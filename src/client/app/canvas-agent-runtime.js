// DeepSeek Harness bridge. The browser remains authoritative for Canvas state.
  const canvasAgentControl = document.querySelector("#canvasAgentControl"),
    canvasAgentToggle = document.querySelector("#canvasAgentToggle"),
    canvasAgentPanel = document.querySelector("#canvasAgentPanel"),
    canvasAgentHead = document.querySelector("#canvasAgentHead"),
    canvasAgentClose = document.querySelector("#canvasAgentClose"),
    canvasAgentNew = document.querySelector("#canvasAgentNew"),
    canvasAgentProjectControl = document.querySelector("#canvasAgentProjectControl"),
    canvasAgentProjectButton = document.querySelector("#canvasAgentProject"),
    canvasAgentProjectClear = document.querySelector("#canvasAgentProjectClear"),
    canvasAgentProjectLabel = document.querySelector("#canvasAgentProjectLabel"),
    canvasAgentProjectPopover = document.querySelector("#canvasAgentProjectPopover"),
    canvasAgentProjectClose = document.querySelector("#canvasAgentProjectClose"),
    canvasAgentProjectList = document.querySelector("#canvasAgentProjectList"),
    canvasAgentProjectCreate = document.querySelector("#canvasAgentProjectCreate"),
    canvasAgentProjectCount = document.querySelector("#canvasAgentProjectCount"),
    canvasAgentFileList = document.querySelector("#canvasAgentFileList"),
    canvasAgentFileCount = document.querySelector("#canvasAgentFileCount"),
    canvasAgentProjectRoots = document.querySelector("#canvasAgentProjectRoots"),
    canvasAgentProjectRootBack = document.querySelector("#canvasAgentProjectRootBack"),
    canvasAgentProjectRootPath = document.querySelector("#canvasAgentProjectRootPath"),
    canvasAgentProjectRootList = document.querySelector("#canvasAgentProjectRootList"),
    canvasAgentProjectRootApproval = document.querySelector("#canvasAgentProjectRootApproval"),
    canvasAgentProjectRootApprovalDetail = document.querySelector("#canvasAgentProjectRootApprovalDetail"),
    canvasAgentProjectRootApprovalReject = document.querySelector("#canvasAgentProjectRootApprovalReject"),
    canvasAgentProjectRootApprovalAllow = document.querySelector("#canvasAgentProjectRootApprovalAllow"),
    canvasAgentProjectRootSelect = document.querySelector("#canvasAgentProjectRootSelect"),
    canvasAgentProjectRootTruncated = document.querySelector("#canvasAgentProjectRootTruncated"),
    canvasAgentProjectError = document.querySelector("#canvasAgentProjectError"),
    canvasAgentHistory = document.querySelector("#canvasAgentHistory"),
    canvasAgentHistoryPopover = document.querySelector("#canvasAgentHistoryPopover"),
    canvasAgentHistoryList = document.querySelector("#canvasAgentHistoryList"),
    canvasAgentHistoryView = document.querySelector("#canvasAgentHistoryView"),
    canvasAgentHistoryReturn = document.querySelector("#canvasAgentHistoryReturn"),
    canvasAgentResizeTop = document.querySelector("#canvasAgentResizeTop"),
    canvasAgentResizeBottom = document.querySelector("#canvasAgentResizeBottom"),
    canvasAgentResizeLeft = document.querySelector("#canvasAgentResizeLeft"),
    canvasAgentResizeRight = document.querySelector("#canvasAgentResizeRight"),
    canvasAgentStatus = document.querySelector("#canvasAgentStatus"),
    canvasAgentTranscript = document.querySelector("#canvasAgentTranscript"),
    canvasAgentSelection = document.querySelector("#canvasAgentSelection"),
    canvasAgentAttachments = document.querySelector("#canvasAgentAttachments"),
    canvasAgentApproval = document.querySelector("#canvasAgentApproval"),
    canvasAgentApprovalReason = document.querySelector("#canvasAgentApprovalReason"),
    canvasAgentApprovalCommand = document.querySelector("#canvasAgentApprovalCommand"),
    canvasAgentApprovalReject = document.querySelector("#canvasAgentApprovalReject"),
    canvasAgentApprovalAllow = document.querySelector("#canvasAgentApprovalAllow"),
    canvasAgentForm = document.querySelector("#canvasAgentForm"),
    canvasAgentInputHint = document.querySelector("#canvasAgentInputHint"),
    canvasAgentPromptSuggestions = document.querySelector("#canvasAgentPromptSuggestions"),
    canvasAgentPromptToggle = document.querySelector("#canvasAgentPromptToggle"),
    canvasAgentPromptPopup = document.querySelector("#canvasAgentPromptPopup"),
    canvasAgentAdditionalPromptList = document.querySelector("#canvasAgentAdditionalPromptList"),
    canvasAgentPrimaryPromptList = document.querySelector("#canvasAgentPrimaryPromptList"),
    canvasAgentInput = document.querySelector("#canvasAgentInput"),
    canvasAgentInkInput = document.querySelector("#canvasAgentInkInput"),
    canvasAgentInkCanvas = document.querySelector("#canvasAgentInkCanvas"),
    canvasAgentClearInkButton = document.querySelector("#canvasAgentClearInk"),
    canvasAgentTextMode = document.querySelector("#canvasAgentTextMode"),
    canvasAgentInkMode = document.querySelector("#canvasAgentInkMode"),
    canvasAgentAttach = document.querySelector("#canvasAgentAttach"),
    canvasAgentReference = document.querySelector("#canvasAgentReference"),
    canvasAgentWidgetPickerLayer = document.querySelector("#canvasAgentWidgetPickerLayer"),
    canvasAgentReferencePicker = document.querySelector("#canvasAgentReferencePicker"),
    canvasAgentReferenceHelp = document.querySelector("#canvasAgentReferenceHelp"),
    canvasAgentReferenceSearch = document.querySelector("#canvasAgentReferenceSearch"),
    canvasAgentReferenceList = document.querySelector("#canvasAgentReferenceList"),
    canvasAgentReferenceNote = document.querySelector("#canvasAgentReferenceNote"),
    canvasAgentSearch = document.querySelector("#canvasAgentSearch"),
    canvasAgentFileInput = document.querySelector("#canvasAgentFileInput"),
    canvasAgentAttachmentCount = document.querySelector("#canvasAgentAttachmentCount"),
    canvasAgentSend = document.querySelector("#canvasAgentSend"),
    canvasAgentStop = document.querySelector("#canvasAgentStop"),
    canvasAgentWidgetPickerContext = canvasAgentWidgetPickerLayer?.getContext("2d"),
    canvasAgentInkContext = canvasAgentInkCanvas?.getContext("2d");
  const CANVAS_AGENT_PROTOCOL_VERSION = 1,
    CANVAS_AGENT_SESSION_KEY = "penecho-canvas-agent-session-v1",
    CANVAS_AGENT_CLIENT_KEY = "penecho-canvas-agent-client-v1",
    CANVAS_AGENT_POSITION_KEY = "penecho-canvas-agent-position-v1",
    CANVAS_AGENT_HEIGHT_KEY = "penecho-canvas-agent-height-v1",
    CANVAS_AGENT_WIDTH_KEY = "penecho-canvas-agent-width-v1",
    CANVAS_AGENT_HISTORY_KEY = "penecho-canvas-agent-history-v1",
    CANVAS_AGENT_SEARCH_ENABLED_KEY = "penecho-canvas-agent-search-enabled-v1",
    CANVAS_AGENT_PROJECT_KEY = "penecho-canvas-agent-project-v1",
    CANVAS_AGENT_PROJECT_UPLOAD_LIMIT = 32 * 1024 * 1024,
    CANVAS_AGENT_IMAGE_MEDIA_TYPES = new Set(["image/png","image/jpeg","image/webp","image/gif"]),
    CANVAS_AGENT_IMAGE_EXTENSION_TYPES = new Map([[".png","image/png"],[".jpg","image/jpeg"],[".jpeg","image/jpeg"],[".webp","image/webp"],[".gif","image/gif"]]),
    CANVAS_AGENT_HISTORY_LIMIT = 5,
    CANVAS_AGENT_HISTORY_ITEM_LIMIT = 120,
    CANVAS_AGENT_HISTORY_TEXT_LIMIT = 20000,
    CANVAS_AGENT_CONTINUATION_TEXT_LIMIT = 80000,
    CANVAS_AGENT_ERROR_MESSAGE_LIMIT = 8000,
    CANVAS_AGENT_MARKDOWN_TEXT_LIMIT = 12000,
    CANVAS_AGENT_MARKDOWN_LINE_LIMIT = 240,
    CANVAS_AGENT_MARKDOWN_MARKER_LIMIT = 800,
    CANVAS_AGENT_MARKDOWN_BACKSLASH_LIMIT = 256,
    CANVAS_AGENT_MARKDOWN_SEGMENT_LIMIT = 48,
    CANVAS_AGENT_HEIGHT_MIN = 320,
    CANVAS_AGENT_WIDTH_MIN = 360,
    CANVAS_AGENT_SIZE_STEPS = 40,
    CANVAS_AGENT_RESIZE_KEY_STEP = 20,
    CANVAS_AGENT_INPUT_MAX_LINES = 10,
    CANVAS_AGENT_INK_LINE_WIDTH = 12,
    CANVAS_AGENT_INK_PADDING_RATIO = 0.6,
    CANVAS_AGENT_INK_PADDING_MIN = 256,
    CANVAS_AGENT_INK_PADDING_MAX = 512,
    CANVAS_AGENT_INK_OUTPUT_SCALE = 1,
    CANVAS_AGENT_INK_WEBP_QUALITY = 1,
    CANVAS_AGENT_MAX_REFERENCES = 20,
    CANVAS_AGENT_MAX_ATTACHMENTS = 5,
    CANVAS_AGENT_MAX_SOURCE_BYTES = 12 * 1024 * 1024,
    CANVAS_AGENT_MAX_WIRE_BYTES = 5 * 1024 * 1024,
    CANVAS_AGENT_MAX_TOTAL_WIRE_BYTES = CANVAS_AGENT_MAX_ATTACHMENTS * CANVAS_AGENT_MAX_WIRE_BYTES,
    CANVAS_AGENT_WIRE_IMAGE_DIMENSION = 2048,
    CANVAS_AGENT_COMFORT_BODY_PX = 15,
    CANVAS_AGENT_PREFERRED_BODY_MIN_PX = 11,
    CANVAS_AGENT_COMPACT_TEXT_MIN_PX = 8,
    CANVAS_AGENT_AUTO_AI_STATUS_KEYS = new Set(["canvasAgentAutoAIFocusPaused","canvasAgentAutoAIRequestPaused"]),
    CANVAS_AGENT_LAYOUT_CAPTURE_POLICY = Object.freeze({id:"canvas-layout-v1",maxLongEdge:1024,maxPixels:520000,quality:.72,maxBytes:700*1024}),
    CANVAS_AGENT_DETAIL_CAPTURE_POLICY = Object.freeze({id:"canvas-detail-v1",maxLongEdge:1440,maxPixels:1800000,quality:.88,maxBytes:1200*1024}),
    CANVAS_AGENT_PROMPT_LIBRARY = Object.freeze({
      simpleDiagram:{prompt:"canvasAgentPromptSimpleDiagram",focus:"canvasAgentPromptFocusSimplify",icon:"visual"},
      sequenceDiagramSource:{prompt:"canvasAgentPromptSequenceDiagramSource",focus:"canvasAgentPromptFocusSequence",icon:"architecture"},
      organize:{prompt:"canvasAgentPromptOrganize",focus:"canvasAgentPromptFocusOrganize",icon:"organize"},
      applyAnnotations:{prompt:"canvasAgentPromptApplyAnnotations",focus:"canvasAgentPromptFocusRevise",icon:"revise"},
      followCanvasCues:{prompt:"canvasAgentPromptFollowCanvasCues",focus:"canvasAgentPromptFocusFollowCanvasCues",icon:"revise"},
      ppt:{prompt:"canvasAgentPromptPpt",focus:"canvasAgentPromptFocusSlides",icon:"slides"},
      excel:{prompt:"canvasAgentPromptExcel",focus:"canvasAgentPromptFocusAnalyze",icon:"data"},
      transformer:{prompt:"canvasAgentPromptTransformer",focus:"canvasAgentPromptFocusLearn",icon:"study"},
      ukTrip:{prompt:"canvasAgentPromptUkTrip",focus:"canvasAgentPromptFocusPlan",icon:"plan"},
      file:{prompt:"canvasAgentPromptFile",focus:"canvasAgentPromptFocusExplain",icon:"file"},
      architecture:{prompt:"canvasAgentPromptArchitecture",focus:"canvasAgentPromptFocusArchitecture",icon:"architecture"},
      handwriting:{prompt:"canvasAgentPromptHandwriting",focus:"canvasAgentPromptFocusEnhance",icon:"handwriting"},
      imageVisual:{prompt:"canvasAgentPromptImageVisual",focus:"canvasAgentPromptFocusVisual",icon:"visual"},
      imageLayer:{prompt:"canvasAgentPromptImageLayer",focus:"canvasAgentPromptFocusLayer",icon:"layer"},
      imagePublish:{prompt:"canvasAgentPromptImagePublish",focus:"canvasAgentPromptFocusPublish",icon:"publish"},
      spreadsheetVisual:{prompt:"canvasAgentPromptSpreadsheetVisual",focus:"canvasAgentPromptFocusAnalyze",icon:"data"},
      spreadsheetLayer:{prompt:"canvasAgentPromptSpreadsheetLayer",focus:"canvasAgentPromptFocusLayer",icon:"layer"},
      spreadsheetPublish:{prompt:"canvasAgentPromptSpreadsheetPublish",focus:"canvasAgentPromptFocusPublish",icon:"publish"},
      presentationVisual:{prompt:"canvasAgentPromptPresentationVisual",focus:"canvasAgentPromptFocusVisual",icon:"slides"},
      presentationLayer:{prompt:"canvasAgentPromptPresentationLayer",focus:"canvasAgentPromptFocusEnhance",icon:"layer"},
      presentationPublish:{prompt:"canvasAgentPromptPresentationPublish",focus:"canvasAgentPromptFocusPublish",icon:"publish"},
      documentVisual:{prompt:"canvasAgentPromptDocumentVisual",focus:"canvasAgentPromptFocusVisual",icon:"visual"},
      documentStudy:{prompt:"canvasAgentPromptDocumentStudy",focus:"canvasAgentPromptFocusLearn",icon:"study"},
      documentPublish:{prompt:"canvasAgentPromptDocumentPublish",focus:"canvasAgentPromptFocusPublish",icon:"publish"},
      codeVisual:{prompt:"canvasAgentPromptCodeVisual",focus:"canvasAgentPromptFocusVisual",icon:"architecture"},
      codeLayer:{prompt:"canvasAgentPromptCodeLayer",focus:"canvasAgentPromptFocusExplain",icon:"layer"},
      codePlan:{prompt:"canvasAgentPromptCodePlan",focus:"canvasAgentPromptFocusPlan",icon:"plan"},
      fileLayer:{prompt:"canvasAgentPromptFileLayer",focus:"canvasAgentPromptFocusLayer",icon:"layer"},
      filePublish:{prompt:"canvasAgentPromptFilePublish",focus:"canvasAgentPromptFocusPublish",icon:"publish"},
      projectPlan:{prompt:"canvasAgentPromptProjectPlan",focus:"canvasAgentPromptFocusPlan",icon:"plan"},
      projectPublish:{prompt:"canvasAgentPromptProjectPublish",focus:"canvasAgentPromptFocusPublish",icon:"publish"},
      selectionVisual:{prompt:"canvasAgentPromptSelectionVisual",focus:"canvasAgentPromptFocusVisual",icon:"visual"},
      selectionLayer:{prompt:"canvasAgentPromptSelectionLayer",focus:"canvasAgentPromptFocusLayer",icon:"layer"},
      selectionPublish:{prompt:"canvasAgentPromptSelectionPublish",focus:"canvasAgentPromptFocusPublish",icon:"publish"},
      notesVisual:{prompt:"canvasAgentPromptNotesVisual",focus:"canvasAgentPromptFocusVisual",icon:"study"},
      notesPublish:{prompt:"canvasAgentPromptNotesPublish",focus:"canvasAgentPromptFocusOrganize",icon:"organize"},
      canvasVisual:{prompt:"canvasAgentPromptCanvasVisual",focus:"canvasAgentPromptFocusVisual",icon:"visual"},
      canvasLayer:{prompt:"canvasAgentPromptCanvasLayer",focus:"canvasAgentPromptFocusLayer",icon:"layer"},
      canvasPublish:{prompt:"canvasAgentPromptCanvasPublish",focus:"canvasAgentPromptFocusPublish",icon:"publish"},
    }),
    CANVAS_AGENT_PROMPT_ICON_PATHS = Object.freeze({
      visual:["M3.5 12s3.1-5 8.5-5 8.5 5 8.5 5-3.1 5-8.5 5-8.5-5-8.5-5Z","M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"],
      organize:["M5 6h14M5 12h14M5 18h14","M8 4v4M15 10v4M11 16v4"],
      slides:["M4 5h16v11H4z","M8 20l4-4 4 4M8 9h8M8 12h5"],
      data:["M5 19V9M12 19V5M19 19v-7M3 19h18"],
      study:["M4 5.5c3.2-.8 5.8-.3 8 1.5v12c-2.2-1.8-4.8-2.3-8-1.5z","M20 5.5c-3.2-.8-5.8-.3-8 1.5v12c2.2-1.8 4.8-2.3 8-1.5z"],
      plan:["M6 4h12v16H6z","m9 2 3 3M9 10h6M9 14h6M9 18h4"],
      file:["M6 3h8l4 4v14H6z","M14 3v5h5M9 12h6M9 16h6"],
      architecture:["M12 4v5M6 20v-5h12v5M6 15v-3h12v3","M9 4h6v5H9zM3 20h6v-5H3zM15 20h6v-5h-6z"],
      handwriting:["M4 18c4-1 5-4 8-9 1.3-2.2 3.2-4 5-2.5 1.7 1.3-.2 3.7-2 5.7-2.4 2.7-4.4 4.1-8.5 5.8","M4 21h16"],
      layer:["m12 3-9 5 9 5 9-5-9-5Z","m5 12 7 4 7-4M5 16l7 4 7-4"],
      publish:["M12 15V3m0 0-4 4m4-4 4 4","M5 14v7h14v-7"],
      revise:["M4 17.5V21h3.5L18 10.5 14.5 7 4 17.5Z","M13.5 9l3.5 3.5M4 5h6M4 9h5"],
    }),
    CANVAS_AGENT_PROMPT_ADDITIONAL = Object.freeze(["simpleDiagram","sequenceDiagramSource","organize","applyAnnotations","followCanvasCues","ppt","excel","transformer","ukTrip"]),
    CANVAS_AGENT_PROMPT_PRIMARY = Object.freeze({
      blank:["file","architecture","handwriting"],
      image:["imageVisual","imageLayer","imagePublish"],
      spreadsheet:["spreadsheetVisual","spreadsheetLayer","spreadsheetPublish"],
      presentation:["presentationVisual","presentationLayer","presentationPublish"],
      document:["documentVisual","documentStudy","documentPublish"],
      code:["codeVisual","codeLayer","codePlan"],
      file:["file","fileLayer","filePublish"],
      project:["architecture","projectPlan","projectPublish"],
      selection:["selectionVisual","selectionLayer","selectionPublish"],
      notes:["notesVisual","applyAnnotations","handwriting"],
      canvas:["canvasVisual","canvasLayer","canvasPublish"],
    });
  const canvasAgent = {
    socket:null,
    connectPromise:null,
    connectResolve:null,
    connectReject:null,
    sessionId:"",
    resumeToken:"",
    connectionId:"",
    sessionEngine:"",
    sessionReady:false,
    pendingHandshakeId:"",
    pendingProvider:"",
    pendingConnectionChange:null,
    sessionProjectId:"",
    sessionAccessMode:"controlled",
    sessionProjectCapabilities:null,
    clientId:sessionStorage.getItem(CANVAS_AGENT_CLIENT_KEY) || canvasClientId(),
    outgoingSeq:0,
    incomingSeq:0,
    running:false,
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
    attachments:[],
    attachmentBusy:false,
    references:[],
    referencePickActive:false,
    referenceHoverId:"",
    inputMode:"text",
    promptSuggestionsExpanded:false,
    promptSuggestionsManual:false,
    promptSuggestionsCollapsedAll:false,
    promptSuggestionContextKey:"",
    promptSuggestions:[],
    inkPresent:false,
    inkStroke:null,
    searchConfigured:Boolean(window.PENECHO_CONFIG?.canvasAgentSearchConfigured),
    searchEnabled:Boolean(window.PENECHO_CONFIG?.canvasAgentSearchConfigured) && localStorage.getItem(CANVAS_AGENT_SEARCH_ENABLED_KEY) !== "false",
    sessionSearchConfigured:false,
    sessionSearchEnabled:false,
    projectId:localStorage.getItem(CANVAS_AGENT_PROJECT_KEY) || "",
    accessMode:"controlled",
    projects:[],
    projectsLoaded:false,
    projectListRequestRevision:0,
    projectRoots:[],
    projectRootsLoaded:false,
    projectRootView:null,
    projectRootApproval:null,
    projectRootApprovals:new Set(),
    projectRootChooserOpen:false,
    projectRootBusy:false,
    projectUploadBusy:false,
    projectHistory:[],
    projectHistoryLoaded:false,
    projectHistoryWrite:Promise.resolve(),
    projectSelectionRevision:0,
    pendingApproval:null,
    followLatest:true,
    panelDrag:null,
    panelResize:null,
    panelPosition:null,
    panelResizeFrame:0,
    panelMotion:null,
    panelMotionFrame:0,
    panelMotionProxy:null,
    currentConversation:null,
    viewingHistoryId:"",
    pendingConversationHistory:[],
    historyPersistTimer:0,
    viewRevision:0,
    viewSignature:"",
    latestChange:null,
  };
  sessionStorage.setItem(CANVAS_AGENT_CLIENT_KEY,canvasAgent.clientId);
  try {
    const saved = JSON.parse(sessionStorage.getItem(CANVAS_AGENT_SESSION_KEY) || "null");
    if (saved?.sessionId && saved?.resumeToken && String(saved.projectId || "") === canvasAgent.projectId && String(saved.accessMode || "controlled") === canvasAgent.accessMode) {
      canvasAgent.sessionId = saved.sessionId;
      canvasAgent.resumeToken = saved.resumeToken;
      canvasAgent.connectionId = String(saved.connectionId || "");
      canvasAgent.sessionEngine = String(saved.engine || "");
      canvasAgent.sessionProjectId = String(saved.projectId || "");
      canvasAgent.sessionAccessMode = String(saved.accessMode || "controlled");
    }
  } catch {}

  function canvasAgentAvailable() {
    const runtime = window.PENECHO_CONFIG?.runtime;
    return window.PENECHO_CONFIG?.canvasAgent !== false && runtime !== "viewer";
  }
  function canvasAgentHasFocus() {
    return !canvasAgentPanel.hidden && canvasAgentPanel.contains(document.activeElement);
  }
  function canvasAgentSuppressesAutomaticAI() {
    return canvasAgent.requestPending || canvasAgent.running || canvasAgentHasFocus();
  }
  function canvasAgentAutomaticAIStatusKey() {
    if (!state.auto) return null;
    if (canvasAgent.requestPending || canvasAgent.running) return "canvasAgentAutoAIRequestPaused";
    return canvasAgentHasFocus() ? "canvasAgentAutoAIFocusPaused" : null;
  }
  function canvasAgentSyncAutomaticAIStatus() {
    const nextKey = canvasAgentAutomaticAIStatusKey();
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
  function canvasAgentSyncTriggerState() {
    const busy = (canvasAgent.requestPending || canvasAgent.running) && canvasAgentPanel.hidden;
    canvasAgentControl.classList.toggle("is-busy",busy);
    canvasAgentToggle.setAttribute("aria-busy",String(busy));
    canvasAgentSyncPromptSuggestions();
  }
  function canvasAgentBeginRequest() {
    canvasAgent.requestPending = true;
    canvasAgentSyncTriggerState();
    canvasAgentPauseAutomaticAI();
    stopActiveAutomaticAI("canvas-agent-request");
    canvasAgentSyncAutomaticAIStatus();
  }
  function canvasAgentRequestDidNotSend() {
    canvasAgent.requestPending = false;
    canvasAgentSyncTriggerState();
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
  function canvasAgentUpdateSearchButton() {
    if (!canvasAgentSearch) return;
    if (!canvasAgent.searchConfigured) canvasAgent.searchEnabled = false;
    const key = !canvasAgent.searchConfigured ? "canvasAgentSearchUnavailable" : canvasAgent.searchEnabled ? "canvasAgentSearchOn" : "canvasAgentSearchOff",
      label = t(key);
    canvasAgentSearch.classList.toggle("active",canvasAgent.searchEnabled);
    canvasAgentSearch.setAttribute("aria-pressed",String(canvasAgent.searchEnabled));
    canvasAgentSearch.setAttribute("aria-disabled",String(!canvasAgent.searchConfigured));
    canvasAgentSearch.setAttribute("aria-label",label);
    canvasAgentSearch.setAttribute("title",canvasAgent.searchConfigured ? label : "");
    canvasAgentSearch.dataset.i18nAria = key;
    canvasAgentSearch.dataset.tooltip = canvasAgent.searchConfigured ? "" : label;
  }
  function canvasAgentSetSearchConfigured(configured) {
    canvasAgent.searchConfigured = Boolean(configured);
    if (!canvasAgent.searchConfigured) {
      canvasAgent.searchEnabled = false;
      localStorage.setItem(CANVAS_AGENT_SEARCH_ENABLED_KEY,"false");
    }
    canvasAgentUpdateSearchButton();
  }
  function canvasAgentSearchConfigurationDidChange(configured,requiresNewSession=false) {
    canvasAgentSetSearchConfigured(configured);
    if (requiresNewSession) canvasAgent.sessionSearchConfigured = false;
  }
  function canvasAgentSetStatus(text, kind = "") {
    canvasAgentStatus.textContent = text;
    canvasAgentPanel.dataset.status = kind;
  }
  function canvasAgentSetComposerActionLabel(button,key) {
    const label=t(key),text=button.querySelector(".canvas-agent-action-label");
    if(text)text.textContent=label;
    button.setAttribute("aria-label",label);
    button.setAttribute("title",label);
  }
  function canvasAgentPromptFileContext(resource) {
    if(resource?.kind==="image")return "image";
    const name=String(resource?.name||"").toLowerCase(),mediaType=String(resource?.mediaType||"").toLowerCase(),dot=name.lastIndexOf("."),extension=dot>=0?name.slice(dot+1):"";
    if(mediaType.startsWith("image/")||["png","jpg","jpeg","webp","gif","svg","heic","avif"].includes(extension))return "image";
    if(["csv","tsv","xls","xlsx","xlsm","xlsb","ods","numbers"].includes(extension)||/(?:spreadsheet|excel|csv)/.test(mediaType))return "spreadsheet";
    if(["ppt","pptx","pps","ppsx","odp","key"].includes(extension)||/(?:presentation|powerpoint)/.test(mediaType))return "presentation";
    if(["doc","docx","odt","rtf","pdf","epub","tex","md","markdown","txt"].includes(extension)||/(?:pdf|wordprocessingml|msword|opendocument\.text|rtf|epub)/.test(mediaType))return "document";
    if(["js","jsx","ts","tsx","mjs","cjs","py","java","kt","kts","go","rs","c","h","cc","cpp","cs","php","rb","swift","vue","svelte","html","css","scss","sql","sh","zsh","yaml","yml","toml","json","xml"].includes(extension)||/(?:javascript|typescript|json|xml|yaml|shellscript|sql)/.test(mediaType))return "code";
    return "file";
  }
  function canvasAgentPromptContext() {
    const attachment=canvasAgent.attachments.find(item=>item?.kind==="file")||canvasAgent.attachments.find(item=>item?.kind==="image")||null;
    if(attachment)return canvasAgentPromptFileContext(attachment);
    if(canvasAgentReferencedIds().length||state.selection?.box)return "selection";
    const project=canvasAgentProjectById();
    if(project?.kind==="file")return canvasAgentPromptFileContext(project);
    if(project?.kind==="folder"||canvasAgent.projectId)return "project";
    const full={x:0,y:0,w:SIZE,h:SIZE};
    if(visibleInkBounds(full))return "notes";
    const imageOnly=state.images.length&&!state.widgets.length&&!state.textBoxes.length&&!state.animations.length&&!state.preservedSnapshotAnimations.length;
    if(imageOnly)return "image";
    return canvasAgentContentBounds()?"canvas":"blank";
  }
  function canvasAgentPromptSuggestionSet() {
    const context=canvasAgentPromptContext(),primaryIds=CANVAS_AGENT_PROMPT_PRIMARY[context]||CANVAS_AGENT_PROMPT_PRIMARY.blank,
      ids=[...CANVAS_AGENT_PROMPT_ADDITIONAL.filter(id=>!primaryIds.includes(id)),...primaryIds],suggestions=ids.map(id=>({id,...CANVAS_AGENT_PROMPT_LIBRARY[id]})).filter(item=>item.prompt);
    return {key:context,suggestions};
  }
  function canvasAgentPromptHasDraft() {
    return Boolean(canvasAgentInput.value.trim()||canvasAgent.inkPresent||canvasAgent.attachments.length||canvasAgent.references.length);
  }
  function canvasAgentPromptNeedsManualExpansion() {
    return canvasAgentPromptHasDraft()||Boolean(canvasAgent.currentConversation?.items?.length);
  }
  function canvasAgentPromptRowsVisible() {
    return canvasAgent.promptSuggestionsExpanded||(!canvasAgent.promptSuggestionsCollapsedAll&&!canvasAgentPromptNeedsManualExpansion());
  }
  function canvasAgentSetPromptSuggestionsExpanded(expanded,{manual=canvasAgent.promptSuggestionsManual,collapseAll=canvasAgent.promptSuggestionsCollapsedAll}={}) {
    canvasAgent.promptSuggestionsExpanded=Boolean(expanded);
    canvasAgent.promptSuggestionsManual=canvasAgent.promptSuggestionsExpanded&&Boolean(manual);
    canvasAgent.promptSuggestionsCollapsedAll=!canvasAgent.promptSuggestionsExpanded&&Boolean(collapseAll);
    const rowsVisible=canvasAgentPromptRowsVisible();
    canvasAgentPromptSuggestions?.classList.toggle("expanded",canvasAgent.promptSuggestionsExpanded);
    canvasAgentPromptSuggestions?.classList.toggle("prompt-rows-visible",rowsVisible);
    if(canvasAgentPromptPopup)canvasAgentPromptPopup.hidden=!rowsVisible;
    if(canvasAgentAdditionalPromptList)canvasAgentAdditionalPromptList.hidden=!canvasAgent.promptSuggestionsExpanded;
    if(canvasAgentPrimaryPromptList)canvasAgentPrimaryPromptList.hidden=canvasAgent.promptSuggestionsCollapsedAll||(canvasAgentPromptNeedsManualExpansion()&&!canvasAgent.promptSuggestionsExpanded);
    if(canvasAgentPromptToggle){
      const key=rowsVisible?"canvasAgentPromptLess":"canvasAgentPromptMore",label=t(key);
      canvasAgentPromptToggle.setAttribute("aria-expanded",String(rowsVisible));
      canvasAgentPromptToggle.setAttribute("aria-label",label);
      canvasAgentPromptToggle.setAttribute("title",label);
    }
  }
  function canvasAgentCreatePromptIcon(iconName) {
    const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
    svg.setAttribute("class","canvas-agent-prompt-icon");
    svg.setAttribute("viewBox","0 0 24 24");
    svg.setAttribute("aria-hidden","true");
    for(const d of CANVAS_AGENT_PROMPT_ICON_PATHS[iconName]||CANVAS_AGENT_PROMPT_ICON_PATHS.visual){
      const path=document.createElementNS("http://www.w3.org/2000/svg","path");
      path.setAttribute("d",d);
      svg.append(path);
    }
    return svg;
  }
  function canvasAgentRenderPromptSuggestions(suggestionSet=canvasAgentPromptSuggestionSet()) {
    if(!canvasAgentPrimaryPromptList)return;
    const renderList=(list,suggestions)=>{
      if(!list)return;
      list.replaceChildren();
      for(const suggestion of suggestions){
        const button=document.createElement("button"),copy=document.createElement("span"),focus=document.createElement("strong"),detail=document.createElement("span"),prompt=t(suggestion.prompt),focusText=t(suggestion.focus);
        button.type="button";
        button.dataset.promptKey=suggestion.prompt;
        copy.className="canvas-agent-prompt-copy";
        focus.textContent=focusText;
        detail.textContent=prompt;
        copy.append(focus,detail);
        button.append(canvasAgentCreatePromptIcon(suggestion.icon),copy);
        button.setAttribute("title",prompt);
        button.setAttribute("aria-label",`${focusText}: ${prompt}`);
        button.addEventListener("click",()=>canvasAgentChoosePromptSuggestion(suggestion.prompt));
        list.append(button);
      }
    };
    const suggestions=suggestionSet.suggestions,primaryStart=Math.max(0,suggestions.length-3);
    canvasAgent.promptSuggestionContextKey=suggestionSet.key;
    canvasAgent.promptSuggestions=suggestions;
    renderList(canvasAgentAdditionalPromptList,suggestions.slice(0,primaryStart));
    renderList(canvasAgentPrimaryPromptList,suggestions.slice(primaryStart));
    canvasAgentPromptSuggestions.setAttribute("aria-label",t("canvasAgentPromptSuggestions"));
    canvasAgentSetPromptSuggestionsExpanded(canvasAgent.promptSuggestionsExpanded);
  }
  function canvasAgentPreventPromptSuggestionFocusLoss(event) {
    if(event.target?.closest?.("button"))event.preventDefault();
  }
  function canvasAgentPromptSuggestionsAvailable() {
    return Boolean(canvasAgentPromptSuggestions
      && !canvasAgentPanel.hidden
      && canvasAgent.inputMode==="text"
      && !canvasAgent.inkPresent
      && !canvasAgent.requestPending
      && !canvasAgent.running
      && !canvasAgent.viewingHistoryId
      && !canvasAgent.pendingApproval
      && !canvasAgent.attachmentBusy
      && !canvasAgent.projectUploadBusy
      && !canvasAgentInput.disabled
      && canvasAgentReferencePicker.hidden
      && canvasAgentApproval.hidden);
  }
  function canvasAgentShouldShowPromptSuggestions() {
    return canvasAgentPromptSuggestionsAvailable();
  }
  function canvasAgentSyncPromptSuggestions() {
    if(!canvasAgentPromptSuggestions)return;
    const suggestionSet=canvasAgentPromptSuggestionSet();
    if(suggestionSet.key!==canvasAgent.promptSuggestionContextKey)canvasAgentRenderPromptSuggestions(suggestionSet);
    const visible=canvasAgentShouldShowPromptSuggestions();
    canvasAgentPromptSuggestions.hidden=!visible;
    if(visible){
      canvasAgentInputHint.hidden=true;
      canvasAgentSetPromptSuggestionsExpanded(canvasAgent.promptSuggestionsExpanded);
    }
    else{
      canvasAgentSetPromptSuggestionsExpanded(false,{collapseAll:false});
      canvasAgentSyncInputHint();
    }
  }
  function canvasAgentExpandPromptSuggestionsOnPointerEnter() {
    if(!canvasAgent.promptSuggestionsCollapsedAll&&!canvasAgentPromptNeedsManualExpansion())canvasAgentSetPromptSuggestionsExpanded(true,{manual:false});
  }
  function canvasAgentCollapsePromptSuggestionsOnPointerLeave() {
    if(canvasAgent.promptSuggestionsManual)return;
    if(canvasAgentPromptSuggestions?.contains(document.activeElement))return;
    canvasAgentSetPromptSuggestionsExpanded(false);
  }
  function canvasAgentSyncPromptSuggestionsFocus() {
    if(!canvasAgentPromptSuggestions)return;
    if(!canvasAgentForm.contains(document.activeElement)&&!canvasAgentPromptSuggestions.contains(document.activeElement))canvasAgentSetPromptSuggestionsExpanded(false);
    else if(!canvasAgentPromptSuggestions.contains(document.activeElement)&&!canvasAgent.promptSuggestionsManual)canvasAgentSetPromptSuggestionsExpanded(false);
    canvasAgentSyncPromptSuggestions();
  }
  function canvasAgentTogglePromptSuggestions() {
    if(canvasAgentPromptRowsVisible())canvasAgentSetPromptSuggestionsExpanded(false,{collapseAll:true});
    else canvasAgentSetPromptSuggestionsExpanded(true,{manual:true,collapseAll:false});
  }
  function canvasAgentCollapsePromptSuggestionsFromPanel(event) {
    if(canvasAgentPromptSuggestions?.hidden||!canvasAgentPromptRowsVisible()||canvasAgentPromptSuggestions.contains(event.target))return;
    canvasAgentSetPromptSuggestionsExpanded(false,{collapseAll:true});
  }
  function canvasAgentChoosePromptSuggestion(promptKey) {
    const suggestion=canvasAgent.promptSuggestions.find(item=>item.prompt===promptKey);
    if(!suggestion||canvasAgentInput.disabled)return false;
    canvasAgentInput.value=t(suggestion.prompt);
    canvasAgentSetPromptSuggestionsExpanded(false);
    canvasAgentInput.dispatchEvent(new Event("input",{bubbles:true}));
    canvasAgentInput.focus();
    canvasAgentInput.setSelectionRange?.(canvasAgentInput.value.length,canvasAgentInput.value.length);
    return true;
  }
  function updateCanvasAgentLanguage() {
    canvasAgentSetComposerActionLabel(canvasAgentSend,canvasAgent.running ? "canvasAgentSteer" : "canvasAgentSend");
    canvasAgentSetComposerActionLabel(canvasAgentStop,"canvasAgentStop");
    canvasAgentInputHint.textContent = t("canvasAgentInputHint");
    canvasAgentRenderPromptSuggestions();
    canvasAgentInput.setAttribute("placeholder",t("canvasAgentPlaceholder"));
    canvasAgentInput.setAttribute("aria-label",t("canvasAgentMessage"));
    canvasAgentInkCanvas.setAttribute("aria-label",t("canvasAgentHandwrite"));
    canvasAgentClearInkButton.textContent=t("canvasAgentClearInk");
    for (const [button,key] of [[canvasAgentTextMode,"canvasAgentType"],[canvasAgentInkMode,"canvasAgentHandwrite"]]) {
      button.setAttribute("aria-label",t(key));
      button.setAttribute("title",t(key));
    }
    canvasAgentReference.setAttribute("aria-label",t("canvasAgentReferenceWidget"));
    canvasAgentReference.setAttribute("title",t("canvasAgentReferenceWidgetTitle"));
    canvasAgentReferencePicker.setAttribute("aria-label",t("canvasAgentReferenceWidget"));
    canvasAgentReferenceHelp.textContent=t("canvasAgentReferenceHelp");
    canvasAgentReferenceSearch.setAttribute("placeholder",t("canvasAgentReferenceSearch"));
    canvasAgentReferenceSearch.setAttribute("aria-label",t("canvasAgentReferenceSearch"));
    canvasAgentSelection.setAttribute("aria-label",t("canvasAgentReferences"));
    canvasAgentHead.setAttribute("title",t("canvasAgentMove"));
    canvasAgentResizeTop.setAttribute("aria-label",t("canvasAgentResizeTop"));
    canvasAgentResizeBottom.setAttribute("aria-label",t("canvasAgentResizeBottom"));
    canvasAgentResizeLeft.setAttribute("aria-label",t("canvasAgentResizeLeft"));
    canvasAgentResizeRight.setAttribute("aria-label",t("canvasAgentResizeRight"));
    canvasAgentAttach.setAttribute("aria-label",t("canvasAgentAttach"));
    canvasAgentAttach.setAttribute("title",t("canvasAgentAttachTitle"));
    canvasAgentUpdateSearchButton();
    canvasAgentAttachments.setAttribute("aria-label",t("canvasAgentAttachments"));
    canvasAgentProjectButton.setAttribute("aria-label",t("canvasAgentProject"));
    canvasAgentProjectButton.setAttribute("title",t("canvasAgentProject"));
    canvasAgentProjectClose.setAttribute("aria-label",t("canvasAgentProjectClose"));
    canvasAgentProjectRootBack.setAttribute("aria-label",t("canvasAgentRootBack"));
    canvasAgentProjectRootSelect.textContent=t("canvasAgentRootSelect");
    canvasAgentProjectRootTruncated.textContent=t("canvasAgentRootTruncated");
    canvasAgentProjectRootApproval.setAttribute("aria-label",t("canvasAgentRootApprovalTitle"));
    canvasAgentProjectRootApproval.querySelector("strong").textContent=t("canvasAgentRootApprovalTitle");
    canvasAgentProjectRootApprovalReject.textContent=t("canvasAgentRootApprovalReject");
    canvasAgentProjectRootApprovalAllow.textContent=t("canvasAgentRootApprovalAllow");
    if(canvasAgent.projectRootApproval)canvasAgentProjectRootApprovalDetail.textContent=t("canvasAgentRootApprovalDetail").replace("{name}",canvasAgent.projectRootApproval.name);
    canvasAgentApproval.setAttribute("aria-label",t("canvasAgentApproval"));
    const statusKey = { ready:"canvasAgentReady", connecting:"canvasAgentConnecting", running:"canvasAgentWorking", offline:"canvasAgentDisconnected", history:"canvasAgentHistoryViewing" }[canvasAgentPanel.dataset.status];
    if (statusKey) canvasAgentStatus.textContent = t(statusKey);
    else if(canvasAgentPanel.dataset.status==="error"&&canvasAgent.lastTurnError)canvasAgentStatus.textContent=canvasAgentErrorSummary(canvasAgent.lastTurnError);
    for (const target of canvasAgent.toolRows.values()) canvasAgentRenderToolRow(target);
    for (const block of canvasAgentTranscript.querySelectorAll(".canvas-agent-copy-block")) {
      block.querySelector(".canvas-agent-copy-block-language").textContent=canvasAgentBlockLabel(block.dataset.language||"");
      const button=block.querySelector(".canvas-agent-copy-block-button"), key=button.classList.contains("copied")?"canvasAgentBlockCopied":button.classList.contains("error")?"canvasAgentBlockCopyFailed":"canvasAgentCopyBlock";
      button.textContent=t(key);
    }
    for (const button of canvasAgentTranscript.querySelectorAll(".canvas-agent-message-copy")) canvasAgentSetAssistantCopyState(button,button.dataset.copyState||"idle");
    for(const row of canvasAgentTranscript.querySelectorAll(".canvas-agent-message.error"))if(row._canvasAgentErrorTarget)canvasAgentRenderErrorElement(row._canvasAgentErrorTarget);
    canvasAgentSyncSelection();
    if (!canvasAgentReferencePicker.hidden) canvasAgentRenderReferencePicker(canvasAgentReferenceSearch.value);
    canvasAgentRenderHistoryList();
    canvasAgentRenderProjects();
    if (canvasAgentTranscript.querySelector(".canvas-agent-empty")) canvasAgentRenderEmpty();
    canvasAgentSyncInputHint();
    canvasAgentSyncPromptSuggestions();
  }
  async function canvasAgentProjectRequest(path, options = {}) {
    const response=await fetch(path,{cache:"no-store",credentials:"same-origin",...options,headers:{accept:"application/json",...(options.body?{"content-type":"application/json"}:{}),...(options.headers||{})}}),body=await response.json().catch(()=>({}));
    if(!response.ok)throw Object.assign(Error(body?.error||`Project request failed (HTTP ${response.status}).`),{code:String(body?.code||""),status:response.status});
    return body;
  }
  function canvasAgentProjectById(id=canvasAgent.projectId) {
    return canvasAgent.projects.find(project=>project.id===id)||null;
  }
  function canvasAgentProjectDisplayPath(project) {
    return String(project?.displayPath||project?.name||"").slice(0,1024);
  }
  function canvasAgentEffectiveAccessMode() {
    return "controlled";
  }
  function canvasAgentProjectRootApi() {
    return window.PENECHO_CONFIG?.runtime==="cloud"
      ? { roots:"/api/canvas-agent/roots", entries:"/api/canvas-agent/roots", select:"/api/canvas-agent/projects/from-root" }
      : { roots:"/api/canvas-agent/host-roots", entries:"/api/canvas-agent/host-roots", select:"/api/canvas-agent/projects/from-host-root" };
  }
  function canvasAgentProjectFileBase64(file) {
    return new Promise((resolve,reject)=>{
      const reader=new FileReader();
      reader.addEventListener("error",()=>reject(reader.error||Error(t("canvasAgentFileReadFailed"))),{once:true});
      reader.addEventListener("abort",()=>reject(Error(t("canvasAgentFileReadFailed"))),{once:true});
      reader.addEventListener("load",()=>{
        const result=String(reader.result||""),separator=result.indexOf(",");
        if(separator<0)return reject(Error(t("canvasAgentFileReadFailed")));
        resolve(result.slice(separator+1));
      },{once:true});
      reader.readAsDataURL(file);
    });
  }
  function canvasAgentClipboardFiles(dataTransfer) {
    const direct=[...(dataTransfer?.files||[])].filter(file=>file instanceof Blob);
    if(direct.length)return direct;
    return [...(dataTransfer?.items||[])].filter(item=>item.kind==="file").map(item=>item.getAsFile()).filter(file=>file instanceof Blob);
  }
  async function canvasAgentDesktopClipboardFiles() {
    const desktop=window.penechoDesktop,plural=typeof desktop?.readClipboardFiles==="function";
    if(!plural&&typeof desktop?.readClipboardFile!=="function")return [];
    const payload=await (plural?desktop.readClipboardFiles():desktop.readClipboardFile());
    if(!payload?.ok){if(payload?.code==="too_many")throw Error(t("canvasAgentAttachmentLimit"));if(payload?.code==="too_large")throw Error(t("canvasAgentUploadTooLarge"));if(payload?.code==="empty")throw Error(t("canvasAgentUploadEmpty"));return [];}
    const values=Array.isArray(payload.files)?payload.files:[payload],files=[];
    for(const value of values){
      if(typeof value?.data!=="string"||!Number.isSafeInteger(value.size)||value.size<1||value.size>CANVAS_AGENT_PROJECT_UPLOAD_LIMIT)return [];
      let binary="";
      try{binary=atob(value.data);}catch{return [];}
      if(binary.length!==value.size)return [];
      const bytes=new Uint8Array(binary.length);
      for(let index=0;index<binary.length;index++)bytes[index]=binary.charCodeAt(index);
      binary="";
      files.push(new File([bytes],String(value.name||"copied-file").slice(0,240),{lastModified:Number(value.lastModified)||Date.now()}));
    }
    return files;
  }
  function canvasAgentImageFile(file) {
    if(!(file instanceof Blob))return null;
    const suppliedType=String(file.type||"").toLowerCase(),name=String(file.name||""),dot=name.lastIndexOf("."),extension=dot>=0?name.slice(dot).toLowerCase():"",
      mediaType=CANVAS_AGENT_IMAGE_MEDIA_TYPES.has(suppliedType)?suppliedType:CANVAS_AGENT_IMAGE_EXTENSION_TYPES.get(extension);
    if(!mediaType)return null;
    if(suppliedType===mediaType)return file;
    return new File([file],name||"pasted-image",{type:mediaType,lastModified:Number(file.lastModified)||Date.now()});
  }
  function canvasAgentSetProjectError(message="") {
    canvasAgentProjectError.textContent=String(message||"");
    canvasAgentProjectError.hidden=!message;
  }
  function canvasAgentUpdateProjectButton() {
    const project=canvasAgentProjectById();
    canvasAgentProjectLabel.textContent=project?.name||t("canvasAgentNoProject");
    canvasAgentProjectControl.classList.toggle("has-resource",Boolean(project));
    canvasAgentProjectButton.classList.toggle("has-project",Boolean(project));
    canvasAgentProjectButton.classList.toggle("has-file",project?.kind==="file");
    canvasAgentProjectButton.title=project?`${project.name} — ${canvasAgentProjectDisplayPath(project)}`:t("canvasAgentProject");
    canvasAgentProjectClear.hidden=!project;
    if(project){
      const clearLabel=t("canvasAgentClearResource").replace("{name}",project.name);
      canvasAgentProjectClear.setAttribute("aria-label",clearLabel);
      canvasAgentProjectClear.title=clearLabel;
    }
  }
  function canvasAgentResourceIcon(kind) {
    const wrapper=document.createElement("span"),svg=document.createElementNS("http://www.w3.org/2000/svg","svg"),paths=kind==="folder"
      ? ["M3.5 7.5h6l2-2h9v13h-17z","M3.5 9.5h17"]
      : kind==="file"
        ? ["M6 3h8l4 4v14H6z","M14 3v5h5"]
        : ["M4 12a8 8 0 1 0 16 0 8 8 0 1 0-16 0Z","M4 12h16M12 4c2 2.2 3 4.8 3 8s-1 5.8-3 8M12 4c-2 2.2-3 4.8-3 8s1 5.8 3 8"];
    wrapper.className=`canvas-agent-resource-icon ${kind}`;
    svg.setAttribute("viewBox","0 0 24 24");svg.setAttribute("aria-hidden","true");
    for(const data of paths){const path=document.createElementNS("http://www.w3.org/2000/svg","path");path.setAttribute("d",data);svg.append(path);}
    wrapper.append(svg);
    return wrapper;
  }
  function canvasAgentProjectEmpty(message) {
    const empty=document.createElement("p");
    empty.className="canvas-agent-project-empty";empty.textContent=message;
    return empty;
  }
  function canvasAgentProjectRootApprovalKey(rootId,relativePath) {
    return `${String(rootId||"")}\n${String(relativePath||"")}`;
  }
  function canvasAgentProjectRootApproved(rootId,relativePath) {
    const path=String(relativePath||"");
    for(const approved of canvasAgent.projectRootApprovals){
      const separator=approved.indexOf("\n"),approvedRoot=approved.slice(0,separator),approvedPath=approved.slice(separator+1);
      if(approvedRoot===rootId&&(path===approvedPath||path.startsWith(`${approvedPath}/`)))return true;
    }
    return false;
  }
  function canvasAgentRequestProjectRootApproval(rootId,entry) {
    canvasAgent.projectRootApproval={rootId:String(rootId||""),relativePath:String(entry?.relativePath||""),name:String(entry?.name||"").slice(0,255)};
    canvasAgentRenderProjectRoots();
    canvasAgentProjectRootApprovalAllow.focus();
  }
  function canvasAgentResolveProjectRootApproval(allowed) {
    const approval=canvasAgent.projectRootApproval;
    canvasAgent.projectRootApproval=null;
    if(!approval){canvasAgentRenderProjectRoots();return;}
    if(!allowed){canvasAgentRenderProjectRoots();return;}
    canvasAgent.projectRootApprovals.add(canvasAgentProjectRootApprovalKey(approval.rootId,approval.relativePath));
    canvasAgentRenderProjectRoots();
    void canvasAgentBrowseProjectRoot(approval.rootId,approval.relativePath);
  }
  function canvasAgentProjectRow(project) {
    const row=document.createElement("div"),choice=document.createElement("button"),copy=document.createElement("span"),title=document.createElement("strong"),detail=document.createElement("small"),remove=document.createElement("button"),selected=project.id===canvasAgent.projectId,
      kindLabel=project.kind==="folder"?t("canvasAgentFolderProject"):project.source==="upload"?t("canvasAgentUploadedFile"):t("canvasAgentLocalFile");
    row.className="canvas-agent-project-row";
    choice.className="canvas-agent-project-choice";choice.type="button";choice.setAttribute("aria-pressed",String(selected));
    copy.className="canvas-agent-project-choice-copy";title.textContent=project.name;detail.textContent=`${kindLabel} · ${t("canvasAgentFileReadOnly")} · ${canvasAgentProjectDisplayPath(project)}`;copy.append(title,detail);
    choice.append(canvasAgentResourceIcon(project.kind),copy);
    if(selected){const current=document.createElement("span");current.className="canvas-agent-project-current";current.textContent=t("canvasAgentCurrentResource");choice.append(current);}
    choice.addEventListener("click",()=>void canvasAgentSelectProject(project.id));
    remove.className="canvas-agent-project-remove";remove.type="button";remove.textContent="×";remove.setAttribute("aria-label",`${t("canvasAgentRemoveProject")}: ${project.name}`);remove.title=t("canvasAgentRemoveProject");
    remove.addEventListener("click",event=>{event.stopPropagation();void canvasAgentRemoveProject(project.id);});
    row.append(choice,remove);
    return row;
  }
  function canvasAgentRenderProjectRoots() {
    const view=canvasAgent.projectRootView,open=canvasAgent.projectRootChooserOpen,approval=canvasAgent.projectRootApproval;
    canvasAgentProjectRoots.hidden=!open;
    canvasAgentProjectCreate.setAttribute("aria-expanded",String(open));
    canvasAgentProjectCreate.lastElementChild.textContent=t(open?"canvasAgentCancelProjectCreate":"canvasAgentNewProject");
    if(!open)return;
    canvasAgentProjectRootList.replaceChildren();
    canvasAgentProjectRootApproval.hidden=!approval;
    if(approval)canvasAgentProjectRootApprovalDetail.textContent=t("canvasAgentRootApprovalDetail").replace("{name}",approval.name);
    canvasAgentProjectRootBack.hidden=!view;
    canvasAgentProjectRootPath.textContent=view?[view.rootName,view.relativePath].filter(Boolean).join("/"):t("canvasAgentServerFolders");
    canvasAgentProjectRootSelect.hidden=!view||view.selectable===false||view.permissionDenied===true;
    canvasAgentProjectRootSelect.disabled=canvasAgent.projectRootBusy;
    canvasAgentProjectRootTruncated.hidden=!view?.truncated;
    if(canvasAgent.projectRootBusy){
      const loading=document.createElement("button"),title=document.createElement("strong");
      loading.type="button";loading.disabled=true;title.textContent=t("canvasAgentRootLoading");loading.append(title);canvasAgentProjectRootList.append(loading);
      return;
    }
    if(view?.permissionDenied){
      const blocked=document.createElement("button"),title=document.createElement("strong"),detail=document.createElement("small");
      blocked.type="button";blocked.disabled=true;title.textContent=view.relativePath.split("/").at(-1)||view.rootName;detail.textContent=t("canvasAgentRootPermissionDenied");blocked.append(title,detail);canvasAgentProjectRootList.append(blocked);return;
    }
    const entries=view?.entries||canvasAgent.projectRoots;
    if(!entries.length){
      const empty=document.createElement("button"),title=document.createElement("strong");
      empty.type="button";empty.disabled=true;title.textContent=t("canvasAgentNoHostFolders");empty.append(title);canvasAgentProjectRootList.append(empty);return;
    }
    for(const entry of entries){
      const choice=document.createElement("button"),title=document.createElement("strong"),detail=document.createElement("small");
      choice.type="button";
      title.textContent=entry.name;
      detail.textContent=entry.permissionDenied?t("canvasAgentRootPermissionDenied"):entry.approvalRequired?t("canvasAgentRootApprovalRequired"):view?entry.relativePath:t("canvasAgentServerFoldersDetail");
      choice.disabled=entry.permissionDenied===true;
      choice.append(title,detail);
      choice.addEventListener("click",()=>entry.approvalRequired?canvasAgentRequestProjectRootApproval(view?.rootId||entry.id,entry):void canvasAgentBrowseProjectRoot(view?.rootId||entry.id,view?entry.relativePath:""));
      canvasAgentProjectRootList.append(choice);
    }
  }
  function canvasAgentRenderProjects() {
    if(!canvasAgentProjectList||!canvasAgentFileList)return;
    const folders=canvasAgent.projects.filter(project=>project.kind==="folder"),files=canvasAgent.projects.filter(project=>project.kind==="file");
    canvasAgentProjectList.replaceChildren();canvasAgentFileList.replaceChildren();
    canvasAgentProjectCount.textContent=String(folders.length);canvasAgentFileCount.textContent=String(files.length);
    const browserRow=document.createElement("div"),browser=document.createElement("button"),browserCopy=document.createElement("span"),browserTitle=document.createElement("strong"),browserDetail=document.createElement("small"),browserSelected=!canvasAgent.projectId;
    browserRow.className="canvas-agent-project-row";
    browser.className="canvas-agent-project-choice";
    browser.type="button";
    browser.setAttribute("aria-pressed",String(browserSelected));
    browserCopy.className="canvas-agent-project-choice-copy";
    browserTitle.textContent=t("canvasAgentBrowserSpace");
    browserDetail.textContent=t("canvasAgentBrowserSpaceDetail");
    browserCopy.append(browserTitle,browserDetail);browser.append(canvasAgentResourceIcon("browser"),browserCopy);
    if(browserSelected){const current=document.createElement("span");current.className="canvas-agent-project-current";current.textContent=t("canvasAgentCurrentResource");browser.append(current);}
    browser.addEventListener("click",()=>void canvasAgentSelectProject(""));
    browserRow.append(browser);
    canvasAgentProjectList.append(browserRow);
    for(const project of folders)canvasAgentProjectList.append(canvasAgentProjectRow(project));
    if(!folders.length)canvasAgentProjectList.append(canvasAgentProjectEmpty(t("canvasAgentNoProjects")));
    for(const project of files)canvasAgentFileList.append(canvasAgentProjectRow(project));
    if(!files.length)canvasAgentFileList.append(canvasAgentProjectEmpty(t("canvasAgentNoFiles")));
    canvasAgentRenderProjectRoots();
    canvasAgentUpdateProjectButton();
  }
  async function canvasAgentLoadProjectHistory(projectId=canvasAgent.projectId,revision=canvasAgent.projectSelectionRevision) {
    const selectedId=String(projectId||""),stillSelected=()=>canvasAgent.projectId===selectedId&&canvasAgent.projectSelectionRevision===revision;
    if(!selectedId){
      if(!stillSelected())return false;
      canvasAgent.projectHistory=[];canvasAgent.projectHistoryLoaded=true;return true;
    }
    let body;
    try{body=await canvasAgentProjectRequest(`/api/canvas-agent/projects/${encodeURIComponent(selectedId)}/history`);}
    catch(error){if(!stillSelected())return false;throw error;}
    if(!stillSelected())return false;
    canvasAgent.projectHistory=(Array.isArray(body?.conversations)?body.conversations:[]).map(canvasAgentNormalizeConversation).filter(conversation=>conversation?.items.length).slice(0,CANVAS_AGENT_HISTORY_LIMIT);
    canvasAgent.projectHistoryLoaded=true;
    return true;
  }
  async function canvasAgentEnsureProjects({refresh=false}={}) {
    if(canvasAgent.projectsLoaded&&!refresh){
      if(canvasAgent.projectId&&!canvasAgent.projectHistoryLoaded)await canvasAgentLoadProjectHistory(canvasAgent.projectId,canvasAgent.projectSelectionRevision);
      return;
    }
    const requestRevision=++canvasAgent.projectListRequestRevision;
    let body;
    try{body=await canvasAgentProjectRequest("/api/canvas-agent/projects");}
    catch(error){if(requestRevision!==canvasAgent.projectListRequestRevision)return false;throw error;}
    if(requestRevision!==canvasAgent.projectListRequestRevision)return false;
    canvasAgent.projects=(Array.isArray(body?.projects)?body.projects:[]).filter(project=>project&&/^(?:local|file)-[0-9a-f]{24}$/.test(String(project.id||""))&&["folder","file"].includes(project.kind)).map(project=>({
      id:String(project.id),kind:project.kind,name:String(project.name||"").slice(0,255),displayPath:String(project.displayPath||project.name||"").slice(0,1024),
      source:String(project.source||project.origin||""),reader:String(project.reader||""),mediaType:String(project.mediaType||""),bytes:Number.isFinite(Number(project.bytes))?Number(project.bytes):0,
    })).filter(project=>project.name&&project.displayPath);
    canvasAgent.projectsLoaded=true;
    if(canvasAgent.projectId&&!canvasAgentProjectById()){
      canvasAgentResolveApproval(false);
      canvasAgentPersistCurrentConversation();
      canvasAgent.projectSelectionRevision++;
      canvasAgent.projectId="";
      canvasAgent.projectHistory=[];
      canvasAgent.projectHistoryLoaded=true;
      canvasAgent.accessMode="controlled";
      localStorage.removeItem(CANVAS_AGENT_PROJECT_KEY);
      canvasAgentBeginLocalConversation({persistCurrent:false});
      canvasAgentDropSessionIdentity();
    }
    await canvasAgentLoadProjectHistory(canvasAgent.projectId,canvasAgent.projectSelectionRevision);
    canvasAgentRenderProjects();
    canvasAgentSyncPromptSuggestions();
    return true;
  }
  async function canvasAgentEnsureProjectRoots({refresh=false}={}) {
    if(canvasAgent.projectRootBusy||canvasAgent.projectRootsLoaded&&!refresh)return;
    canvasAgent.projectRootBusy=true;canvasAgentRenderProjectRoots();
    try{
      const body=await canvasAgentProjectRequest(canvasAgentProjectRootApi().roots);
      canvasAgent.projectRoots=(Array.isArray(body?.roots)?body.roots:[]).filter(root=>root&&/^root-[0-9a-f]{24}$/.test(String(root.id||""))&&typeof root.name==="string").map(root=>({id:String(root.id),name:String(root.name).slice(0,120)}));
      canvasAgent.projectRootsLoaded=true;
      if(canvasAgent.projectRootView&&!canvasAgent.projectRoots.some(root=>root.id===canvasAgent.projectRootView.rootId))canvasAgent.projectRootView=null;
    }finally{canvasAgent.projectRootBusy=false;canvasAgentRenderProjectRoots();}
  }
  function canvasAgentToggleProjectRootChooser(force=null) {
    const open=force===null?!canvasAgent.projectRootChooserOpen:Boolean(force);
    canvasAgent.projectRootChooserOpen=open;
    if(!open){canvasAgent.projectRootView=null;canvasAgent.projectRootApproval=null;canvasAgent.projectRootApprovals.clear();}
    canvasAgentSetProjectError();canvasAgentRenderProjectRoots();
    if(open)void canvasAgentEnsureProjectRoots({refresh:true}).catch(error=>{canvasAgent.projectRoots=[];canvasAgent.projectRootsLoaded=true;canvasAgentRenderProjectRoots();canvasAgentSetProjectError(String(error?.message||error));});
  }
  async function canvasAgentBrowseProjectRoot(rootId,relativePath="") {
    if(canvasAgent.projectRootBusy||!/^root-[0-9a-f]{24}$/.test(String(rootId||"")))return;
    canvasAgent.projectRootBusy=true;canvasAgentSetProjectError();canvasAgentRenderProjectRoots();
    try{
      const params=new URLSearchParams({path:String(relativePath||"")});
      if(canvasAgentProjectRootApproved(rootId,relativePath))params.set("approved","1");
      const body=await canvasAgentProjectRequest(`${canvasAgentProjectRootApi().entries}/${encodeURIComponent(rootId)}/entries?${params}`),view=body?.browser||body,
        resolvedRootId=String(view?.rootId||view?.root?.id||""),rootName=String(view?.rootName||view?.root?.name||"").slice(0,120),resolvedPath=String(view?.relativePath??view?.path??"").slice(0,1024);
      if(resolvedRootId!==rootId||!rootName)throw Error("The server folder response is invalid.");
      const parentPath=view?.parentPath===null?null:String(view?.parentPath||"").slice(0,1024),entries=(Array.isArray(view?.entries)?view.entries:[]).filter(entry=>entry?.kind==="folder"&&typeof entry.name==="string"&&typeof (entry.relativePath??entry.path)==="string").slice(0,200).map(entry=>{const childPath=String(entry.relativePath??entry.path).slice(0,1024);return{name:String(entry.name).slice(0,255),relativePath:childPath,approvalRequired:entry.approvalRequired===true&&!canvasAgentProjectRootApproved(resolvedRootId,childPath),permissionDenied:entry.permissionDenied===true};});
      canvasAgent.projectRootApproval=null;
      canvasAgent.projectRootView={rootId:resolvedRootId,rootName,relativePath:resolvedPath,parentPath,entries,truncated:Boolean(view?.truncated),selectable:view?.selectable!==false,permissionDenied:view?.permissionDenied===true};
    }catch(error){canvasAgentSetProjectError(String(error?.message||error));}
    finally{canvasAgent.projectRootBusy=false;canvasAgentRenderProjectRoots();}
  }
  async function canvasAgentNavigateProjectRootBack() {
    const view=canvasAgent.projectRootView;
    if(!view||canvasAgent.projectRootBusy)return;
    canvasAgent.projectRootApproval=null;
    if(view.parentPath===null){canvasAgent.projectRootView=null;canvasAgentRenderProjectRoots();return;}
    await canvasAgentBrowseProjectRoot(view.rootId,view.parentPath);
  }
  async function canvasAgentSelectProjectRoot() {
    const view=canvasAgent.projectRootView;
    if(!view||canvasAgent.projectRootBusy)return;
    const selectionRevision=canvasAgent.projectSelectionRevision;
    canvasAgent.projectRootBusy=true;canvasAgentSetProjectError();canvasAgentRenderProjectRoots();
    try{
      const body=await canvasAgentProjectRequest(canvasAgentProjectRootApi().select,{method:"POST",body:JSON.stringify({rootId:view.rootId,path:view.relativePath,approved:canvasAgentProjectRootApproved(view.rootId,view.relativePath)})});
      canvasAgent.projectRootView=null;
      await canvasAgentEnsureProjects({refresh:true});
      await canvasAgentSelectProject(body?.project?.id,{expectedRevision:selectionRevision});
    }catch(error){canvasAgentSetProjectError(String(error?.message||error));}
    finally{canvasAgent.projectRootBusy=false;canvasAgentRenderProjectRoots();}
  }
  function canvasAgentWriteProjectHistory(conversations) {
    if(!canvasAgent.projectId||!canvasAgent.projectHistoryLoaded)return;
    const projectId=canvasAgent.projectId,payload={conversations};
    canvasAgent.projectHistoryWrite=canvasAgent.projectHistoryWrite.catch(()=>{}).then(()=>canvasAgentProjectRequest(`/api/canvas-agent/projects/${encodeURIComponent(projectId)}/history`,{method:"PUT",body:JSON.stringify(payload)})).catch(error=>canvasAgentSetStatus(String(error?.message||error),"error"));
  }
  function canvasAgentProjectDialogOpen() {
    return Boolean(canvasAgentProjectPopover.open);
  }
  function canvasAgentShowProjectPopover() {
    if(!canvasAgentProjectDialogOpen()){
      if(typeof canvasAgentProjectPopover.showModal==="function")canvasAgentProjectPopover.showModal();
      else canvasAgentProjectPopover.setAttribute("open","");
    }
    canvasAgentProjectButton.setAttribute("aria-expanded","true");
    canvasAgentProjectClose.focus();
  }
  function canvasAgentHideProjectPopover({restoreFocus=false}={}) {
    if(canvasAgentProjectDialogOpen()){
      if(typeof canvasAgentProjectPopover.close==="function")canvasAgentProjectPopover.close();
      else canvasAgentProjectPopover.removeAttribute("open");
    }
    canvasAgentProjectButton.setAttribute("aria-expanded","false");
    canvasAgent.projectRootChooserOpen=false;canvasAgent.projectRootView=null;canvasAgent.projectRootApproval=null;canvasAgent.projectRootApprovals.clear();canvasAgentRenderProjectRoots();
    canvasAgentSetProjectError();
    if(restoreFocus&&!canvasAgentPanel.hidden)canvasAgentProjectButton.focus();
  }
  async function canvasAgentSelectProject(projectId,{expectedRevision=null,submitExecution=null}={}) {
    if(expectedRevision!==null&&expectedRevision!==canvasAgent.projectSelectionRevision)return false;
    const next=String(projectId||"");
    const revision=++canvasAgent.projectSelectionRevision;
    if(next===canvasAgent.projectId){canvasAgentHideProjectPopover();return true;}
    canvasAgentResolveApproval(false);
    canvasAgentPersistCurrentConversation();
    canvasAgent.projectId=next;
    canvasAgent.projectHistory=[];
    canvasAgent.projectHistoryLoaded=!next;
    canvasAgent.accessMode="controlled";
    if(next)localStorage.setItem(CANVAS_AGENT_PROJECT_KEY,next);else localStorage.removeItem(CANVAS_AGENT_PROJECT_KEY);
    canvasAgentBeginLocalConversation({persistCurrent:false,submitExecution});
    canvasAgentRenderProjects();
    canvasAgentSyncPromptSuggestions();
    canvasAgentHideProjectPopover();
    try{
      if(next&&!await canvasAgentLoadProjectHistory(next,revision))return false;
      if(revision!==canvasAgent.projectSelectionRevision||next!==canvasAgent.projectId)return false;
      canvasAgentRenderHistoryList();
      if(canvasAgent.socket?.readyState===WebSocket.OPEN||canvasAgent.connectPromise)await canvasAgentStartNewConversation(selectedAiConnectionId(),{resetProjection:false,submitExecution});
      else canvasAgentDropSessionIdentity();
      return true;
    }catch(error){
      if(revision!==canvasAgent.projectSelectionRevision||next!==canvasAgent.projectId)return false;
      canvasAgentSetProjectError(String(error?.message||error));canvasAgentSetStatus(String(error?.message||error),"error");return false;
    }
  }
  async function canvasAgentRemoveProject(projectId) {
    const project=canvasAgentProjectById(projectId);
    if(!project)return;
    const confirmKey=project.kind==="folder"?"canvasAgentRemoveFolderConfirm":project.source==="upload"?"canvasAgentRemoveUploadConfirm":"canvasAgentRemoveNativeFileConfirm";
    if(!window.confirm(t(confirmKey).replace("{name}",project.name)))return;
    try{
      if(canvasAgent.projectId===projectId){await canvasAgentSelectProject("");await canvasAgent.projectHistoryWrite;}
      await canvasAgentProjectRequest(`/api/canvas-agent/projects/${encodeURIComponent(projectId)}`,{method:"DELETE"});
      await canvasAgentEnsureProjects({refresh:true});
    }catch(error){canvasAgentSetProjectError(String(error?.message||error));}
  }
  async function canvasAgentUploadProjectFile(file) {
    if(canvasAgent.projectUploadBusy||canvasAgent.attachmentBusy||!file)return;
    if(!Number.isSafeInteger(file.size)||file.size<=0){canvasAgentFileInput.value="";canvasAgentSetStatus(t("canvasAgentUploadEmpty"),"error");return false;}
    if(file.size>CANVAS_AGENT_PROJECT_UPLOAD_LIMIT){canvasAgentFileInput.value="";canvasAgentSetStatus(t("canvasAgentUploadTooLarge"),"error");return false;}
    let data="";
    canvasAgent.projectUploadBusy=true;canvasAgentSetProjectError();canvasAgentRenderProjects();canvasAgentSyncAttachmentButton();
    canvasAgentSetStatus(t("canvasAgentFilePreparing"),"connecting");
    try{
      data=await canvasAgentProjectFileBase64(file);
      const body=await canvasAgentProjectRequest("/api/canvas-agent/files",{method:"POST",body:JSON.stringify({name:file.name,mediaType:String(file.type||""),bytes:file.size,data})});
      await canvasAgentEnsureProjects({refresh:true});
      canvasAgentSetStatus(t("canvasAgentReady"),"ready");
      return body?.project||null;
    }catch(error){canvasAgentSetStatus(String(error?.message||error),"error");return false;}
    finally{data="";canvasAgentFileInput.value="";canvasAgent.projectUploadBusy=false;canvasAgentRenderProjects();canvasAgentSyncAttachmentButton();}
  }
  function canvasAgentResolveApproval(allowed) {
    const pending=canvasAgent.pendingApproval;
    if(!pending)return;
    canvasAgent.pendingApproval=null;
    canvasAgentApproval.hidden=true;
    canvasAgentSyncPromptSuggestions();
    pending.resolve({allowed:Boolean(allowed)});
  }
  function canvasAgentRequestApproval(args) {
    if(canvasAgent.pendingApproval)throw Error("Another project command is already awaiting approval.");
    canvasAgentApprovalReason.textContent=String(args?.reason||"");
    canvasAgentApprovalCommand.textContent=String(args?.command||"");
    canvasAgentApproval.hidden=false;
    canvasAgentApprovalAllow.focus();
    return new Promise(resolve=>{canvasAgent.pendingApproval={resolve};canvasAgentSyncPromptSuggestions();});
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
    if(/CONCURRENC|CAPACITY|SERVER_BUSY/.test(code)||/concurrenc|too many simultaneous|server is busy|service is busy/.test(message))return "busy";
    if(/TIMEOUT|ETIMEDOUT/.test(code)||/timed? out|timeout/.test(message))return "timeout";
    if(/RATE_LIMIT|TOO_MANY_REQUESTS|RESOURCE_EXHAUSTED|QUOTA/.test(code)||code==="429"||/rate limit|too many requests|quota exceeded|\b(?:http )?429\b/.test(message))return "rate_limit";
    if(/CONTEXT_LENGTH|REQUEST_TOO_LARGE|PAYLOAD_TOO_LARGE|TOKEN_LIMIT/.test(code)||/context (?:length|window)|too many tokens|request (?:is )?too large|message is too large|more attachment data than penecho can safely process|maximum token/.test(message))return "request_too_large";
    if(/UNAUTHENTICATED|UNAUTHORIZED|AUTHENTICATION_FAILED|INVALID_API_KEY|API_KEY_INVALID|LOGIN_REQUIRED/.test(code)||code==="401"||/\bunauthorized\b|\bunauthenticated\b|authentication failed|invalid api key|please (?:log|sign) in|not logged in|\b(?:http )?401\b/.test(message))return "authentication";
    if(/MODEL_NOT_FOUND|MODEL_UNAVAILABLE|UNKNOWN_MODEL/.test(code)||/model .*?(?:not found|unavailable|does not exist|not supported)/.test(message))return "model_unavailable";
    if(/ECONN|ENOTFOUND|EAI_AGAIN|NETWORK|SOCKET|CONNECTION/.test(code)||/network error|fetch failed|connection (?:failed|closed|reset|refused)|socket hang up|could not connect/.test(message))return "connection";
    return "generic";
  }
  function canvasAgentErrorSummary(value) {
    return t({
      busy:"canvasAgentErrorBusy",
      timeout:"canvasAgentErrorTimeout",
      rate_limit:"canvasAgentErrorRateLimit",
      request_too_large:"canvasAgentErrorRequestTooLarge",
      authentication:"canvasAgentErrorAuthentication",
      model_unavailable:"canvasAgentErrorModelUnavailable",
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
  function canvasAgentNormalizeHistoryFile(value) {
    if(!value||typeof value!=="object"||!/^file-[0-9a-f]{24}$/.test(String(value.projectId||"")))return null;
    const name=canvasAgentHistoryText(value.name,240).replace(/[\0-\x1f\x7f]/g,"").trim(),bytes=Number(value.bytes),mediaType=canvasAgentHistoryText(value.mediaType,255);
    if(!name||!Number.isSafeInteger(bytes)||bytes<1||bytes>CANVAS_AGENT_PROJECT_UPLOAD_LIMIT)return null;
    return {kind:"file",projectId:String(value.projectId),name,bytes,mediaType};
  }
  function canvasAgentNormalizeHistoryItem(item) {
    if (!item || typeof item !== "object") return null;
    if (item.type === "message" && ["user","assistant"].includes(item.role)) {
      const files=(Array.isArray(item.files)?item.files:[]).map(canvasAgentNormalizeHistoryFile).filter(Boolean).slice(0,CANVAS_AGENT_MAX_ATTACHMENTS);
      return {
      id:canvasAgentHistoryText(item.id,128) || canvasClientId(),
      type:"message",
      role:item.role,
      text:canvasAgentMessageText(item.text),
      attachmentCount:Math.max(files.length,Math.max(0,Math.min(CANVAS_AGENT_MAX_ATTACHMENTS,Number(item.attachmentCount)||0))),
      eventKey:canvasAgentHistoryText(item.eventKey,128),
      ...(Number.isSafeInteger(item.turn)?{turn:item.turn}:{}),
      ...(Number.isSafeInteger(item.step)?{step:item.step}:{}),
      ...(files.length?{files}:{}),
      ...(item.role==="assistant"?{final:item.final!==false,...(typeof item.copyable==="boolean"?{copyable:item.copyable}:{})}:{}),
      };
    }
    if (item.type === "error") {
      const error=canvasAgentNormalizeError(item);
      return {
        id:canvasAgentHistoryText(item.id,128)||canvasClientId(),
        type:"error",
        code:error.code,
        message:error.message,
        eventKey:canvasAgentHistoryText(item.eventKey,128),
      };
    }
    if (item.type === "tool") return {
      id:canvasAgentHistoryText(item.id,128) || canvasClientId(),
      type:"tool",
      callId:canvasAgentHistoryText(item.callId,256),
      name:canvasAgentHistoryText(item.name,128),
      ...(Number.isSafeInteger(item.turn)?{turn:item.turn}:{}),
      ...(Number.isSafeInteger(item.step)?{step:item.step}:{}),
      argumentsText:canvasAgentHistoryText(item.argumentsText,8000),
      resultText:canvasAgentHistoryText(item.resultText,8000),
      state:["running","done","error"].includes(item.state) ? item.state : "done",
    };
    return null;
  }
  function canvasAgentRestoreLegacyCopyableSummaries(items) {
    let candidate=null;
    const finish=()=>{if(candidate)candidate.copyable=true;candidate=null;};
    for(const item of items){
      if(item.type==="message"&&item.role==="user"){finish();continue;}
      if(item.type==="tool"){candidate=null;continue;}
      if(item.type==="error"){candidate=null;continue;}
      if(item.type!=="message"||item.role!=="assistant")continue;
      if(typeof item.copyable==="boolean"){candidate=null;continue;}
      candidate=item.final!==false&&String(item.text||"").trim()?item:null;
    }
    finish();
    for(const item of items)if(item.type==="message"&&item.role==="assistant"&&typeof item.copyable!=="boolean")item.copyable=false;
    return items;
  }
  function canvasAgentNormalizeConversation(value) {
    if (!value || typeof value !== "object") return null;
    const id=canvasAgentHistoryText(value.id,128), createdAt=Number(value.createdAt), updatedAt=Number(value.updatedAt);
    if (!id || !Number.isFinite(createdAt) || !Number.isFinite(updatedAt)) return null;
    return {
      id,
      createdAt,
      updatedAt,
      title:canvasAgentHistoryText(value.title,120),
      items:canvasAgentRestoreLegacyCopyableSummaries((Array.isArray(value.items)?value.items:[]).slice(-CANVAS_AGENT_HISTORY_ITEM_LIMIT).map(canvasAgentNormalizeHistoryItem).filter(Boolean)),
    };
  }
  function canvasAgentReadHistoryStore() {
    try {
      const stored=JSON.parse(localStorage.getItem(CANVAS_AGENT_HISTORY_KEY)||"null"), canvases=stored?.version===1&&stored.canvases&&typeof stored.canvases==="object"&&!Array.isArray(stored.canvases)?stored.canvases:{};
      return {version:1,canvases:{...canvases}};
    } catch { return {version:1,canvases:{}}; }
  }
  function canvasAgentHistoryForCanvas(canvasKey = state.canvasAgentCanvasKey) {
    if(canvasAgent.projectId)return (canvasAgent.projectHistoryLoaded?canvasAgent.projectHistory:[]).map(canvasAgentNormalizeConversation).filter(conversation=>conversation?.items.length).sort((a,b)=>b.updatedAt-a.updatedAt).slice(0,CANVAS_AGENT_HISTORY_LIMIT);
    const stored=canvasAgentReadHistoryStore().canvases[String(canvasKey||"")];
    return (Array.isArray(stored)?stored:[]).map(canvasAgentNormalizeConversation).filter(conversation=>conversation?.items.length).sort((a,b)=>b.updatedAt-a.updatedAt).slice(0,CANVAS_AGENT_HISTORY_LIMIT);
  }
  function canvasAgentWriteHistoryForCanvas(canvasKey, conversations, store = canvasAgentReadHistoryStore()) {
    const key=String(canvasKey||""), normalized=(Array.isArray(conversations)?conversations:[]).map(canvasAgentNormalizeConversation).filter(conversation=>conversation?.items.length).sort((a,b)=>b.updatedAt-a.updatedAt).slice(0,CANVAS_AGENT_HISTORY_LIMIT);
    if(canvasAgent.projectId){
      if(!canvasAgent.projectHistoryLoaded)return false;
      canvasAgent.projectHistory=normalized;
      canvasAgentWriteProjectHistory(normalized);
      return true;
    }
    if (!key) return false;
    if (normalized.length) store.canvases[key]=normalized;
    else delete store.canvases[key];
    try { localStorage.setItem(CANVAS_AGENT_HISTORY_KEY,JSON.stringify(store)); return true; }
    catch { return false; }
  }
  function canvasAgentConversationTitle(conversation) {
    const firstUser=conversation?.items?.find(item=>item.type==="message"&&item.role==="user"&&item.text.trim());
    return firstUser ? firstUser.text.replace(/\s+/g," ").trim().slice(0,72) : "";
  }
  function canvasAgentPersistCurrentConversation() {
    clearTimeout(canvasAgent.historyPersistTimer);
    canvasAgent.historyPersistTimer=0;
    const conversation=canvasAgent.currentConversation;
    if (!conversation?.items?.length || !state.canvasAgentCanvasKey || canvasAgent.projectId&&!canvasAgent.projectHistoryLoaded) {
      canvasAgentRenderHistoryList();
      return false;
    }
    conversation.updatedAt=Date.now();
    conversation.title=canvasAgentConversationTitle(conversation);
    const recent=[conversation,...canvasAgentHistoryForCanvas().filter(item=>item.id!==conversation.id)];
    const stored=canvasAgentWriteHistoryForCanvas(state.canvasAgentCanvasKey,recent);
    canvasAgentRenderHistoryList();
    return stored;
  }
  function canvasAgentScheduleHistoryPersist(delay = 180) {
    clearTimeout(canvasAgent.historyPersistTimer);
    canvasAgent.historyPersistTimer=setTimeout(canvasAgentPersistCurrentConversation,delay);
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
  function canvasAgentRenderEmpty() {
    const empty=document.createElement("div"), title=document.createElement("strong"), body=document.createElement("span");
    empty.className="canvas-agent-empty";
    title.textContent=t("canvasAgentEmptyTitle");
    body.textContent=t("canvasAgentEmptyBody");
    empty.append(title,body);
    canvasAgentTranscript.replaceChildren(empty);
  }
  function canvasAgentHistoryTime(value) {
    try { return new Intl.DateTimeFormat(state.language==="zh"?"zh-CN":"en",{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}).format(value); }
    catch { return ""; }
  }
  function canvasAgentRenderHistoryList() {
    if (!canvasAgentHistoryList) return;
    const histories=canvasAgentHistoryForCanvas();
    canvasAgentHistoryList.replaceChildren();
    if (!histories.length) {
      const empty=document.createElement("div");
      empty.className="canvas-agent-history-empty";
      empty.textContent=t("canvasAgentHistoryEmpty");
      canvasAgentHistoryList.append(empty);
      return;
    }
    for (const conversation of histories) {
      const button=document.createElement("button"), title=document.createElement("span"), meta=document.createElement("span"), current=conversation.id===canvasAgent.currentConversation?.id;
      button.type="button";
      button.setAttribute("role","menuitem");
      button.dataset.conversationId=conversation.id;
      title.className="canvas-agent-history-title";
      meta.className="canvas-agent-history-meta";
      title.textContent=conversation.title||t("canvasAgentHistoryUntitled");
      meta.textContent=[canvasAgentHistoryTime(conversation.updatedAt),current?t("canvasAgentHistoryCurrent"):""].filter(Boolean).join(" · ");
      button.append(title,meta);
      button.addEventListener("click",()=>current?canvasAgentHideHistoryPopover():void canvasAgentViewStoredConversation(conversation.id));
      canvasAgentHistoryList.append(button);
    }
  }
  function canvasAgentHideHistoryPopover() {
    canvasAgentHistoryPopover.hidden=true;
    canvasAgentHistory.setAttribute("aria-expanded","false");
  }
  function canvasAgentSetHistoryViewing(viewing) {
    canvasAgent.viewingHistoryId=viewing?String(viewing):"";
    canvasAgentPanel.dataset.historyViewing=String(Boolean(viewing));
    canvasAgentHistoryView.hidden=!viewing;
    canvasAgentSyncInputHint();
    canvasAgentSyncPromptSuggestions();
  }
  async function canvasAgentViewStoredConversation(id) {
    canvasAgentPersistCurrentConversation();
    const conversation=canvasAgentHistoryForCanvas().find(item=>item.id===id);
    if (!conversation) return;
    canvasAgentHideHistoryPopover();
    canvasAgent.currentConversation=conversation;
    canvasAgent.pendingConversationHistory=canvasAgentConversationHistory(conversation);
    canvasAgent.lastTurnError=null;
    canvasAgentSetHistoryViewing("");
    canvasAgentDropSessionIdentity();
    canvasAgentClearTranscript();
    canvasAgentRenderConversation(conversation,false);
    canvasAgentClearAttachments();
    canvasAgentClearReferences();
    canvasAgentClearInkDraft();
    canvasAgentRenderHistoryList();
    canvasAgentSetStatus(t("canvasAgentConnecting"),"connecting");
    try {
      await canvasAgentStartNewConversation(selectedAiConnectionId(),{resetProjection:false,preserveConversation:true});
      canvasAgentInput.focus();
    } catch (error) { canvasAgentSetStatus(String(error?.message||error),"error"); }
  }
  function canvasAgentReturnToCurrentConversation() {
    canvasAgentHideHistoryPopover();
    canvasAgentSetHistoryViewing("");
    canvasAgentRenderConversation(canvasAgent.currentConversation,true);
    if(!canvasAgent.running&&canvasAgent.lastTurnError)canvasAgentSetStatus(canvasAgentErrorSummary(canvasAgent.lastTurnError),"error");
    else canvasAgentSetStatus(t(canvasAgent.running?"canvasAgentWorking":canvasAgent.socket?.readyState===WebSocket.OPEN&&canvasAgent.sessionReady?"canvasAgentReady":"canvasAgentReadyConnect"),canvasAgent.running?"running":"ready");
    canvasAgentInput.focus();
  }
  function canvasAgentBeginLocalConversation({persistCurrent=true,submitExecution=null,preserveDraft=false}={}) {
    if (submitExecution) canvasAgentAssertSubmitExecution(submitExecution);
    else canvasAgentInvalidateSubmitExecution();
    canvasAgentBeginSessionTransition();
    if (persistCurrent) canvasAgentPersistCurrentConversation();
    canvasAgent.currentConversation=canvasAgentNewConversationRecord();
    canvasAgent.pendingConversationHistory=[];
    canvasAgent.lastTurnError=null;
    canvasAgentSetHistoryViewing("");
    canvasAgentHideHistoryPopover();
    canvasAgentClearTranscript({showEmpty:true});
    if(!preserveDraft){
      canvasAgentClearAttachments();
      canvasAgentClearReferences();
      canvasAgentClearInkDraft();
    }
    canvasAgentRenderHistoryList();
  }
  function canvasAgentDropSessionIdentity() {
    canvasAgent.sessionId="";
    canvasAgent.resumeToken="";
    canvasAgent.connectionId="";
    canvasAgent.sessionEngine="";
    canvasAgent.sessionProjectId="";
    canvasAgent.sessionAccessMode="controlled";
    canvasAgent.sessionProjectCapabilities=null;
    canvasAgentBeginSessionTransition();
    try { sessionStorage.removeItem(CANVAS_AGENT_SESSION_KEY); } catch {}
  }
  function canvasAgentBeginSessionTransition() {
    canvasAgent.sessionGeneration++;
    canvasAgent.sessionReady = false;
    canvasAgent.pendingHandshakeId = "";
    canvasAgent.pendingProvider = "";
    canvasAgentResolveApproval(false);
    if (canvasAgent.connectReject) {
      const reject=canvasAgent.connectReject;
      canvasAgent.connectPromise=null;
      canvasAgent.connectResolve=canvasAgent.connectReject=null;
      reject(Error("PenEcho Agent session changed."));
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
    return Boolean(execution)
      && execution.socket===canvasAgent.socket
      && execution.socket?.readyState===WebSocket.OPEN
      && execution.sessionId===canvasAgent.sessionId
      && execution.generation===canvasAgent.sessionGeneration
      && !execution.controller.signal.aborted;
  }
  function canvasAgentAssertToolExecution(execution) {
    if (!canvasAgentToolExecutionCurrent(execution)) throw canvasAgentToolError("SESSION_EXPIRED","The PenEcho Agent session changed before this tool could finish.");
  }
  function canvasAgentCanvasIdentity({id,location}={}) {
    return id&&location?`${location}:${id}`:`draft:${canvasClientId()}`;
  }
  function canvasAgentCanvasDidChange(identity = null,options = null) {
    const clearProject=options?.clearProject===true;
    canvasAgentPersistCurrentConversation();
    if(clearProject){
      canvasAgent.projectSelectionRevision++;
      canvasAgent.projectId="";
      canvasAgent.projectHistory=[];
      canvasAgent.projectHistoryLoaded=true;
      canvasAgent.accessMode="controlled";
      localStorage.removeItem(CANVAS_AGENT_PROJECT_KEY);
      canvasAgentRenderProjects();
      canvasAgentHideProjectPopover();
    }
    state.canvasAgentCanvasKey=canvasAgentCanvasIdentity(identity||{});
    canvasAgentBeginLocalConversation({persistCurrent:false});
    if (canvasAgent.socket?.readyState===WebSocket.OPEN||canvasAgent.connectPromise) {
      void canvasAgentStartNewConversation(selectedAiConnectionId(),{resetProjection:false}).catch(error=>canvasAgentSetStatus(String(error?.message||error),"error"));
    } else canvasAgentDropSessionIdentity();
    canvasAgentSyncPromptSuggestions();
    if (state.canvasAgentAutoOpen && canvasAgentPanel.hidden) openCanvasAgent({focus:false});
  }
  function canvasAgentCanvasDidPersist(location,id) {
    if (!location||!id) return;
    const previousKey=state.canvasAgentCanvasKey, nextKey=canvasAgentCanvasIdentity({location,id});
    if (previousKey===nextKey) return;
    if(canvasAgent.projectId){state.canvasAgentCanvasKey=nextKey;canvasAgentRenderHistoryList();return;}
    canvasAgentPersistCurrentConversation();
    const store=canvasAgentReadHistoryStore(), previous=(Array.isArray(store.canvases[previousKey])?store.canvases[previousKey]:[]).map(canvasAgentNormalizeConversation).filter(Boolean), next=(Array.isArray(store.canvases[nextKey])?store.canvases[nextKey]:[]).map(canvasAgentNormalizeConversation).filter(Boolean), merged=[];
    for (const conversation of [...previous,...next].sort((a,b)=>b.updatedAt-a.updatedAt)) if (conversation?.items.length&&!merged.some(item=>item.id===conversation.id)) merged.push(conversation);
    if (previousKey?.startsWith("draft:")) delete store.canvases[previousKey];
    canvasAgentWriteHistoryForCanvas(nextKey,merged,store);
    state.canvasAgentCanvasKey=nextKey;
    canvasAgentRenderHistoryList();
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
  function canvasAgentReferenceLabel(id) {
    const object=canvasAgentObject(id), item=object?.item;
    if (!object) return String(id);
    if (object.kind==="widget") return String(item.title||item.widgetType||item.pluginId||item.id);
    if (object.kind==="text") return String(item.text||item.id).replace(/\s+/g," ").trim().slice(0,72)||String(item.id);
    return String(item.sourceName||item.id);
  }
  function canvasAgentReferencedIds() {
    return [...new Set([...canvasAgent.references,...canvasAgentSelectionIds()])].filter(id=>canvasAgentObject(id));
  }
  function canvasAgentCreateReferenceChip(id,{selected=false}={}) {
    const chip=document.createElement("span"), label=document.createElement("span"), meta=document.createElement("em");
    chip.className="canvas-agent-reference-chip";
    label.textContent=canvasAgentReferenceLabel(id);
    label.title=String(id);
    meta.textContent=t(selected?"canvasAgentSelected":"canvasAgentReferenced");
    chip.append(label,meta);
    if (!selected) {
      const remove=document.createElement("button");
      remove.type="button";
      remove.textContent="×";
      remove.setAttribute("aria-label",`${t("canvasAgentRemoveReference")} ${label.textContent}`);
      remove.addEventListener("click",()=>canvasAgentToggleReference(id,false));
      chip.append(remove);
    }
    return chip;
  }
  function canvasAgentSyncSelection() {
    const explicit=canvasAgent.references.filter(id=>canvasAgentObject(id)), explicitSet=new Set(explicit), selected=canvasAgentSelectionIds().filter(id=>canvasAgentObject(id)&&!explicitSet.has(id));
    if (explicit.length!==canvasAgent.references.length) canvasAgent.references=explicit;
    canvasAgentSelection.replaceChildren(...explicit.map(id=>canvasAgentCreateReferenceChip(id)),...selected.map(id=>canvasAgentCreateReferenceChip(id,{selected:true})));
    canvasAgentSelection.hidden = !explicit.length&&!selected.length;
    canvasAgentSyncInputHint();
    canvasAgentSyncPromptSuggestions();
  }
  function canvasAgentClearReferences() {
    canvasAgent.references=[];
    canvasAgentToggleReferencePicker(false);
    canvasAgentSyncSelection();
  }
  function canvasAgentToggleReference(id,force=null) {
    const object=canvasAgentObject(id);
    if (!object||object.kind!=="widget") return false;
    const present=canvasAgent.references.includes(id), add=force===null?!present:Boolean(force);
    if (add&&!present) {
      if (canvasAgent.references.length>=CANVAS_AGENT_MAX_REFERENCES) {
        canvasAgentSetStatus(t("canvasAgentReferenceLimit"),"error");
        return false;
      }
      canvasAgent.references.push(id);
    } else if (!add&&present) canvasAgent.references=canvasAgent.references.filter(value=>value!==id);
    canvasAgentSyncSelection();
    canvasAgentRenderReferencePicker(canvasAgentReferenceSearch.value);
    return true;
  }
  function canvasAgentWidgetFromPickEvent(event) {
    const hit=widgetPointerHit(clientPoint(event),event.pointerType||"mouse",true);
    return hit&&!hit.pending&&state.widgets.includes(hit.widget)?hit.widget:null;
  }
  function canvasAgentPrepareWidgetPickerLayer() {
    if (!canvasAgentWidgetPickerContext) return null;
    const width=Math.max(1,view.clientWidth), height=Math.max(1,view.clientHeight), ratio=Math.max(1,Math.min(2,window.devicePixelRatio||1)), pixelWidth=Math.round(width*ratio), pixelHeight=Math.round(height*ratio);
    if (canvasAgentWidgetPickerLayer.width!==pixelWidth||canvasAgentWidgetPickerLayer.height!==pixelHeight) {
      canvasAgentWidgetPickerLayer.width=pixelWidth;
      canvasAgentWidgetPickerLayer.height=pixelHeight;
    }
    canvasAgentWidgetPickerContext.setTransform(ratio,0,0,ratio,0,0);
    return {width,height};
  }
  function canvasAgentDrawWidgetPick(widget=null) {
    const size=canvasAgentPrepareWidgetPickerLayer();
    if (!size) return;
    canvasAgentWidgetPickerContext.clearRect(0,0,size.width,size.height);
    if (!widget) return;
    const box=widgetBox(widget), x=state.panX+box.x*state.scale, y=state.panY+box.y*state.scale, width=box.w*state.scale, height=box.h*state.scale;
    canvasAgentWidgetPickerContext.save();
    canvasAgentWidgetPickerContext.fillStyle="rgba(79,70,229,.08)";
    canvasAgentWidgetPickerContext.strokeStyle="#4f46e5";
    canvasAgentWidgetPickerContext.lineWidth=2;
    canvasAgentWidgetPickerContext.setLineDash([8,5]);
    canvasAgentWidgetPickerContext.fillRect(x,y,width,height);
    canvasAgentWidgetPickerContext.strokeRect(x+1,y+1,Math.max(0,width-2),Math.max(0,height-2));
    canvasAgentWidgetPickerContext.restore();
  }
  function canvasAgentSetWidgetPickActive(active) {
    active=Boolean(active&&canvasAgentWidgetPickerLayer);
    canvasAgent.referencePickActive=active;
    canvasAgent.referenceHoverId="";
    canvasAgentWidgetPickerLayer.hidden=!active;
    canvasAgentReference.classList.toggle("picking",active);
    canvasAgentDrawWidgetPick();
  }
  function canvasAgentToggleReferencePicker(force=null) {
    const open=force===null?canvasAgentReferencePicker.hidden:Boolean(force);
    canvasAgentReferencePicker.hidden=!open;
    canvasAgentReference.setAttribute("aria-expanded",String(open));
    canvasAgentSetWidgetPickActive(open);
    if (open) {
      canvasAgentReferenceSearch.value="";
      canvasAgentRenderReferencePicker("");
      canvasAgentReferenceSearch.focus();
    }
    canvasAgentSyncPromptSuggestions();
  }
  function canvasAgentRenderReferencePicker(query="") {
    if (!canvasAgentReferenceList) return;
    const normalized=String(query||"").trim().toLowerCase(), widgets=state.widgets.filter(item=>{
      const searchable=[item.title,item.widgetType,item.pluginId,item.id].filter(Boolean).join(" ").toLowerCase();
      return !normalized||searchable.includes(normalized);
    });
    canvasAgentReferenceList.replaceChildren();
    for (const item of widgets) {
      const option=document.createElement("button"), label=document.createElement("span"), status=document.createElement("small"), referenced=canvasAgent.references.includes(item.id);
      option.type="button";
      option.setAttribute("role","option");
      option.setAttribute("aria-selected",String(referenced));
      label.textContent=canvasAgentReferenceLabel(item.id);
      label.title=String(item.id);
      status.textContent=t(referenced?"canvasAgentReferenced":"canvasAgentReferenceAdd");
      option.append(label,status);
      option.addEventListener("click",()=>canvasAgentToggleReference(item.id));
      canvasAgentReferenceList.append(option);
    }
    canvasAgentReferenceNote.textContent=!state.widgets.length?t("canvasAgentReferenceEmpty"):!widgets.length?t("canvasAgentReferenceNoMatch"):t("canvasAgentReferenceCount").replace("{count}",String(widgets.length));
  }
  function canvasAgentTranscriptNearLatest() {
    const remaining = canvasAgentTranscript.scrollHeight - canvasAgentTranscript.clientHeight - canvasAgentTranscript.scrollTop;
    return remaining <= 32;
  }
  function canvasAgentSyncFollowLatest() {
    canvasAgent.followLatest = canvasAgentTranscriptNearLatest();
  }
  function canvasAgentScrollToLatest(force = false) {
    if (!force && !canvasAgent.followLatest) return false;
    canvasAgentTranscript.scrollTop = Math.max(0,canvasAgentTranscript.scrollHeight-canvasAgentTranscript.clientHeight);
    canvasAgent.followLatest = true;
    return true;
  }
  function canvasAgentCompactPanel() {
    return Boolean(window.matchMedia && window.matchMedia("(max-width: 700px)").matches);
  }
  function canvasAgentResetHeightClasses() {
    for (const name of [...canvasAgentPanel.classList]) if (/^canvas-agent-height-\d+$/.test(name)) canvasAgentPanel.classList.remove(name);
  }
  function canvasAgentResetWidthClasses() {
    for (const name of [...canvasAgentPanel.classList]) if (/^canvas-agent-width-\d+$/.test(name)) canvasAgentPanel.classList.remove(name);
  }
  function canvasAgentApplyPanelHeight(height) {
    const extent=Math.max(1,view.clientHeight), step=Math.max(0,Math.min(CANVAS_AGENT_SIZE_STEPS,Math.round((Number(height)||CANVAS_AGENT_HEIGHT_MIN)/extent*CANVAS_AGENT_SIZE_STEPS)));
    canvasAgentResetHeightClasses();
    canvasAgentPanel.classList.add(`canvas-agent-height-${step}`);
    canvasAgentSyncResizeHandleValues();
    return canvasAgentPanel.getBoundingClientRect().height;
  }
  function canvasAgentApplyPanelWidth(width) {
    const extent=Math.max(1,view.clientWidth), step=Math.max(0,Math.min(CANVAS_AGENT_SIZE_STEPS,Math.round((Number(width)||CANVAS_AGENT_WIDTH_MIN)/extent*CANVAS_AGENT_SIZE_STEPS)));
    canvasAgentResetWidthClasses();
    canvasAgentPanel.classList.add(`canvas-agent-width-${step}`);
    canvasAgentSyncResizeHandleValues();
    return canvasAgentPanel.getBoundingClientRect().width;
  }
  function canvasAgentMaximumPanelHeight() {
    return Math.max(CANVAS_AGENT_HEIGHT_MIN,view.clientHeight);
  }
  function canvasAgentMaximumPanelWidth() {
    return Math.max(CANVAS_AGENT_WIDTH_MIN,view.clientWidth-16);
  }
  function canvasAgentSyncResizeHandleValues() {
    const rect=canvasAgentPanel.getBoundingClientRect(), height=Math.round(rect.height), width=Math.round(rect.width), maximumHeight=canvasAgentMaximumPanelHeight(), maximumWidth=canvasAgentMaximumPanelWidth();
    for (const handle of [canvasAgentResizeTop,canvasAgentResizeBottom]) {
      handle.setAttribute("aria-valuemin",String(CANVAS_AGENT_HEIGHT_MIN));
      handle.setAttribute("aria-valuemax",String(maximumHeight));
      handle.setAttribute("aria-valuenow",String(height));
    }
    for (const handle of [canvasAgentResizeLeft,canvasAgentResizeRight]) {
      handle.setAttribute("aria-valuemin",String(CANVAS_AGENT_WIDTH_MIN));
      handle.setAttribute("aria-valuemax",String(maximumWidth));
      handle.setAttribute("aria-valuenow",String(width));
    }
  }
  function canvasAgentRestorePanelSize() {
    if (canvasAgentCompactPanel()) {
      canvasAgentResetHeightClasses();
      canvasAgentResetWidthClasses();
      return;
    }
    let storedHeight="", storedWidth="";
    try { storedHeight=String(localStorage.getItem(CANVAS_AGENT_HEIGHT_KEY)||"");storedWidth=String(localStorage.getItem(CANVAS_AGENT_WIDTH_KEY)||""); } catch {}
    const height=storedHeight==="full"?canvasAgentMaximumPanelHeight():Number(storedHeight), width=storedWidth==="full"?canvasAgentMaximumPanelWidth():Number(storedWidth);
    if (Number.isFinite(height)&&height>=CANVAS_AGENT_HEIGHT_MIN) canvasAgentApplyPanelHeight(height);
    if (Number.isFinite(width)&&width>=CANVAS_AGENT_WIDTH_MIN) canvasAgentApplyPanelWidth(width);
    canvasAgentSyncResizeHandleValues();
  }
  function canvasAgentSavePanelSize() {
    cancelAnimationFrame(canvasAgent.panelResizeFrame);
    canvasAgent.panelResizeFrame=0;
    if (canvasAgentPanel.hidden||canvasAgentCompactPanel()) return;
    const rect=canvasAgentPanel.getBoundingClientRect(), height=Math.round(rect.height), width=Math.round(rect.width), maximumHeight=canvasAgentMaximumPanelHeight(), maximumWidth=canvasAgentMaximumPanelWidth();
    try {
      if (height>=CANVAS_AGENT_HEIGHT_MIN) localStorage.setItem(CANVAS_AGENT_HEIGHT_KEY,height>=maximumHeight-1?"full":String(height));
      if (width>=CANVAS_AGENT_WIDTH_MIN) localStorage.setItem(CANVAS_AGENT_WIDTH_KEY,width>=maximumWidth-1?"full":String(width));
    } catch {}
    canvasAgentSyncResizeHandleValues();
  }
  function canvasAgentSchedulePanelSizeSave() {
    cancelAnimationFrame(canvasAgent.panelResizeFrame);
    canvasAgent.panelResizeFrame=requestAnimationFrame(canvasAgentSavePanelSize);
  }
  function canvasAgentResizeAnchor() {
    const panelRect=canvasAgentPanel.getBoundingClientRect(), viewRect=view.getBoundingClientRect();
    return {
      left:panelRect.left-viewRect.left,
      top:panelRect.top-viewRect.top,
      right:panelRect.right-viewRect.left,
      bottom:panelRect.bottom-viewRect.top,
    };
  }
  function canvasAgentResizePanelTo(edge,size,anchor=canvasAgentResizeAnchor()) {
    const vertical=edge==="top"||edge==="bottom", minimum=vertical?CANVAS_AGENT_HEIGHT_MIN:CANVAS_AGENT_WIDTH_MIN, globalMaximum=vertical?canvasAgentMaximumPanelHeight():canvasAgentMaximumPanelWidth();
    if (canvasAgentCompactPanel()) return vertical?canvasAgentPanel.getBoundingClientRect().height:canvasAgentPanel.getBoundingClientRect().width;
    const available=vertical?(edge==="top"?anchor.bottom:view.clientHeight-anchor.top):(edge==="left"?anchor.right-8:view.clientWidth-anchor.left-8), forceFullHeight=vertical&&Number(size)>=globalMaximum-1, maximum=forceFullHeight?globalMaximum:Math.max(minimum,Math.min(globalMaximum,available)), target=Math.max(minimum,Math.min(maximum,Number(size)||minimum));
    if (vertical) canvasAgentApplyPanelHeight(target);
    else canvasAgentApplyPanelWidth(target);
    const rect=canvasAgentPanel.getBoundingClientRect(), left=edge==="left"?anchor.right-rect.width:anchor.left, top=forceFullHeight?0:edge==="top"?anchor.bottom-rect.height:anchor.top;
    canvasAgentPositionPanel(left,top);
    canvasAgentSyncResizeHandleValues();
    return vertical?rect.height:rect.width;
  }
  function canvasAgentPanelPointerCanManipulate(event) {
    if (event.pointerType==="touch") return false;
    if (event.pointerType==="pen") return event.button===0||(Number(event.buttons)&1)===1;
    return event.button===0;
  }
  function canvasAgentBeginPanelResize(event) {
    if (canvasAgentCompactPanel()||!canvasAgentPanelPointerCanManipulate(event)) return;
    const edge=event.currentTarget.dataset.edge, vertical=edge==="top"||edge==="bottom", rect=canvasAgentPanel.getBoundingClientRect();
    canvasAgent.panelResize={pointerId:event.pointerId,edge,vertical,startCoordinate:vertical?event.clientY:event.clientX,startSize:vertical?rect.height:rect.width,anchor:canvasAgentResizeAnchor(),handle:event.currentTarget};
    canvasAgentPanel.classList.add("resizing",`resizing-${edge}`);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  }
  function canvasAgentMovePanelResize(event) {
    const resize=canvasAgent.panelResize;
    if (resize?.pointerId!==event.pointerId) return;
    const coordinate=resize.vertical?event.clientY:event.clientX, delta=coordinate-resize.startCoordinate, size=resize.startSize+(["top","left"].includes(resize.edge)?-delta:delta);
    canvasAgentResizePanelTo(resize.edge,size,resize.anchor);
    event.preventDefault();
  }
  function canvasAgentFinishPanelResize(event) {
    const resize=canvasAgent.panelResize;
    if (resize?.pointerId!==event.pointerId) return;
    canvasAgent.panelResize=null;
    canvasAgentPanel.classList.remove("resizing","resizing-top","resizing-bottom","resizing-left","resizing-right");
    if (resize.handle.hasPointerCapture?.(event.pointerId)) resize.handle.releasePointerCapture(event.pointerId);
    canvasAgentSavePanelSize();
    canvasAgentSavePanelPosition();
  }
  function canvasAgentKeyboardPanelResize(event) {
    if (canvasAgentCompactPanel()) return;
    const edge=event.currentTarget.dataset.edge, vertical=edge==="top"||edge==="bottom", rect=canvasAgentPanel.getBoundingClientRect(), current=vertical?rect.height:rect.width, minimum=vertical?CANVAS_AGENT_HEIGHT_MIN:CANVAS_AGENT_WIDTH_MIN, maximum=vertical?canvasAgentMaximumPanelHeight():canvasAgentMaximumPanelWidth();
    let next=null;
    if (event.key==="Home") next=minimum;
    else if (event.key==="End") next=maximum;
    else if (vertical&&event.key==="ArrowUp") next=current+(edge==="top"?CANVAS_AGENT_RESIZE_KEY_STEP:-CANVAS_AGENT_RESIZE_KEY_STEP);
    else if (vertical&&event.key==="ArrowDown") next=current+(edge==="bottom"?CANVAS_AGENT_RESIZE_KEY_STEP:-CANVAS_AGENT_RESIZE_KEY_STEP);
    else if (!vertical&&event.key==="ArrowLeft") next=current+(edge==="left"?CANVAS_AGENT_RESIZE_KEY_STEP:-CANVAS_AGENT_RESIZE_KEY_STEP);
    else if (!vertical&&event.key==="ArrowRight") next=current+(edge==="right"?CANVAS_AGENT_RESIZE_KEY_STEP:-CANVAS_AGENT_RESIZE_KEY_STEP);
    if (next===null) return;
    event.preventDefault();
    canvasAgentResizePanelTo(edge,next);
    canvasAgentSavePanelSize();
    canvasAgentSavePanelPosition();
  }
  function canvasAgentPanelLimits() {
    const fullHeight=canvasAgentPanel.offsetHeight>=view.clientHeight-1, minY=fullHeight?0:8;
    return {
      minX:8,
      minY,
      maxX:Math.max(8,view.clientWidth-canvasAgentPanel.offsetWidth-8),
      maxY:Math.max(minY,view.clientHeight-canvasAgentPanel.offsetHeight-(fullHeight?0:8)),
    };
  }
  function canvasAgentPositionPanel(x,y) {
    const {minX,minY,maxX,maxY} = canvasAgentPanelLimits(), xRatio = maxX <= minX ? 1 : Math.max(0,Math.min(1,((Number(x)||0)-minX)/(maxX-minX))), yRatio = maxY <= minY ? 0 : Math.max(0,Math.min(1,((Number(y)||0)-minY)/(maxY-minY))), xStep = Math.round(xRatio*20), yStep = Math.round(yRatio*20);
    canvasAgentResetPositionClasses();
    canvasAgentPanel.classList.add("canvas-agent-positioned",`canvas-agent-position-x-${xStep}`,`canvas-agent-position-y-${yStep}`);
    canvasAgent.panelPosition = {xStep,yStep};
    return {xStep,yStep,maxX,maxY};
  }
  function canvasAgentResetPositionClasses() {
    for (const name of [...canvasAgentPanel.classList]) if (name === "canvas-agent-positioned" || /^canvas-agent-position-[xy]-\d+$/.test(name)) canvasAgentPanel.classList.remove(name);
  }
  function canvasAgentRestorePanelPosition() {
    if (canvasAgentPanel.hidden || canvasAgentCompactPanel()) {
      canvasAgentResetPositionClasses();
      canvasAgent.panelPosition = null;
      return;
    }
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(CANVAS_AGENT_POSITION_KEY) || "null"); } catch {}
    if (!saved || !Number.isFinite(saved.x) || !Number.isFinite(saved.y)) {
      if (canvasAgentPanel.offsetHeight>=view.clientHeight-1) {
        canvasAgentPositionPanel(Math.max(8,view.clientWidth-canvasAgentPanel.offsetWidth-18),0);
        return;
      }
      canvasAgentResetPositionClasses();
      canvasAgent.panelPosition = null;
      return;
    }
    const {minX,minY,maxX,maxY} = canvasAgentPanelLimits();
    canvasAgentPositionPanel(minX+(maxX-minX)*Math.max(0,Math.min(1,saved.x)),minY+(maxY-minY)*Math.max(0,Math.min(1,saved.y)));
  }
  function canvasAgentSavePanelPosition() {
    if (!canvasAgent.panelPosition) return;
    const saved = { x:canvasAgent.panelPosition.xStep/20, y:canvasAgent.panelPosition.yStep/20 };
    try { localStorage.setItem(CANVAS_AGENT_POSITION_KEY,JSON.stringify(saved)); } catch {}
  }
  function canvasAgentBeginPanelDrag(event) {
    if (canvasAgentCompactPanel() || !canvasAgentPanelPointerCanManipulate(event) || event.target.closest("button")) return;
    const panelRect = canvasAgentPanel.getBoundingClientRect(), viewRect = view.getBoundingClientRect();
    canvasAgentPositionPanel(panelRect.left-viewRect.left,panelRect.top-viewRect.top);
    canvasAgent.panelDrag = {
      pointerId:event.pointerId,
      offsetX:event.clientX-panelRect.left,
      offsetY:event.clientY-panelRect.top,
    };
    canvasAgentPanel.classList.add("dragging");
    canvasAgentHead.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }
  function canvasAgentMovePanel(event) {
    if (canvasAgent.panelDrag?.pointerId !== event.pointerId) return;
    const viewRect = view.getBoundingClientRect();
    canvasAgentPositionPanel(event.clientX-viewRect.left-canvasAgent.panelDrag.offsetX,event.clientY-viewRect.top-canvasAgent.panelDrag.offsetY);
    event.preventDefault();
  }
  function canvasAgentFinishPanelDrag(event) {
    if (canvasAgent.panelDrag?.pointerId !== event.pointerId) return;
    canvasAgent.panelDrag = null;
    canvasAgentPanel.classList.remove("dragging");
    if (canvasAgentHead.hasPointerCapture?.(event.pointerId)) canvasAgentHead.releasePointerCapture(event.pointerId);
    canvasAgentSavePanelPosition();
  }
  function canvasAgentReadDataUrl(blob) {
    return new Promise((resolve,reject)=>{
      const reader = new FileReader();
      reader.onload = ()=>resolve(String(reader.result || ""));
      reader.onerror = ()=>reject(reader.error || Error("Could not read the image."));
      reader.readAsDataURL(blob);
    });
  }
  function canvasAgentDecodeImage(blob) {
    return new Promise((resolve,reject)=>{
      const url = URL.createObjectURL(blob), image = new Image();
      image.onload = ()=>{ URL.revokeObjectURL(url); resolve(image); };
      image.onerror = ()=>{ URL.revokeObjectURL(url); reject(Error("Could not decode the image.")); };
      image.src = url;
    });
  }
  function canvasAgentCanvasBlob(canvas,type,quality) {
    return new Promise(resolve=>canvas.toBlob(resolve,type,quality));
  }
  async function canvasAgentWireImage(file,image) {
    const sourceType = String(file.type || "").toLowerCase(), sourceLongEdge=Math.max(image.naturalWidth,image.naturalHeight);
    if (file.size <= CANVAS_AGENT_MAX_WIRE_BYTES && sourceLongEdge <= CANVAS_AGENT_WIRE_IMAGE_DIMENSION && new Set(["image/png","image/webp"]).has(sourceType)) return file;
    let scale = Math.min(1,CANVAS_AGENT_WIRE_IMAGE_DIMENSION/sourceLongEdge);
    for (let pass=0;pass<8;pass++) {
      const width = Math.max(1,Math.round(image.naturalWidth*scale)), height = Math.max(1,Math.round(image.naturalHeight*scale)), canvas = document.createElement("canvas"), context = canvas.getContext("2d");
      canvas.width = width;
      canvas.height = height;
      context.drawImage(image,0,0,width,height);
      for (const quality of [.86,.76,.66]) {
        const encoded = await canvasAgentCanvasBlob(canvas,"image/webp",quality);
        if (encoded?.size && encoded.size <= CANVAS_AGENT_MAX_WIRE_BYTES) return encoded;
      }
      scale *= .8;
    }
    throw Error(t("canvasAgentImageCompressionTooLarge"));
  }
  async function canvasAgentPrepareAttachment(file) {
    if (!(file instanceof Blob) || !String(file.type || "").startsWith("image/") || file.size <= 0) throw Error(t("canvasAgentImageUnsupported"));
    if (file.size > CANVAS_AGENT_MAX_SOURCE_BYTES) throw Error(t("canvasAgentImageSourceTooLarge"));
    const image = await canvasAgentDecodeImage(file), width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
    if (!width || !height) throw Error(t("canvasAgentImageUnsupported"));
    const wire = await canvasAgentWireImage(file,image), dataUrl = await canvasAgentReadDataUrl(wire), comma = dataUrl.indexOf(","), mediaType = String(wire.type || "").toLowerCase();
    if (comma < 0 || !new Set(["image/png","image/jpeg","image/webp","image/gif"]).has(mediaType)) throw Error(t("canvasAgentImageUnsupported"));
    return {
      id:canvasClientId(),
      kind:"image",
      fingerprint:canvasAgentFileFingerprint(file),
      name:String(file.name || "pasted-image").slice(0,240),
      mediaType,
      bytes:wire.size,
      width,
      height,
      dataUrl,
      wire:{ mediaType, data:dataUrl.slice(comma+1), name:String(file.name || "pasted-image").slice(0,240), width, height },
    };
  }
  function canvasAgentFileFingerprint(file) {
    return [String(file?.name||""),Number(file?.size)||0,Number(file?.lastModified)||0,String(file?.type||"").toLowerCase()].join("\u0000");
  }
  function canvasAgentFileExtension(name) {
    const value=String(name||""),dot=value.lastIndexOf("."),extension=dot>0&&dot<value.length-1?value.slice(dot+1):"";
    return (extension||"FILE").slice(0,5).toUpperCase();
  }
  async function canvasAgentOpenProjectFile(attachment) {
    if(!attachment?.projectId||typeof window.penechoDesktop?.openProjectFile!=="function")return false;
    const result=await window.penechoDesktop.openProjectFile(attachment.projectId).catch(()=>({ok:false,code:"open_failed"}));
    if(result?.ok)return true;
    canvasAgentSetStatus(t(result?.code==="unavailable"?"canvasAgentOpenFileUnavailable":"canvasAgentOpenFileFailed"),"error");
    return false;
  }
  function canvasAgentCreateFilePreview(attachment,{message=false}={}) {
    const preview=document.createElement("div"),type=document.createElement("span"),name=document.createElement("span");
    preview.className=message?"canvas-agent-message-file":"canvas-agent-attachment-file";
    type.className="canvas-agent-file-type";
    type.textContent=canvasAgentFileExtension(attachment?.name);
    name.className="canvas-agent-file-name";
    name.textContent=String(attachment?.name||"File");
    name.title=name.textContent;
    preview.append(type,name);
    if(attachment?.projectId&&typeof window.penechoDesktop?.openProjectFile==="function"){
      preview.classList.add("openable");
      preview.tabIndex=0;
      preview.setAttribute("role","button");
      preview.setAttribute("aria-label",t("canvasAgentOpenFile").replace("{name}",name.textContent));
      preview.title=t("canvasAgentOpenFile").replace("{name}",name.textContent);
      preview.addEventListener("dblclick",event=>{event.preventDefault();void canvasAgentOpenProjectFile(attachment);});
      preview.addEventListener("keydown",event=>{if(event.key!=="Enter")return;event.preventDefault();void canvasAgentOpenProjectFile(attachment);});
    }
    return preview;
  }
  async function canvasAgentRemoveAttachment(attachment) {
    if(!attachment||attachment.removing)return;
    if(attachment.kind!=="file"||attachment.deleteOnRemove===false){
      canvasAgent.attachments=canvasAgent.attachments.filter(item=>item.id!==attachment.id);
      canvasAgentRenderAttachments();
      return;
    }
    attachment.removing=true;
    canvasAgentRenderAttachments();
    try{
      await canvasAgentProjectRequest(`/api/canvas-agent/projects/${encodeURIComponent(attachment.projectId)}`,{method:"DELETE"});
      canvasAgent.attachments=canvasAgent.attachments.filter(item=>item.id!==attachment.id);
      await canvasAgentEnsureProjects({refresh:true});
      canvasAgentRenderAttachments();
    }catch(error){attachment.removing=false;canvasAgentRenderAttachments();canvasAgentSetStatus(String(error?.message||error),"error");}
  }
  function canvasAgentRenderAttachments() {
    canvasAgentAttachments.replaceChildren();
    for (const attachment of canvasAgent.attachments) {
      const chip = document.createElement("div"), remove = document.createElement("button");
      chip.className = "canvas-agent-attachment";
      if(attachment.kind==="file")chip.classList.add("file");
      remove.type = "button";
      remove.textContent = "×";
      remove.disabled=Boolean(attachment.removing);
      remove.setAttribute("aria-label",`${t("canvasAgentRemoveAttachment")} ${attachment.name}`);
      remove.onclick = ()=>void canvasAgentRemoveAttachment(attachment);
      if(attachment.kind==="file")chip.append(canvasAgentCreateFilePreview(attachment),remove);
      else{
        const image = document.createElement("img");
        image.src = attachment.dataUrl;
        image.alt = attachment.name;
        chip.append(image,remove);
      }
      canvasAgentAttachments.append(chip);
    }
    canvasAgentAttachments.hidden = !canvasAgent.attachments.length;
    canvasAgentAttachmentCount.textContent = String(canvasAgent.attachments.length);
    canvasAgentAttachmentCount.hidden = !canvasAgent.attachments.length;
    canvasAgentSyncInputHint();
    canvasAgentSyncPromptSuggestions();
  }
  function canvasAgentClearAttachments() {
    canvasAgent.attachments = [];
    canvasAgentRenderAttachments();
  }
  function canvasAgentSyncAttachmentButton() {
    canvasAgentAttach.disabled=canvasAgent.attachmentBusy||canvasAgent.projectUploadBusy;
    canvasAgentSyncPromptSuggestions();
  }
  async function canvasAgentAddAttachments(files) {
    if (canvasAgent.attachmentBusy||canvasAgent.projectUploadBusy) return;
    canvasAgent.attachmentBusy = true;
    canvasAgentSyncAttachmentButton();
    canvasAgentSend.disabled = true;
    try {
      for (const file of files) {
        if (canvasAgent.attachments.length >= CANVAS_AGENT_MAX_ATTACHMENTS) throw Error(t("canvasAgentAttachmentLimit"));
        const attachment = await canvasAgentPrepareAttachment(file), total = canvasAgent.attachments.filter(item=>item.kind==="image").reduce((sum,item)=>sum+item.bytes,0)+attachment.bytes;
        if (total > CANVAS_AGENT_MAX_TOTAL_WIRE_BYTES) throw Error(t("canvasAgentImagesTooLarge"));
        canvasAgent.attachments.push(attachment);
        canvasAgentRenderAttachments();
      }
      return true;
    } catch (error) {
      canvasAgentSetStatus(String(error?.message || error),"error");
      return false;
    } finally {
      canvasAgent.attachmentBusy = false;
      canvasAgentSyncAttachmentButton();
      canvasAgentSend.disabled = false;
      canvasAgentFileInput.value = "";
    }
  }
  async function canvasAgentAddProjectAttachment(file) {
    const fingerprint=canvasAgentFileFingerprint(file),existingFile=canvasAgent.attachments.find(attachment=>attachment.fingerprint===fingerprint);
    if(existingFile){canvasAgentFileInput.value="";return true;}
    if(canvasAgent.attachments.length>=CANVAS_AGENT_MAX_ATTACHMENTS){canvasAgentFileInput.value="";canvasAgentSetStatus(t("canvasAgentAttachmentLimit"),"error");return false;}
    const project=await canvasAgentUploadProjectFile(file);
    if(!project)return false;
    canvasAgent.attachments.push({id:canvasClientId(),kind:"file",name:String(project.name||file.name||"File").slice(0,240),mediaType:String(project.mediaType||file.type||""),bytes:Number(project.bytes)||file.size,fingerprint,projectId:project.id,deleteOnRemove:project.reused!==true});
    canvasAgentRenderAttachments();
    return true;
  }
  async function canvasAgentHandleFiles(files) {
    const selected=[...(files||[])].filter(file=>file instanceof Blob),unique=[];
    for(const original of selected){
      const image=canvasAgentImageFile(original),file=image||original,fingerprint=canvasAgentFileFingerprint(file);
      if(!unique.some(item=>item.fingerprint===fingerprint))unique.push({file,image:Boolean(image),fingerprint});
    }
    const pending=unique.filter(item=>!canvasAgent.attachments.some(attachment=>attachment.fingerprint===item.fingerprint));
    if(!pending.length){canvasAgentFileInput.value="";return false;}
    if(canvasAgent.attachments.length+pending.length>CANVAS_AGENT_MAX_ATTACHMENTS){canvasAgentFileInput.value="";canvasAgentSetStatus(t("canvasAgentAttachmentLimit"),"error");return false;}
    for(const item of pending){
      const added=item.image?await canvasAgentAddAttachments([item.file]):await canvasAgentAddProjectAttachment(item.file);
      if(!added)return false;
    }
    return true;
  }
  function canvasAgentSyncInputHint() {
    if (!canvasAgentInputHint) return;
    const hasConversation=Boolean(canvasAgent.currentConversation?.items?.length), hasDraft=Boolean(canvasAgentInput.value.trim()||canvasAgent.inkPresent||canvasAgent.attachments.length||canvasAgent.references.length);
    canvasAgentInputHint.hidden=canvasAgent.inputMode==="ink"||hasConversation||hasDraft||Boolean(canvasAgent.viewingHistoryId);
  }
  function canvasAgentResizeInput() {
    if(!canvasAgentInput||canvasAgentInput.hidden)return;
    canvasAgentInput.dataset.rows="1";
    const styles=getComputedStyle(canvasAgentInput),lineHeight=Number.parseFloat(styles.lineHeight)||20,
      padding=(Number.parseFloat(styles.paddingTop)||0)+(Number.parseFloat(styles.paddingBottom)||0),
      minimum=Number.parseFloat(styles.minHeight)||lineHeight+padding,maxHeight=Math.max(minimum,lineHeight*CANVAS_AGENT_INPUT_MAX_LINES+padding),
      contentHeight=canvasAgentInput.scrollHeight,rows=Math.max(1,Math.min(CANVAS_AGENT_INPUT_MAX_LINES,Math.ceil((contentHeight-padding)/lineHeight))),overflowing=contentHeight>maxHeight+.5;
    canvasAgentInput.dataset.rows=String(rows);
    canvasAgentInput.classList.toggle("canvas-agent-input-overflowing",overflowing);
  }
  function canvasAgentSetInputMode(mode,focus=true) {
    canvasAgent.inputMode=mode==="ink"?"ink":"text";
    const ink=canvasAgent.inputMode==="ink";
    canvasAgentInput.hidden=ink;
    canvasAgentInkInput.hidden=!ink;
    canvasAgentForm.classList.toggle("canvas-agent-ink-expanded",ink);
    canvasAgentTextMode.classList.toggle("active",!ink);
    canvasAgentInkMode.classList.toggle("active",ink);
    canvasAgentTextMode.setAttribute("aria-pressed",String(!ink));
    canvasAgentInkMode.setAttribute("aria-pressed",String(ink));
    if(!ink)canvasAgentResizeInput();
    canvasAgentSyncInputHint();
    if(focus)(ink?canvasAgentInkCanvas:canvasAgentInput).focus?.();
    canvasAgentSyncPromptSuggestions();
  }
  function canvasAgentClearInkDraft() {
    canvasAgentInkContext?.clearRect(0,0,canvasAgentInkCanvas.width,canvasAgentInkCanvas.height);
    canvasAgent.inkPresent=false;
    canvasAgent.inkStroke=null;
    canvasAgentSyncInputHint();
    canvasAgentSyncPromptSuggestions();
  }
  function canvasAgentInkPoint(event) {
    const rect=canvasAgentInkCanvas.getBoundingClientRect();
    return {x:(event.clientX-rect.left)*canvasAgentInkCanvas.width/rect.width,y:(event.clientY-rect.top)*canvasAgentInkCanvas.height/rect.height};
  }
  function canvasAgentInkPointerDown(event) {
    if (event.button!==0||canvasAgentInput.disabled) return;
    const point=canvasAgentInkPoint(event);
    canvasAgent.inkStroke={pointerId:event.pointerId,point};
    canvasAgentInkCanvas.setPointerCapture?.(event.pointerId);
    canvasAgentInkContext.save();
    canvasAgentInkContext.fillStyle=state.inkColor||"#1f2937";
    canvasAgentInkContext.beginPath();
    canvasAgentInkContext.arc(point.x,point.y,CANVAS_AGENT_INK_LINE_WIDTH/2,0,Math.PI*2);
    canvasAgentInkContext.fill();
    canvasAgentInkContext.restore();
    canvasAgent.inkPresent=true;
    canvasAgentSyncInputHint();
    event.preventDefault();
  }
  function canvasAgentInkPointerMove(event) {
    const stroke=canvasAgent.inkStroke;
    if (!stroke||stroke.pointerId!==event.pointerId) return;
    const point=canvasAgentInkPoint(event);
    canvasAgentInkContext.save();
    canvasAgentInkContext.strokeStyle=state.inkColor||"#1f2937";
    canvasAgentInkContext.lineWidth=CANVAS_AGENT_INK_LINE_WIDTH;
    canvasAgentInkContext.lineCap=canvasAgentInkContext.lineJoin="round";
    canvasAgentInkContext.beginPath();
    canvasAgentInkContext.moveTo(stroke.point.x,stroke.point.y);
    canvasAgentInkContext.lineTo(point.x,point.y);
    canvasAgentInkContext.stroke();
    canvasAgentInkContext.restore();
    stroke.point=point;
    event.preventDefault();
  }
  function canvasAgentInkPointerEnd(event) {
    if (canvasAgent.inkStroke?.pointerId!==event.pointerId) return;
    canvasAgent.inkStroke=null;
    if (canvasAgentInkCanvas.hasPointerCapture?.(event.pointerId)) canvasAgentInkCanvas.releasePointerCapture(event.pointerId);
    event.preventDefault();
  }
  async function canvasAgentPrepareInkAttachment() {
    if (!canvasAgent.inkPresent) return null;
    const image=canvasAgentInkContext.getImageData(0,0,canvasAgentInkCanvas.width,canvasAgentInkCanvas.height), data=image.data;
    let left=image.width,top=image.height,right=-1,bottom=-1;
    for (let y=0;y<image.height;y++) for (let x=0;x<image.width;x++) if (data[(y*image.width+x)*4+3]) {
      left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);
    }
    if (right<left||bottom<top) return null;
    const width=right-left+1,height=bottom-top+1,
      padding=Math.max(CANVAS_AGENT_INK_PADDING_MIN,Math.min(CANVAS_AGENT_INK_PADDING_MAX,Math.round(Math.max(width,height)*CANVAS_AGENT_INK_PADDING_RATIO))),
      outputPadding=Math.ceil(padding*CANVAS_AGENT_INK_OUTPUT_SCALE),outputWidth=Math.max(1,Math.ceil(width*CANVAS_AGENT_INK_OUTPUT_SCALE)),outputHeight=Math.max(1,Math.ceil(height*CANVAS_AGENT_INK_OUTPUT_SCALE)),
      output=document.createElement("canvas");
    output.width=outputWidth+outputPadding*2;
    output.height=outputHeight+outputPadding*2;
    const outputContext=output.getContext("2d");
    outputContext.fillStyle="#fff";
    outputContext.fillRect(0,0,output.width,output.height);
    outputContext.drawImage(canvasAgentInkCanvas,left,top,width,height,outputPadding,outputPadding,outputWidth,outputHeight);
    let mediaType="image/webp",name="canvas-agent-message.webp",blob=null;
    try{blob=await canvasAgentCanvasBlob(output,mediaType,CANVAS_AGENT_INK_WEBP_QUALITY);}catch{}
    if(!blob?.size||String(blob.type||"").toLowerCase()!==mediaType){
      mediaType="image/png";
      name="canvas-agent-message.png";
      blob=await canvasAgentCanvasBlob(output,mediaType);
    }
    if (!blob) throw Error(t("canvasAgentImageUnsupported"));
    return canvasAgentPrepareAttachment(new File([blob],name,{type:mediaType}));
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
      ...(object.kind === "image" ? { sourceName:item.sourceName || "", naturalSize:{ width:item.naturalW, height:item.naturalH } } : {}),
    };
  }
  function canvasAgentContentBounds() {
    const full = { x:0,y:0,w:SIZE,h:SIZE };
    return unionLocalBounds(
      unionLocalBounds(
        unionLocalBounds(
          unionLocalBounds(visibleInkBounds(full),imageBounds()),
          textBoxBounds(),
        ),
        animationBounds(),
      ),
      widgetBounds(),
    );
  }
  function canvasAgentAllObjects() {
    return [
      ...state.widgets.map(item=>canvasAgentObjectSummary({kind:"widget",item})),
      ...state.textBoxes.map(item=>canvasAgentObjectSummary({kind:"text",item})),
      ...state.images.map(item=>canvasAgentObjectSummary({kind:"image",item})),
    ];
  }
  function canvasAgentViewFacts() {
    const viewport = viewportRect(), signature = JSON.stringify({viewport,scale:state.scale,panX:state.panX,panY:state.panY,selection:canvasAgentSelectionIds(),ink:state.selection?.box || null});
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
    canvasAgentSyncSelection();
    if (!canvasAgentReferencePicker.hidden) canvasAgentRenderReferencePicker(canvasAgentReferenceSearch.value);
  }
  function canvasAgentTurnReferences() {
    const objectIds=canvasAgentReferencedIds(), region=state.selection?.box;
    return {objectIds,...(region?{region:{x:region.x,y:region.y,width:region.w,height:region.h}}:{})};
  }
  function canvasAgentFencedSegments(value) {
    const text=String(value||""), lines=text.split("\n"), segments=[], plain=[];
    const flushPlain=()=>{if(plain.length)segments.push({type:"text",text:plain.splice(0).join("\n")});};
    for(let index=0;index<lines.length;index++) {
      const opening=lines[index].match(/^\s*```([^`]*)$/);
      if(!opening){plain.push(lines[index]);continue;}
      flushPlain();
      const content=[];
      index++;
      while(index<lines.length&&!/^\s*```\s*$/.test(lines[index])){content.push(lines[index]);index++;}
      segments.push({type:"block",language:opening[1].trim().split(/\s+/)[0].slice(0,32),text:content.join("\n")});
    }
    flushPlain();
    return segments;
  }
  function canvasAgentBlockLabel(language) {
    if(!language)return t("canvasAgentCodeBlock");
    if(["text","txt","plaintext"].includes(language.toLowerCase()))return t("canvasAgentTextBlock");
    return language;
  }
  function canvasAgentMarkdownHref(value) {
    const text=String(value||"").trim();
    if(!/^(?:https?:\/\/|mailto:)/i.test(text)||/[\u0000-\u001f\u007f\s]/.test(text)||/^mailto:.*%0[ad]/i.test(text))return "";
    try{
      const parsed=new URL(text);
      if(!["http:","https:","mailto:"].includes(parsed.protocol))return "";
      if(["http:","https:"].includes(parsed.protocol)&&(parsed.username||parsed.password||!parsed.hostname))return "";
      return parsed.href;
    }catch{return "";}
  }
  function canvasAgentAppendMarkdownStyled(parent,value) {
    const segments=MIXED_TEXT?.tokenizeInline?.(String(value||""))||[{type:"text",text:String(value||"")}];
    for(const segment of segments){
      const content=segment.type==="math"?segment.raw:segment.text;
      let node;
      if(segment.code){node=document.createElement("code");node.textContent=content;}
      else node=document.createTextNode(content||"");
      if(segment.italic){const emphasis=document.createElement("em");emphasis.append(node);node=emphasis;}
      if(segment.bold){const strong=document.createElement("strong");strong.append(node);node=strong;}
      parent.append(node);
    }
  }
  function canvasAgentAppendMarkdownLinks(parent,value) {
    const text=String(value||""),pattern=/(\*\*|__|\*|_)?(!?)\[([^\]\n]{1,240})\]\(\s*((?:https?:\/\/|mailto:)(?:[^\s<>"'()]|\([^\s<>"'()]{0,240}\)){1,1000})\s*(?:["'][^"'\n]{0,160}["'])?\s*\)\1|<((?:https?:\/\/|mailto:)[^<>\s]{1,1000})>/gi;
    let cursor=0,match;
    while((match=pattern.exec(text))){
      canvasAgentAppendMarkdownStyled(parent,text.slice(cursor,match.index));
      const href=canvasAgentMarkdownHref(match[4]||match[5]);
      if(!href)canvasAgentAppendMarkdownStyled(parent,match[0]);
      else{
        const link=document.createElement("a");
        link.href=href;link.target="_blank";link.rel="noopener noreferrer";link.referrerPolicy="no-referrer";
        if(match[2]){link.className="canvas-agent-markdown-image-link";link.setAttribute("aria-label",match[3]);}
        canvasAgentAppendMarkdownStyled(link,match[3]||match[5]||href);
        if(match[1]){const wrapper=document.createElement(match[1].length===2?"strong":"em");wrapper.append(link);parent.append(wrapper);}else parent.append(link);
      }
      cursor=pattern.lastIndex;
    }
    canvasAgentAppendMarkdownStyled(parent,text.slice(cursor));
  }
  function canvasAgentAppendMarkdownInline(parent,value) {
    const text=String(value||""),pattern=/`([^`\n]*)`/g;
    let cursor=0,match;
    while((match=pattern.exec(text))){
      canvasAgentAppendMarkdownLinks(parent,text.slice(cursor,match.index));
      const code=document.createElement("code");code.textContent=match[1];parent.append(code);cursor=pattern.lastIndex;
    }
    canvasAgentAppendMarkdownLinks(parent,text.slice(cursor));
  }
  function canvasAgentMarkdownSafe(value) {
    const text=String(value||"");
    if(text.length>CANVAS_AGENT_MARKDOWN_TEXT_LIMIT)return false;
    let lines=1,markers=0,backslashes=0;
    for(const character of text){
      if(character==="\n")lines++;
      else if(character==="\\")backslashes++;
      else if("*_`[]<>$^".includes(character))markers++;
      if(lines>CANVAS_AGENT_MARKDOWN_LINE_LIMIT||markers>CANVAS_AGENT_MARKDOWN_MARKER_LIMIT||backslashes>CANVAS_AGENT_MARKDOWN_BACKSLASH_LIMIT)return false;
    }
    return true;
  }
  function canvasAgentAppendMarkdown(parent,value) {
    const lines=String(value||"").replace(/\r\n?/g,"\n").split("\n");
    let paragraph=null,paragraphHardBreak=false,list=null,quote=null;
    const reset=()=>{paragraph=null;paragraphHardBreak=false;list=null;quote=null;};
    for(const raw of lines){
      if(!raw.trim()){reset();continue;}
      const heading=/^ {0,3}(#{1,6})\s+(.+?)(?:\s+#+\s*)?$/.exec(raw),ordered=/^ {0,3}(\d{1,3})[.)]\s+(.+)$/.exec(raw),bullet=/^ {0,3}[-+*]\s+(.+)$/.exec(raw),quoted=/^ {0,3}>\s?(.*)$/.exec(raw);
      if(heading){
        reset();
        const node=document.createElement("h3");node.className="canvas-agent-markdown-heading";node.dataset.level=String(heading[1].length);canvasAgentAppendMarkdownInline(node,heading[2]);parent.append(node);continue;
      }
      if(/^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(raw)){
        reset();parent.append(document.createElement("hr"));continue;
      }
      if(ordered||bullet){
        paragraph=null;paragraphHardBreak=false;quote=null;
        const orderedList=Boolean(ordered),content=(ordered||bullet)[2]||(ordered||bullet)[1];
        if(!list||list.ordered!==orderedList){const element=document.createElement(orderedList?"ol":"ul");if(orderedList&&Number(ordered[1])!==1)element.start=Number(ordered[1]);parent.append(element);list={element,ordered:orderedList};}
        const item=document.createElement("li"),task=/^\[([ xX])\]\s+(.+)$/.exec(content);
        if(task){const marker=document.createElement("span");marker.className="canvas-agent-markdown-task";marker.textContent=task[1].trim()?"✓":"○";item.append(marker);canvasAgentAppendMarkdownInline(item,task[2]);}
        else canvasAgentAppendMarkdownInline(item,content);
        list.element.append(item);continue;
      }
      if(quoted){
        paragraph=null;paragraphHardBreak=false;list=null;
        if(!quote){quote=document.createElement("blockquote");parent.append(quote);}else quote.append(document.createElement("br"));
        canvasAgentAppendMarkdownInline(quote,quoted[1]);continue;
      }
      list=null;quote=null;
      if(!paragraph){paragraph=document.createElement("p");parent.append(paragraph);}
      else paragraph.append(document.createElement(paragraphHardBreak?"br":"span"));
      if(!paragraphHardBreak&&paragraph.childNodes.length>1)paragraph.lastChild.textContent=" ";
      canvasAgentAppendMarkdownInline(paragraph,raw.trim().replace(/\s{2}$/,""));
      paragraphHardBreak=/\s{2}$/.test(raw);
    }
  }
  function canvasAgentRenderMessageBody(body, value, role, options) {
    const text=String(value||""),final=options?.final!==false;
    if(role!=="assistant"||!final){body.classList.remove("is-markdown");body.textContent=text;return;}
    const segments=canvasAgentFencedSegments(text);
    const plain=segments.filter(segment=>segment.type==="text").map(segment=>segment.text).join("\n");
    if(segments.length>CANVAS_AGENT_MARKDOWN_SEGMENT_LIMIT||!canvasAgentMarkdownSafe(plain)||text.endsWith("…")&&(text.match(/^\s*```/gm)||[]).length%2===1){body.classList.remove("is-markdown");body.textContent=text;return;}
    body.classList.add("is-markdown");
    body.replaceChildren();
    for(const segment of segments) {
      if(segment.type==="text") { canvasAgentAppendMarkdown(body,segment.text); continue; }
      const block=document.createElement("section"), head=document.createElement("div"), label=document.createElement("span"), button=document.createElement("button"), pre=document.createElement("pre"), code=document.createElement("code");
      block.className="canvas-agent-copy-block";
      block.dataset.language=segment.language;
      head.className="canvas-agent-copy-block-head";
      label.className="canvas-agent-copy-block-language";
      label.textContent=canvasAgentBlockLabel(segment.language);
      button.className="canvas-agent-copy-block-button";
      button.type="button";
      button.textContent=t("canvasAgentCopyBlock");
      code.textContent=segment.text;
      button.addEventListener("click",async()=>{
        const copied=await writeClipboardText(segment.text);
        button.textContent=t(copied?"canvasAgentBlockCopied":"canvasAgentBlockCopyFailed");
        button.classList.toggle("copied",copied);
        button.classList.toggle("error",!copied);
        setTimeout(()=>{
          button.textContent=t("canvasAgentCopyBlock");
          button.classList.remove("copied","error");
        },1800);
      });
      pre.append(code);
      head.append(label,button);
      block.append(head,pre);
      body.append(block);
    }
  }
  function canvasAgentSetAssistantCopyState(button,state="idle") {
    const normalized=["copied","error"].includes(state)?state:"idle",key={idle:"canvasAgentCopyResponse",copied:"canvasAgentResponseCopied",error:"canvasAgentResponseCopyFailed"}[normalized];
    button.dataset.copyState=normalized;
    button.classList.toggle("copied",normalized==="copied");
    button.classList.toggle("error",normalized==="error");
    button.querySelector(".canvas-agent-message-copy-label").textContent=t(key);
    button.setAttribute("aria-label",t(key));
    button.setAttribute("title",t(key));
  }
  async function canvasAgentCopyAssistantMessage(target) {
    const button=target?.copyButton,text=String(target?.messageText||"");
    if(!button||target?.historyItem?.role!=="assistant"||target.historyItem.copyable!==true||!text)return false;
    const generation=(button._copyGeneration||0)+1;
    button._copyGeneration=generation;
    button.disabled=true;
    const copied=await writeClipboardText(text);
    if(button._copyGeneration!==generation)return copied;
    button.disabled=false;
    canvasAgentSetAssistantCopyState(button,copied?"copied":"error");
    clearTimeout(button._copyResetTimer);
    button._copyResetTimer=setTimeout(()=>{
      if(button._copyGeneration!==generation)return;
      canvasAgentSetAssistantCopyState(button,"idle");
    },1800);
    return copied;
  }
  function canvasAgentSetAssistantCopyReady(target,ready) {
    if(!target?.copyActions)return;
    target.historyItem.copyable=Boolean(ready);
    target.copyActions.hidden=!ready;
    target.copyButton.disabled=!ready;
    if(!ready){
      target.copyButton._copyGeneration=(target.copyButton._copyGeneration||0)+1;
      clearTimeout(target.copyButton._copyResetTimer);
      canvasAgentSetAssistantCopyState(target.copyButton,"idle");
    }
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
      target=canvasAgentRow("assistant",text,[],{eventKey,final,turn:position.turn,step:position.step});
    canvasAgent.assistantRows.set(eventKey,target);
    return target;
  }
  function canvasAgentMarkTurnSummaryCopyable(turn) {
    const items=canvasAgent.currentConversation?.items||[],lastToolIndex=items.findLastIndex(item=>item?.type==="tool"&&item.turn===turn),candidates=[...canvasAgent.assistantRows.values()]
      .map(target=>({target,index:items.indexOf(target?.historyItem)}))
      .filter(({target,index})=>canvasAgentAssistantPosition(target?.historyItem).turn===turn&&index>lastToolIndex&&target?.historyItem?.final!==false&&String(target?.messageText||"").trim())
      .sort((left,right)=>left.index-right.index);
    const target=candidates.at(-1)?.target;
    if(!target)return false;
    canvasAgentSetAssistantCopyReady(target,true);
    return true;
  }
  function canvasAgentCaptureAttachment(event) {
    const attachment=event?.attachment,match=/^data:(image\/(?:png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(attachment?.dataUrl||"")),
      bytes=Number(attachment?.bytes),width=Number(attachment?.width),height=Number(attachment?.height),maxBytes=CANVAS_AGENT_DETAIL_CAPTURE_POLICY.maxBytes;
    let decodedBytes=-1;
    try{decodedBytes=atob(match?.[2]||"").length;}catch{}
    if(!match||String(attachment?.mediaType||"")!==match[1]||decodedBytes!==bytes||!Number.isSafeInteger(bytes)||bytes<=0||bytes>maxBytes||!Number.isSafeInteger(width)||width<1||width>CANVAS_AGENT_DETAIL_CAPTURE_POLICY.maxLongEdge||!Number.isSafeInteger(height)||height<1||height>CANVAS_AGENT_DETAIL_CAPTURE_POLICY.maxLongEdge||match[2].length>Math.ceil(maxBytes*4/3)+4)return null;
    const name=String(attachment.name||"penecho-canvas-capture").replace(/[^\w.-]+/g,"-").replace(/^[.-]+/,"").slice(0,180)||"penecho-canvas-capture";
    return {id:canvasClientId(),kind:"canvas_capture",name,mediaType:match[1],bytes,width,height,dataUrl:match[0]};
  }
  function canvasAgentRenderErrorElement(target) {
    const item=target.historyItem,error=canvasAgentNormalizeError(item);
    target.summaryText.textContent=canvasAgentErrorSummary(error);
    target.action.textContent=t("canvasAgentErrorViewDetails");
    target.codeRow.hidden=!error.code;
    target.codeLabel.textContent=t("canvasAgentErrorCode");
    target.code.textContent=error.code;
    target.messageLabel.textContent=t("canvasAgentErrorMessage");
    target.message.textContent=error.message;
  }
  function canvasAgentAppendErrorElement(item,append=true) {
    if(append)canvasAgentTranscript.querySelector(".canvas-agent-empty")?.remove();
    const row=document.createElement("article"),label=document.createElement("span"),details=document.createElement("details"),summary=document.createElement("summary"),summaryText=document.createElement("span"),action=document.createElement("span"),body=document.createElement("div"),codeRow=document.createElement("div"),codeLabel=document.createElement("span"),code=document.createElement("code"),messageLabel=document.createElement("span"),message=document.createElement("pre");
    row.className="canvas-agent-message assistant error";
    label.className="canvas-agent-message-role";
    label.textContent="Agent";
    details.className="canvas-agent-error";
    summaryText.className="canvas-agent-error-summary";
    action.className="canvas-agent-error-action";
    body.className="canvas-agent-error-body";
    codeRow.className="canvas-agent-error-code";
    codeLabel.className=messageLabel.className="canvas-agent-error-label";
    message.className="canvas-agent-error-message";
    summary.append(summaryText,action);
    codeRow.append(codeLabel,code);
    body.append(codeRow,messageLabel,message);
    details.append(summary,body);
    row.append(label,details);
    const target={row,details,summaryText,action,codeRow,codeLabel,code,messageLabel,message,historyItem:item};
    row._canvasAgentErrorTarget=target;
    canvasAgentRenderErrorElement(target);
    if(append)canvasAgentTranscript.append(row);
    return target;
  }
  function canvasAgentErrorRow(value,{eventKey=""}={}) {
    const error=canvasAgentNormalizeError(value),key=canvasAgentHistoryText(eventKey,128);
    if(!canvasAgent.currentConversation)canvasAgent.currentConversation=canvasAgentNewConversationRecord();
    const existing=key?canvasAgent.currentConversation.items.find(item=>item.type==="error"&&item.eventKey===key):null;
    if(existing){
      const target=[...canvasAgentTranscript.querySelectorAll(".canvas-agent-message.error")].map(row=>row._canvasAgentErrorTarget).find(candidate=>candidate?.historyItem===existing);
      return target||null;
    }
    const item={id:canvasClientId(),type:"error",code:error.code,message:error.message,eventKey:key};
    canvasAgent.currentConversation.items.push(item);
    if(canvasAgent.currentConversation.items.length>CANVAS_AGENT_HISTORY_ITEM_LIMIT)canvasAgent.currentConversation.items.splice(0,canvasAgent.currentConversation.items.length-CANVAS_AGENT_HISTORY_ITEM_LIMIT);
    const target=canvasAgentAppendErrorElement(item,!canvasAgent.viewingHistoryId);
    canvasAgentScheduleHistoryPersist(0);
    if(!canvasAgent.viewingHistoryId)canvasAgentScrollToLatest();
    canvasAgentSyncInputHint();
    return target;
  }
  function canvasAgentAppendMessageElement(item, attachments = [], append = true) {
    if (append) canvasAgentTranscript.querySelector(".canvas-agent-empty")?.remove();
    const row = document.createElement("article");
    row.className = `canvas-agent-message ${item.role}`;
    const label = document.createElement("span"), body = document.createElement("div");
    label.className = "canvas-agent-message-role";
    label.textContent = item.role === "user" ? "You" : "Agent";
    body.className = "canvas-agent-message-body";
    canvasAgentRenderMessageBody(body,item.text,item.role,{final:item.role!=="assistant"||item.final!==false});
    row.append(label,body);
    const position=canvasAgentAssistantPosition(item),target={row,body,historyItem:item,messageText:item.text,turn:position.turn,step:position.step,copyActions:null,copyButton:null};
    if(item.role==="assistant"){
      const actions=document.createElement("div"),button=document.createElement("button"),icon=document.createElement("span"),copyLabel=document.createElement("span");
      actions.className="canvas-agent-message-actions";
      button.className="canvas-agent-message-copy";
      button.type="button";
      icon.className="canvas-agent-message-copy-icon";
      icon.setAttribute("aria-hidden","true");
      copyLabel.className="canvas-agent-message-copy-label";
      button.append(icon,copyLabel);
      actions.append(button);
      row.append(actions);
      target.copyActions=actions;
      target.copyButton=button;
      canvasAgentSetAssistantCopyState(button);
      canvasAgentSetAssistantCopyReady(target,item.copyable===true);
      button.addEventListener("click",()=>void canvasAgentCopyAssistantMessage(target));
    }
    const renderedAttachments=attachments.length?attachments:(Array.isArray(item.files)?item.files:[]),imageAttachments=renderedAttachments.filter(attachment=>attachment?.kind!=="file"&&attachment?.dataUrl),fileAttachments=renderedAttachments.filter(attachment=>attachment?.kind==="file");
    if (imageAttachments.length) {
      const images = document.createElement("div");
      images.className = "canvas-agent-message-images";
      if (imageAttachments.some(attachment=>attachment?.kind==="canvas_capture")) images.classList.add("capture");
      for (const attachment of imageAttachments) {
        const image = document.createElement("img");
        image.src = attachment.dataUrl;
        image.alt = attachment.name;
        if(/^canvas-agent-message\.(?:webp|png)$/.test(attachment.name)){
          images.classList.add("has-handwriting");
          image.classList.add("canvas-agent-message-handwriting");
          if(Number.isFinite(attachment.width)&&attachment.width>0)image.width=attachment.width;
          if(Number.isFinite(attachment.height)&&attachment.height>0)image.height=attachment.height;
        }
        if(attachment.kind==="canvas_capture"){
          const link=document.createElement("a");
          link.className="canvas-agent-capture-link";
          link.href=attachment.dataUrl;
          link.download=attachment.name;
          link.setAttribute("aria-label",t("canvasAgentScreenshotDownload").replace("{name}",attachment.name));
          image.width=attachment.width;
          image.height=attachment.height;
          link.append(image);
          images.append(link);
        }else images.append(image);
      }
      row.append(images);
    }
    if(fileAttachments.length){
      const files=document.createElement("div");
      files.className="canvas-agent-message-files";
      for(const attachment of fileAttachments)files.append(canvasAgentCreateFilePreview(attachment,{message:true}));
      row.append(files);
    }
    if (!renderedAttachments.length&&item.attachmentCount) {
      const note=document.createElement("span");
      note.className="canvas-agent-message-attachment-note";
      note.textContent=t("canvasAgentHistoryAttachments").replace("{count}",String(item.attachmentCount));
      row.append(note);
    }
    if (append) canvasAgentTranscript.append(row);
    return target;
  }
  function canvasAgentRow(role, text = "", attachments = [], {eventKey="",final=true,turn=null,step=null}={}) {
    const files=attachments.map(canvasAgentNormalizeHistoryFile).filter(Boolean).slice(0,CANVAS_AGENT_MAX_ATTACHMENTS),item={id:canvasClientId(),type:"message",role,text:canvasAgentMessageText(text),attachmentCount:attachments.length,eventKey,...(Number.isSafeInteger(turn)?{turn}:{}),...(Number.isSafeInteger(step)?{step}:{}),...(files.length?{files}:{}),...(role==="assistant"?{final:final!==false,copyable:false}:{})};
    if (!canvasAgent.currentConversation) canvasAgent.currentConversation=canvasAgentNewConversationRecord();
    canvasAgent.currentConversation.items.push(item);
    if (canvasAgent.currentConversation.items.length>CANVAS_AGENT_HISTORY_ITEM_LIMIT) canvasAgent.currentConversation.items.splice(0,canvasAgent.currentConversation.items.length-CANVAS_AGENT_HISTORY_ITEM_LIMIT);
    const target=canvasAgentAppendMessageElement(item,attachments,!canvasAgent.viewingHistoryId);
    canvasAgentScheduleHistoryPersist(role==="assistant"?220:0);
    if (!canvasAgent.viewingHistoryId) canvasAgentScrollToLatest(role === "user");
    canvasAgentSyncInputHint();
    return target;
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
  function canvasAgentRenderToolRow(target) {
    target.intent.textContent = canvasAgentToolIntent(target.name,target.arguments);
    target.status.textContent = t({ running:"canvasAgentToolRunning", done:"canvasAgentToolDone", error:"canvasAgentToolFailed" }[target.state] || "canvasAgentToolDone");
    target.argumentsLabel.textContent = t("canvasAgentToolArguments");
    target.resultLabel.textContent = t("canvasAgentToolResult");
  }
  function canvasAgentAppendToolElement(item, append = true) {
    if (append) canvasAgentTranscript.querySelector(".canvas-agent-empty")?.remove();
    const row = document.createElement("details"), head = document.createElement("summary"), intent = document.createElement("span"), status = document.createElement("span"), body = document.createElement("div"), argumentsLabel = document.createElement("span"), argumentsDetail = document.createElement("pre"), result = document.createElement("div"), resultLabel = document.createElement("span"), resultDetail = document.createElement("pre");
    row.className = `canvas-agent-tool${item.state==="running"?" running":""}${item.state==="error"?" error":""}`;
    head.className = "canvas-agent-tool-head";
    intent.className = "canvas-agent-tool-intent";
    status.className = "canvas-agent-tool-status";
    body.className = "canvas-agent-tool-body";
    argumentsLabel.className = resultLabel.className = "canvas-agent-tool-detail-label";
    result.className = "canvas-agent-tool-result";
    result.hidden = !item.resultText;
    argumentsDetail.textContent = item.argumentsText;
    resultDetail.textContent = item.resultText;
    head.append(intent,status);
    body.append(argumentsLabel,argumentsDetail,result);
    result.append(resultLabel,resultDetail);
    row.append(head,body);
    if (append) canvasAgentTranscript.append(row);
    let parsedArguments={};
    try { parsedArguments=JSON.parse(item.argumentsText||"{}"); } catch {}
    const target = {row,intent,status,argumentsLabel,result,resultLabel,resultDetail,name:item.name,arguments:parsedArguments,state:item.state,turn:item.turn,step:item.step,historyItem:item};
    canvasAgentRenderToolRow(target);
    return target;
  }
  function canvasAgentToolRow(event) {
    const item={id:canvasClientId(),type:"tool",callId:String(event.callId||""),name:String(event.name||""),turn:event.turn,step:event.step,argumentsText:canvasAgentHistoryText(JSON.stringify(event.arguments||{},null,2),8000),resultText:"",state:"running"};
    if (!canvasAgent.currentConversation) canvasAgent.currentConversation=canvasAgentNewConversationRecord();
    canvasAgent.currentConversation.items.push(item);
    if (canvasAgent.currentConversation.items.length>CANVAS_AGENT_HISTORY_ITEM_LIMIT) canvasAgent.currentConversation.items.splice(0,canvasAgent.currentConversation.items.length-CANVAS_AGENT_HISTORY_ITEM_LIMIT);
    const target=canvasAgentAppendToolElement(item,!canvasAgent.viewingHistoryId);
    canvasAgent.toolRows.set(event.callId,target);
    canvasAgentScheduleHistoryPersist();
    if (!canvasAgent.viewingHistoryId) canvasAgentScrollToLatest();
    canvasAgentSyncInputHint();
  }
  function canvasAgentRenderConversation(conversation, active = false) {
    canvasAgentTranscript.replaceChildren();
    if (active) {
      canvasAgent.assistantRows.clear();
      canvasAgent.toolRows.clear();
    }
    for (const item of conversation?.items||[]) {
      if (item.type==="message") {
        const target=canvasAgentAppendMessageElement(item,[],true);
        if (active&&item.role==="assistant"&&item.eventKey) canvasAgent.assistantRows.set(item.eventKey,target);
      } else if(item.type==="error") {
        canvasAgentAppendErrorElement(item,true);
      } else if (item.type==="tool") {
        const target=canvasAgentAppendToolElement(item,true);
        if (active&&item.callId) canvasAgent.toolRows.set(item.callId,target);
      }
    }
    if (!canvasAgentTranscript.childElementCount) canvasAgentRenderEmpty();
    canvasAgentScrollToLatest(true);
    canvasAgentSyncInputHint();
  }
  function canvasAgentSetRunning(running) {
    canvasAgent.running = running;
    canvasAgentStop.hidden = !running;
    canvasAgentSetComposerActionLabel(canvasAgentSend,running ? "canvasAgentSteer" : "canvasAgentSend");
    canvasAgentSetStatus(t(running ? "canvasAgentWorking" : "canvasAgentReady"),running ? "running" : "ready");
    canvasAgentSyncTriggerState();
    if (running) canvasAgentPauseAutomaticAI();
    else canvasAgentResumeAutomaticAI();
  }
  function canvasAgentHandleEvent(event,{ replay=false }={}) {
    if (!event || typeof event !== "object") return;
    if (event.kind === "turn_start") {
      canvasAgent.requestPending = false;
      canvasAgent.lastTurnError = null;
      canvasAgentSetRunning(true);
    }
    else if (event.kind === "user_message" && replay && event.text) canvasAgentRow("user",event.text);
    else if (event.kind === "assistant_delta") {
      let target = canvasAgentPendingAssistantRow(event);
      if (!target) target=canvasAgentCreateAssistantRow(event,"",false);
      target.messageText = canvasAgentMessageText(target.messageText + (event.text || ""));
      canvasAgentRenderMessageBody(target.body,target.messageText,"assistant",{final:false});
      target.historyItem.text=target.messageText;target.historyItem.final=false;
      canvasAgentScheduleHistoryPersist();
      if (!canvasAgent.viewingHistoryId) canvasAgentScrollToLatest();
    } else if (event.kind === "assistant_message") {
      let target = canvasAgentPendingAssistantRow(event);
      if (!target && event.text) target=canvasAgentCreateAssistantRow(event,event.text,true);
      else if (target) {
        if(typeof event.text==="string")target.messageText=canvasAgentMessageText(event.text);
        canvasAgentRenderMessageBody(target.body,target.messageText,"assistant",{final:true});
        target.historyItem.text=target.messageText;target.historyItem.final=true;
      }
      if (target && event.interrupted) target.row.classList.add("interrupted");
      canvasAgentScheduleHistoryPersist(0);
      if (target&&!canvasAgent.viewingHistoryId) canvasAgentScrollToLatest();
    } else if (event.kind === "capture_message") {
      const attachment=canvasAgentCaptureAttachment(event);
      if(attachment)canvasAgentRow("assistant",t("canvasAgentScreenshot"),[attachment]);
    } else if (event.kind === "tool_call") canvasAgentToolRow(event);
    else if (event.kind === "tool_result") {
      const target = canvasAgent.toolRows.get(event.callId);
      if (target) {
        target.row.classList.remove("running");
        target.row.classList.toggle("error",Boolean(event.error));
        target.state = event.error ? "error" : "done";
        const resultText = event.text || (event.error ? typeof event.error === "string" ? event.error : JSON.stringify(event.error,null,2) : "");
        target.result.hidden = !resultText;
        target.resultDetail.textContent = resultText;
        target.historyItem.state=target.state;
        target.historyItem.resultText=canvasAgentHistoryText(resultText,8000);
        canvasAgentRenderToolRow(target);
        canvasAgentScheduleHistoryPersist(0);
      }
    } else if (event.kind === "turn_end") {
      canvasAgent.requestPending = false;
      if(event.reason?.kind==="completed")canvasAgentMarkTurnSummaryCopyable(event.turn);
      canvasAgent.lastTurnError=event.reason?.kind==="error"?canvasAgentNormalizeError(event.reason?.error||event.reason):null;
      canvasAgentSetRunning(false);
      if(canvasAgent.lastTurnError){
        canvasAgentErrorRow(canvasAgent.lastTurnError,{eventKey:`turn:${event.turn}`});
        canvasAgentSetStatus(canvasAgentErrorSummary(canvasAgent.lastTurnError),"error");
      }
      canvasAgentSyncState();
      canvasAgentPersistCurrentConversation();
      const pendingConnectionChange=canvasAgent.pendingConnectionChange;
      canvasAgent.pendingConnectionChange=null;
      if(pendingConnectionChange)canvasAgentConnectionDidChange(pendingConnectionChange.force,pendingConnectionChange.provider);
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
      canvasAgent.lastTurnError=null;
      canvasAgent.sessionId = envelope.canvasSessionId;
      canvasAgent.resumeToken = String(envelope.payload?.resumeToken || canvasAgent.resumeToken || "");
      canvasAgent.connectionId = String(envelope.payload?.connectionId || "");
      canvasAgent.sessionEngine = String(envelope.payload?.engine || "");
      canvasAgent.sessionProjectId = String(envelope.payload?.project?.id || "");
      canvasAgent.sessionAccessMode = String(envelope.payload?.accessMode || "controlled");
      const capabilities=envelope.payload?.projectCapabilities;
      canvasAgent.sessionProjectCapabilities=capabilities&&typeof capabilities.bash==="boolean"&&typeof capabilities.readOnly==="boolean"
        ? {bash:capabilities.bash,readOnly:capabilities.readOnly}:null;
      canvasAgent.sessionReady = true;
      canvasAgent.pendingHandshakeId = "";
      canvasAgent.pendingProvider = "";
      canvasAgent.sessionSearchConfigured = envelope.payload?.webSearchConfigured === true;
      canvasAgent.sessionSearchEnabled = envelope.payload?.webSearchEnabled === true;
      canvasAgent.pendingConversationHistory=[];
      canvasAgentSetSearchConfigured(canvasAgent.sessionSearchConfigured);
      canvasAgentRenderProjects();
      try { sessionStorage.setItem(CANVAS_AGENT_SESSION_KEY,JSON.stringify({sessionId:canvasAgent.sessionId,resumeToken:canvasAgent.resumeToken,connectionId:canvasAgent.connectionId,engine:canvasAgent.sessionEngine,projectId:canvasAgent.sessionProjectId,accessMode:canvasAgent.sessionAccessMode})); } catch {}
      canvasAgentSetStatus(t(envelope.payload?.resumed ? "canvasAgentResumed" : "canvasAgentReady"),"ready");
      if (envelope.payload?.resumed) {
        canvasAgent.currentConversation.items=[];
        if (!canvasAgent.viewingHistoryId) canvasAgentTranscript.replaceChildren();
        canvasAgent.assistantRows.clear();
        canvasAgent.toolRows.clear();
      }
      for (const event of envelope.payload?.backlog || []) canvasAgentHandleEvent(event,{replay:true});
      if (!canvasAgent.viewingHistoryId&&!canvasAgentTranscript.childElementCount) canvasAgentRenderEmpty();
      canvasAgentPersistCurrentConversation();
      canvasAgentScrollToLatest(true);
      canvasAgent.connectResolve?.();
      canvasAgent.connectResolve = canvasAgent.connectReject = null;
      canvasAgentSyncState();
    }
    if (envelope.type === "session_event") canvasAgentHandleEvent(envelope.payload);
    else if (envelope.type === "agent_status") {
      const status=String(envelope.payload?.status||"");
      canvasAgent.requestPending = false;
      canvasAgentSetRunning(status !== "idle");
      if(status === "preparing"){
        const phase=String(envelope.payload?.phase||"");
        const key=phase==="installing"?"canvasAgentSettingUpCodex":phase==="repairing"?"canvasAgentRepairingCodex":"canvasAgentCheckingCodex";
        canvasAgentSetStatus(t(key),"running");
      }
      else if(status === "idle"&&canvasAgent.lastTurnError)canvasAgentSetStatus(canvasAgentErrorSummary(canvasAgent.lastTurnError),"error");
    }
    else if (envelope.type === "tool_request") await canvasAgentExecuteTool(envelope.payload);
    else if (envelope.type === "error") {
      const error=canvasAgentNormalizeError(envelope.payload);
      canvasAgent.requestPending = false;
      canvasAgent.lastTurnError=error;
      canvasAgentSyncTriggerState();
      canvasAgentResumeAutomaticAI();
      canvasAgentErrorRow(error,{eventKey:`envelope:${envelope.seq}`});
      canvasAgentSetStatus(canvasAgentErrorSummary(error),"error");
      if(pendingHandshakeError){
        canvasAgent.sessionReady=Boolean(canvasAgent.sessionId);
        canvasAgent.connectReject?.(Error(envelope.payload?.message || "PenEcho Agent failed"));
        canvasAgent.connectResolve=canvasAgent.connectReject=null;
      }else if (envelope.payload?.fatal) canvasAgent.connectReject?.(Error(envelope.payload?.message || "PenEcho Agent failed"));
    }
  }
  function canvasAgentSocketUrl() {
    const path=window.PENECHO_CONFIG?.runtime === "cloud" ? "/api/v1/remote-canvas/canvas-agent" : "/api/canvas-agent/socket";
    return `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}${path}`;
  }
  function canvasAgentWaitForReady(start,{handshakeId,provider}={}) {
    if (canvasAgent.connectPromise) return canvasAgent.connectPromise;
    const expectedHandshakeId=String(handshakeId||"");
    if (!expectedHandshakeId) return Promise.reject(Error("PenEcho Agent handshake identity is missing."));
    canvasAgent.pendingHandshakeId=expectedHandshakeId;
    canvasAgent.pendingProvider=String(provider||"");
    let wrapped;
    const pending = new Promise((resolve,reject)=>{
      canvasAgent.connectResolve = resolve;
      canvasAgent.connectReject = reject;
      try { start(); }
      catch (error) {
        canvasAgent.connectResolve=canvasAgent.connectReject=null;
        if(canvasAgent.pendingHandshakeId===expectedHandshakeId){canvasAgent.pendingHandshakeId="";canvasAgent.pendingProvider="";}
        reject(error);
      }
    });
    wrapped = pending.finally(()=>{
      if (canvasAgent.connectPromise === wrapped) {
        canvasAgent.connectPromise = null;
        if(canvasAgent.pendingHandshakeId===expectedHandshakeId){canvasAgent.pendingHandshakeId="";canvasAgent.pendingProvider="";}
      }
    });
    canvasAgent.connectPromise = wrapped;
    return wrapped;
  }
  function canvasAgentClearTranscript({showEmpty=false}={}) {
    canvasAgentTranscript.replaceChildren();
    canvasAgent.assistantRows.clear();
    canvasAgent.toolRows.clear();
    canvasAgent.toolResultCache.clear();
    canvasAgent.latestChange = null;
    canvasAgent.followLatest = true;
    if (showEmpty) canvasAgentRenderEmpty();
  }
  async function canvasAgentCurrentWidgetCapabilities() {
    if (!state.pluginCatalogLoaded) await loadPluginDocuments();
    return canvasAgentWidgetCapabilities();
  }
  async function canvasAgentStartNewConversation(connectionId = selectedAiConnectionId(), {resetProjection=true,submitExecution=null,preserveDraft=false,preserveConversation=false}={}) {
    connectionId=String(connectionId||"");
    if (resetProjection) canvasAgentBeginLocalConversation({submitExecution,preserveDraft});
    else if(submitExecution)canvasAgentAssertSubmitExecution(submitExecution);
    if (canvasAgent.connectPromise) {
      await canvasAgent.connectPromise;
      return canvasAgentStartNewConversation(connectionId,{resetProjection:false,submitExecution,preserveDraft,preserveConversation});
    }
    if (canvasAgent.socket?.readyState !== WebSocket.OPEN) return canvasAgentConnect({submitExecution});
    if(!preserveConversation){
      canvasAgent.currentConversation.items=[];
      canvasAgentClearTranscript({showEmpty:true});
    }
    if(!preserveDraft){
      canvasAgentClearAttachments();
      canvasAgentClearReferences();
      canvasAgentClearInkDraft();
    }
    canvasAgentSetStatus(t("canvasAgentConnecting"),"connecting");
    canvasAgent.running = false;
    canvasAgentStop.hidden = true;
    canvasAgentSetComposerActionLabel(canvasAgentSend,"canvasAgentSend");
    const widgetCapabilities=await canvasAgentCurrentWidgetCapabilities();
    if(submitExecution)canvasAgentAssertSubmitExecution(submitExecution);
    if(selectedAiConnectionId()!==connectionId)return canvasAgentStartNewConversation(selectedAiConnectionId(),{resetProjection:false,submitExecution,preserveDraft,preserveConversation});
    canvasAgentBeginSessionTransition();
    const handshakeId=canvasClientId(),provider=canvasAgentConnectionProvider(connectionId);
    await canvasAgentWaitForReady(()=>canvasAgentSendEnvelope("new_conversation",{handshakeId,connectionId,webSearchEnabled:canvasAgent.searchEnabled,widgetCapabilities,projectId:canvasAgent.projectId,accessMode:canvasAgentEffectiveAccessMode(),...(canvasAgent.pendingConversationHistory.length?{conversationHistory:canvasAgent.pendingConversationHistory}:{})}),{handshakeId,provider});
    if(selectedAiConnectionId()!==connectionId)return canvasAgentStartNewConversation(selectedAiConnectionId(),{resetProjection:false,submitExecution,preserveDraft,preserveConversation});
  }
  async function canvasAgentChangeConnection(connectionId = selectedAiConnectionId(), {submitExecution=null}={}) {
    connectionId=String(connectionId||"");
    if(canvasAgent.connectPromise){
      await canvasAgent.connectPromise;
      return canvasAgentChangeConnection(connectionId,{submitExecution});
    }
    if(canvasAgent.socket?.readyState!==WebSocket.OPEN||!canvasAgent.sessionId||!canvasAgent.sessionReady)return canvasAgentConnect({submitExecution});
    if(submitExecution)canvasAgentAssertSubmitExecution(submitExecution);
    else canvasAgentInvalidateSubmitExecution();
    const widgetCapabilities=await canvasAgentCurrentWidgetCapabilities();
    if(submitExecution)canvasAgentAssertSubmitExecution(submitExecution);
    if(selectedAiConnectionId()!==connectionId)return canvasAgentChangeConnection(selectedAiConnectionId(),{submitExecution});
    canvasAgentSetStatus(t("canvasAgentConnecting"),"connecting");
    canvasAgentBeginSessionTransition();
    const handshakeId=canvasClientId(),provider=canvasAgentConnectionProvider(connectionId);
    await canvasAgentWaitForReady(()=>canvasAgentSendEnvelope("change_connection",{handshakeId,connectionId,webSearchEnabled:canvasAgent.searchEnabled,widgetCapabilities,projectId:canvasAgent.projectId,accessMode:canvasAgentEffectiveAccessMode()}),{handshakeId,provider});
    if(selectedAiConnectionId()!==connectionId)return canvasAgentChangeConnection(selectedAiConnectionId(),{submitExecution});
  }
  async function canvasAgentConnect(options) {
    const {submitExecution=null}=options||{};
    await canvasAgentEnsureProjects();
    if(submitExecution)canvasAgentAssertSubmitExecution(submitExecution);
    const connectionId = selectedAiConnectionId();
    if (canvasAgent.socket?.readyState === WebSocket.OPEN && canvasAgent.sessionId) {
      if (canvasAgent.sessionReady&&canvasAgent.connectionId === connectionId&&canvasAgent.sessionProjectId===canvasAgent.projectId&&canvasAgent.sessionAccessMode===canvasAgentEffectiveAccessMode()) return;
      if(canvasAgent.sessionReady&&canvasAgent.sessionProjectId===canvasAgent.projectId&&canvasAgent.sessionAccessMode===canvasAgentEffectiveAccessMode()){
        await canvasAgentChangeConnection(connectionId,{submitExecution});
        return;
      }
      await canvasAgentStartNewConversation(connectionId,{submitExecution});
      return canvasAgentConnect({submitExecution});
    }
    if (canvasAgent.connectPromise) {
      await canvasAgent.connectPromise;
      return canvasAgentConnect({submitExecution});
    }
    canvasAgentSetStatus(t("canvasAgentConnecting"),"connecting");
    const widgetCapabilities=await canvasAgentCurrentWidgetCapabilities();
    if(submitExecution)canvasAgentAssertSubmitExecution(submitExecution);
    if(selectedAiConnectionId()!==connectionId)return canvasAgentConnect({submitExecution});
    canvasAgentBeginSessionTransition();
    const handshakeId=canvasClientId(),provider=canvasAgentConnectionProvider(connectionId);
    await canvasAgentWaitForReady(()=>{
      const previousSocket=canvasAgent.socket;
      const socket = new WebSocket(canvasAgentSocketUrl());
      canvasAgent.socket = socket;
      if(previousSocket&&previousSocket!==socket){try{previousSocket.close(1000,"PenEcho Agent session replaced");}catch{}}
      socket.addEventListener("open",()=>{
        if(socket!==canvasAgent.socket){socket.close();return;}
        canvasAgent.outgoingSeq = 0;
        canvasAgent.incomingSeq = 0;
        canvasAgentSendEnvelope("hello",{
          handshakeId,
          canvasSessionId:canvasAgent.sessionId,
          resumeToken:canvasAgent.resumeToken,
          clientId:canvasAgent.clientId,
          connectionId,
          webSearchEnabled:canvasAgent.searchEnabled,
          widgetCapabilities,
          projectId:canvasAgent.projectId,
          accessMode:canvasAgentEffectiveAccessMode(),
          ...(canvasAgent.pendingConversationHistory.length?{conversationHistory:canvasAgent.pendingConversationHistory}:{}),
        });
      });
      socket.addEventListener("message",event=>void canvasAgentHandleMessage(event));
      socket.addEventListener("close",()=>{
        if (socket !== canvasAgent.socket) return;
        const wasPending = Boolean(canvasAgent.connectReject),hadActiveTurn=canvasAgent.requestPending||canvasAgent.running;
        canvasAgent.sessionEngine="";
        canvasAgentInvalidateSubmitExecution(Error("PenEcho Agent connection closed."));
        canvasAgentBeginSessionTransition();
        canvasAgent.connectReject?.(Error("PenEcho Agent connection closed."));
        canvasAgent.connectResolve = canvasAgent.connectReject = null;
        canvasAgent.connectPromise = null;
        canvasAgent.socket = null;
        canvasAgentResolveApproval(false);
        canvasAgent.requestPending = false;
        canvasAgent.running = false;
        canvasAgentStop.hidden = true;
        canvasAgentSetComposerActionLabel(canvasAgentSend,"canvasAgentSend");
        canvasAgentSyncTriggerState();
        canvasAgentResumeAutomaticAI();
        if(hadActiveTurn&&!canvasAgent.lastTurnError){
          const error=canvasAgentNormalizeError({code:"CONNECTION_CLOSED",message:"PenEcho Agent connection closed."});
          canvasAgent.lastTurnError=error;
          canvasAgentErrorRow(error,{eventKey:`connection:${Date.now()}`});
          canvasAgentSetStatus(canvasAgentErrorSummary(error),"error");
        }else if(canvasAgent.lastTurnError)canvasAgentSetStatus(canvasAgentErrorSummary(canvasAgent.lastTurnError),"error");
        else if (!wasPending) canvasAgentSetStatus(t("canvasAgentDisconnected"),"offline");
      });
      socket.addEventListener("error",()=>{ if(socket!==canvasAgent.socket)return; canvasAgentSetStatus(t("canvasAgentErrorConnection"),"error"); });
    },{handshakeId,provider});
    return canvasAgentConnect({submitExecution});
  }
  function canvasAgentConnectionProvider(connectionId) {
    const connection=settings.connections.find(item=>item.id===String(connectionId||""));
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
    void action.catch(error=>canvasAgentSetStatus(String(error?.message||error),"error"));
  }
  async function canvasAgentEnsureSearchSession(submitExecution=null) {
    if (canvasAgent.sessionSearchEnabled === canvasAgent.searchEnabled || canvasAgent.socket?.readyState !== WebSocket.OPEN || !canvasAgent.sessionReady || !canvasAgent.sessionId) return;
    await canvasAgentStartNewConversation(selectedAiConnectionId(),{submitExecution,preserveDraft:true});
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
      canvas_internal_widget:["objectId","artifactId"],canvas_internal_replace_widget:["objectId","baseRevision","expectedHash","changeId","command"],
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
    if (args.target === "region") return canvasAgentValidatedRegion(args.region);
    if (args.target === "object") {
      const object = canvasAgentObject(String(args.objectId || ""));
      if (!object) throw canvasAgentToolError("OBJECT_NOT_FOUND","Canvas object was not found.",{objectId:args.objectId});
      return canvasAgentBox(object);
    }
    throw canvasAgentToolError("INVALID_TARGET","Canvas capture target is invalid. Use viewport, canvas, region, or one object id.",{target:args.target ?? null});
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
  async function canvasAgentCompressedCanvas(source,policy) {
    let canvas=source, encodeQuality=policy.quality, mediaType="image/webp";
    for (let attempt=0;attempt<10;attempt++) {
      let blob=await canvasAgentCanvasBlob(canvas,mediaType,mediaType === "image/webp" ? encodeQuality : undefined);
      if (!blob && mediaType === "image/webp") {
        mediaType="image/png";
        blob=await canvasAgentCanvasBlob(canvas,mediaType);
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
    const {signal=null,assertCurrent=null}=options||{};
    assertCurrent?.();
    const quality=args.quality === "detail" ? "detail" : "basic";
    if(quality === "detail"){
      if(args.target === "object"){
        const object=canvasAgentObject(String(args.objectId||""));
        if(!object)throw canvasAgentToolError("OBJECT_NOT_FOUND","Canvas object was not found.",{objectId:args.objectId});
        if(object.kind!=="widget")throw canvasAgentToolError("DETAIL_TARGET_REQUIRED","Detail capture is limited to one Widget or one explicit region.",{objectId:args.objectId,kind:object.kind});
      }else if(args.target!=="region")throw canvasAgentToolError("DETAIL_TARGET_REQUIRED","Detail capture is limited to one Widget or one explicit region.",{target:args.target});
    }
    const region = canvasAgentTargetRegion(args),
      policy=quality === "detail" ? CANVAS_AGENT_DETAIL_CAPTURE_POLICY : CANVAS_AGENT_LAYOUT_CAPTURE_POLICY,
      scale = Math.min(policy.maxLongEdge/Math.max(region.w,region.h),Math.sqrt(policy.maxPixels/(region.w*region.h))),
      width = Math.max(1,Math.floor(region.w*scale)), height = Math.max(1,Math.floor(region.h*scale)),
      canvas = document.createElement("canvas"), context = canvas.getContext("2d");
    canvas.width = width;
    canvas.height = height;
    await prepareVisibleWidgetSnapshots(region,true,signal);
    assertCurrent?.();
    context.fillStyle = state.paint.paper;
    context.fillRect(0,0,width,height);
    context.save();
    context.scale(scale,scale);
    context.translate(-region.x,-region.y);
    drawAnimationsToContext(context,region);
    drawWidgetsToContext(context,region);
    drawImagesToContext(context,region,false);
    for (const item of state.textBoxes) if (intersection(textBoxBox(item),region)) context.drawImage(item.image,item.x,item.y,item.w,item.h);
    forTiles(region.x,region.y,region.w,region.h,(tileCanvas,tx,ty)=>context.drawImage(tileCanvas,tx*TILE,ty*TILE),false);
    drawSharpOverlays(context,region);
    context.restore();
    const coordinates=["metadata","none"].includes(args.coordinates) ? args.coordinates : "grid", gridStep=coordinates === "grid" ? canvasAgentDrawCoordinateGrid(context,region,width,height) : canvasAgentGridStep(Math.max(region.w,region.h)),
      encoded=await canvasAgentCompressedCanvas(canvas,policy);
    assertCurrent?.();
    const dataUrl=await canvasAgentReadDataUrl(encoded.blob);
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
      if(!canvasAgentDigestHasContent(before))return {digest:before,empty:true};
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
    const raw=String(value), lines=raw.split(/\r\n|\r|\n/), start=Math.max(1,Math.min(lines.length||1,Math.round(Number(args.startLine)||1))), end=Math.max(start,Math.min(lines.length,Math.round(Number(args.endLine)||start+199))), selected=lines.slice(start-1,end).join("\n"), numbered=canvasAgentLineNumberedResourceView(selected,start), maximum=200000, contentTruncated=numbered.length>maximum, terminalBoundary=canvasAgentTerminalBoundary(raw,lines,end);
    return {
      revision:state.userRevision,
      object:base,
      resource,
      contentHash:await canvasAgentHash(raw),
      lineRange:{start,end,total:lines.length,truncated:end<lines.length||contentTruncated},
      content:numbered.slice(0,maximum),
      contentFormat:"nl -ba -w6 -s TAB",
      numbering:"The six-column line number and first ASCII TAB are display metadata. Use the number only for diff coordinates; never include either in context, removed, or added lines.",
      originalEndsWithNewline:/(?:\r\n|\r|\n)$/.test(raw),
      ...(terminalBoundary?{terminalBoundary}:{}),
    };
  }
  function canvasAgentMutationIdle(execution) {
    canvasAgentAssertToolExecution(execution);
    if (state.drawing || state.pending || state.pendingWidget || state.pendingWidgetReplacement || state.selection || state.selectionGesture
      || state.imageEdit || state.imageGesture || state.imageImporting || state.widgetEdit || state.widgetGesture || state.animationEdit || state.animationGesture || state.textEditors.size) {
      throw canvasAgentToolError("CANVAS_BUSY","Finish the active canvas edit or draft before Agent changes the canvas.");
    }
  }
  function canvasAgentFinite(value,name) {
    const number = Number(value);
    if (!Number.isFinite(number)) throw canvasAgentToolError("INVALID_ARGUMENT",`${name} must be a finite number.`);
    return number;
  }
  function canvasAgentPlacementBox(width,height,placement,reserved=[]) {
    const visible=viewportRect() || {x:SIZE/2-800,y:SIZE/2-600,w:1600,h:1200}, gap=Math.max(24,Math.min(400,Number(placement?.gap)||Math.max(40,24/state.scale))),
      nonObjectBounds=[visibleInkBounds({x:0,y:0,w:SIZE,h:SIZE}),animationBounds()].filter(Boolean),
      w=Math.max(1,Math.min(SIZE,width)),h=Math.max(1,Math.min(SIZE,height)), occupied=[...canvasAgentAllObjects().map(item=>canvasAgentInternalRect(item.box)),...nonObjectBounds,...reserved],
      clamp=(candidate)=>({x:Math.max(0,Math.min(SIZE-w,candidate.x)),y:Math.max(0,Math.min(SIZE-h,candidate.y)),w,h}),
      clear=(candidate)=>!occupied.some(box=>intersection({x:candidate.x-gap,y:candidate.y-gap,w:candidate.w+gap*2,h:candidate.h+gap*2},box));
    if(!canvasAgentPanel.hidden){const panel=canvasAgentPanel.getBoundingClientRect(),viewRect=view.getBoundingClientRect(),panelLogical={x:(panel.left-viewRect.left-state.panX)/state.scale,y:(panel.top-viewRect.top-state.panY)/state.scale,w:panel.width/state.scale,h:panel.height/state.scale},blocked=intersection(panelLogical,visible);if(blocked)occupied.push(blocked);}
    if (placement?.mode === "absolute") return {...clamp({x:canvasAgentFinite(placement.x,"placement.x"),y:canvasAgentFinite(placement.y,"placement.y")}),placement:"absolute",crowded:false};
    if (placement?.mode === "relative") {
      const anchor=canvasAgentObject(String(placement.anchorObjectId || ""));
      if (!anchor) throw canvasAgentToolError("ANCHOR_NOT_FOUND","Relative placement anchor was not found.",{anchorObjectId:placement.anchorObjectId});
      const box=canvasAgentBox(anchor), relation=["left","above","below"].includes(placement.relation)?placement.relation:"right", align=["start","end"].includes(placement.align)?placement.align:"center";
      let x=relation === "right" ? box.x+box.w+gap : relation === "left" ? box.x-w-gap : align === "start" ? box.x : align === "end" ? box.x+box.w-w : box.x+(box.w-w)/2,
        y=relation === "below" ? box.y+box.h+gap : relation === "above" ? box.y-h-gap : align === "start" ? box.y : align === "end" ? box.y+box.h-h : box.y+(box.h-h)/2,
        candidate=clamp({x,y});
      if (clear(candidate)) return {...candidate,placement:`relative:${relation}`,crowded:false};
    }
    const stage={x:Math.max(0,visible.x),y:Math.max(0,visible.y),w:Math.min(SIZE-visible.x,visible.w),h:Math.min(SIZE-visible.y,visible.h)}, candidates=[],seen=new Set(),add=(x,y)=>{const candidate=clamp({x,y}),key=`${Math.round(candidate.x)}:${Math.round(candidate.y)}`;if(candidate.x<stage.x||candidate.y<stage.y||candidate.x+w>stage.x+stage.w||candidate.y+h>stage.y+stage.h||seen.has(key))return;seen.add(key);candidates.push(candidate);};
    add(stage.x,stage.y);add(stage.x+stage.w-w,stage.y);add(stage.x,stage.y+stage.h-h);add(stage.x+stage.w-w,stage.y+stage.h-h);add(stage.x+(stage.w-w)/2,stage.y+(stage.h-h)/2);
    for(const box of occupied){add(box.x+box.w+gap,box.y);add(box.x-w-gap,box.y);add(box.x,box.y+box.h+gap);add(box.x,box.y-h-gap);add(box.x+box.w+gap,box.y+(box.h-h)/2);add(box.x+(box.w-w)/2,box.y+box.h+gap);}
    candidates.sort((a,b)=>a.y-b.y||a.x-b.x);
    for(const candidate of candidates)if(clear(candidate))return {...candidate,placement:"auto",crowded:false};
    const xs=[stage.x,stage.x+stage.w-w,...occupied.flatMap(box=>[box.x+box.w+gap,box.x-w-gap])].filter(x=>x>=stage.x&&x+w<=stage.x+stage.w).sort((a,b)=>a-b).slice(0,96),
      ys=[stage.y,stage.y+stage.h-h,...occupied.flatMap(box=>[box.y+box.h+gap,box.y-h-gap])].filter(y=>y>=stage.y&&y+h<=stage.y+stage.h).sort((a,b)=>a-b).slice(0,96);
    for(const y of ys)for(const x of xs){const candidate=clamp({x,y});if(clear(candidate))return {...candidate,placement:"auto",crowded:false};}
    const canvasCandidates=[],canvasSeen=new Set(),addCanvas=(x,y)=>{const candidate=clamp({x,y}),key=`${Math.round(candidate.x)}:${Math.round(candidate.y)}`;if(canvasSeen.has(key))return;canvasSeen.add(key);canvasCandidates.push(candidate);},content=canvasAgentContentBounds(),center={x:visible.x+visible.w/2,y:visible.y+visible.h/2};
    addCanvas(center.x-w/2,center.y-h/2);addCanvas(0,0);addCanvas(SIZE-w,0);addCanvas(0,SIZE-h);addCanvas(SIZE-w,SIZE-h);
    for(const box of [...(content?[content]:[]),...occupied]){
      for(const alignX of [box.x,box.x+(box.w-w)/2,box.x+box.w-w]){addCanvas(alignX,box.y-h-gap);addCanvas(alignX,box.y+box.h+gap);}
      for(const alignY of [box.y,box.y+(box.h-h)/2,box.y+box.h-h]){addCanvas(box.x-w-gap,alignY);addCanvas(box.x+box.w+gap,alignY);}
    }
    const fullXs=[0,SIZE-w,center.x-w/2,...occupied.flatMap(box=>[box.x-w-gap,box.x+box.w+gap])].map(x=>clamp({x,y:0}).x).filter((x,index,array)=>array.indexOf(x)===index).slice(0,128),
      fullYs=[0,SIZE-h,center.y-h/2,...occupied.flatMap(box=>[box.y-h-gap,box.y+box.h+gap])].map(y=>clamp({x:0,y}).y).filter((y,index,array)=>array.indexOf(y)===index).slice(0,128);
    for(const y of fullYs)for(const x of fullXs)addCanvas(x,y);
    canvasCandidates.sort((a,b)=>Math.hypot(a.x+a.w/2-center.x,a.y+a.h/2-center.y)-Math.hypot(b.x+b.w/2-center.x,b.y+b.h/2-center.y)||a.y-b.y||a.x-b.x);
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
  function canvasAgentRecordChange(changeId,historyEntry) {
    canvasAgent.latestChange=historyEntry ? {changeId:String(changeId || ""),revision:state.userRevision,historyEntry} : null;
  }
  function canvasAgentWidgetPluginAllowed(pluginId,widgetType) {
    if(widgetType==="diagram_source")return pluginId==="flowchart"&&pluginEnabled("flowchart")&&pluginManifests.has("flowchart");
    const definition=PLUGIN_DEFINITIONS.find(plugin=>plugin.id===pluginId),canvasAgentPlugin=pluginId==="general"||pluginId==="flowchart"||definition?.builtIn===false;
    return canvasAgentPlugin&&pluginEnabled(pluginId)&&pluginManifests.has(pluginId);
  }
  async function canvasAgentPrepareCreateItems(items) {
    if (!Array.isArray(items)||!items.length||items.length>24) throw canvasAgentToolError("INVALID_BATCH","Provide between 1 and 24 create items.");
    const requested={widget:items.filter(item=>item?.type === "widget").length,text:items.filter(item=>item?.type === "text").length,image:items.filter(item=>item?.type === "image").length};
    if(state.widgets.length+requested.widget>MAX_VISIBLE_WIDGETS||state.textBoxes.length+requested.text>MAX_VISIBLE_TEXT_BOXES||state.images.length+requested.image>MAX_VISIBLE_IMAGES)throw canvasAgentToolError("OBJECT_LIMIT","This transaction would exceed a visible canvas object limit.",{requested});
    if (!state.pluginCatalogLoaded) await loadPluginDocuments();
    const visible=viewportRect() || {x:SIZE/2-800,y:SIZE/2-600,w:1600,h:1200}, prepared=[],reserved=[];
    for (const raw of items) {
      const type=String(raw?.type || "");
      if (type === "text") {
        const fontSize=Number.isFinite(Number(raw.fontSize))?Number(raw.fontSize):38,maxWidth=Number.isFinite(Number(raw.maxWidth))?Number(raw.maxWidth):Math.max(fontSize*3,Math.min(900,visible.w*.65));
        const record=await renderedTextBoxRecord({text:String(raw.text||""),x:0,y:0,fontSize,maxWidth,color:typeof raw.color === "string"?raw.color:state.inkColor});
        if(!record)throw canvasAgentToolError("INVALID_TEXT","Text content or geometry was rejected.");
        const placed=canvasAgentPlacementBox(record.w,record.h,raw.placement,reserved);record.x=Math.round(placed.x);record.y=Math.round(placed.y);reserved.push(canvasAgentBox({kind:"text",item:record}));prepared.push({type,kind:"text",record,placed});
      } else if (type === "widget") {
        const widgetType=String(raw.widgetType||"");
        if(!["html_widget","diagram_source"].includes(widgetType))throw canvasAgentToolError("CAPABILITY_UNAVAILABLE",`Widget type ${widgetType||"(missing)"} is unavailable to PenEcho Agent.`);
        const pluginId=String(raw.pluginId || (widgetType === "diagram_source"?"flowchart":"general")),frameworkVersion=String(raw.frameworkVersion||"").trim();
        if(widgetType === "diagram_source"||pluginId === "flowchart"||frameworkVersion.startsWith("penecho-professional-diagrams"))throw canvasAgentToolError("CAPABILITY_UNAVAILABLE","PenEcho Agent may edit an existing Professional Diagram, but it cannot create a new Professional Diagram.");
        if(!canvasAgentWidgetPluginAllowed(pluginId,widgetType))throw canvasAgentToolError("CAPABILITY_UNAVAILABLE",`Plugin ${pluginId} is unavailable, disabled, or not available to PenEcho Agent.`);
        const width=Math.max(300,Math.min(SIZE,Number(raw.width)||Math.max(600,Math.min(1200,visible.w*.7)))),height=Math.max(200,Math.min(SIZE,Number(raw.height)||Math.max(400,Math.min(800,visible.h*.7)))),placed=canvasAgentPlacementBox(width,height,raw.placement,reserved),
          record=widgetRecord({tool:widgetType,widgetType,pluginId,x:placed.x,y:placed.y,w:width,h:height,contentW:width,contentH:height,title:String(raw.title||"Canvas widget"),refreshSeconds:Number.isFinite(Number(raw.refreshSeconds))?Number(raw.refreshSeconds):0,html:typeof raw.html === "string"?raw.html:"",source:typeof raw.source === "string"?raw.source:"",sourceFormat:raw.sourceFormat,diagramKind:raw.diagramKind,frameworkVersion:raw.frameworkVersion,copyText:raw.copyText,copyLabel:raw.copyLabel});
        if(!record)throw canvasAgentToolError("INVALID_WIDGET","Widget content or geometry was rejected. Read the plugin capability contract and retry.");
        reserved.push(canvasAgentBox({kind:"widget",item:record}));prepared.push({type,kind:"widget",record,placed});
      } else if (type === "image") {
        const match=/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(String(raw._imageDataUrl||""));
        if(!match)throw canvasAgentToolError("ATTACHMENT_UNAVAILABLE","Image attachment bytes were not provided by the trusted host.");
        const bytes=Uint8Array.from(atob(match[2]),character=>character.charCodeAt(0)), imported=await prepareImportedImage(new File([bytes],String(raw._imageName||"image"),{type:match[1]})), naturalRatio=imported.naturalW/imported.naturalH;
        let width=Number(raw.width),height=Number(raw.height);
        if(!Number.isFinite(width)&&!Number.isFinite(height)){const fit=importedImagePlacement(imported.naturalW,imported.naturalH);width=fit.w;height=fit.h;}
        else if(!Number.isFinite(width))width=height*naturalRatio;else if(!Number.isFinite(height))height=width/naturalRatio;
        width=Math.max(80,Math.min(SIZE,width));height=Math.max(80,Math.min(SIZE,height));const placed=canvasAgentPlacementBox(width,height,raw.placement,reserved),record=imageRecord({...imported,x:placed.x,y:placed.y,w:width,h:height,sourceName:String(raw._imageName||"")});
        if(!record)throw canvasAgentToolError("INVALID_IMAGE","Image content or geometry was rejected.");
        reserved.push(canvasAgentBox({kind:"image",item:record}));prepared.push({type,kind:"image",record,placed});
      } else if (["formula","plot","drawing"].includes(type)) {
        let image,x=0,y=0;
        if(type === "formula")image=await formulaImage(String(raw.latex||""),Number(raw.fontSize)||64,typeof raw.color === "string"?raw.color:state.inkColor);
        else if(type === "plot")image=plot({expression:String(raw.expression||""),w:Math.max(240,Math.min(2400,Number(raw.width)||900)),h:Math.max(200,Math.min(1800,Number(raw.height)||650)),color:typeof raw.color === "string"?raw.color:state.inkColor,title:String(raw.title||raw.expression||"")});
        else {const normalized=DRAW?.normalize({...raw.drawing,tool:"draw"},SIZE),made=normalized?DRAW.render(normalized,offscreen,typeof raw.color === "string"?raw.color:state.inkColor):null;if(made){image=made.image;x=made.x;y=made.y;}}
        if(!image)throw canvasAgentToolError("INVALID_INK_CONTENT",`${type} could not be rendered.`);
        const width=image.logicalWidth||image.width,height=image.logicalHeight||image.height,placed=raw.placement?canvasAgentPlacementBox(width,height,raw.placement,reserved):canvasAgentPlacementBox(width,height,{mode:"absolute",x,y},reserved);
        reserved.push({x:placed.x,y:placed.y,w:width,h:height});prepared.push({type,kind:"ink",image,x:placed.x,y:placed.y,w:width,h:height,placed});
      } else throw canvasAgentToolError("UNSUPPORTED_CREATE_TYPE",`Unsupported create type: ${type || "(missing type)"}.`);
    }
    return prepared;
  }
  async function canvasAgentCreate(args,execution) {
    canvasAgentAssertRevision(args.baseRevision);canvasAgentMutationIdle(execution);const prepared=await canvasAgentPrepareCreateItems(args.items);canvasAgentAssertRevision(args.baseRevision);canvasAgentAssertToolExecution(execution);save();
    const kinds=new Set(prepared.map(item=>item.kind));if(kinds.has("widget"))state.widgetHistoryBefore=serializedWidgets();if(kinds.has("text"))state.textBoxHistoryBefore=textBoxHistoryState();if(kinds.has("image"))state.imageHistoryBefore=imageHistoryState();
    const receipts=[];
    for(const item of prepared){
      if(item.kind === "widget"){state.widgets.push(item.record);mountWidget(item.record);receipts.push({type:item.type,status:"created",objectId:item.record.id,box:canvasAgentExternalRect(canvasAgentBox({kind:"widget",item:item.record})),placement:item.placed.placement,crowded:item.placed.crowded,offViewport:Boolean(item.placed.offViewport)});}
      else if(item.kind === "text"){state.textBoxes.push(item.record);receipts.push({type:item.type,status:"created",objectId:item.record.id,box:canvasAgentExternalRect(canvasAgentBox({kind:"text",item:item.record})),placement:item.placed.placement,crowded:item.placed.crowded,offViewport:Boolean(item.placed.offViewport)});}
      else if(item.kind === "image"){state.images.push(item.record);receipts.push({type:item.type,status:"created",objectId:item.record.id,box:canvasAgentExternalRect(canvasAgentBox({kind:"image",item:item.record})),placement:item.placed.placement,crowded:item.placed.crowded,offViewport:Boolean(item.placed.offViewport)});}
      else {blitSized(item.image,item.x,item.y,item.w,item.h);receipts.push({type:item.type,status:"created",region:{x:item.x,y:item.y,width:item.w,height:item.h},placement:item.placed.placement,crowded:item.placed.crowded,offViewport:Boolean(item.placed.offViewport)});}
    }
    state.userRevision++;const entry=save(),changeId=String(args._changeId||canvasClientId());canvasAgentRecordChange(changeId,entry);
    const singleWidget=prepared.length===1&&prepared[0].kind==="widget"?prepared[0]:null,viewResult=singleWidget?canvasAgentFrameRegion(canvasAgentBox({kind:"widget",item:singleWidget.record}),48):null;
    if(!viewResult){requestRender();canvasAgentSyncState();}
    return{ok:true,previousRevision:args.baseRevision,revision:state.userRevision,changeId,receipts,...(viewResult?{viewport:viewResult.viewport}:{}),summary:String(args.summary||"")};
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
        if(object.kind !== "widget")throw canvasAgentToolError("KIND_MISMATCH","resize_widget requires a widget.");const dimension=raw.dimension === "height"?"height":"width",value=canvasAgentFinite(raw.value,"value"),minimum=dimension === "width"?300:200,box=canvasAgentBox(object),contentRatio=dimension === "width"?object.item.contentW/object.item.w:object.item.contentH/object.item.h,contentMinimum=dimension === "width"?300:200;if(value<minimum||value*contentRatio<contentMinimum||(dimension === "width"?box.x+value:box.y+value)>SIZE)throw canvasAgentToolError("INVALID_GEOMETRY","Responsive widget size cannot preserve its current typography scale at this value.");prepared.push({type,kind:"widget",object,dimension,value});
      }else if(type === "resize_image"){
        if(object.kind !== "image")throw canvasAgentToolError("KIND_MISMATCH","resize_image requires an image.");const box=canvasAgentBox(object),ratio=box.w/box.h;let w=Number(raw.width),h=Number(raw.height);if(!Number.isFinite(w)&&!Number.isFinite(h))throw canvasAgentToolError("INVALID_ARGUMENT","resize_image requires width or height.");if(raw.preserveAspect){if(Number.isFinite(w))h=w/ratio;else w=h*ratio;}else{if(!Number.isFinite(w))w=box.w;if(!Number.isFinite(h))h=box.h;}if(w<80||h<80||box.x+w>SIZE||box.y+h>SIZE)throw canvasAgentToolError("INVALID_GEOMETRY","Image size is invalid.");prepared.push({type,kind:"image",object,w,h});
      }else if(type === "delete_object")prepared.push({type,kind:object.kind,object});
      else throw canvasAgentToolError("UNSUPPORTED_EDIT_TYPE",`Unsupported edit type: ${type||"(missing type)"}.`);
    }
    return prepared;
  }
  async function canvasAgentEdit(args,execution) {
    canvasAgentAssertRevision(args.baseRevision);canvasAgentMutationIdle(execution);const prepared=await canvasAgentPrepareEditOperations(args.operations);canvasAgentAssertRevision(args.baseRevision);canvasAgentAssertToolExecution(execution);save();
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
    state.userRevision++;const entry=save(),changeId=String(args._changeId||canvasClientId());canvasAgentRecordChange(changeId,entry);positionTextEditors();
    const resizedVisual=prepared.length===1&&prepared[0].type==="resize_widget"&&prepared[0].object.item.sourceFormat===VISUAL_EXPLAINER_SOURCE_FORMAT,
      viewResult=resizedVisual?canvasAgentFrameRegion(canvasAgentBox(prepared[0].object),48):null;
    if(!viewResult){requestRender();canvasAgentSyncState();}
    return{ok:true,previousRevision:args.baseRevision,revision:state.userRevision,changeId,receipts,...(viewResult?{viewport:viewResult.viewport}:{}),summary:String(args.summary||"")};
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
  async function canvasAgentInternalWidget(args,execution) {
    const object = canvasAgentObject(String(args.objectId || ""));
    if (!object || object.kind !== "widget") throw Error("Widget was not found.");
    const parentWidgetEdit = widgetEditContext(object.item,"agent"),hash=await canvasAgentHash(parentWidgetEdit);
    canvasAgentAssertToolExecution(execution);
    if(object.item.sourceFormat===VISUAL_EXPLAINER_SOURCE_FORMAT&&args.artifactId){
      let plan;try{plan=JSON.parse(object.item.copyText||"");}catch{throw Error("Visual Explainer source is invalid.");}
      const widgetEdit=visualExplainerArtifactWidgetEdit(plan,args.artifactId,{x:object.item.x,y:object.item.y,w:object.item.w,h:object.item.h});
      return {revision:state.userRevision,widgetEdit,hash,containerSourceFormat:VISUAL_EXPLAINER_SOURCE_FORMAT,artifactId:String(args.artifactId)};
    }
    return { revision:state.userRevision, widgetEdit:parentWidgetEdit, hash, containerSourceFormat:object.item.sourceFormat||null };
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
    canvasAgentAssertRevision(args.baseRevision);
    canvasAgentMutationIdle(execution);
    const object = canvasAgentObject(String(args.objectId || ""));
    if (!object || object.kind !== "widget") throw Error("Widget was not found.");
    const currentEdit = widgetEditContext(object.item,"agent");
    if (await canvasAgentHash(currentEdit) !== String(args.expectedHash || "")) throw Error("Widget changed after it was read. Read it again before patching.");
    canvasAgentAssertToolExecution(execution);
    const command = args.command;
    if (!command || command.pluginId !== object.item.pluginId || !["html_widget","diagram_source"].includes(command.tool)) throw Error("Patched widget command is invalid.");
    if(!canvasAgentWidgetPluginAllowed(command.pluginId,command.tool))throw Error("The Widget plugin is unavailable, disabled, or not available to PenEcho Agent.");
    const record = widgetRecord({...command,id:object.item.id,widgetType:command.tool,contentW:object.item.contentW,contentH:object.item.contentH});
    if (!record) throw Error("Patched widget content was rejected by Canvas validation.");
    save();
    state.widgetHistoryBefore = serializedWidgets();
    const contentFields = ["widgetType","pluginId","x","y","w","h","contentW","contentH","title","refreshSeconds","html","source","diagramKind","sourceFormat","frameworkVersion","copyText","copyLabel"];
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
    const entry=save(),changeId=String(args.changeId||canvasClientId());canvasAgentRecordChange(changeId,entry);
    requestRender();
    canvasAgentSyncState();
    return { ok:true, previousRevision:args.baseRevision, revision:state.userRevision, changeId, receipts:[{type:"patch_widget",status:"applied",objectId:record.id,contentHash:await canvasAgentHash(widgetEditContext(record,"agent"))}] };
  }
  function canvasAgentFramePlan(region,padding=80) {
    const rect=view.getBoundingClientRect(),width=Math.max(0,rect.width),height=Math.max(0,rect.height),full={x:0,y:0,w:width,h:height},stages=[full],panelGap=12;
    if(!canvasAgentPanel.hidden&&width>0&&height>0){
      const panel=canvasAgentPanel.getBoundingClientRect(),left=Math.max(0,panel.left-rect.left-panelGap),top=Math.max(0,panel.top-rect.top-panelGap),right=Math.min(width,panel.right-rect.left+panelGap),bottom=Math.min(height,panel.bottom-rect.top+panelGap);
      if(right>left&&bottom>top){
        const unobscured=[{x:0,y:0,w:left,h:height},{x:right,y:0,w:width-right,h:height},{x:0,y:0,w:width,h:top},{x:0,y:bottom,w:width,h:height-bottom}].filter(stage=>stage.w>0&&stage.h>0);
        if(unobscured.length)stages.splice(0,stages.length,...unobscured);
      }
    }
    const logicalPadding=Math.max(0,Math.min(2000,Number.isFinite(Number(padding))?Number(padding):80)),framedX=Math.max(0,region.x-logicalPadding),framedY=Math.max(0,region.y-logicalPadding),framedRight=Math.min(SIZE,region.x+region.w+logicalPadding),framedBottom=Math.min(SIZE,region.y+region.h+logicalPadding),framed={x:framedX,y:framedY,w:Math.max(1,framedRight-framedX),h:Math.max(1,framedBottom-framedY)},ranked=stages.map(stage=>({...stage,scale:Math.max(.03,Math.min(2,Math.min(stage.w/framed.w,stage.h/framed.h)))})).sort((a,b)=>b.scale-a.scale||b.w*b.h-a.w*a.h),stage=ranked[0]||full,scale=stage.scale||.03;
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
    const previousRevision=state.userRevision;state.userRevision++;undo();canvasAgent.latestChange=null;requestRender();canvasAgentSyncState();return{ok:true,revertedChangeId:latest.changeId,previousRevision,revision:state.userRevision};
  }
  async function canvasAgentExecuteTool(payload) {
    const name = String(payload?.name || ""), args = payload?.arguments || {};
    const cacheKey=String(payload?.callId||"");let signature="";
    const execution={
      socket:canvasAgent.socket,
      sessionId:canvasAgent.sessionId,
      generation:canvasAgent.sessionGeneration,
      controller:new AbortController(),
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
      if (name === "project_approval") result = await canvasAgentRequestApproval(args);
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
  function canvasAgentCancelPanelMotion() {
    if (canvasAgent.panelMotionFrame) cancelAnimationFrame(canvasAgent.panelMotionFrame);
    canvasAgent.panelMotionFrame = 0;
    const motion = canvasAgent.panelMotion;
    canvasAgent.panelMotion = null;
    motion?.cancel();
    canvasAgent.panelMotionProxy?.remove();
    canvasAgent.panelMotionProxy = null;
    canvasAgentPanel.classList.remove("canvas-agent-motion-target");
  }
  function canvasAgentAnimatePanel(opening,panelRect,onFinish=null) {
    const reduceMotion=window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
      triggerRect=canvasAgentToggle.getBoundingClientRect();
    if (reduceMotion || typeof Element.prototype.animate !== "function" || !panelRect?.width || !panelRect?.height || !triggerRect.width || !triggerRect.height) {
      canvasAgentPanel.classList.remove("canvas-agent-motion-target");
      onFinish?.();
      return;
    }
    const proxy=document.createElement("div"),
      deltaX=triggerRect.left-panelRect.left,
      deltaY=triggerRect.top-panelRect.top,
      scaleX=Math.max(.04,triggerRect.width/panelRect.width),
      scaleY=Math.max(.04,triggerRect.height/panelRect.height),
      compact={transform:`translate3d(${deltaX}px, ${deltaY}px, 0) scale(${scaleX}, ${scaleY})`,opacity:.28,borderRadius:"6px"},
      expanded={transform:"translate3d(0, 0, 0) scale(1, 1)",opacity:1,borderRadius:"18px"};
    proxy.className="canvas-agent-motion-proxy";
    proxy.setAttribute("aria-hidden","true");
    Object.assign(proxy.style,{left:`${panelRect.left}px`,top:`${panelRect.top}px`,width:`${panelRect.width}px`,height:`${panelRect.height}px`});
    document.body.append(proxy);
    canvasAgent.panelMotionProxy=proxy;
    let animation;
    try {
      animation=proxy.animate(opening?[compact,expanded]:[expanded,compact],{
        duration:opening?280:220,
        easing:opening?"cubic-bezier(.18,.82,.24,1)":"cubic-bezier(.4,0,.25,1)",
        fill:"forwards",
      });
    } catch {
      canvasAgent.panelMotionProxy=null;
      proxy.remove();
      canvasAgentPanel.classList.remove("canvas-agent-motion-target");
      onFinish?.();
      return;
    }
    canvasAgent.panelMotion=animation;
    animation.finished.then(()=>{
      if(canvasAgent.panelMotion!==animation)return;
      canvasAgent.panelMotion=null;
      canvasAgent.panelMotionProxy=null;
      proxy.remove();
      canvasAgentPanel.classList.remove("canvas-agent-motion-target");
      onFinish?.();
    }).catch(()=>{});
  }
  function openCanvasAgent({focus=true}={}) {
    const options=arguments[0]||{},connect=options.connect!==false,animate=options.animate!==false;
    if (!canvasAgentAvailable()) return;
    canvasAgentCancelPanelMotion();
    canvasAgentPanel.hidden = false;
    canvasAgentPanel.setAttribute("aria-hidden","false");
    canvasAgentToggle.setAttribute("aria-expanded","true");
    document.body.classList.add("canvas-agent-open");
    canvasAgentSyncTriggerState();
    if(animate){
      canvasAgentPanel.classList.add("canvas-agent-motion-target");
      canvasAgent.panelMotionFrame=requestAnimationFrame(()=>{
        canvasAgent.panelMotionFrame=0;
        canvasAgentRestorePanelSize();
        canvasAgentRestorePanelPosition();
        canvasAgentResizeInput();
        canvasAgentAnimatePanel(true,canvasAgentPanel.getBoundingClientRect(),focus?()=>
          (canvasAgent.inputMode==="ink"?canvasAgentInkCanvas:canvasAgentInput).focus():null);
      });
    }else{
      canvasAgentRestorePanelSize();
      canvasAgentRestorePanelPosition();
      canvasAgentResizeInput();
      if(focus)(canvasAgent.inputMode==="ink"?canvasAgentInkCanvas:canvasAgentInput).focus();
    }
    if(connect){
      canvasAgentSyncState();
      void canvasAgentConnect().catch(error=>canvasAgentSetStatus(String(error?.message||error),"error"));
    }else canvasAgentSyncSelection();
  }
  function closeCanvasAgent(options) {
    const focus=options?.focus!==false,animate=options?.animate!==false;
    canvasAgentCancelPanelMotion();
    const panelRect=canvasAgentPanel.hidden?null:canvasAgentPanel.getBoundingClientRect();
    const dragPointerId = canvasAgent.panelDrag?.pointerId;
    const resize = canvasAgent.panelResize;
    canvasAgent.panelDrag = null;
    canvasAgent.panelResize = null;
    canvasAgentPanel.classList.remove("dragging","resizing","resizing-top","resizing-bottom","resizing-left","resizing-right");
    if (dragPointerId !== undefined && canvasAgentHead.hasPointerCapture?.(dragPointerId)) canvasAgentHead.releasePointerCapture(dragPointerId);
    if (resize?.handle.hasPointerCapture?.(resize.pointerId)) resize.handle.releasePointerCapture(resize.pointerId);
    canvasAgentPanel.hidden = true;
    canvasAgentPanel.setAttribute("aria-hidden","true");
    canvasAgentToggle.setAttribute("aria-expanded","false");
    document.body.classList.remove("canvas-agent-open");
    canvasAgentSyncTriggerState();
    canvasAgentHideHistoryPopover();
    canvasAgentHideProjectPopover();
    canvasAgentToggleReferencePicker(false);
    canvasAgentPersistCurrentConversation();
    if(focus)canvasAgentToggle.focus();
    if(animate)canvasAgentAnimatePanel(false,panelRect);
  }
  canvasAgentToggle.hidden = !canvasAgentAvailable();
  canvasAgentToggle.addEventListener("click",()=>canvasAgentPanel.hidden ? openCanvasAgent() : closeCanvasAgent());
  canvasAgentClose.addEventListener("click",closeCanvasAgent);
  canvasAgentProjectButton.addEventListener("click",()=>{
    if(canvasAgentProjectDialogOpen()){canvasAgentHideProjectPopover({restoreFocus:true});return;}
    canvasAgentHideHistoryPopover();
    canvasAgentRenderProjects();
    canvasAgentShowProjectPopover();
    void canvasAgentEnsureProjects({refresh:true}).catch(error=>canvasAgentSetProjectError(String(error?.message||error)));
  });
  canvasAgentProjectClear.addEventListener("click",event=>{
    event.preventDefault();event.stopPropagation();
    if(canvasAgent.projectId)void canvasAgentSelectProject("");
  });
  canvasAgentProjectClose.addEventListener("click",()=>canvasAgentHideProjectPopover({restoreFocus:true}));
  canvasAgentProjectCreate.addEventListener("click",()=>canvasAgentToggleProjectRootChooser());
  canvasAgentProjectRootBack.addEventListener("click",()=>void canvasAgentNavigateProjectRootBack());
  canvasAgentProjectRootSelect.addEventListener("click",()=>void canvasAgentSelectProjectRoot());
  canvasAgentProjectRootApprovalReject.addEventListener("click",()=>canvasAgentResolveProjectRootApproval(false));
  canvasAgentProjectRootApprovalAllow.addEventListener("click",()=>canvasAgentResolveProjectRootApproval(true));
  canvasAgentProjectPopover.addEventListener("cancel",event=>{event.preventDefault();canvasAgentHideProjectPopover({restoreFocus:true});});
  canvasAgentProjectPopover.addEventListener("click",event=>{
    if(event.target!==canvasAgentProjectPopover)return;
    const bounds=canvasAgentProjectPopover.getBoundingClientRect();
    if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom)canvasAgentHideProjectPopover({restoreFocus:true});
  });
  canvasAgentApprovalReject.addEventListener("click",()=>canvasAgentResolveApproval(false));
  canvasAgentApprovalAllow.addEventListener("click",()=>canvasAgentResolveApproval(true));
  canvasAgentHistory.addEventListener("click",()=>{
    if (canvasAgentHistoryPopover.hidden) {
      canvasAgentPersistCurrentConversation();
      canvasAgentRenderHistoryList();
      canvasAgentHistoryPopover.hidden=false;
      canvasAgentHistory.setAttribute("aria-expanded","true");
    } else canvasAgentHideHistoryPopover();
  });
  canvasAgentHistoryReturn.addEventListener("click",canvasAgentReturnToCurrentConversation);
  document.addEventListener("keydown",event=>{
    if (event.key !== "Escape" || canvasAgentPanel.hidden) return;
    if (!canvasAgentReferencePicker.hidden) {
      event.preventDefault();
      canvasAgentToggleReferencePicker(false);
      canvasAgentReference.focus();
      return;
    }
    if (!canvasAgentHistoryPopover.hidden) {
      event.preventDefault();
      canvasAgentHideHistoryPopover();
      canvasAgentHistory.focus();
      return;
    }
    if (canvasAgentProjectDialogOpen()) {
      event.preventDefault();
      canvasAgentHideProjectPopover({restoreFocus:true});
      return;
    }
    event.preventDefault();
    closeCanvasAgent();
  });
  document.addEventListener("pointerdown",event=>{
    if (!canvasAgentHistoryPopover.hidden&&!canvasAgentHistoryPopover.contains(event.target)&&!canvasAgentHistory.contains(event.target)) canvasAgentHideHistoryPopover();
    if (canvasAgentProjectDialogOpen()&&!canvasAgentProjectPopover.contains(event.target)&&!canvasAgentProjectButton.contains(event.target)) canvasAgentHideProjectPopover();
    if (!canvasAgentReferencePicker.hidden&&!canvasAgentReferencePicker.contains(event.target)&&!canvasAgentReference.contains(event.target)) canvasAgentToggleReferencePicker(false);
    if (canvasAgent.promptSuggestionsExpanded&&!canvasAgentForm.contains(event.target)&&!canvasAgentPromptSuggestions?.contains(event.target)) canvasAgentSetPromptSuggestionsExpanded(false);
  });
  canvasAgentStop.addEventListener("click",()=>{
    canvasAgentResolveApproval(false);
    try { canvasAgentSendEnvelope("cancel",{}); } catch {}
  });
  canvasAgentAttach.addEventListener("click",()=>{
    if(canvasAgent.attachmentBusy||canvasAgent.projectUploadBusy)return;
    canvasAgentFileInput.value = "";
    canvasAgentFileInput.click();
  });
  canvasAgentReference.addEventListener("click",()=>canvasAgentToggleReferencePicker());
  canvasAgentReferenceSearch.addEventListener("input",()=>canvasAgentRenderReferencePicker(canvasAgentReferenceSearch.value));
  canvasAgentWidgetPickerLayer.addEventListener("pointermove",event=>{
    if (!canvasAgent.referencePickActive) return;
    event.preventDefault();
    event.stopPropagation();
    const widget=canvasAgentWidgetFromPickEvent(event), hoverId=widget?.id||"";
    if (hoverId===canvasAgent.referenceHoverId) return;
    canvasAgent.referenceHoverId=hoverId;
    canvasAgentDrawWidgetPick(widget);
  });
  canvasAgentWidgetPickerLayer.addEventListener("pointerdown",event=>{
    if (!canvasAgent.referencePickActive) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.pointerType==="mouse"&&event.button!==0) return;
    const widget=canvasAgentWidgetFromPickEvent(event);
    if (!widget) {
      canvasAgentReferenceNote.textContent=t("canvasAgentReferencePickMiss");
      return;
    }
    if (!canvasAgentToggleReference(widget.id,true)) return;
    canvasAgentToggleReferencePicker(false);
    (canvasAgent.inputMode==="ink"?canvasAgentInkCanvas:canvasAgentInput).focus();
  });
  canvasAgentWidgetPickerLayer.addEventListener("pointerleave",()=>{
    canvasAgent.referenceHoverId="";
    canvasAgentDrawWidgetPick();
  });
  canvasAgentWidgetPickerLayer.addEventListener("pointercancel",()=>{
    canvasAgent.referenceHoverId="";
    canvasAgentDrawWidgetPick();
  });
  canvasAgentWidgetPickerLayer.addEventListener("wheel",event=>{
    if (!canvasAgent.referencePickActive) return;
    event.preventDefault();
    event.stopPropagation();
  },{passive:false});
  canvasAgentTextMode.addEventListener("click",()=>canvasAgentSetInputMode("text"));
  canvasAgentInkMode.addEventListener("click",()=>canvasAgentSetInputMode("ink"));
  canvasAgentPromptSuggestions?.addEventListener("pointerdown",canvasAgentPreventPromptSuggestionFocusLoss);
  canvasAgentPromptSuggestions?.addEventListener("pointerenter",canvasAgentExpandPromptSuggestionsOnPointerEnter);
  canvasAgentPromptSuggestions?.addEventListener("pointerleave",canvasAgentCollapsePromptSuggestionsOnPointerLeave);
  canvasAgentPromptSuggestions?.addEventListener("focusin",canvasAgentExpandPromptSuggestionsOnPointerEnter);
  canvasAgentPromptSuggestions?.addEventListener("focusout",()=>queueMicrotask(canvasAgentSyncPromptSuggestionsFocus));
  canvasAgentPromptToggle?.addEventListener("click",canvasAgentTogglePromptSuggestions);
  canvasAgentClearInkButton.addEventListener("click",()=>canvasAgentClearInkDraft());
  canvasAgentInkCanvas.addEventListener("pointerdown",canvasAgentInkPointerDown);
  canvasAgentInkCanvas.addEventListener("pointermove",canvasAgentInkPointerMove);
  canvasAgentInkCanvas.addEventListener("pointerup",canvasAgentInkPointerEnd);
  canvasAgentInkCanvas.addEventListener("pointercancel",canvasAgentInkPointerEnd);
  canvasAgentSearch.addEventListener("click",async()=>{
    if (!canvasAgent.searchConfigured) {
      openConfiguration("search",canvasAgentSearch);
      return;
    }
    canvasAgent.searchEnabled = !canvasAgent.searchEnabled;
    localStorage.setItem(CANVAS_AGENT_SEARCH_ENABLED_KEY,String(canvasAgent.searchEnabled));
    canvasAgentUpdateSearchButton();
    try { await canvasAgentEnsureSearchSession(); }
    catch (error) { canvasAgentSetStatus(String(error?.message||error),"error"); }
  });
  canvasAgentFileInput.addEventListener("change",()=>void canvasAgentHandleFiles(canvasAgentFileInput.files));
  canvasAgentNew.addEventListener("click",async()=>{
    try {
      await canvasAgentStartNewConversation(selectedAiConnectionId());
    } catch (error) { canvasAgentSetStatus(String(error?.message||error),"error"); }
  });
  async function canvasAgentSubmitMessage(options) {
    const textOverride=options?.textOverride===undefined?null:options.textOverride,displayTextOverride=options?.displayTextOverride===undefined?null:options.displayTextOverride,includeDraftMedia=options?.includeDraftMedia!==false,clearInput=options?.clearInput!==false;
    if (canvasAgent.attachmentBusy) {
      canvasAgentSetStatus(t("canvasAgentImagePreparing"),"connecting");
      return false;
    }
    const text = textOverride===null?canvasAgentInput.value.trim():String(textOverride||"").trim(), attachments = includeDraftMedia?[...canvasAgent.attachments]:[], fileAttachments=attachments.filter(attachment=>attachment.kind==="file"), imageAttachments=attachments.filter(attachment=>attachment.kind!=="file"), hasInk=includeDraftMedia&&canvasAgent.inkPresent;
    if (!text && !attachments.length&&!hasInk) return false;
    if(fileAttachments.length&&!text){canvasAgentSetStatus(t("canvasAgentFileInstructionRequired"),"error");return false;}
    if (hasInk&&attachments.length>=CANVAS_AGENT_MAX_ATTACHMENTS) {
      canvasAgentSetStatus(t("canvasAgentInkImageLimit"),"error");
      return false;
    }
    let requestSent = false;
    let focusComposerAfterSubmit=true;
    canvasAgentInput.disabled = true;
    canvasAgentInkCanvas.setAttribute("aria-disabled","true");
    canvasAgentSend.disabled = true;
    canvasAgentAttach.disabled = true;
    canvasAgentReference.disabled = true;
    const submitExecution=canvasAgentBeginSubmitExecution(selectedAiConnectionId());
    try {
      canvasAgentBeginRequest();
      const inkAttachment=hasInk?await canvasAgentPrepareInkAttachment():null, outgoingAttachments=inkAttachment?[...imageAttachments,inkAttachment]:imageAttachments,displayAttachments=inkAttachment?[...attachments,inkAttachment]:attachments;
      canvasAgentAssertSubmitExecution(submitExecution);
      const prompt=inkAttachment
        ? [text,t("canvasAgentInkPrompt")].filter(Boolean).join("\n\n")
        : text||t("canvasAgentImagePrompt"), displayText=displayTextOverride===null?(text||(inkAttachment?t("canvasAgentInkOnly"):t("canvasAgentImageOnly"))):String(displayTextOverride);
      await canvasAgentConnect({submitExecution});
      canvasAgentAssertSubmitExecution(submitExecution);
      await canvasAgentEnsureSearchSession(submitExecution);
      canvasAgentBindSubmitExecution(submitExecution);
      canvasAgentSetStatus(t("canvasAgentInitialStatePreparing"),"connecting");
      const initialState=await canvasAgentInitialTurnState(submitExecution);
      canvasAgentAssertSubmitExecution(submitExecution);
      canvasAgentSyncState();
      canvasAgentAssertSubmitExecution(submitExecution);
      canvasAgentRow("user",displayText,displayAttachments);
      canvasAgentAssertSubmitExecution(submitExecution);
      canvasAgentSendRequest(canvasAgent.running ? "steer" : "user_turn",{text:prompt,references:canvasAgentTurnReferences(),images:outgoingAttachments.map(attachment=>attachment.wire),fileIds:fileAttachments.map(attachment=>attachment.projectId),initialState,webSearchEnabled:canvasAgent.searchEnabled});
      requestSent = true;
      focusComposerAfterSubmit=!hasInk;
      if(clearInput){canvasAgentInput.value = "";canvasAgentResizeInput();}
      if(includeDraftMedia){canvasAgentClearAttachments();canvasAgentClearInkDraft();canvasAgentClearReferences();}
      canvasAgentSetInputMode("text",focusComposerAfterSubmit);
      return true;
    } catch (error) {
      const current=canvasAgentSubmitExecutionCurrent(submitExecution);
      if (!requestSent&&current) canvasAgentRequestDidNotSend();
      if(current)canvasAgentSetStatus(String(error?.message||error),"error");
      return false;
    }
    finally {
      const ownsComposer=canvasAgent.activeSubmitExecution===submitExecution||!canvasAgent.activeSubmitExecution;
      if(canvasAgent.activeSubmitExecution===submitExecution)canvasAgent.activeSubmitExecution=null;
      if(ownsComposer){
        canvasAgentInput.disabled=false;
        canvasAgentInkCanvas.removeAttribute("aria-disabled");
        canvasAgentSend.disabled=false;
        canvasAgentAttach.disabled=false;
        canvasAgentReference.disabled=false;
        if(focusComposerAfterSubmit)(canvasAgent.inputMode==="ink"?canvasAgentInkCanvas:canvasAgentInput).focus();
      }
    }
  }
  canvasAgentForm.addEventListener("submit",event=>{
    event.preventDefault();
    if(canvasAgent.projectUploadBusy){canvasAgentSetStatus(t("canvasAgentFilePreparing"),"connecting");return;}
    void canvasAgentSubmitMessage();
  });
  canvasAgentInput.addEventListener("input",()=>{canvasAgentResizeInput();canvasAgentSyncInputHint();if(canvasAgentPromptHasDraft())canvasAgentSetPromptSuggestionsExpanded(false);canvasAgentSyncPromptSuggestions();});
  canvasAgentInput.addEventListener("keydown",event=>{
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      canvasAgentForm.requestSubmit();
    }
  });
  canvasAgentHead.addEventListener("pointerdown",canvasAgentBeginPanelDrag);
  canvasAgentHead.addEventListener("pointermove",canvasAgentMovePanel);
  canvasAgentHead.addEventListener("pointerup",canvasAgentFinishPanelDrag);
  canvasAgentHead.addEventListener("pointercancel",canvasAgentFinishPanelDrag);
  for (const handle of [canvasAgentResizeTop,canvasAgentResizeBottom,canvasAgentResizeLeft,canvasAgentResizeRight]) {
    handle.addEventListener("pointerdown",canvasAgentBeginPanelResize);
    handle.addEventListener("pointermove",canvasAgentMovePanelResize);
    handle.addEventListener("pointerup",canvasAgentFinishPanelResize);
    handle.addEventListener("pointercancel",canvasAgentFinishPanelResize);
    handle.addEventListener("keydown",canvasAgentKeyboardPanelResize);
  }
  canvasAgentPanel.addEventListener("dragover",event=>{
    if ([...(event.dataTransfer?.items || [])].some(item=>item.kind === "file")) event.preventDefault();
  });
  canvasAgentPanel.addEventListener("drop",event=>{
    const files = [...(event.dataTransfer?.files || [])];
    if (!files.length) return;
    event.preventDefault();
    void canvasAgentHandleFiles(files);
  });
  for (const type of ["pointerdown","pointermove","pointerup","pointercancel","wheel"]) canvasAgentPanel.addEventListener(type,event=>event.stopPropagation(),{passive:type === "wheel"});
  canvasAgentPanel.addEventListener("click",canvasAgentCollapsePromptSuggestionsFromPanel);
  canvasAgentForm.addEventListener("focusin",canvasAgentSyncPromptSuggestions);
  canvasAgentForm.addEventListener("focusout",()=>queueMicrotask(canvasAgentSyncPromptSuggestionsFocus));
  canvasAgentPanel.addEventListener("focusin",canvasAgentPauseAutomaticAI);
  canvasAgentPanel.addEventListener("focusout",()=>queueMicrotask(canvasAgentResumeAutomaticAI));
  canvasAgentTranscript.addEventListener("scroll",canvasAgentSyncFollowLatest,{passive:true});
  canvasAgentTranscript.addEventListener("wheel",event=>{
    if (event.deltaY < 0) canvasAgent.followLatest = false;
  },{passive:true});
  document.addEventListener("paste",event=>{
    if (canvasAgentPanel.hidden||canvasAgentProjectDialogOpen()) return;
    const target = event.target, outsideEditable = target instanceof Element && !canvasAgentPanel.contains(target) && (target.isContentEditable || Boolean(target.closest("input, textarea, select")));
    if (outsideEditable) return;
    const files=canvasAgentClipboardFiles(event.clipboardData);
    let hasDesktopFile=false;
    if(!files.length&&typeof window.penechoDesktop?.hasClipboardFile==="function")try{hasDesktopFile=window.penechoDesktop.hasClipboardFile()===true;}catch{}
    if (!files.length&&!hasDesktopFile) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if(files.length)void canvasAgentHandleFiles(files);
    else void canvasAgentDesktopClipboardFiles().then(desktopFiles=>desktopFiles.length?canvasAgentHandleFiles(desktopFiles):canvasAgentSetStatus(t("canvasAgentFileReadFailed"),"error")).catch(error=>canvasAgentSetStatus(String(error?.message||error),"error"));
  },true);
  if (typeof ResizeObserver==="function") new ResizeObserver(()=>{canvasAgentSchedulePanelSizeSave();canvasAgentResizeInput();}).observe(canvasAgentPanel);
  canvasAgentResizeInput();
  window.addEventListener("resize",()=>requestAnimationFrame(()=>{canvasAgentRestorePanelSize();canvasAgentRestorePanelPosition();}),{passive:true});
  window.addEventListener("beforeunload",canvasAgentPersistCurrentConversation);
  canvasAgentUpdateSearchButton();
  canvasAgentRenderProjects();
  canvasAgentCanvasDidChange();
