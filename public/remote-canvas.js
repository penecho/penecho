"use strict";

(() => {
  if (window.PENECHO_CONFIG?.runtime !== "cloud" || !location.pathname.startsWith("/user_canvas")) return;

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
    eyebrow:"远程画布", checking:"正在连接你的 PenEcho…", offline:"你的 PenEcho 主机当前离线",
    body:"此页面不会在云端运行或保存你的私人画布。请让已连接的电脑保持开机并运行 PenEcho，然后重试。",
    steps:["在主电脑启动 PenEcho", "确认已登录同一云端账号并完成 Link Device", "保持 PenEcho 在线，再从任意设备打开此地址"],
    dashboard:"管理连接设备", retry:"重新连接", signout:"返回控制台", connected:"远程连接已保护", unavailable:"未找到已连接设备。请先在控制台完成 Link Device。",
  } : {
    eyebrow:"Remote Canvas", checking:"Connecting to your PenEcho…", offline:"Your PenEcho host is offline",
    body:"This page does not run or store your private Canvas in Cloud. Keep PenEcho running on your linked computer, then try again.",
    steps:["Start PenEcho on your main computer", "Sign in to the same Cloud account and complete Link Device", "Keep PenEcho online, then open this address from anywhere"],
    dashboard:"Manage linked device", retry:"Try again", signout:"Back to console", connected:"Protected remote connection", unavailable:"No linked device was found. Complete Link Device in the console first.",
  };

  const gate = document.createElement("div");
  gate.className = "remote-canvas-gate";
  gate.setAttribute("role", "status");
  gate.setAttribute("aria-live", "polite");
  gate.innerHTML = `<section class="remote-canvas-card" aria-labelledby="remoteCanvasTitle"><p class="eyebrow">${copy.eyebrow}</p><h2 id="remoteCanvasTitle">${copy.checking}</h2><p data-remote-body>${copy.body}</p><ol><li>${copy.steps[0]}</li><li>${copy.steps[1]}</li><li>${copy.steps[2]}</li></ol><div class="remote-canvas-actions"><a class="primary" href="/dashboard.html#devices">${copy.dashboard}</a><button type="button" data-remote-retry>${copy.retry}</button><a href="/dashboard.html">${copy.signout}</a></div><div class="remote-canvas-detail" data-remote-detail>${location.origin}/user_canvas</div></section>`;
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

  async function connect() {
    title.textContent = copy.checking;
    detail.textContent = `${location.origin}/user_canvas`;
    gate.hidden = false;
    try {
      const response = await nativeFetch("/api/v1/remote-canvas/status", { cache:"no-store", credentials:"same-origin", headers:csrfHeaders({ accept:"application/json" }) });
      if (response.status === 401) return location.assign(`/auth.html?returnTo=${encodeURIComponent("/user_canvas/")}`);
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || `HTTP ${response.status}`);
      if (!result.device) {
        title.textContent = copy.offline;
        detail.textContent = copy.unavailable;
        return;
      }
      if (!result.device.online) {
        title.textContent = copy.offline;
        detail.textContent = `${result.device.name} · ${result.device.platform} · Offline`;
        return;
      }
      statusBadge(result.device);
      gate.hidden = true;
    } catch (error) {
      title.textContent = copy.offline;
      detail.textContent = String(error?.message || error || copy.unavailable).slice(0, 500);
    }
  }
  gate.querySelector("[data-remote-retry]").addEventListener("click", connect);
  void connect();
})();
