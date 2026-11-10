import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createInactivityTimeout } = require('../activity-timeout.js')

export const DEFAULT_CANVAS_AGENT_IDLE_TIMEOUT_MS = 180_000

export function canvasAgentTimeoutLimits(value = DEFAULT_CANVAS_AGENT_IDLE_TIMEOUT_MS) {
  const configured = Number(value)
  const idleTimeoutMs = Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_CANVAS_AGENT_IDLE_TIMEOUT_MS
  return { idleTimeoutMs }
}

export function createCanvasAgentModelTimeout(controller, value, options = {}) {
  const limits = canvasAgentTimeoutLimits(value)
  const timeout = createInactivityTimeout(controller, limits.idleTimeoutMs, options)
  return { ...timeout, ...limits }
}

export function canvasAgentTimeoutSeconds(timeoutMs) {
  return Math.max(1, Math.ceil(Number(timeoutMs) / 1000))
}
