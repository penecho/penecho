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

  const t = (en, zh) => (/^zh\b/i.test(navigator.language || "") ? zh : en);
  const copy = {
    loading: t("Opening this Craft…", "正在打开这个 Craft…"),
    signIn: t("Sign in", "登录"),
    signInHint: t("Create a free account to save and continue Crafts", "注册免费账号即可收藏并继续创作"),
    readOnly: t("Read-only — link a device to edit", "只读模式——连接设备后可编辑"),
    takeFurther: t("Take it further", "继续推进"),
    openDashboard: t("Open console", "打开控制台"),
    previewOnly: t("This Craft's full view needs a redemption. Showing the preview.", "查看完整内容需要先赎回,正在展示预览图。"),
    failed: t("This Craft could not be opened.", "这个 Craft 暂时无法打开。"),
    backTitle: t("Back to Explore", "返回探索"),
  };

  document.documentElement.classList.add("viewer-mode");

  const topbar = document.createElement("div");
  topbar.className = "viewer-topbar";
  const brand = document.createElement("a");
  brand.className = "viewer-brand";
  brand.href = config.communityUrl || "/community.html";
  brand.title = copy.backTitle;
  brand.setAttribute("aria-label", copy.backTitle);
  brand.innerHTML = '<img src="penecho-mark.png" alt="">PenEcho';
  const actions = document.createElement("div");
  actions.className = "viewer-actions";
  topbar.append(brand, actions);
  document.body.append(topbar);

  const status = document.createElement("div");
  status.className = "viewer-status";
  status.setAttribute("role", "status");
  status.innerHTML = `<div><div class="spinner"></div>${copy.loading}</div>`;
  document.body.append(status);

  function chip(label, hint, href) {
    const link = document.createElement("a");
    link.className = "viewer-chip";
    link.href = href;
    link.innerHTML = `<b>${label}</b>${hint ? `<small>${hint}</small>` : ""}`;
    return link;
  }

  async function renderAccountArea() {
    try {
      const session = await fetch("/api/v1/auth/session", { credentials: "same-origin", headers: { accept: "application/json" } });
      if (!session.ok) throw new Error("session unavailable");
      const account = (await session.json())?.account;
      if (!account?.id) {
        actions.append(chip(copy.signIn, copy.signInHint, config.signupUrl || "/auth.html"));
        return;
      }
      let devices = 0;
      try {
        const response = await fetch("/api/v1/devices", { credentials: "same-origin", headers: { accept: "application/json" } });
        if (response.ok) devices = ((await response.json())?.devices || []).filter((device) => device.online !== false).length;
      } catch { /* read-only stays the honest default */ }
      if (devices > 0 && config.takeFurtherUrl) {
        const open = document.createElement("a");
        open.className = "viewer-primary";
        open.href = config.takeFurtherUrl;
        open.textContent = copy.takeFurther;
        actions.append(open);
      }
      actions.append(chip(account.name || copy.openDashboard, devices > 0 ? copy.openDashboard : copy.readOnly, config.dashboardUrl || "/dashboard.html"));
    } catch {
      actions.append(chip(copy.signIn, copy.signInHint, config.signupUrl || "/auth.html"));
    }
  }

  async function waitForCanvasBridge(timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (window.PenEchoCommunityCanvas?.importCanvas && window.PenEchoCommunityCanvas?.importWidget) return window.PenEchoCommunityCanvas;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error("The viewer could not start.");
  }

  function showPreview(message) {
    status.innerHTML = `<div>${message || ""}${config.previewUrl ? `<img src="${config.previewUrl}" alt="">` : ""}</div>`;
  }

  (async () => {
    void renderAccountArea();
    try {
      const response = await fetch(config.artifactUrl, { headers: { accept: "application/json" } });
      if (response.status === 403) { showPreview(copy.previewOnly); return; }
      if (!response.ok) throw new Error(`artifact ${response.status}`);
      const payload = await response.json();
      const artifact = payload?.artifact && payload.artifact.format ? payload.artifact : payload;
      const bridge = await waitForCanvasBridge();
      if (artifact?.format === "penecho-widget") await bridge.importWidget(artifact);
      else await bridge.importCanvas(artifact);
      document.getElementById("handToolBtn")?.click();
      status.hidden = true;
    } catch (error) {
      showPreview(`${copy.failed}`);
    }
  })();
})();
