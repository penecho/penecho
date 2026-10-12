  // Example canvases teach one feature each: a fresh canvas with handwritten
  // ink, the suggestion to tap highlighted, and a short note on what it does.
  const EXAMPLES = window.PENECHO_EXAMPLE_SCENARIOS || null,
    EXAMPLE_INK = window.PENECHO_EXAMPLE_INK || null,
    EXAMPLES_STORAGE_KEY = "penecho-examples-v1",
    EXAMPLE_RESULT_TIMEOUT_MS = 180000,
    EXAMPLE_WELCOME_COUNT = 4;
  const exampleCanvases = { progress:null, session:null, opening:false, coachTimer:0, watchTimer:0, doneTimer:0, coachHidden:false, previews:new Map() };
  const exampleWelcome = document.querySelector("#canvasWelcomeExamples"),
    exampleWelcomeTitle = document.querySelector("#canvasWelcomeExamplesTitle"),
    exampleWelcomeProgress = document.querySelector("#canvasWelcomeExamplesProgress"),
    exampleWelcomeAll = document.querySelector("#canvasWelcomeExamplesAll"),
    exampleWelcomeGoals = document.querySelector("#canvasWelcomeGoals"),
    exampleWelcomeList = document.querySelector("#canvasWelcomeExampleList"),
    examplesDialog = document.querySelector("#examplesDialog"),
    examplesDialogTitle = document.querySelector("#examplesDialogTitle"),
    examplesDialogDescription = document.querySelector("#examplesDialogDescription"),
    examplesDialogProgress = document.querySelector("#examplesDialogProgress"),
    examplesDialogMeter = document.querySelector("#examplesDialogMeter"),
    examplesDialogGoals = document.querySelector("#examplesDialogGoals"),
    examplesDialogList = document.querySelector("#examplesDialogList"),
    examplesDialogClose = document.querySelector("#examplesDialogClose"),
    exampleCoach = document.querySelector("#exampleCoach"),
    exampleCoachKicker = document.querySelector("#exampleCoachKicker"),
    exampleCoachTitle = document.querySelector("#exampleCoachTitle"),
    exampleCoachBody = document.querySelector("#exampleCoachBody"),
    exampleCoachTip = document.querySelector("#exampleCoachTip"),
    exampleCoachAll = document.querySelector("#exampleCoachAll"),
    exampleCoachHide = document.querySelector("#exampleCoachHide"),
    exampleCoachSetup = document.querySelector("#exampleCoachSetup"),
    exampleDone = document.querySelector("#exampleDone"),
    exampleDoneTitle = document.querySelector("#exampleDoneTitle"),
    exampleDoneBody = document.querySelector("#exampleDoneBody"),
    exampleDoneNext = document.querySelector("#exampleDoneNext"),
    exampleDoneOwn = document.querySelector("#exampleDoneOwn"),
    exampleDoneClose = document.querySelector("#exampleDoneClose");

  function exampleCopy(en, zh) { return state.language === "zh" ? zh : en; }
  function exampleText(value) { return EXAMPLES ? EXAMPLES.localized(value, state.language) : ""; }
  function examplesAvailable() {
    const config = window.PENECHO_CONFIG || {};
    return Boolean(EXAMPLES && EXAMPLE_INK) && config.runtime !== "viewer" && !config.guestCanvas && !CANVAS_COMPANION_REQUESTED;
  }
  function exampleGoalLabel(goal) {
    return {
      study:exampleCopy("Studying", "学习"),
      code:exampleCopy("Coding", "编程"),
      work:exampleCopy("Working", "工作"),
      play:exampleCopy("Playing", "娱乐"),
    }[goal] || "";
  }
  function exampleRouteLabel(route) {
    return {
      instant:exampleCopy("Instant", "即时"),
      ai:exampleCopy("Uses AI", "使用 AI"),
      agent:"PenEcho Agent",
    }[route] || "";
  }
  function exampleFeatureLabel(feature) {
    return {
      functions:exampleCopy("Functions", "函数"),
      "3d":exampleCopy("3D visual", "立体可视化"),
      proof:exampleCopy("Check your work", "检查推导"),
      drawing:exampleCopy("2D drawing", "平面绘画"),
      visual:exampleCopy("Draw visual", "绘制视觉"),
      animation:exampleCopy("Animation", "动画"),
      diagram:exampleCopy("Diagrams", "图表"),
      explorer:"Visual Explorer",
      agent:"PenEcho Agent",
      cards:exampleCopy("Knowledge cards", "知识卡片"),
      notes:exampleCopy("Notes", "笔记"),
      homework:exampleCopy("Homework", "作业"),
      code:exampleCopy("Code review", "代码检查"),
      prototype:exampleCopy("Prototype", "原型"),
      plan:exampleCopy("Plan", "计划"),
      data:exampleCopy("Data", "数据"),
      game:exampleCopy("Mini game", "小游戏"),
    }[feature] || "";
  }

  function exampleProgress() {
    if (exampleCanvases.progress) return exampleCanvases.progress;
    let raw = null;
    try { raw = localStorage.getItem(EXAMPLES_STORAGE_KEY); } catch {}
    exampleCanvases.progress = EXAMPLES ? EXAMPLES.parseProgress(raw) : null;
    return exampleCanvases.progress;
  }
  function exampleSaveProgress(progress) {
    exampleCanvases.progress = EXAMPLES.parseProgress(progress);
    try { localStorage.setItem(EXAMPLES_STORAGE_KEY, EXAMPLES.serializeProgress(exampleCanvases.progress)); } catch {}
    renderExamples();
  }
  function exampleTriedCount() { return exampleProgress()?.tried.length || 0; }
  function exampleProgressText() {
    const total = EXAMPLES?.SCENARIOS.length || 0, tried = exampleTriedCount();
    return exampleCopy(`${tried} of ${total} tried`, `已体验 ${tried}/${total}`);
  }
  function exampleNextUntried(afterId) {
    const tried = new Set(exampleProgress()?.tried || []), list = EXAMPLES.ordered(exampleProgress()?.goal),
      start = Math.max(0, list.findIndex(scenario => scenario.id === afterId) + 1);
    return [...list.slice(start), ...list.slice(0, start)].find(scenario => !tried.has(scenario.id) && scenario.id !== afterId) || null;
  }

  // A small drawing of the example's own ink, so each card shows what you get to try.
  function examplePreview(scenario) {
    if (scenario.image) {
      const image = document.createElement("img");
      image.src = scenario.image.src;
      image.alt = "";
      image.decoding = "async";
      return image;
    }
    let markup = exampleCanvases.previews.get(scenario.id);
    if (!markup) {
      const strokes = EXAMPLES.strokes(scenario.id), box = EXAMPLE_INK.bounds(strokes),
        pad = Math.max(box.width, box.height) * 0.06 + 4;
      markup = { viewBox:`${-pad} ${-pad} ${box.width + pad * 2} ${box.height + pad * 2}`, points:strokes.map(stroke => stroke.map(point => `${point.x},${point.y}`).join(" ")) };
      exampleCanvases.previews.set(scenario.id, markup);
    }
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", markup.viewBox);
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    for (const points of markup.points) {
      const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
      line.setAttribute("points", points);
      line.setAttribute("vector-effect", "non-scaling-stroke");
      svg.append(line);
    }
    return svg;
  }
  function exampleCard(scenario, options = {}) {
    const tried = exampleProgress()?.tried.includes(scenario.id),
      button = document.createElement("button"),
      preview = document.createElement("span"),
      copy = document.createElement("span"),
      meta = document.createElement("small"),
      title = document.createElement("strong"),
      description = document.createElement("span");
    button.type = "button";
    button.className = "example-card";
    button.dataset.exampleId = scenario.id;
    button.dataset.tried = tried ? "true" : "false";
    preview.className = "example-card-preview";
    preview.append(examplePreview(scenario));
    copy.className = "example-card-copy";
    title.textContent = exampleText(scenario.title);
    description.textContent = exampleText(scenario.description);
    meta.className = "example-card-meta";
    const feature = exampleFeatureLabel(scenario.feature), route = exampleRouteLabel(scenario.route);
    meta.textContent = [options.numbered ? feature : "", options.numbered && route === feature ? "" : route, tried ? exampleCopy("Tried", "已体验") : exampleCopy(`About ${scenario.seconds} s`, `约 ${scenario.seconds} 秒`)].filter(Boolean).join(" · ");
    copy.append(title, description, meta);
    button.append(preview, copy);
    // A host that does not serve the example photo hides its card rather than
    // offering an example that cannot open.
    preview.querySelector("img")?.addEventListener("error", () => { button.hidden = true; }, { once:true });
    button.setAttribute("aria-label", `${exampleText(scenario.title)}. ${exampleText(scenario.description)} ${meta.textContent}`);
    return button;
  }
  function renderExampleGoals(host) {
    if (!host) return;
    const goal = exampleProgress()?.goal;
    host.replaceChildren(...EXAMPLES.GOALS.map(id => {
      const button = document.createElement("button");
      button.type = "button";
      peButton(button, "segment", "segment");
      button.dataset.exampleGoal = id;
      button.setAttribute("aria-pressed", goal === id ? "true" : "false");
      button.textContent = exampleGoalLabel(id);
      return button;
    }));
    host.setAttribute("aria-label", exampleCopy("What would you like to do first?", "你想先做什么？"));
  }
  function renderExampleWelcome() {
    if (!exampleWelcome) return;
    exampleWelcome.hidden = !examplesAvailable();
    if (exampleWelcome.hidden) return;
    const goal = exampleProgress()?.goal;
    exampleWelcomeTitle.textContent = goal ? exampleCopy(`Examples for ${exampleGoalLabel(goal).toLowerCase()}`, `${exampleGoalLabel(goal)}示例`) : exampleCopy("New here? Pick what you do, or try one of these", "第一次使用？选择你的场景，或先试试这些");
    exampleWelcomeProgress.textContent = exampleProgressText();
    exampleWelcomeAll.textContent = exampleCopy("All examples", "全部示例");
    renderExampleGoals(exampleWelcomeGoals);
    const progress = exampleProgress();
    exampleWelcomeList.replaceChildren(...EXAMPLES.welcome(progress?.goal, progress?.tried, EXAMPLE_WELCOME_COUNT).map(scenario => exampleCard(scenario)));
  }
  function renderExamplesDialog() {
    if (!examplesDialog || !EXAMPLES) return;
    const total = EXAMPLES.SCENARIOS.length;
    examplesDialogTitle.textContent = exampleCopy(`Learn PenEcho in ${total} tries`, `${total} 个示例，快速上手 PenEcho`);
    examplesDialogDescription.textContent = exampleCopy("Each example opens a ready canvas. Tap the highlighted suggestion and see the result. Most take under 30 seconds.", "每个示例都会打开一张准备好的画布。点击高亮的建议即可看到结果，大多不到 30 秒。");
    examplesDialogProgress.textContent = exampleProgressText();
    examplesDialogMeter.max = EXAMPLES.SCENARIOS.length;
    examplesDialogMeter.value = exampleTriedCount();
    examplesDialogClose.setAttribute("aria-label", exampleCopy("Close", "关闭"));
    examplesDialogClose.title = exampleCopy("Close", "关闭");
    renderExampleGoals(examplesDialogGoals);
    // One section per category; the chosen one first.
    const goal = exampleProgress()?.goal, goals = goal ? [goal, ...EXAMPLES.GOALS.filter(id => id !== goal)] : EXAMPLES.GOALS;
    examplesDialogList.replaceChildren(...goals.map(id => {
      const section = document.createElement("section"), heading = document.createElement("h3"), grid = document.createElement("div");
      section.className = "examples-dialog-group";
      section.dataset.exampleGroup = id;
      heading.textContent = exampleGoalLabel(id);
      grid.className = "examples-dialog-grid";
      grid.append(...EXAMPLES.ordered(id).map(scenario => exampleCard(scenario, { numbered:true })));
      section.append(heading, grid);
      return section;
    }));
  }
  function renderExampleEntries() {
    const available = examplesAvailable();
    for (const button of document.querySelectorAll("[data-open-examples]")) button.hidden = !available;
    for (const label of document.querySelectorAll('[data-example-label="examples"]')) label.textContent = exampleCopy("Examples", "示例");
    const progress = document.querySelector("#studioNavigatorExamplesProgress");
    if (progress) progress.textContent = `${exampleTriedCount()}/${EXAMPLES.SCENARIOS.length}`;
  }
  function renderExamples() {
    if (!EXAMPLES) return;
    renderExampleEntries();
    renderExampleWelcome();
    if (examplesDialog?.open) renderExamplesDialog();
    if (exampleCoach && !exampleCoach.hidden) renderExampleCoach();
  }
  function openExamplesDialog() {
    if (!examplesDialog || !examplesAvailable()) return;
    renderExamplesDialog();
    if (!examplesDialog.open) examplesDialog.showModal();
  }
  function closeExamplesDialog() {
    if (examplesDialog?.open) examplesDialog.close();
  }
  function chooseExampleGoal(goal) {
    exampleSaveProgress(EXAMPLES.setGoal(exampleProgress(), goal));
  }

  // Instant examples run locally. The others only teach anything when a model
  // produces the real result; without one, Notes would fall back to a card that
  // just holds the photo and the Agent would refuse.
  function exampleModelReady(scenario) {
    if (!scenario || scenario.route === "instant") return true;
    if (scenario.route === "agent" && typeof canvasAgentExecutionAvailable === "function" && !canvasAgentExecutionAvailable()) return false;
    return typeof hasSelectedAiConnection !== "function" || hasSelectedAiConnection();
  }
  function openExampleAiSetup() {
    closeExamplesDialog();
    if (!settings.open) openSettings();
    requestAnimationFrame(() => document.querySelector("#settingsNavConnections")?.click());
    setStatus(exampleCopy("Connect an AI model, then tap the highlighted step again.", "请先连接 AI 模型，再点击高亮的步骤。"));
  }
  function exampleSessionCurrent() {
    const session = exampleCanvases.session;
    return session && canvasDocumentsCurrent()?.id === session.documentId ? session : null;
  }
  function exampleCanvasIsEmpty() {
    return !tiles.size && !state.images.length && !state.textBoxes.length && !visibleWidgets().length && !state.currentSnapshotId;
  }
  function exampleBox(points) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const point of points) { minX = Math.min(minX, point.x); minY = Math.min(minY, point.y); maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y); }
    return { x:minX, y:minY, w:Math.max(1, maxX - minX), h:Math.max(1, maxY - minY) };
  }
  // Draws the example as real recorded strokes: one Undo step, ranked by Suggest
  // like handwriting, and available as vectors to Finish drawing and Animate sketch.
  function drawExampleInk(scenario, { suggest = true } = {}) {
    // Measure the canvas as it is now; panels may have resized it this frame.
    invalidateCanvasViewportMetrics();
    const strokes = EXAMPLES.strokes(scenario.id), box = EXAMPLE_INK.bounds(strokes),
      view = viewportRect() || { x:SIZE / 2 - 800, y:SIZE / 2 - 500, w:1600, h:1000 },
      scale = Math.min(1 / state.scale, view.w * 0.5 / Math.max(1, box.width), view.h * 0.4 / Math.max(1, box.height)),
      width = box.width * scale, height = box.height * scale,
      x = view.x + (view.w - width) / 2, y = view.y + view.h * 0.34 - height / 2,
      size = state.pen, color = state.inkColor;
    smartSuggestSyncDocument();
    const world = strokes.map(stroke => stroke.map(point => ({ x:x + point.x * scale, y:y + point.y * scale })));
    for (const points of world) {
      if (points.length === 1) dot(points[0], false, size, true, color);
      for (let index = 1; index < points.length; index++) stroke(points[index - 1], points[index], false, size, true, color);
    }
    state.userRevision++;
    // The Agent example keeps the panel open; first ink would otherwise hide it.
    if (!suggest && typeof canvasAgentDidStartUserConversation === "function") canvasAgentDidStartUserConversation();
    saveUserCanvasChange();
    requestCommittedInkRender();
    requestRender();
    window.PenEchoStudioNavigator?.updateDocument?.();
    const placed = { x, y, w:width, h:height };
    // Agent examples are read from the canvas; the Suggest bar would compete with Send.
    if (!suggest) {
      if (typeof refreshDirtyHistoryAfter === "function") refreshDirtyHistoryAfter();
      return placed;
    }
    const historyEntry = state.history.at(-1), now = performance.now();
    for (const points of world) smartSuggestRecordStroke({ id:smartSuggest.nextStrokeId++, points, size, color, box:exampleBox(points), at:now, durationMs:240, historyEntry, exact:true });
    smartSuggest.writingMs += world.length * 240;
    smartSuggest.lastKey = "";
    smartSuggest.jev = null;
    smartSuggest.localReadyAt = now + ASSIST_LOCAL_DELAY_MS;
    smartSuggest.inkReadyAt = smartSuggest.localReadyAt + SMART_SUGGEST_RANK_DELAY_MS;
    // Undo/Redo restore the Suggest input recorded above with this history entry.
    if (typeof refreshDirtyHistoryAfter === "function") refreshDirtyHistoryAfter();
    scheduleAssist();
    return placed;
  }
  // Photo examples go through the normal image import, so the photo is new
  // input for Suggest exactly as if the person had added it themselves.
  async function addExampleImage(scenario) {
    const response = await fetch(scenario.image.src, { cache:"force-cache" });
    if (!response.ok) throw Error(exampleCopy("The example photo could not be loaded.", "示例照片加载失败。"));
    const blob = await response.blob(), before = state.images.length;
    // Some hosts serve example files as octet-stream; the bytes are a known JPEG.
    const type = blob.type?.startsWith("image/") ? blob.type : "image/jpeg";
    await addImageFile(new File([blob], scenario.image.name, { type }));
    const item = state.images.length > before ? state.images.at(-1) : null;
    if (!item) throw Error(exampleCopy("The example photo could not be added.", "示例照片无法添加。"));
    // Leave image editing so the suggestion bar is not held back.
    if (state.imageEdit && typeof acceptImageEdit === "function") acceptImageEdit();
    return imageBox(item);
  }
  // Centres the example ink in the visible canvas without changing the zoom.
  function centerExampleView(box) {
    invalidateCanvasViewportMetrics();
    const { width, height } = canvasViewportMetrics();
    if (!width || !height) return null;
    state.panX = width / 2 - (box.x + box.w / 2) * state.scale;
    state.panY = height * 0.36 - (box.y + box.h / 2) * state.scale;
    requestRender();
    return { panX:state.panX, panY:state.panY };
  }
  // Panels that open with a new canvas resize it after the ink lands, and the
  // resize keeps the old centre. Recentre after each resize for a moment, until
  // the person pans, zooms or draws.
  function keepExampleCentred(box, session) {
    const viewport = document.querySelector("#viewport");
    if (!viewport || typeof ResizeObserver !== "function") return;
    let timer = 0;
    const stop = () => {
      observer.disconnect();
      clearTimeout(timer);
      for (const type of ["pointerdown", "wheel"]) viewport.removeEventListener(type, stop, true);
    };
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (exampleCanvases.session === session && exampleSessionCurrent() && !state.drawing) centerExampleView(box);
      }, 60);
    });
    observer.observe(viewport);
    for (const type of ["pointerdown", "wheel"]) viewport.addEventListener(type, stop, true);
    setTimeout(stop, 2500);
  }
  async function openExampleCanvas(id) {
    const scenario = EXAMPLES?.get(id);
    if (!scenario || exampleCanvases.opening || !examplesAvailable()) return false;
    exampleCanvases.opening = true;
    try {
      closeExamplesDialog();
      hideExampleDone();
      endExampleSession();
      // An empty, unsaved canvas is reused; anything else stays open in the workspace.
      if (!exampleCanvasIsEmpty() && await openNewCanvasDialog() === false) return false;
      applyCurrentCanvasGeneratedName(`${exampleCopy("Example", "示例")} · ${exampleText(scenario.title)}`);
      if (state.mode !== "pen") setCanvasMode("pen", { preserveSelection:true });
      const agent = scenario.route === "agent" && canvasAgentReadyForExample();
      // Open the Agent first so the ink is laid out in the space it leaves.
      if (agent) await openExampleAgentPanel();
      const box = scenario.image ? await addExampleImage(scenario) : drawExampleInk(scenario, { suggest:scenario.route !== "agent" });
      exampleCanvases.session = { id:scenario.id, documentId:canvasDocumentsCurrent().id, box, status:"waiting", baseline:"", deadline:0 };
      exampleCanvases.coachHidden = false;
      if (agent) fillExampleAgentPrompt(scenario);
      centerExampleView(box);
      keepExampleCentred(box, exampleCanvases.session);
      startExampleCoach();
      return true;
    } catch (error) {
      setStatus(error?.message || String(error));
      return false;
    } finally {
      exampleCanvases.opening = false;
    }
  }
  function canvasAgentReadyForExample() {
    return typeof canvasAgentAvailable !== "function" || canvasAgentAvailable();
  }
  async function openExampleAgentPanel() {
    if (canvasAgentPanel.hidden || !document.body.classList.contains("canvas-agent-open")) openCanvasAgent({ focus:false });
    // A new canvas may have just started opening the panel too; let it finish
    // resizing the canvas before the view is measured.
    await new Promise(resolve => setTimeout(resolve, 360));
  }
  function fillExampleAgentPrompt(scenario) {
    if (!exampleSessionCurrent() || canvasAgentInput.disabled) return;
    canvasAgentInput.value = exampleText(scenario.prompt);
    canvasAgentInput.dispatchEvent(new Event("input", { bubbles:true }));
    canvasAgentInput.focus({ preventScroll:true });
    canvasAgentInput.setSelectionRange?.(canvasAgentInput.value.length, canvasAgentInput.value.length);
  }
  function endExampleSession() {
    clearInterval(exampleCanvases.watchTimer);
    exampleCanvases.watchTimer = 0;
    exampleCanvases.session = null;
    hideExampleCoach();
  }

  // Suggest hook: on an example canvas, the example's action leads and is highlighted.
  function exampleCanvasesAssistView(view, cluster) {
    const session = exampleSessionCurrent();
    if (!session || session.status !== "waiting" || cluster?.result || cluster?.selection || !view?.items) return view;
    const id = EXAMPLES.get(session.id)?.action;
    if (!id || !SMART_SUGGEST?.actionById(id)) return view;
    const target = [...view.items, ...(view.more || [])].find(item => item.id === id) || { id, source:"local" },
      items = [target, ...view.items.filter(item => item.id !== id)].slice(0, Math.max(1, view.items.length)),
      more = [...view.items, ...(view.more || [])].filter(item => item.id !== id && !items.includes(item));
    return { ...view, items, more, confident:true };
  }
  // Executor hook: returns true when the example handled the action itself.
  async function exampleCanvasesActionStarted(id, target) {
    const session = exampleSessionCurrent();
    if (!session || session.status !== "waiting") return false;
    const scenario = EXAMPLES.get(session.id);
    if (id !== scenario.action) {
      endExampleSession();
      return false;
    }
    // Without a model this example cannot show its real result; set one up first.
    if (!exampleModelReady(scenario) && !(id === "plot" && scenario.graph) && !(id === "diagram" && scenario.architecture)) {
      openExampleAiSetup();
      return true;
    }
    session.status = "running";
    if (target) target.example = true;
    hideExampleCoach();
    exampleSaveProgress(EXAMPLES.markTried(exampleProgress(), scenario.id));
    // Instant examples insert their known result: a graph, or the local
    // architecture diagram of the sketched boxes.
    if (id === "plot" && scenario.graph || id === "diagram" && scenario.architecture) {
      let visible = null;
      try { visible = viewportRect(); } catch {}
      const anchor = target?.box || session.box,
        spec = scenario.graph
          ? SMART_SUGGEST.graphWidgetCommand(scenario.graph, { language:state.language, anchor, visible, canvasSize:SIZE })
          : { tool:"html_widget", pluginId:"general", ...SMART_SUGGEST.graphPlacement({}, { anchor, visible, canvasSize:SIZE }), title:scenario.architecture.title, refreshSeconds:0,
            html:EXAMPLES.architectureDocument(scenario.architecture, state.language) };
      if (spec) {
        hideAssist(scenario.graph ? "example-graph" : "example-diagram");
        await insertAssistWidget(spec, { place:"beside" });
        consumeDirtyInputScope({ x:session.box.x - 24, y:session.box.y - 24, w:session.box.w + 48, h:session.box.h + 48 });
        smartSuggestInputConsumed(smartSuggest.strokes.at(-1)?.id || 0);
        finishExample(session);
        return true;
      }
    }
    watchExampleResult(session);
    return false;
  }
  function exampleSignature() {
    return [state.widgets.length, state.images.length, state.textBoxes.length, state.history.length, state.animations?.length || 0].join("|");
  }
  function exampleBusy() {
    return Boolean(state.activeAI) || smartSuggest.bar?.mode === "working" || Boolean(canvasAgent.running || canvasAgent.requestPending);
  }
  // A result has landed once the canvas changed and nothing is still running.
  function watchExampleResult(session) {
    clearInterval(exampleCanvases.watchTimer);
    session.baseline = exampleSignature();
    session.deadline = performance.now() + EXAMPLE_RESULT_TIMEOUT_MS;
    exampleCanvases.watchTimer = setInterval(() => {
      if (exampleCanvases.session !== session || performance.now() > session.deadline) {
        clearInterval(exampleCanvases.watchTimer);
        exampleCanvases.watchTimer = 0;
        return;
      }
      if (!exampleSessionCurrent() || exampleBusy() || exampleSignature() === session.baseline) return;
      clearInterval(exampleCanvases.watchTimer);
      exampleCanvases.watchTimer = 0;
      finishExample(session);
    }, 600);
  }
  function exampleAgentSubmitted(event) {
    const session = exampleSessionCurrent();
    if (!session || session.status !== "waiting" || EXAMPLES.get(session.id)?.route !== "agent") return;
    if (!exampleModelReady(EXAMPLES.get(session.id))) {
      event?.preventDefault();
      event?.stopImmediatePropagation();
      openExampleAiSetup();
      return;
    }
    session.status = "running";
    hideExampleCoach();
    exampleSaveProgress(EXAMPLES.markTried(exampleProgress(), session.id));
    watchExampleResult(session);
  }
  function finishExample(session) {
    session.status = "done";
    // Results are live. In Pen a press on a Widget draws, so switch to Hand and
    // let the person use the new graph, card or widget straight away.
    if (exampleSessionCurrent() === session && state.mode !== "hand") setCanvasMode("hand", { preserveSelection:true, skipDraftFinalize:true, preserveWidgetRefinement:true });
    showExampleDone(EXAMPLES.get(session.id));
  }

  function showExampleDone(scenario) {
    if (!exampleDone || !scenario) return;
    const next = exampleNextUntried(scenario.id), total = EXAMPLES.SCENARIOS.length, tried = exampleTriedCount();
    exampleDone.dataset.exampleId = scenario.id;
    exampleDone.dataset.documentId = canvasDocumentsCurrent()?.id || "";
    exampleDone.dataset.nextId = next?.id || "";
    exampleDoneTitle.textContent = tried >= total ? exampleCopy(`You tried all ${total} examples`, `${total} 个示例都体验过了`) : `${exampleCopy(`You tried “${exampleText(scenario.title)}”`, `已体验“${exampleText(scenario.title)}”`)} · ${exampleProgressText()}`;
    exampleDoneBody.textContent = [exampleText(scenario.learned), exampleText(scenario.tip)].filter(Boolean).join(" ");
    exampleDoneNext.hidden = !next;
    exampleDoneNext.textContent = next ? `${exampleCopy("Next", "下一个")}: ${exampleText(next.title)}` : "";
    exampleDoneOwn.textContent = exampleCopy("Start my own canvas", "新建我的画布");
    exampleDoneClose.setAttribute("aria-label", exampleCopy("Close", "关闭"));
    exampleDoneClose.title = exampleCopy("Close", "关闭");
    exampleDone.hidden = false;
    // The bar belongs to its example canvas; switching canvases dismisses it.
    clearInterval(exampleCanvases.doneTimer);
    exampleCanvases.doneTimer = setInterval(() => {
      if (exampleDone.hidden || canvasDocumentsCurrent()?.id !== exampleDone.dataset.documentId) hideExampleDone();
    }, 800);
  }
  function hideExampleDone() {
    clearInterval(exampleCanvases.doneTimer);
    exampleCanvases.doneTimer = 0;
    if (exampleDone) exampleDone.hidden = true;
  }

  function renderExampleCoach() {
    const session = exampleCanvases.session, scenario = session && EXAMPLES.get(session.id);
    if (!scenario) return;
    const group = EXAMPLES.ordered(scenario.category), number = group.indexOf(scenario) + 1,
      suggestOff = scenario.route !== "agent" && !smartSuggestActive();
    exampleCoachKicker.textContent = `${exampleGoalLabel(scenario.category)} · ${exampleCopy(`${number} of ${group.length}`, `${number}/${group.length}`)} · ${exampleFeatureLabel(scenario.feature)}`;
    exampleCoachTitle.textContent = exampleText(scenario.title);
    const needsModel = !exampleModelReady(scenario) && !scenario.graph && !scenario.architecture;
    exampleCoachBody.textContent = needsModel
      ? exampleCopy("This example needs an AI model to produce the real result, and none is connected yet. Set one up, then try it.", "此示例需要 AI 模型才能生成真实结果，目前尚未连接。请先设置，再来体验。")
      : suggestOff ? exampleCopy("Suggestions are turned off. Turn them on in Settings, or tap the AI button to try this example.", "建议已关闭。请在设置中开启，或点击 AI 按钮体验此示例。") : exampleText(scenario.coach);
    exampleCoachSetup.hidden = !needsModel;
    exampleCoachSetup.textContent = exampleCopy("Set up AI", "设置 AI");
    exampleCoachTip.textContent = exampleText(scenario.tip);
    exampleCoachTip.hidden = !scenario.tip || scenario.route === "agent";
    exampleCoachAll.textContent = exampleCopy("All examples", "全部示例");
    exampleCoachHide.textContent = exampleCopy("Got it", "知道了");
  }
  function exampleInkScreenRect(box) {
    const viewportElement = document.querySelector("#viewport"), frame = viewportElement ? pageLayoutRect(viewportElement) : null;
    if (!frame) return null;
    const left = frame.left + box.x * state.scale + state.panX, top = frame.top + box.y * state.scale + state.panY,
      width = box.w * state.scale, height = box.h * state.scale;
    return { left, top, right:left + width, bottom:top + height, width, height };
  }
  function exampleCoachTarget(session, scenario) {
    if (scenario.route === "agent") {
      const send = document.querySelector("#canvasAgentSend");
      return send && !canvasAgentPanel.hidden ? { rect:pageLayoutRect(send), placement:"top" } : null;
    }
    const chip = document.querySelector(`#smartSuggestLayer:not([hidden]) .assist-bar[data-mode="suggest"] [data-suggestion="${scenario.action}"]`);
    if (chip?.getClientRects().length) return { rect:pageLayoutRect(chip), placement:"bottom" };
    return smartSuggestActive() ? null : { rect:exampleInkScreenRect(session.box), placement:"bottom" };
  }
  function positionExampleCoach() {
    const session = exampleSessionCurrent(), scenario = session && EXAMPLES.get(session.id);
    if (!scenario || session.status !== "waiting" || exampleCanvases.coachHidden || state.viewMode || featureTour.active || examplesDialog?.open) { if (exampleCoach) exampleCoach.hidden = true; return; }
    const target = exampleCoachTarget(session, scenario);
    if (!target?.rect || !TOUR.rectHasArea(target.rect)) { exampleCoach.hidden = true; return; }
    const wasHidden = exampleCoach.hidden;
    // Connecting a model while the coachmark is up swaps "Set up AI" for the steps.
    const ready = exampleModelReady(scenario);
    if (wasHidden || exampleCanvases.coachReady !== ready) { exampleCanvases.coachReady = ready; renderExampleCoach(); }
    exampleCoach.hidden = false;
    const card = pageLayoutRect(exampleCoach),
      position = TOUR.placeCoachmark(target.rect, { width:card.width, height:card.height }, featureTourViewport(), target.placement, { margin:12, gap:14, arrowMargin:22 }),
      style = runtimeElementStyle(exampleCoach, "example-coach");
    style?.setProperty("left", `${Math.round(position.x)}px`);
    style?.setProperty("top", `${Math.round(position.y)}px`);
    style?.setProperty("--example-coach-arrow", `${Math.round(position.arrowOffset)}px`);
    exampleCoach.dataset.placement = position.placement;
  }
  function startExampleCoach() {
    clearInterval(exampleCanvases.coachTimer);
    renderExampleCoach();
    exampleCanvases.coachTimer = setInterval(() => {
      if (!exampleCanvases.session || exampleCanvases.session.status !== "waiting") { hideExampleCoach(); return; }
      positionExampleCoach();
    }, 200);
  }
  function hideExampleCoach() {
    clearInterval(exampleCanvases.coachTimer);
    exampleCanvases.coachTimer = 0;
    if (exampleCoach) exampleCoach.hidden = true;
  }

  function exampleCardClick(event) {
    const goal = event.target.closest?.("button[data-example-goal]");
    if (goal) { chooseExampleGoal(goal.dataset.exampleGoal); return; }
    const card = event.target.closest?.("[data-example-id]");
    if (card) void openExampleCanvas(card.dataset.exampleId);
  }
  if (EXAMPLES) {
    exampleWelcome?.addEventListener("click", exampleCardClick);
    // The welcome sits over the canvas: keep presses on its controls from drawing.
    exampleWelcome?.addEventListener("pointerdown", event => { if (event.target.closest?.("button")) event.stopPropagation(); });
    exampleWelcomeAll?.addEventListener("click", openExamplesDialog);
    examplesDialog?.addEventListener("click", event => {
      if (event.target === examplesDialog) { closeExamplesDialog(); return; }
      exampleCardClick(event);
    });
    examplesDialogClose?.addEventListener("click", closeExamplesDialog);
    for (const button of document.querySelectorAll("[data-open-examples]")) button.addEventListener("click", () => {
      const menu = button.closest("#canvasMoreMenu");
      if (menu) { menu.hidden = true; document.querySelector("#canvasMoreBtn")?.setAttribute("aria-expanded", "false"); }
      openExamplesDialog();
    });
    exampleCoachAll?.addEventListener("click", openExamplesDialog);
    exampleCoachHide?.addEventListener("click", () => { exampleCanvases.coachHidden = true; hideExampleCoach(); });
    exampleCoachSetup?.addEventListener("click", openExampleAiSetup);
    exampleCoach?.addEventListener("keydown", event => { if (event.key === "Escape") { exampleCanvases.coachHidden = true; hideExampleCoach(); } });
    for (const element of [exampleCoach, exampleDone]) element?.addEventListener("pointerdown", event => event.stopPropagation());
    exampleDoneNext?.addEventListener("click", () => { const next = exampleDone.dataset.nextId; if (next) void openExampleCanvas(next); });
    exampleDoneOwn?.addEventListener("click", () => { hideExampleDone(); endExampleSession(); canvasDocumentsUiAction(openNewCanvasDialog); });
    exampleDoneClose?.addEventListener("click", hideExampleDone);
    document.querySelector("#canvasAgentForm")?.addEventListener("submit", exampleAgentSubmitted, true);
    window.addEventListener("penecho:languagechange", renderExamples);
    renderExamples();
  }
  window.PenEchoExamples = Object.freeze({
    open:id => openExampleCanvas(id),
    openDialog:openExamplesDialog,
    progress:() => ({ ...exampleProgress() }),
  });
