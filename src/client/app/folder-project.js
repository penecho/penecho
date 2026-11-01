  // A folder's project keeps the Canvases open on every page of that folder.
  // Saving a Canvas into the project opens it as a tab on the other pages,
  // closing a tab closes it there too, and + reopens a closed one. Pages share
  // saved copies only; edits reach the other pages when they are saved, which
  // happens by itself a few seconds after each change.
  const FOLDER_AUTOSAVE_MS = 3000;
  const folderProject = { view:null, queue:Promise.resolve(), pending:null, opening:new Set(), started:false, retry:0,
    autosaveTimer:0, savedKey:"", background:new Set(), failures:0, keeping:false, expiresAt:window.PENECHO_CONFIG?.folderProject?.expiresAt || null };
  const FOLDER_GUEST_DAYS_MS = 7 * 86400000;
  // A guest's project keeps its Canvases with the page until 7 days after its
  // last change; signing in keeps them in that account. A signed-out app's
  // project keeps them in that computer's Library.
  function folderProjectGuest() { return Boolean(window.PENECHO_CONFIG?.folderProject?.guest); }
  function folderProjectWithPage() { return folderProjectGuest() || Boolean(window.PENECHO_CONFIG?.folderProject?.localProjectId); }
  function folderProjectTarget() { const project = window.PENECHO_CONFIG?.folderProject; return project?.cloudProjectId || project?.guestProjectId || project?.localProjectId || null; }
  function folderProjectEnabled() {
    return Boolean(window.PENECHO_CONFIG?.browserDraftId && folderProjectTarget());
  }
  function folderProjectExpiry(expiresAt) {
    if (!folderProjectGuest() || expiresAt === undefined) return;
    folderProject.expiresAt = expiresAt;
    if (typeof liveCanvasRenderExpiry === "function") liveCanvasRenderExpiry();
  }
  const folderProjectLocator = canvasId => ({ location:"cloud", id:canvasId });
  function folderProjectDoc(canvasId) {
    return [...canvasDocuments.records.values()].find(doc => doc.locator?.location === "cloud" && doc.locator.id === canvasId) || null;
  }
  function folderProjectRun(work) {
    const run = folderProject.queue.then(work, work);
    folderProject.queue = run.catch(() => {});
    return run;
  }
  function folderProjectRevision(doc) {
    return canvasDocumentsIsActive(doc) ? state.currentSnapshotRevisionId : doc.stored?.item?.currentRevisionId || null;
  }
  // A Canvas kept in Cloud on sign-in stays open here, under its Cloud id.
  function folderProjectRelocate(doc, { from, to, revisionId }) {
    const projectId = folderProjectTarget(), item = stored => stored?.item && { ...stored, item:{ ...stored.item, id:to, projectId, currentRevisionId:revisionId } };
    doc.locator = { location:"cloud", id:to };
    doc.locators = [...(doc.locators || []).filter(locator => locator.location !== "cloud" || locator.id !== from), doc.locator].slice(-16);
    if (doc.stored?.item) doc.stored = item(doc.stored);
    if (doc.base) doc.base = { revisionId, stored:item(doc.base.stored) || doc.base.stored };
    if (canvasDocumentsIsActive(doc)) Object.assign(state, { currentSnapshotId:to, currentSnapshotLocation:"cloud", currentSnapshotRevisionId:revisionId, currentSnapshotProjectId:projectId });
    return canvasDocumentsPersist(doc);
  }
  async function folderProjectApply(view) {
    if (!Array.isArray(view?.tabs) || folderProject.view && view.revision < folderProject.view.revision) return;
    folderProject.view = view;
    folderProjectExpiry(view.expiresAt);
    // A page whose folder joined another project on this computer saves there from now on.
    const config = window.PENECHO_CONFIG?.folderProject;
    if (config?.cloudProjectId && typeof view.cloudProjectId === "string" && view.cloudProjectId && view.cloudProjectId !== config.cloudProjectId) config.cloudProjectId = view.cloudProjectId;
    for (const move of view.moved || []) {
      const doc = folderProjectDoc(move.from);
      if (doc) await folderProjectRelocate(doc, move);
    }
    for (const tab of view.tabs) {
      const doc = folderProjectDoc(tab.canvasId);
      try {
        if (!doc) await canvasDocumentsOpenSaved(folderProjectLocator(tab.canvasId));
        // Another page saved this tab since this page read it: the tab in front
        // merges that save in, keeping its own changes; others take it.
        else if (tab.revisionId && folderProjectRevision(doc) && tab.revisionId !== folderProjectRevision(doc)) {
          if (canvasDocumentsIsActive(doc)) await folderProjectMergeActive(doc);
          else await canvasDocumentsRefreshSaved(doc.id);
        }
      } catch (error) { if (error.code === "DOCUMENT_LIMIT") break; }
    }
    for (const tab of view.closed) {
      const doc = !folderProject.opening.has(tab.canvasId) && folderProjectDoc(tab.canvasId);
      if (doc) await canvasDocumentsForget(doc.id).catch(() => false);
    }
    // A page that starts on a blank Canvas shows the project's first tab instead.
    const active = canvasDocumentsCurrent(), first = view.tabs[0];
    if (!folderProject.started && first && !active.locator && !canvasDocumentsDraftHasContent() && !canvasDocumentsDraftBusy()
      && ![...mcpRuntime.sessions.values()].some(session => session.documentId === active.id && !session.closed)) {
      const doc = await canvasDocumentsOpenSaved(folderProjectLocator(first.canvasId), { show:true }).catch(() => null);
      if (doc && canvasDocumentsIsActive(doc)) await canvasDocumentsForget(active.id).catch(() => false);
    }
    folderProject.started = true;
    window.PenEchoCompanionCanvases?.changed?.();
  }
  function folderProjectSync() {
    if (!folderProjectEnabled() || document.hidden) return Promise.resolve();
    // Focus and visibility often arrive together; one queued sync serves both.
    return folderProject.pending ||= folderProjectRun(async () => {
      folderProject.pending = null;
      await window.PenEchoBrowserDraft?.open();
      // What the page opened with is saved already; only later changes autosave.
      if (!folderProject.started && !folderProject.savedKey && !canvasHasUnsavedChanges()) folderProject.savedKey = canvasDocumentsDraftKey();
      await folderProjectApply(await companionCanvasesRequest("project"));
      // Opened signed in with Canvases still on this computer: keep them in Cloud.
      if (window.PENECHO_CONFIG?.folderProject?.keep && !folderProject.keepStarted) { folderProject.keepStarted = true; void folderProjectKeep(); }
    });
  }
  // A failed sync, such as a slow first load, retries soon and backs off to the
  // minute-long cadence.
  function folderProjectRefresh(delay = 2000) {
    clearTimeout(folderProject.retry);
    void folderProjectSync().catch(() => { folderProject.retry = setTimeout(() => folderProjectRefresh(Math.min(delay * 2, 60000)), delay); });
  }
  async function folderProjectChange(change) {
    const canvasId = change.open || change.close;
    if (change.open) folderProject.opening.add(canvasId);
    try {
      const view = await companionCanvasesRequest("project/tabs", change);
      await folderProjectRun(() => folderProjectApply(view));
      return view;
    } finally { folderProject.opening.delete(canvasId); }
  }
  async function folderProjectReopen(canvasId) {
    await folderProjectChange({ open:canvasId });
    const doc = folderProjectDoc(canvasId) || await folderProjectRun(() => canvasDocumentsOpenSaved(folderProjectLocator(canvasId)));
    if (companionCanvasesEnabled()) await companionCanvasesChoose(doc.id);
    else await canvasDocumentsShow(doc.id);
  }
  // ---------- Autosave ----------
  // A few seconds after a person or an agent changes a Canvas, it saves itself
  // into the folder's project, replacing its previous save (no versions). A
  // newer save from another page is merged in first, so both pages' edits are
  // kept. Undo stays until the page closes.
  function folderProjectChanged(documentId = null) {
    if (!folderProjectEnabled()) return;
    if (documentId) folderProject.background.add(documentId);
    clearTimeout(folderProject.autosaveTimer);
    folderProject.autosaveTimer = setTimeout(folderProjectAutosaveNow, FOLDER_AUTOSAVE_MS);
  }
  // A renamed Canvas saves its new name a few seconds later, like any change.
  function folderProjectRenamed(doc) {
    if (!folderProjectEnabled() || doc.locator?.location !== "cloud") return false;
    if (canvasDocumentsIsActive(doc)) folderProject.savedKey = "";
    else doc.revision = (doc.revision || 0) + 1;
    folderProjectChanged(canvasDocumentsIsActive(doc) ? null : doc.id);
    return true;
  }
  function folderProjectAutosaveNow() {
    clearTimeout(folderProject.autosaveTimer);
    return folderProjectRun(folderProjectAutosave).then(() => { folderProject.failures = 0; }, error => {
      // A Canvas in use is tried again shortly; offline or a passing failure, waiting longer each time.
      if (["CANVAS_BUSY", "CANVAS_CHANGED"].includes(error?.code)) { folderProjectChanged(); return; }
      folderProject.failures++;
      clearTimeout(folderProject.autosaveTimer);
      folderProject.autosaveTimer = setTimeout(folderProjectAutosaveNow, Math.min(60000, FOLDER_AUTOSAVE_MS * 2 ** folderProject.failures));
      if (folderProject.failures === 2) setStatus(String(error?.message || error));
    });
  }
  // False while the Canvas is busy and its save waits.
  async function folderProjectAutosave() {
    if (!folderProjectEnabled() || window.PENECHO_CONFIG?.runtime === "viewer") return true;
    const done = await folderProjectSaveActive();
    for (const id of [...folderProject.background]) await folderProjectSaveBackground(id);
    return done;
  }
  function folderProjectBusy() {
    return snapshotSaveInProgress || snapshotLoadInProgress || canvasDocuments.switching || canvasDocumentsDraftBusy() || selectionAIBusy();
  }
  // Every save carries a name. An unnamed Canvas takes the title of its first
  // titled content, such as an agent's drawing; otherwise the project's next
  // "Canvas N".
  function folderProjectNamed(value) {
    const name = String(value || "").replace(/\s+/g, " ").trim().slice(0, 48).trim();
    return /^(untitled canvas|未命名画布|mcp canvas)$/i.test(name) ? "" : name;
  }
  function folderProjectContentName(item) {
    for (const widget of item?.widgets || []) if (folderProjectNamed(widget.title)) return folderProjectNamed(widget.title);
    for (const image of item?.images || []) if (folderProjectNamed(image.sourceName)) return folderProjectNamed(String(image.sourceName).replace(/\.(png|jpe?g|webp|gif|svg)$/i, ""));
    for (const box of item?.textBoxes || []) {
      const line = String(box.text || "").split("\n").find(part => folderProjectNamed(part));
      if (line) return folderProjectNamed(line);
    }
    return "";
  }
  function folderProjectNumberedName() {
    const taken = new Set([...folderProject.view?.tabs || [], ...folderProject.view?.closed || [], ...canvasDocuments.records.values()].map(entry => entry.title));
    for (let number = 1; ; number++) {
      const name = canvasDocumentsCopy(`Canvas ${number}`, `画布 ${number}`);
      if (!taken.has(name)) return name;
    }
  }
  function folderProjectName(doc, item) {
    const current = folderProjectNamed(canvasDocumentsIsActive(doc) ? currentCanvasDisplayName() : doc.title);
    if (current) return current;
    const name = folderProjectContentName(item) || folderProjectNumberedName();
    if (canvasDocumentsIsActive(doc)) {
      state.currentCanvasSuggestedName = name;
      window.PenEchoStudioNavigator?.updateDocument?.();
    }
    doc.title = name;
    if (doc.stored?.item) doc.stored.item.name = name;
    canvasDocumentsRender();
    return name;
  }
  async function folderProjectSaveActive() {
    for (let attempt = 0; attempt < 4; attempt++) {
      const doc = canvasDocumentsCurrent(), saved = state.currentSnapshotLocation === "cloud" && Boolean(state.currentSnapshotId);
      if (!canvasHasUnsavedChanges() && (!saved || folderProject.savedKey === canvasDocumentsDraftKey())) return true;
      // A new blank Canvas waits for its first content.
      if (!saved && !canvasHasShareableContent()) return true;
      if (folderProjectBusy()) { folderProjectChanged(); return false; }
      // A saved Canvas whose revision this page lost takes in the current save first.
      if (saved && !state.currentSnapshotRevisionId) { await folderProjectMergeActive(doc); continue; }
      const revision = state.userRevision;
      let conflict = false;
      setHistorySaveBusy(true);
      try {
        const id = await saveSnapshot({ location:"cloud", overwriteId:saved ? state.currentSnapshotId : null, name:folderProjectName(doc, state), allowEmpty:saved },
          { quiet:true, baseRevisionId:saved ? state.currentSnapshotRevisionId : undefined, replace:true });
        if (id && state.userRevision === revision && canvasDocumentsIsActive(doc)) folderProject.savedKey = canvasDocumentsDraftKey();
        if (id) folderProjectExpiry(Date.now() + FOLDER_GUEST_DAYS_MS);
        return true;
      } catch (error) {
        // A Canvas cleared from the page's project (7 idle days for a guest, or
        // deleted from the Library) is saved again from this page.
        if (error.status === 404 && folderProjectWithPage() && saved) { Object.assign(state, { currentSnapshotId:null, currentSnapshotLocation:null, currentSnapshotRevisionId:null }); doc.locator = null; continue; }
        if (error.code !== "revision_conflict") throw error;
        conflict = true;
      } finally { setHistorySaveBusy(false); }
      if (conflict) await folderProjectMergeActive(doc);
    }
    throw Error("Other pages keep saving this Canvas. Your changes are kept here; it saves again shortly.");
  }
  // The tab in front takes a newer save of itself, laid under its own changes.
  async function folderProjectMergeActive(doc) {
    if (!doc.locator || !canvasDocumentsIsActive(doc)) return;
    // Never on the user's behalf: an open AI preview, edit or selection waits.
    if (folderProjectBusy()) throw Object.assign(Error("The Canvas is busy; its newer save is merged in shortly."), { code:"CANVAS_BUSY" });
    const key = canvasDocumentsDraftKey(), remote = await readSnapshot(doc.locator.location, doc.locator.id);
    if (!remote) throw Error("This Canvas is no longer in Cloud.");
    // With nothing unsaved here, the newer save is taken as it is: a merge would
    // only find differences in how this page re-serialized what it loaded.
    let merged = { changed:false }, stored = remote;
    if (canvasHasUnsavedChanges() || folderProject.savedKey !== key) {
      const base = doc.base?.stored ? { item:doc.base.stored.item, tiles:canvasMergeTileMap(doc.base.stored.tileEntries) } : null;
      const local = { item:canvasDocumentsActiveSnapshot(), tiles:new Map([...tiles].map(([k, canvas]) => [k, { canvas }])) };
      merged = await canvasMergeSaves({ base, local, remote:{ item:remote.item, tiles:canvasMergeTileMap(remote.tileEntries) }, pixels:canvasMergePixels });
      stored = await canvasMergeStored(merged);
    }
    // Anything drawn while merging would be lost; merge again from it.
    if (key !== canvasDocumentsDraftKey() || !canvasDocumentsIsActive(doc)) throw Object.assign(Error("The Canvas changed while merging."), { code:"CANVAS_CHANGED" });
    await canvasDocumentsShow(doc.id, null, { markSeen:false, replace:stored, clean:!merged.changed });
    doc.base = { revisionId:remote.item.currentRevisionId || null, stored:canvasDocumentsCopyStored(remote) };
    folderProject.savedKey = merged.changed ? "" : canvasDocumentsDraftKey();
    if (merged.changed) folderProjectChanged();
  }
  // An agent changed a tab that is not in front: save its stored copy.
  async function folderProjectSaveBackground(id) {
    folderProject.background.delete(id);
    for (let attempt = 0; attempt < 4; attempt++) {
      const doc = canvasDocuments.records.get(id);
      if (!doc?.stored?.item || canvasDocumentsIsActive(doc) || doc.revision === doc.savedRevision) return;
      const revision = doc.revision, overwriteId = doc.locator?.location === "cloud" ? doc.locator.id : null, snapshot = canvasDocumentsCopyStored(doc.stored);
      if (!overwriteId && !folderProjectStoredContent(snapshot)) return;
      const projectId = snapshot.item.projectId || folderProjectTarget(), now = Date.now();
      const item = { ...snapshot.item, id:overwriteId || `${now}-${crypto.randomUUID()}`, name:folderProjectName(doc, snapshot.item), createdAt:snapshot.item.createdAt || now, updatedAt:now, projectId,
        // The thumbnail of a tab saved in the background stays until it is saved in front.
        preview:snapshot.item.preview || doc.base?.stored?.item?.preview || await folderProjectBlankPreview(),
        bundleExtensions:{ ...snapshot.item.bundleExtensions, [CANVAS_DOCUMENT_EXTENSION]:canvasDocumentsMetadata(doc), [CANVAS_WORKSPACE_EXTENSION]:canvasDocumentsWorkspaceData(doc) } };
      const base = overwriteId ? snapshot.item.currentRevisionId || doc.base?.revisionId : null;
      try {
        // A saved tab whose revision is unknown takes in the current save first.
        if (overwriteId && !base) throw Object.assign(Error("This Canvas's revision is unknown."), { code:"revision_conflict" });
        const saved = await saveCloudSnapshot(item, snapshot.tileEntries, overwriteId, overwriteId ? { baseRevisionId:base, replace:true } : {});
        const current = canvasDocuments.records.get(id);
        if (current !== doc) return;
        doc.locator = { location:"cloud", id:saved.id };
        doc.locators = [...(doc.locators || []).filter(locator => locator.location !== "cloud" || locator.id !== saved.id), doc.locator].slice(-16);
        doc.stored.item = { ...doc.stored.item, id:saved.id, projectId, currentRevisionId:saved.revisionId, updatedAt:now, preview:item.preview };
        doc.base = { revisionId:saved.revisionId, stored:{ item:{ ...snapshot.item, id:saved.id, projectId, currentRevisionId:saved.revisionId, preview:item.preview }, tileEntries:snapshot.tileEntries } };
        doc.savedRevision = revision; doc.savedAt = now;
        await canvasDocumentsPersist(doc);
        canvasDocumentsRender();
        if (!overwriteId) window.dispatchEvent(new CustomEvent("penecho:canvas-saved", { detail:{ location:"cloud", id:saved.id, projectId } }));
        if (doc.revision !== revision) folderProjectChanged(id);
        folderProjectExpiry(Date.now() + FOLDER_GUEST_DAYS_MS);
        return;
      } catch (error) {
        if (error.status === 404 && folderProjectWithPage() && overwriteId) { doc.locator = null; continue; }
        if (error.code !== "revision_conflict") throw error;
      }
      const remote = await readSnapshot("cloud", overwriteId);
      if (!remote) return;
      const merged = await canvasMergeSaves({ base:doc.base?.stored ? { item:doc.base.stored.item, tiles:canvasMergeTileMap(doc.base.stored.tileEntries) } : null,
        local:{ item:snapshot.item, tiles:canvasMergeTileMap(snapshot.tileEntries) }, remote:{ item:remote.item, tiles:canvasMergeTileMap(remote.tileEntries) }, pixels:canvasMergePixels });
      const stored = await canvasMergeStored(merged);
      if (canvasDocuments.records.get(id) !== doc || doc.revision !== revision || canvasDocumentsIsActive(doc)) { folderProjectChanged(id); return; }
      doc.stored = stored; doc.base = { revisionId:remote.item.currentRevisionId || null, stored:canvasDocumentsCopyStored(remote) };
      doc.revision++;
    }
  }
  function folderProjectStoredContent(stored) {
    return Boolean(stored.tileEntries.length || ["widgets", "images", "textBoxes"].some(kind => stored.item[kind]?.length));
  }
  async function folderProjectBlankPreview() {
    const canvas = offscreen(640, 426), context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, 640, 426);
    return canvasBlob(canvas, "image/png");
  }
  // Save now saves even an unchanged Canvas, merging a newer save first.
  async function folderProjectSaveNow() {
    folderProject.savedKey = "";
    clearTimeout(folderProject.autosaveTimer);
    showHistoryNoticeKey("snapshotSaving", "busy", 0);
    try {
      const done = await folderProjectRun(folderProjectAutosave), blank = !state.currentSnapshotId && !canvasHasShareableContent();
      if (done) showHistoryNoticeKey(blank ? "emptyCanvas" : "snapshotSaved", blank ? "info" : "success");
    } catch (error) {
      showHistoryNotice(`${t("snapshotError")}${error.message}`, "error", { duration:5000 });
      folderProjectChanged();
    }
  }
  // Signed in from a guest's folder page, or in a local app whose folder page
  // keeps its Canvases in that computer's Library: they move into this
  // account's project for the folder, and the page reopens saving there.
  async function folderProjectKeep() {
    if (!folderProjectWithPage() || folderProject.keeping) return false;
    folderProject.keeping = true;
    try {
      await window.PenEchoBrowserDraft?.flush?.();
      // Nothing saves here while the Canvases move; their latest saves go with them.
      const kept = await folderProjectRun(async () => { await folderProjectAutosave(); return companionCanvasesRequest("project/keep", {}, 120000); });
      setStatus(companionCanvasesCopy(`Kept ${kept.kept} Canvas${kept.kept === 1 ? "" : "es"} in your Cloud library.`, `已将 ${kept.kept} 个画布保存到你的云端资料库。`));
      location.reload();
      return true;
    } catch (error) {
      setStatus(String(error?.message || error));
      return false;
    } finally { folderProject.keeping = false; }
  }
  if (window.PENECHO_CONFIG?.browserDraftId) window.PenEchoFolderProject = {
    enabled:folderProjectEnabled,
    guest:folderProjectGuest,
    tabOrder:() => (folderProject.view?.tabs || []).map(tab => tab.canvasId),
    expiresAt:() => folderProjectGuest() ? folderProject.expiresAt : null,
    keep:folderProjectKeep,
    changed:folderProjectChanged,
    renamed:folderProjectRenamed,
    flush:() => folderProjectEnabled() ? folderProjectAutosaveNow() : Promise.resolve(),
    saveNow:folderProjectSaveNow,
    closed:() => folderProjectEnabled() && folderProject.view?.closed || [],
    reopen:folderProjectReopen,
    sync:folderProjectSync,
  };
  if (folderProjectEnabled()) {
    // Saving into the project opens the Canvas on the folder's other pages.
    window.addEventListener("penecho:canvas-saved", event => {
      const { location, id, projectId } = event.detail || {};
      if (location !== "cloud" || projectId !== folderProjectTarget()) return;
      if (!folderProject.view?.tabs.some(tab => tab.canvasId === id)) void folderProjectChange({ open:id }).catch(() => {});
    });
    window.addEventListener("penecho:canvas-documents-closed", event => {
      for (const locator of event.detail?.locators || []) {
        if (locator.location === "cloud" && folderProject.view?.tabs.some(tab => tab.canvasId === locator.id)) void folderProjectChange({ close:locator.id }).catch(() => {});
      }
    });
    // Signing in this app keeps a signed-out folder's Canvases in that account.
    if (window.PENECHO_CONFIG?.folderProject?.localProjectId) window.addEventListener("penecho:cloud-account-changed", () => {
      if (window.PenEchoCloudSettings?.cacheIdentity?.()) void folderProjectKeep();
    });
    // A Canvas shown or saved here is the starting point for the next autosave.
    window.addEventListener("penecho:live-share-context-changed", () => { if (!canvasHasUnsavedChanges()) folderProject.savedKey = canvasDocumentsDraftKey(); });
    // Leaving the page saves what is pending, as far as the browser allows.
    document.addEventListener("visibilitychange", () => { if (document.hidden && folderProject.autosaveTimer) void folderProjectAutosaveNow(); });
    window.addEventListener("focus", () => folderProjectRefresh());
    document.addEventListener("visibilitychange", () => folderProjectRefresh());
    setInterval(() => folderProjectRefresh(), 60000);
    // The first sync waits for the page to finish starting.
    setTimeout(() => folderProjectRefresh(), 0);
  }
