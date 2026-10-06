// A model decision is not a transaction. Each browser write remains atomic;
// only revisions proven to belong to earlier successful writes in this decision
// may be forwarded. Never retry against an arbitrary latest browser revision.
export const MAX_CANVAS_DECISION_TOOLS = 16
const pendingBatches = new WeakMap()
export const CANVAS_MUTATION_TOOLS = new Set(['canvas_create', 'canvas_edit', 'canvas_patch_widget', 'canvas_revert','penecho_present_widget','penecho_draw','penecho_plot','penecho_patch_file','penecho_edit_canvas','penecho_upload_image','penecho_place_image'])
const mutations = CANVAS_MUTATION_TOOLS
const busyRecovery = new WeakMap()

// Scope follows the browser's guards, not the presentation/navigation lock.
// In particular, source-lock Widget patches do not consume an active edit.
function mutationScope(name, args) {
  if (name === 'penecho_present_widget' && args?.presentation?.intent === 'inspect'
    || name === 'penecho_edit_canvas' && args?.action === 'show') return null
  if (name === 'canvas_patch_widget' && args?.sourceHash) return 'source'
  if (name === 'penecho_patch_file') {
    const path = String(args?.path || '').replace(/^\//, '')
    if (path === 'context.md') return 'context'
    if (/^objects\/[^/]+\/widget\.(?:html|source|json)$/.test(path)) return 'source'
  }
  if (name === 'penecho_upload_image') return 'upload'
  return mutations.has(name) ? 'spatial' : null
}

function mutationObservation(value) {
  const state = value?.mutationState || value?.browser?.mutationState
  if (!state || !Number.isSafeInteger(state.revision) || !Array.isArray(state.blockers)
    || state.blockers.some(blocker => typeof blocker !== 'string')) return null
  return { revision:state.revision, blockers:JSON.stringify([...state.blockers].sort()) }
}

function currentRecovery(session) {
  let state = busyRecovery.get(session)
  // The hosts replace this budget only for an accepted actual user message.
  if (!state || state.turn !== session.canvasTurnBudget) {
    state = { turn:session.canvasTurnBudget, fences:new Map(), observation:null }
    busyRecovery.set(session, state)
  }
  const observed = mutationObservation(session.stateDigest)
  if (observed && (!state.observation || observed.revision >= state.observation.revision)) state.observation = observed
  return state
}

function fenceResolved(session, state, fence) {
  const observed = state.observation
  if (observed && fence.observation && observed.revision > fence.observation.revision
    && observed.blockers !== fence.observation.blockers) return true
  // Unknown/backpressure errors have no edit-state precondition. A newer
  // verified Canvas revision is useful progress; a viewport change alone isn't.
  return !fence.editState && Number.isSafeInteger(session.stateDigest?.revision)
    && session.stateDigest.revision > fence.canvasRevision
}

function recoveryError(fence, blocked = fence.blocked) {
  const message = blocked
    ? 'Canvas writes for this unchanged busy condition are stopped. Do not switch writing tools or probe another write. Read-only checks remain available; retry the intended write only after the reported blocker changes or a new user message.'
    : 'This busy result did not apply the write. Allow the current gesture or queued operation to finish; at most one automatic retry is allowed for this unchanged condition. Do not switch writing tools to bypass it.'
  return Object.assign(new Error(`${fence.message} ${message}`), {
    code:'CANVAS_BUSY',
    details:{ ...fence.details, recovery:{
      retry:'after_state_change', scope:fence.scope, mutationAttempts:fence.attempts,
      automaticRetryRemaining:blocked ? 0 : 1, blocked,
    } },
  })
}

async function executeWithBusyRecovery(session, name, args, exec, execute) {
  const completedRequest = session.documentToolSession?.mutationRequests?.get(args?.requestId)?.response,
    scope = completedRequest ? null : mutationScope(name, args), state = currentRecovery(session)
  if (!scope) {
    const result = await execute(args, exec), observed = mutationObservation(result)
    if (observed && (!state.observation || observed.revision >= state.observation.revision)) state.observation = observed
    return result
  }
  let fence = state.fences.get(scope)
  if (fence && fenceResolved(session, state, fence)) { state.fences.delete(scope); fence = null }
  if (fence?.blocked) {
    fence.ignored = (fence.ignored || 0) + 1
    const error = recoveryError(fence)
    if (fence.ignored >= 2) {
      error.message = `${fence.message} Automatic Canvas work stopped because repeated writes ignored this unchanged blocker. Existing content is preserved; no further write was sent.`
      error.details.recovery.ignoredBlockedCalls = fence.ignored
      const stop = {code:error.code,message:error.message,details:error.details}
      if (session.canvasTurnBudget) session.canvasTurnBudget.stop = stop
      error.canvasAgentTurnStop = stop
    }
    throw error
  }
  try {
    const result = await execute(args, exec)
    state.fences.delete(scope)
    return result
  } catch (error) {
    if (error?.code !== 'CANVAS_BUSY' || exec?.signal?.aborted) throw error
    const details = error.details && typeof error.details === 'object' ? error.details : {},
      observation = mutationObservation(details), editState = details.mutationGuard === 'canvas-edit' && Boolean(observation),
      signature = JSON.stringify([details.mutationGuard || scope, observation?.blockers || null])
    const same = fence?.signature === signature
    fence = {
      scope, signature, attempts:same ? fence.attempts + 1 : 1,
      editState, observation:observation || state.observation,
      canvasRevision:Number.isSafeInteger(session.stateDigest?.revision) ? session.stateDigest.revision : -1,
      message:String(error.message || 'Canvas is busy.'), details,
    }
    fence.blocked = editState && details.mutationState.transient === false || fence.attempts >= 2
    state.fences.set(scope, fence)
    // CANVAS_BUSY is a rejected precondition, not an uncertain applied write.
    // Keeping it in the unresolved-outcome cache eventually causes a false
    // request_limit after unrelated accepted user turns.
    const cache = session.documentToolSession?.mutationRequests, request = cache?.get(args?.requestId)
    if (request && !request.response && !request.running) cache.delete(args.requestId)
    throw recoveryError(fence)
  }
}

export function createCanvasDecisionBatch(session) {
  const known=[session?.stateDigest?.revision,session?.canvasCommittedRevision].filter(Number.isSafeInteger)
  const revision = known.length?Math.max(...known):undefined
  return { baseRevision:revision, revision, failed:false }
}

export function registerCanvasDecisionBatch(session, calls) {
  const batch = createCanvasDecisionBatch(session)
  pendingBatches.set(session, new Map(calls.map(call => [String(call.id), batch])))
  return batch
}

// Schema/authorization failures can occur before the tool's execute wrapper.
export function recordCanvasBatchToolResult(session, exec, result) {
  const pending=pendingBatches.get(session),id=String(exec?.callId||''),batch=pending?.get(id)
  if(batch&&mutations.has(exec.name)&&result?.isError)batch.failed=true
  pending?.delete(id)
}

export async function executeCanvasBatchTool(session, name, args, exec, execute) {
  const pending = pendingBatches.get(session), id = String(exec?.callId || '')
  const batch = exec?.canvasDecisionBatch || pending?.get(id)
  pending?.delete(id)
  if (!mutations.has(name)) return executeWithBusyRecovery(session, name, args, exec, execute)
  const commit=async submitted=>{
    const result=await executeWithBusyRecovery(session,name,submitted,exec,execute)
    // A browser digest can arrive after its tool receipt. A capture immediately
    // following the write must never reuse an image keyed to the older digest.
    if(result?.ok!==false&&!result?.isError&&!result?.terminal){
      session.captureCache?.clear()
      if(Number.isSafeInteger(result?.revision))session.canvasCommittedRevision=Math.max(session.canvasCommittedRevision??0,result.revision)
    }
    return result
  }
  if (!batch) return commit(args)
  if (batch.failed) {
    const error = new Error('An earlier write in this decision failed or its revision could not be verified. Inspect the current state before submitting further writes; successful earlier changes are preserved.')
    error.code = 'CANVAS_BATCH_WRITE_STOPPED'
    throw error
  }
  // Shared document tools enforce their own source hashes, stable artifact IDs
  // and request receipts. Never substitute a guessed revision into that API.
  if(name.startsWith('penecho_')) {
    try { return await commit(args) }
    catch(error) { batch.failed=true; throw error }
  }
  let submitted = args
  // Source hashes are object-scoped and must never be rewritten, even when a
  // sibling patch changed the same object. The browser checks them at commit.
  if (!args.sourceHash && Number.isSafeInteger(batch.baseRevision)
    && args.baseRevision === batch.baseRevision && batch.revision !== batch.baseRevision) {
    submitted = { ...args, baseRevision:batch.revision }
  }
  try {
    const result = await commit(submitted)
    if (result?.terminal || result?.ok === false || result?.isError) batch.failed = true
    else if (Number.isSafeInteger(result?.revision)) {
      const guardedBase = args.sourceHash || name === 'canvas_revert'
        ? result.previousRevision : submitted.baseRevision
      if (guardedBase === batch.revision && result.revision === batch.revision + 1) batch.revision = result.revision
      else if (result.revision !== batch.revision) batch.failed = true
    } else batch.failed = true
    return result
  } catch (error) {
    batch.failed = true
    throw error
  }
}
