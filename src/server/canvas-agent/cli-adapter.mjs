import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { CallId, LlmAdapter, resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import { HarnessCliSessionManager } from './harness-cli-sessions.mjs'

const require = createRequire(import.meta.url)
const { callKimiCli } = require('../../providers/kimi-cli.js')
const { callCodexCli } = require('../../providers/codex-cli.js')
const { callClaudeCli } = require('../../providers/claude-cli.js')

const CLI_PROVIDERS = new Set(['kimi-cli', 'codex-cli', 'claude-cli'])
const CLI_CONTEXT_WINDOW = 160_000
const CLI_MAX_TOKENS = 8_192
const CLI_MAX_IMAGES = 5
const CLI_REQUEST_IMAGE_MAX_PIXELS = 2048 * 2048
const CLI_REQUEST_IMAGE_MAX_BYTES = 1024 * 1024
const DEFAULT_CLI_TIMEOUT_MS = 180_000
const MAX_CLI_PROMPT_CHARS = 500_000
const CLI_RETRY_POLICY = resolveRetryPolicy({ mode:'normal', maxRetries:0 }, 'penecho-cli-llm.retryPolicy')

const CLI_PROTOCOL_SYSTEM = `You are the model backend for DeepSeek Harness inside PenEcho Canvas.
Harness, not this CLI process, owns the conversation, context, cancellation, and tool loop. You have no direct tools. Never inspect host files, run commands, browse directly, call MCP, delegate, or invent tool results. When a listed search tool is available, request it through Harness like any other listed tool.

Return exactly one JSON object and no markdown fence or surrounding prose:
- To answer the user: {"type":"final","text":"..."}
- To ask Harness to run one listed tool: {"type":"tool_call","name":"canvas_inspect","arguments":{}}

Choose at most one tool per response. Use only a tool listed in the request. The arguments must be one JSON object matching its schema. After Harness supplies the tool result, you will receive a new request containing the updated conversation and should choose the next tool or return the final answer. Do not expose private chain-of-thought.`

function hash(value) {
  return createHash('sha256').update(String(value)).digest('hex')
}

function bounded(value, limit = MAX_CLI_PROMPT_CHARS) {
  const text = String(value ?? '')
  if (text.length > limit) throw new Error('Canvas Agent CLI context exceeds the safe local CLI prompt limit. Start a new conversation or use a larger-context model.')
  return text
}

function connectionSnapshot(connection) {
  return Object.freeze({
    id:String(connection.id),
    name:String(connection.name || ''),
    provider:String(connection.provider),
    cliPath:String(connection.cliPath || connection.provider.replace('-cli', '')),
    cliModel:String(connection.cliModel || ''),
    effort:String(connection.effort || 'config'),
  })
}

export function cliConnectionProfile(connection) {
  if (!connection || !CLI_PROVIDERS.has(connection.provider)) throw new Error('Canvas Agent selected an unsupported CLI connection.')
  const model = String(connection.cliModel || '').trim() || 'default'
  return {
    provider:`penecho-cli-${hash(connection.id).slice(0, 12)}`,
    model,
    displayName:connection.name || ({
      'kimi-cli':'Kimi CLI',
      'codex-cli':'Codex CLI',
      'claude-cli':'Claude CLI',
    }[connection.provider]),
  }
}

function textContent(blocks) {
  return blocks.map(block => {
    if (!block || typeof block !== 'object') return null
    if (block.type === 'text') return { type:'text', text:String(block.text || '') }
    if (block.type === 'reasoning') return null
    if (block.type === 'image') return { type:'image', attachmentId:String(block.attachment?.attachmentId || ''), note:'This active image is attached through the CLI vision input.' }
    if (block.type === 'tool-call') {
      return { type:'tool_call', id:String(block.id), name:String(block.name), arguments:String(block.arguments || '{}') }
    }
    if (block.type === 'tool-result') {
      return {
        type:'tool_result',
        toolCallId:String(block.toolCallId),
        isError:Boolean(block.isError),
        content:textContent(Array.isArray(block.content) ? block.content : []),
      }
    }
    return null
  }).filter(Boolean)
}

function imageRefs(blocks, refs) {
  for (const block of blocks) {
    if (block?.type === 'image' && block.attachment) refs.push(block.attachment)
    if (block?.type === 'tool-result' && Array.isArray(block.content)) imageRefs(block.content, refs)
  }
}

async function activeImageDataUrls(messages, attachments, signal) {
  if (!attachments) return []
  let userRefs = [], userMessageIndex = -1
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index], refs = []
    imageRefs(Array.isArray(message?.content) ? message.content : [], refs)
    if (!refs.length || message.role !== 'user' || message.source?.kind !== 'user') continue
    userRefs = refs.slice(0, CLI_MAX_IMAGES)
    userMessageIndex = index
    break
  }
  let latestGeneratedRef = null
  for (let index = messages.length - 1; index > userMessageIndex; index--) {
    const message = messages[index], refs = []
    if (message.role === 'user' && message.source?.kind === 'user') continue
    imageRefs(Array.isArray(message?.content) ? message.content : [], refs)
    if (refs.length) {
      latestGeneratedRef = refs.at(-1)
      break
    }
  }
  const active = latestGeneratedRef
    ? [...userRefs.slice(0,CLI_MAX_IMAGES-1),latestGeneratedRef]
    : userRefs.slice(0,CLI_MAX_IMAGES)
  return Promise.all(active.map(async ref => {
    const image = await attachments.readImageRequest(ref, { maxPixels:CLI_REQUEST_IMAGE_MAX_PIXELS, maxBytes:CLI_REQUEST_IMAGE_MAX_BYTES }, signal)
    return `data:${image.mediaType};base64,${Buffer.from(image.data).toString('base64')}`
  }))
}

function serializeCliPrompt(options, messages, mode) {
  const conversation = messages.map(message => ({
    role:message.role,
    source:message.source?.kind || 'unknown',
    content:textContent(Array.isArray(message.content) ? message.content : []),
  }))
  const tools = (options.tools || []).map(tool => ({
    name:tool.name,
    description:tool.description,
    parameters:tool.parameters,
  }))
  const prompt = bounded(JSON.stringify({
    purpose:options.purpose || 'conversation',
    ...(mode === 'delta' ? { conversationDelta:conversation } : { conversation }),
    availableTools:tools,
    contextMode:mode,
    instruction:tools.length
      ? `${mode === 'delta' ? 'Continue from the CLI conversation already in memory using only this authoritative Harness delta. ' : ''}Return one tool_call for the next necessary Harness action, or final when the task is complete.`
      : `${mode === 'delta' ? 'Continue from the CLI conversation already in memory using only this authoritative Harness delta. ' : ''}No tools are available for this request. Return final.`,
  }))
  return prompt
}

export async function serializeCliRequest(options, attachments, { messages = options.messages, mode = 'snapshot' } = {}) {
  const prompt = serializeCliPrompt(options, messages, mode)
  const activeImages = await activeImageDataUrls(options.messages, attachments, options.signal)
  return {
    systemPrompt:bounded(`${CLI_PROTOCOL_SYSTEM}\n\n${String(options.system || '')}`),
    prompt,
    atlasImage:activeImages.length > 1 ? activeImages : activeImages[0] || null,
  }
}

function jsonObject(text) {
  const trimmed = String(text || '').trim()
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed)
  const candidate = fenced ? fenced[1] : trimmed
  try { return JSON.parse(candidate) }
  catch {
    const start = candidate.indexOf('{'), end = candidate.lastIndexOf('}')
    if (start >= 0 && end > start) return JSON.parse(candidate.slice(start, end + 1))
    throw new Error('Canvas Agent CLI returned an invalid Harness decision. Expected one JSON object.')
  }
}

function cliReplayAnchor(messages) {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message?.role !== 'assistant' || message?.source?.kind !== 'model') continue
    return message.source.replayState?.response === undefined
      ? { index:-1, replay:null }
      : { index, replay:message.source.replayState.response }
  }
  return { index:-1, replay:null }
}

function harnessSurfaceMarker(messages) {
  const checkpoints = messages.flatMap(message => message?.source?.kind === 'plugin' && message.source.plugin === 'compact'
    ? [`${String(message.source.compactionId || '')}:${String(message.source.sourceCommandId || '')}`]
    : [])
  return checkpoints.length ? hash(JSON.stringify(checkpoints)) : ''
}

export function parseCliDecision(output, toolNames = []) {
  let value
  try { value = jsonObject(output) }
  catch (error) { throw new Error(`Canvas Agent CLI returned an invalid Harness decision: ${error.message}`) }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Canvas Agent CLI decision must be a JSON object.')
  if (value.type === 'final') {
    const text = String(value.text || '').trim()
    if (!text) throw new Error('Canvas Agent CLI returned an empty final answer.')
    return { type:'final', text }
  }
  if (value.type !== 'tool_call') throw new Error('Canvas Agent CLI decision type must be final or tool_call.')
  const name = String(value.name || '')
  if (!toolNames.includes(name)) throw new Error(`Canvas Agent CLI requested unavailable tool: ${name || '(empty)'}.`)
  const args = typeof value.arguments === 'string' ? jsonObject(value.arguments) : value.arguments
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Canvas Agent CLI tool arguments must be a JSON object.')
  return { type:'tool_call', name, arguments:JSON.stringify(args) }
}

function reportedTokenCount(value) {
  const count=Number(value)
  return Number.isFinite(count)&&count>=0?Math.floor(count):null
}

export function normalizeCliTokenUsage(value) {
  if (!value || typeof value!=='object' || Array.isArray(value)) return null
  const totalInput=reportedTokenCount(value.input_tokens??value.prompt_tokens??value.inputTokens),
    cacheRead=reportedTokenCount(value.cached_input_tokens??value.cache_read_tokens??value.input_tokens_details?.cached_tokens??value.cachedInputTokens??value.cacheReadTokens),
    cacheWrite=reportedTokenCount(value.cache_creation_input_tokens??value.cache_write_tokens??value.cacheWriteInputTokens??value.cacheWriteTokens),
    output=reportedTokenCount(value.output_tokens??value.completion_tokens??value.outputTokens),
    reasoning=reportedTokenCount(value.reasoning_output_tokens??value.output_tokens_details?.reasoning_tokens??value.reasoningTokens)
  if ([totalInput,cacheRead,cacheWrite,output,reasoning].every(count=>count===null)) return null
  return {
    inputTokens:Math.max(0,(totalInput??0)-(cacheRead??0)-(cacheWrite??0)),
    outputTokens:output??0,
    ...(cacheRead!==null&&cacheRead>0?{cacheReadTokens:cacheRead}:{}),
    ...(cacheWrite!==null&&cacheWrite>0?{cacheWriteTokens:cacheWrite}:{}),
    ...(reasoning!==null&&reasoning>0?{reasoningTokens:reasoning}:{}),
  }
}

export async function callPenEchoCli({ connection, systemPrompt, prompt, atlasImage, signal, onUsage = null }) {
  const request = {
    executable:connection.cliPath,
    model:connection.cliModel || null,
    effort:connection.effort,
    atlasImage,
    signal,
  }
  if (connection.provider === 'kimi-cli') {
    return callKimiCli({ ...request, prompt:`${systemPrompt}\n\n--- HARNESS REQUEST ---\n${prompt}` })
  }
  if (connection.provider === 'codex-cli') {
    return callCodexCli({ ...request, prompt:`${systemPrompt}\n\n--- HARNESS REQUEST ---\n${prompt}`, onUsage })
  }
  if (connection.provider === 'claude-cli') {
    return callClaudeCli({ ...request, systemPrompt, prompt })
  }
  throw new Error(`Canvas Agent does not support CLI provider ${connection.provider}.`)
}

export class PenEchoCliAdapter extends LlmAdapter {
  constructor({ callCli, sessionManager, attachments = () => undefined, timeoutMs = () => DEFAULT_CLI_TIMEOUT_MS, onDiagnostic = () => {} } = {}) {
    super()
    this.callCli = typeof callCli === 'function' ? callCli : callPenEchoCli
    this.sessionManager = sessionManager === undefined
      ? (typeof callCli === 'function' ? null : new HarnessCliSessionManager())
      : sessionManager
    this.attachments = attachments
    this.timeoutMs = timeoutMs
    this.onDiagnostic = typeof onDiagnostic === 'function' ? onDiagnostic : () => {}
    this.routes = new Map()
  }

  replaceConnections(connections) {
    const routes = new Map()
    for (const connection of connections) {
      if (!CLI_PROVIDERS.has(connection?.provider)) continue
      const profile = cliConnectionProfile(connection)
      routes.set(profile.provider, { profile, connection:connectionSnapshot(connection) })
    }
    this.routes = routes
    return [...routes.keys()]
  }

  route(provider) {
    const route = this.routes.get(provider)
    if (!route) throw new Error(`Canvas Agent CLI provider route is unavailable: ${provider}.`)
    return route
  }

  providerInfo(provider) {
    const route = this.route(provider)
    return { id:provider, name:route.profile.displayName }
  }

  providerRetryPolicy() { return CLI_RETRY_POLICY }

  async listModels(provider) {
    const route = this.route(provider)
    return [this.modelInfo(provider, route.profile.model)]
  }

  modelInfo(provider, model) {
    return {
      provider,
      id:model,
      name:model === 'default' ? 'CLI default model' : model,
      inputModalities:['text', 'image'],
      context:{ contextWindow:CLI_CONTEXT_WINDOW },
      defaultMaxTokens:CLI_MAX_TOKENS,
    }
  }

  async resolveModel(provider, model) {
    this.route(provider)
    return this.modelInfo(provider, model)
  }

  async prepareCall(provider, model) {
    const route = this.route(provider)
    const snapshot = route.connection
    return {
      model:this.modelInfo(provider, model),
      stream:options => this.streamWithConnection(options, snapshot),
    }
  }

  async * stream(options) {
    yield * this.streamWithConnection(options, this.route(options.provider).connection)
  }

  async decision(options, connection) {
    options.signal?.throwIfAborted()
    const configured = Number(this.timeoutMs()), timeoutMs = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_CLI_TIMEOUT_MS,
      controller = new AbortController(), timeoutError = Object.assign(new Error(`Canvas Agent CLI request timed out after ${Math.round(timeoutMs / 1000)} seconds.`), { name:'TimeoutError' }),
      signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal,
      timer = setTimeout(() => controller.abort(timeoutError), timeoutMs)
    timer.unref?.()
    try {
      let usage=null
      let output, replayState
      if (this.sessionManager) {
        const messages = Array.isArray(options.messages) ? options.messages : [], anchor = cliReplayAnchor(messages), replayMessageIndex = anchor.index, replay = anchor.replay,
          requestOptions = { ...options, signal }, attachments = this.attachments(),
          result = await this.sessionManager.request({
            connection,
            harnessSessionId:String(options.sessionId || ''),
            systemPrompt:bounded(`${CLI_PROTOCOL_SYSTEM}\n\n${String(options.system || '')}`),
            surfaceMarker:harnessSurfaceMarker(messages),
            fullRequest:() => serializeCliRequest(requestOptions, attachments),
            deltaRequest:() => serializeCliRequest({ ...requestOptions, messages:messages.slice(replayMessageIndex + 1) }, attachments, { messages:messages.slice(replayMessageIndex + 1), mode:'delta' }),
            signal,
            replay,
            onUsage:value=>{usage=normalizeCliTokenUsage(value)},
          })
        output = result.output
        replayState = result.replayState
      } else {
        const request = await serializeCliRequest({ ...options, signal }, this.attachments())
        output = await this.callCli({ connection, ...request, signal, purpose:options.purpose || 'conversation', onUsage:value=>{usage=normalizeCliTokenUsage(value)} })
      }
      signal.throwIfAborted()
      return { ...parseCliDecision(output, (options.tools || []).map(tool => tool.name)), ...(usage?{usage}:{}), ...(replayState?{replayState}:{}) }
    } catch (error) {
      if (error?.traceDiagnostic) {
        try {
          this.onDiagnostic({
            sessionId:String(options.sessionId || ''),
            provider:connection.provider,
            model:connection.cliModel || options.model || null,
            error:{ name:String(error.name || 'Error'), message:String(error.message || error), code:error.code || null },
            traceDiagnostic:String(error.traceDiagnostic),
          })
        } catch {}
      }
      if (controller.signal.aborted && !options.signal?.aborted) throw timeoutError
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  async * streamWithConnection(options, connection) {
    const decision = await this.decision(options, connection)
    if (decision.type === 'final') {
      yield { type:'block-start', index:0, blockType:'text' }
      yield { type:'text-delta', index:0, text:decision.text }
      yield { type:'block-end', index:0, block:{ type:'text', text:decision.text } }
      if (decision.usage) yield { type:'usage', usage:decision.usage }
      yield { type:'finish', reason:{ kind:'stop' }, ...(decision.replayState?{replayState:decision.replayState}:{}) }
      return
    }
    const id = CallId(`penecho_cli_${randomUUID()}`)
    yield { type:'block-start', index:0, blockType:'tool-call' }
    yield { type:'tool-call-delta', index:0, id, name:decision.name, argumentsDelta:decision.arguments }
    yield { type:'block-end', index:0, block:{ type:'tool-call', id, name:decision.name, arguments:decision.arguments } }
    if (decision.usage) yield { type:'usage', usage:decision.usage }
    yield { type:'finish', reason:{ kind:'tool-calls' }, ...(decision.replayState?{replayState:decision.replayState}:{}) }
  }

  async disposeSession(sessionId) {
    await this.sessionManager?.disposeSession(sessionId)
  }

  async dispose() {
    await this.sessionManager?.dispose()
  }
}

export const PenEchoCliLlmPlugin = {
  name:'penecho-cli-llm',
  inject:['llm', 'attachments'],
  apply(ctx, { host }) {
    host.installCliAdapter(ctx)
  },
}
