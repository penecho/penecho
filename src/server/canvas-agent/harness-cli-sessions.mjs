import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'

const require = createRequire(import.meta.url)
const {
  prepareIsolatedRuntime,
  resolveCodexLaunch,
} = require('../../providers/codex-cli.js')
const {
  buildClaudeArgs,
  resolveClaudeLaunch,
  sanitizeClaudeEnv,
} = require('../../providers/claude-cli.js')
const {
  mapKimiEffort,
  resolveKimiLaunch,
  sanitizeKimiEnv,
} = require('../../providers/kimi-cli.js')

const MAX_PROTOCOL_BYTES = 1024 * 1024
const HARNESS_REPLAY_KIND = 'penecho-harness-cli-session'
const HARNESS_REPLAY_VERSION = 1
const CODEX_DISABLED_FEATURES = Object.freeze([
  'apps', 'auth_elicitation', 'browser_use', 'browser_use_external', 'browser_use_full_cdp_access', 'code_mode', 'code_mode_host', 'computer_use',
  'goals', 'hooks', 'image_generation', 'in_app_browser', 'memories', 'multi_agent', 'network_proxy', 'plugins', 'remote_plugin',
  'request_permissions_tool', 'shell_snapshot', 'shell_tool', 'skill_mcp_dependency_install', 'tool_call_mcp_elicitation', 'tool_suggest', 'unified_exec', 'workspace_dependencies',
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

function abortError(provider = 'CLI') {
  return Object.assign(new Error(`${provider} Harness session request aborted.`), { name:'AbortError' })
}

function appendTail(current, value, limit = MAX_PROTOCOL_BYTES) {
  const next = `${current}${value}`, bytes = Buffer.from(next, 'utf8')
  return bytes.length <= limit ? next : bytes.subarray(bytes.length - limit).toString('utf8').replace(/^\uFFFD/, '')
}

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

function processGroupExists(pid) {
  try { process.kill(-pid, 0); return true } catch { return false }
}

async function stopProcessTree(child) {
  if (!child?.pid) return
  if (process.platform === 'win32') {
    await new Promise(resolve => {
      let settled = false
      const finish = () => { if (!settled) { settled = true; clearTimeout(timer); resolve() } },
        killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { stdio:'ignore', windowsHide:true, shell:false }),
        timer = setTimeout(() => { try { killer.kill() } catch {}; try { child.kill() } catch {}; finish() }, 2_000)
      killer.once('error', () => { try { child.kill() } catch {}; finish() })
      killer.once('close', finish)
    })
    return
  }
  if (!processGroupExists(child.pid)) {
    if (child.exitCode === null && child.signalCode === null) try { child.kill('SIGTERM') } catch {}
    return
  }
  try { process.kill(-child.pid, 'SIGTERM') } catch {}
  const deadline = Date.now() + 1_000
  while (processGroupExists(child.pid) && Date.now() < deadline) await wait(40)
  if (processGroupExists(child.pid)) try { process.kill(-child.pid, 'SIGKILL') } catch {}
}

function spawnPersistent(launch, args, options) {
  const child = spawn(launch.command, [...launch.prefixArgs, ...args], {
    cwd:options.cwd,
    env:options.env,
    stdio:['pipe', 'pipe', 'pipe'],
    windowsHide:true,
    shell:false,
    detached:process.platform !== 'win32',
  })
  child.unref()
  child.stdin.unref?.()
  child.stdout.unref?.()
  child.stderr.unref?.()
  return child
}

function processDiagnostic(name, stderr) {
  return `${name} process closed.${stderr.trim() ? ` ${stderr.trim().slice(-2_000)}` : ''}`
}

class LineRpcProcess {
  constructor({ name, launch, args, cwd, env, onNotification = null, onRequest = null }) {
    this.name = name
    this.launch = launch
    this.args = args
    this.cwd = cwd
    this.env = env
    this.onNotification = onNotification
    this.onRequest = onRequest
    this.child = null
    this.buffer = ''
    this.stderr = ''
    this.nextId = 0
    this.pending = new Map()
    this.closed = false
  }

  get alive() { return Boolean(this.child) && !this.closed }

  start() {
    if (this.closed) throw new Error(`${this.name} RPC process is closed.`)
    if (this.child) return
    const child = spawnPersistent(this.launch, this.args, { cwd:this.cwd, env:this.env })
    this.child = child
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => this.handleData(chunk))
    child.stderr.on('data', chunk => { this.stderr = appendTail(this.stderr, chunk) })
    child.once('error', error => this.processGone(error))
    child.once('exit', (code, signal) => this.processGone(new Error(`${processDiagnostic(this.name, this.stderr)} (code ${code}, signal ${signal})`)))
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') this.processGone(error) })
  }

  handleData(chunk) {
    this.buffer += chunk
    if (Buffer.byteLength(this.buffer, 'utf8') > MAX_PROTOCOL_BYTES && !this.buffer.includes('\n')) {
      this.processGone(new Error(`${this.name} emitted an oversized protocol line.`))
      return
    }
    let newline
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline).trim()
      this.buffer = this.buffer.slice(newline + 1)
      if (!line) continue
      let message
      try { message = JSON.parse(line) }
      catch {
        this.processGone(new Error(`${this.name} emitted invalid JSON-RPC output.`))
        return
      }
      this.handleMessage(message)
    }
  }

  handleMessage(message) {
    if (message?.id !== undefined && message.method === undefined) {
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(`${this.name} ${pending.method} failed: ${message.error.message || JSON.stringify(message.error)}`))
      else pending.resolve(message.result)
      return
    }
    if (message?.method && message.id !== undefined) {
      Promise.resolve().then(() => this.onRequest?.(message.method, message.params)).then(
        result => this.send({ jsonrpc:'2.0', id:message.id, result:result ?? {} }),
        error => this.send({ jsonrpc:'2.0', id:message.id, error:{ code:-32601, message:String(error?.message || error || 'Unsupported request.') } }),
      ).catch(() => {})
      return
    }
    if (message?.method) {
      try { this.onNotification?.(message.method, message.params) } catch {}
    }
  }

  send(message) {
    if (!this.child || this.closed) throw new Error(`${this.name} RPC process is not running.`)
    this.child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  notify(method, params = {}) {
    this.send({ jsonrpc:'2.0', method, params })
  }

  request(method, params = {}) {
    return new Promise((resolve, reject) => {
      if (!this.child || this.closed) return reject(new Error(`${this.name} RPC process is not running.`))
      const id = ++this.nextId
      this.pending.set(id, { method, resolve, reject })
      try { this.send({ jsonrpc:'2.0', id, method, params }) }
      catch (error) { this.pending.delete(id); reject(error) }
    })
  }

  processGone(error) {
    const child = this.child
    if (!child) return
    this.child = null
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
    try { this.onNotification?.('penecho/process-gone', { error }) } catch {}
    if (!this.closed) void stopProcessTree(child).catch(() => {})
  }

  async close() {
    if (this.closed) return
    this.closed = true
    const child = this.child
    this.child = null
    const error = new Error(`${this.name} RPC process closed.`)
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
    if (child) {
      try { child.stdin.end() } catch {}
      await stopProcessTree(child).catch(() => {})
    }
  }
}

function codexHarnessAppServerArgs() {
  const args = ['app-server', '--stdio', '--strict-config']
  for (const feature of CODEX_DISABLED_FEATURES) args.push('--disable', feature)
  for (const config of CODEX_STRICT_CONFIG) args.push('-c', config)
  return args
}

function codexCompletedItemText(item) {
  if (!item || typeof item !== 'object') return ''
  const type = String(item.type || '').toLowerCase()
  if (!['agentmessage', 'agent_message', 'assistant_message', 'message'].includes(type)) return ''
  if (typeof item.text === 'string') return item.text
  if (typeof item.content === 'string') return item.content
  return Array.isArray(item.content) ? item.content.map(part => typeof part === 'string' ? part : part?.text || part?.output_text || '').join('') : ''
}

function codexForbiddenItem(item) {
  const type = String(item?.type || '').replace(/[^a-z]/gi, '').toLowerCase()
  return ['commandexecution', 'filechange', 'mcptoolcall', 'dynamictoolcall', 'websearch', 'computeraction', 'toolcall'].some(forbidden => type.includes(forbidden))
}

function configured(value) {
  const text = String(value || '').trim()
  return text && text !== 'config' && text !== 'default' ? text : null
}

class CodexHarnessSession {
  constructor({ connection, systemPrompt, env, logger }) {
    this.connection = connection
    this.systemPrompt = systemPrompt
    this.env = env
    this.logger = logger
    this.workDir = null
    this.rpc = null
    this.threadId = null
    this.active = null
    this.closed = false
  }

  get alive() { return !this.closed && (!this.rpc || this.rpc.alive) }
  get conversationId() { return this.threadId }

  async start() {
    if (this.closed) throw new Error('Codex Harness session is closed.')
    if (this.rpc?.alive && this.threadId) return
    this.workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'penecho-harness-codex-'))
    await fs.promises.chmod(this.workDir, 0o700).catch(() => {})
    const launch = resolveCodexLaunch(this.connection.cliPath, this.env), childEnv = await prepareIsolatedRuntime(this.workDir, this.env)
    this.rpc = new LineRpcProcess({
      name:'Codex app-server',
      launch,
      args:codexHarnessAppServerArgs(),
      cwd:this.workDir,
      env:childEnv,
      onNotification:(method, params) => this.notification(method, params),
      onRequest:method => { throw new Error(`PenEcho Harness does not provide Codex app-server request ${method}.`) },
    })
    this.rpc.start()
    await this.rpc.request('initialize', { clientInfo:{ name:'penecho-harness', title:'PenEcho Canvas Harness', version:'1' }, capabilities:{ experimentalApi:false } })
    this.rpc.notify('initialized', {})
    const result = await this.rpc.request('thread/start', {
      model:configured(this.connection.cliModel),
      cwd:this.workDir,
      approvalPolicy:'never',
      sandbox:'read-only',
      baseInstructions:this.systemPrompt,
      developerInstructions:null,
      dynamicTools:[],
      environments:[],
      runtimeWorkspaceRoots:[],
      ephemeral:true,
    })
    this.threadId = String(result?.thread?.id || '')
    if (!this.threadId) throw new Error('Codex app-server did not return a thread id.')
  }

  notification(method, params) {
    const active = this.active
    if (method === 'penecho/process-gone') {
      active?.fail(params?.error || new Error('Codex app-server process closed.'))
      return
    }
    if (!active || String(params?.threadId || '') !== this.threadId) return
    if (active.turnId && params?.turnId && String(params.turnId) !== active.turnId) return
    if ((method === 'item/started' || method === 'item/completed') && codexForbiddenItem(params?.item)) {
      if (active.turnId) void this.rpc.request('turn/interrupt', { threadId:this.threadId, turnId:active.turnId }).catch(() => {})
      active.fail(new Error(`Codex Harness session attempted disabled activity: ${String(params?.item?.type || 'tool')}.`))
      return
    }
    if (method === 'item/agentMessage/delta' && typeof params?.delta === 'string') {
      active.text += params.delta
      if (Buffer.byteLength(active.text, 'utf8') > MAX_PROTOCOL_BYTES) active.fail(new Error('Codex app-server response is too large.'))
      return
    }
    if (method === 'item/completed' && !active.text) {
      const text = codexCompletedItemText(params?.item)
      if (text) active.text = text
      return
    }
    if (method === 'thread/tokenUsage/updated') {
      active.usage = params?.tokenUsage?.last || null
      return
    }
    if (method !== 'turn/completed') return
    const status = String(params?.turn?.status || '')
    if (status !== 'completed') {
      active.fail(new Error(`Codex app-server turn ${status || 'failed'}${params?.turn?.error?.message ? `: ${params.turn.error.message}` : '.'}`))
      return
    }
    if (!active.text.trim()) {
      const text = (params?.turn?.items || []).map(codexCompletedItemText).filter(Boolean).at(-1)
      if (text) active.text = text
    }
    if (!active.text.trim()) active.fail(new Error('Codex app-server returned no assistant response.'))
    else active.succeed()
  }

  async request({ prompt, atlasImage, signal }) {
    await this.start()
    if (signal?.aborted) throw abortError('Codex')
    return new Promise((resolve, reject) => {
      const active = {
        turnId:null,
        text:'',
        usage:null,
        settled:false,
        succeed:() => {
          if (active.settled) return
          active.settled = true
          cleanup()
          resolve({ output:active.text.trim(), usage:active.usage, providerConversationId:this.threadId })
        },
        fail:error => {
          if (active.settled) return
          active.settled = true
          cleanup()
          reject(error)
        },
      }
      const cleanup = () => {
        signal?.removeEventListener('abort', onAbort)
        if (this.active === active) this.active = null
      }
      const onAbort = () => {
        if (active.turnId) void this.rpc.request('turn/interrupt', { threadId:this.threadId, turnId:active.turnId }).catch(() => {})
        active.fail(abortError('Codex'))
      }
      this.active = active
      signal?.addEventListener('abort', onAbort, { once:true })
      const input = [{ type:'text', text:String(prompt || '') }]
      for (const image of (Array.isArray(atlasImage) ? atlasImage : atlasImage ? [atlasImage] : []).filter(Boolean).slice(0, 5)) input.push({ type:'image', url:String(image) })
      this.rpc.request('turn/start', {
        threadId:this.threadId,
        input,
        ...(configured(this.connection.effort) ? { effort:configured(this.connection.effort) } : {}),
      }).then(result => {
        if (active.settled) return
        active.turnId = String(result?.turn?.id || '')
        if (!active.turnId) active.fail(new Error('Codex app-server did not return a turn id.'))
      }, error => active.fail(error))
    })
  }

  async close() {
    if (this.closed) return
    this.closed = true
    this.active?.fail(new Error('Codex Harness session closed.'))
    await this.rpc?.close().catch(() => {})
    if (this.workDir) await fs.promises.rm(this.workDir, { recursive:true, force:true, maxRetries:5, retryDelay:100 }).catch(error => this.logger?.({ type:'harness-cli-cleanup-error', provider:'codex-cli', error:String(error?.message || error) }))
  }
}

function claudeResultOutput(event) {
  if (event?.type !== 'result' || event?.subtype !== 'success') throw new Error(`Claude Harness session did not complete successfully${event?.subtype ? ` (${event.subtype})` : ''}.`)
  if (event.structured_output && typeof event.structured_output === 'object') return JSON.stringify(event.structured_output)
  if (typeof event.result !== 'string' || !event.result.trim()) throw new Error('Claude Harness session returned an empty result.')
  return event.result.trim()
}

function toolUseName(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const name = toolUseName(item)
      if (name) return name
    }
    return ''
  }
  if (!value || typeof value !== 'object') return ''
  if (value.type === 'tool_use') return String(value.name || value.tool || 'unknown')
  for (const item of Object.values(value)) {
    const name = toolUseName(item)
    if (name) return name
  }
  return ''
}

function claudeInput(prompt, atlasImage) {
  const content = [{ type:'text', text:String(prompt || '') }]
  for (const input of (Array.isArray(atlasImage) ? atlasImage : atlasImage ? [atlasImage] : []).filter(Boolean).slice(0, 5)) {
    const match = /^data:(image\/(?:png|webp));base64,([A-Za-z0-9+/]+={0,2})$/i.exec(String(input))
    if (!match) throw new Error('Claude Harness session received an invalid canvas image.')
    content.push({ type:'image', source:{ type:'base64', media_type:match[1].toLowerCase(), data:match[2] } })
  }
  return { type:'user', message:{ role:'user', content }, parent_tool_use_id:null }
}

class ClaudeHarnessSession {
  constructor({ connection, systemPrompt, env, logger }) {
    this.connection = connection
    this.systemPrompt = systemPrompt
    this.env = env
    this.logger = logger
    this.workDir = null
    this.child = null
    this.buffer = ''
    this.stderr = ''
    this.active = null
    this.sessionId = null
    this.closed = false
  }

  get alive() { return !this.closed && Boolean(this.child) }
  get conversationId() { return this.sessionId }

  async start() {
    if (this.closed) throw new Error('Claude Harness session is closed.')
    if (this.child) return
    this.workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'penecho-harness-claude-'))
    await fs.promises.chmod(this.workDir, 0o700).catch(() => {})
    const launch = resolveClaudeLaunch(this.connection.cliPath, this.env), args = buildClaudeArgs({
      systemPrompt:this.systemPrompt,
      model:configured(this.connection.cliModel),
      effort:configured(this.connection.effort),
    })
    const child = spawnPersistent(launch, args, { cwd:this.workDir, env:sanitizeClaudeEnv(this.env, this.connection.effort) })
    this.child = child
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => this.handleData(chunk))
    child.stderr.on('data', chunk => { this.stderr = appendTail(this.stderr, chunk) })
    child.once('error', error => this.processGone(error))
    child.once('exit', (code, signal) => this.processGone(new Error(`${processDiagnostic('Claude Harness', this.stderr)} (code ${code}, signal ${signal})`)))
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') this.processGone(error) })
  }

  handleData(chunk) {
    this.buffer += chunk
    if (Buffer.byteLength(this.buffer, 'utf8') > MAX_PROTOCOL_BYTES && !this.buffer.includes('\n')) return this.processGone(new Error('Claude Harness emitted an oversized protocol line.'))
    let newline
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline).trim()
      this.buffer = this.buffer.slice(newline + 1)
      if (!line) continue
      let event
      try { event = JSON.parse(line) }
      catch { return this.processGone(new Error('Claude Harness emitted invalid stream-json output.')) }
      if (event?.type === 'system' && event?.subtype === 'init') {
        this.sessionId = String(event.session_id || this.sessionId || '') || null
        if (Array.isArray(event.tools) && event.tools.length) return this.processGone(new Error(`Claude Harness exposed disabled tools: ${event.tools.map(String).join(', ')}.`))
        if (Array.isArray(event.mcp_servers) && event.mcp_servers.length) return this.processGone(new Error('Claude Harness connected MCP servers despite strict isolation.'))
      }
      const toolName = toolUseName(event)
      if (toolName) return this.processGone(new Error(`Claude Harness attempted disabled tool use: ${toolName}.`))
      if (event?.type !== 'result' || !this.active) continue
      try {
        const output = claudeResultOutput(event)
        this.active.succeed({ output, usage:event.usage || null, providerConversationId:String(event.session_id || this.sessionId || '') || null })
      } catch (error) { this.active.fail(error) }
    }
  }

  processGone(error) {
    const child = this.child
    if (!child) return
    this.child = null
    this.active?.fail(error)
    if (!this.closed) void stopProcessTree(child).catch(() => {})
  }

  async request({ prompt, atlasImage, signal }) {
    await this.start()
    if (signal?.aborted) throw abortError('Claude')
    return new Promise((resolve, reject) => {
      const active = {
        settled:false,
        succeed:value => { if (!active.settled) { active.settled = true; cleanup(); resolve(value) } },
        fail:error => { if (!active.settled) { active.settled = true; cleanup(); reject(error) } },
      }
      const cleanup = () => {
        signal?.removeEventListener('abort', onAbort)
        if (this.active === active) this.active = null
      }
      const onAbort = () => {
        active.fail(abortError('Claude'))
        void this.close()
      }
      this.active = active
      signal?.addEventListener('abort', onAbort, { once:true })
      try { this.child.stdin.write(`${JSON.stringify(claudeInput(prompt, atlasImage))}\n`) }
      catch (error) { active.fail(error) }
    })
  }

  async close() {
    if (this.closed) return
    this.closed = true
    this.active?.fail(new Error('Claude Harness session closed.'))
    const child = this.child
    this.child = null
    if (child) {
      try { child.stdin.end() } catch {}
      await stopProcessTree(child).catch(() => {})
    }
    if (this.workDir) await fs.promises.rm(this.workDir, { recursive:true, force:true, maxRetries:5, retryDelay:100 }).catch(error => this.logger?.({ type:'harness-cli-cleanup-error', provider:'claude-cli', error:String(error?.message || error) }))
  }
}

function kimiImageBlocks(atlasImage) {
  const blocks = []
  for (const input of (Array.isArray(atlasImage) ? atlasImage : atlasImage ? [atlasImage] : []).filter(Boolean).slice(0, 5)) {
    const match = /^data:(image\/(?:png|webp));base64,([A-Za-z0-9+/]+={0,2})$/i.exec(String(input))
    if (!match) throw new Error('Kimi Harness session received an invalid canvas image.')
    blocks.push({ type:'image', mimeType:match[1].toLowerCase(), data:match[2] })
  }
  return blocks
}

class KimiHarnessSession {
  constructor({ connection, systemPrompt, env, logger }) {
    this.connection = connection
    this.systemPrompt = systemPrompt
    this.env = env
    this.logger = logger
    this.workDir = null
    this.rpc = null
    this.sessionId = null
    this.active = null
    this.prompted = false
    this.closed = false
  }

  get alive() { return !this.closed && (!this.rpc || this.rpc.alive) }
  get conversationId() { return this.sessionId }

  async start() {
    if (this.closed) throw new Error('Kimi Harness session is closed.')
    if (this.rpc?.alive && this.sessionId) return
    this.workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'penecho-harness-kimi-'))
    await fs.promises.chmod(this.workDir, 0o700).catch(() => {})
    const launch = resolveKimiLaunch(this.connection.cliPath, this.env)
    this.rpc = new LineRpcProcess({
      name:'Kimi Harness ACP',
      launch,
      args:['acp'],
      cwd:this.workDir,
      env:sanitizeKimiEnv(this.env, this.connection.effort),
      onNotification:(method, params) => this.notification(method, params),
      onRequest:(method, params) => {
        if (method === 'session/request_permission') {
          if (params?.sessionId === this.sessionId) this.rpc.notify('session/cancel', { sessionId:this.sessionId })
          return { outcome:{ outcome:'selected', optionId:'reject' } }
        }
        throw new Error(`PenEcho Harness does not provide Kimi ACP request ${method}.`)
      },
    })
    this.rpc.start()
    await this.rpc.request('initialize', {
      protocolVersion:1,
      clientCapabilities:{ fs:{ readTextFile:false, writeTextFile:false } },
      clientInfo:{ name:'penecho-harness', version:'1' },
    })
    const created = await this.rpc.request('session/new', { cwd:this.workDir, mcpServers:[] })
    this.sessionId = String(created?.sessionId || '')
    if (!this.sessionId) throw new Error('Kimi ACP did not return a session id.')
    const model = configured(this.connection.cliModel)
    if (model) await this.rpc.request('session/set_config_option', { sessionId:this.sessionId, configId:'model', value:model })
    const effort = mapKimiEffort(this.connection.effort)
    if (effort) await this.rpc.request('session/set_config_option', { sessionId:this.sessionId, configId:'thinking', value:effort })
  }

  notification(method, params) {
    const active = this.active
    if (method === 'penecho/process-gone') {
      active?.fail(params?.error || new Error('Kimi ACP process closed.'))
      return
    }
    if (method !== 'session/update' || !active || String(params?.sessionId || '') !== this.sessionId) return
    const update = params?.update
    if (update?.sessionUpdate === 'agent_message_chunk' && typeof update.content?.text === 'string') {
      active.text += update.content.text
      if (Buffer.byteLength(active.text, 'utf8') > MAX_PROTOCOL_BYTES) active.fail(new Error('Kimi ACP response is too large.'))
      return
    }
    if (update?.sessionUpdate === 'tool_call' || update?.sessionUpdate === 'tool_call_update') {
      this.rpc.notify('session/cancel', { sessionId:this.sessionId })
      active.fail(new Error('Kimi Harness session attempted to use a disabled tool.'))
    }
  }

  async request({ prompt, atlasImage, signal }) {
    await this.start()
    if (signal?.aborted) throw abortError('Kimi')
    return new Promise((resolve, reject) => {
      const active = {
        text:'',
        settled:false,
        succeed:() => {
          if (active.settled) return
          active.settled = true
          cleanup()
          resolve({ output:active.text.trim(), usage:null, providerConversationId:this.sessionId })
        },
        fail:error => { if (!active.settled) { active.settled = true; cleanup(); reject(error) } },
      }
      const cleanup = () => {
        signal?.removeEventListener('abort', onAbort)
        if (this.active === active) this.active = null
      }
      const onAbort = () => {
        this.rpc.notify('session/cancel', { sessionId:this.sessionId })
        active.fail(abortError('Kimi'))
      }
      this.active = active
      signal?.addEventListener('abort', onAbort, { once:true })
      const text = this.prompted ? String(prompt || '') : `${this.systemPrompt}\n\n--- HARNESS REQUEST ---\n${String(prompt || '')}`
      const blocks = [...kimiImageBlocks(atlasImage), { type:'text', text }]
      this.rpc.request('session/prompt', { sessionId:this.sessionId, prompt:blocks }).then(() => {
        if (active.settled) return
        if (!active.text.trim()) active.fail(new Error('Kimi ACP returned no assistant response.'))
        else { this.prompted = true; active.succeed() }
      }, error => active.fail(error))
    })
  }

  async close() {
    if (this.closed) return
    this.closed = true
    if (this.active) {
      try { this.rpc?.notify('session/cancel', { sessionId:this.sessionId }) } catch {}
      this.active.fail(new Error('Kimi Harness session closed.'))
    }
    await this.rpc?.close().catch(() => {})
    if (this.workDir) await fs.promises.rm(this.workDir, { recursive:true, force:true, maxRetries:5, retryDelay:100 }).catch(error => this.logger?.({ type:'harness-cli-cleanup-error', provider:'kimi-cli', error:String(error?.message || error) }))
  }
}

function defaultTransportFactory(provider, options) {
  if (provider === 'codex-cli') return new CodexHarnessSession(options)
  if (provider === 'claude-cli') return new ClaudeHarnessSession(options)
  if (provider === 'kimi-cli') return new KimiHarnessSession(options)
  throw new Error(`Canvas Harness does not support persistent CLI provider ${provider}.`)
}

function connectionFingerprint(connection) {
  return hash(JSON.stringify({
    id:String(connection?.id || ''),
    provider:String(connection?.provider || ''),
    cliPath:String(connection?.cliPath || ''),
    cliModel:String(connection?.cliModel || ''),
    effort:String(connection?.effort || ''),
  }))
}

function replayMatches(replay, record, request) {
  return replay?.kind === HARNESS_REPLAY_KIND
    && replay.version === HARNESS_REPLAY_VERSION
    && replay.harnessSessionId === request.harnessSessionId
    && replay.connectionFingerprint === request.connectionFingerprint
    && replay.systemHash === request.systemHash
    && replay.surfaceMarker === request.surfaceMarker
    && replay.sessionNonce === record.sessionNonce
    && record.transport.alive
}

export class HarnessCliSessionManager {
  constructor({ env = process.env, logger = null, transportFactory = defaultTransportFactory } = {}) {
    this.env = env
    this.logger = logger
    this.transportFactory = transportFactory
    this.sessions = new Map()
    this.closed = false
  }

  key(harnessSessionId, connectionId) {
    return `${harnessSessionId}\u0000${connectionId}`
  }

  async request({ connection, harnessSessionId, systemPrompt, surfaceMarker = '', fullPrompt, deltaPrompt, atlasImage, fullRequest = null, deltaRequest = null, signal, replay = null, onUsage = null }) {
    if (this.closed) throw new Error('Canvas Harness CLI session manager is closed.')
    if (!harnessSessionId) throw new Error('Canvas Harness CLI request is missing its Harness session id.')
    signal?.throwIfAborted()
    const connectionId = String(connection?.id || ''), key = this.key(harnessSessionId, connectionId), request = {
      harnessSessionId:String(harnessSessionId),
      connectionFingerprint:connectionFingerprint(connection),
      systemHash:hash(systemPrompt),
      surfaceMarker:String(surfaceMarker || ''),
    }
    let record = this.sessions.get(key), continuing = Boolean(record && replayMatches(replay, record, request))
    if (record && !continuing) {
      this.sessions.delete(key)
      await record.transport.close().catch(() => {})
      record = null
    }
    if (!record) {
      const transport = this.transportFactory(connection.provider, { connection, systemPrompt, env:this.env, logger:this.logger })
      record = { ...request, connectionId, sessionNonce:randomUUID(), transport }
      this.sessions.set(key, record)
      continuing = false
    }
    try {
      const selected = continuing
        ? (typeof deltaRequest === 'function' ? await deltaRequest() : { prompt:deltaPrompt, atlasImage })
        : (typeof fullRequest === 'function' ? await fullRequest() : { prompt:fullPrompt, atlasImage })
      const result = await record.transport.request({ prompt:selected?.prompt, atlasImage:selected?.atlasImage, signal })
      try { if (result.usage) onUsage?.(result.usage) } catch {}
      return {
        output:result.output,
        replayState:{
          response:{
            kind:HARNESS_REPLAY_KIND,
            version:HARNESS_REPLAY_VERSION,
            harnessSessionId:request.harnessSessionId,
            connectionFingerprint:request.connectionFingerprint,
            systemHash:request.systemHash,
            surfaceMarker:request.surfaceMarker,
            sessionNonce:record.sessionNonce,
            provider:connection.provider,
            providerConversationId:result.providerConversationId || record.transport.conversationId || null,
          },
        },
      }
    } catch (error) {
      if (this.sessions.get(key) === record) this.sessions.delete(key)
      await record.transport.close().catch(() => {})
      throw error
    }
  }

  async disposeSession(harnessSessionId) {
    const selected = []
    for (const [key, record] of this.sessions) {
      if (record.harnessSessionId !== String(harnessSessionId)) continue
      this.sessions.delete(key)
      selected.push(record.transport.close())
    }
    await Promise.allSettled(selected)
  }

  async dispose() {
    if (this.closed) return
    this.closed = true
    const records = [...this.sessions.values()]
    this.sessions.clear()
    await Promise.allSettled(records.map(record => record.transport.close()))
  }
}

export function isHarnessCliReplay(value) {
  return value?.kind === HARNESS_REPLAY_KIND && value.version === HARNESS_REPLAY_VERSION
}

export const harnessCliSessionInternals = Object.freeze({
  codexHarnessAppServerArgs,
  HARNESS_REPLAY_KIND,
  HARNESS_REPLAY_VERSION,
})
