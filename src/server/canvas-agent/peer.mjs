import { parseClientEnvelope } from './protocol.mjs'

export const CANVAS_AGENT_MAX_FRAME_BYTES = 48 * 1024 * 1024

/**
 * Transport-neutral PenEcho Canvas Agent protocol peer.
 *
 * Authentication stays at the transport boundary. `principal` is an opaque,
 * immutable server-authenticated scope forwarded to the runtime so a resume
 * token cannot move a session between accounts or canvases.
 */
export function createCanvasAgentPeer({
  runtime,
  principal = null,
  sendFrame,
  closeTransport = () => {},
  onDisconnect = () => {},
}) {
  if (typeof runtime !== 'function') throw new Error('PenEcho Agent peer requires a runtime resolver.')
  if (typeof sendFrame !== 'function') throw new Error('PenEcho Agent peer requires a frame sender.')
  const binding = {}
  const state = { session:null, sessionGeneration:0, incomingSeq:0, outgoingSeq:0, pendingHandshakeId:'', closed:false, receiveQueue:Promise.resolve() }
  const sendForGeneration = generation => {
    if (!Number.isSafeInteger(generation)) throw new Error('PenEcho Agent session generation is invalid.')
    return (type, payload, identity = state.session) => {
      if (state.closed || generation !== state.sessionGeneration) return
      state.outgoingSeq += 1
      sendFrame(JSON.stringify({
        version:1,
        type,
        canvasSessionId:identity?.id || '',
        clientId:identity?.clientId || '',
        seq:state.outgoingSeq,
        payload,
      }))
    }
  }
  const send = (type, payload, identity = state.session) => sendForGeneration(state.sessionGeneration)(type, payload, identity)
  const normalizedHandshakeId = value => String(value || '').slice(0, 256)
  const sendForHandshake = (generation, handshakeId) => {
    const generationSend=sendForGeneration(generation),expected=normalizedHandshakeId(handshakeId)
    return (type,payload,identity)=>generationSend(type,['ready','error'].includes(type)?{...payload,handshakeId:expected}:payload,identity)
  }
  const fail = (error, fatal = false) => {
    send('error', { message:String(error?.message || error || 'PenEcho Agent failed.'), fatal, ...(error?.code ? {code:String(error.code)} : {}), ...(Number.isInteger(error?.status) ? {status:error.status} : {}), ...(state.pendingHandshakeId?{handshakeId:state.pendingHandshakeId}:{}) })
    if (fatal) closeTransport(1008, 'PenEcho Agent protocol error')
  }
  const processFrame = async raw => {
    if (state.closed) return
    try {
      if (Buffer.byteLength(raw) > CANVAS_AGENT_MAX_FRAME_BYTES) throw new Error('PenEcho Agent message is too large.')
      const envelope = parseClientEnvelope(raw)
      if (envelope.seq <= state.incomingSeq) throw new Error('PenEcho Agent message sequence must increase.')
      state.incomingSeq = envelope.seq
      const owner = await runtime()
      if (envelope.type === 'hello') {
        if (state.session) throw new Error('PenEcho Agent hello was already accepted.')
        const generation = ++state.sessionGeneration, handshakeId=normalizedHandshakeId(envelope.payload?.handshakeId)
        state.pendingHandshakeId=handshakeId
        const generationSend = sendForHandshake(generation,handshakeId)
        const session = await owner.connect({
          canvasSessionId:envelope.canvasSessionId || envelope.payload?.canvasSessionId || '',
          resumeToken:String(envelope.payload?.resumeToken || ''),
          clientId:String(envelope.clientId || envelope.payload?.clientId || ''),
          connectionId:String(envelope.payload?.connectionId || 'default'),
          webSearchEnabled:envelope.payload?.webSearchEnabled === true,
          widgetCapabilities:envelope.payload?.widgetCapabilities,
          projectId:String(envelope.payload?.projectId || ''),
          accessMode:String(envelope.payload?.accessMode || 'controlled'),
          conversationId:String(envelope.payload?.conversationId || ''),
          conversationHistory:envelope.payload?.conversationHistory,
          principal,
          binding,
          send:generationSend,
        })
        if (generation !== state.sessionGeneration) {
          await owner.disposeSession(session).catch(() => {})
          throw new Error('PenEcho Agent session replacement is no longer current.')
        }
        state.session = session
        if(state.pendingHandshakeId===handshakeId)state.pendingHandshakeId=''
        return
      }
      if (state.session?.binding !== binding) throw new Error('PenEcho Agent session moved to another connection.')
      if (!state.session) throw new Error('PenEcho Agent session is not established.')
      if (envelope.type === 'new_conversation') {
        const previous = state.session, connectionId = String(envelope.payload?.connectionId || previous.connectionId), handshakeId=normalizedHandshakeId(envelope.payload?.handshakeId)
        const generation = ++state.sessionGeneration
        state.session = null
        state.pendingHandshakeId=handshakeId
        const generationSend = sendForHandshake(generation,handshakeId)
        let replacement
        try {
          replacement = await owner.replaceSession(previous, {
            clientId:previous.clientId,
            connectionId,
            webSearchEnabled:envelope.payload?.webSearchEnabled === true,
            widgetCapabilities:envelope.payload?.widgetCapabilities,
            projectId:String(envelope.payload?.projectId || ''),
            accessMode:String(envelope.payload?.accessMode || 'controlled'),
            conversationId:String(envelope.payload?.conversationId || ''),
            conversationHistory:envelope.payload?.conversationHistory,
            principal,
            binding,
            send:generationSend,
          })
        } catch (error) {
          if(generation===state.sessionGeneration){state.sessionGeneration--;state.session=previous}
          state.pendingHandshakeId=handshakeId
          fail(error,false)
          if(state.pendingHandshakeId===handshakeId)state.pendingHandshakeId=''
          return
        }
        if (generation !== state.sessionGeneration) {
          await owner.disposeSession(replacement).catch(() => {})
          throw new Error('PenEcho Agent session replacement is no longer current.')
        }
        state.session = replacement
        if(state.pendingHandshakeId===handshakeId)state.pendingHandshakeId=''
        return
      }
      if (envelope.type === 'change_context' || envelope.type === 'change_connection') {
        const previous = state.session, connectionId = String(envelope.payload?.connectionId || previous.connectionId), handshakeId=normalizedHandshakeId(envelope.payload?.handshakeId)
        const generation = ++state.sessionGeneration
        state.pendingHandshakeId=handshakeId
        const generationSend = sendForHandshake(generation,handshakeId)
        let changed
        try {
          const method = envelope.type === 'change_context' ? 'changeContext' : 'changeConnection'
          changed = await owner[method](previous, {
            clientId:previous.clientId,
            connectionId,
            webSearchEnabled:envelope.payload?.webSearchEnabled === true,
            widgetCapabilities:envelope.payload?.widgetCapabilities,
            projectId:String(envelope.payload?.projectId || ''),
            accessMode:String(envelope.payload?.accessMode || 'controlled'),
            conversationId:String(envelope.payload?.conversationId || ''),
            principal,
            binding,
            send:generationSend,
          })
        } catch (error) {
          if(generation===state.sessionGeneration)state.sessionGeneration--
          state.pendingHandshakeId=handshakeId
          fail(error,false)
          if(state.pendingHandshakeId===handshakeId)state.pendingHandshakeId=''
          return
        }
        if (generation !== state.sessionGeneration) {
          if (changed !== previous) await owner.disposeSession(changed).catch(() => {})
          throw new Error('PenEcho Agent context change is no longer current.')
        }
        state.session = changed
        if(state.pendingHandshakeId===handshakeId)state.pendingHandshakeId=''
        return
      }
      if (!envelope.canvasSessionId || envelope.canvasSessionId !== state.session.id) return
      if (envelope.type === 'state_sync') owner.updateState(state.session, envelope.payload?.digest)
      else if (envelope.type === 'user_turn' || envelope.type === 'steer') {
        const generation = state.sessionGeneration, session = state.session
        try {
          owner.setWebSearchEnabled(session, envelope.payload?.webSearchEnabled === true)
        } catch (error) {
          sendForGeneration(generation)('error', { message:String(error?.message || error || 'PenEcho Agent failed.'), fatal:false }, session)
          return
        }
        void owner.submit(session, envelope.payload?.text, envelope.type === 'steer', envelope.payload?.images, envelope.payload?.references, envelope.payload?.initialState, envelope.payload?.fileIds, envelope.payload?.canvasTitleNeeded === true, envelope.payload?.reasoningEffort).catch(error => {
          sendForGeneration(generation)('error', { message:String(error?.message || error || 'PenEcho Agent failed.'), fatal:false }, session)
        })
      }
      else if (envelope.type === 'cancel') await owner.cancel(state.session)
      else if (envelope.type === 'tool_result') owner.resolveToolResult(state.session, envelope.payload)
      else if (envelope.type === 'ping') send('pong', { time:Date.now() })
    } catch (error) {
      fail(error, !state.session)
    }
  }
  const receive = raw => {
    const pending = state.receiveQueue.then(() => processFrame(raw))
    state.receiveQueue = pending.catch(() => {})
    return pending
  }
  const disconnect = async () => {
    if (state.closed) return
    state.closed = true
    try {
      await state.receiveQueue.catch(() => {})
      const session = state.session
      state.session = null
      state.sessionGeneration += 1
      if (session) await runtime().then(owner => owner.disconnect(session, binding)).catch(() => {})
    } finally {
      onDisconnect(peer)
    }
  }
  const peer = Object.freeze({ receive, disconnect })
  return peer
}
