"use strict";
const { createModelProxy } = require("./model-proxy.js");
const { modelSupportsReasoningEffort } = require("../../providers/reasoning-effort.js");

// The built-in Lines agent uses the signed-in computer’s PenEcho Cloud account.
const text = value => (typeof value === "string" ? value.trim() : "");
const failure = (message, code) => Object.assign(new Error(message), { status:409, code });
const EFFORTS = ["low", "medium", "high", "xhigh", "max"];
// The proxy tries a failed call again and holds each answer until it is whole (model-retry.js), so the loop in the runner neither
// tries again itself (the two would multiply) nor gives up on a quiet answer the proxy is still waiting for. It only asks once
// more when a model gives an empty answer, which the proxy cannot see. The proxy's own limits end a try that hears nothing.
// The model adapter's own client gives up after 10 minutes without an answer's headers, and the proxy sends them only once
// the answer is whole, so it gets the same ceiling.
const RUNNER_REQUESTS = Object.freeze({ retryPolicy:{ mode:"normal", maxRetries:1, retryableCodes:["EMPTY_RESPONSE"] }, streamIdleTimeoutMs:2 * 60 * 60 * 1000, timeoutMs:2 * 60 * 60 * 1000 });
const NOT_SET_UP = "Sign in to PenEcho Cloud to use the built-in agent.";

function createPenEchoSource({ cloud = () => null, timeoutMs = () => undefined, onError = () => {}, onRetry = null, hostedSilenceMs, backoff, keepaliveMs, stateDir = "", publishEndpoint = true } = {}) {
  const account = () => { try { const connector = cloud(); return connector?.status().accountSession.signedIn ? connector : null; } catch { return null; } };
  const usable = models => (Array.isArray(models) ? models : []).filter(m => m && m.available !== false && m.enabled !== false && !m.retiredAt && ["openai", "anthropic"].includes(m.apiFormat))
    .sort((a, b) => Number(Boolean(b.workerDefault)) - Number(Boolean(a.workerDefault)) || (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0));
  // PenEcho Cloud runs PenEcho's agent on one model, the one its catalog marks `worker` (owner, 2026-11-13: DeepSeek flash only),
  // and offers no other. Cloud lists only models that can answer now, so a worker that is briefly down is missing, mark and all:
  // once a Cloud has marked one, no other Cloud model stands in for it. A Cloud from before that marks none: every usable model.
  let oneWorker = false;
  const workers = models => {
    const all = Array.isArray(models) ? models : [];
    if (all.some(m => m?.worker === true)) oneWorker = true;
    return usable(oneWorker ? all.filter(m => m?.worker === true) : all);
  };
  // Whether a name is one of Cloud's models (a pick saved before Cloud ran PenEcho on one worker names another one).
  const cloudName = (models, name) => (Array.isArray(models) ? models : []).some(m => m && [text(m.displayName), text(m.name), String(m.id)].some(value => value && value.toLowerCase() === name.toLowerCase()));
  const workerAway = () => Object.assign(new Error("PenEcho Cloud's model is not available right now. Try again in a moment."), { status:503, code:"PENECHO_MODEL_UNAVAILABLE" });
  // The list Cloud last gave, without asking again. Empty until it has been asked once.
  const listed = () => { const connector = account(); return connector ? workers(connector.hostedCatalog?.models) : []; };
  const nameOf = model => text(model.displayName) || text(model.name) || String(model.id);
  let credits = null;

  async function connect(pick) {
    const connector = account();
    if (!connector) throw failure(NOT_SET_UP, "PENECHO_NOT_SET_UP");
    const catalog = (await connector.refreshHostedCatalog()).models || [];
    const models = workers(catalog), name = text(pick);
    if (!models.length) {
      if (oneWorker) throw workerAway();
      throw failure("PenEcho Cloud lists no model for this account right now.", "PENECHO_NOT_SET_UP");
    }
    let model = models[0];
    if (name) {
      const match = models.find(m => nameOf(m).toLowerCase() === name.toLowerCase() || String(m.id) === name);
      if (match) model = match;
      // An older saved Cloud pick follows the worker once the catalog designates one.
      else if (!oneWorker || !cloudName(catalog, name)) {
        throw failure(`PenEcho Cloud has no model named ${name}. Choose a Cloud model in agent settings or configure your API key in your own agent.`, "PENECHO_MODEL_UNKNOWN");
      }
    }
    return { ...(await connector.prepareHostedConnection(`hosted:${model.id}`)), name:`PenEcho Cloud ${nameOf(model)}`, ...(model.supportsThinking === false ? { supportsThinking:false } : {}) };
  }
  const core = () => import("./connection-profile.mjs");
  // What the runner is told: the model, how to talk to it and where, which is the proxy. No key and no account token is in it.
  async function describe(connection, { baseURL, effort = "" } = {}) {
    const { connectionProfile } = await core();
    const profile = connectionProfile({ ...connection, ...(effort ? { effort } : {}) }, timeoutMs());
    const { headers = {}, ...config } = profile.config;
    const kept = Object.fromEntries(Object.entries(headers).filter(([name]) => !/^(?:authorization|x-api-key)$/i.test(name)));
    return { provider:profile.provider, model:String(connection.apiModel), apiKeyEnv:profile.apiKeyEnv, ...(profile.reasoningEffort ? { reasoningEffort:profile.reasoningEffort } : {}),
      label:connection.name || "PenEcho Cloud", config:{ ...config, ...(Object.keys(kept).length ? { headers:kept } : {}), baseURL, ...RUNNER_REQUESTS } };
  }
  const target = async connection => (await core()).providerBaseURL(connection);
  const proxy = createModelProxy({ connect, describe, target, idleMs:() => timeoutMs(), onError, onRetry, ...(hostedSilenceMs ? { hostedSilenceMs } : {}), ...(backoff ? { backoff } : {}), ...(keepaliveMs ? { keepaliveMs } : {}), ...(stateDir ? { stateDir } : {}), publishEndpoint });

  return {
    listening:proxy.listening,
    endpointFile:proxy.endpointFile,
    activate:() => proxy.activate(),
    deactivate:() => proxy.deactivate(),
    active:() => proxy.active,
    // Whether a run could start at all: a signed-in account, and the proxy up and active.
    ready() { return Boolean(proxy.port) && proxy.active && Boolean(account()); },
    signedIn() { return Boolean(account()); },
    notSetUp:NOT_SET_UP,
    // Ask Cloud for its list and the credits left, so the names below are there to pick from.
    async refresh() {
      const connector = account();
      if (!connector) { credits = null; return; }
      try { const wallet = (await connector.hostedModels()).credits, left = typeof wallet === "number" ? wallet : wallet?.availableCredits ?? wallet?.available ?? wallet?.balance; credits = Number.isFinite(Number(left)) && left !== null && left !== undefined ? Number(left) : null; }
      catch { credits = null; await connector.refreshHostedCatalog().catch(() => {}); }
    },
    // The names to pick from, and the one used when nothing is picked. Only names: never a key or an address.
    models() {
      const hosted = listed(), choices = [...new Set(hosted.map(nameOf))], signed = Boolean(account());
      const defaultEffortFor = Object.fromEntries(hosted.map(m => [nameOf(m), text(m.defaultEffort).toLowerCase()]));
      const effortsFor = Object.fromEntries(hosted.map(m => {
        const name = nameOf(m), base = m.supportsThinking !== false && modelSupportsReasoningEffort(m.id) ? EFFORTS : [];
        const def = defaultEffortFor[name];
        return [name, def && base.length && !base.includes(def) ? [def, ...base] : base];
      }));
      const effort = choices[0] ? defaultEffortFor[choices[0]] || "" : "";
      return { name:choices[0] || "", effort, from:signed ? "PenEcho Cloud" : "", choices, efforts:EFFORTS, effortsFor, defaultEffortFor, signedIn:signed, credits:signed ? credits : null };
    },
    open:options => proxy.open(options),
    // Before a run on Cloud models: an account with no credits left gets Cloud's own 402 answer back, and the run does not start.
    async preflight(pick) {
      let connection;
      try { connection = await connect(pick); } catch { return null; }
      const connector = account();
      if (!connection?.hosted || !connector) return null;
      let left = null;
      try { const wallet = (await connector.hostedModels()).credits; left = typeof wallet === "number" ? wallet : wallet?.availableCredits ?? wallet?.available ?? wallet?.balance ?? null; } catch { return null; }
      if (left === null || left === undefined || !Number.isFinite(Number(left))) return null;
      credits = Number(left);
      return credits > 0 ? null : { error:"insufficient_credits", details:{ balance:credits, reserved:0, required:1 } };
    },
    refused:id => proxy.refused(id),
    clearRefusal:id => proxy.clearRefusal(id),
    // Hear each model call of a run that is about to be tried again: (runId, { attempt, of, why, waitMs }).
    onRetry:listener => proxy.onRetry(listener),
    end:id => proxy.end(id),
    connect, describe,
    close:() => proxy.close(),
  };
}

module.exports = { createPenEchoSource, NOT_SET_UP };
