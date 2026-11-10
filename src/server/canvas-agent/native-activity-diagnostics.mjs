import { createHash } from 'node:crypto'

const MAX_METHODS = 32
const MAX_EVENTS = 64
const NOTIFICATION_CATEGORIES = new Set(['recognized', 'ignored', 'mismatched'])
const PHASES = new Set([
  'preparing-turn',
  'awaiting-model-events',
  'awaiting-raw-boundary',
  'awaiting-tool-request',
  'awaiting-tool-admission',
  'tool-queued',
  'tool-executing',
  'tool-result-ready',
  'tool-reply-written',
  'turn-ending',
])
const TOOL_STAGES = new Set(['received', 'queued', 'executing', 'result-ready', 'reply-written'])
const SAFE_METHODS = new Set([
  'error',
  'thread/closed',
  'thread/tokenUsage/updated',
  'thread/compacted',
  'turn/started',
  'turn/completed',
  'rawResponseItem/completed',
  'rawResponse/completed',
  'item/started',
  'item/completed',
  'item/agentMessage/delta',
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
  'startup/install',
  'tool/request',
  'public/user_message',
  'public/turn_start',
  'public/token_usage',
  'public/compaction',
  'public/assistant_delta',
  'public/assistant_message',
  'public/tool_call',
  'public/tool_result',
  'public/turn_end',
])

function byteLength(value) {
  try { return Buffer.byteLength(String(value ?? ''), 'utf8') } catch { return 0 }
}

function safeInteger(value) {
  try {
    const number = Number(value)
    return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0
  } catch { return 0 }
}

function safeIso(value) {
  try { return new Date(value).toISOString() } catch { return null }
}

function incrementBounded(map, key, limit) {
  if (map.has(key)) map.set(key, map.get(key) + 1)
  else if (map.size < limit) map.set(key, 1)
  else map.set('overflow', (map.get('overflow') || 0) + 1)
}

function countsObject(map) {
  return Object.fromEntries([...map.entries()].sort(([left], [right]) => left.localeCompare(right)))
}

export function safeNativeActivityMethod(method) {
  try {
    const value = String(method || '')
    if (SAFE_METHODS.has(value)) return value
    const digest = createHash('sha256').update(value).digest('hex').slice(0, 12)
    return `other:${digest}`
  } catch { return 'other:invalid' }
}

export class NativeActivityDiagnostics {
  constructor({ now = Date.now, monotonicNow = () => performance.now(), maxMethods = MAX_METHODS, maxEvents = MAX_EVENTS } = {}) {
    this.now = typeof now === 'function' ? now : Date.now
    this.monotonicNow = typeof monotonicNow === 'function' ? monotonicNow : () => performance.now()
    this.maxMethods = Math.min(MAX_METHODS, Math.max(1, safeInteger(maxMethods) || MAX_METHODS))
    this.maxEvents = Math.min(MAX_EVENTS, Math.max(1, safeInteger(maxEvents) || MAX_EVENTS))
    this.process = {
      stdoutBytes:0, stdoutChunks:0, jsonLines:0, rawBufferBytes:0,
      stderrBytes:0, stderrChunks:0,
      replyWrites:0, replyCallbacks:0, replyCallbackErrors:0,
      lastStdoutUtc:null, lastStdoutMonotonic:null,
      lastJsonLineUtc:null, lastJsonLineMonotonic:null,
      lastStderrUtc:null, lastStderrMonotonic:null,
      lastReplyWriteUtc:null, lastReplyWriteMonotonic:null,
      lastReplyCallbackUtc:null, lastReplyCallbackMonotonic:null,
      processExit:null,
    }
  }

  timestamp() {
    let utcMs = NaN, monotonicMs = NaN
    try { utcMs = Number(this.now()) } catch {}
    try { monotonicMs = Number(this.monotonicNow()) } catch {}
    return {
      utc:safeIso(utcMs),
      monotonicMs:Number.isFinite(monotonicMs) ? Math.round(monotonicMs * 1000) / 1000 : null,
    }
  }

  recordStdoutChunk(chunk) {
    const stamp = this.timestamp()
    this.process.stdoutBytes += byteLength(chunk)
    this.process.stdoutChunks += 1
    this.process.lastStdoutUtc = stamp.utc
    this.process.lastStdoutMonotonic = stamp.monotonicMs
  }

  recordJsonLine() {
    const stamp = this.timestamp()
    this.process.jsonLines += 1
    this.process.lastJsonLineUtc = stamp.utc
    this.process.lastJsonLineMonotonic = stamp.monotonicMs
  }

  setRawBufferBytes(value) {
    this.process.rawBufferBytes = safeInteger(value)
  }

  recordStderrChunk(chunk) {
    const stamp = this.timestamp()
    this.process.stderrBytes += byteLength(chunk)
    this.process.stderrChunks += 1
    this.process.lastStderrUtc = stamp.utc
    this.process.lastStderrMonotonic = stamp.monotonicMs
  }

  recordJsonRpcReply({ callback = false, error = false } = {}) {
    const stamp = this.timestamp()
    if (callback) {
      this.process.replyCallbacks += 1
      if (error) this.process.replyCallbackErrors += 1
      this.process.lastReplyCallbackUtc = stamp.utc
      this.process.lastReplyCallbackMonotonic = stamp.monotonicMs
    } else {
      this.process.replyWrites += 1
      this.process.lastReplyWriteUtc = stamp.utc
      this.process.lastReplyWriteMonotonic = stamp.monotonicMs
    }
  }

  recordProcessExit(code, signal) {
    const stamp = this.timestamp()
    this.process.processExit = {
      code:Number.isInteger(code) ? code : null,
      signal:typeof signal === 'string' && /^[A-Z0-9]{1,16}$/.test(signal) ? signal : null,
      utc:stamp.utc,
      monotonicMs:stamp.monotonicMs,
    }
  }

  beginTurn({ turnNumber = null } = {}) {
    return new NativeTurnActivityDiagnostics(this, { turnNumber })
  }
}

export class NativeTurnActivityDiagnostics {
  constructor(owner, { turnNumber = null } = {}) {
    this.owner = owner
    this.turnNumber = Number.isSafeInteger(turnNumber) ? turnNumber : null
    this.started = owner.timestamp()
    this.baseline = { ...owner.process, processExit:owner.process.processExit }
    this.notifications = { recognized:new Map(), ignored:new Map(), mismatched:new Map() }
    this.activityCounts = new Map()
    this.toolStages = new Map()
    this.events = []
    this.phaseName = 'preparing-turn'
    this.lastNotification = null
    this.lastActivity = null
    this.closed = false
  }

  event(kind, label, stamp = null) {
    if (this.closed) return
    const observed = stamp || this.owner.timestamp()
    this.events.push({ kind, label, utc:observed.utc, monotonicMs:observed.monotonicMs })
    if (this.events.length > this.owner.maxEvents) this.events.splice(0, this.events.length - this.owner.maxEvents)
  }

  notification(category, method) {
    if (this.closed) return
    const safeCategory = NOTIFICATION_CATEGORIES.has(category) ? category : 'ignored'
    const safeMethod = safeNativeActivityMethod(method)
    incrementBounded(this.notifications[safeCategory], safeMethod, this.owner.maxMethods)
    const stamp = this.owner.timestamp()
    this.lastNotification = { category:safeCategory, method:safeMethod, utc:stamp.utc, monotonicMs:stamp.monotonicMs }
    this.event('notification', `${safeCategory}:${safeMethod}`, stamp)
  }

  activity(source) {
    if (this.closed) return
    const safeSource = safeNativeActivityMethod(source)
    incrementBounded(this.activityCounts, safeSource, this.owner.maxMethods)
    const stamp = this.owner.timestamp()
    this.lastActivity = { source:safeSource, utc:stamp.utc, monotonicMs:stamp.monotonicMs }
    this.event('activity', safeSource, stamp)
  }

  phase(name) {
    if (this.closed) return
    this.phaseName = PHASES.has(name) ? name : 'awaiting-model-events'
    this.event('phase', this.phaseName)
  }

  tool(stage) {
    if (this.closed) return
    const safeStage = TOOL_STAGES.has(stage) ? stage : null
    if (!safeStage) return
    incrementBounded(this.toolStages, safeStage, TOOL_STAGES.size)
    this.event('tool', safeStage)
  }

  processDelta(field) {
    return Math.max(0, safeInteger(this.owner.process[field]) - safeInteger(this.baseline[field]))
  }

  summary(reason, snapshot = {}) {
    const process = this.owner.process
    const stdoutChunks = this.processDelta('stdoutChunks'), jsonLines = this.processDelta('jsonLines'), stderrChunks = this.processDelta('stderrChunks')
    const replyWrites = this.processDelta('replyWrites'), replyCallbacks = this.processDelta('replyCallbacks')
    const exitOccurred = process.processExit && process.processExit !== this.baseline.processExit
    return {
      reason:String(reason || 'unknown').slice(0, 64),
      turnNumber:this.turnNumber,
      started:this.started,
      observedAt:this.owner.timestamp(),
      phase:this.phaseName,
      process:{
        alive:Boolean(snapshot.processAlive),
        pendingAppServerRequests:safeInteger(snapshot.pendingAppServerRequests),
        stdoutBytes:this.processDelta('stdoutBytes'),
        stdoutChunks,
        jsonLines,
        rawBufferBytes:snapshot.rawBufferBytes === undefined ? safeInteger(process.rawBufferBytes) : safeInteger(snapshot.rawBufferBytes),
        stderrBytes:this.processDelta('stderrBytes'),
        stderrChunks,
        replyWrites,
        replyCallbacks,
        replyCallbackErrors:this.processDelta('replyCallbackErrors'),
        lastStdout:stdoutChunks ? { utc:process.lastStdoutUtc, monotonicMs:process.lastStdoutMonotonic } : null,
        lastJsonLine:jsonLines ? { utc:process.lastJsonLineUtc, monotonicMs:process.lastJsonLineMonotonic } : null,
        lastStderr:stderrChunks ? { utc:process.lastStderrUtc, monotonicMs:process.lastStderrMonotonic } : null,
        lastReplyWrite:replyWrites ? { utc:process.lastReplyWriteUtc, monotonicMs:process.lastReplyWriteMonotonic } : null,
        lastReplyCallback:replyCallbacks ? { utc:process.lastReplyCallbackUtc, monotonicMs:process.lastReplyCallbackMonotonic } : null,
        exit:exitOccurred ? process.processExit : null,
      },
      notifications:{
        recognized:countsObject(this.notifications.recognized),
        ignored:countsObject(this.notifications.ignored),
        mismatched:countsObject(this.notifications.mismatched),
        last:this.lastNotification,
      },
      activity:{ counts:countsObject(this.activityCounts), last:this.lastActivity },
      tools:{ stages:countsObject(this.toolStages) },
      pending:{
        requests:safeInteger(snapshot.pendingRequests),
        admissions:safeInteger(snapshot.pendingAdmissions),
        executingTools:safeInteger(snapshot.executingTools),
      },
      recentEvents:this.events.slice(),
    }
  }

  close() {
    this.closed = true
  }
}
