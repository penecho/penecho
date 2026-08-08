// AI requests, validation, generated drafts, plotting, and draft interaction.
  let aiPreparationGeneration = 0,
    aiPreparation = null;
  const AI_STREAM_IDLE_GRACE_MS = 10_000;
  function aiTimeoutMultiplier(effort) {
    return ["xhigh", "max"].includes(String(effort || "").trim().toLowerCase()) ? 2 : 1;
  }
  function activeAiRequestTimeoutMs() {
    const effort = state.reasoningEffort === "config" ? configuredAiEffort : state.reasoningEffort;
    return state.aiRequestTimeoutMs * aiTimeoutMultiplier(effort);
  }
  function createActivityAwareAbortTimeout(controller, totalTimeoutMs, idleGraceMs = AI_STREAM_IDLE_GRACE_MS) {
    const deadline = Date.now() + totalTimeoutMs;
    let lastActivityAt = null, timer = 0, cleared = false;
    const schedule = delay => { timer = setTimeout(check, Math.max(1, Math.ceil(delay))); };
    const check = () => {
      if (cleared || controller.signal.aborted) return;
      const now = Date.now();
      if (now < deadline) return schedule(deadline - now);
      if (lastActivityAt !== null && now - lastActivityAt < idleGraceMs) return schedule(idleGraceMs - (now - lastActivityAt));
      controller.abort();
    };
    schedule(totalTimeoutMs);
    return {
      activity() { if (!cleared && !controller.signal.aborted) lastActivityAt = Date.now(); },
      clear() { cleared = true; clearTimeout(timer); timer = 0; },
    };
  }
  function activeWidgetRefinement() {
    return aiPreparation?.widgetEdit || state.activeAI?.widgetEdit || null;
  }
  function finishAIPreparation(preparation) {
    if (aiPreparation !== preparation) return false;
    aiPreparation = null;
    if (!state.activeAI) {
      setBusy(false);
      state.summonAnchor = null;
    }
    return true;
  }
  function aiPreparationInvalid(preparation, generation, revision) {
    if (generation !== aiPreparationGeneration || preparation.superseded || aiPreparation !== preparation) return true;
    if (state.userRevision === revision) return false;
    preparation.superseded = true;
    preparation.controller.abort();
    finishAIPreparation(preparation);
    setStatusKey("deferred");
    return true;
  }
  function supersedeActiveAI(reason) {
    aiPreparationGeneration++;
    const preparation = aiPreparation;
    let cancelled = false;
    if (preparation && !preparation.superseded) {
      preparation.superseded = true;
      preparation.controller.abort();
      if (aiPreparation === preparation) aiPreparation = null;
      cancelled = true;
      debug("ai-deferred", { requestId:state.lastRequestId, reason, phase:"preparing" });
    }
    const active = state.activeAI;
    if (active && !active.superseded) {
      const wasCurrent = state.activeAI === active;
      active.superseded = true;
      active.controller.abort();
      if (wasCurrent) {
        state.activeAI = null;
        setBusy(false);
        setStatusKey(reason === "user-input-started" ? "aiCancelledForInput" : "aiCancelled");
      }
      if ((reason === "user-stop" || !active.dirtyRestored) && !active.oneShotInput && active.recognitionGeneration === state.recognitionGeneration) {
        restoreDirty(active.dirtySnapshot);
        active.dirtyRestored = true;
        state.autoEligible = Boolean(state.dirty);
        if (reason === "user-stop") refreshWidgetRefineHoverCandidate();
      }
      debug("ai-deferred", { requestId: state.lastRequestId, reason });
    }
    if (cancelled && !state.activeAI) {
      setBusy(false);
      state.summonAnchor = null;
      setStatusKey(reason === "user-input-started" ? "aiCancelledForInput" : "aiCancelled");
      if (reason === "user-stop") refreshWidgetRefineHoverCandidate();
    }
  }
  function stopActiveAIRequests() {
    const active = state.activeAI || aiPreparation;
    if (!active || active.superseded) return false;
    state.radialGesture = null;
    state.radialSuppressClickUntil = performance.now() + 450;
    closeRadialMenu();
    supersedeActiveAI("user-stop");
    return true;
  }
  function hasUnsettledToolbox() {
    return Boolean(state.pending || state.pendingWidget || state.pendingGesture || state.widgetEdit || state.widgetGesture || state.imageEdit || state.imageGesture || state.imageImporting || state.selection || state.selectionGesture || state.textEditors.size);
  }
  const AI_PROGRESS_STATUS_KEYS = Object.freeze({
    received:"aiRequestReceived",
    "preparing-image":"aiPreparingImage",
    connecting:"aiConnecting",
    waiting:"aiWaitingResponse",
    receiving:"aiReceivingResponse",
    validating:"aiValidatingResponse",
    retrying:"aiRetrying",
    "image-fallback":"aiImageFallback",
    slow:"aiStillWaiting",
  });
  function aiProgressText(event) {
    const key=AI_PROGRESS_STATUS_KEYS[event?.phase];
    if(!key)return "";
    return t(key)
      .replace("{attempt}",String(Math.max(1,Number(event.attempt)||1)))
      .replace("{seconds}",String(Math.max(10,Number(event.timeoutSeconds)||10)));
  }
  function applyAiProgress(run,event) {
    if(!run||run.superseded||state.activeAI!==run)return;
    const previous=state.aiProgressEvent;
    if(event?.phase==="waiting"&&["retrying","image-fallback"].includes(previous?.phase)&&previous.attempt===event.attempt)return;
    const text=aiProgressText(event);
    if(!text)return;
    if(event.requestId)run.requestId=event.requestId;
    state.aiProgressEvent={phase:event.phase,attempt:event.attempt||null,requestId:event.requestId||null,timeoutSeconds:event.timeoutSeconds||null};
    setStatus(text,AI_PROGRESS_STATUS_KEYS[event.phase]);
  }
  async function readAiCommandResponse(response,onProgress,onActivity) {
    onActivity?.();
    const contentType=String(response.headers.get("content-type")||"").split(";",1)[0].trim().toLowerCase();
    if(contentType!=="application/x-ndjson")return{ok:response.ok,status:response.status,data:await response.json()};
    if(!response.body)throw new Error("PenEcho returned an empty progress stream.");
    const reader=response.body.getReader(),decoder=new TextDecoder();
    let buffer="",terminal=null;
    const consume=(line)=>{
      if(!line.trim())return;
      let event;
      try{event=JSON.parse(line)}catch{throw new Error("PenEcho returned an invalid progress event.")}
      if(event?.type==="progress")onProgress?.(event);
      else if(event?.type==="result"||event?.type==="error")terminal=event;
    };
    while(true){
      const{done,value}=await reader.read();
      if(value?.byteLength)onActivity?.();
      buffer+=decoder.decode(value||new Uint8Array(),{stream:!done});
      let newline;
      while((newline=buffer.indexOf("\n"))>=0){consume(buffer.slice(0,newline));buffer=buffer.slice(newline+1)}
      if(done)break;
    }
    if(buffer.trim())consume(buffer);
    if(!terminal)throw new Error("PenEcho progress stream ended before the model response arrived.");
    const status=Number.isInteger(terminal.status)?terminal.status:terminal.type==="result"?200:500;
    return{ok:terminal.type==="result"&&status>=200&&status<300,status,data:terminal.data||{}};
  }
  function launchAutomaticAI(reason) {
    if (state.mode === "hand" || !state.auto || !state.dirty || !state.autoEligible || state.drawing || state.widgetRefineConfirmation) return;
    if (aiPreparation || state.activeAI) return;
    if (currentWidgetRefineCandidate()) {
      if (state.statusKey !== "widgetRefinePending") setStatusKey("widgetRefinePending");
      return;
    }
    if (hasUnsettledToolbox()) {
      if (state.statusKey !== "autoToolboxPending") setStatusKey("autoToolboxPending");
      return;
    }
    clearWidgetRefineCandidate();
    supersedeActiveAI(reason);
    requestAI("auto");
  }
  function schedule(delay = state.autoDelayMs) {
    clearTimeout(state.timer);
    state.timer = 0;
    if (state.mode === "hand" || !state.auto || !state.dirty || !state.autoEligible) return;
    if (activeWidgetRefinement() || state.widgetRefineConfirmation) return;
    if (currentWidgetRefineCandidate()) {
      if (state.statusKey !== "widgetRefinePending") setStatusKey("widgetRefinePending");
      return;
    }
    state.timer = setTimeout(() => {
      state.timer = 0;
      launchAutomaticAI("new-stroke-deadline");
    }, Math.max(0, delay));
  }
  function inkBox(c, scanWidth = c.width, scanHeight = c.height) {
    const width = Math.max(0, Math.min(c.width, Math.floor(scanWidth))),
      height = Math.max(0, Math.min(c.height, Math.floor(scanHeight)));
    if (!width || !height) return null;
    const d = c.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, width, height).data;
    let x0 = width,
      y0 = height,
      x1 = -1,
      y1 = -1;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (d[i + 3] && !(d[i] > 248 && d[i + 1] > 248 && d[i + 2] > 248)) {
          x0 = Math.min(x0, x);
          y0 = Math.min(y0, y);
          x1 = Math.max(x1, x);
          y1 = Math.max(y1, y);
        }
      }
    return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }
  function intersection(a, b) {
    const x = Math.max(a.x, b.x),
      y = Math.max(a.y, b.y),
      right = Math.min(a.x + a.w, b.x + b.w),
      bottom = Math.min(a.y + a.h, b.y + b.h);
    return right > x && bottom > y ? { x, y, w: right - x, h: bottom - y } : null;
  }
  function containsRect(outer, inner) {
    return Boolean(outer && inner
      && inner.x >= outer.x && inner.y >= outer.y
      && inner.x + inner.w <= outer.x + outer.w
      && inner.y + inner.h <= outer.y + outer.h);
  }
  async function requestAI(action, packedOverride = null, requestOptions = null) {
    requestOptions = requestOptions || {};
    const automatic = action === "auto";
    if (!automatic) {
      clearTimeout(state.timer);
      state.timer = 0;
    }
    const preparationGeneration = ++aiPreparationGeneration;
    clearWidgetRefineCandidate();
    const isolatedSelection = Boolean(requestOptions.isolatedSelection),
      oneShotInput = Boolean(requestOptions.oneShotInput),
      captureCurrentViewport = Boolean(requestOptions.captureCurrentViewport),
      widgetEditTarget = requestOptions.widgetEditTarget || null,
      widgetEditContext = requestOptions.widgetEditContext || null,
      requestedAttentionBox = requestOptions.attentionBox || null,
      revision = state.userRevision,
      recognitionGeneration = state.recognitionGeneration,
      aiColor = state.aiColor,
      dirtySnapshot = state.dirty ? { ...state.dirty } : null,
      latestBox = dirtySnapshot || state.lastUserBox,
      hotspotCount = isolatedSelection ? 0 : state.hotspotTrail.length,
      controller = new AbortController(),
      preparation = {
        controller,
        generation:preparationGeneration,
        superseded:false,
        widgetEdit:widgetEditTarget ? { target:widgetEditTarget, targetId:widgetEditTarget.id, pluginId:widgetEditTarget.pluginId, revision } : null,
      };
    let attentionBox = dirtySnapshot || (captureCurrentViewport ? null : latestBox);
    if (requestedAttentionBox) attentionBox = requestedAttentionBox;
    aiPreparation = preparation;
    state.summonAnchor = dirtySnapshot || state.lastUserBox || null;
    setBusy(true);
    setStatusKey("aiPreparingCanvas");
    if (pluginEnabled("flowchart")) {
      try { await ensurePluginRuntime("flowchart"); }
      catch (error) {
        if (aiPreparationInvalid(preparation, preparationGeneration, revision)) return;
        debug("ai-preparation-degraded", { stage:"flowchart-runtime", error:String(error?.message || error).slice(0, 300) });
      }
    }
    if (aiPreparationInvalid(preparation, preparationGeneration, revision)) return;
    let capturePlan = null,
      packed = packedOverride;
    if (!packed) {
      try {
        capturePlan = captureCurrentViewport || attentionBox ? planViewportImage(attentionBox, captureCurrentViewport) : null;
      } catch (error) {
        debug("ai-preparation-degraded", { stage:"capture-plan", error:String(error?.message || error).slice(0, 300) });
      }
      let snapshotRegion = capturePlan?.sourceRect || null;
      if (!snapshotRegion) {
        try { snapshotRegion = viewportRect(); } catch {}
      }
      const snapshots = await prepareVisibleWidgetSnapshots(snapshotRegion);
      if (snapshots.missing) debug("ai-preparation-degraded", { stage:"widget-snapshot", ...snapshots });
      if (aiPreparationInvalid(preparation, preparationGeneration, revision)) return;
      try {
        packed = captureCurrentViewport || attentionBox
          ? buildViewportImage(state.hotspotTrail.slice(0, hotspotCount), attentionBox, captureCurrentViewport, capturePlan)
          : null;
      } catch (error) {
        debug("ai-preparation-degraded", { stage:"viewport-atlas", error:String(error?.message || error).slice(0, 300) });
      }
      if (!packed) {
        packed = emergencyViewportImage(state.hotspotTrail.slice(0, hotspotCount), attentionBox);
        debug("ai-preparation-degraded", { stage:"viewport-atlas-fallback", sourceRect:packed.sourceRect, atlasSize:packed.atlasSize });
      }
    }
    if (aiPreparationInvalid(preparation, preparationGeneration, revision)) return;
    const
      typedInput = !isolatedSelection && state.latestTypedInput && containsRect(packed?.sourceRect, state.latestTypedInput.box)
        ? state.latestTypedInput
        : null;
    const requestBox = packed.changedBox;
    const // A selection-scoped request never consumes the normal recognition state. Mark its
      // snapshot as already preserved so superseding it cannot merge stale dirty ink back in.
      run = { controller, dirtySnapshot, recognitionGeneration, superseded: false, dirtyRestored: true, inputCleared:false, inputConsumed:isolatedSelection, isolatedSelection, oneShotInput, selection: requestOptions.selection || null, selectionRequestToken: requestOptions.selectionRequestToken || null, widgetEdit:widgetEditTarget ? { target:widgetEditTarget, targetId:widgetEditTarget.id, pluginId:widgetEditTarget.pluginId, revision } : null, action };
    if (aiPreparation !== preparation) return;
    aiPreparation = null;
    state.activeAI = run;
    setStatusKey("aiSendingRequest");
    const requestTimeoutMs=activeAiRequestTimeoutMs(),slowNoticeDelay=Math.min(60000,Math.max(10000,Math.floor(requestTimeoutMs/3)));
    run.slowNoticeTimer=setTimeout(()=>{
      if(run.superseded||state.activeAI!==run)return;
      const phase=state.aiProgressEvent?.phase;
      if(!phase||["received","preparing-image","connecting","waiting","slow"].includes(phase))
        applyAiProgress(run,{phase:"slow",requestId:run.requestId||null,timeoutSeconds:Math.ceil(requestTimeoutMs/1000)});
    },slowNoticeDelay);
    const timeout = createActivityAwareAbortTimeout(controller,requestTimeoutMs);
    try {
      const res = await fetch("/api/ai/command", {
          signal: controller.signal,
          method: "POST",
          credentials: "same-origin",
          headers: aiRequestHeaders({ "Content-Type": "application/json", Accept:"application/x-ndjson, application/json" }),
          body: JSON.stringify({
            ...packed,
            trigger: automatic ? "user_paused" : "manual",
            userAction: action,
            ...(state.reasoningEffort === "config" ? {} : { reasoningEffort: state.reasoningEffort }),
            ...pluginRequestPayload(),
            ...(widgetEditContext ? { widgetEdit:widgetEditContext } : {}),
            ...(typedInput ? { typedInput } : {}),
            canvasSize: { w: SIZE, h: SIZE },
            uiTheme: state.theme,
            persona: {
              research: "Rigorous mathematical-physics research and teaching mentor. Prioritize assumptions, derivations, units, physical interpretation, proofs, and verifiable code or numerical checks when useful. Be concise but academically precise; never claim to literally be Einstein unless asked for roleplay.",
              scifi: "Pragmatic futuristic engineering copilot. Prioritize programming, debugging, algorithms, architecture, systems thinking, quantitative tradeoffs, and plausible emerging technology. Give concise, actionable answers rather than decorative sci-fi prose.",
              arcane: "Warm interdisciplinary knowledge guide. Favor intuition, memorable analogies, creative synthesis, conceptual connections across science and humanities, and exploratory alternatives while keeping facts and reasoning precise.",
              studio: "Minimal, well-organized general-purpose studio assistant. Prioritize clear structure, legible formatting, concise step-by-step reasoning, and practical actionable answers. Keep visual output clean and uncluttered; avoid decorative flourishes.",
            }[state.theme],
          }),
        }),
        streamed = await readAiCommandResponse(res,event=>applyAiProgress(run,event),timeout.activity),
        data = streamed.data;
      if (run.superseded || state.activeAI !== run) throw Error(AI_SUPERSEDED);
      rememberRequest(data.requestId);
      if (!streamed.ok) {
        const error = Error(data.error || `HTTP ${streamed.status}`);
        error.status = streamed.status;
        throw error;
      }
      // Draft confirmation is a separate interaction after the model request has
      // ended. Stop request-only timers now so they cannot report a slow model
      // while the user is deciding whether to keep the completed draft.
      timeout.clear();
      clearTimeout(run.slowNoticeTimer);
      run.slowNoticeTimer = 0;
      if (state.activeAI === run) setBusy(false);
      const rawCommands = Array.isArray(data.commands) ? data.commands : [],
        rawCount = rawCommands.length,
        widgetLimitReached = !widgetEditTarget && state.widgets.length >= MAX_VISIBLE_WIDGETS && rawCommands.some((command) => ["html_widget", "diagram_source"].includes(command?.tool || command?.type || command?.name)),
        commands = normalizeCommandPlacements(validate(rawCommands, aiColor, widgetEditTarget, packed.visibleRect), packed, requestBox),
        meta = { requestId: data.requestId };
      if (action === "normalize")
        for (let index = commands.length - 1; index >= 0; index--)
          if (!["write_text", "draw_formula", "plot_function"].includes(commands[index].tool)) commands.splice(index, 1);
      debug("ai-response", {
        ...meta,
        intent: data.intent || "none",
        rawCount,
        attempts: data.attempts || 1,
      });
      debug("commands-validated", {
        ...meta,
        rawCount,
        validCount: commands.length,
        rejectedCount: rawCount - commands.length,
        tools: commands.map((c) => c.tool),
      });
      if (state.userRevision !== revision) {
        if (!isolatedSelection && !oneShotInput && !run.inputConsumed && state.recognitionGeneration === recognitionGeneration) {
          restoreDirty(dirtySnapshot);
          state.autoEligible = Boolean(state.dirty);
          schedule();
        }
        setStatusKey("deferred");
        debug("ai-deferred", { ...meta, reason: "user-revision-changed" });
        return;
      }
      if (commands.length) {
        if (!isolatedSelection) {
          state.dirty = null;
          state.autoEligible = false;
          run.dirtyRestored = false;
          run.inputCleared = true;
          clearWidgetRefineCandidate();
        }
        setStatusKey("writing");
        if (commands.length === 1 && !["draw", "erase"].includes(commands[0].tool)) {
          if (state.userRevision !== revision) throw Error(AI_CANCELLED);
          await animate(commands[0], revision, meta, run);
          checkAI(revision, run);
        } else {
          const items = [];
          for (const c of commands) {
            if (state.userRevision !== revision) throw Error(AI_CANCELLED);
            const item = await preparePendingItem(c, revision, meta, run);
            if (item) items.push(item);
            checkAI(revision, run);
          }
          const activeItems = pluginEnabled("animation") ? items : items.filter((item) => !item.animationScene);
          if (!activeItems.length) throw Error("AI response tools could not be prepared");
          resolvePendingItemOverlaps(activeItems, meta);
          checkAI(revision, run);
          const outcome = await startPendingBatch(activeItems, revision, meta);
          checkAI(revision, run);
          if (outcome === AI_CANCELLED) throw Error(AI_CANCELLED);
          if (outcome === AI_SUPERSEDED) throw Error(AI_SUPERSEDED);
          if (!outcome?.acceptedCount) throw Error(AI_REJECTED);
          debug("tool-complete", { ...meta, batch: true, acceptedCount: outcome.acceptedCount, discardedCount: commands.length - outcome.acceptedCount });
        }
        if (!run.inputConsumed) {
          if (!isolatedSelection) {
            state.lastUserBox = requestBox;
            if (hotspotCount) state.hotspotTrail.splice(0, hotspotCount);
            if (state.latestTypedInput === typedInput) state.latestTypedInput = null;
            clearDirtyContributionTracking();
          }
          run.inputConsumed = true;
          run.dirtyRestored = true;
        }
        if (!isolatedSelection) save();
        if (widgetLimitReached) setStatusKey("widgetLimitReached");
        else if (data.message) setStatus(data.message);
        else setStatusKey("aiDone");
      } else {
        if (widgetLimitReached) setStatusKey("widgetLimitReached");
        else if (typeof data.message === "string" && data.message.trim()) setStatus(data.message.trim());
        else setStatusKey("aiNoVisibleResponse");
      }
    } catch (e) {
      if (run.superseded) {
        debug("ai-deferred", { requestId: state.lastRequestId, reason: "request-superseded" });
      } else if (e.message === AI_REJECTED) {
        if (!isolatedSelection && run.inputCleared && !run.inputConsumed && state.recognitionGeneration === recognitionGeneration) {
          state.lastUserBox = requestBox;
          if (hotspotCount) state.hotspotTrail.splice(0, hotspotCount);
          if (state.latestTypedInput === typedInput) state.latestTypedInput = null;
          clearDirtyContributionTracking();
          run.inputConsumed = true;
          run.dirtyRestored = true;
        }
        setStatusKey("draftRejected");
      } else if (e.message === AI_SUPERSEDED) {
        setStatusKey("ready");
      } else if (state.userRevision !== revision) {
        if (!isolatedSelection && !oneShotInput && !run.inputConsumed && state.recognitionGeneration === recognitionGeneration) {
          restoreDirty(dirtySnapshot);
          state.autoEligible = Boolean(state.dirty);
          schedule();
        }
        setStatusKey("deferred");
        debug("ai-deferred", { requestId: state.lastRequestId, reason: "stale-request-error" });
      } else if (e.message === AI_CANCELLED) {
        if (!isolatedSelection && !oneShotInput && !run.inputConsumed && state.recognitionGeneration === recognitionGeneration) {
          restoreDirty(dirtySnapshot);
          state.autoEligible = Boolean(state.dirty);
          schedule();
        }
        setStatusKey("deferred");
        debug("ai-deferred", {
          requestId: state.lastRequestId,
          reason: "animation-cancelled",
        });
      } else {
        const timedOut = e.name === "AbortError",
          message = timedOut ? t("timeout") : e.message;
        if (!isolatedSelection && !run.inputConsumed && state.recognitionGeneration === recognitionGeneration) {
          restoreDirty(dirtySnapshot);
          run.dirtyRestored = true;
          run.inputCleared = false;
          state.autoEligible = false;
        }
        setStatus(`${t("aiError")}${message}`);
        debug("ai-error", {
          requestId: state.lastRequestId,
          action,
          error: timedOut ? "timeout" : Number.isInteger(e.status) ? "http-error" : "request-error",
        });
      }
    } finally {
      timeout.clear();
      clearTimeout(run.slowNoticeTimer);
      if (state.activeAI === run) {
        state.activeAI = null;
        setBusy(false);
      }
      if (!state.activeAI) state.summonAnchor = null;
    }
  }
  function viewportRect() {
    const r = view.getBoundingClientRect(),
      x = Math.max(0, -state.panX / state.scale),
      y = Math.max(0, -state.panY / state.scale),
      right = Math.min(SIZE, (r.width - state.panX) / state.scale),
      bottom = Math.min(SIZE, (r.height - state.panY) / state.scale);
    return right > x && bottom > y ? { x, y, w: right - x, h: bottom - y } : null;
  }
  function visibleInkBounds(visible) {
    let bounds = null;
    for (const [k] of tiles) {
      const [tx, ty] = k.split(",").map(Number),
        tileBox = { x: tx * TILE, y: ty * TILE, w: TILE, h: TILE },
        part = intersection(tileBox, visible);
      if (!part) continue;
      let ink = state.inkBounds.get(k);
      if (ink === undefined) {
        const c = tiles.get(k);
        ink = c ? inkBox(c, Math.min(TILE, SIZE - tx * TILE), Math.min(TILE, SIZE - ty * TILE)) : null;
        state.inkBounds.set(k, ink);
      }
      if (!ink) continue;
      const found = intersection({ x: tileBox.x + ink.x, y: tileBox.y + ink.y, w: ink.w, h: ink.h }, visible);
      if (!found) continue;
      bounds = bounds
        ? {
            x: Math.min(bounds.x, found.x),
            y: Math.min(bounds.y, found.y),
            w: Math.max(bounds.x + bounds.w, found.x + found.w) - Math.min(bounds.x, found.x),
            h: Math.max(bounds.y + bounds.h, found.y + found.h) - Math.min(bounds.y, found.y),
          }
        : found;
    }
    return bounds;
  }
  function mapHotspots(sourceRect, imageSize, points) {
    const columns = 8,
      rows = 8,
      cellW = sourceRect.w / columns,
      cellH = sourceRect.h / rows,
      result = [];
    for (const point of points) {
      if (point.x < sourceRect.x || point.x > sourceRect.x + sourceRect.w || point.y < sourceRect.y || point.y > sourceRect.y + sourceRect.h) continue;
      const col = Math.min(columns - 1, Math.max(0, Math.floor((point.x - sourceRect.x) / cellW))),
        row = Math.min(rows - 1, Math.max(0, Math.floor((point.y - sourceRect.y) / cellH))),
        previous = result.at(-1);
      if (previous && previous.cell[0] === col && previous.cell[1] === row) continue;
      result.push({
        cell: [col, row],
        imageRect: {
          x: Math.round((col * imageSize.w) / columns),
          y: Math.round((row * imageSize.h) / rows),
          w: Math.ceil(imageSize.w / columns),
          h: Math.ceil(imageSize.h / rows),
        },
      });
    }
    return {
      columns,
      rows,
      order: "oldest-to-newest",
      attention: "newest unconsumed pen path; use ordered cells to read and apply every edit inside latestInput.imageRect",
      hotspots: result.slice(-64),
    };
  }
  function captureRectFor(latestBox, visible) {
    // Retained dirty ink from a failed request must never expand the next capture beyond what the user can currently see.
    return visible;
  }
  function planViewportImage(latestBox, captureCurrentViewport = false) {
    const visible = viewportRect();
    if (!visible) return null;
    const captureRect = captureRectFor(latestBox, visible),
      ink = unionLocalBounds(unionLocalBounds(unionLocalBounds(visibleInkBounds(captureRect), imageBounds(captureRect)), textBoxBounds(captureRect)), animationBounds(captureRect)),
      useFullViewport = captureCurrentViewport || Boolean(latestBox && !intersection(latestBox, captureRect));
    if (!useFullViewport && !ink) return null;
    const margin = Math.max(120, Math.min(640, 160 / state.scale)),
      left = useFullViewport ? captureRect.x : Math.max(captureRect.x, ink.x - margin),
      top = useFullViewport ? captureRect.y : Math.max(captureRect.y, ink.y - margin),
      right = useFullViewport ? captureRect.x + captureRect.w : Math.min(captureRect.x + captureRect.w, ink.x + ink.w + margin),
      bottom = useFullViewport ? captureRect.y + captureRect.h : Math.min(captureRect.y + captureRect.h, ink.y + ink.h + margin),
      sourceRect = { x: left, y: top, w: right - left, h: bottom - top },
      // Keep ceil(source * scale) inside the server limits despite floating-point drift.
      imageScale = Math.min(1, MAX_ATLAS_WIDTH / sourceRect.w, MAX_ATLAS_HEIGHT / sourceRect.h) * (1 - Number.EPSILON * 4),
      imageSize = {
        w: Math.max(1, Math.min(MAX_ATLAS_WIDTH, Math.ceil(sourceRect.w * imageScale))),
        h: Math.max(1, Math.min(MAX_ATLAS_HEIGHT, Math.ceil(sourceRect.h * imageScale))),
      },
      latestVisible = latestBox ? intersection(latestBox, sourceRect) || { ...sourceRect } : captureCurrentViewport ? { ...sourceRect } : null;
    if (!latestVisible) return null;
    return { visible, captureRect, sourceRect, imageScale, imageSize, latestVisible };
  }
  function buildViewportImage(hotspotPoints, latestBox, captureCurrentViewport = false, capturePlan = null) {
    const plan = capturePlan || planViewportImage(latestBox, captureCurrentViewport);
    if (!plan) return null;
    const { visible, captureRect, sourceRect, imageScale, imageSize, latestVisible } = plan,
      out = offscreen(imageSize.w, imageSize.h),
      q = out.getContext("2d"),
      captureTime = performance.now();
    q.fillStyle = "#fff";
    q.fillRect(0, 0, out.width, out.height);
    q.setTransform(imageScale, 0, 0, imageScale, -sourceRect.x * imageScale, -sourceRect.y * imageScale);
    q.globalAlpha = 0.42;
    drawAnimationsToContext(q, sourceRect, captureTime);
    drawWidgetsToContext(q, sourceRect);
    drawImagesToContext(q, sourceRect);
    drawTextBoxesToContext(q, sourceRect);
    forTiles(sourceRect.x, sourceRect.y, sourceRect.w, sourceRect.h, (c, tx, ty) => q.drawImage(c, tx * TILE, ty * TILE), false);
    drawSharpOverlays(q, sourceRect);
    q.globalAlpha = 1;
    q.save();
    q.beginPath();
    q.rect(latestVisible.x, latestVisible.y, latestVisible.w, latestVisible.h);
    q.clip();
    drawAnimationsToContext(q, latestVisible, captureTime);
    drawWidgetsToContext(q, latestVisible);
    drawImagesToContext(q, latestVisible);
    drawTextBoxesToContext(q, latestVisible);
    forTiles(latestVisible.x, latestVisible.y, latestVisible.w, latestVisible.h, (c, tx, ty) => q.drawImage(c, tx * TILE, ty * TILE), false);
    drawSharpOverlays(q, latestVisible);
    q.restore();
    const focusInset = FOCUS_INSET_ENABLED ? drawFocusInset(out, latestVisible, sourceRect, imageScale, captureTime) : null,
      hotspotGrid = mapHotspots(sourceRect, imageSize, hotspotPoints);
    debug("atlas-built", {
      scope: captureCurrentViewport ? "current-viewport" : "visible-content",
      visibleRect: visible,
      captureRect,
      sourceRect,
      imageSize,
      imageScale: Number(imageScale.toFixed(4)),
      latestBox: latestVisible,
      focusInset,
      hotspots: hotspotGrid.hotspots.length,
    });
    return {
      atlasImage: out.toDataURL("image/png"),
      atlasSize: imageSize,
      visibleRect: visible,
      captureRect,
      sourceRect,
      imageScale,
      changedBox: latestVisible,
      focusInset,
      hotspotGrid,
    };
  }
  function emergencyViewportImage(hotspotPoints, latestBox) {
    let visible = null;
    try { visible = viewportRect(); } catch {}
    if (!visible) visible = { x:0, y:0, w:1, h:1 };
    const sourceRect = { ...visible },
      latestVisible = latestBox ? intersection(latestBox, sourceRect) || { ...sourceRect } : { ...sourceRect },
      imageScale = Math.min(1, MAX_ATLAS_WIDTH / sourceRect.w, MAX_ATLAS_HEIGHT / sourceRect.h) * (1 - Number.EPSILON * 4),
      imageSize = {
        w:Math.max(1, Math.min(MAX_ATLAS_WIDTH, Math.ceil(sourceRect.w * imageScale))),
        h:Math.max(1, Math.min(MAX_ATLAS_HEIGHT, Math.ceil(sourceRect.h * imageScale))),
      },
      plan = { visible, captureRect:{ ...visible }, sourceRect, imageScale, imageSize, latestVisible };
    try {
      const packed = buildViewportImage(hotspotPoints, latestBox, true, plan);
      if (packed) return packed;
    } catch (error) {
      debug("ai-preparation-degraded", { stage:"viewport-atlas-emergency", error:String(error?.message || error).slice(0, 300) });
    }
    const fallbackScale = Math.min(1, 1 / sourceRect.w, 1 / sourceRect.h);
    return {
      atlasImage:"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      atlasSize:{ w:1, h:1 },
      visibleRect:{ ...visible },
      captureRect:{ ...visible },
      sourceRect,
      imageScale:fallbackScale,
      changedBox:latestVisible,
      focusInset:null,
      hotspotGrid:{ columns:8, rows:8, order:"oldest-to-newest", attention:"newest unconsumed pen path; use ordered cells to read and apply every edit inside latestInput.imageRect", hotspots:[] },
    };
  }
  function buildSelectionImage(selection) {
    if (!selection || selection.phase !== "active" || !selection.fragments?.length) return null;
    const content = selectionContentBounds(selection);
    if (!content || content.w <= 0 || content.h <= 0) return null;
    // Use the lasso's own minimum bounding rectangle; the polygon exterior stays white.
    const sourceRect = { ...selection.box },
      imageScale = Math.min(1, MAX_ATLAS_WIDTH / sourceRect.w, MAX_ATLAS_HEIGHT / sourceRect.h) * (1 - Number.EPSILON * 4),
      imageSize = {
        w: Math.max(1, Math.min(MAX_ATLAS_WIDTH, Math.ceil(sourceRect.w * imageScale))),
        h: Math.max(1, Math.min(MAX_ATLAS_HEIGHT, Math.ceil(sourceRect.h * imageScale))),
      },
      out = offscreen(imageSize.w, imageSize.h),
      q = out.getContext("2d");
    q.fillStyle = "#fff";
    q.fillRect(0, 0, out.width, out.height);
    q.setTransform(imageScale, 0, 0, imageScale, -sourceRect.x * imageScale, -sourceRect.y * imageScale);
    for (const fragment of selection.fragments) {
      const target = SELECT.mapFragment(fragment, selection.originalBox, selection.box);
      q.drawImage(fragment.renderImage || fragment.image, target.x, target.y, target.w, target.h);
    }
    q.setTransform(1, 0, 0, 1, 0, 0);
    const path = selectionPathFor(selection),
      context = {
        box: { ...selection.box },
        path: path.map((point) => ({ x: point.x, y: point.y })),
        closed: true,
      },
      contentRect = { ...content };
    debug("selection-atlas-built", {
      sourceRect,
      contentRect,
      imageSize,
      imageScale: Number(imageScale.toFixed(4)),
      pathPoints: path.length,
    });
    return {
      atlasImage: out.toDataURL("image/png"),
      atlasSize: imageSize,
      visibleRect: { x: 0, y: 0, w: SIZE, h: SIZE },
      captureRect: { ...sourceRect },
      sourceRect,
      imageScale,
      changedBox: { ...sourceRect },
      focusInset: null,
      hotspotGrid: { columns: 8, rows: 8, order: "oldest-to-newest", attention: "newest unconsumed pen path; use ordered cells to read and apply every edit inside latestInput.imageRect", hotspots: [] },
      selectionContext: context,
    };
  }
  function drawFocusInset(out, latestBox, sourceRect, mainScale, captureTime = performance.now()) {
    const largeInput = latestBox.w > 1800 || latestBox.h > 1200,
      padding = largeInput ? Math.max(40, Math.min(120, Math.max(latestBox.w, latestBox.h) * 0.04)) : Math.max(50, Math.min(280, Math.max(latestBox.w, latestBox.h) * 0.18)),
      w = Math.min(sourceRect.w, Math.max(220, latestBox.w + padding * 2)),
      h = Math.min(sourceRect.h, Math.max(160, latestBox.h + padding * 2)),
      x = Math.max(sourceRect.x, Math.min(sourceRect.x + sourceRect.w - w, latestBox.x + latestBox.w / 2 - w / 2)),
      y = Math.max(sourceRect.y, Math.min(sourceRect.y + sourceRect.h - h, latestBox.y + latestBox.h / 2 - h / 2)),
      focusRect = { x, y, w, h },
      targetW = largeInput ? Math.min(1500, out.width * 0.72) : 640,
      targetH = largeInput ? Math.min(1000, out.height * 0.82) : 420,
      focusScale = Math.min(3, targetW / w, targetH / h, Math.max(0.01, (out.width - 24) / w), Math.max(0.01, (out.height - 24) / h)),
      latestPixels = { w: latestBox.w * mainScale, h: latestBox.h * mainScale };
    if (focusScale <= mainScale * 1.05 || (!largeInput && focusScale <= mainScale * 1.35 && latestPixels.w >= 180 && latestPixels.h >= 100)) return null;
    const contentW = Math.max(1, Math.ceil(w * focusScale)),
      contentH = Math.max(1, Math.ceil(h * focusScale)),
      latestCenter = {
        x: (latestBox.x + latestBox.w / 2 - sourceRect.x) * mainScale,
        y: (latestBox.y + latestBox.h / 2 - sourceRect.y) * mainScale,
      },
      insetPadding = 12,
      positions = [
        { x: insetPadding, y: insetPadding },
        { x: out.width - contentW - insetPadding, y: insetPadding },
        { x: insetPadding, y: out.height - contentH - insetPadding },
        { x: out.width - contentW - insetPadding, y: out.height - contentH - insetPadding },
      ].filter((position) => position.x >= insetPadding && position.y >= insetPadding),
      distance = (position) => Math.hypot(position.x + contentW / 2 - latestCenter.x, position.y + contentH / 2 - latestCenter.y),
      position = positions.sort((a, b) => distance(b) - distance(a))[0];
    if (!position) return null;
    const q = out.getContext("2d");
    q.save();
    q.setTransform(1, 0, 0, 1, 0, 0);
    q.fillStyle = "#fff";
    q.fillRect(position.x - 5, position.y - 5, contentW + 10, contentH + 10);
    q.beginPath();
    q.rect(position.x, position.y, contentW, contentH);
    q.clip();
    q.setTransform(focusScale, 0, 0, focusScale, position.x - focusRect.x * focusScale, position.y - focusRect.y * focusScale);
    q.globalAlpha = 0.32;
    drawImagesToContext(q, focusRect);
    drawTextBoxesToContext(q, focusRect);
    forTiles(focusRect.x, focusRect.y, focusRect.w, focusRect.h, (c, tx, ty) => q.drawImage(c, tx * TILE, ty * TILE), false);
    q.globalAlpha = 1;
    drawSharpOverlays(q, focusRect);
    drawAnimationsToContext(q, focusRect, captureTime);
    q.save();
    q.beginPath();
    q.rect(latestBox.x, latestBox.y, latestBox.w, latestBox.h);
    q.clip();
    drawImagesToContext(q, latestBox);
    drawTextBoxesToContext(q, latestBox);
    forTiles(latestBox.x, latestBox.y, latestBox.w, latestBox.h, (c, tx, ty) => q.drawImage(c, tx * TILE, ty * TILE), false);
    q.restore();
    drawSharpOverlays(q, latestBox);
    drawAnimationsToContext(q, latestBox, captureTime);
    q.restore();
    q.save();
    q.setTransform(1, 0, 0, 1, 0, 0);
    q.strokeStyle = "#64748b";
    q.lineWidth = 2;
    q.strokeRect(position.x - 4, position.y - 4, contentW + 8, contentH + 8);
    q.restore();
    return {
      sourceRect: focusRect,
      imageRect: { x: position.x, y: position.y, w: contentW, h: contentH },
      imageScale: focusScale,
      purpose: "magnified duplicate of latestInput for handwriting transcription only",
    };
  }
  function containsRect(outer, inner) {
    const epsilon = 0.001;
    return inner.x >= outer.x - epsilon && inner.y >= outer.y - epsilon && inner.x + inner.w <= outer.x + outer.w + epsilon && inner.y + inner.h <= outer.y + outer.h + epsilon;
  }
  const n = (v, min = 0, max = SIZE) => Number.isFinite(v) && v >= min && v <= max;
  function matchedFontSize(value) {
    const screenReadable = 42 / Math.max(0.03, state.scale);
    return Math.max(24, Math.min(650, Math.max(+value || 180, screenReadable)));
  }
  function matchedTextFontSize(value, text) {
    const size = matchedFontSize(value),
      characters = Array.from(String(text).replace(/\s/g, "")).length;
    return characters < 10 ? size : Math.max(24, size * 0.5);
  }
  function normalizeCommandPlacements(commands, packed, latestBox) {
    if (commands.length !== 1) return commands;
    const capture = packed.captureRect,
      padding = Math.max(80, Math.min(320, latestBox.h * 0.15)),
      command = commands[0];
    if (command.tool !== "write_text" && command.tool !== "draw_formula") return commands;
    if (packed.selectionContext) return commands;
    const width = command.tool === "write_text" ? command.maxWidth : command.fontSize,
      height = command.tool === "write_text" ? command.fontSize * command.lineHeight * 2 : command.fontSize * 1.8,
      farAbove = command.y + Math.max(command.fontSize || 100, 120) < capture.y,
      suspiciousCanvasTop = command.y < capture.y + Math.max(200, capture.h * 0.04) && command.y + Math.max(command.fontSize || 100, 120) < latestBox.y - Math.max(400, capture.h * 0.12),
      farOutside = command.y > capture.y + capture.h || command.x > capture.x + capture.w || command.x + width < capture.x;
    if (!farAbove && !suspiciousCanvasTop && !farOutside) return commands;
    const next = { ...command },
      preferredY = Math.max(capture.y, Math.min(capture.y + capture.h - Math.min(height, capture.h), latestBox.y + latestBox.h + padding));
    next.x = Math.max(capture.x, Math.min(capture.x + capture.w - Math.min(width, capture.w), latestBox.x));
    next.y = Math.max(0, Math.min(SIZE - height, preferredY));
    if (next.tool === "write_text") next.maxWidth = Math.max(next.fontSize, Math.min(next.maxWidth, SIZE - next.x));
    return [next];
  }
  function widgetGeometryForViewport(visibleRect) {
    const bucket = (value) => Math.ceil(Math.min(SIZE, Math.max(1, Number(value) || 1)) / 1000) * 1000,
      viewportW = bucket(visibleRect?.w), viewportH = bucket(visibleRect?.h);
    return {
      max:{ w:Math.max(300,Math.round(viewportW/2)), h:Math.max(200,Math.round(viewportH/2)) },
    };
  }
  function fitWidgetGeometry(command, visibleRect) {
    if (!command || ![command.x, command.y, command.w, command.h].every(Number.isFinite)) return null;
    const target = widgetGeometryForViewport(visibleRect).max;
    let x = Math.round(command.x), y = Math.round(command.y),
      w = Math.round(command.w),
      h = Math.round(command.h);
    if (w <= 0 || h <= 0) {
      w = 2400;
      h = 1400;
    } else if (w < 300 || h < 200) {
      const scale = Math.max(300 / w, 200 / h);
      w = Math.ceil(w * scale);
      h = Math.ceil(h * scale);
    }
    if (w > 10000 || h > 10000 || w * h > 40000000) {
      const scale = Math.min(1, target.w / w, target.h / h, 10000 / w, 10000 / h, Math.sqrt(40000000 / (w * h)));
      w = Math.floor(w * scale);
      h = Math.floor(h * scale);
    }
    w = Math.max(300, w);
    h = Math.max(200, h);
    w = Math.min(w, SIZE);
    h = Math.min(h, SIZE);
    x = Math.max(0, Math.min(SIZE - w, x));
    y = Math.max(0, Math.min(SIZE - h, y));
    return w >= 300 && h >= 200 ? { x, y, w, h } : null;
  }
  function validWidgetRefreshSeconds(value) {
    return value === 0 || n(value, 60, 86400);
  }
  function validate(cmds, aiColor = state.aiColor, widgetEditTarget = null, visibleRect = null) {
    if (!Array.isArray(cmds)) return [];
    let plotPixels = 0,
      widgetSlots = widgetEditTarget ? 1 : Math.max(0, MAX_VISIBLE_WIDGETS - state.widgets.length),
      widgetPluginIds = new Set(enabledPluginDescriptors().map((plugin) => plugin.id));
    const acceptedTools = ["write_text", "draw_formula", "plot_function", "draw", "erase"];
    if (widgetPluginIds.size) acceptedTools.push("html_widget");
    if (widgetPluginIds.has("flowchart")) acceptedTools.push("diagram_source");
    const validated = cmds
      .slice(0, 16)
      .map((c) => (c && typeof c === "object" ? { ...c, tool: c.tool || c.type || c.name } : c))
      .filter((c) => c && acceptedTools.includes(c.tool))
      .map((c) => {
        c = { ...c };
        if (c.tool === "write_text") {
          if (!n(c.x) || !n(c.y) || typeof c.text !== "string" || !Number.isFinite(c.maxWidth)) return null;
          c.text = c.text.slice(0, AI_TEXT_MAX_LENGTH);
          c.fontSize = matchedTextFontSize(c.fontSize, c.text);
          c.maxWidth = Math.max(c.fontSize, Math.min(SIZE - c.x, c.maxWidth));
          c.lineHeight = Math.max(1, Math.min(2.2, +c.lineHeight || 1.35));
          c.color = aiColor;
          if (c.maxWidth < c.fontSize) return null;
          c.y = Math.min(c.y, Math.max(0, SIZE - c.fontSize * c.lineHeight * 2));
        }
        if (c.tool === "draw_formula") {
          if (!n(c.x) || !n(c.y) || typeof c.latex !== "string") return null;
          c.latex = c.latex.slice(0, 500);
          c.fontSize = matchedFontSize(c.fontSize);
          c.color = aiColor;
          const estimatedWidth = Math.min(5000, Math.max(c.fontSize, c.latex.length * c.fontSize * 0.72));
          c.x = Math.min(c.x, Math.max(0, SIZE - estimatedWidth));
          c.y = Math.min(c.y, Math.max(0, SIZE - c.fontSize * 1.8));
        }
        if (c.tool === "plot_function" && (!n(c.x) || !n(c.y) || !n(c.w, 240, 6000) || !n(c.h, 180, 6000) || c.w * c.h > 8000000 || Math.max(c.w / c.h, c.h / c.w) > 6 || 12000000 < plotPixels + c.w * c.h || c.x + c.w > SIZE || c.y + c.h > SIZE || typeof c.expression !== "string" || c.expression.length > 180)) return null;
        if (c.tool === "plot_function") {
          c.expression = normalizePlotExpression(c.expression);
          try {
            compileExpression(c.expression);
          } catch {
            return null;
          }
          c.color = aiColor;
          plotPixels += c.w * c.h;
        }
        if (c.tool === "draw") {
          const normalized = DRAW?.normalize(c, SIZE);
          if (!normalized) return null;
          c = { ...normalized, color:aiColor };
        }
        if (c.tool === "html_widget") {
          const allowCopy = c.pluginId !== "image-search",
            diagramKind = typeof c.diagramKind === "string" ? c.diagramKind.trim() : "",
            sourceFormat = typeof c.sourceFormat === "string" ? c.sourceFormat.trim() : "",
            frameworkVersion = typeof c.frameworkVersion === "string" ? c.frameworkVersion.trim() : "",
            geometry = fitWidgetGeometry(c, visibleRect);
          if (widgetSlots <= 0 || !widgetPluginIds.has(c.pluginId) || widgetEditTarget && c.pluginId !== widgetEditTarget.pluginId || !geometry || typeof c.title !== "string" || !c.title.trim() || c.title.length > 120 || !validWidgetRefreshSeconds(c.refreshSeconds) || typeof c.html !== "string" || !c.html.trim() || c.html.length > MAX_WIDGET_HTML_LENGTH || diagramKind.length > 80 || sourceFormat.length > 80 || frameworkVersion.length > 120 || allowCopy && c.copyText !== undefined && (typeof c.copyText !== "string" || !c.copyText.trim() || c.copyText.length > MAX_WIDGET_COPY_TEXT_LENGTH) || allowCopy && c.copyLabel !== undefined && (typeof c.copyLabel !== "string" || !c.copyLabel.trim() || c.copyLabel.length > 80) || c.pluginId === "flowchart" && (typeof c.copyText !== "string" || !c.copyText.trim() || !sourceFormat)) return null;
          c = {
            tool:"html_widget",
            pluginId:c.pluginId,
            x:Math.round(widgetEditTarget ? widgetEditTarget.x : geometry.x),
            y:Math.round(widgetEditTarget ? widgetEditTarget.y : geometry.y),
            w:Math.round(widgetEditTarget ? widgetEditTarget.w : geometry.w),
            h:Math.round(widgetEditTarget ? widgetEditTarget.h : geometry.h),
            title:c.title.trim(),
            refreshSeconds:Math.round(c.refreshSeconds),
            html:c.html,
            ...(diagramKind ? { diagramKind } : {}),
            ...(sourceFormat ? { sourceFormat } : {}),
            ...(frameworkVersion ? { frameworkVersion } : {}),
            ...(allowCopy && typeof c.copyText === "string" ? { copyText:c.copyText.trim(), copyLabel:String(c.copyLabel || (sourceFormat ? `Copy ${sourceFormat}` : "Copy source")).trim() } : {}),
          };
          widgetSlots--;
        }
        if (c.tool === "diagram_source") {
          const runtime = diagramRuntime();
          const geometry = fitWidgetGeometry(c, visibleRect),
            sourceFormat = runtime?.normalizeFormat(c.sourceFormat) || "",
            diagramKind = typeof c.diagramKind === "string" ? c.diagramKind.trim() : "";
          if (widgetSlots <= 0 || !widgetPluginIds.has("flowchart") || c.pluginId !== "flowchart"
            || widgetEditTarget && (widgetEditTarget.pluginId !== "flowchart" || widgetEditTarget.widgetType !== "diagram_source")
            || !geometry || typeof c.title !== "string" || !c.title.trim() || c.title.length > 120
            || !sourceFormat || !diagramSourceFits(c.source)
            || diagramKind.length > 80) return null;
          c = {
            tool:"diagram_source",
            widgetType:"diagram_source",
            pluginId:"flowchart",
            x:Math.round(widgetEditTarget ? widgetEditTarget.x : geometry.x),
            y:Math.round(widgetEditTarget ? widgetEditTarget.y : geometry.y),
            w:Math.round(widgetEditTarget ? widgetEditTarget.w : geometry.w),
            h:Math.round(widgetEditTarget ? widgetEditTarget.h : geometry.h),
            title:c.title.trim(),
            refreshSeconds:0,
            sourceFormat,
            source:c.source,
            ...(diagramKind ? { diagramKind } : {}),
          };
          widgetSlots--;
        }
        if (c.tool === "erase") {
          if (c.mode === "path") {
            if (!Array.isArray(c.points) || c.points.length < 1 || c.points.length > 200 || !c.points.every(point)) return null;
            c.size = Math.max(2, Math.min(300, +c.size || 80));
            const xs = c.points.map((p) => p[0]),
              ys = c.points.map((p) => p[1]);
            if (Math.max(...xs) - Math.min(...xs) > 3000 || Math.max(...ys) - Math.min(...ys) > 3000) return null;
          } else {
            c.mode = "rect";
            if (!n(c.x) || !n(c.y) || !n(c.w, 1, 2000) || !n(c.h, 1, 2000) || c.x + c.w > SIZE || c.y + c.h > SIZE) return null;
          }
        }
        return c;
      })
      .filter(Boolean);
    const widgets = validated.filter((command) => ["html_widget", "diagram_source"].includes(command.tool));
    if (widgetEditTarget) return widgets.length === 1 ? widgets : [];
    return widgets.length ? [widgets[0]] : validated;
  }
  function point(v) {
    return Array.isArray(v) && v.length === 2 && n(v[0]) && n(v[1]);
  }
  function offscreen(w, h, readback = false) {
    const c = document.createElement("canvas");
    c.width = Math.ceil(w);
    c.height = Math.ceil(h);
    if (readback) c.getContext("2d", { willReadFrequently: true });
    return c;
  }
  function checkAI(revision, run = null) {
    if (state.userRevision !== revision) throw Error(AI_CANCELLED);
    if (run && (run.superseded || state.activeAI !== run)) throw Error(AI_SUPERSEDED);
  }
  async function animate(c, revision, meta, run) {
    debug("tool-start", {
      ...meta,
      tool: c.tool,
      x: c.x,
      y: c.y,
      fontSize: c.fontSize,
      maxWidth: c.maxWidth,
    });
    try {
      checkAI(revision, run);
      if (c.tool === "animate_scene" && !pluginEnabled("animation")) throw Error("Animation rendering is unavailable");
      if (["html_widget", "diagram_source"].includes(c.tool)) {
        if (!pluginEnabled(c.pluginId) || !pluginManifests.has(c.pluginId)) throw Error("Widget rendering is unavailable");
        const target = run?.widgetEdit?.target,
          accepted = target ? await startPendingWidgetReplacement(c, target, revision) : await startPendingWidget(c, revision);
        if (accepted === AI_CANCELLED) throw Error(AI_CANCELLED);
        if (accepted === AI_SUPERSEDED) throw Error(AI_SUPERSEDED);
        if (accepted === AI_REJECTED) throw Error(AI_REJECTED);
        if (!accepted) throw Error("Widget draft could not be prepared");
      } else if (c.tool === "erase") {
        const bounds = eraseBounds(c),
          item={ command: c, erase: true, bounds, image: eraseMask(c, bounds) };
        const accepted = await startPendingBatch([item], revision, meta);
        if (accepted === AI_CANCELLED) throw Error(AI_CANCELLED);
        if (accepted === AI_SUPERSEDED) throw Error(AI_SUPERSEDED);
        if (!accepted) throw Error(AI_REJECTED);
      } else {
        let image,
          x = c.x,
          y = c.y,
          pendingCommand = c;
        if (c.tool === "write_text") {
          image = textImage(c.text, c.fontSize, c.color, c.maxWidth, c.lineHeight, state.aiFont, AI_TEXT_MAX_LENGTH, sharpRenderRatio());
        } else if (c.tool === "draw_formula") {
          image = await formulaImage(c.latex, c.fontSize, c.color);
        } else if (c.tool === "plot_function") {
          image = plot(c);
        } else if (c.tool === "animate_scene") {
          pendingCommand = ANIMATION.normalize(c, SIZE);
          image = pendingCommand ? ANIMATION.rasterize(pendingCommand, offscreen, 0, Math.min(2, sharpRenderRatio())) : null;
        } else if (c.tool === "draw") {
          const made = DRAW.render(c, offscreen, c.color);
          image = made.image;
          x = made.x;
          y = made.y;
        }
        if (image) {
          checkAI(revision, run);
          x = Math.max(0, Math.min(x, SIZE - Math.min(image.logicalWidth || image.width, SIZE)));
          y = Math.max(0, Math.min(y, SIZE - Math.min(image.logicalHeight || image.height, SIZE)));
          const accepted = await startPending(image, x, y, revision, meta, pendingCommand);
          if (accepted === AI_CANCELLED) throw Error(AI_CANCELLED);
          if (accepted === AI_SUPERSEDED) throw Error(AI_SUPERSEDED);
          if (accepted === AI_REJECTED || !accepted) throw Error(AI_REJECTED);
        } else throw Error(`Unable to prepare ${c.tool}`);
      }
      debug("tool-complete", { ...meta, tool: c.tool, x: c.x, y: c.y });
    } catch (error) {
      if (![AI_CANCELLED, AI_REJECTED, AI_SUPERSEDED].includes(error.message)) debug("tool-error", { ...meta, tool: c.tool, error: error.message });
      throw error;
    }
  }
  async function preparePendingItem(c, revision, meta, run) {
    debug("tool-start", { ...meta, tool: c.tool, x: c.x, y: c.y, fontSize: c.fontSize, maxWidth: c.maxWidth, batch: true });
    checkAI(revision, run);
    if (c.tool === "animate_scene" && !pluginEnabled("animation")) return null;
    if (c.tool === "erase") {
      const bounds = eraseBounds(c);
      return { command: c, erase: true, bounds, image: eraseMask(c, bounds) };
    }
    let image,
      x = c.x,
      y = c.y,
      pendingCommand = c;
    if (c.tool === "write_text") image = textImage(c.text, c.fontSize, c.color, c.maxWidth, c.lineHeight, state.aiFont, AI_TEXT_MAX_LENGTH, sharpRenderRatio());
    else if (c.tool === "draw_formula") image = await formulaImage(c.latex, c.fontSize, c.color);
    else if (c.tool === "plot_function") image = plot(c);
    else if (c.tool === "animate_scene") {
      pendingCommand = ANIMATION.normalize(c, SIZE);
      image = pendingCommand ? ANIMATION.rasterize(pendingCommand, offscreen, 0, Math.min(2, sharpRenderRatio())) : null;
    } else if (c.tool === "draw") {
      const made = DRAW.render(c, offscreen, c.color);
      image = made.image;
      x = made.x;
      y = made.y;
    }
    checkAI(revision, run);
    if (!image) throw Error(`Unable to prepare ${c.tool}`);
    const logicalWidth = c.tool === "write_text" ? c.maxWidth : image.logicalWidth || image.width,
      logicalHeight = image.logicalHeight || image.height;
    return {
      command: { ...pendingCommand },
      image,
      textCommand: c.tool === "write_text" ? { ...c } : null,
      copyText: copyTextForCommand(c),
      animationScene: c.tool === "animate_scene" ? pendingCommand : null,
      animationPlayback: c.tool === "animate_scene" ? createAnimationPlayback() : null,
      x: Math.max(0, Math.min(x, SIZE - Math.min(logicalWidth, SIZE))),
      y: Math.max(0, Math.min(y, SIZE - Math.min(logicalHeight, SIZE))),
      layoutWidth: logicalWidth,
      layoutHeight: logicalHeight,
    };
  }
  function resolvePendingItemOverlaps(items, meta) {
    const gap = Math.max(40, 14 / Math.max(0.03, state.scale)),
      flow = items
        .filter((item) => ["write_text", "draw_formula"].includes(item.command.tool))
        .sort((a, b) => a.y - b.y || a.x - b.x),
      placed = [],
      fixed = items
        .filter((item) => !["write_text", "draw_formula", "draw"].includes(item.command.tool))
        .map((item) => item.erase ? item.bounds : { x: item.x, y: item.y, w: item.layoutWidth, h: item.layoutHeight });
    for (const item of flow) {
      const width = item.image.logicalWidth || item.image.width,
        height = item.image.logicalHeight || item.image.height;
      let y = item.y;
      for (let pass = 0; pass < items.length; pass++) {
        const collisions = [...fixed, ...placed].filter((prior) => {
          const horizontalOverlap = Math.min(item.x + width, prior.x + prior.w) - Math.max(item.x, prior.x),
            verticalOverlap = Math.min(y + height, prior.y + prior.h) - Math.max(y, prior.y);
          return horizontalOverlap > 0 && verticalOverlap > 0;
        });
        if (!collisions.length) break;
        y = Math.max(...collisions.map((prior) => prior.y + prior.h)) + gap;
      }
      const originalY = item.y;
      item.y = Math.max(0, Math.min(SIZE - height, y));
      if (item.y !== originalY) debug("tool-layout-adjusted", { ...meta, tool: item.command.tool, x: item.x, originalY, y: item.y, width, height });
      placed.push({ x: item.x, y: item.y, w: width, h: height });
    }
  }
  function sharpRenderRatio() {
    return Math.min(3, Math.max(1, (devicePixelRatio || 1) * Math.max(1, state.scale)));
  }
  function rasterScaleFor(width, height, requested = 1) {
    return Math.min(Math.max(0.1, requested), 4096 / width, 4096 / height, Math.sqrt(12000000 / (width * height)));
  }

  function textRasterMetrics(text, f, maxWidth = 900, lineHeight = 1.35, family = state.aiFont, maxLength = AI_TEXT_MAX_LENGTH, pixelRatio = 1) {
    const content = text.slice(0, maxLength),
      fontFamily = family || "ui-rounded, system-ui, sans-serif";
    maxWidth = Math.max(f, Math.min(SIZE, maxWidth));
    const probe = offscreen(1, 1).getContext("2d");
    probe.font = `${f}px ${fontFamily}`;
    const layout = layoutText(content, probe, maxWidth),
      lines = layout.lines,
      widths = layout.widths,
      rowHeight = f * lineHeight,
      naturalWidth = Math.ceil(Math.min(maxWidth, Math.max(...widths)) + 8),
      naturalHeight = Math.ceil(lines.length * rowHeight + 8),
      rasterScale = rasterScaleFor(naturalWidth, naturalHeight, pixelRatio),
      rasterWidth=Math.max(1,Math.ceil(naturalWidth*rasterScale)),rasterHeight=Math.max(1,Math.ceil(naturalHeight*rasterScale));
    return{family:fontFamily,lines,widths,rowHeight,naturalWidth,naturalHeight,rasterScale,rasterWidth,rasterHeight,pixels:rasterWidth*rasterHeight};
  }
  function textImage(text, f, color, maxWidth = 900, lineHeight = 1.35, family = state.aiFont, maxLength = AI_TEXT_MAX_LENGTH, pixelRatio = 1) {
    const metrics=textRasterMetrics(text,f,maxWidth,lineHeight,family,maxLength,pixelRatio),
      {family:resolvedFamily,lines,widths,rowHeight,naturalWidth,naturalHeight,rasterScale,rasterWidth,rasterHeight}=metrics,
      image = offscreen(rasterWidth,rasterHeight),
      q = image.getContext("2d");
    q.font = `${f * rasterScale}px ${resolvedFamily}`;
    q.fillStyle = color || "#2563eb";
    q.textBaseline = "top";
    lines.forEach((value, i) => q.fillText(value, 2 * rasterScale, (2 + i * rowHeight) * rasterScale));
    image.revealRows = widths;
    image.revealRowHeight = rowHeight;
    image.naturalHeight = naturalHeight;
    image.naturalWidth = naturalWidth;
    image.logicalWidth = naturalWidth;
    image.logicalHeight = naturalHeight;
    return image;
  }
  function layoutText(content, context, maxWidth) {
    const lines = [];
    for (const explicitLine of content.replace(/\r/g, "").split("\n")) {
      const parts = explicitLine.match(/\s+|\S+/g) || [""],
        wrapped = [];
      let line = "";
      const push = () => {
        wrapped.push(line);
        line = "";
      };
      for (const part of parts) {
        if (context.measureText(line + part).width <= maxWidth) {
          line += part;
          continue;
        }
        if (line) push();
        if (context.measureText(part).width <= maxWidth) {
          line = part;
          continue;
        }
        for (const char of Array.from(part)) {
          if (line && context.measureText(line + char).width > maxWidth) push();
          line += char;
        }
      }
      if (line || !wrapped.length) wrapped.push(line);
      lines.push(...wrapped);
    }
    return { lines, widths: lines.map((value) => Math.max(1, context.measureText(value).width)) };
  }
  function mixedTextFont(segment, fontSize, family) {
    const fontFamily = segment.code ? "ui-monospace, SFMono-Regular, Consolas, monospace" : family,
      fontStyle = segment.italic ? "italic" : "normal",
      fontWeight = segment.bold ? "700" : "400";
    return `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;
  }
  function splitMixedTextPart(text, segment, fontSize, family, maxWidth, context) {
    const rendered = text.replace(/\t/g, "    "),
      font = mixedTextFont(segment, fontSize, family);
    context.font = font;
    if (context.measureText(rendered).width <= maxWidth) return [{ type: "text", text: rendered, font, fontSize, width: context.measureText(rendered).width }];
    const items = [];
    let chunk = "";
    for (const char of Array.from(rendered)) {
      if (chunk && context.measureText(chunk + char).width > maxWidth) {
        items.push({ type: "text", text: chunk, font, fontSize, width: context.measureText(chunk).width });
        chunk = "";
      }
      chunk += char;
    }
    if (chunk) items.push({ type: "text", text: chunk, font, fontSize, width: context.measureText(chunk).width });
    return items;
  }
  async function mixedTextImage(text, fontSize, color, maxWidth = 900, lineHeight = 1.35, family = state.aiFont, pixelRatio = sharpRenderRatio()) {
    if (!MIXED_TEXT?.parse) return textImage(text, fontSize, color, maxWidth, lineHeight, family, TEXT_INPUT_MAX_LENGTH, pixelRatio);
    const parsed = MIXED_TEXT.parse(text.slice(0, TEXT_INPUT_MAX_LENGTH)),
      resolvedFamily = family || "ui-rounded, system-ui, sans-serif",
      widthLimit = Math.max(fontSize * 3, Math.min(SIZE, maxWidth)),
      probe = offscreen(1, 1).getContext("2d"),
      formulaCache = new Map(),
      preparedLines = [];
    let formulaCount = 0;
    for (const line of parsed.lines) {
      const lineFontSize = Math.max(1, fontSize * (line.fontScale || 1)),
        segments = [];
      for (const segment of line.segments) {
        if (segment.type !== "math" || formulaCount >= 64 || segment.tex.length > MIXED_FORMULA_MAX_LENGTH) {
          segments.push(segment.type === "math" ? { ...segment, type: "text", text: segment.raw } : segment);
          continue;
        }
        formulaCount++;
        const cacheKey = `${lineFontSize}\n${color}\n${segment.tex}`;
        if (!formulaCache.has(cacheKey)) formulaCache.set(cacheKey, mathJaxImage(segment.tex, lineFontSize, color, pixelRatio));
        const formula = await formulaCache.get(cacheKey);
        if (formula.image) segments.push({ type: "math", image: formula.image, raw: segment.raw });
        else segments.push({ ...segment, type: "text", text: segment.raw });
      }
      preparedLines.push({ ...line, lineFontSize, segments });
    }
    const rows = [];
    for (const line of preparedLines) {
      const defaultHeight = line.lineFontSize * lineHeight;
      let row = { items: [], width: 0, height: defaultHeight };
      const finishRow = () => {
        rows.push(row);
        row = { items: [], width: 0, height: defaultHeight };
      };
      const addItem = (item) => {
        if (row.items.length && row.width + item.width > widthLimit) finishRow();
        item.x = row.width;
        row.items.push(item);
        row.width += item.width;
        row.height = Math.max(row.height, item.height || item.fontSize * lineHeight);
      };
      for (const segment of line.segments) {
        if (segment.type === "math") {
          const sourceWidth = segment.image.logicalWidth || segment.image.width,
            sourceHeight = segment.image.logicalHeight || segment.image.height,
            scale = Math.min(1, widthLimit / Math.max(1, sourceWidth));
          addItem({ type: "math", image: segment.image, width: sourceWidth * scale, height: sourceHeight * scale });
          continue;
        }
        const parts = segment.text.match(/\s+|\S+/g) || [];
        for (const part of parts) {
          const items = splitMixedTextPart(part, segment, line.lineFontSize, resolvedFamily, widthLimit, probe);
          items.forEach(addItem);
        }
      }
      finishRow();
    }
    const padding = Math.max(2, fontSize * 0.12),
      contentWidth = Math.max(1, ...rows.map((row) => row.width)),
      naturalWidth = Math.ceil(Math.min(widthLimit, contentWidth) + padding * 2),
      naturalHeight = Math.ceil(rows.reduce((sum, row) => sum + row.height, 0) + padding * 2),
      rasterScale = rasterScaleFor(naturalWidth, naturalHeight, pixelRatio),
      rasterWidth = Math.max(1, Math.ceil(naturalWidth * rasterScale)),
      rasterHeight = Math.max(1, Math.ceil(naturalHeight * rasterScale)),
      image = offscreen(rasterWidth, rasterHeight),
      context = image.getContext("2d");
    context.setTransform(rasterScale, 0, 0, rasterScale, 0, 0);
    context.fillStyle = color || "#2563eb";
    context.textBaseline = "top";
    let y = padding;
    for (const row of rows) {
      for (const item of row.items) {
        const x = padding + item.x;
        if (item.type === "math") context.drawImage(item.image, x, y + (row.height - item.height) / 2, item.width, item.height);
        else {
          context.font = item.font;
          context.fillText(item.text, x, y + (row.height - item.fontSize) / 2);
        }
      }
      y += row.height;
    }
    image.logicalWidth = naturalWidth;
    image.logicalHeight = naturalHeight;
    image.revealRows = rows.map((row) => Math.max(1, row.width));
    image.revealRowHeight = naturalHeight / Math.max(1, rows.length);
    return image;
  }
  async function mathJaxImage(latex, fontSize, color, pixelRatio = sharpRenderRatio()) {
    if (!window.MathJax?.tex2svgPromise) return { image: null, error: Error("MathJax unavailable") };
    try {
      const node = await window.MathJax.tex2svgPromise(latex, {
        display: false,
        containerWidth: SIZE,
      });
      if (node.querySelector('[data-mml-node="merror"], mjx-merror')) throw Error("Invalid MathJax input");
      const svg = node.querySelector("svg");
      if (!svg) throw Error("No MathJax SVG");
      const viewBox = (svg.getAttribute("viewBox") || "").trim().split(/\s+/).map(Number),
        ratio = viewBox.length === 4 && viewBox[2] > 0 && viewBox[3] > 0 ? viewBox[2] / viewBox[3] : Math.max(0.7, latex.length * 0.65),
        logicalHeight = Math.max(1, Math.ceil(fontSize * 1.35)),
        logicalWidth = Math.max(1, Math.ceil(logicalHeight * ratio)),
        rasterScale = rasterScaleFor(logicalWidth, logicalHeight, pixelRatio),
        rasterWidth = Math.max(1, Math.ceil(logicalWidth * rasterScale)),
        rasterHeight = Math.max(1, Math.ceil(logicalHeight * rasterScale));
      svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      svg.setAttribute("width", String(rasterWidth));
      svg.setAttribute("height", String(rasterHeight));
      svg.setAttribute("color", color || "#2563eb");
      svg.setAttribute("fill", "currentColor");
      const xml = new XMLSerializer().serializeToString(svg),
        img = new Image(),
        url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml" }));
      try {
        img.src = url;
        await img.decode();
        const image = offscreen(rasterWidth, rasterHeight);
        image.getContext("2d").drawImage(img, 0, 0, rasterWidth, rasterHeight);
        image.logicalWidth = logicalWidth;
        image.logicalHeight = logicalHeight;
        image.revealRows = [logicalWidth];
        image.revealRowHeight = logicalHeight;
        return { image, error: null };
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch (error) {
      return { image: null, error };
    }
  }
  async function formulaImage(latex, fontSize, color, family = state.aiFont, pixelRatio = sharpRenderRatio()) {
    const rendered = await mathJaxImage(latex, fontSize, color, pixelRatio);
    if (rendered.image) return rendered.image;
    console.warn("MathJax formula fallback", rendered.error);
    return textImage(formulaText(latex), fontSize, color, 900, 1.35, family, AI_TEXT_MAX_LENGTH, pixelRatio);
  }
  function formulaText(s) {
    return s.replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, "($1)/($2)").replace(/[\\{}]/g, "");
  }
  async function reveal(im, x, y, revision, duration = 1200) {
    const imageWidth = im.logicalWidth || im.width,
      imageHeight = im.logicalHeight || im.height,
      rows = im.revealRows || [imageWidth],
      rowHeight = im.revealRowHeight || imageHeight,
      total = rows.reduce((sum, width) => sum + width, 0),
      steps = Math.max(28, Math.min(180, Math.ceil(duration / 28)));
    for (let i = 1; i <= steps; i++) {
      checkAI(revision);
      const distance = (total * i) / steps;
      let consumed = 0,
        current = 0,
        currentWidth = 0;
      while (current < rows.length && consumed + rows[current] < distance) {
        consumed += rows[current];
        current++;
      }
      if (current < rows.length) currentWidth = Math.max(0, distance - consumed);
      render();
      ctx.save();
      ctx.translate(state.panX, state.panY);
      ctx.scale(state.scale, state.scale);
      ctx.beginPath();
      for (let row = 0; row < current; row++) ctx.rect(x, y + row * rowHeight, imageWidth, rowHeight);
      if (current < rows.length) ctx.rect(x, y + current * rowHeight, currentWidth, rowHeight);
      ctx.clip();
      ctx.drawImage(im, x, y, imageWidth, imageHeight);
      ctx.restore();
      await wait(duration / steps);
    }
    checkAI(revision);
    blitSized(im, x, y, imageWidth, imageHeight);
    render();
  }
  function blit(im, x, y, scale = 1) {
    blitStretched(im, x, y, scale, scale);
  }
  function blitStretched(im, x, y, scaleX, scaleY) {
    blitSized(im, x, y, im.width * scaleX, im.height * scaleY);
  }
  function blitSized(im, x, y, w, h) {
    const x0 = Math.max(0, Math.floor(x / TILE)),
      y0 = Math.max(0, Math.floor(y / TILE)),
      x1 = Math.min(Math.ceil(SIZE / TILE) - 1, Math.ceil((x + w) / TILE) - 1),
      y1 = Math.min(Math.ceil(SIZE / TILE) - 1, Math.ceil((y + h) / TILE) - 1);
    for (let ty = y0; ty <= y1; ty++)
      for (let tx = x0; tx <= x1; tx++) {
        recordBefore(tx, ty);
        const t = tile(tx, ty);
        t.getContext("2d").drawImage(im, x - tx * TILE, y - ty * TILE, w, h);
        const local = intersection({ x: x - tx * TILE, y: y - ty * TILE, w, h }, { x: 0, y: 0, w: TILE, h: TILE });
        if (local) extendInkBounds(key(tx, ty), local);
      }
  }
  function blitClipped(im, x, y, w, h, clipW, clipH) {
    forTiles(x, y, clipW, clipH, (canvas, tx, ty) => {
      recordBefore(tx, ty);
      const tileContext = canvas.getContext("2d"),
        local = intersection({ x: x - tx * TILE, y: y - ty * TILE, w: clipW, h: clipH }, { x: 0, y: 0, w: TILE, h: TILE });
      if (!local) return;
      tileContext.save();
      tileContext.beginPath();
      tileContext.rect(local.x, local.y, local.w, local.h);
      tileContext.clip();
      tileContext.drawImage(im, x - tx * TILE, y - ty * TILE, w, h);
      tileContext.restore();
      extendInkBounds(key(tx, ty), local);
    });
  }
  function copyTextForCommand(command) {
    if (command?.tool === "write_text" && typeof command.text === "string") return command.text;
    if (command?.tool === "draw_formula" && typeof command.latex === "string") return command.latex;
    return null;
  }
  function pendingCopyValue(target) {
    if (typeof target?.copyText === "string") return target.copyText;
    return copyTextForCommand(target?.command || target?.textCommand);
  }
  function pendingCopyable(target) {
    return typeof pendingCopyValue(target) === "string";
  }
  function draftBounds(p) {
    if (p.items) return batchBounds(p);
    return {
      x: p.x,
      y: p.y,
      w: (p.textCommand ? p.layoutWidth : p.image.logicalWidth || p.image.width) * p.scaleX,
      h: (p.textCommand ? p.layoutHeight : p.image.logicalHeight || p.image.height) * p.scaleY,
    };
  }
  function pendingItemBounds(item) {
    const width = item.erase ? item.bounds.w : item.textCommand ? item.layoutWidth : item.image.logicalWidth || item.image.width,
      height = item.erase ? item.bounds.h : item.textCommand ? item.layoutHeight : item.image.logicalHeight || item.image.height;
    return { x: item.x, y: item.y, w: width * item.scaleX, h: height * item.scaleY };
  }
  function batchBounds(p) {
    const boxes = p.items.map(pendingItemBounds),
      left = Math.min(...boxes.map((box) => box.x)),
      top = Math.min(...boxes.map((box) => box.y)),
      right = Math.max(...boxes.map((box) => box.x + box.w)),
      bottom = Math.max(...boxes.map((box) => box.y + box.h));
    return { x: left, y: top, w: right - left, h: bottom - top };
  }
  function drawTextDraftSurface(context, box, selected = true) {
    context.save();
    context.globalAlpha *= selected ? 0.82 : 0.68;
    context.fillStyle = state.paint.paper;
    context.fillRect(box.x, box.y, box.w, box.h);
    context.restore();
  }
  function drawPending(p, context = ctx) {
    if (p.items) return drawPendingBatch(p, context);
    const ctx = context,
      b = draftBounds(p),
      progress = p.revealProgress ?? 1,
      logicalWidth = p.image.logicalWidth || p.image.width,
      logicalHeight = p.image.logicalHeight || p.image.height,
      rows = p.image.revealRows || [logicalWidth],
      rowHeight = p.image.revealRowHeight || logicalHeight,
      total = rows.reduce((sum, width) => sum + width, 0),
      distance = total * progress;
    let consumed = 0,
      current = 0,
      currentWidth = 0;
    while (current < rows.length && consumed + rows[current] < distance) {
      consumed += rows[current];
      current++;
    }
    if (current < rows.length) currentWidth = Math.max(0, distance - consumed);
    if (p.textCommand) drawTextDraftSurface(ctx, b);
    ctx.save();
    ctx.beginPath();
    ctx.rect(b.x, b.y, b.w, b.h);
    ctx.clip();
    ctx.beginPath();
    for (let row = 0; row < current; row++) ctx.rect(b.x, b.y + row * rowHeight * p.scaleY, b.w, rowHeight * p.scaleY);
    if (current < rows.length) ctx.rect(b.x, b.y + current * rowHeight * p.scaleY, currentWidth * p.scaleX, rowHeight * p.scaleY);
    ctx.clip();
    const imageWidth = logicalWidth * p.scaleX,
      imageHeight = logicalHeight * p.scaleY;
    if (p.animationScene) drawPendingAnimation(ctx, p.animationScene, p.animationPlayback ||= createAnimationPlayback(), b);
    else ctx.drawImage(p.image, b.x, b.y, imageWidth, imageHeight);
    ctx.restore();
    if (progress < 1) {
      const tipX = b.x + currentWidth * p.scaleX,
        tipY = b.y + Math.min(current, rows.length - 1) * rowHeight * p.scaleY + rowHeight * p.scaleY * 0.72,
        unit = 1 / state.scale;
      ctx.save();
      ctx.strokeStyle = "#2563eb";
      ctx.lineWidth = 2 * unit;
      ctx.lineCap = "round";
      ctx.shadowColor = "#60a5fa";
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(tipX - 7 * unit, tipY + 5 * unit);
      ctx.lineTo(tipX + 2 * unit, tipY - 4 * unit);
      ctx.stroke();
      ctx.restore();
      return;
    }
    const chromeVisible = !p.animationScene || pendingAnimationChromeVisible(p);
    if (!chromeVisible) return;
    const s = 14 / state.scale;
    ctx.save();
    ctx.strokeStyle = "#72b7e599";
    ctx.lineWidth = 1.5 / state.scale;
    ctx.setLineDash([7 / state.scale, 7 / state.scale]);
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    ctx.setLineDash([]);
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = "#2679b8";
    ctx.lineWidth = 1.8 / state.scale;
    ctx.lineCap = "round";
    ctx.beginPath();
    drawResizeHandle(ctx, b, s);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(b.x + b.w + s * 0.08, b.y + b.h / 2 - s * 0.48);
    ctx.lineTo(b.x + b.w + s * 0.08, b.y + b.h / 2 + s * 0.48);
    ctx.moveTo(b.x + b.w / 2 - s * 0.48, b.y + b.h + s * 0.08);
    ctx.lineTo(b.x + b.w / 2 + s * 0.48, b.y + b.h + s * 0.08);
    ctx.stroke();
    ctx.restore();
    drawCopyFeedback(ctx, b, s, p);
  }
  function drawPendingBatch(p, context = ctx) {
    const ctx = context,
      batch = batchBounds(p),
      unit = 1 / state.scale,
      s = 14 * unit,
      entries = p.items.map((item, index) => ({ item, index, box: pendingItemBounds(item), chromeVisible: !item.animationScene || pendingAnimationChromeVisible(p, index) })),
      selectedEntry = entries.find(({ index }) => index === p.selectedIndex),
      batchChromeVisible = !selectedEntry?.item.animationScene || selectedEntry.chromeVisible;
    for (const { item, index, box } of entries) {
      if (item.textCommand) drawTextDraftSurface(ctx, box, index === p.selectedIndex);
      ctx.save();
      ctx.beginPath();
      ctx.rect(box.x, box.y, box.w, box.h);
      ctx.clip();
      if (item.erase) {
        ctx.globalAlpha = 0.18;
        ctx.drawImage(item.image, box.x, box.y, box.w, box.h);
      } else if (item.animationScene) drawPendingAnimation(ctx, item.animationScene, item.animationPlayback ||= createAnimationPlayback(), box);
      else if (item.textCommand) {
        const imageWidth = (item.image.logicalWidth || item.image.width) * item.scaleX,
          imageHeight = (item.image.logicalHeight || item.image.height) * item.scaleY;
        ctx.drawImage(item.image, box.x, box.y, imageWidth, imageHeight);
      } else ctx.drawImage(item.image, box.x, box.y, box.w, box.h);
      ctx.restore();
    }
    if (p.items.length > 1 && batchChromeVisible) {
      ctx.save();
      ctx.strokeStyle = "#2679b866";
      ctx.lineWidth = 1.4 * unit;
      ctx.setLineDash([8 * unit, 7 * unit]);
      ctx.strokeRect(batch.x, batch.y, batch.w, batch.h);
      ctx.restore();
    }
    const controlEntries = [...entries.filter(({ index }) => index !== p.selectedIndex), ...entries.filter(({ index }) => index === p.selectedIndex)];
    for (const { item, index, box, chromeVisible } of controlEntries) {
      if (!chromeVisible) continue;
      ctx.save();
      ctx.strokeStyle = index === p.selectedIndex ? "#2679b8" : "#72b7e577";
      ctx.lineWidth = (index === p.selectedIndex ? 2 : 1.2) * unit;
      ctx.setLineDash(index === p.selectedIndex ? [] : [6 * unit, 6 * unit]);
      ctx.strokeRect(box.x, box.y, box.w, box.h);
      ctx.restore();
      drawCopyFeedback(ctx, box, s, item);
    }
    ctx.save();
    ctx.strokeStyle = "#2679b8";
    ctx.lineWidth = 1.8 * unit;
    ctx.lineCap = "round";
    if (selectedEntry?.chromeVisible) {
      const selectedBox = selectedEntry.box;
      ctx.beginPath();
      drawResizeHandle(ctx, selectedBox, s);
      ctx.moveTo(selectedBox.x + selectedBox.w + s * 0.08, selectedBox.y + selectedBox.h / 2 - s * 0.48);
      ctx.lineTo(selectedBox.x + selectedBox.w + s * 0.08, selectedBox.y + selectedBox.h / 2 + s * 0.48);
      ctx.moveTo(selectedBox.x + selectedBox.w / 2 - s * 0.48, selectedBox.y + selectedBox.h + s * 0.08);
      ctx.lineTo(selectedBox.x + selectedBox.w / 2 + s * 0.48, selectedBox.y + selectedBox.h + s * 0.08);
      ctx.stroke();
    }
    ctx.restore();
    if (p.items.length > 1 && batchChromeVisible) {
      ctx.save();
      ctx.strokeStyle = "#2679b8";
      ctx.lineWidth = 1.8 * unit;
      ctx.lineCap = "round";
      ctx.beginPath();
      drawResizeHandle(ctx, batch, s);
      ctx.stroke();
      ctx.restore();
    }
  }
  function drawPendingAnimation(context, scene, playback, box, now = performance.now()) {
    context.save();
    context.translate(box.x, box.y);
    context.scale(box.w / scene.w, box.h / scene.h);
    ANIMATION.render(context, scene, playbackPlayhead(scene, playback, now));
    context.restore();
  }
  function draftActionPoints(box, s, includeCopy = false, single = false) {
    const prefix = single ? "" : "item-",
      radius = s * 0.54,
      clampX = (value) => Math.max(radius, Math.min(SIZE - radius, value)),
      aboveY = box.y - s * 0.74,
      actionY = aboveY - radius >= 0 ? aboveY : Math.min(SIZE - radius, box.y + radius + s * 0.18),
      actions = {
        [prefix + "cancel"]: { x: clampX(box.x - s * 0.62), y: actionY },
        [prefix + "accept"]: { x: clampX(box.x + box.w + s * 0.62), y: actionY },
      };
    if (includeCopy) actions[prefix + "copy"] = { x: clampX(box.x + box.w / 2), y: actionY };
    return actions;
  }
  function drawDraftActions(context, box, s, includeCopy = false, single = false) {
    const actions = draftActionPoints(box, s, includeCopy, single),
      radius = s * 0.54;
    context.save();
    context.lineCap = context.lineJoin = "round";
    for (const [action, point] of Object.entries(actions)) {
      const kind = action.replace(/^item-/, ""),
        accent = kind === "cancel" ? "#fb7185" : kind === "accept" ? "#4ade80" : "#60a5fa";
      context.fillStyle = "#111827f2";
      context.strokeStyle = "#ffffffd9";
      context.lineWidth = 1.15 / state.scale;
      context.shadowColor = "#00000066";
      context.shadowBlur = 5 / state.scale;
      context.beginPath();
      context.arc(point.x, point.y, radius, 0, Math.PI * 2);
      context.fill();
      context.stroke();
      context.shadowBlur = 0;
      context.strokeStyle = accent;
      context.lineWidth = 1.75 / state.scale;
      context.beginPath();
      if (kind === "cancel") {
        context.moveTo(point.x - radius * 0.34, point.y - radius * 0.34);
        context.lineTo(point.x + radius * 0.34, point.y + radius * 0.34);
        context.moveTo(point.x + radius * 0.34, point.y - radius * 0.34);
        context.lineTo(point.x - radius * 0.34, point.y + radius * 0.34);
      } else if (kind === "accept") {
        context.moveTo(point.x - radius * 0.42, point.y);
        context.lineTo(point.x - radius * 0.1, point.y + radius * 0.3);
        context.lineTo(point.x + radius * 0.46, point.y - radius * 0.38);
      } else {
        const size = radius * 0.72,
          offset = radius * 0.2,
          corner = radius * 0.12;
        if (typeof context.roundRect === "function") context.roundRect(point.x - size / 2 - offset, point.y - size / 2 + offset, size, size, corner);
        else context.rect(point.x - size / 2 - offset, point.y - size / 2 + offset, size, size);
        context.stroke();
        context.beginPath();
        if (typeof context.roundRect === "function") context.roundRect(point.x - size / 2 + offset, point.y - size / 2 - offset, size, size, corner);
        else context.rect(point.x - size / 2 + offset, point.y - size / 2 - offset, size, size);
      }
      context.stroke();
    }
    context.restore();
  }
  function drawCopyFeedback(context, box, s, target) {
    if (target?.copyFeedbackGeneration !== state.copyGeneration || !Number.isFinite(target.copyFeedbackUntil) || target.copyFeedbackUntil <= performance.now()) return;
    const unit = 1 / state.scale,
      label = t("textCopied"),
      fontSize = 11 * unit,
      paddingX = 6 * unit,
      paddingY = 4 * unit;
    context.save();
    context.font = `700 ${fontSize}px system-ui, sans-serif`;
    const width = context.measureText(label).width + paddingX * 2,
      height = fontSize + paddingY * 2,
      x = Math.max(0, Math.min(SIZE - width, box.x + box.w / 2 - width / 2)),
      above = box.y - s * 1.15 - height,
      y = above >= 0 ? above : Math.min(SIZE - height, box.y + s * 0.95);
    context.fillStyle = "#111827e8";
    context.fillRect(x, y, width, height);
    context.fillStyle = "#fff";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(label, x + width / 2, y + height / 2);
    context.restore();
  }
  function drawResizeHandle(context, b, s) {
    context.moveTo(b.x + b.w - s * 0.52, b.y + b.h);
    context.lineTo(b.x + b.w, b.y + b.h - s * 0.52);
    context.moveTo(b.x + b.w - s * 0.28, b.y + b.h);
    context.lineTo(b.x + b.w, b.y + b.h - s * 0.28);
  }
  function drawMoveHandle(context, b, s, selected) {
    const x = b.x + b.w / 2,
      y = b.y - s * 0.46,
      radius = s * 0.34;
    context.save();
    context.fillStyle = selected ? "#eef8ff" : "#eef8ffcc";
    context.strokeStyle = selected ? "#2679b8" : "#72b7e5";
    context.lineWidth = 1.5 / state.scale;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.beginPath();
    context.moveTo(x - radius * 0.55, y);
    context.lineTo(x + radius * 0.55, y);
    context.moveTo(x, y - radius * 0.55);
    context.lineTo(x, y + radius * 0.55);
    context.stroke();
    context.restore();
  }
  function pendingHit(p, e, moveOnly = false) {
    const q = clientPoint(e),
      b = draftBounds(p),
      s = 14 / state.scale;
    if (p.items) {
      const actionRadius = e.pointerType === "touch" ? 22 / state.scale : Math.max(s * 0.8, 9 / state.scale),
        handleRadius = Math.max(s * 0.72, 8 / state.scale),
        selectedControlZ = p.items.length * 10 + 50,
        controls = [],
        addControl = (hit, point, radius, itemIndex, z) => {
          const distance = Math.hypot(q.x - point.x, q.y - point.y);
          if (distance <= radius) controls.push({ hit, itemIndex, distance, z });
        };
      const selected = p.items[p.selectedIndex],
        selectedChromeVisible = !selected?.animationScene || pendingAnimationChromeVisible(p, p.selectedIndex),
        batchChromeVisible = !selected?.animationScene || selectedChromeVisible;
      if (p.items.length > 1 && !moveOnly && batchChromeVisible)
        addControl("batch-resize", { x: b.x + b.w, y: b.y + b.h }, Math.max(handleRadius, (e.pointerType === "touch" ? 16 : 10) / state.scale), null, p.items.length * 10 + 100);
      if (selected && !moveOnly && selectedChromeVisible) {
        const box = pendingItemBounds(selected),
          handles = [
            { hit: "resize", point: { x: box.x + box.w, y: box.y + box.h } },
            { hit: "width", point: { x: box.x + box.w + s * 0.08, y: box.y + box.h / 2 } },
            { hit: "height", point: { x: box.x + box.w / 2, y: box.y + box.h + s * 0.08 } },
          ];
        handles.forEach((handle, index) => addControl(handle.hit, handle.point, handleRadius, p.selectedIndex, selectedControlZ + 20 + index));
      }
      for (let index = p.items.length - 1; index >= 0; index--) {
        const item = p.items[index],
          box = pendingItemBounds(item),
          controlZ = index === p.selectedIndex ? selectedControlZ : index * 10;
        if (!moveOnly && (!item.animationScene || pendingAnimationChromeVisible(p, index))) Object.entries(draftActionPoints(box, s, pendingCopyable(item))).forEach(([hit, point], actionIndex) => addControl(hit, point, actionRadius, index, controlZ + 2 + actionIndex));
      }
      controls.sort((a, b) => a.distance - b.distance || b.z - a.z);
      if (controls[0]) return { hit: controls[0].hit, itemIndex: controls[0].itemIndex };
      if (p.items.length > 1 && batchChromeVisible) {
        const frameOuter = (e.pointerType === "touch" ? 16 : 10) / state.scale,
          frameInner = (e.pointerType === "touch" ? 6 : 4) / state.scale,
          right = b.x + b.w,
          bottom = b.y + b.h,
          insetX = Math.min(frameInner, b.w / 4),
          insetY = Math.min(frameInner, b.h / 4),
          insideOuter = q.x >= b.x - frameOuter && q.x <= right + frameOuter && q.y >= b.y - frameOuter && q.y <= bottom + frameOuter,
          insideInset = q.x > b.x + insetX && q.x < right - insetX && q.y > b.y + insetY && q.y < bottom - insetY,
          nearFrame =
            insideOuter && !insideInset;
        if (nearFrame) return { hit: "batch-move", itemIndex: null };
      }
      for (let index = p.items.length - 1; index >= 0; index--) {
        const box = pendingItemBounds(p.items[index]);
        if (q.x >= box.x && q.x <= box.x + box.w && q.y >= box.y && q.y <= box.y + box.h) return { hit: "move", itemIndex: index };
      }
      if (p.items.length > 1 && q.x >= b.x && q.x <= b.x + b.w && q.y >= b.y && q.y <= b.y + b.h) return { hit: "batch-move", itemIndex: null };
      return null;
    }
    if (moveOnly) return q.x >= b.x && q.x <= b.x + b.w && q.y >= b.y && q.y <= b.y + b.h ? "move" : null;
    if (p.animationScene && !pendingAnimationChromeVisible(p)) return q.x >= b.x && q.x <= b.x + b.w && q.y >= b.y && q.y <= b.y + b.h ? "move" : null;
    const points = {
        ...draftActionPoints(b, s, pendingCopyable(p), true),
        resize: { x: b.x + b.w, y: b.y + b.h },
      };
    points.width = { x: b.x + b.w + s * 0.08, y: b.y + b.h / 2 };
    points.height = { x: b.x + b.w / 2, y: b.y + b.h + s * 0.08 };
    const nearest = Object.entries(points)
      .map(([name, point]) => ({ name, distance: Math.hypot(q.x - point.x, q.y - point.y) }))
      .filter((control) => control.distance <= Math.max(s * 1.8, 18 / state.scale))
      .sort((a, b) => a.distance - b.distance)[0];
    if (nearest) return nearest.name;
    return q.x >= b.x && q.x <= b.x + b.w && q.y >= b.y && q.y <= b.y + b.h ? "move" : null;
  }
  function pendingTextTarget(p, itemIndex = null) {
    if (!p) return null;
    if (!p.items) return itemIndex == null ? p : null;
    return Number.isInteger(itemIndex) ? p.items[itemIndex] || null : null;
  }
  function fallbackCopyText(text) {
    const field = document.createElement("textarea"),
      activeElement = document.activeElement,
      selection = document.getSelection();
    const ranges = [];
    try {
      for (let index = 0; selection && index < selection.rangeCount; index++) ranges.push(selection.getRangeAt(index).cloneRange());
    } catch {}
    field.className = "clipboard-copy-fallback";
    field.value = text;
    field.setAttribute("readonly", "");
    field.setAttribute("tabindex", "-1");
    field.setAttribute("aria-hidden", "true");
    document.body.append(field);
    try {
      field.focus({ preventScroll: true });
    } catch {
      field.focus();
    }
    field.select();
    field.setSelectionRange(0, field.value.length);
    let copied = false;
    try {
      copied = Boolean(document.execCommand?.("copy"));
    } catch {}
    field.remove();
    try {
      activeElement?.focus?.({ preventScroll: true });
    } catch {}
    try {
      selection?.removeAllRanges();
      for (const range of ranges) selection?.addRange(range);
    } catch {}
    return copied;
  }
  async function writeClipboardText(text) {
    // Keep the synchronous fallback inside the trusted pointer event. This is
    // required for LAN HTTP and embedded browsers, and avoids losing transient
    // user activation while waiting for an asynchronous Clipboard API failure.
    if (fallbackCopyText(text)) return true;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (error) {
      debug("clipboard-copy-failed", {
        name: error?.name || "UnknownError",
        secureContext: Boolean(window.isSecureContext),
        focused: Boolean(document.hasFocus?.()),
      });
    }
    return false;
  }
  async function copyPendingText(itemIndex = null) {
    const pending = state.pending,
      target = pendingTextTarget(pending, itemIndex),
      text = pendingCopyValue(target);
    if (typeof text !== "string") return false;
    const generation = ++state.copyGeneration,
      stillPending = () => state.copyGeneration === generation && state.pending === pending && (pending?.items ? pending.items.includes(target) : target === pending);
    setStatusKey("copyText");
    requestRender();
    const copied = await writeClipboardText(text);
    if (!stillPending()) return copied;
    if (!copied) {
      setStatusKey("textCopyFailed");
      return false;
    }
    setStatusKey("textCopied");
    target.copyFeedbackGeneration = generation;
    target.copyFeedbackUntil = performance.now() + COPY_FEEDBACK_MS;
    requestRender();
    setTimeout(() => {
      if (!stillPending() || target.copyFeedbackGeneration !== generation) return;
      if (target.copyFeedbackUntil <= performance.now()) {
        target.copyFeedbackUntil = 0;
        requestRender();
      }
      if (state.statusKey === "textCopied") setStatusKey(state.pending?.items ? "batchDraftReady" : state.pending ? "draftReady" : "ready");
    }, COPY_FEEDBACK_MS + 30);
    return true;
  }
  function acceptPending(options) {
    options ||= {};
    const restoreMode = options?.restoreMode !== false;
    const p = state.pending;
    if (!p) return;
    const pendingBefore = capturePendingHistoryState();
    blockCanvasInput();
    if (p.revision !== state.userRevision && state.userRevision !== p.latestUserRevision) {
      rejectPending();
      setStatusKey("canvasChanged");
      return;
    }
    const acceptedCount = p.items ? (p.acceptedItems || 0) + p.items.length : 1;
    if (p.items) {
      commitPendingBatch(p);
      consumePendingInput(p);
    }
    else if (p.animationScene) {
      const box = draftBounds(p);
      addAnimation(p.animationScene, box, p.animationPlayback);
    }
    else if (p.textCommand) {
      const box = draftBounds(p);
      blitClipped(p.image, p.x, p.y, (p.image.logicalWidth || p.image.width) * p.scaleX, (p.image.logicalHeight || p.image.height) * p.scaleY, box.w, box.h);
    }
    else blitSized(p.image, p.x, p.y, (p.image.logicalWidth || p.image.width) * p.scaleX, (p.image.logicalHeight || p.image.height) * p.scaleY);
    state.pending = null;
    state.pendingGesture = null;
    hideAnimationControls();
    updateBatchActions();
    const historyEntry = save();
    recordPendingHistory(historyEntry, pendingBefore, capturePendingHistoryState());
    render();
    setStatusKey("merged");
    resolvePending(p, p.items ? { acceptedCount } : true);
    if (restoreMode) finishAIDraftHandMode();
    if (options.showHint) showHandStatusHint("ai-draft-confirmed", ["handDraftConfirmedHint", "handAutoAIManual"]);
  }
  function acceptPendingItem(index) {
    const p = state.pending,
      item = p?.items?.[index];
    if (!item) return;
    const pendingBefore = capturePendingHistoryState();
    blockCanvasInput();
    if (p.revision !== state.userRevision && state.userRevision !== p.latestUserRevision) {
      rejectPending();
      setStatusKey("canvasChanged");
      return;
    }
    commitPendingItem(item);
    p.acceptedItems = (p.acceptedItems || 0) + 1;
    consumePendingInput(p);
    removePendingItem(p, index);
    const historyEntry = save();
    finishPendingItemAction(p, "itemAccepted");
    recordPendingHistory(historyEntry, pendingBefore, capturePendingHistoryState());
  }
  function rejectPendingItem(index) {
    const p = state.pending;
    if (!p?.items?.[index]) return;
    blockCanvasInput();
    removePendingItem(p, index);
    finishPendingItemAction(p, "itemDiscarded");
  }
  function removePendingItem(p, index) {
    const selected = p.items[p.selectedIndex],
      removedSelected = selected === p.items[index];
    p.items.splice(index, 1);
    if (removedSelected) p.selectedIndex = Math.max(0, Math.min(index, p.items.length - 1));
    else p.selectedIndex = Math.max(0, p.items.indexOf(selected));
    state.pendingGesture = null;
  }
  function consumePendingInput(p) {
    if (p.inputConsumed) return;
    p.inputConsumed = true;
    if (state.activeAI) {
      state.activeAI.dirtyRestored = true;
      state.activeAI.inputConsumed = true;
    }
    // Selection-scoped drafts are independent of the normal handwriting stream. They
    // must not consume its last box, hotspots, or typed input when the draft is accepted.
    if (p.isolatedSelection) {
      if (p.selection) p.selection.acceptedDraft = true;
      return;
    }
    state.lastUserBox = p.latestBox;
    if (p.hotspotEnd) {
      const end = state.hotspotTrail.indexOf(p.hotspotEnd);
      if (end >= 0) state.hotspotTrail.splice(0, end + 1);
    }
    clearDirtyContributionTracking();
  }
  function finishPendingItemAction(p, statusKey) {
    if (p.items.length) {
      setStatusKey(statusKey);
      updateBatchActions();
      render();
      if (pendingAnimationControlTarget()) showAnimationControls();
      else hideAnimationControls();
      return;
    }
    state.pending = null;
    state.pendingGesture = null;
    hideAnimationControls();
    updateBatchActions();
    render();
    const accepted = Boolean(p.acceptedItems);
    setStatusKey(accepted ? "merged" : "draftRejected");
    resolvePending(p, p.acceptedItems ? { acceptedCount: p.acceptedItems } : false);
    finishAIDraftHandMode();
  }
  function rejectPending(options) {
    options ||= {};
    const restoreMode = options?.restoreMode !== false;
    if (!state.pending) return;
    blockCanvasInput();
    const p = state.pending;
    state.pending = null;
    state.pendingGesture = null;
    hideAnimationControls();
    updateBatchActions();
    render();
    const accepted = Boolean(p.acceptedItems);
    setStatusKey(accepted ? "merged" : "draftRejected");
    resolvePending(p, p.items && p.acceptedItems ? { acceptedCount: p.acceptedItems } : false);
    if (restoreMode) finishAIDraftHandMode();
  }
  function notePendingContinuedInput(drawing) {
    const p = state.pending;
    if (!p) return;
    p.latestUserRevision = state.userRevision;
    p.continuedDistance = (p.continuedDistance || 0) + drawing.screenDistance;
  }
  function cancelPendingForRevision() {
    if (state.pendingWidget) rejectPendingWidget(AI_CANCELLED);
    if (!state.pending) return;
    const p = state.pending;
    state.pending = null;
    state.pendingGesture = null;
    hideAnimationControls();
    updateBatchActions();
    render();
    resolvePending(p, AI_CANCELLED);
    finishAIDraftHandMode();
  }
  function resolvePending(p, result) {
    if (!p) return;
    const callbacks = Array.isArray(p.resolves) ? p.resolves.splice(0) : p.resolve ? [p.resolve] : [];
    p.resolve = null;
    callbacks.forEach((callback) => callback(result));
  }
  function queuePendingResolve(p, resolve) {
    if (typeof resolve !== "function") return;
    if (!Array.isArray(p.resolves)) p.resolves = [];
    if (p.resolve) {
      p.resolves.push(p.resolve);
      p.resolve = null;
    }
    p.resolves.push(resolve);
  }
  function pendingSingleItem(p) {
    return {
      command: p.command || p.textCommand || {},
      image: p.image,
      textCommand: p.textCommand ? { ...p.textCommand } : null,
      animationScene: p.animationScene || null,
      animationPlayback: p.animationPlayback || null,
      copyText: pendingCopyValue(p),
      x: p.x,
      y: p.y,
      scaleX: p.scaleX || 1,
      scaleY: p.scaleY || 1,
      layoutWidth: p.layoutWidth || p.image.logicalWidth || p.image.width,
      layoutHeight: p.layoutHeight || p.image.logicalHeight || p.image.height,
    };
  }
  function appendPendingItems(p, items, revision, meta, resolve) {
    if (!p.items) {
      p.items = [pendingSingleItem(p)];
      p.selectedIndex = 0;
      p.revealProgress = 1;
    }
    const firstAddedIndex = p.items.length,
      additions = items.map((item) => ({ ...item, x: item.erase ? item.bounds.x : item.x, y: item.erase ? item.bounds.y : item.y, scaleX: item.scaleX || 1, scaleY: item.scaleY || 1, animationPlayback: item.animationScene ? item.animationPlayback || createAnimationPlayback() : null })),
      addedAnimationIndex = additions.findIndex((item) => item.animationScene);
    p.items.push(...additions);
    if (addedAnimationIndex >= 0) p.selectedIndex = firstAddedIndex + addedAnimationIndex;
    if (!p.selection && state.activeAI?.isolatedSelection) p.selection = state.activeAI.selection || null;
    if (state.activeAI?.isolatedSelection) p.isolatedSelection = true;
    p.latestUserRevision = state.userRevision;
    if (!p.isolatedSelection) {
      p.latestBox = state.activeAI?.dirtySnapshot || state.lastUserBox || p.latestBox;
      p.hotspotEnd = state.hotspotTrail.at(-1) || p.hotspotEnd;
    }
    p.meta = meta || p.meta;
    p.revision = revision;
    queuePendingResolve(p, resolve);
    updateBatchActions();
    setStatusKey("batchDraftReady");
    render();
    requestAnimationLayerRender();
    if (pendingAnimationControlTarget()) showAnimationControls();
    releaseSelectionAITransformLock();
  }
  function startPending(image, x, y, revision, meta, command) {
    return new Promise((resolve) => {
      enterAIDraftHandMode();
      const textCommand = command.tool === "write_text" ? { ...command } : null,
        animationScene = command.tool === "animate_scene" ? command : null,
        copyText = copyTextForCommand(command),
        layoutWidth = textCommand ? command.maxWidth : image.logicalWidth || image.width,
        layoutHeight = image.logicalHeight || image.height;
      if (state.pending) {
        appendPendingItems(state.pending, [{ command: { ...command }, image, textCommand, animationScene, copyText, x, y, layoutWidth, layoutHeight }], revision, meta, resolve);
        return;
      }
      const rows = image.revealRows || [image.logicalWidth || image.width],
        distance = rows.reduce((sum, width) => sum + width, 0),
        duration = Math.max(900, Math.min(6200, distance * 0.7));
      state.pending = {
        command: { ...command },
        image,
        x,
        y,
        scaleX: 1,
        scaleY: 1,
        textCommand,
        copyText,
        animationScene,
        animationPlayback: animationScene ? createAnimationPlayback() : null,
        layoutWidth,
        layoutHeight,
        heightLocked: false,
        revealProgress: animationScene ? 1 : 0,
        revision,
        meta,
        isolatedSelection: Boolean(state.activeAI?.isolatedSelection),
        selection: state.activeAI?.isolatedSelection ? state.activeAI.selection || null : null,
        resolves: [resolve],
      };
      releaseSelectionAITransformLock();
      updateBatchActions();
      const p = state.pending,
        started = performance.now();
      if (animationScene) {
        setStatusKey("draftReady");
        render();
        showAnimationControls();
        requestAnimationLayerRender();
        return;
      }
      function step(now) {
        if (!state.pending || state.pending !== p) return;
        p.revealProgress = Math.min(1, (now - started) / duration);
        render();
        if (p.revealProgress < 1) requestAnimationFrame(step);
        else setStatusKey("draftReady");
      }
      requestAnimationFrame(step);
    });
  }
  function startPendingBatch(items, revision, meta) {
    return new Promise((resolve) => {
      enterAIDraftHandMode();
      if (state.pending) {
        appendPendingItems(state.pending, items, revision, meta, resolve);
        return;
      }
      state.pending = {
        items: items.map((item) => ({ ...item, x: item.erase ? item.bounds.x : item.x, y: item.erase ? item.bounds.y : item.y, scaleX: 1, scaleY: 1, animationPlayback: item.animationScene ? item.animationPlayback || createAnimationPlayback() : null })),
        selectedIndex: Math.max(0, items.findIndex((item) => item.animationScene)),
        revealProgress: 1,
        revision,
        meta,
        isolatedSelection: Boolean(state.activeAI?.isolatedSelection),
        selection: state.activeAI?.isolatedSelection ? state.activeAI.selection || null : null,
        latestBox: state.activeAI?.isolatedSelection ? null : state.activeAI?.dirtySnapshot || state.lastUserBox,
        hotspotEnd: state.activeAI?.isolatedSelection ? null : state.hotspotTrail.at(-1) || null,
        resolves: [resolve],
      };
      releaseSelectionAITransformLock();
      updateBatchActions();
      setStatusKey("batchDraftReady");
      render();
      requestAnimationLayerRender();
      if (pendingAnimationControlTarget()) showAnimationControls();
    });
  }
  function commitPendingBatch(p) {
    for (const item of p.items) commitPendingItem(item);
  }
  function commitPendingItem(item) {
    const box = pendingItemBounds(item);
    if (item.erase) eraseWithMask(item.image, box.x, box.y, box.w, box.h);
    else if (item.textCommand) blitClipped(item.image, item.x, item.y, (item.image.logicalWidth || item.image.width) * item.scaleX, (item.image.logicalHeight || item.image.height) * item.scaleY, box.w, box.h);
    else if (item.animationScene) addAnimation(item.animationScene, box, item.animationPlayback);
    else blitSized(item.image, box.x, box.y, (item.image.logicalWidth || item.image.width) * item.scaleX, (item.image.logicalHeight || item.image.height) * item.scaleY);
  }
  function armPendingCopy(e, hit, itemIndex = null) {
    const pending = state.pending;
    if (!pending) return false;
    state.pendingGesture = {
      id: e.pointerId,
      hit,
      itemIndex,
      pending,
      armed: true,
      copy: true,
    };
    return true;
  }
  function pendingCopyMatches(gesture, event) {
    const pending = state.pending;
    if (!gesture?.copy || pending !== gesture.pending) return false;
    const result = pendingHit(pending, event, pending.revealProgress < 1),
      hit = typeof result === "string" ? result : result?.hit,
      itemIndex = result && typeof result === "object" ? result.itemIndex : null;
    return hit === gesture.hit && itemIndex === gesture.itemIndex;
  }
  function finishPendingCopy(event) {
    const gesture = state.pendingGesture;
    if (!gesture?.copy || gesture.id !== event.pointerId) return false;
    const shouldCopy = event.type !== "pointercancel" && gesture.armed && pendingCopyMatches(gesture, event);
    state.pendingGesture = null;
    resetCanvasCursor();
    if (shouldCopy) void copyPendingText(gesture.itemIndex);
    return true;
  }
  function beginPendingGesture(e, hit, itemIndex = null) {
    const p = state.pending,
      q = clientPoint(e);
    if (p.items && itemIndex != null) {
      p.selectedIndex = itemIndex;
      if (p.items[itemIndex]?.animationScene) showAnimationControls();
      else hideAnimationControls();
    } else if (!p.items && p.animationScene) showAnimationControls();
    const gesture = {
      id: e.pointerId,
      hit,
      itemIndex,
      last: q,
      armed: true,
      startX: q.x,
      startY: q.y,
    };
    if (p.items && (hit === "batch-move" || hit === "batch-resize")) {
      gesture.batchStartBounds = batchBounds(p);
      gesture.itemStarts = p.items.map((item) => ({ x: item.x, y: item.y, scaleX: item.scaleX, scaleY: item.scaleY }));
    }
    state.pendingGesture = gesture;
    setCanvasCursor(hit === "resize" || hit === "batch-resize" ? "nwse-resize" : hit === "width" ? "ew-resize" : hit === "height" ? "ns-resize" : "grabbing");
    render();
  }
  function resizePendingBatchItems(items, startBox, itemStarts, point, minimum, limit) {
    const target = SELECT.resizeBox(startBox, point, minimum, limit),
      scale = startBox.w > 0 ? target.w / startBox.w : startBox.h > 0 ? target.h / startBox.h : 1;
    items.forEach((item, index) => {
      const start = itemStarts[index];
      if (!start) return;
      item.x = startBox.x + (start.x - startBox.x) * scale;
      item.y = startBox.y + (start.y - startBox.y) * scale;
      item.scaleX = start.scaleX * scale;
      item.scaleY = start.scaleY * scale;
    });
    return target;
  }
  function updatePendingGesture(e) {
    const g = state.pendingGesture,
      p = state.pending;
    if (!g || !p || g.id !== e.pointerId) return false;
    if (g.copy) {
      g.armed = pendingCopyMatches(g, e);
      return true;
    }
    const q = clientPoint(e);
    if (p.items) {
      if (g.hit === "batch-move") {
        if (g.armed) {
          const box = g.batchStartBounds,
            dx = Math.max(-box.x, Math.min(SIZE - box.x - box.w, q.x - g.startX)),
            dy = Math.max(-box.y, Math.min(SIZE - box.y - box.h, q.y - g.startY));
          p.items.forEach((item, index) => {
            item.x = g.itemStarts[index].x + dx;
            item.y = g.itemStarts[index].y + dy;
          });
        }
        g.last = q;
        if (g.armed) render();
        return true;
      }
      if (g.hit === "batch-resize") {
        if (g.armed) resizePendingBatchItems(p.items, g.batchStartBounds, g.itemStarts, q, 40, SIZE);
        g.last = q;
        if (g.armed) render();
        return true;
      }
      const item = p.items[g.itemIndex],
        box = item ? pendingItemBounds(item) : null;
      if (!item || !box) return false;
      if (g.hit === "move" && g.armed) {
        item.x = Math.max(0, Math.min(SIZE - box.w, item.x + q.x - g.last.x));
        item.y = Math.max(0, Math.min(SIZE - box.h, item.y + q.y - g.last.y));
      } else if (g.hit === "resize" && g.armed) {
        const baseWidth = box.w / item.scaleX,
          baseHeight = box.h / item.scaleY,
          minimum = Math.max(40 / baseWidth, 40 / baseHeight),
          maximum = Math.min((SIZE - item.x) / baseWidth, (SIZE - item.y) / baseHeight),
          next = Math.max(minimum, Math.min(maximum, Math.max((q.x - item.x) / baseWidth, (q.y - item.y) / baseHeight)));
        item.scaleX = item.scaleY = next;
      } else if (g.hit === "width" && g.armed) {
        if (item.textCommand) {
          const layoutWidth=Math.max(item.textCommand.fontSize,Math.min((SIZE-item.x)/item.scaleX,(q.x-item.x)/item.scaleX));
          item.layoutWidth=layoutWidth;
          item.image=textImage(item.textCommand.text,item.textCommand.fontSize,item.textCommand.color,item.layoutWidth,item.textCommand.lineHeight);
          if(!item.heightLocked)item.layoutHeight=item.image.logicalHeight||item.image.height;
        } else {
          const baseWidth = box.w / item.scaleX;
          item.scaleX = Math.max(40 / baseWidth, Math.min((SIZE - item.x) / baseWidth, (q.x - item.x) / baseWidth));
        }
      } else if (g.hit === "height" && g.armed) {
        if (item.textCommand) {
          item.layoutHeight = Math.max(item.textCommand.fontSize * item.textCommand.lineHeight + 8, Math.min((SIZE - item.y) / item.scaleY, (q.y - item.y) / item.scaleY));
          item.heightLocked = true;
        } else {
          const baseHeight = box.h / item.scaleY;
          item.scaleY = Math.max(40 / baseHeight, Math.min((SIZE - item.y) / baseHeight, (q.y - item.y) / baseHeight));
        }
      }
      g.last = q;
      if (g.armed) render();
      return true;
    }
    if (g.hit === "move" && g.armed) {
      const b = draftBounds(p);
      p.x = Math.max(0, Math.min(SIZE - b.w, p.x + q.x - g.last.x));
      p.y = Math.max(0, Math.min(SIZE - b.h, p.y + q.y - g.last.y));
    } else if (g.hit === "resize" && g.armed) {
      const minimum = 40,
        baseWidth = p.textCommand ? p.layoutWidth : p.image.logicalWidth || p.image.width,
        baseHeight = p.textCommand ? p.layoutHeight : p.image.logicalHeight || p.image.height,
        ratio = Math.max(minimum / baseWidth, minimum / baseHeight),
        maxScale = Math.max(ratio, Math.min((SIZE - p.x) / baseWidth, (SIZE - p.y) / baseHeight)),
        next = Math.max(ratio, Math.min(maxScale, Math.max((q.x - p.x) / baseWidth, (q.y - p.y) / baseHeight)));
      p.scaleX = p.scaleY = next;
    } else if (g.hit === "width" && g.armed) {
      if (p.textCommand) {
        const layoutWidth=Math.max(p.textCommand.fontSize,Math.min((SIZE-p.x)/p.scaleX,(q.x-p.x)/p.scaleX));
        p.layoutWidth=layoutWidth;
        p.image=textImage(p.textCommand.text,p.textCommand.fontSize,p.textCommand.color,p.layoutWidth,p.textCommand.lineHeight);
        if(!p.heightLocked)p.layoutHeight=p.image.logicalHeight||p.image.height;
      } else {
        const baseWidth = draftBounds(p).w / p.scaleX;
        p.scaleX = Math.max(40 / baseWidth, Math.min((SIZE - p.x) / baseWidth, (q.x - p.x) / baseWidth));
      }
    } else if (g.hit === "height" && g.armed) {
      if (p.textCommand) {
        p.layoutHeight = Math.max(p.textCommand.fontSize * p.textCommand.lineHeight + 8, Math.min((SIZE - p.y) / p.scaleY, (q.y - p.y) / p.scaleY));
        p.heightLocked = true;
      } else {
        const baseHeight = draftBounds(p).h / p.scaleY;
        p.scaleY = Math.max(40 / baseHeight, Math.min((SIZE - p.y) / baseHeight, (q.y - p.y) / baseHeight));
      }
    }
    g.last = q;
    if (g.armed) render();
    return true;
  }
  function eraseRect(x, y, w, h) {
    invalidateSharpOverlays({ x, y, w, h });
    forTiles(
      x,
      y,
      w,
      h,
      (t, tx, ty) => {
        recordBefore(tx, ty);
        t.getContext("2d").clearRect(x - tx * TILE, y - ty * TILE, w, h);
        state.inkBounds.delete(key(tx, ty));
      },
      false,
    );
  }
  function eraseMask(c, bounds) {
    const image = offscreen(Math.max(1, bounds.w), Math.max(1, bounds.h)),
      context = image.getContext("2d");
    context.fillStyle = "#dc2626";
    context.strokeStyle = "#dc2626";
    if (c.mode === "path") {
      context.lineWidth = c.size;
      context.lineCap = context.lineJoin = "round";
      context.beginPath();
      c.points.forEach(([x, y], index) => {
        const px = x - bounds.x,
          py = y - bounds.y;
        if (index) context.lineTo(px, py);
        else context.moveTo(px, py);
      });
      if (c.points.length === 1) context.lineTo(c.points[0][0] - bounds.x + 0.01, c.points[0][1] - bounds.y + 0.01);
      context.stroke();
    } else context.fillRect(0, 0, image.width, image.height);
    return image;
  }
  function eraseWithMask(image, x, y, w, h) {
    invalidateSharpOverlays({ x, y, w, h });
    forTiles(
      x,
      y,
      w,
      h,
      (canvas, tx, ty) => {
        recordBefore(tx, ty);
        const context = canvas.getContext("2d");
        context.save();
        context.globalCompositeOperation = "destination-out";
        context.drawImage(image, x - tx * TILE, y - ty * TILE, w, h);
        context.restore();
        state.inkBounds.delete(key(tx, ty));
      },
      false,
    );
  }
  function eraseBounds(c) {
    if (c.mode !== "path") return { x: c.x, y: c.y, w: c.w, h: c.h };
    const xs = c.points.map((p) => p[0]),
      ys = c.points.map((p) => p[1]),
      pad = c.size / 2;
    return {
      x: Math.max(0, Math.min(...xs) - pad),
      y: Math.max(0, Math.min(...ys) - pad),
      w: Math.min(SIZE, Math.max(...xs) + pad) - Math.max(0, Math.min(...xs) - pad),
      h: Math.min(SIZE, Math.max(...ys) + pad) - Math.max(0, Math.min(...ys) - pad),
    };
  }
  async function previewErase(c, revision) {
    const b = eraseBounds(c);
    for (let i = 1; i <= 12; i++) {
      checkAI(revision);
      render();
      ctx.save();
      ctx.translate(state.panX, state.panY);
      ctx.scale(state.scale, state.scale);
      ctx.fillStyle = "rgba(220,38,38,.16)";
      ctx.fillRect(b.x, b.y, (b.w * i) / 12, b.h);
      ctx.restore();
      await wait(22);
    }
  }
  function commitErasePath(c) {
    const pts = c.points.map(([x, y]) => ({ x, y }));
    if (pts.length === 1) pts.push({ ...pts[0] });
    for (let i = 1; i < pts.length; i++) stroke(pts[i - 1], pts[i], true, c.size, false);
  }
  function compileExpression(source) {
    const text = normalizePlotExpression(source)
      .trim()
      .replace(/^y\s*=\s*/i, "");
    if (!text || text.length > 180 || !/^[\d\sA-Za-z_+\-*/^().]+$/.test(text)) throw Error("Unsupported expression");
    const tokens = [],
      re = /\s*(\d*\.?\d+(?:e[+\-]?\d+)?|[A-Za-z_]+|[()+\-*/^])/gy;
    let at = 0,
      m;
    while ((m = re.exec(text))) {
      if (m.index !== at) throw Error("Invalid token");
      tokens.push(m[1]);
      at = re.lastIndex;
    }
    if (at !== text.length || tokens.length > 100) throw Error("Expression too complex");
    let i = 0;
    const funcs = {
      sin: Math.sin,
      cos: Math.cos,
      tan: Math.tan,
      sqrt: Math.sqrt,
      abs: Math.abs,
      exp: Math.exp,
      log: Math.log,
      ln: Math.log,
    };
    function take(v) {
      if (tokens[i] === v) {
        i++;
        return true;
      }
      return false;
    }
    function primary() {
      const t = tokens[i++];
      if (t === "(") {
        const v = add();
        if (!take(")")) throw Error("Unclosed parenthesis");
        return v;
      }
      if (/^\d|^\./.test(t || "")) return () => Number(t);
      if (t === "x") return (x) => x;
      if (t === "pi") return () => Math.PI;
      if (t === "e") return () => Math.E;
      if (funcs[t]) {
        if (!take("(")) throw Error("Function needs parentheses");
        const arg = add();
        if (!take(")")) throw Error("Unclosed function");
        return (x) => funcs[t](arg(x));
      }
      throw Error("Unknown identifier");
    }
    function unary() {
      if (take("+")) return unary();
      if (take("-")) {
        const v = unary();
        return (x) => -v(x);
      }
      return primary();
    }
    function power() {
      let left = unary();
      if (take("^")) {
        const right = power(),
          old = left;
        left = (x) => old(x) ** right(x);
      }
      return left;
    }
    function multiply() {
      let left = power();
      while (tokens[i] === "*" || tokens[i] === "/") {
        const op = tokens[i++],
          right = power(),
          old = left;
        left = op === "*" ? (x) => old(x) * right(x) : (x) => old(x) / right(x);
      }
      return left;
    }
    function add() {
      let left = multiply();
      while (tokens[i] === "+" || tokens[i] === "-") {
        const op = tokens[i++],
          right = multiply(),
          old = left;
        left = op === "+" ? (x) => old(x) + right(x) : (x) => old(x) - right(x);
      }
      return left;
    }
    const result = add();
    if (i !== tokens.length) throw Error("Unexpected expression tail");
    return result;
  }
  function normalizePlotExpression(source) {
    return String(source || "")
      .trim()
      .replace(/[−–—]/g, "-")
      .replace(/[×·]/g, "*")
      .replace(/÷/g, "/")
      .replace(/π/gi, "pi")
      .replace(/√\s*\(([^()]*)\)/g, "sqrt($1)")
      .replace(/√\s*([A-Za-z0-9_.]+)/g, "sqrt($1)")
      .replace(/(\d|\)|x(?![A-Za-z_])|pi(?![A-Za-z_])|e(?![A-Za-z_]))\s*(?=x|pi|e(?![+\-]?\d)|sin|cos|tan|sqrt|abs|exp|log|ln|\()/gi, "$1*");
  }
  function plot(c) {
    const o = offscreen(c.w, c.h),
      q = o.getContext("2d"),
      minSide = Math.min(c.w, c.h),
      tickFont = Math.max(10, Math.min(96, minSide * 0.032)),
      titleFont = Math.max(11, Math.min(112, minSide * 0.041)),
      margin = {
        left: Math.max(42, minSide * 0.105),
        right: Math.max(24, minSide * 0.06),
        top: Math.max(42, minSide * 0.12),
        bottom: Math.max(38, minSide * 0.1),
      },
      area = {
        left: margin.left,
        top: margin.top,
        right: c.w - margin.right,
        bottom: c.h - margin.bottom,
      },
      plotWidth = Math.max(1, area.right - area.left),
      plotHeight = Math.max(1, area.bottom - area.top),
      gridWidth = Math.max(0.75, Math.min(5, minSide * 0.002)),
      axisWidth = Math.max(1.5, Math.min(9, minSide * 0.004)),
      curveWidth = Math.max(2.2, Math.min(13, minSide * 0.006));
    let evaluate;
    try {
      evaluate = compileExpression(c.expression);
    } catch {
      return o;
    }
    const view = plotView(evaluate),
      { xMin, xMax, yMin, yMax } = view,
      xPixel = (x) => area.left + ((x - xMin) / (xMax - xMin)) * plotWidth,
      yPixel = (y) => area.bottom - ((y - yMin) / (yMax - yMin)) * plotHeight,
      axisX = Math.max(area.left, Math.min(area.right, xPixel(0))),
      axisY = Math.max(area.top, Math.min(area.bottom, yPixel(0))),
      xStep = nicePlotStep(xMax - xMin, Math.max(2, plotWidth / 72)),
      yStep = nicePlotStep(yMax - yMin, Math.max(2, plotHeight / 52)),
      xTicks = plotTicks(xMin, xMax, xStep),
      yTicks = plotTicks(yMin, yMax, yStep);

    q.save();
    q.lineCap = q.lineJoin = "round";
    q.strokeStyle = "rgba(148, 163, 184, 0.34)";
    q.lineWidth = gridWidth;
    q.beginPath();
    for (const x of xTicks) {
      if (Math.abs(x) > xStep * 1e-9) {
        const px = xPixel(x);
        q.moveTo(px, area.top);
        q.lineTo(px, area.bottom);
      }
    }
    for (const y of yTicks) {
      if (Math.abs(y) > yStep * 1e-9) {
        const py = yPixel(y);
        q.moveTo(area.left, py);
        q.lineTo(area.right, py);
      }
    }
    q.stroke();

    q.strokeStyle = "#475569";
    q.fillStyle = "#475569";
    q.lineWidth = axisWidth;
    q.beginPath();
    q.moveTo(area.left, axisY);
    q.lineTo(area.right, axisY);
    q.moveTo(axisX, area.bottom);
    q.lineTo(axisX, area.top);
    q.stroke();
    const arrow = Math.max(6, Math.min(24, tickFont * 0.62));
    q.beginPath();
    q.moveTo(area.right, axisY);
    q.lineTo(area.right - arrow, axisY - arrow * 0.55);
    q.lineTo(area.right - arrow, axisY + arrow * 0.55);
    q.closePath();
    q.moveTo(axisX, area.top);
    q.lineTo(axisX - arrow * 0.55, area.top + arrow);
    q.lineTo(axisX + arrow * 0.55, area.top + arrow);
    q.closePath();
    q.fill();

    const tickLength = Math.max(4, Math.min(18, tickFont * 0.42));
    q.font = `500 ${tickFont}px ui-sans-serif, system-ui, sans-serif`;
    q.textBaseline = axisY > area.bottom - tickFont * 1.8 ? "bottom" : "top";
    q.textAlign = "center";
    q.beginPath();
    for (const x of xTicks) {
      const px = xPixel(x);
      q.moveTo(px, axisY - tickLength / 2);
      q.lineTo(px, axisY + tickLength / 2);
    }
    for (const y of yTicks) {
      const py = yPixel(y);
      q.moveTo(axisX - tickLength / 2, py);
      q.lineTo(axisX + tickLength / 2, py);
    }
    q.stroke();
    for (const x of xTicks) {
      if (Math.abs(x) > xStep * 1e-9) q.fillText(formatPlotTick(x, xStep), xPixel(x), axisY + (q.textBaseline === "top" ? tickLength * 0.7 : -tickLength * 0.7));
    }
    q.textAlign = axisX < area.left + tickFont * 3 ? "left" : "right";
    q.textBaseline = "middle";
    for (const y of yTicks) {
      if (Math.abs(y) > yStep * 1e-9) q.fillText(formatPlotTick(y, yStep), axisX + (q.textAlign === "left" ? tickLength * 0.8 : -tickLength * 0.8), yPixel(y));
    }
    q.textAlign = "left";
    q.textBaseline = "bottom";
    q.font = `600 ${titleFont}px ui-sans-serif, system-ui, sans-serif`;
    q.fillText("x", area.right - titleFont * 0.35, Math.max(area.top + titleFont, axisY - titleFont * 0.28));
    q.fillText("y", Math.min(area.right - titleFont, axisX + titleFont * 0.28), area.top + titleFont * 0.9);
    const title = `y = ${normalizePlotExpression(c.expression).replace(/^y\s*=\s*/i, "")}`;
    q.fillStyle = c.color || "#2563eb";
    q.textBaseline = "top";
    q.fillText(fitCanvasText(q, title, plotWidth), area.left, Math.max(2, (margin.top - titleFont) / 2));

    q.save();
    q.beginPath();
    q.rect(area.left, area.top, plotWidth, plotHeight);
    q.clip();
    q.strokeStyle = c.color || "#2563eb";
    q.lineWidth = curveWidth;
    q.beginPath();
    let joined = false,
      previousPy = 0,
      previousX = 0;
    const sampleStep = Math.max(0.5, Math.min(2, 900 / plotWidth));
    for (let px = area.left; px <= area.right; px += sampleStep) {
      const x = xMin + ((px - area.left) / plotWidth) * (xMax - xMin);
      let y;
      try {
        y = evaluate(x);
      } catch {
        y = NaN;
      }
      const py = yPixel(y),
        visibleEnough = Number.isFinite(py) && py > area.top - plotHeight * 2 && py < area.bottom + plotHeight * 2,
        midpointY = joined ? evaluate((previousX + x) / 2) : y,
        discontinuity = joined && (!Number.isFinite(midpointY) || Math.abs(py - previousPy) > plotHeight * 0.75 || Math.abs(yPixel(midpointY) - (py + previousPy) / 2) > plotHeight * 0.5);
      if (visibleEnough) {
        if (!joined) {
          q.moveTo(px, py);
          joined = true;
        } else if (discontinuity) q.moveTo(px, py);
        else q.lineTo(px, py);
        previousPy = py;
        previousX = x;
      } else joined = false;
    }
    q.stroke();
    q.restore();
    q.restore();
    return o;
  }
  function plotView(evaluate) {
    for (const extent of [5, 10, 100, 1000, 10000]) {
      const values = [];
      for (let i = 0; i <= 240; i++) {
        const y = evaluate(-extent + (i / 240) * extent * 2);
        if (Number.isFinite(y)) values.push(y);
      }
      if (values.length < 8) continue;
      if (extent === 5 && values.some((y) => y >= -10 && y <= 10)) return { xMin: -5, xMax: 5, yMin: -10, yMax: 10 };
      values.sort((a, b) => a - b);
      let low = values[Math.floor(values.length * 0.02)],
        high = values[Math.ceil(values.length * 0.98) - 1];
      if (low === high) {
        const padding = Math.max(1, Math.abs(low) * 0.1);
        low -= padding;
        high += padding;
      } else {
        const padding = (high - low) * 0.1;
        low -= padding;
        high += padding;
      }
      const step = nicePlotStep(high - low, 8);
      return { xMin: -extent, xMax: extent, yMin: Math.floor(low / step) * step, yMax: Math.ceil(high / step) * step };
    }
    return { xMin: -5, xMax: 5, yMin: -10, yMax: 10 };
  }
  function nicePlotStep(range, targetTicks) {
    const rough = Math.max(Number.MIN_VALUE, range / Math.max(1, targetTicks)),
      power = 10 ** Math.floor(Math.log10(rough)),
      normalized = rough / power,
      factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
    return factor * power;
  }
  function plotTicks(min, max, step) {
    const values = [],
      first = Math.ceil((min - step * 1e-9) / step) * step;
    for (let value = first; value <= max + step * 1e-9 && values.length < 40; value += step) values.push(Math.abs(value) < step * 1e-9 ? 0 : value);
    return values;
  }
  function formatPlotTick(value, step) {
    const digits = Math.max(0, Math.min(6, -Math.floor(Math.log10(step))));
    return Number(value.toFixed(digits)).toString();
  }
  function fitCanvasText(context, text, maxWidth) {
    if (context.measureText(text).width <= maxWidth) return text;
    let low = 0,
      high = text.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (context.measureText(`${text.slice(0, middle)}...`).width <= maxWidth) low = middle;
      else high = middle - 1;
    }
    return `${text.slice(0, low)}...`;
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  function animationPointerHit(point, pointerType = "mouse") {
    if (!pluginEnabled("animation")) return null;
    const selected = selectedAnimation(),
      radius = (pointerType === "touch" ? 24 : 14) / state.scale;
    if (selected) {
      const box = animationBox(selected);
      if (animationEditChromeVisible()) {
        const handle = 14 / state.scale,
          actionRadius = pointerType === "touch" ? 22 / state.scale : Math.max(handle * 0.8, 9 / state.scale),
          actions = draftActionPoints(box, handle, false, true),
          controls = [
            ...Object.entries(actions).map(([hit, target]) => ({ hit, target, radius: actionRadius })),
            { hit: "resize", target: { x: box.x + box.w, y: box.y + box.h }, radius },
            { hit: "width", target: { x: box.x + box.w + handle * 0.08, y: box.y + box.h / 2 }, radius },
            { hit: "height", target: { x: box.x + box.w / 2, y: box.y + box.h + handle * 0.08 }, radius },
          ];
        const control = controls
          .map((item) => ({ ...item, distance: Math.hypot(point.x - item.target.x, point.y - item.target.y) }))
          .filter((item) => item.distance <= item.radius)
          .sort((a, b) => a.distance - b.distance)[0];
        if (control) return { animation: selected, hit: control.hit };
      }
      if (point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h) return { animation: selected, hit: "move" };
    }
    const animations = visibleAnimations();
    for (let index = animations.length - 1; index >= 0; index--) {
      const animation = animations[index],
        box = animationBox(animation);
      if (point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h) return { animation, hit: "move" };
    }
    return null;
  }
  function beginAnimationGesture(event, point, result) {
    if (!result?.animation) return false;
    if (result.hit === "accept") return acceptAnimationEdit() || true;
    if (result.hit === "cancel") return cancelAnimationEdit() || true;
    if (state.selection) commitSelection();
    beginAnimationEdit(result.animation);
    state.animationGesture = {
      id: event.pointerId,
      animation: result.animation,
      hit: result.hit,
      startPoint: point,
      start: animationBox(result.animation),
      changed: false,
    };
    if (!refreshHandObjectToolbar()) showAnimationControls();
    setCanvasCursor(result.hit === "resize" ? "nwse-resize" : result.hit === "width" ? "ew-resize" : result.hit === "height" ? "ns-resize" : "grabbing");
    setStatusKey("animationSelected");
    requestAnimationLayerRender();
    requestInteractionLayerRender();
    return true;
  }
  function updateAnimationGesture(event) {
    const gesture = state.animationGesture;
    if (!gesture || gesture.id !== event.pointerId) return false;
    const point = clientPoint(event),
      animation = gesture.animation,
      dx = point.x - gesture.startPoint.x,
      dy = point.y - gesture.startPoint.y;
    if (gesture.hit === "resize") {
      const ratio = gesture.start.w / gesture.start.h,
        targetWidth = Math.max(80, Math.max(point.x - gesture.start.x, (point.y - gesture.start.y) * ratio)),
        width = Math.min(SIZE - gesture.start.x, targetWidth),
        height = Math.min(SIZE - gesture.start.y, width / ratio);
      animation.w = width;
      animation.h = height;
    } else if (gesture.hit === "width") {
      animation.w = Math.max(80, Math.min(SIZE - gesture.start.x, point.x - gesture.start.x));
    } else if (gesture.hit === "height") {
      animation.h = Math.max(80, Math.min(SIZE - gesture.start.y, point.y - gesture.start.y));
    } else {
      animation.x = Math.max(0, Math.min(SIZE - animation.w, gesture.start.x + dx));
      animation.y = Math.max(0, Math.min(SIZE - animation.h, gesture.start.y + dy));
    }
    gesture.changed ||= Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01;
    requestAnimationLayerRender();
    requestInteractionLayerRender();
    return true;
  }
  function finishAnimationGesture(event) {
    const gesture = state.animationGesture;
    if (!gesture || gesture.id !== event.pointerId) return false;
    state.animationGesture = null;
    resetCanvasCursor();
    if (gesture.changed && state.animationEdit) state.animationEdit.changed = true;
    if (!refreshHandObjectToolbar()) showAnimationControls();
    requestAnimationLayerRender();
    requestInteractionLayerRender();
    return true;
  }
  function deselectAnimation() {
    if (!state.selectedAnimationId) return;
    acceptAnimationEdit();
  }
  function isMousePan(e) {
    return e.pointerType === "mouse" && (e.button === 1 || e.altKey);
  }
  function finishDrawing(pointerType) {
    if (!state.drawing) return;
    const d = state.drawing;
    state.drawing = null;
    const shouldRequest = !d.erase;
    let refineCandidate = null;
    if (shouldRequest) {
      for (const point of d.trail) state.hotspotTrail.push(point);
      if (state.hotspotTrail.length > 512) state.hotspotTrail.splice(0, state.hotspotTrail.length - 512);
      refineCandidate = latchWidgetRefineCandidate(d);
    } else {
      recomputeDirtyBounds();
      filterErasedDirtyHotspots(d.dirtyMaskTouched);
      refineCandidate = relatchWidgetRefineCandidateFromDirty();
    }
    notePendingContinuedInput(d);
    state.autoEligible ||= shouldRequest;
    if (state.dirty && state.autoEligible && !refineCandidate) schedule();
    save();
    requestInteractionLayerRender();
    if (shouldRequest || d.erase) setStatusKey(refineCandidate ? "widgetRefinePending" : state.pending?.items ? "batchDraftReady" : state.pending ? "draftReady" : "ready");
  }
