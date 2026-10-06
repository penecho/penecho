  // PenEcho Assist (smart suggestions v2).
  //
  // Help is always one tap away beside the newest ink:
  //   1. after 500 ms of pen-up quiet, local predictions appear (no network);
  //   2. PenEchoLLM waits for quiet, ranks all pending input, then clears its dirty masks;
  //   3. a tapped action shows its progress, then Keep / Retry and follow-ups;
  //   4. "Ask" sends a typed question scoped to the ink;
  //   5. shape tools and instant graphs live in the same bar and the toolbar.
  // PenEchoLLM failures only remove the re-ranking; the local help remains.
  const SMART_SUGGEST = window.PENECHO_SMART_SUGGEST || null,
    SMART_SUGGEST_STORAGE_KEY = "penecho-smart-suggestions",
    SMART_SUGGEST_PRIOR_KEY = "penecho-smart-suggestions-instant-prior",
    ASSIST_LOCAL_DELAY_MS = 500,
    ASSIST_INK_CLEARANCE_PX = 80,
    SMART_SUGGEST_RANK_DELAY_MS = 100,
    SMART_SUGGEST_CONTINUED_RANK_DELAY_MS = 500,
    ASSIST_NAVIGATION_SETTLE_MS = 120,
    SMART_SUGGEST_SHORT_WRITING_MS = 3000,
    SMART_SUGGEST_LONG_WRITING_MS = 10000,
    SMART_SUGGEST_TIMEOUT_MS = 44000,
    SMART_SUGGEST_HOLD_MS = 520,
    SMART_SUGGEST_HOLD_SLOP_PX = 8,
    SMART_SUGGEST_SNAP_SLOP_PX = 18,
    SMART_SUGGEST_MAX_STROKES = 64,
    SMART_SUGGEST_CROP_SIDE = 512,
    SMART_SUGGEST_IMAGE_MAX_CHARS = 256 * 1024,
    smartSuggestLayer = document.querySelector("#smartSuggestLayer"),
    smartSuggestToggle = document.querySelector("#smartSuggestToggle"),
    assistToolsButton = document.querySelector("#assistToolsBtn"),
    smartSuggest = {
      enabled:(() => { try { return localStorage.getItem(SMART_SUGGEST_STORAGE_KEY) !== "false"; } catch { return true; } })(),
      available:window.PENECHO_CONFIG?.smartSuggestions === true,
      access:null,
      availability:{ pending:null, controller:null, checkedAt:0, nextAt:0, retryAfterAt:0, failures:0, authRequired:false },
      strokes:[],
      nextStrokeId:1,
      consumedStrokeId:0,
      dismissedStrokeId:0,
      dismissedObjectKey:"",
      evaluatedStrokeId:0,
      timer:0,
      localTimer:0,
      holdTimer:0,
      controller:null,
      rerun:false,
      deferred:false,
      writingMs:0,
      localReadyAt:0,
      inkReadyAt:0,
      inkEpoch:0,
      request:null,
      nextCandidate:null,
      sequence:0,
      profile:{},
      // Per-device instant-order evidence (PenEchoLLM rankings and taps); never sent.
      instantPrior:(() => {
        try { const value = JSON.parse(localStorage.getItem(SMART_SUGGEST_PRIOR_KEY) || "{}"); return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
        catch { return {}; }
      })(),
      cuesKey:"",
      cues:null,
      cooldown:{},
      recent:[],
      failures:0,
      pausedUntil:0,
      lastKey:"",
      documentId:null,
      retryKey:"",
      retries:0,
      jev:null,
      bar:null,
      frame:0,
      shapeTool:null,
      shapeGesture:null,
      analysisKey:"",
      analysis:null,
      selection:null,
      selectionKey:"",
      selectionVersion:0,
      dismissedSelection:null,
      dismissTap:null,
      reopenTap:null,
      resultSequence:0,
      requests:new Map(),
    };

  // Local Assist (instant predictions, shapes, tools) needs only the setting;
  // PenEchoLLM re-ranking additionally needs a configured relay.
  function smartSuggestActive() {
    return Boolean(SMART_SUGGEST && smartSuggestLayer && (smartSuggest.enabled || state.selection?.phase === "active"));
  }
  function smartSuggestRemote() {
    return smartSuggest.enabled && smartSuggestActive() && smartSuggest.available && !suggestionAccessBlocked();
  }
  function suggestionAccessBlocked() {
    const access=smartSuggest.access;
    return Boolean(access?.reason && (!access.resetsAt || access.resetsAt>Date.now()));
  }
  // ---------- PenEchoLLM status: who ranked these actions, and what is left ----------
  // Local predictions appear after pen-up quiet; PenEchoLLM re-ranks them a moment
  // later. The bar says which one the person is looking at, animates the
  // change, and makes the daily allowance (guest trial, free account, credit
  // continuation or subscription) visible before it runs out.
  function suggestionCopy(en, zh) { return state.language === "zh" ? zh : en; }
  function suggestionAllowance() {
    const access = smartSuggest.access;
    if (!access) return null;
    const limit = Number.isFinite(access.freeLimit) ? access.freeLimit : null,
      remaining = Number.isFinite(access.remaining) ? access.remaining : null,
      tier = access.subscribed ? "subscriber" : !access.signedIn ? "guest" : remaining > 0 ? "free" : access.paidEnabled ? "credits" : "free";
    return {
      tier, limit, remaining, used:Number(access.used) || 0,
      low:(tier === "guest" || tier === "free") && remaining !== null && limit ? remaining <= Math.max(10, Math.round(limit * 0.1)) : false,
      price:Number.isFinite(access.price) ? access.price : 0.1, spent:Number(access.spentToday) || 0,
      dailyLimit:Number.isFinite(access.dailyCreditLimit) ? access.dailyCreditLimit : null, resetsAt:access.resetsAt || 0,
      blocked:suggestionAccessBlocked(), reason:access.reason || null,
    };
  }
  function suggestionResetText(resetsAt) {
    if (!resetsAt) return "";
    try { return new Date(resetsAt).toLocaleTimeString(state.language === "zh" ? "zh-CN" : undefined, { hour:"2-digit", minute:"2-digit" }); } catch { return ""; }
  }
  // The few words beside the spark: only what the person should notice.
  function suggestionAllowanceShort(allowance) {
    if (!allowance) return "";
    if (allowance.blocked) return suggestionCopy("limit reached", "已达上限");
    if (allowance.tier === "credits") return suggestionCopy(`${allowance.price} credit`, `${allowance.price} 积分/次`);
    if ((allowance.tier === "guest" || allowance.tier === "free") && allowance.low) return suggestionCopy(`${allowance.remaining} left`, `剩 ${allowance.remaining} 次`);
    return "";
  }
  function suggestionAllowanceLines(allowance) {
    if (!allowance) return [];
    const reset = suggestionResetText(allowance.resetsAt), lines = [];
    if (allowance.tier === "subscriber") lines.push(suggestionCopy("Unlimited PenEchoLLM with your subscription.", "订阅权益：PenEchoLLM 不限次数。"));
    else if (allowance.tier === "guest") lines.push(allowance.remaining > 0
      ? suggestionCopy(`Free trial: ${allowance.remaining} of ${allowance.limit} left today. Sign in for more free suggestions every day.`, `免费体验：今日还剩 ${allowance.remaining}／${allowance.limit} 次。登录后每天可获得更多免费次数。`)
      : suggestionCopy(`Today's ${allowance.limit} free trial suggestions are used. Sign in to continue.`, `今日 ${allowance.limit} 次免费体验已用完，登录后继续使用。`));
    else if (allowance.tier === "credits") lines.push(suggestionCopy(
      `Free suggestions used today. Continuing at ${allowance.price} credit each · ${allowance.spent}${allowance.dailyLimit ? ` of ${allowance.dailyLimit}` : ""} credits today.`,
      `今日免费次数已用完，正在以 ${allowance.price} 积分／次继续使用 · 今日已用 ${allowance.spent}${allowance.dailyLimit ? `／${allowance.dailyLimit}` : ""} 积分。`));
    else lines.push(allowance.remaining > 0
      ? suggestionCopy(`${allowance.remaining} of ${allowance.limit} free suggestions left today.`, `今日免费建议还剩 ${allowance.remaining}／${allowance.limit} 次。`)
      : suggestionCopy(`Today's ${allowance.limit} free suggestions are used. Turn on credits (${allowance.price} each) or subscribe to continue.`, `今日 ${allowance.limit} 次免费建议已用完。开启积分续用（${allowance.price} 积分／次）或订阅后继续。`));
    if (reset && allowance.tier !== "subscriber") lines.push(suggestionCopy(`Resets at ${reset}.`, `${reset} 重置。`));
    return lines;
  }
  // Which ranking the bar shows for this ink:
  //   ranked     PenEchoLLM ordered these actions
  //   refreshing ranked, and newer strokes are being analysed
  //   pending    instant local order; PenEchoLLM is on its way
  //   local      instant local order only (off, unavailable, limit or failure)
  function penechoLLMRankState(cluster, view) {
    const remote = smartSuggestRemote(), busy = Boolean(smartSuggest.controller || smartSuggest.timer);
    if (view?.source === "penecho-llm") return busy && remote ? "refreshing" : "ranked";
    if (!remote || !cluster) return "local";
    if (busy) return "pending";
    return "local";
  }
  function penechoLLMRankSentence(rank) {
    const status = smartSuggest.status, result = smartSuggest.lastResult, allowance = suggestionAllowance();
    if (smartSuggest.bar?.cluster?.result) {
      if (rank === "ranked" || rank === "refreshing") return suggestionCopy("PenEchoLLM ranked the next actions from this result and nearby context.", "PenEchoLLM 已根据新结果和周围内容推荐后续操作。");
      if (rank === "pending") return suggestionCopy("PenEchoLLM is reading this result to suggest what to do next…", "PenEchoLLM 正在分析新结果，推荐下一步……");
      return suggestionCopy("Next-action ranking is currently unavailable.", "暂时无法分析后续操作。");
    }
    if (rank === "ranked" || rank === "refreshing") {
      const latency = result?.latencyMs ? suggestionCopy(` in ${(result.latencyMs / 1000).toFixed(1)} s`, `（${(result.latencyMs / 1000).toFixed(1)} 秒）`) : "",
        charge = result?.cached ? suggestionCopy(" Same ink as before: no charge.", "与之前相同的笔迹：不计次。")
          : result?.chargedCredits > 0 ? suggestionCopy(` Used ${result.chargedCredits} credit.`, `消耗 ${result.chargedCredits} 积分。`) : "";
      return suggestionCopy(`PenEchoLLM ranked these actions for your ink${latency}.`, `PenEchoLLM 已根据你的笔迹排序这些操作${latency}。`) + charge
        + (rank === "refreshing" ? suggestionCopy(" Updating for your newest strokes…", " 正在根据最新笔画更新……") : "");
    }
    if (rank === "pending") return suggestionCopy("Instant suggestions shown. PenEchoLLM is reading your ink to rank them…", "已显示即时建议，PenEchoLLM 正在识别笔迹并排序……");
    if (!smartSuggest.enabled) return suggestionCopy("Automatic suggestions are off.", "自动提示已关闭。");
    if (allowance?.blocked) return suggestionCopy("Instant suggestions only: today's PenEchoLLM allowance is used.", "仅即时建议：今日 PenEchoLLM 次数已用完。");
    if (!smartSuggest.available) return suggestionCopy("Instant suggestions from this device. PenEchoLLM ranking is unavailable; the next suggestion will retry.", "来自本机的即时建议。PenEchoLLM 排序暂不可用，下次触发建议时会重试。");
    if (status?.state === "failed") return suggestionCopy("Instant suggestions only: PenEchoLLM did not answer. It will retry.", "仅即时建议：PenEchoLLM 暂未响应，稍后会重试。");
    return suggestionCopy("Instant suggestions from this device.", "来自本机的即时建议。");
  }
  // A small badge usable anywhere (Assist bar, Widget panel).
  function penechoLLMBadge(rank, labelText, tag = "span", quotaText = "") {
    const badge = document.createElement(tag), glyph = document.createElement("span"), label = document.createElement("span"), quota = document.createElement("span");
    badge.className = "penecho-llm-badge";
    badge.dataset.rank = rank;
    glyph.className = "penecho-llm-glyph";
    glyph.setAttribute("aria-hidden", "true");
    glyph.textContent = "✦";
    label.className = "penecho-llm-label";
    label.textContent = labelText;
    // The allowance is its own part, so a warning colour never hides the source.
    quota.className = "penecho-llm-quota";
    quota.textContent = quotaText;
    badge.append(glyph, label, quota);
    return badge;
  }
  function assistSparkControl(rank) {
    const allowance = suggestionAllowance(), short = suggestionAllowanceShort(allowance),
      name = rank === "local" ? "" : rank === "pending" ? suggestionCopy("PenEchoLLM…", "PenEchoLLM…") : "PenEchoLLM",
      spark = penechoLLMBadge(rank, name, "button", short);
    spark.type = "button";
    spark.classList.add("assist-spark");
    spark.classList.toggle("is-low", Boolean(allowance?.low || allowance?.blocked));
    spark.title = penechoLLMRankSentence(rank);
    // The spark is compact; hover, focus or a tap reveals the words and details.
    spark.setAttribute("aria-label", [spark.title, ...suggestionAllowanceLines(allowance)].join(" "));
    spark.setAttribute("aria-expanded", "false");
    spark.addEventListener("pointerdown", event => event.stopPropagation());
    spark.addEventListener("click", event => {
      event.stopPropagation();
      const bar = smartSuggest.bar;
      if (!bar) return;
      bar.info = !bar.info;
      syncAssistLlmInfo(bar);
    });
    return spark;
  }
  // The detail row: ranking source, allowance, and the next step for this tier.
  function syncAssistLlmInfo(bar) {
    const element = bar?.element;
    if (!element) return;
    element.querySelector(".assist-llm-info")?.remove();
    const spark = element.querySelector(".assist-spark");
    spark?.setAttribute("aria-expanded", String(Boolean(bar.info)));
    if (!bar.info || bar.mode !== "suggest") { positionAssist(); return; }
    const info = document.createElement("div"), allowance = suggestionAllowance();
    info.className = "assist-llm-info";
    info.setAttribute("role", "status");
    for (const text of [penechoLLMRankSentence(element.dataset.rank || "local"), ...suggestionAllowanceLines(allowance)]) {
      const line = document.createElement("span");
      line.textContent = text;
      info.append(line);
    }
    const actions = document.createElement("div");
    actions.className = "assist-llm-info-actions";
    const button = (label, action) => {
      const node = document.createElement("button");
      node.type = "button";
      node.textContent = label;
      node.addEventListener("pointerdown", event => event.stopPropagation());
      node.addEventListener("click", async event => { event.stopPropagation(); node.disabled = true; try { await action(); } catch (error) { setStatus(String(error?.message || error)); } finally { node.disabled = false; } });
      actions.append(node);
    };
    if (allowance?.tier === "guest") button(suggestionCopy("Sign in", "登录"), () => window.PenEchoCloudSettings?.signIn(() => void refreshSmartSuggestAvailability()));
    if (allowance && allowance.tier !== "guest" && allowance.tier !== "subscriber" && typeof openSettings === "function") button(suggestionCopy("Spending settings", "积分设置"), () => { hideAssist("settings"); openSettings(); });
    if (allowance && allowance.tier !== "subscriber") button(suggestionCopy("Plans & credits", "订阅／积分"), () => window.open(new URL("/dashboard.html#billing", window.PenEchoCloudSettings?.origin() || window.PENECHO_CONFIG?.cloudOrigin || location.origin).href, "_blank", "noopener"));
    if (actions.childElementCount) info.append(actions);
    element.append(info);
    positionAssist();
  }
  // Local → PenEchoLLM: update chips in place and light up the ranking status.
  function assistAnimateRanking(element, previousRank) {
    const rank = element.dataset.rank;
    if (!(rank === "ranked" || rank === "refreshing") || previousRank !== "pending" && previousRank !== "local") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    element.classList.remove("just-ranked");
    void element.offsetWidth;
    element.classList.add("just-ranked");
    setTimeout(() => element.classList.remove("just-ranked"), 1800);
  }
  // Settings: the same allowance, for every tier.
  function refreshSuggestionAllowanceStatus() {
    const help = document.querySelector("#smartSuggestToggleHelp");
    if (!help) return;
    let line = document.querySelector("#suggestionAllowanceStatus");
    if (!line) {
      line = document.createElement("small");
      line.id = "suggestionAllowanceStatus";
      line.className = "suggestion-allowance-status";
      help.after(line);
    }
    const allowance = suggestionAllowance(), lines = suggestionAllowanceLines(allowance);
    line.hidden = !lines.length;
    line.dataset.tier = allowance?.tier || "";
    line.classList.toggle("is-low", Boolean(allowance?.low || allowance?.blocked));
    line.textContent = lines.length ? `PenEchoLLM · ${lines.join(" ")}` : "";
    // The PenEcho Agent Suggest tab shows the same allowance.
    if (typeof agentSuggestRender === "function") agentSuggestRender();
  }
  function suggestionApiPath(suffix="") { return `${window.PENECHO_CONFIG?.runtime === "cloud" ? "/api/v1/apps/penecho-llm/suggest" : "/api/suggest"}${suffix}`; }
  function updateSuggestionAccess(data, { status = false } = {}) {
    const access=data?.access || data?.details?.access;
    if(access) {
      if (!status) {
        // An actual action has newer allowance than a status request admitted
        // before it. Detach that check even when its transport ignores abort.
        invalidateSmartSuggestAvailability();
        smartSuggest.available = true;
        Object.assign(smartSuggest.availability, { checkedAt:Date.now(), nextAt:Date.now()+30000 });
      }
      smartSuggest.access=access;
      // Allowance changes must update even while the pointer holds action ranking.
      const element=smartSuggest.bar?.mode==="suggest"&&smartSuggest.bar.element;
      if(element) {
        element.querySelector(".assist-access-notice")?.remove();
        const notice=suggestionAccessNotice();if(notice)element.append(notice);
        element.classList.toggle("has-access-notice",Boolean(notice));
        const spark=element.querySelector(".assist-spark");
        if(spark)spark.replaceWith(assistSparkControl(element.dataset.rank||"local"));
        if(smartSuggest.bar.info)syncAssistLlmInfo(smartSuggest.bar);
        positionAssist();
      }
      if(typeof requestInteractionLayerRender==="function")requestInteractionLayerRender();
    }
    refreshSuggestionSpendingControl();
    refreshSuggestionAllowanceStatus();
  }
  async function setSuggestionSpending(paidEnabled,dailyCreditLimit) {
    const accountSequence=smartSuggestAccountSequence;
    const response=await fetch(suggestionApiPath("/preferences"),{method:"POST",credentials:"same-origin",headers:authenticatedApiHeaders({"Content-Type":"application/json","X-PenEcho-Suggest":"1"}),body:JSON.stringify({paidEnabled,...(dailyCreditLimit===undefined?{}:{dailyCreditLimit})})});
    const data=await response.json();
    if(accountSequence!==smartSuggestAccountSequence)return;
    updateSuggestionAccess(data);
    if(!response.ok)throw new Error(data.message || data.error || "Could not update suggestion spending.");
    await refreshSmartSuggestAvailability();smartSuggest.lastKey="";smartSuggest.pausedUntil=0;scheduleAssist();
  }
  function suggestionAccessNotice() {
    if(!suggestionAccessBlocked())return null;
    const access=smartSuggest.access,zh=state.language==="zh",wrap=document.createElement("div"),text=document.createElement("span");
    wrap.className="assist-access-notice";wrap.setAttribute("role","status");
    const guest=!access.signedIn,reason=access.reason,limit=Number.isFinite(access.freeLimit)?access.freeLimit:(guest?200:500),price=Number.isFinite(access.price)&&access.price>0?access.price:0.1,reset=suggestionResetText(access.resetsAt),resetText=reset?(zh?`${reset} 重置。`:` Resets at ${reset}.`):"";
    text.textContent=(guest?(reason==="guest_capacity"?(zh?"免费体验暂时繁忙，登录后继续使用。":"Free trials are busy. Sign in to continue."):(zh?`今日 ${limit} 次免费体验已用完，登录后每天可获得更多免费次数。`:`Today's ${limit} free trial suggestions are used. Sign in for more every day.`))
      :reason==="insufficient_credits"?(zh?"积分不足，充值或订阅后继续使用。":"Not enough credits. Add credits or subscribe to continue.")
      :reason==="daily_spend_limit"?(zh?"已达到今日智能建议积分上限，可在设置中调整。":"Today's suggestion spending limit is reached. You can raise it in Settings.")
      :(zh?`今日 ${limit} 次免费智能建议已用完，继续使用为 ${price} 积分／次。`:`Today's ${limit} free suggestions are used. Continue for ${price} credit each.`))+(reason==="guest_capacity"?"":resetText);
    wrap.append(text);
    const button=(label,action)=>{const node=document.createElement("button");node.type="button";node.textContent=label;node.addEventListener("pointerdown",e=>e.stopPropagation());node.addEventListener("click",async e=>{e.stopPropagation();node.disabled=true;try{await action();}catch(error){text.textContent=error.message;}finally{node.disabled=false;}});wrap.append(node);};
    if(guest)button(zh?"登录":"Sign in",()=>window.PenEchoCloudSettings?.signIn(()=>void refreshSmartSuggestAvailability()));
    else {
      if(reason==="paid_consent_required")button(zh?"开启积分续用":"Use credits",()=>setSuggestionSpending(true));
      button(zh?"查看订阅 / 积分":"Subscriptions / credits",()=>window.open(new URL("/dashboard.html#billing",window.PenEchoCloudSettings?.origin() || window.PENECHO_CONFIG?.cloudOrigin || location.origin).href,"_blank","noopener"));
    }
    return wrap;
  }
  function refreshSuggestionSpendingControl() {
    const control=document.querySelector("#suggestionSpendingControl");if(!control)return;
    const access=smartSuggest.access,zh=state.language==="zh";
    control.hidden=!access?.signedIn||access.subscribed;
    control.querySelector("input[type=checkbox]").checked=access?.paidEnabled===true;
    control.querySelector("input[type=number]").value=access?.dailyCreditLimit??50;
    control.querySelector("[data-suggest-spent]").textContent=zh?`今日已用 ${access?.spentToday||0} 积分`:`${access?.spentToday||0} credits used today`;
  }
  function syncSmartSuggestToggle() {
    if (!smartSuggestToggle) return;
    smartSuggestToggle.classList.toggle("on", smartSuggest.enabled);
    smartSuggestToggle.setAttribute("aria-checked", String(smartSuggest.enabled));
    if (typeof agentSuggestRender === "function") agentSuggestRender();
  }
  function setSmartSuggestEnabled(enabled) {
    smartSuggest.enabled = Boolean(enabled);
    try { localStorage.setItem(SMART_SUGGEST_STORAGE_KEY, String(smartSuggest.enabled)); } catch {}
    if (!smartSuggest.enabled) {
      invalidateSmartSuggestAvailability();
      cancelSmartSuggest("disabled");
      stopAssistShapeTool();
    }
    else { smartSuggest.cooldown = {}; smartSuggest.failures = 0; smartSuggest.pausedUntil = 0; smartSuggest.lastKey = ""; smartSuggest.retries = 0; void refreshSmartSuggestAvailability({ force:true, reason:"enabled" }); scheduleAssist(); }
    syncSmartSuggestToggle();
    if (state.selection?.phase === "active") assistRefresh("setting-changed");
    requestInteractionLayerRender();
  }
  function smartSuggestSyncDocument() {
    const id = canvasDocumentsCurrent().id;
    if (smartSuggest.documentId === id) return;
    cancelSmartSuggest("document-changed");
    if(typeof assistAgentDocumentChanged === "function")assistAgentDocumentChanged();
    smartSuggest.sequence++;
    Object.assign(smartSuggest, { documentId:id, strokes:[], consumedStrokeId:0, dismissedStrokeId:0, dismissedObjectKey:"", evaluatedStrokeId:0, writingMs:0, localReadyAt:0, inkReadyAt:0, lastKey:"", retryKey:"", retries:0, failures:0, pausedUntil:0, cooldown:{}, profile:{}, recent:[], jev:null, analysisKey:"", analysis:null, selection:null, selectionKey:"", dismissedSelection:null, reopenTap:null });
  }
  function smartSuggestRecent(entry) {
    smartSuggest.recent.push(entry);
    if (smartSuggest.recent.length > 8) smartSuggest.recent.shift();
  }

  // ---------- Stroke log (vectors survive only here; ink itself is raster) ----------
  function smartSuggestWritingTier() {
    return smartSuggest.writingMs <= SMART_SUGGEST_SHORT_WRITING_MS ? "short"
      : smartSuggest.writingMs <= SMART_SUGGEST_LONG_WRITING_MS ? "medium" : "long";
  }
  function smartSuggestCandidateValid(candidate, cluster = null) {
    if (!candidate || candidate.epoch !== smartSuggest.inkEpoch || candidate.documentId !== canvasDocumentsCurrent().id || !smartSuggest.enabled) return false;
    const cutoff = Math.max(smartSuggest.consumedStrokeId, smartSuggest.dismissedStrokeId);
    if (candidate.strokes.some(stroke => stroke.id <= cutoff || !state.history.includes(stroke.historyEntry))) return false;
    const input = smartSuggestObjectInput();
    if ((candidate.objectKey || "") !== input.objectKey || candidate.objects?.some(object => !input.objects.some(current => current.item === object.item))) return false;
    return !cluster || !cluster.selection && !cluster.result && candidate.strokes.every(stroke => cluster.strokes.includes(stroke));
  }
  function smartSuggestUseNextCandidate() {
    if (state.drawing) return false;
    const candidate = smartSuggest.nextCandidate, cluster = smartSuggestCluster();
    smartSuggest.nextCandidate = null;
    if (cluster && smartSuggestCandidateValid(candidate, cluster) && (!smartSuggest.jev || candidate.sequence > (smartSuggest.jev.sequence || 0))) {
      smartSuggest.jev = candidate;
      smartSuggest.lastResult = candidate.lastResult;
      return true;
    }
    return false;
  }
  function assistSyncWriting(bar = smartSuggest.bar) {
    if (!bar) return false;
    // Hold-to-snap is stroke feedback; every actionable Assist state stays hidden.
    const writing = bar.mode !== "hold" && Boolean(state.drawing
      || !bar.target?.selection && !smartSuggestReopenedInk() && performance.now() < smartSuggest.localReadyAt);
    if (bar.writing !== writing) {
      bar.writing = writing;
      bar.element.classList.toggle("is-writing", writing);
      bar.element.inert = writing;
    }
    return writing;
  }
  function smartSuggestDrawingStarted(drawing) {
    if (typeof dismissWidgetInkRefineOffer === "function") dismissWidgetInkRefineOffer("new-input");
    if (typeof cancelPenRasterDeletion === "function") cancelPenRasterDeletion();
    if (typeof dismissPenGestureOffer === "function") dismissPenGestureOffer("new-gesture", false);
    if (typeof penIntelSyncWriting === "function") penIntelSyncWriting();
    smartSuggestSyncDocument();
    if (smartSuggest.bar) smartSuggest.bar.reopenedKey = null;
    if (drawing && !drawing.erase) {
      drawing.smartSuggestStartedAt = performance.now();
      // No entry point may start an ink request until a new pen-up sets its deadline.
      smartSuggest.inkReadyAt = Infinity;
    }
    if (typeof penIntel === "object" && penIntel.gesture) {
      if (drawing?.erase || penIntel.gesture.resolving) clearPenGesture("continued-input");
      else clearTimeout(penIntel.gesture.timer);
    }
    clearTimeout(smartSuggest.timer);
    smartSuggest.timer = 0;
    clearTimeout(smartSuggest.localTimer);
    smartSuggest.localTimer = 0;
    clearTimeout(smartSuggest.holdTimer);
    smartSuggest.holdTimer = 0;
    // Detach immediately so the next pause never waits for an aborted fetch.
    // A response that wins the cancellation race remains a useful default.
    const request = smartSuggest.request;
    if (request) request.interrupted = true;
    smartSuggest.controller?.abort();
    smartSuggest.controller = null;
    smartSuggest.request = null;
    smartSuggest.rerun = false;
    smartSuggest.sequence++;
    if (request) {
      smartSuggest.lastKey = "";
      smartSuggest.status = { key:request.key, state:"cancelled" };
    }
    if (drawing) drawing.smartHold = { x:drawing.start?.x, y:drawing.start?.y, sampleCount:0, fit:null };
    const bar = smartSuggest.bar;
    if (bar) {
      bar.hovered = false;
      bar.deferred = null;
      assistSyncWriting(bar);
    }
  }
  function smartSuggestDrawingMoved(drawing) {
    // Hold-to-snap is local and instant; it follows the setting even without PenEchoLLM.
    if (!SMART_SUGGEST || !smartSuggestLayer || !smartSuggest.enabled) return;
    if (!drawing || drawing.erase || !drawing.smartHold) return;
    const hold = drawing.smartHold, last = drawing.last,
      scale = Math.max(0.03, state.scale),
      tolerance = (hold.fit ? SMART_SUGGEST_SNAP_SLOP_PX : SMART_SUGGEST_HOLD_SLOP_PX) / scale;
    // Keep a fixed pause anchor: repeated tremor must neither restart the timer
    // nor walk a recognized shape's endpoint away from its original position.
    if (!last || Number.isFinite(hold.x) && Math.hypot(last.x - hold.x, last.y - hold.y) <= tolerance) return;
    hold.x = last.x;
    hold.y = last.y;
    hold.sampleCount = drawing.samples.length;
    if (hold.fit) {
      hold.fit = null;
      if (smartSuggest.bar?.mode === "hold") hideAssist("hold-moved");
    }
    clearTimeout(smartSuggest.holdTimer);
    smartSuggest.holdTimer = setTimeout(() => {
      smartSuggest.holdTimer = 0;
      if (state.drawing !== drawing || !smartSuggest.enabled) return;
      // Fit the stroke at the pause anchor, excluding the stationary tail.
      // Sparse pointer streams still contain valid lines and polygon corners.
      const fit = SMART_SUGGEST.fitStroke(drawing.samples.slice(0, hold.sampleCount).map(sample => sample.point));
      if (fit && Math.hypot(fit.bounds.w, fit.bounds.h) * scale < 12) return;
      if (!fit) return;
      hold.fit = fit;
      showSmartHoldPreview(drawing, fit);
    }, SMART_SUGGEST_HOLD_MS);
  }
  function smartSuggestDrawingFinished(drawing) {
    smartSuggestSyncDocument();
    clearTimeout(smartSuggest.holdTimer);
    smartSuggest.holdTimer = 0;
    if (!drawing || !SMART_SUGGEST) return;
    if (drawing.erase) { smartSuggest.strokes = []; smartSuggest.writingMs = 0; smartSuggest.localReadyAt = 0; smartSuggest.inkReadyAt = 0; smartSuggest.lastKey = ""; smartSuggest.jev = null; cancelSmartSuggest("erased"); if (typeof refreshDirtyHistoryAfter === "function") refreshDirtyHistoryAfter(); return; }
    if (!drawing.samples?.length) return;
    const now = performance.now(), durationMs = Number.isFinite(drawing.smartSuggestStartedAt) ? Math.max(0, now - drawing.smartSuggestStartedAt) : 0;
    // Two clock reads per stroke, one addition: independent of zoom and sample count.
    smartSuggest.writingMs += durationMs;
    const points = drawing.samples.map(sample => ({ x:sample.point.x, y:sample.point.y })),
      size = drawing.samples.at(-1)?.size || drawing.size || state.pen,
      record = { id:smartSuggest.nextStrokeId++, points, size, color:drawing.color || state.inkColor, box:{ ...drawing.bbox }, at:now, durationMs, historyEntry:state.history.at(-1) };
    smartSuggestRecordStroke(record);
    record.deletionGesture = assistDetectDeletion(record);
    smartSuggest.localReadyAt = now + ASSIST_LOCAL_DELAY_MS;
    smartSuggest.inkReadyAt = smartSuggest.localReadyAt + (smartSuggestWritingTier() === "short" ? SMART_SUGGEST_RANK_DELAY_MS : SMART_SUGGEST_CONTINUED_RANK_DELAY_MS);
    smartSuggestUseNextCandidate();
    const holdFit = smartSuggest.enabled ? drawing.smartHold?.fit : null;
    if (smartSuggest.bar?.mode === "hold") hideAssist("hold-released");
    if (holdFit) {
      applySmartShapeSnap([{ ...holdFit, strokes:[record] }]);
      smartSuggestRecent("hold-snapped " + holdFit.type);
      // The snapped stroke is exact now; keep it as context for diagram help,
      // but never offer to clean it up again.
      record.exact = true;
      record.deletionGesture = null;
    }
    // Gesture classification leaves local help and the Auto AI deadline independent.
    const widgetRefine = assistWidgetRefineTarget({ strokes:[record] });
    // A circle on a Widget is an annotation, not an Explain command that lifts
    // the circle away. Cancellation gestures retain their independent Delete.
    if ((!widgetRefine || record.deletionGesture) && typeof penIntelStrokeFinished === "function") penIntelStrokeFinished(record);
    else if (widgetRefine && typeof clearPenGesture === "function") clearPenGesture("widget-annotation");
    if (widgetRefine && typeof offerWidgetInkRefinement === "function") offerWidgetInkRefinement(widgetRefine);
    if (smartSuggest.bar?.mode === "working" && !state.activeAI && (typeof aiPreparation === "undefined" || !aiPreparation)) hideAssist("new-input");
    if (typeof refreshDirtyHistoryAfter === "function") refreshDirtyHistoryAfter();
    scheduleAssist();
  }
  function smartSuggestRecordStroke(record) {
    smartSuggest.strokes.push(record);
    if (smartSuggest.strokes.length > SMART_SUGGEST_MAX_STROKES) smartSuggest.strokes.splice(0, smartSuggest.strokes.length - SMART_SUGGEST_MAX_STROKES);
    const entry = record.historyEntry;
    if (entry?.dirtyAfter?.suggest) entry.dirtyAfter.suggest = captureDirtyHistorySuggest();
  }
  // User-created text and images are pending input even without vector ink.
  // Read the dirty object sets; loading a document or producing AI output does
  // not populate these sets and must not start another automatic request.
  function smartSuggestObjectInput() {
    const objects = [];
    for (const [kind, items, ids, boxFor] of [["image", state.images, state.dirtyImageIds, imageBox], ["text", state.textBoxes, state.dirtyTextBoxIds, textBoxBox]]) {
      for (const item of items || []) if (ids?.has(item.id)) {
        const box = boxFor(item), key = JSON.stringify([kind, item.id, box.x, box.y, box.w, box.h, item.text]);
        objects.push({ kind, item, box:{ ...box }, key });
      }
    }
    return { objects, objectKey:objects.map(object => object.key).join("|"), box:objects.reduce((box, object) => unionLocalBounds(box, object.box), null) };
  }
  function smartSuggestObjectsChanged() {
    smartSuggestSyncDocument();
    cancelSmartSuggest("manual-input");
    smartSuggest.lastKey = "";
    smartSuggest.dismissedObjectKey = "";
    smartSuggest.jev = null;
    const now = performance.now();
    smartSuggest.localReadyAt = now + ASSIST_LOCAL_DELAY_MS;
    smartSuggest.inkReadyAt = smartSuggest.localReadyAt + SMART_SUGGEST_RANK_DELAY_MS;
    scheduleAssist();
  }
  function smartSuggestObjectEditing() {
    return Boolean(state.imageEdit || state.imageGesture || state.imageImporting || state.textEditors?.size);
  }
  function smartSuggestInputModeAllowed() {
    return state.mode === "pen" || state.mode === "hand" && smartSuggestReopenedInk()
      || ["select", "hand"].includes(state.mode) && Boolean(smartSuggestObjectInput().objects.length);
  }
  function smartSuggestInputConsumed(strokeId) {
    smartSuggest.consumedStrokeId = Math.max(smartSuggest.consumedStrokeId, strokeId || 0);
    if ((smartSuggest.strokes.at(-1)?.id || 0) > (strokeId || 0)) return;
    smartSuggest.writingMs = 0;
    smartSuggest.nextCandidate = null;
    smartSuggest.inkEpoch++;
    smartSuggest.localReadyAt = 0;
    smartSuggest.inkReadyAt = 0;
    // Keeping a draft consumes its input, not the verdict for unchanged output.
    if (smartSuggestResultCluster()) return;
    smartSuggest.jev = null;
    smartSuggest.lastKey = "";
    clearTimeout(smartSuggest.timer);
    smartSuggest.timer = 0;
    smartSuggest.controller?.abort();
    smartSuggest.controller = null;
    smartSuggest.request = null;
    smartSuggest.rerun = false;
    smartSuggest.sequence++;
  }
  function scheduleAssist() {
    clearTimeout(smartSuggest.localTimer);
    smartSuggest.localTimer = 0;
    if (!smartSuggestActive()) return;
    if (state.drawing) return;
    const showLocal = () => {
      smartSuggest.localTimer = 0;
      if (!smartSuggestActive() || state.drawing) return;
      const remaining = smartSuggest.selection ? 0 : smartSuggest.localReadyAt - performance.now();
      // Browser timers may fire just before a fractional deadline. Keep the
      // local display scheduled instead of waiting for a model reply to refresh.
      if (remaining > 0) {
        smartSuggest.localTimer = setTimeout(showLocal, Math.ceil(remaining));
        return;
      }
      assistRefresh("local");
    };
    smartSuggest.localTimer = setTimeout(showLocal, smartSuggest.selection ? 0 : Math.max(0, Math.ceil(smartSuggest.localReadyAt - performance.now())));
    scheduleSmartSuggest();
  }
  function scheduleSmartSuggest(delay = null) {
    clearTimeout(smartSuggest.timer);
    smartSuggest.timer = 0;
    if (!smartSuggest.enabled || !smartSuggestActive() || suggestionAccessBlocked() || state.drawing) return;
    const cluster = smartSuggestCluster();
    // New input gets its own attempt instead of inheriting an older failure's
    // inference delay. Explicit rate limits still apply across inputs.
    if (cluster && cluster.key !== smartSuggest.retryKey && !/^(rate_limited|http-429)$/.test(smartSuggest.status?.reason || "")) {
      smartSuggest.failures = 0;
      smartSuggest.pausedUntil = 0;
    }
    const inkDelay = smartSuggest.selection || smartSuggestResultCluster() || smartSuggestReopenedInk() ? 0 : smartSuggest.inkReadyAt - performance.now();
    smartSuggest.timer = setTimeout(() => {
      smartSuggest.timer = 0;
      runSmartSuggest().catch(error => debug("smart-suggest-error", { error:String(error?.message || error).slice(0, 160) })).finally(() => assistRefreshRank());
    }, Math.max(delay ?? (smartSuggest.inkReadyAt && !smartSuggest.selection && !smartSuggestResultCluster() ? 0 : ASSIST_LOCAL_DELAY_MS), inkDelay, smartSuggest.pausedUntil - performance.now()));
    assistRefreshRank();
  }
  function resumeSmartSuggest() {
    if (!smartSuggest.deferred || smartSuggestBlocked()) return;
    smartSuggest.deferred = false;
    scheduleSmartSuggest(0);
  }
  function cancelSmartSuggest(reason) {
    if (typeof dismissWidgetInkRefineOffer === "function") dismissWidgetInkRefineOffer(reason);
    clearTimeout(smartSuggest.timer);
    smartSuggest.timer = 0;
    clearTimeout(smartSuggest.localTimer);
    smartSuggest.localTimer = 0;
    clearTimeout(smartSuggest.holdTimer);
    smartSuggest.holdTimer = 0;
    smartSuggest.controller?.abort();
    smartSuggest.controller = null;
    smartSuggest.request = null;
    smartSuggest.nextCandidate = null;
    smartSuggest.inkEpoch++;
    smartSuggest.rerun = false;
    smartSuggest.deferred = false;
    smartSuggest.sequence++;
    hideAssist(reason);
  }

  function syncSelectionSuggestions() {
    smartSuggestSyncDocument();
    const selection = !state.viewMode && state.selection?.phase === "active" ? state.selection : null,
      key = selection ? `${selection.box.x},${selection.box.y},${selection.box.w},${selection.box.h},${selection.color},${Boolean(state.selectionGesture)}` : "";
    if (smartSuggest.selection === selection && smartSuggest.selectionKey === key) {
      if (selection && !smartSuggest.bar && !state.selectionGesture && !selectionAIBusy(selection)) assistRefresh("selection-controls");
      return;
    }
    const previous = smartSuggest.selection;
    if (previous !== selection) smartSuggest.dismissedSelection = null;
    smartSuggest.selection = selection;
    smartSuggest.selectionKey = key;
    smartSuggest.selectionVersion++;
    if (!selection && !previous) return;
    const selectionResultBar = !selection && previous && state.pending?.selection === previous
      && smartSuggest.bar?.target?.selection === previous
      && ["working", "result"].includes(smartSuggest.bar.mode) ? smartSuggest.bar : null;
    cancelSmartSuggest("selection-changed");
    smartSuggest.jev = null;
    smartSuggest.lastKey = "";
    smartSuggest.retryKey = "";
    smartSuggest.retries = 0;
    if (selectionResultBar) {
      const target = { ...selectionResultBar.target, selection:null, selectionKey:null };
      renderAssist({ mode:"result", box:assistUnion(target.box, assistPendingBox()), target, action:selectionResultBar.action });
    }
    if (selection && !state.selectionGesture && smartSuggest.dismissedSelection !== selection) scheduleAssist();
  }

  // Results and explicit selections have their own bounds. Ordinary Suggest
  // evaluates all pending input together, without time or proximity grouping.
  function smartSuggestResultCluster() {
    const bar = smartSuggest.bar;
    if (!bar || !["result", "followup"].includes(bar.mode) || bar.target?.selection) return null;
    const owner = bar.mode === "result" ? bar.target : bar.target?.previous || bar.target,
      pending = bar.mode === "result" ? state.pending || state.pendingWidget : null,
      box = assistUnion(owner?.resultBox, pending ? assistPendingBox() : null) || (bar.mode === "followup" ? bar.target?.resultBox || bar.box : null);
    if (!box) return null;
    // Erasure previews show the old ink plus red masks, not the resulting
    // content. Rank only after Keep, using the actual committed pixels.
    if (pending?.items?.some(item => item.erase)) return null;
    const previous = bar.resultCluster?.owner === owner ? bar.resultCluster : null,
      strokeId = smartSuggest.strokes.at(-1)?.id || 0,
      historyEntry = state.history.at(-1),
      geometry = JSON.stringify([box, pending === state.pending ? state.pending?.items?.map(pendingItemBounds) || null : null]);
    if (previous && strokeId > previous.strokeId) return null;
    // Keep a draft's verdict after Keep when the same pixels were committed.
    // Moves, resizes, partial acceptance/rejection and Undo invalidate it.
    const accepted = previous?.pending && !pending && owner?.resultBox
      && previous.geometry === JSON.stringify([box, previous.pending.items?.map(pendingItemBounds) || null]);
    if (previous && (previous.geometry === geometry || accepted) && (previous.historyEntry === historyEntry || accepted)) {
      previous.pending = pending;
      previous.historyEntry = historyEntry;
      previous.geometry = geometry;
      return previous;
    }
    if (previous && !pending && previous.historyEntry !== historyEntry && !accepted) return null;
    const cluster = { result:true, owner, pending, box:{ ...box }, newBox:{ ...box }, strokes:[], recentIds:new Set(),
      key:`result:${++smartSuggest.resultSequence}`, strokeId, geometry, historyEntry, previousAction:bar.action?.id };
    bar.resultCluster = cluster;
    return cluster;
  }
  function smartSuggestCluster(includeDismissed = false) {
    const selection = smartSuggest.selection;
    if (selection && selection === state.selection && selection.phase === "active") {
      if (smartSuggest.dismissedSelection === selection) return null;
      // Widgets and loaded or partially selected ink may have no vector history. The
      // masked raster is authoritative; never infer scope from recent strokes.
      return { selection, strokes:[], recentIds:new Set(), box:{ ...selection.box }, newBox:{ ...selection.box }, key:`selection:${smartSuggest.selectionVersion}` };
    }
    const result = smartSuggestResultCluster();
    if (result) return result;
    const cutoff = smartSuggest.consumedStrokeId,
      members = smartSuggest.strokes.filter(stroke => !stroke.inputConsumed && stroke.id > cutoff && state.history.includes(stroke.historyEntry)),
      input = smartSuggestObjectInput(), dirty = smartSuggestDirtyBox();
    if (!members.length && !input.objects.length && !dirty) return null;
    // Dismissal suppresses offers until new input arrives. It never splits the
    // old pending strokes away from the complete target of that new request.
    if (!includeDismissed && members.length && !members.some(stroke => stroke.id > smartSuggest.dismissedStrokeId)
      && (!input.objectKey || input.objectKey === smartSuggest.dismissedObjectKey)) return null;
    if (!includeDismissed && !members.length && (input.objectKey ? input.objectKey === smartSuggest.dismissedObjectKey : smartSuggest.dismissedStrokeId > 0)) return null;
    let box = members.reduce((box, stroke) => unionLocalBounds(box, stroke.box), unionLocalBounds(input.box, dirty));
    if (!box) return null;
    const pad = Math.max(0, ...members.map(stroke => stroke.size)) + 4;
    box = intersection({ x:box.x-pad, y:box.y-pad, w:box.w+pad*2, h:box.h+pad*2 }, { x:0, y:0, w:SIZE, h:SIZE });
    const unseen = members.filter(stroke => stroke.id > smartSuggest.evaluatedStrokeId), recent = unseen.length ? unseen : [members.at(-1)];
    // The action target includes the same complete input as classification.
    const key = members.length ? members.map(stroke => stroke.id).join(",") : input.objectKey ? "objects" : `dirty:${state.userRevision}:${JSON.stringify(dirty)}`;
    return { ...input, strokes:members, recentIds:new Set(recent.filter(Boolean).map(stroke => stroke.id)), box, newBox:{ ...box }, key:`${key}${input.objectKey ? `:${input.objectKey}` : ""}` };
  }
  // Dirty raster masks remain authoritative even after vector/history eviction.
  function smartSuggestDirtyBox() {
    return state.dirty ? intersection(state.dirty, { x:0, y:0, w:SIZE, h:SIZE }) : null;
  }
  // Keep the complete dirty input, even outside the newest cluster or viewport.
  // Only a small edge margin is context. Nearby clean objects must not widen it.
  function smartSuggestCropRegion(cluster) {
    const margin = 8, canvas = { x:0, y:0, w:SIZE, h:SIZE },
      padded = box => ({ x:box.x-margin, y:box.y-margin, w:box.w+margin*2, h:box.h+margin*2 });
    if (cluster.result || cluster.gesture) {
      // These bounds already include the complete result or gesture target.
      return intersection(padded(cluster.box), canvas);
    }
    const dirty = smartSuggestDirtyBox(), required = unionLocalBounds(cluster.box, dirty),
      visible = viewportRect();
    if (!visible || !dirty && !intersection(cluster.box, visible)) return null;
    return intersection(unionLocalBounds(intersection(padded(required), visible), dirty), canvas);
  }
  // Bound the actual base64 payload, not just the bitmap dimensions. Prefer
  // WebP; retain PNG/JPEG when WebP is unavailable or cannot fit the budget.
  function smartSuggestEncodeImage(source) {
    if (!source?.width || !source?.height) return "";
    let scale = Math.min(1, SMART_SUGGEST_CROP_SIDE / Math.max(source.width, source.height));
    for (let attempt = 0; attempt < 8; attempt++, scale *= 0.75) {
      let canvas = source;
      if (scale < 1) {
        canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.floor(source.width * scale));
        canvas.height = Math.max(1, Math.floor(source.height * scale));
        const context = canvas.getContext("2d");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.imageSmoothingQuality = "high";
        context.drawImage(source, 0, 0, canvas.width, canvas.height);
      }
      for (const quality of [0.9, 0.78]) {
        try {
          const webp = canvas.toDataURL("image/webp", quality);
          // Unsupported canvas encoders may silently return PNG instead.
          if (!webp.startsWith("data:image/webp;base64,")) break;
          if (webp.length <= SMART_SUGGEST_IMAGE_MAX_CHARS) return webp;
        } catch { break; }
      }
      const png = canvas.toDataURL("image/png");
      if (!png.startsWith("data:image/png;base64,")) return "";
      if (png.length <= 64 * 1024) return png;
      const jpeg = canvas.toDataURL("image/jpeg", 0.86),
        compact = jpeg.startsWith("data:image/jpeg;base64,") && jpeg.length < png.length * 0.85 ? jpeg : png;
      if (compact.length <= SMART_SUGGEST_IMAGE_MAX_CHARS) return compact;
      const lowerQuality = canvas.toDataURL("image/jpeg", 0.74);
      if (lowerQuality.startsWith("data:image/jpeg;base64,") && lowerQuality.length <= SMART_SUGGEST_IMAGE_MAX_CHARS) return lowerQuality;
    }
    // Never send an oversized or empty image as a text-only classification.
    return "";
  }
  // The dirty mask survives failed ranking, pauses, stroke-cache eviction and
  // Undo-history pruning. Use actual raster pixels so erased ink stays erased.
  function drawSmartSuggestDirtyInk(context, region) {
    const dirty = smartSuggestDirtyBox(), clipped = dirty && intersection(dirty, region);
    if (!clipped || !state.dirtyInkTiles?.size) return;
    const scratch = document.createElement("canvas");
    scratch.width = scratch.height = TILE;
    const maskContext = scratch.getContext("2d");
    context.save();
    context.globalAlpha = 1;
    context.beginPath();
    context.rect(clipped.x, clipped.y, clipped.w, clipped.h);
    context.clip();
    forTiles(clipped.x, clipped.y, clipped.w, clipped.h, (canvas, tx, ty) => {
      const mask = state.dirtyInkTiles.get(`${tx},${ty}`);
      if (!mask) return;
      maskContext.clearRect(0, 0, TILE, TILE);
      maskContext.drawImage(canvas, 0, 0);
      maskContext.globalCompositeOperation = "destination-in";
      maskContext.drawImage(mask, 0, 0, TILE, TILE);
      maskContext.globalCompositeOperation = "source-over";
      context.drawImage(scratch, tx * TILE, ty * TILE);
    }, false);
    context.restore();
  }
  // Keep clean context readable and every pending ink contribution at full
  // contrast, irrespective of which strokes a previous LLM call classified.
  function smartSuggestCrop(cluster, region = null, includeDirty = true) {
    if (cluster.selection) return smartSuggestEncodeImage(renderSelectionImage(cluster.selection, SMART_SUGGEST_CROP_SIDE)?.out);
    region ||= smartSuggestCropRegion(cluster);
    if (!region) return "";
    // Recheck the mandatory bounds immediately before encoding the pixels.
    if (includeDirty && !cluster.result) region = unionLocalBounds(region, smartSuggestDirtyBox());
    const scale = Math.min(1, SMART_SUGGEST_CROP_SIDE / Math.max(region.w, region.h)),
      out = document.createElement("canvas");
    out.width = Math.max(16, Math.round(region.w * scale));
    out.height = Math.max(16, Math.round(region.h * scale));
    const context = out.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, out.width, out.height);
    context.save();
    context.globalAlpha = 0.55;
    context.setTransform(scale, 0, 0, scale, -region.x * scale, -region.y * scale);
    drawSmartSuggestScene(context, region);
    if (cluster.result) {
      context.globalAlpha = 1;
      context.beginPath();
      context.rect(cluster.box.x, cluster.box.y, cluster.box.w, cluster.box.h);
      context.clip();
      context.fillStyle = "#ffffff";
      context.fillRect(cluster.box.x, cluster.box.y, cluster.box.w, cluster.box.h);
      drawSmartSuggestScene(context, region);
      if (cluster.pending && cluster.pending === state.pending) drawPending({ ...state.pending, revealProgress:1 }, context, { chrome:false });
    } else if (cluster.gesture) {
      // Only the command mark is dark. Other unprocessed ink is context, not
      // another part of this gesture (especially important for Widget edits).
      context.globalAlpha = 1; context.lineCap = context.lineJoin = "round";
      for (const record of cluster.strokes) {
        context.strokeStyle = record.color || "#202938"; context.lineWidth = record.size;
        context.beginPath(); record.points.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y)); context.stroke();
      }
    } else {
      // Restore pending objects at full contrast, in the same placed-object
      // order as the Canvas, before emphasizing pending raster ink.
      context.globalAlpha = 1;
      const input = smartSuggestObjectInput(), kinds = state.frontPlacedCanvasObjectKind === "text-box" ? ["image", "text"] : ["text", "image"];
      for (const kind of kinds) for (const object of input.objects) {
        if (object.kind === kind && intersection(object.box, region)) context.drawImage(object.item.image, object.box.x, object.box.y, object.box.w, object.box.h);
      }
      drawSmartSuggestDirtyInk(context, region);
    }
    context.restore();
    return smartSuggestEncodeImage(out);
  }
  function drawSmartSuggestScene(context, region) {
    drawAnimationsToContext(context, region, performance.now());
    drawWidgetsToContext(context, region);
    drawImagesToContext(context, region);
    drawTextBoxesToContext(context, region);
    forTiles(region.x, region.y, region.w, region.h, (canvas, tx, ty) => context.drawImage(canvas, tx * TILE, ty * TILE), false);
    drawSharpOverlays(context, region);
  }

  // Shape fitting is cached per cluster; exact (already snapped or tool-drawn)
  // strokes are diagram context but never "clean up" candidates.
  function assistAnalyze(cluster) {
    if (smartSuggest.analysisKey === cluster.key && smartSuggest.analysis) return smartSuggest.analysis;
    const fits = cluster.strokes.length <= 12 ? SMART_SUGGEST.fitStrokes(cluster.strokes.map(stroke => stroke.points)) : [],
      shapes = SMART_SUGGEST.shapeSummary(fits, cluster.strokes.length, cluster.box),
      rough = shapes ? shapes.fits.filter(fit => fit.strokeIndexes.some(index => !cluster.strokes[index]?.exact)) : [],
      counts = shapes ? {
        closed:shapes.fits.filter(fit => fit.closed).length,
        arrows:shapes.fits.filter(fit => fit.type === "arrow").length,
        rectangles:shapes.fits.filter(fit => ["rectangle", "square"].includes(fit.type)).length,
      } : null;
    smartSuggest.analysis = { fits, shapes, rough, counts };
    smartSuggest.analysisKey = cluster.key;
    return smartSuggest.analysis;
  }
  function smartSuggestFeatures(cluster, fits, shapes) {
    if (cluster.selection) return { ink:{ w:cluster.box.w, h:cluster.box.h }, persona:state.theme, locale:state.language };
    const overlaps = [];
    const intersects = item => item && item.x < cluster.box.x + cluster.box.w && item.x + item.w > cluster.box.x && item.y < cluster.box.y + cluster.box.h && item.y + item.h > cluster.box.y;
    for (const widget of state.widgets || []) if (intersects(widget)) overlaps.push(`widget "${String(widget.title || "").slice(0, 40)}"`);
    for (const image of state.images || []) if (intersects(image)) overlaps.push(image.plotExpression ? `plot y=${image.plotExpression}` : "image");
    const typed = state.latestTypedInput && intersects(state.latestTypedInput.box) ? state.latestTypedInput.text : "";
    return {
      ink:{ strokes:cluster.strokes.length, closed:fits.filter(fit => fit.closed).length, w:cluster.box.w, h:cluster.box.h },
      shape:shapes ? { type:shapes.type, residual:shapes.residual, covers:shapes.covers, total:shapes.total } : null,
      overlaps,
      typedText:typed,
      profile:smartSuggest.profile,
      persona:state.theme,
      locale:state.language,
      recent:smartSuggest.recent,
    };
  }
  // Capture cancellation geometry at pen-up for the independent Delete offer.
  function assistDeletionMarks(record, group = null) {
    const pen = window.PENECHO_PEN_INTEL, marks = group ? [...group] : [record], strokes = smartSuggest.strokes,
      index = strokes.indexOf(record), shape = pen.deletionMarkShape(record.points, record.size);
    // Only consecutive, nearby command marks can share a target. Ordinary
    // writing, another row, Undo and a long pause break the group.
    for (let i = group ? -1 : index - 1; i >= 0; i--) {
      const previous = strokes[i], last = marks[0], previousShape = pen.deletionMarkShape(previous.points, previous.size),
        span = Math.min(record.box.w, previous.box.w), pad = Math.max(record.size * 6, previous.size * 6, span * 0.12),
        sharedWidth = Math.min(record.box.x + record.box.w, previous.box.x + previous.box.w) - Math.max(record.box.x, previous.box.x);
      if (previous.exact || previous.inputConsumed || !state.history.includes(previous.historyEntry)
        || !previous.deletionGesture && !previous.deletionProbe || !previousShape
        || (shape !== "strike" || previousShape !== "strike") && !previous.deletionGesture
        || last.at - previous.at < 0 || last.at - (last.durationMs || 0) - previous.at > pen.GESTURE_FOLLOW_MS * 1.6
        || sharedWidth < span * 0.5 || Math.abs(record.box.y + record.box.h / 2 - previous.box.y - previous.box.h / 2) > pad) break;
      marks.unshift(previous);
    }
    // Joining any member joins the entire earlier command, even when its
    // first line lies beyond the newest line's proximity band.
    const byId = new Map(strokes.map(item => [item.id, item])), ids = new Set(marks.map(item => item.id));
    for (let i = 0; i < marks.length; i++) {
      if (marks[i] === record) continue;
      for (const id of marks[i].deletionMarkIds || []) {
        const previous = byId.get(id);
        if (previous && id < record.id && !ids.has(id)) { marks.push(previous); ids.add(id); }
      }
    }
    return marks.sort((a, b) => a.id - b.id);
  }
  function assistDetectDeletion(record) {
    const pen = window.PENECHO_PEN_INTEL;
    if (!pen || record.exact || !pen.deletionMarkShape(record.points, record.size)) return null;
    const marks = assistDeletionMarks(record), markIds = new Set(marks.map(item => item.id)),
      older = smartSuggest.strokes.filter(item => !markIds.has(item.id) && state.history.includes(item.historyEntry)),
      rowPad = Math.max(record.size * 5, 24 / Math.max(0.03, state.scale)),
      row = { x:record.box.x, y:record.box.y - rowPad, w:record.box.w, h:record.box.h + rowPad * 2 },
      widgetPad = Math.min(rowPad, record.box.w * 0.2),
      widgetRow = { ...row, y:record.box.y - widgetPad, h:record.box.h + widgetPad * 2 },
      contentBoxes = [
        ...older.map(item => ({ ...item.box, at:item.at, stroke:true })),
        // The text can be anywhere in a Widget, including near its top edge.
        // The full Widget's middle band is not the crossed text row.
        ...(state.widgets || []).map(widget => intersection(widgetBox(widget), widgetRow)).filter(Boolean),
        ...(state.textBoxes || []).map(textBoxBox),
      ],
      candidate = pen.classifyGestureStroke(record.points, { size:record.size, now:record.at, strokes:older, contentBoxes, tolerance:4 / Math.max(0.03, state.scale) });
    // Even after a pause, crossing a known cancellation crosses its original
    // content target. The earlier command line cannot replace that target.
    if (["strike", "scribble"].includes(candidate?.shape)) {
      for (const previous of older) if (candidate.strokeIds?.includes(previous.id) && ["strike", "scribble"].includes(previous.deletionGesture?.shape)) {
        marks.push(previous);
        markIds.add(previous.id);
      }
      marks.splice(0, marks.length, ...assistDeletionMarks(record, marks));
      for (const mark of marks) markIds.add(mark.id);
    }
    record.deletionMarkIds = [...markIds];
    const candidates = [...marks.slice(0, -1).map(item => item.deletionGesture), candidate].filter(item => ["strike", "scribble"].includes(item?.shape));
    if (candidates.length) return { ...candidates.at(-1),
      confidence:Math.max(...candidates.map(item => item.confidence)),
      target:candidates.reduce((box, item) => assistUnion(box, item.target), null),
      strokeIds:[...new Set(candidates.flatMap(item => item.strokeIds || []))].filter(id => !markIds.has(id)),
      masks:[...new Set(candidates.flatMap(item => [item.mask, ...item.masks || []].filter(Boolean)))],
    };
    // Use the pre-mark raster, not the mark's own ink or two unrelated density
    // bands. A fraction bar has no crossed component. A clipped divider is not
    // a whole letter. Keep the same pause rule as vector recognition.
    if (typeof schedulePenRasterDeletion !== "function" || older.some(item => record.at - item.at < pen.GESTURE_PAUSE_MS && intersection(row, item.box))) return null;
    const pad = Math.max(rowPad, record.box.w * 0.7);
    record.deletionProbe = true;
    schedulePenRasterDeletion(record, pen.inflate(marks.reduce((box, item) => assistUnion(box, item.box), null), rowPad, pad), marks);
    return null;
  }
  function assistDeletionDetails(target) {
    if (target.selection || !target.strokes?.at(-1)?.deletionGesture) return null;
    const marks = SMART_SUGGEST.recentStrokeUnit(target.strokes).filter(record => record.deletionGesture),
      markBox = marks.reduce((box, record) => assistUnion(box, record.box), null),
      box = marks.reduce((box, record) => assistUnion(box, record.deletionGesture.target), markBox);
    return { marks, markBox, box };
  }

  function assistWidgetRefineTarget(cluster) {
    if (!cluster || cluster.selection || cluster.result || cluster.followUp) return null;
    const strokes = (cluster.strokes || []).filter(record => !record.inputConsumed && record.id > smartSuggest.consumedStrokeId && state.history.includes(record.historyEntry)),
      widgets = (state.widgets || []).filter(widget => widget.shell && widget.renderActive !== false && !widget.pending && !widget.hiddenForReplacement);
    for (const record of strokes.slice().reverse()) {
      for (const widget of widgets.slice().reverse()) {
        if (!SMART_SUGGEST.strokeTouchesBox(record, widgetBox(widget))) continue;
        const marks = strokes.filter(item => SMART_SUGGEST.strokeTouchesBox(item, widgetBox(widget)));
        return { widget, widgetId:widget.id, documentId:canvasDocumentsCurrent().id, strokes:marks,
          box:marks.reduce((box, item) => assistUnion(box, item.box), null) };
      }
    }
    return null;
  }
  function assistWidgetRefineTargetValid(target) {
    const widget = target?.widget;
    return Boolean(widget && target.documentId === canvasDocumentsCurrent().id && state.widgets.includes(widget)
      && widget.shell && widget.renderActive !== false && !widget.pending && !widget.hiddenForReplacement
      && state.dirty && target.strokes?.length && target.strokes.every(record => !record.inputConsumed
        && record.id > smartSuggest.consumedStrokeId && state.history.includes(record.historyEntry))
      && target.strokes.some(record => SMART_SUGGEST.strokeTouchesBox(record, widgetBox(widget))));
  }
  function assistWidgetRefineContext(target, region) {
    if (!target || !region) return null;
    const box = intersection(widgetBox(target.widget), region);
    if (!box) return null;
    return { id:String(target.widgetId).slice(0, 128), title:String(target.widget.title || "").slice(0, 160),
      type:String(target.widget.widgetType || "html_widget").slice(0, 48),
      box:{ x:(box.x - region.x) / region.w, y:(box.y - region.y) / region.h, w:box.w / region.w, h:box.h / region.h } };
  }
  function executeAssistWidgetRefinement(target) {
    if (!assistWidgetRefineTargetValid(target) || state.drawing || state.selection || state.viewMode || state.pending || state.pendingWidget || state.pendingWidgetReplacement) return false;
    // Keep the marks dirty until the existing replacement request succeeds.
    if (typeof clearPenGesture === "function") clearPenGesture("widget-refine");
    if (typeof cancelPenRasterDeletion === "function") cancelPenRasterDeletion();
    if (typeof dismissPenGestureOffer === "function") dismissPenGestureOffer("widget-refine", false);
    if (typeof dismissWidgetInkRefineOffer === "function") dismissWidgetInkRefineOffer("accepted");
    hideAssist("widget-refine");
    return requestWidgetRefinement(target.widget, "nearby-dirty", { actionId:"apply_marks" });
  }
  // Stroke cues for the instant order, cached per cluster.
  function assistInkCues(cluster) {
    if (!cluster || cluster.selection || cluster.result) return null;
    if (smartSuggest.cuesKey !== cluster.key) {
      smartSuggest.cuesKey = cluster.key;
      try { smartSuggest.cues = SMART_SUGGEST.inkCues?.(cluster.strokes) || null; } catch { smartSuggest.cues = null; }
    }
    return smartSuggest.cues;
  }
  function assistInstantBucket(cluster) {
    if (!cluster || cluster.selection || cluster.result || !cluster.strokes?.length) return "";
    try { return SMART_SUGGEST.localPredict(assistLocalFeatures(cluster, assistAnalyze(cluster))).bucket || ""; } catch { return ""; }
  }
  function assistLearnInstant(cluster, distribution, weight) {
    const bucket = assistInstantBucket(cluster);
    if (!bucket || !SMART_SUGGEST.learnInstantPrior) return;
    smartSuggest.instantPrior = SMART_SUGGEST.learnInstantPrior(smartSuggest.instantPrior, bucket, distribution, { weight });
    try { localStorage.setItem(SMART_SUGGEST_PRIOR_KEY, JSON.stringify(smartSuggest.instantPrior)); } catch {}
  }
  // A confident PenEchoLLM ranking teaches the instant order for similar ink.
  function assistLearnInstantRanking(cluster, answers) {
    const actions = SMART_SUGGEST.instantRankingEvidence(answers);
    if (actions) assistLearnInstant(cluster, actions, 1);
  }
  // The user's own tap on ordinary ink counts twice as much as a ranking.
  function assistLearnInstantTap(id, target) {
    if (!id || !target || target.selection || target.followUp || target.accept || target.deletion || target.widgetRefine) return;
    const cluster = smartSuggestCluster();
    if (!cluster || cluster.selection || cluster.result || cluster.strokes?.at(-1)?.id !== target.strokes?.at(-1)?.id) return;
    assistLearnInstant(cluster, { [id]:1 }, 2);
  }
  // Reuse command-loop geometry without depending on the Gestures setting.
  // A loop must contain prior content; its own boundary is not a note target.
  function assistNoteScope(cluster) {
    const key = `${canvasDocumentsCurrent().id}:${cluster.key}:${state.userRevision}`;
    if (smartSuggest.noteScopeKey === key) return smartSuggest.noteScope;
    let scope = null;
    if (cluster.selection) {
      const path = selectionPathFor(cluster.selection), inside = box => path?.length >= 3 && SELECT.pointInPolygon({ x:box.x + box.w / 2, y:box.y + box.h / 2 }, path),
        texts = cluster.selection.regionOnly ? (state.textBoxes || []).filter(item => inside(textBoxBox(item))) : (cluster.selection.objects || []).filter(object => object.kind === "textBoxes").map(object => object.item),
        text = texts.map(item => String(item.text || "")).join("\n"),
        strokes = smartSuggest.strokes.filter(stroke => state.history.includes(stroke.historyEntry) && inside(stroke.box)),
        rows = SMART_SUGGEST.estimateRows(strokes.map(stroke => stroke.box));
      if (text.trim().length >= 80 || text.trim().length >= 40 && text.split(/\n/).filter(line => line.trim()).length >= 3 || strokes.length >= 24 && rows >= 3) scope = { kind:"large_text", path, box:{ ...cluster.box } };
    } else if (!cluster.result && typeof PEN_INTEL !== "undefined" && PEN_INTEL) {
      const newest = cluster.strokes?.at(-1);
      for (const stroke of [...(cluster.strokes || [])].reverse()) {
        // Raster ink includes strokes drawn after an earlier loop (a face drawn
        // before its eyes, or the next body segment), which that loop does not
        // enclose. Only the newest stroke may count raster ink as prior content.
        const excluded = new Set(smartSuggest.strokes.filter(item => item.id >= stroke.id).map(item => item.id)),
          loop = PEN_INTEL.classifyGestureStroke(stroke.points, { size:stroke.size, contentBoxes:penGestureContentBoxes(excluded), strokes:penGestureStrokes(excluded), probe:stroke === newest ? penIntelInkDensity : () => 0, now:stroke.at, pauseMs:0 });
        if (loop?.shape === "enclosure") { scope = { kind:"enclosed", path:stroke.points.map(point => ({ x:point.x, y:point.y })), box:{ ...loop.box } }; break; }
      }
    }
    smartSuggest.noteScopeKey = key;
    return smartSuggest.noteScope = scope;
  }
  function assistLocalFeatures(cluster, analysis) {
    const notePriority = Boolean(assistNoteScope(cluster));
    if (cluster.selection) {
      let objects = 0;
      try {
        const path = selectionPathFor(cluster.selection);
        objects = [...(state.widgets || []).map(widgetBox), ...(state.images || []).map(imageBox), ...(state.textBoxes || []).map(textBoxBox)]
          .filter(box => path?.length >= 3 && SELECT.pointInPolygon({ x:box.x + box.w / 2, y:box.y + box.h / 2 }, path)).length;
      } catch {}
      return { aspect:cluster.box.h ? cluster.box.w / cluster.box.h : 1, selection:true, objects, notePriority };
    }
    const older = cluster.strokes.filter(stroke => !cluster.recentIds.has(stroke.id)),
      olderBottom = older.length ? Math.max(...older.map(stroke => stroke.box.y + stroke.box.h)) : -Infinity,
      newTop = Math.min(...cluster.strokes.filter(stroke => cluster.recentIds.has(stroke.id)).map(stroke => stroke.box.y));
    return {
      notePriority,
      widgetRefine:Boolean(assistWidgetRefineTarget(cluster)),
      deletionMark:Boolean(assistDeletionDetails(cluster)),
      strokes:cluster.strokes.length,
      rows:SMART_SUGGEST.estimateRows(cluster.strokes.map(stroke => stroke.box)),
      aspect:cluster.box.h ? cluster.box.w / cluster.box.h : 1,
      shapes:analysis.shapes ? analysis.counts : null,
      newBelow:older.length > 0 && newTop >= olderBottom - Math.max(8, cluster.newBox.h * 0.2),
      cues:assistInkCues(cluster),
      learned:smartSuggest.instantPrior,
      typedText:state.latestTypedInput?.text || "",
      profile:smartSuggest.profile,
      motionCue:SMART_SUGGEST.motionCues?.(cluster.strokes) || null,
    };
  }

  function smartSuggestReopenedInk(cluster = null) {
    const bar = smartSuggest.bar;
    return Boolean(bar?.mode === "suggest" && bar.reopenedKey && bar.reopenedKey === (cluster || smartSuggestCluster())?.key);
  }
  function smartSuggestBlocked({ recoverAvailability = false } = {}) {
    const selected = smartSuggest.selection && smartSuggest.selection === state.selection && state.selection.phase === "active",
      result = smartSuggestResultCluster(),
      remote = smartSuggestRemote() || recoverAvailability && smartSuggest.enabled && smartSuggestActive() && !suggestionAccessBlocked();
    return !remote || state.drawing || !result && (state.activeAI || state.pending) || state.selectionGesture || state.selection && !selected
      || !selected && !result && (!smartSuggestInputModeAllowed() || smartSuggestObjectEditing()) || state.viewMode || document.visibilityState === "hidden"
      || performance.now() < smartSuggest.pausedUntil
      || (!selected && typeof penGesturePending === "function" && penGesturePending())
      || (!selected && typeof penDeleteOfferVisible === "function" && penDeleteOfferVisible());
  }

  async function runSmartSuggest() {
    smartSuggestSyncDocument();
    if (!smartSuggest.available && !smartSuggestBlocked({ recoverAvailability:true })) {
      const cluster = smartSuggestCluster(), sequence = smartSuggest.sequence;
      if (!cluster || cluster.key === smartSuggest.lastKey || cluster.box.w * state.scale < 14 && cluster.box.h * state.scale < 14) return;
      // A due Suggest is fresh demand. Recheck failed availability, then rank
      // this input in the same attempt if the service has recovered.
      await refreshSmartSuggestAvailability({ reason:"input" });
      if (sequence !== smartSuggest.sequence || smartSuggestCluster()?.key !== cluster.key) return;
    }
    if (smartSuggestBlocked()) {
      if (state.activeAI || state.pending) smartSuggest.deferred = true;
      const blockedCluster = smartSuggest.failures && smartSuggestCluster();
      if (blockedCluster && smartSuggestRemote() && document.visibilityState!=="hidden" && blockedCluster.key !== smartSuggest.lastKey) scheduleSmartSuggest(2000);
      return;
    }
    const cluster = smartSuggestCluster();
    if (!cluster || cluster.key === smartSuggest.lastKey) return;
    smartSuggest.deferred = false;
    // One current request at a time; pen-down releases its slot immediately.
    if (smartSuggest.controller) { smartSuggest.rerun = true; return; }
    if (!cluster.selection && !cluster.result && !smartSuggestReopenedInk(cluster) && performance.now() < smartSuggest.inkReadyAt) {
      scheduleSmartSuggest(0);
      return;
    }
    if (cluster.key !== smartSuggest.retryKey) { smartSuggest.retryKey = cluster.key; smartSuggest.retries = 0; }
    const tiny = cluster.box.w * state.scale < 14 && cluster.box.h * state.scale < 14;
    if (tiny) return;
    smartSuggest.lastKey = cluster.key;
    const analysis = assistAnalyze(cluster),
      documentId = canvasDocumentsCurrent().id,
      sequence = ++smartSuggest.sequence,
      controller = new AbortController(),
      ink = !cluster.selection && !cluster.result,
      request = { key:cluster.key, sequence, controller, ink, tier:ink ? smartSuggestWritingTier() : null, epoch:smartSuggest.inkEpoch, documentId, strokes:cluster.strokes, objects:cluster.objects, objectKey:cluster.objectKey, interrupted:false };
    smartSuggest.controller = controller;
    smartSuggest.request = request;
    smartSuggest.status = { key:cluster.key, state:"pending" };
    assistRefreshRank();
    const started = performance.now();
    // The model deadline starts when the request is sent. Widget preparation
    // has its own deadline, and cancellation aborts either phase immediately.
    let timeout = 0, timedOut = false;
    try {
      const region = cluster.selection ? cluster.selection.regionOnly ? cluster.selection.box : null : smartSuggestCropRegion(cluster);
      if (!cluster.selection && !region) return;
      const stale = () => sequence !== smartSuggest.sequence || controller.signal.aborted || canvasDocumentsCurrent().id !== documentId || cluster.result && smartSuggestResultCluster()?.key !== cluster.key
        || cluster.selection && (state.selection !== cluster.selection || smartSuggestCluster()?.key !== cluster.key);
      if (stale()) return;
      // Every Widget inside the image must contribute current pixels. An image
      // with a missing Widget would misrepresent the selection to the model.
      const required = smartSuggestRequiredWidgets(cluster, region);
      if (required.length) {
        const prepared = await ensureWidgetSnapshots(required, { signal:controller.signal, timeoutMs:WIDGET_CLASSIFY_SNAPSHOT_TIMEOUT_MS, reuseWithinMs:cluster.selection ? 0 : WIDGET_CLASSIFY_SNAPSHOT_REUSE_MS, currentFrame:Boolean(cluster.selection) });
        if (stale()) return;
        if (!prepared.complete || smartSuggestRequiredWidgets(cluster, region).some(widget => !widgetSnapshotFresh(widget))) {
          smartSuggestSnapshotUnavailable(cluster, sequence, prepared);
          return;
        }
      }
      const image = smartSuggestCrop(cluster, region);
      if (!image) return;
      // Preserve the pen-up deadline and the request's current input scope.
      if (ink && (state.drawing || !smartSuggestReopenedInk(cluster) && performance.now() < smartSuggest.inkReadyAt || smartSuggestCluster()?.key !== cluster.key)) {
        smartSuggest.lastKey = "";
        smartSuggest.rerun = true;
        return;
      }
      const widgetRefine = !cluster.selection && !cluster.result ? assistWidgetRefineContext(assistWidgetRefineTarget(cluster), region) : null,
        noteScope = assistNoteScope(cluster);
      timeout = setTimeout(() => { timedOut = true; controller.abort(); }, SMART_SUGGEST_TIMEOUT_MS);
      const response = await fetch(suggestionApiPath(), {
        method:"POST",
        credentials:"same-origin",
        signal:controller.signal,
        headers:authenticatedApiHeaders({ "Content-Type":"application/json", Accept:"application/json", "X-PenEcho-Suggest":"1" }),
        body:JSON.stringify({ version:1, mode:cluster.result?"result":cluster.selection?"selection":"ink", image,
          context:cluster.result ? { ...(SMART_SUGGEST.actionById(cluster.previousAction) || cluster.previousAction === "ask" ? { previousAction:cluster.previousAction } : {}) } : {shapesFit:analysis.rough.length>0, ...(noteScope ? { noteScope:noteScope.kind } : {}), ...(widgetRefine ? { widgetRefine } : {}), ...(!cluster.selection && assistDeletionDetails(cluster) ? { deletionMark:true } : {})} }),
      });
      const data = await response.json().catch(() => null);
      const current = sequence === smartSuggest.sequence && !controller.signal.aborted,
        candidateReply = ink && !current && request.interrupted && smartSuggestCandidateValid(request);
      if (!current && !candidateReply || cluster.result && smartSuggestResultCluster()?.key !== cluster.key || cluster.selection && (state.selection !== cluster.selection || smartSuggestCluster()?.key !== cluster.key)) return;
      if (ink && !smartSuggestCandidateValid(request)) return;
      updateSuggestionAccess(data);
      if (!response.ok || !data?.ok) {
        if (!current) return;
        smartSuggest.status = { key:cluster.key, state:suggestionAccessBlocked() ? "blocked" : "failed", reason:data?.reason || `http-${response.status}` };
        if(suggestionAccessBlocked()){assistRefresh("allowance");return;}
        smartSuggestFailure(data?.reason || data?.error || `http-${response.status}`);
        return;
      }
      const verdict = { key:cluster.key, result:cluster.result, selection:cluster.selection, strokeIds:new Set(cluster.strokes.map(stroke => stroke.id)), answers:data.answers, latencyMs:Math.round(performance.now() - started),
        tier:request.tier, sequence, epoch:request.epoch, documentId, strokes:cluster.strokes, objects:cluster.objects, objectKey:cluster.objectKey };
      if (current) {
        smartSuggest.failures = 0;
        smartSuggest.pausedUntil = 0;
        smartSuggest.status = { key:cluster.key, state:candidateReply ? "ready" : "ranked" };
        smartSuggest.lastResult = { latencyMs:Math.round(performance.now() - started), cached:data.cached === true, chargedCredits:Number(data.chargedCredits) || 0, at:Date.now() };
      }
      verdict.lastResult = current ? smartSuggest.lastResult : { latencyMs:verdict.latencyMs, cached:data.cached === true, chargedCredits:Number(data.chargedCredits) || 0, at:Date.now() };
      if (ink && current) {
        smartSuggest.evaluatedStrokeId = Math.max(smartSuggest.evaluatedStrokeId, cluster.strokes.at(-1)?.id || 0);
        smartSuggest.profile = SMART_SUGGEST.updateProfile(smartSuggest.profile, data.answers.kind);
        assistLearnInstantRanking(cluster, data.answers);
      }
      if (canvasDocumentsCurrent().id !== documentId) return;
      // Ranking only analyzes input. Dirty ownership remains with the existing
      // Canvas action lifecycle, including Stop, failure and successful commit.
      if (candidateReply) {
        // Retain late reply metadata without applying it to newer pending input.
        if (sequence > Math.max(smartSuggest.nextCandidate?.sequence || 0, smartSuggest.jev?.sequence || 0)) smartSuggest.nextCandidate = verdict;
        if (smartSuggestUseNextCandidate()) assistRefresh("penecho-llm-default");
      } else {
        smartSuggest.jev = verdict;
        if ((smartSuggest.nextCandidate?.sequence || 0) <= sequence) smartSuggest.nextCandidate = null;
        assistRefresh("penecho-llm");
      }
      debug("smart-suggest", { latencyMs:verdict.latencyMs, tier:request.tier, candidate:candidateReply, model:data.model, kind:data.answers.kind?.choice, action:data.answers.action?.choice, confidence:Number(data.answers.action?.confidence || 0).toFixed(2) });
      if (ink && current) {
        // The same classification labels the ink for Canvas search, and a
        // derivation line may get a (suggest-only) step check.
        if (typeof canvasIndexInk === "function") void canvasIndexInk(cluster, data.answers).catch(() => {});
        if (typeof stepCheckerConsider === "function") void stepCheckerConsider(cluster, data.answers, region).catch(() => {});
      }
    } catch (error) {
      if (sequence === smartSuggest.sequence && (!controller.signal.aborted || timedOut)) smartSuggestFailure(timedOut || error?.name === "AbortError" ? "timeout" : "network");
    } finally {
      clearTimeout(timeout);
      if (smartSuggest.controller === controller) smartSuggest.controller = null;
      if (smartSuggest.request === request) smartSuggest.request = null;
      if (sequence === smartSuggest.sequence && smartSuggest.status?.key === cluster.key && smartSuggest.status.state === "pending") smartSuggest.status = { key:cluster.key, state:"failed", reason:"cancelled" };
      if (sequence === smartSuggest.sequence && smartSuggest.rerun) { smartSuggest.rerun = false; scheduleSmartSuggest(0); }
      // The spark must never keep spinning for a request that has ended.
      else assistRefreshRank();
    }
  }
  // Updates only the ranking badge (the bar may be hovered or unchanged).
  function assistRefreshRank(cluster = null, view = null) {
    const bar = smartSuggest.bar;
    if (!bar || !["suggest", "result", "followup"].includes(bar.mode) || !bar.cluster) return;
    const rank = penechoLLMRankState(cluster || bar.cluster, view || bar.view);
    if (bar.element.dataset.rank === rank) return;
    bar.element.dataset.rank = rank;
    bar.element.querySelector(".assist-spark")?.replaceWith(assistSparkControl(rank));
    if (bar.info) syncAssistLlmInfo(bar);
  }
  // The Widgets whose pixels this classification image contains: for a lasso
  // the Widgets touching the polygon, otherwise the Widgets in the crop
  // (including the pending-ink bounds smartSuggestCrop adds).
  function smartSuggestRequiredWidgets(cluster, region, includeDirty = true) {
    if (cluster.selection) return cluster.selection.regionOnly ? widgetsRequiredForCapture(cluster.selection.box, selectionPathFor(cluster.selection)) : [];
    const box = includeDirty && !cluster.result ? unionLocalBounds(region, smartSuggestDirtyBox()) : region;
    return box ? capturableWidgets(box) : [];
  }
  // Keep the local suggestions, end the pending state, and retry once when a
  // capture that missed the deadline completes in the background.
  function smartSuggestSnapshotUnavailable(cluster, sequence, prepared) {
    smartSuggest.status = { key:cluster.key, state:"failed", reason:"snapshot-unavailable" };
    debug("smart-suggest-snapshot-unavailable", { missing:prepared?.missing || 0, widgetIds:(prepared?.missingWidgets || []).map(widget => widget.id), code:prepared?.error?.code || null });
    const pending = prepared?.pending || [];
    if (smartSuggest.retries >= 1 || !pending.length) return;
    smartSuggest.retries++;
    void Promise.allSettled(pending).then(() => {
      if (sequence !== smartSuggest.sequence || smartSuggest.controller || smartSuggest.lastKey !== cluster.key || smartSuggestCluster()?.key !== cluster.key) return;
      smartSuggest.lastKey = "";
      scheduleSmartSuggest(0);
    });
  }
  function smartSuggestFailure(reason) {
    smartSuggest.failures++;
    const delay = reason === "rate_limited" || reason === "http-429" ? 30000 : Math.min(10000, 2000 * 2 ** Math.min(3, smartSuggest.failures - 1));
    smartSuggest.pausedUntil = performance.now() + delay;
    if (smartSuggest.status) smartSuggest.status = { ...smartSuggest.status, state:"failed", reason };
    // Retry unchanged input once. Keep lastKey after the second failure so
    // status recovery and automatic scheduling cannot restart the same input.
    if (smartSuggest.retries < 1 && !/^(invalid|invalid_action_space|forbidden|http-40[013])$/.test(reason)) {
      smartSuggest.retries++;
      smartSuggest.lastKey = "";
      scheduleSmartSuggest(delay);
    }
    debug("smart-suggest-silent-failure", { reason, failures:smartSuggest.failures });
  }

  // Keep the manual shortcut in a ranked first/second slot, or default third.
  // Result/Next suggestions keep their own classification-based actions.
  function assistAnswerView(view) {
    // Preserve a ranked Answer (PenEchoLLM or the calibrated instant order) in
    // first or second place; otherwise keep the shortcut in third/last place.
    const answerIndex = view.items.findIndex(item => item.id === "answer"),
      rankedAnswer = answerIndex >= 0 && answerIndex < 2;
    const ranked = [...view.items, ...view.more].filter(item => item.id !== "answer"),
      items = ranked.filter(item => item.mainEligible !== false).slice(0, 2);
    items.splice(rankedAnswer ? answerIndex : items.length, 0, rankedAnswer ? view.items[answerIndex] : { id:"answer", source:"local" });
    return { ...view, items, more:ranked.filter(item => !items.includes(item)), confident:view.confident && items[0].id === view.items[0]?.id };
  }
  // What the bar should offer for the current cluster.
  function assistView(cluster) {
    if (cluster.result) {
      // No guessed next actions while waiting; Ask and Keep remain available.
      return SMART_SUGGEST.rankResultActions(smartSuggest.jev?.key === cluster.key ? smartSuggest.jev.answers : null, { previousAction:cluster.previousAction });
    }
    if (cluster.selection && !smartSuggest.enabled) return assistAnswerView({ items:[{ id:"typeset", source:"local" }], more:[], confident:false, source:"local" });
    const analysis = assistAnalyze(cluster),
      local = SMART_SUGGEST.localPredict(assistLocalFeatures(cluster, analysis)),
      ids = new Set(cluster.strokes.map(stroke => stroke.id)),
      jev = smartSuggest.jev && !smartSuggest.jev.result && (cluster.selection ? smartSuggest.jev.key === cluster.key : !smartSuggest.jev.selection && (smartSuggest.jev.objectKey || "") === (cluster.objectKey || "") && [...smartSuggest.jev.strokeIds].every(id => ids.has(id))) ? smartSuggest.jev : null;
    const routing=jev && (cluster.selection || jev.strokeIds.size===ids.size) ? jev.answers : null;
    const deletion = assistDeletionDetails(cluster), widgetRefine = assistWidgetRefineTarget(cluster);
    const view = {...assistAnswerView(SMART_SUGGEST.rankActions({ local, answers:jev?.answers, cooldown:smartSuggest.cooldown, now:performance.now(), exclude:[...(analysis.rough.length && !deletion && !widgetRefine ? [] : ["snap_shapes"]), ...(widgetRefine ? [] : ["refine"])] })),routing,deletion,widgetRefine};
    view.noteScope = assistNoteScope(cluster);
    return view;
  }
  function assistSuggestBlocked() {
    const selected = smartSuggest.selection && smartSuggest.selection === state.selection && state.selection.phase === "active";
    // Keep the current bar while requests pause automatic suggestion refreshes.
    return !smartSuggestActive() || state.drawing || state.selectionGesture || state.selection && !selected
      || !selected && (!smartSuggestInputModeAllowed() || smartSuggestObjectEditing()) || state.viewMode || document.visibilityState === "hidden" || smartSuggest.shapeTool
      || assistRequestsActive()
      || (!selected && typeof penDeleteOfferVisible === "function" && penDeleteOfferVisible());
  }
  function assistRequestsActive() {
    const documentId = canvasDocumentsCurrent().id;
    return [...smartSuggest.requests.values()].some(request => request.documentId === documentId && request.blocksSuggestions !== false);
  }
  function assistRequestsHideBar() {
    const documentId = canvasDocumentsCurrent().id;
    return [...smartSuggest.requests.values()].some(request => request.documentId === documentId && request.hideSuggestions);
  }
  function assistRequestModel(bar) {
    return bar && ["suggest", "followup"].includes(bar.mode)
      ? { mode:bar.mode, box:bar.box, cluster:bar.cluster, view:bar.view, target:bar.target, action:bar.action } : null;
  }
  function assistRequestStarted(owner, { blocksSuggestions = true, hideSuggestions = false } = {}) {
    if (typeof agentSuggestWorkStarted === "function") agentSuggestWorkStarted();
    const previous = smartSuggest.requests.get(owner);
    if (previous?.documentId === canvasDocumentsCurrent().id) return;
    for (const snapshot of previous?.inputSnapshots || []) releaseDirtyInput(snapshot);
    const bar = smartSuggest.bar;
    smartSuggest.requests.set(owner, {
      documentId:canvasDocumentsCurrent().id,
      recognitionGeneration:state.recognitionGeneration,
      blocksSuggestions,
      hideSuggestions,
      strokeId:smartSuggest.strokes.at(-1)?.id || 0,
      selection:state.selection,
      restore:assistRequestModel(bar) || bar?.requestRestoreModel || null,
    });
    if (bar) positionAssist();
  }
  function assistRequestInputCaptured(owner, snapshot) {
    const request = smartSuggest.requests.get(owner);
    if (!request || request.documentId !== canvasDocumentsCurrent().id) { releaseDirtyInput(snapshot); return; }
    (request.inputSnapshots ||= []).push(snapshot);
  }
  function assistRequestFinished(owner, outcome) {
    const request = smartSuggest.requests.get(owner);
    if (!request) return;
    smartSuggest.requests.delete(owner);
    for (const snapshot of request.inputSnapshots || []) releaseDirtyInput(snapshot);
    if (request.documentId !== canvasDocumentsCurrent().id) return;
    // Canvas AI and Suggest-to-Agent commit paths own their cleanup. Ordinary
    // Agent turns finish here, only after an actual Canvas write.
    if (outcome === "completed" && request.recognitionGeneration === state.recognitionGeneration
      && request.canvasWritten && !assistAgent.resultTarget) consumeAllDirtyInput();
    const bar = smartSuggest.bar;
    // Explicitly nonblocking observers leave the current presentation intact.
    if (request.blocksSuggestions === false) {
      if (bar) positionAssist();
      return;
    }
    if (outcome === "completed") {
      smartSuggest.dismissedStrokeId = Math.max(smartSuggest.dismissedStrokeId, request.strokeId);
      if (request.selection && state.selection === request.selection) smartSuggest.dismissedSelection = request.selection;
      if (bar?.mode === "suggest" || bar?.mode === "followup" && bar.target === request.restore?.target) hideAssist("request-completed");
      if (bar?.mode === "working" && !assistRequestsActive()) {
        if (!bar.target?.selection && bar.target?.resultBox) renderAssist({ mode:"followup", box:bar.target.box, target:bar.target, action:bar.action });
        else hideAssist("request-completed");
      }
      if (!assistRequestsActive() && ((smartSuggest.strokes.at(-1)?.id || 0) > request.strokeId || smartSuggestObjectInput().objects.length)) scheduleAssist();
    } else if (!assistRequestsActive() && outcome !== "superseded") {
      if (bar?.mode === "working") hideAssist("request-stopped");
      const restore = request.restore,
        selection = restore?.cluster?.selection || restore?.target?.selection,
        strokes = restore?.cluster?.strokes || [];
      if (restore && smartSuggestActive() && !state.drawing && !state.pending && !state.pendingWidget
        && (smartSuggest.strokes.at(-1)?.id || 0) <= request.strokeId
        && (!selection || selection === state.selection && smartSuggest.dismissedSelection !== selection)
        && strokes.every(stroke => state.history.includes(stroke.historyEntry) && !stroke.inputConsumed && stroke.id > Math.max(smartSuggest.consumedStrokeId, smartSuggest.dismissedStrokeId))) {
        renderAssist(restore);
      } else assistRefresh("request-stopped");
    }
    if (smartSuggest.bar) positionAssist();
  }
  function assistRefresh(reason = "") {
    const bar = smartSuggest.bar;
    if (!smartSuggestActive()) { hideAssist("inactive"); return; }
    if (assistRequestsActive() && bar?.mode !== "result") return;
    const result = smartSuggestResultCluster();
    if (result) {
      const view = assistView(result);
      if (bar.hovered && bar.cluster?.key === result.key && view.items.length) { if (bar.nextTarget) bar.nextTarget.routing = view.routing; bar.deferred = { cluster:result, view }; assistRefreshRank(result, view); return; }
      renderAssist({ mode:bar.mode, box:bar.box, target:bar.target, action:bar.action, cluster:result, view, reason });
      return;
    }
    if (bar && ["working", "result", "tool", "tools", "hold"].includes(bar.mode)) return;
    if (state.drawing) return;
    if (!smartSuggest.selection && !smartSuggestReopenedInk() && performance.now() < smartSuggest.localReadyAt) return;
    // A temporary pause in prediction does not dismiss already useful help.
    if (assistSuggestBlocked()) return;
    const cluster = smartSuggestCluster();
    if (!cluster) { if (bar?.mode === "suggest") hideAssist("no-ink"); return; }
    const view = assistView(cluster);
    if (cluster.selection && !view.items.length) view.items.push({ id:"typeset", source:"local" });
    if (!view.items.length) return;
    const rankingReply = reason === "penecho-llm" || reason === "penecho-llm-default",
      localTargetChanged = reason === "local" && bar?.cluster?.key !== cluster.key;
    if (bar?.hovered && !localTargetChanged && !(rankingReply && bar.mode === "suggest" && bar.cluster?.key === cluster.key && !bar.element.querySelector("input"))) {
      // Preserve button positions under the pointer, but use the verdict that
      // just arrived for this exact target when an existing button is clicked.
      if (bar.cluster?.key === cluster.key && bar.target) bar.target.routing = view.routing;
      bar.deferred = { cluster, view }; assistRefreshRank(cluster, view); return;
    }
    renderAssist({ mode:"suggest", cluster, view, box:cluster.box, reason });
  }
  // Compatibility for callers of the first version.
  function hideSmartSuggestions(reason = "") { hideAssist(reason); }
  function positionSmartSuggestions() { positionAssist(); }
  function trackSmartSuggestions() { trackAssist(); }

  // ---------- Assist bar ----------
  const SMART_SUGGEST_ICONS = Object.freeze({ refine:"✦", plot:"∿", typeset:"∑", solve:"=", check:"✓", next:"↓", hint:"?", practice:"✎", shape:"◯", diagram:"⇄", prototype:"▣", organize:"≡", answer:"↳", explain:"i", interactive:"✦", animate:"▶", finish:"✎", vivid:"✺", animate_sketch:"✧", note:"▤" });
  const ASSIST_TOOL_ICONS = Object.freeze({ rectangle:"▭", ellipse:"◯", line:"╱", arrow:"→", triangle:"△", axes:"⊥", graph:"∿", graph3d:"⛰" });
  function assistLabel(item) {
    if (item.label) return typeof item.label === "string" ? item.label : item.label[state.language === "zh" ? "zh" : "en"] || item.label.en;
    return SMART_SUGGEST.label(SMART_SUGGEST.actionById(item.id), state.language, { illustrationStyle:state.illustrationStyle });
  }
  function assistButton(label, icon, className, onClick, title = "") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    if (icon) {
      const glyph = document.createElement("span");
      glyph.className = "assist-icon";
      glyph.setAttribute("aria-hidden", "true");
      glyph.textContent = icon;
      button.append(glyph);
    }
    if (label) {
      const text = document.createElement("span");
      text.className = "assist-label";
      text.textContent = label;
      button.append(text);
    }
    if (title) { button.title = title; button.setAttribute("aria-label", title); }
    button.addEventListener("pointerdown", event => event.stopPropagation());
    button.addEventListener("click", event => { event.stopPropagation(); onClick(event); });
    return button;
  }
  function assistActionButton(item, primary, target) {
    const action = SMART_SUGGEST.actionById(item.id), icon = SMART_SUGGEST_ICONS[action?.icon] || "•";
    const button = assistButton(assistLabel(item), icon, `assist-action${primary ? " primary" : ""}`, () => executeAssistAction(item, target),
      item.id === "answer" && !target.followUp ? t("triggerAutoAI") : `${assistLabel(item)} · ${item.source === "penecho-llm" ? t("assistSourcePenEchoLLM") : t("assistSourceLocal")}`);
    button.dataset.suggestion = item.id;
    button.dataset.source = item.source || "local";
    return button;
  }
  function assistEnsureElement() {
    let bar = smartSuggest.bar;
    if (bar) return bar;
    const element = document.createElement("div");
    element.className = "assist-bar";
    element.setAttribute("role", "toolbar");
    element.setAttribute("aria-label", t("smartSuggestions"));
    bar = { element, mode:"", hovered:false, deferred:null, box:null };
    element.addEventListener("pointerenter", () => {
      bar.hovered = true;
      // Reading the options should not race Auto AI.
      clearTimeout(state.timer);
      state.timer = 0;
    });
    element.addEventListener("pointerleave", () => {
      if (element.querySelector("input") === document.activeElement) return;
      bar.hovered = false;
      if (bar.deferred) { bar.deferred = null; assistRefresh("pointerleave"); }
      if (state.auto && state.dirty && state.autoEligible && !state.activeAI && typeof schedule === "function") schedule();
    });
    element.addEventListener("pointerdown", event => event.stopPropagation());
    element.addEventListener("keydown", event => {
      if (event.key === "Escape") { event.stopPropagation(); if (bar.mode === "tool") stopAssistShapeTool(); else dismissAssist("escape"); }
    });
    smartSuggestLayer.append(element);
    smartSuggest.bar = bar;
    return bar;
  }
  function renderAssist(model) {
    if (!smartSuggestLayer || !SMART_SUGGEST) return;
    const bar = assistEnsureElement(), element = bar.element,
      previousRank = bar.mode === "suggest" ? element.dataset.rank || "" : "";
    if (model.mode === "working" && bar.mode !== "working") bar.requestRestoreModel = assistRequestModel(bar);
    else if (model.mode !== "working") bar.requestRestoreModel = null;
    if (model.mode !== "suggest" || bar.mode !== "suggest" || bar.cluster?.key !== model.cluster?.key) bar.info = false;
    Object.assign(bar, { reopenedKey:model.reopenedKey || (model.mode === "suggest" && bar.cluster?.key === model.cluster?.key ? bar.reopenedKey : null), mode:model.mode, box:model.box || bar.box, cluster:model.cluster || null, view:model.view || null, target:model.target || null, action:model.action || null, deferred:null, menu:false, idleSince:0, blocked:null });
    if (!["result", "followup"].includes(model.mode)) bar.resultCluster = null;
    if (model.mode === "followup" && !bar.target?.followUp) bar.target = assistFollowUpTarget(model.target, model.box);
    const resultCluster = smartSuggestResultCluster();
    if (resultCluster) { bar.cluster = resultCluster; bar.view = model.view || assistView(resultCluster); }
    if (model.mode !== "suggest" && model.mode !== "followup") bar.hovered = false;
    element.textContent = "";
    bar.suggestionLayout = null;
    runtimeElementStyle(element, "assist-bar")?.removeProperty("--assist-action-max-width");
    element.dataset.mode = model.mode;
    element.dataset.source = model.view?.source || "";
    element.dataset.scope = model.cluster?.selection || model.target?.selection ? "selection" : "canvas";
    if (model.mode === "suggest" || resultCluster) element.dataset.rank = penechoLLMRankState(bar.cluster, bar.view);
    else delete element.dataset.rank;
    element.classList.remove("assist-menu-shown", "has-access-notice");
    if (model.mode === "followup" && !bar.view?.items.length) {
      // Keep the result target alive for background ranking and invalidation,
      // but display no Next label, Ask control, badge or loading placeholder.
      element.classList.remove("visible");
      smartSuggestLayer.hidden = true;
      bar.hovered = false;
      if (resultCluster && resultCluster.key !== smartSuggest.lastKey && !smartSuggest.timer) scheduleSmartSuggest();
      trackAssist();
      return;
    }
    if (model.mode === "suggest") {
      const target = { routing:model.view.routing, deletion:model.view.deletion, widgetRefine:model.view.widgetRefine, noteScope:model.view.noteScope, box:model.cluster.box, newBox:model.cluster.newBox, strokes:model.cluster.strokes, selection:model.cluster.selection, selectionKey:model.cluster.selection ? model.cluster.key : null };
      bar.target = target;
      element.append(assistSparkControl(element.dataset.rank));
      model.view.items.forEach((item, index) => element.append(assistActionButton(item, index === 0 && model.view.confident, target)));
      const buttons = [...element.querySelectorAll(":scope > .assist-action")],
        ask = assistAskControl(target), more = assistMoreControl(model.view.more, target), close = assistCloseButton(model);
      element.append(ask, more, close);
      bar.suggestionLayout = { buttons, ask, more, close };
      const accessNotice=suggestionAccessNotice();
      element.classList.toggle("has-access-notice",Boolean(accessNotice));
      if(accessNotice)element.append(accessNotice);
      if (bar.info) syncAssistLlmInfo(bar);
    } else if (model.mode === "working") {
      const spinner = document.createElement("span"), text = document.createElement("span");
      spinner.className = "assist-spinner";
      spinner.setAttribute("aria-hidden", "true");
      text.className = "assist-status";
      text.textContent = `${model.label}…`;
      element.append(spinner, text, assistButton(t("assistStop"), "■", "assist-quiet", () => { if(typeof assistAgent!=="undefined"){assistAgent.generation++;assistAgent.routeController?.abort();} stopActiveAIRequests(); hideAssist("stopped"); assistRefresh("stopped"); }));
      if (bar.target?.selection) element.append(assistCloseButton(model));
    } else if (model.mode === "result") {
      element.append(assistButton(t("assistKeep"), "✓", "assist-action primary", () => assistAcceptResult()));
      if (bar.action?.id !== "ask" && SMART_SUGGEST.actionById(bar.action?.id)) element.append(
        assistButton(t("assistRetry"), "↻", "assist-action", () => { const again = bar.action, target = bar.target; assistRejectResult(); executeAssistAction(again, { ...target, resultBox:null }); }));
      if (resultCluster && bar.view.items.length) {
        const divider = document.createElement("span");
        divider.className = "assist-divider";
        element.append(divider, assistSparkControl(element.dataset.rank));
        const target = assistFollowUpTarget(bar.target, resultCluster.box, true);
        target.routing = bar.view.routing;
        bar.nextTarget = target;
        for (const item of bar.view.items.slice(0, 2)) element.append(assistActionButton(item, false, target));
      }
      element.append(assistCloseButton(model));
    } else if (model.mode === "followup") {
      const label = document.createElement("span");
      label.className = "assist-status";
      label.textContent = t("assistNext");
      element.append(label);
      const target = bar.target;
      bar.target = target;
      bar.box = target.box;
      target.routing = bar.view?.routing;
      bar.nextTarget = target;
      if (resultCluster) element.append(assistSparkControl(element.dataset.rank));
      for (const item of bar.view?.items || []) element.append(assistActionButton(item, false, target));
      element.append(assistAskControl(target), assistCloseButton(model));
    } else if (model.mode === "hold") {
      const badge = document.createElement("span");
      badge.className = "assist-hold";
      badge.textContent = `${SMART_SUGGEST_ICONS.shape} ${t(`smartShape_${model.fit.type}`)}`;
      element.append(badge);
    } else if (model.mode === "tool") {
      const text = document.createElement("span");
      text.className = "assist-status";
      text.textContent = `${ASSIST_TOOL_ICONS[model.kind] || ""} ${t(`shapeTool_${model.kind}`)} · ${t("assistToolHint")}`;
      element.append(text, assistButton(t("assistDone"), "", "assist-action primary", () => stopAssistShapeTool()));
    } else if (model.mode === "tools") {
      element.append(assistToolsList(model.target), assistCloseButton(model));
    }
    element.classList.add("visible");
    smartSuggestLayer.hidden = false;
    positionAssist();
    if (model.mode === "suggest") assistAnimateRanking(element, previousRank);
    if (resultCluster && resultCluster.key !== smartSuggest.lastKey && !smartSuggest.timer) scheduleSmartSuggest();
    trackAssist();
  }
  function assistCloseButton(model) {
    const selection = model.cluster?.selection || model.target?.selection;
    return assistButton("", "×", "assist-close", () => {
      if (selection && state.selection === selection) { cancelSelection(); return; }
      dismissAssist("dismissed", true);
    }, t(selection ? "selectionCancel" : "smartSuggestDismiss"));
  }
  function assistAskControl(target) {
    const wrap = document.createElement("span");
    wrap.className = "assist-ask";
    const open = assistButton(t("assistAsk"), "↳", "assist-quiet", () => {
      wrap.textContent = "";
      const input = document.createElement("input");
      const submit = () => { const text = input.value.trim(); if (text) assistAsk(text, target); };
      const send = assistButton("", "➤", "assist-send", submit, t("assistSend"));
      input.type = "text";
      input.maxLength = 1800;
      input.placeholder = t("assistAskPlaceholder");
      input.setAttribute("aria-label", t("assistAskPlaceholder"));
      input.addEventListener("pointerdown", event => event.stopPropagation());
      input.addEventListener("keydown", event => {
        event.stopPropagation();
        if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); submit(); }
        if (event.key === "Escape") {
          if (target.selection) { hideAssist("escape"); assistRefresh("question-closed"); }
          else dismissAssist("escape");
        }
      });
      wrap.append(input, send);
      if (smartSuggest.bar) smartSuggest.bar.hovered = true;
      input.focus();
      positionAssist();
    });
    wrap.append(open);
    return wrap;
  }
  function assistMoreControl(more, target) {
    const wrap = document.createElement("span");
    wrap.className = "assist-more";
    const toggle = assistButton("", "⋯", "assist-quiet", () => {
      const bar = smartSuggest.bar;
      if (!bar) return;
      bar.menu = !bar.menu;
      toggle.setAttribute("aria-expanded", String(bar.menu));
      bar.element.classList.toggle("assist-menu-shown", bar.menu);
      positionAssist();
    }, t("smartSuggestMore"));
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-haspopup", "true");
    const menu = document.createElement("div");
    menu.className = "assist-menu";
    if (target?.selection) {
      // A fixed local menu control, independent of the LLM action registry and ranking.
      const download = assistButton(t("selectionDownload"), "", "assist-action", () => {
        void exportSelectionPng(target, download);
      });
      download.dataset.selectionAction = "download";
      menu.append(download);
    }
    for (const item of more || []) menu.append(assistActionButton(item, false, target));
    if (![...(smartSuggest.bar?.view?.items || []), ...(more || [])].some(item => item.id === "note")
      && target?.widgetRefine?.widget?.sourceFormat !== "penecho-note-card+json") {
      menu.append(assistActionButton({ id:"note", source:"local" }, false, target));
    }
    if (target?.selection) {
      if (![...(smartSuggest.bar?.view?.items || []), ...(more || [])].some(item => item.id === "typeset")) {
        menu.append(assistActionButton({ id:"typeset", source:"local" }, false, target));
      }
      if (!target.selection.regionOnly) {
        const remove = assistButton(t("selectionDelete"), "", "assist-action", () => {
          if (assistSelectionTargetValid(target) && !selectionAIBusy(target.selection)) deleteSelection();
        });
        remove.dataset.selectionAction = "delete";
        menu.append(remove);
      }
      const cancel = assistButton(t("selectionCancel"), "", "assist-action", () => {
        if (state.selection === target.selection) cancelSelection();
      });
      cancel.dataset.selectionAction = "cancel";
      menu.append(cancel);
    } else menu.append(assistToolsList(target));
    wrap.append(toggle, menu);
    return wrap;
  }
  function assistToolsList(target) {
    const list = document.createElement("div");
    list.className = "assist-tools";
    for (const kind of SMART_SUGGEST.SHAPE_TOOLS) {
      const button = assistButton(t(`shapeTool_${kind}`), ASSIST_TOOL_ICONS[kind], `assist-tool${smartSuggest.shapeTool?.kind === kind ? " active" : ""}`, () => startAssistShapeTool(kind));
      button.dataset.tool = kind;
      list.append(button);
    }
    const graph = assistButton(t("assistGraph"), ASSIST_TOOL_ICONS.graph, "assist-tool", () => { hideAssist("graph"); void insertAssistGraph(target).catch(error => setStatus(String(error?.message || error))); });
    graph.dataset.tool = "graph";
    const surface = assistButton(t("assistGraph3d"), ASSIST_TOOL_ICONS.graph3d, "assist-tool", () => { hideAssist("graph-3d"); void insertAssistGraph(target, { surface:true }).catch(error => setStatus(String(error?.message || error))); });
    surface.dataset.tool = "graph3d";
    list.append(graph, surface);
    if (typeof openNoteLibrary === "function") {
      const library = assistButton(state.language === "zh" ? "笔记库" : "Notes library", "▦", "assist-tool", () => { hideAssist("note-library"); void openNoteLibrary(); });
      library.dataset.tool = "notes";
      list.append(library);
    }
    // Canvas content search is deferred; keep it out of the tools menu.
    return list;
  }
  function showSmartHoldPreview(drawing, fit) {
    if (!smartSuggestLayer || !SMART_SUGGEST) return;
    if (smartSuggest.bar && !["suggest", "followup", "hold"].includes(smartSuggest.bar.mode)) return;
    renderAssist({ mode:"hold", fit, box:fit.bounds });
  }
  function hideAssist(reason = "") {
    const bar = smartSuggest.bar;
    if (!bar) return;
    if (bar.mode === "tool" && smartSuggest.shapeTool && reason !== "tool-stopped") return;
    smartSuggest.bar = null;
    smartSuggest.dismissTap = null;
    bar.element.remove();
    if (smartSuggestLayer && !smartSuggestLayer.querySelector(".assist-bar, .assist-shape-preview")) smartSuggestLayer.hidden = true;
    cancelAnimationFrame(smartSuggest.frame);
    smartSuggest.frame = 0;
    if (reason) debug("assist-hidden", { reason });
  }
  function dismissAssist(reason, feedback = false) {
    const bar = smartSuggest.bar;
    if (!bar) return;
    if (["suggest", "followup"].includes(bar.mode)) {
      if (feedback && bar.mode === "suggest") {
        for (const item of bar.view.items) smartSuggest.cooldown[item.id] = SMART_SUGGEST.dismissAction(smartSuggest.cooldown[item.id], performance.now());
        smartSuggestRecent(`dismissed ${bar.view.items.map(item => item.id).join("+")}`);
      }
      if (bar.target?.selection) smartSuggest.dismissedSelection = bar.target.selection;
      else {
        smartSuggest.dismissedStrokeId = Math.max(smartSuggest.dismissedStrokeId, smartSuggest.strokes.at(-1)?.id || 0);
        smartSuggest.dismissedObjectKey = bar.cluster?.objectKey || smartSuggestObjectInput().objectKey;
      }
      // A late ranking reply must not reopen help the user just dismissed.
      cancelSmartSuggest(reason);
    } else hideAssist(reason);
  }
  function assistBlankPoint(point, bar) {
    if (!valid(point) || handObjectToolbarTargetAtPoint(point)) return false;
    const box = bar.box, pad = 6 / Math.max(0.03, state.scale);
    if (box && point.x >= box.x - pad && point.x <= box.x + box.w + pad && point.y >= box.y - pad && point.y <= box.y + box.h + pad) return false;
    // Check raster ink too, including ink loaded without a recent stroke log.
    const x = Math.floor(point.x - pad), y = Math.floor(point.y - pad), size = Math.ceil(pad * 2) + 1;
    let ink = false;
    forTiles(x, y, size, size, (canvas, tx, ty) => {
      if (ink) return;
      const left = Math.max(0, x - tx * TILE), top = Math.max(0, y - ty * TILE),
        right = Math.min(TILE, x + size - tx * TILE), bottom = Math.min(TILE, y + size - ty * TILE),
        pixels = canvas.getContext("2d").getImageData(left, top, right - left, bottom - top).data;
      for (let index = 3; index < pixels.length; index += 4) if (pixels[index]) { ink = true; break; }
    }, false);
    return !ink;
  }
  function beginAssistDismissTap(event) {
    smartSuggest.dismissTap = null;
    const bar = smartSuggest.bar;
    if (!bar || !["suggest", "followup"].includes(bar.mode) || bar.target?.selection || event.target !== screen
        || event.button !== 0 || event.pointerType === "pen" || event.isPrimary === false
        || state.spacePan || event.altKey || state.drawing || state.touches.size) return;
    if (!assistBlankPoint(clientPoint(event), bar)) return;
    smartSuggest.dismissTap = { id:event.pointerId, x:event.clientX, y:event.clientY, bar };
  }
  function moveAssistDismissTap(event) {
    const tap = smartSuggest.dismissTap;
    if (tap?.id === event.pointerId && Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > 6) smartSuggest.dismissTap = null;
  }
  function finishAssistDismissTap(event) {
    const tap = smartSuggest.dismissTap;
    if (!tap || tap.id !== event.pointerId) return;
    smartSuggest.dismissTap = null;
    if (event.type === "pointerup" && smartSuggest.bar === tap.bar && Math.hypot(event.clientX - tap.x, event.clientY - tap.y) <= 6) dismissAssist("blank-tap");
  }
  // Dismissal suppresses automatic offers; it does not consume the dirty ink.
  // Explicitly revisiting that region restores help and immediately requests
  // PenEchoLLM ranking when the current ink has no completed verdict.
  function assistDirtyClusterAtPoint(point) {
    smartSuggestSyncDocument();
    if (!smartSuggestActive() || smartSuggest.bar || !valid(point) || state.viewMode
        || !["pen", "hand"].includes(state.mode) || state.spacePan || state.drawing || state.activeAI
        || state.pending || state.pendingWidget || state.selection || state.selectionGesture || state.panGesture
        || state.touchGesture || state.touches.size || state.widgetRefineConfirmation || smartSuggest.shapeTool
        || document.visibilityState === "hidden" || handObjectToolbarTargetAtPoint(point)) return null;
    const contains = box => point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h;
    const cluster = smartSuggestCluster(true);
    if (!cluster || cluster.selection || !contains(cluster.box)
        || cluster.box.w * state.scale < 14 && cluster.box.h * state.scale < 14) return null;
    return cluster;
  }
  function reopenAssistAtPoint(point) {
    const cluster = assistDirtyClusterAtPoint(point);
    if (!cluster) return;
    const view = assistView(cluster);
    if (!view.items.length) return;
    smartSuggest.dismissedStrokeId = 0;
    smartSuggest.dismissedObjectKey = "";
    renderAssist({ mode:"suggest", cluster, view, box:cluster.box, reopenedKey:cluster.key, reason:"dirty-revisited" });
    if (view.source !== "penecho-llm" || smartSuggest.jev?.key !== cluster.key) {
      // Cancellation leaves lastKey behind. Release that deduplication guard
      // and the writing/backoff delay for this explicit revisit only.
      clearTimeout(smartSuggest.timer);
      smartSuggest.timer = 0;
      if (!smartSuggest.controller) {
        smartSuggest.lastKey = "";
        smartSuggest.retryKey = "";
        smartSuggest.retries = 0;
      }
      smartSuggest.pausedUntil = 0;
      void runSmartSuggest().catch(error => debug("smart-suggest-error", { error:String(error?.message || error).slice(0, 160) })).finally(() => assistRefreshRank());
    }
  }
  function beginAssistReopenTap(event) {
    smartSuggest.reopenTap = null;
    if (event.target !== screen || event.button !== 0 || event.isPrimary === false || event.altKey
        || state.mode !== "hand" && event.pointerType !== "touch") return;
    if (assistDirtyClusterAtPoint(clientPoint(event))) smartSuggest.reopenTap = { id:event.pointerId, x:event.clientX, y:event.clientY };
  }
  function moveAssistReopenPointer(event) {
    const tap = smartSuggest.reopenTap;
    if (tap?.id === event.pointerId && Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > 6) smartSuggest.reopenTap = null;
    if (event.target === screen && event.pointerType === "mouse" && Number(event.buttons) === 0 && !event.altKey) reopenAssistAtPoint(clientPoint(event));
  }
  function finishAssistReopenTap(event) {
    const tap = smartSuggest.reopenTap;
    if (!tap || tap.id !== event.pointerId) return;
    smartSuggest.reopenTap = null;
    if (event.type === "pointerup" && event.target === screen && Math.hypot(event.clientX - tap.x, event.clientY - tap.y) <= 6) reopenAssistAtPoint(clientPoint(event));
  }
  function assistScreenBox(box) {
    return box ? { x:box.x * state.scale + state.panX, y:box.y * state.scale + state.panY, w:box.w * state.scale, h:box.h * state.scale } : null;
  }
  let assistPlacementMask = null;
  function assistContentMask(width, height) {
    const chrome = [document.querySelector(".topbar"), document.querySelector(".primary-tools"),
      ...document.querySelectorAll(".widget-object-toolbar, .canvas-agent-panel:not([hidden]), #assistAgentMini:not([hidden])")]
        .filter(Boolean).map(canvasElementLayoutRect).filter(box => box?.width && box.height),
      region = viewportRect(), objects = [
      ...visibleWidgets(region).map(widgetBox),
      ...visibleImages(region).map(imageBox),
      ...visibleTextBoxes(region).map(textBoxBox),
      ...visibleAnimations(region).map(animationBox),
      assistPendingBox(),
      state.selection?.phase === "active" ? state.selection.box : null,
    ].filter(Boolean).map(assistScreenBox).concat(chrome.map(box => ({ x:box.left, y:box.top, w:box.width, h:box.height }))),
      key = JSON.stringify([canvasDocumentsCurrent().id, state.userRevision, tiles.size, width, height, state.scale, state.panX, state.panY, objects]),
      history = state.history.at(-1);
    if (assistPlacementMask?.key === key && assistPlacementMask.history === history) return assistPlacementMask;
    // Use all rendered raster ink, not the bounded recent/dirty stroke log.
    // One screen-resolution capture and summed-area table are reused across
    // stationary frames. Navigation postpones this work until the view settles.
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(width); canvas.height = Math.ceil(height);
    const context = canvas.getContext("2d", { willReadFrequently:true });
    if (region) forTiles(region.x, region.y, region.w, region.h, (tile, tx, ty) => {
      context.drawImage(tile, tx * TILE * state.scale + state.panX, ty * TILE * state.scale + state.panY, TILE * state.scale, TILE * state.scale);
    }, false);
    context.fillStyle = "#000";
    for (const box of objects) context.fillRect(Math.floor(box.x), Math.floor(box.y), Math.ceil(box.x + box.w) - Math.floor(box.x), Math.ceil(box.y + box.h) - Math.floor(box.y));
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data,
      stride = canvas.width + 1, sums = new Uint32Array(stride * (canvas.height + 1));
    for (let y = 0; y < canvas.height; y++) {
      let row = 0;
      for (let x = 0; x < canvas.width; x++) {
        row += pixels[(y * canvas.width + x) * 4 + 3] > 0 ? 1 : 0;
        sums[(y + 1) * stride + x + 1] = sums[y * stride + x + 1] + row;
      }
    }
    // Only full-width top chrome raises the placement floor. A docked Agent
    // starts at the top too, but reserves its own rectangle rather than the
    // entire viewport height.
    return assistPlacementMask = { key, history, width:canvas.width, height:canvas.height, stride, sums,
      minY:chrome.filter(box => box.top <= 8 && box.left <= 8 && box.right >= width - 8)
        .reduce((min, box) => Math.max(min, Math.ceil(box.top + box.height) + 8), 8) };
  }
  function assistOccupiedArea(mask, x, y, w, h) {
    const left = Math.max(0, Math.floor(x)), top = Math.max(0, Math.floor(y)),
      right = Math.min(mask.width, Math.ceil(x + w)), bottom = Math.min(mask.height, Math.ceil(y + h)),
      { sums, stride } = mask;
    if (right <= left || bottom <= top) return 0;
    return sums[bottom * stride + right] - sums[top * stride + right] - sums[bottom * stride + left] + sums[top * stride + left];
  }
  function assistFindPlacement(mask, w, h, preferred, anchor, options = {}) {
    const minY = mask.minY || 8,
      maxX = Math.max(8, Math.floor(mask.width - w - 8)),
      maxY = Math.max(minY, Math.floor(mask.height - h - 84)),
      origin = { x:Math.max(8, Math.min(maxX, Math.round(preferred.x))), y:Math.max(minY, Math.min(maxY, Math.round(preferred.y))) },
      gap = 8, inkGap = options.inkGap ?? 64,
      nearInk = anchor ? { x:anchor.x - inkGap, y:anchor.y - inkGap, w:anchor.w + inkGap * 2, h:anchor.h + inkGap * 2 } : null;
    const overlayArea = (x, y, width, height) => (options.obstacles || []).reduce((area, box) => area
      + Math.max(0, Math.min(x + width, box.x + box.w) - Math.max(x, box.x))
        * Math.max(0, Math.min(y + height, box.y + box.h) - Math.max(y, box.y)), 0),
      score = (x, y) => [
      assistOccupiedArea(mask, x, y, w, h) + overlayArea(x, y, w, h),
      assistOccupiedArea(mask, x - gap, y - gap, w + gap * 2, h + gap * 2) + overlayArea(x - gap, y - gap, w + gap * 2, h + gap * 2),
      nearInk ? Math.max(0, Math.min(x + w, nearInk.x + nearInk.w) - Math.max(x, nearInk.x))
        * Math.max(0, Math.min(y + h, nearInk.y + nearInk.h) - Math.max(y, nearInk.y)) : 0,
      (x - origin.x) ** 2 + (y - origin.y) ** 2,
    ];
    const writingPenalty = (x, y) => anchor ? Math.max(0, inkGap - Math.max(
      anchor.x - x - w, x - anchor.x - anchor.w, anchor.y - y - h, y - anchor.y - anchor.h, 0)) : 0,
      ordered = (costs, x, y) => options.prioritizeInkGap ? [writingPenalty(x, y), costs[2], costs[0], costs[1], costs[3]] : costs,
      idealScore = costs => costs.slice(0, -1).every(cost => !cost);
    let best = origin, bestScore = ordered(score(origin.x, origin.y), origin.x, origin.y);
    if (idealScore(bestScore)) return best;
    // Search every pixel-aligned position. Ink prompts protect the current
    // writing gap first; other surfaces prefer a complete content-free slot.
    // A crowded viewport still gets the least-obstructing visible fallback.
    const { sums, stride } = mask, spanW = Math.ceil(w), spanH = Math.ceil(h),
      rows = Array.from({ length:maxY - minY + 1 }, (_, index) => index + minY).sort((a, b) => Math.abs(a - origin.y) - Math.abs(b - origin.y));
    for (const y of rows) {
      const dy = (y - origin.y) ** 2,
        ideal = idealScore(bestScore), bestDistance = bestScore.at(-1);
      if (ideal && dy > bestDistance) continue;
      const radius = ideal ? Math.ceil(Math.sqrt(bestDistance - dy)) : maxX,
        minX = Math.max(8, origin.x - radius), limitX = Math.min(maxX, origin.x + radius),
        top = y * stride, bottom = Math.min(mask.height, y + spanH) * stride,
        gapTop = Math.max(0, y - gap) * stride, gapBottom = Math.min(mask.height, y + spanH + gap) * stride,
        nearHeight = nearInk ? Math.max(0, Math.min(y + h, nearInk.y + nearInk.h) - Math.max(y, nearInk.y)) : 0;
      for (let x = minX; x <= limitX; x++) {
        const near = nearHeight ? Math.max(0, Math.min(x + w, nearInk.x + nearInk.w) - Math.max(x, nearInk.x)) * nearHeight : 0,
          penalty = options.prioritizeInkGap ? writingPenalty(x, y) : 0;
        if (options.prioritizeInkGap && (penalty > bestScore[0] || penalty === bestScore[0] && near > bestScore[1])) continue;
        const right = Math.min(mask.width, x + spanW),
          overlap = sums[bottom + right] - sums[top + right] - sums[bottom + x] + sums[top + x] + overlayArea(x, y, w, h);
        if (!options.prioritizeInkGap && overlap > bestScore[0]) continue;
        const leftGap = Math.max(0, x - gap), rightGap = Math.min(mask.width, right + gap),
          clearance = sums[gapBottom + rightGap] - sums[gapTop + rightGap] - sums[gapBottom + leftGap] + sums[gapTop + leftGap]
            + overlayArea(x - gap, y - gap, w + gap * 2, h + gap * 2);
        if (!options.prioritizeInkGap && overlap === bestScore[0] && clearance > bestScore[1]) continue;
        const distance = (x - origin.x) ** 2 + dy;
        const costs = ordered([overlap, clearance, near, distance], x, y);
        for (let index = 0; index < costs.length; index++) {
          if (costs[index] === bestScore[index]) continue;
          if (costs[index] < bestScore[index]) { best = { x, y }; bestScore = costs; }
          break;
        }
      }
    }
    return best;
  }
  function positionAssist() {
    const bar = smartSuggest.bar;
    if (!bar) return;
    // Suggest clicks hide their bar; Auto AI and ordinary Agent requests keep it.
    // Draft approval remains usable while Canvas AI waits for Keep or Reject.
    const hidden = assistRequestsHideBar() && bar.mode !== "result";
    bar.element.classList.toggle("is-request-hidden", hidden);
    bar.element.inert = hidden;
    if (hidden) { bar.hovered = false; return; }
    // Rendering a late request/result must not reveal help under a moving pen.
    if (assistSyncWriting(bar)) return;
    fitAssistSuggestions(bar);
    const { width, height } = canvasViewportMetrics(), element = bar.element,
      w = element.offsetWidth || 320, h = element.offsetHeight || 40, screen = assistScreenBox(bar.box), inkGap = ASSIST_INK_CLEARANCE_PX,
      docked = ["tools", "tool"].includes(bar.mode) && assistToolsButton && !assistToolsButton.hidden,
      toolbarRect = docked ? pageLayoutRect(assistToolsButton) : null,
      viewRect = docked ? pageLayoutRect(smartSuggestLayer) : null;
    let x, y;
    if (toolbarRect?.width && viewRect) {
      x = toolbarRect.left - viewRect.left + toolbarRect.width / 2 - w / 2;
      y = toolbarRect.top - viewRect.top - h - 12;
    } else if (!screen || screen.x > width || screen.y > height || screen.x + screen.w < 0 || screen.y + screen.h < 0) {
      // The ink is off-screen: dock the help above the bottom toolbar.
      x = (width - w) / 2;
      y = height - h - 96;
    } else {
      // Start beside the ink's right edge to leave the next line's writing area clear.
      x = screen.x + screen.w;
      y = screen.y + screen.h + inkGap;
      if (y + h > height - 84) y = screen.y - h - inkGap;
      if (y < 8) y = Math.min(height - h - 84, screen.y + screen.h + inkGap);
    }
    x = Math.max(8, Math.min(width - w - 8, x));
    y = Math.max(8, Math.min(height - h - 8, y));
    if (!docked && bar.mode !== "hold") {
      const now = performance.now(), navigation = bar.navigation, previous = bar.placement,
        changed = navigation && (navigation.scale !== state.scale || navigation.panX !== state.panX || navigation.panY !== state.panY),
        navigating = Boolean(state.panGesture || state.touchGesture),
        until = changed || navigating ? now + ASSIST_NAVIGATION_SETTLE_MS : navigation?.until || 0;
      bar.navigation = { scale:state.scale, panX:state.panX, panY:state.panY, until };
      if (navigating || now < until) {
        // Keep the existing clear position attached to its world point. Do not
        // read pixels, allocate an occupancy table or search on a moving frame.
        // Wheel/trackpad navigation also uses this path without a pan gesture.
        if (previous && screen && screen.x <= width && screen.y <= height && screen.x + screen.w >= 0 && screen.y + screen.h >= 0) {
          x = Math.max(8, Math.min(width - w - 8, (previous.x - previous.panX) * state.scale / previous.scale + state.panX));
          y = Math.max(8, Math.min(height - h - 84, (previous.y - previous.panY) * state.scale / previous.scale + state.panY));
        }
      } else {
        const mask = assistContentMask(width, height),
          anchorKey = JSON.stringify([bar.box, width, height, state.scale, state.panX, state.panY]);
        if (previous?.mask === mask && previous.w === w && previous.h === h && previous.anchorKey === anchorKey) ({ x, y } = previous);
        else {
          const preferred = previous?.anchorKey === anchorKey ? previous : { x, y };
          ({ x, y } = assistFindPlacement(mask, w, h, preferred, screen,
            { inkGap, prioritizeInkGap:bar.mode === "suggest" && !bar.target?.selection }));
          bar.placement = { x, y, w, h, mask, anchorKey, scale:state.scale, panX:state.panX, panY:state.panY };
        }
      }
    }
    const style = runtimeElementStyle(element, "assist-bar");
    const roundedX = Math.round(x), roundedY = Math.round(y);
    if (bar.screenX !== roundedX) { style?.setProperty("--assist-x", `${roundedX}px`); bar.screenX = roundedX; }
    if (bar.screenY !== roundedY) { style?.setProperty("--assist-y", `${roundedY}px`); bar.screenY = roundedY; }
    // Reposition against the completed stroke before becoming visible again.
    assistSyncWriting(bar);
    if (bar.target?.selection && bar.menu) {
      const menu = element.querySelector(".assist-menu"), wrap = menu?.parentElement;
      if (menu && wrap) {
        const menuStyle = runtimeElementStyle(menu, "selection-assist-menu"),
          left = x + wrap.offsetLeft + wrap.offsetWidth - menu.offsetWidth,
          desired = Math.max(8, Math.min(width - menu.offsetWidth - 8, left)),
          above = y + wrap.offsetTop + wrap.offsetHeight + menu.offsetHeight + 8 > height;
        menuStyle?.setProperty("transform", `translateX(${desired - left}px)`);
        menuStyle?.setProperty("top", above ? "auto" : "calc(100% + 8px)");
        menuStyle?.setProperty("bottom", above ? "calc(100% + 8px)" : "auto");
      }
    }
  }
  // Keep the ranked actions and dismissal on one row. Overflow retains the
  // same action buttons and execution targets in More, in their ranked order.
  function fitAssistSuggestions(bar) {
    const layout = bar.suggestionLayout;
    if (bar.mode !== "suggest" || !layout) return;
    const { element } = bar, { buttons, ask, more, close } = layout,
      spark = element.querySelector(".assist-spark"),
      width = Math.min(640, Math.max(0, canvasViewportMetrics().width - 16)),
      fixed = [spark, ask, more, close].map(control => control?.offsetWidth || 0),
      key = [width, ...fixed].join(":");
    if (layout.key === key) return;
    if (!layout.widths) {
      layout.widths = buttons.map(button => button.getBoundingClientRect().width);
      const style = getComputedStyle(element);
      layout.inset = [style.paddingLeft, style.paddingRight, style.borderLeftWidth, style.borderRightWidth]
        .reduce((total, value) => total + (parseFloat(value) || 0), 0);
      layout.gap = parseFloat(style.columnGap) || 0;
    }
    const available = width - layout.inset, fixedWidth = fixed.reduce((sum, value) => sum + value, 0),
      minimum = ask.querySelector("input") ? 0 : Math.min(1, buttons.length);
    let count = buttons.length;
    while (count > minimum && fixedWidth + layout.widths.slice(0, count).reduce((sum, value) => sum + value, 0)
      + layout.gap * (count + 3) > available) count--;
    const menu = more.querySelector(".assist-menu");
    for (let index = count - 1; index >= 0; index--) {
      if (buttons[index].parentElement !== element) element.insertBefore(buttons[index], buttons[index + 1]?.parentElement === element ? buttons[index + 1] : ask);
    }
    for (let index = buttons.length - 1; index >= count; index--) {
      if (buttons[index].parentElement !== menu) menu.prepend(buttons[index]);
    }
    runtimeElementStyle(element, "assist-bar")?.setProperty("--assist-action-max-width", `${Math.max(40, available - fixedWidth - layout.gap * (count + 3))}px`);
    layout.key = key;
  }
  // AI results wait as a draft (ink/text) or as a pending Widget (graphs, prototypes).
  function assistAcceptResult() {
    if (state.pendingWidget) acceptPendingWidget();
    else if (state.pending) acceptPending();
  }
  function assistRejectResult() {
    if (state.pendingWidget) rejectPendingWidget();
    else if (state.pending) rejectPending();
  }
  function assistPendingBox() {
    const widget = state.pendingWidget;
    if (widget && [widget.x, widget.y, widget.w, widget.h].every(Number.isFinite)) return { x:widget.x, y:widget.y, w:widget.w, h:widget.h };
    const pending = state.pending;
    if (!pending) return null;
    try { return pending.items ? batchBounds(pending) : draftBounds(pending); } catch { return null; }
  }
  function assistUnion(a, b) {
    if (!a) return b;
    if (!b) return a;
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    return { x, y, w:Math.max(a.x + a.w, b.x + b.w) - x, h:Math.max(a.y + a.h, b.y + b.h) - y };
  }
  function assistFollowUpTarget(previous, fallbackBox, accept = false) {
    const box = assistUnion(previous?.box, previous?.resultBox) || fallbackBox;
    return { box, newBox:box, strokes:[], followUp:true, accept, previous };
  }
  function assistRequestOptions(target) {
    return {
      onResultCommitted:box => { target.resultBox = assistUnion(target.resultBox, box); },
    };
  }
  function assistFinishDrawingInk(target) {
    // A masked or moved selection may contain only part of a stroke. Its raster
    // is authoritative; the recent vector cache must not unmask excluded ink.
    if (!target || target.selection || target.widget) return null;
    const records = [...new Set([...(smartSuggest.strokes || []), ...(target.strokes || [])])]
      .filter(record => state.history.includes(record.historyEntry));
    return PenEchoFinishDrawing.sourceInk(records, target.box);
  }
  function assistSketchInk(target) {
    // Animate sketch rigs the user's actual strokes. A moved or region-only
    // lasso has no reliable vector source; the caller then uses the Agent.
    if (!target || target.widget || target.followUp) return null;
    let records = [...new Set([...(smartSuggest.strokes || []), ...(target.strokes || [])])]
        .filter(record => state.history.includes(record.historyEntry)),
      scope = target.box;
    const selection = target.selection;
    if (selection) {
      const original = selection.originalBox || selection.box, box = selection.box;
      if (selection.regionOnly || !original || !box || ["x", "y", "w", "h"].some(key => Math.abs(original[key] - box[key]) > 0.5)) return null;
      const path = selection.originalPath || selectionPathFor(selection);
      records = records.filter(record => record.points.every(point => SELECT.pointInPolygon(point, path)));
      scope = box;
    }
    return PenEchoSketchPuppet.sketchInk(records, scope);
  }
  function assistTrackAIResult(run, box, suggestion) {
    if (!smartSuggest.enabled || !smartSuggestActive() || run.isolatedSelection || run.onResultCommitted || !box) return;
    smartSuggestSyncDocument();
    const target = { box:{ ...box }, newBox:{ ...box }, strokes:[] }, id = suggestion || run.action;
    target.requestPromise = new Promise(resolve => { run.resolveAssistResult = resolve; });
    run.onResultCommitted = assistRequestOptions(target).onResultCommitted;
    renderAssist({ mode:"working", box, target, action:{ id }, label:SMART_SUGGEST.label(SMART_SUGGEST.actionById(id), state.language, { illustrationStyle:state.illustrationStyle }) || t("assistAsking") });
  }
  function trackAssist() {
    cancelAnimationFrame(smartSuggest.frame);
    const step = () => {
      const bar = smartSuggest.bar;
      if (!bar) return;
      const now = performance.now();
      if (["result", "followup"].includes(bar.mode)) {
        const result = smartSuggestResultCluster();
        if (result && result.key !== bar.cluster?.key) { assistRefresh("result-changed"); scheduleSmartSuggest(); return; }
        if (!result && bar.mode === "followup") { hideAssist("result-changed"); scheduleAssist(); return; }
      }
      if (["suggest", "followup"].includes(bar.mode)) {
        if (!smartSuggestActive()) { hideAssist("inactive"); return; }
        // A suggestion can supersede an in-flight Canvas request. Drafts still
        // need their explicit Keep/Retry interaction.
        const blocked = Boolean(state.viewMode || state.pending || state.pendingWidget);
        if (bar.blocked !== blocked) {
          bar.blocked = blocked;
          for (const control of bar.element.querySelectorAll("button:not(.assist-close), input")) control.disabled = blocked;
        }
      }
      if (bar.mode === "suggest") {
        if (bar.target?.selection && !assistSelectionTargetValid(bar.target)) { hideAssist("selection-changed"); return; }
        if (bar.target?.strokes?.some(stroke => !state.history.includes(stroke.historyEntry))) { hideAssist("ink-changed"); return; }
      } else if (bar.mode === "working") {
        const busy = state.activeAI || aiPreparation || state.selection?.aiRequest || (typeof assistAgent!=="undefined" && (assistAgent.routeController || assistAgent.preparing));
        if (state.pending || state.pendingWidget) {
          const box = assistUnion(bar.target?.box, assistPendingBox());
          renderAssist({ mode:"result", box, target:bar.target, action:bar.action });
          return;
        }
        if (busy) bar.idleSince = 0;
        else if (!bar.idleSince) bar.idleSince = now;
        else if (now - bar.idleSince > 450) {
          if (/error|fail|timeout|rejected|novisible|cancel/i.test(String(state.statusKey || ""))) { hideAssist("failed"); if (bar.target?.selection) assistRefresh("selection-failed"); }
          else if (bar.target?.selection) { hideAssist("selection-finished"); assistRefresh("selection-finished"); }
          else if (bar.target?.resultBox) renderAssist({ mode:"followup", box:bar.target.box, target:bar.target, action:bar.action });
          else hideAssist("no-result");
          return;
        }
      } else if (bar.mode === "result") {
        if (!state.pending && !state.pendingWidget && !state.activeAI && !aiPreparation) {
          if (state.statusKey === "draftRejected") { hideAssist("rejected"); assistRefresh("after-reject"); }
          else if (bar.target?.selection) hideAssist("selection-finished");
          else if (bar.target?.resultBox) renderAssist({ mode:"followup", box:bar.target.box, target:bar.target, action:bar.action });
          else hideAssist("no-result");
          return;
        }
      } else if (bar.mode === "tool" && (!smartSuggest.shapeTool || state.mode !== "pen")) {
        stopAssistShapeTool();
        return;
      }
      positionAssist();
      smartSuggest.frame = requestAnimationFrame(step);
    };
    smartSuggest.frame = requestAnimationFrame(step);
  }

  // ---------- Executors ----------
  function assistEraseDeletionMask(mask) {
    const { width, height, region } = mask, image = offscreen(width, height), context = image.getContext("2d"), pixels = context.createImageData(width, height);
    for (let index = 0; index < mask.data.length; index++) if (mask.data[index]) pixels.data[index * 4 + 3] = 255;
    context.putImageData(pixels, 0, 0);
    eraseWithMask(image, region.x, region.y, region.w, region.h);
    forTiles(region.x, region.y, region.w, region.h, (_canvas, tx, ty) => {
      const k = key(tx, ty), current = state.dirtyInkTiles.get(k);
      const clear = canvas => {
        if (typeof invalidateDirtyHistoryMask === "function") invalidateDirtyHistoryMask(canvas);
        const target = canvas.getContext("2d");
        target.save();
        target.globalCompositeOperation = "destination-out";
        target.drawImage(image, (region.x - tx * TILE) * DIRTY_MASK_SCALE, (region.y - ty * TILE) * DIRTY_MASK_SCALE, region.w * DIRTY_MASK_SCALE, region.h * DIRTY_MASK_SCALE);
        target.restore();
      };
      if (current) { clear(current); state.dirtyInkBounds.delete(k); }
      for (const snapshot of dirtyInputSnapshots) {
        const later = snapshot.laterInk.get(k);
        if (later) clear(later);
      }
    }, false);
  }
  function executeAssistInkDeletion(deletion, widget = null) {
    const marks = deletion.marks || [], candidates = [deletion, ...marks.map(record => record.deletionGesture).filter(Boolean)],
      ids = new Set(candidates.flatMap(candidate => candidate.strokeIds || [])), masks = [...new Set(candidates.flatMap(candidate => [candidate.mask, ...candidate.masks || []].filter(Boolean)))],
      crossed = smartSuggest.strokes.filter(record => ids.has(record.id));
    if (!marks.length || crossed.length !== ids.size || [...marks, ...crossed].some(record => !state.history.includes(record.historyEntry))) { hideAssist("ink-changed"); return false; }
    if (!crossed.length && !masks.length && !widget) return false;
    if (widget && (widget.pending || !state.widgets.includes(widget))) return false;
    if (masks.some(mask => !Number.isInteger(mask.width) || !Number.isInteger(mask.height) || mask.width <= 0 || mask.height <= 0
      || mask.width * mask.height > 32768 || mask.data?.length !== mask.width * mask.height
      || !mask.region || ![mask.region.x, mask.region.y, mask.region.w, mask.region.h].every(Number.isFinite) || mask.region.w <= 0 || mask.region.h <= 0)) return false;
    // Confirmed Delete always takes the full connected stroke component,
    // including indirect connections outside the cancellation mark's bounds.
    const connected = window.PENECHO_PEN_INTEL.connectedStrokes([...crossed, ...marks], smartSuggest.strokes.filter(record => state.history.includes(record.historyEntry))),
      erased = [...new Set([...crossed, ...marks, ...connected])];
    clearTimeout(state.timer); state.timer = 0;
    cancelPenRasterDeletion();
    clearPenGesture("local-delete");
    dismissPenGestureOffer("accepted", false);
    cancelSmartSuggest("local-delete");
    save();
    for (const mask of masks) assistEraseDeletionMask(mask);
    for (const record of erased) {
      const size = record.size + 3 / Math.max(0.03, state.scale);
      for (let index = 1; index < record.points.length; index++) stroke(record.points[index - 1], record.points[index], true, size, true);
      if (record.points.length === 1) dot(record.points[0], true, size, true);
    }
    const erasedIds = new Set(erased.map(record => record.id));
    smartSuggest.strokes = smartSuggest.strokes.filter(record => !erasedIds.has(record.id));
    smartSuggest.jev = null; smartSuggest.lastKey = ""; smartSuggest.analysisKey = ""; smartSuggest.analysis = null;
    if (!smartSuggest.strokes.length) { smartSuggest.writingMs = 0; smartSuggest.localReadyAt = 0; smartSuggest.inkReadyAt = 0; }
    recomputeDirtyBounds();
    filterErasedDirtyHotspots();
    // Widget removal records its source and the erased marks in this same step.
    if (widget) deleteWidget(widget);
    else { state.userRevision++; saveUserCanvasChange(); }
    requestCommittedInkRender();
    requestRender();
    smartSuggestRecent("accepted delete");
    if (!widget) setStatus(suggestionCopy("Deleted crossed-out strokes.", "已删除划掉的笔迹。"));
    scheduleAssist();
    return true;
  }
  function executeAssistDeletion(target) {
    if (target.strokes?.some(record => !state.history.includes(record.historyEntry))) { hideAssist("ink-changed"); return false; }
    const deletion = target.deletion || assistDeletionDetails(target);
    if (!deletion) return false;
    const marks = deletion.marks || [], markBox = deletion.markBox || target.newBox || target.box,
      candidates = [deletion, ...marks.map(record => record.deletionGesture).filter(Boolean)];
    if (candidates.some(candidate => candidate.strokeIds?.length || candidate.mask || candidate.masks?.length)) return executeAssistInkDeletion(deletion);
    // A confirmed object cancellation removes the Widget itself locally.
    // Never send its source to an AI or guess at content inside the Widget.
    const widgets = (state.widgets || []).filter(widget => intersection(widgetBox(widget), markBox));
    if (widgets.length > 1) { setStatus(suggestionCopy("Cross out one widget at a time.", "请一次划掉一个 Widget。")); return false; }
    if (!widgets.length) { setStatus(suggestionCopy("No crossed-out strokes were identified.", "未识别到被划掉的笔迹。")); return false; }
    return executeAssistInkDeletion(deletion, widgets[0]);
  }
  function assistSelectionTargetValid(target) {
    return Boolean(target?.selection && state.selection === target.selection && state.selection.phase === "active"
      && !state.selectionGesture && target.selectionKey === `selection:${smartSuggest.selectionVersion}`);
  }
  async function executeAssistAction(item, target) {
    const id = item?.id, action = SMART_SUGGEST?.actionById(id);
    if (!target) return;
    if (target.selection && !assistSelectionTargetValid(target)) { hideAssist("selection-changed"); return; }
    if (target.accept) {
      const documentId = canvasDocumentsCurrent().id;
      const routing = target.routing;
      assistAcceptResult();
      // Let the accepted request consume its input before the next one starts.
      await target.previous?.requestPromise;
      if (canvasDocumentsCurrent().id !== documentId || !target.previous?.resultBox) return;
      target = assistFollowUpTarget(target.previous, target.box);
      target.routing = routing;
    }
    if (!action) return;
    if (typeof assistLearnInstantTap === "function") assistLearnInstantTap(id, target);
    if (id === "refine") { executeAssistWidgetRefinement(target.widgetRefine); return; }
    if (action.exec.type === "note") {
      if (typeof organizeSuggestAsNote !== "function") return;
      smartSuggest.cooldown[id] = 0;
      void organizeSuggestAsNote(target);
      return;
    }
    if (id === "answer" && !target.followUp) {
      invokeAIAction("auto", { fromSuggestBar:true });
      return;
    }
    clearTimeout(state.timer);
    state.timer = 0;
    cancelWidgetRefinement?.("smart-suggestion");
    supersedeActiveAI("smart-suggestion");
    if (typeof clearPenGesture === "function") clearPenGesture("smart-suggestion");
    const execution=SMART_SUGGEST.suggestionExecution(id,target.routing),
      sketchInk=id === "animate_sketch" ? assistSketchInk(target) : null;
    if (SMART_SUGGEST.executionRoute(id,execution) === "penecho_agent" || id === "animate_sketch" && !sketchInk) {
      const routed=await assistAgentRun(id,target,{label:SMART_SUGGEST.label(action,state.language,{ illustrationStyle:state.illustrationStyle }),fromSuggestBar:true});
      if(routed === "submitted") {
        smartSuggestRecent(`accepted ${id}`);return;
      }
      if(routed === "blocked")return;
    }
    if (!["typeset", "ai", "animate"].includes(action.exec.type) && target.strokes?.length) smartSuggest.consumedStrokeId = Math.max(smartSuggest.consumedStrokeId, target.strokes.at(-1).id);
    smartSuggest.cooldown[id] = 0;
    smartSuggestRecent(`accepted ${id}`);
    debug("assist-accepted", { id, followUp:Boolean(target.followUp) });
    const label = SMART_SUGGEST.label(action, state.language, { illustrationStyle:state.illustrationStyle }), workingModel = { mode:"working", label, box:target.box, target, action:{ id } };
    if (target.selection) {
      if (!["typeset", "ai", "animate"].includes(action.exec.type)) return;
      const packed = buildSelectionImage(target.selection);
      if (!packed) return;
      renderAssist(workingModel);
      requestSelectionAI(action.exec.type === "typeset" ? "normalize" : action.exec.action, target.selection, packed, {
        fromSuggestBar:true,
        suggestion:action.exec.suggestion,
        ...(sketchInk ? { sketchInk } : {}),
        transformCommands:action.exec.interactivePlot ? commands => smartPlotCommandsToGraph(commands, target.box) : null,
      });
      return;
    }
    if (action.exec.type === "snap") {
      const analysis = smartSuggest.analysis, strokes = target.strokes || [];
      const groups = (analysis?.rough || []).map(fit => ({ ...fit, strokes:fit.strokeIndexes.map(index => strokes[index]).filter(Boolean) }));
      if (applySmartShapeSnap(groups)) {
        for (const group of groups) for (const record of group.strokes) record.exact = true;
        setStatusKey("smartShapesSnapped");
        renderAssist({ mode:"followup", box:target.box, action:{ id } });
      } else hideAssist("snap-empty");
      return;
    }
    if (action.exec.type === "typeset") {
      const pad = 16 / Math.max(0.03, state.scale), b = target.box,
        x0 = Math.max(0, b.x - pad), y0 = Math.max(0, b.y - pad), x1 = Math.min(SIZE, b.x + b.w + pad), y1 = Math.min(SIZE, b.y + b.h + pad);
      if (state.selection) cancelSelection(true);
      captureInkSelection([{ x:x0, y:y0 }, { x:x1, y:y0 }, { x:x1, y:y1 }, { x:x0, y:y1 }, { x:x0, y:y0 + 0.5 }]);
      if (state.selection?.phase === "active") {
        workingModel.target = { ...target, selection:state.selection, selectionKey:`selection:${smartSuggest.selectionVersion}`, box:{ ...state.selection.box } };
        updateSelectionToolbar();
        normalizeSelectionForAI({ fromSuggestBar:true });
        renderAssist(workingModel);
      } else hideAssist("typeset-empty");
      return;
    }
    renderAssist(workingModel);
    target.requestPromise = requestAI(action.exec.action, null, {
      fromSuggestBar:true,
      ...assistRequestOptions(target),
      attentionBox:{ ...(action.exec.focus === "new" && target.newBox ? target.newBox : target.box) },
      focusAttention:true,
      suggestion:action.exec.suggestion,
      ...(id === "finish_drawing" ? { sourceInk:assistFinishDrawingInk(target) } : {}),
      ...(sketchInk ? { sketchInk } : {}),
      transformCommands:action.exec.interactivePlot ? commands => smartPlotCommandsToGraph(commands, target.box) : null,
    });
  }
  // Kept for callers of the first version.
  function executeSmartSuggestion(id) {
    const cluster = smartSuggestCluster();
    if (cluster) executeAssistAction({ id }, { routing:assistView(cluster).routing, deletion:assistDeletionDetails(cluster), widgetRefine:assistWidgetRefineTarget(cluster), noteScope:assistNoteScope(cluster), box:cluster.box, newBox:cluster.newBox, strokes:cluster.strokes, selection:cluster.selection, selectionKey:cluster.selection ? cluster.key : null });
  }
  // A typed question about the ink goes to the model as typed input.
  async function assistAsk(text, target) {
    if (!target?.box) return;
    if(target.selection&&!assistSelectionTargetValid(target))return;
    clearTimeout(state.timer);
    state.timer = 0;
    cancelWidgetRefinement?.("assist-ask");
    supersedeActiveAI("assist-ask");
    if (typeof clearPenGesture === "function") clearPenGesture("assist-ask");
    const documentId=canvasDocumentsCurrent().id,generation=++assistAgent.generation;
    renderAssist({mode:"working",label:t("assistRouting"),box:target.box,target,action:{id:"ask"}});
    const execution=await assistClassifyRequest("ask",target,text);
    if(generation!==assistAgent.generation||!assistAgentTargetCurrent(target,documentId))return;
    if(SMART_SUGGEST.executionRoute("ask",execution)==="penecho_agent") {
      const routed=await assistAgentRun("ask",target,{label:t("assistAsk"),instruction:text,fromSuggestBar:true});
      if(routed==="submitted") return;
      if(routed==="blocked"){hideAssist("agent-blocked");assistRefresh("agent-blocked");return;}
    }
    if (target.selection) {
      if (!assistSelectionTargetValid(target)) { hideAssist("selection-changed"); return; }
      const packed = buildSelectionImage(target.selection);
      if (!packed) return;
      renderAssist({ mode:"working", label:t("assistAsking"), box:target.box, target, action:{ id:"ask" } });
      requestSelectionAI("answer", target.selection, packed, { fromSuggestBar:true, suggestion:"ask", selectionQuestion:text.slice(0, 1800) });
      return;
    }
    const box = { ...target.box };
    smartSuggestRecent("asked");
    const requestTarget = { box, newBox:box, strokes:[] };
    renderAssist({ mode:"working", label:t("assistAsking"), box, target:requestTarget, action:{ id:"ask" } });
    requestTarget.requestPromise = requestAI("answer", null, { ...assistRequestOptions(requestTarget), fromSuggestBar:true, attentionBox:box, focusAttention:true, suggestion:"ask", question:text.slice(0, 1800) });
  }
  // Local graph widgets are inserted directly.
  async function insertAssistWidget(command, options = {}) {
    if (!command || typeof importCommunityWidgetArtifact !== "function") return null;
    const contentW = 900, contentH = Math.max(200, Math.round(900 * command.h / command.w));
    const result = await importCommunityWidgetArtifact({ format:"penecho-widget", formatVersion:1, widget:{
      pluginId:"general", widgetType:"html_widget", title:command.title, html:command.html, refreshSeconds:0, w:command.w, h:command.h, contentW, contentH,
      ...(command.copyText ? { copyText:command.copyText, copyLabel:command.copyLabel } : {}),
    } }, null, { assertCurrent:options.assertCurrent });
    const widget = state.widgets.find(item => item.id === result?.id);
    if (widget && options.place !== "default") {
      widget.x = command.x; widget.y = command.y;
      if (options.place === "exact") { widget.w = command.w; widget.h = command.h; }
      requestRender();
    }
    return widget || null;
  }
  // Instant graph: a live graph widget next to the ink, ready for typing.
  async function insertAssistGraph(target, options = {}) {
    let visible = null;
    try { visible = viewportRect(); } catch {}
    const box = target?.box || (visible ? { x:visible.x + visible.w * 0.3, y:visible.y + visible.h * 0.3, w:visible.w * 0.1, h:visible.h * 0.05 } : null),
      seed = options.surface ? { mode:"3d", expression:"z = a*sin(x)*cos(y)", parameters:{ a:1 } } : { mode:"2d", expression:"y = a*sin(x)", parameters:{ a:1 } },
      spec = SMART_SUGGEST.graphWidgetCommand(seed, { language:state.language, anchor:box, visible, canvasSize:SIZE });
    if (!spec) return;
    await insertAssistWidget(spec, { place:box ? "beside" : "default" });
    setStatusKey("assistGraphInserted");
  }
  // Plot → interactive graph widget with pan, zoom, trace and parameter sliders.
  function smartPlotCommandsToGraph(commands, anchor = null) {
    if (!Array.isArray(commands) || !SMART_SUGGEST) return commands;
    const plots = commands.filter(command => (command?.tool || command?.type || command?.name) === "plot_function");
    if (!plots.length) return commands;
    const merged = { ...plots[0], expressions:plots.map(command => command.expression).filter(Boolean).slice(0, 4), parameters:Object.assign({}, ...plots.map(command => command.parameters || {})) },
      widget = SMART_SUGGEST.graphWidgetCommand(merged, { language:state.language, anchor, visible:(() => { try { return viewportRect(); } catch { return null; } })(), canvasSize:SIZE });
    return widget ? [widget] : commands;
  }
  function liftStrokes(records) {
    if (!records.length) return;
    for (const record of records) {
      const erase = record.size + 3 / Math.max(0.03, state.scale);
      for (let index = 1; index < record.points.length; index++) stroke(record.points[index - 1], record.points[index], true, erase, false);
      if (record.points.length === 1) dot(record.points[0], true, erase, false);
    }
    state.userRevision++;
    saveUserCanvasChange();
    requestCommittedInkRender();
    requestRender();
  }
  // Replace rough strokes with exact shapes in the same ink colour and width.
  // This is one undoable canvas change.
  function applySmartShapeSnap(groups) {
    const usable = (groups || []).filter(group => group?.outline?.length >= 2 && group.strokes?.length);
    if (!usable.length) return false;
    for (const group of usable) {
      for (const record of group.strokes) {
        const erase = record.size + 3 / Math.max(0.03, state.scale);
        for (let index = 1; index < record.points.length; index++) stroke(record.points[index - 1], record.points[index], true, erase, true);
        if (record.points.length === 1) dot(record.points[0], true, erase, true);
        record.inputConsumed=true;
      }
    }
    for (const group of usable) {
      const record = group.strokes[0], size = record.size, color = record.color || state.inkColor;
      for (let index = 1; index < group.outline.length; index++) stroke(group.outline[index - 1], group.outline[index], false, size, false, color);
      if (group.head) for (let index = 1; index < group.head.length; index++) stroke(group.head[index - 1], group.head[index], false, size, false, color);
    }
    recomputeDirtyBounds();filterErasedDirtyHotspots();
    state.userRevision++;
    saveUserCanvasChange();
    requestCommittedInkRender();
    requestRender();
    return true;
  }
  // ---------- Shape tools ----------
  function startAssistShapeTool(kind) {
    if (!SMART_SUGGEST?.SHAPE_TOOLS.includes(kind)) return;
    if (state.mode !== "pen") setCanvasMode("pen");
    smartSuggest.shapeTool = { kind };
    assistToolsButton?.classList.add("active");
    assistToolsButton?.setAttribute("aria-pressed", "true");
    const bar = smartSuggest.bar;
    if (bar) { smartSuggest.bar = null; bar.element.remove(); cancelAnimationFrame(smartSuggest.frame); }
    renderAssist({ mode:"tool", kind, box:bar?.box || null });
  }
  function stopAssistShapeTool() {
    const active = Boolean(smartSuggest.shapeTool);
    smartSuggest.shapeTool = null;
    smartSuggest.shapeGesture?.preview?.remove();
    smartSuggest.shapeGesture = null;
    assistToolsButton?.classList.remove("active");
    assistToolsButton?.setAttribute("aria-pressed", "false");
    if (smartSuggest.bar?.mode === "tool") hideAssist("tool-stopped");
    if (active) assistRefresh("tool-stopped");
  }
  function assistShapeOutline(gesture, constrain) {
    const unit = 1 / Math.max(0.03, state.scale);
    return SMART_SUGGEST.shapeToolOutline(gesture.kind, gesture.start, gesture.end, { constrain, minSize:6 * unit, headMin:12 * unit, headMax:40 * unit });
  }
  function assistShapePreview(gesture, constrain) {
    const outline = assistShapeOutline(gesture, constrain) || [];
    const svg = gesture.preview;
    svg.textContent = "";
    for (const line of outline) {
      const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
      polyline.setAttribute("points", line.map(point => `${(point.x * state.scale + state.panX).toFixed(1)},${(point.y * state.scale + state.panY).toFixed(1)}`).join(" "));
      polyline.setAttribute("stroke", state.inkColor);
      polyline.setAttribute("stroke-width", String(Math.max(1.5, state.pen)));
      svg.append(polyline);
    }
  }
  function assistShapePointerDown(event, point) {
    if (!smartSuggest.shapeTool || state.mode !== "pen" || !point || (event.pointerType === "mouse" && event.button !== 0)) return false;
    if (event.pointerType === "touch" && state.touches?.size > 1) return false;
    const preview = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    preview.setAttribute("class", "assist-shape-preview");
    preview.setAttribute("aria-hidden", "true");
    smartSuggestLayer.append(preview);
    smartSuggestLayer.hidden = false;
    smartSuggest.shapeGesture = { id:event.pointerId, kind:smartSuggest.shapeTool.kind, start:{ ...point }, end:{ ...point }, preview };
    supersedeActiveAI("user-input-started");
    clearTimeout(state.timer);
    state.timer = 0;
    try { event.target?.setPointerCapture?.(event.pointerId); } catch {}
    return true;
  }
  function assistShapePointerMove(event) {
    const gesture = smartSuggest.shapeGesture;
    if (!gesture || gesture.id !== event.pointerId) return false;
    gesture.end = clientPoint(event);
    assistShapePreview(gesture, event.shiftKey);
    return true;
  }
  function assistShapePointerUp(event) {
    const gesture = smartSuggest.shapeGesture;
    if (!gesture || gesture.id !== event.pointerId) return false;
    smartSuggest.shapeGesture = null;
    gesture.preview.remove();
    if (event.type === "pointercancel") return true;
    gesture.end = clientPoint(event);
    const outline = assistShapeOutline(gesture, event.shiftKey);
    if (!outline) return true;
    const size = logicalWidth(state.pen), color = state.inkColor;
    for (const line of outline) for (let index = 1; index < line.length; index++) stroke(line[index - 1], line[index], false, size, true, color);
    state.userRevision++;
    state.autoEligible = true;
    saveUserCanvasChange();
    requestCommittedInkRender();
    requestRender();
    // Tool shapes are exact. They still feed diagram/prototype predictions.
    for (const line of outline) {
      const xs = line.map(point => point.x), ys = line.map(point => point.y),
        box = { x:Math.min(...xs), y:Math.min(...ys), w:Math.max(...xs) - Math.min(...xs), h:Math.max(...ys) - Math.min(...ys) };
      smartSuggestRecordStroke({ id:smartSuggest.nextStrokeId++, points:line, size, color, box, at:performance.now(), historyEntry:state.history.at(-1), exact:true });
    }
    smartSuggestRecent(`drew ${gesture.kind}`);
    return true;
  }
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && smartSuggest.shapeTool) stopAssistShapeTool();
    else if (event.key === "Escape" && ["suggest", "followup"].includes(smartSuggest.bar?.mode)
        && !smartSuggest.bar.target?.selection && !/^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName) && !event.target?.isContentEditable) dismissAssist("escape");
  }, true);
  document.addEventListener("pointerdown", beginAssistDismissTap, true);
  document.addEventListener("pointermove", moveAssistDismissTap, true);
  // Bubble after Canvas pointerup so a mouse tap's dot cannot reopen the bar.
  document.addEventListener("pointerup", finishAssistDismissTap);
  document.addEventListener("pointercancel", finishAssistDismissTap, true);
  document.addEventListener("lostpointercapture", finishAssistDismissTap, true);
  document.addEventListener("pointerdown", beginAssistReopenTap, true);
  document.addEventListener("pointermove", moveAssistReopenPointer, true);
  document.addEventListener("pointerup", finishAssistReopenTap);
  document.addEventListener("pointercancel", finishAssistReopenTap, true);
  document.addEventListener("lostpointercapture", finishAssistReopenTap, true);
  assistToolsButton?.addEventListener("click", event => {
    event.stopPropagation();
    if (smartSuggest.bar?.mode === "tools") { hideAssist("tools-closed"); if (smartSuggest.shapeTool) renderAssist({ mode:"tool", kind:smartSuggest.shapeTool.kind }); return; }
    const cluster = smartSuggestCluster();
    renderAssist({ mode:"tools", box:cluster?.box || null, target:cluster ? { box:cluster.box, newBox:cluster.newBox, strokes:cluster.strokes } : null });
  });
  for (const button of document.querySelectorAll("[data-mode]")) button.addEventListener("click", () => { if (smartSuggest.shapeTool) stopAssistShapeTool(); });
  document.addEventListener("pointerdown", event => {
    if (smartSuggest.bar?.mode === "tools" && !smartSuggest.bar.element.contains(event.target) && !assistToolsButton?.contains(event.target)) {
      hideAssist("tools-outside");
      if (smartSuggest.shapeTool) renderAssist({ mode:"tool", kind:smartSuggest.shapeTool.kind });
    }
  });

  if (smartSuggestToggle) smartSuggestToggle.addEventListener("click", () => setSmartSuggestEnabled(!smartSuggest.enabled));
  syncSmartSuggestToggle();
  // Configuration and allowance checks are demand-driven. Nothing schedules a
  // fresh check simply because a previous status response was unavailable.
  let smartSuggestStatusSequence = 0, smartSuggestAccountSequence = 0;
  function invalidateSmartSuggestAvailability() {
    smartSuggestStatusSequence++;
    smartSuggest.availability.controller?.abort();
    clearTimeout(smartSuggest.availability.timeout);
    Object.assign(smartSuggest.availability, { pending:null, controller:null, checkedAt:0, nextAt:0, retryAfterAt:0, failures:0, authRequired:false });
  }
  function suggestionStatusRetryAfter(value, now) {
    if (!value) return 0;
    const seconds = Number(value), until = Number.isFinite(seconds) ? now + Math.max(0, seconds) * 1000 : Date.parse(value);
    return Number.isFinite(until) ? Math.max(now, until) : 0;
  }
  function refreshSmartSuggestAvailability({ force = false, reason = "manual" } = {}) {
    const explicit = force || reason === "manual" || reason === "input" && smartSuggest.enabled, availability = smartSuggest.availability, now = Date.now(),
      retryUnavailable = explicit && !smartSuggest.available;
    if (!SMART_SUGGEST || document.visibilityState === "hidden" || (!smartSuggest.enabled && !explicit && reason !== "init" && reason !== "account" && !(reason === "visible" && !availability.checkedAt))) return Promise.resolve();
    if (availability.pending) return availability.pending;
    // Due input and explicit controls recover cached failures immediately.
    // Concurrent checks coalesce; fresh successes and Retry-After stay shared.
    if (now < availability.retryAfterAt || !retryUnavailable && availability.checkedAt && now < availability.checkedAt + 1000
      || !explicit && (availability.authRequired || now < availability.nextAt)) return Promise.resolve();
    const sequence = ++smartSuggestStatusSequence, controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 7000);
    availability.controller = controller;
    availability.timeout = timeout;
    availability.checkedAt = now;
    const pending = fetch(suggestionApiPath("/status"), { credentials:"same-origin", signal:controller.signal,
      headers:authenticatedApiHeaders({ Accept:"application/json", ...(explicit ? { "X-PenEcho-Suggest-Refresh":"1" } : {}) }) })
      .then(async response => {
        const data = await response.json().catch(() => null);
        if (sequence !== smartSuggestStatusSequence || controller.signal.aborted) return;
        updateSuggestionAccess(data, { status:true });
        if (!response.ok || typeof data?.configured !== "boolean") throw Object.assign(new Error("Suggestion status is unavailable."), {
          status:response.ok ? 502 : response.status,
          retryAfterAt:suggestionStatusRetryAfter(response.headers?.get?.("Retry-After"), Date.now()),
        });
        const recovered = !smartSuggest.available;
        smartSuggest.available = data.configured;
        Object.assign(availability, { failures:0, authRequired:false, retryAfterAt:0, nextAt:Date.now() + (data.configured ? 30000 : 300000) });
        syncSmartSuggestToggle();
        assistRefresh("allowance");
        if (data.configured && recovered) { scheduleAssist(); if (typeof resumeWidgetAssistSuggestions === "function") resumeWidgetAssistSuggestions(); }
      })
      .catch(error => {
        if (sequence !== smartSuggestStatusSequence) return;
        smartSuggest.available = false;
        const status = Number(error?.status) || 0, transient = !status || status === 408 || status === 409 || status === 425 || status === 429 || status >= 500 && status !== 501;
        availability.authRequired = status === 401 || status === 403;
        availability.failures = transient ? availability.failures + 1 : 0;
        availability.retryAfterAt = Number(error?.retryAfterAt) || 0;
        const backoff = transient ? Math.min(60000, Math.max(5000, 5000 * 2 ** Math.min(availability.failures - 1, 4) * (0.8 + Math.random() * 0.4))) : 300000;
        availability.nextAt = Math.max(Date.now() + backoff, availability.retryAfterAt);
        assistRefresh("allowance");
      })
      .finally(() => {
        clearTimeout(timeout);
        if (availability.pending === pending) { availability.pending = null; availability.controller = null; }
      });
    availability.pending = pending;
    return pending;
  }
  void refreshSmartSuggestAvailability({ reason:"init" });
  window.addEventListener("focus", () => void refreshSmartSuggestAvailability({ reason:"focus" }));
  window.addEventListener("online", () => void refreshSmartSuggestAvailability({ reason:"online" }));
  window.addEventListener("penecho:settings-page", event => {
    if (event.detail?.page === "canvas" || event.detail?.page === "cloud") void refreshSmartSuggestAvailability({ force:true, reason:"settings" });
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      // An offscreen timeout must not change this page's cached availability.
      if (smartSuggest.availability.pending) invalidateSmartSuggestAvailability();
      return;
    }
    void refreshSmartSuggestAvailability({ reason:"visible" });
    scheduleAssist();
    if (typeof resumeWidgetAssistSuggestions === "function") resumeWidgetAssistSuggestions();
  });
  const suggestionSpendingControl=document.querySelector("#suggestionSpendingControl");
  suggestionSpendingControl?.addEventListener("change",()=>void setSuggestionSpending(suggestionSpendingControl.querySelector("input[type=checkbox]").checked,Number(suggestionSpendingControl.querySelector("input[type=number]").value)).catch(()=>void refreshSmartSuggestAvailability()));
  window.addEventListener("penecho:cloud-account-changed", event => {
    if (event.detail?.changed === false) return;
    smartSuggestAccountSequence++;
    cancelSmartSuggest("account-changed");
    smartSuggest.sequence++;
    invalidateSmartSuggestAvailability();
    smartSuggest.available = false;
    smartSuggest.access = null;
    if (typeof cancelWidgetAssistSuggestions === "function") cancelWidgetAssistSuggestions();
    void refreshSmartSuggestAvailability({ force:true, reason:"account" });
  });
