"use strict";

/* Read-only Canvas viewer bootstrap. Only the Cloud serves pages with
   PENECHO_CONFIG.viewer = true (the public /canvas/view/:itemId shell);
   the regular local app never enters this mode. */

(() => {
  // The viewer shell is served at /canvas/view/:itemId on PenEcho Cloud.
  // Everything else (including the regular local app) never enters this mode.
  const match = location.pathname.match(/^\/canvas\/view\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/?$/i);
  if (!match) return;
  const itemId = match[1];
  const config = {
    itemId,
    itemKind: null, // discovered from the artifact payload itself
    artifactUrl: `/api/v1/community/items/${itemId}/view`,
    previewUrl: `/api/v1/community/items/${itemId}/preview`,
    communityUrl: "/community.html",
    signupUrl: "/auth.html",
    dashboardUrl: "/dashboard.html#community",
    takeFurtherUrl: `/canvas/community/${itemId}`,
  };

  const COPY = {
    en: {
      loading:"Opening this Craft…",
      signIn:"Sign in",
      signInHint:"Create a free account to save and continue Crafts",
      readOnly:"Read-only — link a device to edit",
      takeFurther:"Echo",
      openDashboard:"Open console",
      previewOnly:"This Craft's full view needs a redemption. Showing the preview.",
      failed:"This Craft could not be opened.",
      backTitle:"Back to Echoes",
      staticWidgetNotice:"Dynamically loaded content is available after you sign in and complete Link Device.",
      dismissNotice:"Hide this message",
    },
    zh: {
      loading:"正在打开这个 Craft…",
      signIn:"登录",
      signInHint:"注册免费账号即可收藏并继续创作",
      readOnly:"只读模式——连接设备后可编辑",
      takeFurther:"Echo",
      openDashboard:"打开控制台",
      previewOnly:"查看完整内容需要先赎回，正在展示预览图。",
      failed:"这个 Craft 暂时无法打开。",
      backTitle:"返回 Echoes",
      staticWidgetNotice:"动态加载的内容需登录并完成设备连接后才能查看。",
      dismissNotice:"隐藏此提示",
    },
  };
  function viewerLanguage() {
    const canvasLanguage = window.PenEchoI18n?.currentLanguage?.();
    if (canvasLanguage === "en" || canvasLanguage === "zh") return canvasLanguage;
    try {
      const stored = localStorage.getItem("penecho-language");
      if (stored === "en" || stored === "zh") return stored;
    } catch { /* navigator language remains a safe fallback */ }
    return /^zh\b/i.test(navigator.language || "") ? "zh" : "en";
  }
  let copy = COPY[viewerLanguage()];

  document.documentElement.classList.add("viewer-mode");

  const topbar = document.createElement("div");
  topbar.className = "viewer-topbar";
  const brand = document.createElement("a");
  brand.className = "viewer-brand";
  brand.href = config.communityUrl || "/community.html";
  brand.title = copy.backTitle;
  brand.setAttribute("aria-label", copy.backTitle);
  brand.innerHTML = '<img src="penecho-mark.png" alt=""><span>PenEcho</span>';
  const actions = document.createElement("div");
  actions.className = "viewer-actions";
  topbar.append(brand, actions);
  document.body.append(topbar);

  const notice = document.createElement("button");
  notice.type = "button";
  notice.className = "viewer-notice";
  notice.textContent = copy.staticWidgetNotice;
  notice.title = copy.dismissNotice;
  notice.setAttribute("aria-label", `${copy.staticWidgetNotice} ${copy.dismissNotice}`);
  notice.addEventListener("click", () => { notice.hidden = true; });
  // Dock the notice at the bottom of the page (inside the flex-column <main>)
  // instead of floating it over the canvas; #viewport is flex:1, so it yields
  // the space and the app's ResizeObserver re-fits the canvas automatically.
  (document.querySelector("main") || document.body).append(notice);

  const status = document.createElement("div");
  status.className = "viewer-status";
  status.setAttribute("role", "status");
  status.innerHTML = `<div><div class="spinner"></div>${copy.loading}</div>`;
  document.body.append(status);

  // Paid or license-restricted Crafts answer the artifact fetch with 403;
  // continuing them needs a redemption the read-only viewer cannot perform,
  // so the primary "Echo" action must not render for them.
  let previewOnly = false;
  let accountState = { kind:"loading", account:null, devices:0 };

  function chip(label, hint, href, className = "") {
    const link = document.createElement("a");
    link.className = `viewer-chip${className ? ` ${className}` : ""}`;
    link.href = href;
    const text = document.createElement("span");
    text.className = "viewer-action-label";
    text.textContent = label;
    link.append(text);
    if (hint) link.title = hint;
    return link;
  }

  function primaryAction() {
    const link = document.createElement("a");
    link.className = "viewer-primary";
    link.href = config.takeFurtherUrl;
    link.setAttribute("aria-label", copy.takeFurther);
    const text = document.createElement("span");
    text.className = "viewer-action-label";
    text.textContent = copy.takeFurther;
    const arrow = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    arrow.setAttribute("viewBox", "0 0 20 20");
    arrow.setAttribute("aria-hidden", "true");
    arrow.innerHTML = '<path d="M4 10h11M11 6l4 4-4 4"/>';
    link.append(text, arrow);
    return link;
  }

  function renderActions() {
    actions.replaceChildren();
    if (accountState.kind === "loading") return;
    if (accountState.kind !== "signed-in") {
      actions.append(chip(copy.signIn, copy.signInHint, config.signupUrl || "/auth.html", "viewer-auth-action"));
      return;
    }
    if (accountState.devices > 0 && config.takeFurtherUrl && !previewOnly) actions.append(primaryAction());
    actions.append(chip(
      accountState.account.name || copy.openDashboard,
      accountState.devices > 0 ? copy.openDashboard : copy.readOnly,
      config.dashboardUrl || "/dashboard.html",
      "viewer-account-action",
    ));
  }

  function applyViewerLanguage() {
    copy = COPY[viewerLanguage()];
    brand.title = copy.backTitle;
    brand.setAttribute("aria-label", copy.backTitle);
    notice.textContent = copy.staticWidgetNotice;
    notice.title = copy.dismissNotice;
    notice.setAttribute("aria-label", `${copy.staticWidgetNotice} ${copy.dismissNotice}`);
    const statusKey = status.dataset.copyKey;
    if (statusKey && COPY.en[statusKey]) showPreview(statusKey);
    else if (!status.hidden) status.innerHTML = `<div><div class="spinner"></div>${copy.loading}</div>`;
    renderActions();
  }

  async function renderAccountArea() {
    try {
      const session = await fetch("/api/v1/auth/session", { credentials: "same-origin", headers: { accept: "application/json" } });
      if (!session.ok) throw new Error("session unavailable");
      const account = (await session.json())?.account;
      if (!account?.id) {
        accountState = { kind:"signed-out", account:null, devices:0 };
        renderActions();
        return;
      }
      let devices = 0;
      try {
        const response = await fetch("/api/v1/devices", { credentials: "same-origin", headers: { accept: "application/json" } });
        if (response.ok) devices = ((await response.json())?.devices || []).filter((device) => device.online !== false).length;
      } catch { /* read-only stays the honest default */ }
      accountState = { kind:"signed-in", account, devices };
      renderActions();
    } catch {
      accountState = { kind:"signed-out", account:null, devices:0 };
      renderActions();
    }
  }

  async function waitForCanvasBridge(timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (window.PenEchoCommunityCanvas?.viewCanvas && window.PenEchoCommunityCanvas?.importWidget) return window.PenEchoCommunityCanvas;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error("The viewer could not start.");
  }

  function showPreview(copyKey) {
    status.dataset.copyKey = copyKey;
    status.innerHTML = `<div>${copy[copyKey] || ""}${config.previewUrl ? `<img src="${config.previewUrl}" alt="">` : ""}</div>`;
  }

  window.addEventListener("penecho:languagechange", applyViewerLanguage);

  (async () => {
    void renderAccountArea();
    try {
      const response = await fetch(config.artifactUrl, { headers: { accept: "application/json" } });
      if (response.status === 403) {
        previewOnly = true;
        renderActions();
        showPreview("previewOnly");
        return;
      }
      if (!response.ok) throw new Error(`artifact ${response.status}`);
      const payload = await response.json();
      const artifact = payload?.artifact && payload.artifact.format ? payload.artifact : payload;
      const bridge = await waitForCanvasBridge();
      if (artifact?.format === "penecho-widget") await bridge.importWidget(artifact, null, { fitViewport:true });
      else await bridge.viewCanvas(artifact);
      document.getElementById("handToolBtn")?.click();
      status.hidden = true;
    } catch (error) {
      showPreview("failed");
    }
  })();
})();
