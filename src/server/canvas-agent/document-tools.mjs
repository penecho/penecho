import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { TOOLS, validateToolArguments } = require('../mcp/schema.js')
const { executeBoundCanvasTool, BOUND_CANVAS_TOOL_NAMES } = require('../mcp/bound-operations.js')
const { getAuthoringGuidance, CANVAS_RENDERING_ROUTING } = require('../mcp/authoring-guidance.js')

import { harnessDocumentSchema } from './document-schema.mjs'
export { harnessDocumentSchema } from './document-schema.mjs'

export function documentSessionId(session) {
  return `agent-${createHash('sha256').update(String(session.logicalConversationId || session.id)).digest('hex')}`
}

export function validateDocumentToolArguments(name, input, session) {
  if (!name.startsWith('penecho_')) return
  if(name==='penecho_get_guidance')return validateToolArguments(name,input)
  const id=documentSessionId(session)
  if(input?.sessionId!==undefined&&input.sessionId!==id)throw Object.assign(new Error('Omit sessionId; the host binds the current Canvas.'),{code:'SESSION_SCOPE_MISMATCH'})
  if(name==='penecho_upload_image' && input?.attachmentId!==undefined) {
    if(input.source!==undefined)throw new Error('Supply source or attachmentId, not both.')
    if(typeof input.attachmentId!=='string'||!session.attachmentRefs?.has(input.attachmentId))throw Object.assign(new Error('Image attachment is not owned by this PenEcho Agent session.'),{code:'ATTACHMENT_SCOPE_MISMATCH'})
    const {attachmentId,...rest}=input
    return validateToolArguments(name,{...rest,source:'penecho-asset:'+'0'.repeat(64),sessionId:id})
  }
  return validateToolArguments(name,{...input,sessionId:id})
}

export const DOCUMENT_TOOL_INSTRUCTIONS = `${CANVAS_RENDERING_ROUTING} The host binds the current Canvas; omit sessionId. Read virtual source and contentHash before patching; retry uncertain outcomes with identical requestId, conflicts with a fresh read. CANVAS_BUSY is a precondition failure, not a reason to change writing tools. Follow its recovery details: wait for a transient gesture/queue to settle, and stop automatic writes for an unchanged blocked state. Reads and safe source-only edits remain available. Idle selections and open drafts do not lock the whole Canvas. OBJECT_EDIT_CONFLICT protects only the listed objects; leave their unfinished user edits intact and continue independent work. An idle lasso alone does not require cancellation. Use baseRevision for geometry edits. Upload session-owned image attachments and reuse returned sources in Widget HTML img src or CSS url(). Use stable artifactId; host handles placement. Capture only unresolved visual evidence; failed captures may leave applied content. Inbox reads do not acknowledge; keep message and feedback cursors independent. Use mutation completion for successful final status/handled IDs. Load relevant guidance on demand. Stop when correct, readable and usable.`

export function createDocumentTools(session, { wrap, output, saveImage, readImage, onGuidance } = {}) {
  const names = new Set(BOUND_CANVAS_TOOL_NAMES)
  const boundId = documentSessionId(session)
  const bound = session.documentToolSession ||= { id:boundId, connection:null, mutationRequests:new Map(), title:'PenEcho Agent', status:'working', steps:[], events:[] }
  return TOOLS.filter(tool=>names.has(tool.name)||tool.name==='penecho_get_guidance').map(definition=>{
    const schema=structuredClone(definition.inputSchema)
    if (schema.properties.sessionId) schema.required=(schema.required||[]).filter(key=>key!=='sessionId')
    delete schema.properties.sessionId
    if(definition.name==='penecho_upload_image') {
      schema.required=schema.required.filter(key=>key!=='source')
      schema.properties.attachmentId={type:'string',description:'Instead of source, use an image attachmentId from this session host references. Never supply a host path.'}
      schema.oneOf=[{required:['source']},{required:['attachmentId']}]
    }
    const tool={
      name:definition.name, description:definition.description, parameters:harnessDocumentSchema(schema),
      output, timeoutMs:45_000,
      isConcurrencySafe:()=>false,
      async execute(input, exec) {
        if (definition.name==='penecho_get_guidance') {
          const args=validateToolArguments(definition.name,input),guidance=getAuthoringGuidance(args.id,args.detail)
          onGuidance?.(guidance)
          return guidance
        }
        if (input?.sessionId!==undefined && input.sessionId!==boundId) throw Object.assign(new Error('This tool is bound to the current Canvas conversation. Omit sessionId.'),{code:'SESSION_SCOPE_MISMATCH'})
        validateDocumentToolArguments(definition.name,input,session)
        let args={...input,sessionId:boundId}
        if(definition.name==='penecho_upload_image' && args.attachmentId!==undefined) {
          const ref=session.attachmentRefs.get(args.attachmentId)
          if(typeof readImage!=='function')throw new Error('Image attachment reader is unavailable.')
          const stored=await readImage(ref,exec.signal)
          args.source=`data:${stored.ref.mediaType};base64,${Buffer.from(stored.data).toString('base64')}`
          delete args.attachmentId
          args=validateToolArguments(definition.name,args)
        }
        let sequence=0
        const canvasCall=async (_connection,operation,arguments_)=>{
          const requestedAt=Date.now()
          const result=await session.rpc('canvas_document',{operation,arguments:arguments_,bindingKey:boundId},`${exec.callId}:${++sequence}`,exec.signal)
          return {result,timing:{requestedAt,completedAt:Date.now(),durationMs:Date.now()-requestedAt}}
        }
        const result=await executeBoundCanvasTool({name:definition.name,args,session:bound,canvasCall,callOptions:{signal:exec.signal}})
        if (!result.image) return result
        const {image,...metadata}=result
        const attachment=await saveImage(image,exec)
        return {...metadata,attachment}
      },
    }
    if (wrap) tool.execute=wrap(tool.name,tool.execute)
    return tool
  })
}
