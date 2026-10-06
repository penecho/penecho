  // Widget Assist: specific, one-tap help for an existing Widget.
  //
  //   1. Local rules read the Widget's own facts (runtime errors, animation,
  //      interactivity, scene source, new marks). Instant and free.
  //   2. PenEchoLLM ranks a closed menu of Widget actions from a snapshot of
  //      the Widget plus any new marks, exactly like Canvas Assist does for ink.
  //   3. Its ranking replaces local predictions; "none" hides suggestions.
  //      The Refine panel keeps marks, vivid and a typed Ask available.
  //
  // Local header suggestions are instant. Opening Refine requests PenEchoLLM
  // automatically; hovering never calls it. The panel shows its top three
  // recommendations alongside the explicit marks and vivid shortcuts.
  const WIDGET_ASSIST_TIMEOUT_MS = SMART_SUGGEST_TIMEOUT_MS,
    WIDGET_ASSIST_HEADER_LIMIT = 2,
    WIDGET_ASSIST_PANEL_LIMIT = 3,
    WIDGET_ASSIST_HEADER_MIN_SCORE = 0.2,
    WIDGET_ASSIST_CACHE_LIMIT = 64,
    SCENE_SOURCE_FORMAT = "penecho-scene+json",
    WIDGET_ASSIST_ICONS = Object.freeze({
      marks:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/></svg>',
      fix:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17v3h3l5.3-5.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4Z"/></svg>',
      layout:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4" width="17" height="16" rx="2"/><path d="M3.5 9h17M9 9v11"/></svg>',
      theme:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18c1 0 1.6-.8 1.2-1.7-.5-1.1.2-2.3 1.4-2.3H17a4 4 0 0 0 4-4c0-5.5-4-10-9-10Z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7.5" r="1"/></svg>',
      play:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5v14l11-7L7 5Z"/></svg>',
      replay:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4"/></svg>',
      slower:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 7v5l3 2"/><circle cx="12" cy="12" r="8.5"/></svg>',
      faster:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 6 7 6-7 6V6ZM12 6l7 6-7 6V6Z"/></svg>',
      vivid:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/></svg>',
      simplify:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M8 12h8M10.5 17h3"/></svg>',
      note:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>',
      present:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
      send:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
      close:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    });

  // One registry for every Widget action: labels, PenEchoLLM criteria (visual
  // evidence, not benefits), a local prior and the executor kind.
  //   kind "marks"  → Refine with the new marks as the instruction
  //   kind "refine" → focused in-place refinement or a separate derived Widget
  //   kind "note"   → create a separate note through the lasso note pipeline
  const WIDGET_ASSIST_ACTIONS = Object.freeze([
    { id:"apply_marks", kind:"marks", icon:"marks", label:{ en:"Refine with my marks", zh:"根据新笔迹完善" },
      criteria:"New dark handwriting, arrows or sketches on or next to the widget that ask for a change to it." },
    { id:"animate", kind:"refine", icon:"play", label:{ en:"Explain with animation", zh:"动画讲解" },
      criteria:"Teach the widget's concept, formula, physical mechanism, notes or diagram through meaningful timed stages, changing quantities or flow along its actual relationships. The subject is an idea or process; moving a depicted character or object is animate_sketch." },
    { id:"animate_sketch", kind:"refine", icon:"play", label:{ en:"Animate sketch", zh:"让画动起来" },
      criteria:"Make the widget's depicted person, animal, vehicle, plant or object itself move with coordinated motion, preserving the same subject and composition. Explaining a formula, concept, notes or diagram is animate." },
    // Always available in Refine. This explicit shortcut does not need ranking.
    // The selected illustration style supplies its label and instruction at run time.
    { id:"vivid", kind:"refine", panelDefault:true, icon:"vivid", label:{ en:"Storybook illustration", zh:"绘本插画" },
      styleLabels:{ storybook:{ en:"Storybook illustration", zh:"绘本插画" }, "3d":{ en:"3D illustration", zh:"立体插画" } },
      instruction:"Create a separate finished illustration Widget in the selected style, keeping the source's subject, meaning, text, data and controls. Preserve the original Widget unchanged." },
    { id:"note", kind:"note", icon:"note", label:{ en:"Make notes", zh:"生成笔记" },
      criteria:"A widget containing useful explanations, knowledge, formulas, decisions or findings worth saving as a reusable note card. Preserve the original widget." },
    { id:"simplify", kind:"refine", icon:"simplify", label:{ en:"Simplify", zh:"简化" },
      criteria:"A dense widget with too much text or visual clutter for its size.",
      instruction:"Simplify the widget: cut secondary text and visual clutter, keep the key message, data and structure." },
  ]);
  const widgetAssist = { cache:new Map(), inflight:new Map(), controllers:new Map(), retries:new Map(), sequence:0 };
  let widgetAssistMeasureContext = null;

  function widgetAssistLanguage() { return state.language === "zh" ? "zh" : "en"; }
  function widgetAssistActionLabel(action) {
    const names = action.styleLabels?.[PenEchoIllustrationStyle.normalize(state.illustrationStyle)] || action.label;
    return names[widgetAssistLanguage()] || names.en;
  }
  function widgetAssistInstruction(action) {
    if (action.id === "vivid") return PenEchoIllustrationStyle.widgetInstruction(state.illustrationStyle, state.illustrationBackground, { inPlace:false });
    if (action.id === "animate" || action.id === "animate_sketch") {
      // Reuse the established math/physics and character tasks verbatim.
      const task = ASSIST_AGENT_TASKS[action.id] + " Create one separate animated Widget with a new artifactId, preserving the original Widget unchanged. Let the host place the result in nearby free space beside or below the source.";
      return task + (action.id === "animate" ? " For notes, use their existing claims and order to build a short explanatory sequence: progressively reveal the relevant idea, show its example or relationship, and settle on a readable complete summary. For diagrams, trace one valid path or interaction through the existing nodes and directed edges; show requests, responses, dependencies, branch conditions and waits only when the source contains them. Keep the overall structure visible, preserve every label and relationship, and distinguish an illustrative path from measured timing. Do not invent missing facts, values, causal links or branch outcomes. Motion must explain the content; generic bouncing, spinning, flashing or a slideshow of unchanged paragraphs is insufficient. Preserve the widget's meaning, language, data and working controls." : " Preserve this widget's subject, composition, style and details. Animate its actual depicted parts rather than rebuilding it as an unrelated character. Keep existing text and controls readable.");
    }
    return action.instruction;
  }
  function widgetAssistChipWidth(label) {
    try {
      widgetAssistMeasureContext ||= document.createElement("canvas").getContext("2d");
      widgetAssistMeasureContext.font = '500 13px system-ui, -apple-system, "Segoe UI", "Noto Sans SC", sans-serif';
      // Match the header's 16 px icon, 5 px gap and two 9 px side paddings.
      return Math.ceil(Math.min(190, widgetAssistMeasureContext.measureText(String(label || "")).width + 39));
    } catch {
      return Math.min(190, 39 + String(label || "").length * 8);
    }
  }
  function widgetAssistHash(value) {
    let hash = 0x811c9dc5;
    const text = String(value || "");
    for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193);
    return (hash >>> 0).toString(36);
  }
  function widgetAssistSceneSpec(widget) {
    if (widget?.sourceFormat !== SCENE_SOURCE_FORMAT || typeof widget.copyText !== "string") return null;
    try { return JSON.parse(widget.copyText); } catch { return null; }
  }
  function widgetAssistMarks(widget) {
    const confirmation = state.widgetRefineConfirmation;
    if (confirmation?.widgetId === widget.id) return Boolean(confirmation.hasDirty);
    const candidate = currentWidgetRefineCandidate();
    return Boolean(candidate?.widget === widget && candidate.instructionMode === "nearby-dirty");
  }
  function widgetAssistFacts(widget) {
    const html = widget.widgetType === "diagram_source" ? "" : String(widget.html || ""),
      source = String(widget.widgetType === "diagram_source" ? widget.source || "" : widget.copyText || ""),
      formatKey = `${widget.widgetType}:${widget.sourceFormat || ""}`,
      scene = widgetAssistSceneSpec(widget),
      visual = widget.visualDiagnostics ? JSON.stringify(widget.visualDiagnostics).slice(0, 4000) : "";
    if (widget._assistFactsHtml === html && widget._assistFactsSource === source && widget._assistFactsFormat === formatKey && widget._assistFactsVisual === visual && widget._assistFacts) return widget._assistFacts;
    const facts = {
      type:widget.widgetType,
      format:widget.sourceFormat || (widget.widgetType === "diagram_source" ? widget.sourceFormat : "html"),
      diagram:widget.widgetType === "diagram_source",
      note:widget.sourceFormat === "penecho-note-card+json",
      scene:Boolean(scene),
      sceneEngine:scene?.engine || "",
      sceneSpeed:Number(scene?.speed) || 1,
      animated:Boolean(scene) || /requestAnimationFrame|@keyframes|<animate|setInterval\(|\.animate\(|transition:/i.test(html),
      controls:Boolean(scene) || /<button|type=["']range|<input/i.test(html),
      interactive:/addEventListener\(\s*["'](?:click|pointer|mouse|input|change|keydown|wheel)|onclick=|<input|<button|<select/i.test(html),
      errors:Number(widget.runtimeDiagnostics?.errors?.length) || 0,
      layoutIssues:/overflow|clip|overlap|truncat|too small/i.test(visual),
      size:html.length || source.length,
    };
    widget._assistFactsHtml = html;
    widget._assistFactsSource = source;
    widget._assistFactsFormat = formatKey;
    widget._assistFactsVisual = visual;
    widget._assistFacts = facts;
    widget._assistContentKey = widgetAssistHash(`${formatKey}\n${widget.title}\n${html.length}:${source.length}\n${html.slice(0, 4000)}${html.slice(-4000)}\n${source}\n${facts.errors}\n${visual.length}`);
    return facts;
  }
  // Local prior for each action: 0 means "not eligible here".
  function widgetAssistPrior(action, facts, widget, marks) {
    if (action.panelDefault) return 0;
    switch (action.id) {
      case "apply_marks": return marks ? 0.97 : 0;
      case "animate": return 0.16;
      case "animate_sketch": return 0.12;
      case "note": return facts.note ? 0 : 0.1;
      case "simplify": return facts.size > 9000 && !facts.scene ? 0.18 : 0.08;
      default: return 0;
    }
  }
  function widgetAssistEntry(widget) {
    const facts = widgetAssistFacts(widget),
      marks = widgetAssistMarks(widget),
      marksKey = marks ? `${state.userRevision || 0}:${JSON.stringify(state.dirty)}` : "0",
      key = `${widget.id}:${widget._assistContentKey}:${marksKey}:${widgetAssistLanguage()}`;
    return { facts, marks, key, cached:widgetAssist.cache.get(key) || null };
  }
  // Local predictions are a fallback until PenEchoLLM answers. A successful
  // answer owns the ranking, including the decision to suggest nothing.
  function widgetAssistSuggestions(widget, localOnly = false) {
    if (!widget) return [];
    const { facts, marks, cached } = widgetAssistEntry(widget),
      answer = localOnly ? null : cached?.answers?.action,
      probabilities = answer?.probabilities || null,
      ranked = [];
    if (answer?.choice === "none") return ranked;
    for (const action of WIDGET_ASSIST_ACTIONS) {
      const prior = widgetAssistPrior(action, facts, widget, marks);
      if (prior <= 0) continue;
      const score = probabilities ? Number(probabilities[action.id]) : prior;
      if (!Number.isFinite(score) || score <= 0) continue;
      const source = probabilities ? "penecho-llm" : "local";
      ranked.push({ id:action.id, kind:action.kind, icon:action.icon, label:widgetAssistActionLabel(action), tooltip:`${widgetAssistActionLabel(action)} · ${widgetAssistLanguage() === "zh" ? (source === "penecho-llm" ? "由 PenEchoLLM 排序" : "即时建议") : (source === "penecho-llm" ? "Ranked by PenEchoLLM" : "Instant suggestion")}`, score, action, source });
    }
    return ranked.sort((a, b) => b.score - a.score);
  }
  function widgetAssistHeaderSuggestions(widget) {
    if (!smartSuggest.enabled) return [];
    return widgetAssistSuggestions(widget)
      .filter(item => item.score >= WIDGET_ASSIST_HEADER_MIN_SCORE)
      .slice(0, WIDGET_ASSIST_HEADER_LIMIT);
  }
  function widgetAssistPanelSuggestions(widget) {
    if (!widgetAssistEntry(widget).cached?.answers) return [];
    return widgetAssistSuggestions(widget)
      .filter(item => item.id !== "apply_marks" && item.id !== "vivid")
      .slice(0, WIDGET_ASSIST_PANEL_LIMIT);
  }
  function widgetAssistPanelMore(widget, suggestions = widgetAssistPanelSuggestions(widget)) {
    const shown = new Set(suggestions.map(item => item.id)),
      more = widgetAssistSuggestions(widget).filter(item => item.id !== "apply_marks" && item.id !== "vivid" && !shown.has(item.id));
    // More exposes the remaining manual actions without changing ranking.
    // Existing note cards are excluded from every entry point.
    for (const action of WIDGET_ASSIST_ACTIONS) {
      if (action.kind === "marks" || action.panelDefault || action.id === "note" && widgetAssistEntry(widget).facts.note || shown.has(action.id) || more.some(item => item.id === action.id)) continue;
      more.push({ id:action.id, kind:action.kind, icon:action.icon, label:widgetAssistActionLabel(action), action, source:"local" });
    }
    return more;
  }
  function widgetAssistRemote() {
    // Manual Refine suggestions do not depend on the automatic ink setting.
    return smartSuggest.available && !suggestionAccessBlocked()
      && typeof authenticatedApiHeaders === "function";
  }
  function widgetAssistCropRegion(widget) {
    let region = widgetBox(widget);
    const visible = viewportRect();
    if (widgetAssistMarks(widget) && state.dirty && visible) {
      const dirty = intersection(state.dirty, visible);
      if (dirty) {
        const x = Math.min(region.x, dirty.x), y = Math.min(region.y, dirty.y);
        region = { x, y, w:Math.max(region.x + region.w, dirty.x + dirty.w) - x, h:Math.max(region.y + region.h, dirty.y + dirty.h) - y };
      }
    }
    const pad = 8;
    return { x:region.x - pad, y:region.y - pad, w:region.w + pad * 2, h:region.h + pad * 2 };
  }
  function widgetAssistCrop(widget, region, marks = false) {
    if (!widget.snapshotImage) return "";
    // Use the widget's own snapshot so overlapping canvas objects cannot hide
    // its content. Preserve source detail even when the widget is scaled down.
    const sourceScale = Math.max(1, Math.min(widget.snapshotImage.width / widget.w, widget.snapshotImage.height / widget.h)),
      scale = Math.min(sourceScale, SMART_SUGGEST_CROP_SIDE / Math.max(region.w, region.h)),
      out = document.createElement("canvas");
    out.width = Math.max(16, Math.round(region.w * scale));
    out.height = Math.max(16, Math.round(region.h * scale));
    const context = out.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, out.width, out.height);
    context.save();
    context.setTransform(scale, 0, 0, scale, -region.x * scale, -region.y * scale);
    context.drawImage(widget.snapshotImage, widget.x, widget.y, widget.w, widget.h);
    const dirty = marks && state.dirty && intersection(state.dirty, region);
    if (dirty) {
      context.beginPath();
      context.rect(dirty.x, dirty.y, dirty.w, dirty.h);
      context.clip();
      forTiles(dirty.x, dirty.y, dirty.w, dirty.h, (canvas, tx, ty) => {
        context.drawImage(canvas, tx * TILE, ty * TILE);
      }, false);
      drawSharpOverlays(context, dirty);
    }
    context.restore();
    return smartSuggestEncodeImage(out);
  }
  function widgetAssistQuestions(widget, facts, marks) {
    const criteria = { none:"No useful edit, note capture or presentation is apparent, or the view is unclear." };
    for (const action of WIDGET_ASSIST_ACTIONS) if (widgetAssistPrior(action, facts, widget, marks) > 0) criteria[action.id] = action.criteria;
    const questions = {
      action:{ type:"choice", instructions:"The image shows one canvas widget (and any new dark marks near it). Which single follow-up would most help the user with this widget right now? Choose none unless clearly useful.", criteria },
    };
    if (marks) questions.marks_intent = { type:"noul", instructions:"Probability that the new dark marks near the widget are an edit request for this widget (rather than unrelated notes)." };
    return questions;
  }
  function widgetAssistFactText(widget, facts, marks) {
    return [
      `widget: ${widget.widgetType} format=${facts.format} title="${String(widget.title || "").slice(0, 80)}"`,
      `animation_code_detected=${facts.animated} (a code heuristic, not proof of meaningful animation) controls=${facts.controls} interactive=${facts.interactive} scene=${facts.scene ? facts.sceneEngine || "motion" : "no"}`,
      `runtime_errors=${facts.errors} layout_warnings=${facts.layoutIssues} source_chars=${facts.size}`,
      `new_marks_near_widget=${marks}`,
      `screen_width_px=${Math.round(widget.w * state.scale)} locale=${widgetAssistLanguage()}`,
    ].join("\n");
  }
  // Ranks the Widget's actions with PenEchoLLM after an explicit request.
  // Cached per Widget content, marks and language; opening Refine reuses a
  // matching result without spending another request.
  function cancelWidgetAssistSuggestions() {
    for (const controller of widgetAssist.controllers.values()) controller.abort();
    widgetAssist.controllers.clear();
    widgetAssist.inflight.clear();
    for (const retry of widgetAssist.retries.values()) clearTimeout(retry.timer);
    widgetAssist.retries.clear();
  }
  function widgetAssistVisible(widget, key = widgetAssistEntry(widget).key) {
    const confirmation = state.widgetRefineConfirmation;
    return confirmation?.widgetId === widget.id && confirmation.assistRequestedKey === key
      && widgetAssistEntry(widget).key === key;
  }
  function resumeWidgetAssistSuggestions() {
    for(const widget of state.widgets)if(widgetAssistVisible(widget))void widgetAssistPrefetch(widget,"recovery");
  }
  function retryWidgetAssist(widget,key,reason) {
    if(!widgetAssistRemote()||!state.widgets.includes(widget)||!widgetAssistVisible(widget,key))return;
    const previous=widgetAssist.retries.get(widget.id),attempt=(previous?.key===key?previous.attempt:0)+1;
    if(attempt>1)return;
    if(previous)clearTimeout(previous.timer);
    const documentId=canvasDocumentsCurrent().id;
    const delay=reason==="rate_limited"||reason==="http-429"?30000:Math.min(10000,2000*2**Math.min(3,attempt-1));
    const retry={key,attempt,timer:setTimeout(()=>{
      retry.timer=0;
      if(canvasDocumentsCurrent().id!==documentId||!state.widgets.includes(widget)||!widgetAssistVisible(widget,key)){widgetAssist.retries.delete(widget.id);return;}
      if(document.visibilityState!=="hidden")void widgetAssistPrefetch(widget,"retry");
    },delay)};
    widgetAssist.retries.set(widget.id,retry);
  }
  function widgetAssistPrefetch(widget, reason = "hover") {
    if (!widget || !state.widgets.includes(widget) || widget.pending) return null;
    const { facts, marks, key, cached } = widgetAssistEntry(widget);
    if (!widgetAssistVisible(widget, key)) return null;
    if (cached) return Promise.resolve(cached.answers);
    if (widgetAssist.inflight.has(key)) return widgetAssist.inflight.get(key);
    if (!widgetAssistRemote()) return null;
    const retry=widgetAssist.retries.get(widget.id);
    if(retry?.key===key&&retry.timer)return null;
    if(retry?.key===key&&retry.started)return null;
    if(retry&&retry.key!==key){clearTimeout(retry.timer);widgetAssist.retries.delete(widget.id);}
    if(retry?.key===key)retry.started=true;
    let timer = 0;
    const controller = new AbortController(),
      sequence = ++widgetAssist.sequence,
      // Register ownership before an unavailable image can release the slot.
      promise = Promise.resolve().then(async () => {
        try {
          const region = widgetAssistCropRegion(widget);
          if (controller.signal.aborted || !widgetAssistRemote() || !state.widgets.includes(widget) || !widgetAssistVisible(widget, key)) return null;
          // The model must see this Widget's current pixels, so it is captured
          // first (unless it was captured moments ago) under its own deadline;
          // the model deadline starts only when the request is sent.
          if (!widgetSnapshotFresh(widget) || !(performance.now() - (widget.snapshotTakenAt || -Infinity) <= WIDGET_CLASSIFY_SNAPSHOT_REUSE_MS)) {
            try { await requestWidgetSnapshot(widget, WIDGET_CLASSIFY_SNAPSHOT_TIMEOUT_MS, true, controller.signal); }
            catch (error) {
              if (controller.signal.aborted) return null;
              debug("widget-assist-snapshot-unavailable", { widgetId:widget.id, code:error?.code || null, error:String(error?.message || error).slice(0, 200) });
            }
            if (controller.signal.aborted || !widgetAssistRemote() || !state.widgets.includes(widget) || !widgetAssistVisible(widget, key) || !widgetSnapshotFresh(widget)) return null;
          }
          const image = widgetAssistCrop(widget, region, marks);
          if (!image) return null;
          timer = setTimeout(() => controller.abort(), WIDGET_ASSIST_TIMEOUT_MS);
          const response = await fetch(suggestionApiPath(), {
              method:"POST",
              credentials:"same-origin",
              signal:controller.signal,
              headers:authenticatedApiHeaders({ "Content-Type":"application/json", Accept:"application/json", "X-PenEcho-Suggest":"1" }),
              body:JSON.stringify({version:1,mode:"widget",image,context:{marks:Boolean(marks),actions:WIDGET_ASSIST_ACTIONS.filter(action=>widgetAssistPrior(action,facts,widget,marks)>0).map(action=>action.id),animated:Boolean(facts.animated),controls:Boolean(facts.controls),interactive:Boolean(facts.interactive),scene:Boolean(facts.scene),errors:Math.min(1000,Math.max(0,Number(facts.errors)||0)),layoutIssues:Math.min(1000,Math.max(0,Number(facts.layoutIssues)||0))}}),
            }),
            data = await response.json().catch(() => null);
          if (controller.signal.aborted || !widgetAssistRemote() || !state.widgets.includes(widget) || !widgetAssistVisible(widget, key)) return null;
          updateSuggestionAccess(data);
          if (!response.ok || !data?.ok || !data.answers) {
            requestInteractionLayerRender();
            const failure=data?.reason || data?.error || `http-${response.status}`;
            if(!/^(invalid|invalid_action_space|forbidden|http-40[013])$/.test(failure))retryWidgetAssist(widget,key,failure);
            debug("widget-assist-failed", { reason:failure, trigger:reason });
            return null;
          }
          widgetAssist.cache.set(key, { answers:data.answers, at:Date.now(), sequence });
          widgetAssist.retries.delete(widget.id);
          while (widgetAssist.cache.size > WIDGET_ASSIST_CACHE_LIMIT) widgetAssist.cache.delete(widgetAssist.cache.keys().next().value);
          debug("widget-assist-ranked", { widgetId:widget.id, trigger:reason, choice:data.answers.action?.choice, latencyMs:data.latencyMs });
          requestInteractionLayerRender();
          return data.answers;
        } catch (error) {
          if(widgetAssist.controllers.get(key)===controller)retryWidgetAssist(widget,key,error?.name==="AbortError"?"timeout":"network");
          if (!controller.signal.aborted) debug("widget-assist-failed", { reason:String(error?.message || error).slice(0, 200), trigger:reason });
          return null;
        } finally {
          clearTimeout(timer);
          if (widgetAssist.controllers.get(key) === controller) {
            widgetAssist.controllers.delete(key);
            widgetAssist.inflight.delete(key);
          }
          if (state.widgetRefineConfirmation?.widgetId === widget.id) requestInteractionLayerRender();
        }
      });
    widgetAssist.controllers.set(key, controller);
    widgetAssist.inflight.set(key, promise);
    return promise;
  }
  function widgetAssistPending(widget) {
    if (!widget) return false;
    return widgetAssist.inflight.has(widgetAssistEntry(widget).key);
  }
  async function requestWidgetAssistSuggestions(widget) {
    const confirmation = state.widgetRefineConfirmation;
    if (!widget || confirmation?.widgetId !== widget.id || !state.widgets.includes(widget)) return null;
    const key = widgetAssistEntry(widget).key;
    if (widgetAssistPending(widget)) return widgetAssist.inflight.get(key);
    cancelWidgetAssistSuggestions();
    confirmation.assistRequestedKey = key;
    confirmation.assistStatus = "pending";
    const request = widgetAssistPrefetch(widget, "click");
    requestInteractionLayerRender();
    const answers = await request;
    if (state.widgetRefineConfirmation === confirmation && widgetAssistVisible(widget, key)) {
      confirmation.assistStatus = answers ? "ranked" : widgetAssistRemote() ? "failed" : "unavailable";
      requestInteractionLayerRender();
    }
    return answers;
  }

  // ---------- Executors ----------
  async function replaceSceneSpec(widget, update) {
    const runtime = window.PENECHO_SCENE;
    const spec = widgetAssistSceneSpec(widget);
    if (!runtime || !spec) return false;
    let next;
    try {
      next = runtime.normalize(update(structuredClone(spec)) || spec);
    } catch (error) {
      debug("scene-local-edit-failed", { error:String(error?.message || error).slice(0, 200) });
      return false;
    }
    const source = JSON.stringify(next, null, 2),
      command = {
        tool:"html_widget",
        pluginId:widget.pluginId,
        title:widget.title,
        refreshSeconds:widget.refreshSeconds || 0,
        html:runtime.documentFor(next, { title:widget.title, language:widgetAssistLanguage() }),
        sourceFormat:SCENE_SOURCE_FORMAT,
        frameworkVersion:runtime.FRAMEWORK_VERSION,
        copyText:source,
        copyLabel:runtime.COPY_LABEL,
      };
    return startPendingWidgetReplacement(command, widget, state.userRevision);
  }
  function postSceneControl(widget, action) {
    if (!widget?.frame?.contentWindow || !widget.hostReady) return false;
    widget.frame.contentWindow.postMessage({ type:"penecho-scene-control", action }, widget.hostOrigin || location.origin);
    return true;
  }
  function runWidgetAssistLocal(widget, id) {
    if (id === "scene_replay") return postSceneControl(widget, "replay");
    if (id === "scene_slower") return replaceSceneSpec(widget, spec => ({ ...spec, speed:Math.max(0.25, Math.round((Number(spec.speed) || 1) * 0.67 * 100) / 100) }));
    if (id === "scene_faster") return replaceSceneSpec(widget, spec => ({ ...spec, speed:Math.min(4, Math.round((Number(spec.speed) || 1) * 1.5 * 100) / 100) }));
    if (id === "present") return enterWidgetInteraction(widget);
    return false;
  }
  function runWidgetAssistAction(widget, suggestion, surface = "header") {
    if (!widget || !suggestion || !state.widgets.includes(widget)) return false;
    const action = suggestion.action || WIDGET_ASSIST_ACTIONS.find(item => item.id === suggestion.id);
    if (!action) return false;
    debug("widget-assist-action", { widgetId:widget.id, action:action.id, surface });
    if (action.kind === "note") {
      if (widgetAssistEntry(widget).facts.note) return false;
      if (state.widgetRefineConfirmation?.widgetId === widget.id) cancelWidgetRefineConfirmation();
      return organizeWidgetAsNote(widget);
    }
    if (action.kind === "local") {
      if (state.widgetRefineConfirmation?.widgetId === widget.id) cancelWidgetRefineConfirmation();
      return runWidgetAssistLocal(widget, action.id);
    }
    const panelOpen = state.widgetRefineConfirmation?.widgetId === widget.id;
    if (action.kind === "marks") {
      const candidate = widgetHeaderRefineCandidate(widget),
        mode = candidate.instructionMode === "nearby-dirty" ? "nearby-dirty" : "viewport-dirty";
      const options = { instructionMode:mode, actionId:action.id };
      return panelOpen ? confirmWidgetRefinement(options) : requestWidgetRefinement(widget, mode, options);
    }
    const options = { instructionMode:"action", instruction:widgetAssistInstruction(action), actionId:action.id };
    triggerWidgetRefineClickPulse(widget.id);
    return panelOpen ? confirmWidgetRefinement(options) : requestWidgetRefinement(widget, "action", options);
  }
  async function submitWidgetAsk(widget, text) {
    const instruction = String(text || "").trim().slice(0, 600);
    if (!widget || !instruction) return false;
    const options = { instructionMode:"ask", instruction, actionId:"ask" };
    return state.widgetRefineConfirmation?.widgetId === widget.id
      ? confirmWidgetRefinement(options)
      : requestWidgetRefinement(widget, "ask", options);
  }

  // ---------- Refine panel ----------
  function createWidgetRefinePanel() {
    const element = document.createElement("div");
    element.className = "widget-refine-confirmation widget-refine-panel";
    element.setAttribute("role", "dialog");
    element.addEventListener("pointerdown", event => event.stopPropagation());
    element.addEventListener("wheel", event => event.stopPropagation(), { passive:true });
    element.addEventListener("keydown", event => {
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        cancelWidgetRefineConfirmation();
      }
    });
    return element;
  }
  function widgetRefinePanelButton(className, icon, label, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.innerHTML = WIDGET_ASSIST_ICONS[icon] || OBJECT_CHROME_ICONS[icon] || "";
    const text = document.createElement("span");
    text.textContent = label;
    button.append(text);
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    });
    return button;
  }
  function renderWidgetRefinePanel(element, confirmation, widget) {
    const entry = widgetAssistEntry(widget),
      requested = confirmation.assistRequestedKey === entry.key,
      ranked = requested && Boolean(entry.cached?.answers),
      suggestions = ranked ? widgetAssistPanelSuggestions(widget) : [],
      more = widgetAssistPanelMore(widget, suggestions),
      pending = widgetAssistPending(widget),
      status = ranked ? "ranked" : pending ? "pending" : requested ? confirmation.assistStatus : "idle",
      allowance = typeof suggestionAllowance === "function" ? suggestionAllowance() : null,
      renderKey = JSON.stringify([widget.id, confirmation.hasDirty, suggestions.map(item => item.id), more.map(item => item.id), status, allowance?.remaining ?? null, allowance?.blocked ?? false, widgetAssistLanguage()]);
    if (element.dataset.renderKey === renderKey) return;
    const draft = element.querySelector("input")?.value || "",
      hadFocus = element.contains(document.activeElement) && document.activeElement?.tagName === "INPUT",
      hadSuggestFocus = document.activeElement === element.querySelector(".widget-refine-panel-suggest");
    element.dataset.renderKey = renderKey;
    element.replaceChildren();
    const head = document.createElement("div"),
      title = document.createElement("span"),
      close = document.createElement("button");
    head.className = "widget-refine-panel-head";
    title.className = "widget-refine-panel-title";
    title.innerHTML = OBJECT_CHROME_ICONS.refine;
    title.append(document.createTextNode(t("widgetRefinePanelTitle")));
    close.type = "button";
    close.className = "widget-refine-panel-close";
    close.innerHTML = WIDGET_ASSIST_ICONS.close;
    close.setAttribute("aria-label", t("widgetRefineCancel"));
    close.addEventListener("click", event => { event.preventDefault(); event.stopPropagation(); cancelWidgetRefineConfirmation(); });
    head.append(title, close);
    element.append(head);
    element.setAttribute("aria-label", `${t("widgetRefinePanelTitle")} · ${widget.title}`);
    if (confirmation.hasDirty) {
      const marks = widgetRefinePanelButton("widget-refine-panel-marks", "marks", t("widgetRefineApplyMarks"),
        () => confirmWidgetRefinement({ instructionMode:confirmation.instructionMode }));
      marks.title = t(confirmation.instructionMode === "nearby-dirty" ? "widgetRefineNearbyHint" : "widgetRefineViewportHint");
      element.append(marks);
    }
    const vivid = WIDGET_ASSIST_ACTIONS.find(action => action.id === "vivid"),
      vividButton = widgetRefinePanelButton("widget-refine-panel-chip kind-refine", vivid.icon, widgetAssistActionLabel(vivid),
        () => runWidgetAssistAction(widget, { action:vivid }, "panel"));
    const defaults = document.createElement("div");
    defaults.className = "widget-refine-panel-chips";
    vividButton.dataset.source = "default";
    vividButton.dataset.actionId = vivid.id;
    defaults.append(vividButton);
    element.append(defaults);
    const suggest = penechoLLMBadge(pending ? "pending" : ranked ? "ranked" : "local",
      t(pending ? "widgetAssistRanking" : ranked ? "widgetAssistRankedByLLM" : "widgetAssistGetSuggestions"),
      status === "failed" || status === "unavailable" ? "button" : "span", suggestionAllowanceShort(allowance));
    suggest.classList.add("widget-refine-panel-suggest");
    suggest.classList.toggle("is-low", Boolean(allowance?.low || allowance?.blocked));
    suggest.setAttribute("role", "status");
    if (suggest.tagName === "BUTTON") {
      suggest.type = "button";
      suggest.removeAttribute("role");
      suggest.title = t("widgetAssistGetSuggestionsHint");
      suggest.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        void requestWidgetAssistSuggestions(widget);
      });
    }
    element.append(suggest);
    if (requested && (status === "failed" || status === "unavailable" || (ranked && !suggestions.length))) {
      const message = document.createElement("div");
      message.className = "widget-refine-panel-status";
      message.setAttribute("role", "status");
      message.textContent = t(ranked ? "widgetAssistNone" : status === "unavailable" ? "widgetAssistUnavailable" : "widgetAssistFailed");
      element.append(message);
    }
    if (suggestions.length) {
      const list = document.createElement("div");
      list.className = "widget-refine-panel-chips";
      for (const suggestion of suggestions) {
        const chip = widgetRefinePanelButton(`widget-refine-panel-chip kind-${suggestion.kind}`, suggestion.icon, suggestion.label,
          () => runWidgetAssistAction(widget, suggestion, "panel"));
        chip.dataset.source = suggestion.source || "local";
        chip.dataset.actionId = suggestion.id;
        if (suggestion.kind === "local") chip.title = t("widgetAssistLocalHint");
        list.append(chip);
      }
      element.append(list);
    }
    if (more.length) {
      const details = document.createElement("details"), summary = document.createElement("summary"), list = document.createElement("div");
      details.className = "widget-refine-panel-more";
      summary.textContent = t("smartSuggestMore");
      list.className = "widget-refine-panel-chips";
      for (const suggestion of more) {
        const chip = widgetRefinePanelButton(`widget-refine-panel-chip kind-${suggestion.kind}`, suggestion.icon, suggestion.label,
          () => runWidgetAssistAction(widget, suggestion, "panel-more"));
        chip.dataset.actionId = suggestion.id;
        chip.dataset.source = suggestion.source || "local";
        list.append(chip);
      }
      details.append(summary, list);
      element.append(details);
    }
    const form = document.createElement("form"),
      input = document.createElement("input"),
      send = document.createElement("button");
    form.className = "widget-refine-panel-ask";
    input.type = "text";
    input.maxLength = 600;
    input.placeholder = t("widgetAskPlaceholder");
    input.setAttribute("aria-label", t("widgetAskPlaceholder"));
    input.value = draft;
    send.type = "submit";
    send.innerHTML = WIDGET_ASSIST_ICONS.send;
    send.setAttribute("aria-label", t("widgetAskSend"));
    form.addEventListener("submit", event => {
      event.preventDefault();
      event.stopPropagation();
      submitWidgetAsk(widget, input.value);
    });
    form.append(input, send);
    element.append(form);
    const accessNotice=suggestionAccessNotice();if(accessNotice)element.append(accessNotice);
    if (hadFocus) input.focus({ preventScroll:true });
    else if (hadSuggestFocus) (suggest.tagName === "BUTTON" ? suggest : input).focus({ preventScroll:true });
  }
  // A press anywhere outside the panel and the header closes the panel.
  document.addEventListener("pointerdown", event => {
    if (!state.widgetRefineConfirmation) return;
    if (event.target?.closest?.(".widget-refine-panel, .object-chrome-button")) return;
    cancelWidgetRefineConfirmation();
  }, true);
