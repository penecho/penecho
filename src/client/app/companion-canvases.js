  // Companion navigation selects a target for the next MCP attachment. It never
  // retargets an existing session or treats a background document show as consent.
  const companionCanvases = { status:null, busy:false, error:"", refresh:null, signature:"", timer:0 };
  function companionCanvasesEnabled() {
    return CANVAS_COMPANION_REQUESTED && Boolean(window.PENECHO_CONFIG?.browserDraftId);
  }
  function companionCanvasesCopy(en, zh) { return state.language === "zh" ? zh : en; }
  async function companionCanvasesRequest(path, body) {
    const response = await fetch(`/api/v1/mcp/workspaces/${encodeURIComponent(window.PENECHO_CONFIG.browserDraftId)}/${path}`, {
      method:body ? "POST" : "GET", credentials:"same-origin", cache:"no-store",
      headers:body ? { "Content-Type":"application/json" } : {},
      ...(body ? { body:JSON.stringify(body) } : {}), signal:AbortSignal.timeout(12000),
    });
    const result = await response.json();
    if (!response.ok) throw Object.assign(Error(result.message || companionCanvasesCopy("Could not connect to this Canvas. Try again.", "暂时无法连接此画布，请重试。")), { code:result.error });
    return result;
  }
  async function companionCanvasesRefresh() {
    if (!companionCanvasesEnabled()) return;
    if (companionCanvases.refresh) return companionCanvases.refresh;
    companionCanvases.refresh = companionCanvasesRequest("documents").then(status => {
      companionCanvases.status = status;
      return status;
    }).finally(() => { companionCanvases.refresh = null; renderCompanionCanvases(); });
    return companionCanvases.refresh;
  }
  function companionCanvasesChanged() {
    if (!companionCanvasesEnabled()) return;
    renderCompanionCanvases();
    const signature = JSON.stringify([Boolean(mcpRuntime.ready), canvasDocumentsCatalog().map(doc => [doc.documentId, doc.title])]);
    if (signature === companionCanvases.signature) return;
    companionCanvases.signature = signature;
    clearTimeout(companionCanvases.timer);
    if (mcpRuntime.ready && !companionCanvases.busy) companionCanvases.timer = setTimeout(() => {
      void companionCanvasesRefresh().catch(error => { companionCanvases.error = error.message; renderCompanionCanvases(); });
    }, 150);
  }
  async function companionCanvasesSelect(documentId) {
    // Wait only for the just-published catalog; never substitute another doc.
    let status;
    mcpPublishCanvasCatalog(true);
    for (let attempt = 0; attempt < 5; attempt++) {
      status = await companionCanvasesRefresh();
      if (status?.canvases.some(doc => doc.documentId === documentId)) break;
      if (attempt === 4) throw Error(companionCanvasesCopy("This Canvas is kept here, but MCP is still reconnecting. Select it again once connected.", "画布已保留，但 MCP 仍在连接。连接后请再次选择。"));
      await new Promise(resolve => setTimeout(resolve, 200 * (attempt + 1)));
    }
    companionCanvases.status = await companionCanvasesRequest("selection", {
      documentId, expectedRevision:status.selectionRevision, requestId:crypto.randomUUID(),
    });
  }
  async function companionCanvasesChoose(documentId, { create = false } = {}) {
    if (!companionCanvasesEnabled() || companionCanvases.busy) return;
    companionCanvases.busy = true; companionCanvases.error = ""; renderCompanionCanvases();
    try {
      // Establish the original binding before creating the next document.
      const status = await companionCanvasesRefresh();
      if (!status?.canvases.length) throw Error(companionCanvasesCopy("Wait for MCP to connect, then try again.", "请等待 MCP 连接完成后重试。"));
      if (create) {
        const previous = canvasDocuments.activeId;
        await openNewCanvasDialog();
        documentId = canvasDocuments.activeId;
        if (!documentId || documentId === previous) return;
        const title = companionCanvasesCopy(`Canvas ${canvasDocuments.records.size}`, `画布 ${canvasDocuments.records.size}`);
        applyCurrentCanvasGeneratedName(title);
        canvasDocumentsRender();
      } else await canvasDocumentsShow(documentId);
      await window.PenEchoBrowserDraft.flush();
      await companionCanvasesSelect(documentId);
      document.getElementById("companionCanvasMenu")?.hidePopover();
      selectCanvasToolMode("hand");
      setStatus(companionCanvasesCopy("MCP target switched. Existing sessions stay on their original canvases.", "已切换 MCP 目标，已有会话仍保留在各自的画布。"));
    } catch (error) {
      companionCanvases.error = String(error.message || error);
      // The new document is retained even if its connection update fails.
      document.getElementById("companionCanvasMenu")?.showPopover();
    } finally { companionCanvases.busy = false; renderCompanionCanvases(); }
  }
  function renderCompanionCanvases() {
    if (!companionCanvasesEnabled()) return;
    const menu = document.getElementById("companionCanvasMenu"), list = document.getElementById("companionCanvasList"),
      target = document.getElementById("companionCanvasTarget"), current = canvasDocuments.activeId,
      selected = companionCanvases.status?.selectedDocumentId,
      docs = canvasDocumentsCatalog(), selectedDoc = docs.find(doc => doc.documentId === selected),
      disabled = companionCanvases.busy || canvasDocuments.switching;
    if (!menu || !list || !target) return;
    document.getElementById("companionCanvasNew").disabled = disabled;
    document.getElementById("companionCanvasNew").title = companionCanvasesCopy("New Canvas and MCP target", "新建画布并设为 MCP 目标");
    document.getElementById("companionCanvasNew").setAttribute("aria-label", companionCanvasesCopy("New canvas", "新建画布"));
    document.getElementById("companionCanvasSwitch").setAttribute("aria-label", companionCanvasesCopy(`Switch canvas (${docs.length})`, `切换画布（${docs.length}）`));
    target.hidden = !canvasCompanionMinimal();
    target.textContent = !mcpRuntime.ready ? companionCanvasesCopy("MCP · Reconnecting", "MCP · 连接中")
      : selected === current ? companionCanvasesCopy("MCP · This canvas", "MCP · 当前画布")
      : `MCP → ${selectedDoc?.title || companionCanvasesCopy("Choose canvas", "选择画布")}`;
    target.title = selectedDoc ? `MCP → ${selectedDoc.title}` : target.textContent;
    target.dataset.matches = String(selected === current);
    document.getElementById("companionCanvasMenuTitle").textContent = companionCanvasesCopy("Canvases", "画布");
    document.getElementById("companionCanvasMenuHelp").textContent = companionCanvasesCopy("Choose a Canvas for your next MCP request. Existing sessions keep their own Canvas.", "选择下一步 MCP 使用的画布。已有会话保留在各自的画布。");
    const error = document.getElementById("companionCanvasError");
    error.textContent = companionCanvases.error; error.hidden = !companionCanvases.error;
    const signature = JSON.stringify([docs, current, selected, disabled, state.language]);
    if (list.dataset.signature === signature) return;
    list.dataset.signature = signature;
    list.replaceChildren(...docs.map(doc => {
      const button = document.createElement("button"), name = document.createElement("span"), detail = document.createElement("small");
      button.type = "button"; button.className = "companion-canvas-row"; button.dataset.documentId = doc.documentId;
      button.disabled = disabled;
      if (doc.documentId === current) button.setAttribute("aria-current", "page");
      name.textContent = doc.title; name.title = doc.title;
      detail.textContent = doc.documentId === selected ? companionCanvasesCopy("MCP target", "MCP 目标")
        : doc.active ? companionCanvasesCopy("Viewing", "正在查看") : "";
      button.append(name, detail);
      button.addEventListener("click", () => void companionCanvasesChoose(doc.documentId));
      return button;
    }));
  }
  if (companionCanvasesEnabled()) {
    window.PenEchoCompanionCanvases = { changed:companionCanvasesChanged, refresh:() => void companionCanvasesRefresh().catch(() => {}), create:() => companionCanvasesChoose(null, { create:true }) };
    document.getElementById("companionCanvasNew")?.addEventListener("click", () => void window.PenEchoCompanionCanvases.create());
    document.getElementById("companionCanvasMenu")?.addEventListener("toggle", event => {
      if (event.newState === "open") void companionCanvasesRefresh().catch(error => { companionCanvases.error = error.message; renderCompanionCanvases(); });
    });
    window.addEventListener("focus", () => { if (mcpRuntime.ready) void companionCanvasesRefresh().catch(() => {}); });
    window.addEventListener("penecho:languagechange", renderCompanionCanvases);
    window.addEventListener("penecho:companion-view", renderCompanionCanvases);
  }
