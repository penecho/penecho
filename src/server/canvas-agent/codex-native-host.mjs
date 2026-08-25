import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { chmod, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { Context } from '@deepseek-ai/cordis'
import { admitEncodedImages } from '@deepseek-ai/dsh-attachment'
import PenEchoAttachmentStore from './image-attachments.mjs'
import { DEFAULT_CANVAS_AGENT_IDLE_TIMEOUT_MS, canvasAgentTimeoutSeconds, createCanvasAgentModelTimeout } from './model-timeout.mjs'
import {
  acquireProjectRoot,
  admitInitialCanvasState,
  boundedText,
  conversationLogEvent,
  createCanvasAgentNativeRuntime,
  createProjectRuntimeDirectory,
  createSelectedFileSnapshot,
  freshVisualExplainerBudget,
  freshVisualExplorerBudget,
  loadCanvasAgentContract,
  loadCanvasAgentVisualExplorerContract,
  loadCanvasAgentVisualSkills,
  normalizeResolvedWidgetCapabilities,
  projectSessionCapabilities,
  publicSessionProject,
  publicWidgetCapabilities,
  redactPublicProjectValue,
  releaseProjectRoot,
  removeProjectRuntimeDirectory,
  requestTraceConnection,
} from './runtime.mjs'

const require = createRequire(import.meta.url)
const { prepareIsolatedRuntime, resolveCodexLaunch } = require('../../providers/codex-cli.js')
const { fetchPublicResource } = require('../public-fetch.js')

const MAX_PROTOCOL_BYTES = 1024 * 1024
const MAX_STDERR_BYTES = 16 * 1024
const SESSION_TTL_MS = 30_000
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000
const INTERRUPT_REQUEST_TIMEOUT_MS = 5_000
const MAX_BACKLOG = 500
const MAX_AGENT_RESPONSE_CHARS = 400_000
const CODEX_MODEL_IMAGE_REQUEST_POLICY = Object.freeze({ maxPixels:2048 * 2048, maxBytes:1024 * 1024 })
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

function hash(value) {
  return createHash('sha256').update(String(value)).digest('hex')
}

function token(length = 32) {
  return randomBytes(length).toString('base64url')
}

function configured(value) {
  const text = String(value || '').trim()
  return text && text !== 'config' && text !== 'default' ? text : null
}

function safeError(error, fallback = 'Codex Native Canvas Agent failed.') {
  return String(error?.message || error || fallback)
    .replace(/\/(?:[\w.-]+\/)+[\w.-]+/g, '<path>')
    .replace(/\b[A-Za-z]:\\(?:[^\\\s]+\\)+[^\\\s]+/g, '<path>')
    .replace(/\b(api[-_]?key|access[-_]?token|refresh[-_]?token|authorization|cookie|secret)\s*[:=]\s*[^\s,;}]+/gi, '$1=<redacted>')
    .slice(0, 2_000)
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
  const compactNumber = item => Number.isSafeInteger(Number(item)) && Number(item) >= 0 ? Number(item) : null
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
  constructor({ connection, env = process.env, logger = () => {}, spawnProcess = spawn, prepareRuntime = prepareIsolatedRuntime, onNotification = null, onRequest = null, onGone = null }) {
    this.connection = connection
    this.env = env
    this.logger = logger
    this.spawnProcess = spawnProcess
    this.prepareRuntime = prepareRuntime
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
    this.onNotification = this.optionalCallback(onNotification, 'onNotification')
    this.onRequest = this.optionalCallback(onRequest, 'onRequest')
    this.onGone = this.optionalCallback(onGone, 'onGone')
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
    this.workDir = await mkdtemp(join(tmpdir(), 'penecho-canvas-codex-'))
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
      this.stderr = `${this.stderr}${chunk}`.slice(-MAX_STDERR_BYTES)
    })
    this.child.once('error', error => this.processGone(error))
    this.child.once('exit', (code, signal) => this.processGone(new Error(`Codex app-server exited (${signal ?? code}).`)))
    this.child.stdin?.on?.('error', error => {
      if (error?.code !== 'EPIPE') this.processGone(error)
    })

      await this.request('initialize', {
        clientInfo:{ name:'penecho-canvas-agent', title:'PenEcho Canvas Agent', version:'1' },
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
    this.write({ id, result })
  }

  respondError(id, message) {
    this.write({ id, error:{ code:-32000, message:safeError(message, 'Codex dynamic tool failed.') } })
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
    this.buffer += String(chunk)
    if (Buffer.byteLength(this.buffer, 'utf8') > MAX_PROTOCOL_BYTES && !this.buffer.includes('\n')) {
      this.processGone(new Error('Codex app-server emitted an oversized protocol line.'))
      return
    }
    let newline
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline).trim()
      this.buffer = this.buffer.slice(newline + 1)
      if (!line) continue
      if (Buffer.byteLength(line, 'utf8') > MAX_PROTOCOL_BYTES) {
        this.processGone(new Error('Codex app-server emitted an oversized protocol line.'))
        return
      }
      let message
      try { message = JSON.parse(line) }
      catch {
        this.processGone(new Error('Codex app-server emitted invalid JSON-RPC output.'))
        return
      }
      this.handleMessage(message)
      if (!this.child) return
    }
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

  write(message) {
    if (!this.child?.stdin?.writable) throw new Error('Codex app-server is not running.')
    this.child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  processGone(error) {
    const child = this.child
    if (!child) return
    this.child = null
    const failure = error
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
    logger = () => {},
    conversationLogger = null,
    conversationTrace = null,
    env = process.env,
    createAppServer = null,
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
    this.logger = logger
    this.conversationLogger = typeof conversationLogger === 'function' ? conversationLogger : null
    this.conversationTrace = typeof conversationTrace === 'function' ? conversationTrace : null
    this.env = env
    if (typeof publicFetch !== 'function') throw new Error('Codex Native Canvas Agent public fetch is invalid.')
    this.publicFetch = publicFetch
    this.createAppServer = createAppServer || (options => new CodexNativeAppServerProcess(options))
    this.sessionTtlMs = Math.max(1_000, Number(sessionTtlMs) || SESSION_TTL_MS)
    this.sessions = new Map()
    this.resumeIndex = new Map()
    this.context = new Context()
    this.attachments = new PenEchoAttachmentStore(this.context, { dshHome:join(stateDirectory, 'codex-native') })
    this.disposing = null
  }

  async initialize() { return this }

  async connect(options) {
    const {
      canvasSessionId = '', resumeToken = '', clientId = '', connectionId = 'default', webSearchEnabled = false,
      widgetCapabilities = {}, projectId = '', accessMode = 'controlled', binding = null, send = null,
    } = options || {}
    if (String(canvasSessionId).length > 256 || String(resumeToken).length > 256 || String(clientId).length > 256 || String(connectionId).length > 256 || String(projectId).length > 128) {
      throw new Error('Canvas Agent connection identity is invalid.')
    }
    const normalizedProjectId = String(projectId || ''), normalizedAccessMode = String(accessMode || 'controlled')
    if (!['controlled', 'full'].includes(normalizedAccessMode)) throw new Error('Canvas Agent project access mode is invalid.')
    const project = normalizedProjectId ? await this.resolveProject(normalizedProjectId) : null
    if (normalizedProjectId && !project) throw new Error('The selected local project was not found on this PenEcho host.')
    const connection = this.resolveConnection(connectionId)
    if (!connection) throw new Error('The selected AI connection was not found.')
    if (connection.provider !== 'codex-cli') throw new Error('Codex Native Canvas Agent requires a Codex CLI connection.')
    const fingerprint = codexConnectionFingerprint(connection)
    const resolvedWebSearch = this.resolveWebSearch?.() || {}
    const webSearchApiKey = String(resolvedWebSearch.apiKey || '')
    const webSearchKeyHash = hash(webSearchApiKey)
    const resolvedWidgetCapabilities = await this.resolveWidgetCapabilities(widgetCapabilities || {})
    const normalizedWidgetCapabilities = normalizeResolvedWidgetCapabilities(resolvedWidgetCapabilities)
    const professionalDiagramsContract = normalizedWidgetCapabilities.professionalEnabled
      ? loadCanvasAgentContract(this.rootDirectory, 'professional-diagrams-contract.md', 8_000, 'Professional Diagrams')
      : null
    const resumeHash = resumeToken ? hash(resumeToken) : ''
    let session = canvasSessionId ? this.sessions.get(String(canvasSessionId)) : null
    if (session && session.connectionId === String(connection.id || connectionId) && session.connectionFingerprint === fingerprint
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
    if (session) await this.disposeSession(session)
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
      backlog:[],
      pending:new Map(),
      toolAborts:new Map(),
      toolQueue:Promise.resolve(),
      decisionFeedbackCalls:new Map(),
      decisionFeedbackCallIds:new Set(),
      turnQueue:Promise.resolve(),
      attachmentRefs:new Map(),
      captureCache:new Map(),
      activeCaptureAttachmentId:null,
      canvasLayoutOverviewRevision:null,
      canvasLayoutReviewRevision:null,
      lastCanvasMutationRevision:null,
      visualExplainerBudget:freshVisualExplainerBudget(),
      visualExplorerBudget:freshVisualExplorerBudget(),
      visualSkillsLoaded:new Set(),
      widgetContractsLoaded:new Set(),
      nextWidgetContractOrder:500,
      widgetPatchAttempts:new Map(),
      stateDigest:null,
      emitPublicEvent:null,
      expiryTimer:null,
      conversationLogId:randomUUID(),
      requestTraceConnection:{ ...requestTraceConnection(connection, configured(connection.cliModel)), executable:'codex' },
      traceAsset:null,
      tracePatchProtocol:null,
      traceDecisionProtocol:null,
      webSearchKeyHash,
      webSearch:{ provider:'tavily', apiKey:webSearchApiKey, enabled:Boolean(webSearchEnabled) },
      publicFetch:this.publicFetch,
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
      documentReaderLoaded:true,
      databaseReaderLoaded:true,
      threadId:null,
      process:null,
      startPromise:null,
      interruptPromise:null,
      lifecycle:0,
      native:null,
      active:null,
      disposed:false,
      disposePromise:null,
      turnNumber:0,
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
    return session
  }

  send(session, type, payload) {
    if (!session?.connected || typeof session.send !== 'function') return
    session.send(type, payload, { id:session.id, clientId:session.clientId })
  }

  async ensureStarted(session) {
    if (!this.sessions.has(session?.id) || session.disposed) throw new Error('Codex Native Canvas Agent session is closed.')
    const connection = this.resolveConnection(session.connectionId)
    if (!connection) throw new Error('The Codex Native Canvas Agent connection is unavailable.')
    if (codexConnectionFingerprint(connection) !== session.connectionFingerprint) {
      throw new Error('The Codex Native Canvas Agent connection changed. Start a new conversation before submitting this turn.')
    }
    if (connection.provider !== 'codex-cli') throw new Error('The Codex Native Canvas Agent connection is unavailable.')
    if (session.process?.alive && session.threadId) return
    if (session.startPromise) return session.startPromise
    const lifecycle = session.lifecycle
    const startPromise = (async () => {
      const process = this.createAppServer({
        connection,
        env:this.env,
        logger:this.logger,
        onNotification:(method, params) => this.handleNotification(session, method, params),
        onRequest:(id, method, params) => this.handleServerRequest(session, id, method, params),
        onGone:error => { this.invalidateSession(session, error).catch(() => {}) },
      })
      session.process = process
      try {
        const threadId = await process.start({
          model:connection.cliModel,
          cwd:session.project?.kind === 'folder' ? session.project.path : session.projectRuntimeDirectory,
          baseInstructions:session.native.instructions(),
          dynamicTools:session.native.dynamicTools(),
        })
        if (session.disposed || session.lifecycle !== lifecycle) {
          await process.close().catch(() => {})
          throw new Error('Codex Native Canvas Agent session was closed during startup.')
        }
        session.threadId = threadId
        return threadId
      } catch (error) {
        if (session.process === process) await process.close().catch(() => {})
        throw error
      }
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
    session.active?.timeout?.activity()
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

  activeProjectIds() {
    return [...new Set([...this.sessions.values()].map(session => String(session.project?.id || '')).filter(Boolean))]
  }

  updateState(session, digest) {
    if (!digest || typeof digest !== 'object' || Array.isArray(digest)) throw new Error('Canvas state digest is invalid.')
    session.stateDigest = digest
  }

  setWebSearchEnabled(session, enabled) {
    if (Boolean(enabled) !== session.webSearch.enabled) throw new Error('Internet Search changed. Start a new Canvas Agent conversation before submitting this turn.')
    return session.webSearch.enabled
  }

  async admitUserImages(session, images) {
    if (!Array.isArray(images) || images.length > 5) throw new Error('Canvas Agent accepts at most five images per message.')
    const imageAttachments = images.length ? await admitEncodedImages(this.attachments, images) : []
    const nextAttachmentRefs = new Map(session.attachmentRefs)
    for (const attachment of imageAttachments) nextAttachmentRefs.set(String(attachment.attachmentId), attachment)
    const attachmentBytes = [...nextAttachmentRefs.values()].reduce((total, attachment) => total + Number(attachment.bytes || 0), 0)
    if (nextAttachmentRefs.size > 100 || attachmentBytes > 100 * 1024 * 1024) throw new Error('Canvas Agent attachment capacity is exhausted. Start a new conversation before attaching more images.')
    for (const attachment of imageAttachments) session.attachmentRefs.set(String(attachment.attachmentId), attachment)
    return imageAttachments
  }

  hostReferencesFor(session, imageAttachments, references, initialCanvasState) {
    const authoritativeObjects = new Map((Array.isArray(session.stateDigest?.objects) ? session.stateDigest.objects : []).map(object => [String(object?.id || ''), object]))
    const selectedIds = Array.isArray(references?.objectIds) ? references.objectIds.map(String).slice(0, 20) : []
    const region = references?.region && typeof references.region === 'object' ? {
      x:Number(references.region.x), y:Number(references.region.y), width:Number(references.region.width), height:Number(references.region.height),
    } : null
    const canvasWidth = Number(session.stateDigest?.canvas?.width), canvasHeight = Number(session.stateDigest?.canvas?.height)
    const validRegion = region && Object.values(region).every(Number.isFinite) && region.x >= 0 && region.y >= 0 && region.width > 0 && region.height > 0
      && region.x + region.width <= canvasWidth && region.y + region.height <= canvasHeight ? region : null
    return {
      revision:Number.isSafeInteger(session.stateDigest?.revision) ? session.stateDigest.revision : null,
      viewRevision:Number.isSafeInteger(session.stateDigest?.viewRevision) ? session.stateDigest.viewRevision : null,
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

  async submit(session, text, steer = false, images = [], references = {}, initialState = null) {
    if (!this.sessions.has(session?.id) || session.disposed) throw new Error('Codex Native Canvas Agent session is closed.')
    if (session.interruptPromise) await session.interruptPromise
    if (!this.sessions.has(session?.id) || session.disposed) throw new Error('Codex Native Canvas Agent session is closed.')
    const prompt = boundedText(text, 40_000).trim()
    if (!prompt) throw new Error('Enter a message for Canvas Agent.')
    if (steer) return this.runSteer(session, prompt, images, references, initialState)
    const operation = session.turnQueue.then(() => this.runSubmit(session, text, steer, images, references, initialState))
    session.turnQueue = operation.catch(() => {})
    return operation
  }

  async runSteer(session, prompt, images = [], references = {}, initialState = null) {
    const active = session.active
    if (!active || !active.turnId) throw new Error('No active Codex Native Canvas Agent turn is available to steer.')
    if (!session.process?.alive || !session.threadId) throw new Error('Codex Native Canvas Agent thread is unavailable.')
    const imageAttachments = await this.admitUserImages(session, images)
    const initialCanvasState = await admitInitialCanvasState(session, this.attachments, initialState)
    if (session.active !== active || active.inputController.signal.aborted) throw new Error('No active Codex Native Canvas Agent turn is available to steer.')
    const hostReferences = this.hostReferencesFor(session, imageAttachments, references, initialCanvasState)
    const previousVisualExplainerBudget = session.visualExplainerBudget, previousVisualExplorerBudget = session.visualExplorerBudget,
      previousWidgetPatchAttempts = session.widgetPatchAttempts, previousTurnReferences = session.turnReferences
    session.turnReferences = hostReferences
    session.visualExplainerBudget = freshVisualExplainerBudget()
    session.visualExplorerBudget = freshVisualExplorerBudget()
    if (initialCanvasState?.empty) session.visualExplorerBudget.authoritativeEmptyRevision = Number(initialCanvasState.reference?.digest?.revision)
    session.widgetPatchAttempts = new Map()
    try {
      const input = await this.modelInput(session, prompt, hostReferences, [
        ...(initialCanvasState?.attachment ? [initialCanvasState.attachment] : []), ...imageAttachments,
      ], active.inputController.signal)
      if (session.active !== active || active.inputController.signal.aborted) throw new Error('No active Codex Native Canvas Agent turn is available to steer.')
      this.emitPublicEvent(session, { kind:'user_message', turn:session.turnNumber, text:redactPublicProjectValue(prompt, session) })
      await session.process.request('turn/steer', {
        threadId:session.threadId,
        expectedTurnId:active.turnId,
        input,
        additionalContext:this.additionalContextFor(session),
      })
      return { output:'', usage:active.usage, steered:true }
    } catch (error) {
      session.turnReferences = previousTurnReferences
      session.visualExplainerBudget = previousVisualExplainerBudget
      session.visualExplorerBudget = previousVisualExplorerBudget
      session.widgetPatchAttempts = previousWidgetPatchAttempts
      throw error
    }
  }

  async runSubmit(session, text, steer = false, images = [], references = {}, initialState = null) {
    if (!this.sessions.has(session?.id) || session.disposed) throw new Error('Codex Native Canvas Agent session is closed.')
    const prompt = boundedText(text, 40_000).trim()
    if (!prompt) throw new Error('Enter a message for Canvas Agent.')
    if (session.active) throw new Error('A Codex Native Canvas Agent turn is already active.')
    const inputController = new AbortController()
    let active
    const turnPromise = new Promise((resolve, reject) => {
      active = {
        turnId:null, text:'', usage:null, settled:false, callIds:new Set(), compactionEmitted:false, inputController, resolve, reject,
        rawDecisionCalls:[], rawDecisionBatches:new Map(), sealedDecisionBatches:[], rawBoundaryCount:0, pendingToolAdmissions:new Map(), responseTextStart:0,
        completedResponseMessages:[],
        emitEnd:(reason, error = null) => {
          if (active.settled) return
          active.settled = true
          active.timeout?.clear()
          this.rejectNativeToolAdmission(active, error || new Error('Codex Native Canvas Agent turn ended during tool admission.'))
          if (session.active === active) session.active = null
          const event = error
            ? { kind:'turn_end', turn:session.turnNumber, reason:{ kind:reason, error:{ code:'CODEX_NATIVE_FAILED', message:safeError(error) } } }
            : { kind:'turn_end', turn:session.turnNumber, reason:{ kind:reason } }
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
    session.turnNumber += 1
    const timeoutController = new AbortController()
    active.timeout = createCanvasAgentModelTimeout(
      timeoutController,
      Math.max(1_000, Number(this.modelTimeoutMs?.(session.connectionId)) || DEFAULT_CANVAS_AGENT_IDLE_TIMEOUT_MS),
      {
        reasonFor:(kind, limitMs) => Object.assign(new Error(kind === 'idle'
          ? `Codex CLI Canvas Agent turn timed out after ${canvasAgentTimeoutSeconds(limitMs)} seconds without activity.`
          : `Codex CLI Canvas Agent turn timed out after reaching the ${canvasAgentTimeoutSeconds(limitMs)}-second total limit.`), { name:'TimeoutError' }),
      },
    )
    timeoutController.signal.addEventListener('abort', () => {
      const error = timeoutController.signal.reason instanceof Error
        ? timeoutController.signal.reason
        : new Error('Codex CLI Canvas Agent turn timed out.')
      this.failTurn(session, error, { close:true }).catch(() => {})
    }, { once:true })
    this.emitPublicEvent(session, { kind:'user_message', turn:session.turnNumber, text:redactPublicProjectValue(prompt, session) })
    this.emitPublicEvent(session, { kind:'turn_start', turn:session.turnNumber })
    this.send(session, 'agent_status', { status:'running' })

    let previousVisualExplainerBudget, previousVisualExplorerBudget, previousWidgetPatchAttempts, budgetsChanged = false
    const assertActive = () => {
      if (session.disposed || session.active !== active || inputController.signal.aborted) {
        throw inputController.signal.reason instanceof Error
          ? inputController.signal.reason
          : new Error('Codex Native Canvas Agent turn is no longer active.')
      }
    }
    try {
      await this.ensureStarted(session)
      assertActive()
      if (!session.process?.alive || !session.threadId) throw new Error('Codex Native Canvas Agent thread is unavailable.')
      const imageAttachments = await this.admitUserImages(session, images)
      assertActive()
      const initialCanvasState = await admitInitialCanvasState(session, this.attachments, initialState)
      assertActive()
      const hostReferences = this.hostReferencesFor(session, imageAttachments, references, initialCanvasState)
      session.turnReferences = hostReferences
      previousVisualExplainerBudget = session.visualExplainerBudget
      previousVisualExplorerBudget = session.visualExplorerBudget
      previousWidgetPatchAttempts = session.widgetPatchAttempts
      budgetsChanged = true
      session.visualExplainerBudget = freshVisualExplainerBudget()
      session.visualExplorerBudget = freshVisualExplorerBudget()
      if (initialCanvasState?.empty) session.visualExplorerBudget.authoritativeEmptyRevision = Number(initialCanvasState.reference?.digest?.revision)
      session.widgetPatchAttempts = new Map()
      const input = await this.modelInput(session, prompt, hostReferences, [
        ...(initialCanvasState?.attachment ? [initialCanvasState.attachment] : []), ...imageAttachments,
      ], inputController.signal)
      assertActive()
      const result = await session.process.request('turn/start', {
        threadId:session.threadId,
        input,
        ...(session.effort ? { effort:session.effort } : {}),
        additionalContext:this.additionalContextFor(session),
      })
      assertActive()
      const responseTurnId = String(result?.turn?.id || '')
      if (active.turnId && responseTurnId && responseTurnId !== active.turnId) throw new Error('Codex app-server returned a mismatched turn id.')
      active.turnId ||= responseTurnId
      if (!active.turnId) throw new Error('Codex app-server did not return a turn id.')
    } catch (error) {
      inputController.abort(error)
      if (active.settled) return turnPromise
      if (budgetsChanged) {
        session.visualExplainerBudget = previousVisualExplainerBudget
        session.visualExplorerBudget = previousVisualExplorerBudget
        session.widgetPatchAttempts = previousWidgetPatchAttempts
      }
      await this.failTurn(session, error, { close:true })
      return turnPromise
    }

    try {
      return await turnPromise
    } finally {
      session.turnReferences = null
      if (!session.disposed) this.send(session, 'agent_status', { status:'idle' })
    }
  }

  async abortToolWork(session, error) {
    this.rejectNativeToolAdmission(session.active, error)
    for (const [requestId, pending] of session.pending) {
      session.pending.delete(requestId)
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
    const error = new Error('Codex Native Canvas Agent turn cancelled.')
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
      await Promise.all([interruptPromise,this.abortToolWork(session, error)])
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
    } else if (active) active.fail(failure)
    this.send(session, 'agent_status', { status:'idle' })
  }

  async invalidateSession(session, error) {
    const active = session?.active
    const process=session?.process,threadId=session?.threadId,turnId=active?.turnId
    if (active) active.fail(error)
    const disposal=this.disposeSession(session)
    const interruption=turnId&&process?.alive ? process.interrupt(threadId,turnId).catch(() => {}) : null
    await Promise.all([disposal,...(interruption?[interruption]:[])])
    if (active) this.send(session, 'agent_status', { status:'idle' })
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

  sealNativeAssistantResponse(session, active) {
    const start=Math.min(active.responseTextStart,active.text.length),responseText=active.text.slice(start),messages=active.completedResponseMessages.splice(0)
    active.responseTextStart=active.text.length
    if(!responseText)return
    this.emitPublicEvent(session,{kind:'assistant_delta',turn:session.turnNumber,text:redactPublicProjectValue(responseText,session)})
    for(const message of messages)this.emitPublicEvent(session,{kind:'assistant_message',turn:session.turnNumber,text:redactPublicProjectValue(message,session)})
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
        this.invalidateSession(session, new Error(safeError(message))).catch(() => {})
      }
      return
    }
    if (method === 'thread/closed') {
      this.invalidateSession(session, new Error('Codex app-server closed the Canvas Agent thread.')).catch(() => {})
      return
    }
    if (method === 'thread/tokenUsage/updated') {
      const turnId = String(params?.turnId || '')
      if (!active) return
      if (!active.turnId || !turnId || turnId !== active.turnId) {
        this.invalidateSession(session, new Error('Codex app-server emitted token usage for another turn.')).catch(() => {})
        return
      }
      const usage = compactUsage(params.tokenUsage)
      active.usage = usage
      this.emitPublicEvent(session, { kind:'token_usage', turn:session.turnNumber, tokenUsage:usage })
      return
    }
    if (method === 'thread/compacted' || (method === 'item/completed' && String(params.item?.type || '') === 'contextCompaction')) {
      const turnId = String(params.turnId || '')
      if (!active || !turnId || turnId !== active.turnId) {
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
      if (!active || !startedTurnId || (active.turnId && active.turnId !== startedTurnId)) {
        this.invalidateSession(session, new Error('Codex app-server emitted a mismatched turn id.')).catch(() => {})
        return
      }
      active.turnId = startedTurnId
      active.timeout?.activity()
      return
    }
    if (!active) return
    if (!active.turnId) return
    if ((method === 'rawResponseItem/completed' || method === 'rawResponse/completed')
      && (!params?.turnId || String(params.turnId) !== active.turnId)) {
      this.invalidateSession(session, new Error('Codex app-server emitted a raw response event for another turn.')).catch(() => {})
      return
    }
    if (method === 'rawResponseItem/completed') {
      const item=params?.item,type=String(item?.type||'')
      if(type==='function_call'||type==='custom_tool_call'){
        if(!active.rawDecisionCalls.length)this.expireUncalledNativeToolBoundaries(session,active)
        active.rawDecisionCalls.push(nativeRawDecisionCall(item))
      }
      return
    }
    if (method === 'rawResponse/completed') {
      active.timeout?.activity()
      if(!active.rawDecisionCalls.length)this.expireUncalledNativeToolBoundaries(session,active)
      this.sealNativeAssistantResponse(session,active)
      this.sealNativeToolDecision(session,active,params)
      return
    }
    if (method.startsWith('item/') && (!params?.turnId || String(params.turnId) !== active.turnId)) {
      this.invalidateSession(session, new Error('Codex app-server emitted an item for another turn.')).catch(() => {})
      return
    }
    if (method === 'item/agentMessage/delta' && typeof params.delta === 'string') {
      active.timeout?.activity()
      active.text += params.delta
      if (active.text.length > MAX_AGENT_RESPONSE_CHARS) {
        this.failTurn(session, new Error('Codex app-server response is too large.'), { close:true }).catch(() => {})
        return
      }
      return
    }
    if (method === 'item/completed') {
      active.timeout?.activity()
      const text = agentMessageText(params.item)
      this.appendNativeAssistantMessage(active,text)
      if(active.text.length>MAX_AGENT_RESPONSE_CHARS){
        this.failTurn(session,new Error('Codex app-server response is too large.'),{close:true}).catch(()=>{})
      }
      return
    }
    if (method === 'turn/completed') {
      const turnId = String(params.turn?.id || '')
      if (!turnId || turnId !== active.turnId) {
        this.invalidateSession(session, new Error('Codex app-server completed another turn.')).catch(() => {})
        return
      }
      const status = String(params.turn?.status || '')
      if (status !== 'completed') {
        this.failTurn(session, new Error(`Codex app-server turn ${status || 'failed'}.`), { close:true }).catch(() => {})
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
    if(session.disposed||session.active!==active||active.settled)throw new Error('Codex Native Canvas Agent turn changed during tool admission.')
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
    if(batch.count>1){
      if(callId&&callId.length<=256)active.callIds.add(callId)
      const message=`Canvas Agent decision rejected: this model step returned ${batch.count} tool calls. Exactly one tool call is allowed per model step; the entire decision was rejected before execution and no Canvas tool ran. Return exactly one corrected tool call, or a final answer only when the task is complete or cannot proceed.`
      this.traceNativeDecisionRejection(session,batch,'CANVAS_ONE_TOOL_PER_STEP',message)
      return {success:false,contentItems:[{type:'inputText',text:message}]}
    }
    if(batch.count!==1){
      const message='Codex dynamic tool call has no unique raw model response boundary.'
      this.traceNativeDecisionRejection(session,batch,'CODEX_NATIVE_TOOL_CALL_NOT_UNIQUE',message)
      throw new Error(message)
    }
    const parsed=this.parseNativeToolRequest(request)
    active.callIds.add(parsed.callId)
    return this.executeNativeToolRequest(session,parsed)
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
    active.timeout?.activity()
    const lifecycle = session.lifecycle
    const toolStillActive = () => !session.disposed && session.lifecycle === lifecycle && session.active === active && active.turnId === turnId
    const execution = session.toolQueue.then(async () => {
      if (!toolStillActive()) throw new Error('Codex Native Canvas Agent session or turn changed during tool execution.')
      const controller = new AbortController()
      const timeoutMs = Math.max(1_000, Number(tool.timeoutMs) || 45_000)
      const timer = setTimeout(() => controller.abort(new Error(`PenEcho tool ${name} timed out.`)), timeoutMs)
      session.toolAborts.set(callId, controller)
      this.emitPublicEvent(session, { kind:'tool_call', turn:session.turnNumber, callId, name, arguments:redactPublicProjectValue(args, session) })
      try {
        const value = await raceAbortableExecution(
          Promise.resolve().then(() => tool.execute(args, { callId, signal:controller.signal })),
          controller.signal,
          `PenEcho tool ${name} timed out.`,
        )
        if (!toolStillActive()) throw new Error('Codex Native Canvas Agent session or turn changed during tool execution.')
        session.native.recordToolResult({ isError:false, value })
        const contentItems = []
        for (const block of tool.output.render(args, value) || []) {
          if (block?.type === 'text' && typeof block.text === 'string') contentItems.push({ type:'inputText', text:boundedText(block.text, 400_000) })
          else if (block?.type === 'image' && block.attachment?.attachmentId) {
            const stored = await this.attachments.readImageRequest(block.attachment, CODEX_MODEL_IMAGE_REQUEST_POLICY, controller.signal)
            contentItems.push({ type:'inputImage', imageUrl:`data:${stored.ref?.mediaType || stored.mediaType};base64,${Buffer.from(stored.data).toString('base64')}` })
          }
        }
        const directAttachment = value?.attachment?.attachmentId ? value.attachment : null
        if (directAttachment && !contentItems.some(item => item.type === 'inputImage')) {
          const stored = await this.attachments.readImageRequest(directAttachment, CODEX_MODEL_IMAGE_REQUEST_POLICY, controller.signal)
          contentItems.push({ type:'inputImage', imageUrl:`data:${stored.ref?.mediaType || stored.mediaType};base64,${Buffer.from(stored.data).toString('base64')}` })
        }
        if (!toolStillActive()) throw new Error('Codex Native Canvas Agent session or turn changed during tool execution.')
        if (!contentItems.length) contentItems.push({ type:'inputText', text:'PenEcho tool completed.' })
        this.emitPublicEvent(session, { kind:'tool_result', turn:session.turnNumber, callId, text:'PenEcho tool completed.', error:null })
        return { success:true, contentItems }
      } catch (error) {
        if (toolStillActive()) session.native.recordToolResult({ isError:true, error })
        const text = boundedText(redactPublicProjectValue(safeError(error, `PenEcho tool ${name} failed.`), session), 2_000)
        if (toolStillActive()) this.emitPublicEvent(session, { kind:'tool_result', turn:session.turnNumber, callId, text, error:{ code:'CODEX_TOOL_FAILED', message:text } })
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
    if (session.disposed) throw new Error('Codex Native Canvas Agent session is closed.')
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
    })
  }

  callBrowserTool(session, name, args, callId, signal, timeoutMs = 45_000) {
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
    const pending = session.pending.get(String(payload?.requestId || ''))
    if (!pending) throw new Error('Canvas tool result does not match a pending request.')
    session.pending.delete(String(payload.requestId))
    if (payload.ok === false) {
      const detail = payload.error && typeof payload.error === 'object'
        ? JSON.stringify({ code:payload.error.code || 'CANVAS_TOOL_FAILED', message:payload.error.message || 'Canvas tool failed.', details:payload.error.details || null })
        : boundedText(payload.error || 'Canvas tool failed.', 2_000)
      pending.reject(new Error(boundedText(detail, 2_000)))
    } else pending.resolve(payload.result)
  }

  async disconnect(session, binding) {
    if (binding !== undefined && session.binding !== binding) return false
    session.connected = false
    session.send = null
    const disconnectError = new Error('Canvas browser disconnected during tool execution.')
    const active = session.active
    if (active) {
      await this.invalidateSession(session, new Error('Codex Native Canvas Agent turn interrupted by browser disconnect.'))
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
    session.disposePromise = (async () => {
      clearTimeout(session.expiryTimer)
      const active = session.active
      const interruption=active?.turnId&&session.process?.alive
        ? session.process.interrupt(session.threadId,active.turnId).catch(() => {})
        : null
      if (active) active.fail(new Error('Codex Native Canvas Agent session closed.'))
      await this.abortToolWork(session, new Error('Codex Native Canvas Agent session closed.'))
      if(interruption)await interruption
      session.decisionFeedbackCalls.clear()
      session.decisionFeedbackCallIds.clear()
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
