"use strict";

(() => {
  const canvasMatch = location.pathname.match(/^\/canvas\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/?$/i);
  const communityMatch = location.pathname.match(/^\/canvas\/community\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/?$/i);
  if (window.PENECHO_CONFIG?.runtime !== "cloud" || (!canvasMatch && !communityMatch)) return;
  const requestedCanvasId = canvasMatch?.[1] || null;
  const requestedCommunityItemId = communityMatch?.[1] || null;
  const isCommunityCraft = Boolean(requestedCommunityItemId);

  const nativeFetch = window.fetch.bind(window);
  const cloudRuntime = window.PENECHO_CONFIG?.runtime === "cloud";
  let resolveBridgeGate = null;
  let bridgeGateSettled = !cloudRuntime;
  const bridgeGate = cloudRuntime
    ? new Promise((resolve) => { resolveBridgeGate = resolve; })
    : Promise.resolve({ online:true });
  function settleBridgeGate(state) {
    if (bridgeGateSettled) return;
    bridgeGateSettled = true;
    resolveBridgeGate?.(state);
  }
  function unavailableBridgeResponse(state) {
    const payload = {
      error:"device_offline",
      code:"device_offline",
      message:state?.message || "Your linked PenEcho host is offline.",
    };
    if (typeof Response === "function") return new Response(JSON.stringify(payload), { status:409, headers:{ "content-type":"application/json" } });
    return { ok:false, status:409, headers:new Headers({ "content-type":"application/json" }), json:async () => payload };
  }
  const bridgedPaths = [
    /^\/api\/settings(?:\/|$)/,
    /^\/api\/favorites(?:\/|$)/,
    /^\/api\/canvas-projects(?:\/|$)/,
    /^\/api\/canvases(?:\/|$)/,
    /^\/api\/cloud(?:\/|$)/,
    /^\/api\/community\/metadata$/,
    /^\/api\/plugins(?:\/|$)/,
    /^\/canvas\/api\/widget-fetch$/,
    /^\/canvas\/plugins\/private\/[a-z0-9][a-z0-9-]{0,63}(?:\/(?:plugin\.md|styles\.css)|\.md)$/,
  ];
  const nativeCloudPaths = new Set(["/api/ai/command", "/api/plugins/improve"]);

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
    const shouldBridge = !nativeCloudPaths.has(sourceUrl.pathname) && bridgedPaths.some((pattern) => pattern.test(sourceUrl.pathname));
    const bridgePath = sourceUrl.pathname === "/canvas/api/widget-fetch"
      ? "/api/widget-fetch"
      : sourceUrl.pathname.startsWith("/canvas/plugins/private/")
        ? sourceUrl.pathname.slice("/canvas".length)
        : sourceUrl.pathname;
    const target = shouldBridge
      ? `/api/v1/remote-canvas/http?path=${encodeURIComponent(`${bridgePath}${sourceUrl.search}`)}`
      : `${sourceUrl.pathname}${sourceUrl.search}`;
    const request = () => nativeFetch(target, { ...options, method, headers, credentials:"same-origin" });
    if (!shouldBridge || !cloudRuntime) return request();
    return bridgeGate.then((state) => state?.online ? request() : unavailableBridgeResponse(state));
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
      deviceOnline:Boolean(result.device?.online),
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
    if (isCommunityCraft) await window.PenEchoCommunityUI.takeFurther(requestedCommunityItemId);
    else await window.PenEchoCloudProjects.openCanvas(requestedCanvasId);
  }

  async function connect() {
    gate.dataset.state = "checking";
    title.textContent = copy.checking;
    detail.textContent = `${location.origin}${location.pathname}`;
    gate.hidden = false;
    try {
      const response = await nativeFetch("/api/v1/remote-canvas/status", { cache:"no-store", credentials:"same-origin", headers:csrfHeaders({ accept:"application/json" }) });
      if (response.status === 401) {
        settleBridgeGate({ online:false, message:copy.unavailable });
        return location.assign(`/auth.html?returnTo=${encodeURIComponent(location.pathname)}`);
      }
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || `HTTP ${response.status}`);
      publishCloudHeaderStatus(result);
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
