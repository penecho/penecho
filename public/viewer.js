"use strict";

/* Read-only Canvas viewer bootstrap. Only the Cloud serves pages with
   PENECHO_CONFIG.viewer = true (the public /canvas/view/:itemId shell);
   the regular local app never enters this mode. */

(() => {
  // The viewer shell is served at /canvas/view/:itemId on PenEcho Cloud.
  // Everything else (including the regular local app) never enters this mode.
  const match = location.pathname.match(/^\/canvas\/view\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/?$/i);
  const liveMatch = location.pathname.match(/^\/canvas\/share\/([0-9a-f-]{36})\/?$/i);
  if (!match && !liveMatch) return;
  const live = Boolean(liveMatch), itemId = (liveMatch || match)[1];
  const config = {
    itemId,
    itemKind: null, // discovered from the artifact payload itself
    artifactUrl: `/api/v1/community/items/${itemId}/view`,
    previewUrl: `/api/v1/community/items/${itemId}/preview`,
    communityUrl: "/community.html",
    signupUrl: `/auth.html?returnTo=${encodeURIComponent(`/canvas/community/${itemId}`)}`,
    dashboardUrl: "/dashboard.html#community",
    takeFurtherUrl: `/canvas/community/${itemId}`,
  };

  if (live) Object.assign(config, { artifactUrl:`/api/v1/shares/${itemId}`, previewUrl:null, communityUrl:"/", signupUrl:`/auth.html?returnTo=${encodeURIComponent(location.pathname + "?edit=1")}`, dashboardUrl:"/dashboard.html#projects", takeFurtherUrl:location.pathname + "?edit=1" });

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
    },
  };
  if (live) {
    Object.assign(COPY.en,{loading:"Opening shared content…",takeFurther:"Edit in my space",copyFailed:"Could not save to your space. Please try again.",failed:"Shared content could not be loaded. Please try again later.",unavailable:"Sharing has been turned off, or this Canvas / Widget has been removed. You can ask the owner for a new link.",backTitle:"PenEcho home"});
    Object.assign(COPY.zh,{loading:"正在打开分享内容…",takeFurther:"在我的空间编辑",copyFailed:"暂时无法保存到你的空间，请重试。",failed:"分享内容暂时无法加载，请稍后重试。",unavailable:"分享已关闭，或此 Canvas / Widget 已被移除。你可以联系分享者获取新的链接。",backTitle:"PenEcho 首页"});
  }
  let accountState = { kind:"loading", account:null };
  function viewerLanguage() {
    if (accountState.kind !== "signed-in") return "en";
    try {
      return localStorage.getItem("penecho-site-language") === "zh" ? "zh" : "en";
    } catch { return "en"; }
  }
  let copy = COPY[viewerLanguage()];

  document.documentElement.classList.add("viewer-mode");
  if (live) document.documentElement.classList.add("viewer-live-share");
  window.PenEchoViewerFetch?.install({ itemId, live });

  const topbar = document.createElement("div");
  topbar.className = "viewer-topbar";
  const brand = document.createElement("a");
  brand.className = "viewer-brand";
  // Live shares surface the site wordmark (same as the public header/404 page)
  // linking to the PenEcho homepage; ?public=1 keeps signed-in visitors on the
  // public site instead of bouncing to the dashboard.
  brand.href = live ? "/?public=1" : config.communityUrl || "/community.html";
  brand.title = copy.backTitle;
  brand.setAttribute("aria-label", copy.backTitle);
  brand.innerHTML = "<span>Pen<strong>Echo</strong></span>";
  const actions = document.createElement("div");
  actions.className = "viewer-actions";
  topbar.append(brand, actions);
  document.body.append(topbar);

  const status = document.createElement("div");
  status.className = "viewer-status";
  status.setAttribute("role", "status");
  status.innerHTML = `<div><div class="spinner"></div>${copy.loading}</div>`;
  document.body.append(status);

  let contentReady = false;
  let copyFailed = false;

  function chip(label, hint, href, className = "") {
    const link = document.createElement("a");
    link.className = `viewer-chip${className ? ` ${className}` : ""}`;
    link.dataset.peButton = "secondary";
    link.dataset.peDensity = "compact";
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
    link.dataset.peButton = "primary";
    link.dataset.peDensity = "standard";
    link.href = accountState.kind === "signed-in" ? config.takeFurtherUrl : config.signupUrl;
    link.setAttribute("aria-label", copy.takeFurther);
    const text = document.createElement("span");
    text.className = "viewer-action-label";
    text.textContent = copy.takeFurther;
    const arrow = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    arrow.setAttribute("viewBox", "0 0 20 20");
    arrow.setAttribute("aria-hidden", "true");
    arrow.innerHTML = '<path d="M4 10h11M11 6l4 4-4 4"/>';
    link.append(text, arrow);
    if (live && accountState.kind === "signed-in") link.addEventListener("click", event => {event.preventDefault();void copyToMySpace(link);});
    return link;
  }

  let copying = false;
  async function copyToMySpace(button) {
    if(copying)return;copying=true;button?.setAttribute("aria-busy","true");
    try {
      const csrf = decodeURIComponent(document.cookie.split(";").map(v=>v.trim()).find(v=>v.startsWith("penecho_csrf="))?.slice(13) || "");
      const response=await fetch(`/api/v1/shares/${itemId}/copy`,{method:"POST",credentials:"same-origin",headers:{"x-penecho-csrf":csrf,"content-type":"application/json"},body:JSON.stringify({})});
      if(response.status===401){location.href=config.signupUrl;return;}
      if(response.status===404 || response.status===410){showPreview("unavailable");copying=false;return;}
      const result=await response.json();
      if(!response.ok)throw Error(result.message || copy.failed);
      location.href=result.url;
    } catch(error){copyFailed=true;copying=false;renderActions();}
  }

  function renderActions() {
    actions.replaceChildren();
    // The live-share brand remains available while loading or unavailable,
    // but account and edit actions only make sense after content is ready.
    if (live && !contentReady) return;
    actions.append(primaryAction());
    if (copyFailed && contentReady) {
      const message = document.createElement("span");
      message.className = "viewer-copy-error";
      message.setAttribute("role", "alert");
      message.textContent = copy.copyFailed;
      actions.append(message);
    }
    if (accountState.kind !== "signed-in") return;
    actions.append(chip(
      accountState.account.name || copy.openDashboard,
      copy.openDashboard,
      config.dashboardUrl || "/dashboard.html",
      "viewer-account-action",
    ));
  }

  function applyViewerLanguage() {
    copy = COPY[viewerLanguage()];
    document.documentElement.lang = viewerLanguage();
    brand.title = copy.backTitle;
    brand.setAttribute("aria-label", copy.backTitle);
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
        accountState = { kind:"signed-out", account:null };
        applyViewerLanguage();
        return;
      }
      accountState = { kind:"signed-in", account };
      applyViewerLanguage();
    } catch {
      accountState = { kind:"signed-out", account:null };
      applyViewerLanguage();
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
    status.hidden = false;
    if (live) { contentReady = false; renderActions(); }
    status.dataset.copyKey = copyKey;
    status.innerHTML = `<div>${copy[copyKey] || ""}${config.previewUrl ? `<img src="${config.previewUrl}" alt="">` : ""}</div>`;
  }

  window.addEventListener("penecho:languagechange", applyViewerLanguage);
  window.addEventListener("storage", event => {
    if (event.key === "penecho-site-language" || event.key === null) applyViewerLanguage();
  });
  document.documentElement.lang = viewerLanguage();

  renderActions();

  (async () => {
    const accountReady = renderAccountArea();
    try {
      const response = await fetch(config.artifactUrl, { cache:"no-store", headers: { accept: "application/json" } });
      if (live && [404, 410].includes(response.status)) {
        showPreview("unavailable");
        return;
      }
      if (!live && response.status === 403) {
        showPreview("previewOnly");
        return;
      }
      if (!response.ok) throw new Error(`artifact ${response.status}`);
      const payload = await response.json();
      const artifact = payload?.artifact && (payload.artifact.format || payload.artifact.bundleVersion) ? payload.artifact : payload;
      const bridge = await waitForCanvasBridge();
      if (artifact?.format === "penecho-widget") await bridge.importWidget(artifact, null, { fitViewport:true });
      else await bridge.viewCanvas(artifact);
      document.getElementById("handToolBtn")?.click();
      status.hidden = true;
      contentReady = true;
      renderActions();
      await accountReady;
      if(live && new URLSearchParams(location.search).get("edit")==="1" && accountState.kind==="signed-in") {history.replaceState(null,"",location.pathname);await copyToMySpace();}
    } catch (error) {
      console.warn("Canvas viewer could not open the content:", error);
      showPreview("failed");
    }
  })();
})();
