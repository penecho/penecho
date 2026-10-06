  // PenEcho Agent: composer-triggered suggestions, ranked by PenEchoLLM.
  //
  // The panel ranks one combined action space: the Canvas Suggest actions,
  // phrased as fuller Agent requests, plus the Agent's own file, project and
  // authoring requests (CANVAS_AGENT_PROMPT_LIBRARY). Every request above 10%
  // is listed, or the top three when none pass that floor. Requests at the
  // Canvas Suggest confidence threshold are highlighted.
  //
  // Composer focus or a click without results creates inference intent.
  // Typing never blocks it.
  // Rank meaningful, changed context once; reuse cached or in-flight work.
  // Availability, busy state and focus ownership are checked again immediately
  // before spending. Results are presented separately, only after success.
  // `var` keeps these readable when Agent code renders before this file runs.
  var AGENT_SUGGEST_SHOW_MIN = 0.10,
    AGENT_SUGGEST_FOCUS_SETTLE_MS = 350,
    AGENT_SUGGEST_TIMEOUT_MS = 44000,
    AGENT_SUGGEST_SNAPSHOT_TIMEOUT_MS = 2500,
    AGENT_SUGGEST_MAX_CANDIDATES = 40,
    AGENT_SUGGEST_CACHE_LIMIT = 8,
    AGENT_SUGGEST_FIXED_EXAMPLES = ["transformer","ukTrip"],
    AGENT_SUGGEST_FILE_PROMPTS = {
      image:["imageVisual","imageLayer","imagePublish"],
      spreadsheet:["spreadsheetVisual","excel","spreadsheetLayer","spreadsheetPublish"],
      presentation:["presentationVisual","presentationLayer","presentationPublish"],
      document:["documentVisual","documentStudy","documentPublish"],
      code:["codeVisual","codeReview","codeLayer","codePlan"],
      file:["file","fileLayer","filePublish"],
    },
    AGENT_SUGGEST_TEXT_SOURCE_PROMPTS = ["actionItems","glossary","timeline"],
    AGENT_SUGGEST_PROJECT_PROMPTS = ["projectEvidence","projectPlan","projectPublish","releaseReadiness","codeReview","architecture","compareFiles"],
    AGENT_SUGGEST_SELECTION_PROMPTS = ["selectionVisual","selectionLayer","selectionPublish"],
    AGENT_SUGGEST_INK_PROMPTS = ["solveProblem","checkWork","answerQuestion","hint","nextStep","explainStep","typeset","plotGraph","structureDiagram","organize","practiceProblems","createVisual","animateConcept","illustrate","animateSketch","finishDrawing","cleanShapes","interactivePrototype","applyAnnotations","notesVisual","notesPublish","handwriting","followCanvasCues","translateNotes","simpleDiagram","flashcards"],
    AGENT_SUGGEST_CANVAS_PROMPTS = ["canvasVisual","canvasLayer","canvasPublish","followCanvasCues","explainStep","simpleDiagram","structureDiagram","animateConcept","ppt","selfCheckQuiz","flashcards"],
    AGENT_SUGGEST_GENERIC_PROMPTS = ["architecture","sequenceDiagramSource","workflow","comparisonTable","interactiveCalculator","selfCheckQuiz"],
    agentSuggest = {
      status:"idle",       // idle | loading | ready | failed | blocked | off
      items:[],            // [{ id, p }] ranked, at or above the display floor
      key:"",              // fingerprint the shown items belong to
      parts:null,
      pendingKey:"",
      cache:new Map(),     // fingerprint → { items, result, parts }
      controller:null,
      sequence:0,
      focusTimer:0,
      focusEpoch:0,
      preparingEpoch:0,
      promise:null,
      result:null,         // { latencyMs, cached, chargedCredits }
      info:false,
      reason:"",
      renderedSignature:"",
      historyIds:new WeakMap(),
      nextHistoryId:1,
    };

  function agentSuggestCopy(en, zh) { return state.language === "zh" ? zh : en; }
  function agentSuggestElements() {
    return {
      loading:document.querySelector("#canvasAgentSuggestLoading"),
      list:document.querySelector("#canvasAgentPromptSuggestList"),
      status:document.querySelector("#canvasAgentSuggestStatus"),
      items:document.querySelector("#canvasAgentSuggestItems"),

    };
  }
  function agentSuggestFeatureAvailable() {
    return Boolean(typeof smartSuggest === "object" && smartSuggest && typeof SMART_SUGGEST === "object" && SMART_SUGGEST && smartSuggest.available);
  }
  function agentSuggestCanSpend() {
    return agentSuggestFeatureAvailable() && smartSuggest.enabled && !suggestionAccessBlocked();
  }
  function agentSuggestFocusEligible() {
    return !canvasAgentPanel.hidden && canvasAgentPromptSuggestionsAvailable() && !agentSuggestAgentBusy();
  }
  function agentSuggestCanPresent() {
    return Boolean(agentSuggest && canvasAgent.promptSuggestionsIntent && !canvasAgent.promptSuggestionsDismissed
      && agentSuggestFocusEligible() && agentSuggestFeatureAvailable() && smartSuggest.enabled
      && agentSuggest.status === "ready" && agentSuggest.items.length && agentSuggest.key === agentSuggestSnapshot().key);
  }

  // ---------- Context fingerprint ----------
  // The newest non-empty Undo entry identifies the Canvas content. Every
  // committed change (pen, Canvas AI, Agent, MCP) adds one; Undo returns to an
  // earlier entry, so its earlier ranking is reused from the cache.
  function agentSuggestHistoryKey() {
    const history = state.history || [];
    for (let index = history.length - 1, scanned = 0; index >= 0 && scanned < 6; index--, scanned++) {
      const entry = history[index];
      if (!entry || typeof entry !== "object") continue;
      const empty = Array.isArray(entry) ? !entry.length
        : !(entry.tiles?.length || entry.widgetsBefore || entry.widgetsAfter || entry.imagesBefore || entry.imagesAfter || entry.textBoxesBefore || entry.textBoxesAfter || entry.animationsBefore || entry.animationsAfter || entry.objectScope);
      if (empty) continue;
      if (!agentSuggest.historyIds.has(entry)) agentSuggest.historyIds.set(entry, agentSuggest.nextHistoryId++);
      return `h${agentSuggest.historyIds.get(entry)}`;
    }
    return "h0";
  }
  function agentSuggestFileKind(resource) {
    return typeof canvasAgentPromptFileContext === "function" ? canvasAgentPromptFileContext(resource) : "file";
  }
  function agentSuggestSnapshot() {
    const project = typeof canvasAgentProjectById === "function" ? canvasAgentProjectById() : null,
      attachments = (canvasAgent.attachments || []).filter(Boolean),
      selection = state.selection?.phase === "active" && state.selection.box ? state.selection : null,
      references = typeof canvasAgentReferencedIds === "function" ? canvasAgentReferencedIds() : [],
      count = list => Array.isArray(list) ? list.length : 0,
      objects = [count(state.widgets), count(state.images), count(state.textBoxes), count(state.animations) + count(state.preservedSnapshotAnimations)],
      round = value => Math.round(Number(value) || 0),
      parts = {
        document:typeof canvasDocumentsCurrent === "function" ? String(canvasDocumentsCurrent()?.id || "") : "",
        attachments:attachments.map(item => String(item.id || item.name || item.kind)).join(","),
        project:project ? `${project.id}:${project.kind || ""}` : String(canvasAgent.projectId || ""),
        ink:String(typeof smartSuggest === "object" && smartSuggest ? smartSuggest.nextStrokeId : 0),
        content:`${agentSuggestHistoryKey()}:${state.userRevision || 0}:${objects.join(".")}`,
        selection:selection ? [selection.box.x, selection.box.y, selection.box.w, selection.box.h].map(round).join(",") : "",
        references:references.join(","),
      };
    return {
      key:Object.values(parts).join("|"), parts, project, attachments, selection, references,
      attachmentKinds:attachments.map(item => item.kind === "image" ? "image" : agentSuggestFileKind(item)).slice(0, 5),
      projectKind:project ? project.kind === "folder" ? "folder" : agentSuggestFileKind(project) : canvasAgent.projectId ? "folder" : "",
      objects:{ widgets:objects[0], images:objects[1], text:objects[2], animations:objects[3] },
    };
  }
  // What changed since the ranking on screen (a hint for PenEchoLLM).
  function agentSuggestChanges(previous, next) {
    if (!previous || previous.document !== next.document) return [];
    const changes = [];
    if (previous.attachments !== next.attachments) changes.push("attachments");
    if (previous.project !== next.project) changes.push("project");
    if (previous.ink !== next.ink) changes.push("ink");
    else if (previous.content !== next.content) changes.push("content");
    if (previous.selection !== next.selection || previous.references !== next.references) changes.push("selection");
    return changes;
  }

  // ---------- Candidate requests (combined action space) ----------
  function agentSuggestHasInk() {
    return typeof visibleInkBounds === "function" && Boolean(visibleInkBounds({ x:0, y:0, w:SIZE, h:SIZE }));
  }
  function agentSuggestCandidates(snapshot, ink = agentSuggestHasInk()) {
    const ids = [], add = list => { for (const id of list) if (!ids.includes(id)) ids.push(id); },
      kinds = [...snapshot.attachmentKinds, ...(snapshot.projectKind && snapshot.projectKind !== "folder" ? [snapshot.projectKind] : [])],
      objects = snapshot.objects;
    for (const kind of kinds) add(AGENT_SUGGEST_FILE_PROMPTS[kind] || AGENT_SUGGEST_FILE_PROMPTS.file);
    if (kinds.some(kind => kind !== "image")) add(AGENT_SUGGEST_TEXT_SOURCE_PROMPTS);
    if (snapshot.projectKind === "folder") add([...AGENT_SUGGEST_PROJECT_PROMPTS, ...AGENT_SUGGEST_TEXT_SOURCE_PROMPTS]);
    if (snapshot.attachmentKinds.filter(kind => kind !== "image").length >= 2) add(["compareFiles"]);
    if (snapshot.selection || snapshot.references.length) add(AGENT_SUGGEST_SELECTION_PROMPTS);
    if (ink) add(AGENT_SUGGEST_INK_PROMPTS);
    if (objects.images) add(AGENT_SUGGEST_FILE_PROMPTS.image);
    if (objects.widgets || objects.images || objects.text || objects.animations) add(AGENT_SUGGEST_CANVAS_PROMPTS);
    if (objects.text) add(["translateNotes","organize","actionItems"]);
    if (ids.length) add(AGENT_SUGGEST_GENERIC_PROMPTS);
    return ids.filter(id => CANVAS_AGENT_PROMPT_LIBRARY[id] && !AGENT_SUGGEST_FIXED_EXAMPLES.includes(id)).slice(0, AGENT_SUGGEST_MAX_CANDIDATES);
  }
  // Nothing to rank: a blank Canvas with no attachment or project. The
  // static tabs already cover a fresh start, so no call is spent.
  function agentSuggestMeaningful(snapshot) {
    const objects = snapshot.objects;
    return Boolean(snapshot.attachmentKinds.length || snapshot.projectKind || snapshot.selection || snapshot.references.length
      || objects.widgets || objects.images || objects.text || objects.animations || agentSuggestHasInk());
  }

  // ---------- Canvas image ----------
  // Full-contrast view of what the person sees (or their selection). A blank
  // view falls back to the content bounds; no content sends no image.
  async function agentSuggestCaptureImage(snapshot, signal) {
    if (snapshot.selection && typeof renderSelectionImage === "function") {
      const rendered = renderSelectionImage(snapshot.selection, SMART_SUGGEST_CROP_SIDE)?.out;
      if (rendered) return smartSuggestEncodeImage(rendered);
    }
    const full = { x:0, y:0, w:SIZE, h:SIZE }, content = typeof canvasAgentContentBounds === "function" ? canvasAgentContentBounds() : null;
    if (!content) return "";
    const visible = typeof viewportRect === "function" ? viewportRect() : null,
      region = visible && intersection(visible, content) ? intersection(visible, full) : intersection({ x:content.x - 24, y:content.y - 24, w:content.w + 48, h:content.h + 48 }, full);
    if (!region || region.w < 1 || region.h < 1) return "";
    const widgets = typeof capturableWidgets === "function" ? capturableWidgets(region) : [];
    if (widgets.length && typeof ensureWidgetSnapshots === "function") {
      // Best effort: a slow Widget must not hold the composer suggestions.
      try { await ensureWidgetSnapshots(widgets, { signal, timeoutMs:AGENT_SUGGEST_SNAPSHOT_TIMEOUT_MS, reuseWithinMs:WIDGET_CLASSIFY_SNAPSHOT_REUSE_MS }); } catch (error) { if (signal?.aborted) throw error; }
    }
    signal?.throwIfAborted?.();
    const scale = Math.min(1, SMART_SUGGEST_CROP_SIDE / Math.max(region.w, region.h)), out = document.createElement("canvas");
    out.width = Math.max(16, Math.round(region.w * scale));
    out.height = Math.max(16, Math.round(region.h * scale));
    const context = out.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, out.width, out.height);
    context.setTransform(scale, 0, 0, scale, -region.x * scale, -region.y * scale);
    drawSmartSuggestScene(context, region);
    return smartSuggestEncodeImage(out);
  }

  // ---------- Composer trigger ----------
  function agentSuggestAgentBusy() {
    return Boolean(canvasAgent.running || canvasAgent.requestPending || canvasAgent.pendingApproval
      || canvasAgent.attachmentBusy || canvasAgent.projectUploadBusy || state.activeAI
      || (typeof aiPreparation !== "undefined" && aiPreparation) || state.selection?.aiRequest
      || (typeof assistRequestsActive === "function" && assistRequestsActive())
      || (typeof assistAgent !== "undefined" && (assistAgent.routeController || assistAgent.preparing)));
  }
  // Dismissal invalidates pending focus work, but an already spent request may
  // finish and cache its result. It cannot reopen a dismissed panel.
  function agentSuggestCancelPending() {
    if (!agentSuggest) return;
    agentSuggest.focusEpoch++;
    agentSuggest.preparingEpoch = 0;
    if (agentSuggest.focusTimer) clearTimeout(agentSuggest.focusTimer);
    agentSuggest.focusTimer = 0;
  }
  function agentSuggestWorkStarted() {
    if (agentSuggest && canvasAgent.promptSuggestionsIntent) canvasAgentDismissPromptSuggestions();
  }
  function agentSuggestOwnsFocus(epoch) {
    return epoch === agentSuggest.focusEpoch && canvasAgent.promptSuggestionsIntent
      && !canvasAgent.promptSuggestionsDismissed && document.activeElement === canvasAgentInput
      && agentSuggestFocusEligible();
  }
  function agentSuggestComposerFocused() {
    if (!agentSuggest) return;
    agentSuggestCancelPending();
    canvasAgent.promptSuggestionsIntent = false;
    canvasAgent.promptSuggestionsDismissed = false;
    if (!agentSuggestFocusEligible() || !smartSuggest.enabled || !agentSuggestMeaningful(agentSuggestSnapshot())) {
      agentSuggestRender();
      return;
    }
    canvasAgent.promptSuggestionsIntent = true;
    const epoch = agentSuggest.focusEpoch;
    agentSuggest.focusTimer = setTimeout(() => {
      agentSuggest.focusTimer = 0;
      void agentSuggestConsider(epoch);
    }, AGENT_SUGGEST_FOCUS_SETTLE_MS);
    agentSuggestRender();
  }
  function agentSuggestComposerClicked() {
    if (!agentSuggest || agentSuggestCanPresent()) return;
    // A native click follows focus, and repeated clicks can arrive during
    // availability, capture or inference. Keep that work and its focus owner.
    if (agentSuggest.focusTimer || agentSuggest.preparingEpoch || agentSuggest.promise) return;
    agentSuggestComposerFocused();
  }
  async function agentSuggestEnsureAvailability() {
    if (smartSuggest.availability?.pending) await smartSuggest.availability.pending;
    else if (typeof refreshSmartSuggestAvailability === "function") await refreshSmartSuggestAvailability({ reason:"visible" });
  }
  async function agentSuggestConsider(epoch) {
    if (!agentSuggestOwnsFocus(epoch)) { agentSuggestRender(); return; }
    agentSuggest.preparingEpoch = epoch;
    agentSuggestRender();
    try {
      await agentSuggestEnsureAvailability();
      // Join existing work rather than lose a new focus/context while it runs.
      if (agentSuggest.promise) await agentSuggest.promise;
      if (!agentSuggestOwnsFocus(epoch) || !agentSuggestCanSpend()) return;
      const snapshot = agentSuggestSnapshot();
      if (!agentSuggestMeaningful(snapshot)) return;
      const cached = agentSuggest.cache.get(snapshot.key);
      if (cached?.items.length) {
        Object.assign(agentSuggest, { items:cached.items, result:{ ...cached.result, cached:true, chargedCredits:0 },
          key:snapshot.key, parts:snapshot.parts, status:"ready", reason:"" });
        return;
      }
      const pending = agentSuggestRun(snapshot, epoch);
      agentSuggest.promise = pending;
      try { await pending; }
      finally { if (agentSuggest.promise === pending) agentSuggest.promise = null; }
    } catch {
      // Availability failures stay silent; the next focus can try again.
    } finally {
      if (agentSuggest.preparingEpoch === epoch) agentSuggest.preparingEpoch = 0;
      agentSuggestRender();
    }
  }

  // ---------- Request ----------
  async function agentSuggestRun(snapshot, epoch) {
    if (agentSuggest.controller) agentSuggest.controller.abort();
    const sequence = ++agentSuggest.sequence, controller = new AbortController(), previousParts = agentSuggest.parts, previousStatus = agentSuggest.status,
      started = performance.now(), ink = agentSuggestHasInk(), prompts = agentSuggestCandidates(snapshot, ink);
    if (!prompts.length) { agentSuggest.pendingKey = ""; return; }
    agentSuggest.controller = controller;
    agentSuggest.pendingKey = snapshot.key;
    agentSuggest.status = "loading";
    agentSuggest.reason = "";
    agentSuggestRender();
    let timeout = 0, timedOut = false;
    try {
      const image = await agentSuggestCaptureImage(snapshot, controller.signal);
      if (controller.signal.aborted || sequence !== agentSuggest.sequence) return;
      if (!agentSuggestOwnsFocus(epoch) || !agentSuggestCanSpend() || snapshot.key !== agentSuggestSnapshot().key) {
        agentSuggest.status = "idle";
        return;
      }
      const changes = agentSuggestChanges(previousParts, snapshot.parts),
        context = {
          prompts,
          attachments:snapshot.attachmentKinds,
          ...(snapshot.projectKind ? { project:snapshot.projectKind } : {}),
          canvas:{ ink, widgets:snapshot.objects.widgets, images:snapshot.objects.images, text:snapshot.objects.text, animations:snapshot.objects.animations,
            selection:Boolean(snapshot.selection), references:Math.min(20, snapshot.references.length) },
          ...(changes.length ? { changes } : {}),
        };
      timeout = setTimeout(() => { timedOut = true; controller.abort(); }, AGENT_SUGGEST_TIMEOUT_MS);
      const response = await fetch(suggestionApiPath(), {
        method:"POST", credentials:"same-origin", signal:controller.signal,
        headers:authenticatedApiHeaders({ "Content-Type":"application/json", Accept:"application/json", "X-PenEcho-Suggest":"1" }),
        body:JSON.stringify({ version:1, mode:"agent", ...(image ? { image } : {}), context }),
      });
      const data = await response.json().catch(() => null);
      if (sequence !== agentSuggest.sequence) return;
      updateSuggestionAccess(data);
      if (!response.ok || !data?.ok || !data.answers) {
        agentSuggest.status = suggestionAccessBlocked() ? "blocked" : "failed";
        agentSuggest.reason = data?.reason || `http-${response.status}`;
        return;
      }
      const items = agentSuggestRankAnswers(data.answers, prompts),
        result = { latencyMs:Math.round(performance.now() - started), cached:data.cached === true, chargedCredits:Number(data.chargedCredits) || 0 };
      if (items.length) agentSuggestRemember(snapshot.key, { items, result, parts:snapshot.parts });
      Object.assign(agentSuggest, { items, result, key:snapshot.key, parts:snapshot.parts, status:"ready", reason:"" });
      debug("agent-suggest", { latencyMs:result.latencyMs, candidates:prompts.length, shown:items.length, top:items[0]?.id, p:items[0]?.p });
    } catch (error) {
      if (sequence !== agentSuggest.sequence) return;
      agentSuggest.status = "failed";
      agentSuggest.reason = timedOut ? "timeout" : controller.signal.aborted ? "cancelled" : "network";
    } finally {
      clearTimeout(timeout);
      if (agentSuggest.controller === controller) agentSuggest.controller = null;
      if (sequence === agentSuggest.sequence) {
        agentSuggest.pendingKey = "";
        // A cancelled refresh keeps the previous, still-valid ranking.
        if (agentSuggest.status === "failed" && agentSuggest.reason === "cancelled") Object.assign(agentSuggest, { status:previousStatus === "loading" ? "idle" : previousStatus, reason:"" });
        agentSuggestRender();
      }
    }
  }
  function agentSuggestRankAnswers(answers, prompts) {
    const ranked = prompts.map(id => ({ id, p:answers?.[`prompt_${id}`]?.noul }))
      .filter(item => Number.isFinite(item.p) && item.p >= 0 && item.p <= 1)
      .sort((a, b) => b.p - a.p);
    const aboveFloor = ranked.filter(item => item.p > AGENT_SUGGEST_SHOW_MIN);
    return aboveFloor.length ? aboveFloor : ranked.slice(0, 3);
  }
  function agentSuggestRemember(key, value) {
    agentSuggest.cache.delete(key);
    agentSuggest.cache.set(key, value);
    while (agentSuggest.cache.size > AGENT_SUGGEST_CACHE_LIMIT) agentSuggest.cache.delete(agentSuggest.cache.keys().next().value);
  }
  function agentSuggestHighlighted(item) {
    return item.p >= (SMART_SUGGEST?.POLICY?.confident ?? 0.45);
  }

  // ---------- Rendering ----------
  function agentSuggestStale() {
    return agentSuggest.status === "ready" && Boolean(agentSuggest.key) && agentSuggestSnapshot().key !== agentSuggest.key;
  }
  function agentSuggestUsageText() {
    const allowance = suggestionAllowance();
    if (!allowance) return "";
    const used = allowance.used || (allowance.limit !== null && allowance.remaining !== null ? Math.max(0, allowance.limit - allowance.remaining) : 0);
    if (allowance.tier === "subscriber") return agentSuggestCopy(`${used} used today · unlimited`, `今日已用 ${used} 次 · 不限次数`);
    if (allowance.tier === "credits") return agentSuggestCopy(`${used} used today · ${allowance.spent} credits`, `今日已用 ${used} 次 · ${allowance.spent} 积分`);
    if (allowance.limit !== null && allowance.remaining !== null) return agentSuggestCopy(`${used} used today · ${allowance.remaining} of ${allowance.limit} left`, `今日已用 ${used} 次 · 剩余 ${allowance.remaining}／${allowance.limit}`);
    return agentSuggestCopy(`${used} used today`, `今日已用 ${used} 次`);
  }
  function agentSuggestRankSentence() {
    const result = agentSuggest.result;
    if (agentSuggest.status === "loading") return t("canvasAgentSuggestLoading");
    if (agentSuggest.status !== "ready" || !result) return "";
    const latency = result.latencyMs ? agentSuggestCopy(` in ${(result.latencyMs / 1000).toFixed(1)} s`, `（${(result.latencyMs / 1000).toFixed(1)} 秒）`) : "",
      charge = result.cached ? agentSuggestCopy(" Same context as before: no charge.", "与之前相同的上下文：不计次。")
        : result.chargedCredits > 0 ? agentSuggestCopy(` Used ${result.chargedCredits} credit.`, `消耗 ${result.chargedCredits} 积分。`) : "";
    return agentSuggestCopy(`PenEchoLLM ranked these requests for your Canvas, files and project${latency}.`, `PenEchoLLM 已根据画布、文件和项目排序这些请求${latency}。`) + charge;
  }
  function agentSuggestRank() {
    if (agentSuggest.status === "loading") return agentSuggest.items.length ? "refreshing" : "pending";
    return agentSuggest.status === "ready" ? "ranked" : "local";
  }
  function agentSuggestStatusButton(label, action) {
    const node = document.createElement("button");
    node.type = "button";
    node.textContent = label;
    node.addEventListener("click", async event => { event.stopPropagation(); node.disabled = true; try { await action(); } catch (error) { setStatus(String(error?.message || error)); } finally { node.disabled = false; } });
    return node;
  }
  function agentSuggestRenderStatus() {
    const { status } = agentSuggestElements();
    if (!status) return;
    status.replaceChildren();
    const allowance = suggestionAllowance(), rank = agentSuggestRank(),
      badge = penechoLLMBadge(rank, rank === "pending" ? "PenEchoLLM…" : "PenEchoLLM", "button", suggestionAllowanceShort(allowance)),
      usage = document.createElement("span");
    badge.type = "button";
    badge.classList.add("canvas-agent-suggest-spark");
    badge.classList.toggle("is-low", Boolean(allowance?.low || allowance?.blocked));
    badge.title = agentSuggestRankSentence() || t("canvasAgentSuggestUsage");
    badge.setAttribute("aria-expanded", String(agentSuggest.info));
    badge.setAttribute("aria-label", [badge.title, agentSuggestUsageText(), ...suggestionAllowanceLines(allowance)].filter(Boolean).join(" "));
    badge.addEventListener("click", event => { event.stopPropagation(); agentSuggest.info = !agentSuggest.info; agentSuggestRender(); });
    usage.className = "canvas-agent-suggest-usage";
    usage.textContent = agentSuggestUsageText();
    status.append(badge, usage);
    if (agentSuggest.info) {
      const info = document.createElement("div"), actions = document.createElement("div");
      info.className = "canvas-agent-suggest-info";
      for (const text of [agentSuggestRankSentence(), ...suggestionAllowanceLines(allowance)].filter(Boolean)) {
        const line = document.createElement("span");
        line.textContent = text;
        info.append(line);
      }
      actions.className = "canvas-agent-suggest-info-actions";
      if (allowance?.tier === "guest") actions.append(agentSuggestStatusButton(agentSuggestCopy("Sign in", "登录"), () => window.PenEchoCloudSettings?.signIn(() => void refreshSmartSuggestAvailability())));
      if (allowance && allowance.tier !== "subscriber") actions.append(agentSuggestStatusButton(agentSuggestCopy("Plans & credits", "订阅／积分"), () => window.open(new URL("/dashboard.html#billing", window.PenEchoCloudSettings?.origin() || window.PENECHO_CONFIG?.cloudOrigin || location.origin).href, "_blank", "noopener")));
      if (actions.childElementCount) info.append(actions);
      status.append(info);
    }
  }
  function agentSuggestRow(item) {
    const suggestion = CANVAS_AGENT_PROMPT_LIBRARY[item.id];
    if (!suggestion) return null;
    const button = document.createElement("button"), icon = canvasAgentCreatePromptIcon(suggestion.icon), copy = document.createElement("span"),
      title = document.createElement("strong"), summary = document.createElement("small"), meta = document.createElement("span"),
      highlighted = agentSuggestHighlighted(item), titleText = t(suggestion.title);
    button.type = "button";
    button.className = "canvas-agent-prompt-row canvas-agent-suggest-row";
    button.dataset.peItem = "icon-copy-action";
    button.dataset.peState = "default";
    button.dataset.promptKey = suggestion.prompt;
    button.dataset.suggestId = item.id;
    button.dataset.recommended = String(highlighted);
    if (suggestion.canvasAction) button.dataset.canvasAction = suggestion.canvasAction;
    icon.dataset.peRegion = "media";
    copy.className = "canvas-agent-prompt-copy";
    copy.dataset.peRegion = "copy";
    title.dataset.peRegion = "title";
    title.textContent = titleText;
    summary.textContent = t(`${suggestion.prompt}Summary`);
    copy.append(title, summary);
    meta.className = "canvas-agent-suggest-meta";
    if (highlighted) {
      const badge = document.createElement("span");
      badge.className = "canvas-agent-suggest-badge";
      badge.textContent = t("canvasAgentSuggestRecommended");
      meta.append(badge);
    }
    button.append(icon, copy, meta);
    button.title = titleText;
    button.setAttribute("aria-label", `${titleText}. ${t(`${suggestion.prompt}Summary`)}${highlighted ? `, ${t("canvasAgentSuggestRecommended")}` : ""}`);
    button.addEventListener("click", event => agentSuggestChoose(item.id, event));
    return button;
  }
  // Selecting a suggestion replaces the composer contents with its full prompt.
  function agentSuggestChoose(id, event = null) {
    const suggestion = CANVAS_AGENT_PROMPT_LIBRARY[id];
    if (!suggestion || canvasAgentInput.disabled) return false;
    const button = event?.currentTarget || null,
      pointerType = event?.pointerType || (button && button === canvasAgent.promptSuggestionPointerButton ? canvasAgent.promptSuggestionPointerType : "");
    if (typeof canvasAgentClearPromptSuggestionPointer === "function") canvasAgentClearPromptSuggestionPointer();
    agentSuggestCancelPending();
    canvasAgentInput.value = canvasAgentPromptText(suggestion.prompt);
    canvasAgentDismissPromptSuggestions();
    canvasAgentInput.dispatchEvent(new Event("input", { bubbles:true }));
    if (pointerType !== "touch" && pointerType !== "pen") {
      canvasAgentRestoreSuggestionFocus();
      canvasAgentInput.setSelectionRange?.(canvasAgentInput.value.length, canvasAgentInput.value.length);
    }
    else canvasAgentRestoreSuggestionFocus(false);
    return true;
  }
  function agentSuggestRender() {
    if (!agentSuggest) return;
    const { loading, list, items } = agentSuggestElements(), visible = agentSuggestCanPresent();
    if (loading) loading.hidden = !(!visible && canvasAgent.promptSuggestionsIntent && agentSuggestFocusEligible()
      && (agentSuggest.focusTimer || agentSuggest.preparingEpoch || agentSuggest.status === "loading"));
    canvasAgentSyncPromptPresentation(visible);
    if (!list || !items) return;
    const stale = agentSuggestStale();
    list.setAttribute("aria-busy", "false");
    list.dataset.rank = agentSuggestRank();
    // Rebuild only on a visible change, so a pending tap never loses its row.
    const signature = JSON.stringify([state.language, agentSuggest.status, agentSuggest.key, agentSuggest.items.map(item => [item.id, Math.round(item.p * 100)]), stale, agentSuggest.info,
      suggestionAllowanceShort(suggestionAllowance()), agentSuggestUsageText(), agentSuggest.result?.latencyMs || 0, agentSuggestCanSpend()]);
    if (signature === agentSuggest.renderedSignature) return;
    agentSuggest.renderedSignature = signature;
    agentSuggestRenderStatus();
    items.replaceChildren();
    items.dataset.refreshing = String(agentSuggest.status === "loading" || stale);
    if (agentSuggest.status === "ready" || agentSuggest.status === "loading") for (const item of agentSuggest.items) {
      const row = agentSuggestRow(item);
      if (row) items.append(row);
    }
  }
  // Refresh the stale marker when the panel re-syncs (attachments, project…).
  function agentSuggestSync() {
    if (!agentSuggest) return;
    if (canvasAgent.promptSuggestionsIntent && !agentSuggestFocusEligible()) canvasAgentDismissPromptSuggestions();
    agentSuggestRender();
  }
