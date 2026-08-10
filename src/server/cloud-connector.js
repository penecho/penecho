"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const net = require("net");
const { createHash, randomBytes, timingSafeEqual } = require("crypto");
const { WebSocket } = require("ws");

const MAX_RELAY_MESSAGE_BYTES = 140 * 1024 * 1024;
const MAX_CLOUD_BUNDLE_BYTES = 32 * 1024 * 1024;
const DEFAULT_HEARTBEAT_SECONDS = 20;
const ACCOUNT_REFRESH_INTERVAL_MS = 5 * 60_000;
const ACCOUNT_SIGNOUT_TIMEOUT_MS = 5_000;
const BROWSER_AUTHORIZATION_MS = 10 * 60_000;
const PUBLIC_MESSAGE_TIMEOUT_MS = 3_500;
const BROWSER_CALLBACK_PATH = "/api/cloud/sign-in/callback";

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

function publicAccount(value) {
  if (!value?.id) return null;
  return {
    id: String(value.id),
    name: String(value.name || "PenEcho user"),
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
  return !Number.isFinite(expiresAt) || expiresAt <= now;
}

class CloudConnector {
  constructor({ stateDir, executeRequest, executeHttpRequest = null, logger = null, defaultOrigin = "https://penecho.ai" }) {
    this.stateDir = stateDir;
    this.file = path.join(stateDir, "cloud-device.json");
    this.executeRequest = executeRequest;
    this.executeHttpRequest = executeHttpRequest;
    this.logger = logger;
    this.defaultOrigin = normalizedOrigin(defaultOrigin);
    this.configuration = this.readConfiguration();
    this.socket = null;
    this.heartbeatTimer = null;
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
      throw Object.assign(new Error("The local PenEcho Cloud account session expired. Sign in on this computer again."), { status: 401 });
    }
    const token = accountToken(this.configuration);
    if (!token || !this.configuration?.origin) throw new Error("Connect your PenEcho Cloud account on this computer first.");
    return { ...this.configuration, accountToken: token };
  }

  async cloudRequest(pathname, { method = "GET", body } = {}) {
    const configuration = this.requireCloudAccount();
    if (!["/api/v1/device-sync/", "/api/v1/community/"].some((prefix) => String(pathname).startsWith(prefix))) throw new Error("Unsupported cloud account request.");
    const response = await fetch(`${configuration.origin}${pathname}`, {
      method,
      redirect: "error",
      headers: {
        authorization: `Bearer ${configuration.accountToken}`,
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 && this.configuration?.accountToken && !this.configuration?.legacyAccountAccess) this.clearAccountSession();
      const error = new Error(payload.message || `Cloud account request failed (HTTP ${response.status}).`);
      error.status = response.status;
      throw error;
    }
    return payload;
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
      if(response.status===401&&token&&!this.configuration?.legacyAccountAccess)this.clearAccountSession();
      const error=new Error(payload.message||`Community request failed (HTTP ${response.status}).`);
      error.status=response.status;
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
    const response = await fetch(url, { method, redirect: "error", headers, body: bytes });
    if (!response.ok) throw new Error(`Cloud storage transfer failed (HTTP ${response.status}).`);
    return response;
  }

  async signIn({ origin, code }) {
    const cloudOrigin = normalizedOrigin(origin);
    if (this.configuration?.origin && this.configuration.origin !== cloudOrigin && deviceToken(this.configuration)) {
      throw new Error("Disconnect or revoke the device linked to the current Cloud address before signing in to another address.");
    }
    const response = await fetch(`${cloudOrigin}/api/v1/local-access/session`, {
      method: "POST",
      redirect: "error",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ code }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.accessToken || !payload.account?.id) {
      throw new Error(payload.message || `Cloud sign-in failed (HTTP ${response.status}).`);
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
    this.browserAuthorizations.set(state, { state, origin: cloudOrigin, callbackOrigin: callback.origin, expiresAt });
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
    return this.signIn({ origin: pending.origin, code: authorizationCode });
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
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.account?.id) {
        if (response.status === 401) this.clearAccountSession();
        throw new Error(payload.message || `Cloud account refresh failed (HTTP ${response.status}).`);
      }
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

  expireAccountSessionIfNeeded() {
    if (!accountSessionExpired(this.configuration)) return false;
    this.clearAccountSession();
    this.accountLastError = null;
    this.log("account-session-expired");
    return true;
  }

  async signOut() {
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
    const payload = await this.cloudRequest("/api/v1/device-sync/library");
    if (payload?.account) {
      this.account = publicAccount(payload.account);
      this.accountUpdatedAt = Date.now();
      this.accountLastError = null;
      if (this.configuration) this.writeConfiguration({ ...this.configuration, account:this.account, accountUpdatedAt:this.accountUpdatedAt });
    }
    if (payload?.account) payload.account = publicAccount(payload.account);
    return payload;
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
    if (!response.ok) throw Object.assign(new Error(`Community preview request failed (HTTP ${response.status}).`), { status:response.status });
    const contentType = String(response.headers.get("content-type") || "").split(";", 1)[0].toLowerCase(), bytes = Buffer.from(await response.arrayBuffer());
    if (contentType !== "image/webp" || !bytes.length || bytes.length > 4 * 1024 * 1024) throw new Error("PenEcho Cloud returned an invalid community preview.");
    return { contentType, bytes };
  }

  communityPreview(itemId) { return this.communityImage(itemId,"preview"); }

  communityThumbnail(itemId) { return this.communityImage(itemId,"thumbnail"); }

  async shareCommunityItem({ kind, name, description = "", category, tags = [], priceCredits = 0, artifact }) {
    if (!["widget", "canvas"].includes(kind) || !artifact || typeof artifact !== "object") throw new Error("The community share is invalid.");
    const bytes = Buffer.from(JSON.stringify(artifact));
    const maximum = kind === "widget" ? 10 * 1024 * 1024 : MAX_CLOUD_BUNDLE_BYTES;
    if (!bytes.length || bytes.length > maximum) throw new Error(`The shared ${kind} is too large.`);
    const reservation = await this.cloudRequest("/api/v1/community/items", {
      method:"POST",
      body:{
        kind,
        name:String(name || "").trim(),
        description:String(description || "").trim(),
        category,
        tags,
        priceCredits:Number(priceCredits || 0),
        formatVersion:Number(artifact.formatVersion || 1),
        artifact:{ sha256:sha256(bytes), sizeBytes:bytes.length, contentType:"application/json" },
      },
    });
    await this.assetRequest(reservation.upload, { method:"PUT", bytes });
    return this.cloudRequest(`/api/v1/community/items/${encodeURIComponent(reservation.item.id)}/complete`, { method:"POST", body:{} });
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
      if (response.status === 401 && this.configuration?.accountToken && !this.configuration?.legacyAccountAccess) this.clearAccountSession();
      throw Object.assign(new Error(`Cloud thumbnail request failed (HTTP ${response.status}).`), { status: response.status });
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
    await this.assetRequest(reservation.bundle.upload, { method: "PUT", bytes: bundleBytes });
    return this.completeCloudCanvasRevision(canvasId, reservation.revisionId);
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
    this.disconnect({ forget: true });
    return this.status();
  }

  clearTimers() {
    clearInterval(this.heartbeatTimer);
    clearTimeout(this.helloTimer);
    clearTimeout(this.reconnectTimer);
    this.heartbeatTimer = null;
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
      this.lastSeenAt = Date.now();
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
        this.startHeartbeat(Number(message.heartbeatSeconds) || DEFAULT_HEARTBEAT_SECONDS);
        if (accountToken(this.configuration)) this.refreshAccount({ force: true }).catch((error) => this.log("account-refresh-failed", { error: safeMessage(error) }));
        this.log("connected", { deviceId: this.configuration.deviceId });
        return;
      }
      if (message.type === "request" && this.connectionState !== "connected") return socket.close(4002, "request before relay authentication");
      if (message.type === "request" && typeof message.requestId === "string") this.handleRequest(socket, message);
    });

    socket.on("close", (code, reason) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.clearTimers();
      const credentialInvalid = code === 4003;
      this.connectionState = credentialInvalid ? "invalid" : "disconnected";
      this.lastError = code === 1000 ? null : `Connection closed (${code}): ${String(reason || "")}`.trim();
      this.log("closed", { code });
      if (!credentialInvalid) this.scheduleReconnect();
    });

    socket.on("error", (error) => {
      this.lastError = safeMessage(error);
      this.log("error", { error: this.lastError });
    });
  }

  startHeartbeat(seconds) {
    clearInterval(this.heartbeatTimer);
    const interval = Math.max(5, Math.min(120, seconds)) * 1000;
    this.heartbeatTimer = setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({ type: "heartbeat", sentAt: Date.now() }));
        this.lastSeenAt = Date.now();
      }
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
      const executor = message.payload?.operation === "canvas.http" ? this.executeHttpRequest : this.executeRequest;
      if (typeof executor !== "function") throw Object.assign(new Error("This PenEcho version does not support Remote Canvas."), { code:"remote_canvas_unsupported" });
      const payload = await executor(message.payload, Number(message.timeoutMs) || 210_000);
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

module.exports = { CloudConnector, accountSessionExpired, normalizedOrigin, publicCanvasMessage, reconnectDelayMs };
