"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const net = require("net");
const { createHash, randomBytes, timingSafeEqual } = require("crypto");
const { WebSocket } = require("ws");

const MAX_RELAY_MESSAGE_BYTES = 140 * 1024 * 1024;
const MAX_CLOUD_BUNDLE_BYTES = 32 * 1024 * 1024;
const DEFAULT_HEARTBEAT_SECONDS = 60;
const ACCOUNT_REFRESH_INTERVAL_MS = 5 * 60_000;
const ACCOUNT_SIGNOUT_TIMEOUT_MS = 5_000;
const CLOUD_REQUEST_TIMEOUT_MS = 30_000;
const BROWSER_AUTHORIZATION_MS = 10 * 60_000;
const PUBLIC_MESSAGE_TIMEOUT_MS = 3_500;
const BROWSER_CALLBACK_PATH = "/api/cloud/sign-in/callback";
const CLOUD_AI_CONTEXT_KEY = "__penechoCloudAi";
const LOCAL_CONNECTION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizedCloudAiConnectionId(value) {
  const connectionId = typeof value === "string" ? value.trim() : "";
  return LOCAL_CONNECTION_ID_PATTERN.test(connectionId) ? connectionId : null;
}

function cloudAiRelayRequest(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || !Object.hasOwn(payload, CLOUD_AI_CONTEXT_KEY)) {
    return { payload, connectionId:null };
  }
  const context = payload[CLOUD_AI_CONTEXT_KEY], cleanPayload = { ...payload };
  delete cleanPayload[CLOUD_AI_CONTEXT_KEY];
  const connectionId = context && typeof context === "object" && !Array.isArray(context) && context.version === 1
    ? normalizedCloudAiConnectionId(context.connectionId)
    : null;
  return { payload:cleanPayload, connectionId };
}

function cloudAiConnectionHeaders(context) {
  const connectionId = normalizedCloudAiConnectionId(context?.connectionId);
  return connectionId ? { "x-penecho-connection":connectionId } : {};
}

function normalizedOrigin(value) {
  const url = new URL(String(value || "").trim());
  const loopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname.toLowerCase());
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) throw new Error("Cloud origin must use HTTPS.");
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("Cloud origin must be an origin without a path, query, or credentials.");
  return url.origin;
}

function defaultDeviceName() {
  return `${os.hostname()} PenEcho server`;
}

function defaultPlatform() {
  return `${os.platform()} ${os.release()}`;
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

function reconnectDelayMs(attempt, random = Math.random) {
  const retry = Math.max(0, Math.floor(Number(attempt) || 0));
  const base = retry < 3 ? 10_000 : retry < 8 ? 60_000 : 300_000;
  const sample = Math.max(0, Math.min(1, Number(random()) || 0));
  return Math.round(base * (0.8 + sample * 0.4));
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

function deviceToken(configuration) {
  return configuration?.deviceToken || configuration?.token || null;
}

function accountToken(configuration) {
  return configuration?.accountToken || (configuration?.legacyAccountAccess ? deviceToken(configuration) : null);
}

function accountSessionExpired(configuration, now = Date.now()) {
  if (!configuration?.accountToken || configuration.legacyAccountAccess || !configuration.accountExpiresAt) return false;
  const expiresAt = Date.parse(configuration.accountExpiresAt);
  // Malformed local metadata is not proof that the Cloud session expired.
  // Preserve the credential and let the authoritative session endpoint
  // validate it instead of destructively signing the user out.
  return Number.isFinite(expiresAt) && expiresAt <= now;
}

class CloudConnector {
  constructor({ stateDir, executeRequest, executeHttpRequest = null, logger = null, defaultOrigin = "https://penecho.ai", capabilities = null, heartbeatTimeoutMs = null }) {
    this.stateDir = stateDir;
    this.file = path.join(stateDir, "cloud-device.json");
    this.executeRequest = executeRequest;
    this.executeHttpRequest = executeHttpRequest;
    this.logger = logger;
    this.defaultOrigin = normalizedOrigin(defaultOrigin);
    this.capabilities = Object.freeze({ modelConfigured:Boolean(capabilities?.modelConfigured) });
    this.configuration = this.readConfiguration();
    this.socket = null;
    this.heartbeatTimer = null;
    this.heartbeatDeadlineTimer = null;
    this.heartbeatTimeoutOverrideMs = Number.isFinite(heartbeatTimeoutMs) && heartbeatTimeoutMs > 0 ? heartbeatTimeoutMs : null;
    this.heartbeatTimedOutSocket = null;
    this.helloTimer = null;
    this.reconnectTimer = null;
    this.accountRefreshTimer = null;
    this.reconnectAttempt = 0;
    this.stopped = false;
    this.connectionState = "disconnected";
    this.lastConnectedAt = null;
    this.lastSeenAt = null;
    this.lastError = null;
    this.account = publicAccount(this.configuration?.account);
    this.accountUpdatedAt = Number(this.configuration?.accountUpdatedAt || 0) || null;
    this.accountLastError = null;
    this.browserAuthorizations = new Map();
    this.accountSignInSeq = 0;
    this.deviceOperationSeq = 0;
    this.expireAccountSessionIfNeeded();
  }

  log(event, details = {}) {
    this.logger?.({ type: "cloud-connector", event, ...details });
  }

  readConfiguration() {
    try {
      const contents = fs.readFileSync(this.file, "utf8");
      try { fs.chmodSync(this.file, 0o600); } catch {}
      const value = JSON.parse(contents);
      if (!value || typeof value !== "object" || !value.origin) return null;
      const legacyDeviceToken = typeof value.token === "string" && value.token ? value.token : null;
      const configuration = {
        ...value,
        version: 2,
        origin: normalizedOrigin(value.origin),
        deviceToken: value.deviceToken || legacyDeviceToken,
        legacyAccountAccess: Boolean(value.legacyAccountAccess || (legacyDeviceToken && !value.accountToken)),
        enabled: value.enabled !== false,
        account: publicAccount(value.account),
      };
      delete configuration.token;
      if (!configuration.deviceToken && !configuration.accountToken) return null;
      return configuration;
    } catch {
      return null;
    }
  }

  writeConfiguration(configuration) {
    if (!configuration?.origin || (!deviceToken(configuration) && !configuration.accountToken)) {
      this.configuration = null;
      try { fs.unlinkSync(this.file); } catch (error) { if (error.code !== "ENOENT") throw error; }
      return;
    }
    const normalized = {
      ...configuration,
      version: 2,
      origin: normalizedOrigin(configuration.origin),
      deviceToken: deviceToken(configuration),
      legacyAccountAccess: Boolean(configuration.legacyAccountAccess || (configuration.token && !configuration.accountToken)),
      account: publicAccount(configuration.account),
    };
    if (!normalized.deviceToken) delete normalized.deviceToken;
    if (!normalized.account) delete normalized.account;
    delete normalized.token;
    fs.mkdirSync(this.stateDir, { recursive: true });
    const temporary = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(normalized, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporary, this.file);
    try { fs.chmodSync(this.file, 0o600); } catch {}
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
    const configured = Boolean(deviceToken(this.configuration));
    const accountSignedIn = Boolean(this.configuration?.accountToken || this.configuration?.legacyAccountAccess);
    const accountStale = Boolean(this.account && (!this.accountUpdatedAt || Date.now() - this.accountUpdatedAt > ACCOUNT_REFRESH_INTERVAL_MS * 2));
    return {
      configured,
      enabled: configured && Boolean(this.configuration?.enabled),
      connected: this.connectionState === "connected",
      state: this.connectionState,
      origin: this.configuration?.origin || null,
      deviceId: this.configuration?.deviceId || null,
      deviceName: this.configuration?.deviceName || null,
      lastConnectedAt: this.lastConnectedAt,
      lastSeenAt: this.lastSeenAt,
      lastError: this.lastError,
      account: publicAccount(this.account),
      accountSession: {
        signedIn: accountSignedIn,
        expiresAt: this.configuration?.accountExpiresAt || null,
        updatedAt: this.accountUpdatedAt,
        stale: accountStale,
        lastError: this.accountLastError,
        credential: this.configuration?.legacyAccountAccess ? "legacy-device" : accountSignedIn ? "opaque-local-session" : null,
      },
      browserSignIn: {
        pending: Boolean(pending),
        expiresAt: pending?.expiresAt || null,
      },
      device: {
        configured,
        enabled: configured && Boolean(this.configuration?.enabled),
        connected: this.connectionState === "connected",
        state: this.connectionState,
        id: this.configuration?.deviceId || null,
        name: this.configuration?.deviceName || null,
      },
      privacy: {
        apiKeysLeaveDevice: false,
        requestContentUsesCloudRelay: true,
        endToEndEncrypted: false,
      },
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

  async cloudRequest(pathname, { method = "GET", body } = {}) {
    const configuration = this.requireCloudAccount();
    if (!["/api/v1/device-sync/", "/api/v1/community/", "/api/v1/favorites"].some((prefix) => String(pathname).startsWith(prefix))) throw new Error("Unsupported cloud account request.");
    let response;
    try {
      response = await fetch(`${configuration.origin}${pathname}`, {
        method,
        redirect: "error",
        headers: {
          authorization: `Bearer ${configuration.accountToken}`,
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal:AbortSignal.timeout(CLOUD_REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw temporaryCloudError(error, configuration.origin);
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) {
        if (!configuration.legacyAccountAccess) {
          await this.confirmAccountSessionAfterUnauthorized(configuration.accountToken, payload.message);
        }
        throw Object.assign(new Error(payload.message || "PenEcho Cloud rejected this account request."), {
          status:403,
          code:payload.error || "cloud_request_not_authorized",
        });
      }
      const temporary = [502, 503, 504].includes(response.status);
      const error = new Error(temporary
        ? `${configuration.origin.includes("internaltest.penecho.ai") ? "UAT Cloud" : "PenEcho Cloud"} is temporarily unavailable (HTTP ${response.status}). Your Canvas is still safe on this device. Try Save again in a moment.`
        : payload.message || `Cloud account request failed (HTTP ${response.status}).`);
      error.status = response.status;
      error.code = temporary ? "cloud_temporarily_unavailable" : payload.error || "cloud_request_failed";
      throw error;
    }
    return payload;
  }

  async communityRequest(pathname) {
    if(!String(pathname).startsWith("/api/v1/community/"))throw new Error("Unsupported public community request.");
    this.expireAccountSessionIfNeeded();
    const origin=this.configuration?.origin||this.defaultOrigin,token=accountToken(this.configuration),legacyAccountAccess=Boolean(this.configuration?.legacyAccountAccess),response=await fetch(`${origin}${pathname}`,{
      method:"GET",
      redirect:"error",
      headers:{accept:"application/json",...(token?{authorization:`Bearer ${token}`}:{})},
    }),payload=await response.json().catch(()=>({}));
    if(!response.ok){
      if(response.status===401&&token&&!legacyAccountAccess)await this.confirmAccountSessionAfterUnauthorized(token,payload.message);
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
      error.status = [502, 503, 504].includes(response.status) ? 503 : response.status;
      error.code = "cloud_storage_transfer_failed";
      throw error;
    }
    return response;
  }

  async signIn({ origin, code, callback = null }) {
    const signInSeq = ++this.accountSignInSeq;
    const cloudOrigin = normalizedOrigin(origin);
    if (this.configuration?.origin && this.configuration.origin !== cloudOrigin && deviceToken(this.configuration)) {
      throw new Error("Disconnect or revoke the device linked to the current Cloud address before signing in to another address.");
    }
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
      legacyAccountAccess: false,
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
    if (this.configuration?.origin && this.configuration.origin !== cloudOrigin && deviceToken(this.configuration)) {
      throw new Error("Disconnect or revoke the device linked to the current Cloud address before signing in to another address.");
    }
    for (const [pendingState, pending] of this.browserAuthorizations) if (pending.expiresAt <= Date.now()) this.browserAuthorizations.delete(pendingState);
    const state = randomBytes(32).toString("base64url");
    const expiresAt = Date.now() + BROWSER_AUTHORIZATION_MS;
    callback.searchParams.set("state", state);
    const authorizationUrl = new URL("/dashboard.html", cloudOrigin);
    authorizationUrl.searchParams.set("local_callback", callback.toString());
    authorizationUrl.searchParams.set("local_client", "penecho-canvas");
    authorizationUrl.hash = "devices";
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
    if (current.legacyAccountAccess) {
      await this.library();
      return this.status();
    }
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
      this.writeConfiguration({ ...this.configuration, account:this.account, accountExpiresAt:payload.expiresAt || this.configuration.accountExpiresAt || null, accountUpdatedAt:this.accountUpdatedAt });
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
    configuration.legacyAccountAccess = false;
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

  async library() {
    const requestedWithToken = accountToken(this.configuration);
    const payload = await this.cloudRequest("/api/v1/device-sync/library");
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
    const configuration=this.configuration,token=accountToken(configuration),legacyAccountAccess=Boolean(configuration?.legacyAccountAccess);
    if(!configuration?.origin||!token)throw Object.assign(new Error("Sign in to PenEcho Cloud on this computer first."),{status:401,code:"cloud_account_required"});
    const response=await fetch(`${configuration.origin}/api/v1/favorites/${encodeURIComponent(favoriteId)}/thumbnail`,{method:"GET",redirect:"error",headers:{accept:"image/webp",authorization:`Bearer ${token}`}});
    if(!response.ok){
      if(response.status===401&&!legacyAccountAccess)await this.confirmAccountSessionAfterUnauthorized(token,"PenEcho Cloud rejected this favorite thumbnail request.");
      throw Object.assign(new Error(`Favorite thumbnail request failed (HTTP ${response.status}).`),{status:response.status===401?403:response.status,code:response.status===401?"cloud_request_not_authorized":"favorite_thumbnail_failed"});
    }
    const contentType=String(response.headers.get("content-type")||"").split(";",1)[0].toLowerCase(),bytes=Buffer.from(await response.arrayBuffer());
    if(contentType!=="image/webp"||!bytes.length||bytes.length>96*1024*1024)throw new Error("PenEcho Cloud returned an invalid favorite thumbnail.");
    return {contentType,bytes};
  }

  async saveWidgetFavorite(favorite) {
    const result = await this.cloudRequest("/api/v1/favorites", { method:"POST", body:{ name:favorite.name, artifact:favorite.artifact, thumbnail:favorite.thumbnail || "", sourceItemId:favorite.sourceItemId || null } });
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
    const origin=this.configuration?.origin||this.defaultOrigin,token=accountToken(this.configuration),legacyAccountAccess=Boolean(this.configuration?.legacyAccountAccess),suffix=variant==="thumbnail"?"thumbnail":"preview";
    const response = await fetch(`${origin}/api/v1/community/items/${encodeURIComponent(itemId)}/${suffix}`, { method:"GET", redirect:"error", headers:{ accept:"image/webp",...(token?{authorization:`Bearer ${token}`}:{}) } });
    if (!response.ok) {
      if(response.status===401&&token&&!legacyAccountAccess)await this.confirmAccountSessionAfterUnauthorized(token,"PenEcho Cloud rejected this community image request.");
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
      if (response.status === 401 && configuration.accountToken && !configuration.legacyAccountAccess) {
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

  async saveCloudCanvas({ canvasId, baseRevisionId = null, bundle }) {
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
      return await this.completeCloudCanvasRevision(canvasId, reservation.revisionId);
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

  async completeCloudCanvasRevision(canvasId, revisionId) {
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const completed = await this.cloudRequest(`/api/v1/device-sync/canvas-revisions/${encodeURIComponent(revisionId)}/complete`, { method: "POST", body: {} });
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
  async pair({ origin, code, name = defaultDeviceName(), platform = defaultPlatform(), publicKey = null }) {
    const deviceOperationSeq = ++this.deviceOperationSeq;
    const cloudOrigin = normalizedOrigin(origin);
    const accountConfiguration = this.requireCloudAccount();
    if (accountConfiguration.origin !== cloudOrigin) {
      throw new Error("Pair this computer with the same PenEcho Cloud account that is signed in locally.");
    }
    const response = await fetch(`${cloudOrigin}/api/v1/device/pair`, {
      method: "POST",
      redirect: "error",
      headers: { "content-type": "application/json", accept: "application/json", authorization: `Bearer ${accountConfiguration.accountToken}` },
      body: JSON.stringify({ code, name, platform, publicKey }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.token || !payload.device?.id) throw new Error(payload.message || `Cloud pairing failed (HTTP ${response.status}).`);
    if (deviceOperationSeq !== this.deviceOperationSeq) throw Object.assign(new Error("A newer device-link action replaced this request."), { code:"cloud_device_action_superseded" });
    if (accountToken(this.configuration) !== accountConfiguration.accountToken || this.configuration?.origin !== accountConfiguration.origin) {
      throw cloudSignInRequiredError("The local PenEcho Cloud account changed while this device was linking. Start Link device again.");
    }
    const existing = this.configuration;
    const configuration = {
      ...(existing || {}),
      version: 2,
      origin: cloudOrigin,
      deviceToken: payload.token,
      deviceId: payload.device.id,
      deviceName: payload.device.name || name,
      platform: payload.device.platform || platform,
      enabled: true,
      pairedAt: new Date().toISOString(),
      legacyAccountAccess: false,
    };
    // A successful replacement invalidates the previous device credential.
    // Detach its socket before connect() checks readyState, otherwise an open
    // old relay can prevent the newly paired credential from ever connecting.
    const previousSocket = this.socket;
    this.socket = null;
    this.clearTimers();
    this.connectionState = "disconnected";
    if (previousSocket) {
      try { previousSocket.close(1000, "device re-paired"); } catch {}
    }
    this.writeConfiguration(configuration);
    if (configuration.accountToken) try { await this.refreshAccount({ force: true }); } catch {}
    this.stopped = false;
    this.reconnectAttempt = 0;
    this.connect();
    return this.status();
  }

  start() {
    this.stopped = false;
    this.startAccountRefresh();
    if (this.configuration?.enabled && deviceToken(this.configuration)) this.connect();
  }

  startAccountRefresh() {
    if (this.accountRefreshTimer) return;
    this.accountRefreshTimer = setInterval(() => {
      if (!accountToken(this.configuration)) return;
      this.refreshAccount({ force: true }).catch((error) => this.log("account-refresh-failed", { error: safeMessage(error) }));
    }, ACCOUNT_REFRESH_INTERVAL_MS);
    this.accountRefreshTimer.unref?.();
  }

  stop() {
    this.stopped = true;
    this.clearTimers();
    if (this.socket) {
      try { this.socket.close(1001, "local server stopping"); } catch {}
      this.socket = null;
    }
    this.connectionState = "disconnected";
  }

  close() {
    this.stop();
    clearInterval(this.accountRefreshTimer);
    this.accountRefreshTimer = null;
  }

  disconnect({ forget = false } = {}) {
    this.stop();
    if (forget) {
      const configuration = { ...this.configuration };
      for (const field of ["deviceToken", "deviceId", "deviceName", "platform", "enabled", "pairedAt"]) delete configuration[field];
      configuration.legacyAccountAccess = false;
      this.writeConfiguration(configuration);
    } else if (this.configuration) {
      this.writeConfiguration({ ...this.configuration, enabled: false });
    }
    return this.status();
  }

  enable() {
    if (!deviceToken(this.configuration)) throw new Error("This PenEcho server has not been paired.");
    this.writeConfiguration({ ...this.configuration, enabled: true });
    this.stopped = false;
    this.reconnectAttempt = 0;
    this.connect();
    return this.status();
  }

  async revokeDevice() {
    const deviceOperationSeq = ++this.deviceOperationSeq;
    const configuration = this.configuration;
    const token = deviceToken(configuration);
    if (!token || !configuration?.origin) throw new Error("This PenEcho server has not been paired.");
    const response = await fetch(`${configuration.origin}/api/v1/device-sync/device`, {
      method: "DELETE",
      redirect: "error",
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    });
    if (!response.ok && ![401, 404].includes(response.status)) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.message || `Device revocation failed (HTTP ${response.status}).`);
    }
    if (deviceOperationSeq !== this.deviceOperationSeq || deviceToken(this.configuration) !== token) return this.status();
    this.disconnect({ forget: true });
    return this.status();
  }

  clearTimers() {
    clearInterval(this.heartbeatTimer);
    clearTimeout(this.heartbeatDeadlineTimer);
    clearTimeout(this.helloTimer);
    clearTimeout(this.reconnectTimer);
    this.heartbeatTimer = null;
    this.heartbeatDeadlineTimer = null;
    this.helloTimer = null;
    this.reconnectTimer = null;
  }

  relayUrl() {
    const url = new URL(this.configuration.origin);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = "/relay/device";
    return url.toString();
  }

  connect() {
    const token = deviceToken(this.configuration);
    if (this.stopped || !this.configuration?.enabled || !token) return;
    if (this.socket && [WebSocket.CONNECTING, WebSocket.OPEN].includes(this.socket.readyState)) return;
    this.clearTimers();
    this.connectionState = "connecting";
    const socket = new WebSocket(this.relayUrl(), {
      headers: { authorization: `Bearer ${token}` },
      handshakeTimeout: 15_000,
      maxPayload: MAX_RELAY_MESSAGE_BYTES,
      perMessageDeflate: false,
    });
    this.socket = socket;

    socket.on("open", () => {
      if (this.socket !== socket) return socket.close();
      clearTimeout(this.helloTimer);
      this.helloTimer = setTimeout(() => {
        if (this.socket === socket && this.connectionState === "connecting") socket.close(4008, "relay authentication timed out");
      }, 15_000);
      this.helloTimer.unref?.();
      this.log("socket-open", { deviceId: this.configuration.deviceId });
    });

    socket.on("message", (data) => {
      if (data.length > MAX_RELAY_MESSAGE_BYTES) return socket.close(4009, "message too large");
      let message;
      try { message = JSON.parse(data.toString("utf8")); } catch { return socket.close(4002, "invalid message"); }
      if (message.type === "hello") {
        if (this.socket !== socket) return;
        if (message.protocol !== 1 || message.deviceId !== this.configuration?.deviceId) return socket.close(4002, "invalid relay hello");
        clearTimeout(this.helloTimer);
        this.helloTimer = null;
        this.connectionState = "connected";
        this.lastConnectedAt = Date.now();
        this.lastSeenAt = Date.now();
        this.lastError = null;
        this.reconnectAttempt = 0;
        socket.send(JSON.stringify({ type:"capabilities", capabilities:this.capabilities }));
        this.startHeartbeat(
          Number(message.heartbeatSeconds) || DEFAULT_HEARTBEAT_SECONDS,
          Number(message.heartbeatTimeoutSeconds) || null,
          socket,
        );
        if (accountToken(this.configuration)) this.refreshAccount({ force: true }).catch((error) => this.log("account-refresh-failed", { error: safeMessage(error) }));
        this.log("connected", { deviceId: this.configuration.deviceId });
        return;
      }
      if (this.socket === socket && this.connectionState === "connected") this.noteRelayActivity(socket);
      if (message.type === "heartbeat_ack") return;
      if (message.type === "request" && this.connectionState !== "connected") return socket.close(4002, "request before relay authentication");
      if (message.type === "request" && typeof message.requestId === "string") this.handleRequest(socket, message);
    });

    socket.on("close", (code, reason) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.clearTimers();
      const credentialInvalid = code === 4003;
      const heartbeatTimedOut = this.heartbeatTimedOutSocket === socket;
      if (heartbeatTimedOut) this.heartbeatTimedOutSocket = null;
      this.connectionState = credentialInvalid ? "invalid" : "disconnected";
      this.lastError = heartbeatTimedOut ? "Relay heartbeat acknowledgement timed out."
        : code === 1000 ? null : `Connection closed (${code}): ${String(reason || "")}`.trim();
      this.log("closed", { code });
      if (!credentialInvalid) this.scheduleReconnect();
    });

    socket.on("error", (error) => {
      this.lastError = safeMessage(error);
      this.log("error", { error: this.lastError });
    });
  }

  noteRelayActivity(socket) {
    if (this.socket !== socket || this.connectionState !== "connected") return;
    this.lastSeenAt = Date.now();
    clearTimeout(this.heartbeatDeadlineTimer);
    const timeoutMs = this.activeHeartbeatTimeoutMs;
    if (!timeoutMs) return;
    this.heartbeatDeadlineTimer = setTimeout(() => {
      if (this.socket !== socket || this.connectionState !== "connected") return;
      this.heartbeatTimedOutSocket = socket;
      this.lastError = "Relay heartbeat acknowledgement timed out.";
      this.log("heartbeat-timeout", { timeoutMs });
      if (typeof socket.terminate === "function") socket.terminate();
      else socket.close(4008, "relay heartbeat timed out");
    }, timeoutMs);
    this.heartbeatDeadlineTimer.unref?.();
  }

  startHeartbeat(seconds, timeoutSeconds = null, socket = this.socket) {
    clearInterval(this.heartbeatTimer);
    const interval = Math.max(5, Math.min(120, seconds)) * 1000;
    const configuredTimeout = Number.isFinite(timeoutSeconds) && timeoutSeconds > 0
      ? Math.max(15, Math.min(600, timeoutSeconds)) * 1000
      : null;
    // Old Cloud versions do not advertise or acknowledge a heartbeat timeout.
    // Keep those rolling-upgrade connections compatible until Cloud opts in.
    this.activeHeartbeatTimeoutMs = configuredTimeout ? this.heartbeatTimeoutOverrideMs || Math.max(interval + 5_000, configuredTimeout) : null;
    this.noteRelayActivity(socket);
    this.heartbeatTimer = setInterval(() => {
      if (this.socket === socket && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "heartbeat", sentAt: Date.now() }));
    }, interval);
    this.heartbeatTimer.unref?.();
  }

  scheduleReconnect() {
    if (this.stopped || !this.configuration?.enabled || !deviceToken(this.configuration)) return;
    const delay = reconnectDelayMs(this.reconnectAttempt++);
    this.connectionState = "waiting";
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
    this.reconnectTimer.unref?.();
  }

  async handleRequest(socket, message) {
    try {
      const operation = message.payload?.operation,
        remoteCanvas = operation === "canvas.http",
        canvasAi = operation === undefined,
        executor = remoteCanvas ? this.executeHttpRequest : this.executeRequest,
        timeoutMs = Number(message.timeoutMs) || 210_000;
      if (typeof executor !== "function") throw Object.assign(new Error("This PenEcho version does not support Remote Canvas."), { code:"remote_canvas_unsupported" });
      const relayRequest = canvasAi ? cloudAiRelayRequest(message.payload) : null,
        payload = relayRequest?.connectionId
          ? await executor(relayRequest.payload, timeoutMs, { connectionId:relayRequest.connectionId })
          : await executor(relayRequest ? relayRequest.payload : message.payload, timeoutMs);
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "response", requestId: message.requestId, ok: true, payload }));
    } catch (error) {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({
        type: "response",
        requestId: message.requestId,
        ok: false,
        error: error.code || "local_device_error",
        message: safeMessage(error),
      }));
    }
  }
}

module.exports = { CloudConnector, accountSessionExpired, cloudAiConnectionHeaders, cloudAiRelayRequest, normalizedOrigin, publicCanvasMessage, reconnectDelayMs };
