  // ---------- Cloud MCP Companion -> Projects & Lines Bridge ----------
  // Turns the companion canvas header, left rail, More menu and sidebar into calm
  // bridges to PenEcho Projects & Lines (/lines/<key> and /dashboard.html) without
  // interrupting the live MCP WebSocket session.
  const cpbState = {
    projects: [],
    ownProjects: [],
    account: null,
    loaded: false,
    loading: null,
    loadedAt: 0,
    lastTrigger: null,
    clearIntentOnClose: false,
    linesByProject: new Map(),
  };
  const cpbCopy = (en, zh) => state.language === "zh" ? zh : en;
  function cpbEnabled() {
    return Boolean(window.PENECHO_CONFIG?.browserDraftId) && !projectLinesLocal();
  }
  function cpbGuest() { return Boolean(window.PENECHO_CONFIG?.guestCanvas); }
  function cpbFolderConfig() { return window.PENECHO_CONFIG?.folderProject || null; }
  function cpbLinked() {
    const cfg = cpbFolderConfig();
    const raw = cfg?.linkedLineProject || folderProject.view?.linkedLineProject || null;
    if (!raw?.key) return null;
    if (cpbState.loaded && cpbState.projects.length) {
      const live = cpbState.projects.find(p => p.key === raw.key && !p.archived);
      if (!live) return null;
      return { key: live.key, name: live.name || raw.name || live.key };
    }
    return { key: raw.key, name: raw.name || raw.key };
  }
  function cpbCsrfHeaders(extra = {}) {
    const csrf = document.cookie.split(";").map(v => v.trim()).find(v => v.startsWith("penecho_csrf="))?.slice("penecho_csrf=".length) || "";
    return { accept: "application/json", ...(csrf ? { "x-penecho-csrf": decodeURIComponent(csrf) } : {}), ...extra };
  }
  async function cpbFetch(url, { method = "GET", body } = {}) {
    const headers = cpbCsrfHeaders(body === undefined ? {} : { "content-type": "application/json" });
    const response = await fetch(url, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const code = payload?.code || payload?.error || "";
      const message = payload?.error_description || payload?.message || (typeof payload?.error === "string" ? payload.error : "") || `HTTP ${response.status}`;
      throw Object.assign(Error(message), { status: response.status, code, payload });
    }
    return payload;
  }
  function cpbIsPaidAccount() {
    const a = cpbState.account;
    if (!a) return false;
    const tier = String(a.plan || a.tier || a.subscriptionTier || a.subscription?.plan || "").toLowerCase();
    return Boolean(a.isPaid || a.plus || a.pro || (tier && tier !== "free"));
  }
  function cpbIsProjectLimitError(error) {
    return error?.status === 409 && (error.code === "project_limit" || /project_limit|free|limit|3/i.test(String(error.message)));
  }
  const cpbLineProjectHref = (key, { fromMcp = false, copied = 0, sameTabReturn = false, hash = "" } = {}) => {
    const params = new URLSearchParams();
    if (fromMcp) {
      params.set("from", "mcp");
      if (copied > 0) params.set("copied", String(copied));
      if (sameTabReturn) params.set("mcpReturn", `${location.pathname}${location.search}`);
    }
    const q = params.toString();
    return `/lines/${encodeURIComponent(key)}${q ? `?${q}` : ""}${hash ? `#${hash}` : ""}`;
  };
  function cpbFolderCanvasSummary() {
    const cfg = cpbFolderConfig();
    if (cfg && (cfg.cloudProjectId || cfg.guestProjectId)) {
      const tabCount = folderProject.view?.tabs?.length || 0;
      const closedCount = folderProject.view?.closed?.length || 0;
      const total = tabCount + closedCount;
      const count = total > 0 ? total : Math.max(1, canvasDocumentsCatalog().length);
      return { isFolder: true, folderName: cfg.name || "Project", count };
    }
    return { isFolder: false, folderName: "", count: 1 };
  }
  function cpbHasUnsavedLocalEdits() {
    return Boolean(canvasHasUnsavedChanges() || canvasDocumentsDraftUnsaved());
  }
  async function cpbLoadState({ force = false } = {}) {
    if (!cpbEnabled() || cpbGuest()) return;
    if (!force && cpbState.loaded && Date.now() - cpbState.loadedAt < 15000) return;
    if (cpbState.loading) return cpbState.loading;
    cpbState.loading = (async () => {
      try {
        const [projRes, sessRes] = await Promise.all([
          cpbFetch("/api/v1/line-projects").catch(() => null),
          cpbFetch("/api/v1/auth/session").catch(() => null),
        ]);
        if (projRes && Array.isArray(projRes.projects)) {
          cpbState.projects = projRes.projects;
          cpbState.ownProjects = projRes.projects.filter(p => !p.systemKey && !p.archived && !p.example);
          cpbState.loaded = true;
          cpbState.loadedAt = Date.now();
        }
        if (sessRes && sessRes.account) cpbState.account = sessRes.account;
      } finally {
        cpbState.loading = null;
        cpbRenderAll();
      }
    })();
    return cpbState.loading;
  }
  async function cpbLoadProjectLines(key) {
    if (!key || key === "my-canvases") return [];
    const listed = cpbState.projects.find(p => p.key === key);
    if (Array.isArray(listed?.rail) && listed.rail.length) {
      const normalized = listed.rail.map(item => ({
        slug: item.slug || item.id,
        title: item.title || item.slug || item.id,
      })).filter(item => item.slug);
      if (normalized.length) {
        cpbState.linesByProject.set(key, normalized);
        return normalized;
      }
    }
    try {
      const data = await cpbFetch(`/api/v1/line-projects/${encodeURIComponent(key)}/state`);
      const rows = [...(data.lines || []), ...(data.backlog || [])]
        .filter(l => l && !l.archived && !l.closed && !l.deleted)
        .map(l => ({ slug: l.slug || l.id, title: l.title || l.slug || l.id }))
        .filter(l => l.slug);
      cpbState.linesByProject.set(key, rows);
      return rows;
    } catch {
      return cpbState.linesByProject.get(key) || [];
    }
  }
  function cpbRenderSidebar() {
    const side = document.getElementById("projectLinesSide");
    if (!side || !cpbEnabled()) return;
    const titleEl = side.querySelector("[data-project-lines-side-title]");
    const allEl = side.querySelector("[data-project-lines-side-all]");
    const listEl = side.querySelector("[data-project-lines-side-list]");
    if (!listEl) return;
    if (titleEl) titleEl.textContent = cpbCopy("Projects", "项目");
    if (allEl) {
      allEl.textContent = cpbCopy("All Projects ↗", "全部项目 ↗");
      allEl.setAttribute("href", "/dashboard.html");
      allEl.setAttribute("target", "_blank");
      allEl.setAttribute("rel", "noopener");
      allEl.hidden = cpbGuest();
    }
    listEl.replaceChildren();
    const guest = cpbGuest();
    const linked = !guest ? cpbLinked() : null;
    const summary = cpbFolderCanvasSummary();
    if (guest) {
      const card = document.createElement("div");
      card.className = "cpb-side-card";
      const h4 = document.createElement("h4");
      h4.textContent = cpbCopy("Keep your AI drawings", "保存你的 AI 画布");
      const p = document.createElement("p");
      p.textContent = cpbCopy("Keep your AI drawings in a PenEcho Project — organize with Lines & sharing.", "将 AI 画布收入 PenEcho 项目，使用 Lines 与分享功能。");
      const actions = document.createElement("div");
      actions.className = "cpb-actions";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cpb-btn-primary";
      btn.textContent = cpbCopy("Sign up & create Project", "注册并创建项目");
      btn.addEventListener("click", () => cpbOpenModal({ mode: "guest", trigger: btn }));
      actions.append(btn);
      card.append(h4, p, actions);
      listEl.append(card);
      side.hidden = false;
      return;
    }
    const eligible = cpbState.ownProjects.slice(0, 3);
    if (!eligible.length && summary.isFolder && !linked) {
      const card = document.createElement("div");
      card.className = "cpb-side-card";
      const h4 = document.createElement("h4");
      h4.textContent = cpbCopy("Turn into a Lines Project", "升级为 Lines 项目");
      const p = document.createElement("p");
      p.textContent = cpbCopy(
        `Keep all ${summary.count} canvas${summary.count === 1 ? "" : "es"} from ${summary.folderName} together with Lines & sharing.`,
        `将 ${summary.folderName} 中的 ${summary.count} 张画布收入项目，使用 Lines 与分享。`
      );
      const actions = document.createElement("div");
      actions.className = "cpb-actions";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cpb-btn-primary";
      btn.textContent = cpbCopy("Create Project", "创建项目");
      btn.addEventListener("click", () => cpbOpenModal({ mode: "create", trigger: btn }));
      actions.append(btn);
      card.append(h4, p, actions);
      listEl.append(card);
      side.hidden = false;
      return;
    }
    if (linked) {
      const linkedRow = document.createElement("a");
      linkedRow.className = "cpb-row";
      linkedRow.href = cpbLineProjectHref(linked.key);
      linkedRow.target = "_blank";
      linkedRow.rel = "noopener";
      const nm = document.createElement("span");
      nm.className = "cpb-row-name";
      nm.textContent = linked.name;
      const badge = document.createElement("span");
      badge.className = "cpb-row-badge";
      badge.textContent = cpbCopy("Linked ↗", "已关联 ↗");
      linkedRow.append(nm, badge);
      listEl.append(linkedRow);
    }
    for (const proj of eligible) {
      if (linked && proj.key === linked.key) continue;
      const row = document.createElement("a");
      row.className = "cpb-row";
      row.href = cpbLineProjectHref(proj.key);
      row.target = "_blank";
      row.rel = "noopener";
      const nm = document.createElement("span");
      nm.className = "cpb-row-name";
      nm.textContent = proj.name || proj.key;
      const meta = document.createElement("span");
      meta.className = "cpb-row-meta";
      meta.textContent = "↗";
      row.append(nm, meta);
      listEl.append(row);
    }
    const footActions = document.createElement("div");
    footActions.className = "cpb-side-footer-actions";
    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "cpb-row";
    saveBtn.textContent = cpbCopy("Save this canvas to Project…", "保存画布到已有项目…");
    saveBtn.addEventListener("click", () => cpbOpenModal({ mode: eligible.length ? "save-existing" : "create", trigger: saveBtn }));
    footActions.append(saveBtn);
    if (summary.isFolder && !linked) {
      const upgradeBtn = document.createElement("button");
      upgradeBtn.type = "button";
      upgradeBtn.className = "cpb-row";
      upgradeBtn.textContent = cpbCopy(`Turn ${summary.folderName} into a Project…`, `将 ${summary.folderName} 创建为新项目…`);
      upgradeBtn.addEventListener("click", () => cpbOpenModal({ mode: "create", trigger: upgradeBtn }));
      footActions.append(upgradeBtn);
    } else {
      const newBtn = document.createElement("button");
      newBtn.type = "button";
      newBtn.className = "cpb-row";
      newBtn.textContent = cpbCopy("+ New Project", "+ 新建项目");
      newBtn.addEventListener("click", () => cpbOpenModal({ mode: "create", trigger: newBtn }));
      footActions.append(newBtn);
    }
    listEl.append(footActions);
    side.hidden = false;
  }
  function cpbSyncStaticControls() {
    const active = cpbEnabled();
    const railBtn = document.getElementById("companionRailProjects");
    if (railBtn) {
      railBtn.hidden = !active;
      const tip = cpbCopy("PenEcho Projects", "PenEcho 项目");
      railBtn.title = tip;
      railBtn.setAttribute("aria-label", tip);
    }
    const moreSave = document.getElementById("moreSaveToProjectBtn");
    const moreSaveLabel = document.getElementById("moreSaveToProjectLabel");
    if (moreSave) moreSave.hidden = !active;
    if (moreSaveLabel) moreSaveLabel.textContent = cpbCopy("Save to a Project…", "保存到项目…");
    const moreOpen = document.getElementById("moreOpenProjectsLink");
    const moreOpenLabel = document.getElementById("moreOpenProjectsLabel");
    if (moreOpen) moreOpen.hidden = !active || cpbGuest();
    if (moreOpenLabel) moreOpenLabel.textContent = cpbCopy("Open PenEcho Projects ↗", "打开 PenEcho 项目 ↗");
  }
  function cpbRenderAll() {
    if (!cpbEnabled()) return;
    cpbSyncStaticControls();
    cpbRenderSidebar();
    const pop = document.getElementById("projectBridgePopover");
    if (pop?.matches?.(":popover-open")) cpbRenderPopover();
  }
  function cpbClosePopover() {
    const pop = document.getElementById("projectBridgePopover");
    if (pop?.matches?.(":popover-open")) pop.hidePopover();
  }
  function cpbRenderPopover() {
    const pop = document.getElementById("projectBridgePopover");
    if (!pop) return;
    pop.replaceChildren();
    const guest = cpbGuest();
    const linked = !guest ? cpbLinked() : null;
    const summary = cpbFolderCanvasSummary();
    const title = document.createElement("h3");
    title.id = "projectBridgePopoverTitle";
    const desc = document.createElement("p");
    if (guest) {
      title.textContent = summary.isFolder
        ? cpbCopy(`Keep ${summary.folderName} in a Project`, `将 ${summary.folderName} 保存为项目`)
        : cpbCopy("Save draft to a PenEcho Project", "将草稿保存到 PenEcho 项目");
      desc.textContent = cpbCopy(
        "Temporary draft — sign up free to keep your canvases with Lines & sharing. Your MCP tab stays connected.",
        "临时草稿 — 免费注册即可将画布保存到项目，使用 Lines 与分享。当前 MCP 连接不受影响。"
      );
      const actions = document.createElement("div");
      actions.className = "cpb-actions";
      const cta = document.createElement("button");
      cta.type = "button";
      cta.className = "cpb-btn-primary";
      cta.textContent = cpbCopy("Sign up & create Project", "注册并创建项目");
      cta.addEventListener("click", () => { cpbClosePopover(); cpbOpenModal({ mode: "guest", trigger: cta }); });
      actions.append(cta);
      pop.append(title, desc, actions);
      return;
    }
    if (linked) {
      title.textContent = linked.name;
      desc.textContent = cpbCopy(
        "Linked PenEcho Project. Open it in a new tab to keep MCP connected here, or copy the latest canvas snapshot.",
        "已关联的 PenEcho 项目。在新标签页打开可保持当前 MCP 连接，也可将最新画布快照复制进去。"
      );
      const actions = document.createElement("div");
      actions.className = "cpb-actions";
      const openLink = document.createElement("a");
      openLink.className = "cpb-btn-primary";
      openLink.href = cpbLineProjectHref(linked.key);
      openLink.target = "_blank";
      openLink.rel = "noopener";
      openLink.textContent = cpbCopy("Open Project ↗", "打开项目 ↗");
      openLink.addEventListener("click", cpbClosePopover);
      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "cpb-btn-secondary";
      copyBtn.textContent = cpbCopy("Save snapshot to Project…", "复制画布快照…");
      copyBtn.addEventListener("click", () => { cpbClosePopover(); cpbOpenModal({ mode: "save-existing", defaultProjectKey: linked.key, trigger: copyBtn }); });
      actions.append(openLink, copyBtn);
      pop.append(title, desc, actions);
    } else if (summary.isFolder && !cpbState.ownProjects.length) {
      title.textContent = cpbCopy(`Turn ${summary.folderName} into a Project`, `将 ${summary.folderName} 升级为项目`);
      desc.textContent = cpbCopy(
        `Copies ${summary.count} canvas${summary.count === 1 ? "" : "es"} into a new PenEcho Project with Lines & sharing. Your MCP canvas stays connected.`,
        `将 ${summary.count} 张画布复制到新项目，使用 Lines 与分享。当前 MCP 连接不受影响。`
      );
      const actions = document.createElement("div");
      actions.className = "cpb-actions";
      const cta = document.createElement("button");
      cta.type = "button";
      cta.className = "cpb-btn-primary";
      cta.textContent = cpbCopy("Create Project", "创建项目");
      cta.addEventListener("click", () => { cpbClosePopover(); cpbOpenModal({ mode: "create", trigger: cta }); });
      actions.append(cta);
      pop.append(title, desc, actions);
    } else {
      title.textContent = cpbCopy("PenEcho Projects", "PenEcho 项目");
      desc.textContent = cpbCopy(
        "Save a snapshot of this canvas into an existing Project, or turn this folder into a new Project.",
        "将当前画布快照保存到已有项目，或将此文件夹创建为新项目。"
      );
      const list = document.createElement("div");
      list.className = "cpb-list";
      const saveRow = document.createElement("button");
      saveRow.type = "button";
      saveRow.className = "cpb-row";
      saveRow.textContent = cpbCopy("Save canvas to a Project…", "保存画布到已有项目…");
      saveRow.addEventListener("click", () => { cpbClosePopover(); cpbOpenModal({ mode: "save-existing", trigger: saveRow }); });
      list.append(saveRow);
      if (summary.isFolder) {
        const upgradeRow = document.createElement("button");
        upgradeRow.type = "button";
        upgradeRow.className = "cpb-row";
        upgradeRow.textContent = cpbCopy(`Turn ${summary.folderName} (${summary.count}) into a new Project…`, `将 ${summary.folderName}（${summary.count} 张）创建为新项目…`);
        upgradeRow.addEventListener("click", () => { cpbClosePopover(); cpbOpenModal({ mode: "create", trigger: upgradeRow }); });
        list.append(upgradeRow);
      } else {
        const newRow = document.createElement("button");
        newRow.type = "button";
        newRow.className = "cpb-row";
        newRow.textContent = cpbCopy("+ Create new Project…", "+ 新建项目…");
        newRow.addEventListener("click", () => { cpbClosePopover(); cpbOpenModal({ mode: "create", trigger: newRow }); });
        list.append(newRow);
      }
      pop.append(title, desc, list);
      if (cpbState.ownProjects.length) {
        const sep = document.createElement("hr");
        sep.className = "cpb-sep";
        pop.append(sep);
        const recentList = document.createElement("div");
        recentList.className = "cpb-list";
        for (const proj of cpbState.ownProjects.slice(0, 4)) {
          const link = document.createElement("a");
          link.className = "cpb-row";
          link.href = cpbLineProjectHref(proj.key);
          link.target = "_blank";
          link.rel = "noopener";
          const nm = document.createElement("span");
          nm.className = "cpb-row-name";
          nm.textContent = proj.name || proj.key;
          const arrow = document.createElement("span");
          arrow.className = "cpb-row-meta";
          arrow.textContent = "↗";
          link.append(nm, arrow);
          link.addEventListener("click", cpbClosePopover);
          recentList.append(link);
        }
        pop.append(recentList);
      }
    }
    const foot = document.createElement("div");
    foot.className = "cpb-foot";
    const allLink = document.createElement("a");
    allLink.className = "cpb-link-muted";
    allLink.href = "/dashboard.html";
    allLink.target = "_blank";
    allLink.rel = "noopener";
    allLink.textContent = cpbCopy("All Projects ↗", "全部项目 ↗");
    allLink.addEventListener("click", cpbClosePopover);
    foot.append(allLink);
    if (cpbState.account?.email) {
      const acct = document.createElement("span");
      acct.textContent = cpbState.account.email;
      foot.append(acct);
    }
    pop.append(foot);
  }
  function cpbOpenPopover(anchor) {
    const pop = document.getElementById("projectBridgePopover");
    if (!pop) return;
    if (pop.matches(":popover-open")) { pop.hidePopover(); return; }
    cpbRenderPopover();
    const pos = runtimeElementStyle(pop, "project-bridge-popover");
    if (anchor) {
      const rect = anchor.getBoundingClientRect();
      const fromRail = anchor.id === "companionRailProjects";
      if (fromRail) {
        pos?.setProperty("top", "auto");
        pos?.setProperty("bottom", `${Math.max(12, Math.round(innerHeight - rect.bottom))}px`);
        pos?.setProperty("left", `${Math.round(rect.right + 8)}px`);
      } else {
        pos?.setProperty("bottom", "auto");
        pos?.setProperty("top", `${Math.round(rect.bottom + 6)}px`);
        pos?.setProperty("left", `${Math.max(8, Math.min(Math.round(rect.left), innerWidth - 336))}px`);
      }
    }
    pop.showPopover();
    void cpbLoadState();
  }
  async function cpbEnsureConfirmedCloudCanvases({ wholeFolder = false } = {}) {
    if (wholeFolder && folderProjectEnabled() && !folderProjectGuest()) {
      await window.PenEchoBrowserDraft?.flush?.();
      const savedOk = await folderProjectRun(folderProjectAutosave);
      if (savedOk === false || window.PenEchoFolderProject?.hasPendingBackground?.() || cpbHasUnsavedLocalEdits()) {
        throw Error(cpbCopy("Some edits are still saving to Cloud. Wait a moment and try again so nothing is missed.", "部分改动仍在保存到云端，请稍候片刻重试以免遗漏。"));
      }
      await folderProjectSync();
      const cfg = cpbFolderConfig();
      const allTabs = [...(folderProject.view?.tabs || []), ...(folderProject.view?.closed || [])];
      let canvasIds = allTabs.filter(t => t.canvasId && t.revisionId).map(t => t.canvasId);
      if (!canvasIds.length && canvasHasShareableContent()) {
        const savedId = await saveSnapshot({ location: "cloud", overwriteId: state.currentSnapshotLocation === "cloud" ? state.currentSnapshotId : null, name: currentCanvasDisplayName(), allowEmpty: false });
        if (savedId && state.currentSnapshotRevisionId) canvasIds = [savedId];
      }
      const sourceCloudProjectId = cfg?.cloudProjectId || folderProject.view?.cloudProjectId || null;
      if (!sourceCloudProjectId && !canvasIds.length) {
        throw Error(cpbCopy("No saved canvas revision is ready to copy yet. Draw something or save first.", "还没有可复制的已保存画布版本，请先绘制或保存画布。"));
      }
      return {
        sourceCloudProjectId,
        // Omit canvasIds when sourceCloudProjectId is present so Cloud reads complete folder membership (not the 50-item closed view cap).
        useCompleteFolder: Boolean(sourceCloudProjectId),
        canvasIds,
        activeCanvasId: state.currentSnapshotLocation === "cloud" && state.currentSnapshotRevisionId ? state.currentSnapshotId : (canvasIds[0] || null),
      };
    }
    // Single active canvas snapshot
    await window.PenEchoBrowserDraft?.flush?.();
    if (folderProjectEnabled() && !folderProjectGuest() && cpbHasUnsavedLocalEdits()) {
      const savedOk = await folderProjectRun(folderProjectAutosave);
      if (savedOk === false || cpbHasUnsavedLocalEdits()) {
        throw Error(cpbCopy("Canvas is still saving to Cloud. Please try again in a moment.", "画布仍在保存到云端，请稍后重试。"));
      }
    }
    if (!state.currentSnapshotId || state.currentSnapshotLocation !== "cloud" || !state.currentSnapshotRevisionId || cpbHasUnsavedLocalEdits()) {
      const savedId = await saveSnapshot({
        location: "cloud",
        overwriteId: state.currentSnapshotLocation === "cloud" ? state.currentSnapshotId : null,
        name: currentCanvasDisplayName(),
        allowEmpty: false,
      });
      if (!savedId || !state.currentSnapshotRevisionId) {
        throw Error(cpbCopy("Could not confirm a saved Cloud revision for this canvas. Please try saving first.", "未能确认此画布的云端保存版本，请先保存画布。"));
      }
    }
    return { sourceCloudProjectId: null, useCompleteFolder: false, canvasIds: [state.currentSnapshotId], activeCanvasId: state.currentSnapshotId };
  }
  async function cpbCopyToMyCanvases(canvasIds) {
    await cpbFetch("/api/v1/my-canvases", { method: "POST", body: {} });
    const copied = [], failed = [];
    for (const id of canvasIds) {
      try {
        const res = await cpbFetch("/api/v1/line-projects/my-canvases/canvases", { method: "POST", body: { from: `cloud:${id}` } });
        copied.push({ canvasId: id, source: res.source || res.canvas?.source || null, reused: Boolean(res.reused) });
      } catch (error) {
        failed.push({ canvasId: id, reason: String(error?.message || error) });
      }
    }
    return { copied, failed };
  }
  function cpbBuildDialogHeader(dialog, titleText) {
    const head = document.createElement("div");
    head.className = "cpb-dialog-head";
    const h2 = document.createElement("h2");
    h2.id = "companionProjectModalTitle";
    h2.textContent = titleText;
    const close = document.createElement("button");
    close.type = "button";
    close.className = "cpb-dialog-close";
    close.setAttribute("aria-label", cpbCopy("Close", "关闭"));
    close.textContent = "×";
    close.addEventListener("click", () => dialog.close());
    head.append(h2, close);
    return head;
  }
  function cpbBuildAccountFooter() {
    if (!cpbState.account?.email) return null;
    const foot = document.createElement("div");
    foot.className = "cpb-foot";
    const info = document.createElement("span");
    const used = cpbState.ownProjects.length;
    info.textContent = cpbIsPaidAccount()
      ? cpbCopy(`Signed in as ${cpbState.account.email}`, `当前账号：${cpbState.account.email}`)
      : cpbCopy(`Signed in as ${cpbState.account.email} · ${used} of 3 free Projects used`, `当前账号：${cpbState.account.email} · 免费项目已用 ${used}/3`);
    foot.append(info);
    return foot;
  }
  function cpbRenderLimitFallback(container, dialog, { canvasIds, onPickExisting, onMyCanvasesDone, errBox }) {
    container.replaceChildren();
    const msg = document.createElement("div");
    msg.textContent = cpbCopy(
      "You’ve reached 3 Projects on the free plan. Save to an existing Project or My Canvases instead.",
      "免费版最多保留 3 个项目。可保存到已有项目或「我的画布」。"
    );
    const limitActions = document.createElement("div");
    limitActions.className = "cpb-actions";
    if (cpbState.ownProjects.length && onPickExisting) {
      const pickExisting = document.createElement("button");
      pickExisting.type = "button";
      pickExisting.className = "cpb-btn-secondary";
      pickExisting.textContent = cpbCopy("Save to an existing Project", "保存到已有项目");
      pickExisting.addEventListener("click", () => onPickExisting(canvasIds));
      limitActions.append(pickExisting);
    }
    const myBtn = document.createElement("button");
    myBtn.type = "button";
    myBtn.className = "cpb-btn-primary";
    myBtn.textContent = cpbCopy("Save to My Canvases (free)", "保存到我的画布（免费）");
    const runMyCanvases = async (idsToCopy, previouslyCopied = 0) => {
      myBtn.disabled = true;
      if (errBox) errBox.hidden = true;
      try {
        const res = await cpbCopyToMyCanvases(idsToCopy);
        const totalCopied = previouslyCopied + res.copied.length;
        if (!totalCopied) throw Error(res.failed[0]?.reason || cpbCopy("Could not copy to My Canvases.", "无法复制到我的画布。"));
        const remainingIds = res.failed.map(f => f.canvasId);
        if (onMyCanvasesDone) onMyCanvasesDone({ copiedCount: totalCopied, failed: res.failed });
        cpbShowSuccessDialog(dialog, {
          projectKey: "my-canvases",
          projectName: cpbCopy("My Canvases", "我的画布"),
          copiedCount: totalCopied,
          hash: "canvases",
          failed: res.failed,
          onRetry: remainingIds.length ? () => runMyCanvases(remainingIds, totalCopied) : null,
        });
      } catch (copyErr) {
        if (errBox && dialog.contains(errBox)) {
          errBox.textContent = String(copyErr?.message || copyErr);
          errBox.hidden = false;
        } else {
          setStatus(String(copyErr?.message || copyErr));
        }
        myBtn.disabled = false;
      }
    };
    myBtn.addEventListener("click", () => void runMyCanvases(canvasIds, 0));
    const upgradeLink = document.createElement("a");
    upgradeLink.className = "cpb-link-muted";
    upgradeLink.href = "/dashboard.html#billing";
    upgradeLink.target = "_blank";
    upgradeLink.rel = "noopener";
    upgradeLink.textContent = cpbCopy("Upgrade plan ↗", "升级方案 ↗");
    limitActions.append(myBtn, upgradeLink);
    container.append(msg, limitActions);
    container.hidden = false;
  }
  function cpbShowSuccessDialog(dialog, { projectKey, projectName, copiedCount, summaryText, hash = "", starterLineCreated = false, skipped = [], failed = [], onRetry = null }) {
    const nothingCopied = copiedCount <= 0;
    dialog.replaceChildren(cpbBuildDialogHeader(dialog, nothingCopied ? cpbCopy("No canvases were copied", "未能复制画布") : cpbCopy("Project ready", "项目已就绪")));
    if (!nothingCopied) {
      const box = document.createElement("div");
      box.className = "cpb-success-box";
      const strong = document.createElement("strong");
      strong.textContent = summaryText || cpbCopy(
        `Copied ${copiedCount} canvas snapshot${copiedCount === 1 ? "" : "s"} into ${projectName}.`,
        `已将 ${copiedCount} 张画布快照复制到「${projectName}」。`
      );
      box.append(strong);
      if (starterLineCreated) {
        const sub = document.createElement("div");
        sub.textContent = cpbCopy("A starter Line was created with your canvas attached (no AI run until you ask).", "已用此画布创建一条起始 Line（在你提问前不会自动运行 AI）。");
        box.append(sub);
      }
      const liveNote = document.createElement("div");
      liveNote.textContent = cpbCopy("Your MCP companion tab stays connected here.", "当前 MCP 画布连接保持在线。");
      box.append(liveNote);
      dialog.append(box);
    }
    if (skipped.length) {
      const skipNote = document.createElement("div");
      skipNote.className = "cpb-note";
      skipNote.textContent = cpbCopy(
        `${skipped.length} canvas${skipped.length === 1 ? " was" : "es were"} skipped because no saved revision was found.`,
        `有 ${skipped.length} 张画布尚未保存云端版本，已跳过。`
      );
      dialog.append(skipNote);
    }
    const retryErr = document.createElement("div");
    retryErr.className = "cpb-error";
    retryErr.hidden = true;
    if (failed.length || nothingCopied) {
      const warn = document.createElement("div");
      warn.className = "cpb-warning";
      warn.textContent = failed.length
        ? cpbCopy(
          `${failed.length} canvas${failed.length === 1 ? "" : "es"} could not be copied yet. You can retry missing canvases into the same Project.`,
          `有 ${failed.length} 张画布未能复制，可直接重试复制到同一项目。`
        )
        : cpbCopy(
          "No saved canvases were copied into this Project yet.",
          "尚未将已保存的画布复制到此项目。"
        );
      dialog.append(warn);
    }
    dialog.append(retryErr);
    const actions = document.createElement("div");
    actions.className = "cpb-dialog-actions cpb-dialog-actions-split";
    const left = document.createElement("div");
    left.className = "cpb-actions";
    if (!nothingCopied) {
      const sameTab = document.createElement("a");
      sameTab.className = "cpb-link-muted";
      sameTab.href = cpbLineProjectHref(projectKey, { fromMcp: projectKey !== "my-canvases", copied: copiedCount, sameTabReturn: true, hash });
      sameTab.textContent = cpbCopy("Open here (pauses MCP until you return)", "在当前页打开（返回前会暂停 MCP）");
      left.append(sameTab);
    }
    const right = document.createElement("div");
    right.className = "cpb-actions";
    if ((failed.length || nothingCopied) && onRetry) {
      const retryBtn = document.createElement("button");
      retryBtn.type = "button";
      retryBtn.className = nothingCopied ? "cpb-btn-primary" : "cpb-btn-secondary";
      retryBtn.textContent = cpbCopy("Retry missing canvases", "重试未复制画布");
      retryBtn.addEventListener("click", async () => {
        retryBtn.disabled = true;
        retryErr.hidden = true;
        try {
          await onRetry();
        } catch (err) {
          retryErr.textContent = String(err?.message || err);
          retryErr.hidden = false;
          retryBtn.disabled = false;
        }
      });
      right.append(retryBtn);
    }
    if (!nothingCopied) {
      const openLink = document.createElement("a");
      openLink.className = "cpb-btn-primary";
      openLink.href = cpbLineProjectHref(projectKey, { fromMcp: projectKey !== "my-canvases", copied: copiedCount, hash });
      openLink.target = "_blank";
      openLink.rel = "noopener";
      openLink.textContent = projectKey === "my-canvases"
        ? cpbCopy("Open My Canvases ↗", "打开我的画布 ↗")
        : cpbCopy("Open Project ↗", "打开项目 ↗");
      right.append(openLink);
    }
    actions.append(left, right);
    dialog.append(actions);
    const foot = cpbBuildAccountFooter();
    if (foot) dialog.append(foot);
  }
  function cpbOpenModal({ mode = "create", defaultProjectKey = "", batchCanvasIds = null, trigger = null } = {}) {
    const dialog = document.getElementById("companionProjectModal");
    if (!dialog) return;
    cpbState.lastTrigger = trigger || document.activeElement;
    cpbState.clearIntentOnClose = false;
    if (cpbGuest()) mode = "guest";
    const operationId = crypto.randomUUID();
    const summary = cpbFolderCanvasSummary();
    const activeTitle = currentCanvasDisplayName() || cpbCopy("Untitled Canvas", "未命名画布");
    const defaultName = summary.folderName || activeTitle;

    const renderMode = (currentMode, opts = {}) => {
      dialog.replaceChildren();
      if (currentMode === "guest") {
        dialog.append(cpbBuildDialogHeader(dialog, cpbCopy("Save to a PenEcho Project", "保存到 PenEcho 项目")));
        const note = document.createElement("p");
        note.className = "cpb-note";
        note.textContent = cpbCopy(
          "Temporary draft — sign up free to keep this canvas in a PenEcho Project with Lines & sharing. Your strokes will be saved before signing in.",
          "临时草稿 — 免费注册即可将画布保存到 PenEcho 项目，使用 Lines 与分享。登录前会先保存你的笔迹。"
        );
        const field = document.createElement("div");
        field.className = "cpb-field";
        const lbl = document.createElement("label");
        lbl.htmlFor = "cpbGuestProjectName";
        lbl.textContent = cpbCopy("Project name", "项目名称");
        const input = document.createElement("input");
        input.id = "cpbGuestProjectName";
        input.className = "cpb-input";
        input.type = "text";
        input.maxLength = 160;
        input.value = defaultName;
        field.append(lbl, input);
        const starterWrap = document.createElement("label");
        starterWrap.className = "cpb-check";
        const starterCb = document.createElement("input");
        starterCb.type = "checkbox";
        starterCb.checked = summary.count <= 1;
        const starterTxt = document.createElement("span");
        starterTxt.textContent = cpbCopy(
          `Also create a starter Line with "${activeTitle}" (no AI run until you ask)`,
          `同时用「${activeTitle}」创建一条起始 Line（在你提问前不会运行 AI）`
        );
        starterWrap.append(starterCb, starterTxt);
        const errBox = document.createElement("div");
        errBox.className = "cpb-error";
        errBox.hidden = true;
        const actions = document.createElement("div");
        actions.className = "cpb-dialog-actions";
        const cancelBtn = document.createElement("button");
        cancelBtn.type = "button";
        cancelBtn.className = "cpb-btn-secondary";
        cancelBtn.textContent = cpbCopy("Cancel", "取消");
        cancelBtn.addEventListener("click", () => dialog.close());
        const submitBtn = document.createElement("button");
        submitBtn.type = "button";
        submitBtn.className = "cpb-btn-primary";
        submitBtn.textContent = cpbCopy("Sign up & create Project", "注册并创建项目");
        submitBtn.addEventListener("click", async () => {
          const name = input.value.trim();
          if (!name) { errBox.textContent = cpbCopy("Give the Project a name.", "请输入项目名称。"); errBox.hidden = false; input.focus(); return; }
          submitBtn.disabled = true;
          errBox.hidden = true;
          try {
            const ok = await window.PenEchoBrowserDraft?.signIn({
              intent: "promote_to_project",
              signup: true,
              projectName: name,
              createStarterLine: starterCb.checked,
              operationId,
              guestProjectId: cpbFolderConfig()?.guestProjectId || "",
            });
            if (ok === false) {
              errBox.textContent = cpbCopy("Could not store your draft before signing in. Please try again in a moment.", "登录前未能保存草稿，请稍后重试。");
              errBox.hidden = false;
              submitBtn.disabled = false;
            }
          } catch (error) {
            errBox.textContent = String(error?.message || error);
            errBox.hidden = false;
            submitBtn.disabled = false;
          }
        });
        actions.append(cancelBtn, submitBtn);
        dialog.append(note, field, starterWrap, errBox, actions);
        return;
      }

      if (currentMode === "create") {
        dialog.append(cpbBuildDialogHeader(dialog, summary.isFolder ? cpbCopy("Turn into a Lines Project", "升级为 Lines 项目") : cpbCopy("Create a PenEcho Project", "创建 PenEcho 项目")));
        const field = document.createElement("div");
        field.className = "cpb-field";
        const lbl = document.createElement("label");
        lbl.htmlFor = "cpbProjectName";
        lbl.textContent = cpbCopy("Project name", "项目名称");
        const input = document.createElement("input");
        input.id = "cpbProjectName";
        input.className = "cpb-input";
        input.type = "text";
        input.maxLength = 160;
        input.value = defaultName;
        field.append(lbl, input);
        const note = document.createElement("p");
        note.className = "cpb-note";
        const unsavedNote = cpbHasUnsavedLocalEdits() ? cpbCopy(" Current edits will be saved first.", " 当前未保存的改动会先自动保存。") : "";
        note.textContent = summary.isFolder
          ? cpbCopy(
            `Copies ${summary.count} saved canvas${summary.count === 1 ? "" : "es"} from ${summary.folderName} into your new Project (snapshots). Your MCP tab stays connected.${unsavedNote}`,
            `将 ${summary.folderName} 中的 ${summary.count} 张画布快照复制到新项目中。当前 MCP 连接不受影响。${unsavedNote}`
          )
          : cpbCopy(
            `Copies this canvas snapshot into your new Project. Your MCP tab stays connected.${unsavedNote}`,
            `将此画布快照复制到新项目中。当前 MCP 连接不受影响。${unsavedNote}`
          );
        const starterWrap = document.createElement("label");
        starterWrap.className = "cpb-check";
        const starterCb = document.createElement("input");
        starterCb.type = "checkbox";
        // Decision #2 (Recommended): unchecked for multi-canvas folders, checked for single-canvas drafts.
        starterCb.checked = summary.count <= 1;
        const starterTxt = document.createElement("span");
        starterTxt.textContent = cpbCopy(
          `Also create a starter Line with "${activeTitle}" (no AI run until you ask)`,
          `同时用「${activeTitle}」创建一条起始 Line（在你提问前不会运行 AI）`
        );
        starterWrap.append(starterCb, starterTxt);
        const limitBox = document.createElement("div");
        limitBox.className = "cpb-warning";
        limitBox.hidden = true;
        const errBox = document.createElement("div");
        errBox.className = "cpb-error";
        errBox.hidden = true;
        const actions = document.createElement("div");
        actions.className = "cpb-dialog-actions";
        const cancelBtn = document.createElement("button");
        cancelBtn.type = "button";
        cancelBtn.className = "cpb-btn-secondary";
        cancelBtn.textContent = cpbCopy("Cancel", "取消");
        cancelBtn.addEventListener("click", () => dialog.close());
        const submitBtn = document.createElement("button");
        submitBtn.type = "button";
        submitBtn.className = "cpb-btn-primary";
        submitBtn.textContent = cpbCopy("Create Project", "创建项目");

        let frozenName = "";
        let frozenStarter = false;
        const runCreate = async ({ isRetry = false } = {}) => {
          const name = isRetry ? frozenName : input.value.trim();
          const wantStarter = isRetry ? frozenStarter : starterCb.checked;
          if (!name) { errBox.textContent = cpbCopy("Give the Project a name.", "请输入项目名称。"); errBox.hidden = false; input.focus(); return; }
          frozenName = name;
          frozenStarter = wantStarter;
          if (!isRetry) {
            submitBtn.disabled = true;
            errBox.hidden = true;
            limitBox.hidden = true;
          }
          let confirmed;
          try {
            confirmed = await cpbEnsureConfirmedCloudCanvases({ wholeFolder: summary.isFolder });
          } catch (error) {
            if (isRetry) throw error;
            errBox.textContent = String(error?.message || error);
            errBox.hidden = false;
            submitBtn.disabled = false;
            return;
          }
          try {
            const payload = {
              name,
              operationId,
              ...(confirmed.sourceCloudProjectId ? { sourceCloudProjectId: confirmed.sourceCloudProjectId } : {}),
              ...(!confirmed.useCompleteFolder ? { canvasIds: confirmed.canvasIds } : {}),
            };
            const created = await cpbFetch("/api/v1/line-projects", { method: "POST", body: payload });
            const projectKey = created.project?.key;
            const projectName = created.project?.name || name;
            const copied = Array.isArray(created.copied) ? created.copied : [];
            const skipped = Array.isArray(created.skipped) ? created.skipped : [];
            const failed = Array.isArray(created.failed) ? created.failed : [];
            let starterLineCreated = false;
            if (wantStarter && projectKey && copied.length) {
              const first = copied.find(c => c.canvasId === confirmed.activeCanvasId && c.source) || copied.find(c => c.source);
              if (first?.source) {
                await cpbFetch(`/api/v1/line-projects/${encodeURIComponent(projectKey)}/yours`, {
                  method: "POST",
                  body: { kind: "canvas", picture: first.source, topic: "new" },
                }).then(() => { starterLineCreated = true; }).catch(() => {});
              }
            }
            if (confirmed.sourceCloudProjectId && projectKey && copied.length > 0 && cpbFolderConfig()) {
              cpbFolderConfig().linkedLineProject = { key: projectKey, name: projectName };
            }
            void cpbLoadState({ force: true });
            cpbRenderAll();
            cpbShowSuccessDialog(dialog, {
              projectKey,
              projectName,
              copiedCount: copied.length,
              starterLineCreated,
              skipped,
              failed,
              onRetry: (failed.length || !copied.length) ? () => runCreate({ isRetry: true }) : null,
            });
          } catch (error) {
            if (isRetry) throw error;
            submitBtn.disabled = false;
            if (cpbIsProjectLimitError(error)) {
              cpbRenderLimitFallback(limitBox, dialog, {
                canvasIds: confirmed.canvasIds,
                errBox,
                onPickExisting: (ids) => renderMode("save-existing", { batchIds: ids }),
              });
              return;
            }
            errBox.textContent = String(error?.message || error);
            errBox.hidden = false;
          }
        };
        submitBtn.addEventListener("click", () => void runCreate({ isRetry: false }));
        actions.append(cancelBtn, submitBtn);
        dialog.append(field, note, starterWrap, limitBox, errBox, actions);
        const foot = cpbBuildAccountFooter();
        if (foot) dialog.append(foot);
        return;
      }

      // Mode: save-existing (State C, or multi-canvas folder fallback from 409 project_limit)
      const explicitBatchIds = Array.isArray(opts.batchIds || batchCanvasIds) && (opts.batchIds || batchCanvasIds).length > 1
        ? [...(opts.batchIds || batchCanvasIds)]
        : null;
      dialog.append(cpbBuildDialogHeader(dialog, explicitBatchIds
        ? cpbCopy(`Save ${explicitBatchIds.length} canvases to a Project`, `将 ${explicitBatchIds.length} 张画布保存到项目`)
        : cpbCopy("Save canvas to a Project", "保存画布到项目")));
      const targetField = document.createElement("div");
      targetField.className = "cpb-field";
      const targetLbl = document.createElement("label");
      targetLbl.htmlFor = "cpbTargetProject";
      targetLbl.textContent = cpbCopy("Destination Project", "目标项目");
      const targetSel = document.createElement("select");
      targetSel.id = "cpbTargetProject";
      targetSel.className = "cpb-select";
      for (const proj of cpbState.ownProjects) {
        const opt = document.createElement("option");
        opt.value = proj.key;
        opt.textContent = proj.name || proj.key;
        targetSel.append(opt);
      }
      const myOpt = document.createElement("option");
      myOpt.value = "my-canvases";
      myOpt.textContent = cpbCopy("My Canvases (always free)", "我的画布（始终免费）");
      targetSel.append(myOpt);
      if (!explicitBatchIds) {
        const newOpt = document.createElement("option");
        newOpt.value = "__new__";
        newOpt.textContent = cpbCopy("+ Create new Project…", "+ 新建项目…");
        targetSel.append(newOpt);
      }
      if (defaultProjectKey && [...targetSel.options].some(o => o.value === defaultProjectKey)) targetSel.value = defaultProjectKey;
      targetField.append(targetLbl, targetSel);

      const actionField = document.createElement("div");
      actionField.className = "cpb-field";
      const actionLbl = document.createElement("label");
      actionLbl.htmlFor = "cpbLineAction";
      actionLbl.textContent = cpbCopy("Where to place this canvas", "放置方式");
      const actionSel = document.createElement("select");
      actionSel.id = "cpbLineAction";
      actionSel.className = "cpb-select";
      for (const [val, en, zh] of [
        ["library", "Library only (Canvases & files)", "仅保存到资料库（画布与文件）"],
        ["attach", "Attach to an existing Line…", "附加到已有 Line…"],
        ["starter", "Create a starter Line (no AI run until you ask)", "创建一条起始 Line（不自动运行 AI）"],
      ]) {
        const opt = document.createElement("option");
        opt.value = val;
        opt.textContent = cpbCopy(en, zh);
        actionSel.append(opt);
      }
      actionField.append(actionLbl, actionSel);
      if (explicitBatchIds) actionField.hidden = true;

      const lineField = document.createElement("div");
      lineField.className = "cpb-field";
      lineField.hidden = true;
      const lineLbl = document.createElement("label");
      lineLbl.htmlFor = "cpbTargetLine";
      lineLbl.textContent = cpbCopy("Choose Line", "选择 Line");
      const lineSel = document.createElement("select");
      lineSel.id = "cpbTargetLine";
      lineSel.className = "cpb-select";
      lineField.append(lineLbl, lineSel);

      let pickerSeq = 0;
      const syncLinePicker = async () => {
        const seq = ++pickerSeq;
        const key = targetSel.value;
        if (key === "__new__") { renderMode("create"); return; }
        const isMy = key === "my-canvases";
        actionField.hidden = isMy || Boolean(explicitBatchIds);
        if (isMy || explicitBatchIds) { lineField.hidden = true; return; }
        lineField.hidden = actionSel.value !== "attach";
        if (actionSel.value === "attach") {
          lineSel.replaceChildren();
          const loadingOpt = document.createElement("option");
          loadingOpt.value = "";
          loadingOpt.textContent = cpbCopy("Loading Lines…", "正在加载 Lines…");
          lineSel.append(loadingOpt);
          const rows = await cpbLoadProjectLines(key);
          // Discard out-of-order responses if destination or mode changed while loading.
          if (seq !== pickerSeq || targetSel.value !== key || actionSel.value !== "attach") return;
          lineSel.replaceChildren();
          if (!rows.length) {
            const none = document.createElement("option");
            none.value = "";
            none.textContent = cpbCopy("No open Lines yet (choose Library or Starter Line)", "暂无进行中的 Line（请选择资料库或起始 Line）");
            lineSel.append(none);
          } else {
            for (const row of rows) {
              const opt = document.createElement("option");
              opt.value = row.slug;
              opt.textContent = row.title;
              lineSel.append(opt);
            }
          }
        }
      };
      targetSel.addEventListener("change", () => void syncLinePicker());
      actionSel.addEventListener("change", () => void syncLinePicker());

      const note = document.createElement("p");
      note.className = "cpb-note";
      note.textContent = explicitBatchIds
        ? cpbCopy(
          `Copies all ${explicitBatchIds.length} saved canvas snapshots into the chosen Project’s Canvases & files. Your MCP canvas stays connected.`,
          `将这 ${explicitBatchIds.length} 张已保存的画布快照复制到所选项目的「画布与文件」中。当前 MCP 连接不受影响。`
        )
        : cpbCopy(
          `Copies a snapshot of "${activeTitle}" into the chosen Project. Your MCP canvas stays connected.`,
          `将「${activeTitle}」的快照复制到所选项目中。当前 MCP 连接不受影响。`
        );
      const errBox = document.createElement("div");
      errBox.className = "cpb-error";
      errBox.hidden = true;
      const actions = document.createElement("div");
      actions.className = "cpb-dialog-actions";
      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "cpb-btn-secondary";
      cancelBtn.textContent = cpbCopy("Cancel", "取消");
      cancelBtn.addEventListener("click", () => dialog.close());
      const submitBtn = document.createElement("button");
      submitBtn.type = "button";
      submitBtn.className = "cpb-btn-primary";
      submitBtn.textContent = explicitBatchIds
        ? cpbCopy(`Save ${explicitBatchIds.length} snapshots`, `保存 ${explicitBatchIds.length} 张快照`)
        : cpbCopy("Save snapshot", "保存快照");
      submitBtn.addEventListener("click", async () => {
        // Freeze destination + Line pair before any async work.
        const frozenKey = targetSel.value;
        const frozenProjName = targetSel.selectedOptions[0]?.textContent || frozenKey;
        const frozenAction = (frozenKey === "my-canvases" || explicitBatchIds) ? "library" : actionSel.value;
        const frozenLineSlug = frozenAction === "attach" ? lineSel.value : "";
        const frozenLineTitle = frozenAction === "attach" ? (lineSel.selectedOptions[0]?.textContent || frozenLineSlug) : "";
        if (frozenKey === "__new__") { renderMode("create"); return; }
        if (frozenAction === "attach" && !frozenLineSlug) {
          errBox.textContent = cpbCopy("Choose an existing Line, or switch to Library / Starter Line.", "请选择一条已有 Line，或切换为仅保存到资料库 / 创建起始 Line。");
          errBox.hidden = false;
          return;
        }
        submitBtn.disabled = true;
        errBox.hidden = true;
        try {
          if (frozenKey === "my-canvases") await cpbFetch("/api/v1/my-canvases", { method: "POST", body: {} });
          if (explicitBatchIds) {
            const copyBatch = async (idsToCopy, previouslyCopied = 0) => {
              const copied = [], failed = [];
              for (const id of idsToCopy) {
                try {
                  const res = await cpbFetch(`/api/v1/line-projects/${encodeURIComponent(frozenKey)}/canvases`, {
                    method: "POST",
                    body: { from: `cloud:${id}` },
                  });
                  copied.push({ canvasId: id, source: res.source || res.canvas?.source || null });
                } catch (err) {
                  failed.push({ canvasId: id, reason: String(err?.message || err) });
                }
              }
              const total = previouslyCopied + copied.length;
              const remaining = failed.map(f => f.canvasId);
              cpbShowSuccessDialog(dialog, {
                projectKey: frozenKey,
                projectName: frozenProjName,
                copiedCount: total,
                hash: frozenKey === "my-canvases" ? "canvases" : "",
                failed,
                onRetry: remaining.length ? () => copyBatch(remaining, total) : null,
              });
            };
            await copyBatch(explicitBatchIds, 0);
            return;
          }
          const confirmed = await cpbEnsureConfirmedCloudCanvases({ wholeFolder: false });
          const created = await cpbFetch(`/api/v1/line-projects/${encodeURIComponent(frozenKey)}/canvases`, {
            method: "POST",
            body: { from: `cloud:${confirmed.activeCanvasId}` },
          });
          const source = created.source || created.canvas?.source || null;
          let summaryText = created.reused
            ? cpbCopy(`Kept existing snapshot in ${frozenProjName}.`, `已在「${frozenProjName}」中保留现有快照。`)
            : cpbCopy(`Copied snapshot into ${frozenProjName}.`, `已将画布快照复制到「${frozenProjName}」。`);
          let hash = frozenKey === "my-canvases" ? "canvases" : "";
          let starterLineCreated = false;
          if (frozenAction === "attach" && source && frozenLineSlug) {
            await cpbFetch(`/api/v1/line-projects/${encodeURIComponent(frozenKey)}/canvases/attach`, {
              method: "POST",
              body: { path: source, topic: frozenLineSlug },
            });
            summaryText = cpbCopy(`Copied & attached snapshot to "${frozenLineTitle}" in ${frozenProjName}.`, `已复制并附加到「${frozenProjName}」的 Line「${frozenLineTitle}」。`);
            hash = `line/${encodeURIComponent(frozenLineSlug)}`;
          } else if (frozenAction === "starter" && source) {
            await cpbFetch(`/api/v1/line-projects/${encodeURIComponent(frozenKey)}/yours`, {
              method: "POST",
              body: { kind: "canvas", picture: source, topic: "new" },
            });
            starterLineCreated = true;
          }
          cpbShowSuccessDialog(dialog, {
            projectKey: frozenKey,
            projectName: frozenProjName,
            copiedCount: 1,
            summaryText,
            hash,
            starterLineCreated,
          });
        } catch (error) {
          errBox.textContent = String(error?.message || error);
          errBox.hidden = false;
          submitBtn.disabled = false;
        }
      });
      actions.append(cancelBtn, submitBtn);
      dialog.append(targetField, actionField, lineField, note, errBox, actions);
      const foot = cpbBuildAccountFooter();
      if (foot) dialog.append(foot);
      void syncLinePicker();
    };

    renderMode(mode);
    if (!dialog.open) dialog.showModal();
    void cpbLoadState();
  }
  async function cpbResumePromote(intent) {
    const dialog = document.getElementById("companionProjectModal");
    if (dialog) {
      cpbState.clearIntentOnClose = false;
      dialog.replaceChildren(cpbBuildDialogHeader(dialog, cpbCopy("Creating your Project…", "正在创建项目…")));
      const p = document.createElement("p");
      p.className = "cpb-note";
      p.textContent = cpbCopy("Saving your canvas and setting up your PenEcho Project…", "正在保存画布并创建 PenEcho 项目…");
      dialog.append(p);
      if (!dialog.open) dialog.showModal();
    }
    let sourceCloudProjectId = null;
    let canvasIds = [];
    let activeCanvasId = null;
    let useCompleteFolder = false;
    try {
      await cpbLoadState();
      if (folderProjectGuest() || intent.guestProjectId) {
        if (folderProjectGuest()) {
          const kept = await folderProjectKeep({ reload: false });
          if (!kept || !kept.cloudProjectId) throw Error(cpbCopy("Could not claim your guest folder canvases. Please try again.", "未能保存临时文件夹画布，请重试。"));
          sourceCloudProjectId = kept.cloudProjectId;
        } else {
          sourceCloudProjectId = cpbFolderConfig()?.cloudProjectId || null;
        }
        await folderProjectSync();
        const allTabs = [...(folderProject.view?.tabs || []), ...(folderProject.view?.closed || [])];
        canvasIds = allTabs.filter(t => t.canvasId && t.revisionId).map(t => t.canvasId);
        activeCanvasId = state.currentSnapshotId || canvasIds[0] || null;
        useCompleteFolder = Boolean(sourceCloudProjectId);
      } else {
        if (intent.documentId && intent.documentId !== canvasDocuments.activeId) {
          throw Error(cpbCopy("Signed in. Open the Canvas you were promoting and choose Save to Project.", "已登录。请打开要保存的画布，然后再次选择保存到项目。"));
        }
        const confirmed = await cpbEnsureConfirmedCloudCanvases({ wholeFolder: false });
        canvasIds = confirmed.canvasIds;
        activeCanvasId = confirmed.activeCanvasId;
      }
      const name = String(intent.projectName || cpbFolderConfig()?.name || currentCanvasDisplayName() || "Project").trim().slice(0, 160);
      const operationId = intent.operationId || crypto.randomUUID();
      const created = await cpbFetch("/api/v1/line-projects", {
        method: "POST",
        body: {
          name,
          operationId,
          ...(sourceCloudProjectId ? { sourceCloudProjectId } : {}),
          ...(!useCompleteFolder && canvasIds.length ? { canvasIds } : {}),
        },
      });
      const projectKey = created.project?.key;
      const projectName = created.project?.name || name;
      const copied = Array.isArray(created.copied) ? created.copied : [];
      const skipped = Array.isArray(created.skipped) ? created.skipped : [];
      const failed = Array.isArray(created.failed) ? created.failed : [];
      let starterLineCreated = false;
      if (intent.createStarterLine && projectKey && copied.length) {
        const first = copied.find(c => c.canvasId === activeCanvasId && c.source) || copied.find(c => c.source);
        if (first?.source) {
          await cpbFetch(`/api/v1/line-projects/${encodeURIComponent(projectKey)}/yours`, {
            method: "POST",
            body: { kind: "canvas", picture: first.source, topic: "new" },
          }).then(() => { starterLineCreated = true; }).catch(() => {});
        }
      }
      if (sourceCloudProjectId && projectKey && copied.length > 0 && cpbFolderConfig()) {
        cpbFolderConfig().linkedLineProject = { key: projectKey, name: projectName };
      }
      if (copied.length > 0 && failed.length === 0) {
        canvasDocumentsClearIntent();
        cpbState.clearIntentOnClose = false;
      } else {
        cpbState.clearIntentOnClose = true;
      }
      void cpbLoadState({ force: true });
      cpbRenderAll();
      if (dialog) {
        cpbShowSuccessDialog(dialog, {
          projectKey,
          projectName,
          copiedCount: copied.length,
          starterLineCreated,
          skipped,
          failed,
          onRetry: (failed.length || !copied.length) ? () => cpbResumePromote(intent) : null,
        });
      }
      return copied.length > 0 && failed.length === 0;
    } catch (error) {
      setStatus(String(error?.message || error));
      if (dialog) {
        cpbState.clearIntentOnClose = true;
        if (cpbIsProjectLimitError(error)) {
          dialog.replaceChildren(cpbBuildDialogHeader(dialog, cpbCopy("Free plan Project limit reached", "已达免费版项目上限")));
          const limitBox = document.createElement("div");
          limitBox.className = "cpb-warning";
          const errBox = document.createElement("div");
          errBox.className = "cpb-error";
          errBox.hidden = true;
          cpbRenderLimitFallback(limitBox, dialog, {
            canvasIds,
            errBox,
            onPickExisting: (ids) => {
              canvasDocumentsClearIntent();
              cpbState.clearIntentOnClose = false;
              cpbOpenModal({ mode: "save-existing", batchCanvasIds: ids });
            },
            onMyCanvasesDone: ({ failed }) => {
              if (!failed.length) {
                canvasDocumentsClearIntent();
                cpbState.clearIntentOnClose = false;
              }
            },
          });
          dialog.append(limitBox, errBox);
          const foot = cpbBuildAccountFooter();
          if (foot) dialog.append(foot);
          return false;
        }
        dialog.replaceChildren(cpbBuildDialogHeader(dialog, cpbCopy("Could not finish creating Project", "未能完成项目创建")));
        const err = document.createElement("div");
        err.className = "cpb-error";
        err.textContent = String(error?.message || error);
        const actions = document.createElement("div");
        actions.className = "cpb-dialog-actions";
        const dismiss = document.createElement("button");
        dismiss.type = "button";
        dismiss.className = "cpb-btn-secondary";
        dismiss.textContent = cpbCopy("Cancel", "取消");
        dismiss.addEventListener("click", () => dialog.close());
        const retry = document.createElement("button");
        retry.type = "button";
        retry.className = "cpb-btn-primary";
        retry.textContent = cpbCopy("Retry", "重试");
        retry.addEventListener("click", () => void cpbResumePromote(intent));
        actions.append(dismiss, retry);
        dialog.append(err, actions);
      }
      return false;
    }
  }
  window.PenEchoCompanionProjectBridge = {
    enabled: cpbEnabled,
    render: cpbRenderAll,
    renderSidebar: cpbRenderSidebar,
    openPopover: cpbOpenPopover,
    openModal: cpbOpenModal,
    resumePromote: cpbResumePromote,
    refresh: () => cpbLoadState({ force: true }),
  };
  if (cpbEnabled()) {
    const modal = document.getElementById("companionProjectModal");
    modal?.addEventListener("close", () => {
      if (cpbState.clearIntentOnClose) {
        canvasDocumentsClearIntent();
        cpbState.clearIntentOnClose = false;
      }
      if (cpbState.lastTrigger && typeof cpbState.lastTrigger.focus === "function" && document.contains(cpbState.lastTrigger)) {
        cpbState.lastTrigger.focus();
      }
      cpbState.lastTrigger = null;
    });
    document.getElementById("companionRailProjects")?.addEventListener("click", event => cpbOpenPopover(event.currentTarget));
    document.getElementById("moreSaveToProjectBtn")?.addEventListener("click", () => {
      document.getElementById("canvasMoreMenu")?.setAttribute("hidden", "");
      document.getElementById("canvasMoreBtn")?.setAttribute("aria-expanded", "false");
      cpbOpenModal({ mode: cpbGuest() ? "guest" : (cpbState.ownProjects.length ? "save-existing" : "create") });
    });
    window.addEventListener("penecho:languagechange", cpbRenderAll);
    window.addEventListener("penecho:companion-view", cpbRenderAll);
    cpbRenderAll();
    setTimeout(() => { void cpbLoadState(); }, 0);
  }
