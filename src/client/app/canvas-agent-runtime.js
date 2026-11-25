// DeepSeek Harness bridge. The browser remains authoritative for Canvas state.
  // The Agent has no panel. This is its engine: the session with the server, the tools the model calls on the
  // Canvas, and canvasAgentSubmitMessage, which a lasso, a suggestion and Widget Refine use (assist-agent.js).
  // What it is doing is said in "penecho:agent-activity" events (canvasAgentTell).
  //
  // The toolbar group that holds the MCP and Playground buttons keeps its old name. It moves between the toolbar
  // and the Canvas frame as the window narrows (canvasAgentSyncToolbarLayout).
  const canvasAgentControl = document.querySelector("#canvasAgentControl"),
    canvasAgentToolbar = document.querySelector(".toolbar"),
    canvasAgentToolbarHome = document.querySelector("#canvasAgentToolbarHome"),
    canvasAgentFrame = view.closest(".canvas-frame");
  const CANVAS_AGENT_PROTOCOL_VERSION = 1,
    CANVAS_AGENT_CLIENT_KEY = "penecho-canvas-agent-client-v1",
    // Where the panel kept its chats in this browser. They stay there. See canvasAgentReadHistoryStore.
    CANVAS_AGENT_HISTORY_KEY = "penecho-canvas-agent-history-v1",
    CANVAS_AGENT_HISTORY_ITEM_LIMIT = 120,
    CANVAS_AGENT_HISTORY_TEXT_LIMIT = 20000,
    CANVAS_AGENT_CONTINUATION_TEXT_LIMIT = 80000,
    CANVAS_AGENT_ERROR_MESSAGE_LIMIT = 8000,
    CANVAS_AGENT_COMFORT_BODY_PX = 15,
    CANVAS_AGENT_PREFERRED_BODY_MIN_PX = 11,
    CANVAS_AGENT_COMPACT_TEXT_MIN_PX = 8,
    CANVAS_AGENT_AUTO_AI_STATUS_KEYS = new Set(["canvasAgentExternalAIPaused"]),
    CANVAS_AGENT_LAYOUT_CAPTURE_POLICY = Object.freeze({id:"canvas-layout-v1",maxLongEdge:1024,maxPixels:520000,quality:.72,maxBytes:700*1024}),
    CANVAS_AGENT_DETAIL_CAPTURE_POLICY = Object.freeze({id:"canvas-detail-v1",maxLongEdge:1440,maxPixels:1800000,quality:.88,maxBytes:1200*1024});
  const canvasAgent = {
    socket:null,
    socketCloudCanvasId:"",
    connectPromise:null,
    connectResolve:null,
    connectReject:null,
    sessionId:"",
    resumeToken:"",
    connectionId:"",
    sessionEngine:"",
    sessionModel:"",
    sessionChannel:"",
    sessionReady:false,
    pendingHandshakeId:"",
    pendingProvider:"",
    pendingConnectionChange:null,
    pendingContextChange:null,
    clientId:sessionStorage.getItem(CANVAS_AGENT_CLIENT_KEY) || canvasClientId(),
    outgoingSeq:0,
    incomingSeq:0,
    running:false,
    statusText:"",
    statusKind:"",
    requestPending:false,
    lastTurnError:null,
    automaticAIStatusRestore:null,
    assistantRows:new Map(),
    toolRows:new Map(),
    toolResultCache:new Map(),
    toolControllers:new Map(),
    activeToolExecution:null,
    activeSubmitExecution:null,
    sessionGeneration:0,
    // Web search has no switch of its own: it is on whenever it is set up in Settings.
    searchConfigured:Boolean(window.PENECHO_CONFIG?.canvasAgentSearchConfigured),
    searchEnabled:Boolean(window.PENECHO_CONFIG?.canvasAgentSearchConfigured),
    sessionSearchConfigured:false,
    sessionSearchEnabled:false,
    currentConversation:null,
    pendingConversationHistory:[],
    viewRevision:0,
    viewSignature:"",
    latestChange:null,
  };
  sessionStorage.setItem(CANVAS_AGENT_CLIENT_KEY,canvasAgent.clientId);

  function canvasAgentExecutionAvailable() {
    const runtime = window.PENECHO_CONFIG?.runtime;
    return runtime !== "viewer" && (window.PENECHO_CONFIG?.canvasAgent !== false || window.PENECHO_CONFIG?.hostedCanvasAgent === true && canvasAgentUsesCloudHost());
  }
  function canvasAgentCloudSavedCanvasId() {
    const id=String(state.currentSnapshotId||"");
    return window.PENECHO_CONFIG?.runtime === "cloud" && state.currentSnapshotLocation === "cloud"
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ? id : "";
  }
  function canvasAgentCloudCanvasId() {
    if (window.PENECHO_CONFIG?.runtime !== "cloud") return "";
    const saved = canvasAgentCloudSavedCanvasId();
    if (saved) return saved;
    const document = canvasDocumentsCurrent();
    return document.cloudDraftExecutionId ||= crypto.randomUUID();
  }
  function canvasAgentCloudExecutionScope() {
    return { canvasId:canvasAgentCloudCanvasId(), draft:!canvasAgentCloudSavedCanvasId() };
  }
  function canvasAgentReconcileCloudCanvas() {
    if (!canvasAgent.socketCloudCanvasId || canvasAgent.socketCloudCanvasId === canvasAgentCloudCanvasId()) return;
    const socket=canvasAgent.socket;
    // Detach before close: late frames and close handlers belong to the old Canvas.
    canvasAgent.socket=null;
    canvasAgent.socketCloudCanvasId="";
    canvasAgentInvalidateSubmitExecution(Object.assign(Error("PenEcho Agent Canvas changed."),{code:"SESSION_CHANGED"}));
    canvasAgentDropSessionIdentity();
    canvasAgent.requestPending=false;
    canvasAgentSetRunning(false);
    if (typeof assistRequestFinished === "function") assistRequestFinished(canvasAgent, "superseded");
    try { socket?.close(1000,"PenEcho Agent Canvas changed"); } catch {}
  }
  function canvasAgentUsesCloudHost(connectionId = null) {
    return window.PENECHO_CONFIG?.runtime === "cloud" && window.PENECHO_CONFIG?.hostedCanvasAgent === true
      && /^hosted:[0-9a-f-]{36}$/i.test(connectionId ?? selectedAiConnectionId());
  }
  function canvasAgentSuppressesAutomaticAI() {
    return typeof canvasDocumentsExternal==="function"&&canvasDocumentsExternal();
  }
  function canvasAgentAutomaticAIStatusKey() {
    if (!state.auto) return null;
    return typeof canvasDocumentsExternal==="function"&&canvasDocumentsExternal() ? "canvasAgentExternalAIPaused" : null;
  }
  function canvasAgentSyncAutomaticAIStatus() {
    const nextKey = canvasAgentAutomaticAIStatusKey();
    const notice = document.querySelector("#canvasAutoPausedNotice");
    notice.hidden = !nextKey;
    document.body.classList.toggle("canvas-auto-paused", Boolean(nextKey));
    notice.querySelector("span").textContent = nextKey ? t(nextKey) : "";
    if (nextKey) {
      if (!canvasAgent.automaticAIStatusRestore) canvasAgent.automaticAIStatusRestore = { key:state.statusKey, text:status.textContent };
      if (state.statusKey !== nextKey) setStatusKey(nextKey);
      return;
    }
    const previous = canvasAgent.automaticAIStatusRestore;
    canvasAgent.automaticAIStatusRestore = null;
    if (!previous || !CANVAS_AGENT_AUTO_AI_STATUS_KEYS.has(state.statusKey)) return;
    if (previous.key) setStatusKey(previous.key);
    else setStatus(previous.text || t("ready"));
  }
  function canvasAgentPauseAutomaticAI() {
    clearTimeout(state.timer);
    state.timer = 0;
    canvasAgentSyncAutomaticAIStatus();
  }
  function canvasAgentResumeAutomaticAI() {
    if (!canvasAgentSuppressesAutomaticAI() && !state.timer) schedule();
    canvasAgentSyncAutomaticAIStatus();
  }
  function canvasAgentBeginRequest(options = null) {
    canvasAgent.requestPending = true;
    if (typeof assistRequestStarted === "function") assistRequestStarted(canvasAgent, { hideSuggestions:Boolean(options?.fromSuggestBar) });
    canvasAgentPauseAutomaticAI();
    canvasAgentSyncAutomaticAIStatus();
  }
  function canvasAgentRequestDidNotSend() {
    canvasAgent.requestPending = false;
    if (!canvasAgent.running && typeof assistRequestFinished === "function") assistRequestFinished(canvasAgent, "failed");
    canvasAgentResumeAutomaticAI();
  }
  function canvasAgentSendRequest(type,payload) {
    if (!canvasAgent.requestPending) canvasAgentBeginRequest();
    try { canvasAgentSendEnvelope(type,payload); }
    catch (error) {
      canvasAgentRequestDidNotSend();
      throw error;
    }
  }
  function canvasAgentSetSearchConfigured(configured) {
    canvasAgent.searchConfigured = canvasAgent.searchEnabled = Boolean(configured);
  }
  function canvasAgentSearchConfigurationDidChange(configured,requiresNewSession=false) {
    const previousConfigured=canvasAgent.searchConfigured,previousEnabled=canvasAgent.searchEnabled;
    canvasAgentSetSearchConfigured(configured);
    if (requiresNewSession||previousConfigured!==canvasAgent.searchConfigured||previousEnabled!==canvasAgent.searchEnabled) {
      canvasAgent.sessionSearchConfigured = false;
      canvasAgentContextDidChange(true);
    }
  }
  function canvasAgentUnavailableMessage() {
    return t("canvasAgentNoConnections");
  }
  function canvasAgentSetStatus(text, kind = "") {
    const unavailable = !canvasAgentExecutionAvailable(), message = unavailable ? canvasAgentUnavailableMessage() : text;
    canvasAgent.statusText = message === t("canvasAgentConnectionStale") ? t("canvasAgentChooseConnection") : message;
    canvasAgent.statusKind = unavailable ? "unavailable" : kind;
    canvasAgentTell("state");
  }
  // What the Agent is doing, said aloud for whoever shows it: the card a lasso or a suggestion puts on the Canvas
  // (assist-agent.js) and the activity layer that words it. Types: "state" (status, text, running), "user",
  // "assistant" (key, text), "tool" (callId, state, label), "stop".
  // Things said in one go are heard together, once the engine has finished what it was doing: whether a turn is
  // running is heard once, as it then stands, and before the steps of that turn. So a turn that ends in an error is
  // heard as an error, not as "ready" and then an error.
  const canvasAgentSaid = { state:false, rest:[], queued:false };
  function canvasAgentTell(type, detail = {}) {
    if (type === "state") canvasAgentSaid.state = true;
    else canvasAgentSaid.rest.push({ type, ...detail });
    if (canvasAgentSaid.queued) return;
    canvasAgentSaid.queued = true;
    queueMicrotask(() => {
      const rest = canvasAgentSaid.rest.splice(0), state = canvasAgentSaid.state;
      canvasAgentSaid.queued = canvasAgentSaid.state = false;
      const say = said => window.dispatchEvent(new CustomEvent("penecho:agent-activity", { detail:said }));
      if (state) say({ type:"state", status:canvasAgent.statusKind, text:canvasAgent.statusText, running:canvasAgent.running });
      for (const said of rest) say(said);
    });
  }
  // Stop the turn that is running. The server answers with the turn's end.
  function canvasAgentStopTurn() {
    canvasAgentTell("stop");
    try { canvasAgentSendEnvelope("cancel",{}); } catch {}
  }



  // The status is kept as words, so it is said again in the new language.
  function updateCanvasAgentLanguage() {
    const statusKey = { ready:"canvasAgentReady", connecting:"canvasAgentConnecting", running:"canvasAgentWorking", offline:"canvasAgentDisconnected" }[canvasAgent.statusKind];
    if (!canvasAgentExecutionAvailable()) canvasAgentSetStatus(t("canvasAgentNoConnections"),"unavailable");
    else if (statusKey) canvasAgentSetStatus(t(statusKey),canvasAgent.statusKind);
    else if (canvasAgent.statusKind==="error"&&canvasAgent.lastTurnError) canvasAgentSetStatus(canvasAgentErrorSummary(canvasAgent.lastTurnError),"error");
  }
  function canvasAgentHistoryText(value, limit = CANVAS_AGENT_HISTORY_TEXT_LIMIT) {
    return String(value || "").slice(0,limit);
  }
  function canvasAgentNormalizeError(value) {
    const source=value&&typeof value==="object"?value:{message:value}, nested=source.error&&typeof source.error==="object"?source.error:null,
      code=canvasAgentHistoryText(source.code||source.name||nested?.code||nested?.name||"",128).replace(/[\0-\x1f\x7f]/g,"").trim(),
      fallback=typeof value==="string"?value:"",
      message=canvasAgentHistoryText(source.message||nested?.message||fallback||"PenEcho Agent failed.",CANVAS_AGENT_ERROR_MESSAGE_LIMIT).trim()||"PenEcho Agent failed.";
    return {code,message};
  }
  function canvasAgentErrorKind(value) {
    const error=canvasAgentNormalizeError(value),code=error.code.toUpperCase(),message=error.message.toLowerCase();
    if(/INSUFFICIENT_CREDITS/.test(code)||/available credits do not cover|insufficient[_\s-]+credits/.test(message))return "credits";
    if(/CONCURRENC|CAPACITY|SERVER_BUSY/.test(code)||/concurrenc|too many simultaneous|server is busy|service is busy/.test(message))return "busy";
    if(/TIMEOUT|ETIMEDOUT/.test(code)||/timed? out|timeout/.test(message))return "timeout";
    if(/RATE_LIMIT|TOO_MANY_REQUESTS|RESOURCE_EXHAUSTED|QUOTA/.test(code)||code==="429"||/rate limit|too many requests|quota exceeded|\b(?:http )?429\b/.test(message))return "rate_limit";
    if(/CONTEXT_LENGTH|REQUEST_TOO_LARGE|PAYLOAD_TOO_LARGE|TOKEN_LIMIT/.test(code)||/context (?:length|window)|too many tokens|request (?:is )?too large|message is too large|more attachment data than penecho can safely process|maximum token/.test(message))return "request_too_large";
    if(/UNAUTHENTICATED|UNAUTHORIZED|AUTHENTICATION_FAILED|INVALID_API_KEY|API_KEY_INVALID|LOGIN_REQUIRED/.test(code)||code==="401"||/\bunauthorized\b|\bunauthenticated\b|authentication failed|invalid api key|please (?:log|sign) in|not logged in|\b(?:http )?401\b/.test(message))return "authentication";
    if(/MODEL_NOT_FOUND|MODEL_UNAVAILABLE|UNKNOWN_MODEL/.test(code)||/model .*?(?:not found|unavailable|does not exist|not supported)/.test(message))return "model_unavailable";
    if(code==="400"||/\bhttp 400\b/.test(message))return "request_rejected";
    if(/ECONN|ENOTFOUND|EAI_AGAIN|NETWORK|SOCKET|CONNECTION/.test(code)||/network error|fetch failed|connection (?:failed|closed|reset|refused)|socket hang up|could not connect/.test(message))return "connection";
    return "generic";
  }
  function canvasAgentErrorSummary(value) {
    if (canvasAgentNormalizeError(value).code === "CONNECTION_STALE") return t("canvasAgentConnectionStale");
    return t({
      busy:"canvasAgentErrorBusy",
      credits:"canvasAgentErrorCredits",
      timeout:"canvasAgentErrorTimeout",
      rate_limit:"canvasAgentErrorRateLimit",
      request_too_large:"canvasAgentErrorRequestTooLarge",
      authentication:"canvasAgentErrorAuthentication",
      model_unavailable:"canvasAgentErrorModelUnavailable",
      request_rejected:"canvasAgentErrorRequestRejected",
      connection:"canvasAgentErrorConnection",
      generic:"canvasAgentErrorGeneric",
    }[canvasAgentErrorKind(value)]);
  }
  function canvasAgentMessageText(value) {
    const text=String(value||"");
    if(text.length<=CANVAS_AGENT_HISTORY_TEXT_LIMIT)return text;
    let end=CANVAS_AGENT_HISTORY_TEXT_LIMIT-1;
    if(/[\uD800-\uDBFF]/.test(text[end-1])&&/[\uDC00-\uDFFF]/.test(text[end]))end--;
    return `${text.slice(0,end)}…`;
  }
  function canvasAgentVisibleAssistantText(value) {
    const text=String(value||""),opening=/<p(?:h)?enecho_canvas_title>/.exec(text);
    if(!opening)return canvasAgentMessageText(text);
    const start=opening.index,titleStart=start+opening[0].length,closing=/<\/p(?:h)?enecho_canvas_title>/.exec(text.slice(titleStart));
    if(!closing)return canvasAgentMessageText(text);
    const end=titleStart+closing.index,before=text.slice(0,start),after=text.slice(end+closing[0].length),left=before.match(/(?:\r?\n[ \t]*)+$/)?.[0]||"",right=after.match(/^(?:[ \t]*\r?\n)+/)?.[0]||"",lineBreak=left.includes("\r\n")||right.includes("\r\n")?"\r\n":"\n",breaks=Math.min(2,Math.max((left.match(/\n/g)||[]).length,(right.match(/\n/g)||[]).length));
    return canvasAgentMessageText(!before.trim()?after.slice(right.length):!after.trim()?before.slice(0,before.length-left.length):left&&right?`${before.slice(0,before.length-left.length)}${lineBreak.repeat(breaks)}${after.slice(right.length)}`:`${before}${after}`);
  }
  // The chats the old Agent panel saved in this browser are left exactly where they are. Nothing shows them now and
  // nothing here writes that store. It is read for one thing only: a Canvas that once had a conversation is not
  // taken for a blank page, even when nothing is drawn on it (canvas-documents.js).
  function canvasAgentReadHistoryStore() {
    try {
      const stored=JSON.parse(localStorage.getItem(CANVAS_AGENT_HISTORY_KEY)||"null");
      return stored?.version===1&&stored.canvases&&typeof stored.canvases==="object"&&!Array.isArray(stored.canvases)?stored.canvases:{};
    } catch { return {}; }
  }
  // The saved conversations in a list that have something in them.
  function canvasAgentStoredConversations(value) {
    return (Array.isArray(value)?value:[]).filter(chat=>chat&&typeof chat==="object"&&String(chat.id||"")&&Number.isFinite(Number(chat.createdAt))&&Number.isFinite(Number(chat.updatedAt))
      &&(Array.isArray(chat.items)?chat.items:[]).some(item=>item&&typeof item==="object"&&(item.type==="message"&&["user","assistant"].includes(item.role)||item.type==="error"||item.type==="tool")));
  }
  function canvasAgentStoredHistoryGroups() {
    return Object.entries(canvasAgentReadHistoryStore()).filter(([,value])=>canvasAgentStoredConversations(value).length).map(([canvasKey])=>({canvasKey}));
  }
  function canvasAgentHistoryForCanvas(canvasKey = state.canvasAgentCanvasKey) {
    return canvasAgentStoredConversations(canvasAgentReadHistoryStore()[String(canvasKey||"")]);
  }
  function canvasAgentShouldRequestCanvasTitle() {
    return currentCanvasNeedsAgentName();
  }
  function canvasAgentNewConversationRecord() {
    const now=Date.now();
    return {id:canvasClientId(),createdAt:now,updatedAt:now,title:"",items:[]};
  }
  function canvasAgentConversationHistory(conversation) {
    const messages=(conversation?.items||[]).filter(item=>item?.type==="message"&&["user","assistant"].includes(item.role)&&item.final!==false&&String(item.text||"").trim()).slice(-CANVAS_AGENT_HISTORY_ITEM_LIMIT),retained=[];
    let remaining=CANVAS_AGENT_CONTINUATION_TEXT_LIMIT;
    for(let index=messages.length-1;index>=0&&remaining>0;index--){
      const item=messages[index],text=String(item.text||"").slice(-remaining);
      if(!text)continue;
      retained.unshift({role:item.role,text});
      remaining-=text.length;
    }
    return retained;
  }
  function canvasAgentContinuationHistory() {
    return canvasAgent.pendingConversationHistory.length
      ? canvasAgent.pendingConversationHistory.slice()
      : canvasAgentConversationHistory(canvasAgent.currentConversation);
  }
  // A new, empty conversation in the page. It lives in memory only.
  function canvasAgentBeginLocalConversation({submitExecution=null}={}) {
    if (submitExecution) canvasAgentAssertSubmitExecution(submitExecution);
    else canvasAgentInvalidateSubmitExecution();
    canvasAgentBeginSessionTransition();
    canvasAgent.currentConversation=canvasAgentNewConversationRecord();
    canvasAgent.pendingConversationHistory=[];
    canvasAgent.lastTurnError=null;
    canvasAgentClearTurnRecords();
  }
  function canvasAgentDropSessionIdentity() {
    canvasAgent.sessionId="";
    canvasAgent.resumeToken="";
    canvasAgent.connectionId="";
    canvasAgent.sessionEngine="";
    canvasAgent.sessionModel="";
    canvasAgent.sessionChannel="";
    canvasAgentBeginSessionTransition();
  }
  function canvasAgentReportAsyncError(error) {
    // Loading a saved Canvas supersedes the initial connection handshake.
    // Its rejected promise must not overwrite the replacement session status.
    if(error?.code==="SESSION_CHANGED") {
      if(!canvasAgent.connectPromise&&!canvasAgent.running)canvasAgentSetStatus(t(canvasAgent.sessionReady?"canvasAgentReady":"canvasAgentReadyConnect"),"ready");
      return;
    }
    canvasAgentSetStatus(String(error?.message||error),"error");
  }
  function canvasAgentBeginSessionTransition() {
    canvasAgent.sessionGeneration++;
    canvasAgent.sessionReady = false;
    canvasAgent.retireSuggestionTurn?.();
    canvasAgent.pendingHandshakeId = "";
    canvasAgent.pendingProvider = "";
    if (canvasAgent.connectReject) {
      const reject=canvasAgent.connectReject;
      canvasAgent.connectPromise=null;
      canvasAgent.connectResolve=canvasAgent.connectReject=null;
      reject(Object.assign(Error("PenEcho Agent session changed."),{code:"SESSION_CHANGED"}));
    }
    for (const controller of canvasAgent.toolControllers.values()) {
      controller.abort(Error("PenEcho Agent session changed."));
    }
    canvasAgent.toolControllers.clear();
    canvasAgent.toolResultCache.clear();
    canvasAgent.activeToolExecution=null;
  }
  function canvasAgentInvalidateSubmitExecution(reason=Error("PenEcho Agent session changed.")) {
    const execution=canvasAgent.activeSubmitExecution;
    if (!execution) return;
    canvasAgent.activeSubmitExecution=null;
    execution.controller.abort(reason);
    if(canvasAgent.requestPending)canvasAgentRequestDidNotSend();
  }
  function canvasAgentBeginSubmitExecution(connectionId) {
    canvasAgentInvalidateSubmitExecution(Error("A newer PenEcho Agent submission replaced this request."));
    const execution={
      connectionId:String(connectionId||""),
      controller:new AbortController(),
      socket:null,
      sessionId:"",
      generation:null,
    };
    canvasAgent.activeSubmitExecution=execution;
    return execution;
  }
  function canvasAgentSubmitExecutionCurrent(execution) {
    if (!execution || canvasAgent.activeSubmitExecution!==execution || execution.controller.signal.aborted
      || selectedAiConnectionId()!==execution.connectionId) return false;
    if (execution.generation===null) return true;
    return execution.socket===canvasAgent.socket
      && execution.socket?.readyState===WebSocket.OPEN
      && canvasAgent.sessionReady
      && execution.sessionId===canvasAgent.sessionId
      && execution.generation===canvasAgent.sessionGeneration;
  }
  function canvasAgentAssertSubmitExecution(execution) {
    if (!canvasAgentSubmitExecutionCurrent(execution)) throw Error("PenEcho Agent session changed before the message could be sent.");
  }
  function canvasAgentBindSubmitExecution(execution) {
    canvasAgentAssertSubmitExecution(execution);
    if (!canvasAgent.sessionReady || !canvasAgent.sessionId || canvasAgent.socket?.readyState!==WebSocket.OPEN) throw Error("PenEcho Agent is not connected.");
    execution.socket=canvasAgent.socket;
    execution.sessionId=canvasAgent.sessionId;
    execution.generation=canvasAgent.sessionGeneration;
    canvasAgentAssertSubmitExecution(execution);
  }
  function canvasAgentToolExecutionCurrent(execution=null) {
    if (execution?.kind === "mcp") return mcpExecutionCurrent(execution);
    return Boolean(execution)
      && execution.socket===canvasAgent.socket
      && execution.socket?.readyState===WebSocket.OPEN
      && execution.sessionId===canvasAgent.sessionId
      && execution.generation===canvasAgent.sessionGeneration
      && (execution.documentEpoch===undefined || execution.documentEpoch===canvasDocuments.epoch && execution.activeDocumentId===canvasDocuments.activeId)
      && (!execution.assistContext || assistAgentToolContextCurrent(execution.assistContext))
      && !execution.controller.signal.aborted;
  }
  function canvasAgentAssertToolExecution(execution) {
    if(execution?.kind==="mcp"&&execution.controller.signal.aborted)throw mcpExecutionAbortError(execution.controller.signal);
    if (!canvasAgentToolExecutionCurrent(execution)) throw canvasAgentToolError("SESSION_EXPIRED","The PenEcho Agent session changed before this tool could finish.");
  }
  function canvasAgentCanvasIdentity({id,location}={}) {
    if(id&&location)return `${location}:${id}`;
    const doc=typeof canvasDocuments!=="undefined"?canvasDocumentsCurrent():null;
    return doc?`workspace:${doc.id}`:`draft:${canvasClientId()}`;
  }
  function canvasAgentCanvasDidChange(identity = null) {
    canvasAgentReconcileCloudCanvas();
    // The MCP connection owns a workspace. Its sessions keep their original documentId.
    if(typeof canvasDocuments==="undefined")mcpDisconnect();
    state.canvasAgentCanvasKey=canvasAgentCanvasIdentity(identity||{});
    canvasAgentBeginLocalConversation();
    if (canvasAgent.socket?.readyState===WebSocket.OPEN||canvasAgent.connectPromise) {
      void canvasAgentStartNewConversation(selectedAiConnectionId(),{resetProjection:false}).catch(canvasAgentReportAsyncError);
    } else canvasAgentDropSessionIdentity();
  }
  function canvasAgentCanvasDidPersist(location,id) {
    canvasAgentReconcileCloudCanvas();
    if (window.PENECHO_CONFIG?.runtime === "cloud" && canvasAgent.statusKind === "unavailable" && canvasAgentExecutionAvailable()) canvasAgentSetStatus(t("canvasAgentReadyConnect"),"ready");
    if (location&&id) state.canvasAgentCanvasKey=canvasAgentCanvasIdentity({location,id});
  }
  function canvasAgentSendEnvelope(type, payload = {}) {
    if (!canvasAgent.socket || canvasAgent.socket.readyState !== WebSocket.OPEN) throw Error("PenEcho Agent is not connected.");
    canvasAgent.outgoingSeq++;
    canvasAgent.socket.send(JSON.stringify({
      version:CANVAS_AGENT_PROTOCOL_VERSION,
      type,
      canvasSessionId:canvasAgent.sessionId,
      clientId:canvasAgent.clientId,
      seq:canvasAgent.outgoingSeq,
      payload,
    }));
  }
  function canvasAgentSelectionIds() {
    return [state.selectedWidgetId,state.selectedTextBoxId,state.selectedImageId].filter(Boolean);
  }
  let canvasAgentToolbarLayoutFrame = 0;
  function canvasAgentToolbarOverflows() {
    return Boolean(canvasAgentToolbar?.clientWidth && canvasAgentToolbar.scrollWidth > canvasAgentToolbar.clientWidth + 1);
  }
  function canvasAgentSyncToolbarLayout(theme = state.theme) {
    const body = document.body,
      toolbarAvailable = theme === "studio" && Boolean(window.matchMedia?.("(min-width: 701px)").matches) && canvasAgentToolbar && canvasAgentToolbarHome;
    body.classList.remove("studio-toolbar-effort-compact", "studio-toolbar-controls-compact", "studio-toolbar-two-row", "studio-agent-launcher-floating");
    if (!toolbarAvailable) {
      if (canvasAgentControl.parentElement !== canvasAgentFrame) canvasAgentFrame.append(canvasAgentControl);
      body.classList.toggle("studio-agent-launcher-floating", theme === "studio");
      return "floating";
    }
    if (canvasAgentControl.parentElement !== canvasAgentToolbarHome) canvasAgentToolbarHome.append(canvasAgentControl);
    if (!canvasAgentToolbarOverflows()) return "full";
    body.classList.add("studio-toolbar-effort-compact");
    if (!canvasAgentToolbarOverflows()) return "effort-compact";
    body.classList.add("studio-toolbar-controls-compact");
    if (!canvasAgentToolbarOverflows()) return "controls-compact";
    body.classList.add("studio-toolbar-two-row");
    return "two-row";
  }
  function canvasAgentScheduleToolbarLayout() {
    if (canvasAgentToolbarLayoutFrame) return;
    canvasAgentToolbarLayoutFrame = requestAnimationFrame(() => {
      canvasAgentToolbarLayoutFrame = 0;
      canvasAgentSyncToolbarLayout();
    });
  }
  function syncStudioWorkbench(theme = state.theme) {
    canvasAgentSyncToolbarLayout(theme);
    window.PenEchoStudioNavigator?.syncTheme?.(theme);
  }
  function canvasAgentReadDataUrl(blob, execution = null) {
    if(execution?.kind!=="mcp") {
    return new Promise((resolve,reject)=>{
      const reader = new FileReader();
      reader.onload = ()=>resolve(String(reader.result || ""));
      reader.onerror = ()=>reject(reader.error || Error("Could not read the image."));
      reader.readAsDataURL(blob);
    });
      }

    return new Promise((resolve,reject)=>{
      const reader = new FileReader();let settled=false;
      const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);reader.onload=reader.onerror=reader.onabort=null;error?reject(error):resolve(value);};
      const timer=setTimeout(()=>{finish(Error("Image reading timed out."));try{reader.abort();}catch{}},15_000);
      reader.onload = ()=>finish(null,String(reader.result || ""));
      reader.onerror = ()=>finish(reader.error || Error("Could not read the image."));
      reader.onabort = ()=>finish(Error("Image reading was cancelled."));
      reader.readAsDataURL(blob);
    });
  }
  function canvasAgentCanvasBlob(canvas,type,quality,execution = null) {
    if(execution?.kind!=="mcp") {
    return new Promise(resolve=>canvas.toBlob(resolve,type,quality));
      }

    const pending=canvasAgentCanvasBlob.pending||(canvasAgentCanvasBlob.pending=new Set());
    if(pending.size>=128)return Promise.reject(Object.assign(Error("Canvas image encoders are still finishing."),{code:"CANVAS_BUSY"}));
    const resource={};pending.add(resource);

    return new Promise((resolve,reject)=>{
      let settled=false;
      const finish=(error,blob)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(blob);};
      const timer=setTimeout(()=>finish(Error("Image encoding timed out.")),15_000);
      try{canvas.toBlob(blob=>{pending.delete(resource);finish(null,blob);},type,quality);}
      catch(error){pending.delete(resource);finish(error);}
    });
  }
  function canvasAgentBox(object) {
    if (!object) return null;
    if (object.kind === "widget") return widgetBox(object.item);
    if (object.kind === "text") return textBoxBox(object.item);
    if (object.kind === "image") return imageBox(object.item);
    if (object.kind === "animation") return animationBox(object.item);
    return null;
  }
  function canvasAgentExternalRect(rect) {
    return rect ? {x:rect.x,y:rect.y,width:rect.w,height:rect.h} : null;
  }
  function canvasAgentInternalRect(rect) {
    return rect ? {x:rect.x,y:rect.y,w:rect.w ?? rect.width,h:rect.h ?? rect.height} : null;
  }
  function canvasAgentObject(id) {
    let item = state.widgets.find(value=>value.id===id);
    if (item) return { kind:"widget", item };
    item = state.textBoxes.find(value=>value.id===id);
    if (item) return { kind:"text", item };
    item = state.images.find(value=>value.id===id);
    return item ? { kind:"image", item } : null;
  }
  function canvasAgentObjectSummary(object) {
    const box = canvasAgentBox(object), item = object.item;
    return {
      id:item.id,
      kind:object.kind,
      box:canvasAgentExternalRect(box),
      ...(object.kind === "widget" ? { title:item.title, pluginId:item.pluginId, widgetType:item.widgetType, sourceFormat:item.sourceFormat || null } : {}),
      ...(object.kind === "text" ? { text:item.text.slice(0,240), fontSize:item.fontSize, color:item.color } : {}),
      ...(object.kind === "image" ? { sourceName:item.sourceName || "", naturalSize:{ width:item.naturalW, height:item.naturalH }, ...(item.plotExpression ? { plotExpression:item.plotExpression } : {}) } : {}),
    };
  }
  function canvasAgentContentBounds() {
    const full = { x:0,y:0,w:SIZE,h:SIZE };
    const bounds = unionLocalBounds(
      unionLocalBounds(
        unionLocalBounds(
          unionLocalBounds(visibleInkBounds(full),imageBounds()),
          textBoxBounds(),
        ),
        animationBounds(),
      ),
      widgetBounds(),
    );
    const selection = state.selection;
    return selection?.phase === "active" && selection.fragments?.length
      ? unionLocalBounds(bounds, selectionContentBounds(selection))
      : bounds;
  }
  function canvasAgentAllObjects() {
    return [
      ...state.widgets.map(item=>canvasAgentObjectSummary({kind:"widget",item})),
      ...state.textBoxes.map(item=>canvasAgentObjectSummary({kind:"text",item})),
      ...state.images.map(item=>canvasAgentObjectSummary({kind:"image",item})),
    ];
  }
  function canvasAgentViewFacts() {
    // Panel and window geometry belongs to app chrome; only Canvas interaction advances this revision.
    const viewport = viewportRect(), signature = JSON.stringify({scale:state.scale,panX:state.panX,panY:state.panY,selection:canvasAgentSelectionIds(),ink:state.selection?.box || null});
    if (signature !== canvasAgent.viewSignature) {
      canvasAgent.viewSignature = signature;
      canvasAgent.viewRevision++;
    }
    return {viewport,viewRevision:canvasAgent.viewRevision};
  }
  function canvasAgentAppearanceFacts() {
    const style=getComputedStyle(document.body),cssValue=name=>style.getPropertyValue(name).trim()||null;
    return {
      uiTheme:state.theme,
      fontFamily:style.fontFamily||null,
      colorScheme:style.colorScheme||null,
      colors:{
        paper:state.paint.paper,
        grid:state.paint.paperGrid,
        outside:state.paint.outside,
        ink:cssValue("--ink"),
        muted:cssValue("--muted"),
        accent:cssValue("--gold-bright"),
        line:state.paint.border,
        panel:cssValue("--panel"),
        panelRaised:cssValue("--panel-raised"),
      },
    };
  }
  function canvasAgentDigest(detail = "summary") {
    const objects = canvasAgentAllObjects(), viewFacts = canvasAgentViewFacts();
    const inkBounds = visibleInkBounds({x:0,y:0,w:SIZE,h:SIZE});
    return {
      revision:state.userRevision,
      viewRevision:viewFacts.viewRevision,
      mutationState:canvasAgentMutationState(),
      canvas:{ width:SIZE, height:SIZE, contentBounds:canvasAgentExternalRect(canvasAgentContentBounds()) },
      appearance:canvasAgentAppearanceFacts(),
      viewport:canvasAgentExternalRect(viewFacts.viewport),
      selection:{ objectIds:canvasAgentSelectionIds(), inkBounds:canvasAgentExternalRect(state.selection?.box) },
      counts:{ inkTiles:tiles.size, widgets:state.widgets.length, textBoxes:state.textBoxes.length, images:state.images.length },
      ...(inkBounds ? { ink:{ id:"ink", kind:"ink", box:canvasAgentExternalRect(inkBounds) } } : {}),
      ...(detail === "objects" ? { objects } : { objects:objects.map(({text,...object})=>object) }),
    };
  }
  function canvasAgentSyncState() {
    if (canvasAgent.socket?.readyState === WebSocket.OPEN && canvasAgent.sessionReady && canvasAgent.sessionId) {
      canvasAgentSendEnvelope("state_sync",{digest:canvasAgentDigest("objects")});
    }
  }
  function canvasAgentTurnReferences() {
    const objectIds=canvasAgentSelectionIds().filter(id=>canvasAgentObject(id)), region=state.selection?.box;
    return {objectIds,...(region?{region:{x:region.x,y:region.y,width:region.w,height:region.h}}:{})};
  }
  function canvasAgentAssistantPosition(value) {
    const legacy=/^(\d+):(\d+)(?::|$)/.exec(String(value?.eventKey||"")),legacyTurn=Number(legacy?.[1]),legacyStep=Number(legacy?.[2]);
    return {
      turn:Number.isSafeInteger(value?.turn)?value.turn:Number.isSafeInteger(legacyTurn)?legacyTurn:0,
      step:Number.isSafeInteger(value?.step)?value.step:Number.isSafeInteger(legacyStep)?legacyStep:0,
    };
  }
  function canvasAgentPendingAssistantRow(event) {
    const position=canvasAgentAssistantPosition(event);
    return [...canvasAgent.assistantRows.values()].findLast(target=>{
      const candidate=canvasAgentAssistantPosition(target?.historyItem);
      return candidate.turn===position.turn&&candidate.step===position.step&&target?.historyItem?.final===false;
    })||null;
  }
  function canvasAgentCreateAssistantRow(event,text="",final=true) {
    const position=canvasAgentAssistantPosition(event),eventKey=`${position.turn}:${position.step}:${canvasClientId()}`,
      target=canvasAgentRow("assistant",text,{eventKey,final,turn:position.turn,step:position.step});
    canvasAgent.assistantRows.set(eventKey,target);
    return target;
  }
  function canvasAgentErrorRow(value,{eventKey=""}={}) {
    const error=canvasAgentNormalizeError(value),key=eventKey?canvasAgentHistoryText(`${canvasAgent.sessionId||"unbound"}:${eventKey}`,128):"";
    if(key&&canvasAgent.currentConversation?.items.some(item=>item.type==="error"&&item.eventKey===key))return;
    canvasAgentRecordItem({id:canvasClientId(),type:"error",code:error.code,message:error.message,eventKey:key});
  }
  // The conversation as the engine remembers it: what was asked, what the model wrote, what went wrong. It is kept
  // in memory only, for the page's own use: a reconnect sends the last messages along, and a suggestion starts
  // a new conversation when this one has anything in it.
  function canvasAgentRecordItem(item) {
    if (!canvasAgent.currentConversation) canvasAgent.currentConversation=canvasAgentNewConversationRecord();
    const items=canvasAgent.currentConversation.items;
    items.push(item);
    if (items.length>CANVAS_AGENT_HISTORY_ITEM_LIMIT) items.splice(0,items.length-CANVAS_AGENT_HISTORY_ITEM_LIMIT);
    return item;
  }
  function canvasAgentRow(role, text = "", {eventKey="",final=true,turn=null,step=null}={}) {
    const item=canvasAgentRecordItem({id:canvasClientId(),type:"message",role,text:role==="assistant"?canvasAgentVisibleAssistantText(text):canvasAgentMessageText(text),eventKey,...(Number.isSafeInteger(turn)?{turn}:{}),...(Number.isSafeInteger(step)?{step}:{}),...(role==="assistant"?{final:final!==false}:{})});
    if (role === "user") canvasAgentTell("user");
    return {historyItem:item,messageText:item.text};
  }
  function canvasAgentToolIntent(name,args = {}) {
    const compact=value=>{
      const text=String(value||"").replace(/\s+/g," ").trim();
      return text.length>100?`${text.slice(0,100)}…`:text;
    },quoted=value=>{
      const text=compact(value);
      return text?`“${text}”`:"";
    },visualSkillKey={
      "math-2d":"canvasAgentToolVisualMath2D",
      "physics-2d":"canvasAgentToolVisualPhysics2D",
      "math-3d":"canvasAgentToolVisualMath3D",
    }[String(args?.skill||"")],widgetContractKey={
      "general-html":"canvasAgentToolGeneralHtml",
      "professional-diagrams":"canvasAgentToolProfessionalDiagrams",
    }[String(args?.route||"")],projectPluginKey={
      documents:"canvasAgentToolLoadDocumentReader",
      database:"canvasAgentToolLoadDatabaseReader",
    }[String(args?.plugin||"")],canvasTargetKey={
      viewport:"canvasAgentToolTargetViewport",
      canvas:"canvasAgentToolTargetCanvas",
      object:"canvasAgentToolTargetObject",
      selection:"canvasAgentToolTargetSelection",
      region:"canvasAgentToolTargetRegion",
    };
    if(name==="load_visual_skill"&&visualSkillKey)return t(visualSkillKey);
    if(name==="load_widget_contract"&&widgetContractKey)return t(widgetContractKey);
    if(name==="load_project_plugin"&&projectPluginKey)return t(projectPluginKey);
    const key = {
      penecho_list_files:"canvasAgentToolInspect",
      penecho_read_file:"canvasAgentToolRead",
      penecho_get_guidance:"canvasAgentToolRead",
      penecho_present_widget:"canvasAgentToolCreate",
      penecho_draw:"canvasAgentToolCreate",
      penecho_plot:"canvasAgentToolCreate",
      penecho_patch_file:"canvasAgentToolPatchWidget",
      penecho_edit_canvas:"canvasAgentToolEdit",
      penecho_capture_canvas:"canvasAgentToolCapture",
      penecho_capture_widget:"canvasAgentToolCapture",
      penecho_inspect_session:"canvasAgentToolInspect",
      penecho_read_feedback:"canvasAgentToolRead",
      penecho_read_messages:"canvasAgentToolRead",
      penecho_ack_messages:"canvasAgentToolEdit",
      canvas_inspect:"canvasAgentToolInspect",
      canvas_read:"canvasAgentToolRead",
      canvas_capture:"canvasAgentToolCapture",
      canvas_create:"canvasAgentToolCreate",
      canvas_edit:"canvasAgentToolEdit",
      canvas_patch_widget:"canvasAgentToolPatchWidget",
      canvas_set_view:"canvasAgentToolSetView",
      canvas_revert:"canvasAgentToolRevert",
      bash:"canvasAgentToolRunProjectCommand",
      read_document:"canvasAgentToolReadDocument",
      read:"canvasAgentToolReadProjectFile",
      read_binary:"canvasAgentToolReadBinary",
      read_image:"canvasAgentToolReadProjectImage",
      read_database:"canvasAgentToolReadDatabase",
      glob:"canvasAgentToolFindProjectFiles",
      grep:"canvasAgentToolSearchProjectFiles",
      list_directory:"canvasAgentToolListProjectFolder",
      tavily_search:"canvasAgentToolSearch",
      deepseek_search:"canvasAgentToolSearch",
      research_search:"canvasAgentToolSearch",
      github_repository_search:"canvasAgentToolSearch",
      duckduckgo_search:"canvasAgentToolSearch",
      web_read:"canvasAgentToolReadWeb",
      stock_symbol_search:"canvasAgentToolStock",
      stock_market_data:"canvasAgentToolStock",
    }[name] || "canvasAgentToolUse";
    const intent=t(key),search=["tavily_search","deepseek_search","research_search","github_repository_search","duckduckgo_search"].includes(name),fileReader=["read_document","read","read_binary","read_image"].includes(name),target=canvasTargetKey[String(args?.target||args?.scope||"")],patchPath=/^\+\+\+ b\/([^\n\r]+)/m.exec(String(args?.patch||""))?.[1],detail=
      search||name==="stock_symbol_search"?quoted(args?.query):
      name==="stock_market_data"?compact(args?.symbol):
      name==="web_read"?compact(args?.url):
      name==="bash"?quoted(args?.command):
      ["glob","grep"].includes(name)?quoted(args?.pattern):
      fileReader?compact(args?.file_path):
      ["penecho_read_file","penecho_patch_file"].includes(name)?compact(args?.path):
      name==="penecho_get_guidance"?compact(args?.id):
      ["penecho_present_widget","penecho_draw","penecho_plot"].includes(name)?compact(args?.title):
      name==="read_database"?[compact(args?.file_path),quoted(args?.query)].filter(Boolean).join(" · "):
      name==="list_directory"?compact(args?.path||"."):
      ["canvas_create","canvas_edit"].includes(name)?compact(args?.summary):
      name==="canvas_read"&&args?.resource&&args.resource!=="content"?compact(args.resource):
      name==="canvas_patch_widget"?compact(patchPath):
      ["canvas_inspect","canvas_capture","canvas_set_view"].includes(name)&&target?t(target):
      key==="canvasAgentToolUse"?compact(name):"";
    if(!detail)return intent;
    return `${intent} · ${detail}`;
  }
  function canvasAgentToolRow(event) {
    const callId=String(event.callId||""),target={name:String(event.name||""),arguments:event.arguments&&typeof event.arguments==="object"?event.arguments:{},state:"running"};
    canvasAgent.toolRows.set(event.callId,target);
    canvasAgentTell("tool",{ callId, state:"running", label:canvasAgentToolIntent(target.name,target.arguments) });
  }
  function canvasAgentSetRunning(running) {
    canvasAgent.running = running;
    canvasAgentSetStatus(t(running ? "canvasAgentWorking" : "canvasAgentReady"),running ? "running" : "ready");
    if (running) canvasAgentPauseAutomaticAI();
    else canvasAgentResumeAutomaticAI();
  }
  function canvasAgentHandleEvent(event,{ replay=false }={}) {
    if (!event || typeof event !== "object") return;
    if (event.kind === "turn_start") {
      canvasAgent.requestPending = false;
      canvasAgent.lastTurnError = null;
      if(!replay&&typeof mcpBeginAgentTurn==="function")mcpBeginAgentTurn();
      if (!replay && typeof assistRequestStarted === "function") assistRequestStarted(canvasAgent);
      canvasAgentSetRunning(true);
    }
    else if (event.kind === "user_message" && replay && event.text) canvasAgentRow("user",event.text);
    else if (event.kind === "assistant_delta") {
      let target = canvasAgentPendingAssistantRow(event);
      if (!target) target=canvasAgentCreateAssistantRow(event,"",false);
      target.messageText = canvasAgentVisibleAssistantText(target.messageText + (event.text || ""));
      target.historyItem.text=target.messageText;target.historyItem.final=false;
      canvasAgentTell("assistant",{ key:target.historyItem.eventKey, text:target.messageText });
    } else if (event.kind === "assistant_message") {
      let target = canvasAgentPendingAssistantRow(event);
      if (!target && event.text) target=canvasAgentCreateAssistantRow(event,event.text,true);
      else if (target) {
        if(typeof event.text==="string")target.messageText=canvasAgentVisibleAssistantText(event.text);
        target.historyItem.text=target.messageText;target.historyItem.final=true;
      }
      if (target) canvasAgentTell("assistant",{ key:target.historyItem.eventKey, text:target.messageText });
    } else if (event.kind === "tool_call") canvasAgentToolRow(event);
    else if (event.kind === "tool_result") {
      const target = canvasAgent.toolRows.get(event.callId);
      if (target) {
        target.state = event.error ? "error" : "done";
        canvasAgentTell("tool",{ callId:String(event.callId||""), state:target.state, label:canvasAgentToolIntent(target.name,target.arguments) });
      }
    } else if (event.kind === "turn_end") {
      canvasAgent.requestPending = false;
      if(event.reason?.kind==="completed")applyCurrentCanvasGeneratedName(event.canvasTitle);
      canvasAgent.lastTurnError=event.reason?.kind==="error"?canvasAgentNormalizeError(event.reason?.error||event.reason):null;
      canvasAgentSetRunning(false);
      if (!replay && typeof assistRequestFinished === "function") assistRequestFinished(canvasAgent, event.reason?.kind === "completed" ? "completed" : "stopped");
      if (!replay && typeof assistAgentFinishResult === "function") assistAgentFinishResult(event.reason?.kind === "completed");
      if(canvasAgent.lastTurnError){
        canvasAgentErrorRow(canvasAgent.lastTurnError,{eventKey:`turn:${event.turn}`});
        canvasAgentSetStatus(canvasAgentErrorSummary(canvasAgent.lastTurnError),"error");
      }
      canvasAgentSyncState();
      const pendingConnectionChange=canvasAgent.pendingConnectionChange;
      canvasAgent.pendingConnectionChange=null;
      if(pendingConnectionChange)canvasAgentConnectionDidChange(pendingConnectionChange.force,pendingConnectionChange.provider);
      const pendingContextChange=canvasAgent.pendingContextChange;
      canvasAgent.pendingContextChange=null;
      if(pendingContextChange)canvasAgentContextDidChange(pendingContextChange.force);
    }
  }
  async function canvasAgentHandleMessage(message) {
    let envelope;
    try { envelope = JSON.parse(message.data); } catch { return; }
    if (envelope?.version !== CANVAS_AGENT_PROTOCOL_VERSION || !Number.isSafeInteger(envelope.seq) || envelope.seq <= canvasAgent.incomingSeq) return;
    const socket = message.target;
    if (socket && socket !== canvasAgent.socket) return;
    const handshakeId=String(envelope.payload?.handshakeId||"");
    const readyHandshake = envelope.type === "ready" && Boolean(canvasAgent.connectPromise) && Boolean(envelope.canvasSessionId)
      && Boolean(canvasAgent.pendingHandshakeId) && handshakeId===canvasAgent.pendingHandshakeId;
    const currentSessionEnvelope = Boolean(canvasAgent.sessionReady) && Boolean(envelope.canvasSessionId) && envelope.canvasSessionId === canvasAgent.sessionId;
    const pendingHandshakeError = envelope.type === "error" && Boolean(canvasAgent.connectPromise)
      && Boolean(canvasAgent.pendingHandshakeId) && handshakeId===canvasAgent.pendingHandshakeId;
    if (!readyHandshake && !currentSessionEnvelope && !pendingHandshakeError) return;
    canvasAgent.incomingSeq = envelope.seq;
    if (envelope.type === "ready") {
      const selection=canvasAgent.pendingSelection;
      if(selection && (selection.connectionId!==selectedAiConnectionId() || selection.scope!==aiConnectionScope(selection.connectionId.startsWith("hosted:")))) {
        canvasAgent.connectReject?.(Object.assign(Error("PenEcho Agent selection changed."),{code:"SESSION_CHANGED"}));
        return;
      }
      canvasAgent.lastTurnError=null;
      canvasAgent.sessionId = envelope.canvasSessionId;
      canvasAgent.resumeToken = String(envelope.payload?.resumeToken || canvasAgent.resumeToken || "");
      canvasAgent.connectionId = String(envelope.payload?.connectionId || "");
      canvasAgent.sessionEngine = String(envelope.payload?.engine || "");
      canvasAgent.sessionModel = String(envelope.payload?.model || "");
      canvasAgent.sessionChannel = String(envelope.payload?.channel || "");
      canvasAgent.sessionReady = true;
      canvasAgent.pendingHandshakeId = "";
      canvasAgent.pendingProvider = "";
      canvasAgent.sessionSearchConfigured = envelope.payload?.webSearchConfigured === true;
      canvasAgent.sessionSearchEnabled = envelope.payload?.webSearchEnabled === true;
      canvasAgent.pendingConversationHistory=[];
      canvasAgentSetSearchConfigured(canvasAgent.sessionSearchConfigured);
      canvasAgentSetStatus(t(envelope.payload?.resumed ? "canvasAgentResumed" : "canvasAgentReady"),"ready");
      // A session taken up again with nothing remembered here: the server says what was in it.
      if (envelope.payload?.resumed&&!canvasAgent.currentConversation?.items?.length) {
        canvasAgent.currentConversation.items=[];
        canvasAgent.assistantRows.clear();
        canvasAgent.toolRows.clear();
        for (const event of envelope.payload?.backlog || []) canvasAgentHandleEvent(event,{replay:true});
      }
      canvasAgent.connectResolve?.();
      canvasAgent.connectResolve = canvasAgent.connectReject = null;
      canvasAgentSyncState();
    }
    if (envelope.type === "session_event") canvasAgentHandleEvent(envelope.payload);
    else if (envelope.type === "agent_status") {
      const status=String(envelope.payload?.status||"");
      canvasAgent.requestPending = false;
      canvasAgentSetRunning(status !== "idle");
      if(status === "idle"&&canvasAgent.lastTurnError)canvasAgentSetStatus(canvasAgentErrorSummary(canvasAgent.lastTurnError),"error");
    }
    else if (envelope.type === "tool_request") await canvasAgentExecuteTool(envelope.payload);
    else if (envelope.type === "error") {
      const error=canvasAgentNormalizeError(envelope.payload);
      if(pendingHandshakeError && error.code === "CONNECTION_STALE" && canvasAgent.recoverStaleHandshake){
        canvasAgent.connectReject?.(Object.assign(Error(error.message),{code:error.code}));
        canvasAgent.connectResolve=canvasAgent.connectReject=null;
        return;
      }
      canvasAgent.requestPending = false;
      if (!canvasAgent.running && typeof assistRequestFinished === "function") assistRequestFinished(canvasAgent, "failed");
      canvasAgent.lastTurnError=error;
      canvasAgentResumeAutomaticAI();
      canvasAgentErrorRow(error,{eventKey:`envelope:${envelope.seq}`});
      canvasAgentSetStatus(canvasAgentErrorSummary(error),"error");
      if(pendingHandshakeError){
        canvasAgent.sessionReady=Boolean(canvasAgent.sessionId);
        canvasAgent.connectReject?.(Object.assign(Error(envelope.payload?.message || "PenEcho Agent failed"),{code:error.code}));
        canvasAgent.connectResolve=canvasAgent.connectReject=null;
      }else if (envelope.payload?.fatal) canvasAgent.connectReject?.(Object.assign(Error(envelope.payload?.message || "PenEcho Agent failed"),{code:error.code}));
    }
  }
  function canvasAgentSocketUrl(connectionId = selectedAiConnectionId()) {
    const path=canvasAgentUsesCloudHost(connectionId)
      ? `/api/v1/hosted/canvases/${canvasAgentCloudCanvasId()}/agent${canvasAgentCloudSavedCanvasId() ? "" : "?draft=1"}`
      : window.PENECHO_CONFIG?.runtime === "cloud" ? "/api/v1/remote-canvas/canvas-agent" : "/api/canvas-agent/socket";
    return `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}${path}`;
  }
  function canvasAgentWaitForReady(start,{handshakeId,provider}={}) {
    if (canvasAgent.connectPromise) return canvasAgent.connectPromise;
    const expectedHandshakeId=String(handshakeId||"");
    if (!expectedHandshakeId) return Promise.reject(Error("PenEcho Agent handshake is missing."));
    const connectionId=selectedAiConnectionId(), scope=aiConnectionScope(connectionId.startsWith("hosted:"));
    const generation=canvasAgent.sessionGeneration, conversationId=canvasAgent.currentConversation?.id;
    let wrapped;
    const pending=Promise.resolve().then(async()=>{
      for(let attempt=0;attempt<2;attempt++){
        await validateAiConnectionSelection(connectionId,scope);
        if (canvasAgent.connectPromise !== wrapped || canvasAgent.sessionGeneration !== generation || canvasAgent.currentConversation?.id !== conversationId) throw Object.assign(Error("PenEcho Agent session changed."),{code:"SESSION_CHANGED"});
        canvasAgent.pendingSelection = { connectionId, scope };
        canvasAgent.pendingHandshakeId=expectedHandshakeId;
        canvasAgent.pendingProvider=String(provider||"");
        canvasAgent.recoverStaleHandshake=attempt===0;
        try {
          await new Promise((resolve,reject)=>{
            canvasAgent.connectResolve=resolve;
            canvasAgent.connectReject=reject;
            try { start(); } catch(error) { reject(error); }
          });
          return;
        } catch(error) {
          // Only a correlated handshake rejection can enter this path. No user
          // turn or provider output is ever replayed by connection recovery.
          if(error?.code!=="CONNECTION_STALE"||attempt!==0)throw error;
        }
      }
    });
    wrapped=pending.finally(()=>{
      if(canvasAgent.connectPromise===wrapped){
        canvasAgent.connectPromise=null;
        canvasAgent.connectResolve=canvasAgent.connectReject=null;
        canvasAgent.recoverStaleHandshake=false;
        canvasAgent.pendingSelection=null;
        if(canvasAgent.pendingHandshakeId===expectedHandshakeId){canvasAgent.pendingHandshakeId="";canvasAgent.pendingProvider="";}
      }
    });
    canvasAgent.connectPromise=wrapped;
    return wrapped;
  }
  // What the engine remembers of the turns so far, forgotten.
  function canvasAgentClearTurnRecords() {
    canvasAgent.assistantRows.clear();
    canvasAgent.toolRows.clear();
    canvasAgent.toolResultCache.clear();
    canvasAgent.latestChange = null;
  }
  async function canvasAgentCurrentWidgetCapabilities() {
    return {version:1,professionalEnabled:false,privatePluginIds:[]};
  }
  async function canvasAgentStartNewConversation(connectionId = selectedAiConnectionId(), {resetProjection=true,submitExecution=null}={}) {
    canvasAgentReconcileCloudCanvas();
    connectionId=String(connectionId||"");
    if (resetProjection) canvasAgentBeginLocalConversation({submitExecution});
    else if(submitExecution)canvasAgentAssertSubmitExecution(submitExecution);
    if (canvasAgent.connectPromise) {
      await canvasAgent.connectPromise;
      return canvasAgentStartNewConversation(connectionId,{resetProjection:false,submitExecution});
    }
    if (canvasAgent.socket?.readyState !== WebSocket.OPEN) return canvasAgentConnect({submitExecution});
    canvasAgent.currentConversation.items=[];
    canvasAgentClearTurnRecords();
    canvasAgent.running = false;
    canvasAgentSetStatus(t("canvasAgentConnecting"),"connecting");
    const widgetCapabilities=await canvasAgentCurrentWidgetCapabilities();
    if(submitExecution)canvasAgentAssertSubmitExecution(submitExecution);
    if(selectedAiConnectionId()!==connectionId)return canvasAgentStartNewConversation(selectedAiConnectionId(),{resetProjection:false,submitExecution});
    canvasAgentBeginSessionTransition();
    const handshakeId=canvasClientId(),provider=canvasAgentConnectionProvider(connectionId);
    const conversationHistory=canvasAgentContinuationHistory();
    await canvasAgentWaitForReady(()=>canvasAgentSendEnvelope("new_conversation",{handshakeId,connectionId,conversationId:canvasAgent.currentConversation?.id||"",webSearchEnabled:canvasAgent.searchEnabled,widgetCapabilities,projectId:"",accessMode:"controlled",...(conversationHistory.length?{conversationHistory}:{})}),{handshakeId,provider});
    if(selectedAiConnectionId()!==connectionId)return canvasAgentStartNewConversation(selectedAiConnectionId(),{resetProjection:false,submitExecution});
  }
  async function canvasAgentChangeConnection(connectionId = selectedAiConnectionId(), {submitExecution=null}={}) {
    connectionId=String(connectionId||"");
    if(canvasAgent.connectPromise){
      await canvasAgent.connectPromise;
      return canvasAgentChangeConnection(connectionId,{submitExecution});
    }
    if(canvasAgent.socket?.readyState!==WebSocket.OPEN||!canvasAgent.sessionId||!canvasAgent.sessionReady)return canvasAgentConnect({submitExecution});
    if(canvasAgentUsesCloudHost(connectionId)!==canvasAgentUsesCloudHost(canvasAgent.connectionId))return canvasAgentConnect({submitExecution});
    if(submitExecution)canvasAgentAssertSubmitExecution(submitExecution);
    else canvasAgentInvalidateSubmitExecution();
    const widgetCapabilities=await canvasAgentCurrentWidgetCapabilities();
    if(submitExecution)canvasAgentAssertSubmitExecution(submitExecution);
    if(selectedAiConnectionId()!==connectionId)return canvasAgentChangeConnection(selectedAiConnectionId(),{submitExecution});
    canvasAgentSetStatus(t("canvasAgentConnecting"),"connecting");
    canvasAgentBeginSessionTransition();
    const handshakeId=canvasClientId(),provider=canvasAgentConnectionProvider(connectionId);
    await canvasAgentWaitForReady(()=>canvasAgentSendEnvelope("change_connection",{handshakeId,connectionId,conversationId:canvasAgent.currentConversation?.id||"",webSearchEnabled:canvasAgent.searchEnabled,widgetCapabilities,projectId:"",accessMode:"controlled"}),{handshakeId,provider});
    if(selectedAiConnectionId()!==connectionId)return canvasAgentChangeConnection(selectedAiConnectionId(),{submitExecution});
  }
  function canvasAgentSessionContextMatches() {
    return canvasAgent.sessionSearchEnabled===canvasAgent.searchEnabled;
  }
  async function canvasAgentChangeContext({submitExecution=null,force=false}={}) {
    if((canvasAgent.running||canvasAgent.requestPending)&&!submitExecution){canvasAgent.pendingContextChange={force:Boolean(force)};return;}
    if(canvasAgent.connectPromise)await canvasAgent.connectPromise;
    if(canvasAgent.socket?.readyState!==WebSocket.OPEN||!canvasAgent.sessionId||!canvasAgent.sessionReady)return canvasAgentConnect({submitExecution});
    if(!force&&canvasAgentSessionContextMatches())return;
    if(submitExecution)canvasAgentAssertSubmitExecution(submitExecution);
    else canvasAgentInvalidateSubmitExecution();
    const connectionId=selectedAiConnectionId(),widgetCapabilities=await canvasAgentCurrentWidgetCapabilities();
    if(submitExecution)canvasAgentAssertSubmitExecution(submitExecution);
    if(selectedAiConnectionId()!==connectionId)return canvasAgentChangeContext({submitExecution,force});
    canvasAgentSetStatus(t("canvasAgentConnecting"),"connecting");
    canvasAgentBeginSessionTransition();
    const handshakeId=canvasClientId(),provider=canvasAgentConnectionProvider(connectionId);
    await canvasAgentWaitForReady(()=>canvasAgentSendEnvelope("change_context",{
      handshakeId,connectionId,conversationId:canvasAgent.currentConversation?.id||"",webSearchEnabled:canvasAgent.searchEnabled,
      widgetCapabilities,projectId:"",accessMode:"controlled",
    }),{handshakeId,provider});
    if(selectedAiConnectionId()!==connectionId||!canvasAgentSessionContextMatches())return canvasAgentChangeContext({submitExecution});
    canvasAgent.pendingContextChange=null;
  }
  async function canvasAgentConnect(options) {
    canvasAgentReconcileCloudCanvas();
    const cloudCanvasId=canvasAgentCloudCanvasId();
    const assertCloudCanvas=()=>{if(cloudCanvasId!==canvasAgentCloudCanvasId())throw Object.assign(Error("PenEcho Agent Canvas changed."),{code:"SESSION_CHANGED"});};
    if (!canvasAgentExecutionAvailable()) throw Object.assign(Error(t("canvasAgentNoConnections")),{code:"CANVAS_AGENT_NO_CONNECTION"});
    const {submitExecution=null}=options||{};
    if(submitExecution)canvasAgentAssertSubmitExecution(submitExecution);
    const connectionId = selectedAiConnectionId();
    if (canvasAgent.socket && canvasAgentUsesCloudHost(connectionId)!==canvasAgentUsesCloudHost(canvasAgent.connectionId)) {
      const previousSocket=canvasAgent.socket;
      canvasAgent.socket=null;
      canvasAgent.sessionId="";
      canvasAgent.resumeToken="";
      canvasAgent.sessionReady=false;
      // Keep the same conversation; the next hello carries its bounded history.
      try { previousSocket.close(1000,"PenEcho Agent execution host changed"); } catch {}
    }
    // An existing handshake owns the transition. An open transport with a
    // saved session ID is not sufficient evidence that its session is ready.
    if (canvasAgent.connectPromise) {
      await canvasAgent.connectPromise;
      return canvasAgentConnect({submitExecution});
    }
    if (canvasAgent.socket?.readyState === WebSocket.OPEN && canvasAgent.sessionId && canvasAgent.sessionReady) {
      if (canvasAgent.sessionReady&&canvasAgent.connectionId === connectionId&&canvasAgentSessionContextMatches()) return;
      if(canvasAgent.sessionReady&&canvasAgent.connectionId!==connectionId){
        await canvasAgentChangeConnection(connectionId,{submitExecution});
        return canvasAgentConnect({submitExecution});
      }
      await canvasAgentChangeContext({submitExecution});
      // Context changes during a turn are deliberately deferred until turn_end.
      // Retrying here would only enqueue resolved promises, starving input,
      // paint and the very socket event that can make progress.
      if (!submitExecution && (canvasAgent.running || canvasAgent.requestPending)) return;
      return canvasAgentConnect({submitExecution});
    }
    canvasAgentSetStatus(t("canvasAgentConnecting"),"connecting");
    const widgetCapabilities=await canvasAgentCurrentWidgetCapabilities();
    assertCloudCanvas();
    if (!canvasAgentExecutionAvailable()) throw Object.assign(Error(t("canvasAgentNoConnections")),{code:"CANVAS_AGENT_NO_CONNECTION"});
    if(submitExecution)canvasAgentAssertSubmitExecution(submitExecution);
    if(selectedAiConnectionId()!==connectionId)return canvasAgentConnect({submitExecution});
    canvasAgentBeginSessionTransition();
    const handshakeId=canvasClientId(),provider=canvasAgentConnectionProvider(connectionId);
    await canvasAgentWaitForReady(()=>{
      const previousSocket=canvasAgent.socket;
      const socket = new WebSocket(canvasAgentSocketUrl());
      canvasAgent.socket = socket;
      canvasAgent.socketCloudCanvasId=canvasAgentUsesCloudHost(connectionId)?cloudCanvasId:"";
      if(previousSocket&&previousSocket!==socket){try{previousSocket.close(1000,"PenEcho Agent session replaced");}catch{}}
      socket.addEventListener("open",()=>{
        canvasAgentReconcileCloudCanvas();
        if(socket!==canvasAgent.socket){socket.close();return;}
        const selection=canvasAgent.pendingSelection;
        if(selection && (selection.connectionId!==selectedAiConnectionId() || selection.scope!==aiConnectionScope(selection.connectionId.startsWith("hosted:")))) { socket.close(1000,"PenEcho Agent selection changed"); return; }
        canvasAgent.outgoingSeq = 0;
        canvasAgent.incomingSeq = 0;
        const conversationHistory=canvasAgentContinuationHistory();
        canvasAgentSendEnvelope("hello",{
          handshakeId,
          canvasSessionId:canvasAgent.sessionId,
          resumeToken:canvasAgent.resumeToken,
          clientId:canvasAgent.clientId,
          connectionId,
          conversationId:canvasAgent.currentConversation?.id||"",
          webSearchEnabled:canvasAgent.searchEnabled,
          widgetCapabilities,
          projectId:"",
          accessMode:"controlled",
          ...(conversationHistory.length?{conversationHistory}:{}),
        });
      });
      socket.addEventListener("message",event=>{canvasAgentReconcileCloudCanvas();if(socket===canvasAgent.socket)void canvasAgentHandleMessage(event);});
      socket.addEventListener("close",()=>{
        if (socket !== canvasAgent.socket) return;
        if (!canvasAgentUsesCloudHost(canvasAgent.connectionId)) window.PenEchoLinkedDevice?.invalidate();
        const wasPending = Boolean(canvasAgent.connectReject),hadActiveTurn=canvasAgent.requestPending||canvasAgent.running;
        canvasAgent.sessionEngine="";
        canvasAgent.sessionModel="";
        canvasAgent.sessionChannel="";
        canvasAgentInvalidateSubmitExecution(Error("PenEcho Agent connection closed."));
        canvasAgentBeginSessionTransition();
        canvasAgent.connectReject?.(Error("PenEcho Agent connection closed."));
        canvasAgent.connectResolve = canvasAgent.connectReject = null;
        canvasAgent.connectPromise = null;
        canvasAgent.socket = null;
        canvasAgent.socketCloudCanvasId="";
        canvasAgent.requestPending = false;
        canvasAgent.running = false;
        if (typeof assistRequestFinished === "function") assistRequestFinished(canvasAgent, "failed");
        canvasAgentResumeAutomaticAI();
        if(hadActiveTurn&&!canvasAgent.lastTurnError){
          const error=canvasAgentNormalizeError({code:"CONNECTION_CLOSED",message:"PenEcho Agent connection closed."});
          canvasAgent.lastTurnError=error;
          canvasAgentErrorRow(error,{eventKey:`connection:${Date.now()}`});
          canvasAgentSetStatus(canvasAgentErrorSummary(error),"error");
        }else if(canvasAgent.lastTurnError)canvasAgentSetStatus(canvasAgentErrorSummary(canvasAgent.lastTurnError),"error");
        else if (!wasPending) canvasAgentSetStatus(t("canvasAgentDisconnected"),"offline");
        canvasAgentTell("state");
      });
      socket.addEventListener("error",()=>{ if(socket!==canvasAgent.socket)return; canvasAgentSetStatus(t("canvasAgentErrorConnection"),"error"); });
    },{handshakeId,provider});
    return canvasAgentConnect({submitExecution});
  }
  function canvasAgentConnectionProvider(connectionId) {
    const connection=allAiConnections().find(item=>item.id===String(connectionId||""));
    return String(connection?.provider||"");
  }
  function canvasAgentSelectedConnectionProvider() {
    return canvasAgentConnectionProvider(selectedAiConnectionId());
  }
  function canvasAgentConnectionDidChange(force = false, nextProvider = canvasAgentSelectedConnectionProvider()) {
    const provider=String(nextProvider||"");
    const connectionActive = canvasAgent.socket?.readyState === WebSocket.OPEN || Boolean(canvasAgent.connectPromise);
    if (!connectionActive || !force && canvasAgent.connectionId === selectedAiConnectionId()) return;
    if(canvasAgent.running||canvasAgent.requestPending){canvasAgent.pendingConnectionChange={force,provider};return;}
    const action = canvasAgentChangeConnection(selectedAiConnectionId());
    void action.catch(canvasAgentReportAsyncError);
  }
  function canvasAgentContextDidChange(force = false) {
    const connectionActive=canvasAgent.socket?.readyState===WebSocket.OPEN||Boolean(canvasAgent.connectPromise);
    if(!connectionActive)return;
    if(canvasAgent.running||canvasAgent.requestPending){
      canvasAgent.pendingContextChange={force:Boolean(force)||Boolean(canvasAgent.pendingContextChange?.force)};
      return;
    }
    void canvasAgentChangeContext({force}).catch(canvasAgentReportAsyncError);
  }
  async function canvasAgentEnsureSearchSession(submitExecution=null) {
    if (canvasAgent.sessionSearchEnabled === canvasAgent.searchEnabled || canvasAgent.socket?.readyState !== WebSocket.OPEN || !canvasAgent.sessionReady || !canvasAgent.sessionId) return;
    await canvasAgentChangeContext({submitExecution});
  }

  function canvasAgentValidatedRegion(value) {
    const x = Number(value?.x), y = Number(value?.y), w = Number(value?.w ?? value?.width), h = Number(value?.h ?? value?.height);
    if (![x,y,w,h].every(Number.isFinite) || w <= 0 || h <= 0 || x < 0 || y < 0 || x+w > SIZE || y+h > SIZE) throw canvasAgentToolError("INVALID_REGION","Canvas region is invalid or outside the canvas.",{region:value});
    return {x,y,w,h};
  }
  function canvasAgentToolError(code,message,details) {
    const error = Error(message);
    error.code = code;
    if (details !== undefined) error.details = details;
    return error;
  }
  function canvasAgentAssertToolKeys(name,args) {
    const allowed={
      canvas_inspect:["scope","region","detail","kinds","cursor","limit","plannedWidget"],
      canvas_read:["objectId","artifactId","resource","startLine","endLine"],
      canvas_capture:["target","objectId","region","quality","coordinates","deliverToUser"],
      canvas_create:["baseRevision","items","summary","_changeId"],canvas_edit:["baseRevision","operations","summary","_changeId"],
      canvas_visual_explainer_create:["baseRevision","plan","title","width","height","placement","summary","_changeId"],
      canvas_visual_explainer_update:["objectId","baseRevision","plan","title","summary","_changeId"],
      canvas_set_view:["target","objectId","region","padding"],canvas_revert:["changeId"],
      canvas_internal_widget:["objectId","artifactId"],canvas_internal_replace_widget:["objectId","baseRevision","expectedHash","expectedSourceHash","changeId","command"],
      canvas_internal_patch_visual_explainer:["objectId","artifactId","baseRevision","expectedHash","changeId","plan","command","summary"],
    }[name];
    const extras=Object.keys(args||{}).filter(key=>!allowed?.includes(key));
    if(!allowed||extras.length)throw canvasAgentToolError("INVALID_ARGUMENT",extras.length?`Unexpected ${name} argument: ${extras[0]}.`:`Unknown PenEcho Agent tool: ${name}.`);
  }
  function canvasAgentAssertRevision(baseRevision) {
    if (!Number.isSafeInteger(baseRevision) || baseRevision !== state.userRevision) {
      throw canvasAgentToolError("REVISION_CONFLICT",`Canvas revision conflict: expected ${baseRevision}, current ${state.userRevision}. Inspect again before editing.`,{expected:baseRevision,current:state.userRevision});
    }
  }
  function canvasAgentTargetRegion(args) {
    if (args.target === "viewport") return viewportRect();
    if (args.target === "canvas") return canvasAgentContentBounds() || viewportRect();
    if (args.target === "selection") {
      if (state.selection?.phase !== "active") throw canvasAgentToolError("SELECTION_REQUIRED","Create an active lasso selection before capturing it.");
      return canvasAgentValidatedRegion(state.selection.box);
    }
    if (args.target === "region") return canvasAgentValidatedRegion(args.region);
    if (args.target === "object") {
      const object = canvasAgentObject(String(args.objectId || ""));
      if (!object) throw canvasAgentToolError("OBJECT_NOT_FOUND","Canvas object was not found.",{objectId:args.objectId});
      return canvasAgentBox(object);
    }
    throw canvasAgentToolError("INVALID_TARGET","Canvas capture target is invalid. Use viewport, canvas, selection, region, or one object id.",{target:args.target ?? null});
  }
  function canvasAgentGridStep(span) {
    const rough = Math.max(1,span/6), power = 10 ** Math.floor(Math.log10(rough)), normalized = rough/power;
    return (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10)*power;
  }
  function canvasAgentDrawCoordinateGrid(context,region,width,height) {
    const scaleX = width/region.w, scaleY = height/region.h, step = canvasAgentGridStep(Math.max(region.w,region.h)), fontSize = Math.max(10,Math.min(16,Math.round(Math.min(width,height)/38)));
    context.save();
    context.strokeStyle = "rgba(37,99,235,.38)";
    context.fillStyle = "rgba(30,64,175,.92)";
    context.lineWidth = 1;
    context.font = `600 ${fontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    context.textBaseline = "top";
    for (let x=Math.ceil(region.x/step)*step;x<=region.x+region.w;x+=step) {
      const px=(x-region.x)*scaleX;
      context.beginPath();context.moveTo(px,0);context.lineTo(px,height);context.stroke();
      context.fillText(`x ${Number(x.toFixed(2))}`,Math.min(width-fontSize*6,px+3),3);
    }
    for (let y=Math.ceil(region.y/step)*step;y<=region.y+region.h;y+=step) {
      const py=(y-region.y)*scaleY;
      context.beginPath();context.moveTo(0,py);context.lineTo(width,py);context.stroke();
      context.fillText(`y ${Number(y.toFixed(2))}`,3,Math.min(height-fontSize-2,py+3));
    }
    context.restore();
    return step;
  }
  async function canvasAgentCompressedCanvas(source,policy,execution = null) {
    let canvas=source, encodeQuality=policy.quality, mediaType="image/webp";
    for (let attempt=0;attempt<10;attempt++) {
      let blob=await canvasAgentCanvasBlob(canvas,mediaType,mediaType === "image/webp" ? encodeQuality : undefined,execution);
      if (!blob && mediaType === "image/webp") {
        mediaType="image/png";
        blob=await canvasAgentCanvasBlob(canvas,mediaType,undefined,execution);
      }
      if (!blob) throw canvasAgentToolError("CAPTURE_ENCODING_FAILED","Canvas capture could not be encoded.");
      if (blob.type) mediaType=blob.type;
      if (blob.size<=policy.maxBytes) return {canvas,blob,encodeQuality,mediaType};
      const ratio=Math.max(.45,Math.min(.84,Math.sqrt(policy.maxBytes/blob.size)*.92)), next=document.createElement("canvas"),
        proposedWidth=Math.max(1,Math.floor(canvas.width*ratio)), proposedHeight=Math.max(1,Math.floor(canvas.height*ratio));
      next.width=canvas.width>1 ? Math.min(canvas.width-1,proposedWidth) : 1;
      next.height=canvas.height>1 ? Math.min(canvas.height-1,proposedHeight) : 1;
      if (next.width===canvas.width && next.height===canvas.height) break;
      next.getContext("2d").drawImage(canvas,0,0,next.width,next.height);
      canvas=next;
      if (mediaType === "image/webp") encodeQuality=Math.max(.5,encodeQuality-.08);
    }
    throw canvasAgentToolError("CAPTURE_TOO_LARGE","Canvas capture could not be compressed below the hard encoded-byte limit.",{maxBytes:policy.maxBytes});
  }
  async function canvasAgentCapture(args,options) {
    const {signal=null,assertCurrent=null,execution=null}=options||{};
    assertCurrent?.();
    const quality=args.quality === "detail" ? "detail" : "basic";
    if(quality === "detail"){
      if(args.target === "object"){
        const object=canvasAgentObject(String(args.objectId||""));
        if(!object)throw canvasAgentToolError("OBJECT_NOT_FOUND","Canvas object was not found.",{objectId:args.objectId});
        if(object.kind!=="widget")throw canvasAgentToolError("DETAIL_TARGET_REQUIRED","Detail capture is limited to one Widget or one explicit region.",{objectId:args.objectId,kind:object.kind});
      }else if(args.target!=="region")throw canvasAgentToolError("DETAIL_TARGET_REQUIRED","Detail capture is limited to one Widget or one explicit region.",{target:args.target});
    }
    const region = canvasAgentTargetRegion(args);
    if (!region) throw canvasAgentToolError("EMPTY_CAPTURE_REGION","The current viewport does not include the Canvas. Move back onto the Canvas, or capture an existing object or explicit region.",{target:args.target});
    const selection=args.target === "selection" ? state.selection : null,
      selectionSignature=selection ? JSON.stringify({box:selection.box,path:selectionPathFor(selection)}) : null;
    const policy=quality === "detail" ? CANVAS_AGENT_DETAIL_CAPTURE_POLICY : CANVAS_AGENT_LAYOUT_CAPTURE_POLICY,
      scale = Math.min(policy.maxLongEdge/Math.max(region.w,region.h),Math.sqrt(policy.maxPixels/(region.w*region.h))),
      width = Math.max(1,Math.floor(region.w*scale)), height = Math.max(1,Math.floor(region.h*scale)),
      canvas = document.createElement("canvas"), context = canvas.getContext("2d");
    canvas.width = width;
    canvas.height = height;
    const widgetCaptureDeadline=performance.now()+WIDGET_SNAPSHOT_TIMEOUT_MS;
    for(let attempt=0;attempt<3;attempt++){
      const remaining=widgetCaptureDeadline-performance.now();
      if(remaining<1000)throw canvasAgentToolError("WIDGET_CAPTURE_TIMEOUT","Canvas capture could not finish while Widgets were loading.");
      try{
        await prepareVisibleWidgetSnapshots(region,false,signal,false,remaining);
      }catch(error){
        assertCurrent?.();
        if(error?.code==="WIDGET_CONTENT_CHANGED"&&attempt<2)continue;
        throw error;
      }
      assertCurrent?.();
      const unavailable=capturableWidgets(region)
        .filter(widget=>!widget.snapshotImage||widget.snapshotVersion<widget.contentVersion);
      if(!unavailable.length)break;
      if(attempt<2&&unavailable.every(widget=>widget.snapshotImage&&widget.snapshotVersion<widget.contentVersion))continue;
      throw canvasAgentToolError(
        "WIDGET_CAPTURE_UNAVAILABLE",
        "Canvas capture stopped because one or more Widgets did not become ready. Refresh the Canvas and retry.",
        {objectIds:unavailable.map(widget=>widget.id)},
      );
    }
    context.fillStyle = state.paint.paper;
    context.fillRect(0,0,width,height);
    if (selection) {
      if (state.selection !== selection || selection.phase !== "active" || selectionSignature !== JSON.stringify({box:selection.box,path:selectionPathFor(selection)})) {
        throw canvasAgentToolError("SELECTION_CHANGED","The lasso changed while preparing its capture. Retry with the current selection.");
      }
      const rendered=renderSelectionImage(selection,policy.maxLongEdge);
      if (!rendered) throw canvasAgentToolError("EMPTY_CAPTURE_REGION","The lasso contains no capturable content.");
      context.drawImage(rendered.out,0,0,width,height);
    } else {
      context.save();
      context.scale(scale,scale);
      context.translate(-region.x,-region.y);
      drawAnimationsToContext(context,region);
      drawWidgetsToContext(context,region);
      drawImagesToContext(context,region,false);
      for (const item of state.textBoxes) if (intersection(textBoxBox(item),region)) context.drawImage(item.image,item.x,item.y,item.w,item.h);
      forTiles(region.x,region.y,region.w,region.h,(tileCanvas,tx,ty)=>context.drawImage(tileCanvas,tx*TILE,ty*TILE),false);
      drawSharpOverlays(context,region);
      // Lifted lasso ink lives outside the backing tiles until committed.
      if (state.selection?.phase === "active") drawSelectionContent(state.selection,context);
      context.restore();
    }
    const coordinates=["metadata","none"].includes(args.coordinates) ? args.coordinates : "grid", gridStep=coordinates === "grid" ? canvasAgentDrawCoordinateGrid(context,region,width,height) : canvasAgentGridStep(Math.max(region.w,region.h)),
      encoded=await canvasAgentCompressedCanvas(canvas,policy,execution);
    assertCurrent?.();
    const dataUrl=await canvasAgentReadDataUrl(encoded.blob,execution);
    assertCurrent?.();
    const finalWidth=encoded.canvas.width, finalHeight=encoded.canvas.height,
      scaleX=finalWidth/region.w, scaleY=finalHeight/region.h, viewFacts=canvasAgentViewFacts();
    return {
      dataUrl, mediaType:encoded.blob.type || encoded.mediaType, encodedBytes:encoded.blob.size,
      width:finalWidth,height:finalHeight,quality,coordinates,revision:state.userRevision,viewRevision:viewFacts.viewRevision,
      logicalRegion:{x:region.x,y:region.y,width:region.w,height:region.h},
      mapping:{origin:{x:region.x,y:region.y},pixelsPerLogicalUnit:{x:scaleX,y:scaleY},logicalUnitsPerPixel:{x:1/scaleX,y:1/scaleY}},
      compression:{policy:policy.id,format:encoded.blob.type||encoded.mediaType,quality:encoded.mediaType === "image/webp" ? Number(encoded.encodeQuality.toFixed(2)) : null,maxBytes:policy.maxBytes,automatic:true},
      sampling:{maxWidth:policy.maxLongEdge,maxHeight:policy.maxLongEdge,maxPixels:policy.maxPixels,pixelsPerLogicalUnit:Math.min(scaleX,scaleY),note:"Tighter logical regions receive more image pixels per Canvas unit."},
      coordinateGrid:{step:gridStep,labels:"absolute canvas logical coordinates",rendered:coordinates === "grid"},
    };
  }
  function canvasAgentSameInitialRegion(capture, digest) {
    const actual=capture?.logicalRegion, expected=digest?.canvas?.contentBounds || digest?.viewport;
    return actual && expected && ["x","y","width","height"].every(key=>Math.abs(Number(actual[key])-Number(expected[key]))<.01);
  }
  function canvasAgentDigestHasContent(digest) {
    const counts=digest?.counts||{};
    return Boolean(digest?.canvas?.contentBounds)||["inkTiles","widgets","textBoxes","images"].some(key=>Number(counts[key])>0);
  }
  async function canvasAgentInitialTurnState(submitExecution=null) {
    for (let attempt=0;attempt<3;attempt++) {
      if(submitExecution)canvasAgentAssertSubmitExecution(submitExecution);
      const before=canvasAgentDigest("objects");
      if(!canvasAgentDigestHasContent(before))return {digest:before,empty:true,...(typeof canvasDocumentsCurrent==="function"?{taskContext:canvasDocumentsCurrent().context||""}:{})};
      const capture=await canvasAgentCapture({target:"canvas",quality:"basic",coordinates:"none"},{
        signal:submitExecution?.controller.signal,
        assertCurrent:submitExecution?()=>canvasAgentAssertSubmitExecution(submitExecution):null,
      }), digest=canvasAgentDigest("objects");
      if (before.revision!==digest.revision || before.viewRevision!==digest.viewRevision || capture.revision!==digest.revision
        || capture.viewRevision!==digest.viewRevision || !canvasAgentSameInitialRegion(capture,digest)) continue;
      const match=/^data:(image\/(?:png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(capture.dataUrl||""));
      if(!match)throw canvasAgentToolError("CAPTURE_ENCODING_FAILED","The initial Canvas state could not be encoded.");
      const {dataUrl,...metadata}=capture, extension=match[1].slice("image/".length);
      return {
        digest,
        ...(typeof canvasDocumentsCurrent==="function"?{taskContext:canvasDocumentsCurrent().context||""}:{}),
        capture:{target:"canvas",...metadata},
        image:{mediaType:match[1],data:match[2],name:`penecho-initial-canvas.${extension}`},
      };
    }
    throw canvasAgentToolError("INITIAL_STATE_CHANGED","The Canvas changed while its initial state was being prepared. Try sending again.");
  }
  function canvasAgentObjectContent(object) {
    if (object.kind === "widget") return widgetEditContext(object.item,"agent");
    if (object.kind === "text") return {text:object.item.text,fontSize:object.item.fontSize,maxWidth:object.item.maxWidth,color:object.item.color};
    return canvasAgentObjectSummary(object);
  }
  async function canvasAgentInspect(args) {
    const viewFacts=canvasAgentViewFacts(), scope=["viewport","selection","region"].includes(args.scope) ? args.scope : "canvas",
      region=scope === "viewport" ? viewFacts.viewport : scope === "region" ? canvasAgentValidatedRegion(args.region) : null,
      selected=new Set(canvasAgentSelectionIds()), kinds=new Set(Array.isArray(args.kinds) ? args.kinds : []), all=canvasAgentAllObjects(), filtered=[];
    for (const summary of all) {
      if (kinds.size && !kinds.has(summary.kind)) continue;
      if (scope === "selection" && !selected.has(summary.id)) continue;
      if (region && !intersection(canvasAgentInternalRect(summary.box),region)) continue;
      const object=canvasAgentObject(summary.id), contentHash=args.detail === "metadata" ? await canvasAgentHash(canvasAgentObjectContent(object)) : null;
      filtered.push({...summary,...(contentHash ? {contentHash} : {})});
    }
    const start=Math.max(0,Number.parseInt(args.cursor,10)||0), limit=Math.max(1,Math.min(100,Number(args.limit)||60)), page=filtered.slice(start,start+limit), next=start+page.length;
    return {
      revision:state.userRevision,viewRevision:viewFacts.viewRevision,scope,
      mutationState:canvasAgentMutationState(),
      canvas:{width:SIZE,height:SIZE,contentBounds:canvasAgentExternalRect(canvasAgentContentBounds())},viewport:canvasAgentExternalRect(viewFacts.viewport),
      selection:{objectIds:[...selected],inkBounds:canvasAgentExternalRect(state.selection?.box)},counts:canvasAgentDigest("summary").counts,
      page:{cursor:String(start),nextCursor:next<filtered.length?String(next):null,returned:page.length,total:filtered.length},objects:page,
      ...(args.plannedWidget?{layoutProposal:canvasAgentPlanWidget(args.plannedWidget)}:{}),
      ...(scope !== "selection" && visibleInkBounds(region || {x:0,y:0,w:SIZE,h:SIZE}) ? {ink:{id:"ink",kind:"ink",box:canvasAgentExternalRect(visibleInkBounds(region || {x:0,y:0,w:SIZE,h:SIZE}))}} : {}),
    };
  }
  function canvasAgentLineNumberedResourceView(value,startLine=1) {
    return String(value??"").split(/\r\n|\r|\n/).map((line,index)=>`${String(startLine+index).padStart(6," ")}\t${line}`).join("\n");
  }
  function canvasAgentTerminalBoundary(raw,lines,end) {
    if (end !== lines.length || /(?:\r\n|\r|\n)$/.test(raw)) return null;
    const lastLine=String(lines.at(-1)??""), characters=Array.from(lastLine), trailing=characters.slice(-8);
    return {
      line:lines.length,
      characters:characters.length,
      trailingCodePoints:trailing.map(character=>`U+${character.codePointAt(0).toString(16).toUpperCase().padStart(4,"0")}`),
      note:"trailingCodePoints are the exact final source characters before EOF; JSON quotes outside content are delimiters, not source characters.",
    };
  }
  async function canvasAgentRead(args) {
    const object = canvasAgentObject(String(args.objectId || ""));
    if (!object) throw canvasAgentToolError("OBJECT_NOT_FOUND","Canvas object was not found.",{objectId:args.objectId});
    const item = object.item, base = canvasAgentObjectSummary(object);
    let resource=String(args.resource || "content"), value;
    if (object.kind === "widget") {
      let bundle=widgetEditContext(item,"agent");
      if(resource==="visual.artifacts"){
        if(item.sourceFormat!==VISUAL_EXPLAINER_SOURCE_FORMAT)throw canvasAgentToolError("RESOURCE_NOT_FOUND","visual.artifacts is available only for Visual Explainers.");
        let plan;try{plan=visualExplainerNormalizePlan(JSON.parse(item.copyText||""));}catch{throw canvasAgentToolError("INVALID_VISUAL_PLAN","Visual Explainer source is invalid.");}
        value=JSON.stringify((plan.artifacts||[]).map(artifact=>({id:artifact.id,title:artifact.title,sourceFormat:artifact.sourceFormat,frameworkVersion:artifact.frameworkVersion||null,refreshSeconds:artifact.refreshSeconds,htmlCharacters:artifact.html.length,regions:plan.regions.filter(region=>region.artifactId===artifact.id).map(region=>region.id)})),null,2)+"\n";
      }else if(resource.startsWith("artifact.widget.")){
        if(item.sourceFormat!==VISUAL_EXPLAINER_SOURCE_FORMAT||!args.artifactId)throw canvasAgentToolError("RESOURCE_NOT_FOUND","An artifactId from visual.artifacts is required.");
        let plan;try{plan=JSON.parse(item.copyText||"");}catch{throw canvasAgentToolError("INVALID_VISUAL_PLAN","Visual Explainer source is invalid.");}
        bundle=visualExplainerArtifactWidgetEdit(plan,args.artifactId,{x:item.x,y:item.y,w:item.w,h:item.h});
      }
      const hasDistinctSource=!bundle.sourceMirrorsHtml&&typeof bundle.source === "string"&&Boolean(bundle.source), manifest={tool:bundle.widgetType,pluginId:bundle.pluginId,title:bundle.title,refreshSeconds:bundle.widgetType === "diagram_source"?0:bundle.refreshSeconds||0,diagramKind:bundle.diagramKind||null,sourceFormat:bundle.sourceFormat||null,...(bundle.widgetType === "diagram_source"?{sourceFile:"widget.source"}:{frameworkVersion:bundle.frameworkVersion||null,htmlFile:"widget.html",copyTextFile:bundle.sourceMirrorsHtml?"widget.html":hasDistinctSource?"widget.source":null,copyLabel:hasDistinctSource?bundle.copyLabel||null:null})};
      if (resource === "widget.json") value=JSON.stringify(manifest,null,2)+"\n";
      else if (resource === "widget.html") value=String(bundle.html || "");
      else if (resource === "widget.source") value=String(bundle.widgetType === "diagram_source"?bundle.source||"":bundle.sourceMirrorsHtml?"":bundle.source||"");
      else if(resource==="artifact.widget.json")value=JSON.stringify(manifest,null,2)+"\n";
      else if(resource==="artifact.widget.html")value=String(bundle.html||"");
      else if(resource==="artifact.widget.source")value=String(bundle.sourceMirrorsHtml?"":bundle.source||"");
      else if(resource==="visual.artifacts"){}
      else { resource="content";value=JSON.stringify(bundle,null,2); }
    } else {
      if (resource !== "content") throw canvasAgentToolError("RESOURCE_NOT_FOUND",`${resource} is only available for widgets.`);
      value=object.kind === "text" ? item.text : JSON.stringify(base,null,2);
    }
    const revision=state.userRevision,
      sourceState=object.kind === "widget" && !args.artifactId && item.sourceFormat!==VISUAL_EXPLAINER_SOURCE_FORMAT ? canvasAgentWidgetSourceState(widgetEditContext(item,"agent")) : null,
      raw=String(value), lines=raw.split(/\r\n|\r|\n/), start=Math.max(1,Math.min(lines.length||1,Math.round(Number(args.startLine)||1))), end=Math.max(start,Math.min(lines.length,Math.round(Number(args.endLine)||(args.startLine?start+199:raw.length<=64000?lines.length:start+199)))), selected=lines.slice(start-1,end).join("\n"), numbered=canvasAgentLineNumberedResourceView(selected,start), maximum=200000, contentTruncated=numbered.length>maximum,
      lastCompleteBreak=numbered.lastIndexOf("\n",maximum),
      content=contentTruncated?(lastCompleteBreak<0?"":numbered.slice(0,lastCompleteBreak)):numbered,
      returnedEnd=contentTruncated?(content?start+content.split("\n").length-1:start-1):end,
      terminalBoundary=!contentTruncated?canvasAgentTerminalBoundary(raw,lines,end):null,
      [contentHash,sourceHash]=await Promise.all([canvasAgentHash(raw),sourceState?canvasAgentHash(sourceState):null]);
    return {
      revision,
      object:base,
      resource,
      contentHash,
      ...(sourceHash?{sourceHash}:{}),
      lineRange:{start,end:returnedEnd,total:lines.length,truncated:end<lines.length||contentTruncated},
      ...(contentTruncated?{nextStartLine:returnedEnd+1,...(!content?{lineTooLong:true}: {})}:{}),
      content,
      contentFormat:"nl -ba -w6 -s TAB",
      numbering:"The six-column line number and first ASCII TAB are display metadata. Use the number only for diff coordinates; never include either in context, removed, or added lines.",
      originalEndsWithNewline:/(?:\r\n|\r|\n)$/.test(raw),
      ...(terminalBoundary?{terminalBoundary}:{}),
    };
  }
  function canvasAgentMutationState() {
    // A region-only lasso holds context, not extracted ink or an Undo transaction.
    // Gesture and draft transactions still own pending snapshots until settled.
    const blockers=[], persistent=[],objectLocks=[];
    for (const [key,active] of [["drawing",state.drawing],["selection-gesture",state.selectionGesture||state.selection?.phase==="lasso"],
      ["image-gesture",state.imageGesture],
      ["widget-gesture",state.widgetGesture],["animation-gesture",state.animationGesture]]) if(active)blockers.push(key);
    if(state.selection&&!state.selection.regionOnly&&state.selection.phase!=="lasso"){blockers.push("selection-edit");persistent.push("selection-edit");}
    for(const [kind,edit,items] of [["image",state.imageEdit,state.images],["widget",state.widgetEdit,state.widgets],["animation",state.animationEdit,state.animations]]){
      const item=edit&&items.find(item=>item.id===edit.id);
      if(item&&(edit.changed||["x","y","w","h","contentW","contentH"].some(key=>key in edit.before&&item[key]!==edit.before[key])))objectLocks.push({objectId:edit.id,reason:`${kind}-edit`});
    }
    for(const editor of state.textEditors.values())if(editor.sourceTextBoxId)objectLocks.push({objectId:editor.sourceTextBoxId,reason:"text-draft"});
    const signature=JSON.stringify({blockers,objectLocks}), previous=canvasAgent.mutationObservation;
    if(!previous || previous.signature!==signature)canvasAgent.mutationObservation={signature,revision:(previous?.revision||0)+1};
    return {revision:canvasAgent.mutationObservation.revision,blockers,objectLocks,transient:blockers.length>0&&!persistent.length};
  }
  function canvasAgentMutationIdle(execution,objectIds=[]) {
    canvasAgentAssertToolExecution(execution);
    const source=execution?.assistContext?.owner?.inputTarget;
    if(source?.variant&&objectIds.includes(source.widget.id))throw canvasAgentToolError("READ_ONLY_SOURCE","This action creates a separate Widget. Preserve the source Widget unchanged.");
    const mutationState=canvasAgentMutationState();
    if(mutationState.blockers.length)throw canvasAgentToolError("CANVAS_BUSY",
      `Canvas changes are waiting for the active edit: ${mutationState.blockers.join(", ")}.`,
      {mutationGuard:"canvas-edit",mutationState,retry:mutationState.transient?"after_gesture":"after_state_change"});
    const locked=mutationState.objectLocks.filter(lock=>objectIds.includes(lock.objectId));
    if(locked.length)throw canvasAgentToolError("OBJECT_EDIT_CONFLICT","The requested object has an unfinished user edit. Other objects and new content remain writable.",{objectLocks:locked,retry:"after_object_edit",mutationState});
  }
  function canvasAgentBeginMutation(execution,objectIds=[]) {
    // Call only at a synchronous commit boundary, after asynchronous preparation.
    canvasAgentMutationIdle(execution,objectIds);
    const suspended=[];
    for(const [editKey,field,kind,snapshot] of [["widgetEdit","widgetHistoryBefore","widgets",serializedWidgets],["imageEdit","imageHistoryBefore","images",imageHistoryState],["animationEdit","animationHistoryBefore","animations",serializedAnimations]]){
      const edit=state[editKey];if(!edit)continue;
      const dirty=edit.changed||state[kind].some(item=>item.id===edit.id&&["x","y","w","h","contentW","contentH"].some(key=>key in edit.before&&item[key]!==edit.before[key]));
      const before=state[field]||(dirty?snapshot().map(item=>item.id===edit.id?{...item,...edit.before}:item):null);
      suspended.push({editKey,edit,field,kind,before,dirty});state[field]=null;
    }
    save();
    if (typeof recordDirtyHistoryBefore === "function") recordDirtyHistoryBefore();
    const previous=state.agentMutationHistory,transaction={entries:[]};state.agentMutationHistory=transaction;
    return ()=>{
      state.agentMutationHistory=previous;
      if (execution && transaction.entries.length) execution.canvasWritten = true;
      for(const pending of suspended){
        if(state[pending.editKey]!==pending.edit)continue;
        let before=pending.before;
        for(const entry of transaction.entries){
          const ids=entry.objectScope?.[pending.kind]||[];
          if(before&&ids.length)before=canvasHistoryMergeObjects(before,entry[pending.kind+"After"],ids);
          if(ids.includes(pending.edit.id)){
            const item=state[pending.kind].find(item=>item.id===pending.edit.id);
            if(item){for(const key of Object.keys(pending.edit.before))if(key in item)pending.edit.before[key]=item[key];pending.edit.beforeIndex=state[pending.kind].indexOf(item);}
            else {state[pending.editKey]=null;const selected="selected"+pending.kind.slice(0,1).toUpperCase()+pending.kind.slice(1,-1)+"Id";state[selected]=null;}
          }
        }
        if(state[pending.editKey]){
          state[pending.field]=pending.dirty?before:null;
          if(pending.dirty)pending.edit.changed=true;
          pending.edit.beforeFrontCanvasObjectKind=state.frontCanvasObjectKind;
          pending.edit.beforeFrontPlacedCanvasObjectKind=state.frontPlacedCanvasObjectKind;
        }
      }
      updateHistoryButtons();
    };
  }
  function canvasAgentFinite(value,name) {
    const number = Number(value);
    if (!Number.isFinite(number)) throw canvasAgentToolError("INVALID_ARGUMENT",`${name} must be a finite number.`);
    return number;
  }
  function canvasAgentPlacementBox(width,height,placement,reserved=[],execution=null) {
    // A preplanned absolute slot needs no second global occupancy scan.
    if(placement?.mode === "absolute"){
      const w=Math.max(1,Math.min(SIZE,width)),h=Math.max(1,Math.min(SIZE,height));
      return {x:Math.max(0,Math.min(SIZE-w,canvasAgentFinite(placement.x,"placement.x"))),y:Math.max(0,Math.min(SIZE-h,canvasAgentFinite(placement.y,"placement.y"))),w,h,placement:"absolute",crowded:false};
    }
    if(execution?.assistContext && placement?.mode!=="relative") {
      canvasAgentAssertToolExecution(execution);
      const doc=canvasDocumentsCurrent(),plan=canvasDocumentsPlace(doc,width,height,null,null,true,execution,reserved);
      return {x:plan.placement.x,y:plan.placement.y,w:width,h:height,placement:"auto:source",crowded:false,sourcePlacement:plan.sourcePlacement,offViewport:plan.sourcePlacement?.inViewport===false};
    }
    const visible=viewportRect() || {x:SIZE/2-800,y:SIZE/2-600,w:1600,h:1200}, gap=Math.max(24,Math.min(400,Number(placement?.gap)||Math.max(40,24/state.scale))),
      nonObjectBounds=[visibleInkBounds({x:0,y:0,w:SIZE,h:SIZE}),animationBounds()].filter(Boolean),
      w=Math.max(1,Math.min(SIZE,width)),h=Math.max(1,Math.min(SIZE,height)), occupied=[...canvasAgentAllObjects().map(item=>canvasAgentInternalRect(item.box)),...nonObjectBounds,...reserved],
      clamp=(candidate)=>({x:Math.max(0,Math.min(SIZE-w,candidate.x)),y:Math.max(0,Math.min(SIZE-h,candidate.y)),w,h}),
      clear=(candidate)=>!occupied.some(box=>intersection({x:candidate.x-gap,y:candidate.y-gap,w:candidate.w+gap*2,h:candidate.h+gap*2},box));
    if (placement?.mode === "relative") {
      const anchor=canvasAgentObject(String(placement.anchorObjectId || ""));
      if (!anchor) throw canvasAgentToolError("ANCHOR_NOT_FOUND","Relative placement anchor was not found.",{anchorObjectId:placement.anchorObjectId});
      const box=canvasAgentBox(anchor), relation=["left","above","below"].includes(placement.relation)?placement.relation:"right", align=["start","end"].includes(placement.align)?placement.align:"center";
      let x=relation === "right" ? box.x+box.w+gap : relation === "left" ? box.x-w-gap : align === "start" ? box.x : align === "end" ? box.x+box.w-w : box.x+(box.w-w)/2,
        y=relation === "below" ? box.y+box.h+gap : relation === "above" ? box.y-h-gap : align === "start" ? box.y : align === "end" ? box.y+box.h-h : box.y+(box.h-h)/2,
        candidate=clamp({x,y});
      if (clear(candidate)) return {...candidate,placement:`relative:${relation}`,crowded:false};
    }
    const stage={x:Math.max(0,visible.x),y:Math.max(0,visible.y),w:Math.min(SIZE-visible.x,visible.w),h:Math.min(SIZE-visible.y,visible.h)}, center={x:stage.x+stage.w/2,y:stage.y+stage.h/2},autoAlign=["start","center","end"].includes(placement?.align)?placement.align:null,
      candidateDistance=candidate=>autoAlign==="start"?Math.hypot(candidate.x-stage.x,candidate.y-stage.y):autoAlign==="end"?Math.hypot(candidate.x+candidate.w-(stage.x+stage.w),candidate.y+candidate.h-(stage.y+stage.h)):Math.hypot(candidate.x+candidate.w/2-center.x,candidate.y+candidate.h/2-center.y),
      rankCandidates=(a,b)=>autoAlign?candidateDistance(a)-candidateDistance(b)||a.y-b.y||a.x-b.x:a.y-b.y||a.x-b.x,
      candidates=[],seen=new Set(),add=(x,y)=>{const candidate=clamp({x,y}),key=`${Math.round(candidate.x)}:${Math.round(candidate.y)}`;if(candidate.x<stage.x||candidate.y<stage.y||candidate.x+w>stage.x+stage.w||candidate.y+h>stage.y+stage.h||seen.has(key))return;seen.add(key);candidates.push(candidate);};
    add(stage.x,stage.y);add(stage.x+stage.w-w,stage.y);add(stage.x,stage.y+stage.h-h);add(stage.x+stage.w-w,stage.y+stage.h-h);add(stage.x+(stage.w-w)/2,stage.y+(stage.h-h)/2);
    for(const box of occupied){add(box.x+box.w+gap,box.y);add(box.x-w-gap,box.y);add(box.x,box.y+box.h+gap);add(box.x,box.y-h-gap);add(box.x+box.w+gap,box.y+(box.h-h)/2);add(box.x+(box.w-w)/2,box.y+box.h+gap);}
    candidates.sort(rankCandidates);
    for(const candidate of candidates)if(clear(candidate))return {...candidate,placement:"auto",crowded:false};
    const xs=[stage.x,stage.x+stage.w-w,...occupied.flatMap(box=>[box.x+box.w+gap,box.x-w-gap])].filter(x=>x>=stage.x&&x+w<=stage.x+stage.w).sort((a,b)=>a-b).slice(0,96),
      ys=[stage.y,stage.y+stage.h-h,...occupied.flatMap(box=>[box.y+box.h+gap,box.y-h-gap])].filter(y=>y>=stage.y&&y+h<=stage.y+stage.h).sort((a,b)=>a-b).slice(0,96);
    const gridCandidates=[];for(const y of ys)for(const x of xs)gridCandidates.push(clamp({x,y}));gridCandidates.sort(rankCandidates);
    for(const candidate of gridCandidates)if(clear(candidate))return {...candidate,placement:"auto",crowded:false};
    const canvasCandidates=[],canvasSeen=new Set(),addCanvas=(x,y)=>{const candidate=clamp({x,y}),key=`${Math.round(candidate.x)}:${Math.round(candidate.y)}`;if(canvasSeen.has(key))return;canvasSeen.add(key);canvasCandidates.push(candidate);},content=canvasAgentContentBounds();
    addCanvas(center.x-w/2,center.y-h/2);addCanvas(0,0);addCanvas(SIZE-w,0);addCanvas(0,SIZE-h);addCanvas(SIZE-w,SIZE-h);
    for(const box of [...(content?[content]:[]),...occupied]){
      for(const alignX of [box.x,box.x+(box.w-w)/2,box.x+box.w-w]){addCanvas(alignX,box.y-h-gap);addCanvas(alignX,box.y+box.h+gap);}
      for(const alignY of [box.y,box.y+(box.h-h)/2,box.y+box.h-h]){addCanvas(box.x-w-gap,alignY);addCanvas(box.x+box.w+gap,alignY);}
    }
    const fullXs=[0,SIZE-w,center.x-w/2,...occupied.flatMap(box=>[box.x-w-gap,box.x+box.w+gap])].map(x=>clamp({x,y:0}).x).filter((x,index,array)=>array.indexOf(x)===index).slice(0,128),
      fullYs=[0,SIZE-h,center.y-h/2,...occupied.flatMap(box=>[box.y-h-gap,box.y+box.h+gap])].map(y=>clamp({x:0,y}).y).filter((y,index,array)=>array.indexOf(y)===index).slice(0,128);
    for(const y of fullYs)for(const x of fullXs)addCanvas(x,y);
    canvasCandidates.sort(autoAlign?rankCandidates:(a,b)=>Math.hypot(a.x+a.w/2-center.x,a.y+a.h/2-center.y)-Math.hypot(b.x+b.w/2-center.x,b.y+b.h/2-center.y)||a.y-b.y||a.x-b.x);
    for(const candidate of canvasCandidates)if(clear(candidate))return {...candidate,placement:"auto:canvas",crowded:false,offViewport:!(candidate.x>=visible.x&&candidate.y>=visible.y&&candidate.x+w<=visible.x+visible.w&&candidate.y+h<=visible.y+visible.h)};
    return {...clamp({x:center.x-w/2,y:center.y-h/2}),placement:"auto",crowded:true,offViewport:w>visible.w||h>visible.h};
  }

  function canvasAgentPlanWidget(value) {
    value=value||{};
    const width=Math.max(300,Math.min(SIZE,Number(value.width)||1200)),height=Math.max(200,Math.min(SIZE,Number(value.height)||800)),placed=canvasAgentPlacementBox(width,height,value.placement),box={x:placed.x,y:placed.y,w:placed.w,h:placed.h},frame=canvasAgentFramePlan(box,48),scale=frame.scale,allObjects=canvasAgentAllObjects(),
      sourceTarget=screenPx=>Number((screenPx/Math.max(.03,scale)).toFixed(1)),sourceValue=(name,fallback)=>Number.isFinite(Number(value[name]))?Number(value[name]):fallback,
      bodyPx=sourceValue("bodyPx",18),captionPx=sourceValue("captionPx",15),titlePx=sourceValue("titlePx",52),screenValue=sourcePx=>Number((sourcePx*scale).toFixed(1)),
      capturePadding=Math.max(40,Math.min(240,Math.round(Math.max(width,height)*.06))),capture={x:Math.max(0,box.x-capturePadding),y:Math.max(0,box.y-capturePadding)},nearbyRegion={x:box.x-width*.25,y:box.y-height*.25,w:width*1.5,h:height*1.5},nearby=allObjects.filter(object=>intersection(canvasAgentInternalRect(object.box),nearbyRegion)).map(object=>({id:object.id,kind:object.kind,box:object.box})),overlaps=allObjects.filter(object=>intersection(canvasAgentInternalRect(object.box),box)).map(object=>object.id),inkBounds=visibleInkBounds({x:0,y:0,w:SIZE,h:SIZE}),motionBounds=animationBounds();
    capture.width=Math.min(SIZE-capture.x,width+capturePadding*2);capture.height=Math.min(SIZE-capture.y,height+capturePadding*2);
    return {
      requested:{width,height,typography:{bodyPx,captionPx,titlePx}},
      proposed:{box:canvasAgentExternalRect(box),createPlacement:{mode:"absolute",x:box.x,y:box.y},placement:placed.placement,crowded:Boolean(placed.crowded),offViewport:Boolean(placed.offViewport),overlappingObjectIds:overlaps},
      context:{canvasContentBounds:canvasAgentExternalRect(canvasAgentContentBounds()),currentViewport:canvasAgentExternalRect(viewportRect()),nearbyObjects:nearby,inkBounds:canvasAgentExternalRect(inkBounds),animationBounds:canvasAgentExternalRect(motionBounds)},
      focusedView:{padding:48,unobscuredScreenStage:{x:frame.stage.x,y:frame.stage.y,width:frame.stage.w,height:frame.stage.h},scale:Number(scale.toFixed(4)),displayedSize:{width:Number((width*scale).toFixed(1)),height:Number((height*scale).toFixed(1))}},
      sizeAssessment:{fitsLogicalCanvas:box.x>=0&&box.y>=0&&box.x+width<=SIZE&&box.y+height<=SIZE,fitsUnobscuredStageAt100Percent:scale>=1,unobscuredBoxAt100Percent:{width:Math.max(1,Math.round(frame.stage.w-96)),height:Math.max(1,Math.round(frame.stage.h-96))},guidance:"Choose width and height from semantic density. If a readable document needs more height, use empty Canvas space and pan the Canvas; do not shrink meaningful text merely to force all content into one screen."},
      typography:{basis:"Estimated screen px after the proposed Widget is automatically focused; verify the rendered Widget with diagnostics and a viewport capture.",screenPerSourcePx:Number(scale.toFixed(4)),predicted:{bodyPx:screenValue(bodyPx),captionPx:screenValue(captionPx),titlePx:screenValue(titlePx)},targets:{comfortableBodyPx:CANVAS_AGENT_COMFORT_BODY_PX,preferredBodyMinimumPx:CANVAS_AGENT_PREFERRED_BODY_MIN_PX,compactSupportingTextMinimumPx:CANVAS_AGENT_COMPACT_TEXT_MIN_PX},sourcePxTargetsAtFocusedView:{comfortableBody:sourceTarget(CANVAS_AGENT_COMFORT_BODY_PX),preferredMinimumBody:sourceTarget(CANVAS_AGENT_PREFERRED_BODY_MIN_PX),compactSupportingText:sourceTarget(CANVAS_AGENT_COMPACT_TEXT_MIN_PX)},readableAtFocusedView:screenValue(bodyPx)>=CANVAS_AGENT_PREFERRED_BODY_MIN_PX},
      suggestedCapture:{target:"region",region:capture,quality:"basic",coordinates:"grid"},
      note:"A complete-Canvas overview validates composition but may intentionally render text very small. Judge local typography from the focused viewport estimate and post-render viewport/detail evidence, not from the whole-Canvas thumbnail alone.",
    };
  }
  function canvasAgentRecordChange(changeId,historyEntry,execution=null) {
    canvasAgent.latestChange=historyEntry ? {changeId:String(changeId || ""),revision:state.userRevision,historyEntry} : null;
    if (historyEntry && execution) execution.canvasWritten = true;
  }
  function canvasAgentWidgetPluginAllowed(pluginId,widgetType) {
    if(widgetType==="diagram_source")return pluginId==="flowchart"&&pluginEnabled("flowchart")&&pluginManifests.has("flowchart");
    const definition=PLUGIN_DEFINITIONS.find(plugin=>plugin.id===pluginId),canvasAgentPlugin=pluginId==="general"||pluginId==="flowchart"||definition?.builtIn===false;
    return canvasAgentPlugin&&pluginEnabled(pluginId)&&pluginManifests.has(pluginId);
  }
  async function canvasAgentPrepareCreateItems(items,execution=null) {
    if (!Array.isArray(items)||!items.length||items.length>24) throw canvasAgentToolError("INVALID_BATCH","Provide between 1 and 24 create items.");
    // Note cards arrive as a note source; PenEcho renders the card Widget.
    items=items.map(item=>{
      if(item?.type!=="note")return item;
      try{return noteCardCreateItem(item,"agent");}
      catch(error){throw canvasAgentToolError("INVALID_NOTE_CARD",String(error?.message||error));}
    });
    const requested={widget:items.filter(item=>item?.type === "widget").length,text:items.filter(item=>item?.type === "text").length,image:items.filter(item=>["image","plot"].includes(item?.type)).length};
    if(state.widgets.length+requested.widget>MAX_VISIBLE_WIDGETS||state.textBoxes.length+requested.text>MAX_VISIBLE_TEXT_BOXES||state.images.length+requested.image>MAX_VISIBLE_IMAGES)throw canvasAgentToolError("OBJECT_LIMIT","This Canvas is full. Continue on a new Canvas, or remove unused objects first.",{requested});
    if (!state.pluginCatalogLoaded) await loadPluginDocuments();
    const visible=viewportRect() || {x:SIZE/2-800,y:SIZE/2-600,w:1600,h:1200}, prepared=[],reserved=[];
    for (const raw of items) {
      const type=String(raw?.type || "");
      if (type === "text") {
        const fontSize=Number.isFinite(Number(raw.fontSize))?Number(raw.fontSize):(execution?.assistContext?20/(execution.assistContext.scale||1):38),maxWidth=Number.isFinite(Number(raw.maxWidth))?Number(raw.maxWidth):Math.max(fontSize*3,Math.min(900,visible.w*.65));
        const record=await renderedTextBoxRecord({text:String(raw.text||""),x:0,y:0,fontSize,maxWidth,fontFamily:state.aiFont,color:typeof raw.color === "string"?raw.color:state.inkColor});
        if(!record)throw canvasAgentToolError("INVALID_TEXT","Text content or geometry was rejected.");
        const placed=canvasAgentPlacementBox(record.w,record.h,raw.placement,reserved,execution);record.x=Math.round(placed.x);record.y=Math.round(placed.y);reserved.push(canvasAgentBox({kind:"text",item:record}));prepared.push({type,kind:"text",record,placed});
      } else if (type === "widget") {
        const widgetType=String(raw.widgetType||"");
        if(!["html_widget","diagram_source"].includes(widgetType))throw canvasAgentToolError("CAPABILITY_UNAVAILABLE",`Widget type ${widgetType||"(missing)"} is unavailable to PenEcho Agent.`);
        const pluginId=String(raw.pluginId || (widgetType === "diagram_source"?"flowchart":"general")),frameworkVersion=String(raw.frameworkVersion||"").trim();
        if(widgetType === "diagram_source"||pluginId === "flowchart"||frameworkVersion.startsWith("penecho-professional-diagrams"))throw canvasAgentToolError("CAPABILITY_UNAVAILABLE","PenEcho Agent may edit an existing Professional Diagram, but it cannot create a new Professional Diagram.");
        if(!canvasAgentWidgetPluginAllowed(pluginId,widgetType))throw canvasAgentToolError("CAPABILITY_UNAVAILABLE",`Plugin ${pluginId} is unavailable, disabled, or not available to PenEcho Agent.`);
        const width=Math.max(execution?.widgetContentViewport?1:300,Math.min(SIZE,Number(raw.width)||Math.max(600,Math.min(1200,visible.w*.7)))),height=Math.max(execution?.widgetContentViewport?1:200,Math.min(SIZE,Number(raw.height)||Math.max(400,Math.min(800,visible.h*.7)))),placed=canvasAgentPlacementBox(width,height,raw.placement,reserved,execution),
          record=widgetRecord({tool:widgetType,widgetType,pluginId,x:placed.x,y:placed.y,w:width,h:height,contentW:execution?.widgetContentViewport?.width??width,contentH:execution?.widgetContentViewport?.height??height,title:String(raw.title||"Canvas widget"),refreshSeconds:Number.isFinite(Number(raw.refreshSeconds))?Number(raw.refreshSeconds):0,html:typeof raw.html === "string"?raw.html:"",source:typeof raw.source === "string"?raw.source:"",sourceFormat:raw.sourceFormat,diagramKind:raw.diagramKind,frameworkVersion:raw.frameworkVersion,copyText:raw.copyText,copyLabel:raw.copyLabel});
        if(!record)throw canvasAgentToolError("INVALID_WIDGET","Widget content or geometry was rejected. Read the plugin capability contract and retry.");
        reserved.push(canvasAgentBox({kind:"widget",item:record}));prepared.push({type,kind:"widget",record,placed});
      } else if (type === "image") {
        const match=/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(String(raw._imageDataUrl||""));
        if(!match)throw canvasAgentToolError("ATTACHMENT_UNAVAILABLE","Image attachment bytes were not provided by the trusted host.");
        const bytes=Uint8Array.from(atob(match[2]),character=>character.charCodeAt(0)), imported=await prepareImportedImage(new File([bytes],String(raw._imageName||"image"),{type:match[1]})), naturalRatio=imported.naturalW/imported.naturalH;
        let width=Number(raw.width),height=Number(raw.height);
        if(!Number.isFinite(width)&&!Number.isFinite(height)){const fit=importedImagePlacement(imported.naturalW,imported.naturalH);width=fit.w;height=fit.h;}
        else if(!Number.isFinite(width))width=height*naturalRatio;else if(!Number.isFinite(height))height=width/naturalRatio;
        width=Math.max(80,Math.min(SIZE,width));height=Math.max(80,Math.min(SIZE,height));const placed=canvasAgentPlacementBox(width,height,raw.placement,reserved,execution),record=imageRecord({...imported,x:placed.x,y:placed.y,w:width,h:height,sourceName:String(raw._imageName||"")});
        if(!record)throw canvasAgentToolError("INVALID_IMAGE","Image content or geometry was rejected.");
        reserved.push(canvasAgentBox({kind:"image",item:record}));prepared.push({type,kind:"image",record,placed});
      } else if (type === "plot") {
        const expression=String(raw.expression||"").trim(),preparedPlot=await plotObjectImage({expression,w:Math.max(240,Math.min(2400,Number(raw.width)||900)),h:Math.max(200,Math.min(1800,Number(raw.height)||650)),color:typeof raw.color === "string"?raw.color:state.inkColor,title:String(raw.title||raw.expression||"")}),
          width=preparedPlot.logicalWidth,height=preparedPlot.logicalHeight,placed=canvasAgentPlacementBox(width,height,raw.placement,reserved,execution),record=imageRecord({image:preparedPlot.image,blob:preparedPlot.blob,x:placed.x,y:placed.y,w:width,h:height,naturalW:preparedPlot.image.width,naturalH:preparedPlot.image.height,sourceName:"",plotExpression:expression});
        if(!record)throw canvasAgentToolError("INVALID_PLOT","Function plot content or geometry was rejected.");
        reserved.push(canvasAgentBox({kind:"image",item:record}));prepared.push({type,kind:"image",record,placed});
      } else if (["formula","drawing"].includes(type)) {
        let image,x=0,y=0;
        if(type === "formula")image=await formulaImage(String(raw.latex||""),Number(raw.fontSize)||64,typeof raw.color === "string"?raw.color:state.inkColor);
        else {const normalized=DRAW?.normalize({...raw.drawing,tool:"draw"},SIZE),made=normalized?DRAW.render(normalized,offscreen,typeof raw.color === "string"?raw.color:state.inkColor):null;if(made){image=made.image;x=made.x;y=made.y;}}
        if(!image)throw canvasAgentToolError("INVALID_INK_CONTENT",`${type} could not be rendered.`);
        const width=image.logicalWidth||image.width,height=image.logicalHeight||image.height,placed=raw.placement?canvasAgentPlacementBox(width,height,raw.placement,reserved,execution):canvasAgentPlacementBox(width,height,type==="formula"&&execution?.assistContext?null:{mode:"absolute",x,y},reserved,execution);
        reserved.push({x:placed.x,y:placed.y,w:width,h:height});prepared.push({type,kind:"ink",image,x:placed.x,y:placed.y,w:width,h:height,placed});
      } else throw canvasAgentToolError("UNSUPPORTED_CREATE_TYPE",`Unsupported create type: ${type || "(missing type)"}.`);
    }
    return prepared;
  }
  async function canvasAgentCreate(args,execution) {
    canvasAgentAssertRevision(args.baseRevision);canvasAgentMutationIdle(execution);const prepared=await canvasAgentPrepareCreateItems(args.items,execution);canvasAgentAssertRevision(args.baseRevision);canvasAgentAssertToolExecution(execution);const restoreMutation=canvasAgentBeginMutation(execution,[]);try {save();
    const kinds=new Set(prepared.map(item=>item.kind));if(kinds.has("widget"))state.widgetHistoryBefore=serializedWidgets();if(kinds.has("text"))state.textBoxHistoryBefore=textBoxHistoryState();if(kinds.has("image"))state.imageHistoryBefore=imageHistoryState();
    const receipts=[];
    for(const item of prepared){
      if(item.kind === "widget"){state.widgets.push(item.record);mountWidget(item.record);receipts.push({type:item.type,status:"created",objectId:item.record.id,box:canvasAgentExternalRect(canvasAgentBox({kind:"widget",item:item.record})),placement:item.placed.placement,crowded:item.placed.crowded,offViewport:Boolean(item.placed.offViewport),sourcePlacement:mcpSourcePlacement(execution?.assistContext,{x:item.record?.x??item.x,y:item.record?.y??item.y,w:item.record?.w??item.w,h:item.record?.h??item.h},32/(execution?.assistContext?.scale||state.scale))});}
      else if(item.kind === "text"){state.textBoxes.push(item.record);receipts.push({type:item.type,status:"created",objectId:item.record.id,box:canvasAgentExternalRect(canvasAgentBox({kind:"text",item:item.record})),placement:item.placed.placement,crowded:item.placed.crowded,offViewport:Boolean(item.placed.offViewport),sourcePlacement:mcpSourcePlacement(execution?.assistContext,{x:item.record?.x??item.x,y:item.record?.y??item.y,w:item.record?.w??item.w,h:item.record?.h??item.h},32/(execution?.assistContext?.scale||state.scale))});}
      else if(item.kind === "image"){state.images.push(item.record);receipts.push({type:item.type,status:"created",objectId:item.record.id,box:canvasAgentExternalRect(canvasAgentBox({kind:"image",item:item.record})),placement:item.placed.placement,crowded:item.placed.crowded,offViewport:Boolean(item.placed.offViewport),sourcePlacement:mcpSourcePlacement(execution?.assistContext,{x:item.record?.x??item.x,y:item.record?.y??item.y,w:item.record?.w??item.w,h:item.record?.h??item.h},32/(execution?.assistContext?.scale||state.scale))});}
      else {blitSized(item.image,item.x,item.y,item.w,item.h);receipts.push({type:item.type,status:"created",region:{x:item.x,y:item.y,width:item.w,height:item.h},placement:item.placed.placement,crowded:item.placed.crowded,offViewport:Boolean(item.placed.offViewport),sourcePlacement:mcpSourcePlacement(execution?.assistContext,{x:item.record?.x??item.x,y:item.record?.y??item.y,w:item.record?.w??item.w,h:item.record?.h??item.h},32/(execution?.assistContext?.scale||state.scale))});}
    }
    state.userRevision++;const entry=save(),changeId=String(args._changeId||canvasClientId());canvasAgentRecordChange(changeId,entry,execution);
    for (const item of prepared) if (item.kind === "widget") item.record.autoContentHeight = {
      start:widgetLayout(item.record), html:item.record.html, historyEntry:entry, documentReady:false,
      defaultContentHeight:mcpPresentationSize({}).contentHeight || item.record.contentH,
    };
    const singleWidget=prepared.length===1&&prepared[0].kind==="widget"?prepared[0]:null,viewResult=singleWidget&&!execution?.preserveView?canvasAgentFrameRegion(canvasAgentBox({kind:"widget",item:singleWidget.record}),48):null;
    if(!viewResult){requestRender();canvasAgentSyncState();}
    return{ok:true,previousRevision:args.baseRevision,revision:state.userRevision,changeId,receipts,...(viewResult?{viewport:viewResult.viewport}:{}),summary:String(args.summary||"")};
    }finally{restoreMutation();}
  }
  async function canvasAgentVisualExplainerCreate(args,execution) {
    const item=visualExplainerWidgetItem(args.plan,{title:args.title,width:args.width,height:args.height,placement:args.placement}),
      result=await canvasAgentCreate({baseRevision:args.baseRevision,items:[item],summary:args.summary,_changeId:args._changeId},execution),
      objectId=result.receipts?.[0]?.objectId,object=objectId?canvasAgentObject(objectId):null,
      diagnostics=object?.kind === "widget"?await visualExplainerWaitForDiagnostics(object.item):null;
    canvasAgentAssertToolExecution(execution);
    return {...result,visualExplainer:{objectId,frameworkVersion:VISUAL_EXPLAINER_FRAMEWORK_VERSION,diagnostics}};
  }
  async function canvasAgentVisualExplainerUpdate(args,execution) {
    canvasAgentAssertRevision(args.baseRevision);canvasAgentMutationIdle(execution);
    const object=canvasAgentObject(String(args.objectId||""));
    if(!object||object.kind!=="widget")throw canvasAgentToolError("OBJECT_NOT_FOUND","Visual Explainer Widget was not found.",{objectId:args.objectId});
    if(object.item.widgetType!=="html_widget"||object.item.pluginId!=="general"||object.item.sourceFormat!==VISUAL_EXPLAINER_SOURCE_FORMAT)throw canvasAgentToolError("KIND_MISMATCH","The target is not a PenEcho Visual Explainer Widget.",{objectId:args.objectId});
    const previousDiagnostics=object.item.visualDiagnostics?structuredClone(object.item.visualDiagnostics):await visualExplainerWaitForDiagnostics(object.item,1200),
      generated=visualExplainerWidgetItem(args.plan,{title:args.title||object.item.title}),currentEdit=widgetEditContext(object.item,"agent"),expectedHash=await canvasAgentHash(currentEdit),
      command={tool:"html_widget",widgetType:"html_widget",pluginId:"general",title:generated.title,refreshSeconds:0,html:generated.html,sourceFormat:generated.sourceFormat,frameworkVersion:generated.frameworkVersion,copyText:generated.copyText,copyLabel:generated.copyLabel,x:object.item.x,y:object.item.y,w:object.item.w,h:object.item.h};
    canvasAgentAssertToolExecution(execution);
    const result=await canvasAgentReplaceWidget({objectId:object.item.id,baseRevision:args.baseRevision,expectedHash,changeId:args._changeId,command},execution),updated=canvasAgentObject(object.item.id),
      diagnostics=updated?.kind === "widget"?await visualExplainerWaitForDiagnostics(updated.item):null;
    canvasAgentAssertToolExecution(execution);
    return {...result,summary:String(args.summary||""),visualExplainer:{objectId:object.item.id,frameworkVersion:VISUAL_EXPLAINER_FRAMEWORK_VERSION,previousDiagnostics,diagnostics}};
  }
  async function canvasAgentPrepareEditOperations(operations) {
    if(!Array.isArray(operations)||!operations.length||operations.length>40)throw canvasAgentToolError("INVALID_BATCH","Provide between 1 and 40 edit operations.");
    const prepared=[],touched=new Set();
    for(const raw of operations){
      const type=String(raw?.type||"");
      if(type === "erase_ink"){prepared.push({type,kind:"ink",region:canvasAgentValidatedRegion(raw.region)});continue;}
      if(type === "arrange_objects"){
        const ids=[...new Set(Array.isArray(raw.objectIds)?raw.objectIds.map(String):[])];if(!ids.length)throw canvasAgentToolError("INVALID_ARGUMENT","arrange_objects requires objectIds.");
        const objects=ids.map(id=>{const object=canvasAgentObject(id);if(!object)throw canvasAgentToolError("OBJECT_NOT_FOUND",`Canvas object ${id} was not found.`);if(touched.has(id))throw canvasAgentToolError("DUPLICATE_TARGET",`Canvas object ${id} is modified more than once.`);touched.add(id);return object;}),gap=Math.max(0,Number.isFinite(Number(raw.gap))?Number(raw.gap):48),layout=["column","grid"].includes(raw.layout)?raw.layout:"row",columns=layout === "grid"?Math.max(1,Math.min(objects.length,Number(raw.columns)||Math.ceil(Math.sqrt(objects.length)))):layout === "column"?1:objects.length,
          boxes=objects.map(canvasAgentBox),cellW=Math.max(...boxes.map(box=>box.w)),cellH=Math.max(...boxes.map(box=>box.h)),origin=raw.origin&&Number.isFinite(Number(raw.origin.x))&&Number.isFinite(Number(raw.origin.y))?{x:Number(raw.origin.x),y:Number(raw.origin.y)}:{x:Math.min(...boxes.map(box=>box.x)),y:Math.min(...boxes.map(box=>box.y))},positions=[];
        objects.forEach((object,index)=>{const row=Math.floor(index/columns),column=index%columns,box=canvasAgentBox(object),x=origin.x+column*(cellW+gap),y=origin.y+row*(cellH+gap);if(x<0||y<0||x+box.w>SIZE||y+box.h>SIZE)throw canvasAgentToolError("INVALID_GEOMETRY","Arranged objects would leave the canvas.");positions.push({object,x,y});});prepared.push({type,kind:"arrange",positions});continue;
      }
      const objectId=String(raw?.objectId||""),object=canvasAgentObject(objectId);if(!object)throw canvasAgentToolError("OBJECT_NOT_FOUND",`Canvas object ${objectId||"(missing id)"} was not found.`);if(touched.has(objectId))throw canvasAgentToolError("DUPLICATE_TARGET",`Canvas object ${objectId} is modified more than once.`);touched.add(objectId);
      if(type === "update_text"){
        if(object.kind !== "text")throw canvasAgentToolError("KIND_MISMATCH","update_text requires a text object.");const record=await renderedTextBoxRecord({...object.item,id:object.item.id,text:typeof raw.text === "string"?raw.text:object.item.text,fontSize:Number.isFinite(Number(raw.fontSize))?Number(raw.fontSize):object.item.fontSize,maxWidth:Number.isFinite(Number(raw.maxWidth))?Number(raw.maxWidth):object.item.maxWidth,color:typeof raw.color === "string"?raw.color:object.item.color});if(!record)throw canvasAgentToolError("INVALID_TEXT","Updated text was rejected.");prepared.push({type,kind:"text",object,record});
      }else if(type === "move_object"){
        const box=canvasAgentBox(object),x=canvasAgentFinite(raw.x,"x"),y=canvasAgentFinite(raw.y,"y");if(x<0||y<0||x+box.w>SIZE||y+box.h>SIZE)throw canvasAgentToolError("INVALID_GEOMETRY","Moved object would leave the canvas.");prepared.push({type,kind:object.kind,object,x,y});
      }else if(type === "resize_widget"){
        if(object.kind !== "widget")throw canvasAgentToolError("KIND_MISMATCH","resize_widget requires a widget.");const dimension=raw.dimension === "height"?"height":"width",value=canvasAgentFinite(raw.value,"value"),minimum=1,box=canvasAgentBox(object),contentRatio=dimension === "width"?object.item.contentW/object.item.w:object.item.contentH/object.item.h,contentMinimum=dimension === "width"?300:200;if(value<minimum||value*contentRatio<contentMinimum||(dimension === "width"?box.x+value:box.y+value)>SIZE)throw canvasAgentToolError("INVALID_GEOMETRY","Responsive widget size cannot preserve its current typography scale at this value.");prepared.push({type,kind:"widget",object,dimension,value});
      }else if(type === "resize_image"){
        if(object.kind !== "image")throw canvasAgentToolError("KIND_MISMATCH","resize_image requires an image.");const box=canvasAgentBox(object),ratio=box.w/box.h;let w=Number(raw.width),h=Number(raw.height);if(!Number.isFinite(w)&&!Number.isFinite(h))throw canvasAgentToolError("INVALID_ARGUMENT","resize_image requires width or height.");if(raw.preserveAspect){if(Number.isFinite(w))h=w/ratio;else w=h*ratio;}else{if(!Number.isFinite(w))w=box.w;if(!Number.isFinite(h))h=box.h;}if(w<80||h<80||box.x+w>SIZE||box.y+h>SIZE)throw canvasAgentToolError("INVALID_GEOMETRY","Image size is invalid.");prepared.push({type,kind:"image",object,w,h});
      }else if(type === "delete_object")prepared.push({type,kind:object.kind,object});
      else throw canvasAgentToolError("UNSUPPORTED_EDIT_TYPE",`Unsupported edit type: ${type||"(missing type)"}.`);
    }
    return prepared;
  }
  async function canvasAgentEdit(args,execution) {
    canvasAgentAssertRevision(args.baseRevision);canvasAgentMutationIdle(execution);const prepared=await canvasAgentPrepareEditOperations(args.operations);canvasAgentAssertRevision(args.baseRevision);canvasAgentAssertToolExecution(execution);const restoreMutation=canvasAgentBeginMutation(execution,prepared.flatMap(op=>op.positions?op.positions.map(item=>item.object.item.id):op.object?[op.object.item.id]:[]));try {save();
    const objectKinds=new Set(prepared.flatMap(op=>op.kind === "arrange"?op.positions.map(item=>item.object.kind):[op.kind]));if(objectKinds.has("widget"))state.widgetHistoryBefore=serializedWidgets();if(objectKinds.has("text"))state.textBoxHistoryBefore=textBoxHistoryState();if(objectKinds.has("image"))state.imageHistoryBefore=imageHistoryState();
    const receipts=[];
    for(const op of prepared){
      if(op.type === "update_text"){state.textBoxes[state.textBoxes.indexOf(op.object.item)]=op.record;receipts.push({type:op.type,status:"applied",objectId:op.record.id,after:canvasAgentExternalRect(canvasAgentBox({kind:"text",item:op.record}))});}
      else if(op.type === "move_object"){op.object.item.x=Math.round(op.x);op.object.item.y=Math.round(op.y);receipts.push({type:op.type,status:"applied",objectId:op.object.item.id,after:canvasAgentExternalRect(canvasAgentBox(op.object))});}
      else if(op.type === "resize_widget"){const item=op.object.item;if(op.dimension === "width"){const ratio=item.contentW/item.w;item.w=Math.round(op.value);item.contentW=item.w*ratio;}else{const ratio=item.contentH/item.h;item.h=Math.round(op.value);item.contentH=item.h*ratio;}positionWidget(item);receipts.push({type:op.type,status:"applied",objectId:item.id,dimension:op.dimension,after:{box:canvasAgentExternalRect(canvasAgentBox(op.object)),contentSize:{width:item.contentW,height:item.contentH}},note:"Responsive reflow; typography scale preserved."});}
      else if(op.type === "resize_image"){op.object.item.w=Math.round(op.w);op.object.item.h=Math.round(op.h);receipts.push({type:op.type,status:"applied",objectId:op.object.item.id,after:canvasAgentExternalRect(canvasAgentBox(op.object))});}
      else if(op.type === "arrange_objects"){for(const item of op.positions){item.object.item.x=Math.round(item.x);item.object.item.y=Math.round(item.y);if(item.object.kind === "widget")positionWidget(item.object.item);}receipts.push({type:op.type,status:"applied",objects:op.positions.map(item=>({objectId:item.object.item.id,box:canvasAgentExternalRect(canvasAgentBox(item.object))}))});}
      else if(op.type === "erase_ink"){eraseRect(op.region.x,op.region.y,op.region.w,op.region.h);receipts.push({type:op.type,status:"applied",region:{x:op.region.x,y:op.region.y,width:op.region.w,height:op.region.h}});}
      else if(op.type === "delete_object"){const item=op.object.item;if(op.object.kind === "widget"){unmountWidget(item);state.widgets.splice(state.widgets.indexOf(item),1);}else if(op.object.kind === "text")state.textBoxes.splice(state.textBoxes.indexOf(item),1);else state.images.splice(state.images.indexOf(item),1);if(state.selectedWidgetId===item.id)state.selectedWidgetId=null;if(state.selectedTextBoxId===item.id)state.selectedTextBoxId=null;if(state.selectedImageId===item.id)state.selectedImageId=null;receipts.push({type:op.type,status:"applied",objectId:item.id});}
    }
    state.userRevision++;const entry=save(),changeId=String(args._changeId||canvasClientId());canvasAgentRecordChange(changeId,entry,execution);positionTextEditors();
    const resizedVisual=prepared.length===1&&prepared[0].type==="resize_widget"&&prepared[0].object.item.sourceFormat===VISUAL_EXPLAINER_SOURCE_FORMAT,
      viewResult=resizedVisual?canvasAgentFrameRegion(canvasAgentBox(prepared[0].object),48):null;
    if(!viewResult){requestRender();canvasAgentSyncState();}
    return{ok:true,previousRevision:args.baseRevision,revision:state.userRevision,changeId,receipts,...(viewResult?{viewport:viewResult.viewport}:{}),summary:String(args.summary||"")};
    }finally{restoreMutation();}
  }
  async function canvasAgentHash(value) {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    if (globalThis.crypto?.subtle?.digest) {
      try {
        const digest = await globalThis.crypto.subtle.digest("SHA-256",bytes);
        return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,"0")).join("");
      } catch {}
    }
    let first=0x811c9dc5,second=0x9e3779b9;
    for(const byte of bytes){first=Math.imul(first^byte,0x01000193)>>>0;second=Math.imul(second^(byte+first),0x85ebca6b)>>>0;}
    return `fallback-${first.toString(16).padStart(8,"0")}${second.toString(16).padStart(8,"0")}-${bytes.length}`;
  }
  function canvasAgentWidgetSourceState(edit) {
    // Only persisted source and its interpretation belong in the source lock.
    // Geometry, selection and live diagnostics are deliberately excluded.
    const common={tool:edit.widgetType,pluginId:edit.pluginId,title:edit.title,
      refreshSeconds:edit.widgetType==="diagram_source"?0:edit.refreshSeconds||0,
      diagramKind:edit.diagramKind||null,sourceFormat:edit.sourceFormat||null};
    const distinct=!edit.sourceMirrorsHtml&&typeof edit.source==="string"&&Boolean(edit.source);
    const manifest=edit.widgetType==="diagram_source"?{...common,sourceFile:"widget.source"}:
      {...common,frameworkVersion:edit.frameworkVersion||null,htmlFile:"widget.html",
        copyTextFile:edit.sourceMirrorsHtml?"widget.html":distinct?"widget.source":null,copyLabel:distinct?edit.copyLabel||null:null};
    const files=[{path:"widget.json",content:JSON.stringify(manifest,null,2)+"\n"}];
    const raw=value=>typeof value==="string"?value:"";
    if(edit.widgetType!=="diagram_source")files.push({path:"widget.html",content:raw(edit.html)});
    files.push({path:"widget.source",content:raw(edit.widgetType==="diagram_source"||!edit.sourceMirrorsHtml?edit.source:"")});
    if(edit.widgetAnimation)files.push({path:"widget.animation.json",content:JSON.stringify(edit.widgetAnimation,null,2)+"\n"});
    return {version:1,files};
  }
  function canvasAgentIsolateSourceHistory() {
    // Source writes must not consume an unrelated in-progress ink/image/text edit.
    const fields=["historyBefore","animationHistoryBefore","imageHistoryBefore","textBoxHistoryBefore"],pending={};
    for(const field of fields){pending[field]=state[field];state[field]=field==="historyBefore"?new Map():null;}
    return ()=>{for(const field of fields)state[field]=pending[field];};
  }
  function canvasAgentSealWidgetGeometryEdit() {
    const edit=state.widgetEdit,widget=edit&&state.widgets.find(item=>item.id===edit.id);
    if(!edit)return;
    // Seal only an existing geometry change, keeping selection and iframe alive.
    // The following source change gets its own history entry.
    if(edit.changed||widget&&JSON.stringify(widgetLayout(widget))!==JSON.stringify(edit.before)) {
      state.userRevision++;
      saveUserCanvasChange();
    }
    state.widgetHistoryBefore=null;
    if(widget) {
      edit.before=widgetLayout(widget);
      edit.beforeIndex=state.widgets.indexOf(widget);
      edit.beforeFrontCanvasObjectKind=state.frontCanvasObjectKind;
      edit.beforeFrontPlacedCanvasObjectKind=state.frontPlacedCanvasObjectKind;
      edit.changed=false;
    }
  }
  async function canvasAgentInternalWidget(args,execution) {
    const object = canvasAgentObject(String(args.objectId || ""));
    if (!object || object.kind !== "widget") throw Error("Widget was not found.");
    const revision=state.userRevision,parentWidgetEdit = widgetEditContext(object.item,"agent"),
      [hash,sourceHash]=await Promise.all([canvasAgentHash(parentWidgetEdit),object.item.sourceFormat!==VISUAL_EXPLAINER_SOURCE_FORMAT?canvasAgentHash(canvasAgentWidgetSourceState(parentWidgetEdit)):null]);
    canvasAgentAssertToolExecution(execution);
    if(object.item.sourceFormat===VISUAL_EXPLAINER_SOURCE_FORMAT&&args.artifactId){
      let plan;try{plan=JSON.parse(object.item.copyText||"");}catch{throw Error("Visual Explainer source is invalid.");}
      const widgetEdit=visualExplainerArtifactWidgetEdit(plan,args.artifactId,{x:object.item.x,y:object.item.y,w:object.item.w,h:object.item.h});
      return {revision:state.userRevision,widgetEdit,hash,containerSourceFormat:VISUAL_EXPLAINER_SOURCE_FORMAT,artifactId:String(args.artifactId)};
    }
    return { revision, widgetEdit:parentWidgetEdit, hash, ...(sourceHash?{sourceHash}:{}), containerSourceFormat:object.item.sourceFormat||null };
  }
  async function canvasAgentPatchVisualExplainer(args,execution) {
    canvasAgentAssertRevision(args.baseRevision);canvasAgentMutationIdle(execution);const object=canvasAgentObject(String(args.objectId||""));
    if(!object||object.kind!=="widget")throw Error("Visual Explainer Widget was not found.");
    if(object.item.sourceFormat!==VISUAL_EXPLAINER_SOURCE_FORMAT)throw Error("The target is not a Visual Explainer Widget.");
    const currentEdit=widgetEditContext(object.item,"agent");if(await canvasAgentHash(currentEdit)!==String(args.expectedHash||""))throw Error("Visual Explainer changed after it was read. Read it again before patching.");
    canvasAgentAssertToolExecution(execution);
    let plan;
    if(args.artifactId){let currentPlan;try{currentPlan=JSON.parse(object.item.copyText||"");}catch{throw Error("Visual Explainer source is invalid.");}plan=visualExplainerReplaceArtifact(currentPlan,args.artifactId,args.command);}
    else plan=visualExplainerNormalizePlan(args.plan);
    const generated=visualExplainerWidgetItem(plan,{title:object.item.title}),command={tool:"html_widget",widgetType:"html_widget",pluginId:"general",title:generated.title,refreshSeconds:0,html:generated.html,sourceFormat:generated.sourceFormat,frameworkVersion:generated.frameworkVersion,copyText:generated.copyText,copyLabel:generated.copyLabel,x:object.item.x,y:object.item.y,w:object.item.w,h:object.item.h};
    const result=await canvasAgentReplaceWidget({objectId:object.item.id,baseRevision:args.baseRevision,expectedHash:args.expectedHash,changeId:args.changeId,command},execution),updated=canvasAgentObject(object.item.id),diagnostics=updated?.kind==="widget"?await visualExplainerWaitForDiagnostics(updated.item):null;
    canvasAgentAssertToolExecution(execution);
    return {...result,summary:String(args.summary||""),visualExplainer:{objectId:object.item.id,frameworkVersion:VISUAL_EXPLAINER_FRAMEWORK_VERSION,patchedArtifactId:args.artifactId||null,diagnostics}};
  }
  async function canvasAgentReplaceWidget(args,execution) {
    const sourceOnly=typeof args.expectedSourceHash === "string" && Boolean(args.expectedSourceHash);
    if(sourceOnly)canvasAgentAssertToolExecution(execution);
    else {canvasAgentAssertRevision(args.baseRevision);canvasAgentMutationIdle(execution);}
    const object = canvasAgentObject(String(args.objectId || ""));
    if (!object || object.kind !== "widget") throw Error("Widget was not found.");
    const source=execution?.assistContext?.owner?.inputTarget;
    if(source?.variant&&source.widget.id===object.item.id)throw canvasAgentToolError("READ_ONLY_SOURCE","This action creates a separate Widget. Preserve the source Widget unchanged.");
    const currentEdit = widgetEditContext(object.item,"agent"),
      sourceState=sourceOnly?canvasAgentWidgetSourceState(currentEdit):null,
      sourceSignature=sourceOnly?JSON.stringify(sourceState):null;
    if (await canvasAgentHash(sourceOnly?sourceState:currentEdit) !== String(sourceOnly?args.expectedSourceHash:args.expectedHash||"")) {
      throw canvasAgentToolError(sourceOnly?"SOURCE_CONFLICT":"REVISION_CONFLICT",sourceOnly?"Widget source changed. Read the affected source before patching.":"Widget changed after it was read. Read it again before patching.");
    }
    canvasAgentAssertToolExecution(execution);
    if(sourceOnly) {
      canvasAgentAssertToolExecution(execution);
      const latest=canvasAgentObject(String(args.objectId||""));
      if(!latest||latest.item!==object.item||JSON.stringify(canvasAgentWidgetSourceState(widgetEditContext(latest.item,"agent")))!==sourceSignature) {
        throw canvasAgentToolError("SOURCE_CONFLICT","Widget source or identity changed before commit.");
      }
    } else canvasAgentAssertRevision(args.baseRevision);
    const command = args.command;
    if (!command || command.pluginId !== object.item.pluginId || !["html_widget","diagram_source"].includes(command.tool)) throw Error("Patched widget command is invalid.");
    if(!canvasAgentWidgetPluginAllowed(command.pluginId,command.tool))throw Error("The Widget plugin is unavailable, disabled, or not available to PenEcho Agent.");
    const record = widgetRecord({...command,...(sourceOnly?{x:object.item.x,y:object.item.y,w:object.item.w,h:object.item.h}:{}),id:object.item.id,widgetType:command.tool,contentW:object.item.contentW,contentH:object.item.contentH,fitContent:object.item.fitContent,fitContentAxes:object.item.fitContentAxes});
    if (!record) throw Error("Patched widget content was rejected by Canvas validation.");
    const sourceHash=sourceOnly?await canvasAgentHash(canvasAgentWidgetSourceState(widgetEditContext(record,"agent"))):null;
    if(sourceOnly) {
      canvasAgentAssertToolExecution(execution);
      const latest=canvasAgentObject(String(args.objectId||""));
      if(!latest||latest.item!==object.item||JSON.stringify(canvasAgentWidgetSourceState(widgetEditContext(latest.item,"agent")))!==sourceSignature)throw canvasAgentToolError("SOURCE_CONFLICT","Widget source changed before commit.");
      for(const field of ["x","y","w","h","contentW","contentH"])record[field]=object.item[field];
    }
    const restoreHistory=sourceOnly?canvasAgentIsolateSourceHistory():canvasAgentBeginMutation(execution,[object.item.id]);
    let result;
    try {
    if(sourceOnly)canvasAgentSealWidgetGeometryEdit();
    const previousRevision=state.userRevision;
    save();
    state.widgetHistoryBefore = serializedWidgets();
    const contentFields = ["widgetType","pluginId","x","y","w","h","contentW","contentH","title","refreshSeconds","html","source","diagramKind","sourceFormat","frameworkVersion","copyText","copyLabel","widgetAnimation"];
    for(const field of contentFields) object.item[field] = record[field];
    object.item.snapshotImage = null;
    object.item.snapshotDataUrl = "";
    object.item.snapshotVersion = -1;
    object.item.contentVersion = (object.item.contentVersion || 0) + 1;
    object.item.runtimeDiagnostics = null;
    object.item.visualDiagnostics = null;
    if(!(object.item.visualDiagnosticWaiters instanceof Set)) object.item.visualDiagnosticWaiters = new Set();
    object.item.initialized = false;
    object.item.hostStateKey = null;
    if(object.item.shell) object.item.shell.setAttribute("aria-label", `${object.item.title}. ${t("widgetRefineHint")}`);
    if(object.item.frame) object.item.frame.title = object.item.title;
    positionWidget(object.item);
    sendWidgetInit(object.item);
    sendWidgetHostState(object.item, undefined, undefined, true);
    state.userRevision++;
    const entry=save(),changeId=String(args.changeId||canvasClientId());canvasAgentRecordChange(changeId,entry,execution);
    if(sourceOnly&&state.widgetEdit)state.widgetHistoryBefore=serializedWidgets();
    requestRender();
    canvasAgentSyncState();
    result = { ok:true, previousRevision, revision:state.userRevision, changeId, ...(sourceHash?{sourceHash,geometry:{x:record.x,y:record.y,w:record.w,h:record.h,contentW:record.contentW,contentH:record.contentH}}:{}), receipts:[{type:"patch_widget",status:"applied",objectId:record.id,...(sourceHash?{sourceHash}:{}),}] };
    } finally {restoreHistory();}
    result.receipts[0].contentHash=await canvasAgentHash(widgetEditContext(record,"agent"));
    return result;
  }
  function canvasAgentFramePlan(region,padding=80) {
    const width=Math.max(0,view.clientWidth),height=Math.max(0,view.clientHeight),full={x:0,y:0,w:width,h:height},stages=[full];
    const logicalPadding=Math.max(0,Math.min(2000,Number.isFinite(Number(padding))?Number(padding):80)),framedX=Math.max(0,region.x-logicalPadding),framedY=Math.max(0,region.y-logicalPadding),framedRight=Math.min(SIZE,region.x+region.w+logicalPadding),framedBottom=Math.min(SIZE,region.y+region.h+logicalPadding),framed={x:framedX,y:framedY,w:Math.max(1,framedRight-framedX),h:Math.max(1,framedBottom-framedY)},ranked=stages.map(stage=>({...stage,scale:Math.max(.03,Math.min(1,Math.min(stage.w/framed.w,stage.h/framed.h)))})).sort((a,b)=>b.scale-a.scale||b.w*b.h-a.w*a.h),stage=ranked[0]||full,scale=stage.scale||.03;
    return{framed,stage,scale,panX:stage.x+(stage.w-framed.w*scale)/2-framed.x*scale,panY:stage.y+(stage.h-framed.h*scale)/2-framed.y*scale};
  }
  function canvasAgentFrameRegion(region,padding=80) {
    const frame=canvasAgentFramePlan(region,padding);
    state.scale=frame.scale;
    state.panX=frame.panX;
    state.panY=frame.panY;
    requestRender();
    const facts=canvasAgentViewFacts();canvasAgentSyncState();return{viewport:canvasAgentExternalRect(facts.viewport),viewRevision:facts.viewRevision};
  }
  function canvasAgentSetView(args,execution) {
    canvasAgentAssertToolExecution(execution);
    let region;
    if (args.target === "canvas") region = canvasAgentContentBounds() || {x:0,y:0,w:SIZE,h:SIZE};
    else if (args.target === "region") region = canvasAgentValidatedRegion(args.region);
    else if (args.target === "object") {
      const object = canvasAgentObject(String(args.objectId || ""));
      if (!object) throw Error("Canvas object was not found.");
      region = canvasAgentBox(object);
    } else throw Error("Canvas view target is invalid.");
    const result=canvasAgentFrameRegion(region,args.padding);return { ok:true, viewport:result.viewport, revision:state.userRevision, viewRevision:result.viewRevision };
  }
  function canvasAgentRevert(args,execution) {
    canvasAgentAssertToolExecution(execution);
    const latest=canvasAgent.latestChange;
    if(!latest||String(args.changeId||"")!==latest.changeId)throw canvasAgentToolError("REVERT_NOT_LATEST","Only the latest PenEcho Agent change can be reverted.",{latestChangeId:latest?.changeId||null});
    if(state.userRevision!==latest.revision||state.history.at(-1)!==latest.historyEntry)throw canvasAgentToolError("REVERT_CONFLICT","Canvas changed after this Agent change, so it can no longer be reverted safely.",{changeRevision:latest.revision,currentRevision:state.userRevision});
    const entry=latest.historyEntry;
    if(!entry.objectScope&&(state.widgetEdit||state.imageEdit||state.animationEdit||state.textEditors.size))throw canvasAgentToolError("REVERT_CONFLICT","This older change contains a full Canvas snapshot. Finish the active edit before reverting it.");
    const finish=canvasAgentBeginMutation(execution,Object.values(entry.objectScope||{}).flat());
    try {
      if(state.history.at(-1)!==entry)throw canvasAgentToolError("REVERT_CONFLICT","A newer user history entry precedes this revert.");
      const previousRevision=state.userRevision;state.userRevision++;undo();
      // Rebase suspended user snapshots onto the inverse Agent change as well.
      if(entry.objectScope)state.agentMutationHistory.entries.push({...entry,widgetsAfter:entry.widgetsBefore,imagesAfter:entry.imagesBefore,textBoxesAfter:entry.textBoxesBefore});
      canvasAgent.latestChange=null;requestRender();canvasAgentSyncState();return{ok:true,revertedChangeId:latest.changeId,previousRevision,revision:state.userRevision};
    }finally{finish();}
  }
  async function canvasAgentExecuteTool(payload) {
    const name = String(payload?.name || ""), args = payload?.arguments || {};
    const cacheKey=String(payload?.callId||"");let signature="";
    const execution={
      socket:canvasAgent.socket,
      sessionId:canvasAgent.sessionId,
      generation:canvasAgent.sessionGeneration,
      controller:new AbortController(),
      assistContext:typeof assistAgentToolContext==="function"?assistAgentToolContext():null,
    },requestId=String(payload?.requestId||"");
    if(requestId)canvasAgent.toolControllers.set(requestId,execution.controller);
    canvasAgent.activeToolExecution=execution;
    const sendToolResult=envelope=>{
      if(!canvasAgentToolExecutionCurrent(execution))return;
      canvasAgentSendEnvelope("tool_result",{requestId,...envelope});
    };
    try {
      canvasAgentAssertToolExecution(execution);
      signature=await canvasAgentHash({name,args});
      canvasAgentAssertToolExecution(execution);
      const cached=cacheKey?canvasAgent.toolResultCache.get(cacheKey):null;
      if(cached){
        if(cached.signature!==signature){sendToolResult({ok:false,error:{code:"CALL_ID_CONFLICT",message:"A Canvas tool callId was reused with different arguments.",details:null}});return;}
        sendToolResult(cached.envelope);return;
      }
      let result;
      canvasAgentAssertToolExecution(execution);
      if (name === "canvas_document") result = await canvasAgentDocumentOperation(args,execution);
      // A command in a project folder needed a person's yes. The engine has no project and nobody to ask, so it is no.
      else if (name === "project_approval") result = { allowed:false };
      else {
        canvasAgentAssertToolKeys(name,args);
        if (name === "canvas_inspect") result = await canvasAgentInspect(args);
      else if (name === "canvas_read") result = await canvasAgentRead(args);
      else if (name === "canvas_capture") result = await canvasAgentCapture(args,{signal:execution.controller.signal,assertCurrent:()=>canvasAgentAssertToolExecution(execution)});
      else if (name === "canvas_create") result = await canvasAgentCreate({...args,_changeId:payload.callId},execution);
      else if (name === "canvas_visual_explainer_create") result = await canvasAgentVisualExplainerCreate({...args,_changeId:payload.callId},execution);
      else if (name === "canvas_visual_explainer_update") result = await canvasAgentVisualExplainerUpdate({...args,_changeId:payload.callId},execution);
      else if (name === "canvas_edit") result = await canvasAgentEdit({...args,_changeId:payload.callId},execution);
      else if (name === "canvas_set_view") result = canvasAgentSetView(args,execution);
      else if (name === "canvas_revert") result = canvasAgentRevert(args,execution);
      else if (name === "canvas_internal_widget") result = await canvasAgentInternalWidget(args,execution);
      else if (name === "canvas_internal_replace_widget") result = await canvasAgentReplaceWidget(args,execution);
      else if (name === "canvas_internal_patch_visual_explainer") result = await canvasAgentPatchVisualExplainer(args,execution);
      else throw Error(`Unknown PenEcho Agent tool: ${name}.`);
      }
      canvasAgentAssertToolExecution(execution);
      const envelope={ok:true,result};
      if (typeof assistAgentRecordResult === "function") assistAgentRecordResult(name, args, result, { canvasWritten:Boolean(execution.canvasWritten || name === "canvas_revert" && result?.revision > result?.previousRevision) });
      if(cacheKey&&signature&&canvasAgentToolExecutionCurrent(execution)){
        canvasAgent.toolResultCache.set(cacheKey,{signature,envelope});
        if(canvasAgent.toolResultCache.size>20)canvasAgent.toolResultCache.delete(canvasAgent.toolResultCache.keys().next().value);
      }
      sendToolResult(envelope);
    } catch (error) {
      const envelope={ok:false,error:{code:String(error?.code||"CANVAS_TOOL_FAILED"),message:String(error?.message||error).slice(0,1600),details:error?.details||null}};if(cacheKey&&signature&&canvasAgentToolExecutionCurrent(execution)){canvasAgent.toolResultCache.set(cacheKey,{signature,envelope});if(canvasAgent.toolResultCache.size>20)canvasAgent.toolResultCache.delete(canvasAgent.toolResultCache.keys().next().value);}sendToolResult(envelope);
    }finally{
      if(requestId)canvasAgent.toolControllers.delete(requestId);
      if(canvasAgent.activeToolExecution===execution)canvasAgent.activeToolExecution=null;
    }
  }
  function canvasAgentSyncRuntimeAvailability() {
    if (settings.connectionScope && settings.connectionScope !== aiConnectionScope()) {
      settings.connections = [];
      settings.connectionScope = aiConnectionScope();
      renderConnectionLists();
    }
    if (!canvasAgentExecutionAvailable()) canvasAgentSetStatus(t("canvasAgentNoConnections"),"unavailable");
    else if (canvasAgent.statusKind === "unavailable") canvasAgentSetStatus(t("canvasAgentReadyConnect"));
    if (window.PENECHO_CONFIG?.browserCanvasEditing) {
      renderHostedModels();
      const gallery = canvasTrialDraft() && window.PENECHO_EXAMPLE_SCENARIOS && window.PENECHO_EXAMPLE_INK;
      const titleKey = gallery ? "canvasWelcomeTitle" : "canvasBrowserWelcomeTitle";
      const bodyKey = gallery ? (canvasGuest() ? "canvasTrialWelcomeBody" : "canvasWelcomeBody")
        : (canvasGuest() ? "canvasGuestWelcomeBody" : "canvasBrowserWelcomeBody");
      for (const [oldKey, key] of [["canvasWelcomeTitle", titleKey], ["canvasWelcomeBody", bodyKey]]) {
        const element = document.querySelector(`[data-i18n="${oldKey}"]`);
        if (element) { element.dataset.i18n = key; element.textContent = t(key); }
      }
    }
  }
  canvasAgentSyncRuntimeAvailability();
  window.addEventListener("penecho:capabilities-changed", canvasAgentSyncRuntimeAvailability);
  // One request to the engine. Its callers are the lasso, the suggestions and Widget Refine (assist-agent.js): they
  // give the words, the pictures and what the request is about.
  async function canvasAgentSubmitMessage(options) {
    const text=String(options?.textOverride||"").trim();
    if (!text) return false;
    if (!requireAiConnectionSelection()) return false;
    if (!canvasAgentExecutionAvailable()) {
      canvasAgentSetStatus(t("canvasAgentNoConnections"),"unavailable");
      return false;
    }
    let requestSent = false;
    let inputSnapshot = null;
    const submitExecution=canvasAgentBeginSubmitExecution(selectedAiConnectionId());
    try {
      canvasAgentBeginRequest(options);
      await canvasAgentConnect({submitExecution});
      canvasAgentAssertSubmitExecution(submitExecution);
      await canvasAgentEnsureSearchSession(submitExecution);
      canvasAgentBindSubmitExecution(submitExecution);
      canvasAgentSetStatus(t("canvasAgentInitialStatePreparing"),"connecting");
      // The initial Canvas capture is input to this turn. Keep later writing
      // separate, and transfer ownership only after the request was sent.
      if (!options?.omitInitialCapture && typeof captureDirtyInput === "function") inputSnapshot = captureDirtyInput({x:0,y:0,w:SIZE,h:SIZE});
      const initialState=options?.omitInitialCapture?null:await canvasAgentInitialTurnState(submitExecution);
      canvasAgentAssertSubmitExecution(submitExecution);
      options?.assertCurrent?.();
      canvasAgentSyncState();
      canvasAgentAssertSubmitExecution(submitExecution);
      canvasAgentRow("user",options?.displayTextOverride===undefined?text:String(options.displayTextOverride));
      canvasAgentAssertSubmitExecution(submitExecution);
      const taskContext=typeof canvasDocumentsCurrent==="function"?canvasDocumentsCurrent().context||"":"",
        contextualPrompt=taskContext?`${text}\n\nSaved Canvas task context (user-editable; check against the current instruction):\n${taskContext.slice(0,16000)}`:text;
      options?.assertCurrent?.();
      if(!canvasAgent.running)canvasAgent.retireSuggestionTurn?.();
      options?.beforeSend?.();
      canvasAgentSendRequest(canvasAgent.running ? "steer" : "user_turn",{text:contextualPrompt,references:options?.referencesOverride||canvasAgentTurnReferences(),images:[...(options?.imageOverrides||[])],fileIds:[],initialState,webSearchEnabled:canvasAgent.searchEnabled,canvasTitleNeeded:canvasAgentShouldRequestCanvasTitle(),reasoningEffort:state.reasoningEffort});
      requestSent = true;
      if (inputSnapshot) { assistRequestInputCaptured(canvasAgent, inputSnapshot); inputSnapshot = null; }
      return true;
    } catch (error) {
      const current=canvasAgentSubmitExecutionCurrent(submitExecution);
      if (!requestSent&&current) canvasAgentRequestDidNotSend();
      if(current) {
        if(error?.code==="CONNECTION_STALE"&&promptForAiConnectionSelection()) canvasAgentSetStatus(t("canvasAgentChooseConnection"),"unavailable");
        else canvasAgentSetStatus(String(error?.message||error),"error");
      }
      return false;
    }
    finally {
      if (inputSnapshot) releaseDirtyInput(inputSnapshot);
      if(canvasAgent.activeSubmitExecution===submitExecution)canvasAgent.activeSubmitExecution=null;
    }
  }
  if (typeof ResizeObserver==="function") {
    const toolbarLayoutObserver = new ResizeObserver(canvasAgentScheduleToolbarLayout);
    toolbarLayoutObserver.observe(canvasAgentToolbar);
    toolbarLayoutObserver.observe(document.querySelector(".tool-group.primary-tools"));
  }
  window.addEventListener("resize",()=>requestAnimationFrame(()=>syncStudioWorkbench()),{passive:true});
  canvasAgentCanvasDidChange();
