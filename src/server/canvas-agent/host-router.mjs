
import {
  canvasAgentConversationBacklog,
  canvasAgentConversationContinuity,
  canvasAgentConversationEntries,
} from './conversation-continuity.mjs'

export class CanvasAgentHostRouter {
  constructor({ resolveConnection, prepareConnection = async () => {}, harnessFactory, nativeFactory }) {
    if (typeof resolveConnection !== 'function') throw new Error('PenEcho Agent host router requires a connection resolver.')
    if (typeof harnessFactory !== 'function' || typeof nativeFactory !== 'function') throw new Error('PenEcho Agent host router requires lazy host factories.')
    this.prepareConnection = prepareConnection
    this.resolveConnection = resolveConnection
    this.harnessFactory = harnessFactory
    this.nativeFactory = nativeFactory
    this.ownerPromises = { harness:null, 'codex-native':null }
    this.owners = new Set()
  }

  engineForConnection(connection) {
    return connection?.provider === 'codex-cli' ? 'codex-native' : 'harness'
  }

  ownerForConnection(connection) {
    return this.engineForConnection(connection) === 'codex-native' ? 'native' : 'harness'
  }

  async owner(engine) {
    if (!this.ownerPromises[engine]) {
      if (engine !== 'codex-native' && engine !== 'harness') throw new Error(`PenEcho Agent engine ${engine} is invalid.`)
      const factory = engine === 'codex-native' ? this.nativeFactory : this.harnessFactory
      this.ownerPromises[engine] = Promise.resolve(factory()).then(async owner => {
        if (!owner) throw new Error(`PenEcho Agent ${engine} host is unavailable.`)
        if (owner.initialize) await owner.initialize()
        this.owners.add(owner)
        return owner
      })
      this.ownerPromises[engine].catch(() => { this.ownerPromises[engine] = null })
    }
    return this.ownerPromises[engine]
  }

  ownerForSession(session) {
    if (session?.engine === 'codex-native' && this.owners.has(session.engineOwner)) return session.engineOwner
    if (session?.engine === 'harness' && this.owners.has(session.engineOwner)) return session.engineOwner
    throw new Error('PenEcho Agent session owner is invalid.')
  }

  async initialize() { return this }

  wrappedSend(request, engine) {
    const send = request?.send
    if (typeof send !== 'function') return undefined
    return (type, payload, identity) => send(type, type === 'ready' ? { ...payload, engine } : payload, identity)
  }

  conversationEntries(source) {
    return canvasAgentConversationEntries(source)
  }

  conversationBacklog(source) {
    return canvasAgentConversationBacklog(source)
  }

  withConversationHistory(request = {}) {
    const suppliedBacklog=Array.isArray(request.initialBacklog),initialBacklog=suppliedBacklog
      ? request.initialBacklog.slice()
      : this.conversationBacklog(request.conversationHistory)
    const continuity=String(request.continuity || this.conversationContinuity(initialBacklog))
    return { ...request, initialBacklog, continuity }
  }

  async connect(request) {
    request=this.withConversationHistory(request)
    const connectionId = String(request?.connectionId || 'default')
    await this.prepareConnection(connectionId)
    const connection = this.resolveConnection(connectionId)
    if (!connection) throw Object.assign(new Error('The selected AI connection was not found. Refresh AI connections.'), { code:'CONNECTION_STALE', status:409 })
    const engine = this.engineForConnection(connection)
    const owner = await this.owner(engine)
    const session = await owner.connect({ ...request, connectionId, send:this.wrappedSend(request, engine) })
    session.engine = engine
    session.engineOwner = owner
    return session
  }

  async replaceSession(previous, request) {
    const originalOwner = previous ? this.ownerForSession(previous) : null
    const connectionId = String(request?.connectionId || previous?.connectionId || 'default')
    await this.prepareConnection(connectionId)
    const connection = this.resolveConnection(connectionId)
    if (!connection) throw Object.assign(new Error('The selected AI connection was not found. Refresh AI connections.'), { code:'CONNECTION_STALE', status:409 })
    const replacement = await this.connect({ ...request, connectionId })
    if (originalOwner) await originalOwner.disposeSession(previous).catch(() => {})
    return replacement
  }

  async changeContext(previous, request) {
    if (!previous) throw new Error('PenEcho Agent session is not established.')
    const originalOwner = this.ownerForSession(previous)
    const connectionId = String(request?.connectionId || previous.connectionId || 'default')
    await this.prepareConnection(connectionId)
    const connection = this.resolveConnection(connectionId)
    if (!connection) throw Object.assign(new Error('The selected AI connection was not found. Refresh AI connections.'), { code:'CONNECTION_STALE', status:409 })
    const initialBacklog = Array.isArray(previous.backlog) ? previous.backlog.slice() : []
    const continuity = this.conversationContinuity(initialBacklog)
    const conversationId = String(request?.conversationId || previous.logicalConversationId || '')
    const replacement = await this.connect({ ...request, connectionId, conversationId, initialBacklog, continuity })
    await originalOwner.disposeSession(previous).catch(() => {})
    return replacement
  }

  async changeConnection(previous, request) {
    if (!previous) throw new Error('PenEcho Agent session is not established.')
    const originalOwner = this.ownerForSession(previous)
    const connectionId = String(request?.connectionId || previous.connectionId || 'default')
    await this.prepareConnection(connectionId)
    const connection = this.resolveConnection(connectionId)
    if (!connection) throw Object.assign(new Error('The selected AI connection was not found. Refresh AI connections.'), { code:'CONNECTION_STALE', status:409 })
    const engine = this.engineForConnection(connection)
    const send = this.wrappedSend(request, engine)
    if (engine === previous.engine) {
      await originalOwner.setConnection(previous, { connectionId, binding:request?.binding, send })
      return previous
    }
    const initialBacklog = Array.isArray(previous.backlog) ? previous.backlog.slice() : []
    const continuity = this.conversationContinuity(initialBacklog)
    const conversationId = String(request?.conversationId || previous.logicalConversationId || '')
    const replacement = await this.connect({ ...request, connectionId, conversationId, send:request?.send, initialBacklog, continuity })
    await originalOwner.disposeSession(previous).catch(() => {})
    return replacement
  }

  conversationContinuity(backlog) {
    return canvasAgentConversationContinuity(backlog)
  }

  activeProjectIds() {
    return [...new Set([...this.owners].flatMap(owner => owner.activeProjectIds()))]
  }

  updateState(session, digest) { return this.ownerForSession(session).updateState(session, digest) }
  setWebSearchEnabled(session, enabled) { return this.ownerForSession(session).setWebSearchEnabled(session, enabled) }
  submit(session, ...arguments_) { return this.ownerForSession(session).submit(session, ...arguments_) }
  cancel(session) { return this.ownerForSession(session).cancel(session) }
  resolveToolResult(session, payload) { return this.ownerForSession(session).resolveToolResult(session, payload) }
  disconnect(session, binding) { return this.ownerForSession(session).disconnect(session, binding) }
  disposeSession(session) { return this.ownerForSession(session).disposeSession(session) }

  async dispose() {
    const owners = [...this.owners]
    this.owners.clear()
    this.ownerPromises = { harness:null, 'codex-native':null }
    await Promise.allSettled(owners.map(owner => owner.dispose()))
  }
}
