export const CANVAS_AGENT_PROTOCOL_VERSION = 1
export const CANVAS_AGENT_SOCKET_PATH = '/api/canvas-agent/socket'

const CLIENT_MESSAGE_TYPES = new Set([
  'hello',
  'state_sync',
  'user_turn',
  'steer',
  'cancel',
  'tool_result',
  'change_connection',
  'change_context',
  'new_conversation',
  'ping',
])

export function parseClientEnvelope(raw) {
  let value
  try {
    value = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8'))
  } catch {
    throw new Error('PenEcho Agent messages must be valid JSON.')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('PenEcho Agent message envelope is invalid.')
  }
  if (value.version !== CANVAS_AGENT_PROTOCOL_VERSION || !CLIENT_MESSAGE_TYPES.has(value.type)) {
    throw new Error('PenEcho Agent protocol version or message type is unsupported.')
  }
  if (!Number.isSafeInteger(value.seq) || value.seq < 1 || value.seq > Number.MAX_SAFE_INTEGER) {
    throw new Error('PenEcho Agent message sequence is invalid.')
  }
  if (value.canvasSessionId !== undefined && (typeof value.canvasSessionId !== 'string' || value.canvasSessionId.length > 256 || /[\r\n\0]/.test(value.canvasSessionId))) {
    throw new Error('PenEcho Agent session id is invalid.')
  }
  if (value.clientId !== undefined && (typeof value.clientId !== 'string' || value.clientId.length > 256 || /[\r\n\0]/.test(value.clientId))) {
    throw new Error('PenEcho Agent client id is invalid.')
  }
  if (value.payload !== undefined && (!value.payload || typeof value.payload !== 'object' || Array.isArray(value.payload))) {
    throw new Error('PenEcho Agent message payload is invalid.')
  }
  return value
}

export function hostEnvelope(type, session, payload = {}) {
  session.outgoingSeq += 1
  return {
    version: CANVAS_AGENT_PROTOCOL_VERSION,
    type,
    canvasSessionId: session.id,
    clientId: session.clientId,
    seq: session.outgoingSeq,
    payload,
  }
}
