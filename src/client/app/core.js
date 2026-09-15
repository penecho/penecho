"use strict";
(() => {
  function peButton(element, type = "secondary", density = "standard") {
    if (!element) return element;
    element.dataset.peButton = type;
    if (density) element.dataset.peDensity = density;
    return element;
  }
  function peChoice(element) {
    if (element) element.dataset.peHit = "choice";
    return element;
  }
  const SIZE = 20000,
    TILE = 512,
    DIRTY_MASK_SCALE = 0.25,
    INITIAL_CANVAS_SCALE = 0.5,
    CANVAS_DOWNLOAD_RESOLUTION_SCALE = 1.5,
    EXPORT_MAX_DIMENSION = 16384,
    EXPORT_MAX_PIXELS = 64 * 1024 * 1024,
    MAX_ATLAS_WIDTH = 2048,
    MAX_ATLAS_HEIGHT = 1536,
    FOCUS_INSET_ENABLED = false,
    MAX_LASSO_POINTS = 4096,
    MAX_HISTORY = 30,
    DEFAULT_AUTO_DELAY = 5000,
    DEFAULT_AI_TIMEOUT = 260000,
    PEN_SIZE_MIN = 3,
    PEN_SIZE_MAX = 8,
    screen = document.querySelector("#screen"),
    view = document.querySelector("#viewport"),
    canvasNavigationLock = document.querySelector("#canvasNavigationLock"),
    canvasViewButton = document.querySelector("#canvasViewBtn"),
    canvasViewActions = document.querySelector("#canvasViewActions"),
    canvasViewShareButton = document.querySelector("#canvasViewShareBtn"),
    canvasViewDownloadButton = document.querySelector("#canvasViewDownloadBtn"),
    canvasViewCloseButton = document.querySelector("#canvasViewCloseBtn"),
    eraserToolControl = document.querySelector("#eraserToolControl"),
    eraserToolButton = document.querySelector("#eraserToolBtn"),
    eraserToolMenu = document.querySelector("#eraserToolMenu"),
    eraserFreehandButton = document.querySelector("#eraserFreehandBtn"),
    eraserAreaButton = document.querySelector("#eraserAreaBtn"),
    ctx = screen.getContext("2d"),
    animationLayer = document.querySelector("#animationLayer"),
    animationCtx = animationLayer.getContext("2d"),
    widgetLayer = document.querySelector("#widgetLayer"),
    selectedWidgetMaterial = document.querySelector("#selectedWidgetMaterial"),
    placedContentLayer = document.querySelector("#placedContentLayer"),
    placedContentCtx = placedContentLayer.getContext("2d"),
    textContentLayer = document.querySelector("#textContentLayer"),
    textContentCtx = textContentLayer.getContext("2d"),
    summonLayer = document.querySelector("#summonLayer"),
    inkLayer = document.querySelector("#inkLayer"),
    inkCtx = inkLayer.getContext("2d"),
    liveInkLayer = document.querySelector("#liveInkLayer"),
    liveInkCtx = liveInkLayer.getContext("2d"),
    interactionLayer = document.querySelector("#interactionLayer"),
    interactionCtx = interactionLayer.getContext("2d"),
    objectChromeLayer = document.querySelector("#objectChromeLayer"),
    animationControls = document.querySelector("#animationControls"),
    animationPlayPause = document.querySelector("#animationPlayPause"),
    animationRestart = document.querySelector("#animationRestart"),
    animationDelete = document.querySelector("#animationDelete"),
    pluginButton = document.querySelector("#pluginButton"),
    pluginPopover = document.querySelector("#pluginPopover"),
    pluginOptions = document.querySelector("#pluginOptions"),
    pluginClose = document.querySelector("#pluginClose"),
    pluginRefresh = document.querySelector("#pluginRefresh"),
    pluginLocalTab = document.querySelector("#pluginLocalTab"),
    pluginCreateTab = document.querySelector("#pluginCreateTab"),
    pluginServerTab = document.querySelector("#pluginServerTab"),
    pluginLocalPanel = document.querySelector("#pluginLocalPanel"),
    pluginCreatePanel = document.querySelector("#pluginCreatePanel"),
    pluginServerPanel = document.querySelector("#pluginServerPanel"),
    pluginLocalCount = document.querySelector("#pluginLocalCount"),
    pluginCatalogStatus = document.querySelector("#pluginCatalogStatus"),
    pluginCreateForm = document.querySelector("#pluginCreateForm"),
    pluginSimpleTemplate = document.querySelector("#pluginSimpleTemplate"),
    pluginTitle = document.querySelector("#pluginTitle"),
    pluginDocumentEditor = document.querySelector("#pluginDocumentEditor"),
    pluginDocumentBytes = document.querySelector("#pluginDocumentBytes"),
    pluginStylesEditor = document.querySelector("#pluginStylesEditor"),
    pluginStylesUploadButton = document.querySelector("#pluginStylesUploadButton"),
    pluginStylesUpload = document.querySelector("#pluginStylesUpload"),
    pluginStylesBytes = document.querySelector("#pluginStylesBytes"),
    pluginStylesPreview = document.querySelector("#pluginStylesPreview"),
    pluginDocumentStatus = document.querySelector("#pluginDocumentStatus"),
    pluginImprove = document.querySelector("#pluginImprove"),
    pluginSave = document.querySelector("#pluginSave"),
    status = document.querySelector("#status"),
    coords = document.querySelector("#coords"),
    canvasHint = document.querySelector("#canvasHint"),
    canvasWelcome = document.querySelector("#canvasWelcome"),
    debugList = document.querySelector("#debugEvents"),
    debugRequest = document.querySelector("#debugRequest"),
    embodiment = document.querySelector("#aiEmbodiment"),
    aiOrb = document.querySelector("#aiOrb"),
    selectionOverlayLayer = document.querySelector("#selectionOverlayLayer"),
    selectionToolbar = document.querySelector("#selectionToolbar"),
    selectionTypesetButton = document.querySelector("#selectionTypesetBtn"),
    selectionDeleteButton = document.querySelector("#selectionDeleteBtn"),
    selectionCancelButton = document.querySelector("#selectionCancelBtn"),
    imagePickerButton = document.querySelector("#imagePickerBtn"),
    clipboardCopyButton = document.querySelector("#clipboardCopyBtn"),
    imagePickerInput = document.querySelector("#imagePickerInput"),
    imageMaterialLayer = document.querySelector("#imageMaterialLayer"),
    imageSelectionMaterial = document.querySelector("#imageSelectionMaterial"),
    textEditorLayer = document.querySelector("#textEditorLayer"),
    textInputHint = document.querySelector("#textInputHint"),
    tourMain = document.querySelector("main"),
    tourLayer = document.querySelector("#tourLayer"),
    tourHighlight = document.querySelector("#tourHighlight"),
    tourCard = document.querySelector("#tourCard"),
    tourBadge = document.querySelector(".tour-badge"),
    tourProgress = document.querySelector("#tourProgress"),
    tourProgressTrack = document.querySelector("#tourProgressTrack"),
    tourProgressBar = document.querySelector("#tourProgressBar"),
    tourTitle = document.querySelector("#tourTitle"),
    tourBody = document.querySelector("#tourBody"),
    tourBackButton = document.querySelector("#tourBack"),
    tourNextButton = document.querySelector("#tourNext"),
    tourSkipButton = document.querySelector("#tourSkip"),
    changelogLayer = document.querySelector("#changelogLayer"),
    changelogDialog = document.querySelector("#changelogDialog"),
    changelogCloseButton = document.querySelector("#changelogClose"),
    settingsLayer = document.querySelector("#settingsLayer"),
    settingsBackdrop = document.querySelector("#settingsBackdrop"),
    settingsPanel = document.querySelector("#settingsPanel"),
    settingsButton = document.querySelector("#settingsBtn"),
    settingsCloseButton = document.querySelector("#settingsClose"),
    settingsOpenApi = document.querySelector("#settingsOpenApi"),
    settingsOpenSearch = document.querySelector("#settingsOpenSearch"),
    settingsSearchEntryStatus = document.querySelector("#settingsSearchEntryStatus"),
    settingsOpenSystem = document.querySelector("#settingsOpenSystem"),
    configurationLayer = document.querySelector("#configurationLayer"),
    configurationBackdrop = document.querySelector("#configurationBackdrop"),
    configurationPanel = document.querySelector("#configurationPanel"),
    configurationBody = document.querySelector("#configurationBody"),
    configurationTitle = document.querySelector("#configurationTitle"),
    configurationSubtitle = document.querySelector("#configurationSubtitle"),
    configurationClose = document.querySelector("#configurationClose"),
    connectionManager = document.querySelector("#connectionManager"),
    connectionLimitText = document.querySelector("#connectionLimitText"),
    settingsConnectionList = document.querySelector("#settingsConnectionList"),
    settingsConnectionQuickList = document.querySelector("#settingsConnectionQuickList"),
    settingsConnectionStatus = document.querySelector("#settingsConnectionStatus"),
    settingsAddConnection = document.querySelector("#settingsAddConnection"),
    canvasSettingsForm = document.querySelector("#canvasSettingsForm"),
    settingsProvider = document.querySelector("#settingsProvider"),
    settingsApiFields = document.querySelector("#settingsApiFields"),
    settingsApiPresetFields = document.querySelector("#settingsApiPresetFields"),
    settingsApiRegion = document.querySelector("#settingsApiRegion"),
    settingsApiService = document.querySelector("#settingsApiService"),
    settingsKimiSignup = document.querySelector("#settingsKimiSignup"),
    settingsKimiSignupLink = document.querySelector("#settingsKimiSignupLink"),
    settingsCliFields = document.querySelector("#settingsCliFields"),
    settingsKimiCliRecommendation = document.querySelector("#settingsKimiCliRecommendation"),
    settingsCliModel = document.querySelector("#settingsCliModel"),
    settingsCliPath = document.querySelector("#settingsCliPath"),
    settingsCliStatus = document.querySelector("#settingsCliStatus"),
    settingsCliStatusTitle = document.querySelector("#settingsCliStatusTitle"),
    settingsCliStatusDetail = document.querySelector("#settingsCliStatusDetail"),
    settingsCliCommandRow = document.querySelector("#settingsCliCommandRow"),
    settingsCliCommand = document.querySelector("#settingsCliCommand"),
    settingsCliCopyCommand = document.querySelector("#settingsCliCopyCommand"),
    settingsApiFormat = document.querySelector("#settingsApiFormat"),
    settingsApiUrl = document.querySelector("#settingsApiUrl"),
    settingsApiModel = document.querySelector("#settingsApiModel"),
    settingsApiModelOptions = document.querySelector("#settingsApiModelOptions"),
    settingsApiModelPresets = document.querySelector("#settingsApiModelPresets"),
    settingsFetchModels = document.querySelector("#settingsFetchModels"),
    settingsFetchModelsLabel = settingsFetchModels?.querySelector("[data-i18n='settingsFetchModels']"),
    settingsApiKey = document.querySelector("#settingsApiKey"),
    settingsApiSaved = document.querySelector("#settingsApiSaved"),
    settingsDeepSeekSearchProvider = document.querySelector("#settingsDeepSeekSearchProvider"),
    settingsOpenCodeGoSearchSetup = document.querySelector("#settingsOpenCodeGoSearchSetup"),
    settingsDeepSeekSearchApiKey = document.querySelector("#settingsDeepSeekSearchApiKey"),
    settingsDeepSeekSearchSaved = document.querySelector("#settingsDeepSeekSearchSaved"),
    settingsTavilyApiKey = document.querySelector("#settingsTavilyApiKey"),
    settingsTavilySaved = document.querySelector("#settingsTavilySaved"),
    settingsSearchTestResults = document.querySelector("#settingsSearchTestResults"),
    settingsSearchTestFlashLabel = document.querySelector("#settingsSearchTestFlashLabel"),
    settingsEffort = document.querySelector("#settingsEffort"),
    settingsEffortCombobox = document.querySelector("#settingsEffortCombobox"),
    settingsEffortToggle = document.querySelector("#settingsEffortToggle"),
    settingsEffortOptions = document.querySelector("#settingsEffortOptions"),
    settingsMaxTokens = document.querySelector("#settingsMaxTokens"),
    settingsAgentTurnLimit = document.querySelector("#settingsAgentTurnLimit"),
    settingsTimeout = document.querySelector("#settingsTimeout"),
    settingsAutoDelay = document.querySelector("#settingsAutoDelay"),
    settingsImageFormat = document.querySelector("#settingsImageFormat"),
    settingsTraceToggle = document.querySelector("#settingsTraceToggle"),
    settingsTraceLimit = document.querySelector("#settingsTraceLimit"),
    settingsSaveButton = document.querySelector("#settingsSave"),
    settingsTestConnection = document.querySelector("#settingsTestConnection"),
    settingsTestSearch = document.querySelector("#settingsTestSearch"),
    settingsInstallCli = document.querySelector("#settingsInstallCli"),
    settingsEditorCancel = document.querySelector("#settingsEditorCancel"),
    settingsSaveStatus = document.querySelector("#settingsSaveStatus"),
    settingsAutoToggle = document.querySelector("#settingsAutoToggle"),
    settingsCanvasAgentAutoOpenToggle = document.querySelector("#settingsCanvasAgentAutoOpenToggle"),
    settingsWidgetShadowToggle = document.querySelector("#settingsWidgetShadowToggle"),
    summonToggle = document.querySelector("#summonToggle"),
    settingsTourButton = document.querySelector("#settingsTourBtn"),
    settingsChangelogButton = document.querySelector("#settingsChangelogBtn");

  function clampPenWidth(value) {
    const width = Number(value);
    if (!Number.isFinite(width)) return PEN_SIZE_MIN;
    return Math.max(PEN_SIZE_MIN, Math.min(PEN_SIZE_MAX, width));
  }
  const ZH = window.PENECHO_LOCALES?.zh || {};
  const DRAW = window.PENECHO_DRAW;
  const SELECT = window.PENECHO_SELECTION;
  const TOUR = window.PENECHO_TOUR;
  const MIXED_TEXT = window.PENECHO_MIXED_TEXT;
  const ANIMATION = window.PENECHO_ANIMATION;
  const PLUGINS = window.PENECHO_PLUGINS;
  const SUMMON = window.PENECHO_SUMMON;
  const API_PRESETS = Object.freeze({
    "kimi-global-api":Object.freeze({ family:"kimi", region:"global", service:"api", format:"openai", url:"https://api.moonshot.ai/v1", model:"kimi-k3" }),
    "kimi-china-api":Object.freeze({ family:"kimi", region:"china", service:"api", format:"openai", url:"https://api.moonshot.cn/v1", model:"kimi-k3" }),
    "kimi-global-coding":Object.freeze({ family:"kimi", region:"global", service:"coding", format:"openai", url:"https://api.kimi.com/coding/v1", model:"k3" }),
    "kimi-china-coding":Object.freeze({ family:"kimi", region:"china", service:"coding", format:"openai", url:"https://api.kimi.com/coding/v1", model:"k3" }),
    "minimax-global-api":Object.freeze({ family:"minimax", region:"global", service:"api", format:"openai", url:"https://api.minimax.io/v1", model:"MiniMax-M3" }),
    "minimax-china-api":Object.freeze({ family:"minimax", region:"china", service:"api", format:"openai", url:"https://api.minimaxi.com/v1", model:"MiniMax-M3" }),
    "minimax-global-coding":Object.freeze({ family:"minimax", region:"global", service:"coding", format:"anthropic", url:"https://api.minimax.io/anthropic", model:"MiniMax-M3" }),
    "minimax-china-coding":Object.freeze({ family:"minimax", region:"china", service:"coding", format:"anthropic", url:"https://api.minimaxi.com/anthropic", model:"MiniMax-M3" }),
  });
  const KIMI_SIGNUP = Object.freeze({
    api:Object.freeze({
      global:Object.freeze({ url:"https://platform.kimi.ai?aff=penecho", label:"settingsKimiApiSignupGlobal" }),
      china:Object.freeze({ url:"https://platform.kimi.com?aff=penecho", label:"settingsKimiApiSignupChina" }),
    }),
    coding:Object.freeze({ url:"https://www.kimi.com/code?aff=penecho", label:"settingsKimiCodingSignup" }),
  });
  const API_DEFAULTS = Object.freeze({
    openai:Object.freeze({ format:"openai", url:"https://api.openai.com/v1", model:"gpt-5.6-sol" }),
    anthropic:Object.freeze({ format:"anthropic", url:"https://api.anthropic.com", model:"claude-opus-4-8" }),
  });
  const API_MODELS = Object.freeze({
    openai:Object.freeze(["gpt-5.6-sol"]),
    anthropic:Object.freeze(["claude-opus-4-8"]),
    kimi:Object.freeze(["k3", "kimi-k3"]),
    minimax:Object.freeze(["MiniMax-M3", "MiniMax-M2.7"]),
  });
  const AI_FONT_STORAGE_KEY = "penecho-ai-font",
    AI_FONT_HANDWRITTEN = "Bradley Hand, Segoe Print, Comic Sans MS, cursive",
    AI_FONT_HANDWRITTEN_LEGACY = "Segoe Print, Comic Sans MS, cursive",
    AI_FONT_OPTIONS = new Set([
      "ui-rounded, system-ui, sans-serif",
      AI_FONT_HANDWRITTEN,
      "Georgia, serif",
      "system-ui, sans-serif",
    ]),
    TEXT_EDITOR_DEFAULT_WIDTH = 320,
    TEXT_EDITOR_DEFAULT_HEIGHT = 168,
    TEXT_EDITOR_MIN_WIDTH = 170,
    TEXT_EDITOR_MIN_HEIGHT = 96,
    TEXT_EDITOR_FONT_CSS = 17,
    TEXT_EDITOR_PREVIEW_INTERVAL_MS = 80,
    TEXT_EDITOR_FONT_FAMILY = "ui-rounded, system-ui, sans-serif",
    TEXT_INPUT_GUARD_MS = 500,
    TEXT_INPUT_MAX_LENGTH = 2000,
    MAX_VISIBLE_TEXT_BOXES = 50,
    MIXED_FORMULA_MAX_LENGTH = 512,
    AI_TEXT_MAX_LENGTH = 1000,
    COPY_STATUS_MS = 1600,
    NAVIGATION_HINT_VISIBLE_MS = 10000,
    CANVAS_CHROME_MATERIAL_RESTORE_MS = 1000,
    CANVAS_AGENT_NAVIGATION_RESTORE_MS = 500,
    ANIMATION_CONTROLS_VISIBLE_MS = 10000;
  function normalizeToolbarReasoningEffort(value) {
    if (typeof value !== "string") return "";
    const effort = value.trim().toLowerCase();
    return effort && effort.length <= 128 && !/[\r\n\0]/.test(effort) ? effort : "";
  }
  const MAX_SHARP_OVERLAY_PIXELS = 8000000,
    MAX_SHARP_OVERLAY_ITEM_PIXELS = 2500000,
    MAX_VISIBLE_ANIMATIONS = 100,
    MAX_VISIBLE_WIDGETS = 100,
    MAX_VISIBLE_IMAGES = 100,
    MAX_IMAGE_SOURCE_BYTES = 32 * 1024 * 1024,
    MAX_IMAGE_DIMENSION = 2048,
    MAX_IMAGE_PIXELS = 16 * 1024 * 1024,
    MAX_WIDGET_HTML_LENGTH = 200000,
    MAX_WIDGET_COPY_TEXT_LENGTH = 16000,
    MAX_VISUAL_EXPLAINER_SOURCE_LENGTH = 240000,
    MAX_DIAGRAM_SOURCE_BYTES = 100 * 1024,
    MAX_WIDGET_CONTENT_DIMENSION = 1000000,
    WIDGET_SNAPSHOT_TIMEOUT_MS = 20000,
    WIDGET_HISTORY_SNAPSHOT_WAIT_MS = 3000;
  const PLUGIN_TEMPLATE_DOCUMENTS = Object.freeze({
    simple: `---
penecho-plugin: 1
id: air-quality
name: Air Quality
name-zh: 空气质量
version: 1
description: Show air quality for a place in a live canvas widget.
description-zh: 根据地点在画布组件中显示空气质量。
category: Environment
category-zh: 环境
source: Public web API
connect:
recommended-refresh-seconds: 900
---

# Air Quality

我需要根据地点, 显示空气质量.

## Output contract

Return exactly one html_widget command and no prose, with pluginId:"air-quality". Generate a complete responsive HTML document that uses the place from the user's request, displays the most important air-quality information clearly, matches the current PenEcho theme when host context exposes it, and keeps the outer layout transparent by default. Use a contained opaque or translucent surface only when it materially improves legibility or semantic grouping.

## Runtime rules

The generated HTML must fetch data directly in the user's browser, own its refresh timer, and show loading, error, and last-update states. Improve with AI before saving so this draft gains exact browser-accessible API origins, endpoint URLs, parameters, response fields, and instructions for constructing and using those URLs inside the HTML.

## One-shot example

User writes “我需要根据地点, 显示空气质量”, names a place, and points to an empty area. Produce one html_widget there that uses that place in its API requests and displays the resulting air-quality information in large readable type.`,
  });
  const PLUGIN_TEMPLATE_STYLES = Object.freeze({ simple:"" });
  const I18N = {
    en: {
      title: "PenEcho | Handwritten AI Canvas",
      language: "Language",
      hintPrefix: "Hint",
      guideStudio: "Studio assistant",
      boardTools: "Board tools",
      canvasViewHand: "Move canvas",
      canvasViewSelect: "Select a widget to interact",
      widgetMaximize: "Maximize",
      widgetReturnToCanvas: "Interact on canvas",
      imageZoomOut: "Zoom out",
      imageZoomIn: "Zoom in",
      widgetInteract: "Interact with widget",
      widgetInteractShort: "Interact",
      widgetInteracting: "Interacting",
      widgetExitInteraction: "Exit interaction",
      canvasNavigationActions: "Canvas navigation",
      canvasFitContents: "Fit all content",
      canvasWheelZoom: "Use scrolling to zoom",
      canvasWheelZoomHelp: "Off: scroll to pan; pinch or Ctrl/Cmd + scroll to zoom. Turning this on also changes trackpad scrolling.",
      hand: "Hand: move the canvas (H)",
      handAutoAIManual: "Hand mode pauses Auto AI · Use the AI button to run it manually.",
      handAutoAIResume: "Auto AI resumes when you leave Hand mode.",
      handWidgetConfirmedHint: "Widget confirmed · Tap it again to reveal its controls.",
      handImageConfirmedHint: "Placed as a movable image · It stays separate from the canvas and can be moved again.",
      handImageMergedHint: "Merged into the canvas · The eraser can erase it, but it can no longer move as an image.",
      handAnimationConfirmedHint: "Animation confirmed · Tap it again to move, resize, or play.",
      handTextConfirmedHint: "Text confirmed · Tap it again to edit, move, or resize.",
      handDraftConfirmedHint: "AI result confirmed · Auto AI remains paused in Hand.",
      pen: "Pen",
      enterCanvasViewMode: "View canvas",
      exitCanvasViewMode: "Exit view mode",
      canvasViewModeActions: "View mode actions",
      eraser: "Eraser",
      eraserOptions: "Eraser options",
      areaEraser: "Area erase",
      select: "Select objects or lasso ink (V)",
      text: "Text input",
      textMixedMode: "Preview Markdown + LaTeX formatting",
      textMixedModeShort: "Preview",
      textEditMode: "Return to editing",
      textPreview: "Markdown and LaTeX preview",
      textConfirm: "Confirm text",
      textCancel: "Discard text",
      textPlaceholder: "Type text or a formula",
      textConfirmHint: "to confirm",
      textEmpty: "Enter some text first",
      textMixedModeError: "Mixed formatting was unavailable; plain text was inserted",
      textHelp: "Text formatting help",
      addImage: "Add image or photo",
      copyFromClipboard: "Copy text or image from clipboard",
      clipboardReading: "Reading clipboard...",
      clipboardTextAdded: "Clipboard text added. Move or resize the text box, then confirm.",
      clipboardUnsupported: "Clipboard format not supported. Copy plain text or an image.",
      clipboardReadFailed: "Could not read the clipboard. Allow clipboard access or use Ctrl/Cmd+V.",
      imageLoading: "Preparing image...",
      imageAdded: "Image added",
      imageSelected: "Editing image: drag its top toolbar to move it, or use the edge handles to resize",
      imagePlaced: "Placed as a movable image · It stays separate from the canvas and can be moved again",
      imageMerged: "Merged into the canvas · The eraser can erase it, but it can no longer move as an image",
      imagePlace: "Place image",
      imagePlaceHint: "Keep it separate from the canvas so it can be moved again later",
      imageMerge: "Merge into ink",
      imageMergeHint: "Fuse it into the canvas; the eraser can erase it, but it can no longer move as an image",
      imageDelete: "Delete image",
      imageDeleteHint: "Remove this image from the canvas",
      imageDeleted: "Image deleted",
      imageLimitReached: "Image limit reached (100). Delete an image before adding another.",
      imageTooLarge: "The selected image is too large (32 MB maximum)",
      imageUnsupported: "This image format could not be opened",
      imageImportFailed: "The image could not be added",
      textHelpTitle: "Markdown + LaTeX",
      textHelpClose: "Close text help",
      textHelpIntro: "Type normally; line breaks are preserved. Markdown and likely LaTeX are formatted automatically when confirmed; Preview shows the result.",
      textHelpMarkdown: "Use # for headings, - for lists, **text** for bold, and *text* for italic.",
      textHelpMath: "You may use $...$, but common bare TeX such as \\pi, \\frac{a}{b}, A_x, and \\sin(x) is recognized too.",
      textHelpExampleTitle: "Example",
      textHelpExample: "# Kinematics\n**Speed:** $v=\\frac{d}{t}$\n- Area: $A=\\pi r^2$",
      penSize: "Pen size",
      autoAI: "Auto AI",
      autoEnabled: "Auto ({delay}s)",
      autoDisabled: "Manual AI",
      autoDelay: "Auto AI delay",
      autoToolboxPending: "Auto AI paused: settle the open toolbox or trigger AI manually",
      aiTools: "AI tools",
      grid: "Canvas grid",
      gridOn: "Show canvas grid",
      gridOff: "Hide canvas grid",
      canvasLockNavigation: "Lock canvas navigation",
      canvasUnlockNavigation: "Unlock canvas navigation",
      canvasNavigationLockedHint: "Canvas view locked · Click the top-left lock to unlock",
      researchGridDefault: "Research grid (off by default)",
      font: "Font",
      aiFont: "AI font",
      reasoningEffort: "Reasoning effort",
      reasoningEffortDisplay: "Reasoning ({level})",
      effortCustom: "Custom reasoning effort",
      effortCustomPlaceholder: "Custom value",
      effortApplyCustom: "Use custom reasoning effort",
      effortConfigured: "Configured",
      effortConfiguredShort: "Conf",
      effortNone: "None",
      effortLow: "Low",
      effortMedium: "Medium",
      effortMediumShort: "Med",
      effortHigh: "High",
      effortMaximum: "Max",
      inkColor: "Ink color",
      customColor: "Custom…",
      customColorApply: "Apply",
      customColorCancel: "Cancel",
      fontRounded: "Rounded",
      fontHand: "Handwritten",
      fontSerif: "Classic serif",
      fontSans: "Sans serif",
      aiColor: "AI color",
      colorBlue: "Blue",
      colorBlack: "Ink black",
      colorRed: "Red",
      colorOrange: "Orange",
      colorGold: "Gold",
      colorGreen: "Green",
      colorCyan: "Cyan",
      colorPurple: "Purple",
      undo: "Undo",
      redo: "Redo",
      fullscreen: "Fullscreen",
      exitFullscreen: "Exit fullscreen",
      clear: "Clear",
      debug: "Debug",
      canvas: "Zoomable handwritten AI canvas",
      aiGuide: "AI knowledge guide",
      triggerAutoAI: "Run Auto AI now",
      stopAIRequest: "Stop current AI request",
      answer: "Answer",
      hint: "Hint",
      continue: "Continue",
      explain: "Explain",
      plot: "Plot",
      tip: "Pan: two-finger scroll, Hand, or Space + drag · Zoom: pinch or Ctrl/Cmd + scroll",
      tourReplay: "Feature tour",
      tourDialog: "PenEcho feature tour",
      tourBadge: "Quick tour",
      tourBadgeNew: "What's new",
      tourProgress: "Tour progress",
      tourStepCounter: "Step {current} of {total}",
      tourSkip: "Skip tour",
      tourBack: "Back",
      tourNext: "Next",
      tourDone: "Finish",
      tourCanvasAgentLauncherTitle: "Open PenEcho Agent",
      tourMcpTitle: "Bring external AI onto your canvas",
      tourMcpBody: "Connect Codex, Claude, or another MCP-compatible AI to create and edit canvas content. Set it up in Settings → MCP service, then use this button to connect or disconnect. Give the AI your request in its own app.",
      tourCanvasAgentLauncherBody: "On larger screens, use the Agent control at the right end of the toolbar. On narrow screens, use the floating button at the lower right. Start multi-step work with folders, files, web research, and the current canvas.",
      tourCanvasAgentPanelTitle: "Work in the Agent panel",
      tourCanvasAgentPanelBody: "PenEcho Agent opens as a right sidebar on larger screens and a bottom panel on narrow screens. Type or handwrite a request, add files or a read-only folder project, reference a Widget, and enable web search when available. Resize the desktop sidebar from its left edge.",
      tourEffortTitle: "Choose how deeply AI reasons",
      tourEffortBody: "AI Effort controls the reasoning depth used for each request. Higher levels suit difficult derivations and multi-step problems, but can take longer. Configured uses the default selected in your local setup.",
      tourHandTitle: "Move the canvas anywhere",
      tourHandBody: "Hand moves the canvas even over a large widget. Click a widget for its toolbar. Use Select to arrange objects or enter widget interaction.",
      tourLassoTitle: "Work with exactly the content you select",
      tourLassoBody: "With a mouse or stylus, draw a closed loop around handwriting. Drag the selected region to move it; use the right edge, bottom edge, or lower-right corner to resize it. The selection toolbar can typeset handwriting, delete it, or cancel. Selection-scoped AI requests do not reference the rest of the canvas.",
      tourTextTitle: "Add editable text and formulas",
      tourTextBody: "Choose Text, then click the canvas to create an input box. Markdown and likely LaTeX are formatted automatically; Preview shows the exact placement before confirmation. Confirm with the check button or Ctrl/Cmd + Enter.",
      tourImageTitle: "Add images and photos",
      tourImageBody: "Add a picture from your device; large pictures are compressed automatically. In Hand, tap it to reveal move and resize controls. Place keeps it below ink, while Merge makes it erasable.",
      tourFullscreenTitle: "Give the canvas the whole screen",
      tourFullscreenBody: "Fullscreen hides surrounding browser space and expands the drawing area. Use the same button—or your browser's fullscreen shortcut—to return.",
      tourFavoritesTitle: "Add something from Favorites",
      tourFavoritesBody: "Use the star button to open your Echoes favorites. Add a favorite Widget to the current Canvas, or open a favorite Canvas here as a new Canvas.",
      tourShareCanvasTitle: "Publish this Canvas to Echoes",
      tourShareCanvasBody: "Share opens a preview and publishing form for the current Canvas. After signing in, review its details before making it public in Echoes, then copy its link or share it as an image. Use Cloud instead for private saves.",
      tourCloudTitle: "Keep private work in PenEcho Cloud",
      tourCloudBody: "Open Cloud to sign in, save and reopen private versioned Canvases by project, and use favorite Canvases or Widgets from Echoes in your current Canvas.",
      tourManualAITitle: "Run Auto AI on demand",
      tourManualAIBody: "Click the magic orb to run the same prompt used by Auto AI immediately. It uses the current canvas context—or only the lasso selection when one is active.",
      tourStatusTitle: "Follow every AI request and result",
      tourStatusBody: "This status indicator reports when AI is observing, writing, finished, delayed, or needs confirmation. When a multi-part draft is ready, nearby controls let you accept or discard the complete response.",
      tourCanvasTitle: "Navigate the large canvas",
      tourCanvasBody: "Write with a mouse or stylus. Pan with one finger, the middle mouse button, or Alt-drag. Zoom with a wheel or trackpad, and pinch with two fingers. Your pointer position and zoom level are shown below the canvas.",
      changelogDialog: "PenEcho release notes",
      changelogClose: "Close release notes",
      changelogBadge: "What's new",
      changelogTitle: "Create with Canvas Agent and MCP",
      changelogCanvasAgent: "Canvas Agent works with your canvas, files, and web sources to create and refine editable visual content. Continue the conversation to build on your results.",
      changelogMcpCanvases: "Connect external AI tools through MCP to create and update Canvas documents. Find their canvases in the Navigator and follow the latest updates.",
      changelogCloudMcp: "New Cloud MCP lets external AI agents such as Codex and Claude connect to your enabled PenEcho Cloud canvases to read content, create and edit results, and follow your handwritten feedback. Cloud MCP and Local MCP are optional connection paths.",
      changelogFrostedStudio: "A simpler frosted Studio brings the toolbar, Navigator, Agent, settings, and dialogs into one restrained visual system. Translucent materials, fine hairlines, and lighter controls keep the Canvas visible and the workspace easy to scan.",
      changelogPerformance: "Drawing, erasing, panning, and zooming feel more immediate. Low-latency live ink and coordinated frame work keep Widgets live and restore sharper text after movement.",
      changelogKeyboardShortcuts: "Customizable keyboard shortcuts are now available in Settings for focusing the Agent, saving, undo and redo, opening the Canvas Library, fullscreen, and Settings.",
      settingsTitle: "Settings",
      settingsClose: "Close settings",
      settingsSubtitle: "Choose a category, then adjust its settings without leaving this window.",
      settingsNavigation: "Settings categories",
      settingsNavAppearance: "Appearance",
      settingsNavConnections: "AI & connections",
      settingsNavCanvas: "Canvas",
      settingsNavShortcuts: "Keyboard shortcuts",
      settingsNavAbout: "Help & about",
      settingsShortcuts: "Keyboard shortcuts",
      settingsShortcutsHelp: "Choose a command, then press the keys you want to use.",
      settingsShortcutInstructions: "Press Escape to cancel. Press Backspace or Delete to remove a shortcut.",
      settingsShortcutResetAll: "Reset all",
      settingsShortcutGroupEssential: "Essentials",
      settingsShortcutGroupWorkspace: "Workspace",
      settingsShortcutNotSet: "Not set",
      settingsShortcutPressKeys: "Press keys…",
      settingsShortcutEdit: "Change shortcut for {command}",
      settingsShortcutReset: "Reset shortcut for {command}",
      settingsShortcutRecording: "Press a new shortcut for {command}.",
      settingsShortcutConflict: "{shortcut} is already used by {command}.",
      settingsShortcutInvalid: "{shortcut} cannot be used as a shortcut.",
      settingsShortcutReserved: "{shortcut} is reserved by the system or browser.",
      settingsShortcutUpdated: "Shortcut updated for {command}.",
      settingsShortcutCleared: "Shortcut removed for {command}.",
      settingsShortcutResetDone: "Shortcut reset for {command}.",
      settingsShortcutResetAllDone: "All shortcuts were reset.",
      settingsShortcutCancelled: "Shortcut change cancelled.",
      shortcutFocusAgent: "Toggle PenEcho Agent",
      shortcutFocusAgentHelp: "Open or close Agent while Canvas has focus.",
      shortcutSaveCanvasHelp: "Save or overwrite the current Canvas using its existing location.",
      shortcutUndoHelp: "Undo the latest Canvas change.",
      shortcutRedoHelp: "Redo the latest undone Canvas change.",
      shortcutCanvasLibrary: "Canvas Library",
      shortcutCanvasLibraryHelp: "Open saved Canvases and storage locations.",
      shortcutFullscreenHelp: "Enter or leave full-screen Canvas view.",
      shortcutSettingsHelp: "Open Settings from the Canvas workspace.",
      settingsAppearance: "Appearance",
      settingsAppearanceHelp: "Studio stays consistent while its accent and supporting neutrals change together.",
      settingsColorScheme: "Color scheme",
      settingsColorSchemeHelp: "Eight restrained, professional Studio palettes.",
      settingsInterfaceScale: "Interface scale",
      settingsInterfaceScaleHelp: "Scale the application text and controls.",
      studioPaletteIndigo: "Indigo",
      studioPaletteIndigoHelp: "Creative and balanced",
      studioPaletteGraphite: "Graphite",
      studioPaletteGraphiteHelp: "Neutral and distraction-free",
      studioPaletteCobalt: "Cobalt",
      studioPaletteCobaltHelp: "Classic productivity blue",
      studioPaletteAzure: "Azure",
      studioPaletteAzureHelp: "Clear and open",
      studioPaletteTeal: "Teal",
      studioPaletteTealHelp: "Calm and technical",
      studioPaletteForest: "Forest",
      studioPaletteForestHelp: "Focused and grounded",
      studioPaletteAmber: "Amber",
      studioPaletteAmberHelp: "Warm and decisive",
      studioPaletteBurgundy: "Burgundy",
      studioPaletteBurgundyHelp: "Deep and editorial",
      settingsApiSection: "AI connection",
      settingsApiDescription: "Choose an API or an existing local CLI login.",
      settingsProvider: "AI provider",
      settingsCliModel: "Model (optional)",
      settingsCliPath: "Command or path",
      settingsCliHelp: "PenEcho detects the CLI automatically. If one-click installation fails, copy the official command and install it in a terminal.",
      settingsCliChecking: "Checking CLI…",
      settingsCliCheckingDetail: "Looking for a PenEcho-managed or system installation.",
      settingsCliReady: "{provider} is ready",
      settingsCliReadyDetail: "{source} installation{version} passed the local check.",
      settingsCliKimiAuthDeferred: "Authentication will be confirmed by the first Kimi request.",
      settingsCliAuthRequired: "{provider} needs login",
      settingsCliAuthRequiredDetail: "Run the login command in a terminal, then test the connection again.",
      settingsCliMissing: "{provider} is not installed",
      settingsCliMissingDetail: "Use one-click install, or run the official command below yourself.",
      settingsCliRepairRequired: "{provider} needs repair",
      settingsCliRepairRequiredDetail: "The CLI was found but could not start. Rerun the official installer below.",
      settingsCliManaged: "PenEcho-managed",
      settingsCliSystem: "System",
      settingsCliCopyCommand: "Copy command",
      settingsCliCommandCopied: "Command copied.",
      settingsCliInspectionFailed: "CLI check failed",
      settingsCliManualFallback: "The official manual installation command remains available above.",
      settingsKimiCodingRecommendationTitle: "Recommended: connect with the Kimi Coding API",
      settingsKimiCodingRecommendationBody: "Create and copy an API key in the Kimi Code Console, then add an API connection using the OpenAI-compatible format and this Base URL.",
      settingsKimiCodingConsole: "Open Kimi Code Console",
      settingsKimiCodingRecommendationReason: "Kimi CLI may not reliably reuse the Harness context cache, which can increase latency and usage.",
      settingsConfiguration: "Configuration",
      settingsConnections: "AI connections",
      settingsCloudSetupTitle: "Sign in to use cloud connections",
      settingsCloudSignedIn: "Signed in · {balance}",
      settingsLocalConnections: "Local connections",
      settingsLocalConnectionsEmpty: "No local connections yet. Choose Manage to add one.",
      settingsCapabilities: "Capabilities",
      settingsCloudSetupHelp: "Sign in to PenEcho Cloud, then choose a cloud model below. No API key or CLI setup needed.",
      settingsCloudSetupLink: "Sign in",
      settingsHostedModels: "Cloud models",
      settingsHostedRefresh: "Refresh",
      settingsHostedPricing: "How credits are calculated",
      settingsHostedPricingHelp: "Input, cache reads, cache writes and output have separate rates. The displayed multiplier applies to each base rate. Your own connections do not spend PenEcho credits.",
      settingsHostedBilling: "Account & credits ↗",
      settingsHostedBrowserNotice: "Use PenEcho models to edit this Canvas and save to Cloud. Your own connections, local files and device settings need a linked device.",
      settingsLinkedDeviceOffline: "Your linked device is offline. Open PenEcho on that device, then refresh. Cloud models and Cloud Library remain available.",
      canvasAgentCloudContext: "Cloud Canvas",
      canvasAgentCloudContextHelp: "This connection works with the current Canvas. Use a device connection for local folders and files.",
      canvasAgentCloudFileFormats: "Cloud documents: PDF text layer, DOCX, XLSX, CSV, TXT, MD, JSON; up to 8 MiB each. No scanned PDFs or OCR. Files expire 30 days after upload.",
      canvasAgentCloudFileScopeChanged: "This file belongs to another Agent connection or conversation. Remove it and attach it again here. Your draft is kept.",
      canvasAgentCloudFilesHelp: "Cloud Agent accepts images and the current Canvas. For documents or local files, select a device connection. Your draft is kept.",
      settingsHostedLinkDevice: "Link a device ↗",
      settingsHostedLoading: "Loading available models…",
      settingsHostedEmpty: "No PenEcho models are available right now.",
      settingsHostedError: "Could not refresh PenEcho models. Try again.",
      settingsHostedBalance: "{count} credits available",
      settingsHostedRateUnit: "Credits per 1M tokens",
      settingsHostedRateModel: "Model",
      settingsHostedRateMultiplier: "Multiplier",
      settingsHostedRateInput: "Input",
      settingsHostedRateRead: "Cache read",
      settingsHostedRateOutput: "Output",
      settingsManage: "Manage",
      settingsApiEntry: "API & CLI settings",
      settingsApiEntryHelp: "Changes apply immediately",
      settingsSystemEntry: "System settings",
      settingsSystemEntryHelp: "Restart required after saving",
      settingsPluginsEntryHelp: "Manage AI capabilities",
      settingsSearchEntry: "Internet search",
      settingsSearchDeepSeekReady: "Flash search + DuckDuckGo + built-in ready",
      settingsSearchAllReady: "Flash search + Tavily + DuckDuckGo + built-in ready",
      settingsSearchTavilyReady: "Tavily + DuckDuckGo + built-in ready",
      settingsSearchNotConfigured: "DuckDuckGo + built-in search ready · Flash or Tavily optional",
      settingsApiDialogTitle: "API & CLI settings",
      settingsApiDialogSubtitle: "Manage your saved connections and choose which one to use on this device. Changes take effect immediately.",
      settingsSearchDialogTitle: "Internet search",
      settingsSearchDialogSubtitle: "Choose DeepSeek official or OpenCode Go for native Flash search; Tavily, DuckDuckGo, research, GitHub, and stock search remain available as backups.",
      settingsConnectionEditor: "Connection details",
      settingsEffortToolbarHelp: "You can quickly change reasoning for any request from the Canvas toolbar.",
      settingsEffortSuggestions: "Reasoning suggestions",
      settingsShowEffortSuggestions: "Show reasoning suggestions",
      settingsSavedConnections: "Saved connections",
      settingsConnectionCount: "{count} of {limit} connections",
      settingsAddConnection: "Add connection",
      settingsSaveConnection: "Save connection",
      settingsTestConnection: "Test connection",
      settingsTestingConnection: "Testing the model with a small image request…",
      settingsConnectionTestPassed: "Connection ready. The model accepted the image and responded successfully.",
      settingsConnectionTestFailed: "Connection test failed.",
      settingsInstallCli: "Install CLI",
      settingsRepairCli: "Repair CLI",
      settingsInstallingCli: "Downloading, verifying, and installing the official CLI…",
      settingsCliInstalled: "CLI installed. Testing the connection again…",
      settingsCliInstallFailed: "Automatic CLI installation failed.",
      settingsCancel: "Cancel",
      settingsActive: "Current",
      settingsUse: "Use",
      settingsEdit: "Edit",
      settingsDelete: "Delete",
      settingsDefaultConnection: "Default connection",
      settingsApiSummary: "{model} · {url}",
      settingsCliSummary: "{provider} · {model}",
      settingsCliDefaultModel: "CLI default model",
      settingsConnectionActivated: "Connection changed. New requests will use it immediately.",
      settingsConnectionDeleted: "Connection deleted.",
      settingsConnectionSaved: "Connection saved. Devices using it will apply the changes to new requests immediately.",
      settingsDeleteConfirm: "Delete this connection?",
      settingsFetchModels: "Fetch models",
      settingsFetchingModels: "Fetching models…",
      settingsModelsFetched: "Found {count} models. Choose one or keep typing.",
      settingsModelFetchFailed: "Could not fetch models from the provider.",
      settingsModelSuggestions: "Available models",
      settingsSystemDialogTitle: "System settings",
      settingsSystemDialogSubtitle: "Saved changes take effect after PenEcho restarts.",
      settingsKeySaved: "Key saved",
      settingsApiFormat: "API format",
      settingsApiRegion: "Access region",
      settingsApiRegionGlobal: "Global",
      settingsApiRegionChina: "Mainland China",
      settingsApiService: "Service",
      settingsApiServiceApi: "API",
      settingsApiServiceCoding: "Coding Plan",
      settingsKimiPartner: "PenEcho is a Kimi 2026 Open Source Partner.",
      settingsKimiApiSignupGlobal: "Get a Kimi API key for Global access",
      settingsKimiApiSignupChina: "Get a Kimi API key for Mainland China",
      settingsKimiCodingSignup: "Get a Kimi Coding Plan API key",
      settingsApiModel: "Model",
      settingsApiUrl: "Base URL",
      settingsApiKey: "API key",
      settingsApiKeyHelp: "Stored only in the local PenEcho configuration file.",
      settingsSearchSection: "Internet search",
      settingsSearchDescription: "On by default. DeepSeek Flash or Tavily can be added, while DuckDuckGo, research, GitHub, and stock search remain available as backups.",
      settingsDeepSeekSearchProvider: "Flash key provider",
      settingsDeepSeekSearchProviderOfficial: "DeepSeek official",
      settingsDeepSeekSearchProviderOpenCodeGo: "OpenCode Go",
      settingsDeepSeekSearchProviderHelp: "Choose where this key was issued. PenEcho automatically sends native Flash search to the matching endpoint.",
      settingsOpenCodeGoSearchSetupTitle: "OpenCode Go setup",
      settingsOpenCodeGoSearchSetupBody: "Open the Go page in your current OpenCode Workspace, enable China-hosted DeepSeek models, then copy the Go API key and paste it below.",
      settingsOpenCodeGoSearchSetupLink: "Open OpenCode Go",
      settingsDeepSeekSearchApiKey: "Flash search API key",
      settingsDeepSeekSearchApiKeyHelp: "Preferred current-web provider. Each search uses a separate DeepSeek V4 Flash model turn with native web search; the key stays local until search is enabled and called.",
      settingsSearchTestStatusTitle: "Current search status",
      settingsTestSearch: "Test search",
      settingsTestingSearch: "Testing search…",
      settingsSearchTestFlashLabel: "Flash native search ({provider})",
      settingsSearchTestNotTested: "Not tested",
      settingsSearchTestNotConfigured: "Not configured",
      settingsSearchTestTesting: "Testing…",
      settingsSearchTestAvailable: "Available · result returned",
      settingsSearchTestRegionAccessRequired: "Enable China-hosted model",
      settingsSearchTestHttpError: "Unavailable · HTTP {status}",
      settingsSearchTestNoResults: "No usable results",
      settingsSearchTestRequestFailed: "Unavailable",
      settingsSearchTestTimeout: "Timed out",
      settingsSearchTestFailed: "Could not test search providers.",
      settingsSearchTestComplete: "Search test finished.",
      settingsDeepSeekSearchApiKeySavedPlaceholder: "Paste a new key or leave blank to keep the saved key",
      settingsDeepSeekSearchSaved: "Flash key saved",
      settingsTavilyApiKey: "Tavily API key",
      settingsTavilyApiKeyHelp: "Optional fallback web-search provider. Stored locally and sent only from the PenEcho service to Tavily when search is enabled and called.",
      settingsTavilyApiKeySavedPlaceholder: "Paste a new key or leave blank to keep the saved key",
      settingsTavilySaved: "Tavily saved",
      settingsDuckDuckGoReady: "DuckDuckGo fallback ready",
      settingsSaveSearch: "Save search",
      settingsSearchSaved: "Search settings saved. Internet search is on by default and can be turned off with the globe button.",
      settingsEffort: "Reasoning",
      settingsMaxTokens: "Maximum response tokens",
      settingsMaxTokensHelp: "Includes thinking tokens. Default 63,000; must be larger than 15,000. Low limits may be exhausted during reasoning.",
      settingsAgentTurnLimit: "PenEcho Agent rounds per request",
      settingsAgentTurnLimitUnit: "rounds",
      settingsAgentTurnLimitHelp: "Stops only the current request at the limit. Results and conversation stay available so the next message can continue. Default 100.",
      settingsTimeout: "No-activity timeout",
      settingsTimeoutHelp: "Resets when model output, tool activity, or progress arrives. There is no fixed total-time limit.",
      settingsAutoDelay: "Auto AI delay",
      settingsImageFormat: "Canvas image",
      settingsTraceLimit: "Keep request traces",
      settingsRequestTrace: "Record request details",
      settingsSave: "Save settings",
      settingsLoading: "Loading settings…",
      settingsLoadFailed: "Could not load settings.",
      settingsSaving: "Saving…",
      settingsProviderApplied: "Saved and applied. New AI requests will use this connection immediately—no restart required.",
      settingsSystemSaved: "Saved. Restart PenEcho to apply these system changes.",
      settingsCanvasSection: "Canvas preferences",
      settingsCanvasAgentAutoOpen: "Open PenEcho Agent with each canvas",
      settingsWidgetShadow: "Widget & image shadows",
      settingsAISection: "AI",
      settingsSummonSection: "Thinking indicator",
      settingsChangelog: "What's new",
      settingsHelpSection: "Help & about",
      settingsDownloadMac: "Download for macOS",
      settingsDownloadWin: "Download for Windows",
      settingsGitHub: "GitHub repository",
      summonUnderstanding: "Understanding this part of the canvas...",
      summonPhrase1: "I’m following the trail your pen left behind...",
      summonPhrase2: "Give me a moment—I’m fitting the pieces on the canvas together.",
      summonPhrase3: "This deserves another look. I’m still thinking with you.",
      summonPhrase4: "I’m turning the question around to see its other side...",
      summonPhrase5: "No rush. The answer is beginning to take shape.",
      summonPhrase6: "I’m looking for the most honest explanation between these lines.",
      summonPhrase7: "Thinking is not waiting for an answer; it is making the question clearer.",
      summonPhrase8: "The canvas keeps the marks; understanding gives them direction.",
      summonPhrase9: "Every line is a question that has not quite finished speaking.",
      summonPhrase10: "Intelligence may begin with calculation; understanding begins with attention.",
      summonPhrase11: "Let’s turn this hazy idea into something we can both see.",
      summonPhrase12: "An answer is not an ending. It is where the next stroke begins.",
      summonTip1: "Tip: create professional diagrams for engineering, science, software, and business.",
      summonTip2: "Tip: professional diagrams preserve editable source that you can copy into other tools.",
      summonTip3: "Tip: add a few strokes beside a diagram, then use AI Refine to update only that diagram.",
      summonTip4: "Tip: AI Refine tries to preserve the diagram’s format, layout, terminology, and visual style.",
      summonTip5: "Tip: professional diagram renderers load only when needed; simply viewing them uses no model tokens.",
      summonTip6: "Tip: Professional Diagrams is on by default and can be turned off from Plugins.",
      summonTip7: "Tip: Real Photo Search places sourced web photos directly on the canvas.",
      summonTip8: "Tip: use Hand to move and freely resize images, animations, and AI widgets.",
      summonTip9: "Tip: remote images remain included when you save the canvas or export a PNG.",
      summonTip10: "Tip: save a canvas to the PenEcho server so other authorized devices can open it.",
      summonTip11: "Tip: pause a few seconds after writing and AI replies on its own; auto mode can be toggled in Settings.",
      summonTip12: "Tip: click the AI orb on the canvas to manually pick Answer, Hint, Continue, Explain, or Plot.",
      summonTip13: "Tip: circle content with the lasso and AI will work only on that selection.",
      summonTip14: "Tip: the text tool understands Markdown and LaTeX; press Ctrl/Cmd + Enter to confirm.",
      summonTip15: "Tip: AI drafts can be moved as a group, or accepted and discarded item by item.",
      summonTip16: "Tip: raise the Reasoning effort in the toolbar for harder problems.",
      summonTip17: "Tip: plugins add focused capabilities and can be switched off when you do not need them.",
      summonTip18: "Tip: History can update the current snapshot or save a separate new copy.",
      summonTip19: "Tip: scroll to pan; pinch or Ctrl/Cmd + scroll to zoom.",
      summonTip20: "Tip: AI ink color lives in the toolbar; AI font lives in this Settings panel.",
      summonTip21: "Tip: write changes anywhere in this view, then choose a widget and use AI Refine.",
      summonTip22: "Tip: tap a widget, or hover it with a mouse, to reveal AI Refine.",
      summonTip23: "Tip: AI Refine uses the newest strokes, text, and images in this view as instructions.",
      summonTip24: "Tip: use AI Refine to update a widget in place; regular AI adds a new widget.",
      debugTitle: "PenEcho debug",
      openLocalLog: "Open local server log",
      history: "Canvas Library",
      historyTitle: "Canvas Library",
      historySearch: "Search",
      historySearchLabel: "Search Canvas Library",
      historyLibraryLocation: "Library location",
      historyLibraryNavigation: "Canvas Library navigation",
      historyCanvasList: "Canvas Library content",
      historyLocations: "Locations",
      historyProjects: "Projects",
      historyAllCanvases: "All Canvases",
      historyCanvasCount: "{count} Canvases",
      historySortLabel: "Sort Canvases",
      historySortModified: "Last modified",
      historySortName: "Name",
      historySortCreated: "Date created",
      historyView: "Canvas view",
      historyViewList: "List view",
      historyViewGrid: "Grid view",
      historyNewCanvas: "New Canvas",
      historyColumnCanvas: "Canvas",
      historyColumnContents: "Contents",
      historyColumnModified: "Modified",
      historySaveCurrentSection: "Save current Canvas",
      historyMoreActions: "More actions for “{name}”",
      historyNoMatch: "No matching Canvases in this location.",
      historySelectionEmpty: "Select a Canvas to open",
      historyOpenCanvas: "Open Canvas",
      historyDeleteTitle: "Delete this Canvas?",
      studioNavigatorTitle: "Recent work",
      studioNavigatorMcpEmpty: "Canvases connected through MCP will appear here.",
      studioNavigatorOpen: "Open recent work",
      studioNavigatorClose: "Close recent work",
      studioNavigatorSearch: "Search work",
      studioNavigatorAll: "All",
      studioNavigatorAgents: "Agent",
      studioNavigatorCanvases: "Canvases",
      studioNavigatorCurrent: "Current",
      studioNavigatorOpened: "Open",
      studioNavigatorNotOpened: "Not open",
      studioNavigatorRecent: "Recent work",
      studioNavigatorEmpty: "No recent work yet.",
      studioNavigatorNoMatch: "No matching recent work.",
      studioNavigatorAgentEmpty: "No saved Canvas conversations yet.",
      studioNavigatorAgentNoMatch: "No matching conversations.",
      studioNavigatorUnknownCanvas: "Saved canvas",
      studioNavigatorDraftCanvas: "Unsaved canvas",
      studioNavigatorSessionCount: "{count} sessions",
      studioNavigatorCanvasUnavailable: "This conversation's canvas is no longer available.",
      studioNavigatorConversationUnavailable: "This conversation is no longer available for the selected canvas.",
      studioNavigatorCanvasEmpty: "No canvases saved in this location yet.",
      studioNavigatorCanvasNoMatch: "No matching canvases.",
      studioNavigatorCanvasLoading: "Loading canvases…",
      studioNavigatorMessageCount: "{count} messages",
      studioNavigatorManageAgents: "View all recent work",
      studioNavigatorManageCanvases: "Manage Canvas Library",
      studioNavigatorLibraryShort: "Library",
      studioNavigatorRestored: "Restored {canvas} · continuing {conversation}",
      studioNavigatorDeleteSession: "Delete session “{name}”",
      studioNavigatorDeleteSessionTitle: "Delete session?",
      studioNavigatorDeleteSessionAction: "Delete",
      studioNavigatorDeleteSessionConfirm: "“{name}” will be permanently deleted. This cannot be undone.",
      studioNavigatorDeleteSessionBusy: "Stop the current Agent session before deleting it.",
      studioNavigatorDeleteSessionFailed: "This session could not be deleted. Try again.",
      saveLocation: "Location",
      storageThisDevice: "Device",
      storagePenEchoServer: "Server",
      storagePenEchoCloud: "Cloud",
      storageThisDeviceDescription: "Stored only on this device.",
      storagePenEchoServerDescription: "Stored on this host for authorized users.",
      storagePenEchoCloudDescription: "Private account storage, available on any client.",
      canvasProject: "Project",
      canvasProjectAll: "All projects",
      canvasProjectUncategorized: "No Project",
      canvasProjectNew: "New project",
      canvasProjectDelete: "Delete project",
      canvasProjectMove: "Move to project",
      canvasProjectName: "Project name",
      canvasProjectCreated: "Project created",
      canvasProjectDeleted: "Project deleted; its canvases moved to No Project",
      deleteCloudProjectConfirm: "Delete project “{name}”? Its Canvases will move to No Project and no saved content will be deleted.",
      canvasProjectMoved: "Canvas moved",
      closeHistory: "Close history",
      newCanvas: "New",
      saveCanvas: "Save canvas",
      saveCurrentSnapshot: "Save",
      canvasUntitledName: "Untitled canvas",
      canvasRename: "Rename",
      canvasRenameCurrent: "Rename current canvas",
      canvasRenameNamed: "Rename canvas “{name}”",
      canvasRenameConfirm: "Confirm rename",
      canvasNamePlaceholder: "Canvas name",
      canvasNameRequired: "Enter a canvas name.",
      canvasRenamed: "Canvas renamed",
      canvasSaveStateUnsaved: "Not saved",
      canvasSaveStateSaved: "Saved",
      canvasSaveStateEdited: "Edited",
      canvasSaveStateSaving: "Saving…",
      canvasWelcomeKicker: "start here",
      canvasWelcomeTitle: "Start sketching, or create with AI",
      canvasWelcomeBody: "Ask PenEcho Agent, or connect an external AI via MCP to create and edit canvas content.",
      canvasBrowserWelcomeTitle: "Start sketching on your Cloud Canvas",
      canvasBrowserWelcomeBody: "Choose a PenEcho cloud model in Settings to work with this Canvas online. Connect a device to use local files and connections.",
      exportPng: "Export PNG",
      newCanvasTitle: "New canvas",
      closeCanvasTitle: "Close canvas",
      closeCanvasDescription: "Save your changes before closing this canvas?",
      closeWithoutSave: "Close without saving",
      saveAsNewAndClose: "Save as new and close",
      overwriteAndClose: "Save and close",

      newCanvasDescription: "Save this canvas if needed. Unaccepted AI drafts aren't included.",
      loadCanvasTitle: "Load another canvas?",
      loadCanvasDescription: "Save changes before loading another canvas.",
      currentSnapshot: "Current snapshot: {name} · {location}",
      noCurrentSnapshot: "There is no current snapshot to overwrite.",
      currentSnapshotOtherLocation: "Current snapshot {name} is in {location}. Select that location to overwrite it.",
      newSnapshotName: "Name",
      cancel: "Cancel",
      newWithoutSave: "Don't save",
      saveAsNewAndCreate: "Save as new",
      overwriteAndCreate: "Overwrite current",
      loadWithoutSave: "Load without saving",
      saveAsNewAndLoad: "Save as new and load",
      overwriteAndLoad: "Save and load",
      snapshotName: "Name (optional)",
      saveSnapshot: "Save copy",
      snapshotSaving: "Saving canvas...",
      snapshotSavingShort: "Saving...",
      snapshotLibraryLoading: "Loading {location} canvases…",
      snapshotLibraryLoadingDetail: "The previous location is being replaced with verified items.",
      snapshotLibraryUnavailable: "{location} canvases are unavailable",
      snapshotLibraryRetryDetail: "The connection could not be reached. Try again in a moment.",
      snapshotLibraryRetry: "Try again",
      snapshotLibraryCacheRetained: "Previously loaded canvases are still shown. Retry to get the latest list.",
      snapshotLibraryLoadFailed: "Could not load {location}. Select the location to try again.",
      snapshotCloudCacheRefreshing: "Showing cached Cloud canvases while the latest version loads.",
      snapshotCloudCacheLoadFailed: "Cloud is unavailable. Cached canvases remain visible; select Cloud to try again.",
      snapshotCloudSignInRequired: "Sign in to view Cloud canvases",
      snapshotCloudSignInHint: "Your Cloud projects and canvases appear here once you are signed in.",
      openPenEchoCloud: "Open PenEcho Cloud",
      openPenEchoCloudExternal: "Open PenEcho Cloud in a new tab",
      opensInNewTab: "Opens in a new tab",
      openCloudCanvasUnsaved: "This Canvas has unsaved changes. Opening another Canvas in a new page will not save them. Continue?",
      snapshotLoading: "Loading “{name}”…",
      snapshotLoadingShort: "Loading…",
      snapshotLoadRequesting: "Requesting the saved Canvas…",
      snapshotLoadDownloading: "Downloading saved content…",
      snapshotLoadPreparing: "Preparing Canvas plugins…",
      snapshotLoadDecoding: "Restoring tiles and images…",
      snapshotLoadApplying: "Applying the Canvas safely…",
      snapshotLoadChanged: "The current Canvas changed while another Canvas was loading. Select Load to try again.",
      snapshotLoadFailed: "Loading stopped: {message} Select Load to try again.",
      loadSnapshot: "Load",
      deleteSnapshot: "Delete",
      emptyDeviceHistory: "Nothing saved on this device yet",
      serverHistoryDeviceOffline: "Linked device is offline. Open PenEcho on that device and keep it connected to access its canvases.",
      serverHistoryDeviceRequired: "No linked device. Link a device to access its canvases.",
      emptyServerHistory: "Nothing saved on this server yet",
      emptyCloudHistory: "Nothing saved to Cloud yet",
      emptyProjectHistory: "Nothing saved in this project yet",
      emptyCanvas: "The canvas is empty",
      snapshotSaved: "Canvas snapshot saved",
      snapshotOverwritten: "Current snapshot overwritten",
      cloudCanvasConflict: "This Cloud Canvas changed on another device. The library was refreshed; load the latest version or save your work as a new Canvas.",
      snapshotLoaded: "Canvas snapshot loaded",
      snapshotDeleted: "Canvas snapshot deleted",
      newCanvasReady: "New canvas ready",
      exportComplete: "PNG exported",
      exportError: "Export: ",
      snapshotError: "Canvas history: ",
      snapshotTiles: "canvas tiles",
      historySnapshotTile: "tile",
      historySnapshotTiles: "tiles",
      snapshotImages: "images",
      snapshotModified: "Modified {time}",
      deleteSnapshotConfirmDevice: "Delete this snapshot from this device?",
      deleteSnapshotConfirmServer: "Delete this shared snapshot from the PenEcho server?",
      deleteSnapshotConfirmCloud: "Move this Cloud Canvas to Trash? It remains recoverable from PenEcho Cloud.",
      canvasHintWidgetAdded: "Mark a widget with Pen, then choose AI Refine.",
      canvasHintWidgetFullscreen: "Double-click a widget to maximize it.",
      canvasHintWidgetInline: "Double-click a widget to interact.",
      canvasHintShortcutAgent: "{shortcut}: open or close Agent.",
      canvasHintShortcutSave: "{shortcut}: save canvas.",
      canvasHintShortcutUndoRedo: "{undo}: undo · {redo}: redo.",
      canvasHintShortcutLibrary: "{shortcut}: open Canvas Library.",
      canvasHintShortcutFullscreen: "{shortcut}: toggle fullscreen.",
      canvasHintShortcutSettings: "{shortcut}: open Settings.",
      canvasHintMcp: "Settings → MCP: connect an AI client.",
      canvasHintMcpConnected: "MCP connected: your AI can edit this canvas.",
      canvasHintHand: "Drag to pan; click an object to select.",
      canvasHintHandAlt: "Hold Space to pan temporarily.",
      canvasHintWidgetTouchHand: "Select → Interact: use widget content.",
      canvasHintLasso: "Click an object to move or resize; drag empty canvas to lasso.",
      canvasHintLassoAlt: "Double-click a widget to interact.",
      canvasHintText: "Markdown/LaTeX; Ctrl/Cmd + Enter to confirm.",
      canvasHintTextAlt: "Click the canvas to add text.",
      canvasHintEraser: "Eraser removes ink; Select deletes objects.",
      canvasHintEraserAlt: "Erase AI marks without affecting widgets.",
      canvasHintAreaEraser: "Drag a box to erase ink inside.",
      canvasHintAreaEraserAlt: "Area Eraser affects ink only.",
      ready: "Ready",
      aiBusy: "AI is working. Please wait.",
      noInk: "Write something first",
      cannotCapture: "Could not capture the newest handwriting",
      observing: "Observing...",
      aiPreparingCanvas: "Preparing canvas context...",
      aiSendingRequest: "Sending request...",
      aiRequestReceived: "Request received by PenEcho",
      aiPreparingImage: "Preparing model input...",
      aiConnecting: "Connecting to the model...",
      aiWaitingResponse: "Waiting for the model...",
      aiReceivingResponse: "Receiving model response...",
      aiValidatingResponse: "Checking model response...",
      aiRetrying: "Correcting response · attempt {attempt}",
      aiImageFallback: "Retrying with a compatible image · attempt {attempt}",
      aiStillWaiting: "The model is taking longer than usual · PenEcho timeout {seconds}s",
      aiCancelled: "AI request cancelled",
      aiCancelledForInput: "AI request cancelled because new input started",
      deferred: "New ink found; this AI result was deferred",
      writing: "Writing...",
      aiDone: "AI completed",
      draftRejected: "AI draft discarded",
      draftFading: "Continued writing detected; fading the AI draft",
      canvasChanged: "Canvas changed; the old AI draft was discarded",
      draftReady: "Drag the AI draft to move it; use its handles to resize",
      batchDraftReady: "Accept or discard all",
      itemAccepted: "AI item accepted; remaining drafts are still editable",
      itemDiscarded: "AI item discarded; remaining drafts are still editable",
      copyText: "Copy content",
      textCopied: "Copied",
      textCopyFailed: "Could not copy content",
      rejectBatch: "Discard all AI drafts",
      acceptBatch: "Accept all AI drafts",
      outsideCanvas: "This is outside the canvas. Write on the paper.",
      selectionEmpty: "The selected area has no ink",
      selectionTooSmall: "Draw a larger closed lasso around some ink",
      selectionReady: "Move or resize the selected lasso region",
      selectionCommitted: "Selection applied locally",
      selectionCancelled: "Selection cancelled",
      selectionRecolored: "Selection color changed locally",
      selectionTools: "Selection tools",
      selectionScopeNotice: "AI answers use only this selected region",
      selectionTypeset: "Typeset",
      selectionDelete: "Delete",
      selectionCancel: "Cancel",
      selectionTypesetting: "Typesetting selection...",
      selectionDeleted: "Selected region deleted",
      areaEraseTooSmall: "Drag a larger area to erase",
      areaEraseDeleted: "Ink in the selected area was deleted",
      pendingConfirm: "Confirm or discard the current AI draft first",
      merged: "AI merged",
      plugins: "Plugins",
      savedCrafts: "Favorites",
      savedCraftsTitle: "Favorites",
      savedCraftsSubtitle: "Canvases and Widgets",
      savedType: "Type",
      savedSearch: "Search",
      savedSearchLabel: "Search Favorites",
      savedView: "View",
      savedListView: "List view",
      savedGridView: "Grid view",
      browseEchoes: "Browse Echoes",
      savedCount: "{count} favorites",
      savedLoading: "Loading favorites…",
      savedRefreshing: "Refreshing…",
      savedNoMatches: "No matching favorites.",
      savedEmptyIn: "No favorite Canvases or Widgets yet.",
      savedEmptyOut: "No local favorite Widgets yet. Sign in to see Cloud favorites.",
      savedAdd: "Add",
      savedAdding: "Adding…",
      savedOpen: "Open",
      savedOpening: "Opening…",
      savedCanvas: "Canvas",
      savedWidget: "Widget",
      savedRemoveTitle: "Remove from favorites",
      savedRemoveConfirmTitle: "Remove from favorites?",
      savedRemoveConfirmDescription: "“{name}” will no longer appear in Favorites.",
      savedRemoveAction: "Remove",
      savedSourceLocal: "Local",
      savedSourceCloud: "Cloud",
      savedSourceCommunity: "Cloud community",
      savedSourceSynced: "Cloud + local",
      savedSourceSyncedTitle: "On PenEcho Cloud and this device",
      savedSourceLocalTitle: "On this device only; it uploads to PenEcho Cloud after you sign in",
      savedSourceCloudTitle: "On PenEcho Cloud",
      savedErrorAdd: "This Widget could not be added.",
      savedErrorOpen: "This Canvas could not be opened.",
      savedErrorToggle: "The favorite could not be updated. Try again shortly.",
      closeSavedCrafts: "Close Favorites",
      shareCanvasCloud: "Share Canvas to PenEcho Cloud",
      shareWidget: "Share widget",
      openInNewPage: "Open in a new page",
      openCanvas: "Open Canvas",
      addToCanvas: "Add to Canvas",
      favorites: "Favorites",
      all: "All",
      canvases: "Canvases",
      widgets: "Widgets",
      favoriteCanvases: "Favorite Canvases",
      favoriteWidgets: "Favorite Widgets",
      projects: "Projects",
      explore: "Echoes",
      canvasAgent: "PenEcho Agent",
      openCanvasAgent: "Open PenEcho Agent",
      closeCanvasAgent: "Close PenEcho Agent",
      newCanvasAgentConversation: "New PenEcho Agent conversation",
      canvasAgentAutoAIFocusPaused: "PenEcho Agent is open · Canvas Auto AI is paused.",
      canvasAgentExternalAIPaused: "External conversation selected · Canvas Auto AI is paused. Feedback is kept for the external AI.",
      canvasAgentAutoAIRequestPaused: "PenEcho Agent is working · Canvas Auto AI is paused.",
      canvasAgentProject: "Manage projects and files",
      canvasAgentProjectClose: "Close project manager",
      canvasAgentProjectBoundary: "This version supports read access only. For file safety, modifying files is not supported.",
      canvasAgentWorkspace: "Workspace",
      canvasAgentProjectManager: "Project manager",
      canvasAgentProjectManagerDescription: "Projects are folders. Files are added from the PenEcho Agent composer.",
      canvasAgentProjects: "Projects",
      canvasAgentProjectsDescription: "A project is a folder the Agent can read while working.",
      canvasAgentProjectFolders: "project folders",
      canvasAgentNewProject: "New project",
      canvasAgentCancelProjectCreate: "Cancel",
      canvasAgentNoProjects: "No project folders yet. Create one by choosing a folder.",
      canvasAgentFiles: "Files",
      canvasAgentFilesDescription: "Files already used with PenEcho Agent appear here.",
      canvasAgentKnownFiles: "known files",
      canvasAgentNoFiles: "No files yet. Add one from the chat composer.",
      canvasAgentFilesAddHint: "Add a file from the chat composer, or paste it with Ctrl/Cmd+V.",
      canvasAgentFolderProject: "Folder project",
      canvasAgentUploadedFile: "Uploaded file",
      canvasAgentLocalFile: "Local file",
      canvasAgentCurrentResource: "Current",
      canvasAgentNoProject: "No project",
      canvasAgentClearResource: "Clear selected resource: {name}",
      canvasAgentBrowserSpace: "No project",
      canvasAgentBrowserSpaceDetail: "Use the current canvas without a project or file",
      canvasAgentUploadEmpty: "Choose a non-empty file.",
      canvasAgentUploadTooLarge: "Uploads are limited to 32 MB.",
      canvasAgentFileReadFailed: "The selected file could not be read.",
      canvasAgentFilePreparing: "Copying the file to PenEcho…",
      canvasAgentAttachmentLimit: "A message can include at most five files and images in any combination.",
      canvasAgentFileInstructionRequired: "Add instructions for the attached file or files before sending.",
      canvasAgentFileReadOnly: "Read only",
      canvasAgentRemoveProject: "Remove resource",
      canvasAgentRemoveProjectTitle: "Remove resource?",
      canvasAgentRemoveFolderConfirm: "Remove “{name}” from PenEcho? The folder and its .penecho conversation history will stay on disk.",
      canvasAgentRemoveNativeFileConfirm: "Remove “{name}” from PenEcho? The original file will stay on disk, but its saved project conversations will be deleted.",
      canvasAgentRemoveUploadConfirm: "Delete the uploaded copy “{name}” and its saved project conversations from PenEcho? This cannot be undone.",
      canvasAgentServerFolders: "Choose a project folder",
      canvasAgentServerFoldersDetail: "Select a host folder to register it as a read-only project.",
      canvasAgentNoHostFolders: "No host folders are available",
      canvasAgentRootBack: "Back",
      canvasAgentRootSelect: "Use this folder",
      canvasAgentRootTruncated: "Some folders are not shown.",
      canvasAgentRootLoading: "Loading folders…",
      canvasAgentRootApprovalRequired: "Approval required",
      canvasAgentRootApprovalTitle: "Approve private folder access?",
      canvasAgentRootApprovalDetail: "Allow PenEcho to browse “{name}” for this folder-selection session.",
      canvasAgentRootApprovalReject: "Cancel",
      canvasAgentRootApprovalAllow: "Allow once",
      canvasAgentRootPermissionDenied: "The system denied access. Change the folder's system permissions to use it.",
      canvasAgentApproval: "Authorize project command",
      canvasAgentApprovalTitle: "Authorize critical command?",
      canvasAgentApprovalReject: "Reject",
      canvasAgentApprovalAllow: "Allow once",
      canvasAgentHistory: "Sessions on this Canvas",
      canvasAgentHistoryManageAll: "View all recent work",
      canvasAgentResizeTop: "Resize PenEcho Agent from the top edge",
      canvasAgentResizeBottom: "Resize PenEcho Agent from the bottom edge",
      canvasAgentResizeLeft: "Resize PenEcho Agent from the left edge",
      canvasAgentResizeRight: "Resize PenEcho Agent from the right edge",
      canvasAgentHistoryEmpty: "No saved conversations for this canvas",
      canvasAgentHistoryCurrent: "Current",
      canvasAgentHistoryViewing: "Viewing saved conversation",
      canvasAgentHistoryReturn: "Back to current conversation",
      canvasAgentHistoryUntitled: "New conversation",
      canvasAgentHistoryAttachments: "{count} attachments",
      canvasAgentReadyConnect: "Ready to connect",
      canvasAgentReady: "Ready",
      canvasAgentNoConnections: "No available connections",
      canvasAgentConnectionStale: "This connection is no longer available on the linked device. Choose an AI connection; your draft is kept.",
      canvasAgentConnecting: "Connecting…",
      canvasAgentResumed: "Conversation resumed",
      canvasAgentWorking: "Agent is working…",
      canvasAgentCheckingCodex: "Checking Codex setup…",
      canvasAgentSettingUpCodex: "Setting up Codex for first use…",
      canvasAgentRepairingCodex: "Repairing Codex setup…",
      canvasAgentInitialStatePreparing: "Preparing the initial Canvas state…",
      canvasAgentDisconnected: "Disconnected — send to reconnect",
      canvasAgentErrorBusy: "The AI service is busy, so processing stopped early. Continue shortly.",
      canvasAgentErrorCredits: "Available credits do not cover this request’s reservation. Check Credits & billing.",
      canvasAgentErrorTimeout: "The Agent took too long to respond, so processing stopped early. Continue when ready.",
      canvasAgentErrorRateLimit: "The AI request limit was reached. Continue later.",
      canvasAgentErrorRequestTooLarge: "This request is too large. Reduce its content and try again.",
      canvasAgentErrorAuthentication: "This AI connection needs to be signed in or reconfigured.",
      canvasAgentErrorModelUnavailable: "The selected model is unavailable. Choose another model or connection.",
      canvasAgentErrorConnection: "The AI service could not be reached. Check the connection and try again.",
      canvasAgentErrorGeneric: "The Agent could not finish this request. Open the error details for more information.",
      canvasAgentErrorRequestRejected: "The model service rejected this request (HTTP 400). Open details for the reason; repeating the same request may fail again.",
      canvasAgentErrorViewDetails: "View details",
      canvasAgentErrorCode: "Error code",
      canvasAgentErrorMessage: "Original message",
      canvasAgentEmptyTitle: "Understand what is here, then build on it.",
      canvasAgentEmptyBody: "Use the Canvas, handwriting, Widgets, folders, files, and the web as context. Ask Agent to explain, organize, plan, or update the work directly.",
      canvasAgentInputHint: "Type or use the Pen button to write by hand. Reference a Widget, then ask Agent to extract canvas handwriting, inspect source, arrange content, or edit the Widget.",
      canvasAgentPlaceholder: "Ask PenEcho Agent…",
      canvasAgentMessage: "Message PenEcho Agent",
      canvasAgentChooseConnection: "Choose AI connection",
      canvasAgentModel: "AI model",
      canvasAgentPromptSuggestions: "Suggested prompts",
      canvasAgentPromptSuggestionsTitle: "Try asking",
      canvasAgentPromptSuggestionsHint: "Suggestions adapt to the current context.",
      canvasAgentPromptCategories: "Prompt categories",
      canvasAgentPromptCategoryNotes: "Notes",
      canvasAgentPromptCategoryFiles: "Files & Projects",
      canvasAgentPromptCategoryCreate: "Create",
      canvasAgentPromptDisclosureMore: "More",
      canvasAgentPromptDisclosureLess: "Less",
      canvasAgentPromptMore: "Show suggested prompts",
      canvasAgentPromptLess: "Hide suggested prompts",
      canvasAgentPromptFocusVisual: "Visualize",
      canvasAgentPromptFocusSimplify: "Simplify",
      canvasAgentPromptFocusOrganize: "Organize",
      canvasAgentPromptFocusRevise: "Revise",
      canvasAgentPromptFocusSlides: "Slides",
      canvasAgentPromptFocusAnalyze: "Analyze",
      canvasAgentPromptFocusLearn: "Learn",
      canvasAgentPromptFocusPlan: "Plan",
      canvasAgentPromptFocusExplain: "Explain",
      canvasAgentPromptFocusArchitecture: "Architecture",
      canvasAgentPromptFocusSequence: "Sequence",
      canvasAgentPromptFocusEnhance: "Enhance",
      canvasAgentPromptFocusLayer: "Layer",
      canvasAgentPromptFocusPublish: "Publish",
      canvasAgentPromptFocusFollowCanvasCues: "Follow canvas cues",
      canvasAgentPromptSimpleDiagramTitle: "Simplify the Core Ideas",
      canvasAgentPromptSequenceDiagramSourceTitle: "Create Editable Sequence Diagram",
      canvasAgentPromptOrganizeTitle: "Organize the Current Canvas",
      canvasAgentPromptApplyAnnotationsTitle: "Apply My Canvas Annotations",
      canvasAgentPromptFollowCanvasCuesTitle: "Follow My Canvas Cues",
      canvasAgentPromptCheckWorkTitle: "Find and Mark My Mistakes",
      canvasAgentPromptPptTitle: "Create a Presentation Layout",
      canvasAgentPromptExcelTitle: "Chart Spreadsheet Insights",
      canvasAgentPromptCompareFilesTitle: "Compare Related Files",
      canvasAgentPromptProjectEvidenceTitle: "Find Evidence Across the Project",
      canvasAgentPromptReleaseReadinessTitle: "Review the Project for Release",
      canvasAgentPromptTransformerTitle: "Explain Transformer Architecture",
      canvasAgentPromptUkTripTitle: "Plan a UK Journey",
      canvasAgentPromptInteractivePrototypeTitle: "Build a Clickable Prototype",
      canvasAgentPromptInteractiveCalculatorTitle: "Create an Interactive Calculator",
      canvasAgentPromptSelfCheckQuizTitle: "Make a Self-Check Quiz",
      canvasAgentPromptFileTitle: "Explain the Current File",
      canvasAgentPromptArchitectureTitle: "Map the Project Architecture",
      canvasAgentPromptHandwritingTitle: "Enhance My Handwritten Notes",
      canvasAgentPromptImageVisualTitle: "Explain the Current Image",
      canvasAgentPromptImageLayerTitle: "Annotate the Image Clearly",
      canvasAgentPromptImagePublishTitle: "Publish Insights from Image",
      canvasAgentPromptSpreadsheetVisualTitle: "Visualize Key Spreadsheet Trends",
      canvasAgentPromptSpreadsheetLayerTitle: "Build a Canvas Dashboard",
      canvasAgentPromptSpreadsheetPublishTitle: "Publish Spreadsheet Findings",
      canvasAgentPromptPresentationVisualTitle: "Map the Presentation Story",
      canvasAgentPromptPresentationLayerTitle: "Improve the Presentation Structure",
      canvasAgentPromptPresentationPublishTitle: "Publish the Presentation Summary",
      canvasAgentPromptDocumentVisualTitle: "Map the Document Argument",
      canvasAgentPromptDocumentStudyTitle: "Create Study Notes",
      canvasAgentPromptDocumentPublishTitle: "Publish the Document Findings",
      canvasAgentPromptCodeVisualTitle: "Map the Code Architecture",
      canvasAgentPromptCodeLayerTitle: "Explain the Code Layers",
      canvasAgentPromptCodePlanTitle: "Plan the Next Changes",
      canvasAgentPromptFileLayerTitle: "Add a File Overview",
      canvasAgentPromptFilePublishTitle: "Publish the File Findings",
      canvasAgentPromptProjectPlanTitle: "Plan the Project Work",
      canvasAgentPromptProjectPublishTitle: "Publish the Project Summary",
      canvasAgentPromptSelectionVisualTitle: "Explain the Selected Content",
      canvasAgentPromptSelectionLayerTitle: "Add Context to Selection",
      canvasAgentPromptSelectionPublishTitle: "Publish the Selection Summary",
      canvasAgentPromptNotesVisualTitle: "Structure My Handwritten Notes",
      canvasAgentPromptNotesPublishTitle: "Organize and Publish Notes",
      canvasAgentPromptCanvasVisualTitle: "Explain the Current Canvas",
      canvasAgentPromptCanvasLayerTitle: "Add a Canvas Overview",
      canvasAgentPromptCanvasPublishTitle: "Publish the Canvas Summary",
      canvasAgentPromptFile: "Do not return only a written explanation. Create and display a visual file overview on Canvas showing its purpose, structure, key relationships, and important details. If there is no file, create a visual overview of the current Canvas instead.",
      canvasAgentPromptArchitecture: "Do not return only text. Create and display a visual architecture map on Canvas showing the current project's core modules, dependencies, data flow, and key directories.",
      canvasAgentPromptSimpleDiagram: "Do not only describe the content. Create and display a separate, simple visual diagram on Canvas showing the core concepts, relationships, and essential labels.",
      canvasAgentPromptSequenceDiagramSource: "Do not return only source code. Create and display the rendered sequence diagram on Canvas, then provide its editable Mermaid or PlantUML source in chat—not HTML.",
      canvasAgentPromptPpt: "Turn the current view into a presentation-ready layout and send the final image in chat.",
      canvasAgentPromptHandwriting: "Keep the current handwriting completely unchanged—do not edit, erase, or move it. Add a transparent explanatory layer over it; overlap is acceptable only if the original strokes remain clearly visible, and use annotations, connectors, links, graphics, or motion where appropriate to make the notes more vivid and intuitive.",
      canvasAgentPromptExcel: "Do not return only a written analysis. Create and display visual charts on Canvas for the attached spreadsheet's key metrics, trends, anomalies, and conclusions, then summarize the findings in chat.",
      canvasAgentPromptCompareFiles: "Compare the selected or related files. Do not stop at a written explanation: create a visual comparison on Canvas using a table, relationship map, or annotated highlights. Show meaningful differences, conflicting facts, and missing information, then add a concise chat summary of what to keep or reconcile.",
      canvasAgentPromptProjectEvidence: "Search the current project for evidence related to my question. Do not return only text: create a visual evidence map on Canvas that connects exact files and relevant sections to the findings. Clearly separate confirmed facts from assumptions, then summarize the key conclusions in chat.",
      canvasAgentPromptReleaseReadiness: "Review the current project's changed code, configuration, tests, and documentation. Do not return only a written checklist: create a visual release-readiness board on Canvas that links each prioritized blocker to the affected area. Explain the impact and provide the smallest verification checklist in chat.",
      canvasAgentPromptTransformer: "Do not only explain Transformer in chat. Create and display a layered visual diagram on Canvas with pseudocode, key data flow, and tensor shapes.",
      canvasAgentPromptUkTrip: "Do not return only itinerary text. Create and display a visual 15-day UK travel map on Canvas with daily routes, transport, stays, and highlights.",
      canvasAgentPromptInteractivePrototype: "Do not only describe the design: build and display a working interface prototype on Canvas from the current sketch or requirements. Show the main states visually and include navigation, realistic sample content, essential interactions, and concise supporting annotations.",
      canvasAgentPromptInteractiveCalculator: "Do not only explain how it works: build and display a working interactive calculator on Canvas from the formulas or rules I provide. Use a clear visual layout with labeled inputs, live results, validation, concise explanations, and reset.",
      canvasAgentPromptSelfCheckQuiz: "Do not only outline the questions: build and display an interactive self-check quiz on Canvas from the current notes or attached material. Use a clear visual layout with varied questions, immediate explanations, progress feedback, and retry.",
      canvasAgentPromptOrganize: "Do not only describe how to organize it. Reorganize and display the current Canvas as clear visual notes with themes, hierarchy, and information gaps.",
      canvasAgentPromptApplyAnnotations: "Apply my new Canvas annotations and sketches: add, remove, move, resize, or reconnect only clearly marked content, and ask about ambiguity first.",
      canvasAgentPromptFollowCanvasCues: "Follow my latest Canvas drawings, images, text boxes, and annotations. Continue and refine the work without changing unmarked content; ask if unclear.",
      canvasAgentPromptCheckWork: "Keep my original content unchanged—do not edit, erase, or move it. Review the current page and find every mistake: mark each error in place with a clear, compact annotation, and write the correct answer or steps in a suitable open space nearby, visually linked to its error. Briefly summarize in chat what was wrong and why.",
      canvasAgentPromptImageVisual: "Do not return only text. Create and display a visual analysis on Canvas of the current image's subjects, structure, relationships, important details, and uncertainties.",
      canvasAgentPromptImageLayer: "Keep the image unchanged and add a transparent explanation layer with labels, links, graphics, or motion.",
      canvasAgentPromptImagePublish: "Extract the image's key information; publish visuals to Canvas and send the summary in chat.",
      canvasAgentPromptSpreadsheetVisual: "Do not return only a written analysis. Create and display visual charts on Canvas showing the spreadsheet's metrics, trends, anomalies, field relationships, and data quality.",
      canvasAgentPromptSpreadsheetLayer: "Keep the source data and add a Canvas dashboard with metric cards, charts, and explanations.",
      canvasAgentPromptSpreadsheetPublish: "Organize conclusions, risks, and next steps; put charts on Canvas and the summary in chat.",
      canvasAgentPromptPresentationVisual: "Do not only summarize the presentation in chat. Create and display a visual overview diagram on Canvas connecting its structure and key conclusions.",
      canvasAgentPromptPresentationLayer: "Preserve the meaning, unify the deck, and add essential diagrams and explanation layers.",
      canvasAgentPromptPresentationPublish: "Create a speaking outline, slide revision list, and summary; put visuals on Canvas.",
      canvasAgentPromptDocumentVisual: "Do not only summarize the document or paper in chat. Create and display a visual explanation on Canvas of its topic, structure, arguments, key concepts, and conclusions.",
      canvasAgentPromptDocumentStudy: "Do not return only written notes. Create and display visual study notes on Canvas with terminology, difficult ideas, examples, diagrams, and review points.",
      canvasAgentPromptDocumentPublish: "Create a summary, action items, and open questions; publish useful diagrams to Canvas.",
      canvasAgentPromptCodeVisual: "Do not only explain the code in chat. Create and display a visual code map on Canvas showing entry points, core logic, dependencies, data flow, and key boundaries.",
      canvasAgentPromptCodeLayer: "Do not return only written suggestions. Keep code behavior unchanged, and create and display a visual module map on Canvas with key flows, comment ideas, risks, and relevant links.",
      canvasAgentPromptCodePlan: "Create an implementation summary, risk list, and phased plan, with architecture on Canvas.",
      canvasAgentPromptFileLayer: "Keep the file unchanged and add a transparent visual explanation in open Canvas space.",
      canvasAgentPromptFilePublish: "Organize the file's structure, summary, conclusions, and actions; put diagrams on Canvas.",
      canvasAgentPromptProjectPlan: "Do not return only a written plan. Create and display a visual project plan on Canvas showing goals, milestones, dependencies, risks, and acceptance criteria, then add a concise chat summary.",
      canvasAgentPromptProjectPublish: "Do not return only handoff text. Create and display a visual project map on Canvas showing entry points, directory responsibilities, dependencies, risks, and run steps, then provide the handoff summary in chat.",
      canvasAgentPromptSelectionVisual: "Do not only explain the selection in chat. Create and display a visual explanation on Canvas of only the selected or referenced content's purpose, structure, relationships, and key details.",
      canvasAgentPromptSelectionLayer: "Keep the selection unchanged and add a transparent explanation layer with labels and links nearby.",
      canvasAgentPromptSelectionPublish: "Organize conclusions and next steps; put visuals on Canvas and the summary in chat.",
      canvasAgentPromptNotesVisual: "Do not only explain the handwritten notes in chat. Keep the original handwriting unchanged, and create and display a visual knowledge map on Canvas showing its themes, hierarchy, relationships, and questions.",
      canvasAgentPromptNotesPublish: "Do not return only a written summary. Create and display visual notes on Canvas with a transcription, knowledge map, tasks, and review points, then send a concise summary in chat.",
      canvasAgentPromptCanvasVisual: "Do not only describe the current Canvas in chat. Create and display a visual overview on Canvas showing its content, structure, relationships, and information gaps.",
      canvasAgentPromptCanvasLayer: "Keep the canvas meaning and objects, improve layout, and add transparent explanations in open space.",
      canvasAgentPromptCanvasPublish: "Do not return only a copy-ready recap. Create and display a visual summary board on Canvas showing the key conclusions and actions, then send the concise copy-ready recap in chat.",
      canvasAgentPromptSimpleDiagramSummary: "Draw a simple diagram of the core concepts and relationships.",
      canvasAgentPromptSequenceDiagramSourceSummary: "Convert this diagram to editable Mermaid or PlantUML sequence source.",
      canvasAgentPromptOrganizeSummary: "Organize the canvas into clear visual notes and surface gaps.",
      canvasAgentPromptApplyAnnotationsSummary: "Apply only clearly marked Canvas changes; ask if anything is unclear.",
      canvasAgentPromptFollowCanvasCuesSummary: "Continue from the latest cues without changing unmarked content.",
      canvasAgentPromptCheckWorkSummary: "Mark each error in place and write the correct answer or steps nearby.",
      canvasAgentPromptPptSummary: "Turn this view into a presentation layout and return the final image.",
      canvasAgentPromptExcelSummary: "Chart the spreadsheet's key metrics, trends, anomalies, and conclusions.",
      canvasAgentPromptCompareFilesSummary: "Create a visual Canvas comparison, then summarize differences, conflicts, gaps, and resolutions.",
      canvasAgentPromptProjectEvidenceSummary: "Map project evidence visually on Canvas, cite exact sources, and separate facts from assumptions.",
      canvasAgentPromptReleaseReadinessSummary: "Build a visual Canvas release-readiness board with prioritized blockers and verification steps.",
      canvasAgentPromptTransformerSummary: "Explain Transformer with layers, data flow, shapes, and pseudocode.",
      canvasAgentPromptUkTripSummary: "Map a 15-day UK trip with routes, transport, stays, and highlights.",
      canvasAgentPromptInteractivePrototypeSummary: "Build and display a working visual Canvas prototype with states and interactions.",
      canvasAgentPromptInteractiveCalculatorSummary: "Build and display a visual Canvas calculator with live results and validation.",
      canvasAgentPromptSelfCheckQuizSummary: "Build and display a visual Canvas quiz with explanations, progress, and retry.",
      canvasAgentPromptFileSummary: "Explain this file's purpose, structure, relationships, and details visually.",
      canvasAgentPromptArchitectureSummary: "Map project modules, dependencies, data flow, and key directories.",
      canvasAgentPromptHandwritingSummary: "Preserve the handwriting and add a transparent visual explanation layer.",
      canvasAgentPromptImageVisualSummary: "Explain the image's subjects, structure, relationships, and key details.",
      canvasAgentPromptImageLayerSummary: "Keep the image unchanged and add a transparent explanation layer.",
      canvasAgentPromptImagePublishSummary: "Extract key image information; put visuals on Canvas and summary in chat.",
      canvasAgentPromptSpreadsheetVisualSummary: "Chart key metrics, trends, anomalies, relationships, and data quality.",
      canvasAgentPromptSpreadsheetLayerSummary: "Keep source data and add a Canvas dashboard with charts and context.",
      canvasAgentPromptSpreadsheetPublishSummary: "Put conclusions and risks in chat, with supporting charts on Canvas.",
      canvasAgentPromptPresentationVisualSummary: "Connect the presentation's structure and conclusions in one diagram.",
      canvasAgentPromptPresentationLayerSummary: "Preserve the meaning, unify the deck, and add essential diagrams.",
      canvasAgentPromptPresentationPublishSummary: "Create a speaking outline, revision list, summary, and Canvas visuals.",
      canvasAgentPromptDocumentVisualSummary: "Explain the document's structure, arguments, concepts, and conclusions.",
      canvasAgentPromptDocumentStudySummary: "Turn the document into study notes with examples and review points.",
      canvasAgentPromptDocumentPublishSummary: "Summarize actions and open questions; put useful diagrams on Canvas.",
      canvasAgentPromptCodeVisualSummary: "Explain code entry points, logic, dependencies, data flow, and boundaries.",
      canvasAgentPromptCodeLayerSummary: "Keep behavior unchanged; add a module map, flows, risks, and links.",
      canvasAgentPromptCodePlanSummary: "Create an implementation summary, risks, phases, and architecture.",
      canvasAgentPromptFileLayerSummary: "Keep the file unchanged and explain it visually in open Canvas space.",
      canvasAgentPromptFilePublishSummary: "Organize the file's structure, conclusions, actions, and diagrams.",
      canvasAgentPromptProjectPlanSummary: "Plan goals, milestones, dependencies, risks, and acceptance criteria.",
      canvasAgentPromptProjectPublishSummary: "Map project entry points, directories, dependencies, risks, and run steps.",
      canvasAgentPromptSelectionVisualSummary: "Explain only the selected content's purpose, structure, and relationships.",
      canvasAgentPromptSelectionLayerSummary: "Keep the selection unchanged and add a nearby explanation layer.",
      canvasAgentPromptSelectionPublishSummary: "Put selection conclusions in chat and supporting visuals on Canvas.",
      canvasAgentPromptNotesVisualSummary: "Explain the notes' themes, hierarchy, relationships, and questions.",
      canvasAgentPromptNotesPublishSummary: "Turn handwriting into a transcript, knowledge map, tasks, and review points.",
      canvasAgentPromptCanvasVisualSummary: "Explain the canvas content, structure, relationships, and gaps at a glance.",
      canvasAgentPromptCanvasLayerSummary: "Preserve canvas meaning, improve layout, and add explanations in open space.",
      canvasAgentPromptCanvasPublishSummary: "Organize the canvas summary, conclusions, actions, and copy-ready recap.",
      canvasAgentType: "Type with keyboard",
      canvasAgentHandwrite: "Write by hand",
      canvasAgentClearInk: "Clear",
      canvasAgentInkPrompt: "The attached image named canvas-agent-message.webp, or canvas-agent-message.png when WebP is unavailable, is additional user-authored message text, not an image-analysis request. Transcribe it internally and treat the transcription as if the user typed it after any text above; then respond to or carry out the resulting request. Do not describe the handwriting image or any automatically supplied canvas-state image unless the resulting request asks you to. Ask one concise clarification only if important handwriting is ambiguous.",
      canvasAgentInkOnly: "Extract as a regular prompt and execute",
      canvasAgentInkImageLimit: "Extracting handwriting as a regular prompt uses one image slot. Remove one attachment before sending.",
      canvasAgentSend: "Send",
      canvasAgentSteer: "Steer",
      canvasAgentStop: "Stop",
      canvasAgentSelected: "Selected",
      canvasAgentReferenced: "Referenced",
      canvasAgentReferences: "Referenced canvas objects",
      canvasAgentReferenceWidget: "Reference a Widget",
      canvasAgentReferenceWidgetTitle: "Pick a Widget to reference",
      canvasAgentReferenceHelp: "Choose one from the list, or click it directly on the canvas.",
      canvasAgentReferenceSearch: "Search canvas Widgets",
      canvasAgentReferenceCollapse: "Collapse Widget picker",
      canvasAgentReferenceAdd: "Reference",
      canvasAgentRemoveReference: "Remove reference",
      canvasAgentReferenceLimit: "You can reference up to 20 Widgets in one message.",
      canvasAgentReferenceEmpty: "There are no Widgets on this canvas yet.",
      canvasAgentReferenceNoMatch: "No matching Widgets.",
      canvasAgentReferencePickMiss: "No Widget there — click directly on a Widget or choose one from the list.",
      canvasAgentReferenceCountOne: "1 Widget",
      canvasAgentReferenceCount: "{count} Widgets",
      canvasAgentMove: "Drag to move PenEcho Agent",
      canvasAgentAttach: "Attach files and images",
      canvasAgentAttachTitle: "Attach up to five files and images",
      canvasAgentSearchOn: "Internet search on",
      canvasAgentSearchOff: "Turn on internet search",
      canvasAgentSearchUnavailable: "Internet search is unavailable in this build",
      canvasAgentAttachments: "Attachments",
      canvasAgentRemoveAttachment: "Remove attachment",
      canvasAgentOpenFile: "Double-click to open {name} with the system app",
      canvasAgentOpenFileFailed: "The system could not open this file.",
      canvasAgentOpenFileUnavailable: "This file is no longer available.",
      canvasAgentImageSourceTooLarge: "The original image is larger than 12 MB. Choose a smaller image.",
      canvasAgentImageCompressionTooLarge: "PenEcho could not resize and convert this image to a WebP below 5 MB. Choose a smaller image.",
      canvasAgentImagesTooLarge: "Images in one message can total at most 25 MB.",
      canvasAgentImageUnsupported: "This image format is not supported.",
      canvasAgentImagePreparing: "Preparing attachments…",
      canvasAgentImagePrompt: "Please inspect the attached image or images.",
      canvasAgentImageOnly: "Attached image",
      canvasAgentScreenshot: "Canvas screenshot",
      canvasAgentScreenshotDownload: "Download {name}",
      canvasAgentToolInspect: "Inspect canvas",
      canvasAgentToolRead: "Read canvas object",
      canvasAgentToolCapture: "Capture canvas",
      canvasAgentToolCreate: "Create canvas content",
      canvasAgentToolEdit: "Edit canvas content",
      canvasAgentToolPatchWidget: "Update widget",
      canvasAgentToolSetView: "Adjust canvas view",
      canvasAgentToolRevert: "Revert Agent change",
      canvasAgentToolRunProjectCommand: "Run project command",
      canvasAgentToolReadDocument: "Read document",
      canvasAgentToolReadProjectFile: "Read project file",
      canvasAgentToolReadBinary: "Inspect binary file",
      canvasAgentToolReadProjectImage: "Inspect project image",
      canvasAgentToolReadDatabase: "Query project database",
      canvasAgentToolLoadDocumentReader: "Load document reader",
      canvasAgentToolLoadDatabaseReader: "Load database reader",
      canvasAgentToolFindProjectFiles: "Find project files",
      canvasAgentToolSearchProjectFiles: "Search project contents",
      canvasAgentToolListProjectFolder: "List project folder",
      canvasAgentToolSearch: "Search the web",
      canvasAgentToolReadWeb: "Read web page",
      canvasAgentToolStock: "Look up stock data",
      canvasAgentToolVisualMath2D: "Use Canvas Math 2D",
      canvasAgentToolVisualPhysics2D: "Use Canvas Physics 2D",
      canvasAgentToolVisualMath3D: "Use Canvas Math 3D",
      canvasAgentToolGeneralHtml: "Use Canvas General HTML",
      canvasAgentToolProfessionalDiagrams: "Use Canvas Professional Diagrams",
      canvasAgentToolTargetViewport: "viewport",
      canvasAgentToolTargetCanvas: "entire canvas",
      canvasAgentToolTargetObject: "canvas object",
      canvasAgentToolTargetSelection: "selection",
      canvasAgentToolTargetRegion: "canvas region",
      canvasAgentToolUse: "Use canvas tool",
      canvasAgentToolRunning: "Working…",
      canvasAgentToolDone: "Done",
      canvasAgentToolFailed: "Failed",
      canvasAgentToolArguments: "Request details",
      canvasAgentToolResult: "Result details",
      canvasAgentCopyBlock: "Copy",
      canvasAgentBlockCopied: "Copied",
      canvasAgentBlockCopyFailed: "Copy failed",
      canvasAgentCopyResponse: "Copy response",
      canvasAgentResponseCopied: "Copied",
      canvasAgentResponseCopyFailed: "Copy failed",
      canvasAgentLikeResponse: "Helpful",
      canvasAgentCriticizeResponse: "Needs improvement",
      canvasAgentRetryResponse: "Retry response",
      canvasAgentRetryMessage: "Retry response",
      canvasAgentCodeBlock: "Code",
      canvasAgentTextBlock: "Text",
      pluginManagerTitle: "Plugin manager",
      pluginManagerDescription: "Choose which capabilities the AI can use. Disabled plugins add no prompt or canvas widget runtime.",
      closePlugins: "Close plugins",
      pluginSources: "Plugin sources",
      localPlugins: "Local plugins",
      createPlugin: "Create",
      pluginPreview: "Preview",
      serverPlugins: "Server plugins",
      comingSoon: "Coming soon",
      refreshPlugins: "Refresh local plugins",
      serverPluginsComingTitle: "Server plugin marketplace is coming",
      serverPluginsComingDescription: "Free community plugins, server selection, trust details, and updates will appear here after the PenEcho website launches.",
      pluginBuiltIn: "Built in",
      pluginLocal: "Local Markdown",
      pluginPersonalSection: "Your plugins",
      pluginBuiltInSection: "Built-in plugins",
      pluginRecommended: "Recommended",
      generalPluginRecommendedHelp: "Recommended. Gives AI a flexible way to present rich interactive and dynamic content when ordinary canvas output is not enough.",
      pluginUsageTitle: "How to use",
      pluginUsageDescription: "For custom interfaces, enable General HTML and write a request such as “a colorful live clock.” For live data, enable its source and ask for “Shanghai weather” or “Kweichow Moutai daily chart.” An arrow or box can choose where the widget appears; data is fetched directly by your browser.",
      pluginSourceLabel: "Source: {source}",
      pluginApiLabel: "API: {origins}",
      pluginNoNetwork: "No network access",
      pluginPublicHttps: "Any public HTTPS origin",
      pluginPromptEstimate: "adds about {tokens} prompt tokens to each AI request while enabled; once on canvas, display, interaction, refresh, and rendering use no tokens",
      pluginRefreshRate: "refresh {time}",
      pluginDetails: "Details",
      pluginDetailsFor: "{name} plugin details",
      copyPluginMarkdown: "Copy Markdown",
      pluginMarkdownCopied: "Copied",
      pluginMarkdownCopyFailed: "Copy failed",
      duplicatePlugin: "Create editable copy",
      pluginCopyName: "Copy of {name}",
      pluginCopyDraftReady: "Editable copy of {name} is ready. Review and save it as your own plugin.",
      pluginBuiltInRuntime: "Built-in runtime capability",
      pluginDefaultState: "Default: {state}",
      pluginRequestField: "Request field: {field}",
      pluginStateEnabled: "enabled",
      pluginStateDisabled: "disabled",
      pluginMinute: "{count} min",
      pluginHour: "{count} hr",
      pluginDay: "{count} day",
      pluginCatalogLoading: "Refreshing local plugin directory...",
      pluginCatalogReady: "{count} plugins found · {enabled} enabled",
      pluginCatalogFailed: "Local plugin directory could not be refreshed",
      pluginNoDescription: "Local plugin capability",
      createPluginTitle: "Create a local plugin",
      createPluginDescription: "Preview: this workflow has limited testing. Describe the capability in the template, then preferably use Improve with AI before saving so endpoints, runtime rules, and the display title are completed for you.",
      sharePluginComing: "Share to Community · Coming soon",
      pluginTemplateLabel: "Template",
      pluginSimpleTemplate: "Simple HTML",
      pluginTitleLabel: "Plugin title",
      pluginTitlePlaceholder: "Filled automatically by Improve with AI, or enter your own",
      pluginDocumentLabel: "Plugin Markdown",
      pluginDocumentHint: "Prefer Improve with AI before saving. The final document needs frontmatter and an exact One-shot example.",
      pluginStylesLabel: "Plugin CSS (optional)",
      pluginStylesHint: "Saved CSS is injected only when this plugin's widget is mounted; it does not load at canvas startup. Edit here or import a .css file. Put external JS/CSS URLs in generated widget HTML.",
      pluginStylesImport: "Import .css",
      pluginStylesImported: "Imported {name}. Review the preview before saving.",
      pluginStylesFileType: "Choose a .css file",
      pluginStylesFileTooLarge: "CSS file must be 32000 bytes or smaller",
      pluginStylesReadFailed: "CSS file could not be read: {error}",
      pluginStylesPreview: "Plugin CSS preview",
      improvePluginWithAi: "Improve with AI",
      saveAndEnablePlugin: "Save and enable",
      pluginMarketplaceNote: "The future Community library will let authors share plugins for everyone to use free.",
      pluginBytes: "{bytes} / 12000 bytes",
      pluginStylesBytes: "{bytes} / 32000 bytes",
      pluginDraftValid: "Ready to save as {name}",
      pluginDraftInvalid: "Fix the plugin document: {error}",
      pluginIdExists: "Plugin id {id} already exists",
      pluginIdReserved: "Plugin id {id} is reserved",
      pluginImproving: "AI is improving the capability contract...",
      pluginImproved: "AI improvement is ready. Review it before saving.",
      pluginImproveFailed: "AI improvement failed: {error}",
      pluginSaving: "Saving local plugin...",
      pluginSaved: "{name} was saved and enabled",
      pluginSaveFailed: "Plugin could not be saved: {error}",
      deletePlugin: "Delete plugin",
      deletePluginConfirm: "Delete the local plugin “{name}”? Existing widgets created with it will stop running.",
      pluginDeleting: "Deleting {name}...",
      pluginDeleted: "{name} was deleted",
      pluginDeleteFailed: "Plugin could not be deleted: {error}",
      animationPlugin: "Animation scenes",
      animationPluginCost: "Adds about 500–600 prompt tokens per AI request",
      animationPluginDisabledHelp: "When enabled, the model can return animated demonstrations when explicitly requested or genuinely useful.",
      animationControls: "Animation controls",
      animationPlay: "Play",
      animationPause: "Pause",
      animationRestart: "Restart",
      animationDelete: "Delete animation",
      animationSelected: "Editing animation; drag the top handle to move, resize with edge or corner handles, then confirm or cancel",
      animationDeleted: "Animation deleted",
      animationLimitReached: "Animation limit reached (100). Delete an animation before adding another.",
      snapshotAnimations: "animations",
      widgetAccept: "Keep widget",
      widgetDiscard: "Discard widget",
      widgetMove: "Move widget",
      objectToolbarMove: "Drag toolbar to move",
      widgetDelete: "Delete widget",
      widgetDeleted: "Widget deleted",
      widgetSourceCopied: "Widget source copied",
      widgetSourceCopyFailed: "Widget source could not be copied",
      downloadWidget: "Download Widget image",
      widgetDownloading: "Preparing Widget image…",
      widgetDownloaded: "Widget image downloaded",
      widgetDownloadFailed: "Widget image could not be downloaded",
      favoriteWidget: "Favorite widget",
      favoriteWidgetSaving: "Saving favorite…",
      unfavoriteWidget: "Remove widget favorite",
      widgetFavorited: "Widget added to Favorites",
      widgetUnfavorited: "Widget removed from Favorites",
      widgetRefine: "AI Refine",
      widgetRefineHint: "Refine and replace this widget using its content and the current canvas",
      widgetRefineNearbyHint: "New annotations were detected near this widget. Use AI Refine to update it from those instructions.",
      widgetRefineViewportHint: "New instructions are present in this view. Use AI Refine to update this widget from them.",
      widgetRefineNoInputHint: "AI Refine needs a clear instruction. Add a note or drawing to show what should change.",
      widgetRefineConfirmDirty: "Update this widget using the new instructions?",
      widgetRefineConfirmNoInput: "No change request was found. Continue anyway? AI may not know what you want changed.",
      widgetRefineConfirm: "Update widget",
      widgetRefineCancel: "Cancel",
      widgetRefinePending: "New marks detected near this diagram. Use its AI Refine button to update it, or choose a manual AI action above. Auto AI is paused.",
      widgetRefining: "AI is refining this widget",
      widgetReplacementReady: "Review the refined replacement",
      widgetExportFailed: "A live widget could not be captured. Wait for it to finish loading and try again.",
      widgetPluginUnavailable: "The plugin document could not be loaded",
      widgetLimitReached: "Live widget limit reached (100). Delete a widget before adding another.",
      snapshotWidgets: "live widgets",
      historySnapshotWidget: "widget",
      historySnapshotWidgets: "widgets",
      clearConfirm: "Clear the whole canvas?",
      timeout: "Request timed out",
      aiNoVisibleResponse: "AI returned no displayable content. Please retry or rephrase the request.",
      aiError: "AI: ",
    },
    zh: ZH,
  };
  const PLUGIN_STORAGE_KEY = "penecho-plugins",
    DEFAULT_THEME = "studio",
    DEFAULT_STUDIO_PALETTE = "teal",
    REMOVED_THEMES = new Set(["arcane", "scifi", "research"]),
    SUPPORTED_THEMES = new Set([DEFAULT_THEME]),
    SUPPORTED_STUDIO_PALETTES = new Set(["indigo", "graphite", "cobalt", "azure", "teal", "forest", "amber", "burgundy"]),
    DIAGRAM_RUNTIME_VERSION = "penecho-diagram-source-v1",
    DIAGRAM_SOURCE_FORMATS = new Set(["mermaid", "dot", "bpmn-xml", "vega-lite", "geojson", "smiles", "cytoscape-json"]),
    BUILTIN_PLUGIN_DEFINITIONS = Object.freeze([]);
  const PLUGIN_DEFINITIONS = [...BUILTIN_PLUGIN_DEFINITIONS];
  const pluginManifests = new Map(),
    pluginLoadErrors = new Map(),
    widgetSnapshotRequests = new Map(),
    widgetHostPointerAnchors = new Map(),
    screenCalibration = new Map();
  let diagramRuntimePromise = null,
    pluginCatalogLoadPromise = null;
  let screenClientRatio = 1;
  function normalizeTheme(theme) {
    return SUPPORTED_THEMES.has(theme) ? theme : DEFAULT_THEME;
  }
  function normalizeStudioPalette(palette) {
    return SUPPORTED_STUDIO_PALETTES.has(palette) ? palette : DEFAULT_STUDIO_PALETTE;
  }
  function normalizeStudioPaletteForTheme(theme, palette) {
    return REMOVED_THEMES.has(theme) ? DEFAULT_STUDIO_PALETTE : normalizeStudioPalette(palette);
  }
  function storedPluginSettings() {
    let stored = {};
    try {
      const parsed = JSON.parse(localStorage.getItem(PLUGIN_STORAGE_KEY) || "{}");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) stored = parsed;
    } catch {}
    return Object.fromEntries(PLUGIN_DEFINITIONS.map((plugin) => {
      const legacy = plugin.legacyStorageKey ? localStorage.getItem(plugin.legacyStorageKey) : null,
        value = typeof stored[plugin.id] === "boolean" ? stored[plugin.id] : legacy === null ? plugin.defaultEnabled : legacy === "true";
      return [plugin.id, value];
    }));
  }
  const initialPlugins = storedPluginSettings();
  const ERASER_MODE_STORAGE_KEY = "penecho-eraser-mode";
  function normalizeAiFont(value) {
    const font = String(value || "").trim();
    if (font === AI_FONT_HANDWRITTEN_LEGACY) return AI_FONT_HANDWRITTEN;
    return AI_FONT_OPTIONS.has(font) ? font : AI_FONT_HANDWRITTEN;
  }
  function normalizeTextBoxFontFamily(value) {
    const font = String(value || "").trim();
    if (!font) return TEXT_EDITOR_FONT_FAMILY;
    if (font === AI_FONT_HANDWRITTEN_LEGACY) return AI_FONT_HANDWRITTEN;
    return AI_FONT_OPTIONS.has(font) ? font : TEXT_EDITOR_FONT_FAMILY;
  }
  const storedPrimaryLanguage = localStorage.getItem("penecho-language"),
    storedLegacyLanguage = localStorage.getItem("ghostboard-language"),
    storedTheme = localStorage.getItem("penecho-theme") || localStorage.getItem("ghostboard-theme"),
    storedStudioPalette = localStorage.getItem("penecho-studio-palette"),
    storedGrid = localStorage.getItem("penecho-grid") ?? localStorage.getItem("ghostboard-grid"),
    storedAutoEnabled = localStorage.getItem("penecho-auto-ai"),
    storedAutoDelayText = localStorage.getItem("penecho-auto-delay-ms"),
    storedSummonEnabled = localStorage.getItem("penecho-summon-enabled"),
    storedCanvasAgentAutoOpen = localStorage.getItem("penecho-canvas-agent-auto-open"),
    storedWidgetShadowEnabled = localStorage.getItem("penecho-widget-shadow"),
    storedAiFont = localStorage.getItem(AI_FONT_STORAGE_KEY),
    storedSnapshotLocation = localStorage.getItem("penecho-snapshot-location"),
    storedEraserMode = localStorage.getItem(ERASER_MODE_STORAGE_KEY),
    storedAiEffort = normalizeToolbarReasoningEffort(localStorage.getItem("penecho-ai-effort")),
    storedAutoDelay = storedAutoDelayText === null ? NaN : Number(storedAutoDelayText),
    initialLanguage = TOUR.resolveInitialLanguage(storedPrimaryLanguage, storedLegacyLanguage),
    initialTheme = normalizeTheme(storedTheme),
    initialStudioPalette = normalizeStudioPaletteForTheme(storedTheme, storedStudioPalette),
    initialPageScale = window.PenEchoPageScale?.current?.() || 1,
    initialGrid = storedGrid === null ? true : storedGrid === "true",
    configuredAutoDelay = Number(window.PENECHO_CONFIG?.autoAiDelayMs),
    configuredAiTimeout = Number(window.PENECHO_CONFIG?.aiRequestTimeoutMs),
    configuredAiEffort = normalizeToolbarReasoningEffort(window.PENECHO_CONFIG?.aiEffort),
    configuredCanvasAgentAutoOpen = typeof window.PENECHO_CONFIG?.canvasAgentAutoOpen === "boolean" ? window.PENECHO_CONFIG.canvasAgentAutoOpen : null,
    configuredAccessSession = String(window.PENECHO_CONFIG?.accessSessionToken || sessionStorage.getItem("penecho-access-session") || ""),
    serverAutoDelay = Number.isFinite(configuredAutoDelay) && configuredAutoDelay >= 0 ? configuredAutoDelay : DEFAULT_AUTO_DELAY,
    initialAutoDelay = Number.isFinite(storedAutoDelay) && storedAutoDelay >= 0 && storedAutoDelay <= 10000 ? storedAutoDelay : Math.min(10000, serverAutoDelay),
    initialAutoEnabled = storedAutoEnabled === null ? true : storedAutoEnabled === "true",
    initialSummonEnabled = storedSummonEnabled === null ? true : storedSummonEnabled === "true",
    initialCanvasAgentAutoOpen = window.PENECHO_CONFIG?.desktopApp === true && configuredCanvasAgentAutoOpen !== null
      ? configuredCanvasAgentAutoOpen
      : storedCanvasAgentAutoOpen === null ? configuredCanvasAgentAutoOpen !== false : storedCanvasAgentAutoOpen === "true",
    initialWidgetShadowEnabled = storedWidgetShadowEnabled === "true",
    initialAiFont = normalizeAiFont(storedAiFont),
    initialEraserMode = ["eraser", "area-eraser"].includes(storedEraserMode) ? storedEraserMode : "eraser",
    // The public viewer shares the Cloud origin (and therefore localStorage)
    // with editable Cloud Canvases. Never inherit their last-selected Cloud
    // history location: the read-only shell has no /api/cloud/library route.
    initialSnapshotLocation = window.PENECHO_CONFIG?.runtime === "viewer"
      ? "device"
      : ["device", "server", "cloud"].includes(storedSnapshotLocation) ? storedSnapshotLocation : "device",
    initialAiEffort = storedAiEffort || configuredAiEffort || "config",
    initialAiTimeout = Number.isFinite(configuredAiTimeout) && configuredAiTimeout >= 10000 ? configuredAiTimeout : DEFAULT_AI_TIMEOUT;
  function canvasClientId() {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map(value => value.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  const AI_CONNECTION_STORAGE_KEY = "penecho-ai-connection-id",
    AI_CLIENT_ID = canvasClientId();
  function aiConnectionScope(hosted = false) {
    const config = window.PENECHO_CONFIG || {}, cloud = config.runtime === "cloud";
    const account = String(config.connectionAccountId || "");
    if (cloud || hosted) {
      if (!account) return "";
      const origin = cloud ? location.origin : String(config.cloudOrigin || "https://penecho.ai");
      const owner = `${origin}:${account}:${cloud ? "cloud" : "local"}`;
      return hosted ? `${owner}:hosted` : config.linkedDeviceId ? `${owner}:device:${config.linkedDeviceId}` : "";
    }
    return `local:${location.origin}`;
  }
  function aiConnectionStorageKey(hosted = false) {
    const scope = aiConnectionScope(hosted);
    return scope ? `${AI_CONNECTION_STORAGE_KEY}:${scope}` : "";
  }
  function selectedAiConnectionId() {
    const hostedKey = aiConnectionStorageKey(true), localKey = aiConnectionStorageKey();
    const hosted = hostedKey && localStorage.getItem(`${hostedKey}:selected`) === "true";
    const key = hosted ? hostedKey : localKey;
    const legacy = window.PENECHO_CONFIG?.runtime !== "cloud" ? localStorage.getItem(AI_CONNECTION_STORAGE_KEY) : null;
    const id = String((key && localStorage.getItem(key)) || (!hosted && legacy && !legacy.startsWith("hosted:") ? legacy : "default")).trim();
    return id === "default" || id === "cli-override" || /^(?:hosted:)?[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id) ? id : "default";
  }
  function storeAiConnectionSelection(id) {
    const hosted = id.startsWith("hosted:"), key = aiConnectionStorageKey(hosted), hostedKey = aiConnectionStorageKey(true);
    if (!key) return false;
    localStorage.setItem(key, id);
    if (hostedKey) localStorage.setItem(`${hostedKey}:selected`, String(hosted));
    return true;
  }
  function aiConnectionSelectionError() {
    return Object.assign(Error(t("canvasAgentConnectionStale")), { code:"CONNECTION_STALE" });
  }
  async function validateAiConnectionSelection(connectionId, scope) {
    const hosted = connectionId.startsWith("hosted:");
    if (!scope || aiConnectionScope(hosted) !== scope || selectedAiConnectionId() !== connectionId) throw aiConnectionSelectionError();
    if (hosted) {
      await loadHostedModels();
      if (aiConnectionScope(true) !== scope || selectedAiConnectionId() !== connectionId || !hostedSettings.models.some(model => `hosted:${model.id}` === connectionId)) throw aiConnectionSelectionError();
      return;
    }
    await window.PenEchoLinkedDevice?.refresh({ ifNeeded:true });
    if (aiConnectionScope() !== scope || selectedAiConnectionId() !== connectionId) throw aiConnectionSelectionError();
    const response = await fetch("/api/settings/connections", { headers:authenticatedApiHeaders(), signal:AbortSignal.timeout(12000) });
    const body = await response.json();
    if (aiConnectionScope() !== scope || selectedAiConnectionId() !== connectionId) throw aiConnectionSelectionError();
    if (!response.ok) throw Object.assign(Error(body.message || body.error || t("settingsLoadFailed")), { code:body.code || body.error });
    settings.connections = Array.isArray(body.connections) ? body.connections : [];
    settings.connectionScope = scope;
    syncLocalConnectionSelection();
    renderConnectionLists();
    const valid = settings.connections.some(connection => connection.id === connectionId);
    if (!valid && !(window.PENECHO_CONFIG?.runtime !== "cloud" && connectionId === "default" && settings.connections.length)) throw aiConnectionSelectionError();
  }
  function authenticatedApiHeaders(headers = {}) {
    const csrf = window.PENECHO_CONFIG?.runtime === "cloud"
      ? document.cookie.split(";").map(value => value.trim()).find(value => value.startsWith("penecho_csrf="))?.slice("penecho_csrf=".length) || ""
      : "";
    return configuredAccessSession
      ? { ...headers, "X-PenEcho-Client":AI_CLIENT_ID, "X-PenEcho-Session":configuredAccessSession, ...(csrf ? { "X-PenEcho-CSRF":decodeURIComponent(csrf) } : {}) }
      : { ...headers, "X-PenEcho-Client":AI_CLIENT_ID, ...(csrf ? { "X-PenEcho-CSRF":decodeURIComponent(csrf) } : {}) };
  }
  function aiRequestHeaders(headers = {}) {
    const id = selectedAiConnectionId();
    if (window.PENECHO_CONFIG?.runtime === "cloud" && id === "default") throw aiConnectionSelectionError();
    return { ...authenticatedApiHeaders(headers), "X-PenEcho-Connection":id };
  }
  function canvasAssetUrl(name) {
    // Cloud-served shells (remote canvas + read-only viewer) live under nested
    // routes (/canvas/community/:id, /canvas/view/:id), so assets must resolve
    // against the canvas root rather than the page URL.
    const runtime = window.PENECHO_CONFIG?.runtime;
    const base = runtime === "cloud" || runtime === "viewer" ? new URL("/canvas/", location.origin) : location.href;
    return new URL(name, base).href;
  }
  const tiles = new Map(),
    state = {
      mode: "pen",
      previousToolMode: "pen",
      widgetReturnMode: "pen",
      eraserMode: initialEraserMode,
      scale: 0.1,
      panX: 0,
      panY: 0,
      pen: 4,
      eraser: 35,
      aiFont: initialAiFont,
      inkColor: "#1f2937",
      aiColor: "#2563eb",
      drawing: null,
      pointers: new Map(),
      touches: new Map(),
      touchGesture: null,
      panGesture: null,
      handToolbarTargets: new Map(),
      handToolbarActiveKey: null,
      handToolbarTimer: 0,
      handHoverKey: null,
      handPointerFocusKeys: new Map(),
      handToolbarOperationPointers: new Map(),
      handWidgetPointerIds: new Set(),
      handGestureIncludesWidget: false,
      navigationLocked: false,
      viewMode: false,
      viewTool: "hand",
      interactingWidgetId: null,
      widgetInteractionReturnTool: null,
      widgetActivationTap: null,
      handToolbarTap: null,
      spacePan: false,
      wheelZoom: localStorage.getItem("penecho-wheel-zoom") === "true",
      viewModeNavigationLocked: false,
      textEditors: new Map(),
      textBoxes: [],
      textEditorStyleSheet: null,
      nextTextEditorId: 1,
      nextTextBoxId: 1,
      nextTextEditorZ: 1,
      activeTextEditorId: null,
      selectedTextBoxId: null,
      textBoxHistoryBefore: null,
      animations: [],
      nextAnimationId: 1,
      selectedAnimationId: null,
      animationGesture: null,
      animationEdit: null,
      widgets: [],
      nextWidgetId: 1,
      pendingWidget: null,
      pendingWidgetReplacement: null,
      selectedWidgetId: null,
      widgetEdit: null,
      widgetGesture: null,
      widgetHistoryBefore: null,
      widgetRefineCandidate: null,
      widgetRefineHoverCandidate: null,
      widgetRefineConfirmation: null,
      widgetRefineHoveredWidgetId: null,
      widgetRefineButtonHoverId: null,
      widgetRefineClickPulse: null,
      widgetRefinePointer: null,
      widgetRefineHoverTimer: 0,
      widgetRefineHintTimer: 0,
      widgetMessageHooked: false,
      plugins: { ...initialPlugins },
      animationFrame: 0,
      animationLastFrame: 0,
      animationFullRedraw: true,
      animationScreenBoxes: new Map(),
      animationRenderedPlayheads: new Map(),
      animationControlsTimer: 0,
      animationControlsUntil: 0,
      interactionRenderQueued: false,
      animationHistoryBefore: null,
      sharpOverlays: [],
      sharpOverlayPixels: 0,
      images: [],
      nextImageId: 1,
      selectedImageId: null,
      imageEdit: null,
      imageGesture: null,
      imageHistoryBefore: null,
      imageHandReturnMode: null,
      frontCanvasObjectKind: "image",
      frontPlacedCanvasObjectKind: "image",
      imageImporting: false,
      clipboardImporting: false,
      textInputBlockedUntil: 0,
      textTap: null,
      latestTypedInput: null,
      pending: null,
      pendingGesture: null,
      aiDraftReturnMode: null,
      pendingHistoryRestored: false,
      pointerPreview: null,
      areaEraseGesture: null,
      copyGeneration: 0,
      selection: null,
      selectionGesture: null,
      hotspotTrail: [],
      auto: initialAutoEnabled,
      summonEnabled: initialSummonEnabled,
      canvasAgentAutoOpen: initialCanvasAgentAutoOpen,
      widgetShadowEnabled: initialWidgetShadowEnabled,
      summonAnchor: null,
      timer: 0,
      autoPopoverTimer: 0,
      effortPopoverTimer: 0,
      pluginCatalogLoading: false,
      pluginCatalogLoaded: false,
      pluginCatalogError: "",
      pluginCatalogNotice: null,
      pluginDeleting: "",
      pluginDialogRestoreFocus: null,
      pluginAuthoringTemplate: "simple",
      pluginAuthoringBusy: false,
      pluginAuthoringStatus: null,
      autoDelayMs: initialAutoDelay,
      reasoningEffort: initialAiEffort,
      aiRequestTimeoutMs: initialAiTimeout,
      dirty: null,
      dirtyInkTiles: new Map(),
      dirtyInkBounds: new Map(),
      dirtyImageIds: new Set(),
      dirtyTextBoxIds: new Set(),
      autoEligible: false,
      lastUserBox: null,
      history: [],
      future: [],
      historyBefore: new Map(),
      inkBounds: new Map(),
      busy: false,
      activeAI: null,
      snapshotLoadGeneration: 0,
      snapshotLocation: initialSnapshotLocation,
      currentSnapshotId: null,
      currentSnapshotName: "",
      currentSnapshotHasExplicitName: false,
      currentCanvasSuggestedName: "",
      currentSnapshotLocation: null,
      currentSnapshotProjectId: null,
      currentSnapshotRevisionId: null,
      currentSnapshotBundleExtensions: {},
      currentSnapshotManifestExtensions: {},
      currentSnapshotPreservedAssets: [],
      canvasAgentCanvasKey: "",
      preservedSnapshotAnimations: [],
      snapshotSavedRevision: 0,
      restoreGeneration: 0,
      recognitionGeneration: 0,
      userRevision: 0,
      lastRequestId: "—",
      viewInitialized: false,
      renderQueued: false,
      language: initialLanguage,
      theme: initialTheme,
      studioPalette: initialStudioPalette,
      pageScale: initialPageScale,
      gridVisible: initialGrid,
      paint: { paper: "#ead9ad", paperGrid: "#c8ae7155", outside: "#090814", border: "#7f693b" },
      navigationTimer: 0,
      navigationDeadline: 0,
      canvasChromeMaterialTimer: 0,
      canvasChromeMaterialDeadline: 0,
      canvasChromeMaterialActive: false,
      canvasAgentNavigationActive: false,
      canvasAgentNavigationWasOpen: false,
      canvasAgentNavigationRestoreTimer: 0,
      canvasAgentNavigationRestoreDeadline: 0,
      canvasAgentNavigationPointerIds: new Set(),
      aiOrbIdleTimer: 0,
      statusKey: "ready",
      aiProgressEvent: null,
      canvasHintKey: null,
      canvasHintValues: null,
    };
  let textHelpInvoker = null;
  let pluginStylesPreviewReady = false,
    pluginStylesPreviewPayload = null;
  const AI_CANCELLED = "AI_CANCELLED";
  const AI_REJECTED = "AI_REJECTED";
  const AI_SUPERSEDED = "AI_SUPERSEDED";
  const FEATURE_TOUR_STORAGE_KEY = "penecho-tour-progress";
  const CHANGELOG_STORAGE_KEY = "penecho-changelog-seen";
  const CHANGELOG_VERSION = "1.3.0";
  // Keep seen IDs stable. Add a new ID (or bump its -vN suffix) to show only that feature to returning users.
  const FEATURE_TOUR_STEPS = Object.freeze([
    { id: "core-effort-v1", targets: ["#aiEffortButton"], titleKey: "tourEffortTitle", bodyKey: "tourEffortBody", placement: "bottom", radius: 8 },
    { id: "favorites-add-v1", targets: ["#craftsButton"], titleKey: "tourFavoritesTitle", bodyKey: "tourFavoritesBody", placement: "bottom", radius: 8 },
    { id: "hand-v1", targets: ["#handToolBtn"], titleKey: "tourHandTitle", bodyKey: "tourHandBody", placement: "bottom", radius: 7 },
    { id: "core-lasso-v1", targets: ["#lassoToolBtn"], titleKey: "tourLassoTitle", bodyKey: "tourLassoBody", placement: "bottom", radius: 7 },
    { id: "core-text-v1", targets: ["#textToolBtn"], titleKey: "tourTextTitle", bodyKey: "tourTextBody", placement: "bottom", radius: 7 },
    { id: "core-image-v1", targets: ["#imagePickerBtn"], titleKey: "tourImageTitle", bodyKey: "tourImageBody", placement: "bottom", radius: 7 },
    { id: "core-fullscreen-v1", targets: ["#fullscreenBtn"], titleKey: "tourFullscreenTitle", bodyKey: "tourFullscreenBody", placement: "bottom", radius: 7 },
    { id: "cloud-share-canvas-v1", targets: ["#shareCanvasBtn"], titleKey: "tourShareCanvasTitle", bodyKey: "tourShareCanvasBody", placement: "bottom", radius: 7 },
    { id: "cloud-workspace-v1", targets: ["#cloudAccountBtn"], titleKey: "tourCloudTitle", bodyKey: "tourCloudBody", placement: "bottom", radius: 8 },
    { id: "mcp-canvas-v1", targets: ["#mcpToolbarToggle"], titleKey: "tourMcpTitle", bodyKey: "tourMcpBody", placement: "bottom", radius: 8, padding: 4 },
    { id: "canvas-agent-launcher-v2", targets: ["#canvasAgentToggle"], titleKey: "tourCanvasAgentLauncherTitle", bodyKey: "tourCanvasAgentLauncherBody", placement: "bottom", radius: 9, padding: 4 },
    { id: "canvas-agent-panel-v2", targets: ["#canvasAgentPanel"], titleKey: "tourCanvasAgentPanelTitle", bodyKey: "tourCanvasAgentPanelBody", placement: "left", radius: 18, padding: 4, preview: "canvas-agent-panel" },
    { id: "core-manual-ai-v1", targets: ["#aiOrb"], titleKey: "tourManualAITitle", bodyKey: "tourManualAIBody", placement: "left", radius: 50 },
    { id: "core-status-v1", targets: ["#aiStatusArea"], titleKey: "tourStatusTitle", bodyKey: "tourStatusBody", placement: "bottom", radius: 999 },
    { id: "core-navigation-v1", targets: ["#viewport"], titleKey: "tourCanvasTitle", bodyKey: "tourCanvasBody", placement: "center", radius: 10, padding: 5 },
  ]);
  const featureTour = {
    active: false,
    steps: [],
    index: 0,
    progress: TOUR.parseProgress(null),
    replay: false,
    newOnly: false,
    restoreFocus: null,
    restoreScrollX: 0,
    restoreScrollY: 0,
    positionFrame: 0,
    retryFrame: 0,
    resizeObserver: null,
    pendingObserver: null,
    activeObserver: null,
    targets: [],
    shownIds: new Set(),
    autoChecked: false,
    canvasAgentOpenedForTour: false,
  };
  const changelog = {
    active: false,
    restoreFocus: null,
  };
  const COLOR_CLASS = { "#2563eb": "color-blue", "#1f2937": "color-black", "#dc2626": "color-red", "#ea580c": "color-orange", "#ca8a04": "color-gold", "#16a34a": "color-green", "#0891b2": "color-cyan", "#9333ea": "color-purple" };
  const runtimeStyleRules = new Map();
  function runtimeElementStyle(element, key) {
    if (!element || !key) return null;
    let record = runtimeStyleRules.get(key);
    if (!record) {
      const className = `penecho-runtime-${String(key).replace(/[^a-z0-9_-]/gi, "-")}`,
        sheet = textEditorStyleSheet();
      if (!sheet) return null;
      try {
        const index = sheet.cssRules.length;
        sheet.insertRule(`.${className} {}`, index);
        record = { className, style:sheet.cssRules[index]?.style || null };
        if (!record.style) return null;
        runtimeStyleRules.set(key, record);
      } catch {
        return null;
      }
    }
    element.classList.add(record.className);
    return record.style;
  }
  function pageLayoutScale() {
    const value = Number.parseFloat(window.getComputedStyle?.(document.documentElement)?.zoom);
    return Number.isFinite(value) && value > 0 ? value : 1;
  }
  function pageLayoutRect(element) {
    const rect = element?.getBoundingClientRect?.();
    if (!rect) return null;
    const scale = pageLayoutScale(), left = rect.left / scale, top = rect.top / scale,
      width = rect.width / scale, height = rect.height / scale;
    return { left, top, right:left + width, bottom:top + height, width, height };
  }
  let canvasViewportMetricsCache = null;
  let canvasViewportMetricsCacheFrame = 0;
  function invalidateCanvasViewportMetrics() {
    if (canvasViewportMetricsCacheFrame) cancelAnimationFrame(canvasViewportMetricsCacheFrame);
    canvasViewportMetricsCacheFrame = 0;
    canvasViewportMetricsCache = null;
  }
  function canvasViewportMetrics() {
    if (canvasViewportMetricsCache) return canvasViewportMetricsCache;
    const rect = view.getBoundingClientRect(),
      width = Math.max(0, Number(view.clientWidth) || rect.width),
      height = Math.max(0, Number(view.clientHeight) || rect.height),
      clientScaleX = rect.width > 0 ? width / rect.width : 1,
      clientScaleY = rect.height > 0 ? height / rect.height : 1;
    canvasViewportMetricsCache = { rect, width, height, clientScaleX, clientScaleY };
    canvasViewportMetricsCacheFrame = requestAnimationFrame(() => {
      canvasViewportMetricsCacheFrame = 0;
      canvasViewportMetricsCache = null;
    });
    return canvasViewportMetricsCache;
  }
  function canvasClientPosition(clientX, clientY) {
    const metrics = canvasViewportMetrics();
    return {
      x:(Number(clientX) - metrics.rect.left) * metrics.clientScaleX,
      y:(Number(clientY) - metrics.rect.top) * metrics.clientScaleY,
    };
  }
  function canvasClientDelta(dx, dy) {
    const metrics = canvasViewportMetrics();
    return { x:Number(dx) * metrics.clientScaleX, y:Number(dy) * metrics.clientScaleY };
  }
  function canvasElementLayoutRect(element) {
    const rect = element?.getBoundingClientRect?.(), metrics = canvasViewportMetrics();
    if (!rect) return null;
    const left = (rect.left - metrics.rect.left) * metrics.clientScaleX,
      top = (rect.top - metrics.rect.top) * metrics.clientScaleY,
      width = rect.width * metrics.clientScaleX,
      height = rect.height * metrics.clientScaleY;
    return { left, top, right:left + width, bottom:top + height, width, height };
  }
  const AI_NON_PROGRESS_STATUS_KEYS = new Set(["aiBusy", "aiDone", "aiNoVisibleResponse", "aiError", "aiCancelled", "aiCancelledForInput"]);
  const MULTILINE_STATUS_KEYS = new Set(["widgetRefinePending"]);
  const setStatus = (text, key = null) => {
    status.textContent = text;
    state.statusKey = key;
    const progress=typeof key==="string"&&key.startsWith("ai")&&!AI_NON_PROGRESS_STATUS_KEYS.has(key);
    const multiline=MULTILINE_STATUS_KEYS.has(key);
    if(!progress)state.aiProgressEvent=null;
    status.dataset.aiProgress=String(progress);
    status.dataset.multiline=String(multiline);
    status.title=progress||multiline?text:"";
  };
  const setStatusKey = (key) => setStatus(t(key), key);
  const t = (key) => I18N[state.language]?.[key] || I18N.en[key] || key;
  window.PenEchoI18n = Object.freeze({
    t,
    currentLanguage:() => state.language,
  });
  function renderCanvasHint(restart = false) {
    if (!canvasHint || !state.canvasHintKey) return;
    let message = t(state.canvasHintKey);
    for (const [key, value] of Object.entries(state.canvasHintValues || {})) message = message.replaceAll(`{${key}}`, String(value));
    canvasHint.textContent = `${t("hintPrefix")}: ${message}`;
    canvasHint.hidden = false;
    if (!restart) return;
    canvasHint.classList.remove("is-new");
    void canvasHint.offsetWidth;
    canvasHint.classList.add("is-new");
  }
  function showCanvasHint(keys) {
    const candidates = (Array.isArray(keys) ? keys : [keys])
      .map((candidate) => typeof candidate === "string" ? { key:candidate, values:null } : candidate)
      .filter((candidate) => candidate?.key && (I18N[state.language][candidate.key] || I18N.zh[candidate.key]));
    if (!candidates.length) return;
    const alternatives = candidates.filter((candidate) => candidate.key !== state.canvasHintKey),
      choices = alternatives.length ? alternatives : candidates;
    const choice = choices[Math.floor(Math.random() * choices.length)];
    state.canvasHintKey = choice.key;
    state.canvasHintValues = choice.values || null;
    renderCanvasHint(true);
  }
  const statusHintRotation = new Map();
  function showHandStatusHint(action, keys) {
    if (state.mode !== "hand" || state.busy) return false;
    const candidates = (Array.isArray(keys) ? keys : [keys]).filter((key) => key && (I18N[state.language][key] || I18N.zh[key]));
    if (!candidates.length) return false;
    const index = ((statusHintRotation.get(action) ?? -1) + 1) % candidates.length;
    statusHintRotation.set(action, index);
    setStatusKey(candidates[index]);
    return true;
  }
  const summonFX = SUMMON?.create({
    fxCanvas:summonLayer,
    textLayer: document.querySelector("#summonTextLayer"),
    t,
    getTransform: () => ({ scale: state.scale, panX: state.panX, panY: state.panY, width: view.clientWidth, height: view.clientHeight, dpr: devicePixelRatio || 1 }),
    getAiColor: () => state.aiColor,
    getReducedMotion: () => Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches),
    styleFor: (element) => runtimeElementStyle(element, "summon-copy"),
  });
  function showSummon() {
    if (!summonFX || !state.summonEnabled) return;
    summonFX.show(state.summonAnchor);
  }
  function hideSummon() {
    summonFX?.hide();
  }
  function readFeatureTourProgress() {
    try {
      const stored = TOUR.parseProgress(localStorage.getItem(FEATURE_TOUR_STORAGE_KEY));
      featureTour.progress = TOUR.markSeen(stored, featureTour.progress.seen);
    } catch {
      featureTour.progress = TOUR.parseProgress(featureTour.progress);
    }
    return featureTour.progress;
  }
  function markFeatureTourStepsSeen(steps) {
    featureTour.progress = TOUR.markSeen(featureTour.progress, steps.map((step) => step.id));
    try {
      localStorage.setItem(FEATURE_TOUR_STORAGE_KEY, TOUR.serializeProgress(featureTour.progress));
    } catch {}
  }
  function featureTourViewport() {
    const visual = window.visualViewport,
      scale = pageLayoutScale();
    return visual
      ? { left: visual.offsetLeft / scale, top: visual.offsetTop / scale, width: visual.width / scale, height: visual.height / scale }
      : { left: 0, top: 0, width: window.innerWidth / scale, height: window.innerHeight / scale };
  }
  function featureTourElements(step) {
    return (step?.targets || [])
      .map((selector) => document.querySelector(selector))
      .filter((element) => {
        if (!element?.isConnected || element.hidden || !element.getClientRects().length) return false;
        const rect = element.getBoundingClientRect(),
          computed = window.getComputedStyle(element);
        return TOUR.rectHasArea(rect) && computed.display !== "none" && computed.visibility !== "hidden" && computed.visibility !== "collapse";
      });
  }
  function featureTourTargetRect(step, elements = featureTourElements(step)) {
    return TOUR.unionRects(elements.map(pageLayoutRect));
  }
  function featureTourStepAvailable(step) {
    if (step?.preview === "canvas-agent-panel") {
      const panel = document.querySelector("#canvasAgentPanel"),
        panelRect = featureTourTargetRect(step),
        toggleRect = featureTourTargetRect({ targets:["#canvasAgentToggle"] });
      return Boolean(panel?.isConnected && (panelRect || toggleRect));
    }
    return Boolean(featureTourTargetRect(step));
  }
  function availableFeatureTourSteps(steps) {
    return (Array.isArray(steps) ? steps : []).filter(featureTourStepAvailable);
  }
  function syncFeatureTourPreview(step) {
    const showCanvasAgent = step?.preview === "canvas-agent-panel";
    if (showCanvasAgent && canvasAgentPanel.hidden) {
      featureTour.canvasAgentOpenedForTour = true;
      openCanvasAgent({ focus:false, connect:false, animate:false });
    } else if (!showCanvasAgent && featureTour.canvasAgentOpenedForTour) {
      featureTour.canvasAgentOpenedForTour = false;
      if (!canvasAgentPanel.hidden) closeCanvasAgent({ focus:false, animate:false });
    }
  }
  function featureTourTargetNeedsScroll(rect) {
    const viewport = featureTourViewport(),
      margin = 10;
    return rect && (rect.top < viewport.top + margin || rect.left < viewport.left + margin || rect.bottom > viewport.top + viewport.height - margin || rect.right > viewport.left + viewport.width - margin);
  }
  function observeFeatureTourTargets(elements) {
    featureTour.resizeObserver?.disconnect();
    featureTour.resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(scheduleFeatureTourPosition) : null;
    for (const element of elements) featureTour.resizeObserver?.observe(element);
  }
  function stopActiveFeatureTourObserver() {
    featureTour.activeObserver?.disconnect();
    featureTour.activeObserver = null;
  }
  function featureTourObserverTarget() {
    if (window.PENECHO_CONFIG?.runtime === "viewer") return null;
    const target = document.body;
    return typeof Node === "function" && target instanceof Node ? target : null;
  }
  function observeActiveFeatureTour() {
    stopActiveFeatureTourObserver();
    const target = featureTourObserverTarget();
    if (typeof MutationObserver !== "function" || !target) return false;
    featureTour.activeObserver = new MutationObserver((records) => {
      if (featureTour.active && records.some((record) => !tourLayer.contains(record.target))) scheduleFeatureTourPosition();
    });
    featureTour.activeObserver.observe(target, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["hidden", "class", "style", "aria-hidden", "open"],
    });
    return true;
  }
  function focusTargetAvailableOutsideLayer(layer, target) {
    return Boolean(target?.isConnected && typeof target.focus === "function" && target.disabled !== true && target !== document.body && !layer?.contains(target) && !target.closest?.('[hidden], [inert], [aria-hidden="true"]'));
  }
  function hideLayerWithoutRetainedFocus(layer, ...focusTargets) {
    if (!layer) return false;
    const active = document.activeElement;
    if (layer.contains(active)) {
      const target = focusTargets.find((candidate) => focusTargetAvailableOutsideLayer(layer, candidate));
      target?.focus({ preventScroll:true });
      if (layer.contains(document.activeElement)) active?.blur?.();
    }
    layer.hidden = true;
    layer.setAttribute("aria-hidden", "true");
    return true;
  }
  function scheduleFeatureTourPosition() {
    if (!featureTour.active || featureTour.positionFrame) return;
    featureTour.positionFrame = requestAnimationFrame(positionFeatureTour);
  }
  function handleFeatureTourViewportChange() {
    if (featureTour.active) scheduleFeatureTourPosition();
    else if (featureTour.pendingObserver) scheduleFeatureTourPendingRetry();
  }
  function positionFeatureTour() {
    featureTour.positionFrame = 0;
    if (!featureTour.active) return;
    const step = featureTour.steps[featureTour.index],
      elements = featureTourElements(step),
      target = featureTourTargetRect(step, elements);
    if (!target) {
      runtimeElementStyle(tourHighlight, "tour-highlight")?.setProperty("visibility", "hidden");
      runtimeElementStyle(tourCard, "tour-card")?.setProperty("visibility", "hidden");
      showFeatureTourStep(featureTour.index + 1, 1);
      return;
    }
    featureTour.targets = elements;
    const viewport = featureTourViewport(),
      layerStyle = runtimeElementStyle(tourLayer, "tour-layer"),
      padding = step.padding ?? 7,
      viewportRight = viewport.left + viewport.width,
      viewportBottom = viewport.top + viewport.height,
      left = Math.max(viewport.left + 2, target.left - padding),
      top = Math.max(viewport.top + 2, target.top - padding),
      right = Math.min(viewportRight - 2, target.right + padding),
      bottom = Math.min(viewportBottom - 2, target.bottom + padding);
    layerStyle?.setProperty("--tour-viewport-width", `${Math.max(1, Math.floor(viewport.width))}px`);
    layerStyle?.setProperty("--tour-viewport-height", `${Math.max(1, Math.floor(viewport.height))}px`);
    tourCard.classList.toggle("tour-compact", viewport.width < 300);
    const highlightStyle = runtimeElementStyle(tourHighlight, "tour-highlight"),
      cardStyle = runtimeElementStyle(tourCard, "tour-card");
    highlightStyle?.setProperty("left", `${Math.round(left)}px`);
    highlightStyle?.setProperty("top", `${Math.round(top)}px`);
    highlightStyle?.setProperty("width", `${Math.max(2, Math.round(right - left))}px`);
    highlightStyle?.setProperty("height", `${Math.max(2, Math.round(bottom - top))}px`);
    highlightStyle?.setProperty("border-radius", `${step.radius ?? 10}px`);
    const cardRect = pageLayoutRect(tourCard),
      coachmarkMargin = viewport.width <= 620 ? 8 : 12,
      position = TOUR.placeCoachmark(target, { width: cardRect.width, height: cardRect.height }, viewport, step.placement, { margin: coachmarkMargin, gap: 15, arrowMargin: 23 });
    cardStyle?.setProperty("left", `${Math.round(position.x)}px`);
    cardStyle?.setProperty("top", `${Math.round(position.y)}px`);
    cardStyle?.setProperty("--tour-arrow-offset", `${Math.round(position.arrowOffset)}px`);
    tourCard.dataset.placement = position.placement;
    highlightStyle?.setProperty("visibility", "visible");
    cardStyle?.setProperty("visibility", "visible");
    if (!featureTour.shownIds.has(step.id)) {
      featureTour.shownIds.add(step.id);
      markFeatureTourStepsSeen([step]);
    }
  }
  function updateFeatureTourLanguage() {
    if (!featureTour.active) return;
    const step = featureTour.steps[featureTour.index],
      current = featureTour.index + 1,
      total = featureTour.steps.length,
      counter = t("tourStepCounter").replace("{current}", String(current)).replace("{total}", String(total));
    tourBadge.textContent = t(featureTour.newOnly ? "tourBadgeNew" : "tourBadge");
    tourProgress.textContent = counter;
    tourTitle.textContent = t(step.titleKey);
    tourBody.textContent = t(step.bodyKey);
    tourBackButton.textContent = t("tourBack");
    tourSkipButton.textContent = t("tourSkip");
    tourNextButton.textContent = t(current === total ? "tourDone" : "tourNext");
    tourBackButton.disabled = featureTour.index === 0;
    tourProgressTrack.setAttribute("aria-label", t("tourProgress"));
    tourProgressTrack.setAttribute("aria-valuemax", String(total));
    tourProgressTrack.setAttribute("aria-valuenow", String(current));
    runtimeElementStyle(tourProgressBar, "tour-progress")?.setProperty("width", `${(current / total) * 100}%`);
    tourCard.dataset.stepId = step.id;
    scheduleFeatureTourPosition();
  }
  function showFeatureTourStep(index, direction = 1) {
    let nextIndex = index,
      elements = [];
    while (nextIndex >= 0 && nextIndex < featureTour.steps.length) {
      syncFeatureTourPreview(featureTour.steps[nextIndex]);
      elements = featureTourElements(featureTour.steps[nextIndex]);
      if (featureTourTargetRect(featureTour.steps[nextIndex], elements)) break;
      nextIndex += direction;
    }
    if (nextIndex < 0 || nextIndex >= featureTour.steps.length) {
      closeFeatureTour();
      return false;
    }
    featureTour.index = nextIndex;
    featureTour.targets = elements;
    runtimeElementStyle(tourCard, "tour-card")?.setProperty("visibility", "hidden");
    runtimeElementStyle(tourHighlight, "tour-highlight")?.setProperty("visibility", "hidden");
    updateFeatureTourLanguage();
    const rect = featureTourTargetRect(featureTour.steps[nextIndex], elements);
    if (featureTourTargetNeedsScroll(rect)) elements[0].scrollIntoView({ block: featureTour.steps[nextIndex].placement === "center" ? "center" : "nearest", inline: "nearest", behavior: "auto" });
    observeFeatureTourTargets(elements);
    const stepId = featureTour.steps[nextIndex].id;
    requestAnimationFrame(() => {
      if (!featureTour.active || featureTour.steps[featureTour.index]?.id !== stepId) return;
      positionFeatureTour();
      if (featureTour.active && featureTour.steps[featureTour.index]?.id === stepId) tourTitle.focus({ preventScroll: true });
    });
    return true;
  }
  function startFeatureTour(steps, options = {}) {
    const available = availableFeatureTourSteps(steps);
    if (!available.length || !tourLayer || !TOUR) return false;
    if (featureTour.active) closeFeatureTour({ restore: false, scroll: false, retry: false, changelog: false });
    cancelAnimationFrame(featureTour.retryFrame);
    featureTour.retryFrame = 0;
    hideAutoDelayControl();
    hideEffortControl();
    hidePluginControl();
    featureTour.active = true;
    featureTour.steps = available;
    featureTour.index = 0;
    featureTour.replay = Boolean(options.replay);
    featureTour.newOnly = Boolean(options.newOnly);
    featureTour.shownIds = new Set();
    featureTour.restoreFocus = document.activeElement;
    featureTour.restoreScrollX = window.scrollX;
    featureTour.restoreScrollY = window.scrollY;
    tourMain.inert = true;
    document.body.classList.add("tour-open");
    tourLayer.hidden = false;
    tourLayer.setAttribute("aria-hidden", "false");
    runtimeElementStyle(tourHighlight, "tour-highlight")?.setProperty("visibility", "hidden");
    observeActiveFeatureTour();
    return showFeatureTourStep(0, 1);
  }
  function closeFeatureTour(options = {}) {
    if (!featureTour.active) return false;
    const restore = options.restore !== false,
      restoreScroll = options.scroll !== false,
      restoreFocus = featureTour.restoreFocus;
    featureTour.active = false;
    cancelAnimationFrame(featureTour.positionFrame);
    featureTour.positionFrame = 0;
    featureTour.resizeObserver?.disconnect();
    featureTour.resizeObserver = null;
    stopActiveFeatureTourObserver();
    featureTour.targets = [];
    tourMain.inert = false;
    const restoreTarget = focusTargetAvailableOutsideLayer(tourLayer, restoreFocus) ? restoreFocus : settingsButton;
    hideLayerWithoutRetainedFocus(tourLayer, restore ? restoreTarget : settingsButton, settingsButton);
    syncFeatureTourPreview(null);
    document.body.classList.remove("tour-open");
    runtimeElementStyle(tourHighlight, "tour-highlight")?.setProperty("visibility", "hidden");
    runtimeElementStyle(tourCard, "tour-card")?.setProperty("visibility", "hidden");
    if (restoreScroll) window.scrollTo({ left: featureTour.restoreScrollX, top: featureTour.restoreScrollY, behavior: "auto" });
    requestAnimationFrame(() => {
      if (featureTour.active) return;
      if (options.changelog !== false && maybeShowChangelog()) return;
      if (restore && document.activeElement !== restoreTarget) restoreTarget?.focus({ preventScroll: true });
    });
    if (options.retry !== false) scheduleFeatureTourPendingRetry();
    return true;
  }
  function nextFeatureTourStep() {
    if (!featureTour.active) return false;
    if (featureTour.index >= featureTour.steps.length - 1) return closeFeatureTour();
    return showFeatureTourStep(featureTour.index + 1, 1);
  }
  function previousFeatureTourStep() {
    if (!featureTour.active || featureTour.index <= 0) return false;
    return showFeatureTourStep(featureTour.index - 1, -1);
  }
  function skipFeatureTour() {
    if (!featureTour.active) return false;
    markFeatureTourStepsSeen(availableFeatureTourSteps(FEATURE_TOUR_STEPS));
    return closeFeatureTour();
  }
  function replayFeatureTour() {
    readFeatureTourProgress();
    return startFeatureTour(FEATURE_TOUR_STEPS, { replay: true, newOnly: false });
  }
  function stopFeatureTourPendingObserver() {
    featureTour.pendingObserver?.disconnect();
    featureTour.pendingObserver = null;
  }
  function scheduleFeatureTourPendingRetry() {
    if (featureTour.active || featureTour.retryFrame) return false;
    featureTour.retryFrame = requestAnimationFrame(() => {
      featureTour.retryFrame = 0;
      if (featureTour.active) return;
      maybeStartFeatureTour(true);
    });
    return true;
  }
  function watchForPendingFeatureTour() {
    const target = featureTourObserverTarget();
    if (featureTour.pendingObserver || typeof MutationObserver !== "function" || !target) return false;
    featureTour.pendingObserver = new MutationObserver((records) => {
      if (!featureTour.active && records.some((record) => !tourLayer.contains(record.target))) scheduleFeatureTourPendingRetry();
    });
    featureTour.pendingObserver.observe(target, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["hidden", "class", "style", "aria-hidden", "open"],
    });
    return true;
  }
  function maybeStartFeatureTour(retry = false) {
    if (featureTour.active || changelog.active || (featureTour.autoChecked && !retry)) return false;
    featureTour.autoChecked = true;
    const progress = readFeatureTourProgress(),
      pending = TOUR.unseenSteps(FEATURE_TOUR_STEPS, progress),
      available = availableFeatureTourSteps(pending);
    if (!pending.length) {
      stopFeatureTourPendingObserver();
      return false;
    }
    if (available.length < pending.length) watchForPendingFeatureTour();
    else stopFeatureTourPendingObserver();
    return available.length ? startFeatureTour(available, { newOnly: progress.seen.length > 0 }) : false;
  }
  function featureTourFocusableButtons() {
    return [tourSkipButton, tourBackButton, tourNextButton].filter((button) => button && !button.disabled && !button.hidden);
  }
  function handleFeatureTourKeydown(event) {
    if (!featureTour.active) return false;
    if (event.key === "Tab") {
      const buttons = featureTourFocusableButtons(),
        current = buttons.indexOf(document.activeElement),
        next = event.shiftKey ? (current <= 0 ? buttons.length - 1 : current - 1) : current < 0 || current === buttons.length - 1 ? 0 : current + 1;
      event.preventDefault();
      event.stopImmediatePropagation();
      buttons[next]?.focus();
      return true;
    }
    if ((event.key === "Enter" || event.key === " ") && event.target instanceof HTMLButtonElement && tourCard.contains(event.target)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      event.target.click();
      return true;
    }
    const action = TOUR.keyAction(event);
    if (action) event.preventDefault();
    event.stopImmediatePropagation();
    if (action === "next") nextFeatureTourStep();
    else if (action === "back") previousFeatureTourStep();
    else if (action === "skip") skipFeatureTour();
    return true;
  }
  function changelogSeen() {
    try {
      return localStorage.getItem(CHANGELOG_STORAGE_KEY) === CHANGELOG_VERSION;
    } catch {
      return false;
    }
  }
  function markChangelogSeen() {
    try {
      localStorage.setItem(CHANGELOG_STORAGE_KEY, CHANGELOG_VERSION);
    } catch {}
  }
  function maybeShowChangelog(force = false) {
    if (!changelogLayer || !changelogDialog || changelog.active || featureTour.active || !pluginPopover.hidden || (!force && changelogSeen())) return false;
    hideAutoDelayControl();
    hideEffortControl();
    hidePluginControl();
    const active = document.activeElement;
    changelog.restoreFocus = active?.isConnected && active !== document.body && !tourLayer.contains(active) ? active : settingsButton;
    changelog.active = true;
    tourMain.inert = true;
    document.body.classList.add("changelog-open");
    changelogLayer.hidden = false;
    changelogLayer.setAttribute("aria-hidden", "false");
    requestAnimationFrame(() => changelogDialog.focus({ preventScroll: true }));
    return true;
  }
  function closeChangelog() {
    if (!changelog.active) return false;
    const restoreFocus = changelog.restoreFocus;
    changelog.active = false;
    changelog.restoreFocus = null;
    markChangelogSeen();
    document.body.classList.remove("changelog-open");
    tourMain.inert = featureTour.active || !pluginPopover.hidden;
    const restoreTarget = focusTargetAvailableOutsideLayer(changelogLayer, restoreFocus) ? restoreFocus : settingsButton;
    hideLayerWithoutRetainedFocus(changelogLayer, restoreTarget, settingsButton);
    requestAnimationFrame(() => {
      if (!featureTour.active && !changelog.active && document.activeElement !== restoreTarget) restoreTarget?.focus({ preventScroll: true });
    });
    scheduleFeatureTourPendingRetry();
    return true;
  }
  function handleChangelogKeydown(event) {
    if (!changelog.active) return false;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeChangelog();
      return true;
    }
    if (event.key !== "Tab") return false;
    const focusable = [changelogCloseButton].filter((button) => button && !button.disabled && !button.hidden),
      current = focusable.indexOf(document.activeElement),
      next = event.shiftKey ? (current <= 0 ? focusable.length - 1 : current - 1) : current < 0 || current === focusable.length - 1 ? 0 : current + 1;
    event.preventDefault();
    event.stopPropagation();
    focusable[next]?.focus();
    return true;
  }
  if (configurationBody && canvasSettingsForm) configurationBody.append(canvasSettingsForm);
  const settings = { open:false, activePage:"appearance", restoreFocus:null, requestTrace:false, cli:{}, cliStatuses:{}, cliInspectionGeneration:0, currentProvider:"api", configurationMode:"", startupConnectionsChecked:false, configurationLoad:null, configurationRestoreFocus:null, connections:[], activeConnectionId:"default", connectionLimit:10, editingConnectionId:null, deepSeekSearchProvider:"deepseek-official", hasDeepSeekSearchApiKey:false, hasTavilyApiKey:false, searchTestResults:null, searchTestGeneration:0, searchTestBusy:false, fetchedApiModels:[], fetchingApiModels:false, connectionActionBusy:false };
  const hostedSettings = { models:[], credits:null, loading:false, generation:0, signedIn:false, error:false };
  function hostedMultiplierLabel(value) {
    return `${Number(value).toLocaleString(undefined, { maximumFractionDigits:1 })}×`;
  }
  function allAiConnections() {
    return [...hostedSettings.models.map(model => ({ id:`hosted:${model.id}`, provider:"api", apiModel:model.displayName, hosted:true, modelId:model.id, multiplier:model.multiplier })), ...(settings.connectionScope === aiConnectionScope() ? settings.connections : [])];
  }
  function renderHostedModels() {
    const section = document.getElementById("settingsHostedSection"), list = document.getElementById("settingsHostedList"), status = document.getElementById("settingsHostedStatus"), rates = document.getElementById("settingsHostedRates");
    if (!section || !list) return;
    const cloudSetupLink = document.getElementById("settingsCloudSetupLink");
    if (cloudSetupLink) cloudSetupLink.href = `${String(window.PENECHO_CONFIG?.cloudOrigin || (window.PENECHO_CONFIG?.runtime === "cloud" ? location.origin : "https://penecho.ai")).replace(/\/$/, "")}/auth.html`;
    const browserEditing = window.PENECHO_CONFIG?.browserCanvasEditing === true,
      hostUnavailable = browserEditing && window.PENECHO_CONFIG?.linkedDeviceOnline !== true,
      deviceLinked = window.PENECHO_CONFIG?.linkedDeviceLinked === true,
      notice = document.getElementById("settingsHostedBrowserNotice");
    notice.hidden = !hostUnavailable;
    notice.dataset.i18n = deviceLinked ? "settingsLinkedDeviceOffline" : "settingsHostedBrowserNotice";
    notice.textContent = t(notice.dataset.i18n);
    document.getElementById("settingsHostedLinkDevice").hidden = !hostUnavailable || deviceLinked;
    document.getElementById("settingsLocalConnectionsEmpty").hidden = hostUnavailable || settings.connections.length > 0;
    for (const control of settingsConnectionQuickList.querySelectorAll("button")) control.disabled = hostUnavailable;
    for (const control of [settingsOpenApi, settingsOpenSearch, settingsOpenSystem]) {
      control.disabled = hostUnavailable;
      if (hostUnavailable) control.setAttribute("aria-describedby", "settingsHostedBrowserNotice");
      else control.removeAttribute("aria-describedby");
    }
    section.hidden = !hostedSettings.signedIn && !hostedSettings.loading && !hostedSettings.error;
    document.getElementById("settingsCloudAccount").hidden = !hostedSettings.signedIn;
    document.getElementById("settingsCloudSetup").hidden = hostedSettings.signedIn || hostedSettings.loading;
    document.getElementById("settingsCloudAccountStatus").textContent = t("settingsCloudSignedIn").replace("{balance}", t("settingsHostedBalance").replace("{count}", Number(hostedSettings.credits || 0).toLocaleString()));
    status.hidden = !hostedSettings.loading && !hostedSettings.error && hostedSettings.models.length > 0;
    const selected = selectedAiConnectionId();
    status.textContent = hostedSettings.loading ? t("settingsHostedLoading") : hostedSettings.error ? t("settingsHostedError") : hostedSettings.models.length ? t("settingsHostedBalance").replace("{count}", Number(hostedSettings.credits || 0).toLocaleString()) : t("settingsHostedEmpty");
    document.getElementById("settingsHostedRefresh").disabled = hostedSettings.loading;
    list.replaceChildren();
    rates.replaceChildren();
    const pricing = document.getElementById("settingsHostedPricing");
    if (pricing) pricing.hidden = hostedSettings.models.length === 0;
    for (const model of hostedSettings.models) {
      const button = document.createElement("button"), mark = document.createElement("span"), copy = document.createElement("span"), name = document.createElement("strong"), detail = document.createElement("small");
      button.type = "button";
      peChoice(button);
      button.className = `settings-connection-quick${selected === `hosted:${model.id}` ? " active" : ""}`;
      button.dataset.connectionActivate = `hosted:${model.id}`;
      button.setAttribute("aria-pressed", String(selected === button.dataset.connectionActivate));
      mark.textContent = selected === button.dataset.connectionActivate ? "✓" : "";
      mark.setAttribute("aria-hidden", "true");
      const cloudIcon = document.createElement("span");
      cloudIcon.className = "settings-model-cloud-icon";
      cloudIcon.setAttribute("aria-hidden", "true");
      cloudIcon.innerHTML = '<svg viewBox="0 0 24 24"><path d="M7 18h10a4 4 0 0 0 .6-8 6 6 0 0 0-11.5-1A4.5 4.5 0 0 0 7 18Z"/></svg>';
      name.textContent = model.displayName;
      detail.textContent = hostedMultiplierLabel(model.multiplier);
      detail.className = "settings-model-multiplier";
      copy.append(name); button.append(mark, cloudIcon, copy, detail); list.append(button);
    }
    if (hostedSettings.models.length) {
      const table = document.createElement("table");
      table.className = "settings-hosted-rates-table";
      const caption = document.createElement("caption");
      table.append(caption);
      caption.textContent = t("settingsHostedRateUnit");
      const head = document.createElement("thead"), heading = document.createElement("tr");
      head.append(heading); table.append(head);
      for (const key of ["settingsHostedRateModel", "settingsHostedRateMultiplier", "settingsHostedRateInput", "settingsHostedRateRead", "settingsHostedRateOutput"]) {
        const cell = document.createElement("th");
        cell.scope = "col";
        cell.textContent = t(key);
        heading.append(cell);
      }
      const body = document.createElement("tbody");
      table.append(body);
      const number = value => value !== null && value !== undefined && String(value).trim() !== "" && Number.isFinite(Number(value)) ? Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 }) : "—";
      for (const model of hostedSettings.models) {
        const row = document.createElement("tr"), name = document.createElement("th");
        body.append(row);
        name.scope = "row";
        name.textContent = model.displayName;
        row.append(name);
        for (const value of [hostedMultiplierLabel(model.multiplier), number(model.inputCreditsPerMillion), number(model.cacheReadInputCreditsPerMillion), number(model.outputCreditsPerMillion)]) {
          const cell = document.createElement("td"); cell.textContent = value; row.append(cell);
        }
      }
      rates.append(table);
    }
    document.getElementById("settingsHostedBilling").href = `${String(window.PENECHO_CONFIG?.cloudOrigin || (window.PENECHO_CONFIG?.runtime === "cloud" ? location.origin : "https://penecho.ai")).replace(/\/$/, "")}/dashboard.html#billing`;
    if (typeof canvasAgentUpdateConnectionButton === "function") canvasAgentUpdateConnectionButton();
  }
  function loadHostedModels(options = {}) {
    if (hostedSettings.loadPromise && !options.accountChanged) return hostedSettings.loadPromise;
    const pending = loadHostedModelsOnce(options);
    const wrapped = pending.finally(() => { if (hostedSettings.loadPromise === wrapped) hostedSettings.loadPromise = null; });
    hostedSettings.loadPromise = wrapped;
    return wrapped;
  }
  async function loadHostedModelsOnce({ accountChanged = false } = {}) {
    if (window.PENECHO_CONFIG?.runtime === "viewer" || (hostedSettings.loading && !accountChanged)) return;
    if (accountChanged) { hostedSettings.models = []; hostedSettings.credits = null; hostedSettings.signedIn = false; }
    const generation = ++hostedSettings.generation, cloud = window.PENECHO_CONFIG?.runtime === "cloud";
    hostedSettings.loading = true; hostedSettings.error = false; renderHostedModels();
    try {
      const response = await fetch(cloud ? "/api/v1/models" : "/api/cloud/models", { headers:authenticatedApiHeaders(), signal:AbortSignal.timeout(12_000) });
      if (generation !== hostedSettings.generation) return;
      if ([401, 403].includes(response.status)) { window.PENECHO_CONFIG.connectionAccountId = ""; hostedSettings.signedIn = false; hostedSettings.models = []; return; }
      if (!response.ok) throw new Error("catalog_unavailable");
      const body = await response.json();
      if (generation !== hostedSettings.generation) return;
      window.PENECHO_CONFIG.connectionAccountId = String(body.accountId || window.PENECHO_CONFIG.connectionAccountId || "");
      if (!cloud && body.origin) window.PENECHO_CONFIG.cloudOrigin = body.origin;
      hostedSettings.signedIn = true;
      hostedSettings.models = (Array.isArray(body.models) ? body.models : []).filter(model => model.available === true && model.enabled !== false && !model.retiredAt && Number(model.multiplier) > 0).slice(0, 100);
      const hostedKey = aiConnectionStorageKey(true), localKey = aiConnectionStorageKey(), legacy = localStorage.getItem(AI_CONNECTION_STORAGE_KEY);
      // Migrate history only before a scoped choice exists. A catalog arriving
      // after the user selects a local connection must never select Cloud.
      if (hostedKey && !localStorage.getItem(hostedKey) && localStorage.getItem(`${hostedKey}:selected`) === null
        && !(localKey && localStorage.getItem(localKey)) && legacy?.startsWith("hosted:")
        && hostedSettings.models.some(model => `hosted:${model.id}` === legacy)) storeAiConnectionSelection(legacy);
      if (body.credits) hostedSettings.credits = body.credits.availableCredits ?? body.credits.available ?? body.credits.balance ?? 0;
      else {
        const balance = await fetch("/api/v1/credits", { headers:authenticatedApiHeaders(), signal:AbortSignal.timeout(8_000) });
        if (balance.ok && generation === hostedSettings.generation) { const payload = await balance.json(); if (generation === hostedSettings.generation) hostedSettings.credits = payload.credits?.availableCredits ?? payload.credits?.available ?? payload.credits?.balance ?? 0; }
      }
    } catch { if (generation === hostedSettings.generation) { hostedSettings.error = true; hostedSettings.models = []; } }
    finally { if (generation === hostedSettings.generation) { hostedSettings.loading = false; renderHostedModels(); } }
  }
  function syncLocalConnectionSelection() {
    const scope = aiConnectionScope(), key = aiConnectionStorageKey();
    if (settings.connectionScope && settings.connectionScope !== scope) settings.connections = [];
    settings.connectionScope = scope;
    let selected = selectedAiConnectionId();
    // Migrate only a UUID proven to belong to this exact host. Never substitute
    // a different model when a Cloud selection disappears.
    if (key && !localStorage.getItem(key) && !selected.startsWith("hosted:")) {
      const legacy = localStorage.getItem(AI_CONNECTION_STORAGE_KEY);
      if (legacy && settings.connections.some(connection => connection.id === legacy)) {
        storeAiConnectionSelection(legacy);
        selected = legacy;
      }
    }
    if (window.PENECHO_CONFIG?.runtime !== "cloud" && selected === "default" && key && !localStorage.getItem(key)) {
      selected = settings.connections[0]?.id || "default";
      storeAiConnectionSelection(selected);
    }
    settings.activeConnectionId = selected;
    settings.connections = settings.connections.map(connection => ({ ...connection, active:connection.id === selected }));
  }
  function setConfigurationSection(section, visible) {
    if (!section) return;
    section.hidden = !visible;
    for (const control of section.querySelectorAll("input, select, button")) control.disabled = !visible;
  }
  function openConfiguration(mode, restoreTarget = null) {
    if (window.PENECHO_CONFIG?.browserCanvasEditing && window.PENECHO_CONFIG?.linkedDeviceOnline !== true) return false;
    if (!configurationLayer || !canvasSettingsForm) return false;
    closeSettings(false);
    settings.configurationMode = mode;
    settings.configurationRestoreFocus = restoreTarget || (mode === "api" ? settingsOpenApi : mode === "search" ? settingsOpenSearch : settingsOpenSystem);
    configurationTitle.textContent = t(mode === "api" ? "settingsApiDialogTitle" : mode === "search" ? "settingsSearchDialogTitle" : "settingsSystemDialogTitle");
    configurationSubtitle.textContent = t(mode === "api" ? "settingsApiDialogSubtitle" : mode === "search" ? "settingsSearchDialogSubtitle" : "settingsSystemDialogSubtitle");
    setConfigurationSection(canvasSettingsForm.querySelector(".settings-api-group"), mode === "api");
    setConfigurationSection(canvasSettingsForm.querySelector(".settings-system-group"), mode === "system");
    setConfigurationSection(canvasSettingsForm.querySelector(".settings-search-group"), mode === "search");
    connectionManager.hidden = mode !== "api";
    canvasSettingsForm.dataset.editorHidden = String(mode === "api");
    settingsEditorCancel.hidden = mode !== "api";
    settingsTestConnection.hidden = mode !== "api";
    settingsTestSearch.hidden = mode !== "search";
    settingsInstallCli.hidden = true;
    settingsSaveButton.textContent = t(mode === "api" ? "settingsSaveConnection" : mode === "search" ? "settingsSaveSearch" : "settingsSave");
    canvasSettingsForm.hidden = false;
    configurationLayer.hidden = false;
    configurationLayer.setAttribute("aria-hidden", "false");
    setSettingsStatus();
    void loadCanvasSettings();
    requestAnimationFrame(() => configurationPanel.focus({ preventScroll:true }));
    return true;
  }
  function closeConfiguration(restore = true) {
    if (!settings.configurationMode) return false;
    const restoreFocus = settings.configurationRestoreFocus,
      restoreTarget = focusTargetAvailableOutsideLayer(configurationLayer, restoreFocus) ? restoreFocus : settingsButton;
    settings.configurationMode = "";
    settings.configurationRestoreFocus = null;
    hideSettingsEffortOptions();
    hideLayerWithoutRetainedFocus(configurationLayer, restore ? restoreTarget : settingsButton, settingsButton);
    canvasSettingsForm.hidden = true;
    if (restore && document.activeElement !== restoreTarget) requestAnimationFrame(() => restoreTarget?.focus({ preventScroll:true }));
    return true;
  }
  function updateSettingsProviderFields() {
    const provider = settingsProvider?.value || "api", api = provider === "api";
    if (settings.currentProvider !== "api" && settings.currentProvider !== provider) settings.cli[settings.currentProvider] = { model:settingsCliModel.value, path:settingsCliPath.value };
    settings.currentProvider = provider;
    settingsApiFields.hidden = !api;
    settingsCliFields.hidden = api;
    settingsKimiCliRecommendation.hidden = provider !== "kimi-cli";
    for (const control of settingsApiFields.querySelectorAll("input, select")) control.disabled = !api || settings.configurationMode !== "api";
    for (const control of settingsCliFields.querySelectorAll("input, select")) control.disabled = api || settings.configurationMode !== "api";
    clearFetchedApiModels();
    settingsApiSaved.hidden = !api || settingsApiSaved.dataset.saved !== "true";
    updateConnectionModelFetchState();
    showCliInstaller("", false);
    if (!api) {
      const values = settings.cli[provider] || {};
      settingsCliModel.value = values.model || "";
      settingsCliPath.value = values.path || ({ "kimi-cli":"kimi", "codex-cli":"codex", "claude-cli":"claude" }[provider] || "");
      void inspectCanvasCli(provider);
    } else if (settingsCliStatus) {
      settingsCliStatus.hidden = true;
    }
    updateApiPresetFields(false);
  }
  function defaultConnectionEffort(provider = settingsProvider?.value || "api") {
    return "medium";
  }
  function updateSettingsEffortOptions() {
    const selected = settingsEffort.value.trim();
    settingsEffortOptions?.querySelectorAll("[data-effort-value]").forEach((option) => option.setAttribute("aria-selected", String(option.dataset.effortValue === selected)));
  }
  function hideSettingsEffortOptions() {
    if (!settingsEffortOptions) return;
    settingsEffortOptions.hidden = true;
    settingsEffort.setAttribute("aria-expanded", "false");
    settingsEffortToggle?.setAttribute("aria-expanded", "false");
  }
  function showSettingsEffortOptions() {
    if (!settingsEffortOptions || settingsEffort.disabled || settingsEffortToggle?.disabled) return;
    updateSettingsEffortOptions();
    settingsEffortOptions.hidden = false;
    settingsEffort.setAttribute("aria-expanded", "true");
    settingsEffortToggle?.setAttribute("aria-expanded", "true");
  }
  function chooseSettingsEffort(value) {
    settingsEffort.value = String(value || "");
    updateSettingsEffortOptions();
    hideSettingsEffortOptions();
    settingsEffort.focus({ preventScroll:true });
  }
  function handleSettingsEffortKeydown(event) {
    if (event.key === "Escape") {
      if (settingsEffortOptions?.hidden) return;
      event.preventDefault();
      hideSettingsEffortOptions();
      return;
    }
    if (event.key !== "ArrowDown") return;
    event.preventDefault();
    showSettingsEffortOptions();
    const options = [...settingsEffortOptions.querySelectorAll("[data-effort-value]")], selected = options.find(option => option.getAttribute("aria-selected") === "true");
    (selected || options[0])?.focus({ preventScroll:true });
  }
  function handleSettingsEffortOptionKeydown(event) {
    const option = event.target.closest("[data-effort-value]");
    if (!option) return;
    const options = [...settingsEffortOptions.querySelectorAll("[data-effort-value]")], index = options.indexOf(option);
    if (event.key === "Escape") {
      event.preventDefault();
      hideSettingsEffortOptions();
      settingsEffort.focus({ preventScroll:true });
      return;
    }
    const next = event.key === "ArrowDown" ? options[(index + 1) % options.length] : event.key === "ArrowUp" ? options[(index - 1 + options.length) % options.length] : event.key === "Home" ? options[0] : event.key === "End" ? options.at(-1) : null;
    if (!next) return;
    event.preventDefault();
    next.focus({ preventScroll:true });
  }
  function selectDefaultConnectionEffort() {
    settingsEffort.value = defaultConnectionEffort();
    updateSettingsEffortOptions();
  }
  function apiPresetForConnection(connection = {}) {
    if (connection.apiPreset && API_PRESETS[connection.apiPreset]) return [connection.apiPreset, API_PRESETS[connection.apiPreset]];
    const url = String(connection.apiUrl || "").trim().replace(/\/+$/, ""), format = String(connection.apiFormat || "").trim().toLowerCase();
    return Object.entries(API_PRESETS).find(([, preset]) => preset.url === url && (!format || preset.format === format)) || null;
  }
  function selectedApiPreset() {
    const family = settingsApiFormat?.value || "openai";
    return API_PRESETS[`${family}-${settingsApiRegion?.value || "global"}-${settingsApiService?.value || "api"}`] || null;
  }
  function updateKimiSignup() {
    if (!settingsKimiSignup || !settingsKimiSignupLink) return;
    const isKimi = settingsApiFormat?.value === "kimi";
    settingsKimiSignup.hidden = !isKimi;
    if (!isKimi) return;
    const service = settingsApiService?.value === "coding" ? "coding" : "api",
      destination = service === "coding" ? KIMI_SIGNUP.coding : KIMI_SIGNUP.api[settingsApiRegion?.value === "china" ? "china" : "global"];
    settingsKimiSignupLink.href = destination.url;
    settingsKimiSignupLink.dataset.i18n = destination.label;
    settingsKimiSignupLink.textContent = t(destination.label);
  }
  function apiModelSuggestions() {
    const presets = API_MODELS[settingsApiFormat?.value || "openai"] || [], presetValues = new Set(presets);
    return [...new Set([...presets, ...settings.fetchedApiModels.filter(model => !presetValues.has(model))])];
  }
  function updateApiModelChoices() {
    if (!settingsApiModelPresets) return;
    const models = apiModelSuggestions();
    settingsApiModelPresets.replaceChildren(...models.map(model => {
      const option = document.createElement("option");
      option.value = model;
      return option;
    }));
    settingsApiModelOptions?.replaceChildren(...models.map(model => {
      const option = document.createElement("button");
      option.type = "button";
      option.role = "option";
      peButton(option, "menu-item", "");
      option.dataset.apiModelValue = model;
      option.textContent = model;
      return option;
    }));
    updateApiModelSelection();
  }
  function updateApiModelSelection() {
    const selected = settingsApiModel?.value.trim() || "";
    settingsApiModelOptions?.querySelectorAll("[data-api-model-value]").forEach(option => option.setAttribute("aria-selected", String(option.dataset.apiModelValue === selected)));
  }
  function clearFetchedApiModels() {
    settings.fetchedApiModels = [];
    hideApiModelOptions();
    updateApiModelChoices();
  }
  function hideApiModelOptions() {
    if (!settingsApiModelOptions) return;
    settingsApiModelOptions.hidden = true;
    settingsApiModel?.setAttribute("aria-expanded", "false");
  }
  function showApiModelOptions() {
    if (!settingsApiModelOptions || settingsApiModel?.disabled || !settingsApiModelOptions.firstElementChild) return;
    updateApiModelSelection();
    settingsApiModelOptions.hidden = false;
    settingsApiModel.setAttribute("aria-expanded", "true");
  }
  function chooseApiModel(value) {
    settingsApiModel.value = String(value || "");
    updateApiModelSelection();
    hideApiModelOptions();
    settingsApiModel.focus({ preventScroll:true });
  }
  function handleApiModelKeydown(event) {
    if (event.key === "Escape") {
      if (settingsApiModelOptions?.hidden) return;
      event.preventDefault();
      hideApiModelOptions();
      return;
    }
    if (event.key !== "ArrowDown") return;
    event.preventDefault();
    showApiModelOptions();
    const options = [...settingsApiModelOptions.querySelectorAll("[data-api-model-value]")], selected = options.find(option => option.getAttribute("aria-selected") === "true");
    (selected || options[0])?.focus({ preventScroll:true });
  }
  function handleApiModelOptionKeydown(event) {
    const option = event.target.closest("[data-api-model-value]");
    if (!option) return;
    const options = [...settingsApiModelOptions.querySelectorAll("[data-api-model-value]")], index = options.indexOf(option);
    if (event.key === "Escape") {
      event.preventDefault();
      hideApiModelOptions();
      settingsApiModel.focus({ preventScroll:true });
      return;
    }
    const next = event.key === "ArrowDown" ? options[(index + 1) % options.length] : event.key === "ArrowUp" ? options[(index - 1 + options.length) % options.length] : event.key === "Home" ? options[0] : event.key === "End" ? options.at(-1) : null;
    if (!next) return;
    event.preventDefault();
    next.focus({ preventScroll:true });
  }
  function updateApiPresetFields(applyDefaults = false, resetModel = false) {
    if (!settingsApiFormat || !settingsApiPresetFields) return;
    const family = settingsApiFormat.value, presetFamily = family === "kimi" || family === "minimax",
      enabled = presetFamily && settingsProvider?.value === "api" && settings.configurationMode === "api";
    settingsApiPresetFields.hidden = !presetFamily;
    for (const control of settingsApiPresetFields.querySelectorAll("select")) control.disabled = !enabled;
    updateKimiSignup();
    if (resetModel) clearFetchedApiModels();
    updateApiModelChoices();
    const defaults = selectedApiPreset() || API_DEFAULTS[family];
    if (!applyDefaults || !defaults) return;
    settingsApiUrl.value = defaults.url;
    if (resetModel || !settingsApiModel.value.trim()) settingsApiModel.value = defaults.model;
  }
  function fillApiEditor(connection = {}) {
    const matched = apiPresetForConnection(connection), preset = matched?.[1] || null;
    settings.fetchedApiModels = [];
    hideApiModelOptions();
    settingsApiFormat.value = preset?.family || (connection.apiFormat === "anthropic" ? "anthropic" : "openai");
    settingsApiRegion.value = preset?.region || "global";
    settingsApiService.value = preset?.service || "api";
    updateApiPresetFields(false);
    settingsApiUrl.value = connection.apiUrl || API_DEFAULTS[connection.apiFormat === "anthropic" ? "anthropic" : "openai"].url;
    settingsApiModel.value = connection.apiModel || "";
  }
  function connectionProviderLabel(connection) {
    return { "kimi-cli":"Kimi CLI", "codex-cli":"Codex CLI", "claude-cli":"Claude CLI" }[connection.provider] || connection.provider;
  }
  function connectionTitle(connection) {
    const title = connection.provider === "api" ? connection.apiModel || "API" : connection.cliModel || t("settingsCliDefaultModel");
    return connection.hosted ? `☁️ ${title}` : title;
  }
  function connectionSummary(connection) {
    return connection.provider === "api" ? connection.apiUrl || "" : connectionProviderLabel(connection);
  }
  function setConnectionStatus(message = "", kind = "") {
    if (!settingsConnectionStatus) return;
    settingsConnectionStatus.textContent = message;
    settingsConnectionStatus.className = `settings-save-status${kind ? ` ${kind}` : ""}`;
  }
  function renderConnectionLists() {
    if (!settingsConnectionList || !settingsConnectionQuickList) return;
    settingsConnectionList.replaceChildren();
    settingsConnectionQuickList.replaceChildren();
    document.getElementById("settingsLocalConnectionsEmpty").hidden = settings.connections.length > 0;
    for (const connection of settings.connections) {
      const quick = document.createElement("button"), quickMark = document.createElement("span"), quickCopy = document.createElement("span"), quickName = document.createElement("strong"), quickSummary = document.createElement("small");
      quick.type = "button";
      peChoice(quick);
      quick.className = `settings-connection-quick${connection.active ? " active" : ""}`;
      quick.dataset.connectionActivate = connection.id;
      quick.setAttribute("aria-pressed", String(connection.active));
      quickMark.setAttribute("aria-hidden", "true");
      quickMark.textContent = connection.active ? "✓" : "";
      quickName.textContent = connectionTitle(connection);
      quickSummary.textContent = connectionSummary(connection);
      quickCopy.append(quickName, quickSummary);
      quick.append(quickMark, quickCopy);
      settingsConnectionQuickList.append(quick);

      const item = document.createElement("article"), copy = document.createElement("div"), title = document.createElement("div"), name = document.createElement("strong"), summary = document.createElement("p"), actions = document.createElement("div"),
        editing = settings.editingConnectionId === connection.id;
      item.className = `settings-connection-item${editing ? " editing" : ""}`;
      copy.className = "settings-connection-copy";
      title.className = "settings-connection-title";
      name.textContent = connectionTitle(connection);
      title.append(name);
      if (connection.active) {
        const badge = document.createElement("span");
        badge.className = "settings-connection-badge";
        badge.textContent = t("settingsActive");
        title.append(badge);
      }
      summary.textContent = connectionSummary(connection);
      copy.append(title, summary);
      actions.className = "settings-connection-actions";
      if (!connection.active) {
        const use = document.createElement("button");
        use.type = "button";
        peButton(use, "secondary", "compact");
        use.dataset.connectionActivate = connection.id;
        use.textContent = t("settingsUse");
        actions.append(use);
      }
      const edit = document.createElement("button");
      edit.type = "button";
      peButton(edit, "secondary", "compact");
      edit.dataset.connectionEdit = connection.id;
      edit.textContent = t("settingsEdit");
      actions.append(edit);
      if (connection.removable) {
        const remove = document.createElement("button");
        remove.type = "button";
        peButton(remove, "danger", "compact");
        remove.className = "danger";
        remove.dataset.connectionDelete = connection.id;
        remove.textContent = t("settingsDelete");
        actions.append(remove);
      }
      item.append(copy, actions);
      settingsConnectionList.append(item);
    }
    connectionLimitText.textContent = t("settingsConnectionCount").replace("{count}", String(settings.connections.length)).replace("{limit}", String(settings.connectionLimit));
    settingsAddConnection.disabled = settings.connections.length >= settings.connectionLimit;
    if (typeof canvasAgentUpdateConnectionButton === "function") canvasAgentUpdateConnectionButton();
    renderHostedModels();
  }
  function fillConnectionEditor(connection = null) {
    settings.editingConnectionId = connection?.id || null;
    const provider = connection?.provider || "api";
    settingsProvider.value = provider;
    settings.currentProvider = provider;
    fillApiEditor(connection || { apiFormat:API_DEFAULTS.openai.format, apiUrl:API_DEFAULTS.openai.url, apiModel:API_DEFAULTS.openai.model });
    settingsApiKey.value = "";
    settingsApiSaved.dataset.saved = String(connection?.hasApiKey === true);
    settings.cli[provider] = { model:connection?.cliModel || "", path:connection?.cliPath || provider.replace("-cli", "") };
    settingsEffort.value = connection?.effort || defaultConnectionEffort(provider);
    updateSettingsEffortOptions();
    canvasSettingsForm.dataset.editorHidden = "false";
    updateSettingsProviderFields();
    renderConnectionLists();
    setSettingsStatus();
    requestAnimationFrame(() => settingsProvider.focus({ preventScroll:true }));
  }
  function hideConnectionEditor() {
    settings.editingConnectionId = null;
    canvasSettingsForm.dataset.editorHidden = "true";
    settingsApiKey.value = "";
    hideSettingsEffortOptions();
    hideApiModelOptions();
    renderConnectionLists();
    setSettingsStatus();
  }
  function setSettingsStatus(message = "", kind = "") {
    if (!settingsSaveStatus) return;
    settingsSaveStatus.textContent = message;
    settingsSaveStatus.className = `settings-save-status${kind ? ` ${kind}` : ""}`;
  }
  function connectionEditorPayload() {
    const provider = settingsProvider.value;
    if (provider !== "api") settings.cli[provider] = { model:settingsCliModel.value, path:settingsCliPath.value };
    const apiPreset = provider === "api" ? selectedApiPreset() : null;
    return {
      provider, apiFormat:apiPreset?.format || settingsApiFormat.value, apiPreset:apiPreset ? `${apiPreset.family}-${apiPreset.region}-${apiPreset.service}` : "", apiUrl:settingsApiUrl.value, apiModel:settingsApiModel.value,
      apiKey:settingsApiKey.value, effort:settingsEffort.value,
      cliModel:provider === "api" ? "" : settingsCliModel.value, cliPath:provider === "api" ? "" : settingsCliPath.value,
    };
  }
  function connectionModelDiscoverySignature() {
    const connection = connectionEditorPayload();
    return JSON.stringify([settings.editingConnectionId || "", connection.provider, connection.apiFormat, connection.apiUrl, connection.apiKey]);
  }
  function updateConnectionModelFetchState() {
    if (!settingsFetchModels) return;
    const api = settingsProvider?.value === "api" && settings.configurationMode === "api";
    settingsFetchModels.disabled = settings.connectionActionBusy || settings.fetchingApiModels || !api;
    settingsFetchModels.setAttribute("aria-busy", String(settings.fetchingApiModels && api));
    settingsFetchModelsLabel.textContent = settings.fetchingApiModels && api ? t("settingsFetchingModels") : t("settingsFetchModels");
  }
  function setConnectionTestBusy(busy) {
    settings.connectionActionBusy = busy;
    settingsTestConnection.disabled = busy;
    if (settingsTestSearch) settingsTestSearch.disabled = busy;
    settingsSaveButton.disabled = busy;
    settingsInstallCli.disabled = busy;
    if (settingsCliCopyCommand) settingsCliCopyCommand.disabled = busy;
    updateConnectionModelFetchState();
  }
  function showCliInstaller(provider, visible, repair = false) {
    settingsInstallCli.hidden = !visible || !window.penechoDesktop?.installCli || !["kimi-cli", "codex-cli", "claude-cli"].includes(provider);
    settingsInstallCli.dataset.provider = settingsInstallCli.hidden ? "" : provider;
    settingsInstallCli.textContent = t(repair ? "settingsRepairCli" : "settingsInstallCli");
  }
  function cliStatusLabel(status) {
    return status?.label || ({ "kimi-cli":"Kimi Code", "codex-cli":"Codex CLI", "claude-cli":"Claude Code" }[status?.provider] || "CLI");
  }
  function showCliCommand(command) {
    settingsCliCommand.textContent = command || "";
    settingsCliCommandRow.hidden = !command;
  }
  function renderCanvasCliStatus(status) {
    if (!settingsCliStatus || !status?.provider || settingsProvider.value !== status.provider) return;
    const label = cliStatusLabel(status), version = status.version ? ` · ${status.version}` : "";
    settings.cliStatuses[status.provider] = status;
    settingsCliStatus.hidden = false;
    settingsCliStatus.dataset.state = status.state || "repair_required";
    if (status.executable) {
      settingsCliPath.value = status.executable;
      settings.cli[status.provider] = { model:settingsCliModel.value, path:status.executable };
    }
    if (status.state === "ready") {
      settingsCliStatusTitle.textContent = t("settingsCliReady").replace("{provider}", label);
      settingsCliStatusDetail.textContent = t("settingsCliReadyDetail")
        .replace("{source}", t(status.source === "managed" ? "settingsCliManaged" : "settingsCliSystem"))
        .replace("{version}", version);
      if (status.authenticationDeferred) settingsCliStatusDetail.textContent += ` ${t("settingsCliKimiAuthDeferred")}`;
      showCliCommand("");
      showCliInstaller("", false);
    } else if (status.state === "auth_required") {
      settingsCliStatusTitle.textContent = t("settingsCliAuthRequired").replace("{provider}", label);
      settingsCliStatusDetail.textContent = t("settingsCliAuthRequiredDetail");
      showCliCommand(status.loginCommand);
      showCliInstaller("", false);
    } else if (status.state === "missing") {
      settingsCliStatusTitle.textContent = t("settingsCliMissing").replace("{provider}", label);
      settingsCliStatusDetail.textContent = t("settingsCliMissingDetail");
      showCliCommand(status.installCommand);
      showCliInstaller(status.provider, true);
    } else if (status.state === "checking") {
      settingsCliStatusTitle.textContent = t("settingsCliChecking");
      settingsCliStatusDetail.textContent = t("settingsCliCheckingDetail");
      showCliCommand("");
      showCliInstaller("", false);
    } else {
      settingsCliStatusTitle.textContent = t("settingsCliRepairRequired").replace("{provider}", label);
      settingsCliStatusDetail.textContent = t("settingsCliRepairRequiredDetail");
      showCliCommand(status.installCommand);
      showCliInstaller(status.provider, true, true);
    }
  }
  async function inspectCanvasCli(provider) {
    if (!provider?.endsWith("-cli")) return;
    const generation = ++settings.cliInspectionGeneration;
    renderCanvasCliStatus({ provider, state:"checking" });
    try {
      const response = await fetch("/api/settings/connections/inspect-cli", {
        method:"POST", headers:authenticatedApiHeaders({ "Content-Type":"application/json" }), body:JSON.stringify({ provider }),
      }), body = await response.json();
      if (!response.ok) throw new Error(body?.error || t("settingsCliInspectionFailed"));
      if (generation !== settings.cliInspectionGeneration || settingsProvider.value !== provider) return;
      renderCanvasCliStatus(body.status);
    } catch (error) {
      if (generation !== settings.cliInspectionGeneration || settingsProvider.value !== provider) return;
      settingsCliStatus.dataset.state = "repair_required";
      settingsCliStatusTitle.textContent = t("settingsCliInspectionFailed");
      settingsCliStatusDetail.textContent = error?.message || t("settingsConnectionTestFailed");
      showCliInstaller("", false);
    }
  }
  async function copyCanvasCliCommand() {
    const command = settingsCliCommand?.textContent || "";
    if (!command) return;
    const copied = await writeClipboardText(command);
    setSettingsStatus(t(copied ? "settingsCliCommandCopied" : "copyFailed"), copied ? "success" : "error");
  }
  async function testCanvasConnection() {
    if (!canvasSettingsForm || !canvasSettingsForm.reportValidity()) return;
    setConnectionTestBusy(true);
    showCliInstaller("", false);
    setSettingsStatus(t("settingsTestingConnection"));
    try {
      const connection = connectionEditorPayload(), response = await fetch("/api/settings/connections/test", {
        method:"POST", headers:authenticatedApiHeaders({ "Content-Type":"application/json" }),
        body:JSON.stringify({ id:settings.editingConnectionId, connection }),
      }), body = await response.json();
      if (!response.ok) {
        const failedProvider = body?.provider || connection.provider;
        if (["missing", "auth_required"].includes(body?.cliState) && failedProvider?.endsWith("-cli")) {
          const previous = settings.cliStatuses[failedProvider] || {}, status = { ...previous, provider:failedProvider, state:body.cliState, loginCommand:body.loginCommand || previous.loginCommand };
          if (body.cliState === "missing" && !status.installCommand) void inspectCanvasCli(failedProvider);
          else renderCanvasCliStatus(status);
        } else showCliInstaller(failedProvider, body?.installable === true);
        throw new Error([body?.error, body?.guidance].filter(Boolean).join(" ") || t("settingsConnectionTestFailed"));
      }
      setSettingsStatus(body?.message || t("settingsConnectionTestPassed"), "success");
    } catch (error) { setSettingsStatus(error?.message || t("settingsConnectionTestFailed"), "error"); }
    finally { setConnectionTestBusy(false); }
  }
  function normalizeFetchedApiModels(models) {
    if (!Array.isArray(models) || models.length > 256) throw new Error(t("settingsModelFetchFailed"));
    if (models.some(model => typeof model !== "string")) throw new Error(t("settingsModelFetchFailed"));
    const values = models.map(model => model.trim());
    if (values.some(model => model.length > 200 || /[\r\n\0]/.test(model)) || new Set(values).size !== values.length) throw new Error(t("settingsModelFetchFailed"));
    return [...new Set(values)].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  }
  async function fetchConnectionModels() {
    if (settingsFetchModels?.disabled || settingsProvider.value !== "api") return;
    if (![settingsApiFormat, settingsApiUrl, settingsApiKey].every(control => control.checkValidity())) return;
    const connection = connectionEditorPayload(), requestSignature = connectionModelDiscoverySignature();
    setConnectionTestBusy(true);
    settings.fetchingApiModels = true;
    updateConnectionModelFetchState();
    hideApiModelOptions();
    setSettingsStatus(t("settingsFetchingModels"));
    try {
      const response = await fetch("/api/settings/connections/models", {
        method:"POST", headers:authenticatedApiHeaders({ "Content-Type":"application/json" }),
        body:JSON.stringify({ id:settings.editingConnectionId, connection }),
      });
      let body = null;
      try { body = await response.json(); } catch {}
      if (!response.ok) throw new Error(body?.error || t("settingsModelFetchFailed"));
      if (requestSignature !== connectionModelDiscoverySignature()) {
        setSettingsStatus();
        return;
      }
      settings.fetchedApiModels = normalizeFetchedApiModels(body?.models);
      updateApiModelChoices();
      if (!settingsApiModel.value.trim() && settings.fetchedApiModels.length) settingsApiModel.value = settings.fetchedApiModels[0];
      updateApiModelSelection();
      showApiModelOptions();
      settingsApiModel.focus({ preventScroll:true });
      setSettingsStatus(t("settingsModelsFetched").replace("{count}", String(settings.fetchedApiModels.length)), "success");
    } catch (error) {
      hideApiModelOptions();
      setSettingsStatus(error?.message || t("settingsModelFetchFailed"), "error");
    } finally {
      settings.fetchingApiModels = false;
      setConnectionTestBusy(false);
    }
  }
  async function installCanvasCli() {
    const provider = settingsInstallCli.dataset.provider;
    if (!window.penechoDesktop?.installCli || !provider) return;
    setConnectionTestBusy(true);
    setSettingsStatus(t("settingsInstallingCli"));
    try {
      const result = await window.penechoDesktop.installCli(provider);
      if (!result?.ok) throw new Error(result?.error || t("settingsCliInstallFailed"));
      settingsCliPath.value = result.executable;
      settings.cli[provider] = { model:settingsCliModel.value, path:result.executable };
      if (result.status) renderCanvasCliStatus(result.status);
      else await inspectCanvasCli(provider);
      if ((result.status || settings.cliStatuses[provider])?.state === "auth_required") {
        setSettingsStatus(t("settingsCliAuthRequiredDetail"));
        setConnectionTestBusy(false);
        return;
      }
      setSettingsStatus(t("settingsCliInstalled"), "success");
    } catch (error) {
      setSettingsStatus(`${error?.message || t("settingsCliInstallFailed")} ${t("settingsCliManualFallback")}`, "error");
      setConnectionTestBusy(false);
      return;
    }
    setConnectionTestBusy(false);
    await testCanvasConnection();
  }
  function updateTraceToggle() {
    if (!settingsTraceToggle) return;
    settingsTraceToggle.classList.toggle("on", settings.requestTrace);
    settingsTraceToggle.setAttribute("aria-checked", String(settings.requestTrace));
  }
  function searchTestConfigured(provider) {
    if (provider === "duckduckgo") return true;
    if (provider === "flash") return Boolean(settingsDeepSeekSearchApiKey?.value.trim() || settings.hasDeepSeekSearchApiKey);
    return Boolean(settingsTavilyApiKey?.value.trim() || settings.hasTavilyApiKey);
  }
  function searchTestStatusCopy(result) {
    const state = result?.state || "request_failed", key = {
      available:"settingsSearchTestAvailable",
      not_configured:"settingsSearchTestNotConfigured",
      region_access_required:"settingsSearchTestRegionAccessRequired",
      http_error:"settingsSearchTestHttpError",
      no_results:"settingsSearchTestNoResults",
      request_failed:"settingsSearchTestRequestFailed",
      timeout:"settingsSearchTestTimeout",
      not_tested:"settingsSearchTestNotTested",
      testing:"settingsSearchTestTesting",
    }[state] || "settingsSearchTestRequestFailed";
    return { state, key, text:t(key).replace("{status}", String(result?.httpStatus || "—")) };
  }
  function renderSearchTestStatuses(results = settings.searchTestResults, testing = false) {
    if (!settingsSearchTestResults) return;
    if (Array.isArray(results)) settings.searchTestResults = results;
    const byProvider = new Map((Array.isArray(results) ? results : []).map(result => [result?.id, result]));
    const provider = settingsDeepSeekSearchProvider?.value === "opencode-go" ? "opencode-go" : "deepseek-official",
      providerLabel = t(provider === "opencode-go" ? "settingsDeepSeekSearchProviderOpenCodeGo" : "settingsDeepSeekSearchProviderOfficial");
    if (settingsSearchTestFlashLabel) settingsSearchTestFlashLabel.textContent = t("settingsSearchTestFlashLabel").replace("{provider}", providerLabel);
    for (const row of settingsSearchTestResults.querySelectorAll("[data-search-test-provider]")) {
      const id=row.dataset.searchTestProvider, configured=searchTestConfigured(id), result=byProvider.get(id), status=result || { state:configured ? testing ? "testing" : "not_tested" : "not_configured" }, copy=searchTestStatusCopy(status), output=row.querySelector("output");
      if (!output) continue;
      output.dataset.state = copy.state;
      output.dataset.i18n = copy.key;
      output.textContent = copy.text;
    }
  }
  function resetSearchTestStatuses() {
    settings.searchTestGeneration += 1;
    settings.searchTestResults = null;
    renderSearchTestStatuses();
  }
  function setSearchTestBusy(busy) {
    settings.searchTestBusy = busy;
    setConnectionTestBusy(busy);
    settingsSearchTestResults?.setAttribute("aria-busy", String(busy));
    if (settingsTestSearch) settingsTestSearch.textContent = t(busy ? "settingsTestingSearch" : "settingsTestSearch");
  }
  async function testCanvasSearch() {
    if (!settingsTestSearch || settings.searchTestBusy) return;
    const generation=++settings.searchTestGeneration;
    setSearchTestBusy(true);
    renderSearchTestStatuses(null, true);
    setSettingsStatus(t("settingsTestingSearch"));
    try {
      const response=await fetch("/api/settings/search/test",{
        method:"POST",headers:authenticatedApiHeaders({ "Content-Type":"application/json" }),
        body:JSON.stringify({ deepSeekSearchProvider:settingsDeepSeekSearchProvider.value, deepseekSearchApiKey:settingsDeepSeekSearchApiKey.value, tavilyApiKey:settingsTavilyApiKey.value }),
      });
      let body=null;
      try { body=await response.json(); } catch {}
      if (!response.ok || !Array.isArray(body?.results)) throw new Error(body?.error || t("settingsSearchTestFailed"));
      if (generation !== settings.searchTestGeneration) return;
      renderSearchTestStatuses(body.results);
      setSettingsStatus(t("settingsSearchTestComplete"), "success");
    } catch(error) {
      if (generation !== settings.searchTestGeneration) return;
      const failed=["flash","tavily","duckduckgo"].map(id=>({ id, state:searchTestConfigured(id)?"request_failed":"not_configured" }));
      renderSearchTestStatuses(failed);
      setSettingsStatus(error?.message || t("settingsSearchTestFailed"), "error");
    } finally { setSearchTestBusy(false); }
  }
  function updateSearchSettingsState({ provider=settings.deepSeekSearchProvider, deepseek=settings.hasDeepSeekSearchApiKey, tavily=settings.hasTavilyApiKey } = {}) {
    settings.deepSeekSearchProvider = ["deepseek-official", "opencode-go"].includes(provider) ? provider : "deepseek-official";
    settings.hasDeepSeekSearchApiKey = Boolean(deepseek);
    settings.hasTavilyApiKey = Boolean(tavily);
    if (settingsDeepSeekSearchProvider) settingsDeepSeekSearchProvider.value = settings.deepSeekSearchProvider;
    updateDeepSeekSearchProviderNotice();
    if (settingsDeepSeekSearchSaved) settingsDeepSeekSearchSaved.hidden = !settings.hasDeepSeekSearchApiKey;
    if (settingsDeepSeekSearchApiKey) settingsDeepSeekSearchApiKey.placeholder = t(settings.hasDeepSeekSearchApiKey ? "settingsDeepSeekSearchApiKeySavedPlaceholder" : "settingsDeepSeekSearchApiKey");
    if (settingsTavilySaved) settingsTavilySaved.hidden = !settings.hasTavilyApiKey;
    if (settingsTavilyApiKey) settingsTavilyApiKey.placeholder = t(settings.hasTavilyApiKey ? "settingsTavilyApiKeySavedPlaceholder" : "settingsTavilyApiKey");
    if (settingsSearchEntryStatus) {
      const key = settings.hasDeepSeekSearchApiKey && settings.hasTavilyApiKey ? "settingsSearchAllReady" : settings.hasDeepSeekSearchApiKey ? "settingsSearchDeepSeekReady" : settings.hasTavilyApiKey ? "settingsSearchTavilyReady" : "settingsSearchNotConfigured";
      settingsSearchEntryStatus.dataset.i18n = key;
      settingsSearchEntryStatus.textContent = t(key);
    }
    resetSearchTestStatuses();
  }
  function updateDeepSeekSearchProviderNotice() {
    if (settingsOpenCodeGoSearchSetup) settingsOpenCodeGoSearchSetup.hidden = settingsDeepSeekSearchProvider?.value !== "opencode-go";
  }
  function loadCanvasSettings() {
    if (settings.configurationLoad) return settings.configurationLoad;
    settings.configurationLoad = performCanvasSettingsLoad().finally(() => { settings.configurationLoad = null; });
    return settings.configurationLoad;
  }
  function routeStartupConnections(body) {
    if (settings.startupConnectionsChecked) return;
    settings.startupConnectionsChecked = true;
    if (window.PENECHO_CONFIG?.runtime === "cloud" || window.PENECHO_CONFIG?.runtime === "viewer") return;
    if (body.openConnections === true || body.hasUsableConnection === false) {
      selectSettingsPage("connections");
      openSettings();
    }
  }
  async function performCanvasSettingsLoad() {
    if (!canvasSettingsForm) return;
    void loadHostedModels();
    setSettingsStatus(t("settingsLoading"));
    try {
      await window.PenEchoLinkedDevice?.refresh({ ifNeeded:true });
      const connectionScope = aiConnectionScope();
      const response = await fetch("/api/settings", { headers:authenticatedApiHeaders(), signal:AbortSignal.timeout(12000) }), body = await response.json();
      if (!response.ok) throw new Error(body?.error || t("settingsLoadFailed"));
      if (connectionScope !== aiConnectionScope()) return;
      settings.connectionScope = connectionScope;
      settings.connections = Array.isArray(body.connections) ? body.connections : [];
      syncLocalConnectionSelection();
      settings.connectionLimit = Number(body.connectionLimit) || 10;
      settingsProvider.value = body.provider;
      settings.currentProvider = body.provider;
      fillApiEditor({ apiPreset:body.apiPreset, apiFormat:body.apiFormat, apiUrl:body.apiUrl, apiModel:body.apiModel });
      settingsApiKey.value = "";
      settingsApiSaved.dataset.saved = String(body.hasApiKey);
      settingsDeepSeekSearchApiKey.value = "";
      settingsTavilyApiKey.value = "";
      updateSearchSettingsState({ provider:body.deepSeekSearchProvider, deepseek:body.hasDeepSeekSearchApiKey === true, tavily:body.hasTavilyApiKey === true });
      canvasAgentSetSearchConfigured(body.webSearchAvailable === true);
      settings.cli = {
        "kimi-cli":{ model:body.kimiCliModel, path:body.kimiCliPath },
        "codex-cli":{ model:body.codexModel, path:body.codexPath },
        "claude-cli":{ model:body.claudeModel, path:body.claudePath },
      };
      settingsEffort.value = body.effort || defaultConnectionEffort(body.provider);
      updateSettingsEffortOptions();
      settingsMaxTokens.value = String(body.maxTokens);
      settingsAgentTurnLimit.value = String(body.canvasAgentTurnLimit);
      settingsTimeout.value = String(body.timeoutSeconds);
      settingsAutoDelay.value = String(body.autoDelaySeconds);
      settingsImageFormat.value = body.imageFormat;
      settingsTraceLimit.value = String(body.requestTraceLimit);
      settings.requestTrace = body.requestTrace === true;
      updateTraceToggle();
      updateSettingsProviderFields();
      renderConnectionLists();
      setSettingsStatus();
      routeStartupConnections(body);
    } catch (error) { setSettingsStatus(error?.message || t("settingsLoadFailed"), "error"); }
  }
  async function saveCanvasSettings(event) {
    event?.preventDefault();
    if (!canvasSettingsForm || !canvasSettingsForm.reportValidity()) return;
    setConnectionTestBusy(true);
    setSettingsStatus(t("settingsSaving"));
    try {
      const provider = settingsProvider.value, scope = settings.configurationMode, connectionPayload = connectionEditorPayload(), apiPreset = provider === "api" ? selectedApiPreset() : null,
        deepseekProviderChanged = scope === "search" && settingsDeepSeekSearchProvider.value !== settings.deepSeekSearchProvider,
        deepseekKeyChanged = scope === "search" && Boolean(settingsDeepSeekSearchApiKey.value.trim()),
        tavilyKeyChanged = scope === "search" && Boolean(settingsTavilyApiKey.value.trim()),
        searchNeedsNewSession = deepseekProviderChanged || (deepseekKeyChanged && !settings.hasDeepSeekSearchApiKey) || (tavilyKeyChanged && !settings.hasTavilyApiKey);
      const connectionScope = aiConnectionScope();
      const endpoint = scope === "api" ? "/api/settings/connections" : "/api/settings", payload = scope === "api" ? { action:"save", id:settings.editingConnectionId, connection:connectionPayload } : scope === "search" ? {
        scope, deepSeekSearchProvider:settingsDeepSeekSearchProvider.value, deepseekSearchApiKey:settingsDeepSeekSearchApiKey.value, tavilyApiKey:settingsTavilyApiKey.value,
      } : {
        scope, provider, apiFormat:apiPreset?.format || settingsApiFormat.value, apiPreset:apiPreset ? `${apiPreset.family}-${apiPreset.region}-${apiPreset.service}` : "", apiUrl:settingsApiUrl.value, apiModel:settingsApiModel.value,
        apiKey:settingsApiKey.value, effort:settingsEffort.value, maxTokens:Number(settingsMaxTokens.value), canvasAgentTurnLimit:Number(settingsAgentTurnLimit.value), timeoutSeconds:Number(settingsTimeout.value),
        autoDelaySeconds:Number(settingsAutoDelay.value), imageFormat:settingsImageFormat.value,
        requestTrace:settings.requestTrace, requestTraceLimit:Number(settingsTraceLimit.value),
      };
      const response = await fetch(endpoint, {
        method:"POST",
        headers:authenticatedApiHeaders({ "Content-Type":"application/json" }),
        body:JSON.stringify(payload),
      }), body = await response.json();
      if (!response.ok) throw new Error(body?.error || t("settingsLoadFailed"));
      if (settingsApiKey.value.trim()) settingsApiSaved.dataset.saved = "true";
      settingsApiKey.value = "";
      if (scope === "api") {
        if (connectionScope !== aiConnectionScope()) return;
        settings.connectionScope = connectionScope;
        settings.connections = body.connections || settings.connections;
        syncLocalConnectionSelection();
        renderConnectionLists();
        if (body.savedId === selectedAiConnectionId()) {
          const selected=settings.connections.find(connection=>connection.id===body.savedId);
          canvasAgentConnectionDidChange(true,selected?.provider || "");
        }
        hideConnectionEditor();
        setConnectionStatus(t("settingsConnectionSaved"), "success");
      } else if (scope === "search") {
        settingsDeepSeekSearchApiKey.value = "";
        settingsTavilyApiKey.value = "";
        updateSearchSettingsState({ provider:body.deepSeekSearchProvider, deepseek:body.hasDeepSeekSearchApiKey === true, tavily:body.hasTavilyApiKey === true });
        canvasAgentSearchConfigurationDidChange(body.webSearchAvailable === true, searchNeedsNewSession);
        setSettingsStatus(t("settingsSearchSaved"), "success");
      } else setSettingsStatus(t("settingsSystemSaved"), "success");
    } catch (error) { setSettingsStatus(error?.message || t("settingsLoadFailed"), "error"); }
    finally { setConnectionTestBusy(false); }
  }
  async function updateConnection(action, id) {
    setConnectionStatus(t("settingsSaving"));
    const connectionScope = aiConnectionScope();
    try {
      const response = await fetch("/api/settings/connections", { method:"POST", headers:authenticatedApiHeaders({ "Content-Type":"application/json" }), body:JSON.stringify({ action, id }) }), body = await response.json();
      if (!response.ok) throw new Error(body?.error || t("settingsLoadFailed"));
      if (connectionScope !== aiConnectionScope()) return;
      settings.connectionScope = connectionScope;
      settings.connections = body.connections || [];
      syncLocalConnectionSelection();
      renderConnectionLists();
      const nextId=selectedAiConnectionId(),nextConnection=settings.connections.find(connection=>connection.id===nextId);
      canvasAgentConnectionDidChange(false,nextConnection?.provider || "");
      setConnectionStatus(t(action === "delete" ? "settingsConnectionDeleted" : "settingsConnectionActivated"), "success");
    } catch (error) { setConnectionStatus(error?.message || t("settingsLoadFailed"), "error"); }
  }
  function handleConnectionAction(event) {
    const button = event.target.closest("button[data-connection-activate],button[data-connection-edit],button[data-connection-delete]");
    if (!button) return;
    if (button.dataset.connectionActivate) {
      const id = button.dataset.connectionActivate,
        closeAfterActivation = settingsConnectionQuickList?.contains(button) === true || document.getElementById("settingsHostedList")?.contains(button) === true;
      if (!allAiConnections().some(connection => connection.id === id)) return;
      storeAiConnectionSelection(id);
      syncLocalConnectionSelection();
      renderConnectionLists();
      canvasAgentConnectionDidChange(false,allAiConnections().find(connection=>connection.id===id)?.provider || "");
      setConnectionStatus(t("settingsConnectionActivated"), "success");
      if (closeAfterActivation) closeSettings();
      return;
    }
    const connection = settings.connections.find(item => item.id === button.dataset.connectionEdit || item.id === button.dataset.connectionDelete);
    if (!connection) return;
    if (button.dataset.connectionEdit) fillConnectionEditor(connection);
    else if (window.confirm(t("settingsDeleteConfirm"))) void updateConnection("delete", connection.id);
  }
  function selectSettingsPage(page, { focus = false } = {}) {
    if (!settingsPanel) return false;
    const tabs = [...settingsPanel.querySelectorAll("[data-settings-page-target]")],
      pages = [...settingsPanel.querySelectorAll("[data-settings-page]")],
      available = new Set(pages.map((node) => node.dataset.settingsPage)),
      nextPage = available.has(page) ? page : "appearance",
      pageChanged = settings.activePage !== nextPage;
    settings.activePage = nextPage;
    if (nextPage === "mcp") { void mcpRefreshSettings(); window.PenEchoMcpSettings?.open(); }
    tabs.forEach((tab) => {
      const selected = tab.dataset.settingsPageTarget === settings.activePage;
      tab.classList.toggle("active", selected);
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected && focus) tab.focus({ preventScroll:true });
    });
    pages.forEach((node) => {
      const selected = node.dataset.settingsPage === settings.activePage;
      node.classList.toggle("active", selected);
      node.hidden = !selected;
      if (selected && pageChanged) node.scrollTop = 0;
    });
    return true;
  }
  function handleSettingsNavigationKeydown(event) {
    const current = event.target.closest("[data-settings-page-target]");
    if (!current || !["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return false;
    const tabs = [...settingsPanel.querySelectorAll("[data-settings-page-target]")];
    let index = tabs.indexOf(current);
    if (event.key === "Home") index = 0;
    else if (event.key === "End") index = tabs.length - 1;
    else index = (index + (event.key === "ArrowDown" ? 1 : -1) + tabs.length) % tabs.length;
    event.preventDefault();
    selectSettingsPage(tabs[index]?.dataset.settingsPageTarget, { focus:true });
    return true;
  }
  function updateSettingsPanel() {
    if (!settingsPanel) return;
    selectSettingsPage(settings.activePage);
    settingsAutoToggle.classList.toggle("on", state.auto);
    settingsAutoToggle.setAttribute("aria-checked", String(state.auto));
    settingsCanvasAgentAutoOpenToggle.classList.toggle("on", state.canvasAgentAutoOpen);
    settingsCanvasAgentAutoOpenToggle.setAttribute("aria-checked", String(state.canvasAgentAutoOpen));
    summonToggle.classList.toggle("on", state.summonEnabled);
    summonToggle.setAttribute("aria-checked", String(state.summonEnabled));
    settingsWidgetShadowToggle.classList.toggle("on", state.widgetShadowEnabled);
    settingsWidgetShadowToggle.setAttribute("aria-checked", String(state.widgetShadowEnabled));
    document.querySelector("#aiFont").value = state.aiFont;
    void loadCanvasSettings();
  }
  function openSettings() {
    if (settings.open || !settingsLayer) return false;
    hideAutoDelayControl();
    hideEffortControl();
    hidePluginControl();
    settings.open = true;
    settings.restoreFocus = document.activeElement?.isConnected && document.activeElement !== document.body ? document.activeElement : settingsButton;
    settingsLayer.hidden = false;
    settingsLayer.setAttribute("aria-hidden", "false");
    settingsButton.setAttribute("aria-expanded", "true");
    updateSettingsPanel();
    requestAnimationFrame(() => settingsPanel.focus({ preventScroll: true }));
    return true;
  }
  function closeSettings(restore = true) {
    if (!settings.open) return false;
    const restoreTarget = restore && settings.restoreFocus?.isConnected ? settings.restoreFocus : settingsButton;
    if (settingsLayer.contains(document.activeElement)) restoreTarget?.focus({ preventScroll:true });
    settings.open = false;
    settingsLayer.hidden = true;
    settingsLayer.setAttribute("aria-hidden", "true");
    settingsButton.setAttribute("aria-expanded", "false");
    if (restore && document.activeElement !== restoreTarget) requestAnimationFrame(() => restoreTarget?.focus({ preventScroll:true }));
    settings.restoreFocus = null;
    return true;
  }
  function setSummonEnabled(enabled) {
    state.summonEnabled = Boolean(enabled);
    localStorage.setItem("penecho-summon-enabled", String(state.summonEnabled));
    if (!state.summonEnabled) hideSummon();
    updateSettingsPanel();
  }
  function setAiFont(value) {
    state.aiFont = normalizeAiFont(value);
    localStorage.setItem(AI_FONT_STORAGE_KEY, state.aiFont);
    document.querySelector("#aiFont").value = state.aiFont;
  }
  function setCanvasAgentAutoOpen(enabled) {
    state.canvasAgentAutoOpen = Boolean(enabled);
    localStorage.setItem("penecho-canvas-agent-auto-open", String(state.canvasAgentAutoOpen));
    settingsCanvasAgentAutoOpenToggle.classList.toggle("on", state.canvasAgentAutoOpen);
    settingsCanvasAgentAutoOpenToggle.setAttribute("aria-checked", String(state.canvasAgentAutoOpen));
  }
  function setWidgetShadowEnabled(enabled) {
    state.widgetShadowEnabled = Boolean(enabled);
    localStorage.setItem("penecho-widget-shadow", String(state.widgetShadowEnabled));
    view.classList.toggle("widget-shadows", state.widgetShadowEnabled);
    settingsWidgetShadowToggle.classList.toggle("on", state.widgetShadowEnabled);
    settingsWidgetShadowToggle.setAttribute("aria-checked", String(state.widgetShadowEnabled));
    requestRender();
  }
  function maybeStartOnboarding() {
    if (window.PENECHO_CONFIG?.runtime === "viewer" || settings.open) return false;
    if (!maybeStartFeatureTour()) maybeShowChangelog();
  }
  function autoDelayText() {
    const seconds = state.autoDelayMs / 1000;
    return Number.isInteger(seconds) ? String(seconds) : String(Number(seconds.toFixed(1)));
  }
  function updateAutoControl() {
    const button = document.querySelector("#auto"),
      range = document.querySelector("#autoDelayRange"),
      value = document.querySelector("#autoDelayValue"),
      disabled = state.mode === "hand" && state.auto;
    button.classList.toggle("active", state.auto);
    button.setAttribute("aria-pressed", String(state.auto));
    button.disabled = disabled;
    button.setAttribute("aria-disabled", String(disabled));
    document.querySelector("#autoLabel").textContent = state.auto ? t("autoEnabled").replace("{delay}", autoDelayText()) : t("autoDisabled");
    range.value = String(state.autoDelayMs / 1000);
    value.textContent = `${autoDelayText()} s`;
    if (settingsAutoToggle) {
      settingsAutoToggle.classList.toggle("on", state.auto);
      settingsAutoToggle.setAttribute("aria-checked", String(state.auto));
    }
  }
  function positionToolbarPopover(controlSelector, popoverSelector, options) {
    options ||= {};
    const control = document.querySelector(controlSelector),
      popover = document.querySelector(popoverSelector),
      host = document.querySelector(".topbar"),
      toolbar = host?.querySelector(".toolbar");
    if (!control || !popover || !host || popover.hidden) return;
    if (popover.parentElement !== host) host.append(popover);
    const controlRect = control.getBoundingClientRect(),
      hostRect = host.getBoundingClientRect(),
      toolbarRect = toolbar?.getBoundingClientRect(),
      anchorBottom = document.body.classList.contains("studio-toolbar-two-row") && toolbarRect
        ? Math.max(controlRect.bottom, toolbarRect.bottom)
        : controlRect.bottom,
      scaleX = host.offsetWidth > 0 && hostRect.width > 0 ? hostRect.width / host.offsetWidth : 1,
      scaleY = host.offsetHeight > 0 && hostRect.height > 0 ? hostRect.height / host.offsetHeight : scaleX,
      inset = 6,
      controlLeft = (controlRect.left - hostRect.left) / scaleX,
      controlWidth = controlRect.width / scaleX,
      desiredLeft = options.align === "center" ? controlLeft + (controlWidth - popover.offsetWidth) / 2 : controlLeft,
      maxLeft = Math.max(inset, host.offsetWidth - popover.offsetWidth - inset),
      popoverStyle = runtimeElementStyle(popover, `toolbar-popover-${popover.id}`);
    popover.classList.add("toolbar-anchored-popover");
    popoverStyle?.setProperty("left", `${Math.max(inset, Math.min(desiredLeft, maxLeft))}px`);
    popoverStyle?.setProperty("top", `${(anchorBottom - hostRect.top) / scaleY + (Number(options.gap) || 8)}px`);
  }
  function positionOpenToolbarPopovers() {
    positionToolbarPopover("#autoControl", "#autoDelayPopover");
    positionToolbarPopover("#effortControl", "#effortPopover");
    positionToolbarPopover("#eraserToolControl", "#eraserToolMenu", { align:"center", gap:6 });
    positionToolbarPopover('[data-color-control="ink"]', "#inkColorPopover", { align:"center", gap:6 });
    positionToolbarPopover('[data-color-control="ai"]', "#aiColorPopover", { align:"center", gap:6 });
  }
  function updateEffortControl() {
    state.reasoningEffort = normalizeToolbarReasoningEffort(state.reasoningEffort) || "config";
    const control = document.querySelector("#effortControl"),
      button = document.querySelector("#aiEffortButton"),
      label = document.querySelector("#aiEffortLabel"),
      fullLabel = label.querySelector(".effort-label-full"),
      shortLabel = label.querySelector(".effort-label-short"),
      customInput = document.querySelector("#aiEffortCustomInput"),
      levelKey = { config:"effortConfigured", none:"effortNone", low:"effortLow", medium:"effortMedium", high:"effortHigh", max:"effortMaximum" }[state.reasoningEffort],
      level = levelKey ? t({ config:"effortConfiguredShort", medium:"effortMediumShort" }[state.reasoningEffort] || levelKey) : state.reasoningEffort,
      shortLevel = levelKey ? t({ config:"effortConfiguredShort", medium:"effortMediumShort" }[state.reasoningEffort] || levelKey) : state.reasoningEffort,
      text = t("reasoningEffortDisplay").replace("{level}", level);
    fullLabel.textContent = text;
    shortLabel.textContent = shortLevel;
    button.setAttribute("aria-label", text);
    button.setAttribute("title", text);
    button.setAttribute("aria-expanded", String(!document.querySelector("#effortPopover").hidden));
    control.dataset.effort = state.reasoningEffort;
    if (customInput && document.activeElement !== customInput) customInput.value = levelKey ? "" : state.reasoningEffort;
    document.querySelectorAll("#effortOptions .effort-option").forEach((option) => {
      const optionKey = { config:"effortConfigured", none:"effortNone", low:"effortLow", medium:"effortMedium", high:"effortHigh", max:"effortMaximum" }[option.dataset.effort] || "effortConfigured";
      option.querySelector("[data-effort-label]").textContent = t(optionKey);
      option.setAttribute("aria-selected", String(option.dataset.effort === state.reasoningEffort));
      option.classList.toggle("active", option.dataset.effort === state.reasoningEffort);
    });
    if (typeof canvasAgentScheduleToolbarLayout === "function") canvasAgentScheduleToolbarLayout();
  }
  function hideAutoDelayControl() {
    clearTimeout(state.autoPopoverTimer);
    state.autoPopoverTimer = 0;
    document.querySelector("#autoDelayPopover").hidden = true;
    document.querySelector("#auto").setAttribute("aria-expanded", "false");
  }
  function keepAutoDelayControlOpen() {
    clearTimeout(state.autoPopoverTimer);
    state.autoPopoverTimer = setTimeout(hideAutoDelayControl, 5000);
  }
  function showAutoDelayControl() {
    document.querySelector("#autoDelayPopover").hidden = false;
    document.querySelector("#auto").setAttribute("aria-expanded", "true");
    positionToolbarPopover("#autoControl", "#autoDelayPopover");
    requestAnimationFrame(positionOpenToolbarPopovers);
    keepAutoDelayControlOpen();
  }
  function hideEffortControl() {
    clearTimeout(state.effortPopoverTimer);
    state.effortPopoverTimer = 0;
    document.querySelector("#effortPopover").hidden = true;
    document.querySelector("#aiEffortButton").setAttribute("aria-expanded", "false");
    document.querySelector("#aiEffortCustomInput")?.setAttribute("aria-expanded", "false");
  }
  function keepEffortControlOpen() {
    clearTimeout(state.effortPopoverTimer);
    state.effortPopoverTimer = setTimeout(hideEffortControl, 5000);
  }
  function showEffortControl() {
    document.querySelector("#effortPopover").hidden = false;
    document.querySelector("#aiEffortButton").setAttribute("aria-expanded", "true");
    document.querySelector("#aiEffortCustomInput")?.setAttribute("aria-expanded", "true");
    updateEffortControl();
    positionToolbarPopover("#effortControl", "#effortPopover");
    requestAnimationFrame(positionOpenToolbarPopovers);
    keepEffortControlOpen();
  }
  function pluginEnabled(pluginId) {
    return pluginId === "general" || state.plugins[pluginId] === true;
  }
  function diagramRuntime() {
    return window.PENECHO_DIAGRAM_RUNTIME || null;
  }
  function canonicalStoredDiagramFormat(value) {
    const format = String(value || "").trim().toLowerCase();
    return DIAGRAM_SOURCE_FORMATS.has(format) ? format : "";
  }
  function diagramSourceFits(value) {
    return typeof value === "string" && value.trim() && new TextEncoder().encode(value).length <= MAX_DIAGRAM_SOURCE_BYTES;
  }
  function loadDiagramRuntime() {
    if (diagramRuntime()) return Promise.resolve(diagramRuntime());
    if (diagramRuntimePromise) return diagramRuntimePromise;
    diagramRuntimePromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "plugins/flowchart/runtime.js";
      script.async = true;
      script.onload = () => {
        const runtime = diagramRuntime();
        if (runtime) resolve(runtime);
        else reject(Error("Professional diagram runtime did not initialize"));
      };
      script.onerror = () => reject(Error("Professional diagram runtime could not be loaded"));
      document.head.append(script);
    }).catch((error) => {
      diagramRuntimePromise = null;
      throw error;
    });
    return diagramRuntimePromise;
  }
  function ensurePluginRuntime(pluginId) {
    return pluginId === "flowchart" ? loadDiagramRuntime() : Promise.resolve(null);
  }
  async function enableSnapshotWidgetPlugins(items) {
    const pluginIds = [...new Set((Array.isArray(items) ? items : [])
      .map((item) => typeof item?.pluginId === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.pluginId) ? item.pluginId : "")
      .filter(Boolean))];
    if (!pluginIds.length) return;
    for (const pluginId of pluginIds) state.plugins[pluginId] = true;
    if (pluginIds.includes("flowchart") && items.some((item) => item?.pluginId === "flowchart" && item?.widgetType === "diagram_source")) {
      try { await ensurePluginRuntime("flowchart"); }
      catch (error) { state.pluginCatalogError = error.message; }
    }
    persistPluginSettings();
    syncWidgetRuntime();
    updatePluginControl();
  }
  function dataPluginDefinitions() {
    return PLUGIN_DEFINITIONS.filter((plugin) => plugin.documentPath);
  }
  function widgetRuntimeEnabled() {
    return state.widgetMessageHooked;
  }
  function syncWidgetRuntime() {
    const enabled = dataPluginDefinitions().some((plugin) => pluginEnabled(plugin.id) && pluginManifests.has(plugin.id));
    widgetLayer.hidden = !enabled;
    if (enabled === state.widgetMessageHooked) return;
    state.widgetMessageHooked = enabled;
    window[enabled ? "addEventListener" : "removeEventListener"]("message", handleWidgetMessage);
  }
  function enabledPluginDescriptors() {
    return dataPluginDefinitions().filter((plugin) => pluginEnabled(plugin.id))
      .map((plugin) => pluginManifests.get(plugin.id))
      .filter(Boolean)
      .sort((a, b) => {
        const priority = (id) => id === "general" ? 0 : id === "flowchart" ? 1 : 2,
          difference = priority(a.id) - priority(b.id);
        return difference || a.id.localeCompare(b.id);
      })
      .map((manifest) => ({
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        connect: [...manifest.connect],
        recommendedRefreshSeconds: manifest.recommendedRefreshSeconds,
        document: manifest.document,
      }));
  }
  function canvasAgentWidgetCapabilities() {
    const privatePluginIds = dataPluginDefinitions()
      .filter((plugin) => plugin.builtIn === false && pluginEnabled(plugin.id) && pluginManifests.has(plugin.id))
      .map((plugin) => plugin.id)
      .sort();
    return {
      version:1,
      professionalEnabled:pluginEnabled("flowchart") && pluginManifests.has("flowchart"),
      privatePluginIds,
    };
  }
  function pluginRequestPayload() {
    const payload = Object.fromEntries(PLUGIN_DEFINITIONS.filter((plugin) => plugin.requestField && pluginEnabled(plugin.id)).map((plugin) => [plugin.requestField, true])),
      plugins = enabledPluginDescriptors();
    if (plugins.length) payload.plugins = plugins;
    return payload;
  }
  function validPluginCatalogPath(value, extension) {
    if (typeof value !== "string") return null;
    const suffix = extension === "css" ? "styles\\.css" : "plugin\\.md",
      legacy = extension === "md" ? "|[a-z0-9][a-z0-9-]{0,63}\\.md" : "";
    // PenEcho Cloud appends a content-version query (?v=<sha>) for cache
    // busting; accept it alongside the plain paths the local server returns.
    return new RegExp(`^plugins/(?:private/)?(?:[a-z0-9][a-z0-9-]{0,63}/${suffix}${legacy})(?:\\?v=[a-f0-9]{6,16})?$`).test(value) ? value : null;
  }
  function pluginDocumentCacheMode(path, builtIn) {
    return builtIn && /\?v=[a-f0-9]{6,16}$/.test(path) ? "force-cache" : "no-store";
  }
  async function loadPluginDocuments() {
    if (pluginCatalogLoadPromise) return pluginCatalogLoadPromise;
    let resolveSharedLoad,loadSucceeded=false;
    pluginCatalogLoadPromise=new Promise((resolve)=>{resolveSharedLoad=resolve;});
    const catalogWasLoaded=state.pluginCatalogLoaded;
    state.pluginCatalogLoading = true;
    state.pluginCatalogError = "";
    updatePluginControl();
    updatePluginAuthoringUi();
    try {
      const nativeCloudCanvasReadsEnabled = window.PENECHO_CONFIG?.runtime === "cloud" && window.PENECHO_CONFIG?.remoteCanvasNativeReads === true,
        catalogRequests = nativeCloudCanvasReadsEnabled
          ? [
              { path:"/api/plugins", cache:"default", accept:(entry) => entry?.builtIn !== false },
              { path:"/api/plugins?scope=private", cache:"no-store", accept:(entry) => entry?.builtIn === false, optional:true },
            ]
          : [{ path:"/api/plugins", cache:"no-store", accept:() => true }],
        catalogs = await Promise.all(catalogRequests.map(async (request) => {
          try {
            const response = await fetch(request.path, { credentials:"same-origin", cache:request.cache });
            if (!response.ok) throw Error(`HTTP ${response.status}`);
            return { catalog:await response.json(), accept:request.accept };
          } catch (error) {
            if (!request.optional) throw error;
            return { catalog:{ plugins:[] }, accept:request.accept };
          }
        })),
        entries = catalogs.flatMap(({ catalog, accept }) => (Array.isArray(catalog?.plugins) ? catalog.plugins : []).filter(accept))
        .map((entry) => ({
          path:validPluginCatalogPath(entry?.path, "md"),
          stylePath:entry?.stylePath ? validPluginCatalogPath(entry.stylePath, "css") : null,
          builtIn:entry?.builtIn !== false,
          inlineDocument:entry?.builtIn !== false && typeof entry?.document === "string" ? entry.document : null,
          inlineStyles:entry?.builtIn !== false && typeof entry?.styles === "string" ? entry.styles : "",
          error:typeof entry?.error === "string" ? entry.error : "",
        }))
        .filter((entry) => entry.path), uniqueEntries = [...new Map(entries.map((entry) => [entry.path, entry])).values()];
      const loaded = await Promise.all(uniqueEntries.map(async ({ path:documentPath, stylePath, builtIn, inlineDocument, inlineStyles, error:catalogError }) => {
        if (catalogError) return { documentPath, error:catalogError };
        try {
          if (inlineDocument !== null) {
            const manifest = PLUGINS?.parse(inlineDocument, inlineStyles);
            if (!manifest) throw Error("Plugin parser is unavailable");
            return { documentPath, stylePath, manifest, builtIn };
          }
          const documentCache = pluginDocumentCacheMode(documentPath, builtIn),
            styleCache = stylePath ? pluginDocumentCacheMode(stylePath, builtIn) : "no-store";
          const [documentResponse, styleResponse] = await Promise.all([
            fetch(canvasAssetUrl(documentPath), { credentials:"same-origin", cache:documentCache }),
            stylePath ? fetch(canvasAssetUrl(stylePath), { credentials:"same-origin", cache:styleCache }) : null,
          ]);
          if (!documentResponse.ok) throw Error(`HTTP ${documentResponse.status}`);
          if (styleResponse && !styleResponse.ok) throw Error(`CSS HTTP ${styleResponse.status}`);
          const [document, styles] = await Promise.all([documentResponse.text(), styleResponse ? styleResponse.text() : ""]),
            manifest = PLUGINS?.parse(document, styles);
          if (!manifest) throw Error("Plugin parser is unavailable");
          return { documentPath, stylePath, manifest, builtIn };
        } catch (error) {
          return { documentPath, error:error.message };
        }
      }));
      const definitions = [], manifests = new Map(), errors = new Map();
      for (const item of loaded) {
        if (item.error) {
          errors.set(item.documentPath, item.error);
          continue;
        }
        if (item.manifest.id === "animation" || manifests.has(item.manifest.id)) {
          errors.set(item.documentPath, "Plugin id is reserved or duplicated");
          continue;
        }
        manifests.set(item.manifest.id, item.manifest);
        definitions.push(Object.freeze({
          id:item.manifest.id,
          documentPath:item.documentPath,
          stylePath:item.stylePath,
          builtIn:item.builtIn,
          defaultEnabled:["general", "flowchart"].includes(item.manifest.id),
        }));
      }
      definitions.sort((a, b) => (manifests.get(a.id)?.name || a.id).localeCompare(manifests.get(b.id)?.name || b.id));
      const generalDefinitions = definitions.filter((definition) => definition.id === "general"),
        professionalDefinitions = definitions.filter((definition) => definition.id === "flowchart"),
        promotedDefinitions = ["image-search", "weather"].map((id) => definitions.find((definition) => definition.id === id)).filter(Boolean),
        fixedDefinitionIds = new Set(["general", "flowchart", ...promotedDefinitions.map((definition) => definition.id)]),
        remainingDefinitions = definitions.filter((definition) => !fixedDefinitionIds.has(definition.id)),
        previousIds = new Set(dataPluginDefinitions().map((plugin) => plugin.id)), nextIds = new Set(definitions.map((plugin) => plugin.id));
      if (activeWidgetRefinement() || state.pendingWidgetReplacement) cancelWidgetRefinement("plugin-catalog-reloaded");
      for (const widget of [...state.widgets, ...(state.pendingWidget ? [state.pendingWidget] : [])]) unmountWidget(widget);
      PLUGIN_DEFINITIONS.splice(0, PLUGIN_DEFINITIONS.length, ...generalDefinitions, ...professionalDefinitions, ...BUILTIN_PLUGIN_DEFINITIONS, ...promotedDefinitions, ...remainingDefinitions);
      pluginManifests.clear();
      for (const [id, manifest] of manifests) pluginManifests.set(id, manifest);
      pluginLoadErrors.clear();
      for (const [path, error] of errors) pluginLoadErrors.set(path, error);
      const stored = storedPluginSettings();
      for (const definition of definitions) if (typeof state.plugins[definition.id] !== "boolean") state.plugins[definition.id] = stored[definition.id];
      for (const id of previousIds) if (!nextIds.has(id)) state.plugins[id] = false;
      if (pluginEnabled("flowchart")) await ensurePluginRuntime("flowchart");
      if (state.pendingWidget && !pluginManifests.has(state.pendingWidget.pluginId)) rejectPendingWidget();
      if (state.widgetEdit && !pluginManifests.has(selectedWidget()?.pluginId)) acceptWidgetEdit();
      // Hook the parent message channel before a newly mounted host can emit
      // its first ready signal. The iframe load probe remains the recovery path
      // for cached navigation and external callers that mount at the boundary.
      state.pluginCatalogLoaded = true;
      syncWidgetRuntime();
      for (const widget of state.widgets) if (pluginEnabled(widget.pluginId)) mountWidget(widget);
      if (state.pendingWidget && pluginEnabled(state.pendingWidget.pluginId)) mountWidget(state.pendingWidget);
      persistPluginSettings();
      requestRender();
      if(catalogWasLoaded)canvasAgentContextDidChange(true);
      loadSucceeded=true;
      return true;
    } catch (error) {
      state.pluginCatalogError = error.message;
      return false;
    } finally {
      resolveSharedLoad(loadSucceeded);
      pluginCatalogLoadPromise=null;
      state.pluginCatalogLoading = false;
      updatePluginControl();
      updatePluginAuthoringUi();
    }
  }
  function persistPluginSettings() {
    let stored = {};
    try {
      const parsed = JSON.parse(localStorage.getItem(PLUGIN_STORAGE_KEY) || "{}");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) stored = parsed;
    } catch {}
    localStorage.setItem(PLUGIN_STORAGE_KEY, JSON.stringify({ ...stored, ...Object.fromEntries(PLUGIN_DEFINITIONS.map((plugin) => [plugin.id, pluginEnabled(plugin.id)])) }));
  }
  function localizedManifestValue(manifest, field) {
    if (!manifest) return "";
    const localized = state.language === "zh" ? manifest[`${field}Zh`] : "";
    return localized || manifest[field] || "";
  }
  function pluginRefreshText(seconds) {
    const key = seconds >= 86400 && seconds % 86400 === 0 ? "pluginDay" : seconds >= 3600 && seconds % 3600 === 0 ? "pluginHour" : "pluginMinute",
      count = key === "pluginDay" ? seconds / 86400 : key === "pluginHour" ? seconds / 3600 : Math.max(1, Math.round(seconds / 60));
    return t("pluginRefreshRate").replace("{time}", t(key).replace("{count}", String(count)));
  }
  function pluginCatalogStatusText() {
    if (state.pluginCatalogLoading) return t("pluginCatalogLoading");
    if (state.pluginCatalogError) return `${t("pluginCatalogFailed")}: ${state.pluginCatalogError}`;
    if (state.pluginCatalogNotice) return pluginAuthoringText(state.pluginCatalogNotice);
    const plugins = dataPluginDefinitions(), enabled = plugins.filter((plugin) => pluginEnabled(plugin.id)).length;
    let text = t("pluginCatalogReady").replace("{count}", String(plugins.length)).replace("{enabled}", String(enabled));
    if (pluginLoadErrors.size) text += state.language === "zh" ? ` · ${pluginLoadErrors.size} 个文件无效` : ` · ${pluginLoadErrors.size} invalid file${pluginLoadErrors.size === 1 ? "" : "s"}`;
    return text;
  }
  function renderPluginOptions() {
    const fragment = document.createDocumentFragment(),
      groups = [
        { titleKey: "pluginPersonalSection", plugins: PLUGIN_DEFINITIONS.filter((plugin) => plugin.builtIn === false) },
        { titleKey: "pluginBuiltInSection", plugins: PLUGIN_DEFINITIONS.filter((plugin) => plugin.builtIn !== false) },
      ];
    for (const group of groups) {
      if (!group.plugins.length) continue;
      const section = document.createElement("section"),
        heading = document.createElement("h3"),
        grid = document.createElement("div");
      section.className = "plugin-option-section";
      heading.className = "plugin-option-section-title";
      heading.textContent = t(group.titleKey);
      grid.className = "plugin-option-grid";
      for (const plugin of group.plugins) {
        const option = document.createElement("div"),
          label = document.createElement("label"),
          input = document.createElement("input"),
          copy = document.createElement("span"),
          titleRow = document.createElement("span"),
          title = document.createElement("strong"),
          help = document.createElement("small"),
          meta = document.createElement("span"),
          manifest = pluginManifests.get(plugin.id);
        option.className = "plugin-option";
        label.className = "plugin-option-toggle";
        label.htmlFor = `plugin-${plugin.id}`;
        input.id = label.htmlFor;
        input.type = "checkbox";
        input.dataset.pluginId = plugin.id;
        input.checked = pluginEnabled(plugin.id);
        input.disabled = plugin.id === "general" || Boolean(plugin.documentPath && !pluginManifests.has(plugin.id));
        copy.className = "plugin-option-copy";
        titleRow.className = "plugin-option-title";
        title.textContent = plugin.labelKey ? t(plugin.labelKey) : localizedManifestValue(manifest, "name") || plugin.id;
        titleRow.append(title);
        const badge = document.createElement("span");
        badge.className = "plugin-badge";
        badge.textContent = plugin.documentPath ? localizedManifestValue(manifest, "category") || t("pluginLocal") : t("pluginBuiltIn");
        titleRow.append(badge);
        if (plugin.id === "general") {
          const recommended = document.createElement("span");
          recommended.className = "plugin-badge recommended";
          recommended.textContent = t("pluginRecommended");
          titleRow.append(recommended);
        }
        help.textContent = plugin.id === "general" ? t("generalPluginRecommendedHelp") : plugin.helpKey ? t(plugin.helpKey) : localizedManifestValue(manifest, "description") || t("pluginNoDescription");
        meta.className = "plugin-option-meta";
        if (plugin.documentPath && manifest) {
          const bytes = new TextEncoder().encode(manifest.document).length,
            tokens = Math.ceil(bytes / 4),
            source = manifest.source || manifest.connect.map((origin) => new URL(origin).hostname).join(", "),
            sourceItem = document.createElement("span"),
            apiItem = document.createElement("span"),
            refreshItem = document.createElement("span"),
            tokenItem = document.createElement("span");
          sourceItem.className = "plugin-option-source";
          sourceItem.textContent = t("pluginSourceLabel").replace("{source}", source);
          apiItem.className = "plugin-option-api";
          apiItem.textContent = t("pluginApiLabel").replace("{origins}", plugin.id === "general" ? t("pluginPublicHttps") : manifest.connect.length ? manifest.connect.join(" · ") : t("pluginNoNetwork"));
          refreshItem.textContent = pluginRefreshText(manifest.recommendedRefreshSeconds);
          tokenItem.textContent = t("pluginPromptEstimate").replace("{tokens}", String(tokens));
          meta.append(sourceItem, apiItem, refreshItem, tokenItem);
        } else if (plugin.costKey) meta.append(document.createTextNode(t(plugin.costKey)));
        copy.append(titleRow, help, meta);
        label.append(input, copy);
        const actions = document.createElement("span");
        actions.className = "plugin-option-actions";
        const detailDocument = manifest?.document || (plugin.builtIn !== false ? [
          title.textContent,
          t("pluginBuiltInRuntime"),
          t("pluginDefaultState").replace("{state}", t(plugin.defaultEnabled ? "pluginStateEnabled" : "pluginStateDisabled")),
          ...(plugin.requestField ? [t("pluginRequestField").replace("{field}", plugin.requestField)] : []),
          "",
          help.textContent,
          ...(plugin.costKey ? [t(plugin.costKey)] : []),
        ].join("\n") : "");
        if (detailDocument) {
          const detailButton = document.createElement("button"),
            detail = document.createElement("section"),
            detailBar = document.createElement("span"),
            detailTitle = document.createElement("strong"),
            documentView = document.createElement("pre");
          detailButton.className = "plugin-detail-button";
          detailButton.type = "button";
          peButton(detailButton, "secondary", "compact");
          detailButton.dataset.pluginDetail = plugin.id;
          detailButton.setAttribute("aria-expanded", "false");
          detailButton.setAttribute("aria-controls", `plugin-detail-${plugin.id}`);
          detailButton.textContent = t("pluginDetails");
          detail.id = `plugin-detail-${plugin.id}`;
          detail.className = "plugin-option-detail";
          detail.hidden = true;
          detailBar.className = "plugin-option-detail-bar";
          detailTitle.textContent = t("pluginDetailsFor").replace("{name}", localizedManifestValue(manifest, "name") || title.textContent);
          detailBar.append(detailTitle);
          if (manifest?.document) {
            const copyButton = document.createElement("button");
            copyButton.className = "plugin-detail-copy";
            copyButton.type = "button";
            peButton(copyButton, "secondary", "compact");
            copyButton.dataset.pluginCopy = plugin.id;
            copyButton.textContent = t("copyPluginMarkdown");
            detailBar.append(copyButton);
          }
          documentView.textContent = detailDocument;
          detail.append(detailBar, documentView);
          actions.append(detailButton);
          option.append(detail);
        }
        if (plugin.documentPath && manifest?.document) {
          const duplicateButton = document.createElement("button");
          duplicateButton.className = "plugin-duplicate-button";
          duplicateButton.type = "button";
          peButton(duplicateButton, "toolbar", "compact");
          duplicateButton.dataset.pluginDuplicate = plugin.id;
          duplicateButton.disabled = state.pluginAuthoringBusy;
          duplicateButton.setAttribute("aria-label", t("duplicatePlugin"));
          duplicateButton.setAttribute("title", t("duplicatePlugin"));
          duplicateButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="11" height="11" rx="1.5"/><path d="M15 14v5.5A1.5 1.5 0 0 1 13.5 21h-9A1.5 1.5 0 0 1 3 19.5v-9A1.5 1.5 0 0 1 4.5 9H9"/></svg>';
          actions.append(duplicateButton);
        }
        if (plugin.documentPath && plugin.builtIn === false) {
          const deleteButton = document.createElement("button");
          deleteButton.className = "plugin-delete-button";
          deleteButton.type = "button";
          peButton(deleteButton, "danger", "compact");
          deleteButton.dataset.pluginDelete = plugin.id;
          deleteButton.disabled = Boolean(state.pluginDeleting);
          deleteButton.setAttribute("aria-label", t("deletePlugin"));
          deleteButton.setAttribute("title", t("deletePlugin"));
          deleteButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"/></svg>';
          actions.append(deleteButton);
        }
        option.prepend(label, actions);
        grid.append(option);
      }
      section.append(heading, grid);
      fragment.append(section);
    }
    pluginOptions.replaceChildren(fragment);
  }
  function updatePluginControl() {
    renderPluginOptions();
    pluginButton.classList.toggle("active", !pluginPopover.hidden);
    pluginButton.removeAttribute("aria-pressed");
    pluginButton.setAttribute("aria-expanded", String(!pluginPopover.hidden));
    pluginLocalCount.textContent = String(PLUGIN_DEFINITIONS.length);
    pluginCatalogStatus.textContent = pluginCatalogStatusText();
    pluginCatalogStatus.classList.toggle("plugin-option-error", Boolean(state.pluginCatalogError) || state.pluginCatalogNotice?.type === "error");
    pluginRefresh.classList.toggle("loading", state.pluginCatalogLoading);
    pluginRefresh.disabled = state.pluginCatalogLoading;
  }
  function togglePluginDetails(pluginId, button) {
    const detail = button?.closest(".plugin-option")?.querySelector(`#plugin-detail-${CSS.escape(pluginId)}`);
    if (!detail) return;
    const expanded = detail.hidden;
    detail.hidden = !expanded;
    button.setAttribute("aria-expanded", String(expanded));
  }
  async function copyPluginMarkdown(pluginId, button) {
    const document = pluginManifests.get(pluginId)?.document;
    if (!document || !button) return;
    const copied = await writeClipboardText(document),
      original = t("copyPluginMarkdown");
    button.textContent = t(copied ? "pluginMarkdownCopied" : "pluginMarkdownCopyFailed");
    clearTimeout(button._copyResetTimer);
    button._copyResetTimer = setTimeout(() => {
      if (button.isConnected) button.textContent = original;
    }, 1800);
  }
  function nextPluginCopyId(pluginId) {
    const taken = new Set(PLUGIN_DEFINITIONS.map((plugin) => plugin.id));
    for (const id of pluginManifests.keys()) taken.add(id);
    for (let index = 1; index < 10000; index++) {
      const suffix = index === 1 ? "-copy" : `-copy-${index}`,
        stem = pluginId.slice(0, Math.max(1, 64 - suffix.length)).replace(/-+$/, "") || "plugin",
        candidate = `${stem}${suffix}`;
      if (!taken.has(candidate)) return candidate;
    }
    return "";
  }
  function replacePluginFrontmatterField(document, field, value) {
    const line = `${field}: ${String(value).trim().replace(/[\r\n]/g, " ")}`,
      pattern = new RegExp(`^${field}:[^\\r\\n]*$`, "m");
    if (pattern.test(document)) return document.replace(pattern, line);
    return document.replace(/^(name:[^\r\n]*\r?\n)/m, (match) => `${match}${line}\n`);
  }
  function createPluginCopy(pluginId) {
    if (state.pluginAuthoringBusy) return false;
    const plugin = PLUGIN_DEFINITIONS.find((item) => item.id === pluginId),
      manifest = pluginManifests.get(pluginId);
    if (!plugin?.documentPath || !manifest?.document) return false;
    const copyId = nextPluginCopyId(pluginId);
    if (!copyId) return false;
    const sourceName = localizedManifestValue(manifest, "name") || manifest.name || pluginId,
      copyName = t("pluginCopyName").replace("{name}", sourceName),
      escapedId = pluginId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      pluginIdPattern = new RegExp(`(pluginId\\s*:\\s*["'])${escapedId}(["'])`, "g");
    let document = manifest.document.replace(/^id:[^\r\n]*$/m, `id: ${copyId}`);
    document = document.replace(pluginIdPattern, `$1${copyId}$2`);
    document = replacePluginFrontmatterField(document, state.language === "zh" ? "name-zh" : "name", copyName);
    pluginTitle.value = copyName;
    pluginDocumentEditor.value = document;
    pluginStylesEditor.value = manifest.styles || "";
    state.pluginAuthoringStatus = { key:"pluginCopyDraftReady", type:"success", values:{ name:sourceName } };
    setPluginTab("create");
    requestAnimationFrame(() => pluginTitle.focus({ preventScroll:true }));
    return true;
  }
  function pluginAuthoringText(status) {
    if (!status) return "";
    let text = status.raw || t(status.key);
    for (const [key, value] of Object.entries(status.values || {})) text = text.replace(`{${key}}`, String(value));
    return text;
  }
  function pluginDocumentWithTitle(document, title = pluginTitle?.value) {
    const value = String(title || "").trim().replace(/[\r\n]/g, " ");
    if (!value) return document;
    let next = document;
    if (state.language === "zh") {
      if (/^name-zh:/m.test(next)) next = next.replace(/^name-zh:[^\r\n]*$/m, () => `name-zh: ${value}`);
      else next = next.replace(/^(name:[^\r\n]*\r?\n)/m, (line) => `${line}name-zh: ${value}\n`);
    } else next = next.replace(/^name:[^\r\n]*$/m, () => `name: ${value}`);
    return next;
  }
  function syncPluginTitleFromDocument(document) {
    try {
      const manifest = PLUGINS?.parse(document);
      if (manifest) pluginTitle.value = localizedManifestValue(manifest, "name") || manifest.name;
    } catch {}
  }
  function pluginDraftValidation() {
    const document = pluginDocumentWithTitle(pluginDocumentEditor.value),
      styles = pluginStylesEditor?.value || "",
      bytes = new TextEncoder().encode(document).length,
      styleBytes = new TextEncoder().encode(styles).length;
    try {
      if (!PLUGINS?.parse) throw Error("Plugin parser is unavailable");
      const manifest = PLUGINS.parse(document, styles);
      if (PLUGIN_DEFINITIONS.some((plugin) => plugin.id === manifest.id && plugin.builtIn !== false) || ["animation", "general"].includes(manifest.id)) throw Error(t("pluginIdReserved").replace("{id}", manifest.id));
      if (pluginManifests.has(manifest.id)) throw Error(t("pluginIdExists").replace("{id}", manifest.id));
      return { bytes, styleBytes, manifest, document, styles:manifest.styles, error:"" };
    } catch (error) {
      return { bytes, styleBytes, manifest:null, error:error.message || String(error) };
    }
  }
  function updatePluginStylesPreview(validation) {
    // The read-only viewer never exposes plugin authoring. Avoid creating its
    // hidden preview iframe (and a third, unnecessary Widget host document).
    if (!pluginStylesPreview || window.PENECHO_CONFIG?.runtime === "viewer") return;
    const css = validation?.manifest?.styles || "";
    pluginStylesPreviewPayload = {
      type:"penecho-widget-init",
      title:t("pluginStylesPreview"),
      html:`<!doctype html><meta charset="utf-8"><style>
      *{box-sizing:border-box}body{margin:0;padding:22px;background:#fff;color:#172033;font:16px/1.45 system-ui,sans-serif}
      .plugin-css-preview{display:grid;gap:16px}.preview-row{display:flex;flex-wrap:wrap;align-items:center;gap:12px}
      .preview-node{padding:12px 16px;border:2px solid #64748b;border-radius:6px;background:#f8fafc;font-weight:700}
      .preview-muted{color:#64748b}.preview-accent{color:#2563eb}
    </style><main class="plugin-css-preview pd-root" data-pd-palette="standard" data-pd-density="comfortable">
      <h2 class="pd-title">Plugin style preview</h2><p class="pd-subtitle preview-muted">Typography, semantic nodes, labels and palette variables</p>
      <div class="preview-row pd-stage"><span class="preview-node pd-node pd-node--service">Service</span><span class="pd-edge-label">request</span><span class="preview-node pd-node pd-node--database">Database</span></div>
      <div class="preview-row"><span class="pd-badge pd-badge--info preview-accent">Info</span><span class="pd-badge pd-badge--success">Success</span><span class="pd-badge pd-badge--warning">Warning</span><span class="pd-badge pd-badge--danger">Error</span></div>
    </main>`,
      pluginStyles:css,
    };
    if (!pluginStylesPreview.getAttribute("src")) {
      pluginStylesPreviewReady = false;
      pluginStylesPreview.src = canvasAssetUrl("widget-host.html");
    }
    sendPluginStylesPreview();
  }
  function sendPluginStylesPreview() {
    if (!pluginStylesPreviewReady || !pluginStylesPreviewPayload || !pluginStylesPreview?.contentWindow) return false;
    pluginStylesPreview.contentWindow.postMessage(pluginStylesPreviewPayload, location.origin);
    return true;
  }
  function handlePluginStylesPreviewMessage(event) {
    if (event.source !== pluginStylesPreview?.contentWindow || event.origin !== location.origin || event.data?.type !== "penecho-widget-host-ready") return;
    pluginStylesPreviewReady = true;
    sendPluginStylesPreview();
  }
  window.addEventListener("message", handlePluginStylesPreviewMessage);
  function updatePluginAuthoringUi() {
    const validation = pluginDraftValidation(),
      status = state.pluginAuthoringStatus || (validation.manifest
        ? { key:"pluginDraftValid", values:{ name:localizedManifestValue(validation.manifest, "name") || validation.manifest.name }, type:"" }
        : { key:"pluginDraftInvalid", values:{ error:validation.error }, type:"error" });
    for (const button of [pluginSimpleTemplate]) {
      const active = button.dataset.pluginTemplate === state.pluginAuthoringTemplate;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
      button.disabled = state.pluginAuthoringBusy;
    }
    pluginDocumentBytes.textContent = t("pluginBytes").replace("{bytes}", String(validation.bytes));
    pluginDocumentBytes.classList.toggle("invalid", validation.bytes > 12000);
    pluginStylesBytes.textContent = t("pluginStylesBytes").replace("{bytes}", String(validation.styleBytes));
    pluginStylesBytes.classList.toggle("invalid", validation.styleBytes > 32000);
    pluginDocumentStatus.textContent = pluginAuthoringText(status);
    pluginDocumentStatus.className = status.type || "";
    pluginTitle.disabled = state.pluginAuthoringBusy;
    pluginDocumentEditor.disabled = state.pluginAuthoringBusy;
    pluginStylesEditor.disabled = state.pluginAuthoringBusy;
    pluginStylesUploadButton.disabled = state.pluginAuthoringBusy;
    pluginStylesUpload.disabled = state.pluginAuthoringBusy;
    pluginImprove.disabled = state.pluginAuthoringBusy || !pluginDocumentEditor.value.trim() || validation.bytes > 12000;
    pluginSave.disabled = state.pluginAuthoringBusy || state.pluginCatalogLoading || !validation.manifest;
    for (const tab of [pluginLocalTab, pluginCreateTab, pluginServerTab]) tab.disabled = state.pluginAuthoringBusy;
    updatePluginStylesPreview(validation);
    return validation;
  }
  function setPluginAuthoringStatus(key, type = "", values = {}, raw = "") {
    state.pluginAuthoringStatus = { key, type, values, raw };
    updatePluginAuthoringUi();
  }
  function setPluginTemplate(template) {
    if (!Object.hasOwn(PLUGIN_TEMPLATE_DOCUMENTS, template) || state.pluginAuthoringBusy) return false;
    state.pluginAuthoringTemplate = template;
    state.pluginAuthoringStatus = null;
    pluginDocumentEditor.value = PLUGIN_TEMPLATE_DOCUMENTS[template];
    pluginStylesEditor.value = PLUGIN_TEMPLATE_STYLES[template] || "";
    syncPluginTitleFromDocument(pluginDocumentEditor.value);
    updatePluginAuthoringUi();
    return true;
  }
  async function importPluginStylesFile(file) {
    if (!(file instanceof Blob) || state.pluginAuthoringBusy) return false;
    const name = String(file.name || "styles.css"),
      isCss = /\.css$/i.test(name) || file.type === "text/css";
    if (!isCss) {
      setPluginAuthoringStatus("pluginStylesFileType", "error");
      return false;
    }
    if (file.size > 32000) {
      setPluginAuthoringStatus("pluginStylesFileTooLarge", "error");
      return false;
    }
    try {
      const styles = await file.text();
      if (new TextEncoder().encode(styles).length > 32000) {
        setPluginAuthoringStatus("pluginStylesFileTooLarge", "error");
        return false;
      }
      pluginStylesEditor.value = styles;
      state.pluginAuthoringStatus = null;
      const validation = pluginDraftValidation();
      if (!validation.manifest) {
        setPluginAuthoringStatus("pluginDraftInvalid", "error", { error:validation.error });
        return false;
      }
      setPluginAuthoringStatus("pluginStylesImported", "success", { name });
      return true;
    } catch (error) {
      setPluginAuthoringStatus("pluginStylesReadFailed", "error", { error:error.message || String(error) });
      return false;
    } finally {
      pluginStylesUpload.value = "";
    }
  }
  async function pluginJsonResponse(response) {
    let body = null;
    try { body = await response.json(); } catch {}
    if (!response.ok) throw Error(body?.error || `HTTP ${response.status}`);
    return body;
  }
  async function improvePluginDraft() {
    if (state.pluginAuthoringBusy) return false;
    const document = pluginDocumentWithTitle(pluginDocumentEditor.value),
      styles = pluginStylesEditor.value;
    if (!document.trim() || new TextEncoder().encode(document).length > 12000 || new TextEncoder().encode(styles).length > 32000) return false;
    state.pluginAuthoringBusy = true;
    setPluginAuthoringStatus("pluginImproving");
    try {
      const response = await fetch("/api/plugins/improve", {
        method:"POST",
        credentials:"same-origin",
        headers:aiRequestHeaders({ "Content-Type":"application/json" }),
        body:JSON.stringify({ document, styles, reasoningEffort:state.reasoningEffort }),
      }), body = await pluginJsonResponse(response);
      if (typeof body?.document !== "string" || typeof body?.styles !== "string") throw Error("The AI response did not contain a complete plugin bundle");
      PLUGINS.parse(body.document, body.styles);
      pluginDocumentEditor.value = body.document;
      pluginStylesEditor.value = body.styles;
      syncPluginTitleFromDocument(body.document);
      state.pluginAuthoringStatus = { key:"pluginImproved", type:"success", values:{} };
      return true;
    } catch (error) {
      state.pluginAuthoringStatus = { key:"pluginImproveFailed", type:"error", values:{ error:error.message || String(error) } };
      return false;
    } finally {
      state.pluginAuthoringBusy = false;
      updatePluginAuthoringUi();
    }
  }
  async function savePluginDraft(event) {
    event?.preventDefault();
    if (state.pluginAuthoringBusy) return false;
    const validation = updatePluginAuthoringUi();
    if (!validation.manifest) return false;
    state.pluginAuthoringBusy = true;
    setPluginAuthoringStatus("pluginSaving");
    try {
      const response = await fetch("/api/plugins", {
        method:"POST",
        credentials:"same-origin",
        headers:authenticatedApiHeaders({ "Content-Type":"application/json" }),
        body:JSON.stringify({ document:validation.document, styles:validation.styles }),
      }), body = await pluginJsonResponse(response), savedId = body?.plugin?.id;
      if (typeof savedId !== "string" || !await loadPluginDocuments() || !await setPluginEnabled(savedId, true)) throw Error("The plugin was saved, but the local catalog could not be refreshed");
      state.pluginAuthoringStatus = { key:"pluginSaved", type:"success", values:{ name:localizedManifestValue(validation.manifest, "name") || validation.manifest.name } };
      setPluginTab("local");
      return true;
    } catch (error) {
      state.pluginAuthoringStatus = { key:"pluginSaveFailed", type:"error", values:{ error:error.message || String(error) } };
      return false;
    } finally {
      state.pluginAuthoringBusy = false;
      updatePluginAuthoringUi();
    }
  }
  function forgetPluginSetting(pluginId) {
    try {
      const stored = JSON.parse(localStorage.getItem(PLUGIN_STORAGE_KEY) || "{}");
      if (!stored || typeof stored !== "object" || Array.isArray(stored)) return;
      delete stored[pluginId];
      localStorage.setItem(PLUGIN_STORAGE_KEY, JSON.stringify(stored));
    } catch {}
  }
  async function deleteLocalPlugin(pluginId) {
    if (state.pluginDeleting) return false;
    const plugin = PLUGIN_DEFINITIONS.find((item) => item.id === pluginId);
    if (!plugin?.documentPath || plugin.builtIn !== false) return false;
    const manifest = pluginManifests.get(pluginId), name = localizedManifestValue(manifest, "name") || pluginId,
      confirmation = t("deletePluginConfirm").replace("{name}", name);
    if (!window.confirm(confirmation)) return false;
    state.pluginDeleting = pluginId;
    state.pluginCatalogNotice = { key:"pluginDeleting", values:{ name } };
    updatePluginControl();
    try {
      const response = await fetch(`/api/plugins/${encodeURIComponent(pluginId)}`, { method:"DELETE", credentials:"same-origin", headers:authenticatedApiHeaders() });
      await pluginJsonResponse(response);
      forgetPluginSetting(pluginId);
      state.pluginCatalogNotice = { key:"pluginDeleted", values:{ name }, type:"success" };
      await loadPluginDocuments();
      return true;
    } catch (error) {
      state.pluginCatalogNotice = { key:"pluginDeleteFailed", values:{ error:error.message || String(error) }, type:"error" };
      return false;
    } finally {
      state.pluginDeleting = "";
      updatePluginControl();
    }
  }
  function hidePluginControl() {
    if (pluginPopover.hidden) return;
    const restore = state.pluginDialogRestoreFocus;
    document.body.classList.remove("plugin-open");
    if (!featureTour.active) tourMain.inert = false;
    const restoreTarget = focusTargetAvailableOutsideLayer(pluginPopover, restore) ? restore : settingsButton;
    hideLayerWithoutRetainedFocus(pluginPopover, restoreTarget, settingsButton);
    pluginButton.classList.remove("active");
    pluginButton.setAttribute("aria-expanded", "false");
    state.pluginDialogRestoreFocus = null;
    if (document.activeElement !== restoreTarget) restoreTarget?.focus({ preventScroll:true });
  }
  function setPluginTab(tab) {
    const selected = ["local", "create", "server"].includes(tab) ? tab : "local",
      tabs = [["local", pluginLocalTab, pluginLocalPanel], ["create", pluginCreateTab, pluginCreatePanel], ["server", pluginServerTab, pluginServerPanel]];
    for (const [name, button, panel] of tabs) {
      const active = name === selected;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
      panel.hidden = !active;
      if (active) panel.scrollTop = 0;
    }
    if (selected === "create") updatePluginAuthoringUi();
  }
  function showPluginControl() {
    if (!pluginPopover.hidden) return;
    state.pluginDialogRestoreFocus = document.activeElement;
    pluginPopover.hidden = false;
    pluginPopover.setAttribute("aria-hidden", "false");
    document.body.classList.add("plugin-open");
    tourMain.inert = true;
    updatePluginControl();
    setPluginTab("local");
    pluginPopover.querySelector(".plugin-modal")?.focus({ preventScroll:true });
    if (!state.pluginCatalogLoaded) void loadPluginDocuments();
  }
  function discardPendingAnimationDrafts() {
    const pending = state.pending;
    if (!pending) return;
    if (!pending.items) {
      if (!pending.animationScene) return;
      state.pending = null;
      state.pendingGesture = null;
      updateBatchActions();
      resolvePending(pending, AI_REJECTED);
      return;
    }
    const remaining = pending.items.filter((item) => !item.animationScene);
    if (remaining.length === pending.items.length) return;
    if (!remaining.length) {
      state.pending = null;
      state.pendingGesture = null;
      updateBatchActions();
      resolvePending(pending, AI_REJECTED);
      return;
    }
    pending.items = remaining;
    pending.selectedIndex = Math.min(pending.selectedIndex, remaining.length - 1);
    state.pendingGesture = null;
    updateBatchActions();
  }
  function applyAnimationPluginState(enabled) {
    if (!enabled) {
      if (state.animationEdit) acceptAnimationEdit();
      discardPendingAnimationDrafts();
      hideAnimationControls();
      state.selectedAnimationId = null;
      state.animationGesture = null;
      state.animationEdit = null;
      stopAnimationFrames();
      clearAnimationLayer();
    } else {
      state.animationFullRedraw = true;
      requestAnimationLayerRender();
    }
    requestRender();
  }
  function applyWidgetPluginState(pluginId, enabled) {
    if (!enabled && activeWidgetRefinement()?.pluginId === pluginId) cancelWidgetRefinement("widget-plugin-disabled");
    if (!enabled && state.pendingWidget?.pluginId === pluginId) rejectPendingWidget();
    if (!enabled && selectedWidget()?.pluginId === pluginId) acceptWidgetEdit();
    for (const widget of state.widgets) {
      if (widget.pluginId !== pluginId) continue;
      if (enabled) mountWidget(widget);
      else unmountWidget(widget);
    }
    syncWidgetRuntime();
    requestRender();
  }
  async function setPluginEnabled(pluginId, enabled) {
    const plugin = PLUGIN_DEFINITIONS.find((item) => item.id === pluginId);
    if (!plugin) return false;
    if (pluginId === "general") enabled = true;
    if (enabled && plugin.documentPath && !pluginManifests.has(pluginId)) return false;
    if (enabled) {
      try { await ensurePluginRuntime(pluginId); }
      catch (error) {
        state.pluginCatalogError = error.message;
        updatePluginControl();
        return false;
      }
    }
    state.plugins[pluginId] = Boolean(enabled);
    persistPluginSettings();
    if (plugin.documentPath) applyWidgetPluginState(pluginId, state.plugins[pluginId]);
    else plugin.onChange?.(state.plugins[pluginId]);
    updatePluginControl();
    if (pluginId === "flowchart" || plugin.builtIn === false) canvasAgentContextDidChange(true);
    return true;
  }
  function setEffort(value) {
    const effort = normalizeToolbarReasoningEffort(value);
    if (!effort) return false;
    state.reasoningEffort = effort;
    localStorage.setItem("penecho-ai-effort", state.reasoningEffort);
    updateEffortControl();
    hideEffortControl();
    return true;
  }
  function setAutoEnabled(enabled, showDelay = false) {
    state.auto = enabled;
    clearTimeout(state.timer);
    state.timer = 0;
    localStorage.setItem("penecho-auto-ai", String(enabled));
    updateAutoControl();
    canvasAgentSyncAutomaticAIStatus();
    if (enabled) {
      schedule();
      if (showDelay) showAutoDelayControl();
    } else hideAutoDelayControl();
  }
  function updatePaint() {
    const css = getComputedStyle(document.body);
    state.paint = {
      paper: css.getPropertyValue("--paper").trim() || "#ead9ad",
      paperGrid: css.getPropertyValue("--paper-grid").trim() || "#c8ae7155",
      outside: css.getPropertyValue("--outside").trim() || "#090814",
      border: css.getPropertyValue("--line").trim() || "#7f693b",
      accent: css.getPropertyValue("--studio-accent").trim() || "#4f46e5",
    };
  }
  function applyLanguage() {
    mcpRenderSettings();
    if(typeof canvasDocuments!=="undefined")canvasDocumentsRender();
    document.documentElement.lang = state.language === "zh" ? "zh-CN" : "en";
    document.title = t("title");
    document.querySelectorAll("[data-i18n]").forEach((node) => (node.textContent = t(node.dataset.i18n)));
    document.querySelectorAll("[data-i18n-aria]").forEach((node) => node.setAttribute("aria-label", t(node.dataset.i18nAria)));
    document.querySelectorAll("[data-i18n-title]").forEach((node) => node.setAttribute("title", t(node.dataset.i18nTitle)));
    document.querySelectorAll("[data-i18n-placeholder]").forEach((node) => node.setAttribute("placeholder", t(node.dataset.i18nPlaceholder)));
    document.querySelectorAll("[data-language]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.language === state.language)));
    updateAutoControl();
    updateEffortControl();
    updatePluginControl();
    updatePluginAuthoringUi();
    updateFullscreenButton();
    updateAppearanceControls();
    updateEmbodimentLabel();
    updateGridButton();
    updateHistorySaveFeedbackLanguage();
    renderSnapshotList();
    renderConnectionLists();
    renderSearchTestStatuses();
    if (settings.searchTestBusy && settingsTestSearch) settingsTestSearch.textContent = t("settingsTestingSearch");
    updateNewCanvasDialog();
    renderCanvasHint(false);
    if (state.aiProgressEvent) setStatus(aiProgressText(state.aiProgressEvent),AI_PROGRESS_STATUS_KEYS[state.aiProgressEvent.phase]);
    else if (state.statusKey) setStatusKey(state.statusKey);
    updateSelectionToolbar();
    updateCanvasAgentLanguage();
    updateFeatureTourLanguage();
    summonFX?.refreshText();
    positionAnimationControls();
    requestInteractionLayerRender();
    window.dispatchEvent(new CustomEvent("penecho:languagechange", { detail:{ language:state.language } }));
  }
  function updateAppearanceControls() {
    document.querySelectorAll(".studio-palette-option[data-studio-palette]").forEach((button) => {
      const selected = button.dataset.studioPalette === state.studioPalette;
      button.setAttribute("aria-checked", String(selected));
      button.classList.toggle("selected", selected);
    });
    document.querySelectorAll("[data-page-scale]").forEach((button) => {
      const selected = Math.abs(Number(button.dataset.pageScale) - state.pageScale) < 0.0001;
      button.setAttribute("aria-checked", String(selected));
      button.classList.toggle("selected", selected);
    });
  }
  function updateEmbodimentLabel() {
    const label = t("guideStudio");
    embodiment.setAttribute("aria-label", label);
    const orbLabel = state.busy ? t("stopAIRequest") : t("triggerAutoAI");
    aiOrb.setAttribute("aria-label", orbLabel);
    aiOrb.setAttribute("title", orbLabel);
  }
  function updateFullscreenButton() {
    const button = document.querySelector("#fullscreenBtn");
    if (!button) return;
    const active = Boolean(document.fullscreenElement);
    button.setAttribute("aria-pressed", String(active));
    button.setAttribute("aria-label", t(active ? "exitFullscreen" : "fullscreen"));
    button.setAttribute("title", t(active ? "exitFullscreen" : "fullscreen"));
    document.body.classList.toggle("is-fullscreen", active);
  }
  function updateBatchActions() {
    const actions = document.querySelector("#batchActions");
    if (actions) actions.hidden = !state.pending?.items || state.pending.fading;
  }
  function updateGridButton() {
    const button = document.querySelector("#gridToggle"),
      visible = state.gridVisible,
      label = t(visible ? "gridOff" : "gridOn");
    button.disabled = false;
    button.classList.toggle("active", visible);
    button.setAttribute("aria-pressed", String(visible));
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
  }
  function applyTheme(theme) {
    const removedTheme = REMOVED_THEMES.has(theme),
      studioPalette = normalizeStudioPaletteForTheme(theme, state.studioPalette),
      studioPaletteChanged = studioPalette !== state.studioPalette;
    theme = normalizeTheme(theme);
    state.theme = theme;
    state.studioPalette = studioPalette;
    document.body.dataset.theme = theme;
    document.body.dataset.studioPalette = studioPalette;
    embodiment.dataset.theme = theme;
    localStorage.setItem("penecho-theme", theme);
    if (removedTheme || studioPaletteChanged) {
      localStorage.setItem("penecho-studio-palette", studioPalette);
      updateAppearanceControls();
    }
    state.gridVisible = (localStorage.getItem("penecho-grid") ?? localStorage.getItem("ghostboard-grid")) !== "false";
    updateEmbodimentLabel();
    updateGridButton();
    syncStudioWorkbench(theme);
    updatePaint();
    requestRender();
  }
  function applyStudioPalette(palette) {
    state.studioPalette = normalizeStudioPalette(palette);
    document.body.dataset.studioPalette = state.studioPalette;
    localStorage.setItem("penecho-studio-palette", state.studioPalette);
    updateAppearanceControls();
    updatePaint();
    requestRender();
  }
  function applyPageScale(scale) {
    state.pageScale = window.PenEchoPageScale?.apply?.(scale) || 1;
    updateAppearanceControls();
    fit();
    window.dispatchEvent(new Event("resize"));
  }
  function setBusy(value) {
    state.busy = Boolean(value);
    embodiment.classList.toggle("working", state.busy);
    embodiment.setAttribute("aria-busy", String(state.busy));
    if (state.busy) {
      revealAIOrb();
      showSummon();
    } else {
      hideSummon();
      scheduleAIOrbIdle();
    }
    updateEmbodimentLabel();
  }
  function noteCanvasChromeInteraction(now = performance.now()) {
    state.canvasChromeMaterialDeadline = now + CANVAS_CHROME_MATERIAL_RESTORE_MS;
    if (!state.canvasChromeMaterialActive) {
      state.canvasChromeMaterialActive = true;
      view.classList.add("canvas-chrome-lightweight");
    }
    if (state.canvasChromeMaterialTimer) return;
    const restore = () => {
      const remaining = state.canvasChromeMaterialDeadline - performance.now();
      if (remaining > 16) {
        state.canvasChromeMaterialTimer = setTimeout(restore, remaining);
        return;
      }
      state.canvasChromeMaterialTimer = 0;
      state.canvasChromeMaterialDeadline = 0;
      state.canvasChromeMaterialActive = false;
      view.classList.remove("canvas-chrome-lightweight");
    };
    state.canvasChromeMaterialTimer = setTimeout(restore, CANVAS_CHROME_MATERIAL_RESTORE_MS);
  }
  function restoreCanvasChromeMaterial() {
    if (state.canvasChromeMaterialTimer) clearTimeout(state.canvasChromeMaterialTimer);
    state.canvasChromeMaterialTimer = 0;
    state.canvasChromeMaterialDeadline = 0;
    state.canvasChromeMaterialActive = false;
    view.classList.remove("canvas-chrome-lightweight");
  }
  function restoreCanvasAgentAfterNavigation() {
    const restoreMaterial = state.canvasAgentNavigationActive && state.canvasAgentNavigationWasOpen;
    if (state.canvasAgentNavigationRestoreTimer) clearTimeout(state.canvasAgentNavigationRestoreTimer);
    state.canvasAgentNavigationRestoreTimer = 0;
    state.canvasAgentNavigationRestoreDeadline = 0;
    state.canvasAgentNavigationActive = false;
    state.canvasAgentNavigationWasOpen = false;
    if (restoreMaterial) restoreCanvasChromeMaterial();
    document.body.classList.remove("canvas-agent-navigation-hidden");
  }
  function scheduleCanvasAgentNavigationRestore() {
    if (!state.canvasAgentNavigationActive || state.canvasAgentNavigationRestoreTimer) return;
    const restore = () => {
      const remaining = state.canvasAgentNavigationRestoreDeadline - performance.now();
      if (remaining > 16) {
        state.canvasAgentNavigationRestoreTimer = setTimeout(restore, remaining);
        return;
      }
      state.canvasAgentNavigationRestoreTimer = 0;
      if (state.canvasAgentNavigationPointerIds.size) return;
      restoreCanvasAgentAfterNavigation();
    };
    state.canvasAgentNavigationRestoreTimer = setTimeout(restore, CANVAS_AGENT_NAVIGATION_RESTORE_MS);
  }
  function noteCanvasAgentNavigation(now = performance.now()) {
    if (!state.canvasAgentNavigationActive) {
      state.canvasAgentNavigationActive = true;
      state.canvasAgentNavigationWasOpen = !canvasAgentPanel.hidden && document.body.classList.contains("canvas-agent-open");
      if (state.canvasAgentNavigationWasOpen) {
        if (canvasAgentPanel.contains(document.activeElement)) document.activeElement.blur();
        document.body.classList.add("canvas-agent-navigation-hidden");
      }
    }
    state.canvasAgentNavigationRestoreDeadline = now + CANVAS_AGENT_NAVIGATION_RESTORE_MS;
    scheduleCanvasAgentNavigationRestore();
  }
  function canvasAgentNavigationPointerDidEnd(pointerId, now = performance.now()) {
    const released = state.canvasAgentNavigationPointerIds.delete(pointerId);
    if (!released || !state.canvasAgentNavigationActive || state.canvasAgentNavigationPointerIds.size) return false;
    state.canvasAgentNavigationRestoreDeadline = now + CANVAS_AGENT_NAVIGATION_RESTORE_MS;
    scheduleCanvasAgentNavigationRestore();
    return true;
  }
  function setNavigating(value) {
    const now = performance.now();
    state.navigationDeadline = now + NAVIGATION_HINT_VISIBLE_MS;
    if (value) view.classList.add("is-navigating");
    if (!view.classList.contains("is-navigating")) return;
    if (state.navigationTimer) return;
    const hide = () => {
      const remaining = state.navigationDeadline - performance.now();
      if (remaining > 16) {
        state.navigationTimer = setTimeout(hide, remaining);
        return;
      }
      state.navigationTimer = 0;
      state.navigationDeadline = 0;
      view.classList.remove("is-navigating", "is-wheel-navigating");
      void window.PenEchoStudioNavigator?.flushMcpFollow?.();
    };
    state.navigationTimer = setTimeout(hide, NAVIGATION_HINT_VISIBLE_MS);
  }
  function wheelNavigating() {
    view.classList.add("is-wheel-navigating");
    setNavigating(true);
  }
  function setCanvasNavigationLocked(locked) {
    state.navigationLocked = Boolean(locked);
    state.panGesture = null;
    state.touchGesture = null;
    const label = t(state.navigationLocked ? "canvasUnlockNavigation" : "canvasLockNavigation");
    view.classList.toggle("navigation-locked", state.navigationLocked);
    canvasNavigationLock.classList.toggle("locked", state.navigationLocked);
    canvasNavigationLock.setAttribute("aria-pressed", String(state.navigationLocked));
    canvasNavigationLock.setAttribute("aria-label", label);
    canvasNavigationLock.setAttribute("title", label);
    syncWidgetHostStates();
    resetCanvasCursor();
    setNavigating(true);
  }
  function selectionAIRequest(selection = state.selection) {
    return selection?.aiRequest || null;
  }
  function selectionAIBusy(selection = state.selection) {
    return Boolean(selectionAIRequest(selection));
  }
  function selectionIsTypesetting(selection = state.selection) {
    return selectionAIRequest(selection)?.action === "normalize";
  }
  function selectionAIStatusKey(selection = state.selection) {
    return selectionIsTypesetting(selection) ? "selectionTypesetting" : "observing";
  }
  function requestSelectionAI(action, selection, packed) {
    if (!selection || selection.phase !== "active" || !packed) return false;
    const token = {};
    selection.aiRequest = { token, action };
    supersedeActiveAI("selection-scoped-action");
    setStatusKey(selectionAIStatusKey(selection));
    updateSelectionToolbar();
    requestAI(action, packed, { isolatedSelection: true, selection, selectionRequestToken: token }).finally(() => {
      if (selection.aiRequest?.token === token) selection.aiRequest = null;
      if (state.selection === selection) updateSelectionToolbar();
    });
    return true;
  }
  function invokeAIAction(action) {
    cancelWidgetRefinement("manual-action");
    clearTimeout(state.timer);
    state.timer = 0;
    if (state.selection?.phase === "active") {
      const selection = state.selection,
        packed = buildSelectionTypesetRequest(selection);
      if (!packed) return;
      requestSelectionAI(action, selection, packed);
      return;
    }
    supersedeActiveAI("manual-action");
    requestAI(action, null, { captureCurrentViewport: true });
  }
  const AI_ORB_IDLE_DELAY_MS = 5000;
  function revealAIOrb() {
    clearTimeout(state.aiOrbIdleTimer);
    state.aiOrbIdleTimer = 0;
    embodiment.classList.remove("idle-dim");
  }
  function scheduleAIOrbIdle() {
    revealAIOrb();
    if (state.busy) return;
    state.aiOrbIdleTimer = setTimeout(() => {
      state.aiOrbIdleTimer = 0;
      if (!state.busy) embodiment.classList.add("idle-dim");
    }, AI_ORB_IDLE_DELAY_MS);
  }
  function debug(event, details = {}) {
    const item = document.createElement("li");
    item.textContent = `${new Date().toLocaleTimeString()} ${event} ${JSON.stringify(details)}`;
    debugList.prepend(item);
    while (debugList.children.length > 30) debugList.lastChild.remove();
  }
  function rememberRequest(id) {
    if (!id) return;
    state.lastRequestId = id;
    debugRequest.textContent = `request: ${id}`;
  }
  const key = (x, y) => `${x},${y}`;
