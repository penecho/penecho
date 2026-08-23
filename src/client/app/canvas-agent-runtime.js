// DeepSeek Harness bridge. The browser remains authoritative for Canvas state.
  const canvasAgentControl = document.querySelector("#canvasAgentControl"),
    canvasAgentToggle = document.querySelector("#canvasAgentToggle"),
    canvasAgentPanel = document.querySelector("#canvasAgentPanel"),
    canvasAgentHead = document.querySelector("#canvasAgentHead"),
    canvasAgentClose = document.querySelector("#canvasAgentClose"),
    canvasAgentNew = document.querySelector("#canvasAgentNew"),
    canvasAgentProjectButton = document.querySelector("#canvasAgentProject"),
    canvasAgentProjectLabel = document.querySelector("#canvasAgentProjectLabel"),
    canvasAgentProjectPopover = document.querySelector("#canvasAgentProjectPopover"),
    canvasAgentProjectClose = document.querySelector("#canvasAgentProjectClose"),
    canvasAgentProjectList = document.querySelector("#canvasAgentProjectList"),
    canvasAgentProjectAddFile = document.querySelector("#canvasAgentProjectAddFile"),
    canvasAgentProjectUpload = document.querySelector("#canvasAgentProjectUpload"),
    canvasAgentProjectUploadInput = document.querySelector("#canvasAgentProjectUploadInput"),
    canvasAgentProjectRoots = document.querySelector("#canvasAgentProjectRoots"),
    canvasAgentProjectRootBack = document.querySelector("#canvasAgentProjectRootBack"),
    canvasAgentProjectRootPath = document.querySelector("#canvasAgentProjectRootPath"),
    canvasAgentProjectRootList = document.querySelector("#canvasAgentProjectRootList"),
    canvasAgentProjectRootSelect = document.querySelector("#canvasAgentProjectRootSelect"),
    canvasAgentProjectRootTruncated = document.querySelector("#canvasAgentProjectRootTruncated"),
    canvasAgentProjectError = document.querySelector("#canvasAgentProjectError"),
    canvasAgentHistory = document.querySelector("#canvasAgentHistory"),
    canvasAgentHistoryPopover = document.querySelector("#canvasAgentHistoryPopover"),
    canvasAgentHistoryList = document.querySelector("#canvasAgentHistoryList"),
    canvasAgentHistoryView = document.querySelector("#canvasAgentHistoryView"),
    canvasAgentHistoryReturn = document.querySelector("#canvasAgentHistoryReturn"),
    canvasAgentSize = document.querySelector("#canvasAgentSize"),
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
    canvasAgentImageInput = document.querySelector("#canvasAgentImageInput"),
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
    CANVAS_AGENT_PROJECT_ACCESS_KEY = "penecho-canvas-agent-project-access-v1",
    CANVAS_AGENT_PROJECT_UPLOAD_LIMIT = 32 * 1024 * 1024,
    CANVAS_AGENT_PROJECT_FILE_EXTENSIONS = new Set([
      ".pdf", ".docx", ".xlsx", ".csv", ".db", ".sqlite", ".sqlite3",
      ".png", ".jpg", ".jpeg", ".webp", ".gif",
      ".txt", ".text", ".md", ".markdown", ".mdx", ".rst", ".adoc", ".log",
      ".json", ".jsonc", ".jsonl", ".ndjson", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf", ".config", ".properties", ".env", ".xml", ".xsd", ".svg",
      ".html", ".htm", ".css", ".scss", ".sass", ".less", ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts",
      ".py", ".pyi", ".rb", ".php", ".java", ".kt", ".kts", ".go", ".rs", ".c", ".h", ".cc", ".cpp", ".cxx", ".hpp", ".cs", ".scala", ".swift",
      ".sh", ".bash", ".zsh", ".fish", ".ps1", ".bat", ".cmd", ".sql", ".graphql", ".gql", ".proto", ".vue", ".svelte", ".astro", ".tex", ".lock", ".diff", ".patch",
    ]),
    CANVAS_AGENT_PROJECT_TEXT_FILENAMES = new Set([
      "readme", "license", "licence", "copying", "notice", "changelog", "changes", "authors", "contributors",
      "makefile", "dockerfile", "containerfile", "procfile", "gemfile", "rakefile", "justfile", ".gitignore", ".gitattributes", ".editorconfig", ".npmrc", ".nvmrc", ".prettierrc", ".eslintrc",
    ]),
    CANVAS_AGENT_HISTORY_LIMIT = 5,
    CANVAS_AGENT_HISTORY_ITEM_LIMIT = 120,
    CANVAS_AGENT_HISTORY_TEXT_LIMIT = 20000,
    CANVAS_AGENT_HEIGHT_MIN = 320,
    CANVAS_AGENT_WIDTH_MIN = 360,
    CANVAS_AGENT_SIZE_STEPS = 40,
    CANVAS_AGENT_RESIZE_KEY_STEP = 20,
    CANVAS_AGENT_MAX_REFERENCES = 20,
    CANVAS_AGENT_MAX_ATTACHMENTS = 5,
    CANVAS_AGENT_MAX_SOURCE_BYTES = 12 * 1024 * 1024,
    CANVAS_AGENT_MAX_WIRE_BYTES = 900 * 1024,
    CANVAS_AGENT_MAX_TOTAL_WIRE_BYTES = CANVAS_AGENT_MAX_ATTACHMENTS * CANVAS_AGENT_MAX_WIRE_BYTES,
    CANVAS_AGENT_MAX_IMAGE_PIXELS = 64 * 1024 * 1024,
    CANVAS_AGENT_MAX_IMAGE_DIMENSION = 16384,
    CANVAS_AGENT_WIRE_IMAGE_DIMENSION = 2048,
    CANVAS_AGENT_COMFORT_BODY_PX = 15,
    CANVAS_AGENT_PREFERRED_BODY_MIN_PX = 11,
    CANVAS_AGENT_COMPACT_TEXT_MIN_PX = 8,
    CANVAS_AGENT_AUTO_AI_STATUS_KEYS = new Set(["canvasAgentAutoAIFocusPaused","canvasAgentAutoAIRequestPaused"]),
    CANVAS_AGENT_LAYOUT_CAPTURE_POLICY = Object.freeze({id:"canvas-layout-v1",maxLongEdge:1024,maxPixels:520000,quality:.72,maxBytes:700*1024}),
    CANVAS_AGENT_DETAIL_CAPTURE_POLICY = Object.freeze({id:"canvas-detail-v1",maxLongEdge:1440,maxPixels:1800000,quality:.88,maxBytes:1200*1024});
  const canvasAgent = {
    socket:null,
    connectPromise:null,
    connectResolve:null,
    connectReject:null,
    sessionId:"",
    resumeToken:"",
    connectionId:"",
    sessionProjectId:"",
    sessionAccessMode:"controlled",
    sessionProjectCapabilities:null,
    clientId:sessionStorage.getItem(CANVAS_AGENT_CLIENT_KEY) || canvasClientId(),
    outgoingSeq:0,
    incomingSeq:0,
    running:false,
    requestPending:false,
    automaticAIStatusRestore:null,
    assistantRows:new Map(),
    toolRows:new Map(),
    toolResultCache:new Map(),
    attachments:[],
    attachmentBusy:false,
    references:[],
    referencePickActive:false,
    referenceHoverId:"",
    inputMode:"text",
    inkPresent:false,
    inkStroke:null,
    searchConfigured:Boolean(window.PENECHO_CONFIG?.canvasAgentSearchConfigured),
    searchEnabled:Boolean(window.PENECHO_CONFIG?.canvasAgentSearchConfigured) && localStorage.getItem(CANVAS_AGENT_SEARCH_ENABLED_KEY) === "true",
    sessionSearchConfigured:false,
    projectId:localStorage.getItem(CANVAS_AGENT_PROJECT_KEY) || "",
    accessMode:"controlled",
    projects:[],
    projectsLoaded:false,
    projectListRequestRevision:0,
    projectRoots:[],
    projectRootsLoaded:false,
    projectRootView:null,
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
  function updateCanvasAgentLanguage() {
    canvasAgentSend.textContent = t(canvasAgent.running ? "canvasAgentSteer" : "canvasAgentSend");
    canvasAgentStop.textContent = t("canvasAgentStop");
    canvasAgentInputHint.textContent = t("canvasAgentInputHint");
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
    canvasAgentSize.setAttribute("aria-label",t("canvasAgentResize"));
    canvasAgentSize.setAttribute("title",t("canvasAgentResize"));
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
    canvasAgentProjectPopover.setAttribute("aria-label",t("canvasAgentProject"));
    canvasAgentProjectClose.setAttribute("aria-label",t("canvasAgentProjectClose"));
    canvasAgentProjectAccess.setAttribute("aria-label",t("canvasAgentAccessMode"));
    canvasAgentProjectAddFile.textContent=t("canvasAgentAddProjectFile");
    canvasAgentProjectUpload.textContent=t(canvasAgent.projectUploadBusy?"canvasAgentUploadingFile":"canvasAgentUploadFile");
    canvasAgentProjectRootBack.setAttribute("aria-label",t("canvasAgentRootBack"));
    canvasAgentProjectRootSelect.textContent=t("canvasAgentRootSelect");
    canvasAgentProjectRootTruncated.textContent=t("canvasAgentRootTruncated");
    canvasAgentApproval.setAttribute("aria-label",t("canvasAgentApproval"));
    const statusKey = { ready:"canvasAgentReady", connecting:"canvasAgentConnecting", running:"canvasAgentWorking", offline:"canvasAgentDisconnected", history:"canvasAgentHistoryViewing" }[canvasAgentPanel.dataset.status];
    if (statusKey) canvasAgentStatus.textContent = t(statusKey);
    for (const target of canvasAgent.toolRows.values()) canvasAgentRenderToolRow(target);
    for (const block of canvasAgentTranscript.querySelectorAll(".canvas-agent-copy-block")) {
      block.querySelector(".canvas-agent-copy-block-language").textContent=canvasAgentBlockLabel(block.dataset.language||"");
      const button=block.querySelector(".canvas-agent-copy-block-button"), key=button.classList.contains("copied")?"canvasAgentBlockCopied":button.classList.contains("error")?"canvasAgentBlockCopyFailed":"canvasAgentCopyBlock";
      button.textContent=t(key);
    }
    canvasAgentSyncSelection();
    if (!canvasAgentReferencePicker.hidden) canvasAgentRenderReferencePicker(canvasAgentReferenceSearch.value);
    canvasAgentRenderHistoryList();
    canvasAgentRenderProjects();
    if (canvasAgentTranscript.querySelector(".canvas-agent-empty")) canvasAgentRenderEmpty();
    canvasAgentSyncInputHint();
  }
  async function canvasAgentProjectRequest(path, options = {}) {
    const response=await fetch(path,{cache:"no-store",credentials:"same-origin",...options,headers:{accept:"application/json",...(options.body?{"content-type":"application/json"}:{}),...(options.headers||{})}}),body=await response.json().catch(()=>({}));
    if(!response.ok)throw Error(body?.error||`Project request failed (HTTP ${response.status}).`);
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
  function canvasAgentProjectFileSupported(filename) {
    const name=String(filename||"").trim().toLowerCase(),dot=name.lastIndexOf("."),extension=dot>=0?name.slice(dot):"";
    return CANVAS_AGENT_PROJECT_FILE_EXTENSIONS.has(extension)||CANVAS_AGENT_PROJECT_TEXT_FILENAMES.has(name)
      ||name.startsWith(".env.")||name.startsWith("dockerfile.")||name.startsWith("containerfile.")||name.startsWith("makefile.");
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
  function canvasAgentSetProjectError(message="") {
    canvasAgentProjectError.textContent=String(message||"");
    canvasAgentProjectError.hidden=!message;
  }
  function canvasAgentUpdateProjectButton() {
    const project=canvasAgentProjectById();
    canvasAgentProjectLabel.textContent=project?.name||t("canvasAgentNoProject");
    canvasAgentProjectButton.classList.toggle("has-project",Boolean(project));
    canvasAgentProjectButton.classList.toggle("has-file",project?.kind==="file");
    canvasAgentProjectButton.title=project?`${project.name} — ${canvasAgentProjectDisplayPath(project)}`:t("canvasAgentProject");
  }
  function canvasAgentRenderProjectRoots() {
    const view=canvasAgent.projectRootView,available=canvasAgent.projectRootsLoaded&&(canvasAgent.projectRoots.length>0||Boolean(view));
    canvasAgentProjectRoots.hidden=!available;
    if(!available)return;
    canvasAgentProjectRootList.replaceChildren();
    canvasAgentProjectRootBack.hidden=!view;
    canvasAgentProjectRootPath.textContent=view?[view.rootName,view.relativePath].filter(Boolean).join("/"):t("canvasAgentServerFolders");
    canvasAgentProjectRootSelect.hidden=!view;
    canvasAgentProjectRootSelect.disabled=canvasAgent.projectRootBusy;
    canvasAgentProjectRootTruncated.hidden=!view?.truncated;
    if(canvasAgent.projectRootBusy){
      const loading=document.createElement("button"),title=document.createElement("strong");
      loading.type="button";loading.disabled=true;title.textContent=t("canvasAgentRootLoading");loading.append(title);canvasAgentProjectRootList.append(loading);
      return;
    }
    const entries=view?.entries||canvasAgent.projectRoots;
    for(const entry of entries){
      const choice=document.createElement("button"),title=document.createElement("strong"),detail=document.createElement("small");
      choice.type="button";
      title.textContent=entry.name;
      detail.textContent=view?entry.relativePath:t("canvasAgentServerFoldersDetail");
      choice.append(title,detail);
      choice.addEventListener("click",()=>void canvasAgentBrowseProjectRoot(view?.rootId||entry.id,view?entry.relativePath:""));
      canvasAgentProjectRootList.append(choice);
    }
  }
  function canvasAgentRenderProjects() {
    if(!canvasAgentProjectList)return;
    canvasAgentProjectList.replaceChildren();
    const browserRow=document.createElement("div"),browser=document.createElement("button"),browserTitle=document.createElement("strong"),browserDetail=document.createElement("small");
    browserRow.className="canvas-agent-project-row";
    browser.className="canvas-agent-project-choice";
    browser.type="button";
    browser.setAttribute("aria-pressed",String(!canvasAgent.projectId));
    browserTitle.textContent=t("canvasAgentBrowserSpace");
    browserDetail.textContent=t("canvasAgentBrowserSpaceDetail");
    browser.append(browserTitle,browserDetail);
    browser.addEventListener("click",()=>void canvasAgentSelectProject(""));
    browserRow.append(browser);
    canvasAgentProjectList.append(browserRow);
    for(const project of canvasAgent.projects){
      const row=document.createElement("div"),choice=document.createElement("button"),title=document.createElement("strong"),detail=document.createElement("small"),remove=document.createElement("button");
      row.className="canvas-agent-project-row";
      choice.className="canvas-agent-project-choice";
      choice.type="button";
      choice.setAttribute("aria-pressed",String(project.id===canvasAgent.projectId));
      title.textContent=project.name;
      detail.textContent=`${t("canvasAgentFileReadOnly")} · ${canvasAgentProjectDisplayPath(project)}`;
      choice.append(title,detail);
      choice.addEventListener("click",()=>void canvasAgentSelectProject(project.id));
      remove.className="canvas-agent-project-remove";
      remove.type="button";
      remove.textContent="×";
      remove.setAttribute("aria-label",`${t("canvasAgentRemoveProject")}: ${project.name}`);
      remove.title=t("canvasAgentRemoveProject");
      remove.addEventListener("click",event=>{event.stopPropagation();void canvasAgentRemoveProject(project.id);});
      row.append(choice,remove);
      canvasAgentProjectList.append(row);
    }
    const canPickFile=typeof window.penechoDesktop?.pickProjectFile==="function";
    canvasAgentProjectAddFile.hidden=!canPickFile;
    canvasAgentProjectUpload.hidden=canPickFile;
    canvasAgentProjectAddFile.disabled=canvasAgent.projectUploadBusy;
    canvasAgentProjectUpload.disabled=canvasAgent.projectUploadBusy;
    canvasAgentProjectUpload.textContent=t(canvasAgent.projectUploadBusy?"canvasAgentUploadingFile":"canvasAgentUploadFile");
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
      localStorage.setItem(CANVAS_AGENT_PROJECT_ACCESS_KEY,"controlled");
      canvasAgentBeginLocalConversation({persistCurrent:false});
      canvasAgentDropSessionIdentity();
    }
    await canvasAgentLoadProjectHistory(canvasAgent.projectId,canvasAgent.projectSelectionRevision);
    canvasAgentRenderProjects();
    return true;
  }
  async function canvasAgentEnsureProjectRoots({refresh=false}={}) {
    if(canvasAgent.projectRootsLoaded&&!refresh)return;
    const body=await canvasAgentProjectRequest(canvasAgentProjectRootApi().roots);
    canvasAgent.projectRoots=(Array.isArray(body?.roots)?body.roots:[]).filter(root=>root&&/^root-[0-9a-f]{24}$/.test(String(root.id||""))&&typeof root.name==="string").map(root=>({id:String(root.id),name:String(root.name).slice(0,120)}));
    canvasAgent.projectRootsLoaded=true;
    if(canvasAgent.projectRootView&&!canvasAgent.projectRoots.some(root=>root.id===canvasAgent.projectRootView.rootId))canvasAgent.projectRootView=null;
    canvasAgentRenderProjectRoots();
  }
  async function canvasAgentBrowseProjectRoot(rootId,relativePath="") {
    if(canvasAgent.projectRootBusy||!/^root-[0-9a-f]{24}$/.test(String(rootId||"")))return;
    canvasAgent.projectRootBusy=true;canvasAgentSetProjectError();canvasAgentRenderProjectRoots();
    try{
      const body=await canvasAgentProjectRequest(`${canvasAgentProjectRootApi().entries}/${encodeURIComponent(rootId)}/entries?path=${encodeURIComponent(String(relativePath||""))}`),view=body?.browser||body,
        resolvedRootId=String(view?.rootId||view?.root?.id||""),rootName=String(view?.rootName||view?.root?.name||"").slice(0,120),resolvedPath=String(view?.relativePath??view?.path??"").slice(0,1024);
      if(resolvedRootId!==rootId||!rootName)throw Error("The server folder response is invalid.");
      const parentPath=view?.parentPath===null?null:String(view?.parentPath||"").slice(0,1024),entries=(Array.isArray(view?.entries)?view.entries:[]).filter(entry=>entry?.kind==="folder"&&typeof entry.name==="string"&&typeof (entry.relativePath??entry.path)==="string").slice(0,200).map(entry=>({name:String(entry.name).slice(0,255),relativePath:String(entry.relativePath??entry.path).slice(0,1024)}));
      canvasAgent.projectRootView={rootId:resolvedRootId,rootName,relativePath:resolvedPath,parentPath,entries,truncated:Boolean(view?.truncated)};
    }catch(error){canvasAgentSetProjectError(String(error?.message||error));}
    finally{canvasAgent.projectRootBusy=false;canvasAgentRenderProjectRoots();}
  }
  async function canvasAgentNavigateProjectRootBack() {
    const view=canvasAgent.projectRootView;
    if(!view||canvasAgent.projectRootBusy)return;
    if(view.parentPath===null){canvasAgent.projectRootView=null;canvasAgentRenderProjectRoots();return;}
    await canvasAgentBrowseProjectRoot(view.rootId,view.parentPath);
  }
  async function canvasAgentSelectProjectRoot() {
    const view=canvasAgent.projectRootView;
    if(!view||canvasAgent.projectRootBusy)return;
    const selectionRevision=canvasAgent.projectSelectionRevision;
    canvasAgent.projectRootBusy=true;canvasAgentSetProjectError();canvasAgentRenderProjectRoots();
    try{
      const body=await canvasAgentProjectRequest(canvasAgentProjectRootApi().select,{method:"POST",body:JSON.stringify({rootId:view.rootId,path:view.relativePath})});
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
  function canvasAgentHideProjectPopover() {
    canvasAgentProjectPopover.hidden=true;
    canvasAgentProjectButton.setAttribute("aria-expanded","false");
    canvasAgentSetProjectError();
  }
  async function canvasAgentSelectProject(projectId,{expectedRevision=null}={}) {
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
    localStorage.setItem(CANVAS_AGENT_PROJECT_ACCESS_KEY,"controlled");
    if(next)localStorage.setItem(CANVAS_AGENT_PROJECT_KEY,next);else localStorage.removeItem(CANVAS_AGENT_PROJECT_KEY);
    canvasAgentBeginLocalConversation({persistCurrent:false});
    canvasAgentRenderProjects();
    canvasAgentHideProjectPopover();
    try{
      if(next&&!await canvasAgentLoadProjectHistory(next,revision))return false;
      if(revision!==canvasAgent.projectSelectionRevision||next!==canvasAgent.projectId)return false;
      canvasAgentRenderHistoryList();
      if(canvasAgent.socket?.readyState===WebSocket.OPEN||canvasAgent.connectPromise)await canvasAgentStartNewConversation(selectedAiConnectionId(),{resetProjection:false});
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
  async function canvasAgentAddProjectFile() {
    if(typeof window.penechoDesktop?.pickProjectFile!=="function")return;
    const selectionRevision=canvasAgent.projectSelectionRevision;
    try{
      canvasAgentSetProjectError();
      const picked=await window.penechoDesktop.pickProjectFile();
      if(picked?.canceled||!picked?.path||!picked?.pickerToken)return;
      const body=await canvasAgentProjectRequest("/api/canvas-agent/projects",{method:"POST",body:JSON.stringify({path:picked.path,kind:"file",pickerToken:picked.pickerToken})});
      await canvasAgentEnsureProjects({refresh:true});
      await canvasAgentSelectProject(body.project.id,{expectedRevision:selectionRevision});
    }catch(error){canvasAgentSetProjectError(String(error?.message||error));}
  }
  async function canvasAgentUploadProjectFile(file) {
    if(canvasAgent.projectUploadBusy||!file)return;
    if(!canvasAgentProjectFileSupported(file.name)){canvasAgentProjectUploadInput.value="";canvasAgentSetProjectError(t("canvasAgentFileUnsupported"));return;}
    if(!Number.isSafeInteger(file.size)||file.size<=0){canvasAgentProjectUploadInput.value="";canvasAgentSetProjectError(t("canvasAgentUploadEmpty"));return;}
    if(file.size>CANVAS_AGENT_PROJECT_UPLOAD_LIMIT){canvasAgentProjectUploadInput.value="";canvasAgentSetProjectError(t("canvasAgentUploadTooLarge"));return;}
    const selectionRevision=canvasAgent.projectSelectionRevision;
    let data="";
    canvasAgent.projectUploadBusy=true;canvasAgentSetProjectError();canvasAgentRenderProjects();
    try{
      data=await canvasAgentProjectFileBase64(file);
      const body=await canvasAgentProjectRequest("/api/canvas-agent/files",{method:"POST",body:JSON.stringify({name:file.name,bytes:file.size,data})});
      await canvasAgentEnsureProjects({refresh:true});
      await canvasAgentSelectProject(body?.project?.id,{expectedRevision:selectionRevision});
    }catch(error){canvasAgentSetProjectError(String(error?.message||error));}
    finally{data="";canvasAgentProjectUploadInput.value="";canvasAgent.projectUploadBusy=false;canvasAgentRenderProjects();}
  }
  function canvasAgentResolveApproval(allowed) {
    const pending=canvasAgent.pendingApproval;
    if(!pending)return;
    canvasAgent.pendingApproval=null;
    canvasAgentApproval.hidden=true;
    pending.resolve({allowed:Boolean(allowed)});
  }
  function canvasAgentRequestApproval(args) {
    if(canvasAgent.pendingApproval)throw Error("Another project command is already awaiting approval.");
    canvasAgentApprovalReason.textContent=String(args?.reason||"");
    canvasAgentApprovalCommand.textContent=String(args?.command||"");
    canvasAgentApproval.hidden=false;
    canvasAgentApprovalAllow.focus();
    return new Promise(resolve=>{canvasAgent.pendingApproval={resolve};});
  }
  function canvasAgentHistoryText(value, limit = CANVAS_AGENT_HISTORY_TEXT_LIMIT) {
    return String(value || "").slice(0,limit);
  }
  function canvasAgentNormalizeHistoryItem(item) {
    if (!item || typeof item !== "object") return null;
    if (item.type === "message" && ["user","assistant"].includes(item.role)) return {
      id:canvasAgentHistoryText(item.id,128) || canvasClientId(),
      type:"message",
      role:item.role,
      text:canvasAgentHistoryText(item.text),
      attachmentCount:Math.max(0,Math.min(CANVAS_AGENT_MAX_ATTACHMENTS,Number(item.attachmentCount)||0)),
      eventKey:canvasAgentHistoryText(item.eventKey,128),
    };
    if (item.type === "tool") return {
      id:canvasAgentHistoryText(item.id,128) || canvasClientId(),
      type:"tool",
      callId:canvasAgentHistoryText(item.callId,256),
      name:canvasAgentHistoryText(item.name,128),
      argumentsText:canvasAgentHistoryText(item.argumentsText,8000),
      resultText:canvasAgentHistoryText(item.resultText,8000),
      state:["running","done","error"].includes(item.state) ? item.state : "done",
    };
    return null;
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
      items:(Array.isArray(value.items)?value.items:[]).slice(-CANVAS_AGENT_HISTORY_ITEM_LIMIT).map(canvasAgentNormalizeHistoryItem).filter(Boolean),
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
      button.addEventListener("click",()=>current?canvasAgentReturnToCurrentConversation():canvasAgentViewStoredConversation(conversation.id));
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
  }
  function canvasAgentViewStoredConversation(id) {
    canvasAgentPersistCurrentConversation();
    const conversation=canvasAgentHistoryForCanvas().find(item=>item.id===id);
    if (!conversation) return;
    canvasAgentHideHistoryPopover();
    canvasAgentSetHistoryViewing(conversation.id);
    canvasAgentRenderConversation(conversation,false);
    canvasAgentSetStatus(t("canvasAgentHistoryViewing"),"history");
    canvasAgentHistoryReturn.focus();
  }
  function canvasAgentReturnToCurrentConversation() {
    canvasAgentHideHistoryPopover();
    canvasAgentSetHistoryViewing("");
    canvasAgentRenderConversation(canvasAgent.currentConversation,true);
    canvasAgentSetStatus(t(canvasAgent.running?"canvasAgentWorking":canvasAgent.socket?.readyState===WebSocket.OPEN?"canvasAgentReady":"canvasAgentReadyConnect"),canvasAgent.running?"running":"ready");
    canvasAgentInput.focus();
  }
  function canvasAgentBeginLocalConversation({persistCurrent=true}={}) {
    if (persistCurrent) canvasAgentPersistCurrentConversation();
    canvasAgent.currentConversation=canvasAgentNewConversationRecord();
    canvasAgentSetHistoryViewing("");
    canvasAgentHideHistoryPopover();
    canvasAgentClearTranscript({showEmpty:true});
    canvasAgentClearAttachments();
    canvasAgentClearReferences();
    canvasAgentClearInkDraft();
    canvasAgentRenderHistoryList();
  }
  function canvasAgentDropSessionIdentity() {
    canvasAgent.sessionId="";
    canvasAgent.resumeToken="";
    canvasAgent.connectionId="";
    canvasAgent.sessionProjectId="";
    canvasAgent.sessionAccessMode="controlled";
    canvasAgent.sessionProjectCapabilities=null;
    try { sessionStorage.removeItem(CANVAS_AGENT_SESSION_KEY); } catch {}
  }
  function canvasAgentCanvasIdentity({id,location}={}) {
    return id&&location?`${location}:${id}`:`draft:${canvasClientId()}`;
  }
  function canvasAgentCanvasDidChange(identity = null) {
    canvasAgentPersistCurrentConversation();
    state.canvasAgentCanvasKey=canvasAgentCanvasIdentity(identity||{});
    canvasAgentBeginLocalConversation({persistCurrent:false});
    if (canvasAgent.socket?.readyState===WebSocket.OPEN||canvasAgent.connectPromise) {
      void canvasAgentStartNewConversation(selectedAiConnectionId(),{resetProjection:false}).catch(error=>canvasAgentSetStatus(String(error?.message||error),"error"));
    } else canvasAgentDropSessionIdentity();
    if (canvasAgentPanel.hidden) openCanvasAgent({focus:false});
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
    if (!canvasAgent.socket || canvasAgent.socket.readyState !== WebSocket.OPEN) throw Error("Canvas Agent is not connected.");
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
  function canvasAgentCyclePanelHeight() {
    if (canvasAgentCompactPanel()) return;
    const maximum=canvasAgentMaximumPanelHeight(), current=canvasAgentPanel.getBoundingClientRect().height, choices=[360,500,650,maximum].map(value=>Math.min(value,maximum)).filter((value,index,items)=>items.indexOf(value)===index), next=choices.find(value=>value>current+24)||choices[0];
    canvasAgentResizePanelTo("bottom",next);
    canvasAgentSavePanelSize();
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
  function canvasAgentBeginPanelResize(event) {
    if (canvasAgentCompactPanel()||event.button!==0||event.pointerType==="touch") return;
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
    if (canvasAgentCompactPanel() || event.button !== 0 || event.pointerType === "touch" || event.target.closest("button")) return;
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
    const sourceType = String(file.type || "").toLowerCase();
    if (file.size <= CANVAS_AGENT_MAX_WIRE_BYTES && new Set(["image/png","image/webp"]).has(sourceType)) return file;
    let scale = Math.min(1,CANVAS_AGENT_WIRE_IMAGE_DIMENSION/Math.max(image.naturalWidth,image.naturalHeight));
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
    throw Error(t("canvasAgentImageTooLarge"));
  }
  async function canvasAgentPrepareAttachment(file) {
    if (!(file instanceof Blob) || !String(file.type || "").startsWith("image/") || file.size <= 0) throw Error(t("canvasAgentImageUnsupported"));
    if (file.size > CANVAS_AGENT_MAX_SOURCE_BYTES) throw Error(t("canvasAgentImageTooLarge"));
    const image = await canvasAgentDecodeImage(file), width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
    if (!width || !height || width > CANVAS_AGENT_MAX_IMAGE_DIMENSION || height > CANVAS_AGENT_MAX_IMAGE_DIMENSION || width*height > CANVAS_AGENT_MAX_IMAGE_PIXELS) throw Error(t("canvasAgentImageTooLarge"));
    const wire = await canvasAgentWireImage(file,image), dataUrl = await canvasAgentReadDataUrl(wire), comma = dataUrl.indexOf(","), mediaType = String(wire.type || "").toLowerCase();
    if (comma < 0 || !new Set(["image/png","image/jpeg","image/webp","image/gif"]).has(mediaType)) throw Error(t("canvasAgentImageUnsupported"));
    return {
      id:canvasClientId(),
      name:String(file.name || "pasted-image").slice(0,240),
      mediaType,
      bytes:wire.size,
      width,
      height,
      dataUrl,
      wire:{ mediaType, data:dataUrl.slice(comma+1), name:String(file.name || "pasted-image").slice(0,240) },
    };
  }
  function canvasAgentRenderAttachments() {
    canvasAgentAttachments.replaceChildren();
    for (const attachment of canvasAgent.attachments) {
      const chip = document.createElement("div"), image = document.createElement("img"), remove = document.createElement("button");
      chip.className = "canvas-agent-attachment";
      image.src = attachment.dataUrl;
      image.alt = attachment.name;
      remove.type = "button";
      remove.textContent = "×";
      remove.setAttribute("aria-label",`${t("canvasAgentRemoveImage")} ${attachment.name}`);
      remove.onclick = ()=>{
        canvasAgent.attachments = canvasAgent.attachments.filter(item=>item.id!==attachment.id);
        canvasAgentRenderAttachments();
      };
      chip.append(image,remove);
      canvasAgentAttachments.append(chip);
    }
    canvasAgentAttachments.hidden = !canvasAgent.attachments.length;
    canvasAgentAttachmentCount.textContent = String(canvasAgent.attachments.length);
    canvasAgentAttachmentCount.hidden = !canvasAgent.attachments.length;
    canvasAgentSyncInputHint();
  }
  function canvasAgentClearAttachments() {
    canvasAgent.attachments = [];
    canvasAgentRenderAttachments();
  }
  async function canvasAgentAddAttachments(files) {
    if (canvasAgent.attachmentBusy) return;
    canvasAgent.attachmentBusy = true;
    canvasAgentAttach.disabled = true;
    canvasAgentSend.disabled = true;
    try {
      for (const file of files) {
        if (canvasAgent.attachments.length >= CANVAS_AGENT_MAX_ATTACHMENTS) throw Error(t("canvasAgentImageLimit"));
        const attachment = await canvasAgentPrepareAttachment(file), total = canvasAgent.attachments.reduce((sum,item)=>sum+item.bytes,0)+attachment.bytes;
        if (total > CANVAS_AGENT_MAX_TOTAL_WIRE_BYTES) throw Error(t("canvasAgentImagesTooLarge"));
        canvasAgent.attachments.push(attachment);
        canvasAgentRenderAttachments();
      }
    } catch (error) {
      canvasAgentSetStatus(String(error?.message || error),"error");
    } finally {
      canvasAgent.attachmentBusy = false;
      canvasAgentAttach.disabled = false;
      canvasAgentSend.disabled = false;
      canvasAgentImageInput.value = "";
    }
  }
  function canvasAgentSyncInputHint() {
    if (!canvasAgentInputHint) return;
    const hasConversation=Boolean(canvasAgent.currentConversation?.items?.length), hasDraft=Boolean(canvasAgentInput.value.trim()||canvasAgent.inkPresent||canvasAgent.attachments.length||canvasAgent.references.length);
    canvasAgentInputHint.hidden=hasConversation||hasDraft||Boolean(canvasAgent.viewingHistoryId);
  }
  function canvasAgentSetInputMode(mode) {
    canvasAgent.inputMode=mode==="ink"?"ink":"text";
    const ink=canvasAgent.inputMode==="ink";
    canvasAgentInput.hidden=ink;
    canvasAgentInkInput.hidden=!ink;
    canvasAgentTextMode.classList.toggle("active",!ink);
    canvasAgentInkMode.classList.toggle("active",ink);
    canvasAgentTextMode.setAttribute("aria-pressed",String(!ink));
    canvasAgentInkMode.setAttribute("aria-pressed",String(ink));
    (ink?canvasAgentInkCanvas:canvasAgentInput).focus?.();
  }
  function canvasAgentClearInkDraft() {
    canvasAgentInkContext?.clearRect(0,0,canvasAgentInkCanvas.width,canvasAgentInkCanvas.height);
    canvasAgent.inkPresent=false;
    canvasAgent.inkStroke=null;
    canvasAgentSyncInputHint();
  }
  function canvasAgentInkPoint(event) {
    const rect=canvasAgentInkCanvas.getBoundingClientRect();
    return {x:(event.clientX-rect.left)*canvasAgentInkCanvas.width/rect.width,y:(event.clientY-rect.top)*canvasAgentInkCanvas.height/rect.height};
  }
  function canvasAgentInkPointerDown(event) {
    if (event.button!==0||canvasAgentInput.disabled) return;
    const point=canvasAgentInkPoint(event), pressure=event.pressure||.5;
    canvasAgent.inkStroke={pointerId:event.pointerId,point};
    canvasAgentInkCanvas.setPointerCapture?.(event.pointerId);
    canvasAgentInkContext.save();
    canvasAgentInkContext.fillStyle=state.inkColor||"#1f2937";
    canvasAgentInkContext.beginPath();
    canvasAgentInkContext.arc(point.x,point.y,Math.max(2,4*pressure),0,Math.PI*2);
    canvasAgentInkContext.fill();
    canvasAgentInkContext.restore();
    canvasAgent.inkPresent=true;
    canvasAgentSyncInputHint();
    event.preventDefault();
  }
  function canvasAgentInkPointerMove(event) {
    const stroke=canvasAgent.inkStroke;
    if (!stroke||stroke.pointerId!==event.pointerId) return;
    const point=canvasAgentInkPoint(event), pressure=event.pressure||.5;
    canvasAgentInkContext.save();
    canvasAgentInkContext.strokeStyle=state.inkColor||"#1f2937";
    canvasAgentInkContext.lineWidth=Math.max(4,8*pressure);
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
    const padding=18,x=Math.max(0,left-padding),y=Math.max(0,top-padding),width=Math.min(image.width-x,right-left+1+padding*2),height=Math.min(image.height-y,bottom-top+1+padding*2),cropped=document.createElement("canvas");
    cropped.width=width;
    cropped.height=height;
    cropped.getContext("2d").drawImage(canvasAgentInkCanvas,x,y,width,height,0,0,width,height);
    const blob=await canvasAgentCanvasBlob(cropped,"image/png");
    if (!blob) throw Error(t("canvasAgentImageUnsupported"));
    return canvasAgentPrepareAttachment(new File([blob],"canvas-agent-handwriting.png",{type:"image/png"}));
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
    if (canvasAgent.socket?.readyState === WebSocket.OPEN && canvasAgent.sessionId) {
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
  function canvasAgentRenderMessageBody(body, value, role) {
    const text=String(value||"");
    if(role!=="assistant"||!text.includes("```")){body.textContent=text;return;}
    const segments=canvasAgentFencedSegments(text);
    if(!segments.some(segment=>segment.type==="block")){body.textContent=text;return;}
    body.replaceChildren();
    for(const segment of segments) {
      if(segment.type==="text") { body.append(document.createTextNode(segment.text)); continue; }
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
  function canvasAgentAppendMessageElement(item, attachments = [], append = true) {
    if (append) canvasAgentTranscript.querySelector(".canvas-agent-empty")?.remove();
    const row = document.createElement("article");
    row.className = `canvas-agent-message ${item.role}`;
    const label = document.createElement("span"), body = document.createElement("div");
    label.className = "canvas-agent-message-role";
    label.textContent = item.role === "user" ? "You" : "Agent";
    body.className = "canvas-agent-message-body";
    canvasAgentRenderMessageBody(body,item.text,item.role);
    row.append(label,body);
    if (attachments.length) {
      const images = document.createElement("div");
      images.className = "canvas-agent-message-images";
      for (const attachment of attachments) {
        const image = document.createElement("img");
        image.src = attachment.dataUrl;
        image.alt = attachment.name;
        images.append(image);
      }
      row.append(images);
    } else if (item.attachmentCount) {
      const note=document.createElement("span");
      note.className="canvas-agent-message-attachment-note";
      note.textContent=t("canvasAgentHistoryImages").replace("{count}",String(item.attachmentCount));
      row.append(note);
    }
    if (append) canvasAgentTranscript.append(row);
    return { row, body, historyItem:item, messageText:item.text };
  }
  function canvasAgentRow(role, text = "", attachments = [], {eventKey=""}={}) {
    const item={id:canvasClientId(),type:"message",role,text:canvasAgentHistoryText(text),attachmentCount:attachments.length,eventKey};
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
    const key = {
      canvas_inspect:"canvasAgentToolInspect",
      canvas_read:"canvasAgentToolRead",
      canvas_capture:"canvasAgentToolCapture",
      canvas_create:"canvasAgentToolCreate",
      canvas_edit:"canvasAgentToolEdit",
      canvas_patch_widget:"canvasAgentToolPatchWidget",
      canvas_set_view:"canvasAgentToolSetView",
      canvas_revert:"canvasAgentToolRevert",
      tavily_search:"canvasAgentToolSearch",
    }[name] || "canvasAgentToolUse";
    const intent = t(key), summary = ["canvas_create","canvas_edit"].includes(name) ? String(args?.summary || "").replace(/\s+/g," ").trim() : "";
    if (!summary) return intent;
    return `${intent} · ${summary.length > 100 ? `${summary.slice(0,100)}…` : summary}`;
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
    const target = {row,intent,status,argumentsLabel,result,resultLabel,resultDetail,name:item.name,arguments:parsedArguments,state:item.state,historyItem:item};
    canvasAgentRenderToolRow(target);
    return target;
  }
  function canvasAgentToolRow(event) {
    const item={id:canvasClientId(),type:"tool",callId:String(event.callId||""),name:String(event.name||""),argumentsText:canvasAgentHistoryText(JSON.stringify(event.arguments||{},null,2),8000),resultText:"",state:"running"};
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
    canvasAgentSend.textContent = t(running ? "canvasAgentSteer" : "canvasAgentSend");
    canvasAgentSetStatus(t(running ? "canvasAgentWorking" : "canvasAgentReady"),running ? "running" : "ready");
    canvasAgentSyncTriggerState();
    if (running) canvasAgentPauseAutomaticAI();
    else canvasAgentResumeAutomaticAI();
  }
  function canvasAgentHandleEvent(event,{ replay=false }={}) {
    if (!event || typeof event !== "object") return;
    if (event.kind === "turn_start") {
      canvasAgent.requestPending = false;
      canvasAgentSetRunning(true);
    }
    else if (event.kind === "user_message" && replay && event.text) canvasAgentRow("user",event.text);
    else if (event.kind === "assistant_delta") {
      const key = `${event.turn}:${event.step}`;
      let target = canvasAgent.assistantRows.get(key);
      if (!target) {
        target = canvasAgentRow("assistant","",[],{eventKey:key});
        canvasAgent.assistantRows.set(key,target);
      }
      target.messageText += event.text || "";
      canvasAgentRenderMessageBody(target.body,target.messageText,"assistant");
      target.historyItem.text=canvasAgentHistoryText(target.messageText);
      canvasAgentScheduleHistoryPersist();
      if (!canvasAgent.viewingHistoryId) canvasAgentScrollToLatest();
    } else if (event.kind === "assistant_message") {
      const key = `${event.turn}:${event.step}`;
      let target = canvasAgent.assistantRows.get(key);
      if (!target && event.text) {
        target = canvasAgentRow("assistant",event.text,[],{eventKey:key});
        canvasAgent.assistantRows.set(key,target);
      } else if (target && event.text && !target.messageText) {
        target.messageText = event.text;
        canvasAgentRenderMessageBody(target.body,target.messageText,"assistant");
        target.historyItem.text=canvasAgentHistoryText(event.text);
      }
      if (target && event.interrupted) target.row.classList.add("interrupted");
      canvasAgentScheduleHistoryPersist(0);
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
      canvasAgentSetRunning(false);
      canvasAgentSyncState();
      canvasAgentPersistCurrentConversation();
    }
  }
  async function canvasAgentHandleMessage(message) {
    let envelope;
    try { envelope = JSON.parse(message.data); } catch { return; }
    if (envelope?.version !== CANVAS_AGENT_PROTOCOL_VERSION || !Number.isSafeInteger(envelope.seq) || envelope.seq <= canvasAgent.incomingSeq) return;
    canvasAgent.incomingSeq = envelope.seq;
    if (envelope.type === "ready") {
      canvasAgent.sessionId = envelope.canvasSessionId;
      canvasAgent.resumeToken = String(envelope.payload?.resumeToken || canvasAgent.resumeToken || "");
      canvasAgent.connectionId = String(envelope.payload?.connectionId || "");
      canvasAgent.sessionProjectId = String(envelope.payload?.project?.id || "");
      canvasAgent.sessionAccessMode = String(envelope.payload?.accessMode || "controlled");
      const capabilities=envelope.payload?.projectCapabilities;
      canvasAgent.sessionProjectCapabilities=capabilities&&typeof capabilities.bash==="boolean"&&typeof capabilities.readOnly==="boolean"
        ? {bash:capabilities.bash,readOnly:capabilities.readOnly}:null;
      canvasAgent.sessionSearchConfigured = envelope.payload?.webSearchConfigured === true;
      canvasAgentSetSearchConfigured(canvasAgent.sessionSearchConfigured);
      canvasAgentRenderProjects();
      try { sessionStorage.setItem(CANVAS_AGENT_SESSION_KEY,JSON.stringify({sessionId:canvasAgent.sessionId,resumeToken:canvasAgent.resumeToken,connectionId:canvasAgent.connectionId,projectId:canvasAgent.sessionProjectId,accessMode:canvasAgent.sessionAccessMode})); } catch {}
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
    } else if (envelope.type === "session_event") canvasAgentHandleEvent(envelope.payload);
    else if (envelope.type === "agent_status") {
      canvasAgent.requestPending = false;
      canvasAgentSetRunning(envelope.payload?.status !== "idle");
    }
    else if (envelope.type === "tool_request") await canvasAgentExecuteTool(envelope.payload);
    else if (envelope.type === "error") {
      canvasAgent.requestPending = false;
      canvasAgentSyncTriggerState();
      canvasAgentResumeAutomaticAI();
      canvasAgentSetStatus(envelope.payload?.message || "Canvas Agent failed","error");
      if (envelope.payload?.fatal) canvasAgent.connectReject?.(Error(envelope.payload?.message || "Canvas Agent failed"));
    }
  }
  function canvasAgentSocketUrl() {
    const path=window.PENECHO_CONFIG?.runtime === "cloud" ? "/api/v1/remote-canvas/canvas-agent" : "/api/canvas-agent/socket";
    return `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}${path}`;
  }
  function canvasAgentWaitForReady(start) {
    if (canvasAgent.connectPromise) return canvasAgent.connectPromise;
    let wrapped;
    const pending = new Promise((resolve,reject)=>{
      canvasAgent.connectResolve = resolve;
      canvasAgent.connectReject = reject;
      try { start(); }
      catch (error) { canvasAgent.connectResolve=canvasAgent.connectReject=null; reject(error); }
    });
    wrapped = pending.finally(()=>{
      if (canvasAgent.connectPromise === wrapped) canvasAgent.connectPromise = null;
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
  async function canvasAgentStartNewConversation(connectionId = selectedAiConnectionId(), {resetProjection=true}={}) {
    if (resetProjection) canvasAgentBeginLocalConversation();
    if (canvasAgent.connectPromise) {
      await canvasAgent.connectPromise;
      return canvasAgentStartNewConversation(connectionId,{resetProjection:false});
    }
    if (canvasAgent.socket?.readyState !== WebSocket.OPEN || !canvasAgent.sessionId) return canvasAgentConnect();
    canvasAgent.currentConversation.items=[];
    canvasAgentClearTranscript({showEmpty:true});
    canvasAgentClearAttachments();
    canvasAgentClearReferences();
    canvasAgentClearInkDraft();
    canvasAgentSetStatus(t("canvasAgentConnecting"),"connecting");
    canvasAgent.running = false;
    canvasAgentStop.hidden = true;
    canvasAgentSend.textContent = t("canvasAgentSend");
    return canvasAgentWaitForReady(()=>canvasAgentSendEnvelope("new_conversation",{connectionId,webSearchEnabled:canvasAgent.searchEnabled,projectId:canvasAgent.projectId,accessMode:canvasAgentEffectiveAccessMode()}));
  }
  async function canvasAgentConnect() {
    await canvasAgentEnsureProjects();
    const connectionId = selectedAiConnectionId();
    if (canvasAgent.socket?.readyState === WebSocket.OPEN && canvasAgent.sessionId) {
      if (canvasAgent.connectionId === connectionId&&canvasAgent.sessionProjectId===canvasAgent.projectId&&canvasAgent.sessionAccessMode===canvasAgentEffectiveAccessMode()) return;
      await canvasAgentStartNewConversation(connectionId);
      return canvasAgentConnect();
    }
    if (canvasAgent.connectPromise) {
      await canvasAgent.connectPromise;
      return canvasAgentConnect();
    }
    canvasAgentSetStatus(t("canvasAgentConnecting"),"connecting");
    await canvasAgentWaitForReady(()=>{
      const socket = new WebSocket(canvasAgentSocketUrl());
      canvasAgent.socket = socket;
      socket.addEventListener("open",()=>{
        canvasAgent.outgoingSeq = 0;
        canvasAgent.incomingSeq = 0;
        canvasAgentSendEnvelope("hello",{
          canvasSessionId:canvasAgent.sessionId,
          resumeToken:canvasAgent.resumeToken,
          clientId:canvasAgent.clientId,
          connectionId:selectedAiConnectionId(),
          webSearchEnabled:canvasAgent.searchEnabled,
          projectId:canvasAgent.projectId,
          accessMode:canvasAgentEffectiveAccessMode(),
        });
      });
      socket.addEventListener("message",event=>void canvasAgentHandleMessage(event));
      socket.addEventListener("close",()=>{
        const wasPending = Boolean(canvasAgent.connectReject);
        canvasAgent.connectReject?.(Error("Canvas Agent connection closed."));
        canvasAgent.connectResolve = canvasAgent.connectReject = null;
        canvasAgent.connectPromise = null;
        canvasAgent.socket = null;
        canvasAgentResolveApproval(false);
        canvasAgent.requestPending = false;
        canvasAgent.running = false;
        canvasAgentStop.hidden = true;
        canvasAgentSend.textContent = t("canvasAgentSend");
        canvasAgentSyncTriggerState();
        canvasAgentResumeAutomaticAI();
        if (!wasPending) canvasAgentSetStatus(t("canvasAgentDisconnected"),"offline");
      });
      socket.addEventListener("error",()=>canvasAgentSetStatus("Could not connect to Canvas Agent","error"));
    });
    return canvasAgentConnect();
  }
  function canvasAgentConnectionDidChange(force = false) {
    if (canvasAgentPanel.hidden || canvasAgent.socket?.readyState !== WebSocket.OPEN || !force && canvasAgent.connectionId === selectedAiConnectionId()) return;
    const action = force ? canvasAgentStartNewConversation(selectedAiConnectionId()) : canvasAgentConnect();
    void action.catch(error=>canvasAgentSetStatus(String(error?.message||error),"error"));
  }
  async function canvasAgentEnsureSearchSession() {
    if (!canvasAgent.searchEnabled || canvasAgent.sessionSearchConfigured || canvasAgent.socket?.readyState !== WebSocket.OPEN || !canvasAgent.sessionId) return;
    await canvasAgentStartNewConversation(selectedAiConnectionId());
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
      canvas_capture:["target","objectId","region","quality","coordinates"],
      canvas_create:["baseRevision","items","summary","_changeId"],canvas_edit:["baseRevision","operations","summary","_changeId"],
      canvas_visual_explainer_create:["baseRevision","plan","title","width","height","placement","summary","_changeId"],
      canvas_visual_explainer_update:["objectId","baseRevision","plan","title","summary","_changeId"],
      canvas_set_view:["target","objectId","region","padding"],canvas_revert:["changeId"],
      canvas_internal_widget:["objectId","artifactId"],canvas_internal_replace_widget:["objectId","baseRevision","expectedHash","changeId","command"],
      canvas_internal_patch_visual_explainer:["objectId","artifactId","baseRevision","expectedHash","changeId","plan","command","summary"],
    }[name];
    const extras=Object.keys(args||{}).filter(key=>!allowed?.includes(key));
    if(!allowed||extras.length)throw canvasAgentToolError("INVALID_ARGUMENT",extras.length?`Unexpected ${name} argument: ${extras[0]}.`:`Unknown Canvas Agent tool: ${name}.`);
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
    throw canvasAgentToolError("INVALID_TARGET","Canvas capture target is invalid.");
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
  async function canvasAgentCapture(args) {
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
    await prepareVisibleWidgetSnapshots(region,true);
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
      encoded=await canvasAgentCompressedCanvas(canvas,policy), finalWidth=encoded.canvas.width, finalHeight=encoded.canvas.height,
      scaleX=finalWidth/region.w, scaleY=finalHeight/region.h, viewFacts=canvasAgentViewFacts();
    return {
      dataUrl:await canvasAgentReadDataUrl(encoded.blob), mediaType:encoded.blob.type || encoded.mediaType, encodedBytes:encoded.blob.size,
      width:finalWidth,height:finalHeight,quality,coordinates,revision:state.userRevision,viewRevision:viewFacts.viewRevision,
      logicalRegion:{x:region.x,y:region.y,width:region.w,height:region.h},
      mapping:{origin:{x:region.x,y:region.y},pixelsPerLogicalUnit:{x:scaleX,y:scaleY},logicalUnitsPerPixel:{x:1/scaleX,y:1/scaleY}},
      compression:{policy:policy.id,format:encoded.blob.type||encoded.mediaType,quality:encoded.mediaType === "image/webp" ? Number(encoded.encodeQuality.toFixed(2)) : null,maxBytes:policy.maxBytes,automatic:true},
      sampling:{maxWidth:policy.maxLongEdge,maxHeight:policy.maxLongEdge,maxPixels:policy.maxPixels,pixelsPerLogicalUnit:Math.min(scaleX,scaleY),note:"Tighter logical regions receive more image pixels per Canvas unit."},
      coordinateGrid:{step:gridStep,labels:"absolute canvas logical coordinates",rendered:coordinates === "grid"},
    };
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
    const raw=String(value), lines=raw.split(/\r\n|\r|\n/), start=Math.max(1,Math.min(lines.length||1,Math.round(Number(args.startLine)||1))), end=Math.max(start,Math.min(lines.length,Math.round(Number(args.endLine)||start+199))), selected=lines.slice(start-1,end).join("\n"), numbered=canvasAgentLineNumberedResourceView(selected,start), maximum=200000, contentTruncated=numbered.length>maximum;
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
    };
  }
  function canvasAgentMutationIdle() {
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
        const widgetType=raw.widgetType === "diagram_source" ? "diagram_source" : "html_widget",pluginId=String(raw.pluginId || (widgetType === "diagram_source"?"flowchart":"general"));
        if(!["general","flowchart"].includes(pluginId))throw canvasAgentToolError("CAPABILITY_UNAVAILABLE","Canvas Agent may create Widgets only with General HTML or Professional Diagrams.");
        if(!pluginManifests.has(pluginId)||!pluginEnabled(pluginId))throw canvasAgentToolError("CAPABILITY_UNAVAILABLE",`Plugin ${pluginId} is unavailable or disabled.`);
        if(widgetType === "diagram_source")await ensurePluginRuntime("flowchart");
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
  async function canvasAgentCreate(args) {
    canvasAgentAssertRevision(args.baseRevision);canvasAgentMutationIdle();const prepared=await canvasAgentPrepareCreateItems(args.items);canvasAgentAssertRevision(args.baseRevision);save();
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
  async function canvasAgentVisualExplainerCreate(args) {
    const item=visualExplainerWidgetItem(args.plan,{title:args.title,width:args.width,height:args.height,placement:args.placement}),
      result=await canvasAgentCreate({baseRevision:args.baseRevision,items:[item],summary:args.summary,_changeId:args._changeId}),
      objectId=result.receipts?.[0]?.objectId,object=objectId?canvasAgentObject(objectId):null,
      diagnostics=object?.kind === "widget"?await visualExplainerWaitForDiagnostics(object.item):null;
    return {...result,visualExplainer:{objectId,frameworkVersion:VISUAL_EXPLAINER_FRAMEWORK_VERSION,diagnostics}};
  }
  async function canvasAgentVisualExplainerUpdate(args) {
    canvasAgentAssertRevision(args.baseRevision);canvasAgentMutationIdle();
    const object=canvasAgentObject(String(args.objectId||""));
    if(!object||object.kind!=="widget")throw canvasAgentToolError("OBJECT_NOT_FOUND","Visual Explainer Widget was not found.",{objectId:args.objectId});
    if(object.item.widgetType!=="html_widget"||object.item.pluginId!=="general"||object.item.sourceFormat!==VISUAL_EXPLAINER_SOURCE_FORMAT)throw canvasAgentToolError("KIND_MISMATCH","The target is not a PenEcho Visual Explainer Widget.",{objectId:args.objectId});
    const previousDiagnostics=object.item.visualDiagnostics?structuredClone(object.item.visualDiagnostics):await visualExplainerWaitForDiagnostics(object.item,1200),
      generated=visualExplainerWidgetItem(args.plan,{title:args.title||object.item.title}),currentEdit=widgetEditContext(object.item,"agent"),expectedHash=await canvasAgentHash(currentEdit),
      command={tool:"html_widget",widgetType:"html_widget",pluginId:"general",title:generated.title,refreshSeconds:0,html:generated.html,sourceFormat:generated.sourceFormat,frameworkVersion:generated.frameworkVersion,copyText:generated.copyText,copyLabel:generated.copyLabel,x:object.item.x,y:object.item.y,w:object.item.w,h:object.item.h};
    const result=await canvasAgentReplaceWidget({objectId:object.item.id,baseRevision:args.baseRevision,expectedHash,changeId:args._changeId,command}),updated=canvasAgentObject(object.item.id),
      diagnostics=updated?.kind === "widget"?await visualExplainerWaitForDiagnostics(updated.item):null;
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
  async function canvasAgentEdit(args) {
    canvasAgentAssertRevision(args.baseRevision);canvasAgentMutationIdle();const prepared=await canvasAgentPrepareEditOperations(args.operations);canvasAgentAssertRevision(args.baseRevision);save();
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
  async function canvasAgentInternalWidget(args) {
    const object = canvasAgentObject(String(args.objectId || ""));
    if (!object || object.kind !== "widget") throw Error("Widget was not found.");
    const parentWidgetEdit = widgetEditContext(object.item,"agent"),hash=await canvasAgentHash(parentWidgetEdit);
    if(object.item.sourceFormat===VISUAL_EXPLAINER_SOURCE_FORMAT&&args.artifactId){
      let plan;try{plan=JSON.parse(object.item.copyText||"");}catch{throw Error("Visual Explainer source is invalid.");}
      const widgetEdit=visualExplainerArtifactWidgetEdit(plan,args.artifactId,{x:object.item.x,y:object.item.y,w:object.item.w,h:object.item.h});
      return {revision:state.userRevision,widgetEdit,hash,containerSourceFormat:VISUAL_EXPLAINER_SOURCE_FORMAT,artifactId:String(args.artifactId)};
    }
    return { revision:state.userRevision, widgetEdit:parentWidgetEdit, hash, containerSourceFormat:object.item.sourceFormat||null };
  }
  async function canvasAgentPatchVisualExplainer(args) {
    canvasAgentAssertRevision(args.baseRevision);canvasAgentMutationIdle();const object=canvasAgentObject(String(args.objectId||""));
    if(!object||object.kind!=="widget")throw Error("Visual Explainer Widget was not found.");
    if(object.item.sourceFormat!==VISUAL_EXPLAINER_SOURCE_FORMAT)throw Error("The target is not a Visual Explainer Widget.");
    const currentEdit=widgetEditContext(object.item,"agent");if(await canvasAgentHash(currentEdit)!==String(args.expectedHash||""))throw Error("Visual Explainer changed after it was read. Read it again before patching.");
    let plan;
    if(args.artifactId){let currentPlan;try{currentPlan=JSON.parse(object.item.copyText||"");}catch{throw Error("Visual Explainer source is invalid.");}plan=visualExplainerReplaceArtifact(currentPlan,args.artifactId,args.command);}
    else plan=visualExplainerNormalizePlan(args.plan);
    const generated=visualExplainerWidgetItem(plan,{title:object.item.title}),command={tool:"html_widget",widgetType:"html_widget",pluginId:"general",title:generated.title,refreshSeconds:0,html:generated.html,sourceFormat:generated.sourceFormat,frameworkVersion:generated.frameworkVersion,copyText:generated.copyText,copyLabel:generated.copyLabel,x:object.item.x,y:object.item.y,w:object.item.w,h:object.item.h};
    const result=await canvasAgentReplaceWidget({objectId:object.item.id,baseRevision:args.baseRevision,expectedHash:args.expectedHash,changeId:args.changeId,command}),updated=canvasAgentObject(object.item.id),diagnostics=updated?.kind==="widget"?await visualExplainerWaitForDiagnostics(updated.item):null;
    return {...result,summary:String(args.summary||""),visualExplainer:{objectId:object.item.id,frameworkVersion:VISUAL_EXPLAINER_FRAMEWORK_VERSION,patchedArtifactId:args.artifactId||null,diagnostics}};
  }
  async function canvasAgentReplaceWidget(args) {
    canvasAgentAssertRevision(args.baseRevision);
    canvasAgentMutationIdle();
    const object = canvasAgentObject(String(args.objectId || ""));
    if (!object || object.kind !== "widget") throw Error("Widget was not found.");
    const currentEdit = widgetEditContext(object.item,"agent");
    if (await canvasAgentHash(currentEdit) !== String(args.expectedHash || "")) throw Error("Widget changed after it was read. Read it again before patching.");
    const command = args.command;
    if (!command || command.pluginId !== object.item.pluginId || !["html_widget","diagram_source"].includes(command.tool)) throw Error("Patched widget command is invalid.");
    const record = widgetRecord({...command,id:object.item.id,widgetType:command.tool,contentW:object.item.contentW,contentH:object.item.contentH});
    if (!record) throw Error("Patched widget content was rejected by Canvas validation.");
    save();
    state.widgetHistoryBefore = serializedWidgets();
    const index = state.widgets.indexOf(object.item);
    unmountWidget(object.item);
    state.widgets[index] = record;
    mountWidget(record);
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
  function canvasAgentSetView(args) {
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
  function canvasAgentRevert(args) {
    const latest=canvasAgent.latestChange;
    if(!latest||String(args.changeId||"")!==latest.changeId)throw canvasAgentToolError("REVERT_NOT_LATEST","Only the latest Canvas Agent change can be reverted.",{latestChangeId:latest?.changeId||null});
    if(state.userRevision!==latest.revision||state.history.at(-1)!==latest.historyEntry)throw canvasAgentToolError("REVERT_CONFLICT","Canvas changed after this Agent change, so it can no longer be reverted safely.",{changeRevision:latest.revision,currentRevision:state.userRevision});
    const previousRevision=state.userRevision;state.userRevision++;undo();canvasAgent.latestChange=null;requestRender();canvasAgentSyncState();return{ok:true,revertedChangeId:latest.changeId,previousRevision,revision:state.userRevision};
  }
  async function canvasAgentExecuteTool(payload) {
    const name = String(payload?.name || ""), args = payload?.arguments || {};
    const cacheKey=String(payload?.callId||"");let signature="";
    try {
      signature=await canvasAgentHash({name,args});
      const cached=cacheKey?canvasAgent.toolResultCache.get(cacheKey):null;
      if(cached){
        if(cached.signature!==signature){canvasAgentSendEnvelope("tool_result",{requestId:payload?.requestId,ok:false,error:{code:"CALL_ID_CONFLICT",message:"A Canvas tool callId was reused with different arguments.",details:null}});return;}
        canvasAgentSendEnvelope("tool_result",{requestId:payload.requestId,...cached.envelope});return;
      }
      let result;
      if (name === "project_approval") result = await canvasAgentRequestApproval(args);
      else {
        canvasAgentAssertToolKeys(name,args);
        if (name === "canvas_inspect") result = await canvasAgentInspect(args);
      else if (name === "canvas_read") result = await canvasAgentRead(args);
      else if (name === "canvas_capture") result = await canvasAgentCapture(args);
      else if (name === "canvas_create") result = await canvasAgentCreate({...args,_changeId:payload.callId});
      else if (name === "canvas_visual_explainer_create") result = await canvasAgentVisualExplainerCreate({...args,_changeId:payload.callId});
      else if (name === "canvas_visual_explainer_update") result = await canvasAgentVisualExplainerUpdate({...args,_changeId:payload.callId});
      else if (name === "canvas_edit") result = await canvasAgentEdit({...args,_changeId:payload.callId});
      else if (name === "canvas_set_view") result = canvasAgentSetView(args);
      else if (name === "canvas_revert") result = canvasAgentRevert(args);
      else if (name === "canvas_internal_widget") result = await canvasAgentInternalWidget(args);
      else if (name === "canvas_internal_replace_widget") result = await canvasAgentReplaceWidget(args);
      else if (name === "canvas_internal_patch_visual_explainer") result = await canvasAgentPatchVisualExplainer(args);
      else throw Error(`Unknown Canvas Agent tool: ${name}.`);
      }
      const envelope={ok:true,result};if(cacheKey&&signature){canvasAgent.toolResultCache.set(cacheKey,{signature,envelope});if(canvasAgent.toolResultCache.size>20)canvasAgent.toolResultCache.delete(canvasAgent.toolResultCache.keys().next().value);}canvasAgentSendEnvelope("tool_result",{requestId:payload.requestId,...envelope});
    } catch (error) {
      const envelope={ok:false,error:{code:String(error?.code||"CANVAS_TOOL_FAILED"),message:String(error?.message||error).slice(0,1600),details:error?.details||null}};if(cacheKey&&signature){canvasAgent.toolResultCache.set(cacheKey,{signature,envelope});if(canvasAgent.toolResultCache.size>20)canvasAgent.toolResultCache.delete(canvasAgent.toolResultCache.keys().next().value);}canvasAgentSendEnvelope("tool_result",{requestId:payload?.requestId,...envelope});
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
    if (!canvasAgentAvailable()) return;
    canvasAgentCancelPanelMotion();
    canvasAgentPanel.hidden = false;
    canvasAgentPanel.classList.add("canvas-agent-motion-target");
    canvasAgentPanel.setAttribute("aria-hidden","false");
    canvasAgentToggle.setAttribute("aria-expanded","true");
    document.body.classList.add("canvas-agent-open");
    canvasAgentSyncTriggerState();
    canvasAgent.panelMotionFrame=requestAnimationFrame(()=>{
      canvasAgent.panelMotionFrame=0;
      canvasAgentRestorePanelSize();
      canvasAgentRestorePanelPosition();
      canvasAgentAnimatePanel(true,canvasAgentPanel.getBoundingClientRect(),focus?()=>
        (canvasAgent.inputMode==="ink"?canvasAgentInkCanvas:canvasAgentInput).focus():null);
    });
    canvasAgentSyncState();
    void canvasAgentConnect().catch(error=>canvasAgentSetStatus(String(error?.message||error),"error"));
  }
  function closeCanvasAgent() {
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
    canvasAgentToggle.focus();
    canvasAgentAnimatePanel(false,panelRect);
  }
  canvasAgentToggle.hidden = !canvasAgentAvailable();
  canvasAgentToggle.addEventListener("click",()=>canvasAgentPanel.hidden ? openCanvasAgent() : closeCanvasAgent());
  canvasAgentClose.addEventListener("click",closeCanvasAgent);
  canvasAgentProjectButton.addEventListener("click",()=>{
    if(!canvasAgentProjectPopover.hidden){canvasAgentHideProjectPopover();return;}
    canvasAgentHideHistoryPopover();
    canvasAgentProjectPopover.hidden=false;
    canvasAgentProjectButton.setAttribute("aria-expanded","true");
    canvasAgentRenderProjects();
    void canvasAgentEnsureProjects({refresh:true}).catch(error=>canvasAgentSetProjectError(String(error?.message||error)));
    void canvasAgentEnsureProjectRoots({refresh:true}).catch(error=>{canvasAgent.projectRoots=[];canvasAgent.projectRootsLoaded=true;canvasAgentRenderProjectRoots();canvasAgentSetProjectError(String(error?.message||error));});
  });
  canvasAgentProjectClose.addEventListener("click",canvasAgentHideProjectPopover);
  canvasAgentProjectAddFile.addEventListener("click",()=>void canvasAgentAddProjectFile());
  canvasAgentProjectUpload.addEventListener("click",()=>{if(!canvasAgent.projectUploadBusy){canvasAgentProjectUploadInput.value="";canvasAgentProjectUploadInput.click();}});
  canvasAgentProjectUploadInput.addEventListener("change",()=>void canvasAgentUploadProjectFile(canvasAgentProjectUploadInput.files?.[0]));
  canvasAgentProjectRootBack.addEventListener("click",()=>void canvasAgentNavigateProjectRootBack());
  canvasAgentProjectRootSelect.addEventListener("click",()=>void canvasAgentSelectProjectRoot());
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
  canvasAgentSize.addEventListener("click",canvasAgentCyclePanelHeight);
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
    if (!canvasAgentProjectPopover.hidden) {
      event.preventDefault();
      canvasAgentHideProjectPopover();
      canvasAgentProjectButton.focus();
      return;
    }
    event.preventDefault();
    closeCanvasAgent();
  });
  document.addEventListener("pointerdown",event=>{
    if (!canvasAgentHistoryPopover.hidden&&!canvasAgentHistoryPopover.contains(event.target)&&!canvasAgentHistory.contains(event.target)) canvasAgentHideHistoryPopover();
    if (!canvasAgentProjectPopover.hidden&&!canvasAgentProjectPopover.contains(event.target)&&!canvasAgentProjectButton.contains(event.target)) canvasAgentHideProjectPopover();
    if (!canvasAgentReferencePicker.hidden&&!canvasAgentReferencePicker.contains(event.target)&&!canvasAgentReference.contains(event.target)) canvasAgentToggleReferencePicker(false);
  });
  canvasAgentStop.addEventListener("click",()=>{
    canvasAgentResolveApproval(false);
    try { canvasAgentSendEnvelope("cancel",{}); } catch {}
  });
  canvasAgentAttach.addEventListener("click",()=>{
    canvasAgentImageInput.value = "";
    canvasAgentImageInput.click();
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
  canvasAgentImageInput.addEventListener("change",()=>void canvasAgentAddAttachments([...canvasAgentImageInput.files]));
  canvasAgentNew.addEventListener("click",async()=>{
    try {
      await canvasAgentStartNewConversation(selectedAiConnectionId());
    } catch (error) { canvasAgentSetStatus(String(error?.message||error),"error"); }
  });
  canvasAgentForm.addEventListener("submit",async event=>{
    event.preventDefault();
    if (canvasAgent.attachmentBusy) {
      canvasAgentSetStatus(t("canvasAgentImagePreparing"),"connecting");
      return;
    }
    const text = canvasAgentInput.value.trim(), attachments = [...canvasAgent.attachments], hasInk=canvasAgent.inkPresent;
    if (!text && !attachments.length&&!hasInk) return;
    if (hasInk&&attachments.length>=CANVAS_AGENT_MAX_ATTACHMENTS) {
      canvasAgentSetStatus(t("canvasAgentInkImageLimit"),"error");
      return;
    }
    let requestSent = false;
    canvasAgentBeginRequest();
    canvasAgentInput.disabled = true;
    canvasAgentInkCanvas.setAttribute("aria-disabled","true");
    canvasAgentSend.disabled = true;
    canvasAgentAttach.disabled = true;
    canvasAgentReference.disabled = true;
    try {
      const inkAttachment=hasInk?await canvasAgentPrepareInkAttachment():null, outgoingAttachments=inkAttachment?[...attachments,inkAttachment]:attachments;
      const prompt=inkAttachment
        ? [text,t("canvasAgentInkPrompt")].filter(Boolean).join("\n\n")
        : text||t("canvasAgentImagePrompt"), displayText=text||(inkAttachment?t("canvasAgentInkOnly"):t("canvasAgentImageOnly"));
      await canvasAgentConnect();
      await canvasAgentEnsureSearchSession();
      canvasAgentSyncState();
      canvasAgentRow("user",displayText,outgoingAttachments);
      canvasAgentSendRequest(canvasAgent.running ? "steer" : "user_turn",{text:prompt,references:canvasAgentTurnReferences(),images:outgoingAttachments.map(attachment=>attachment.wire),webSearchEnabled:canvasAgent.searchEnabled});
      requestSent = true;
      canvasAgentInput.value = "";
      canvasAgentClearAttachments();
      canvasAgentClearInkDraft();
      canvasAgentClearReferences();
    } catch (error) {
      if (!requestSent) canvasAgentRequestDidNotSend();
      canvasAgentSetStatus(String(error?.message||error),"error");
    }
    finally {
      canvasAgentInput.disabled=false;
      canvasAgentInkCanvas.removeAttribute("aria-disabled");
      canvasAgentSend.disabled=false;
      canvasAgentAttach.disabled=false;
      canvasAgentReference.disabled=false;
      (canvasAgent.inputMode==="ink"?canvasAgentInkCanvas:canvasAgentInput).focus();
    }
  });
  canvasAgentInput.addEventListener("input",canvasAgentSyncInputHint);
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
    if ([...(event.dataTransfer?.items || [])].some(item=>item.kind === "file" && String(item.type || "").startsWith("image/"))) event.preventDefault();
  });
  canvasAgentPanel.addEventListener("drop",event=>{
    const images = [...(event.dataTransfer?.files || [])].filter(file=>String(file.type || "").startsWith("image/"));
    if (!images.length) return;
    event.preventDefault();
    void canvasAgentAddAttachments(images);
  });
  for (const type of ["pointerdown","pointermove","pointerup","pointercancel","wheel"]) canvasAgentPanel.addEventListener(type,event=>event.stopPropagation(),{passive:type === "wheel"});
  canvasAgentPanel.addEventListener("focusin",canvasAgentPauseAutomaticAI);
  canvasAgentPanel.addEventListener("focusout",()=>queueMicrotask(canvasAgentResumeAutomaticAI));
  canvasAgentTranscript.addEventListener("scroll",canvasAgentSyncFollowLatest,{passive:true});
  canvasAgentTranscript.addEventListener("wheel",event=>{
    if (event.deltaY < 0) canvasAgent.followLatest = false;
  },{passive:true});
  document.addEventListener("paste",event=>{
    if (canvasAgentPanel.hidden) return;
    const target = event.target, outsideEditable = target instanceof Element && !canvasAgentPanel.contains(target) && (target.isContentEditable || Boolean(target.closest("input, textarea, select")));
    if (outsideEditable) return;
    const images = [...(event.clipboardData?.items || [])].filter(item=>String(item.type || "").startsWith("image/")).map(item=>item.getAsFile()).filter(Boolean);
    if (!images.length) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void canvasAgentAddAttachments(images);
  },true);
  if (typeof ResizeObserver==="function") new ResizeObserver(canvasAgentSchedulePanelSizeSave).observe(canvasAgentPanel);
  window.addEventListener("resize",()=>requestAnimationFrame(()=>{canvasAgentRestorePanelSize();canvasAgentRestorePanelPosition();}),{passive:true});
  window.addEventListener("beforeunload",canvasAgentPersistCurrentConversation);
  canvasAgentUpdateSearchButton();
  canvasAgentRenderProjects();
  canvasAgentCanvasDidChange();
