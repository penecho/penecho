import { randomUUID } from 'node:crypto'
import { BlockAssembler, CallId } from '@deepseek-ai/dsh-llm'

export const CANVAS_DECISION_FEEDBACK_TOOL = 'penecho_canvas_decision_feedback'
export const CANVAS_DECISION_PROTOCOL_SUMMARY = 'Use at most one tool call per model step. Treat errors as feedback: correct or switch tools and continue; finish only when complete or unable to proceed.'

function decisionError(code, message, details = null) {
  const error = new Error(message)
  error.name = 'CanvasDecisionProtocolError'
  error.code = code
  error.details = details
  return error
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function feedbackFrom(error, details = null) {
  const code = String(error?.code || 'CANVAS_DECISION_REJECTED'), message = String(error?.message || error || 'PenEcho Agent decision was rejected.')
  return Object.freeze({
    code,
    message:`${message} The entire tool decision was rejected before execution; no Canvas tool ran. Return exactly one corrected standard JSON tool call, or a final answer only when the task is complete or cannot proceed.`,
    details:details || error?.details || null,
  })
}

function stageFeedback(session, feedback) {
  const id = CallId(`penecho_decision_${randomUUID()}`), callId = String(id)
  if (!(session?.decisionFeedbackCalls instanceof Map) || !(session?.decisionFeedbackCallIds instanceof Set)) {
    throw new Error('PenEcho Agent decision feedback storage is unavailable.')
  }
  session.decisionFeedbackCalls.set(callId, feedback)
  session.decisionFeedbackCallIds.add(callId)
  session.traceDecisionProtocol?.({ kind:'decision-rejected', code:feedback.code, message:feedback.message, details:feedback.details })
  return { type:'tool-call', id, name:CANVAS_DECISION_FEEDBACK_TOOL, arguments:JSON.stringify({ code:feedback.code }) }
}

function validateToolCall(block, availableTools) {
  const name=String(block?.name||'')
  if(!availableTools.has(name))throw decisionError('CANVAS_TOOL_UNAVAILABLE',`PenEcho Agent requested an unavailable tool: ${name||'(empty)'}.`)
  let args
  try{args=JSON.parse(String(block?.arguments||'{}'))}
  catch(error){throw decisionError('CANVAS_TOOL_ARGUMENTS_INVALID',`${name} arguments are not valid complete JSON: ${error.message}`)}
  if(!isObject(args))throw decisionError('CANVAS_TOOL_ARGUMENTS_INVALID',`${name} arguments must be one JSON object.`)
}

export function admitCanvasDecision({ session, blocks, availableTools = [] }) {
  const content=Array.isArray(blocks)?blocks:[],toolCalls=content.filter(block=>block?.type==='tool-call')
  if(toolCalls.length>1){
    return{kind:'feedback',block:stageFeedback(session,feedbackFrom(decisionError(
      'CANVAS_ONE_TOOL_PER_STEP',
      `Your previous step returned ${toolCalls.length} tool calls, but PenEcho Agent allows at most one tool call per model step.`,
      {toolCallCount:toolCalls.length},
    )))}
  }
  if(!toolCalls.length)return{kind:'final'}
  try{
    validateToolCall(toolCalls[0],new Set(availableTools))
    return{kind:'tool-call',block:toolCalls[0]}
  }catch(error){
    return{kind:'feedback',block:stageFeedback(session,feedbackFrom(error))}
  }
}

function chunkBlockType(chunk) {
  if (chunk.type === 'block-start') return chunk.blockType
  if (chunk.type === 'text-delta') return 'text'
  if (chunk.type === 'reasoning-delta') return 'reasoning'
  if (chunk.type === 'tool-call-delta') return 'tool-call'
  if (chunk.type === 'block-end') return chunk.block?.type
  return null
}

function canonicalToolChunks(block, index) {
  return [
    { type:'block-start', index, blockType:'tool-call' },
    { type:'tool-call-delta', index, id:block.id, name:block.name, argumentsDelta:block.arguments },
    { type:'block-end', index, block },
  ]
}

export async function * admitCanvasAgentDecisionStream(upstream, { session, availableTools = [] } = {}) {
  const assembler=new BlockAssembler(),heldChunks=[],heldUsageChunks=[],seenIndexes=new Set()
  let finish=null
  for await(const chunk of upstream){
    assembler.push(chunk)
    if(Number.isInteger(chunk.index))seenIndexes.add(chunk.index)
    if(chunk.type==='finish'){finish=chunk;break}
    if(chunk.type==='usage'){heldUsageChunks.push(chunk);continue}
    heldChunks.push(chunk)
  }
  const terminal=finish||{type:'finish',reason:{kind:'stop'}},terminalKind=terminal.reason?.kind,assembledBlocks=assembler.blocks(),heldToolCalls=heldChunks.filter(chunk=>chunk.type==='block-end'&&chunk.block?.type==='tool-call').map(chunk=>chunk.block),
    assembledToolCalls=assembledBlocks.filter(block=>block?.type==='tool-call'),toolCalls=assembledToolCalls.length?assembledToolCalls:heldToolCalls,
    blocks=assembledToolCalls.length||!heldToolCalls.length?assembledBlocks:[...assembledBlocks,...heldToolCalls]
  if(terminalKind==='error'||terminalKind==='aborted'){
    for(const held of heldChunks)yield held
    for(const usage of heldUsageChunks)yield usage
    yield terminal
    return
  }
  const admission=terminalKind==='max-tokens'&&toolCalls.length
    ? {kind:'feedback',block:stageFeedback(session,feedbackFrom(decisionError('CANVAS_TOOL_DECISION_INCOMPLETE','A tool decision reached the model token limit and cannot be executed safely.',{terminalKind})))}
    : admitCanvasDecision({session,blocks,availableTools}),
    unchangedSingleTool=admission.kind==='tool-call'&&toolCalls.length===1&&admission.block===toolCalls[0]
  if(admission.kind==='final'||unchangedSingleTool){
    for(const held of heldChunks)yield held
    for(const usage of heldUsageChunks)yield usage
    yield terminal
    return
  }
  for(const held of heldChunks)if(chunkBlockType(held)!=='tool-call')yield held
  const nextIndex=seenIndexes.size?Math.max(...seenIndexes)+1:0
  for(const chunk of canonicalToolChunks(admission.block,nextIndex))yield chunk
  for(const usage of heldUsageChunks)yield usage
  yield{type:'finish',reason:{kind:'tool-calls'}}
}

export function canvasDecisionFeedbackResult(session, exec, next) {
  if (exec?.name !== CANVAS_DECISION_FEEDBACK_TOOL) return next()
  const callId = String(exec.callId || ''), feedback = session?.decisionFeedbackCalls?.get(callId)
  if (!feedback) return next()
  session.decisionFeedbackCalls.delete(callId)
  return Promise.resolve({
    content:[{ type:'text', text:`PenEcho Agent decision rejected: ${feedback.message}` }],
    isError:true,
    error:{ message:feedback.message, info:{ name:'CanvasDecisionProtocolError', code:feedback.code } },
  })
}
