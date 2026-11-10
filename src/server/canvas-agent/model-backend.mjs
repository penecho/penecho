export function assertCanvasAgentModelBackend(backend) {
  if (!backend || typeof backend !== 'object') throw new Error('PenEcho Agent model backend is invalid.')
  for (const method of ['install', 'profile']) {
    if (typeof backend[method] !== 'function') throw new Error(`PenEcho Agent model backend requires ${method}().`)
  }
  return backend
}

export function canvasAgentPrincipalKey(principal) {
  if (principal === undefined || principal === null || principal === '') return ''
  if (typeof principal === 'string') {
    if (!principal || principal.length > 512 || /[\r\n\0]/.test(principal)) throw new Error('PenEcho Agent principal is invalid.')
    return principal
  }
  if (!principal || typeof principal !== 'object' || Array.isArray(principal)) throw new Error('PenEcho Agent principal is invalid.')
  const accountId=String(principal.accountId || ''),canvasId=String(principal.canvasId || '')
  if (!accountId || !canvasId || accountId.length > 128 || canvasId.length > 128 || /[\r\n\0]/.test(`${accountId}${canvasId}`)) throw new Error('PenEcho Agent principal is invalid.')
  return `${accountId}\0${canvasId}`
}
