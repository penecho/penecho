"use strict";

const fs = require("fs");
const path = require("path");
const net = require("net");
const { createHash, randomBytes, timingSafeEqual } = require("crypto");
const { forwardModelEvaluation } = require("./model-evaluation.js");
const { localUsageRecord } = require("./local-request-usage.js");
const { createSuggestionTransport } = require("./suggestion-transport.js");

const MAX_CLOUD_BUNDLE_BYTES = 32 * 1024 * 1024;
const ACCOUNT_REFRESH_INTERVAL_MS = 5 * 60_000;
const ACCOUNT_SIGNOUT_TIMEOUT_MS = 5_000;
const CLOUD_REQUEST_TIMEOUT_MS = 30_000;
const BROWSER_AUTHORIZATION_MS = 10 * 60_000;
const PUBLIC_MESSAGE_TIMEOUT_MS = 3_500;
const MODEL_EVALUATION_QUEUE_TTL_MS = 10_000;
const MODEL_EVALUATION_QUEUE_LIMIT = 32;
const BROWSER_CALLBACK_PATH = "/api/cloud/sign-in/callback";
// Cloud did not answer this time: a busy or restarting server (502-504), or Cloudflare's own pages in front of penecho.ai when it
// could not reach it in time (520-524; 524 is a request not answered within 100 s) or the tunnel to it was down (530).
const TEMPORARY_CLOUD_STATUSES = new Set([502, 503, 504, 520, 521, 522, 523, 524, 530]);
// Linked Device was retired on 2026-11-13. Older installs saved these fields beside
// the Cloud sign-in; they are removed once on start and never written again.
const RETIRED_DEVICE_FIELDS = Object.freeze(["deviceToken", "token", "enabled", "cloudMcpEnabled", "deviceId", "deviceName", "platform", "pairedAt", "legacyAccountAccess"]);

function withoutRetiredDeviceFields(value) {
  const cleaned = { ...value };
  for (const field of RETIRED_DEVICE_FIELDS) delete cleaned[field];
  return cleaned;
}

function normalizedOrigin(value) {
  const url = new URL(String(value || "").trim());
  const loopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname.toLowerCase());
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) throw new Error("Cloud origin must use HTTPS.");
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("Cloud origin must be an origin without a path, query, or credentials.");
  return url.origin;
}

function safeMessage(error) {
  const message = String(error?.message || "Local PenEcho could not complete the request.");
  return message.replace(/(?:sk-|key-|Bearer\s+)[A-Za-z0-9._-]{12,}/gi, "[credential redacted]").slice(0, 1000);
}

function temporaryCloudError(error, origin) {
  const cause = error?.cause?.code || error?.code || error?.name || "cloud_network_error";
  const label = String(origin || "").includes("internaltest.penecho.ai") ? "UAT Cloud" : "PenEcho Cloud";
  const wrapped = new Error(`${label} is temporarily unavailable (${cause}). Your Canvas is still safe on this device. Try Save again in a moment.`);
  wrapped.status = 503;
  wrapped.code = "cloud_temporarily_unavailable";
  return wrapped;
}

function cloudSignInRequiredError(message) {
  return Object.assign(new Error(message), { status:401, code:"cloud_sign_in_required" });
}

function isPrivateHost(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (host === "localhost" || host === "::1") return true;
  const version = net.isIP(host);
  if (version === 4) {
    const octets = host.split(".").map(Number);
    return octets[0] === 127 || octets[0] === 10 || octets[0] === 192 && octets[1] === 168
      || octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31
      || octets[0] === 169 && octets[1] === 254;
  }
  return version === 6 && /^(?:fc|fd|fe8|fe9|fea|feb)/.test(host);
}

function isLocalCanvasHost(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (isPrivateHost(host)) return true;
  if (net.isIP(host)) return false;
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?|[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.local)$/i.test(host);
}

function cloudAssetUrl(value, cloudOrigin) {
  const url = new URL(String(value || ""), cloudOrigin);
  const development = isPrivateHost(new URL(cloudOrigin).hostname);
  if (!development && (url.protocol !== "https:" || isPrivateHost(url.hostname))) throw new Error("Cloud storage returned an unsafe asset URL.");
  if (development && !["http:", "https:"].includes(url.protocol)) throw new Error("Cloud storage returned an unsupported asset URL.");
  if (url.username || url.password) throw new Error("Cloud storage returned an unsafe asset URL.");
  return url.toString();
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function communityArtifactLineage(kind, artifact) {
  const itemId=kind==="widget"?artifact?.widget?.communityOriginItemId:artifact?.extensions?.penechoCommunity?.originItemId;
  return /^[0-9a-f-]{36}$/i.test(String(itemId||""))?{itemId:String(itemId)}:null;
}

function publicAccount(value) {
  if (!value?.id) return null;
  return {
    id: String(value.id),
    name: String(value.name || "PenEcho user"),
    ...(value.bio ? { bio:String(value.bio) } : {}),
    ...(value.avatarUrl ? { avatarUrl:String(value.avatarUrl) } : {}),
    credits: Number(value.credits || 0),
    ...(["plus", "pro"].includes(value.membership?.tier) && Number.isFinite(value.membership?.expiresAt) && value.membership.expiresAt > Date.now()
      ? { membership:{ tier:value.membership.tier, expiresAt:value.membership.expiresAt } } : {}),
    workspace: value.workspace && typeof value.workspace === "object" ? value.workspace : undefined,
  };
}

function publicCanvasMessage(value) {
  if (!value || typeof value !== "object") return null;
  const localized = (field, maximum) => {
    const source = value[field];
    if (!source || typeof source !== "object") return { en:"", zh:"" };
    return { en:String(source.en || "").slice(0, maximum), zh:String(source.zh || "").slice(0, maximum) };
  };
  let actionUrl = null;
  if (value.actionUrl) {
    const parsed = new URL(String(value.actionUrl));
    if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isPrivateHost(parsed.hostname))) throw new Error("Cloud message returned an unsafe link.");
    if (parsed.username || parsed.password) throw new Error("Cloud message returned an unsafe link.");
    actionUrl = parsed.toString();
  }
  const title = localized("title", 120), body = localized("body", 800), actionLabel = localized("actionLabel", 80);
  if (!body.en && !body.zh) return null;
  return { title, body, actionLabel, actionUrl, updatedAt:Number(value.updatedAt) || null };
}

function accountToken(configuration) {
  return configuration?.accountToken || null;
}

function accountSessionExpired(configuration, now = Date.now()) {
  if (!configuration?.accountToken || !configuration.accountExpiresAt) return false;
  const expiresAt = Date.parse(configuration.accountExpiresAt);
  // Malformed local metadata is not proof that the Cloud session expired.
  // Preserve the credential and let the authoritative session endpoint
  // validate it instead of destructively signing the user out.
  return Number.isFinite(expiresAt) && expiresAt <= now;
}

class CloudConnector {
  constructor({ stateDir, logger = null, defaultOrigin = "https://penecho.ai", suggestionTransport = null }) {
    this.stateDir = stateDir;
    // The file keeps its old name: it holds the Cloud sign-in of every install.
    this.file = path.join(stateDir, "cloud-device.json");
    this.logger = logger;
    this.defaultOrigin = normalizedOrigin(defaultOrigin);
    this.suggestionTransport = suggestionTransport;
    this.configuration = this.readConfiguration();
    this.accountRefreshTimer = null;
    this.closed = false;
    this.account = publicAccount(this.configuration?.account);
    this.accountUpdatedAt = Number(this.configuration?.accountUpdatedAt || 0) || null;
    this.accountLastError = null;
    this.browserAuthorizations = new Map();
    this.accountSignInSeq = 0;
    this.modelEvaluationQueue = [];
    this.modelEvaluationQueueRunning = false;
    this.expireAccountSessionIfNeeded();
  }

  log(event, details = {}) {
    this.logger?.({ type: "cloud-connector", event, ...details });
  }

  readConfiguration() {
    let value;
    try {
      const contents = fs.readFileSync(this.file, "utf8");
      try { fs.chmodSync(this.file, 0o600); } catch {}
      value = JSON.parse(contents);
    } catch {
      return null;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    if (RETIRED_DEVICE_FIELDS.some(field => Object.hasOwn(value, field))) value = this.removeRetiredDevice(value);
    if (!value.origin || !value.accountToken) return null;
    try {
      return { ...value, version: 2, origin: normalizedOrigin(value.origin), account: publicAccount(value.account) };
    } catch {
      return null;
    }
  }

  // Runs once, on the first start after Linked Device was retired: the device leaves
  // the file and the Cloud sign-in beside it is written back exactly as it was. An old
  // install that signed in only through its device has no sign-in left and is signed out.
  removeRetiredDevice(saved) {
    const cleaned = withoutRetiredDeviceFields(saved), signedIn = Boolean(cleaned.origin && cleaned.accountToken);
    try {
      if (signedIn) this.writeFile(cleaned);
      else fs.rmSync(this.file, { force: true });
      this.log("linked-device-removed", { signedIn });
    } catch (error) {
      this.log("linked-device-remove-failed", { error: safeMessage(error) });
    }
    return cleaned;
  }

  writeFile(value) {
    fs.mkdirSync(this.stateDir, { recursive: true });
    const temporary = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporary, this.file);
    try { fs.chmodSync(this.file, 0o600); } catch {}
  }

  writeConfiguration(configuration) {
    const nextOrigin = configuration?.origin && configuration.accountToken ? normalizedOrigin(configuration.origin) : this.defaultOrigin;
    if ((this.configuration?.origin || this.defaultOrigin) !== nextOrigin || (this.configuration?.accountToken || null) !== (configuration?.accountToken || null)) this.invalidateSuggestionStatus();
    if (!configuration?.origin || !configuration.accountToken) {
      this.configuration = null;
      try { fs.unlinkSync(this.file); } catch (error) { if (error.code !== "ENOENT") throw error; }
      return;
    }
    const normalized = {
      ...withoutRetiredDeviceFields(configuration),
      version: 2,
      origin: normalizedOrigin(configuration.origin),
      account: publicAccount(configuration.account),
    };
    if (!normalized.account) delete normalized.account;
    this.writeFile(normalized);
    this.configuration = normalized;
  }

  pendingBrowserAuthorization() {
    for (const [state, pending] of this.browserAuthorizations) {
      if (pending.expiresAt <= Date.now()) {
        this.browserAuthorizations.delete(state);
        continue;
      }
      return pending;
    }
    return null;
  }

  status() {
    this.expireAccountSessionIfNeeded();
    const pending = this.pendingBrowserAuthorization();
    const accountSignedIn = Boolean(this.configuration?.accountToken);
    const accountStale = Boolean(this.account && (!this.accountUpdatedAt || Date.now() - this.accountUpdatedAt > ACCOUNT_REFRESH_INTERVAL_MS * 2));
    return {
      origin: this.configuration?.origin || null,
      account: publicAccount(this.account),
      accountSession: {
        signedIn: accountSignedIn,
        expiresAt: this.configuration?.accountExpiresAt || null,
        updatedAt: this.accountUpdatedAt,
        stale: accountStale,
        lastError: this.accountLastError,
        credential: accountSignedIn ? "opaque-local-session" : null,
      },
      browserSignIn: {
        pending: Boolean(pending),
        expiresAt: pending?.expiresAt || null,
      },
      // Linked Device is retired. Today's Cloud and MCP settings pages still read these
      // fields; they always say "not linked, not online, Cloud MCP off" until those pages are cleaned.
      state: "disconnected",
      lastError: null,
      cloudMcpEnabled: false,
      device: { configured: false, enabled: false, connected: false, state: "disconnected", id: null, name: null },
    };
  }

  requireCloudAccount() {
    if (this.expireAccountSessionIfNeeded()) {
      throw cloudSignInRequiredError("The local PenEcho Cloud account session expired. Sign in on this computer again.");
    }
    const token = accountToken(this.configuration);
    if (!token || !this.configuration?.origin) throw cloudSignInRequiredError("Connect your PenEcho Cloud account on this computer first.");
    return { ...this.configuration, accountToken: token };
  }

  // A link Canvas needs no account: this computer starts and ends one on the
  // Cloud it uses, proving ownership with the key Cloud returned at the start.
  async linkRequest(pathname, { method = "POST", body, ownerKey, origin } = {}) {
    if (!(method === "POST" && pathname === "/api/v1/live/links" || method === "DELETE" && /^\/api\/v1\/live\/links\/[0-9a-f-]{36}$/i.test(pathname))) throw new Error("Unsupported link Canvas request.");
    const cloudOrigin = normalizedOrigin(this.configuration?.origin || origin);
    let response;
    try {
      response = await fetch(`${cloudOrigin}${pathname}`, {
        method, redirect:"error",
        headers:{ accept:"application/json", ...(body === undefined ? {} : { "content-type":"application/json" }), ...(ownerKey ? { "x-penecho-owner-key":ownerKey } : {}) },
        body:body === undefined ? undefined : JSON.stringify(body),
        signal:AbortSignal.timeout(60_000),
      });
    } catch (error) {
      throw temporaryCloudError(error, cloudOrigin);
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(response.status === 413 ? "This Canvas is too large to collaborate on without an account. Sign in to collaborate on it." : payload.message || `PenEcho Cloud refused this link (HTTP ${response.status}).`), { status:response.status, code:payload.error || "cloud_link_failed" });
    return { ...payload, origin:cloudOrigin };
  }

  // bytes: a raw file body (a Lines project file) instead of JSON.
  async cloudRequest(pathname, { method = "GET", body, bytes, headers = {}, signal, timeoutMs = CLOUD_REQUEST_TIMEOUT_MS, responseTrace } = {}) {
    const configuration = this.requireCloudAccount();
    const notesRequest = method === "GET" && /^\/api\/v1\/notes(?:\?cursor=[^&#]+)?$/.test(pathname)
      || ["GET", "PUT"].includes(method) && /^\/api\/v1\/notes\/[^/?#]+$/.test(pathname);
    const linkAdoption = method === "POST" && /^\/api\/v1\/live\/links\/[0-9a-f-]{36}\/adopt$/i.test(pathname);
    if (!notesRequest && !linkAdoption && !(/^\/api\/v1\/canvases\/[0-9a-f-]{36}\/(?:share(?:\?widgetId=[0-9a-f-]{36})?|collaboration)$/i.test(pathname) && ["GET","POST","DELETE"].includes(method)) && !(/^\/api\/v1\/mcp(?:\/(?:tokens|canvases)|\/grants\/[0-9a-f-]{36})?$/.test(pathname) && ["GET","POST","DELETE"].includes(method)) && !["/api/v1/device-sync/", "/api/v1/community/", "/api/v1/favorites"].some((prefix) => String(pathname).startsWith(prefix)) && !(method === "GET" && ["/api/v1/models", "/api/v1/credits"].includes(pathname))) throw new Error("Unsupported cloud account request.");
    let response;
    try {
      response = await fetch(`${configuration.origin}${pathname}`, {
        method,
        redirect: "error",
        headers: {
          ...headers,
          authorization: `Bearer ${configuration.accountToken}`,
          accept: "application/json",
          ...(bytes !== undefined ? { "content-type": "application/octet-stream" } : body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: bytes !== undefined ? bytes : body === undefined ? undefined : JSON.stringify(body),
        signal:signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      if (error.name === "TimeoutError") throw Object.assign(error, { status:504 });
      throw temporaryCloudError(error, configuration.origin);
    }
    let payload;
    if (responseTrace) {
      responseTrace.response(response.status);
      const text = await response.text();
      responseTrace.responseBody(text.split(configuration.accountToken).join("<redacted>"));
      try { payload = JSON.parse(text); } catch { payload = {}; }
    } else payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) {
        await this.confirmAccountSessionAfterUnauthorized(configuration.accountToken, payload.message);
        throw Object.assign(new Error(payload.message || "PenEcho Cloud rejected this account request."), {
          status:403,
          code:payload.error || "cloud_request_not_authorized",
        });
      }
      const temporary = TEMPORARY_CLOUD_STATUSES.has(response.status);
      const error = new Error(temporary
        ? `${configuration.origin.includes("internaltest.penecho.ai") ? "UAT Cloud" : "PenEcho Cloud"} is temporarily unavailable (HTTP ${response.status}). Your Canvas is still safe on this device. Try Save again in a moment.`
        : payload.message || `Cloud account request failed (HTTP ${response.status}).`);
      error.status = response.status;
      error.code = temporary ? "cloud_temporarily_unavailable" : payload.error || "cloud_request_failed";
      if (payload.details) error.details = payload.details;
      throw error;
    }
    return payload;
  }

  // The raw answer of one account request for Lines: a project's files and pages, a file's bytes, meetings and credits.
  // Only these paths, only for the signed-in account. The caller reads the status and the body itself.
  async accountFetch(pathname, { method = "GET", headers = {}, body, signal, timeoutMs = CLOUD_REQUEST_TIMEOUT_MS } = {}) {
    const where = String(pathname);
    if (where.includes("..") || !/^\/api\/v1\/(?:device-sync\/line-projects|line-projects|meetcue|credits)(?:[/?]|$)/.test(where)) throw new Error("Unsupported cloud account request.");
    const configuration = this.requireCloudAccount();
    const pass = Object.fromEntries(Object.entries(headers || {}).filter(([name, value]) => /^(?:content-type|accept)$/i.test(name) && typeof value === "string"));
    try {
      return await fetch(`${configuration.origin}${where}`, { method, redirect:"error", headers:{ accept:"application/json", ...pass, authorization:`Bearer ${configuration.accountToken}` }, body:body === undefined || ["GET", "HEAD"].includes(method) ? undefined : body,
        signal:signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      if (error.name === "TimeoutError") throw Object.assign(error, { status:504 });
      throw temporaryCloudError(error, configuration.origin);
    }
  }

  invalidateSuggestionStatus() {
    this.suggestionStatusEpoch = (this.suggestionStatusEpoch || 0) + 1;
    this.suggestionStatus?.controller?.abort();
    this.suggestionStatus = null;
  }

  async suggestionRequest(suffix = "", {method=suffix==="/status"?"GET":"POST",body,signal,timeoutMs=6000,responseTrace,refresh=false} = {}) {
    if(!["","/status","/preferences"].includes(suffix)||method!==(suffix==="/status"?"GET":"POST"))throw new Error("Unsupported suggestion request.");
    this.expireAccountSessionIfNeeded();
    const origin=this.configuration?.origin||this.defaultOrigin,sessionToken=this.configuration?.accountToken||null;
    const identityCurrent=()=> (this.configuration?.accountToken||null)===sessionToken && (this.configuration?.origin||this.defaultOrigin)===origin;
    const superseded=()=>Object.assign(new Error("The Cloud account or suggestion settings changed. Try again."),{status:409,code:"suggestion_status_superseded"});
    this.suggestionGuests ||= (()=>{try{return JSON.parse(fs.readFileSync(path.join(this.stateDir,"suggestion-guests.json"),"utf8"));}catch{return {};}})();
    const send=async(part,requestMethod,payload,requestSignal=signal)=>{
      if(!identityCurrent())throw superseded();
      const statusEpoch=part==="/status"?this.suggestionStatusEpoch:null;
      this.suggestionTransport ||= createSuggestionTransport();
      const response=await this.suggestionTransport.request(`${origin}/api/v1/apps/penecho-llm/suggest${part}`,{
        method:requestMethod,redirect:"error",signal:requestSignal?AbortSignal.any([requestSignal,AbortSignal.timeout(timeoutMs)]):AbortSignal.timeout(timeoutMs),
        headers:{accept:"application/json","x-penecho-client":"canvas",...(this.suggestionGuests[origin]?{"x-penecho-guest":this.suggestionGuests[origin]}:{}),
          ...(sessionToken?{authorization:`Bearer ${sessionToken}`}:{ }),...(payload===undefined?{}:{"content-type":"application/json"})},
        body:payload===undefined?undefined:JSON.stringify(payload),
      });
      const raw=await response.text();
      if(!identityCurrent()||part==="/status"&&statusEpoch!==this.suggestionStatusEpoch)throw superseded();
      if(part===""&&responseTrace) {
        responseTrace.response(response.status);
        let safe=raw;
        for(const secret of [this.configuration?.accountToken,this.suggestionGuests[origin]])if(secret)safe=safe.split(secret).join("<redacted>");
        responseTrace.responseBody(safe);
      }
      let value;try{value=JSON.parse(raw);}catch{value={};}
      if(part==="/status"&&response.ok&&typeof value.configured!=="boolean")throw Object.assign(new Error("Cloud returned an invalid suggestion status."),{status:502,code:"invalid_suggestion_status"});
      if(value.guestToken) {
        this.suggestionGuests[origin]=value.guestToken;
        if(this.stateDir){fs.mkdirSync(this.stateDir,{recursive:true});fs.writeFileSync(path.join(this.stateDir,"suggestion-guests.json"),JSON.stringify(this.suggestionGuests),{mode:0o600});}
        delete value.guestToken;
      }
      if(!response.ok){let message=value.message||"PenEchoLLM is unavailable.";for(const secret of [sessionToken,this.suggestionGuests[origin]])if(secret)message=message.split(secret).join("<redacted>");const retryAfter=response.headers?.get("retry-after"),seconds=Number(retryAfter),until=retryAfter?(Number.isFinite(seconds)?Date.now()+Math.max(0,seconds)*1000:Date.parse(retryAfter)):0;throw Object.assign(new Error(message),{status:response.status,code:value.error,details:value.details,retryAfterAt:Number.isFinite(until)?until:0});}
      return value;
    };
    if (suffix === "/status") {
      signal?.throwIfAborted();
      let entry = this.suggestionStatus;
      if (!entry || entry.origin !== origin || entry.sessionToken !== sessionToken) {
        this.invalidateSuggestionStatus();
        entry = this.suggestionStatus = { origin, sessionToken, epoch:this.suggestionStatusEpoch, pending:null, controller:null, value:null, error:null, checkedAt:0, nextAt:0, retryAfterAt:0, failures:0, authRequired:false };
      }
      const now = Date.now(), retryUnavailable = refresh && (entry.error || entry.value?.configured === false);
      if (!entry.pending && (now < entry.retryAfterAt || !retryUnavailable && entry.checkedAt && now < entry.checkedAt + 1000 || !refresh && (entry.authRequired || now < entry.nextAt))) {
        if (entry.error) throw entry.error;
        return structuredClone(entry.value);
      }
      if (!entry.pending) {
        const controller = new AbortController();
        entry.controller = controller;
        entry.checkedAt = now;
        const pending = send("/status", "GET", undefined, controller.signal)
          .then(value => {
            if (!identityCurrent() || this.suggestionStatus !== entry || entry.epoch !== this.suggestionStatusEpoch) throw superseded();
            Object.assign(entry, { value, error:null, failures:0, authRequired:false, retryAfterAt:0, nextAt:Date.now() + (value.configured ? 30000 : 300000) });
            return value;
          })
          .catch(error => {
            if (!identityCurrent() || this.suggestionStatus !== entry || entry.epoch !== this.suggestionStatusEpoch) throw superseded();
            const status = Number(error.status) || (error.name === "TimeoutError" ? 504 : 503), transient = status === 408 || status === 409 || status === 425 || status === 429 || status >= 500 && status !== 501;
            error.status = status;
            error.code ||= error.name === "TimeoutError" ? "timeout" : "unavailable";
            entry.authRequired = status === 401 || status === 403;
            entry.failures = transient ? entry.failures + 1 : 0;
            entry.error = error;
            entry.retryAfterAt = Number(error.retryAfterAt) || 0;
            const backoff = transient ? Math.min(60000, Math.max(5000, 5000 * 2 ** Math.min(entry.failures - 1, 4) * (0.8 + Math.random() * 0.4))) : 300000;
            entry.nextAt = Math.max(Date.now() + backoff, entry.retryAfterAt);
            throw error;
          })
          .finally(() => { if (entry.pending === pending) { entry.pending = null; entry.controller = null; } });
        entry.pending = pending;
      }
      // A caller may stop waiting without cancelling other windows' shared check.
      const pending = entry.pending;
      let abort;
      try {
        signal?.throwIfAborted();
        const value = signal ? await Promise.race([pending, new Promise((_, reject) => {
          abort = () => reject(signal.reason);
          signal.addEventListener("abort", abort, { once:true });
        })]) : await pending;
        if (!identityCurrent() || this.suggestionStatus !== entry || entry.epoch !== this.suggestionStatusEpoch) throw superseded();
        return structuredClone(value);
      } finally { if (abort) signal.removeEventListener("abort", abort); }
    }
    if(!this.suggestionGuests[origin])await this.suggestionRequest("/status",{signal,timeoutMs});
    let value;
    try { value = await send(suffix,method,body); }
    catch(error) {
      if(error.code!=="trial_required") {
        if (identityCurrent() && error.details?.access) {
          this.invalidateSuggestionStatus();
          this.suggestionStatus = { origin, sessionToken, epoch:this.suggestionStatusEpoch, pending:null, controller:null,
            value:{ configured:true, model:"PenEchoLLM", access:error.details.access }, error:null, checkedAt:Date.now(), nextAt:Date.now()+30000, retryAfterAt:0, failures:0, authRequired:false };
        }
        throw error;
      }
      this.invalidateSuggestionStatus();
      await this.suggestionRequest("/status",{signal,timeoutMs,refresh:true});
      value = await send(suffix,method,body);
    }
    // Status responses can race a consumed allowance or a spending change.
    // Reject that older check and keep only the allowance from the actual action.
    if (suffix === "/preferences" || value.access) {
      const cached = this.suggestionStatus?.value;
      this.invalidateSuggestionStatus();
      if (suffix !== "/preferences") this.suggestionStatus = {
        origin, sessionToken, epoch:this.suggestionStatusEpoch, pending:null, controller:null,
        value:{ ...cached, configured:true, model:"PenEchoLLM", access:value.access }, error:null, checkedAt:Date.now(), nextAt:Date.now()+30000, retryAfterAt:0, failures:0, authRequired:false,
      };
    }
    return value;
  }

  async refreshHostedCatalog({ force = false } = {}) {
    const configuration = this.requireCloudAccount();
    const matches = value => value?.token === configuration.accountToken && value.origin === configuration.origin;
    if (!force && matches(this.hostedCatalog) && Date.now() - this.hostedCatalog.fetchedAt < 300_000) return this.hostedCatalog;
    if (matches(this.hostedCatalogRequest)) return this.hostedCatalogRequest.promise;
    const pending = { token:configuration.accountToken, origin:configuration.origin };
    pending.promise = (async () => {
      const catalog = await this.cloudRequest("/api/v1/models");
      if (accountToken(this.configuration) !== configuration.accountToken || this.configuration?.origin !== configuration.origin) throw cloudSignInRequiredError("Cloud account changed. Refresh the model list.");
      this.hostedCatalog = { token:configuration.accountToken, origin:configuration.origin, models:(catalog.models || []).filter(model => model.available && model.enabled !== false && !model.retiredAt), fetchedAt:Date.now() };
      return this.hostedCatalog;
    })();
    this.hostedCatalogRequest = pending;
    try { return await pending.promise; }
    finally { if (this.hostedCatalogRequest === pending) this.hostedCatalogRequest = null; }
  }

  async hostedModels({ refresh = false } = {}) {
    const configuration = this.requireCloudAccount();
    const [catalog, wallet] = await Promise.all([this.refreshHostedCatalog({ force:refresh }), this.cloudRequest("/api/v1/credits")]);
    if (accountToken(this.configuration) !== configuration.accountToken || this.configuration?.origin !== configuration.origin) throw cloudSignInRequiredError("Cloud account changed. Refresh the model list.");
    return { models:catalog.models, credits:wallet.credits, origin:configuration.origin, accountId:this.account?.id || null };
  }

  async prepareHostedConnection(connectionId) {
    if (!/^hosted:[0-9a-f-]{36}$/i.test(String(connectionId))) return null;
    await this.refreshHostedCatalog();
    const connection = this.hostedConnection(connectionId);
    if (!connection) throw Object.assign(new Error("The selected PenEcho model is unavailable. Refresh AI connections."), { status:409, code:"CONNECTION_STALE" });
    // Old Cloud catalogs did not declare a protocol. Fail closed until the
    // server is upgraded; a model name or UUID cannot establish its wire format.
    if (!["openai", "anthropic"].includes(connection.apiFormat)) throw Object.assign(new Error("Cloud did not provide a supported API format for this model. Refresh the model list or update the Cloud server."), { status:409, code:"hosted_model_protocol_unavailable" });
    return connection;
  }

  hostedConnection(connectionId) {
    if (!/^hosted:[0-9a-f-]{36}$/i.test(String(connectionId))) return null;
    const configuration = this.requireCloudAccount();
    const catalog = this.hostedCatalog?.token === configuration.accountToken && this.hostedCatalog.origin === configuration.origin ? this.hostedCatalog : null;
    const model = catalog?.models.find(model => model.id === connectionId.slice(7));
    if (catalog && !model) return null;
    // Keep synchronous callers synchronous. Only inference preparation may
    // resolve a cold catalog, and it must do so before selecting a backend.
    const effort = typeof model?.defaultEffort === "string" && model.defaultEffort.trim() ? model.defaultEffort.trim().toLowerCase() : "medium";
    return { id:connectionId, provider:"api", apiFormat:model?.apiFormat || null, apiUrl:`${configuration.origin}/api/v1/hosted`, apiKey:configuration.accountToken, apiModel:connectionId.slice(7), effort, ...(model?.defaultEffort ? { defaultEffort:model.defaultEffort } : {}), hosted:true };
  }

  hostedConnections() {
    this.expireAccountSessionIfNeeded();
    const token = accountToken(this.configuration);
    if (!token || this.hostedCatalog?.token !== token || this.hostedCatalog.origin !== this.configuration?.origin) return [];
    return this.hostedCatalog.models.filter(model => ["openai", "anthropic"].includes(model.apiFormat)).map(model => this.hostedConnection(`hosted:${model.id}`));
  }

  async reportModelEvaluation(event, timeoutMs = 10_000) {
    this.expireAccountSessionIfNeeded();
    const configuration = this.configuration, token = accountToken(configuration);
    if (!configuration?.origin || !token) throw cloudSignInRequiredError("Sign in to PenEcho Cloud on this computer before reporting model evaluation feedback.");
    return forwardModelEvaluation(fetch, configuration.origin, token, event, timeoutMs);
  }

  reportLocalModelUsage(event) {
    const record = localUsageRecord(event), configuration = this.configuration;
    const token = accountToken(configuration);
    if (!record || this.closed || !configuration?.origin || !token || (this.usageReportsPending || 0) >= 32) return false;
    this.usageReportsPending = (this.usageReportsPending || 0) + 1;
    // Capture the account at admission. A later sign-in must not reassign usage.
    void fetch(`${configuration.origin}/api/v1/activity/model-requests`, {
      method:"POST", redirect:"error", signal:AbortSignal.timeout(10_000),
      headers:{ authorization:`Bearer ${token}`, "content-type":"application/json" },
      body:JSON.stringify(record),
    }).then(response => response.body?.cancel()).catch(() => {}).finally(() => { this.usageReportsPending--; });
    return true;
  }

  enqueueModelEvaluation(event, ttlMs = MODEL_EVALUATION_QUEUE_TTL_MS) {
    if(this.closed||this.modelEvaluationQueue.length>=MODEL_EVALUATION_QUEUE_LIMIT)return false;
    const ttl=Math.max(1,Math.min(MODEL_EVALUATION_QUEUE_TTL_MS,Number(ttlMs)||MODEL_EVALUATION_QUEUE_TTL_MS));
    this.modelEvaluationQueue.push({event,expiresAt:Date.now()+ttl});
    setImmediate(()=>void this.drainModelEvaluationQueue());
    return true;
  }

  async drainModelEvaluationQueue() {
    if(this.modelEvaluationQueueRunning||this.closed)return;
    this.modelEvaluationQueueRunning=true;
    try{
      while(!this.closed&&this.modelEvaluationQueue.length){
        const item=this.modelEvaluationQueue.shift(),remaining=item.expiresAt-Date.now();
        if(remaining<=0)continue;
        try{await this.reportModelEvaluation(item.event,remaining);}catch{}
      }
    }finally{
      this.modelEvaluationQueueRunning=false;
      if(!this.closed&&this.modelEvaluationQueue.length)setImmediate(()=>void this.drainModelEvaluationQueue());
    }
  }

  async communityRequest(pathname) {
    if(!String(pathname).startsWith("/api/v1/community/"))throw new Error("Unsupported public community request.");
    this.expireAccountSessionIfNeeded();
    const origin=this.configuration?.origin||this.defaultOrigin,token=accountToken(this.configuration),response=await fetch(`${origin}${pathname}`,{
      method:"GET",
      redirect:"error",
      headers:{accept:"application/json",...(token?{authorization:`Bearer ${token}`}:{})},
    }),payload=await response.json().catch(()=>({}));
    if(!response.ok){
      if(response.status===401&&token)await this.confirmAccountSessionAfterUnauthorized(token,payload.message);
      const error=new Error(payload.message||`Community request failed (HTTP ${response.status}).`);
      error.status=response.status===401&&token?403:response.status;
      error.code=response.status===401&&token?(payload.error||"cloud_request_not_authorized"):(payload.error||"community_request_failed");
      throw error;
    }
    return payload;
  }

  async publicCanvasMessage({ origin } = {}) {
    const cloudOrigin = normalizedOrigin(origin || this.configuration?.origin || "https://penecho.ai");
    const response = await fetch(`${cloudOrigin}/api/v1/public/canvas-cloud-message`, {
      method:"GET",
      redirect:"error",
      headers:{ accept:"application/json" },
      signal:AbortSignal.timeout(PUBLIC_MESSAGE_TIMEOUT_MS),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(`Cloud message request failed (HTTP ${response.status}).`), { status:response.status });
    return { message:publicCanvasMessage(payload.message) };
  }

  async assetRequest(target, { method = "GET", bytes } = {}) {
    const configuration = this.requireCloudAccount();
    const url = cloudAssetUrl(target?.url, configuration.origin);
    const headers = {};
    for (const [key, value] of Object.entries(target?.headers || {})) {
      const normalized = key.toLowerCase();
      if (normalized === "content-type" || normalized.startsWith("x-amz-")) headers[normalized] = String(value);
    }
    let response;
    try {
      response = await fetch(url, { method, redirect: "error", headers, body: bytes, signal:AbortSignal.timeout(CLOUD_REQUEST_TIMEOUT_MS) });
    } catch (error) {
      throw temporaryCloudError(error, configuration.origin);
    }
    if (!response.ok) {
      const error = new Error(`Cloud storage transfer failed (HTTP ${response.status}). Your Canvas is still safe on this device; try Save again.`);
      error.status = TEMPORARY_CLOUD_STATUSES.has(response.status) ? 503 : response.status;
      error.code = "cloud_storage_transfer_failed";
      throw error;
    }
    return response;
  }

  async signIn({ origin, code, callback = null }) {
    const signInSeq = ++this.accountSignInSeq;
    const cloudOrigin = normalizedOrigin(origin);
    const response = await fetch(`${cloudOrigin}/api/v1/local-access/session`, {
      method: "POST",
      redirect: "error",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ code, ...(callback ? { callback } : {}) }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.accessToken || !payload.account?.id) {
      throw new Error(payload.message || `Cloud sign-in failed (HTTP ${response.status}).`);
    }
    if (signInSeq !== this.accountSignInSeq) {
      throw Object.assign(new Error("A newer PenEcho Cloud sign-in replaced this request."), { code:"cloud_sign_in_superseded" });
    }
    const account = publicAccount(payload.account);
    const accountUpdatedAt = Date.now();
    const sameOrigin = this.configuration?.origin === cloudOrigin;
    this.account = account;
    this.accountUpdatedAt = accountUpdatedAt;
    this.accountLastError = null;
    this.writeConfiguration({
      ...(sameOrigin ? this.configuration : {}),
      version: 2,
      origin: cloudOrigin,
      accountToken: payload.accessToken,
      accountExpiresAt: payload.expiresAt || null,
      account,
      accountUpdatedAt,
    });
    this.startAccountRefresh();
    return this.status();
  }

  beginBrowserSignIn({ origin, callbackUrl }) {
    const cloudOrigin = normalizedOrigin(origin);
    const callback = new URL(String(callbackUrl || ""));
    if (callback.protocol !== "http:" || !isLocalCanvasHost(callback.hostname) || callback.username || callback.password || callback.pathname !== BROWSER_CALLBACK_PATH || callback.search || callback.hash) {
      throw new Error("Cloud sign-in callback must use this local PenEcho server.");
    }
    for (const [pendingState, pending] of this.browserAuthorizations) if (pending.expiresAt <= Date.now()) this.browserAuthorizations.delete(pendingState);
    const state = randomBytes(32).toString("base64url");
    const expiresAt = Date.now() + BROWSER_AUTHORIZATION_MS;
    callback.searchParams.set("state", state);
    const authorizationUrl = new URL("/dashboard.html", cloudOrigin);
    authorizationUrl.searchParams.set("local_callback", callback.toString());
    authorizationUrl.searchParams.set("local_client", "penecho-canvas");
    this.browserAuthorizations.set(state, { state, origin: cloudOrigin, callback:callback.toString(), callbackOrigin: callback.origin, expiresAt });
    return { authorizationUrl: authorizationUrl.toString(), expiresAt };
  }

  async completeBrowserSignIn({ state, code, callbackOrigin }) {
    const stateValue = String(state || "");
    const pending = this.browserAuthorizations.get(stateValue);
    if (!pending || pending.expiresAt <= Date.now()) throw Object.assign(new Error("This browser sign-in request expired. Start again from local PenEcho."), { status: 401 });
    const actual = Buffer.from(stateValue);
    const expected = Buffer.from(pending.state);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw Object.assign(new Error("Cloud sign-in state did not match this local request."), { status: 403 });
    }
    if (new URL(String(callbackOrigin || "")).origin !== pending.callbackOrigin) {
      throw Object.assign(new Error("Cloud sign-in returned to a different local Canvas address."), { status: 403 });
    }
    const authorizationCode = String(code || "").trim();
    if (authorizationCode.length < 24 || authorizationCode.length > 256) throw Object.assign(new Error("The Cloud authorization code is invalid."), { status: 400 });
    this.browserAuthorizations.delete(stateValue);
    return this.signIn({ origin: pending.origin, code: authorizationCode, callback:pending.callback });
  }

  async refreshAccount({ force = false } = {}) {
    if (!force && this.accountUpdatedAt && Date.now() - this.accountUpdatedAt < ACCOUNT_REFRESH_INTERVAL_MS) return this.status();
    const current = this.requireCloudAccount();
    try {
      const response = await fetch(`${current.origin}/api/v1/local-access/session`, {
        method: "GET",
        redirect: "error",
        headers: { authorization: `Bearer ${current.accountToken}`, accept: "application/json" },
        signal:AbortSignal.timeout(CLOUD_REQUEST_TIMEOUT_MS),
      });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 401 && (accountToken(this.configuration) !== current.accountToken || this.configuration?.origin !== current.origin)) {
        throw Object.assign(new Error("A newer PenEcho Cloud sign-in replaced this account check."), { status:409, code:"cloud_request_superseded" });
      }
      if (response.status === 401 && payload.error === "invalid_local_session") {
        if (this.clearAccountSessionIfCurrent(current.accountToken)) {
          throw cloudSignInRequiredError("The local PenEcho Cloud account session is no longer valid. Sign in on this computer again.");
        }
        throw Object.assign(new Error("A newer PenEcho Cloud sign-in replaced this account check."), { status:409, code:"cloud_request_superseded" });
      }
      if (response.status === 401) {
        throw Object.assign(new Error(payload.message || "Cloud could not authoritatively validate the local account session."), {
          status:503,
          code:"cloud_session_validation_untrusted",
        });
      }
      if (!response.ok || !payload.account?.id) {
        throw new Error(payload.message || `Cloud account refresh failed (HTTP ${response.status}).`);
      }
      // A previous account refresh may finish after a newer browser sign-in.
      // Never let that older response overwrite the newly issued session.
      if (accountToken(this.configuration) !== current.accountToken || this.configuration?.origin !== current.origin) return this.status();
      this.account = publicAccount(payload.account);
      this.accountUpdatedAt = Date.now();
      this.accountLastError = null;
      const accountExpiresAt = payload.expiresAt !== undefined ? (payload.expiresAt || null) : (this.configuration.accountExpiresAt || null);
      this.writeConfiguration({ ...this.configuration, account:this.account, accountExpiresAt, accountUpdatedAt:this.accountUpdatedAt });
      return this.status();
    } catch (error) {
      this.accountLastError = safeMessage(error);
      throw error;
    }
  }

  async confirmAccountSessionAfterUnauthorized(expectedToken, message = "") {
    if (!expectedToken || accountToken(this.configuration) !== expectedToken) {
      throw Object.assign(new Error("A newer PenEcho Cloud sign-in replaced this request."), { status:409, code:"cloud_request_superseded" });
    }
    try {
      await this.refreshAccount({ force:true });
    } catch (error) {
      if (error?.code === "cloud_sign_in_required" || error?.code === "cloud_request_superseded") throw error;
      if (accountToken(this.configuration) !== expectedToken) {
        throw Object.assign(new Error("A newer PenEcho Cloud sign-in replaced this request."), { status:409, code:"cloud_request_superseded" });
      }
      throw temporaryCloudError(error, this.configuration?.origin);
    }
    throw Object.assign(new Error(message || "PenEcho Cloud rejected this request while the account session remains valid."), {
      status:403,
      code:"cloud_request_not_authorized",
    });
  }

  clearAccountSession() {
    this.account = null;
    this.accountUpdatedAt = null;
    const configuration = { ...this.configuration };
    delete configuration.accountToken;
    delete configuration.accountExpiresAt;
    delete configuration.account;
    delete configuration.accountUpdatedAt;
    this.writeConfiguration(configuration);
  }

  clearAccountSessionIfCurrent(expectedToken) {
    if (!expectedToken || accountToken(this.configuration) !== expectedToken) return false;
    this.clearAccountSession();
    return true;
  }

  expireAccountSessionIfNeeded() {
    if (!accountSessionExpired(this.configuration)) return false;
    this.clearAccountSession();
    this.accountLastError = null;
    this.log("account-session-expired");
    return true;
  }

  async signOut() {
    this.accountSignInSeq++;
    const configuration = this.configuration;
    const token = configuration?.accountToken;
    this.clearAccountSession();
    this.accountLastError = null;
    if (token && configuration?.origin) {
      try {
        const response = await fetch(`${configuration.origin}/api/v1/local-access/session`, {
          method: "DELETE",
          redirect: "error",
          headers: { authorization: `Bearer ${token}`, accept: "application/json" },
          signal: AbortSignal.timeout(ACCOUNT_SIGNOUT_TIMEOUT_MS),
        });
        if (!response.ok && response.status !== 401) {
          const payload = await response.json().catch(() => ({}));
          const error = new Error(payload.message || `Cloud sign-out failed (HTTP ${response.status}).`);
          error.status = response.status;
          throw error;
        }
      } catch (error) {
        this.log("account-signout-remote-failed", { error: safeMessage(error) });
      }
    }
    return this.status();
  }

  async library(params = null) {
    const requestedWithToken = accountToken(this.configuration);
    const query = new URLSearchParams();
    for (const key of ["limit", "offset", "q", "projectId", "sort", "locale", "previews"]) if (params?.has(key)) query.set(key, params.get(key));
    const payload = await this.cloudRequest(`/api/v1/device-sync/library${query.size ? `?${query}` : ""}`);
    if (payload?.account && requestedWithToken && accountToken(this.configuration) === requestedWithToken) {
      this.account = publicAccount(payload.account);
      this.accountUpdatedAt = Date.now();
      this.accountLastError = null;
      if (this.configuration) this.writeConfiguration({ ...this.configuration, account:this.account, accountUpdatedAt:this.accountUpdatedAt });
    }
    if (payload?.account) payload.account = publicAccount(payload.account);
    return payload;
  }

  listWidgetFavorites({ summary = false, limit = null, cursor = null } = {}) {
    const search = new URLSearchParams();
    if (summary) search.set("view", "summary");
    if (limit !== null && limit !== undefined && limit !== "") search.set("limit", String(limit));
    if (cursor) search.set("cursor", String(cursor));
    return this.cloudRequest(`/api/v1/favorites${search.size ? `?${search}` : ""}`);
  }
  listNotes(cursor = "") {
    return this.cloudRequest(`/api/v1/notes${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
  }
  getNote(id) { return this.cloudRequest(`/api/v1/notes/${encodeURIComponent(id)}`); }
  saveNote(id, entry, expectedVersion) {
    return this.cloudRequest(`/api/v1/notes/${encodeURIComponent(id)}`, { method:"PUT", body:{ entry, expectedVersion } });
  }

  favoriteFeed(query = {}) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
    return this.cloudRequest(`/api/v1/favorites/feed${search.size ? `?${search}` : ""}`);
  }

  getWidgetFavorite(favoriteId) {
    return this.cloudRequest(`/api/v1/favorites/${encodeURIComponent(favoriteId)}`);
  }

  async widgetFavoriteThumbnail(favoriteId) {
    this.expireAccountSessionIfNeeded();
    const configuration=this.configuration,token=accountToken(configuration);
    if(!configuration?.origin||!token)throw Object.assign(new Error("Sign in to PenEcho Cloud on this computer first."),{status:401,code:"cloud_account_required"});
    const response=await fetch(`${configuration.origin}/api/v1/favorites/${encodeURIComponent(favoriteId)}/thumbnail`,{method:"GET",redirect:"error",headers:{accept:"image/webp",authorization:`Bearer ${token}`}});
    if(!response.ok){
      if(response.status===401)await this.confirmAccountSessionAfterUnauthorized(token,"PenEcho Cloud rejected this favorite thumbnail request.");
      throw Object.assign(new Error(`Favorite thumbnail request failed (HTTP ${response.status}).`),{status:response.status===401?403:response.status,code:response.status===401?"cloud_request_not_authorized":"favorite_thumbnail_failed"});
    }
    const contentType=String(response.headers.get("content-type")||"").split(";",1)[0].toLowerCase(),bytes=Buffer.from(await response.arrayBuffer());
    if(contentType!=="image/webp"||!bytes.length||bytes.length>96*1024*1024)throw new Error("PenEcho Cloud returned an invalid favorite thumbnail.");
    return {contentType,bytes};
  }

  async saveWidgetFavorite(favorite) {
    const result = await this.cloudRequest("/api/v1/favorites", { method:"POST", body:{ name:favorite.name, artifact:favorite.artifact, thumbnail:favorite.thumbnail || "", sourceItemId:favorite.sourceItemId || null, sourceWidgetId:favorite.sourceWidgetId || null } });
    return result.favorite;
  }

  deleteWidgetFavorite(favoriteId) {
    return this.cloudRequest(`/api/v1/favorites/${encodeURIComponent(favoriteId)}`, { method:"DELETE" });
  }

  communityItems(query = {}) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
    return this.communityRequest(`/api/v1/community/items${search.size ? `?${search}` : ""}`);
  }

  communityItem(itemId) {
    return this.communityRequest(`/api/v1/community/items/${encodeURIComponent(itemId)}`);
  }

  async communityImage(itemId,variant="preview") {
    this.expireAccountSessionIfNeeded();
    const origin=this.configuration?.origin||this.defaultOrigin,token=accountToken(this.configuration),suffix=variant==="thumbnail"?"thumbnail":"preview";
    const response = await fetch(`${origin}/api/v1/community/items/${encodeURIComponent(itemId)}/${suffix}`, { method:"GET", redirect:"error", headers:{ accept:"image/webp",...(token?{authorization:`Bearer ${token}`}:{}) } });
    if (!response.ok) {
      if(response.status===401&&token)await this.confirmAccountSessionAfterUnauthorized(token,"PenEcho Cloud rejected this community image request.");
      throw Object.assign(new Error(`Community preview request failed (HTTP ${response.status}).`), {
        status:response.status===401&&token?403:response.status,
        code:response.status===401&&token?"cloud_request_not_authorized":"community_image_failed",
      });
    }
    const contentType = String(response.headers.get("content-type") || "").split(";", 1)[0].toLowerCase(), bytes = Buffer.from(await response.arrayBuffer());
    if (contentType !== "image/webp" || !bytes.length || bytes.length > 4 * 1024 * 1024) throw new Error("PenEcho Cloud returned an invalid community preview.");
    return { contentType, bytes };
  }

  communityPreview(itemId) { return this.communityImage(itemId,"preview"); }

  communityThumbnail(itemId) { return this.communityImage(itemId,"thumbnail"); }

  async shareCommunityItem({ kind, name, description = "", category, tags = [], artifact, parentItemId = null, contributionNote = "", continuationPrompt = "", publicationTermsAccepted = false, publicationRightsAccepted = false, modelTrainingAccepted = false, publicationTermsVersion = "" }) {
    if (!["widget", "canvas"].includes(kind) || !artifact || typeof artifact !== "object") throw new Error("The community share is invalid.");
    const normalizedName=String(name || "").trim(),normalizedDescription=String(description || "").trim();
    if(!normalizedName)throw Object.assign(new Error("A title is required."),{status:400,code:"community_title_required"});
    if(!normalizedDescription)throw Object.assign(new Error("A description is required."),{status:400,code:"community_description_required"});
    const artifactLineage=communityArtifactLineage(kind,artifact),submittedParent=String(parentItemId || "").trim() || null;
    if(artifactLineage?.itemId&&submittedParent&&artifactLineage.itemId!==submittedParent)throw Object.assign(new Error("The submitted Craft parent does not match this artifact's saved lineage."),{status:409,code:"community_lineage_mismatch"});
    const effectiveParentItemId=artifactLineage?.itemId||submittedParent,bytes=Buffer.from(JSON.stringify(artifact)),maximum=kind==="widget"?10*1024*1024:MAX_CLOUD_BUNDLE_BYTES;
    if(!bytes.length||bytes.length>maximum)throw new Error(`The shared ${kind} is too large.`);
    const reservation=await this.cloudRequest("/api/v1/community/items",{method:"POST",body:{
      kind,name:normalizedName,description:normalizedDescription,category,tags,priceCredits:0,parentItemId:effectiveParentItemId,
      contributionNote:String(contributionNote||"").trim(),continuationPrompt:String(continuationPrompt||"").trim(),
      publicationTermsAccepted:publicationTermsAccepted===true,publicationRightsAccepted:publicationRightsAccepted===true,
      modelTrainingAccepted:modelTrainingAccepted===true,publicationTermsVersion:String(publicationTermsVersion||""),
      formatVersion:Number(artifact.formatVersion||1),artifact:{sha256:sha256(bytes),sizeBytes:bytes.length,contentType:"application/json"},
    }});
    await this.assetRequest(reservation.upload,{method:"PUT",bytes});
    return this.cloudRequest(`/api/v1/community/items/${encodeURIComponent(reservation.item.id)}/complete`,{method:"POST",body:{}});
  }

  favoriteCommunityItem(itemId, favorite = true) {
    return this.cloudRequest(`/api/v1/community/items/${encodeURIComponent(itemId)}/favorite`, { method:favorite ? "POST" : "DELETE", body:favorite ? {} : undefined });
  }

  redeemCommunityItem(itemId) {
    return this.cloudRequest(`/api/v1/community/items/${encodeURIComponent(itemId)}/redeem`, { method:"POST", body:{} });
  }

  async downloadCommunityItem(itemId) {
    const result = await this.cloudRequest(`/api/v1/community/items/${encodeURIComponent(itemId)}/artifact`);
    const response = await this.assetRequest(result.download);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length !== Number(result.item?.artifact?.sizeBytes)
      || sha256(bytes).toLowerCase() !== String(result.item?.artifact?.sha256 || "").toLowerCase()) throw new Error("The community artifact failed checksum verification.");
    let artifact;
    try { artifact = JSON.parse(bytes.toString("utf8")); }
    catch { throw new Error("The community artifact is invalid."); }
    return { item:result.item, artifact };
  }

  createCloudFolder(input) {
    return this.cloudRequest("/api/v1/device-sync/folders", { method: "POST", body: input });
  }

  createCloudProject(input) {
    return this.cloudRequest("/api/v1/device-sync/projects", { method: "POST", body: input });
  }

  updateCloudProject(projectId, input) {
    return this.cloudRequest(`/api/v1/device-sync/projects/${encodeURIComponent(projectId)}`, { method:"PATCH", body:input });
  }

  deleteCloudProject(projectId) {
    return this.cloudRequest(`/api/v1/device-sync/projects/${encodeURIComponent(projectId)}`, { method:"DELETE" });
  }

  // The account's Cloud project for a folder on this computer; project is the
  // folder's link, shared with Cloud's agents here.
  folderProject(folder, { signal, project } = {}) {
    return this.cloudRequest("/api/v1/device-sync/folder-projects", { method:"POST", body:{ folder, ...(project ? { project } : {}) }, signal });
  }

  folderProjectTabs(folder, change) {
    return this.cloudRequest("/api/v1/device-sync/folder-projects/tabs", { method:"POST", body:{ folder, ...change } });
  }

  createCloudCanvas(projectId, input) {
    return this.cloudRequest(`/api/v1/device-sync/projects/${encodeURIComponent(projectId)}/canvases`, { method: "POST", body: input });
  }

  updateCloudCanvas(canvasId, input) {
    return this.cloudRequest(`/api/v1/device-sync/canvases/${encodeURIComponent(canvasId)}`, { method:"PATCH", body:input });
  }

  trashCloudCanvas(canvasId) {
    return this.cloudRequest(`/api/v1/device-sync/canvases/${encodeURIComponent(canvasId)}`, { method: "DELETE" });
  }

  async cloudCanvasThumbnail(canvasId) {
    const configuration = this.requireCloudAccount();
    const response = await fetch(`${configuration.origin}/api/v1/device-sync/canvases/${encodeURIComponent(canvasId)}/thumbnail`, {
      method: "GET",
      redirect: "error",
      headers: { authorization: `Bearer ${configuration.accountToken}`, accept: "image/webp" },
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      if (response.status === 401 && configuration.accountToken) {
        await this.confirmAccountSessionAfterUnauthorized(configuration.accountToken, "PenEcho Cloud rejected this Canvas thumbnail request.");
      }
      throw Object.assign(new Error(`Cloud thumbnail request failed (HTTP ${response.status}).`), {
        status:response.status === 401 ? 403 : response.status,
        code:response.status === 401 ? "cloud_request_not_authorized" : "cloud_thumbnail_failed",
      });
    }
    const contentType = String(response.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
    const bytes = Buffer.from(await response.arrayBuffer());
    if (contentType !== "image/webp" || !bytes.length || bytes.length > 512 * 1024) throw new Error("Cloud returned an invalid Canvas thumbnail.");
    return { bytes, contentType };
  }

  // replace: the save takes the place of the one it starts from (no versions),
  // under the bundle's name.
  async saveCloudCanvas({ canvasId, baseRevisionId = null, bundle, replace = false }) {
    if (!canvasId || bundle?.bundleVersion !== 2 || !bundle.manifest || !Array.isArray(bundle.assets)) throw new Error("The cloud Canvas bundle is invalid.");
    const bundleBytes = Buffer.from(JSON.stringify(bundle));
    if (!bundleBytes.length || bundleBytes.length > MAX_CLOUD_BUNDLE_BYTES) throw new Error("The cloud Canvas bundle is too large for local synchronization.");
    const bundleHash = sha256(bundleBytes);
    const reservation = await this.cloudRequest(`/api/v1/device-sync/canvases/${encodeURIComponent(canvasId)}/revisions`, {
      method: "POST",
      body: {
        baseRevisionId,
        formatVersion: bundle.formatVersion,
        mode: bundle.mode || "snapshot",
        bundle: { sha256: bundleHash, sizeBytes: bundleBytes.length, contentType: "application/json" },
      },
    });
    try {
      await this.assetRequest(reservation.bundle.upload, { method: "PUT", bytes: bundleBytes });
      const name = typeof bundle.name === "string" ? bundle.name.trim().slice(0, 160) : "";
      return await this.completeCloudCanvasRevision(canvasId, reservation.revisionId, { replace, name });
    } catch (error) {
      // A best-effort cancel releases the Cloud quota reservation. If completion
      // actually succeeded, Cloud treats this as a no-op and keeps the revision.
      try { await this.cloudRequest(`/api/v1/device-sync/canvas-revisions/${encodeURIComponent(reservation.revisionId)}`, { method:"DELETE" }); } catch {}
      throw error;
    }
  }

  async createAndSaveCloudCanvas({ projectId, name, bundle }) {
    const created = await this.createCloudCanvas(projectId, { name });
    const canvas = created?.canvas;
    if (!canvas?.id) throw new Error("PenEcho Cloud did not create the Canvas.");
    try {
      const saved = await this.saveCloudCanvas({ canvasId:canvas.id, baseRevisionId:null, bundle });
      return { canvas:{ ...canvas, currentRevisionId:saved.revision.id, updatedAt:saved.revision.completedAt || Date.now() }, revision:saved.revision };
    } catch (error) {
      // Creation and object upload are separate Cloud operations. Keep a failed
      // first save out of the active library while retaining recoverability.
      try { await this.trashCloudCanvas(canvas.id); } catch {}
      throw error;
    }
  }

  async completeCloudCanvasRevision(canvasId, revisionId, { replace = false, name = "" } = {}) {
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const completed = await this.cloudRequest(`/api/v1/device-sync/canvas-revisions/${encodeURIComponent(revisionId)}/complete`, { method: "POST", body: replace ? { replace:true, ...(name ? { name } : {}) } : {} });
        if (completed?.revision?.id === revisionId) return completed;
        lastError = new Error("PenEcho Cloud returned an invalid Canvas revision confirmation.");
      } catch (error) {
        lastError = error;
      }
    }
    try {
      const latest = await this.cloudRequest(`/api/v1/device-sync/canvases/${encodeURIComponent(canvasId)}/revisions/latest`);
      if (latest?.revision?.id === revisionId && latest.revision.status === "complete") return { revision: latest.revision };
    } catch (error) {
      lastError ||= error;
    }
    throw lastError || new Error("PenEcho Cloud could not confirm the saved Canvas revision.");
  }

  async loadCloudCanvas(canvasId) {
    const latest = await this.cloudRequest(`/api/v1/device-sync/canvases/${encodeURIComponent(canvasId)}/revisions/latest`);
    if (!latest.revision) return { revision: null, bundle: null };
    const response = await this.assetRequest(latest.bundle.download);
    const bundleBytes = Buffer.from(await response.arrayBuffer());
    if (!bundleBytes.length || bundleBytes.length > MAX_CLOUD_BUNDLE_BYTES || bundleBytes.length !== Number(latest.bundle.sizeBytes)
      || sha256(bundleBytes).toLowerCase() !== String(latest.bundle.sha256 || "").toLowerCase()) throw new Error("The cloud Canvas bundle failed checksum verification.");
    const bundle = JSON.parse(bundleBytes.toString("utf8"));
    if (bundle?.bundleVersion !== 2 || !Array.isArray(bundle.assets)) throw new Error("The cloud Canvas bundle is invalid.");
    return { revision: latest.revision, bundle };
  }

  start() {
    this.startAccountRefresh();
  }

  startAccountRefresh() {
    if (this.accountRefreshTimer) return;
    this.accountRefreshTimer = setInterval(() => {
      if (!accountToken(this.configuration)) return;
      this.refreshAccount({ force: true }).catch((error) => this.log("account-refresh-failed", { error: safeMessage(error) }));
    }, ACCOUNT_REFRESH_INTERVAL_MS);
    this.accountRefreshTimer.unref?.();
  }

  close() {
    this.closed = true;
    this.modelEvaluationQueue.length = 0;
    this.invalidateSuggestionStatus();
    this.suggestionTransport?.close?.();
    clearInterval(this.accountRefreshTimer);
    this.accountRefreshTimer = null;
  }
}

module.exports = { CloudConnector, accountSessionExpired, normalizedOrigin, publicCanvasMessage };
