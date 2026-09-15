"use strict";

(() => {
  const canvasMatch = location.pathname.match(/^\/canvas\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/?$/i);
  const communityMatch = location.pathname.match(/^\/canvas\/community\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/?$/i);
  if (window.PENECHO_CONFIG?.runtime !== "cloud" || (!canvasMatch && !communityMatch)) return;
  const requestedCanvasId = canvasMatch?.[1] || null;
  const requestedCommunityItemId = communityMatch?.[1] || null;
  const isCommunityCraft = Boolean(requestedCommunityItemId);

  const nativeFetch = window.fetch.bind(window);
  const nativeWebSocket = window.WebSocket;
  const cloudRuntime = window.PENECHO_CONFIG?.runtime === "cloud";
  const nativeCloudCanvasReadsEnabled = window.PENECHO_CONFIG?.remoteCanvasNativeReads === true;
  const deviceIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const widgetPaintReadyFrames = new WeakSet();
  const widgetPaintReadyWaiters = new Set();
  let bridgeDeviceId = "";
  let bridgeDeviceLinked = false;
  let browserEditing = false;
  const hostedExecutionSessionId = crypto.randomUUID();
  const hostedExecutionSessionStartedAt = Date.now();
  let hostedGeneration = 0;
  let resolveBridgeGate = null;
  let bridgeState = { online:!cloudRuntime };
  let refreshPending = null;
  let readyRefreshTimer = null;
  let readyRefreshDeadline = 0;
  let deviceRetryAttempt = 0;
  let deviceRetryStopped = false;
  let deviceRetrySuspended = false;
  let bridgeGateSettled = !cloudRuntime;
  const bridgeGate = cloudRuntime
    ? new Promise((resolve) => { resolveBridgeGate = resolve; })
    : Promise.resolve({ online:true });
  function settleBridgeGate(state) {
    bridgeState = state;
    if (bridgeGateSettled) return;
    bridgeGateSettled = true;
    resolveBridgeGate?.(state);
  }
  function linkedDeviceRetryDelay(attempt, random = Math.random) {
    const base = attempt < 3 ? 10000 : attempt < 8 ? 60000 : 300000;
    return Math.round(base * (0.8 + Math.max(0, Math.min(1, random())) * 0.4));
  }
  function scheduleLinkedDeviceRefresh({ uncertain = false } = {}) {
    if (readyRefreshTimer !== null || deviceRetryStopped || deviceRetrySuspended || bridgeState?.ready) return;
    if (!uncertain && !bridgeDeviceId && !bridgeDeviceLinked) return;
    const waitingForCapabilities = bridgeState?.online && readyRefreshDeadline && Date.now() < readyRefreshDeadline;
    const delay = waitingForCapabilities ? 500 : linkedDeviceRetryDelay(deviceRetryAttempt++);
    readyRefreshTimer = setTimeout(() => {
      readyRefreshTimer = null;
      void window.PenEchoLinkedDevice.refresh({ automatic:true }).catch(() => {});
    }, delay);
    readyRefreshTimer?.unref?.();
  }
  function invalidateLinkedDevice() {
    clearTimeout(readyRefreshTimer);
    readyRefreshTimer = null;
    readyRefreshDeadline = 0;
    bridgeState = { online:false };
    window.PENECHO_CONFIG.linkedDeviceOnline = false;
    window.PENECHO_CONFIG.linkedDeviceReady = false;
    if (browserEditing) window.PENECHO_CONFIG.canvasAgent = false;
    const previous = window.PENECHO_REMOTE_CLOUD_STATUS;
    if (previous) {
      const detail = Object.freeze({ ...previous, deviceOnline:false, deviceReady:false });
      window.PENECHO_REMOTE_CLOUD_STATUS = detail;
      window.dispatchEvent(new CustomEvent("penecho:remote-cloud-status", { detail }));
    }
    window.dispatchEvent(new CustomEvent("penecho:capabilities-changed"));
    scheduleLinkedDeviceRefresh({ uncertain:true });
  }
  function unavailableBridgeResponse(state, code = "device_offline") {
    const payload = {
      error:code,
      code,
      message:state?.message || "Your linked PenEcho host is offline.",
    };
    if (typeof Response === "function") return new Response(JSON.stringify(payload), { status:409, headers:{ "content-type":"application/json" } });
    return { ok:false, status:409, headers:new Headers({ "content-type":"application/json" }), json:async () => payload };
  }
  const bridgedPaths = [
    /^\/api\/settings(?:\/|$)/,
    /^\/api\/favorites(?:\/|$)/,
    /^\/api\/canvas-agent\/(?:projects|roots|files)(?:\/|$)/,
    /^\/api\/canvas-projects(?:\/|$)/,
    /^\/api\/canvases(?:\/|$)/,
    /^\/api\/cloud(?:\/|$)/,
    /^\/api\/community\/metadata$/,
    /^\/api\/plugins(?:\/|$)/,
    /^\/canvas\/api\/widget-fetch$/,
    /^\/api\/widget-fetch$/,
    /^\/canvas\/plugins\/private\/[a-z0-9][a-z0-9-]{0,63}(?:\/(?:plugin\.md|styles\.css)|\.md)$/,
  ];
  const nativeCloudPaths = new Set(["/api/ai/command", "/api/plugins/improve", "/api/community/metadata"]);
  function jsonResponse(payload, status = 200) {
    return new Response(JSON.stringify(payload), { status, headers:{ "content-type":"application/json" } });
  }
  function browserOnlyRequest(sourceUrl, method, options, headers) {
    if (bridgeDeviceLinked && method === "GET" && ["/api/settings", "/api/settings/connections"].includes(sourceUrl.pathname)) return Promise.resolve(unavailableBridgeResponse(bridgeState));
    if (sourceUrl.pathname === "/api/settings" && method === "GET") return Promise.resolve(jsonResponse({ provider:"api", connections:[], connectionLimit:0, hasApiKey:false, cli:{}, requestTrace:false }));
    if (sourceUrl.pathname === "/api/settings/connections" && method === "GET") return Promise.resolve(jsonResponse({ connections:[] }));
    if (["/api/canvases", "/api/canvas-projects"].includes(sourceUrl.pathname) && method === "GET") {
      const code = bridgeDeviceLinked ? "device_offline" : "linked_device_required";
      return Promise.resolve(jsonResponse({ error:code, code }, 409));
    }
    // Widget hosts retain the relay-shaped POST contract so the same client
    // works with older linked devices. In Cloud-native Canvas mode, resolve
    // that public-data request against Cloud's account-scoped proxy instead
    // of sending it through the unavailable device relay.
    if (sourceUrl.pathname === "/api/v1/remote-canvas/http" && method === "POST"
      && sourceUrl.searchParams.get("path") === "/api/widget-fetch") {
      let body = null;
      try { body = JSON.parse(String(options.body || "")); } catch {}
      const url = typeof body?.url === "string" ? body.url : "";
      if (!url) return Promise.resolve(jsonResponse({ error:"widget_fetch_url_invalid" }, 400));
      return nativeFetch(`/api/v1/widget-fetch?url=${encodeURIComponent(url)}`, { method:"GET", credentials:"same-origin", cache:"no-store", headers });
    }
    if (["/canvas/api/widget-fetch", "/api/widget-fetch"].includes(sourceUrl.pathname)) return nativeFetch(`/api/v1/widget-fetch${sourceUrl.search}`, { ...options, method, headers, credentials:"same-origin" });
    if (sourceUrl.pathname.startsWith("/api/cloud/") || sourceUrl.pathname === "/api/plugins") return nativeFetch(sourceUrl.pathname + sourceUrl.search, { ...options, method, headers, credentials:"same-origin" });
    const code = bridgeDeviceLinked ? "device_offline" : "linked_device_required";
    return Promise.resolve(jsonResponse({ error:code, code, message:"This feature needs a linked PenEcho device. Browser editing supports Cloud saves and PenEcho models; local files, CLI tools and private API forwarding stay on your device." }, 409));
  }

  function notifyWidgetPaintReadyWaiters() {
    for (const resolve of widgetPaintReadyWaiters) resolve();
    widgetPaintReadyWaiters.clear();
  }

  window.addEventListener("message", (event) => {
    if (event.origin !== location.origin || !event.source || !event.data || typeof event.data !== "object") return;
    if (event.data.type === "penecho-widget-host-ready") {
      widgetPaintReadyFrames.delete(event.source);
      notifyWidgetPaintReadyWaiters();
    } else if (event.data.type === "penecho-widget-capture-ready") {
      widgetPaintReadyFrames.add(event.source);
      notifyWidgetPaintReadyWaiters();
    }
  });

  // Only the actual Canvas-owned host frames can use this public GET channel.
  // Resolve the pinned device at request time; the relay verifies current ownership
  // and liveness, so an offline device can reconnect without a stale status cache.
  function ownsWidgetHost(source) {
    return [...document.querySelectorAll(".canvas-widget .canvas-widget-frame")].some((frame) => {
      if (frame.contentWindow !== source) return false;
      try {
        const url = new URL(frame.src, location.href);
        return url.origin === location.origin && url.pathname === "/canvas/widget-host.html";
      } catch { return false; }
    });
  }
  async function fetchWidgetPublicData(url) {
    const headers = csrfHeaders();
    if (nativeCloudCanvasReadsEnabled) return nativeFetch(`/api/v1/widget-fetch?url=${encodeURIComponent(url)}`, { method:"GET", credentials:"same-origin", cache:"no-store", headers });
    await bridgeGate;
    if (bridgeDeviceId) {
      const path = `/api/widget-fetch?url=${encodeURIComponent(url)}`;
      const response = await nativeFetch(`/api/v1/remote-canvas/http?path=${encodeURIComponent(path)}&deviceId=${encodeURIComponent(bridgeDeviceId)}`, {
        method:"GET", credentials:"same-origin", cache:"no-store", headers,
      });
      if (response.ok) return response;
      const failure = await response.clone().json().catch(() => ({}));
      if (response.status !== 409 || failure.error !== "device_offline") return response;
    }
    return nativeFetch(`/api/v1/widget-fetch?url=${encodeURIComponent(url)}`, { method:"GET", credentials:"same-origin", cache:"no-store", headers });
  }
  window.addEventListener("message", (event) => {
    const message = event.data;
    if (event.origin !== location.origin || !event.source || message?.type !== "penecho-widget-host-public-fetch"
      || !ownsWidgetHost(event.source) || typeof message.requestId !== "string" || !/^widget-fetch-\d{1,16}$/.test(message.requestId)
      || typeof message.url !== "string" || message.url.length > 16384) return;
    let url;
    try { url = new URL(message.url); } catch { return; }
    if (url.protocol !== "https:" || url.username || url.password) return;
    const reply = (payload, transfer = []) => {
      if (ownsWidgetHost(event.source)) event.source.postMessage({ type:"penecho-widget-host-public-fetch-result", requestId:message.requestId, ...payload }, location.origin, transfer);
    };
    void (async () => {
      try {
        const response = await fetchWidgetPublicData(url.href), body = await response.arrayBuffer();
        if (body.byteLength > 5 * 1024 * 1024) throw Error("The public data response is too large");
        const headers = {};
        for (const name of ["content-type", "x-penecho-upstream-status", "x-penecho-final-url"]) {
          const value = response.headers.get(name);
          if (value) headers[name] = value;
        }
        reply({ status:response.status, headers, body }, [body]);
      } catch (error) { reply({ error:String(error?.message || "The public data request failed").slice(0, 300) }); }
    })();
  });

  function nextCanvasPaint() {
    return new Promise((resolve) => {
      if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(() => window.requestAnimationFrame(resolve));
      else setTimeout(resolve, 0);
    });
  }

  function visibleWidgetFrames() {
    return [...document.querySelectorAll(".canvas-widget:not(.widget-offscreen) .canvas-widget-frame")]
      .filter((frame) => frame?.contentWindow);
  }

  async function waitForVisibleWidgets(timeoutMs = 15_000) {
    const deadline = Date.now() + timeoutMs;
    await nextCanvasPaint();
    while (true) {
      const frames = visibleWidgetFrames();
      if (frames.every((frame) => widgetPaintReadyFrames.has(frame.contentWindow))) {
        await nextCanvasPaint();
        const settledFrames = visibleWidgetFrames();
        if (settledFrames.every((frame) => widgetPaintReadyFrames.has(frame.contentWindow))) return;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) return;
      await new Promise((resolve) => {
        const finish = () => {
          clearTimeout(timer);
          widgetPaintReadyWaiters.delete(finish);
          resolve();
        };
        const timer = setTimeout(finish, remaining);
        widgetPaintReadyWaiters.add(finish);
      });
    }
  }

  function canvasAgentWebSocketTarget(value) {
    if (!bridgeDeviceId) return value;
    try {
      const target = new URL(String(value), location.href), page = new URL(location.href);
      const expectedProtocol = page.protocol === "https:" ? "wss:" : "ws:";
      if (target.protocol !== expectedProtocol || target.host !== page.host || !["/api/v1/remote-canvas/canvas-agent", "/api/v1/remote-canvas/mcp"].includes(target.pathname)) return value;
      target.searchParams.set("deviceId", bridgeDeviceId);
      return target.toString();
    } catch { return value; }
  }

  if (typeof nativeWebSocket === "function") {
    window.WebSocket = class PenEchoRemoteCanvasWebSocket extends nativeWebSocket {
      constructor(url, protocols) {
        const target = canvasAgentWebSocketTarget(url);
        if (arguments.length > 1) super(target, protocols);
        else super(target);
      }
    };
  }

  function cookie(name) {
    const prefix = `${encodeURIComponent(name)}=`;
    for (const part of document.cookie.split(";")) {
      const value = part.trim();
      if (value.startsWith(prefix)) return decodeURIComponent(value.slice(prefix.length));
    }
    return "";
  }

  function csrfHeaders(source) {
    const headers = new Headers(source || {}), token = cookie("penecho_csrf");
    if (token && !headers.has("x-penecho-csrf")) headers.set("x-penecho-csrf", token);
    return headers;
  }

  window.fetch = (input, options = {}) => {
    const sourceUrl = new URL(input instanceof Request ? input.url : input, document.baseURI || location.href);
    if (sourceUrl.origin !== location.origin) return nativeFetch(input, options);
    const method = String(options.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    const inputHeaders = input instanceof Request ? input.headers : undefined;
    const headers = csrfHeaders(options.headers || inputHeaders);
    if (cloudRuntime && sourceUrl.pathname === "/api/mcp/status") {
      if(window.PenEchoCloudMcpSocket)return nativeFetch('/api/v1/mcp/canvas/status',{...options,method:'GET',body:undefined,headers,credentials:'same-origin'});
      return bridgeGate.then(() => bridgeState?.online && bridgeDeviceId
        ? nativeFetch(`/api/v1/remote-canvas/mcp/status?deviceId=${encodeURIComponent(bridgeDeviceId)}`, { ...options, method:"GET", body:undefined, headers, credentials:"same-origin" })
        : unavailableBridgeResponse(bridgeState, bridgeDeviceLinked ? "device_offline" : "linked_device_required"));
    }
    const hostedModel = /^hosted:([0-9a-f-]{36})$/i.exec(headers.get("x-penecho-connection") || "");
    if (sourceUrl.pathname === "/api/community/metadata" && method === "POST" && hostedModel) {
      return nativeFetch("/api/community/metadata", { ...options, method, headers, credentials:"same-origin" });
    }
    const executionScope = () => window.PenEchoCloudProjects?.currentExecutionScope?.()
      || { canvasId:window.PenEchoCloudProjects?.currentCanvasId?.() || null, draft:false };
    if (sourceUrl.pathname === "/api/ai/command" && method === "POST" && hostedModel) {
      const scope = executionScope();
      if (!scope.canvasId) return Promise.resolve(jsonResponse({ error:"cloud_canvas_initializing", message:"Canvas is still initializing. Retry in a moment." }, 409));
      const command = JSON.parse(options.body || "{}");
      headers.set("idempotency-key", crypto.randomUUID());
      headers.set("content-type", "application/json");
      const execution = { executionSessionId:hostedExecutionSessionId, executionSessionStartedAt:hostedExecutionSessionStartedAt, generation:++hostedGeneration };
      return (async () => {
        let executionCanvasId = scope.canvasId;
        if (scope.draft) {
          const response = await nativeFetch("/api/v1/hosted/draft-scopes", { ...options, method:"POST", headers, credentials:"same-origin", body:JSON.stringify({draftId:scope.canvasId}) });
          if (!response.ok) return response;
          executionCanvasId = (await response.json()).canvasId;
        }
        const current = () => { const value=executionScope(); return value.canvasId===scope.canvasId && value.draft===scope.draft; };
        if (!current()) return jsonResponse({ error:"cloud_canvas_changed", message:"The active Canvas changed. Retry on the current Canvas." }, 409);
        return nativeFetch(`/api/v1/hosted/canvases/${executionCanvasId}/execution-fence`, { ...options, method, headers, credentials:"same-origin", body:JSON.stringify(execution) }).then(async (fence) => {
          if (!fence.ok) return fence;
          if (!current()) return jsonResponse({ error:"cloud_canvas_changed", message:"The active Canvas changed. Retry on the current Canvas." }, 409);
          return nativeFetch("/api/v1/hosted/commands", { ...options, method, headers, credentials:"same-origin", body:JSON.stringify({ modelId:hostedModel[1], canvasId:executionCanvasId, command, ...execution }) });
        });
      })();
    }
    const nativeCloudRequest = nativeCloudCanvasReadsEnabled && (
      sourceUrl.pathname.startsWith("/api/cloud/")
      || sourceUrl.pathname === "/api/plugins"
    );
    const localCommand = !hostedModel && (nativeCloudCanvasReadsEnabled && nativeCloudPaths.has(sourceUrl.pathname) || sourceUrl.pathname === "/api/community/metadata");
    if (hostedModel && sourceUrl.pathname === "/api/plugins/improve" && bridgeDeviceId) headers.set("x-penecho-device", bridgeDeviceId);
    if (localCommand && sourceUrl.pathname !== "/api/community/metadata" && !headers.has("x-penecho-connection")) headers.set("x-penecho-connection", "default");
    const shouldBridge = !nativeCloudRequest && (localCommand || (!nativeCloudPaths.has(sourceUrl.pathname) && bridgedPaths.some((pattern) => pattern.test(sourceUrl.pathname))));
    const bridgePath = sourceUrl.pathname === "/canvas/api/widget-fetch"
      ? "/api/widget-fetch"
      : sourceUrl.pathname.startsWith("/canvas/plugins/private/")
        ? sourceUrl.pathname.slice("/canvas".length)
        : sourceUrl.pathname;
    const request = () => {
      const target = shouldBridge
        ? `/api/v1/remote-canvas/http?path=${encodeURIComponent(`${bridgePath}${sourceUrl.search}`)}${bridgeDeviceId ? `&deviceId=${encodeURIComponent(bridgeDeviceId)}` : ""}`
        : `${sourceUrl.pathname}${sourceUrl.search}`;
      return nativeFetch(target, { ...options, method, headers, credentials:"same-origin" }).then(async (response) => {
        if ((shouldBridge || sourceUrl.pathname === "/api/v1/remote-canvas/http") && [502,503,504].includes(response.status)) invalidateLinkedDevice();
        if ((shouldBridge || sourceUrl.pathname === "/api/v1/remote-canvas/http") && response.status === 409 && typeof response.clone === "function") {
          const payload = await response.clone().json().catch(() => ({}));
          if (["device_offline", "device_timeout", "device_connecting"].includes(payload.error || payload.code)) {
            invalidateLinkedDevice();
          }
        }
        return response;
      });
    };
    if (nativeCloudCanvasReadsEnabled && ["/canvas/api/widget-fetch", "/api/widget-fetch"].includes(sourceUrl.pathname)) return browserOnlyRequest(sourceUrl, method, options, headers);
    if (sourceUrl.pathname === "/api/v1/remote-canvas/http") return bridgeGate.then(() => {
      // Explicit relay callers must stay bound to the same authoritative host.
      if (bridgeState?.online && bridgeDeviceId) {
        sourceUrl.searchParams.set("deviceId", bridgeDeviceId);
        return request();
      }
      return browserEditing ? browserOnlyRequest(sourceUrl, method, options, headers) : unavailableBridgeResponse(bridgeState, bridgeDeviceLinked ? "device_offline" : "linked_device_required");
    });
    if (!shouldBridge || !cloudRuntime) return request();
    return bridgeGate.then(() => bridgeState?.online ? request() : browserEditing ? browserOnlyRequest(sourceUrl, method, options, headers) : unavailableBridgeResponse(bridgeState));
  };

  const zh = /^zh\b/i.test(navigator.language || "");
  const copy = zh ? {
    eyebrow:"私人云端画布", checking:"正在连接你的 PenEcho 主机…", noHost:"连接 PenEcho 主机后即可打开",
    offline:"已连接的 PenEcho 主机当前离线", failed:"这张画布暂时无法打开",
    dashboard:"连接设备", back:"返回项目",
    connected:"受保护的远程连接", unavailable:"请先连接一台 PenEcho 主机。", opening:"主机在线，正在打开云端画布…",
    offlineStatus:"离线", onlineStatus:"在线",
  } : {
    eyebrow:"Private Cloud Canvas", checking:"Connecting to your PenEcho host…", noHost:"Connect one PenEcho host to open this Canvas",
    offline:"Your linked PenEcho host is offline", failed:"This Canvas could not be opened",
    dashboard:"Link Device", back:"Back to Projects",
    connected:"Protected remote connection", unavailable:"No device is linked yet. Install PenEcho, then connect one main computer from Link Device.", opening:"Host online. Opening your Cloud Canvas…",
    offlineStatus:"Offline", onlineStatus:"Online",
  };
  if (isCommunityCraft) Object.assign(copy, zh ? {
    eyebrow:"公开 Craft", noHost:"连接 PenEcho 主机后即可 Echo 此创作", back:"返回 Echoes",
    failed:"暂时无法继续这个 Craft", opening:"主机在线，正在导入这个 Craft…",
  } : {
    eyebrow:"Public Craft", noHost:"Connect one PenEcho host to Echo this Craft", back:"Back to Echoes",
    failed:"This Craft could not be continued right now", opening:"Host online. Importing this Craft…",
  });

  // The PenEcho brand in the top bar doubles as the way back: the toolbar stays
  // uncluttered and the escape hatch lives where users expect a home control.
  const brandTarget = isCommunityCraft ? "/community.html" : "/dashboard.html";
  const brand = document.querySelector(".brand");
  if (brand) {
    brand.setAttribute("data-home-link", "true");
    brand.setAttribute("role", "link");
    brand.setAttribute("tabindex", "0");
    brand.title = copy.back;
    brand.setAttribute("aria-label", copy.back);
    brand.addEventListener("click", () => { location.assign(brandTarget); });
    brand.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); location.assign(brandTarget); } });
  }

  // The gate is a compact status view, not a landing page. The only action it
  // ever offers is Link Device, revealed solely while no device is linked
  // (gate.dataset.state === "unlinked"); checking, offline, opening and error
  // states render no actions at all.
  const gate = document.createElement("div");
  gate.className = "remote-canvas-gate";
  gate.setAttribute("role", "status");
  gate.setAttribute("aria-live", "polite");
  gate.dataset.state = "checking";

  const card = document.createElement("section");
  card.className = "remote-canvas-card";
  card.setAttribute("aria-labelledby", "remoteCanvasTitle");

  const head = document.createElement("div");
  head.className = "remote-canvas-head";
  const dot = document.createElement("span");
  dot.className = "remote-canvas-dot";
  dot.setAttribute("aria-hidden", "true");
  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = copy.eyebrow;
  head.append(dot, eyebrow);

  const title = document.createElement("h2");
  title.id = "remoteCanvasTitle";
  title.textContent = copy.checking;

  const detail = document.createElement("p");
  detail.className = "remote-canvas-detail";
  detail.textContent = `${location.origin}${location.pathname}`;

  const actions = document.createElement("div");
  actions.className = "remote-canvas-actions";
  const link = document.createElement("a");
  link.className = "primary";
  link.dataset.action = "link";
  link.href = "/dashboard.html#devices";
  link.textContent = copy.dashboard;
  actions.append(link);

  card.append(head, title, detail, actions);
  gate.append(card);
  document.body.append(gate);

  function publishCloudHeaderStatus(result) {
    const detail = Object.freeze({
      accountName:String(result.account?.name || "").slice(0, 100),
      credits:Number.isFinite(result.account?.credits) ? result.account.credits : null,
      deviceOnline:Boolean(result.device?.online),
      deviceReady:Boolean(result.device?.online && result.device?.ready),
      deviceId:bridgeDeviceId,
    });
    window.PENECHO_REMOTE_CLOUD_STATUS = detail;
    if (typeof window.dispatchEvent === "function" && typeof CustomEvent === "function") {
      window.dispatchEvent(new CustomEvent("penecho:remote-cloud-status", { detail }));
    }
  }

  async function openRequestedCanvas() {
    const deadline = Date.now() + 15_000;
    while (isCommunityCraft ? !window.PenEchoCommunityUI?.takeFurther : !window.PenEchoCloudProjects?.openCanvas) {
      if (Date.now() >= deadline) throw new Error("PenEcho Canvas did not finish loading.");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (isCommunityCraft) {
      const item = await window.PenEchoCommunityUI.takeFurther(requestedCommunityItemId);
      if (browserEditing) {
        const canvasId = await window.PenEchoCloudProjects.saveEcho(item?.name);
        if (!deviceIdPattern.test(String(canvasId || ""))) throw Error("Cloud returned an invalid Canvas identity");
        // Saving already binds this loaded document to the owned Cloud copy.
        // Keep the gate up until completion, then reveal it without reloading.
        window.history.replaceState(window.history.state, "", `/canvas/${canvasId}`);
      }
    }
    else await window.PenEchoCloudProjects.openCanvas(requestedCanvasId);
  }

  function updateLinkedDevice(result) {
    const candidate = deviceIdPattern.test(String(result.device?.id || "")) ? String(result.device.id) : "";
    // Once selected, keep the host pinned for this document's lifetime.
    if (!bridgeDeviceId && candidate) bridgeDeviceId = candidate;
    bridgeDeviceLinked = Boolean(result.device);
    const online = Boolean(candidate && candidate === bridgeDeviceId && result.device?.online);
    const ready = online && result.device?.ready === true;
    bridgeState = { online, ready };
    window.PENECHO_CONFIG.connectionAccountId = String(result.accountId || window.PENECHO_CONFIG.connectionAccountId || "");
    window.PENECHO_CONFIG.linkedDeviceId = bridgeDeviceId;
    window.PENECHO_CONFIG.linkedDeviceReady = ready;
    window.PENECHO_CONFIG.linkedDeviceLinked = bridgeDeviceLinked;
    window.PENECHO_CONFIG.linkedDeviceOnline = online;
    window.PENECHO_CONFIG.canvasAgent = ready && result.device?.capabilities?.canvasAgent === true;
    if (typeof result.capabilities?.hostedCanvasAgent === "boolean") window.PENECHO_CONFIG.hostedCanvasAgent = result.capabilities.hostedCanvasAgent;
    publishCloudHeaderStatus({ ...result, device:{ ...result.device, online, ready } });
    clearTimeout(readyRefreshTimer);
    readyRefreshTimer = null;
    if (ready) { deviceRetryAttempt = 0; readyRefreshDeadline = 0; }
    else {
      if (online && !readyRefreshDeadline) readyRefreshDeadline = Date.now() + 15000;
      scheduleLinkedDeviceRefresh();
    }
    window.dispatchEvent(new CustomEvent("penecho:capabilities-changed"));
    return bridgeState;
  }

  async function readLinkedDeviceStatus() {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    let timer;
    try {
      return await Promise.race([
        nativeFetch("/api/v1/remote-canvas/status", { cache:"no-store", credentials:"same-origin", headers:csrfHeaders({ accept:"application/json" }), ...(controller ? { signal:controller.signal } : {}) }).then(async (response) => ({ response, result:await response.json().catch(() => ({})) })),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            controller?.abort();
            reject(new Error("Linked device status timed out."));
          }, 8000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  window.PenEchoLinkedDevice = Object.freeze({
    invalidate:invalidateLinkedDevice,
    refresh({ ifNeeded = false, automatic = false } = {}) {
      if (!automatic) deviceRetrySuspended = false;
      if (ifNeeded && bridgeGateSettled && bridgeState?.online && bridgeState?.ready && bridgeDeviceId) return Promise.resolve(bridgeState);
      if (refreshPending) return refreshPending;
      // Settings and Library can request capabilities while the initial check
      // is running. Reuse that discovery instead of checking the host twice.
      if (!bridgeGateSettled) return bridgeGate;
      refreshPending = bridgeGate.then(async () => {
        const { response, result } = await readLinkedDeviceStatus();
        if (!response.ok) {
          if ([401, 403].includes(response.status)) deviceRetrySuspended = true;
          throw new Error(`HTTP ${response.status}`);
        }
        return updateLinkedDevice(result);
      }).catch((error) => {
        invalidateLinkedDevice();
        throw error;
      }).finally(() => { refreshPending = null; });
      return refreshPending;
    },
  });

  window.addEventListener("pagehide", () => { deviceRetryStopped = true; clearTimeout(readyRefreshTimer); readyRefreshTimer = null; });
  window.addEventListener("pageshow", () => { deviceRetryStopped = false; scheduleLinkedDeviceRefresh(); });
  window.addEventListener("online", () => {
    if (deviceRetryStopped || deviceRetrySuspended || bridgeState?.ready) return;
    deviceRetryAttempt = 0;
    clearTimeout(readyRefreshTimer); readyRefreshTimer = null;
    void window.PenEchoLinkedDevice.refresh({ automatic:true }).catch(() => {});
  });

  async function connect() {
    gate.dataset.state = "checking";
    title.textContent = copy.checking;
    detail.textContent = `${location.origin}${location.pathname}`;
    gate.hidden = false;
    if (nativeCloudCanvasReadsEnabled) {
      // Cloud document loading owns the opening gate. Device discovery only
      // settles device-owned requests; neither failure nor latency blocks Cloud.
      browserEditing = true;
      window.PENECHO_CONFIG.browserCanvasEditing = true;
      window.PENECHO_CONFIG.canvasAgent = false;
      window.dispatchEvent(new CustomEvent("penecho:capabilities-changed"));
      void readLinkedDeviceStatus().then(({ response, result }) => {
        if (!response.ok) {
          if ([401, 403].includes(response.status)) deviceRetrySuspended = true;
          throw new Error(result.message || `HTTP ${response.status}`);
        }
        updateLinkedDevice(result);
        settleBridgeGate({ online:window.PENECHO_CONFIG.linkedDeviceOnline, ready:window.PENECHO_CONFIG.linkedDeviceReady, browserEditing:true });
      }).catch((error) => {
        invalidateLinkedDevice();
        settleBridgeGate({ online:false, browserEditing:true, message:String(error?.message || error) });
      });
      gate.dataset.state = "opening";
      title.textContent = zh ? "正在浏览器中打开云端画布…" : "Opening your Cloud Canvas in this browser…";
      detail.textContent = zh ? "Cloud 连接 · 浏览器直接编辑" : "Cloud connection · Browser editing";
      try {
        await openRequestedCanvas();
        await waitForVisibleWidgets();
        if(new URLSearchParams(location.search).get('mcp')==='1')window.dispatchEvent(new CustomEvent('penecho:open-cloud-mcp'));
        gate.hidden = true;
      } catch (error) {
        gate.dataset.state = "error";
        title.textContent = copy.failed;
        detail.textContent = String(error?.message || error || copy.unavailable).slice(0, 500);
      }
      return;
    }
    try {
      const { response, result } = await readLinkedDeviceStatus();
      if (response.status === 401) {
        settleBridgeGate({ online:false, message:copy.unavailable });
        return location.assign(`/auth.html?returnTo=${encodeURIComponent(location.pathname)}`);
      }
      if (!response.ok) throw new Error(result.message || `HTTP ${response.status}`);
      updateLinkedDevice(result);
      if (!result.device) {
        settleBridgeGate({ online:false, message:copy.unavailable });
        gate.dataset.state = "unlinked";
        title.textContent = copy.noHost;
        detail.textContent = copy.unavailable;
        return;
      }
      if (!result.device.online) {
        settleBridgeGate({ online:false, message:copy.offline });
        gate.dataset.state = "offline";
        title.textContent = copy.offline;
        detail.textContent = `${result.device.name} · ${result.device.platform} · ${copy.offlineStatus}`;
        return;
      }
      gate.dataset.state = "opening";
      title.textContent = copy.opening;
      detail.textContent = `${result.device.name} · ${result.device.platform} · ${copy.onlineStatus}`;
      settleBridgeGate({ online:true });
      await openRequestedCanvas();
      if (nativeCloudCanvasReadsEnabled) await waitForVisibleWidgets();
      gate.hidden = true;
    } catch (error) {
      settleBridgeGate({ online:false, message:String(error?.message || error || copy.unavailable).slice(0, 500) });
      gate.dataset.state = "error";
      title.textContent = copy.failed;
      detail.textContent = String(error?.message || error || copy.unavailable).slice(0, 500);
    }
  }
  void connect();
})();
