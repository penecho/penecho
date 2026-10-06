import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { isDeepStrictEqual } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import { admitEncodedImages } from '@deepseek-ai/dsh-attachment'
import { canvasAgentConversationContinuity } from './conversation-continuity.mjs'
import { createCanvasDecisionBatch, MAX_CANVAS_DECISION_TOOLS, CANVAS_MUTATION_TOOLS } from './tool-batch.mjs'
import PenEchoAttachmentStore from './image-attachments.mjs'
import { NativeActivityDiagnostics } from './native-activity-diagnostics.mjs'
import { DEFAULT_CANVAS_AGENT_IDLE_TIMEOUT_MS, canvasAgentTimeoutSeconds, createCanvasAgentModelTimeout } from './model-timeout.mjs'
import {
  CANVAS_AGENT_MAX_TURN_ATTACHMENTS,
  acquireProjectRoot,
  admitInitialCanvasState,
  boundedText,
  canvasBrowserToolError,
  canvasAgentHandwritingAdmissionDiagnostic,
  clearCanvasAgentTurnFiles,
  conversationLogEvent,
  createCanvasAgentNativeRuntime,
  createProjectRuntimeDirectory,
  createSelectedFileSnapshot,
  discardCanvasAgentTurnFiles,
  freshCanvasAgentTurnBudget,
  freshVisualExplainerBudget,
  freshVisualExplorerBudget,
  isCanvasAgentHandwritingImageName,
  loadCanvasAgentContract,
  loadCanvasAgentPublicApi,
  loadCanvasAgentVisualExplorerContract,
  loadCanvasAgentVisualSkills,
  normalizeResolvedWidgetCapabilities,
  normalizeCanvasAgentTurnFileIds,
  parseCanvasTitleEnvelope,
  prepareCanvasAgentTurnFiles,
  projectSessionCapabilities,
  publicSessionProject,
  publicWidgetCapabilities,
  redactPublicProjectValue,
  releaseProjectRoot,
  removeProjectRuntimeDirectory,
  requestTraceConnection,
  resolveCanvasAgentRequestEffort,
} from './runtime.mjs'

const require = createRequire(import.meta.url)
const { prepareIsolatedRuntime, resolveCodexLaunch } = require('../../providers/codex-cli.js')
const { canonicalFile, cliCandidates, managedCliPaths } = require('../../providers/cli-discovery.js')
const { DEFAULT_CANVAS_AGENT_TURN_LIMIT, configuredCanvasAgentTurnLimit } = require('./turn-limit.js')
const { CODEX_CLI_PINNED_VERSION, assertCodexCliBundle, assertCodexCliVersion, installCli, runProcess } = require('../../providers/cli-installer.js')
const { fetchPublicResource } = require('../public-fetch.js')

const MAX_PROTOCOL_BYTES = 48 * 1024 * 1024
const MAX_STDERR_BYTES = 16 * 1024
const SESSION_TTL_MS = 30_000
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000
const INTERRUPT_REQUEST_TIMEOUT_MS = 5_000
const MAX_BACKLOG = 500
const MAX_AGENT_RESPONSE_CHARS = 400_000
const MAX_NATIVE_PROGRESS_SCAN_CHARS = 512
const CODEX_CLI_RESOLUTION_CACHE_VERSION = 1
const CODEX_MODEL_IMAGE_REQUEST_POLICY = Object.freeze({ maxPixels:2048 * 2048, maxBytes:5 * 1024 * 1024 })
const CODEX_DISABLED_FEATURES = Object.freeze([
  'apps', 'auth_elicitation', 'browser_use', 'browser_use_external', 'browser_use_full_cdp_access', 'code_mode', 'computer_use',
  'goals', 'hooks', 'image_generation', 'in_app_browser', 'memories', 'multi_agent', 'multi_agent_v2', 'network_proxy', 'plugins', 'plugin_sharing',
  'recommended_plugins', 'remote_plugin', 'skill_search',
  'request_permissions_tool', 'shell_snapshot', 'shell_tool', 'skill_mcp_dependency_install', 'tool_call_mcp_elicitation', 'tool_suggest', 'unified_exec', 'workspace_dependencies',
  'view_image',
])
const CODEX_STRICT_CONFIG = Object.freeze([
  'approval_policy="never"',
  'web_search="disabled"',
  'mcp_servers={}',
  'project_doc_max_bytes=0',
  'project_root_markers=[]',
  'include_environment_context=false',
  'include_apps_instructions=false',
  'include_collaboration_mode_instructions=false',
  'skills.include_instructions=false',
  'skills.bundled.enabled=false',
  'orchestrator.skills.enabled=false',
  'orchestrator.mcp.enabled=false',
  'memories.generate_memories=false',
  'memories.use_memories=false',
  'memories.dedicated_tools=false',
  'notify=[]',
  'check_for_update_on_startup=false',
  'analytics.enabled=false',
  'feedback.enabled=false',
  'history.persistence="none"',
])
const CODEX_NATIVE_TURN_ACTIVITY_NOTIFICATIONS = new Set([
  'item/started',
  'item/reasoning/summaryPartAdded',
  'item/reasoning/summaryTextDelta',
  'item/reasoning/textDelta',
  'item/plan/delta',
  'item/commandExecution/outputDelta',
  'item/commandExecution/terminalInteraction',
  'item/fileChange/outputDelta',
  'item/fileChange/patchUpdated',
  'item/mcpToolCall/progress',
  'item/autoApprovalReview/started',
  'item/autoApprovalReview/completed',
  'autoApprovalReview/strictReviewRequired',
  'turn/plan/updated',
  'turn/diff/updated',
])
const CODEX_NATIVE_KNOWN_NOTIFICATIONS = new Set([
  ...CODEX_NATIVE_TURN_ACTIVITY_NOTIFICATIONS,
  'error',
  'thread/closed',
  'thread/tokenUsage/updated',
  'thread/compacted',
  'turn/started',
  'turn/completed',
  'rawResponseItem/completed',
  'rawResponse/completed',
  'item/agentMessage/delta',
  'item/completed',
])
const CODEX_NATIVE_CAPTURE_CONSUMPTION_CONTRACT = [
  'Code Mode capture result contract: await tools.penecho__canvas_capture(args) may return a structured result or a nested result string containing metadata and a data:image/png;base64,... or data:image/webp;base64,... URL.',
  'Extract the image URL and forward it with image(url); forward metadata separately with text(metadata).',
  'Do not inspect r.content, guess a content shape, or call text(raw) while raw still contains the image data.',
  'Standard form: const r=await tools.penecho__canvas_capture(args); const raw=r&&typeof r===\'object\'&&\'result\' in r?r.result:r; const imageUrl=typeof raw===\'string\'?raw.match(/data:image\\/(?:png|webp);base64,[A-Za-z0-9+/=]+/)?.[0]:raw?.imageUrl??raw?.dataUrl??(typeof raw?.image===\'string\'?raw.image:null)??raw?.attachment?.dataUrl; const metadata=typeof raw===\'string\'?raw.replace(/data:image\\/(?:png|webp);base64,[A-Za-z0-9+/=]+/g,\'\').trim():raw?.metadata??Object.fromEntries(Object.entries(raw&&typeof raw===\'object\'?raw:{}).filter(([key])=>![\'image\',\'imageUrl\',\'dataUrl\',\'attachment\'].includes(key))); if(metadata)text(typeof metadata===\'string\'?metadata:JSON.stringify(metadata)); if(imageUrl)image(imageUrl).',
].join(' ')
const CODEX_NATIVE_CAPTURE_DATA_URL_PATTERN = /data:image\/(?:png|webp);base64,[A-Za-z0-9+/=]+/g

export function addCodexNativeCaptureContract(dynamicTools) {
  if (!Array.isArray(dynamicTools)) return dynamicTools
  return dynamicTools.map(namespace => {
    if (namespace?.type !== 'namespace' || namespace.name !== 'penecho' || !Array.isArray(namespace.tools)) return namespace
    return {
      ...namespace,
      tools:namespace.tools.map(tool => {
        if (tool?.name !== 'canvas_capture') return tool
        const description=String(tool.description || '')
        return description.includes(CODEX_NATIVE_CAPTURE_CONSUMPTION_CONTRACT)
          ? tool
          : { ...tool, description:`${description}${description ? ' ' : ''}${CODEX_NATIVE_CAPTURE_CONSUMPTION_CONTRACT}` }
      }),
    }
  })
}

export function sanitizeCodexNativeCaptureMetadataText(value) {
  return typeof value === 'string'
    ? value.replace(CODEX_NATIVE_CAPTURE_DATA_URL_PATTERN, '[image forwarded separately]')
    : value
}

function nativeInputImageUrl(stored) {
  const mediaType=String(stored?.ref?.mediaType || stored?.mediaType || '')
  return `data:${mediaType};base64,${Buffer.from(stored?.data || '').toString('base64')}`
}

export async function nativeToolContentItems({ name, value, renderedBlocks = [], readImageRequest, imagePolicy, signal }) {
  if (typeof readImageRequest !== 'function') throw new Error('Codex Native image reader is unavailable.')
  const contentItems=[]
  for (const block of renderedBlocks || []) {
    if (block?.type === 'text' && typeof block.text === 'string') {
      const text=name === 'canvas_capture' ? sanitizeCodexNativeCaptureMetadataText(block.text) : block.text
      contentItems.push({ type:'inputText', text:boundedText(text, 400_000) })
    } else if (block?.type === 'image' && block.attachment?.attachmentId) {
      const stored=await readImageRequest(block.attachment, imagePolicy, signal)
      contentItems.push({ type:'inputImage', imageUrl:nativeInputImageUrl(stored) })
    }
  }
  const directAttachment=value?.attachment?.attachmentId ? value.attachment : null
  if (directAttachment && value?.reusedActiveImage !== true && !contentItems.some(item => item.type === 'inputImage')) {
    const stored=await readImageRequest(directAttachment, imagePolicy, signal)
    contentItems.push({ type:'inputImage', imageUrl:nativeInputImageUrl(stored) })
  }
  return contentItems
}

function hash(value) {
  return createHash('sha256').update(String(value)).digest('hex')
}

function codexCliResolutionKey(connection) {
  return hash(JSON.stringify({
    provider:String(connection?.provider || ''),
    cliPath:String(connection?.cliPath || ''),
  }))
}

function codexCliResolutionFile(stateDirectory) {
  return join(stateDirectory, 'tools', 'codex', 'resolution.json')
}

function readCodexCliResolutions(stateDirectory) {
  try {
    const parsed=JSON.parse(readFileSync(codexCliResolutionFile(stateDirectory),'utf8'))
    if(parsed?.version!==CODEX_CLI_RESOLUTION_CACHE_VERSION||parsed?.pinnedVersion!==CODEX_CLI_PINNED_VERSION||!Array.isArray(parsed.entries))return new Map()
    return new Map(parsed.entries.flatMap(entry=>{
      const key=String(entry?.key||''),executable=String(entry?.executable||'').trim()
      return /^[0-9a-f]{64}$/.test(key)&&executable&&executable.length<=4096?[[key,executable]]:[]
    }))
  } catch { return new Map() }
}

function writeCodexCliResolutions(stateDirectory, resolutions) {
  const directory=join(stateDirectory,'tools','codex'),file=codexCliResolutionFile(stateDirectory),temporary=`${file}.${process.pid}.tmp`
  mkdirSync(directory,{recursive:true,mode:0o700})
  const entries=[...resolutions].sort(([left],[right])=>left.localeCompare(right)).map(([key,executable])=>({key,executable}))
  writeFileSync(temporary,`${JSON.stringify({version:CODEX_CLI_RESOLUTION_CACHE_VERSION,pinnedVersion:CODEX_CLI_PINNED_VERSION,entries},null,2)}\n`,{encoding:'utf8',mode:0o600})
  renameSync(temporary,file)
  try { chmodSync(file,0o600) } catch(error) { if(process.platform!=='win32')throw error }
}

function token(length = 32) {
  return randomBytes(length).toString('base64url')
}

function configured(value) {
  const text = String(value || '').trim()
  return text && text !== 'config' && text !== 'default' ? text : null
}

function safeError(error, fallback = 'Codex Native PenEcho Agent failed.') {
  return String(error?.message || error || fallback)
    .replace(/\/(?:[\w.-]+\/)+[\w.-]+/g, '<path>')
    .replace(/\b[A-Za-z]:\\(?:[^\\\s]+\\)+[^\\\s]+/g, '<path>')
    .replace(/\b(api[-_]?key|access[-_]?token|refresh[-_]?token|authorization|cookie|secret)\s*[:=]\s*[^\s,;}]+/gi, '$1=<redacted>')
    .slice(0, 2_000)
}

function codexNativeResetRequired(message) {
  return Object.assign(new Error(message),{codexNativeResetRequired:true})
}

function codexFailureStderr(value) {
  return String(value || '').split(/\r?\n/).filter(line => !/^WARNING: proceeding, even though we could not (?:create PATH aliases|update PATH):/i.test(line.trim())).join('\n').trim()
}

function codexProtocolLineTooLargeError() {
  return new Error('Codex returned more attachment data than PenEcho can safely process in one message. Send fewer or smaller images and try again.')
}

function nativeRawDecisionCall(item) {
  const itemId=String(item?.id||''),callId=String(item?.call_id||item?.callId||''),aliases=[...new Set([itemId,callId].filter(value=>value&&value.length<=256))],
    name=String(item?.name||''),argumentsValue=item?.arguments??item?.input??null,
    underlyingToolNames=name==='exec'&&typeof argumentsValue==='string'
      ? [...argumentsValue.matchAll(/\btools\.penecho__([A-Za-z0-9_]+)\s*\(/g)].map(match=>match[1])
      : name?[name]:[]
  return{
    itemId:itemId&&itemId.length<=256?itemId:null,
    callId:callId&&callId.length<=256?callId:null,
    aliases,
    name,
    namespace:item?.namespace==null?null:String(item.namespace),
    arguments:argumentsValue,
    underlyingToolNames,
    admitted:false,
  }
}

function codexConnectionFingerprint(connection) {
  return hash(JSON.stringify({
    id:String(connection?.id || ''),
    provider:String(connection?.provider || ''),
    cliPath:String(connection?.cliPath || ''),
    cliModel:String(connection?.cliModel || ''),
    effort:String(connection?.effort || ''),
  }))
}

function installedCodexCandidates(connection, env, stateDirectory, platform = process.platform) {
  const configuredPath=String(connection?.cliPath || 'codex').trim() || 'codex', candidates=cliCandidates('codex-cli', {
    env,
    platform,
    stateDir:stateDirectory,
    configuredPath,
  }), privateExecutable=managedCliPaths('codex-cli',{env,platform,stateDir:stateDirectory})[0]
  return candidates.map(candidate=>canonicalFile(candidate.executable)===canonicalFile(privateExecutable)
    ? {...candidate,source:'penecho-managed',privateManaged:true}
    : candidate)
}

async function inspectCodexCandidateVersion(candidate, env, cwd, platform = process.platform) {
  assertCodexCliBundle(candidate.executable,platform)
  const launch=resolveCodexLaunch(candidate.executable,env),result=await runProcess(launch.command,[...launch.prefixArgs,'--version'],{
    cwd,
    env,
    timeoutMs:15_000,
  })
  return String(result.output||result.diagnostic||'').slice(0,200)
}

function systemCodexFallbacks(candidates, preferred) {
  const preferredCanonical=preferred?canonicalFile(preferred.executable):'',seen=new Set(),fallbacks=[]
  for(const candidate of candidates){
    const canonical=canonicalFile(candidate.executable)
    if(candidate.privateManaged||canonical===preferredCanonical||seen.has(canonical))continue
    seen.add(canonical)
    fallbacks.push(candidate)
  }
  return fallbacks
}

function codexCandidateFailure(failures) {
  if (failures.length === 1) return failures[0].error
  const messages=[...new Set(failures.map(failure=>safeError(failure.error)).filter(Boolean))], authentication=messages.find(message=>/authenticat|unauthori|not logged|login required|\b401\b/i.test(message)),
    error=new Error(authentication
      ? `Every installed Codex CLI candidate requires authentication or failed to start. ${authentication}`
      : `No compatible installed Codex CLI could start PenEcho Agent.${messages.length ? ` ${messages.at(-1)}` : ''}`)
  error.code=authentication ? 'CODEX_CLI_AUTHENTICATION_REQUIRED' : 'CODEX_CLI_INCOMPATIBLE'
  error.diagnostic=JSON.stringify(failures.map(failure=>({source:failure.source,error:safeError(failure.error)})))
  return error
}

function agentMessageText(item) {
  if (!item || typeof item !== 'object') return ''
  const type = String(item.type || '').toLowerCase()
  if (!['agentmessage', 'agent_message', 'assistantmessage', 'assistant_message', 'message'].includes(type)) return ''
  if (typeof item.text === 'string') return item.text
  if (typeof item.content === 'string') return item.content
  if (!Array.isArray(item.content)) return ''
  return item.content.map(part => typeof part === 'string' ? part : part?.text || part?.outputText || part?.output_text || '').join('')
}

function compactUsage(value) {
  if (!value || typeof value !== 'object') return null
  const compactNumber = item => item !== null && item !== undefined && Number.isSafeInteger(Number(item)) && Number(item) >= 0 ? Number(item) : null
  const breakdown = item => (!item || typeof item !== 'object') ? null : Object.fromEntries(Object.entries({
    inputTokens:compactNumber(item.inputTokens),
    cachedInputTokens:compactNumber(item.cachedInputTokens),
    cacheWriteInputTokens:compactNumber(item.cacheWriteInputTokens),
    outputTokens:compactNumber(item.outputTokens),
    reasoningOutputTokens:compactNumber(item.reasoningOutputTokens),
    totalTokens:compactNumber(item.totalTokens),
  }).filter(([,number]) => number !== null))
  return {
    ...(breakdown(value.last) ? { last:breakdown(value.last) } : {}),
    ...(breakdown(value.total) ? { total:breakdown(value.total) } : {}),
    ...(Number.isSafeInteger(Number(value.modelContextWindow)) && Number(value.modelContextWindow) >= 0 ? { modelContextWindow:Number(value.modelContextWindow) } : {}),
  }
}

function raceAbortableExecution(execution, signal, fallbackMessage) {
  if (!signal) return Promise.resolve(execution)
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error, value) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', abort)
      if (error) reject(error)
      else resolve(value)
    }
    const abort = () => {
      const reason = signal.reason instanceof Error ? signal.reason : new Error(fallbackMessage)
      finish(reason)
    }
    if (signal.aborted) {
      abort()
      return
    }
    signal.addEventListener('abort', abort, { once:true })
    Promise.resolve(execution).then(
      value => finish(null, value),
      error => finish(error),
    )
  })
}

async function stopProcessTree(child) {
  if (!child?.pid) return
  if (process.platform === 'win32') {
    const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { stdio:'ignore', windowsHide:true, shell:false })
    await new Promise(resolve => {
      const timer = setTimeout(() => {
        try { killer.kill() } catch {}
        try { child.kill() } catch {}
        resolve()
      }, 2_000)
      const finish = () => { clearTimeout(timer); resolve() }
      killer.once('error', () => { try { child.kill() } catch {}; finish() })
      killer.once('close', finish)
    })
    return
  }
  try { process.kill(-child.pid, 'SIGTERM') } catch {
    try { child.kill('SIGTERM') } catch {}
  }
  const deadline = Date.now() + 1_000
  const exists = () => {
    try { process.kill(-child.pid, 0); return true } catch { return false }
  }
  while (exists() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 40))
  if (exists()) {
    try { process.kill(-child.pid, 'SIGKILL') } catch {}
  }
}

function codexAppServerArgs() {
  const args = ['app-server', '--stdio', '--strict-config']
  for (const feature of CODEX_DISABLED_FEATURES) args.push('--disable', feature)
  for (const config of CODEX_STRICT_CONFIG) args.push('-c', config)
  return args
}

export class CodexNativeAppServerProcess {
  constructor({ connection, env = process.env, logger = () => {}, spawnProcess = spawn, prepareRuntime = prepareIsolatedRuntime, runtimeDirectory = null, diagnostics = null, diagnosticsEnabled = Boolean(diagnostics), onNotification = null, onRequest = null, onToolReply = null, onGone = null }) {
    this.connection = connection
    this.env = env
    this.logger = logger
    this.spawnProcess = spawnProcess
    this.prepareRuntime = prepareRuntime
    this.runtimeDirectory = runtimeDirectory ? String(runtimeDirectory) : null
    this.child = null
    this.workDir = null
    this.launch = null
    this.nextRequestId = 0
    this.pending = new Map()
    this.buffer = ''
    this.stderr = ''
    this.closed = false
    this.closing = null
    this.termination = null
    this.diagnostics = diagnosticsEnabled ? diagnostics : null
    this.onNotification = this.optionalCallback(onNotification, 'onNotification')
    this.onRequest = this.optionalCallback(onRequest, 'onRequest')
    this.onToolReply = this.optionalCallback(onToolReply, 'onToolReply')
    this.onGone = this.optionalCallback(onGone, 'onGone')
    try { this.diagnostics?.setRawBufferBytes(0) } catch {}
  }

  optionalCallback(value, name) {
    if (value == null) return null
    if (typeof value !== 'function') throw new Error(`Codex app-server ${name} callback is invalid.`)
    return value
  }

  get alive() {
    return !this.closed && Boolean(this.child) && Boolean(this.threadId)
  }

  async start({ model, cwd, baseInstructions, dynamicTools }) {
    if (this.closed) throw new Error('Codex app-server process is closed.')
    if (this.child || this.workDir) throw new Error('Codex app-server process was already started.')
    const runtimeDirectory = this.runtimeDirectory || tmpdir()
    if (this.runtimeDirectory) {
      await mkdir(runtimeDirectory, { recursive:true, mode:0o700 })
      await chmod(runtimeDirectory, 0o700).catch(() => {})
    }
    this.workDir = await mkdtemp(join(runtimeDirectory, 'penecho-canvas-codex-'))
    await chmod(this.workDir, 0o700).catch(() => {})
    try {
    this.launch = resolveCodexLaunch(this.connection.cliPath, this.env)
    const childEnv = await this.prepareRuntime(this.workDir, this.env)
    this.child = this.spawnProcess(this.launch.command, [...this.launch.prefixArgs, ...codexAppServerArgs()], {
      cwd:this.workDir,
      env:childEnv,
      stdio:['pipe', 'pipe', 'pipe'],
      windowsHide:true,
      shell:false,
      detached:process.platform !== 'win32',
    })
    this.child.stdout?.setEncoding?.('utf8')
    this.child.stderr?.setEncoding?.('utf8')
    this.child.stdout?.on?.('data', chunk => this.handleData(chunk))
    this.child.stderr?.on?.('data', chunk => {
      try { this.diagnostics?.recordStderrChunk(chunk) } catch {}
      this.stderr = `${this.stderr}${chunk}`.slice(-MAX_STDERR_BYTES)
    })
    this.child.once('error', error => this.processGone(error))
    this.child.once('exit', (code, signal) => {
      try { this.diagnostics?.recordProcessExit(code, signal) } catch {}
      this.processGone(new Error(`Codex app-server exited (${signal ?? code}).`))
    })
    this.child.stdin?.on?.('error', error => {
      if (error?.code !== 'EPIPE') this.processGone(error)
    })

      await this.request('initialize', {
        clientInfo:{ name:'penecho-canvas-agent', title:'PenEcho Agent', version:'1' },
        capabilities:{ experimentalApi:true },
      }, DEFAULT_REQUEST_TIMEOUT_MS)
      this.notify('initialized', {})
      const result = await this.request('thread/start', {
        ...(configured(model) ? { model:configured(model) } : {}),
        cwd,
        approvalPolicy:'never',
        sandbox:'read-only',
        baseInstructions,
        developerInstructions:null,
        dynamicTools,
        experimentalRawEvents:true,
        environments:[],
        runtimeWorkspaceRoots:[],
        ephemeral:true,
      }, DEFAULT_REQUEST_TIMEOUT_MS)
      this.threadId = String(result?.thread?.id || '')
      if (!this.threadId) throw new Error('Codex app-server did not return a thread id.')
      if (result.thread.ephemeral !== true) throw new Error('Codex app-server returned a non-ephemeral thread.')
      return this.threadId
    } catch (error) {
      await this.close().catch(() => {})
      throw error
    }
  }

  request(method, params = {}, timeoutMs = null) {
    if (!this.child?.stdin?.writable) return Promise.reject(new Error('Codex app-server is not running.'))
    const id = ++this.nextRequestId
    return new Promise((resolve, reject) => {
      let timer = null
      if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
        timer = setTimeout(() => {
          this.pending.delete(id)
          reject(new Error(`${method} timed out.`))
        }, timeoutMs)
      }
      this.pending.set(id, { method, resolve, reject, timer })
      try {
        this.write({ id, method, params })
      } catch (error) {
        if (timer) clearTimeout(timer)
        this.pending.delete(id)
        reject(error)
      }
    })
  }

  notify(method, params = {}) {
    this.write({ method, params })
  }

  respond(id, result = {}) {
    this.write({ id, result }, { toolReply:true, requestId:id })
  }

  respondError(id, message) {
    this.write({ id, error:{ code:-32000, message:safeError(message, 'Codex dynamic tool failed.') } }, { toolReply:true, requestId:id })
  }

  async interrupt(threadId, turnId) {
    if (!this.alive || !threadId || !turnId) return
    await this.request('turn/interrupt', { threadId, turnId }, INTERRUPT_REQUEST_TIMEOUT_MS)
  }

  async close() {
    if (this.closing) return this.closing
    this.closed = true
    this.closing = (async () => {
      const child = this.child
      this.child = null
      const error = new Error('Codex app-server process closed.')
      for (const pending of this.pending.values()) {
        if (pending.timer) clearTimeout(pending.timer)
        pending.reject(error)
      }
      this.pending.clear()
      if (child) {
        try { child.stdin?.end?.() } catch {}
        this.termination ||= stopProcessTree(child).catch(() => {})
      }
      if (this.termination) await this.termination
      if (this.workDir) {
        await rm(this.workDir, { recursive:true, force:true, maxRetries:5, retryDelay:100 }).catch(error => {
          this.logger({ type:'codex-native-cleanup-error', error:safeError(error) })
        })
        this.workDir = null
      }
    })()
    return this.closing
  }

  handleData(chunk) {
    try { this.diagnostics?.recordStdoutChunk(chunk) } catch {}
    this.buffer += String(chunk)
    try {
      if (Buffer.byteLength(this.buffer, 'utf8') > MAX_PROTOCOL_BYTES && !this.buffer.includes('\n')) {
        this.processGone(codexProtocolLineTooLargeError())
        return
      }
      let newline
      while ((newline = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, newline).trim()
        this.buffer = this.buffer.slice(newline + 1)
        if (!line) continue
        if (Buffer.byteLength(line, 'utf8') > MAX_PROTOCOL_BYTES) {
          this.processGone(codexProtocolLineTooLargeError())
          return
        }
        let message
        try { message = JSON.parse(line) }
        catch {
          this.processGone(new Error('Codex app-server emitted invalid JSON-RPC output.'))
          return
        }
        try { this.diagnostics?.recordJsonLine() } catch {}
        this.handleMessage(message)
        if (!this.child) return
      }
    } finally { try { this.diagnostics?.setRawBufferBytes(Buffer.byteLength(this.buffer, 'utf8')) } catch {} }
  }

  handleMessage(message) {
    if (message?.id !== undefined && message.method === undefined) {
      const pending = this.pending.get(message.id)
      if (!pending) {
        this.processGone(new Error('Codex app-server returned an unknown JSON-RPC response id.'))
        return
      }
      this.pending.delete(message.id)
      if (pending.timer) clearTimeout(pending.timer)
      if (!('result' in message) && !('error' in message)) {
        this.processGone(new Error('Codex app-server returned an invalid JSON-RPC response.'))
        return
      }
      if (message.error) {
        const error = new Error(`${pending.method} failed: ${message.error.message || JSON.stringify(message.error)}`)
        error.data = message.error.data
        pending.reject(error)
      } else pending.resolve(message.result)
      return
    }
    if (message?.method !== undefined && message.id !== undefined) {
      const handler = this.onRequest
      if (!handler) {
        try { this.respondError(message.id, 'Codex app-server request handler is unavailable.') }
        catch (error) { this.processGone(error) }
        return
      }
      Promise.resolve().then(() => handler(message.id, message.method, message.params)).then(
        result => this.respond(message.id, result ?? {}),
        error => this.respondError(message.id, error),
      ).catch(() => {})
      return
    }
    if (message?.method !== undefined) {
      try { this.onNotification?.(message.method, message.params || {}) } catch (error) { this.logger({ type:'codex-native-event-error', error:safeError(error) }) }
    }
  }

  write(message, { toolReply = false, requestId = null } = {}) {
    if (!this.child?.stdin?.writable) throw new Error('Codex app-server is not running.')
    const serialized=`${JSON.stringify(message)}\n`
    if (!toolReply || !this.diagnostics) {
      this.child.stdin.write(serialized)
      return
    }
    this.child.stdin.write(serialized, error => {
      try { this.diagnostics?.recordJsonRpcReply({ callback:true, error:Boolean(error) }) } catch {}
      try { this.onToolReply?.({ stage:'callback', error:Boolean(error), requestId }) } catch {}
    })
    try { this.diagnostics?.recordJsonRpcReply() } catch {}
    try { this.onToolReply?.({ stage:'written', error:false, requestId }) } catch {}
  }

  processGone(error) {
    const child = this.child
    if (!child) return
    this.child = null
    const stderr=safeError(codexFailureStderr(this.stderr),''),failure=stderr ? Object.assign(new Error(`${safeError(error)} ${stderr}`),{cause:error,traceDiagnostic:stderr}) : error
    for (const pending of this.pending.values()) {
      if (pending.timer) clearTimeout(pending.timer)
      pending.reject(failure)
    }
    this.pending.clear()
    try { this.onGone?.(failure) } catch {}
    this.termination ||= stopProcessTree(child).catch(() => {})
  }
}

export class CodexNativeHost {
  constructor({
    stateDirectory,
    rootDirectory,
    resolveConnection,
    resolveWebSearch = () => null,
    resolveWidgetCapabilities = () => ({ professionalEnabled:false, privatePlugins:[] }),
    resolveProject = async () => null,
    modelTimeoutMs = () => DEFAULT_CANVAS_AGENT_IDLE_TIMEOUT_MS,
    canvasAgentTurnLimit = () => DEFAULT_CANVAS_AGENT_TURN_LIMIT,
    logger = () => {},
    conversationLogger = null,
    conversationTrace = null,
    onModelUsage = null,
    env = process.env,
    createAppServer = null,
    resolveCliCandidates = null,
    inspectCliCandidate = null,
    installManagedCli = null,
    platform = process.platform,
    sessionTtlMs = SESSION_TTL_MS,
    publicFetch = fetchPublicResource,
  }) {
    this.stateDirectory = stateDirectory
    this.rootDirectory = rootDirectory
    this.resolveConnection = resolveConnection
    this.resolveWebSearch = resolveWebSearch
    this.resolveWidgetCapabilities = resolveWidgetCapabilities
    this.resolveProject = resolveProject
    this.modelTimeoutMs = modelTimeoutMs
    this.canvasAgentTurnLimit = canvasAgentTurnLimit
    this.logger = logger
    this.conversationLogger = typeof conversationLogger === 'function' ? conversationLogger : null
    this.conversationTrace = typeof conversationTrace === 'function' ? conversationTrace : null
    this.onModelUsage = typeof onModelUsage === 'function' ? onModelUsage : null
    this.env = env
    this.platform = platform
    if (typeof publicFetch !== 'function') throw new Error('Codex Native PenEcho Agent public fetch is invalid.')
    this.publicFetch = publicFetch
    this.createAppServer = createAppServer || (options => new CodexNativeAppServerProcess(options))
    this.resolveCliCandidates = resolveCliCandidates || (connection => installedCodexCandidates(connection,this.env,this.stateDirectory,this.platform))
    this.inspectCliCandidate = inspectCliCandidate || (candidate => inspectCodexCandidateVersion(candidate,this.env,this.stateDirectory,this.platform))
    this.installManagedCli = installManagedCli || (codexVersion => installCli('codex-cli',{
      platform:this.platform,
      home:this.env.USERPROFILE||this.env.HOME||homedir(),
      stateDir:this.stateDirectory,
      env:this.env,
      codexVersion,
    }))
    this.managedCliInstalls = new Map()
    this.preferredCliExecutables = readCodexCliResolutions(this.stateDirectory)
    this.sessionTtlMs = Math.max(1_000, Number(sessionTtlMs) || SESSION_TTL_MS)
    this.sessions = new Map()
    this.resumeIndex = new Map()
    this.context = new Context()
    this.attachments = new PenEchoAttachmentStore(this.context, { dshHome:join(stateDirectory, 'codex-native') })
    this.attachments.requestImageObserver = record => this.traceModelRequestImage(record)
    this.disposing = null
  }

  async initialize() { return this }

  async connect(options) {
    const {
      canvasSessionId = '', resumeToken = '', clientId = '', connectionId = 'default', conversationId = '', webSearchEnabled = false,
      widgetCapabilities = {}, projectId = '', accessMode = 'controlled', binding = null, send = null, initialBacklog = [], continuity = '',
    } = options || {}
    if (String(canvasSessionId).length > 256 || String(resumeToken).length > 256 || String(clientId).length > 256 || String(connectionId).length > 256 || String(conversationId).length > 256 || /[\r\n\0]/.test(String(conversationId || '')) || String(projectId).length > 128) {
      throw new Error('PenEcho Agent connection identity is invalid.')
    }
    const normalizedProjectId = String(projectId || ''), normalizedAccessMode = String(accessMode || 'controlled'), logicalConversationId=String(conversationId || '')
    if (!['controlled', 'full'].includes(normalizedAccessMode)) throw new Error('PenEcho Agent project access mode is invalid.')
    const project = normalizedProjectId ? await this.resolveProject(normalizedProjectId) : null
    if (normalizedProjectId && !project) throw new Error('The selected local project was not found on this PenEcho host.')
    const connection = this.resolveConnection(connectionId)
    if (!connection) throw Object.assign(new Error('The selected AI connection was not found. Refresh AI connections.'), { code:'CONNECTION_STALE', status:409 })
    if (connection.provider !== 'codex-cli') throw new Error('Codex Native PenEcho Agent requires a Codex CLI connection.')
    const fingerprint = codexConnectionFingerprint(connection)
    const resolvedWebSearch = this.resolveWebSearch?.() || {}
    const requestedDeepSeekSearchProvider=String(resolvedWebSearch.deepseekProvider||''), deepseekSearchProvider=['deepseek-official','opencode-go'].includes(requestedDeepSeekSearchProvider)?requestedDeepSeekSearchProvider:'deepseek-official', deepseekSearchApiKey=String(resolvedWebSearch.deepseekApiKey||''), tavilySearchApiKey=String(resolvedWebSearch.tavilyApiKey??resolvedWebSearch.apiKey??'')
    const webSearchKeyHash=hash(`${deepseekSearchProvider}\0${deepseekSearchApiKey}\0${tavilySearchApiKey}`)
    const normalizedWidgetCapabilities = normalizeResolvedWidgetCapabilities({})
    const professionalDiagramsContract = normalizedWidgetCapabilities.professionalEnabled
      ? loadCanvasAgentContract(this.rootDirectory, 'professional-diagrams-contract.md', 8_000, 'Professional Diagrams')
      : null
    const resumeHash = resumeToken ? hash(resumeToken) : ''
    let session = canvasSessionId ? this.sessions.get(String(canvasSessionId)) : null
    const resumablePrevious=session&&resumeHash&&session.resumeHash===resumeHash&&this.resumeIndex.get(resumeHash)===session.id?session:null
    if (session && (!logicalConversationId || session.logicalConversationId === logicalConversationId) && session.connectionId === String(connection.id || connectionId) && session.connectionFingerprint === fingerprint
      && session.webSearchKeyHash === webSearchKeyHash && session.webSearch.enabled === Boolean(webSearchEnabled)
      && session.widgetCapabilities.fingerprint === normalizedWidgetCapabilities.fingerprint
      && session.project?.id === project?.id && session.accessMode === 'controlled' && session.resumeHash === resumeHash
      && this.resumeIndex.get(resumeHash) === session.id) {
      clearTimeout(session.expiryTimer)
      session.expiryTimer = null
      session.clientId = clientId || session.clientId
      session.binding = binding
      session.send = send
      session.connected = true
      this.logConversation(session, 'resume')
      this.traceConversation(session, 'resume')
      this.send(session, 'ready', {
        resumeToken,
        connectionId:session.connectionId,
        model:session.model || 'default',
        channel:session.connection.provider || 'codex-cli',
        conversationId:session.logicalConversationId,
        harnessSessionId:session.threadId || '',
        webSearchConfigured:true,
        webSearchEnabled:session.webSearch.enabled,
        widgetCapabilities:publicWidgetCapabilities(session.widgetCapabilities),
        project:publicSessionProject(session.project),
        projectCapabilities:projectSessionCapabilities(session),
        accessMode:session.accessMode,
        resumed:true,
        engine:'codex-native',
        backlog:session.backlog,
      })
      this.send(session, 'agent_status', { status:session.active ? 'running' : 'idle' })
      return session
    }
    session = null

    const sessionId = randomUUID(), projectRuntimeDirectory = await createProjectRuntimeDirectory(this.stateDirectory, sessionId)
    let projectRootLease = null, projectSnapshotPath = ''
    try {
      if (project?.kind === 'folder') projectRootLease = acquireProjectRoot(project.path)
      else if (project?.kind === 'file') projectSnapshotPath = await createSelectedFileSnapshot(project, projectRuntimeDirectory)
    } catch (error) {
      releaseProjectRoot(projectRootLease)
      await removeProjectRuntimeDirectory(this.stateDirectory, { id:sessionId, projectRuntimeDirectory }).catch(() => {})
      throw error
    }
    const nextResumeToken = token()
    session = {
      id:sessionId,
      clientId:clientId || randomUUID(),
      connectionId:String(connection.id || connectionId),
      connectionFingerprint:fingerprint,
      connection,
      resumeHash:hash(nextResumeToken),
      send,
      binding,
      connected:true,
      backlog:Array.isArray(initialBacklog) ? initialBacklog.slice(-MAX_BACKLOG) : [],
      pending:new Map(),
      ignoredToolResultIds:new Set(),
      toolAborts:new Map(),
      toolQueue:Promise.resolve(),
      decisionFeedbackCalls:new Map(),
      decisionFeedbackCallIds:new Set(),
      turnQueue:Promise.resolve(),
      attachmentRefs:new Map(),
      turnFiles:[],
      captureCache:new Map(),
      activeCaptureAttachmentId:null,
      canvasLayoutOverviewRevision:null,
      canvasLayoutReviewRequired:false,
      lastCanvasMutationRevision:null,
      canvasTurnBudget:freshCanvasAgentTurnBudget(),
      canvasAgentTurnLimit:configuredCanvasAgentTurnLimit(this.canvasAgentTurnLimit()),
      visualExplainerBudget:freshVisualExplainerBudget(),
      visualExplorerBudget:freshVisualExplorerBudget(),
      visualSkillsLoaded:new Set(),
      widgetContractsLoaded:new Set(),
      nextWidgetContractOrder:500,
      widgetPatchAttempts:new Map(),
      stateDigest:null,
      emitPublicEvent:null,
      expiryTimer:null,
      logicalConversationId:logicalConversationId||randomUUID(),
      conversationLogId:randomUUID(),
      requestTraceConnection:{ ...requestTraceConnection(connection, configured(connection.cliModel)), executable:'codex' },
      traceAsset:null,
      tracePatchProtocol:null,
      traceDecisionProtocol:null,
      webSearchKeyHash,
      webSearch:{ provider:deepseekSearchApiKey?deepseekSearchProvider:tavilySearchApiKey?'tavily':'built-in', deepseekProvider:deepseekSearchProvider, deepseekApiKey:deepseekSearchApiKey, tavilyApiKey:tavilySearchApiKey, apiKey:tavilySearchApiKey, enabled:Boolean(webSearchEnabled) },
      publicFetch:this.publicFetch,
      publicWebEnabled:true,
      loadPublicApiDiscovery:()=>loadCanvasAgentPublicApi(this),
      resolveWebSearch:() => this.resolveWebSearch?.() || null,
      widgetCapabilities:normalizedWidgetCapabilities,
      generalHtmlContract:loadCanvasAgentContract(this.rootDirectory, 'general-html-contract.md', 8_000, 'General HTML'),
      professionalDiagramsContract,
      visualExplorerContract:loadCanvasAgentVisualExplorerContract(this.rootDirectory),
      visualSkillContracts:loadCanvasAgentVisualSkills(this.rootDirectory),
      project,
      accessMode:'controlled',
      projectRuntimeDirectory,
      projectRootLease,
      projectSnapshotPath,
      model:configured(connection.cliModel),
      effort:configured(connection.effort),
      continuity:boundedText(continuity,80_500),
      documentReaderLoaded:true,
      databaseReaderLoaded:true,
      canvasTitleRequested:false,
      threadId:null,
      process:null,
      startPromise:null,
      interruptPromise:null,
      recoveryPromise:null,
      lifecycle:0,
      native:null,
      nativeActivityDiagnostics:this.conversationTrace ? new NativeActivityDiagnostics() : null,
      active:null,
      disposed:false,
      disposePromise:null,
      turnNumber:Array.isArray(initialBacklog) ? initialBacklog.reduce((latest,event)=>Math.max(latest,Number.isSafeInteger(event?.turn)?event.turn:0),0) : 0,
    }
    session.emitPublicEvent = event => this.emitPublicEvent(session, event)
    session.traceAsset = this.conversationTrace ? asset => this.traceConversationAsset(session, asset) : null
    session.tracePatchProtocol = this.conversationTrace ? record => this.tracePatchProtocol(session, record) : null
    session.traceDecisionProtocol = this.conversationTrace ? record => this.traceDecisionProtocol(session, record) : null
    session.rpc = (name, args, callId, signal, timeoutMs) => this.callBrowserTool(session, name, args, callId, signal, timeoutMs)
    try {
      session.native = await createCanvasAgentNativeRuntime({ session, attachments:this.attachments })
    } catch (error) {
      session.disposed = true
      releaseProjectRoot(projectRootLease)
      await removeProjectRuntimeDirectory(this.stateDirectory, session).catch(() => {})
      throw new Error(safeError(error))
    }
    this.sessions.set(session.id, session)
    this.resumeIndex.set(session.resumeHash, session.id)
    this.logConversation(session, 'start')
    this.traceConversation(session, 'start')
    this.send(session, 'ready', {
      resumeToken:nextResumeToken,
      connectionId:session.connectionId,
      model:session.model || 'default',
      channel:session.connection.provider || 'codex-cli',
      conversationId:session.logicalConversationId,
      harnessSessionId:session.threadId || '',
      webSearchConfigured:true,
      webSearchEnabled:session.webSearch.enabled,
      widgetCapabilities:publicWidgetCapabilities(session.widgetCapabilities),
      project:publicSessionProject(session.project),
      projectCapabilities:projectSessionCapabilities(session),
      accessMode:session.accessMode,
      resumed:false,
      engine:'codex-native',
      backlog:[],
    })
    this.send(session, 'agent_status', { status:'idle' })
    if(resumablePrevious)await this.disposeSession(resumablePrevious).catch(() => {})
    return session
  }

  send(session, type, payload) {
    if (!session?.connected || typeof session.send !== 'function') return
    session.send(type, payload, { id:session.id, clientId:session.clientId })
  }

  persistPreferredCliExecutables() {
    try { writeCodexCliResolutions(this.stateDirectory,this.preferredCliExecutables) }
    catch(error) { this.logger({type:'codex-native-cli-resolution-cache-error',error:safeError(error)}) }
  }

  rememberPreferredCli(connection, executable) {
    const key=codexCliResolutionKey(connection),selected=String(executable||'').trim(),current=this.preferredCliExecutables.get(key)
    if(!selected||current&&canonicalFile(current)===canonicalFile(selected))return
    this.preferredCliExecutables.set(key,selected)
    this.persistPreferredCliExecutables()
  }

  forgetPreferredCli(connection, executable = '') {
    const key=codexCliResolutionKey(connection),current=this.preferredCliExecutables.get(key),failed=String(executable||'').trim()
    if(!current||failed&&canonicalFile(current)!==canonicalFile(failed))return
    this.preferredCliExecutables.delete(key)
    this.persistPreferredCliExecutables()
  }

  nativeTools(session) {
    if (!session?.native || typeof session.native.dynamicTools !== 'function') throw new Error('Codex Native tools are unavailable.')
    return addCodexNativeCaptureContract(session.native.dynamicTools())
  }

  async startCandidate(session, connection, candidate, lifecycle, failures) {
    if (session.disposed || session.lifecycle !== lifecycle) throw new Error('Codex Native PenEcho Agent session was closed during startup.')
    const executable=String(candidate?.executable || '').trim()
    if (!executable) return null
    const source=String(candidate?.source || 'configured').slice(0,32),candidateConnection={...connection,cliPath:executable}
    let starting=true,startupFailure=null
    const process = this.createAppServer({
      connection:candidateConnection,
      env:this.env,
      logger:this.logger,
      runtimeDirectory:join(this.stateDirectory,'codex-native','runtime'),
      diagnosticsEnabled:Boolean(session.nativeActivityDiagnostics),
      diagnostics:session.nativeActivityDiagnostics,
      onNotification:(method, params) => this.handleNotification(session, method, params),
      onRequest:(id, method, params) => this.handleServerRequest(session, id, method, params),
      ...(session.nativeActivityDiagnostics ? { onToolReply:event => {
          const active=session.active
          if (event?.stage !== 'written') return
          const belongsToActiveTurn=active?.activityDiagnosticRequestIds?.delete(event.requestId) === true
          if (!belongsToActiveTurn) return
          active?.activityDiagnostics?.tool('reply-written')
          active?.activityDiagnostics?.phase('tool-reply-written')
          active?.activityDiagnostics?.phase('awaiting-model-events')
        } } : {}),
      onGone:error => {
        if (starting) startupFailure ||= error
        else if (session.process === process) this.invalidateSession(session, error).catch(() => {})
      },
    })
    session.process = process
    try {
      const threadId = await process.start({
        model:connection.cliModel,
        cwd:session.project?.kind === 'folder' ? session.project.path : session.projectRuntimeDirectory,
        baseInstructions:session.native.instructions(),
        dynamicTools:this.nativeTools(session),
      })
      starting=false
      if (startupFailure) throw startupFailure
      if (session.disposed || session.lifecycle !== lifecycle) throw new Error('Codex Native PenEcho Agent session was closed during startup.')
      session.threadId = threadId
      session.reportedUsageTotal = null
      session.cliSource = source
      this.rememberPreferredCli(connection,executable)
      this.logger({type:'codex-native-cli-selected',source,fallbackCount:failures.length})
      session.traceDecisionProtocol?.({kind:'native-cli-selected',source,fallbackCount:failures.length})
      return threadId
    } catch (error) {
      starting=false
      if (session.process === process) session.process=null
      session.threadId=null
      await process.close().catch(() => {})
      if (session.disposed || session.lifecycle !== lifecycle) throw new Error('Codex Native PenEcho Agent session was closed during startup.')
      this.forgetPreferredCli(connection,executable)
      failures.push({source,error})
      this.logger({type:'codex-native-cli-candidate-failed',source,error:safeError(error)})
      session.traceDecisionProtocol?.({kind:'native-cli-candidate-failed',source,error:safeError(error)})
      return null
    }
  }

  async compatibleCandidate(session, connection, candidate, failures) {
    const executable=String(candidate?.executable||'').trim(),source=String(candidate?.source||'configured').slice(0,32)
    if(!executable)return null
    try{
      const version=String(candidate.detectedVersion||await this.inspectCliCandidate(candidate)).slice(0,200)
      return{...candidate,detectedVersion:version}
    }catch(error){
      this.forgetPreferredCli(connection,executable)
      failures.push({source,error})
      this.logger({type:'codex-native-cli-candidate-rejected',source,error:safeError(error)})
      session.traceDecisionProtocol?.({kind:'native-cli-candidate-rejected',source,error:safeError(error)})
      return null
    }
  }

  ensureManagedCliInstalled(codexVersion = CODEX_CLI_PINNED_VERSION) {
    const requestedVersion=String(codexVersion||CODEX_CLI_PINNED_VERSION)
    if (!this.managedCliInstalls.has(requestedVersion)) {
      const promise=Promise.resolve().then(()=>this.installManagedCli(requestedVersion)).then(result=>{
        const executable=String(result?.executable||'').trim()
        if(!executable)throw new Error('PenEcho managed Codex CLI installation did not return an executable.')
        assertCodexCliVersion(result?.version,requestedVersion)
        return{...result,executable}
      },error=>{
        throw error instanceof Error?error:new Error(safeError(error))
      })
      promise.catch(()=>{})
      this.managedCliInstalls.set(requestedVersion,promise)
    }
    return this.managedCliInstalls.get(requestedVersion)
  }

  async ensureStarted(session) {
    if (!this.sessions.has(session?.id) || session.disposed) throw new Error('Codex Native PenEcho Agent session is closed.')
    if (session.recoveryPromise) await session.recoveryPromise
    if (!this.sessions.has(session?.id) || session.disposed) throw new Error('Codex Native PenEcho Agent session is closed.')
    const connection = this.resolveConnection(session.connectionId)
    if (!connection) throw new Error('The Codex Native PenEcho Agent connection is unavailable.')
    if (codexConnectionFingerprint(connection) !== session.connectionFingerprint) {
      throw new Error('The Codex Native PenEcho Agent connection changed. Start a new conversation before submitting this turn.')
    }
    if (connection.provider !== 'codex-cli') throw new Error('The Codex Native PenEcho Agent connection is unavailable.')
    if (session.process?.alive && session.threadId) return session.threadId
    if (session.startPromise) return session.startPromise
    const lifecycle = session.lifecycle
    const startPromise = (async () => {
      const candidates=await Promise.resolve(this.resolveCliCandidates(connection))
      if (!Array.isArray(candidates)) throw new Error('Codex CLI discovery returned an invalid result.')
      const resolutionKey=codexCliResolutionKey(connection),preferredExecutable=this.preferredCliExecutables.get(resolutionKey),preferred=preferredExecutable
        ? candidates.find(candidate=>canonicalFile(candidate?.executable||'')===canonicalFile(preferredExecutable))||null
        : null
      const privateExecutable=managedCliPaths('codex-cli',{env:this.env,platform:this.platform,stateDir:this.stateDirectory})[0],hadPrivateManagedCli=candidates.some(candidate=>candidate?.privateManaged)
        || Boolean(preferredExecutable&&canonicalFile(preferredExecutable)===canonicalFile(privateExecutable))
      if(preferredExecutable&&!preferred)this.forgetPreferredCli(connection)
      const failures=[]
      if (preferred) {
        const compatible=await this.compatibleCandidate(session,connection,preferred,failures)
        if(compatible){
          const threadId=await this.startCandidate(session,connection,compatible,lifecycle,failures)
          if(threadId)return threadId
        }
      }
      this.send(session,'agent_status',{status:'preparing',phase:hadPrivateManagedCli?'repairing':'installing'})
      this.recordNativeActivity(session.active, 'startup/install')
      let installed=null
      try {
        installed=await this.ensureManagedCliInstalled(CODEX_CLI_PINNED_VERSION)
        this.logger({type:'codex-native-managed-cli-installed',release:CODEX_CLI_PINNED_VERSION,version:String(installed.version||'').slice(0,64)})
        session.traceDecisionProtocol?.({kind:'native-managed-cli-installed',release:CODEX_CLI_PINNED_VERSION,version:String(installed.version||'').slice(0,64)})
      } catch(error) {
        failures.push({source:'penecho-install-pinned',error})
        this.logger({type:'codex-native-managed-cli-install-failed',release:CODEX_CLI_PINNED_VERSION,error:safeError(error)})
        session.traceDecisionProtocol?.({kind:'native-managed-cli-install-failed',release:CODEX_CLI_PINNED_VERSION,error:safeError(error)})
      }
      if(installed){
        const threadId=await this.startCandidate(session,connection,{executable:installed.executable,source:'penecho-installed',privateManaged:true},lifecycle,failures)
        if(threadId)return threadId
      }
      this.send(session,'agent_status',{status:'preparing',phase:'discovering'})
      session.active?.timeout?.activity()
      for(const candidate of systemCodexFallbacks(candidates,preferred)){
        const compatible=await this.compatibleCandidate(session,connection,candidate,failures)
        if(!compatible)continue
        const threadId=await this.startCandidate(session,connection,compatible,lifecycle,failures)
        if(threadId)return threadId
      }
      this.send(session,'agent_status',{status:'preparing',phase:'installing'})
      session.active?.timeout?.activity()
      let latest=null
      try{
        latest=await this.ensureManagedCliInstalled('latest')
        this.logger({type:'codex-native-managed-cli-installed',release:'latest',version:String(latest.version||'').slice(0,64)})
        session.traceDecisionProtocol?.({kind:'native-managed-cli-installed',release:'latest',version:String(latest.version||'').slice(0,64)})
      }catch(error){
        failures.push({source:'penecho-install-latest',error})
        this.logger({type:'codex-native-managed-cli-install-failed',release:'latest',error:safeError(error)})
        session.traceDecisionProtocol?.({kind:'native-managed-cli-install-failed',release:'latest',error:safeError(error)})
      }
      if(latest){
        const threadId=await this.startCandidate(session,connection,{executable:latest.executable,source:'penecho-latest',privateManaged:true},lifecycle,failures)
        if(threadId)return threadId
      }
      throw codexCandidateFailure(failures)
    })()
    session.startPromise = startPromise
    try {
      return await startPromise
    } finally {
      if (session.startPromise === startPromise) session.startPromise = null
    }
  }

  emitPublicEvent(session, event) {
    if (session.disposed) return
    this.recordNativeActivity(session.active, `public/${String(event?.kind || '')}`)
    session.backlog.push(event)
    if (session.backlog.length > MAX_BACKLOG) session.backlog.splice(0, session.backlog.length - MAX_BACKLOG)
    if (event?.kind === 'assistant_delta' || event?.kind === 'user_message') {
      this.send(session, 'session_event', event)
      return
    }
    this.logConversation(session, 'event', event)
    this.traceConversation(session, 'event', event)
    this.send(session, 'session_event', event)
  }

  recordNativeActivity(active, source) {
    if (!active?.timeout) return
    active.timeout.activity()
    active.activityDiagnostics?.activity(source)
  }

  recordNativeNotification(session, method, params) {
    const active=session.active,diagnostics=active?.activityDiagnostics
    if (!diagnostics) return
    let category=CODEX_NATIVE_KNOWN_NOTIFICATIONS.has(method) ? 'recognized' : 'ignored'
    const threadId=params?.threadId
    if (threadId !== undefined && String(threadId) !== String(session.threadId)) category='mismatched'
    else if (active.turnId) {
      const expectedTurnId=method==='turn/started'||method==='turn/completed'
        ? String(params?.turn?.id || '')
        : String(params?.turnId || '')
      const requiresTurn=method==='turn/started'||method==='turn/completed'||method==='thread/tokenUsage/updated'
        ||method==='thread/compacted'||method==='rawResponseItem/completed'||method==='rawResponse/completed'
        ||method.startsWith('item/')||CODEX_NATIVE_TURN_ACTIVITY_NOTIFICATIONS.has(method)
      if (requiresTurn && (!expectedTurnId || expectedTurnId !== active.turnId)) category='mismatched'
    }
    diagnostics.notification(category,method)
  }

  traceNativeActivitySummary(session, active, reason) {
    const diagnostics=active?.activityDiagnostics
    if (!diagnostics || active.activitySummaryTraced) return
    try {
      const pendingAdmissions=[...active.pendingToolAdmissions.values()].reduce((count,entries)=>count+(Array.isArray(entries)?entries.length:0),0)
      const metadata=diagnostics.summary(reason,{
        processAlive:Boolean(session.process?.alive),
        pendingAppServerRequests:session.process?.pending?.size,
        rawBufferBytes:Buffer.byteLength(String(session.process?.buffer || ''),'utf8'),
        pendingRequests:session.pending.size,
        pendingAdmissions,
        executingTools:session.toolAborts.size,
      })
      active.activitySummaryTraced=true
      if (session.traceDecisionProtocol) session.traceDecisionProtocol({kind:'native-activity-summary',reason:String(reason||'unknown').slice(0,64),metadata})
      else this.logger({type:'codex-native-activity-summary',reason:String(reason||'unknown').slice(0,64),metadata})
    } catch (error) {
      try { this.logger({type:'codex-native-activity-summary-error',error:safeError(error)}) } catch {}
    }
  }

  activeProjectIds() {
    return [...new Set([...this.sessions.values()].flatMap(session=>[
      String(session.project?.id || ''),
      ...(Array.isArray(session.turnFiles) ? session.turnFiles.map(file=>String(file?.id || '')) : []),
    ]).filter(Boolean))]
  }

  updateState(session, digest) {
    if (!digest || typeof digest !== 'object' || Array.isArray(digest)) throw new Error('Canvas state digest is invalid.')
    session.stateDigest = digest
  }

  async setConnection(session, { connectionId, binding = session?.binding, send = session?.send } = {}) {
    if (!this.sessions.has(session?.id) || session.disposed) throw new Error('Codex Native PenEcho Agent session is closed.')
    if (session.recoveryPromise) await session.recoveryPromise
    if (!this.sessions.has(session?.id) || session.disposed) throw new Error('Codex Native PenEcho Agent session is closed.')
    if (session.active || session.interruptPromise) throw new Error('Wait for the current PenEcho Agent turn to finish before changing models.')
    const connection = this.resolveConnection(String(connectionId || ''))
    if (!connection) throw Object.assign(new Error('The selected AI connection was not found. Refresh AI connections.'), { code:'CONNECTION_STALE', status:409 })
    if (connection.provider !== 'codex-cli') throw new Error('The selected AI connection cannot use Codex Native PenEcho Agent.')
    session.connectionId=String(connection.id || connectionId)
    session.connectionFingerprint=codexConnectionFingerprint(connection)
    session.connection=connection
    session.model=configured(connection.cliModel)
    session.effort=configured(connection.effort)
    session.requestTraceConnection={ ...requestTraceConnection(connection,session.model), executable:'codex' }
    session.binding=binding
    session.send=send
    this.logConversation(session,'connection-change')
    this.traceConversation(session,'connection-change')
    this.send(session,'ready',{
      connectionId:session.connectionId,
      model:session.model || 'default',
      channel:session.connection.provider || 'codex-cli',
      conversationId:session.logicalConversationId,
      harnessSessionId:session.threadId || '',
      webSearchConfigured:true,
      webSearchEnabled:session.webSearch.enabled,
      widgetCapabilities:publicWidgetCapabilities(session.widgetCapabilities),
      project:publicSessionProject(session.project),
      projectCapabilities:projectSessionCapabilities(session),
      accessMode:session.accessMode,
      resumed:false,
      connectionChanged:true,
      backlog:[],
    })
    this.send(session,'agent_status',{status:'idle'})
    return session
  }

  setWebSearchEnabled(session, enabled) {
    if (Boolean(enabled) !== session.webSearch.enabled) throw new Error('Internet Search changed. Start a new PenEcho Agent conversation before submitting this turn.')
    return session.webSearch.enabled
  }

  async admitUserImages(session, images) {
    if (!Array.isArray(images) || images.length > 5) throw new Error('PenEcho Agent accepts at most five images per message.')
    const imageAttachments = images.length ? await admitEncodedImages(this.attachments, images) : []
    if (this.conversationTrace) images.forEach((image,index)=>{
      const diagnostic=canvasAgentHandwritingAdmissionDiagnostic(image,imageAttachments[index])
      if (diagnostic) this.traceImageDebug(session,diagnostic)
    })
    const nextAttachmentRefs = new Map(session.attachmentRefs)
    for (const attachment of imageAttachments) nextAttachmentRefs.set(String(attachment.attachmentId), attachment)
    const attachmentBytes = [...nextAttachmentRefs.values()].reduce((total, attachment) => total + Number(attachment.bytes || 0), 0)
    if (nextAttachmentRefs.size > 100 || attachmentBytes > 100 * 1024 * 1024) throw new Error('PenEcho Agent attachment capacity is exhausted. Start a new conversation before attaching more images.')
    for (const attachment of imageAttachments) session.attachmentRefs.set(String(attachment.attachmentId), attachment)
    return imageAttachments
  }

  hostReferencesFor(session, imageAttachments, references, initialCanvasState) {
    const turnDigest=initialCanvasState?.reference?.digest||session.stateDigest
    const authoritativeObjects = new Map((Array.isArray(turnDigest?.objects) ? turnDigest.objects : []).map(object => [String(object?.id || ''), object]))
    const selectedIds = Array.isArray(references?.objectIds) ? references.objectIds.map(String).slice(0, 20) : []
    const region = references?.region && typeof references.region === 'object' ? {
      x:Number(references.region.x), y:Number(references.region.y), width:Number(references.region.width), height:Number(references.region.height),
    } : null
    const canvasWidth = Number(turnDigest?.canvas?.width), canvasHeight = Number(turnDigest?.canvas?.height)
    const validRegion = region && Object.values(region).every(Number.isFinite) && region.x >= 0 && region.y >= 0 && region.width > 0 && region.height > 0
      && region.x + region.width <= canvasWidth && region.y + region.height <= canvasHeight ? region : null
    return {
      revision:Number.isSafeInteger(turnDigest?.revision) ? turnDigest.revision : null,
      viewRevision:Number.isSafeInteger(turnDigest?.viewRevision) ? turnDigest.viewRevision : null,
      objects:selectedIds.map(id => authoritativeObjects.get(id)).filter(Boolean),
      ...(validRegion ? { region:validRegion } : {}),
      ...(initialCanvasState ? { initialCanvasState:initialCanvasState.reference } : {}),
      attachments:imageAttachments.map(attachment => ({
        attachmentId:String(attachment.attachmentId), mediaType:attachment.mediaType,
        width:attachment.width, height:attachment.height, name:attachment.name || '',
      })),
    }
  }

  async modelInput(session, prompt, hostReferences, attachments, signal = new AbortController().signal) {
    const input = [
      { type:'text', text:prompt },
      ...(session.continuity ? [{ type:'text', text:`\n${session.continuity}` }] : []),
      { type:'text', text:`\n<penecho_host_references>${JSON.stringify(hostReferences)}</penecho_host_references>` },
    ]
    for (const attachment of attachments) {
      const stored = await this.attachments.readImageRequest(attachment, CODEX_MODEL_IMAGE_REQUEST_POLICY, signal)
      const mediaType = stored.ref?.mediaType || stored.mediaType
      input.push({ type:'image', url:`data:${mediaType};base64,${Buffer.from(stored.data).toString('base64')}` })
    }
    return input
  }

  additionalContextFor(session) {
    return Object.fromEntries(session.native.turnAdditionalContext().map(context => [
      context.key || context.name.replace(/[^a-zA-Z0-9_-]/g, '_'),
      { kind:context.kind, value:context.value },
    ]))
  }

  async submit(session, text, steer = false, images = [], references = {}, initialState = null, fileIds = [], canvasTitleNeeded = false, reasoningEffort = 'config') {
    if (!this.sessions.has(session?.id) || session.disposed) throw new Error('Codex Native PenEcho Agent session is closed.')
    if (session.interruptPromise) await session.interruptPromise
    if (session.recoveryPromise) await session.recoveryPromise
    if (!this.sessions.has(session?.id) || session.disposed) throw new Error('Codex Native PenEcho Agent session is closed.')
    const prompt = boundedText(text, 40_000).trim()
    if (!prompt) throw new Error('Enter a message for PenEcho Agent.')
    const requestEffort=resolveCanvasAgentRequestEffort(session.connection,reasoningEffort)
    const normalizedFileIds=normalizeCanvasAgentTurnFileIds(fileIds,Array.isArray(images)?images.length:0)
    if (steer) return this.runSteer(session, prompt, images, references, initialState, normalizedFileIds, canvasTitleNeeded)
    const operation = session.turnQueue.then(() => this.runSubmit(session, text, steer, images, references, initialState, normalizedFileIds, canvasTitleNeeded, requestEffort))
    session.turnQueue = operation.catch(() => {})
    return operation
  }

  async runSteer(session, prompt, images = [], references = {}, initialState = null, fileIds = [], canvasTitleNeeded = false) {
    const active = session.active
    if (!active || !active.turnId) throw new Error('No active Codex Native PenEcho Agent turn is available to steer.')
    if (!session.process?.alive || !session.threadId) throw new Error('Codex Native PenEcho Agent thread is unavailable.')
    const initialCanvasState = await admitInitialCanvasState(session, this.attachments, initialState)
    const imageAttachments = await this.admitUserImages(session, images)
    const preparedTurnFiles=await prepareCanvasAgentTurnFiles(session,this.resolveProject,fileIds,images.length), previousTurnFiles=Array.isArray(session.turnFiles)?session.turnFiles:[],
      addedTurnFiles=preparedTurnFiles.filter(file=>!previousTurnFiles.some(previous=>previous.id===file.id)), duplicateTurnFiles=preparedTurnFiles.filter(file=>previousTurnFiles.some(previous=>previous.id===file.id)),
      nextTurnFiles=[...previousTurnFiles,...addedTurnFiles]
    await discardCanvasAgentTurnFiles(duplicateTurnFiles)
    if(nextTurnFiles.length+images.length>CANVAS_AGENT_MAX_TURN_ATTACHMENTS){await discardCanvasAgentTurnFiles(addedTurnFiles);throw new Error('PenEcho Agent accepts at most five files and images per active turn.')}
    session.turnFiles=nextTurnFiles
    if (session.active !== active || active.inputController.signal.aborted) {
      session.turnFiles=previousTurnFiles
      await discardCanvasAgentTurnFiles(addedTurnFiles)
      throw new Error('No active Codex Native PenEcho Agent turn is available to steer.')
    }
    const hostReferences = this.hostReferencesFor(session, imageAttachments, references, initialCanvasState)
    const previousCanvasTurnBudget = session.canvasTurnBudget, previousVisualExplainerBudget = session.visualExplainerBudget, previousVisualExplorerBudget = session.visualExplorerBudget,
      previousWidgetPatchAttempts = session.widgetPatchAttempts, previousTurnReferences = session.turnReferences,previousCanvasTitleRequested=session.canvasTitleRequested,
      previousActiveTitleRequested=active.titleRequested
    session.turnReferences = hostReferences
    session.canvasTurnBudget = freshCanvasAgentTurnBudget()
    session.visualExplainerBudget = freshVisualExplainerBudget()
    session.visualExplorerBudget = freshVisualExplorerBudget()
    if (initialCanvasState?.empty) session.visualExplorerBudget.authoritativeEmptyRevision = Number(initialCanvasState.reference?.digest?.revision)
    session.widgetPatchAttempts = new Map()
    active.titleRequested ||= canvasTitleNeeded===true
    session.canvasTitleRequested=active.titleRequested
    try {
      const input = await this.modelInput(session, prompt, hostReferences, [
        ...(initialCanvasState?.attachment ? [initialCanvasState.attachment] : []), ...imageAttachments,
      ], active.inputController.signal)
      if (session.active !== active || active.inputController.signal.aborted) throw new Error('No active Codex Native PenEcho Agent turn is available to steer.')
      this.emitPublicEvent(session, { kind:'user_message', turn:session.turnNumber, text:redactPublicProjectValue(prompt, session) })
      await session.process.request('turn/steer', {
        threadId:session.threadId,
        expectedTurnId:active.turnId,
        input,
        additionalContext:this.additionalContextFor(session),
      })
      return { output:'', usage:active.usage, steered:true }
    } catch (error) {
      session.turnFiles=previousTurnFiles
      await discardCanvasAgentTurnFiles(addedTurnFiles)
      session.turnReferences = previousTurnReferences
      session.canvasTurnBudget = previousCanvasTurnBudget
      session.visualExplainerBudget = previousVisualExplainerBudget
      session.visualExplorerBudget = previousVisualExplorerBudget
      session.widgetPatchAttempts = previousWidgetPatchAttempts
      session.canvasTitleRequested=previousCanvasTitleRequested
      active.titleRequested=previousActiveTitleRequested
      throw error
    }
  }

  async runSubmit(session, text, steer = false, images = [], references = {}, initialState = null, fileIds = [], canvasTitleNeeded = false, requestEffort = resolveCanvasAgentRequestEffort(session?.connection)) {
    if (!this.sessions.has(session?.id) || session.disposed) throw new Error('Codex Native PenEcho Agent session is closed.')
    const prompt = boundedText(text, 40_000).trim()
    if (!prompt) throw new Error('Enter a message for PenEcho Agent.')
    if (session.active) throw new Error('A Codex Native PenEcho Agent turn is already active.')
    const inputController = new AbortController()
    let active
    const turnPromise = new Promise((resolve, reject) => {
      active = {
        usageRequestId:randomUUID(),usageStartedAt:Date.now(),usageBaseline:session.reportedUsageTotal || {},
        turnId:null, text:'', usage:null, settled:false, callIds:new Set(), compactionEmitted:false, inputController, resolve, reject,
        rawDecisionCalls:[], rawDecisionBatches:new Map(), sealedDecisionBatches:[], rawBoundaryCount:0, pendingToolAdmissions:new Map(), responseTextStart:0,
        completedResponseMessages:[],titleRequested:canvasTitleNeeded===true,canvasTitleCandidate:'',effort:requestEffort.effective,
        activityDiagnostics:session.nativeActivityDiagnostics?.beginTurn({turnNumber:session.turnNumber+1}) || null,
        activityDiagnosticRequestIds:session.nativeActivityDiagnostics ? new Set() : null,
        activitySummaryTraced:false,
        emitEnd:(reason, error = null) => {
          if (active.settled) return
          active.activityDiagnostics?.phase('turn-ending')
          this.traceNativeActivitySummary(session,active,reason)
          active.settled = true
          if(this.onModelUsage) {
            const total=active.usage?.total,usage=total ? Object.fromEntries(['inputTokens','cachedInputTokens','cacheWriteInputTokens','outputTokens'].map(key=>{
              const value=total[key],previous=active.usageBaseline[key] ?? 0;
              return [key,Number.isSafeInteger(value)&&value>=previous?value-previous:null];
            })) : null;
            try { Promise.resolve(this.onModelUsage({requestId:active.usageRequestId,connectionId:session.connectionId,connectionName:session.connection?.name || 'Codex CLI',model:session.model || 'default',createdAt:active.usageStartedAt,completedAt:Date.now(),status:reason==='completed'?'succeeded':reason==='cancelled'||reason==='interrupted'?'cancelled':'failed',usage,usageFormat:'openai'})).catch(()=>{}); } catch {}
          }
          active.timeout?.clear()
          this.rejectNativeToolAdmission(active, error || new Error('Codex Native PenEcho Agent turn ended during tool admission.'))
          active.activityDiagnosticRequestIds?.clear()
          if (session.active === active) session.active = null
          active.activityDiagnostics?.close()
          const event = error
            ? { kind:'turn_end', turn:session.turnNumber, reason:{ kind:reason, error:{ code:'CODEX_NATIVE_FAILED', message:safeError(error) } } }
            : { kind:'turn_end', turn:session.turnNumber, reason:{ kind:reason },...(reason==='completed'&&active.titleRequested&&active.canvasTitleCandidate?{canvasTitle:active.canvasTitleCandidate}:{}) }
          session.canvasTitleRequested=false
          session.backlog.push(event)
          if (session.backlog.length > MAX_BACKLOG) session.backlog.splice(0, session.backlog.length - MAX_BACKLOG)
          this.logConversation(session, 'event', event)
          this.traceConversation(session, 'event', event)
          this.send(session, 'session_event', event)
          if (error) reject(error)
          else resolve({ output:redactPublicProjectValue(active.text.trim(), session), usage:active.usage })
        },
        fail:(error, reason = 'error') => {
          active.inputController.abort(error)
          active.emitEnd(reason, new Error(safeError(error)))
        },
        succeed:() => active.emitEnd('completed'),
      }
    })
    turnPromise.catch(() => {})
    session.active = active
    session.requestTraceConnection={
      ...requestTraceConnection(requestEffort.selected==='config'?session.connection:{...session.connection,effort:requestEffort.effective},session.model),
      executable:'codex',
    }
    session.canvasTitleRequested=active.titleRequested
    session.turnNumber += 1
    this.emitPublicEvent(session, { kind:'user_message', turn:session.turnNumber, text:redactPublicProjectValue(prompt, session) })
    this.emitPublicEvent(session, { kind:'turn_start', turn:session.turnNumber })
    this.send(session, 'agent_status', { status:'running' })

    let previousCanvasTurnBudget, previousVisualExplainerBudget, previousVisualExplorerBudget, previousWidgetPatchAttempts, budgetsChanged = false, pendingTurnFiles=[], initialCanvasState=null
    const assertActive = () => {
      if (session.disposed || session.active !== active || inputController.signal.aborted) {
        throw inputController.signal.reason instanceof Error
          ? inputController.signal.reason
          : new Error('Codex Native PenEcho Agent turn is no longer active.')
      }
    }
    try {
      // Freeze the send-time Canvas before provider startup can allow later state_sync frames to replace the live digest.
      initialCanvasState = await admitInitialCanvasState(session, this.attachments, initialState)
      assertActive()
      await this.ensureStarted(session)
      active.usageBaseline = session.reportedUsageTotal || {}
      assertActive()
      if (!session.process?.alive || !session.threadId) throw codexNativeResetRequired('Codex Native PenEcho Agent thread is unavailable.')
      const timeoutController = new AbortController()
      active.timeout = createCanvasAgentModelTimeout(
        timeoutController,
        Math.max(1_000, Number(this.modelTimeoutMs?.(session.connectionId)) || DEFAULT_CANVAS_AGENT_IDLE_TIMEOUT_MS),
        {
          reasonFor:(_kind, limitMs) => {
            this.traceNativeActivitySummary(session,active,'timeout')
            return Object.assign(new Error(`Codex CLI PenEcho Agent turn timed out after ${canvasAgentTimeoutSeconds(limitMs)} seconds without activity. The conversation is preserved; send another message to continue.`), { name:'TimeoutError' })
          },
        },
      )
      timeoutController.signal.addEventListener('abort', () => {
        const error = timeoutController.signal.reason instanceof Error
          ? timeoutController.signal.reason
          : new Error('Codex CLI PenEcho Agent turn timed out.')
        this.interruptFailedTurn(session, error).catch(() => {})
      }, { once:true })
      const imageAttachments = await this.admitUserImages(session, images)
      assertActive()
      pendingTurnFiles=await prepareCanvasAgentTurnFiles(session,this.resolveProject,fileIds,images.length)
      assertActive()
      await clearCanvasAgentTurnFiles(session)
      session.turnFiles=pendingTurnFiles
      pendingTurnFiles=[]
      const hostReferences = this.hostReferencesFor(session, imageAttachments, references, initialCanvasState)
      session.turnReferences = hostReferences
      previousCanvasTurnBudget = session.canvasTurnBudget
      previousVisualExplainerBudget = session.visualExplainerBudget
      previousVisualExplorerBudget = session.visualExplorerBudget
      previousWidgetPatchAttempts = session.widgetPatchAttempts
      budgetsChanged = true
      session.canvasTurnBudget = freshCanvasAgentTurnBudget()
      session.visualExplainerBudget = freshVisualExplainerBudget()
      session.visualExplorerBudget = freshVisualExplorerBudget()
      if (initialCanvasState?.empty) session.visualExplorerBudget.authoritativeEmptyRevision = Number(initialCanvasState.reference?.digest?.revision)
      session.widgetPatchAttempts = new Map()
      const input = await this.modelInput(session, prompt, hostReferences, [
        ...(initialCanvasState?.attachment ? [initialCanvasState.attachment] : []), ...imageAttachments,
      ], inputController.signal)
      assertActive()
      active.activityDiagnostics?.phase('awaiting-model-events')
      const result = await session.process.request('turn/start', {
        threadId:session.threadId,
        input,
        ...(session.model ? { model:session.model } : {}),
        ...(active.effort ? { effort:active.effort } : {}),
        additionalContext:this.additionalContextFor(session),
      })
      assertActive()
      const responseTurnId = String(result?.turn?.id || '')
      if (active.turnId && responseTurnId && responseTurnId !== active.turnId) throw codexNativeResetRequired('Codex app-server returned a mismatched turn id.')
      active.turnId ||= responseTurnId
      if (!active.turnId) throw codexNativeResetRequired('Codex app-server did not return a turn id.')
      session.continuity=''
    } catch (error) {
      inputController.abort(error)
      await discardCanvasAgentTurnFiles(pendingTurnFiles)
      await clearCanvasAgentTurnFiles(session)
      if (active.settled) return turnPromise
      if (budgetsChanged) {
        session.canvasTurnBudget = previousCanvasTurnBudget
        session.visualExplainerBudget = previousVisualExplainerBudget
        session.visualExplorerBudget = previousVisualExplorerBudget
        session.widgetPatchAttempts = previousWidgetPatchAttempts
      }
      await this.failTurn(session,error,{close:error?.codexNativeResetRequired===true||Boolean(session.process&&!session.process.alive)})
      return turnPromise
    }

    try {
      return await turnPromise
    } finally {
      session.turnReferences = null
      await clearCanvasAgentTurnFiles(session)
      if (!session.disposed) this.send(session, 'agent_status', { status:'idle' })
    }
  }

  async abortToolWork(session, error, active = session.active) {
    this.rejectNativeToolAdmission(active, error)
    for (const [requestId, pending] of session.pending) {
      session.pending.delete(requestId)
      session.ignoredToolResultIds.add(requestId)
      if (session.ignoredToolResultIds.size > 256) session.ignoredToolResultIds.delete(session.ignoredToolResultIds.values().next().value)
      pending.reject(error)
    }
    for (const [callId, controller] of session.toolAborts) {
      session.toolAborts.delete(callId)
      controller.abort(error)
    }
    const toolWork = session.toolQueue.catch(() => {})
    await toolWork
  }

  async cancel(session) {
    const active = session?.active
    if (!active) return
    const error = new Error('Codex Native PenEcho Agent turn cancelled.')
    if (!active.turnId) {
      await this.invalidateSession(session, error)
      return
    }
    if (!session.process?.alive) {
      await this.invalidateSession(session, error)
      return
    }
    active.inputController.abort(error)
    active.emitEnd('cancelled')
    const interruptPromise=session.process.interrupt(session.threadId, active.turnId)
    session.interruptPromise=interruptPromise
    try {
      await Promise.all([interruptPromise,this.abortToolWork(session, error, active)])
      this.send(session, 'agent_status', { status:'idle' })
    } catch (interruptError) {
      await this.invalidateSession(session, new Error(`Codex app-server interrupt failed: ${safeError(interruptError)}`))
    } finally {
      if(session.interruptPromise===interruptPromise)session.interruptPromise=null
    }
  }

  async failTurn(session, error, { close = false } = {}) {
    const active = session.active
    const failure = new Error(safeError(error))
    if (close) {
      await this.invalidateSession(session, failure)
    } else if (active) {
      active.fail(failure)
      await this.abortToolWork(session, failure, active)
    }
    this.send(session, 'agent_status', { status:'idle' })
  }

  async interruptFailedTurn(session, error) {
    const active = session?.active
    if (!active) return
    const failure = new Error(safeError(error))
    failure.name = error?.name || failure.name
    if (!active.turnId || !session.process?.alive) {
      await this.invalidateSession(session, failure)
      return
    }
    const interruptPromise = session.process.interrupt(session.threadId, active.turnId)
    session.interruptPromise = interruptPromise
    const toolAbortPromise = this.abortToolWork(session, failure, active)
    active.fail(failure)
    try {
      await Promise.all([interruptPromise, toolAbortPromise])
      this.send(session, 'agent_status', { status:'idle' })
    } catch (interruptError) {
      await this.invalidateSession(session, new Error(`Codex app-server interrupt failed after a recoverable turn error: ${safeError(interruptError)}`))
    } finally {
      if (session.interruptPromise === interruptPromise) session.interruptPromise = null
    }
  }

  concludeNativeTurnAfterTool(session, active, value) {
    setImmediate(() => {
      if (session.disposed || session.active !== active || active.settled || !active.turnId) return
      const message=boundedText(String(value?.message||'PenEcho Agent stopped the current turn.'),2_000), turnId=active.turnId
      this.emitPublicEvent(session,{kind:'assistant_message',turn:session.turnNumber,text:redactPublicProjectValue(message,session)})
      const interruptPromise=session.process?.alive
        ? session.process.interrupt(session.threadId,turnId)
        : Promise.resolve()
      session.interruptPromise=interruptPromise
      active.inputController.abort(new Error(message))
      active.emitEnd('blocked')
      interruptPromise.catch(error=>this.invalidateSession(session,new Error(`Codex app-server interrupt failed after a terminal Canvas tool result: ${safeError(error)}`)))
        .finally(()=>{if(session.interruptPromise===interruptPromise)session.interruptPromise=null})
    })
  }

  async invalidateSession(session, error) {
    if (!this.sessions.has(session?.id) || session.disposed) return
    if (session.recoveryPromise) return session.recoveryPromise
    const failure=error instanceof Error?error:new Error(safeError(error)),active=session.active,
      process=session.process,threadId=session.threadId,turnId=active?.turnId
    session.lifecycle+=1
    session.process=null
    session.threadId=null
    const recoveryPromise=(async()=>{
      if (active) active.fail(failure)
      await this.abortToolWork(session,failure,active)
      if(turnId&&process?.alive)await process.interrupt(threadId,turnId).catch(()=>{})
      try{await process?.close()}catch(closeError){this.logger({type:'codex-native-close-error',error:safeError(closeError)})}
      if (!session.disposed) {
        session.continuity=canvasAgentConversationContinuity(session.backlog)
        this.logger({type:'codex-native-session-recoverable',error:safeError(failure)})
        this.send(session,'agent_status',{status:'idle'})
      }
    })()
    session.recoveryPromise=recoveryPromise
    try{return await recoveryPromise}
    finally{if(session.recoveryPromise===recoveryPromise)session.recoveryPromise=null}
  }

  appendNativeAssistantMessage(active, text) {
    const value=String(text||'')
    if(!value)return
    const start=Math.min(active.responseTextStart,active.text.length),prefix=active.text.slice(0,start),responseText=active.text.slice(start)
    if(!responseText)active.text+=value
    else if(value.startsWith(responseText))active.text=`${prefix}${value}`
    else if(!responseText.endsWith(value))active.text+=value
    active.completedResponseMessages.push(value)
  }

  projectNativeProgress(session, active) {
    // Publish only one complete, explicitly public leading status line for
    // the current response. Title envelopes are parsed for inspection only;
    // the original text remains available to the completion path.
    if(active.publicResponsePrefix)return
    const response=active.text.slice(active.responseTextStart,active.responseTextStart+MAX_NATIVE_PROGRESS_SCAN_CHARS),visible=parseCanvasTitleEnvelope(response,false).text,
      match=/^(?:Progress:|进展：)[^\r\n]{1,160}\r?\n/.exec(visible)
    if(!match)return
    active.publicResponsePrefix=match[0]
    this.emitPublicEvent(session,{kind:'assistant_delta',turn:session.turnNumber,text:redactPublicProjectValue(match[0],session)})
  }

  sealNativeAssistantResponse(session, active) {
    const start=Math.min(active.responseTextStart,active.text.length),prefix=active.text.slice(0,start),responseText=active.text.slice(start),messages=active.completedResponseMessages.splice(0),
      project=value=>{
        const parsed=parseCanvasTitleEnvelope(value,true)
        if(active.titleRequested&&parsed.matched&&parsed.title&&!active.canvasTitleCandidate)active.canvasTitleCandidate=parsed.title
        return parsed.text
      },visibleResponse=project(responseText),visibleMessages=messages.map(project).filter(Boolean)
    active.text=`${prefix}${visibleResponse}`
    active.responseTextStart=active.text.length
    const alreadyProjected=active.publicResponsePrefix||''
    const projectedWithoutLineBreak=alreadyProjected.replace(/\r?\n$/,''),remaining=alreadyProjected
      ? visibleResponse.startsWith(alreadyProjected)
        ? visibleResponse.slice(alreadyProjected.length)
        : visibleResponse===projectedWithoutLineBreak ? '' : visibleResponse
      : visibleResponse
    active.publicResponsePrefix=''
    if(remaining)this.emitPublicEvent(session,{kind:'assistant_delta',turn:session.turnNumber,text:redactPublicProjectValue(remaining,session)})
    for(const message of visibleMessages)this.emitPublicEvent(session,{kind:'assistant_message',turn:session.turnNumber,text:redactPublicProjectValue(message,session)})
  }

  nativeToolMatch(batch, request, includeSettled = false) {
    const callId=String(request?.params?.callId||''),name=String(request?.params?.tool||request?.params?.name||'')
    return batch?.underlyingCalls?.find(candidate=>(includeSettled||candidate.state==='open')&&(
      candidate.rawCall.aliases.includes(callId)
      || candidate.rawCall.name==='exec'&&candidate.name===name
    ))||null
  }

  settleNativeToolAdmission(session, entry, batch, underlyingCall) {
    underlyingCall.state='reserved'
    Promise.resolve().then(()=>this.admitNativeToolRequest(session,entry.request,batch,underlyingCall)).then(entry.resolve,entry.reject)
  }

  settlePendingNativeToolAdmissions(session, active, batch) {
    for(const [callId,entries] of [...active.pendingToolAdmissions]){
      for(const entry of entries){
        const match=this.nativeToolMatch(batch,entry.request)
        if(match)this.settleNativeToolAdmission(session,entry,batch,match)
        else{
          const settled=this.nativeToolMatch(batch,entry.request,true),duplicate=settled&&settled.rawCall.aliases.includes(String(entry.request?.params?.callId||'')),
            message=duplicate?'Codex dynamic tool call attempted to reuse an already admitted raw model response item.':'Codex dynamic tool call does not match the tool encoded by its raw model response boundary.'
          session.traceDecisionProtocol?.({kind:'decision-rejected',code:duplicate?'CODEX_NATIVE_RAW_RESPONSE_ITEM_ALREADY_ADMITTED':'CODEX_NATIVE_TOOL_RESPONSE_BOUNDARY_MISMATCH',message,details:{dynamicRequest:entry.request.params,responseId:batch.responseId,underlyingToolNames:batch.underlyingCalls.map(call=>call.name)}})
          entry.reject(new Error(message))
        }
      }
      active.pendingToolAdmissions.delete(callId)
    }
  }

  expireUncalledNativeToolBoundaries(session, active) {
    for(const batch of active.sealedDecisionBatches){
      const expired=batch.underlyingCalls.filter(call=>call.state==='open')
      if(!expired.length)continue
      for(const call of expired)call.state='expired'
      for(const alias of batch.aliases)if(active.rawDecisionBatches.get(alias)===batch)active.rawDecisionBatches.delete(alias)
      session.traceDecisionProtocol?.({kind:'native-response-boundary-expired',responseId:boundedText(batch.responseId,256)||null,uncalledToolNames:expired.map(call=>call.name)})
    }
  }

  sealNativeToolDecision(session, active, params) {
    const rawCalls=active.rawDecisionCalls.splice(0),calls=rawCalls,
      underlyingCalls=calls.flatMap(rawCall=>rawCall.underlyingToolNames.map((name,index)=>({rawCall,name,index,state:'open'}))),
      aliases=new Set(calls.flatMap(call=>call.aliases)),batch={
      turnId:active.turnId,
      responseId:String(params?.responseId||''),
      count:underlyingCalls.length,
      wrapperCount:calls.length,
      calls,
      underlyingCalls,
      aliases,
      rejectionTraced:false,
    }
    if(batch.count>1){
      batch.canvasDecisionBatch=createCanvasDecisionBatch(session)
      // The installed CLI can still wrap dynamic tools in exec even when Code
      // Mode is disabled. Its actual callbacks supply resolved JSON arguments;
      // do not evaluate or parse the JavaScript wrapper in the PenEcho host.
      batch.callbackOrdered=calls.length===1&&calls[0].name==='exec'
      let predecessor=Promise.resolve()
      for(const call of underlyingCalls){
        call.predecessor=predecessor
        predecessor=new Promise(resolve=>{call.complete=resolve})
      }
      try{
        if(batch.count>MAX_CANVAS_DECISION_TOOLS)throw Object.assign(new Error(`A decision supports at most ${MAX_CANVAS_DECISION_TOOLS} calls.`),{code:'CANVAS_TOOL_BATCH_LIMIT'})
        const ids=new Set()
        for(const call of calls){
          if(call.name==='exec'){
            if(!batch.callbackOrdered)throw Object.assign(new Error('Do not mix wrapper and direct tool batches; return direct tool calls.'),{code:'CANVAS_TOOL_BATCH_WRAPPER'})
            for(const name of call.underlyingToolNames)if(!session.native.tool(name))throw Object.assign(new Error(`Unavailable tool: ${name}.`),{code:'CANVAS_TOOL_UNAVAILABLE'})
            continue
          }
          if(call.namespace!==null&&call.namespace!=='penecho')throw new Error('Tool namespace is unavailable.')
          if(!session.native.tool(call.name))throw Object.assign(new Error(`Unavailable tool: ${call.name}.`),{code:'CANVAS_TOOL_UNAVAILABLE'})
          if(!call.aliases.length||call.aliases.some(id=>ids.has(id)))throw new Error('Tool call IDs must be nonempty and unique.')
          call.aliases.forEach(id=>ids.add(id))
          const args=typeof call.arguments==='string'?JSON.parse(call.arguments):call.arguments
          if(!args||typeof args!=='object'||Array.isArray(args))throw new Error('Tool arguments must be a JSON object.')
        }
      }catch(error){batch.admissionError={code:error.code||'CANVAS_TOOL_ARGUMENTS_INVALID',message:error.message}}
    }
    active.rawBoundaryCount++
    active.sealedDecisionBatches.push(batch)
    session.traceDecisionProtocol?.({
      kind:'native-response-boundary',
      responseId:boundedText(batch.responseId,256)||null,
      toolCallCount:batch.count,
      wrapperCallCount:batch.wrapperCount,
      recognizedCallIdCount:calls.filter(call=>call.aliases.length).length,
      recognizedAliasCount:aliases.size,
      rawCalls:rawCalls.map(call=>({itemId:call.itemId,callId:call.callId,name:call.name,namespace:call.namespace,arguments:call.arguments,aliases:call.aliases,underlyingToolNames:call.underlyingToolNames})),
    })
    for(const alias of aliases)active.rawDecisionBatches.set(alias,batch)
    this.settlePendingNativeToolAdmissions(session,active,batch)
  }

  handleNotification(session, method, params) {
    if (session.disposed) return
    this.recordNativeNotification(session,method,params)
    if (params?.threadId !== undefined && String(params.threadId) !== String(session.threadId)) {
      this.invalidateSession(session, new Error('Codex app-server emitted a notification for another thread.')).catch(() => {})
      return
    }
    const active = session.active
    if (method === 'error') {
      const turnId = String(params?.turnId || '')
      if (params?.willRetry === false) {
        if (turnId && (!active?.turnId || turnId !== active.turnId)) {
          this.invalidateSession(session, new Error('Codex app-server reported a fatal error for another turn.')).catch(() => {})
          return
        }
        const message = String(params?.error?.message || params?.message || params?.error || 'Codex app-server reported a fatal error.')
        this.failTurn(session, new Error(safeError(message))).catch(() => {})
      }
      return
    }
    if (method === 'thread/closed') {
      this.invalidateSession(session, new Error('Codex app-server closed the PenEcho Agent thread.')).catch(() => {})
      return
    }
    if (method === 'thread/tokenUsage/updated') {
      const turnId = String(params?.turnId || '')
      if (!active) return
      if (!params?.threadId || String(params.threadId) !== String(session.threadId) || !active.turnId || !turnId || turnId !== active.turnId) {
        this.invalidateSession(session, new Error('Codex app-server emitted token usage for another turn.')).catch(() => {})
        return
      }
      const usage = compactUsage(params.tokenUsage)
      active.usage = usage
      if(usage?.total)session.reportedUsageTotal=usage.total
      this.emitPublicEvent(session, { kind:'token_usage', turn:session.turnNumber, tokenUsage:usage })
      return
    }
    if (method === 'thread/compacted' || (method === 'item/completed' && String(params.item?.type || '') === 'contextCompaction')) {
      const turnId = String(params.turnId || '')
      if (!active || !params?.threadId || String(params.threadId) !== String(session.threadId) || !turnId || turnId !== active.turnId) {
        this.invalidateSession(session, new Error('Codex app-server emitted compaction for another turn.')).catch(() => {})
        return
      }
      if (!active.compactionEmitted) {
        active.compactionEmitted = true
        this.emitPublicEvent(session, { kind:'compaction', mode:'native', turn:session.turnNumber })
      }
      return
    }
    if (method === 'turn/started') {
      const startedTurnId = String(params.turn?.id || '')
      if (!active || !params?.threadId || String(params.threadId) !== String(session.threadId) || !startedTurnId || (active.turnId && active.turnId !== startedTurnId)) {
        this.invalidateSession(session, new Error('Codex app-server emitted a mismatched turn id.')).catch(() => {})
        return
      }
      active.turnId = startedTurnId
      active.activityDiagnostics?.phase('awaiting-model-events')
      this.recordNativeActivity(active, 'turn/started')
      return
    }
    if (!active) return
    if (!active.turnId) return
    if ((method === 'rawResponseItem/completed' || method === 'rawResponse/completed')
      && (!params?.threadId || String(params.threadId) !== String(session.threadId) || !params?.turnId || String(params.turnId) !== active.turnId)) {
      this.invalidateSession(session, new Error('Codex app-server emitted a raw response event for another turn.')).catch(() => {})
      return
    }
    if (method === 'rawResponseItem/completed') {
      this.recordNativeActivity(active, 'rawResponseItem/completed')
      const item=params?.item,type=String(item?.type||'')
      if(type==='function_call'||type==='custom_tool_call'){
        active.activityDiagnostics?.phase('awaiting-raw-boundary')
        if(!active.rawDecisionCalls.length)this.expireUncalledNativeToolBoundaries(session,active)
        active.rawDecisionCalls.push(nativeRawDecisionCall(item))
      }
      return
    }
    if (method === 'rawResponse/completed') {
      this.recordNativeActivity(active, 'rawResponse/completed')
      if(!active.rawDecisionCalls.length)this.expireUncalledNativeToolBoundaries(session,active)
      this.sealNativeAssistantResponse(session,active)
      this.sealNativeToolDecision(session,active,params)
      active.activityDiagnostics?.phase(active.sealedDecisionBatches.at(-1)?.count ? 'awaiting-tool-request' : 'awaiting-model-events')
      return
    }
    const itemNotification = method.startsWith('item/'), turnActivity = CODEX_NATIVE_TURN_ACTIVITY_NOTIFICATIONS.has(method)
    if ((itemNotification || turnActivity) && (!params?.threadId || String(params.threadId) !== String(session.threadId)
      || !params?.turnId || String(params.turnId) !== active.turnId)) {
      this.invalidateSession(session, new Error(itemNotification
        ? 'Codex app-server emitted an item for another turn.'
        : 'Codex app-server emitted progress for another turn.')).catch(() => {})
      return
    }
    if (turnActivity) {
      this.recordNativeActivity(active, method)
      return
    }
    if (method === 'item/agentMessage/delta' && typeof params.delta === 'string') {
      this.recordNativeActivity(active, 'item/agentMessage/delta')
      active.text += params.delta
      if (active.text.length > MAX_AGENT_RESPONSE_CHARS) {
        this.failTurn(session, new Error('Codex app-server response is too large.'), { close:true }).catch(() => {})
        return
      }
      this.projectNativeProgress(session,active)
      return
    }
    if (method === 'item/completed') {
      this.recordNativeActivity(active, 'item/completed')
      const text = agentMessageText(params.item)
      this.appendNativeAssistantMessage(active,text)
      this.projectNativeProgress(session,active)
      if(active.text.length>MAX_AGENT_RESPONSE_CHARS){
        this.failTurn(session,new Error('Codex app-server response is too large.'),{close:true}).catch(()=>{})
      }
      return
    }
    if (method === 'turn/completed') {
      const turnId = String(params.turn?.id || '')
      if (!params?.threadId || String(params.threadId) !== String(session.threadId) || !turnId || turnId !== active.turnId) {
        this.invalidateSession(session, new Error('Codex app-server completed another turn.')).catch(() => {})
        return
      }
      const status = String(params.turn?.status || '')
      if (status !== 'completed') {
        this.failTurn(session, new Error(`Codex app-server turn ${status || 'failed'}.`)).catch(() => {})
        return
      }
      if (!active.text.trim()) {
        const text = (Array.isArray(params.turn?.items) ? params.turn.items.map(agentMessageText).filter(Boolean) : []).at(-1)
        this.appendNativeAssistantMessage(active,text)
      }
      this.sealNativeAssistantResponse(session,active)
      if (!active.text.trim()) {
        this.failTurn(session, new Error('Codex app-server returned no assistant response.'), { close:true }).catch(() => {})
        return
      }
      active.succeed()
      return
    }
  }

  captureNativeToolRequest(session, params) {
    const active = session.active
    if (String(params?.threadId || '') !== String(session.threadId) || !active || !active.turnId
      || String(params.turnId || '') !== active.turnId) {
      throw new Error('Codex dynamic tool call does not match the active turn.')
    }
    return { active, turnId:String(params.turnId), params }
  }

  parseNativeToolRequest(request) {
    const { active, turnId, params }=request
    const namespace = params.namespace === undefined ? 'penecho' : String(params.namespace || '')
    const name = String(params.tool || params.name || '')
    if (!name || name.length > 200) throw new Error('Codex dynamic tool name is invalid.')
    if (namespace !== 'penecho') throw new Error('Codex dynamic tool namespace is unavailable.')
    let args = params.arguments
    if (typeof args === 'string') {
      if (!args.trim()) args = {}
      else {
        try { args = JSON.parse(args) }
        catch { throw new Error(`Codex dynamic tool ${name} arguments are invalid JSON.`) }
      }
    }
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error(`Codex dynamic tool ${name} arguments must be an object.`)
    const callId = String(params.callId || '')
    if (!callId || callId.length > 256) throw new Error('Codex dynamic tool call id is invalid.')
    if (active.callIds.has(callId)) throw new Error('Codex dynamic tool call id was already used.')
    return { active, turnId, callId, name, args }
  }

  async admitNativeToolRequest(session, request, batch, underlyingCall = null) {
    const {active}=request,callId=String(request.params?.callId||'')
    if(session.disposed||session.active!==active||active.settled)throw new Error('Codex Native PenEcho Agent turn changed during tool admission.')
    const matched=underlyingCall||this.nativeToolMatch(batch,request),rawCall=matched?.rawCall
    if(batch.turnId!==request.turnId||!rawCall){
      const message='Codex dynamic tool call does not match its raw model response boundary.'
      this.traceNativeDecisionRejection(session,batch,'CODEX_NATIVE_TOOL_RESPONSE_BOUNDARY_MISMATCH',message,{callMatched:false,dynamicRequest:request.params})
      throw new Error(message)
    }
    if(matched.state==='admitted'){
      const message='Codex dynamic tool call attempted to reuse an already admitted raw model response item.'
      session.traceDecisionProtocol?.({
        kind:'decision-rejected',code:'CODEX_NATIVE_RAW_RESPONSE_ITEM_ALREADY_ADMITTED',message,
        details:{dynamicRequest:request.params,itemId:rawCall.itemId,callId:rawCall.callId,aliases:rawCall.aliases,underlyingToolName:matched.name},
      })
      throw new Error(message)
    }
    matched.state='admitted'
    rawCall.admitted=true
    if(batch.admissionError){
      if(callId&&callId.length<=256)active.callIds.add(callId)
      const message=`PenEcho Agent decision rejected: ${batch.admissionError.message} The entire decision was rejected before execution; no Canvas tool ran. Return corrected direct JSON tool calls.`
      this.traceNativeDecisionRejection(session,batch,batch.admissionError.code,message)
      return {success:false,contentItems:[{type:'inputText',text:message}]}
    }
    if(batch.count<1){
      const message='Codex dynamic tool call has no unique raw model response boundary.'
      this.traceNativeDecisionRejection(session,batch,'CODEX_NATIVE_TOOL_CALL_NOT_UNIQUE',message)
      throw new Error(message)
    }
    if(!batch.canvasDecisionBatch){
      const parsed=this.parseNativeToolRequest(request)
      if(parsed.name!==matched.name)throw new Error('Dynamic tool name differs from the admitted model decision.')
      active.callIds.add(parsed.callId)
      return this.executeNativeToolRequest(session,parsed)
    }
    // Requests can arrive out of order. Wait before joining the session queue,
    // otherwise a later call could hold that queue while awaiting its predecessor.
    try{
      const parsed=this.parseNativeToolRequest(request)
      if(parsed.name!==matched.name)throw new Error('Dynamic tool name differs from the admitted model decision.')
      if(!batch.callbackOrdered){
        const rawArgs=typeof rawCall.arguments==='string'?JSON.parse(rawCall.arguments):rawCall.arguments
        if(!isDeepStrictEqual(parsed.args,rawArgs))throw new Error('Dynamic tool arguments differ from the admitted model decision.')
      }
      active.callIds.add(parsed.callId)
      if(!batch.callbackOrdered)await raceAbortableExecution(matched.predecessor,active.inputController.signal,'Canvas batch cancelled.')
      if(active.settled)throw new Error('Canvas batch turn already ended.')
      return await this.executeNativeToolRequest(session,{...parsed,canvasDecisionBatch:batch.canvasDecisionBatch})
    }catch(error){batch.canvasDecisionBatch.failed=true;throw error}
    finally{matched.complete()}
  }

  rejectNativeToolAdmission(active, error) {
    if(!active)return
    for(const entries of active.pendingToolAdmissions.values())for(const entry of entries)entry.reject(error)
    active.pendingToolAdmissions.clear()
    active.rawDecisionBatches.clear()
    active.sealedDecisionBatches.length=0
    active.rawDecisionCalls.length=0
  }

  async executeNativeToolRequest(session, request) {
    const {active,turnId,callId,name,args}=request,tool=session.native.tool(name)
    if (!tool) throw new Error(`Codex dynamic tool ${name || '(missing)'} is unavailable.`)
    this.recordNativeActivity(active, 'tool/request')
    active.activityDiagnostics?.tool('queued')
    active.activityDiagnostics?.phase('tool-queued')
    const lifecycle = session.lifecycle
    const toolStillActive = () => !session.disposed && session.lifecycle === lifecycle && session.active === active && active.turnId === turnId
    let concludesTurn=false
    const execution = session.toolQueue.then(async () => {
      if (!toolStillActive()) throw new Error('Codex Native PenEcho Agent session or turn changed during tool execution.')
      active.activityDiagnostics?.tool('executing')
      active.activityDiagnostics?.phase('tool-executing')
      const controller = new AbortController()
      const timeoutMs = Math.max(1_000, Number(tool.timeoutMs) || 45_000)
      const timer = setTimeout(() => controller.abort(new Error(`PenEcho tool ${name} timed out.`)), timeoutMs)
      session.toolAborts.set(callId, controller)
      this.emitPublicEvent(session, { kind:'tool_call', turn:session.turnNumber, callId, name, arguments:redactPublicProjectValue(args, session) })
      try {
        const value = await raceAbortableExecution(
          Promise.resolve().then(() => tool.execute(args, { callId, signal:controller.signal, canvasDecisionBatch:request.canvasDecisionBatch, concludeTurn:()=>{concludesTurn=true} })),
          controller.signal,
          `PenEcho tool ${name} timed out.`,
        )
        if (!toolStillActive()) throw new Error('Codex Native PenEcho Agent session or turn changed during tool execution.')
        session.native.recordToolResult({ isError:false, value })
        const contentItems=await nativeToolContentItems({
          name,
          value,
          renderedBlocks:tool.output.render(args, value) || [],
          readImageRequest:(attachment, policy, signal) => this.attachments.readImageRequest(attachment, policy, signal),
          imagePolicy:CODEX_MODEL_IMAGE_REQUEST_POLICY,
          signal:controller.signal,
        })
        if (!toolStillActive()) throw new Error('Codex Native PenEcho Agent session or turn changed during tool execution.')
        if (!contentItems.length) contentItems.push({ type:'inputText', text:'PenEcho tool completed.' })
        const resultText=value?.terminal===true?boundedText(String(value.message||'PenEcho Agent stopped the current turn.'),2_000):'PenEcho tool completed.'
        this.emitPublicEvent(session, { kind:'tool_result', turn:session.turnNumber, callId, text:resultText,
          error:value?.terminal===true&&value?.code==='CANVAS_BUSY'?{code:value.code,message:resultText,details:value.details}:null })
        const response={ success:true, contentItems }
        active.activityDiagnostics?.tool('result-ready')
        active.activityDiagnostics?.phase('tool-result-ready')
        if(concludesTurn)this.concludeNativeTurnAfterTool(session,active,value)
        return response
      } catch (error) {
        if(request.canvasDecisionBatch&&CANVAS_MUTATION_TOOLS.has(name))request.canvasDecisionBatch.failed=true
        if (toolStillActive()) session.native.recordToolResult({ isError:true, error })
        const text = boundedText(redactPublicProjectValue(safeError(error, `PenEcho tool ${name} failed.`), session), 2_000)
        if (toolStillActive()) this.emitPublicEvent(session, { kind:'tool_result', turn:session.turnNumber, callId, text, error:{ code:'CODEX_TOOL_FAILED', message:text } })
        active.activityDiagnostics?.tool('result-ready')
        active.activityDiagnostics?.phase('tool-result-ready')
        return { success:false, contentItems:[{ type:'inputText', text }] }
      } finally {
        clearTimeout(timer)
        session.toolAborts.delete(callId)
      }
    })
    session.toolQueue = execution.catch(() => {})
    return execution
  }

  async handleServerRequest(session, id, method, params) {
    if (session.disposed) throw new Error('Codex Native PenEcho Agent session is closed.')
    if (method === 'item/tool/call') {
      const active=session.active
      if (active?.activityDiagnosticRequestIds && active.activityDiagnosticRequestIds.size < 64) active.activityDiagnosticRequestIds.add(id)
      active?.activityDiagnostics?.tool('received')
      active?.activityDiagnostics?.phase('awaiting-tool-admission')
    }
    session.traceDecisionProtocol?.({kind:'native-server-request',requestId:id,method,params})
    if (method !== 'item/tool/call') {
      const message=`PenEcho refused Codex app-server request ${method}.`
      session.traceDecisionProtocol?.({kind:'decision-rejected',code:'CODEX_NATIVE_SERVER_REQUEST_UNAVAILABLE',message,details:{method:boundedText(method,128)}})
      this.invalidateSession(session, new Error(message)).catch(() => {})
      throw new Error(message)
    }
    let request
    try{request=this.captureNativeToolRequest(session,params)}catch(error){
      session.traceDecisionProtocol?.({
        kind:'decision-rejected',code:'CODEX_NATIVE_TOOL_REQUEST_INVALID',message:safeError(error),
        details:{method:'item/tool/call',hasCallId:Boolean(params?.callId)},
      })
      throw error
    }
    const active=request.active,callId=String(params?.callId||'')
    if(!callId||callId.length>256)throw new Error('Codex dynamic tool call id is invalid.')
    const sealed=active.rawDecisionBatches.get(callId)
    if(sealed){
      const match=this.nativeToolMatch(sealed,request),settled=this.nativeToolMatch(sealed,request,true)
      if(match)return this.admitNativeToolRequest(session,request,sealed,match)
      if(settled)throw new Error('Codex dynamic tool call attempted to reuse an already admitted raw model response item.')
    }
    for(const batch of active.sealedDecisionBatches){
      const match=this.nativeToolMatch(batch,request)
      if(match)return this.admitNativeToolRequest(session,request,batch,match)
    }
    const dynamicName=String(params?.tool||params?.name||''),pendingRawMatch=active.rawDecisionCalls.some(call=>
      call.aliases.includes(callId)||call.name==='exec'&&call.underlyingToolNames.includes(dynamicName)
    )
    if(!pendingRawMatch&&active.rawBoundaryCount>0){
      const message='Codex dynamic tool call arrived without a matching raw model response item.'
      session.traceDecisionProtocol?.({
        kind:'decision-rejected',code:'CODEX_NATIVE_RAW_RESPONSE_ITEM_MISSING',message,
        details:{
          pendingRawToolCallCount:active.rawDecisionCalls.length,
          dynamicRequest:params,
          rawCalls:active.rawDecisionCalls.map(call=>({
            itemId:call.itemId,
            callId:call.callId,
            name:call.name,
            namespace:call.namespace,
            arguments:call.arguments,
            aliases:call.aliases,
            underlyingToolNames:call.underlyingToolNames,
          })),
        },
      })
      throw new Error(message)
    }
    return new Promise((resolve,reject)=>{
      const entries=active.pendingToolAdmissions.get(callId)||[]
      entries.push({request,resolve,reject})
      active.pendingToolAdmissions.set(callId,entries)
      active.activityDiagnostics?.phase('awaiting-tool-admission')
    })
  }

  callBrowserTool(session, name, args, callId, signal, timeoutMs = 45_000) {
    if (signal?.aborted) return Promise.reject(signal.reason instanceof Error ? signal.reason : Object.assign(new Error(`Canvas tool ${name} was cancelled.`), {name:'AbortError'}))
    if (!session.connected) return Promise.reject(new Error('Canvas browser disconnected during tool execution.'))
    const requestId = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        session.pending.delete(requestId)
        reject(new Error(`Canvas tool ${name} timed out.`))
      }, Math.max(1_000, Number(timeoutMs) || 45_000))
      const abort = () => {
        clearTimeout(timer)
        session.pending.delete(requestId)
        reject(signal?.reason instanceof Error ? signal.reason : new Error(`Canvas tool ${name} was cancelled.`))
      }
      signal?.addEventListener('abort', abort, { once:true })
      session.pending.set(requestId, {
        resolve:value => { clearTimeout(timer); signal?.removeEventListener('abort', abort); resolve(value) },
        reject:error => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(error) },
      })
      this.send(session, 'tool_request', { requestId, callId:String(callId), name, arguments:args })
    })
  }

  resolveToolResult(session, payload) {
    const requestId=String(payload?.requestId || ''),pending = session.pending.get(requestId)
    if (!pending) {
      if (session.ignoredToolResultIds.delete(requestId)) return false
      throw new Error('Canvas tool result does not match a pending request.')
    }
    session.pending.delete(requestId)
    if (payload.ok === false) {
      pending.reject(canvasBrowserToolError(payload.error))
    } else pending.resolve(payload.result)
    return true
  }

  async disconnect(session, binding) {
    if (binding !== undefined && session.binding !== binding) return false
    session.connected = false
    session.send = null
    const disconnectError = new Error('Canvas browser disconnected during tool execution.')
    const active = session.active
    if (active) {
      await this.invalidateSession(session, new Error('Codex Native PenEcho Agent turn interrupted by browser disconnect.'))
      return true
    }
    await this.abortToolWork(session, disconnectError)
    clearTimeout(session.expiryTimer)
    session.expiryTimer = setTimeout(() => { this.disposeSession(session).catch(() => {}) }, this.sessionTtlMs)
    session.expiryTimer.unref?.()
    return true
  }

  async disposeSession(session) {
    if (session?.disposePromise) return session.disposePromise
    if (!this.sessions.has(session?.id)) return
    this.sessions.delete(session.id)
    this.resumeIndex.delete(session.resumeHash)
    session.lifecycle += 1
    session.disposed = true
    const recoveryPromise=session.recoveryPromise
    session.disposePromise = (async () => {
      clearTimeout(session.expiryTimer)
      if(recoveryPromise)await recoveryPromise.catch(()=>{})
      const active = session.active
      const interruption=active?.turnId&&session.process?.alive
        ? session.process.interrupt(session.threadId,active.turnId).catch(() => {})
        : null
      if (active) active.fail(new Error('Codex Native PenEcho Agent session closed.'))
      await this.abortToolWork(session, new Error('Codex Native PenEcho Agent session closed.'))
      if(interruption)await interruption
      session.decisionFeedbackCalls.clear()
      session.decisionFeedbackCallIds.clear()
      session.ignoredToolResultIds.clear()
      this.logConversation(session, 'end')
      this.traceConversation(session, 'end')
      try { await session.process?.close() } catch (error) { this.logger({ type:'codex-native-close-error', error:safeError(error) }) }
      releaseProjectRoot(session.projectRootLease)
      try { await removeProjectRuntimeDirectory(this.stateDirectory, session) } catch (error) { this.logger({ type:'canvas-agent-runtime-cleanup-error', error:safeError(error) }) }
    })()
    return session.disposePromise
  }

  async dispose() {
    if (this.disposing) return this.disposing
    const sessions = [...this.sessions.values()]
    this.disposing = (async () => {
      await Promise.allSettled(sessions.map(session => this.disposeSession(session)))
      await this.context.fiber.dispose().catch(() => {})
    })()
    return this.disposing
  }

  logConversation(session, phase, event) {
    if (!this.conversationLogger) return
    try {
      this.conversationLogger({
        type:'canvas-agent-conversation',
        conversationId:session.conversationLogId,
        connectionId:session.connectionId,
        phase,
        ...(event ? { event:conversationLogEvent(event) } : {}),
      })
    } catch (error) {
      this.logger({ type:'canvas-agent-conversation-log-error', error:safeError(error) })
    }
  }

  traceConversation(session, phase, event, messages) {
    if (!this.conversationTrace) return
    try {
      this.conversationTrace({
        conversationId:session.conversationLogId,
        connectionId:session.connectionId,
        connection:session.requestTraceConnection,
        phase,
        ...(event ? { event } : {}),
        ...(messages ? { messages } : {}),
      })
    } catch (error) {
      this.logger({ type:'canvas-agent-request-trace-error', error:safeError(error) })
    }
  }

  async traceConversationAsset(session, asset) {
    if (!this.conversationTrace) return
    try { await this.conversationTrace({ conversationId:session.conversationLogId, connectionId:session.connectionId, connection:session.requestTraceConnection, phase:'asset', asset }) }
    catch (error) { this.logger({ type:'canvas-agent-request-trace-error', error:safeError(error) }) }
  }

  traceImageDebug(session, image) {
    if (!this.conversationTrace) return
    try { this.conversationTrace({ conversationId:session.conversationLogId, connectionId:session.connectionId, connection:session.requestTraceConnection, phase:'image-debug', image }) }
    catch (error) { this.logger({ type:'canvas-agent-request-trace-error', error:safeError(error) }) }
  }

  traceModelRequestImage({ ref, policy, image }) {
    const name=String(ref?.name || '')
    if (!isCanvasAgentHandwritingImageName(name) || !image?.data) return
    const attachmentId=String(ref.attachmentId || ''),sha256=createHash('sha256').update(image.data).digest('hex'),byteIdenticalToAdmitted=attachmentId === `sha256:${sha256}`
    for (const session of this.sessions.values()) if (session.attachmentRefs.has(attachmentId)) this.traceImageDebug(session,{
      stage:'llm-request', kind:'canvas-agent-handwriting', attachmentId, variantId:String(image.variantId || ''),
      name, mediaType:image.mediaType, bytes:Number(image.bytes) || image.data.byteLength,
      width:Number(image.width) || null, height:Number(image.height) || null,
      sha256, byteIdenticalToAdmitted, transformedForModel:!byteIdenticalToAdmitted,
      policy:{ maxPixels:Number(policy?.maxPixels) || null, maxBytes:Number(policy?.maxBytes) || null },
      data:image.data,
    })
  }

  tracePatchProtocol(session, record) {
    if (!this.conversationTrace) return
    try {
      this.conversationTrace({ conversationId:session.conversationLogId, connectionId:session.connectionId, connection:session.requestTraceConnection, phase:'patch-protocol', record })
    } catch (error) { this.logger({ type:'canvas-agent-request-trace-error', error:safeError(error) }) }
  }

  traceNativeDecisionRejection(session, batch, code, message, details = null) {
    if(batch?.rejectionTraced)return
    if(batch)batch.rejectionTraced=true
    session.traceDecisionProtocol?.({
      kind:'decision-rejected',
      code,
      message,
      details:{
        responseId:boundedText(batch?.responseId,256)||null,
        toolCallCount:Number.isSafeInteger(batch?.count)?batch.count:null,
        recognizedCallIdCount:Array.isArray(batch?.calls)?batch.calls.filter(call=>call.aliases.length).length:null,
        recognizedAliasCount:batch?.aliases instanceof Set?batch.aliases.size:null,
        ...(details||{}),
      },
    })
  }

  traceDecisionProtocol(session, record) {
    if (!this.conversationTrace) return
    try {
      this.conversationTrace({
        conversationId:session.conversationLogId,
        connectionId:session.connectionId,
        connection:session.requestTraceConnection,
        phase:'diagnostic',
        diagnostic:{
          provider:'codex-native',
          model:session.model,
          error:record?.kind==='decision-rejected'?{
            name:'CanvasDecisionProtocolError',
            message:String(record.message||''),
            code:String(record.code||'CANVAS_DECISION_REJECTED'),
          }:null,
          traceDiagnostic:JSON.stringify({kind:'canvas-decision-protocol',...record}),
        },
      })
    } catch (error) { this.logger({ type:'canvas-agent-request-trace-error', error:safeError(error) }) }
  }
}
