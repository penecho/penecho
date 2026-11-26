  // A Canvas opened from a project reads its picture from the project's folder and saves back there.
  // Drawing, history and the Agent are the same Canvas as always. This only opens, saves and comes back.
  const projectLinesInShell = window.projectLinesInShell === true || (new URLSearchParams(location.search).get("shell") === "1" && window.parent !== window);
  function projectLinesShellDormant() {
    return Boolean(projectLinesInShell && !projectLinesRun.ready);
  }
  function projectLinesShellTell(message) {
    if (projectLinesInShell && window.parent !== window) {
      window.parent.postMessage({ source:"penecho-canvas-shell", ...message }, location.origin);
    }
  }
  let projectLinesTarget = (() => {
    const q = new URLSearchParams(location.search), project = q.get("linesProject"), source = q.get("linesCanvas");
    // Started before any Canvas is asked for (project-lines-cover.js): it waits to be told which.
    if (window.projectLinesWaiting) return { project:"", source:"", doc:"", title:"", summary:"", back:"", seed:"", draft:true, originLine:"", originLabel:"", first:false, warm:true };
    return project && source ? { project, source, doc:q.get("linesDoc") || "", title:q.get("linesTitle") || "", summary:q.get("linesSummary") || "", back:q.get("linesBack") || "", seed:q.get("linesSeed") || "", draft:q.get("linesDraft") === "1",
      originLine:q.get("linesOriginLine") || "", originLabel:q.get("linesOriginLabel") || "",
      // first: PenEcho's first open. This new Canvas in My Canvases opens under the first page, until "Draw on a Canvas" or a stroke.
      first:q.get("linesFirst") === "1" } : null;
  })();
  function projectLinesDestination() {
    return projectLinesAddress(`/projects.html${projectLinesTarget?.back ? `#${projectLinesTarget.back}` : projectLinesTarget ? `#${encodeURIComponent(projectLinesTarget.project)}` : ""}`);
  }
  // A save waits until the pen has been still this long, and the picture of the whole Canvas a little longer.
  // Drawing again stops a save that has started; the next quiet moment takes it.
  const PROJECT_LINES_IDLE_MS = 2500, PROJECT_LINES_PICTURE_IDLE_MS = 6000, PROJECT_LINES_CHECK_MS = 500;
  // The folder's picture of the Canvas is kept to this many pixels (2560 × 1600), more than any agent reads; the server keeps every
  // picture to the same (project-lines/picture-size.js). Download PNG on the Canvas still renders in full.
  const PROJECT_LINES_PICTURE_PIXELS = 2560 * 1600, PROJECT_LINES_IMAGE_PADDING = 32, PROJECT_LINES_HEAVY_PICTURE = 3 * 1024 * 1024;
  const PROJECT_LINES_GAVE_WAY = Symbol("gave way");
  const projectLinesHost = window.PenEchoHostedProjectCanvas;
  const projectLinesFetch = (path, init) => projectLinesHost ? projectLinesHost.fetch(path, init) : fetch(path, init);
  const projectLinesAddress = path => projectLinesHost ? projectLinesHost.address(path) : path;
  const projectLinesLocal = () => Boolean(projectLinesHost) || !["viewer", "cloud"].includes(window.PENECHO_CONFIG?.runtime) && !window.PENECHO_CONFIG?.browserDraftId && !window.PENECHO_CONFIG?.guestCanvas;
  const projectLinesZh = () => state.language === "zh";
  // A Canvas opened after another in the same page gets its own: what the one before is still waiting for never lands here.
  const projectLinesNewRun = () => ({ documentId:"", savedKey:"", pictureKey:"", saving:null, createdAt:0, snapshotId:"", ready:false, failed:false, inputAt:0, pulling:false, noPull:false,
    // base: the version of the folder's file this page started from (null when the server does not say). elsewhere: another page saved since.
    // redraw: the picture in the folder is behind what this Canvas shows.
    base:null, elsewhere:false, redraw:false });
  let projectLinesRun = projectLinesNewRun();
  const projectLinesUnsavedKey = () => `penecho-lines-unsaved:${projectLinesRun.documentId}`;
  function projectLinesRemember(unsaved) {
    // What is kept is the version the unsaved work started from, so a page that comes back to it still knows.
    try { if (unsaved) localStorage.setItem(projectLinesUnsavedKey(), projectLinesRun.base === null ? "1" : `base:${projectLinesRun.base}`); else localStorage.removeItem(projectLinesUnsavedKey()); } catch { /* The picture itself is still saved. */ }
  }
  function projectLinesWasUnsaved() {
    try { return localStorage.getItem(projectLinesUnsavedKey()) !== null; } catch { return false; }
  }
  function projectLinesUnsavedBase() {
    try { const kept = localStorage.getItem(projectLinesUnsavedKey()); return kept && kept.startsWith("base:") ? kept.slice(5) : null; } catch { return null; }
  }
  async function projectLinesRequest(query = "", body = null, signal = null) {
    const url = `/api/lines/projects/${encodeURIComponent(projectLinesTarget.project)}/canvas${query}`;
    const opening = !body && window.projectLinesCanvasLoad?.url === url ? window.projectLinesCanvasLoad : null;
    if (opening) window.projectLinesCanvasLoad = null;
    const response = (opening && await opening.response) || await projectLinesFetch(url, { method:body ? "POST" : "GET", credentials:"same-origin", headers:{ accept:"application/json", ...(body ? { "content-type":"application/json" } : {}) }, ...(body ? { body:JSON.stringify(body) } : {}), ...(signal ? { signal } : {}) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(Error(result.message || result.error || (projectLinesZh() ? "无法连接这个项目。" : "PenEcho could not reach this project.")), { code:result.code || result.error || "", status:response.status });
    return result;
  }
  // A picture from a project, placed on a new Canvas to draw on. Nothing is written until something changes.
  async function projectLinesSeedFile(project, seed) {
    const response = await projectLinesFetch(`/api/lines/projects/${encodeURIComponent(project)}/file?path=${encodeURIComponent(seed)}`, { credentials:"same-origin" });
    if (!response.ok) throw Error(projectLinesZh() ? "无法打开这张图片。" : "PenEcho could not open this picture.");
    return response.blob();
  }
  async function projectLinesSeeded() {
    const { project, seed, picture } = projectLinesTarget;
    const original = picture?.blob || await projectLinesSeedFile(project, seed);
    // Only its size is wanted, and an image knows that without being decoded: showing it decodes it anyway. An SVG is refused, as before.
    const sized = /svg/i.test(original.type) ? await createImageBitmap(original) : await imageFromBlob(original), width = sized.naturalWidth || sized.width, height = sized.naturalHeight || sized.height;
    // Handed over before the folder has it, a heavy picture has not been made lighter there (picture-size.js), and every save would carry it.
    const fits = width <= MAX_IMAGE_DIMENSION && height <= MAX_IMAGE_DIMENSION && width * height <= MAX_IMAGE_PIXELS && original.size <= (picture ? PROJECT_LINES_HEAVY_PICTURE : MAX_IMAGE_SOURCE_BYTES);
    // The Canvas drops a picture over its limits without a word, so a big one is made to fit, as it is when added to a Canvas any other way.
    const { blob, naturalW, naturalH } = fits ? { blob:original, naturalW:width, naturalH:height } : await prepareImportedImage(original);
    sized.close?.();
    const x = 2000, y = 2000, w = Math.max(600, Math.min(1800, naturalW)), h = Math.round(w * naturalH / naturalW);
    return { item:{ widgets:[], textBoxes:[], animations:[], theme:state.theme, images:[{ id:"image-1", x, y, w, h, naturalW, naturalH, sourceName:(seed || picture?.name || "").split("/").pop(), blob }], view:{ region:{ x:x - 60, y:y - 60, w:w + 120, h:h + 120 }, navigationLocked:false } }, tileEntries:[] };
  }
  // The view belongs to this browser and Canvas, independently of its content saves.
  // An agent drawing or another tab saving must not reset where you were looking.
  const projectLinesView = { key:"", current:"", saved:"", timer:0 };
  function projectLinesRestoreView() {
    const kept = projectLinesView;
    kept.key = `penecho-lines-view:${projectLinesRun.documentId}`;
    try {
      const camera = JSON.parse(localStorage.getItem(kept.key) || "null");
      if (camera?.version === 1 && [camera.scale, camera.panX, camera.panY].every(Number.isFinite) && camera.scale > 0 && typeof camera.navigationLocked === "boolean") {
        canvasDocumentsApplyView(camera);
        state.viewInitialized = true;
        requestRender();
      }
    } catch { /* An unavailable or invalid local view leaves the file's view in place. */ }
    // Start from this visit's view. An unchanged older tab must not overwrite a newer tab's view when it closes.
    kept.current = kept.saved = projectLinesViewValue();
  }
  function projectLinesViewValue() {
    return JSON.stringify({ version:1, scale:state.scale, panX:state.panX, panY:state.panY, navigationLocked:state.navigationLocked === true });
  }
  function projectLinesRememberView(flush = false) {
    const kept = projectLinesView;
    if (!kept.key || !projectLinesRun.ready || !projectLinesInFront() || !projectLinesLocal()) return;
    const value = projectLinesViewValue();
    if (!flush && value === kept.current) return;
    kept.current = value;
    clearTimeout(kept.timer);
    kept.timer = 0;
    if (value === kept.saved) return;
    if (!flush) { kept.timer = setTimeout(() => projectLinesRememberView(true), 200); return; }
    try { localStorage.setItem(kept.key, value); kept.saved = value; } catch { /* Navigation still works without browser storage. */ }
  }
  // stop: another Canvas was asked for meanwhile (projectLinesTurn). This one then goes no further than it must, and shows nothing.
  async function projectLinesOpen(stop = null) {
    const { source, doc:docPath, title } = projectLinesTarget, wanted = () => stop?.throwIfAborted();
    // A new Canvas is not in the folder yet, and there is nothing to read.
    const info = projectLinesTarget.fresh ? { exists:false, source:null, base:"", context:"" } : await projectLinesRequest(`?${new URLSearchParams({ path:source, doc:docPath })}`, null, stop);
    wanted();
    // Load the recovery records, but do not decode and show the previous Canvas
    // only to replace it. The selected Canvas's unsaved copy is restored below.
    await canvasDocumentsStartDraft(false);
    await canvasDocumentsSettleDraft(5000, { finalize:true });
    wanted();
    projectLinesRun.documentId = `doc-${await canvasAgentHash(`lines:${projectLinesHost ? projectLinesHost.account + ":" : ""}${projectLinesTarget.project}:${source}`)}`;
    wanted();
    projectLinesRememberDoc(projectLinesRun.documentId);
    const existing = canvasDocuments.records.get(projectLinesRun.documentId);
    projectLinesRun.base = typeof info.base === "string" ? info.base : null;
    // A picture that never reached the folder stays as you left it. Otherwise the file in the folder is what opens.
    if (existing && projectLinesWasUnsaved()) {
      // It started from the version it remembers, not from the one in the folder now: if another page saved since, the first save says so.
      const started = projectLinesUnsavedBase();
      if (started !== null && projectLinesRun.base !== null) projectLinesRun.base = started;
      await canvasDocumentsShow(existing.id, null);
      projectLinesRun.savedKey = projectLinesRun.pictureKey = "";
    } else {
      if (existing && canvasDocumentsIsActive(existing)) await canvasDocumentsClose(existing.id);
      else if (existing) canvasDocuments.records.delete(existing.id);
      projectLinesRun.seeded = !info.exists && Boolean(projectLinesTarget.seed || projectLinesTarget.picture);
      const stored = info.exists ? await readSnapshotBundle(info.source) : projectLinesRun.seeded ? await projectLinesSeeded() : { item:{ widgets:[], textBoxes:[], images:[], animations:[], theme:state.theme }, tileEntries:[] };
      wanted();
      const record = canvasDocumentsRecord({ documentId:projectLinesRun.documentId, title:title || stored.item.name || (projectLinesZh() ? "项目画布" : "Project Canvas"), context:info.context || "" }, stored);
      await canvasDocumentsPersist(record);
      wanted();
      canvasDocuments.records.set(record.id, record);
      await canvasDocumentsShow(record.id, null);
      projectLinesRun.createdAt = stored.item.createdAt || 0;
      projectLinesRun.snapshotId = stored.item.id || "";
      projectLinesRun.savedKey = projectLinesRun.pictureKey = canvasDocumentsDraftKey();
      canvasDocumentsDraft.savedKey = projectLinesRun.savedKey;
      projectLinesRun.redraw = info.behind === true;
    }
    canvasDocumentsRender();
    // Opened to draw on, whatever it holds: the pen is in your hand.
    if (projectLinesTarget.draft) setCanvasMode("pen");
    projectLinesRestoreView();
    projectLinesRun.ready = true;
    // Opened again from here (Try again), it is read from the folder.
    projectLinesTarget.fresh = false; projectLinesTarget.picture = null;
    window.projectLinesViewChanged = (flush = false) => projectLinesRememberView(flush);
  }
  // The picture a new Canvas was opened to draw on, where it is on screen: the cover carries the picture you clicked onto it.
  function projectLinesLanding() {
    const image = projectLinesRun.seeded && projectLinesRun.ready && state.images[0];
    if (!image) return null;
    const box = view.getBoundingClientRect();
    return { left:box.left + state.panX + image.x * state.scale, top:box.top + state.panY + image.y * state.scale, width:image.w * state.scale, height:image.h * state.scale };
  }
  function projectLinesBlank() {
    return !tiles.size && !state.images.length && !state.textBoxes.length && !state.preservedSnapshotAnimations.length && !state.animations.length && !state.widgets.length;
  }
  function projectLinesCanSave() {
    return projectLinesRun.ready && !projectLinesRun.elsewhere && canvasDocuments.activeId === projectLinesRun.documentId && !canvasDocumentsDraftBusy() && !selectionAIBusy()
      && !(typeof canvasAgent !== "undefined" && (canvasAgent.running || canvasAgent.requestPending));
  }
  const projectLinesPng = exported => new Promise((resolve, reject) => { canvasBlob(exported).then(blob => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); }, reject); });
  function projectLinesRenderPicture() {
    const padding = state.images.length ? PROJECT_LINES_IMAGE_PADDING : undefined;
    return renderExportCanvas(null, null, PROJECT_LINES_PICTURE_PIXELS, padding);
  }
  // This Canvas as the folder keeps it: the bundle, and its picture when asked for. fresh: as a new Canvas of its own.
  async function projectLinesBundle({ picture = true, part = () => {}, fresh = false } = {}) {
    const key = canvasDocumentsDraftKey();
    part("widgets");
    await prepareVisibleWidgetSnapshots(null, true);
    part("tiles");
    // The draft copy of this Canvas has every tile encoded already. They are encoded again only when that copy is behind.
    await canvasDocumentsFlushDraft().catch(() => {});
    const kept = canvasDocumentsDraft.savedKey === key && key === canvasDocumentsDraftKey() ? canvasDocumentsCurrent()?.stored?.tileEntries : null;
    const tileEntries = kept?.length === tiles.size ? kept : await Promise.all([...tiles].map(async ([k, canvas]) => ({ k, blob:await canvasBlob(canvas) })));
    part("preview");
    const now = Date.now(), name = String(currentCanvasDisplayName() || projectLinesTarget.title || "").slice(0, 48);
    const animations = serializedAnimations(), widgets = serializedWidgets(), textBoxes = storedTextBoxes(), images = storedImages();
    if (!fresh) { projectLinesRun.snapshotId ||= `lines-${now}`; projectLinesRun.createdAt ||= now; }
    const item = { version:2, id:fresh ? `lines-${now}` : projectLinesRun.snapshotId, createdAt:fresh ? now : projectLinesRun.createdAt, updatedAt:now, name, projectId:SERVER_DEFAULT_PROJECT_ID, theme:state.theme,
      view:{ scale:state.scale, panX:state.panX, panY:state.panY, navigationLocked:state.navigationLocked },
      tileCount:tileEntries.length, animationCount:animations.length, animations, widgetCount:widgets.length, widgets, textBoxCount:textBoxes.length, textBoxes, imageCount:images.length, images,
      preview:await snapshotPreviewBlob(), bundleExtensions:snapshotCanvasObjectExtensions(), manifestExtensions:snapshotExtensionObject(state.currentSnapshotManifestExtensions), preservedAssets:snapshotPreservedAssets(state.currentSnapshotPreservedAssets) };
    part("bundle");
    const source = await serverSnapshotPayload(item, tileEntries);
    let png = null;
    if (picture) {
      part("picture");
      const exported = await projectLinesRenderPicture();
      part("picture-encode");
      png = exported ? await projectLinesPng(exported) : null;
    }
    return { key, name, source, png };
  }
  // Two pages had this Canvas open and the other one saved. This page's work is not written over it and is not thrown away:
  // it stays here until you open the saved one, or keep this one as a Canvas of its own.
  function projectLinesShowElsewhere() {
    if (document.getElementById("projectLinesElsewhere")) return;
    const zh = projectLinesZh(), bar = document.createElement("div");
    bar.id = "projectLinesElsewhere"; bar.className = "project-lines-elsewhere"; bar.setAttribute("role", "alert");
    const say = document.createElement("span"), keep = document.createElement("button"), open = document.createElement("button");
    say.textContent = zh ? "这张画布已在另一个页面保存过。" : "This Canvas was saved from another page.";
    keep.type = open.type = "button"; open.className = "primary";
    keep.textContent = zh ? "把我的另存为副本" : "Keep mine as a copy";
    open.textContent = zh ? "打开已保存的" : "Open the saved one";
    open.addEventListener("click", () => { projectLinesRemember(false); location.reload(); });
    keep.addEventListener("click", async () => {
      keep.disabled = open.disabled = true;
      try {
        const { name, source, png } = await projectLinesBundle({ fresh:true });
        const response = await projectLinesFetch(`/api/lines/projects/${encodeURIComponent(projectLinesTarget.project)}/canvases`, { method:"POST", credentials:"same-origin", headers:{ accept:"application/json", "content-type":"application/json" },
          body:JSON.stringify({ title:`${name || (zh ? "画布" : "Canvas")} ${zh ? "副本" : "copy"}`, source, png }) });
        const made = await response.json().catch(() => ({}));
        if (!response.ok || !made.source) throw Error(made.message || made.error || (zh ? "未能另存。" : "The copy could not be made."));
        projectLinesRemember(false);
        if (projectLinesInShell) {
          projectLinesRun.ready = false;
          await canvasDocumentsClose(projectLinesRun.documentId).catch(() => {});
          projectLinesShellTell({ open:{ project:projectLinesTarget.project, source:made.source, title:made.title || "", back:projectLinesTarget.back || "" } });
          return;
        }
        const address = new URL(location.href);
        address.searchParams.set("linesCanvas", made.source); address.searchParams.set("linesTitle", made.title || "");
        for (const gone of ["linesDoc", "linesDraft"]) address.searchParams.delete(gone);
        location.href = address;
      } catch (error) { keep.disabled = open.disabled = false; setStatus(error.message); }
    });
    bar.append(say, keep, open);
    (document.querySelector(".canvas-frame") || document.body).append(bar);
    setStatus(say.textContent);
  }
  // picture: also write the PNG of the whole Canvas. quiet: an autosave, which gives way as soon as you draw again.
  async function projectLinesSave({ picture = true, quiet = false } = {}) {
    const run = projectLinesRun, target = projectLinesTarget;
    if (run.saving) return run.saving;
    const started = performance.now();
    // Each part is marked, so scripts/measure-stroke-latency.cjs can say which part held the page up.
    const part = name => {
      performance.mark(`penecho-lines-save:${name}`);
      if (quiet && (run.inputAt > started || state.drawing)) throw PROJECT_LINES_GAVE_WAY;
    };
    run.saving = (async () => {
      projectLinesRemember(true);
      const { key, name, source, png } = await projectLinesBundle({ picture, part });
      part("send");
      // What was bundled is the Canvas in front. It is only ever written to that Canvas's own file.
      if (projectLinesRun !== run || projectLinesTarget !== target || !projectLinesInFront()) throw quiet ? PROJECT_LINES_GAVE_WAY : Error(projectLinesZh() ? "保存时打开了另一张画布，请重试。" : "Another Canvas was opened while this one was being saved. Try again.");
      const answer = await projectLinesRequest("", { path:target.source, doc:target.doc, title:target.title || name, summary:target.summary, source, png, ...(run.base === null ? {} : { base:run.base }) });
      if (typeof answer.base === "string") run.base = answer.base;
      performance.mark("penecho-lines-save:done");
      run.savedKey = key;
      if (picture) { run.pictureKey = key; run.redraw = false; }
      await projectLinesTake(answer);
      // What changed while this was sent starts from the version just saved.
      projectLinesRemember(key !== canvasDocumentsDraftKey());
      if (run.failed) { run.failed = false; setStatus(projectLinesZh() ? "已保存到项目文件夹。" : "Saved to the project folder."); }
    })().catch(error => {
      performance.mark("penecho-lines-save:done");
      if (error === PROJECT_LINES_GAVE_WAY) return;
      // Another page saved this Canvas since this one opened it. Nothing is written over it: both are kept and you choose.
      if (error.code === "canvas_changed") { run.elsewhere = true; projectLinesShowElsewhere(); throw error; }
      run.failed = true;
      setStatus(`${projectLinesZh() ? "未能保存到项目文件夹：" : "Could not save to the project folder: "}${error.message}`);
      throw error;
    }).finally(() => { run.saving = null; });
    return run.saving;
  }
  const projectLinesNothingYet = () => projectLinesBlank() && !projectLinesRun.snapshotId;
  // The project's Canvas is the one on screen. The Canvas page can hold others, and a save, its label and leaving are about this one only.
  const projectLinesInFront = () => canvasDocuments.activeId === projectLinesRun.documentId;
  // Is the folder behind what is on the Canvas: its file, or only its picture?
  function projectLinesBehind() {
    const key = canvasDocumentsDraftKey();
    return { file:projectLinesRun.savedKey !== key, picture:projectLinesRun.pictureKey !== key };
  }
  // Saves once the pen has been still for a moment and a stroke, edit or Agent turn has settled. An empty new Canvas writes nothing.
  function projectLinesAutosave() {
    if (!projectLinesCanSave() || projectLinesNothingYet()) return;
    const behind = projectLinesBehind(), still = performance.now() - projectLinesRun.inputAt;
    if (projectLinesRun.redraw && !(behind.file || behind.picture)) { void projectLinesRedraw(); return; }
    if (!(behind.file || behind.picture) || still < PROJECT_LINES_IDLE_MS) return;
    const picture = still >= PROJECT_LINES_PICTURE_IDLE_MS;
    if (behind.file || picture) projectLinesSave({ picture, quiet:true }).catch(() => {});
  }
  // The Canvas opened with its picture in the folder behind it, such as after an agent drew on it. Once you are still the picture is drawn again, and
  // only the picture is sent: opening a Canvas saves nothing on it. One that cannot be drawn now is left for the next time the Canvas opens.
  async function projectLinesRedraw() {
    const run = projectLinesRun, target = projectLinesTarget, started = performance.now(), key = canvasDocumentsDraftKey();
    run.inputAt ||= started;
    if (run.saving || document.hidden || started - run.inputAt < PROJECT_LINES_PICTURE_IDLE_MS) return;
    run.redraw = false;
    const drawnOn = () => projectLinesRun !== run || projectLinesTarget !== target || !projectLinesInFront() || Boolean(run.saving) || key !== canvasDocumentsDraftKey();
    try {
      const exported = await projectLinesRenderPicture();
      if (!exported || drawnOn()) return;
      // You are moving about: it waits until you are still again.
      if (run.inputAt > started || state.drawing) { run.redraw = true; return; }
      const png = await projectLinesPng(exported);
      if (drawnOn()) return;
      await projectLinesRequest("", { path:target.source, redraw:true, png, base:run.base, sources:projectLinesSources() });
    } catch { /* The next time it opens, then. */ }
  }
  // Going to another window, often to the agent that will read the picture: the folder is brought up to date now.
  function projectLinesSaveOnHide() {
    if (!document.hidden) return;
    projectLinesRememberView(true);
    if (!projectLinesCanSave() || projectLinesNothingYet()) return;
    const behind = projectLinesBehind();
    if (behind.file || behind.picture) projectLinesSave().catch(() => {});
  }
  let projectLinesSaveLabelBound = false, projectLinesInputWatched = false, projectLinesIntervalsWired = false, projectLinesLinksBound = false;
  function projectLinesWatchInput() {
    if (projectLinesInputWatched) return;
    projectLinesInputWatched = true;
    const touched = () => { projectLinesRun.inputAt = performance.now(); projectLinesSyncStripAvailability?.(); };
    const touchedEnd = () => { touched(); requestAnimationFrame(() => projectLinesSyncStripAvailability?.()); };
    for (const type of ["pointerdown", "keydown", "wheel"]) addEventListener(type, touched, { capture:true, passive:true });
    addEventListener("pointerup", touchedEnd, { capture:true, passive:true });
    addEventListener("pointerup", touchedEnd, { passive:true });
    addEventListener("pointermove", event => { if (event.buttons) touched(); }, { capture:true, passive:true });
    document.addEventListener("visibilitychange", projectLinesSaveOnHide);
    addEventListener("pagehide", () => projectLinesRememberView(true));
  }
  // The Canvas header reports its own Library saves. Here it reports the project folder instead.
  function projectLinesShowSaved() {
    projectLinesSyncStripAvailability?.();
    const button = document.querySelector("#canvasDocumentSaveState"), label = document.querySelector("#canvasDocumentSaveLabel");
    if (!button || !label || !projectLinesRun.ready || !projectLinesInFront() || projectLinesNothingYet()) return;
    const zh = projectLinesZh(), failed = projectLinesRun.failed, settled = !projectLinesRun.saving && projectLinesRun.savedKey === canvasDocumentsDraftKey();
    const stateKey = failed ? "unsaved" : settled ? "saved" : "saving", text = failed ? (zh ? "未保存到项目" : "Not saved to project") : settled ? (zh ? "已保存到项目" : "Saved to project") : (zh ? "正在保存…" : "Saving…");
    if (button.dataset.state !== stateKey) button.dataset.state = stateKey;
    if (label.textContent !== text) label.textContent = text;
  }
  function projectLinesBindSaveLabel() {
    if (projectLinesSaveLabelBound) return;
    projectLinesSaveLabelBound = true;
    const button = document.querySelector("#canvasDocumentSaveState");
    if (button) new MutationObserver(projectLinesShowSaved).observe(button, { subtree:true, childList:true, characterData:true, attributes:true, attributeFilter:["data-state"] });
    for (const control of [button, document.querySelector("#saveCanvasBtn")]) control?.addEventListener("click", event => {
      if (!projectLinesRun.ready || !projectLinesInFront()) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (projectLinesCanSave()) projectLinesSave().catch(() => {});
    }, true);
    setInterval(projectLinesShowSaved, 500);
  }
  function projectLinesPanelPause(paused) {
    try { projectLinesPanel.frame?.contentWindow?.postMessage({ source:"penecho-canvas", paused:Boolean(paused) }, location.origin); } catch {}
  }
  const PROJECT_LINES_SETTINGS_HASH = /^#(?:settings(?:\/|$)|agents(?:\/|$)|providers$|archived$|setup$)/;
  function projectLinesSettingsHashOf(destination) {
    try {
      const url = new URL(destination, location.href);
      if (url.origin === location.origin && (url.pathname === "/projects.html" || url.pathname === "/") && PROJECT_LINES_SETTINGS_HASH.test(url.hash || "")) {
        return url.hash;
      }
    } catch {}
    return "";
  }
  async function projectLinesFlushAndDeactivate({ showCover = false } = {}) {
    projectLinesRememberView(true);
    if (projectLinesRun.ready && !projectLinesInFront()) {
      // Another Canvas is in front (one opened here from the Library, say). It is never written into the project's file:
      // the browser keeps it as it keeps any Canvas, and the project's Canvas is as it was last saved.
      await canvasDocumentsSettleDraft(5000, { finalize:true });
      projectLinesRun.ready = false;
      if (showCover) window.projectLinesCover?.show();
    } else if (projectLinesRun.ready) {
      await canvasDocumentsSettleDraft(5000, { finalize:true });
      if (projectLinesRun.saving) await projectLinesRun.saving.catch(() => {});
      // The Canvas can still be drawn on while it is saved: a stroke made meanwhile is saved too.
      for (let round = 0; round < 3; round++) {
        const behind = projectLinesBehind();
        if (!(behind.file || behind.picture) || projectLinesNothingYet()) break;
        await projectLinesSave();
      }
      // The picture lives in the folder now, so a plain Canvas page will not bring this one back.
      projectLinesRemember(false);
      projectLinesRun.ready = false;
      // Closing it brings up another Canvas underneath, which you never need to see.
      if (showCover) window.projectLinesCover?.show();
      if (!projectLinesInShell) {
        try { sessionStorage.setItem("penecho-lines-zoomed", "1"); } catch { /* It only skips the last part of the animation. */ }
      }
      await canvasDocumentsClose(projectLinesRun.documentId).catch(() => {});
      // Everything is in the folder by now, and closing it brought up another Canvas that has not changed. Nothing is unsaved, so the browser has nothing to ask.
      canvasDocumentsDraft.savedKey = canvasDocumentsDraftKey();
    } else if (!projectLinesTarget) await canvasDocumentsSettleDraft(5000, { finalize:true });
    projectLinesPanelPause(true);
  }
  // In the shell this page stays for every Canvas. Opening one, switching to another and leaving take turns, so no two of them ever
  // hold the Canvas at once: a newer turn stops the one before it where that can still stop, and starts once it has let go.
  let projectLinesTurns = Promise.resolve(), projectLinesTurnStop = null;
  function projectLinesTurn(work) {
    projectLinesTurnStop?.abort();
    const { signal } = projectLinesTurnStop = new AbortController();
    const turn = projectLinesTurns.then(() => signal.aborted ? undefined : work(signal));
    projectLinesTurns = turn.catch(() => {});
    return turn;
  }
  // The Canvas could not be saved, so it stays open. The shell is told which one that is, and why; a failed save has already said so here.
  function projectLinesTellStayed(error, requestId) {
    const why = String(error?.message || error);
    if (!projectLinesRun.failed && !projectLinesRun.elsewhere) setStatus(why);
    projectLinesShellTell({ stayed:true, requestId, error:why, project:projectLinesTarget.project, canvas:projectLinesTarget.source });
  }
  async function projectLinesLeave(destination) {
    if (projectLinesInShell) {
      const settingsTarget = projectLinesSettingsHashOf(destination);
      if (settingsTarget) {
        // Settings opens directly over the live Canvas in the persistent shell — flush quietly without closing.
        if (projectLinesCanSave() && !projectLinesNothingYet() && (projectLinesBehind().file || projectLinesBehind().picture)) {
          void projectLinesSave({ picture:false, quiet:true }).catch(() => {});
        }
        projectLinesShellTell({ openSettings:settingsTarget });
        return;
      }
      await projectLinesTurn(async stop => {
        await projectLinesFlushAndDeactivate({ showCover:false });
        if (!stop.aborted) projectLinesShellTell({ leave:destination });
      });
      return;
    }
    await projectLinesFlushAndDeactivate({ showCover:true });
    location.assign(projectLinesAddress(destination));
  }
  // An empty Canvas shows "Start a project" and the example projects. Drawing still starts anywhere, and the panel goes away as soon as there is something on the Canvas.
  async function projectLinesRenderEntry() {
    const entry = document.querySelector("#projectLinesEntry"), side = document.querySelector("#projectLinesSide"), tools = window.PenEchoProjects;
    if (!entry || !tools || !projectLinesLocal() || projectLinesTarget && !projectLinesTarget.first) {
      if (entry) entry.hidden = true;
      if (side) {
        if (window.PenEchoCompanionProjectBridge?.enabled?.()) window.PenEchoCompanionProjectBridge.renderSidebar();
        else side.hidden = true;
      }
      document.documentElement.classList.remove("pls-first");
      return;
    }
    const lang = projectLinesZh() ? "zh" : "en";
    try {
      const { projects } = await tools.list();
      // Put away, the Canvas is as it always was: its own welcome and examples on an empty one.
      if (!window.projectLinesWelcomeOpen) { entry.hidden = true; projectLinesRenderSide(side, projects, lang); return; }
      // The app start page opens on the hand tool so the intro stays visible unless you leave it or switch to pen.
      // On a first open there is no Canvas to go back to: the second button says where it goes, the new Canvas in My Canvases underneath.
      const fresh = Boolean(projectLinesTarget?.first);
      tools.mount(entry, { lang, projects, drawHint:false, startButton:true, showModel:true, backToCanvas:!fresh, drawCanvas:fresh });
      for (const button of entry.querySelectorAll("[data-pls-back], [data-pls-draw]")) button.addEventListener("click", () => { projectLinesPutAway(); void projectLinesRenderEntry(); });
      entry.hidden = false;
      // The rail beside it already lists the projects.
      if (fresh) { if (side) side.hidden = true; } else projectLinesRenderSide(side, projects, lang);
    } catch { entry.hidden = true; if (side) side.hidden = true; }
    finally { document.documentElement.classList.remove("pls-first"); }
  }
  function projectLinesRenderSide(side, projects, lang) {
    if (!side) return;
    const tools = window.PenEchoProjects, list = side.querySelector("[data-project-lines-side-list]"), recent = [...projects].sort((a, b) => (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0));
    side.querySelector("[data-project-lines-side-title]").textContent = lang === "zh" ? "项目" : "Projects";
    side.querySelector("[data-project-lines-side-all]").textContent = lang === "zh" ? "全部" : "All";
    list.replaceChildren(...recent.slice(0, 8).map(project => {
      const row = document.createElement("a"), mark = document.createElement("span"), name = document.createElement("b"), state = document.createElement("em");
      row.className = "project-lines-side-row"; mark.className = "project-lines-side-mark";
      row.href = tools.projectUrl(project); row.title = project.name;
      if (project.color) row.style.setProperty("--project-color", project.color);
      mark.textContent = project.name.slice(0, 1); name.textContent = project.name;
      const status = tools.statusText(project, lang);
      if ((project.lines || []).length || project.missing) state.textContent = status;
      row.append(mark, name, state);
      row.addEventListener("click", event => {
        if (!tools.plain(event)) return;
        event.preventDefault();
        projectLinesLeave(row.href).catch(error => setStatus(String(error.message || error)));
      });
      return row;
    }));
    side.hidden = !recent.length;
  }
  // PenEcho Lines is what you see first, every time PenEcho opens. A Canvas kept from last time waits underneath, one click or one stroke away.
  function projectLinesPutAway() {
    window.projectLinesWelcomeOpen = false;
    // Once put away, the first page is done with: the address no longer asks for it.
    if (projectLinesTarget?.first) {
      projectLinesTarget.first = false;
      const address = new URL(location.href);
      address.searchParams.delete("linesFirst");
      history.replaceState(history.state, "", address);
    }
    window.projectLinesWelcomeSync?.();
    if (state.mode === "hand" && !state.viewMode) resetCanvasDefaultMode();
    // The Canvas is in front now: the one hint by the AI button, on a new install.
    if (typeof maybeShowCanvasHint === "function") requestAnimationFrame(() => maybeShowCanvasHint());
  }
  // New canvas is a Canvas you asked for, so it opens on the Canvas's own welcome and examples.
  let projectLinesMakingCanvas = false;
  window.projectLinesNewCanvas = open => {
    if (projectLinesTarget || !projectLinesLocal()) return open();
    projectLinesMakingCanvas = true;
    projectLinesPutAway();
    void projectLinesRenderEntry();
    return Promise.resolve(open()).finally(() => requestAnimationFrame(() => { projectLinesMakingCanvas = false; }));
  };
  // The panel fades while a stroke is being drawn over it, and comes back if the Canvas is still empty afterwards.
  function projectLinesBindDrawing() {
    const welcome = document.querySelector("#canvasWelcome"), viewport = document.querySelector("#viewport");
    if (!welcome || !viewport) return;
    // A new empty Canvas shows the panel again, with the projects as they are now.
    // So does a Canvas that turns out to be kept from last time once it has loaded.
    let shown = !welcome.hidden, covering = welcome.classList.contains("pls-kept");
    new MutationObserver(() => {
      const nowShown = !welcome.hidden, nowCovering = welcome.classList.contains("pls-kept");
      if (nowShown && !shown && !projectLinesTarget && !projectLinesMakingCanvas) window.projectLinesWelcomeOpen = true;
      if (nowShown && (nowShown !== shown || nowCovering !== covering)) void projectLinesRenderEntry();
      shown = nowShown; covering = nowCovering;
    }).observe(welcome, { attributes:true, attributeFilter:["hidden", "class"] });
    let putAway = false;
    // Over a kept Canvas the panel still covers it, so scrolling there does not move a Canvas you cannot see.
    viewport.addEventListener("wheel", event => { if (!welcome.hidden && welcome.classList.contains("pls-kept") && !welcome.classList.contains("pls-drawing")) { event.preventDefault(); event.stopImmediatePropagation(); } }, { capture:true, passive:false });
    // The app start page stays on the hand tool so clicking or dragging does not draw or dismiss the intro.
    // If the user explicitly switches to a drawing tool and starts drawing on the Canvas, the panel fades and leaves.
    viewport.addEventListener("pointerdown", event => {
      if (welcome.hidden || event.target.closest?.("#projectLinesEntry :is(a,button,input,label)")) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      const canvasSurface = event.target === screen || Boolean(event.target.closest?.(".placed-content-input-region, .canvas-widget"));
      if (state.viewMode || state.mode === "hand" || state.spacePan || event.altKey) {
        if (welcome.classList.contains("pls-kept") && !welcome.classList.contains("pls-drawing") && canvasSurface) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
        return;
      }
      if (!canvasSurface) return;
      welcome.classList.add("pls-drawing");
      if (window.projectLinesWelcomeOpen) {
        window.projectLinesWelcomeOpen = false;
        putAway = true;
      }
    }, true);
    const lift = () => { welcome.classList.remove("pls-drawing"); if (putAway) { putAway = false; window.projectLinesWelcomeSync?.(); } };
    addEventListener("pointerup", lift, true);
    addEventListener("pointercancel", lift, true);
  }
  // ---------- An agent's drawing on the open Canvas ----------
  // The Canvas file says which text each agent-made Widget was last drawn from. The page hands that back with every save,
  // and asks now and then whether an agent has drawn since, so what it draws shows without a reload.
  const PROJECT_LINES_PULL_MS = 4000;
  const projectLinesSources = () => snapshotExtensionObject(state.currentSnapshotManifestExtensions)["penecho.lines"]?.sources || {};
  async function projectLinesTake(answer) {
    if (!answer || typeof answer !== "object") return 0;
    const widgets = Array.isArray(answer.widgets) ? answer.widgets : [];
    // A Widget you are moving or changing right now is left to you. Nothing is remembered about this answer,
    // so the next look brings the same drawings again: remembering them here would lose them for good.
    if (widgets.length && (state.widgetGesture || state.widgetEdit || state.pendingWidget)) return 0;
    if (answer.sources && typeof answer.sources === "object") {
      const extensions = snapshotExtensionObject(state.currentSnapshotManifestExtensions);
      state.currentSnapshotManifestExtensions = { ...extensions, "penecho.lines":{ ...(extensions["penecho.lines"] || {}), sources:answer.sources } };
    }
    if (!widgets.length) return 0;
    const run = projectLinesRun;
    await enableSnapshotWidgetPlugins(widgets);
    if (projectLinesRun !== run) return 0;
    let taken = 0;
    for (const item of widgets) {
      const at = state.widgets.findIndex(widget => widget.id === item.id), had = at >= 0 ? state.widgets[at] : null;
      // What an agent redrew stays where you put it, at the size you gave it.
      const record = widgetRecord(had ? { ...item, x:had.x, y:had.y, w:had.w, h:had.h } : item);
      if (!record) continue;
      if (had) { unmountWidget(had); state.widgets[at] = record; } else state.widgets.push(record);
      const numbered = /^widget-(\d+)$/.exec(record.id);
      if (numbered) state.nextWidgetId = Math.max(state.nextWidgetId, Number(numbered[1]) + 1);
      if (pluginEnabled(record.pluginId)) mountWidget(record);
      taken++;
    }
    if (taken) {
      requestRender();
      canvasDocumentsScheduleDraft(true);
      setStatus(projectLinesZh() ? "AI 在这张画布上画了新内容。" : "AI drew on this Canvas.");
    }
    return taken;
  }
  // The part of the Canvas the person sees: the view, less what the line panel covers.
  function projectLinesSeenRect() {
    const { width, height } = canvasFitViewportSize(),
      x = Math.max(0, -state.panX / state.scale), y = Math.max(0, -state.panY / state.scale),
      right = Math.min(SIZE, (width - state.panX) / state.scale), bottom = Math.min(SIZE, (height - state.panY) / state.scale);
    return right > x && bottom > y ? { x, y, w:right - x, h:bottom - y } : null;
  }
  // An agent asked what the person sees (GET /api/draw?view=1): this view as a PNG, with Canvas coordinates on a grid.
  async function projectLinesSendView(id) {
    const run = projectLinesRun, target = projectLinesTarget;
    if (run.viewSent === id) return;
    run.viewSent = id;
    let body;
    try {
      const seen = projectLinesSeenRect();
      const shot = await canvasAgentCapture(seen ? { target:"region", region:seen, quality:"basic", coordinates:"grid" } : { target:"viewport", quality:"basic", coordinates:"grid" }, {});
      let png = shot.dataUrl;
      if (!/^data:image\/png;/.test(png)) {
        const image = new Image();
        image.src = png;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
        canvas.getContext("2d").drawImage(image, 0, 0);
        png = canvas.toDataURL("image/png");
      }
      // Another Canvas was opened while this one was being captured: the picture may be of that one.
      if (projectLinesRun !== run || !run.ready) return;
      body = { path:target.source, id, png, region:shot.logicalRegion };
    } catch (error) {
      body = { path:target.source, id, error:String(error?.message || error).slice(0, 300) };
    }
    await projectLinesFetch(`/api/lines/projects/${encodeURIComponent(target.project)}/canvas/view`, { method:"POST", credentials:"same-origin", headers:{ accept:"application/json", "content-type":"application/json" }, body:JSON.stringify(body) }).catch(() => {});
  }
  async function projectLinesPull() {
    const run = projectLinesRun;
    if (!run.ready || run.noPull || run.pulling || run.saving || document.hidden || state.drawing || !run.snapshotId || canvasDocuments.activeId !== run.documentId) return;
    if (performance.now() - run.inputAt < 1500) return;
    run.pulling = true;
    try {
      const response = await projectLinesFetch(`/api/lines/projects/${encodeURIComponent(projectLinesTarget.project)}/canvas/pull`, { method:"POST", credentials:"same-origin", headers:{ accept:"application/json", "content-type":"application/json" }, body:JSON.stringify({ path:projectLinesTarget.source, sources:projectLinesSources(), view:projectLinesSeenRect() }) });
      // A server from before this could be asked, or a Canvas that has moved: either way there is nothing to take.
      if (response.status === 404 || response.status === 409 || response.status === 410) { run.noPull = true; return; }
      if (!response.ok) return;
      const answer = await response.json().catch(() => null);
      // What an agent drew on this Canvas is not for the one opened since.
      if (projectLinesRun !== run || !run.ready) return;
      if (typeof answer?.capture === "string" && answer.capture) void projectLinesSendView(answer.capture);
      await projectLinesTake(answer);
    } catch { /* The next look tries again. */ }
    finally { run.pulling = false; }
  }

  // ---------- The line beside the Canvas ----------
  // Every Canvas in a project has a panel that is its line: notes, Asks, what agents answered, Run with. It is the Projects page itself,
  // shown in its panel mode (public/lines/embed.js), so the line reads and works here exactly as it does there.
  const projectLinesPanel = { element:null, frame:null, button:null, open:false, leaving:false };
  const projectLinesStripState = { attachedLine:"", attachedLabel:"", attachedStep:null, error:"", busy:false };
  const projectLinesMeta = { loaded:false, loading:null, projectTitle:"", lineTitle:"", topics:[] };
  function projectLinesActiveLineSlug() {
    return (/^(?:lines|topics)\/([^/]+)\.md$/.exec(projectLinesTarget?.doc || "") || [])[1] || "";
  }
  function projectLinesContextLineSlug() {
    return projectLinesActiveLineSlug() || projectLinesTarget?.originLine || "";
  }
  async function projectLinesEnsureMeta() {
    if (!projectLinesTarget || !projectLinesLocal()) return null;
    if (projectLinesMeta.loaded) return projectLinesMeta;
    if (projectLinesMeta.loading) return projectLinesMeta.loading;
    const target = projectLinesTarget;
    projectLinesMeta.loading = projectLinesJson(`/api/lines/projects/${encodeURIComponent(target.project)}/state?for=rail`).then(data => {
      if (projectLinesTarget !== target) return null;
      projectLinesMeta.projectTitle = data?.project?.name || data?.project?.title || projectLinesTarget.project;
      const merged = [
        ...(Array.isArray(data?.lines) ? data.lines : []),
        ...(Array.isArray(data?.backlog) ? data.backlog : []),
        ...(Array.isArray(data?.landed) ? data.landed : []),
      ];
      projectLinesMeta.topics = merged.filter(item => item?.slug && !item.archived);
      const slug = projectLinesContextLineSlug();
      const matched = projectLinesMeta.topics.find(item => item.slug === slug);
      projectLinesMeta.lineTitle = matched?.title || projectLinesTarget.originLabel || slug || "";
      projectLinesMeta.loaded = true;
      projectLinesRenderBreadcrumb();
      projectLinesRenderContextStrip();
      return projectLinesMeta;
    }).catch(() => null).finally(() => { if (projectLinesTarget === target) projectLinesMeta.loading = null; });
    return projectLinesMeta.loading;
  }
  function projectLinesPanelAddress(step = "") {
    const { project, source, doc, originLine } = projectLinesTarget, line = (/^(?:lines|topics)\/([^/]+)\.md$/.exec(doc) || [])[1] || originLine || "";
    // A newly saved Ask may be absent from an open panel's cached Line. Load the specific Ask from fresh Line state.
    const query = new URLSearchParams({ embed:"panel", canvas:source, ...(step ? { ask:step } : {}) });
    return projectLinesAddress(`/projects.html?${query}#${encodeURIComponent(project)}/${line ? `line/${encodeURIComponent(line)}` : "newline"}${step ? `/${encodeURIComponent(step)}` : ""}`);
  }
  function projectLinesReloadPanel(step = "") {
    const frame = projectLinesPanel.frame;
    if (!frame || !projectLinesTarget) return;
    if (frame.getAttribute("src") && frame.contentWindow) {
      try {
        frame.contentWindow.postMessage({
          source:"penecho-canvas",
          switchPanel:{ project:projectLinesTarget.project, canvas:projectLinesTarget.source, line:projectLinesContextLineSlug(), step },
        }, location.origin);
        return;
      } catch {}
    }
    const nextSrc = projectLinesPanelAddress(step);
    if (frame.getAttribute("src") !== nextSrc) { frame.src = nextSrc; return; }
    try { frame.contentWindow?.location.reload(); } catch { frame.src = nextSrc; }
  }
  function projectLinesRenderBreadcrumb() {
    const btn = document.getElementById("canvasBreadcrumbParent"), sep = document.getElementById("canvasBreadcrumbSep");
    if (!btn || !sep) return;
    if (!projectLinesTarget || projectLinesTarget.draft || !projectLinesLocal()) {
      btn.hidden = true; sep.hidden = true; return;
    }
    const lineSlug = projectLinesContextLineSlug();
    const matched = projectLinesMeta.topics.find(item => item.slug === lineSlug);
    const parentLabel = lineSlug ? (matched?.title || projectLinesMeta.lineTitle || projectLinesTarget.originLabel || lineSlug) : (projectLinesMeta.projectTitle || projectLinesTarget.project);
    btn.textContent = parentLabel;
    btn.title = parentLabel;
    btn.hidden = false;
    sep.hidden = false;
  }
  function projectLinesSyncStripAvailability() {
    const btn = document.querySelector("#projectLinesContextStrip .project-lines-strip-btn.primary");
    if (!btn || projectLinesStripState.busy) return;
    const isAdded = Boolean(projectLinesTarget?.doc) && projectLinesTarget.doc === `lines/${projectLinesTarget?.originLine || projectLinesStripState.attachedLine}.md`;
    if (!isAdded) btn.disabled = projectLinesBlank();
  }
  function projectLinesLineDisplayName(slug) {
    const matched = projectLinesMeta.topics.find(item => item.slug === slug);
    return matched?.title || projectLinesTarget?.originLabel || projectLinesMeta.lineTitle || slug || "";
  }
  function projectLinesRenderContextStrip() {
    const host = document.getElementById("projectLinesContextStrip");
    if (!host) return;
    const targetSlug = projectLinesTarget?.originLine || projectLinesStripState.attachedLine;
    if (!projectLinesTarget || projectLinesTarget.draft || !projectLinesLocal() || !targetSlug) {
      host.hidden = true;
      host.replaceChildren();
      return;
    }
    const zh = projectLinesZh();
    const attachedNow = Boolean(projectLinesTarget.doc && projectLinesTarget.doc === `lines/${targetSlug}.md`);
    const lineName = projectLinesStripState.attachedLabel || projectLinesLineDisplayName(targetSlug);
    const stateName = projectLinesStripState.error ? "error" : attachedNow ? "added" : "loose";
    host.hidden = false;
    const bar = document.createElement("div");
    bar.className = "project-lines-strip-bar";
    bar.dataset.state = stateName;
    const status = document.createElement("span");
    status.className = "project-lines-strip-status";
    const dot = document.createElement("span");
    dot.className = "project-lines-strip-dot";
    dot.setAttribute("aria-hidden", "true");
    const text = document.createElement("span");
    text.className = "project-lines-strip-text";
    text.textContent = stateName === "error"
      ? projectLinesStripState.error
      : attachedNow
        ? (zh ? `已加入工作线「${lineName}」` : `Added to ${lineName}`)
        : (zh ? `尚未加入工作线「${lineName}」` : `Not added to ${lineName}`);
    status.append(dot, text);
    const actions = document.createElement("div");
    actions.className = "project-lines-strip-actions";
    if (attachedNow && stateName !== "error") {
      const undo = document.createElement("button");
      undo.type = "button";
      undo.className = "project-lines-strip-btn";
      undo.textContent = zh ? "撤销" : "Undo";
      undo.disabled = projectLinesStripState.busy;
      undo.addEventListener("click", () => { void projectLinesUndoAttach(targetSlug); });
      actions.append(undo);
    } else {
      const attach = document.createElement("button");
      attach.type = "button";
      attach.className = "project-lines-strip-btn primary";
      attach.textContent = projectLinesStripState.busy
        ? (zh ? "加入中…" : "Adding…")
        : stateName === "error"
          ? (zh ? "重试加入" : "Retry add")
          : (zh ? "加入工作线" : "Add to Line");
      attach.disabled = projectLinesStripState.busy || projectLinesBlank();
      if (projectLinesBlank() && !projectLinesStripState.busy) {
        attach.title = zh ? "先在画布上画一些内容，再加入工作线" : "Draw on the canvas first to add it to this Line";
      }
      attach.addEventListener("click", () => { void projectLinesAttachOrigin(targetSlug); });
      actions.append(attach);
    }
    bar.append(status, actions);
    host.replaceChildren(bar);
  }
  async function projectLinesAttachOrigin(slug) {
    if (!projectLinesTarget || !slug || projectLinesStripState.busy || projectLinesBlank()) return;
    const zh = projectLinesZh(), target = projectLinesTarget;
    projectLinesStripState.busy = true;
    projectLinesStripState.error = "";
    projectLinesRenderContextStrip();
    try {
      if (projectLinesCanSave()) await projectLinesSave({ picture:true, quiet:false });
      const res = await projectLinesJson(`/api/lines/projects/${encodeURIComponent(target.project)}/canvases/attach`, {
        path: target.source,
        topic: slug,
      });
      if (projectLinesTarget !== target) return;
      projectLinesStripState.attachedLine = slug;
      projectLinesStripState.attachedLabel = res?.topicTitle || projectLinesLineDisplayName(slug);
      projectLinesStripState.attachedStep = res?.step ?? null;
      projectLinesAdoptLine(slug);
      projectLinesReloadPanel();
    } catch (error) {
      if (projectLinesTarget !== target) return;
      projectLinesStripState.error = String(error?.message || (zh ? "未能加入工作线。" : "Could not add to Line."));
      setStatus(projectLinesStripState.error);
    } finally {
      if (projectLinesTarget === target) {
        projectLinesStripState.busy = false;
        projectLinesRenderContextStrip();
      }
    }
  }
  async function projectLinesUndoAttach(slug) {
    if (!projectLinesTarget || !slug || projectLinesStripState.busy) return;
    const zh = projectLinesZh(), target = projectLinesTarget;
    projectLinesStripState.busy = true;
    projectLinesStripState.error = "";
    projectLinesRenderContextStrip();
    try {
      await projectLinesJson(`/api/lines/projects/${encodeURIComponent(target.project)}/canvases/detach`, {
        path: target.source,
        topic: slug,
        ...(projectLinesStripState.attachedStep ? { step: projectLinesStripState.attachedStep } : {}),
      });
      if (projectLinesTarget !== target) return;
      projectLinesStripState.attachedStep = null;
      projectLinesAdoptLine("");
      projectLinesReloadPanel();
    } catch (error) {
      if (projectLinesTarget !== target) return;
      projectLinesStripState.error = String(error?.message || (zh ? "未能撤销加入。" : "Could not undo adding to Line."));
      setStatus(projectLinesStripState.error);
    } finally {
      if (projectLinesTarget === target) {
        projectLinesStripState.busy = false;
        projectLinesRenderContextStrip();
      }
    }
  }
  function projectLinesSyncMoreMenu() {
    const active = Boolean(projectLinesTarget && !projectLinesTarget.draft && projectLinesLocal());
    const hasDoc = Boolean(active && projectLinesTarget.doc);
    const moveBtn = document.getElementById("moreMoveCanvasBtn");
    const moveLabel = document.getElementById("moreMoveCanvasLabel");
    const folderBtn = document.getElementById("moreOpenFolderBtn");
    const delBtn = document.getElementById("moreDeleteCanvasBtn");
    const sepDanger = document.getElementById("moreSepDanger");
    const zh = projectLinesZh();
    if (moveBtn) moveBtn.hidden = !active;
    if (moveLabel) moveLabel.textContent = hasDoc ? (zh ? "移到其他工作线…" : "Move its line to…") : (zh ? "加入工作线…" : "Add to a line…");
    if (folderBtn) {
      folderBtn.hidden = !active || Boolean(projectLinesHost);
      const folderSpan = folderBtn.querySelector("span");
      if (folderSpan && !/mac/i.test(navigator.platform || "")) folderSpan.textContent = zh ? "打开所在文件夹" : "Open folder";
    }
    if (delBtn && active) delBtn.hidden = false;
    if (sepDanger && delBtn) sepDanger.hidden = delBtn.hidden || document.documentElement.dataset.penechoGuestAi === "true";
  }
  function projectLinesPanelShow(open) {
    const panel = projectLinesPanel;
    if (!panel.element) return;
    const opening = open && panel.element.hidden;
    panel.open = open;
    // Opening it writes nothing: a Canvas you only open stays out of the folder until you draw, or the panel makes its line (projectLinesFileForPanel).
    if (open && !panel.frame.getAttribute("src")) panel.frame.src = projectLinesPanelAddress();
    panel.element.hidden = !open;
    document.body.classList.toggle("project-lines-panel-open", open);
    panel.button.setAttribute("aria-expanded", String(open));
    // The panel lies over the Canvas: what it would cover moves beside it.
    if (opening) keepCanvasContentsClearOfPanel();
  }
  // A line needs its Canvas to be a file. The panel asks just before it sends a note or an Ask that makes this Canvas's line,
  // and the Canvas is written then, with what is on it now.
  async function projectLinesFileForPanel() {
    if (!projectLinesCanSave()) return;
    if (projectLinesNothingYet() || projectLinesBehind().file) await projectLinesSave({ picture:false });
  }
  // The Canvas now belongs to this line: its saves link their picture there, and the address says so.
  function projectLinesAdoptLine(line) {
    const doc = line ? `lines/${line}.md` : "";
    if (doc === projectLinesTarget.doc) return;
    projectLinesTarget.doc = doc;
    const address = new URL(location.href);
    if (doc) address.searchParams.set("linesDoc", doc); else address.searchParams.delete("linesDoc");
    history.replaceState(history.state, "", address);
    // The rail marks the line this Canvas is now on.
    projectLinesRail.frame?.contentWindow?.postMessage({ source:"penecho-canvas", line }, location.origin);
    projectLinesShellTell({ line, project:projectLinesTarget.project, canvas:projectLinesTarget.source });
    projectLinesRenderBreadcrumb();
    projectLinesSyncMoreMenu();
    projectLinesRenderContextStrip();
  }
  // An Ask from this page on the line of the Canvas in front: an example, say. The Canvas is saved first, with its picture, so the agent sees
  // what is drawn; the Ask is kept on this Canvas's line (made now if it has none), runs at once on the default agent, and the line opens beside it.
  function projectLinesCanAsk() {
    return Boolean(projectLinesTarget && !projectLinesTarget.draft && projectLinesLocal() && projectLinesRun.ready && canvasDocuments.activeId === projectLinesRun.documentId);
  }
  // Save the clicked suggestion as a normal unsent Ask. The embedded Line owns the later Run with action.
  async function projectLinesSaveSuggestion(text, captures, { selection, assertCurrent }) {
    const target = projectLinesTarget, { project, source } = target, base = `/api/lines/projects/${encodeURIComponent(project)}`;
    const canvasView = projectLinesSeenRect(), attachments = [];
    await projectLinesRun.saving;
    assertCurrent();
    if (!projectLinesRun.snapshotId || projectLinesBehind().file) {
      // The masked picture is captured first. Return lifted ink to the Canvas before writing its project file.
      if (selection && state.selection === selection) commitSelection();
      if (!projectLinesCanSave()) throw Error(projectLinesZh() ? "画布正在更新，请稍后再保存任务。" : "The Canvas is changing. Try saving the task again in a moment.");
      await projectLinesSave({ picture:false });
    }
    for (const { dataUrl, name } of captures) {
      assertCurrent();
      const blob = dataUrlBlob(dataUrl), filename = `${name}.${blob.type.split("/")[1]}`;
      const response = await projectLinesFetch(`${base}/upload?name=${encodeURIComponent(filename)}`, { method:"POST", credentials:"same-origin", body:blob });
      const file = await response.json();
      if (!response.ok || !file.path) throw Error(file.message || file.error || (projectLinesZh() ? "无法保存任务图片。" : "Could not save the task image."));
      attachments.push({ path:file.path, name:file.name, type:blob.type });
    }
    assertCurrent();
    const answer = await projectLinesJson(`${base}/unsent`, { text, canvas:source, canvasView, attachments, topic:projectLinesContextLineSlug() || "new" });
    if (!answer.slug || !answer.step) throw Error(projectLinesZh() ? "无法保存任务。" : "Could not save the task.");
    if (projectLinesTarget === target && projectLinesCanAsk()) {
      projectLinesAdoptLine(answer.slug);
      if (projectLinesPanel.frame) {
        projectLinesPanel.frame.src = projectLinesPanelAddress(answer.step);
        projectLinesPanelShow(true);
      }
    }
  }
  async function projectLinesAskOnLine({ text, title = "", agent = "" }) {
    if (!projectLinesCanAsk()) throw Error(projectLinesZh() ? "这张画布不在项目里。" : "This Canvas is not in a project.");
    const target = projectLinesTarget;
    await canvasDocumentsSettleDraft(5000, { finalize:true });
    if (projectLinesTarget === target) await projectLinesSave({ picture:true });
    const response = await projectLinesFetch(`/api/lines/projects/${encodeURIComponent(target.project)}/topics`, { method:"POST", credentials:"same-origin", headers:{ accept:"application/json", "content-type":"application/json" }, body:JSON.stringify({ canvas:target.source, text, title, agent }) });
    const answer = await response.json().catch(() => null);
    if (!response.ok || !answer?.slug) throw Error(answer?.error || (projectLinesZh() ? "没能把请求发给 Agent。" : "The Ask could not be sent to the agent."));
    if (projectLinesTarget !== target) return answer.slug;
    projectLinesAdoptLine(answer.slug);
    const panel = projectLinesPanel;
    if (panel.element) {
      panel.frame.src = projectLinesPanelAddress();
      projectLinesPanelShow(true);
    }
    return answer.slug;
  }
  function projectLinesPanelLabels() {
    const { button, element, frame } = projectLinesPanel, zh = projectLinesZh();
    if (!element) return;
    button.querySelector("span").textContent = zh ? "笔记与 AI" : "Notes & AI";
    button.setAttribute("aria-label", button.querySelector("span").textContent);
    button.title = zh ? "这张画布的笔记、提问和 AI 的回答" : "This Canvas's notes, Asks and what AI answered";
    element.setAttribute("aria-label", zh ? "这张画布的笔记与 AI" : "Notes and AI for this Canvas");
    frame.title = element.getAttribute("aria-label");
  }
  function projectLinesBindPanel() {
    const link = document.querySelector("[data-project-lines-link]"), frameHost = document.querySelector(".canvas-frame");
    // A Canvas opened only to draw something for the box has no line of its own.
    if (!link || !frameHost || projectLinesTarget.draft) return;
    const panel = projectLinesPanel;
    const button = panel.button = document.createElement("button");
    button.type = "button"; button.className = "project-lines-panel-button"; button.setAttribute("aria-expanded", "false"); button.setAttribute("aria-controls", "projectLinesPanel");
    button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14v10H10l-5 4z"/></svg><span></span>`;
    link.closest(".top-row").append(button);
    const element = panel.element = document.createElement("aside");
    element.id = "projectLinesPanel"; element.className = "project-lines-panel"; element.hidden = true;
    const frame = panel.frame = document.createElement("iframe");
    projectLinesPanelLabels();
    element.append(frame);
    frameHost.append(element);
    button.addEventListener("click", () => projectLinesPanelShow(!panel.open));
    addEventListener("message", event => {
      const said = event.data;
      if (event.origin !== location.origin || event.source !== frame.contentWindow || said?.source !== "penecho-lines-panel") return;
      if (said.want === "file" && typeof said.ask === "string") {
        const reply = data => frame.contentWindow?.postMessage({ source:"penecho-canvas", file:said.ask, canvas:projectLinesTarget.source, ...data }, location.origin);
        projectLinesFileForPanel().then(() => reply({ view:projectLinesSeenRect() }), error => reply({ error:String(error.message || error) }));
        return;
      }
      const keepOriginLoose = !projectLinesTarget.doc && projectLinesTarget.originLine && said.line === projectLinesTarget.originLine;
      // The panel may still be answering for the Canvas that was open before this one.
      const ours = said.project === projectLinesTarget.project && (said.canvas === undefined || said.canvas === projectLinesTarget.source);
      if (typeof said.line === "string" && ours && !keepOriginLoose) projectLinesAdoptLine(said.line);
      // Anything outside the line is a whole page: the Canvas is saved, then it opens.
      if (typeof said.leave === "string" && said.leave.startsWith("/") && !said.leave.startsWith("//") && !panel.leaving) {
        panel.leaving = true;
        if (projectLinesIsSettingsLeave(said.leave)) projectLinesSettingsReturnUrl();
        // In the shell this page stays, and its panel can be left from again.
        projectLinesLeave(said.leave).then(() => { if (projectLinesInShell) panel.leaving = false; }, error => { panel.leaving = false; setStatus(String(error.message || error)); });
      }
    });
    addEventListener("pageshow", event => { if (event.persisted && panel.leaving) location.reload(); });
    // Every visit starts with this Canvas's line (or originating line for a new canvas) visible when wide enough to sit beside the Canvas;
    // at 900px and below CSS treats the panel as an overlay that hides Canvas tools, so the Canvas comes first and Notes & AI is a tap away.
    projectLinesPanelShow(!matchMedia("(max-width: 900px)").matches);
  }

  function projectLinesIsSettingsLeave(leave) {
    return typeof leave === "string" && /^\/projects\.html#(?:agents(?:\/(?:canvas|apps|mcp))?|settings(?:\/(?:agents|apps|mcp|canvas|general))?|providers|archived|setup)$/.test(leave);
  }
  function projectLinesSettingsReturnUrl() {
    try {
      sessionStorage.setItem("penecho-settings-return", JSON.stringify({
        url: location.pathname + location.search + location.hash,
        label: projectLinesTarget?.title || document.querySelector("#canvasDocumentNameLabel")?.textContent?.trim() || (projectLinesZh() ? "画布" : "Canvas"),
      }));
    } catch {}
  }
  let projectLinesMenuWired = false;
  function projectLinesOpenMoveDialog() {
    if (!projectLinesTarget || !projectLinesLocal()) return;
    const zh = projectLinesZh(), currentLine = projectLinesActiveLineSlug(), target = projectLinesTarget;
    void projectLinesEnsureMeta().then(meta => {
      if (projectLinesTarget !== target) return;
      const candidates = (meta?.topics || []).filter(item => item.slug && item.slug !== currentLine);
      const dialog = document.createElement("dialog");
      dialog.className = "project-lines-move-dialog";
      dialog.setAttribute("aria-label", zh ? "选择工作线" : "Choose a Line");
      const h = document.createElement("h3");
      h.textContent = currentLine ? (zh ? "移动到其他工作线" : "Move Canvas to another Line") : (zh ? "将画布加入工作线" : "Add Canvas to a Line");
      const p = document.createElement("p");
      p.textContent = candidates.length
        ? (zh ? "选择一条工作线作为这张画布的新去处：" : "Pick the Line where this Canvas belongs:")
        : (zh ? "当前项目中没有其他可选工作线。" : "No other Lines are available in this project.");
      const list = document.createElement("div");
      list.className = "project-lines-move-list";
      for (const item of candidates) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = item.title || item.slug;
        btn.addEventListener("click", async () => {
          btn.disabled = true;
          try {
            if (projectLinesCanSave() && !projectLinesBlank()) await projectLinesSave({ picture:true, quiet:false });
            if (currentLine) {
              await projectLinesJson(`/api/lines/projects/${encodeURIComponent(target.project)}/canvases/detach`, {
                path: target.source,
                topic: currentLine,
              });
            }
            const res = await projectLinesJson(`/api/lines/projects/${encodeURIComponent(target.project)}/canvases/attach`, {
              path: target.source,
              topic: item.slug,
            });
            if (projectLinesTarget !== target) { dialog.close(); return; }
            projectLinesStripState.attachedLine = item.slug;
            projectLinesStripState.attachedLabel = res?.topicTitle || item.title || item.slug;
            projectLinesStripState.attachedStep = res?.step ?? null;
            projectLinesTarget.originLine = item.slug;
            projectLinesTarget.originLabel = res?.topicTitle || item.title || item.slug;
            projectLinesAdoptLine(item.slug);
            projectLinesReloadPanel();
            dialog.close();
          } catch (error) {
            btn.disabled = false;
            setStatus(String(error?.message || error));
          }
        });
        list.append(btn);
      }
      const foot = document.createElement("div");
      foot.className = "project-lines-move-foot";
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.textContent = zh ? "取消" : "Cancel";
      cancel.addEventListener("click", () => dialog.close());
      foot.append(cancel);
      dialog.append(h, p, list, foot);
      dialog.addEventListener("close", () => dialog.remove());
      document.body.append(dialog);
      dialog.showModal();
    });
  }
  function projectLinesBindMenuActions() {
    if (projectLinesMenuWired) return;
    projectLinesMenuWired = true;
    document.getElementById("canvasBreadcrumbParent")?.addEventListener("click", () => {
      projectLinesLeave(projectLinesDestination()).catch(error => setStatus(String(error?.message || error)));
    });
    document.getElementById("moreOpenFolderBtn")?.addEventListener("click", () => {
      if (!projectLinesTarget || !projectLinesLocal()) return;
      void projectLinesJson(`/api/lines/projects/${encodeURIComponent(projectLinesTarget.project)}/open-folder`, {
        which: "canvas",
        path: projectLinesTarget.source,
      }).catch(error => setStatus(String(error?.message || error)));
    });
    document.getElementById("moreMoveCanvasBtn")?.addEventListener("click", () => {
      projectLinesOpenMoveDialog();
    });
    window.projectLinesRenameCurrent = async (name) => {
      if (!projectLinesTarget || projectLinesTarget.draft || !projectLinesLocal()) return null;
      const clean = String(name || "").trim().slice(0, 48), target = projectLinesTarget;
      if (!clean) return false;
      try {
        await projectLinesJson(`/api/lines/projects/${encodeURIComponent(target.project)}/canvases/rename`, {
          path: target.source,
          title: clean,
        });
      } catch (error) {
        // If a brand-new loose Canvas was never written to disk yet, write it once and retry rename.
        if (projectLinesTarget === target && projectLinesCanSave()) {
          await projectLinesSave({ picture:false, quiet:false });
          await projectLinesJson(`/api/lines/projects/${encodeURIComponent(target.project)}/canvases/rename`, {
            path: target.source,
            title: clean,
          });
        } else throw error;
      }
      target.title = clean;
      if (projectLinesTarget !== target) return true;
      const nameLabel = document.querySelector("#canvasDocumentNameLabel");
      if (nameLabel) nameLabel.textContent = clean;
      state.currentSnapshotName = clean;
      state.currentSnapshotHasExplicitName = true;
      projectLinesShellTell({ title:clean, project:target.project, canvas:target.source });
      setStatus(t("canvasRenamed"));
      return true;
    };
    window.projectLinesNewFromMenu = () => {
      if (!projectLinesTarget || projectLinesTarget.draft || !projectLinesLocal()) return false;
      const target = projectLinesTarget;
      void (async () => {
        try {
          if (projectLinesCanSave() && !projectLinesNothingYet() && (projectLinesBehind().file || projectLinesBehind().picture)) {
            await projectLinesSave({ picture:true, quiet:false });
          }
          if (projectLinesTarget !== target) return;
          const originLine = projectLinesActiveLineSlug() || projectLinesTarget.originLine || "";
          const originLabel = originLine ? projectLinesLineDisplayName(originLine) : "";
          const created = await projectLinesJson(`/api/lines/projects/${encodeURIComponent(target.project)}/canvases`, { title:"" });
          if (projectLinesInShell) {
            // Another Canvas was opened while this one was being made: that is where you are.
            if (projectLinesTarget !== target) return;
            projectLinesShellTell({
              open:{
                project:target.project,
                source:created.source,
                title:created.title || "",
                originLine,
                originLabel,
                back:target.back || "",
              },
            });
            return;
          }
          const params = new URLSearchParams({
            linesProject: projectLinesTarget.project,
            linesCanvas: created.source,
          });
          if (created.title) params.set("linesTitle", created.title);
          if (originLine) {
            params.set("linesOriginLine", originLine);
            if (originLabel) params.set("linesOriginLabel", originLabel);
          }
          if (projectLinesTarget.back) params.set("linesBack", projectLinesTarget.back);
          projectLinesRun.ready = false;
          window.projectLinesCover?.show?.();
          location.assign(projectLinesAddress(`/index.html?${params.toString()}`));
        } catch (error) {
          setStatus(String(error?.message || error));
        }
      })();
      return true;
    };
    window.projectLinesOpenCanvasSettings = () => {
      if (!projectLinesTarget || projectLinesTarget.draft || !projectLinesLocal()) return false;
      projectLinesSettingsReturnUrl();
      projectLinesLeave("/projects.html#settings/canvas").catch(error => setStatus(String(error?.message || error)));
      return true;
    };
    window.projectLinesOpenCanvasAiSettings = () => {
      if (!projectLinesTarget || projectLinesTarget.draft || !projectLinesLocal()) return false;
      projectLinesSettingsReturnUrl();
      projectLinesLeave("/projects.html#agents/canvas").catch(error => setStatus(String(error?.message || error)));
      return true;
    };
    window.PenEchoOpenAppSettings = () => {
      if (projectLinesTarget && !projectLinesTarget.draft && projectLinesLocal()) {
        projectLinesSettingsReturnUrl();
        projectLinesLeave("/projects.html#agents/apps").catch(error => setStatus(String(error?.message || error)));
        return;
      }
      if (typeof window.PenEchoOpenSettingsPage === "function") window.PenEchoOpenSettingsPage("mcp");
      else { selectSettingsPage("mcp"); openSettings(); }
    };
    window.projectLinesDeleteFromMenu = async () => {
      if (!projectLinesTarget || projectLinesTarget.draft || !projectLinesLocal()) return false;
      const title = projectLinesTarget.title || document.querySelector("#canvasDocumentNameLabel")?.textContent?.trim() || (projectLinesZh() ? "此画布" : "this Canvas");
      const msg = projectLinesZh() ? `确定永久删除「${title}」吗？这不会删除工作线上的文字内容。` : `Delete "${title}" from this project?`;
      if (!window.confirm(msg)) return true;
      const target = projectLinesTarget;
      await projectLinesJson(`/api/lines/projects/${encodeURIComponent(target.project)}/canvases/delete`, {
        path: target.source,
      });
      // The Canvas opened since is not the one that was deleted.
      if (projectLinesTarget !== target) return true;
      projectLinesRemember(false);
      projectLinesRun.ready = false;
      if (projectLinesInShell) {
        await canvasDocumentsClose(projectLinesRun.documentId).catch(() => {});
        projectLinesPanelPause(true);
        projectLinesShellTell({ deleted:true, leave:projectLinesDestination() });
        return true;
      }
      location.assign(projectLinesAddress(projectLinesDestination()));
      return true;
    };
    document.getElementById("newCanvasBtn")?.addEventListener("click", event => {
      if (!projectLinesTarget || projectLinesTarget.draft || !projectLinesLocal()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      window.projectLinesNewFromMenu?.();
    }, true);
  }

  // ---------- The rail beside the Canvas ----------
  // One rail everywhere: search, My Canvases, the projects and their lines, Agent setup, the account. Beside a project's Canvas it is the Projects page
  // itself, drawn with only its rail (public/lines/embed.js, ?embed=rail), in a frame to the left. The frame is as large as the window, so the rail is
  // exactly as wide as on the Projects page, and only the rail's part of it shows until a menu or a dialog opened from it needs the whole window.
  // The Canvas's own sidebar is not shown here. A direct return to the originating line or Files stays in the header.
  const projectLinesRail = { element:null, frame:null, button:null, open:false, leaving:false };
  // The Projects page's own choice, so the rail is hidden or shown everywhere at once.
  const PROJECT_LINES_RAIL_HIDDEN_KEY = "penecho-lines-projects-hidden";
  // A Canvas opened only to draw something for the box has no rail: Done takes it back.
  function projectLinesHasRail() { return Boolean(projectLinesTarget && !projectLinesTarget.draft) && projectLinesLocal(); }
  // The Canvas's own sidebar asks this before it opens (studio-navigator.js).
  window.projectLinesRailed = projectLinesHasRail();
  const projectLinesNarrow = () => matchMedia("(max-width: 899px)").matches;
  function projectLinesRailAddress() {
    const { project, source, doc } = projectLinesTarget, line = (/^(?:lines|topics)\/([^/]+)\.md$/.exec(doc) || [])[1];
    return projectLinesAddress(`/projects.html?${new URLSearchParams({ embed:"rail", canvas:source })}#${encodeURIComponent(project)}${line ? `/line/${encodeURIComponent(line)}` : ""}`);
  }
  function projectLinesRailFrame() {
    const rail = projectLinesRail, frame = rail.frame = document.createElement("iframe");
    frame.title = rail.element.getAttribute("aria-label");
    frame.src = projectLinesRailAddress();
    rail.element.replaceChildren(frame);
  }
  function projectLinesRailShow(open, { remember = true } = {}) {
    const rail = projectLinesRail;
    if (!rail.element) return;
    rail.open = open;
    const hadFocus = rail.element.contains(document.activeElement);
    // Hidden, the rail is gone: nothing of it runs beside the drawing.
    if (open && !rail.frame) projectLinesRailFrame();
    if (!open) { rail.frame = null; rail.element.replaceChildren(); rail.element.classList.remove("over"); }
    rail.element.hidden = !open;
    document.documentElement.classList.toggle("project-lines-rail-open", open);
    rail.button.hidden = open;
    rail.button.setAttribute("aria-expanded", String(open));
    if (!open && hadFocus) rail.button.focus({ preventScroll:true });
    // A narrow window starts without the rail every time, so what you choose there is for this visit.
    if (remember && !projectLinesNarrow()) try { localStorage.setItem(PROJECT_LINES_RAIL_HIDDEN_KEY, open ? "0" : "1"); } catch { /* It only forgets whether the rail was hidden. */ }
  }
  function projectLinesShellSyncUi({ railHidden, fullscreen } = {}) {
    if (!projectLinesInShell) return;
    const root = document.documentElement;
    if (typeof railHidden === "boolean") {
      root.classList.toggle("shell-rail-hidden", railHidden);
      if (projectLinesRail.button) {
        projectLinesRail.button.hidden = !railHidden || Boolean(projectLinesTarget?.draft);
        projectLinesRail.button.setAttribute("aria-expanded", String(!railHidden));
      }
    }
    if (typeof fullscreen === "boolean") {
      root.classList.toggle("is-desktop-fullscreen", fullscreen);
    }
  }
  function projectLinesRailLabels() {
    const { button, element } = projectLinesRail, zh = projectLinesZh();
    if (!button) return;
    button.title = zh ? "显示项目" : "Show projects"; button.setAttribute("aria-label", button.title);
    if (!element) return;
    element.setAttribute("aria-label", zh ? "项目" : "Projects");
    if (projectLinesRail.frame) projectLinesRail.frame.title = element.getAttribute("aria-label");
  }
  function projectLinesBindRail() {
    const toggle = document.querySelector("#studioNavigatorToggle"), root = document.documentElement;
    if (projectLinesInShell) {
      // The parent persistent shell already renders the real sidebar (#rail); never spawn a duplicate ?embed=rail iframe.
      window.projectLinesRailed = Boolean(projectLinesTarget && !projectLinesTarget.draft) && projectLinesLocal();
      root.classList.toggle("project-lines-railed", window.projectLinesRailed);
      root.classList.remove("project-lines-rail-open");
      if (toggle && !projectLinesRail.button) {
        const button = projectLinesRail.button = document.createElement("button");
        button.id = "projectLinesRailShow"; button.type = "button"; button.className = "studio-navigator-toggle project-lines-rail-show";
        button.dataset.peButton = "toolbar"; button.dataset.peDensity = "compact";
        projectLinesRailLabels();
        button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4" width="17" height="16" rx="2"/><path d="M9 4v16"/></svg>`;
        button.addEventListener("click", () => projectLinesShellTell({ showRail:true }));
        toggle.after(button);
      }
      projectLinesShellSyncUi({ railHidden:root.classList.contains("shell-rail-hidden") });
      return window.projectLinesRailed;
    }
    if (projectLinesRail.element) return true;
    // Without it the page is as it was: its own sidebar, and its link back to the project.
    if (!projectLinesHasRail() || !toggle) { window.projectLinesRailed = false; root.classList.remove("project-lines-railed", "project-lines-rail-open"); return false; }
    const zh = projectLinesZh(), rail = projectLinesRail;
    root.classList.add("project-lines-railed");
    const element = rail.element = document.createElement("aside");
    element.id = "projectLinesRail"; element.className = "project-lines-rail";
    element.setAttribute("aria-label", zh ? "项目" : "Projects");
    document.body.append(element);
    // Where the Canvas's own sidebar button was, and where the Projects page brings its rail back from.
    const button = rail.button = document.createElement("button");
    button.id = "projectLinesRailShow"; button.type = "button"; button.className = "studio-navigator-toggle project-lines-rail-show";
    button.dataset.peButton = "toolbar"; button.dataset.peDensity = "compact";
    button.setAttribute("aria-controls", "projectLinesRail");
    button.title = zh ? "显示项目" : "Show projects"; button.setAttribute("aria-label", button.title);
    button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4" width="17" height="16" rx="2"/><path d="M9 4v16"/></svg>`;
    button.addEventListener("click", () => projectLinesRailShow(true));
    toggle.after(button);
    addEventListener("message", event => {
      const said = event.data;
      if (event.origin !== location.origin || !rail.frame || event.source !== rail.frame.contentWindow || said?.source !== "penecho-lines-rail") return;
      if (Number.isFinite(said.width) && said.width >= 40 && said.width <= 480) root.style.setProperty("--project-lines-rail-width", `${Math.round(said.width)}px`);
      if (said.hide === true) projectLinesRailShow(false);
      if (typeof said.over === "boolean") element.classList.toggle("over", said.over);
      if (typeof said.say === "string" && said.say) setStatus(said.say.slice(0, 300));
      // Anywhere the rail leads is a whole page: the Canvas is saved, then it opens.
      if (typeof said.leave === "string" && said.leave.startsWith("/") && !said.leave.startsWith("//") && !rail.leaving) {
        rail.leaving = true;
        if (projectLinesIsSettingsLeave(said.leave)) projectLinesSettingsReturnUrl();
        projectLinesLeave(said.leave).catch(error => {
          rail.leaving = false;
          setStatus(String(error.message || error));
          // The rail had already turned to where it was going.
          if (rail.open) projectLinesRailFrame();
        });
      }
    });
    let hidden = projectLinesNarrow();
    if (!hidden) try { hidden = localStorage.getItem(PROJECT_LINES_RAIL_HIDDEN_KEY) === "1"; } catch { /* It starts shown. */ }
    projectLinesRailShow(!hidden, { remember:false });
    // Back to a page that had already left starts it again, with its Canvas open and its rail alive.
    addEventListener("pageshow", event => { if (event.persisted && rail.leaving) location.reload(); });
    return true;
  }

  // ---------- PenEcho opened by itself ----------
  // The Canvas page opened with nothing in its address, in the local app, starts on a new, blank Canvas in My Canvases: it has the rail,
  // and it is kept in My Canvases from its first stroke. Only when the Projects pages are on this server, and only when this browser keeps
  // nothing of the plain Canvas: no draft, no open document, no chat. Anything else, and the page stays exactly as it always was.
  const PROJECT_LINES_DOCS_KEY = "penecho-lines-docs", PROJECT_LINES_BLANK_KEY = "penecho-lines-blank";
  const projectLinesAlone = window.projectLinesAlone === true && !projectLinesTarget && projectLinesLocal();
  // Whether the opening stays on the Canvas welcome or continues to Projects.
  // What greets you on a Canvas waits for it (maybeStartOnboarding in core.js): the Canvas this page lands on does the greeting.
  let projectLinesStayed = projectLinesAlone ? null : true, projectLinesStays = null;
  const projectLinesStaying = projectLinesAlone ? new Promise(resolve => { projectLinesStays = resolve; }) : Promise.resolve(true);
  function projectLinesKnownDocs() {
    try { const list = JSON.parse(localStorage.getItem(PROJECT_LINES_DOCS_KEY) || "[]"); return Array.isArray(list) ? list.filter(id => typeof id === "string") : []; } catch { return []; }
  }
  // The copy this browser holds of a project's Canvas is only its working copy: the Canvas itself is in the project's folder.
  function projectLinesRememberDoc(id) {
    try { localStorage.setItem(PROJECT_LINES_DOCS_KEY, JSON.stringify([id, ...projectLinesKnownDocs().filter(known => known !== id)].slice(0, 300))); } catch { /* It is then taken for a draft, and the page stays as it was. */ }
  }
  function projectLinesKeptInProject(doc, known) {
    if (known.has(doc.id) || /^lines-/.test(String(doc.stored?.item?.id || ""))) return true;
    try { return localStorage.getItem(`penecho-lines-unsaved:${doc.id}`) !== null; } catch { return false; }
  }
  function projectLinesWorkingOnCanvas() {
    return canvasDocumentsDraftBusy() || mcpRuntime.wanted || mcpRuntime.socket || mcpRuntime.sessions.size ||
      typeof canvasAgent !== "undefined" && (canvasAgent.running || canvasAgent.requestPending);
  }
  function projectLinesNothingKept() {
    if (!canvasDocumentsDraft.ready || canvasDocumentsDraftHasContent() || projectLinesWorkingOnCanvas() || state.currentSnapshotId || state.currentSnapshotName) return false;
    if (typeof canvasAgent !== "undefined" && canvasAgent.currentConversation?.items?.length) return false;
    const known = new Set(projectLinesKnownDocs());
    for (const doc of canvasDocuments.records.values()) {
      if (canvasDocumentsIsActive(doc)) { if (doc.stored && !canvasDocumentsIsEmptyPlaceholder(doc) || doc.locator || doc.savedAt || doc.hasUserHistory || doc.agentDraft) return false; }
      else if (!projectLinesKeptInProject(doc, known)) return false;
    }
    return true;
  }
  async function projectLinesJson(path, body) {
    const response = await projectLinesFetch(path, { method:body ? "POST" : "GET", credentials:"same-origin", headers:{ accept:"application/json", ...(body ? { "content-type":"application/json" } : {}) }, ...(body ? { body:JSON.stringify(body) } : {}) });
    if (!response.ok) throw Error(`HTTP ${response.status}`);
    return response.json();
  }
  // The address of a new, blank Canvas in My Canvases. One made earlier that nothing was ever drawn on is used again, so opening PenEcho leaves no empty folders behind.
  async function projectLinesBlankCanvas() {
    let blank = null;
    try { blank = JSON.parse(localStorage.getItem(PROJECT_LINES_BLANK_KEY) || "null"); } catch { /* A new one is made. */ }
    // The Canvas open here is never "the new one", even while nothing of it has reached its folder yet.
    if (blank && projectLinesTarget && blank.project === projectLinesTarget.project && blank.source === projectLinesTarget.source) blank = null;
    if (blank && typeof blank.project === "string" && typeof blank.source === "string") {
      const info = await projectLinesJson(`/api/lines/projects/${encodeURIComponent(blank.project)}/canvas?${new URLSearchParams({ path:blank.source })}`).catch(() => null);
      if (!info || info.exists !== false) blank = null;
    } else blank = null;
    if (!blank) {
      const mine = (await projectLinesJson("/api/lines/my-canvases", {})).project;
      if (!mine?.id) throw Error("My Canvases was not made.");
      const held = await projectLinesJson(`/api/lines/projects/${encodeURIComponent(mine.id)}/state`).catch(() => null), n = (Array.isArray(held?.pictures) ? held.pictures.length : 0) + 1;
      const made = await projectLinesJson(`/api/lines/projects/${encodeURIComponent(mine.id)}/canvases`, { title:projectLinesZh() ? `画布 ${n}` : `Canvas ${n}` });
      if (!made?.source) throw Error("The Canvas was not made.");
      blank = { project:mine.id, source:made.source, title:made.title || "" };
      try { localStorage.setItem(PROJECT_LINES_BLANK_KEY, JSON.stringify(blank)); } catch { /* The next time simply makes another. */ }
    }
    return `/?${new URLSearchParams({ linesProject:blank.project, linesCanvas:blank.source, linesTitle:blank.title, linesBack:blank.project })}`;
  }
  // An example that needs a line, from a page that has none to give it: a new Canvas in My Canvases, opened in this tab.
  async function projectLinesDrawOnCanvas(button = null, extra = {}) {
    if (button) button.disabled = true;
    try {
      const address = await projectLinesBlankCanvas(), query = new URLSearchParams(extra), to = query.size ? `${address}&${query}` : address;
      // A project's Canvas is saved before the page goes.
      if (projectLinesTarget) await projectLinesLeave(to); else location.assign(to);
    } catch (error) {
      if (button) button.disabled = false;
      setStatus(String(error?.message || error));
    }
  }
  async function projectLinesStartAlone() {
    const opening = window.PenEchoOpening, desktopLaunch = opening?.desktopLaunch;
    const startingUrl = location.href, startingCommit = canvasDocumentsDraft.commitVersion;
    let address = "";
    try {
      const listed = await (window.projectLinesFirstAnswer || window.projectLinesFirstList);
      if (listed && Array.isArray(listed.projects)) {
        const own = listed.projects.some(p => !p.example && !p.myCanvases && !p.archived);
        if (desktopLaunch) {
          // Stored Canvas recovery stays available, independently of the desktop's starting page.
          if (own) address = `/projects.html?${new URLSearchParams({ desktopLaunch })}`;
        } else {
          await canvasDocumentsStartDraft(true);
          if (own && projectLinesNothingKept()) address = "/projects.html";
        }
      }
    } catch { address = ""; }
    // A slow project list or opening can finish after the user has started working on this Canvas.
    if (address) {
      await opening?.settled();
      if (desktopLaunch && (location.href !== startingUrl || !window.projectLinesWelcomeOpen ||
          canvasDocumentsDraft.commitVersion !== startingCommit || projectLinesWorkingOnCanvas())) address = "";
    }
    projectLinesStayed = !address;
    projectLinesStays(projectLinesStayed);
    if (address) location.replace(address);
    else {
      window.projectLinesCover?.lift();
      if (desktopLaunch) opening.ready();
    }
  }
  if (projectLinesAlone) {
    // A tab that last showed a project's Canvas does not bring its working copy back as a plain Canvas: that Canvas is in its folder.
    try { const key = canvasDocumentsDraftStorageKey(), last = sessionStorage.getItem(key); if (last && projectLinesKnownDocs().includes(last)) sessionStorage.removeItem(key); } catch { /* It is then taken for a draft, and the page stays as it was. */ }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => { void projectLinesStartAlone(); }, { once:true });
    else void projectLinesStartAlone();
  }

  function projectLinesSyncLinks(railed) {
    const links = [...document.querySelectorAll("[data-project-lines-link]")];
    const destination = projectLinesDestination();
    const toFiles = /\/(files|canvases)$/.test(projectLinesTarget?.back || "");
    const toLine = /\/line\/[^/]+(?:\/[^/]+)?$/.test(projectLinesTarget?.back || "");
    for (const link of links) {
      link.href = destination;
      // Keep a one-activation return to the line (and selected Work), even with the rail open.
      link.hidden = railed && !toFiles && !toLine;
      const svg = link.querySelector("svg");
      if (svg) svg.innerHTML = (toFiles || toLine) ? '<path d="M15 6l-6 6 6 6"/>' : '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>';
      link.classList.toggle("project-lines-back", Boolean(toLine && !projectLinesTarget?.draft));
      if (toLine && !projectLinesTarget?.draft && link.parentElement?.firstElementChild !== link) {
        link.parentElement.prepend(link);
      }
      const label = projectLinesTarget?.draft ? (projectLinesZh() ? "完成" : "Done") : toLine ? (projectLinesZh() ? "返回工作线" : "Back to line") : toFiles ? (projectLinesZh() ? "返回" : "Back") : projectLinesTarget ? (projectLinesZh() ? "返回项目" : "Back to project") : projectLinesZh() ? "项目" : "Projects";
      const labelEl = link.querySelector("[data-project-lines-label]");
      if (labelEl) labelEl.textContent = label;
      link.setAttribute("aria-label", label);
      link.title = label;
      if (!projectLinesLinksBound) {
        link.addEventListener("click", event => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          projectLinesLeave(projectLinesDestination()).catch(error => setStatus(String(error.message || error)));
        });
      }
    }
    projectLinesLinksBound = true;
  }

  // The language was changed while the Canvas is open: what is written here from code is written again.
  window.addEventListener("penecho:languagechange", () => {
    if (!projectLinesLinksBound || !projectLinesLocal()) return;
    projectLinesSyncLinks(Boolean(window.projectLinesRailed));
    if (!projectLinesTarget) return;
    projectLinesSyncMoreMenu();
    projectLinesRenderBreadcrumb();
    projectLinesRenderContextStrip();
    projectLinesPanelLabels();
    projectLinesRailLabels();
    projectLinesShowSaved();
  });

  function projectLinesSwitchTarget(next, requestId = "") {
    if (!projectLinesInShell || !next?.project || !next?.source) return;
    void projectLinesTurn(stop => projectLinesSwitch(next, requestId, stop)).catch(error => setStatus(String(error?.message || error)));
  }
  async function projectLinesSwitch(next, requestId, stop) {
    // The Canvas in front is saved before another takes its place. When it cannot be, it stays.
    try { await projectLinesFlushAndDeactivate({ showCover:false }); }
    catch (error) { if (!stop.aborted) projectLinesTellStayed(error, requestId); return; }
    if (stop.aborted) return;
    document.querySelectorAll("#projectLinesElsewhere, .project-lines-error").forEach(el => el.remove());
    projectLinesTarget = {
      project:String(next.project),
      source:String(next.source),
      doc:String(next.doc || ""),
      title:String(next.title || ""),
      summary:String(next.summary || ""),
      back:String(next.back || ""),
      seed:String(next.seed || ""),
      draft:Boolean(next.draft),
      originLine:String(next.originLine || ""),
      originLabel:String(next.originLabel || ""),
      first:false,
      fresh:next.fresh === true,
      picture:next.picture?.blob ? next.picture : null,
    };
    const nextUrl = new URL("/index.html", location.origin);
    nextUrl.searchParams.set("shell", "1");
    nextUrl.searchParams.set("linesProject", projectLinesTarget.project);
    nextUrl.searchParams.set("linesCanvas", projectLinesTarget.source);
    if (projectLinesTarget.doc) nextUrl.searchParams.set("linesDoc", projectLinesTarget.doc);
    if (projectLinesTarget.title) nextUrl.searchParams.set("linesTitle", projectLinesTarget.title);
    if (projectLinesTarget.summary) nextUrl.searchParams.set("linesSummary", projectLinesTarget.summary);
    if (projectLinesTarget.back) nextUrl.searchParams.set("linesBack", projectLinesTarget.back);
    if (projectLinesTarget.seed) nextUrl.searchParams.set("linesSeed", projectLinesTarget.seed);
    if (projectLinesTarget.draft) nextUrl.searchParams.set("linesDraft", "1");
    if (projectLinesTarget.originLine) nextUrl.searchParams.set("linesOriginLine", projectLinesTarget.originLine);
    if (projectLinesTarget.originLabel) nextUrl.searchParams.set("linesOriginLabel", projectLinesTarget.originLabel);
    try { history.replaceState(history.state, "", nextUrl); } catch {}
    projectLinesRun = projectLinesNewRun();
    Object.assign(projectLinesMeta, { loaded:false, loading:null, projectTitle:"", lineTitle:"", topics:[] });
    Object.assign(projectLinesStripState, { attachedLine:"", attachedLabel:"", attachedStep:null, error:"", busy:false });
    document.body.classList.toggle("project-lines-draft", Boolean(projectLinesTarget.draft));
    document.body.classList.add("project-lines-canvas");
    const railed = projectLinesBindRail();
    projectLinesSyncLinks(railed);
    projectLinesSyncMoreMenu();
    projectLinesRenderBreadcrumb();
    projectLinesRenderContextStrip();
    projectLinesBindMenuActions();
    if (!projectLinesTarget.draft) void projectLinesEnsureMeta();
    try {
      await projectLinesOpen(stop);
      projectLinesBindSaveLabel();
      projectLinesWatchInput();
      if (!projectLinesIntervalsWired) {
        projectLinesIntervalsWired = true;
        setInterval(projectLinesAutosave, PROJECT_LINES_CHECK_MS);
        setInterval(projectLinesPull, projectLinesHost ? 15000 : PROJECT_LINES_PULL_MS);
      }
      if (projectLinesTarget.draft) {
        if (projectLinesPanel.button) projectLinesPanel.button.hidden = true;
        if (projectLinesPanel.element) projectLinesPanelShow(false);
        projectLinesPanelPause(true);
      } else {
        if (!projectLinesPanel.element) {
          projectLinesBindPanel();
        } else {
          if (projectLinesPanel.button) projectLinesPanel.button.hidden = false;
          projectLinesReloadPanel();
          projectLinesPanelShow(!matchMedia("(max-width: 900px)").matches);
        }
      }
      projectLinesRenderContextStrip();
    } catch (error) {
      if (stop.aborted) return;
      const banner = document.createElement("div"), message = document.createElement("span"), back = document.createElement("a"), retry = document.createElement("button");
      banner.className = "project-lines-error"; banner.setAttribute("role", "alert");
      message.textContent = `${projectLinesZh() ? "项目画布未打开：" : "This project Canvas did not open: "}${error.message}`;
      back.textContent = projectLinesZh() ? "返回项目" : "Back to project"; back.href = projectLinesDestination();
      back.addEventListener("click", event => { event.preventDefault(); void projectLinesLeave(projectLinesDestination()); });
      retry.textContent = projectLinesZh() ? "重试" : "Try again"; retry.type = "button"; retry.onclick = () => projectLinesSwitchTarget(projectLinesTarget, requestId);
      banner.append(message, back, retry); document.body.append(banner); setStatus(message.textContent);
    } finally {
      if (!stop.aborted) projectLinesShellTell({ ready:true, requestId, landing:projectLinesLanding(), project:projectLinesTarget.project, canvas:projectLinesTarget.source, line:projectLinesActiveLineSlug() });
    }
  }

  let projectLinesShellListenerBound = false;
  function projectLinesBindShellHost() {
    if (!projectLinesInShell || projectLinesShellListenerBound) return;
    projectLinesShellListenerBound = true;
    addEventListener("message", event => {
      if (event.origin !== location.origin || event.source !== window.parent) return;
      const msg = event.data;
      if (!msg || msg.source !== "penecho-shell") return;
      if (msg.action === "shell-ui") {
        projectLinesShellSyncUi(msg);
        return;
      }
      if (msg.action === "leave") {
        const requestId = msg.requestId || "";
        // Leaving waits for the save, and stops when it fails. A newer turn that came first answers for itself.
        void projectLinesTurn(async () => { await projectLinesFlushAndDeactivate({ showCover:false }); return true; })
          .then(left => projectLinesShellTell({ left:left === true, requestId }), error => projectLinesTellStayed(error, requestId));
        return;
      }
      if (msg.action === "open" && msg.target) {
        projectLinesShellSyncUi(msg);
        window.projectLinesWaiting = false;
        projectLinesSwitchTarget({ ...msg.target, fresh:msg.handed?.fresh === true, picture:msg.handed?.picture || null }, msg.requestId || "");
        // Opening a Canvas was once a new page, which read the settings afresh.
        applySettingsFromStorage();
        return;
      }
      // The picture this Canvas was handed is in the folder now: loaded again, the page finds it there.
      if (msg.action === "picture-saved" && projectLinesTarget?.project === msg.project && projectLinesTarget.source === msg.canvas && typeof msg.path === "string") {
        projectLinesTarget.seed = msg.path;
        const here = new URL(location.href);
        here.searchParams.set("linesSeed", msg.path);
        try { history.replaceState(history.state, "", here); } catch {}
        return;
      }
      if (msg.action === "sync-settings") applySettingsFromStorage();
    });
    // Loaded again ("Open the saved one", a sign-in), this page cannot answer until it has started. What it says on its way out
    // can be lost with it, so the new one says it too.
    addEventListener("pagehide", event => { if (!event.persisted) projectLinesShellTell({ gone:true }); });
    projectLinesShellTell({ gone:true });
  }

  async function projectLinesStart() {
    projectLinesBindShellHost();
    const links = [...document.querySelectorAll("[data-project-lines-link]")];
    // Opened to draw on, so a blank Canvas is only a blank Canvas.
    if (projectLinesTarget?.draft) document.body.classList.add("project-lines-draft");
    // A Canvas that belongs to a project has its line beside it, where the Agent was.
    if (projectLinesTarget) document.body.classList.add("project-lines-canvas");
    // Opened on its own, not to draw something for a project: PenEcho Lines comes first. So it does on a first open.
    window.projectLinesWelcomeOpen = (!projectLinesTarget || projectLinesTarget.first) && projectLinesLocal();
    window.projectLinesWelcomeSync?.();
    if (window.projectLinesWelcomeOpen && !state.viewMode && state.mode === "pen") resetCanvasDefaultMode();
    void projectLinesRenderEntry();
    projectLinesBindDrawing();
    if (!projectLinesLocal()) { links.forEach(link => { link.hidden = true; }); window.projectLinesCover?.lift(); return; }
    // The rail is there from the start, so there is a way out even when the Canvas does not open.
    const railed = projectLinesBindRail();
    projectLinesSyncLinks(railed);
    if (!projectLinesTarget) return;
    if (projectLinesTarget.warm) {
      await projectLinesTurn(() => canvasDocumentsStartDraft(false)).catch(() => {});
      projectLinesShellTell({ ready:true, warm:true, project:"", canvas:"" });
      return;
    }
    projectLinesSyncMoreMenu();
    projectLinesRenderBreadcrumb();
    projectLinesRenderContextStrip();
    projectLinesBindMenuActions();
    if (!projectLinesTarget.draft) void projectLinesEnsureMeta();
    let stopped = null;
    try {
      await projectLinesTurn(stop => { stopped = stop; return projectLinesOpen(stop); });
      projectLinesBindSaveLabel();
      projectLinesWatchInput();
      if (!projectLinesIntervalsWired) {
        projectLinesIntervalsWired = true;
        setInterval(projectLinesAutosave, PROJECT_LINES_CHECK_MS);
        setInterval(projectLinesPull, projectLinesHost ? 15000 : PROJECT_LINES_PULL_MS);
      }
      projectLinesBindPanel();
      projectLinesRenderContextStrip();
      // Opened to try an example (one that needs a line, from a page that had none): it opens here, once.
      const example = new URLSearchParams(location.search).get("linesExample");
      if (example) {
        const address = new URL(location.href);
        address.searchParams.delete("linesExample");
        history.replaceState(history.state, "", address);
        requestAnimationFrame(() => { void window.PenEchoExamples?.open(example, { here:true }); });
      }
    } catch (error) {
      if (stopped?.aborted) return;
      const banner = document.createElement("div"), message = document.createElement("span"), back = document.createElement("a"), retry = document.createElement("button");
      banner.className = "project-lines-error"; banner.setAttribute("role", "alert");
      message.textContent = `${projectLinesZh() ? "项目画布未打开：" : "This project Canvas did not open: "}${error.message}`;
      back.textContent = projectLinesZh() ? "返回项目" : "Back to project"; back.href = projectLinesDestination();
      if (projectLinesInShell) back.addEventListener("click", event => { event.preventDefault(); void projectLinesLeave(projectLinesDestination()); });
      retry.textContent = projectLinesZh() ? "重试" : "Try again"; retry.type = "button"; retry.onclick = () => (projectLinesInShell ? projectLinesSwitchTarget(projectLinesTarget) : location.reload());
      banner.append(message, back, retry); document.body.append(banner); setStatus(message.textContent);
    } finally {
      window.projectLinesCover?.lift(projectLinesLanding());
      projectLinesShellTell({ ready:true, landing:projectLinesLanding(), project:projectLinesTarget?.project || "", canvas:projectLinesTarget?.source || "", line:projectLinesActiveLineSlug() });
    }
  }
  // Editing a picture needs the initialized editor, not every preview image or
  // the Projects iframe's load event. Those may take much longer than this Canvas.
  if (projectLinesTarget && projectLinesLocal()) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => { void projectLinesStart(); }, { once:true });
    else queueMicrotask(() => { void projectLinesStart(); });
  } else window.addEventListener("load", () => { void projectLinesStart(); }, { once:true });
  // The rail comes with the page, not once every picture on it has loaded: it is beside the Canvas from the first moment, as on the Projects page.
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => { projectLinesBindRail(); }, { once:true });
  else projectLinesBindRail();
  // PenEcho Lines is drawn as soon as the page is there, not once every picture has loaded.
  if (document.documentElement.classList.contains("pls-first")) document.addEventListener("DOMContentLoaded", () => { void projectLinesRenderEntry(); }, { once:true });
