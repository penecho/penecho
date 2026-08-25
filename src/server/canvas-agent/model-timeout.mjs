import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createIdleAndTotalTimeout } = require('../activity-timeout.js')

export const DEFAULT_CANVAS_AGENT_IDLE_TIMEOUT_MS = 180_000
export const MAX_CANVAS_AGENT_TOTAL_TIMEOUT_MS = 600_000
export const CANVAS_AGENT_TOTAL_TIMEOUT_MULTIPLIER = 3

export function canvasAgentTimeoutLimits(value = DEFAULT_CANVAS_AGENT_IDLE_TIMEOUT_MS) {
  const configured = Number(value)
  const idleTimeoutMs = Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_CANVAS_AGENT_IDLE_TIMEOUT_MS
  const totalTimeoutMs = Math.max(
    idleTimeoutMs,
    Math.min(MAX_CANVAS_AGENT_TOTAL_TIMEOUT_MS, idleTimeoutMs * CANVAS_AGENT_TOTAL_TIMEOUT_MULTIPLIER),
  )
  return { idleTimeoutMs, totalTimeoutMs }
}

export function createCanvasAgentModelTimeout(controller, value, options = {}) {
  const limits = canvasAgentTimeoutLimits(value)
  const timeout = createIdleAndTotalTimeout(
    controller,
    limits.idleTimeoutMs,
    limits.totalTimeoutMs,
    options,
  )
  return { ...timeout, ...limits }
}

export function canvasAgentTimeoutSeconds(timeoutMs) {
  return Math.max(1, Math.ceil(Number(timeoutMs) / 1000))
}
