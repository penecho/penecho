"use strict";

(() => {
  const canvasMatch = location.pathname.match(/^\/canvas\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/?$/i);
  if (window.PENECHO_CONFIG?.runtime !== "cloud" || !canvasMatch) return;
  const requestedCanvasId = canvasMatch[1];

  const nativeFetch = window.fetch.bind(window);
  const bridgedPaths = [
    /^\/api\/settings(?:\/|$)/,
    /^\/api\/canvas-projects(?:\/|$)/,
    /^\/api\/canvases(?:\/|$)/,
    /^\/api\/cloud(?:\/|$)/,
    /^\/api\/community\/metadata$/,
    /^\/api\/plugins(?:\/|$)/,
    /^\/canvas\/api\/widget-fetch$/,
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
    const sourceUrl = new URL(typeof input === "string" || input instanceof URL ? input : input.url, location.href);
    if (sourceUrl.origin !== location.origin) return nativeFetch(input, options);
    const method = String(options.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    const inputHeaders = input instanceof Request ? input.headers : undefined;
    const headers = csrfHeaders(options.headers || inputHeaders);
    const shouldBridge = !nativeCloudPaths.has(sourceUrl.pathname) && bridgedPaths.some((pattern) => pattern.test(sourceUrl.pathname));
    const target = shouldBridge
      ? `/api/v1/remote-canvas/http?path=${encodeURIComponent(`${sourceUrl.pathname === "/canvas/api/widget-fetch" ? "/api/widget-fetch" : sourceUrl.pathname}${sourceUrl.search}`)}`
      : `${sourceUrl.pathname}${sourceUrl.search}`;
    return nativeFetch(target, { ...options, method, headers, credentials:"same-origin" });
  };

  const zh = /^zh\b/i.test(navigator.language || "");
  const copy = zh ? {
    eyebrow:"私人云端画布", checking:"正在连接你的 PenEcho 主机…", noHost:"连接一台 PenEcho 主机后即可打开",
    offline:"已连接的 PenEcho 主机当前离线", failed:"这张画布暂时无法打开",
    body:"项目与版本安全存储在云端；画布运行、模型请求和 API 密钥始终由你连接的电脑处理，云服务器不会运行画布。",
    nodes:["已登录的浏览器", "PenEcho Cloud 桥接", "你的 PenEcho 主机"],
    nodeDetails:["打开指定云端画布", "身份验证与白名单中继", "本地运行画布与模型"],
    dashboard:"Link Device", projects:"返回 Cloud Projects", download:"下载 PenEcho", retry:"重新连接",
    connected:"受保护的远程连接", unavailable:"尚未连接设备。请先安装 PenEcho，并在 Link Device 页面连接一台主电脑。", opening:"主机在线，正在打开云端画布…",
  } : {
    eyebrow:"Private Cloud Canvas", checking:"Connecting to your PenEcho host…", noHost:"Connect one PenEcho host to open this Canvas",
    offline:"Your linked PenEcho host is offline", failed:"This Canvas could not be opened",
    body:"Your project and versions are stored safely in Cloud. Canvas runtime, model requests, and API keys stay on your linked computer; the Cloud server never runs the Canvas.",
    nodes:["Signed-in browser", "PenEcho Cloud Bridge", "Your PenEcho host"],
    nodeDetails:["Opens this Cloud Canvas", "Auth + allow-listed relay", "Runs Canvas + model locally"],
    dashboard:"Link Device", projects:"Back to Cloud Projects", download:"Download PenEcho", retry:"Try again",
    connected:"Protected remote connection", unavailable:"No device is linked yet. Install PenEcho, then connect one main computer from Link Device.", opening:"Host online. Opening your Cloud Canvas…",
  };

  const gate = document.createElement("div");
  gate.className = "remote-canvas-gate";
  gate.setAttribute("role", "status");
  gate.setAttribute("aria-live", "polite");
  gate.innerHTML = `<section class="remote-canvas-card" aria-labelledby="remoteCanvasTitle"><p class="eyebrow">${copy.eyebrow}</p><h2 id="remoteCanvasTitle">${copy.checking}</h2><p data-remote-body>${copy.body}</p><div class="remote-canvas-flow" role="img" aria-label="${copy.nodes.join(" to ")}"><div><span>01</span><b>${copy.nodes[0]}</b><small>${copy.nodeDetails[0]}</small></div><i aria-hidden="true">→</i><div><span>02</span><b>${copy.nodes[1]}</b><small>${copy.nodeDetails[1]}</small></div><i aria-hidden="true">→</i><div><span>03</span><b>${copy.nodes[2]}</b><small>${copy.nodeDetails[2]}</small></div></div><div class="remote-canvas-actions"><a class="primary" href="/dashboard.html#devices">${copy.dashboard}</a><a href="/downloads.html">${copy.download}</a><button type="button" data-remote-retry>${copy.retry}</button><a href="/dashboard.html#projects">${copy.projects}</a></div><div class="remote-canvas-detail" data-remote-detail>${location.origin}${location.pathname}</div></section>`;
  document.body.append(gate);
  const title = gate.querySelector("h2"), detail = gate.querySelector("[data-remote-detail]");

  function statusBadge(device) {
    let badge = document.querySelector(".remote-canvas-status");
    if (!badge) {
      badge = document.createElement("div");
      badge.className = "remote-canvas-status";
      badge.setAttribute("role", "status");
      document.querySelector(".top-row")?.insertBefore(badge, document.querySelector(".language-toggle"));
    }
    badge.title = `${copy.connected}: ${device.name}`;
    const label = document.createElement("span");
    label.textContent = `${copy.connected} · ${String(device.name || "PenEcho")}`;
    badge.replaceChildren(label);
  }

  async function openRequestedCanvas() {
    const deadline = Date.now() + 15_000;
    while (!window.PenEchoCloudProjects?.openCanvas) {
      if (Date.now() >= deadline) throw new Error("PenEcho Canvas did not finish loading.");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await window.PenEchoCloudProjects.openCanvas(requestedCanvasId);
  }

  async function connect() {
    title.textContent = copy.checking;
    detail.textContent = `${location.origin}${location.pathname}`;
    gate.hidden = false;
    try {
      const response = await nativeFetch("/api/v1/remote-canvas/status", { cache:"no-store", credentials:"same-origin", headers:csrfHeaders({ accept:"application/json" }) });
      if (response.status === 401) return location.assign(`/auth.html?returnTo=${encodeURIComponent(location.pathname)}`);
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || `HTTP ${response.status}`);
      if (!result.device) {
        gate.dataset.state = "unlinked";
        title.textContent = copy.noHost;
        detail.textContent = copy.unavailable;
        return;
      }
      if (!result.device.online) {
        gate.dataset.state = "offline";
        title.textContent = copy.offline;
        detail.textContent = `${result.device.name} · ${result.device.platform} · Offline`;
        return;
      }
      gate.dataset.state = "opening";
      title.textContent = copy.opening;
      detail.textContent = `${result.device.name} · ${result.device.platform} · Online`;
      statusBadge(result.device);
      await openRequestedCanvas();
      gate.hidden = true;
    } catch (error) {
      gate.dataset.state = "error";
      title.textContent = copy.failed;
      detail.textContent = String(error?.message || error || copy.unavailable).slice(0, 500);
    }
  }
  gate.querySelector("[data-remote-retry]").addEventListener("click", connect);
  void connect();
})();
