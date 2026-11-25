import { createRequire } from 'node:module'
import { canvasAgentTimeoutLimits } from '../canvas-agent/model-timeout.mjs'
import { hash } from './text.mjs'

// How one AI connection (the person's own API key, or a PenEcho Cloud model) is described to the dsh loop:
// its provider entry, the reasoning levels it takes and the level a request asks for.
// The Canvas engine and the PenEcho runner for Lines both read it from here.
const require = createRequire(import.meta.url)
const additionalApiPresets = require('../../providers/api-presets.js')
const { presetRequestHeaders } = require('../../providers/preset-discovery.js')
const { DEFAULT_REASONING_EFFORT, reasoningEffortMapping, isGlm53Model, modelSupportsReasoningEffort } = require('../../providers/reasoning-effort.js')

export const CANVAS_AGENT_CONTEXT_WINDOW = 160_000
export const CANVAS_AGENT_COMPACTION_THRESHOLD_RATIO = 100_000 / CANVAS_AGENT_CONTEXT_WINDOW
export const CANVAS_AGENT_REQUEST_IMAGE_MAX_PIXELS = 2048 * 2048

export function providerBaseURL(connection) {
  const url = new URL(String(connection.apiUrl || ''))
  const path = url.pathname.replace(/\/+$/, '')
  const suffix = connection.apiFormat === 'anthropic' ? '/v1/messages' : '/chat/completions'
  if (path.toLowerCase().endsWith(suffix)) url.pathname = path.slice(0, -suffix.length) || '/'
  url.hash = ''
  return url.href.replace(/\/$/, '')
}

export const CANVAS_HARNESS_REASONING_LEVELS = Object.freeze([
  ['off', 'none'],
  ['minimal', 'minimal'],
  ['low', 'low'],
  ['medium', 'medium'],
  ['high', 'high'],
  ['xhigh', 'xhigh'],
  ['max', 'max'],
])
export const CANVAS_AGENT_HARNESS_REASONING_EFFORTS = new Set(CANVAS_HARNESS_REASONING_LEVELS.map(([, effort]) => effort))
const CANVAS_AGENT_REQUEST_REASONING_EFFORT_MAX_LENGTH = 128

export function resolveCanvasAgentRequestEffort(connection, value = 'config') {
  if (typeof value !== 'string') throw new Error('PenEcho Agent reasoning effort is invalid.')
  const selected = value.trim().toLowerCase()
  if (!selected || selected.length > CANVAS_AGENT_REQUEST_REASONING_EFFORT_MAX_LENGTH || /[\r\n\0]/.test(selected)) throw new Error('PenEcho Agent reasoning effort is invalid.')
  const configuredEffort = String(connection?.effort || '').trim()
  return {
    selected,
    effective:selected === 'config'
      ? (configuredEffort && configuredEffort !== 'config' && configuredEffort !== 'default' ? configuredEffort : null)
      : selected,
  }
}

function isKimiCodingPlanOpenAiApi(connection) {
  if (String(connection.apiFormat || '').trim().toLowerCase() !== 'openai') return false
  try {
    const url = new URL(String(connection.apiUrl || '')),
      path = url.pathname.replace(/\/+$/, '').toLowerCase()
    return url.hostname.toLowerCase() === 'api.kimi.com'
      && (path === '/coding/v1' || path === '/coding/v1/chat/completions')
  } catch {
    return false
  }
}

export function apiHarnessReasoning(connection) {
  const model = String(connection.apiModel || '').trim()
  if (connection.supportsThinking === false || !modelSupportsReasoningEffort(model)) return { reasoningEffort:undefined, reasoningEfforts:false }
  const mappings = Object.fromEntries(CANVAS_HARNESS_REASONING_LEVELS.map(([level, effort]) => [level, reasoningEffortMapping({
    provider:'api',
    apiFormat:connection.apiFormat,
    apiPreset:connection.apiPreset,
    apiUrl:connection.apiUrl,
    model,
    effort,
  })]))
  const requestedEffort = String(connection.effort || '').trim() || DEFAULT_REASONING_EFFORT,
    requestedLevel = CANVAS_HARNESS_REASONING_LEVELS.find(([, effort]) => effort === requestedEffort)?.[0] || null,
    selectedMapping = reasoningEffortMapping({
      provider:'api',
      apiFormat:connection.apiFormat,
      apiPreset:connection.apiPreset,
      apiUrl:connection.apiUrl,
      model,
      effort:requestedEffort,
    })
  const reasoningEffort = requestedLevel === 'off'
    ? (selectedMapping.canDisable ? 'off' : 'low')
    : requestedLevel || 'medium'
  const reasoningEfforts = {}
  if (mappings.off.canDisable) reasoningEfforts.off = connection.apiFormat === 'anthropic' ? 'disabled' : (mappings.off.mode === 'reasoning_effort' ? mappings.off.value : null)
  for (const [level] of CANVAS_HARNESS_REASONING_LEVELS.slice(1)) reasoningEfforts[level] = mappings[level].value || level
  if (!requestedLevel) reasoningEfforts[reasoningEffort] = selectedMapping.value || requestedEffort

  let compat
  if (connection.apiFormat === 'anthropic') {
    if (mappings.medium.adaptiveThinking) compat = { forceAdaptiveThinking:true }
  } else if (mappings.medium.mode === 'reasoning_effort') {
    compat = { supportsReasoningEffort:true }
  } else {
    compat = { thinkingFormat:'deepseek', supportsReasoningEffort:false }
  }
  if (isKimiCodingPlanOpenAiApi(connection)) compat = { ...compat, supportsDeveloperRole:false }
  // The installed OpenAI-compatible adapter otherwise defaults DeepSeek to
  // max_completion_tokens, which is not its documented output-limit field.
  if (connection.apiFormat !== 'anthropic') {
    let hostname = ''
    try { hostname = new URL(connection.apiUrl).hostname.toLowerCase().replace(/\.$/, '') } catch {}
    if (hostname === 'api.deepseek.com' || isGlm53Model(model)) compat = { ...compat, maxTokensField:'max_tokens' }
  }
  return { reasoningEffort, reasoningEfforts, ...(compat ? { compat } : {}) }
}

export function harnessRequestReasoningEffort(connection, requestEffort) {
  if (connection.provider === 'api' && (connection.supportsThinking === false || !modelSupportsReasoningEffort(connection.apiModel))) return undefined
  if (requestEffort.selected === 'config') {
    return connection.provider === 'api' ? apiHarnessReasoning(connection).reasoningEffort : undefined
  }
  if (connection.provider === 'api') return apiHarnessReasoning({ ...connection, effort:requestEffort.effective }).reasoningEffort
  return requestEffort.effective === 'none' ? 'off' : requestEffort.effective
}

export function connectionProfile(connection, configuredTimeoutMs) {
  const digest = hash(connection.id).slice(0, 12)
  const provider = `penecho-${digest}`
  const apiKeyEnv = `PENECHO_AI_CONNECTION_${digest.toUpperCase()}`
  const model = String(connection.apiModel || '').trim()
  const reasoning = apiHarnessReasoning(connection)
  const { idleTimeoutMs } = canvasAgentTimeoutLimits(configuredTimeoutMs)
  return {
    provider,
    apiKeyEnv,
    reasoningEffort:reasoning.reasoningEffort,
    config:{
      displayName:connection.name || `PenEcho ${model}`,
      api:connection.apiFormat === 'anthropic' ? 'anthropic-messages' : 'openai-completions',
      baseURL:providerBaseURL(connection),
      ...(additionalApiPresets.isOpenCode(connection.apiPreset) ? { headers:presetRequestHeaders(connection, connection.apiSessionId) } : {}),
      ...(connection.hosted === true ? {
        headers:{ 'x-penecho-request-kind':'agent', ...(connection.apiFormat === 'anthropic' && connection.apiKey ? { Authorization:`Bearer ${connection.apiKey}` } : {}) },
        // An inactivity deadline ends this request. Repeating it five times
        // hides the failure for 18 minutes; keep transient-error recovery only.
        retryPolicy:{mode:'normal',maxRetries:5,retryableCodes:['EMPTY_RESPONSE','RATE_LIMIT','SERVER','TRANSPORT']},
      } : {}),
      streamIdleTimeoutMs:idleTimeoutMs,
      defaultInput:['text', 'image'],
      defaultContextWindow:CANVAS_AGENT_CONTEXT_WINDOW,
      requestImagePixelBudget:CANVAS_AGENT_REQUEST_IMAGE_MAX_PIXELS,
      models:[{
        id:model,
        name:model,
        contextWindow:CANVAS_AGENT_CONTEXT_WINDOW,
        maxTokens:64_000,
        input:['text', 'image'],
        reasoningEfforts:reasoning.reasoningEfforts,
        ...(reasoning.compat ? { compat:reasoning.compat } : {}),
      }],
    },
  }
}
