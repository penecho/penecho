"use strict";
(() => {
  const SIZE = 20000,
    TILE = 512,
    DIRTY_MASK_SCALE = 0.25,
    INITIAL_VIEW_ZOOM = 1.5,
    EXPORT_MAX_DIMENSION = 16384,
    EXPORT_MAX_PIXELS = 64 * 1024 * 1024,
    MAX_ATLAS_WIDTH = 2048,
    MAX_ATLAS_HEIGHT = 1536,
    FOCUS_INSET_ENABLED = false,
    MAX_LASSO_POINTS = 4096,
    MAX_HISTORY = 30,
    DEFAULT_AUTO_DELAY = 5000,
    DEFAULT_AI_TIMEOUT = 260000,
    screen = document.querySelector("#screen"),
    view = document.querySelector("#viewport"),
    canvasNavigationLock = document.querySelector("#canvasNavigationLock"),
    ctx = screen.getContext("2d"),
    animationLayer = document.querySelector("#animationLayer"),
    animationCtx = animationLayer.getContext("2d"),
    widgetLayer = document.querySelector("#widgetLayer"),
    placedContentLayer = document.querySelector("#placedContentLayer"),
    placedContentCtx = placedContentLayer.getContext("2d"),
    summonLayer = document.querySelector("#summonLayer"),
    inkLayer = document.querySelector("#inkLayer"),
    inkCtx = inkLayer.getContext("2d"),
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
    debugList = document.querySelector("#debugEvents"),
    debugRequest = document.querySelector("#debugRequest"),
    embodiment = document.querySelector("#aiEmbodiment"),
    aiOrb = document.querySelector("#aiOrb"),
    aiRadial = document.querySelector("#aiRadial"),
    selectionOverlayLayer = document.querySelector("#selectionOverlayLayer"),
    selectionToolbar = document.querySelector("#selectionToolbar"),
    selectionTypesetButton = document.querySelector("#selectionTypesetBtn"),
    selectionDeleteButton = document.querySelector("#selectionDeleteBtn"),
    selectionCancelButton = document.querySelector("#selectionCancelBtn"),
    imagePickerButton = document.querySelector("#imagePickerBtn"),
    clipboardCopyButton = document.querySelector("#clipboardCopyBtn"),
    imagePickerInput = document.querySelector("#imagePickerInput"),
    imageEditBar = document.querySelector("#imageEditBar"),
    imagePlaceButton = document.querySelector("#imagePlaceBtn"),
    imageMergeButton = document.querySelector("#imageMergeBtn"),
    imageDeleteButton = document.querySelector("#imageDeleteBtn"),
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
    settingsCliFields = document.querySelector("#settingsCliFields"),
    settingsCliModel = document.querySelector("#settingsCliModel"),
    settingsCliPath = document.querySelector("#settingsCliPath"),
    settingsApiFormat = document.querySelector("#settingsApiFormat"),
    settingsApiUrl = document.querySelector("#settingsApiUrl"),
    settingsApiModel = document.querySelector("#settingsApiModel"),
    settingsApiModelPresets = document.querySelector("#settingsApiModelPresets"),
    settingsApiKey = document.querySelector("#settingsApiKey"),
    settingsApiSaved = document.querySelector("#settingsApiSaved"),
    settingsEffort = document.querySelector("#settingsEffort"),
    settingsMaxTokens = document.querySelector("#settingsMaxTokens"),
    settingsTimeout = document.querySelector("#settingsTimeout"),
    settingsAutoDelay = document.querySelector("#settingsAutoDelay"),
    settingsImageFormat = document.querySelector("#settingsImageFormat"),
    settingsTraceToggle = document.querySelector("#settingsTraceToggle"),
    settingsTraceLimit = document.querySelector("#settingsTraceLimit"),
    settingsSaveButton = document.querySelector("#settingsSave"),
    settingsTestConnection = document.querySelector("#settingsTestConnection"),
    settingsInstallCli = document.querySelector("#settingsInstallCli"),
    settingsEditorCancel = document.querySelector("#settingsEditorCancel"),
    settingsSaveStatus = document.querySelector("#settingsSaveStatus"),
    settingsAutoToggle = document.querySelector("#settingsAutoToggle"),
    settingsWidgetShadowToggle = document.querySelector("#settingsWidgetShadowToggle"),
    summonToggle = document.querySelector("#summonToggle"),
    settingsTourButton = document.querySelector("#settingsTourBtn"),
    settingsChangelogButton = document.querySelector("#settingsChangelogBtn");
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
  const API_MODELS = Object.freeze({
    openai:Object.freeze(["gpt-5.6-sol"]),
    anthropic:Object.freeze(["claude-opus-4-8"]),
    kimi:Object.freeze(["k3", "kimi-k3"]),
    minimax:Object.freeze(["MiniMax-M3", "MiniMax-M2.7"]),
  });
  const EFFORT_LEVELS = ["none", "low", "medium", "high", "max"],
    EFFORT_OPTIONS = ["config", ...EFFORT_LEVELS],
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
    COPY_FEEDBACK_MS = 1600,
    NAVIGATION_HINT_VISIBLE_MS = 10000,
    ANIMATION_CONTROLS_VISIBLE_MS = 10000;
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

Return exactly one html_widget command and no prose, with pluginId:"air-quality". Generate a complete responsive HTML document that uses the place from the user's request, displays the most important air-quality information clearly, and keeps the outer layout transparent.

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
      theme: "Theme",
      themeArcane: "Arcane",
      themeScifi: "Sci-fi",
      themeResearch: "Research",
      themeStudio: "Studio",
      themeFocusArcane: "Favors interdisciplinary insight, intuitive analogy, and creative exploration",
      themeFocusScifi: "Favors engineering, debugging, system design, and future technology",
      themeFocusResearch: "Favors mathematical physics, rigorous derivation, teaching, and code verification",
      themeFocusStudio: "Favors clean layout, concise structured answers, and practical next steps",
      guideArcane: "Arcane knowledge crystal",
      guideScifi: "Holographic analysis core",
      guideResearch: "Einstein scientific mentor",
      guideStudio: "Studio assistant",
      boardTools: "Board tools",
      hand: "Hand tool: move canvas and objects",
      handAutoAIManual: "Hand mode pauses Auto AI · Use the AI button to run it manually.",
      handAutoAIResume: "Auto AI resumes when you leave Hand mode.",
      handWidgetConfirmedHint: "Widget confirmed · Tap it again to reveal its controls.",
      handImageConfirmedHint: "Image confirmed · Tap it again to move, resize, merge, or delete.",
      handImageMergedHint: "Image merged · It now behaves like canvas ink.",
      handAnimationConfirmedHint: "Animation confirmed · Tap it again to move, resize, or play.",
      handTextConfirmedHint: "Text confirmed · Tap it again to edit, move, or resize.",
      handDraftConfirmedHint: "AI result confirmed · Auto AI remains paused in Hand.",
      pen: "Pen",
      eraser: "Eraser",
      select: "Lasso select",
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
      imageSelected: "Editing image: drag the top handle to move, use edge handles to resize, or choose a side action",
      imageMerged: "Merged into canvas ink — the eraser now works on it",
      imageEditBarLabel: "Image actions",
      imagePlace: "Place image",
      imagePlaceHint: "Keep it as an image; tap it in Hand to reveal its edit controls",
      imageMerge: "Merge into ink",
      imageMergeHint: "Fuse into the canvas; the eraser then works on it",
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
      effortConfigured: "Configured",
      effortConfiguredShort: "Conf",
      effortNone: "None",
      effortLow: "Low",
      effortMedium: "Medium",
      effortMediumShort: "Med",
      effortHigh: "High",
      effortMaximum: "Max",
      inkColor: "Ink color",
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
      openAIMenu: "Open AI action menu",
      stopAIRequest: "Stop current AI request",
      aiActions: "AI actions",
      answer: "Answer",
      hint: "Hint",
      continue: "Continue",
      explain: "Explain",
      plot: "Plot",
      tip: "Pan: middle-mouse drag, Hand tool, or one finger · Zoom: wheel or pinch",
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
      tourEffortTitle: "Choose how deeply AI reasons",
      tourEffortBody: "AI Effort controls the reasoning depth used for each request. Higher levels suit difficult derivations and multi-step problems, but can take longer. Configured uses the default selected in your local setup.",
      tourPluginsTitle: "Real photos and professional diagrams",
      tourPluginsBody: "Real Photos is on by default and usually shows one web photo. Professional Diagrams is also on by default and creates editable professional visuals with copyable source. Manage both in Plugins.",
      tourHandTitle: "Move objects with the Hand tool",
      tourHandBody: "Choose Hand, then tap an image, animation, text box, or AI widget to reveal its controls. HTML widgets remain interactive; drag empty space to pan.",
      tourStudioThemeTitle: "Try the new Studio theme",
      tourStudioThemeBody: "Open Theme to switch the canvas's visual style and the AI's response emphasis. The new Studio theme uses a clean, focused interface and favors concise, well-structured, practical answers. You can switch themes at any time.",
      tourLassoTitle: "Work with exactly the content you select",
      tourLassoBody: "With a mouse or stylus, draw a closed loop around handwriting. Drag the selected region to move it; use the right edge, bottom edge, or lower-right corner to resize it. The selection toolbar can typeset handwriting, delete it, or cancel. Selection-scoped AI requests do not reference the rest of the canvas.",
      tourTextTitle: "Add editable text and formulas",
      tourTextBody: "Choose Text, then click the canvas to create an input box. Markdown and likely LaTeX are formatted automatically; Preview shows the exact placement before confirmation. Confirm with the check button or Ctrl/Cmd + Enter.",
      tourImageTitle: "Add images and photos",
      tourImageBody: "Add a picture from your device; large pictures are compressed automatically. In Hand, tap it to reveal move and resize controls. Place keeps it below ink, while Merge makes it erasable.",
      tourFullscreenTitle: "Give the canvas the whole screen",
      tourFullscreenBody: "Fullscreen hides surrounding browser space and expands the drawing area. Use the same button—or your browser's fullscreen shortcut—to return.",
      tourFilesTitle: "Start, export, and save locally",
      tourFilesBody: "New starts a clean canvas and offers to save confirmed work first. Download exports all visible ink as a cropped PNG. History opens local snapshots, where you can name, save, reload, or delete canvases. Unconfirmed AI drafts are not saved.",
      tourManualAITitle: "Ask AI for a specific kind of help",
      tourManualAIBody: "Click the magic orb to open manual AI actions such as Answer, Hint, Continue, Explain, and Plot. Manual requests use the current canvas context—or only the lasso selection when one is active.",
      tourStatusTitle: "Follow every AI request and result",
      tourStatusBody: "This status indicator reports when AI is observing, writing, finished, delayed, or needs confirmation. When a multi-part draft is ready, nearby controls let you accept or discard the complete response.",
      tourCanvasTitle: "Navigate the large canvas",
      tourCanvasBody: "Write with a mouse or stylus. Pan with one finger, the middle mouse button, or Alt-drag. Zoom with a wheel or trackpad, and pinch with two fingers. Your pointer position and zoom level are shown below the canvas.",
      changelogDialog: "PenEcho release notes",
      changelogClose: "Close release notes",
      changelogBadge: "What's new",
      changelogTitle: "Local-first Cloud and Echoes",
      changelogLocalCloud: "Open Cloud and favorite Canvases locally; add favorite Widgets to your current Canvas.",
      changelogEchoes: "Publish to Echoes, Echo shared work, and share Widgets or Canvases as images.",
      settingsTitle: "Settings",
      settingsClose: "Close settings",
      settingsApiSection: "AI connection",
      settingsApiDescription: "Choose an API or an existing local CLI login.",
      settingsProvider: "AI provider",
      settingsCliModel: "Model (optional)",
      settingsCliPath: "Command or path",
      settingsCliHelp: "Uses the CLI's existing local login. Test the connection for installation and sign-in guidance.",
      settingsConfiguration: "Configuration",
      settingsConnections: "AI connections",
      settingsManage: "Manage",
      settingsApiEntry: "API & CLI settings",
      settingsApiEntryHelp: "Changes apply immediately",
      settingsSystemEntry: "System settings",
      settingsSystemEntryHelp: "Restart required after saving",
      settingsApiDialogTitle: "API & CLI settings",
      settingsApiDialogSubtitle: "Connections are shared with every client. Your current choice is private to this device and applies immediately.",
      settingsConnectionEditor: "Connection details",
      settingsEffortToolbarHelp: "You can quickly change reasoning for any request from the Canvas toolbar.",
      settingsSavedConnections: "Saved connections",
      settingsConnectionCount: "{count} of {limit} connections",
      settingsAddConnection: "Add connection",
      settingsSaveConnection: "Save connection",
      settingsTestConnection: "Test connection",
      settingsTestingConnection: "Testing the model with a small image request…",
      settingsConnectionTestPassed: "Connection ready. The model accepted the image and responded successfully.",
      settingsConnectionTestFailed: "Connection test failed.",
      settingsInstallCli: "Install CLI",
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
      settingsApiModel: "Model",
      settingsApiUrl: "Base URL",
      settingsApiKey: "API key",
      settingsApiKeyHelp: "Stored only in the local PenEcho configuration file.",
      settingsSystemSection: "System",
      settingsSystemDescription: "Simple defaults for requests and canvas behavior.",
      settingsEffort: "Reasoning",
      settingsMaxTokens: "Maximum response tokens",
      settingsMaxTokensHelp: "Includes thinking tokens. Default 20,000; must be larger than 15,000. Low limits may be exhausted during reasoning.",
      settingsTimeout: "Timeout",
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
      settingsWidgetShadow: "Widget & image shadows",
      settingsAISection: "AI",
      settingsSummonSection: "Thinking indicator",
      settingsChangelog: "What's new",
      settingsHelpSection: "Help & about",
      settingsDownloadMac: "Download for macOS",
      settingsDownloadWin: "Download for Windows",
      settingsGitHub: "GitHub repository",
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
      summonTip19: "Tip: zoom with the wheel, pan with the middle mouse button—the canvas spans twenty thousand squares.",
      summonTip20: "Tip: AI ink color lives in the toolbar; AI font lives in this Settings panel.",
      summonTip21: "Tip: write changes anywhere in this view, then choose a widget and use AI Refine.",
      summonTip22: "Tip: tap a widget, or hover it with a mouse, to reveal AI Refine.",
      summonTip23: "Tip: AI Refine uses the newest strokes, text, and images in this view as instructions.",
      summonTip24: "Tip: use AI Refine to update a widget in place; regular AI adds a new widget.",
      debugTitle: "PenEcho debug",
      openLocalLog: "Open local server log",
      history: "Canvas history",
      historyTitle: "History",
      saveLocation: "Location",
      storageThisDevice: "Device",
      storagePenEchoServer: "Server",
      storagePenEchoCloud: "Cloud",
      storageThisDeviceDescription: "Saved only in this browser, on this device.",
      storagePenEchoServerDescription: "Saved on this PenEcho host and shared with anyone who passes its access check.",
      storagePenEchoCloudDescription: "Private, versioned storage in your account. Open the same project from any client.",
      canvasProject: "Project",
      canvasProjectAll: "All projects",
      canvasProjectUncategorized: "Uncategorized",
      canvasProjectNew: "New project",
      canvasProjectDelete: "Delete project",
      canvasProjectMove: "Move to project",
      canvasProjectName: "Project name",
      canvasProjectCreated: "Project created",
      canvasProjectDeleted: "Project deleted; its canvases moved to Uncategorized",
      deleteCloudProjectConfirm: "Delete project “{name}”? Its Canvases will move to Uncategorized and no saved content will be deleted.",
      canvasProjectMoved: "Canvas moved",
      closeHistory: "Close history",
      newCanvas: "New",
      saveCanvas: "Save canvas",
      saveCurrentSnapshot: "Save",
      exportPng: "Export PNG",
      newCanvasTitle: "New canvas",
      newCanvasDescription: "Save the confirmed canvas before starting over. Unaccepted AI drafts are not included.",
      loadCanvasTitle: "Load another canvas?",
      loadCanvasDescription: "This canvas has unsaved changes. Save them before loading another canvas.",
      currentSnapshot: "Current snapshot: {name} · {location}",
      noCurrentSnapshot: "There is no current snapshot to overwrite.",
      currentSnapshotOtherLocation: "Current snapshot {name} is in {location}. Select that location to overwrite it.",
      newSnapshotName: "New snapshot name",
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
      snapshotLibraryLoadFailed: "Could not load {location}. Select the location to try again.",
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
      snapshotImages: "images",
      snapshotModified: "Modified {time}",
      deleteSnapshotConfirmDevice: "Delete this snapshot from this device?",
      deleteSnapshotConfirmServer: "Delete this shared snapshot from the PenEcho server?",
      deleteSnapshotConfirmCloud: "Move this Cloud Canvas to Trash? It remains recoverable from PenEcho Cloud.",
      canvasHintWidgetAdded: "Use Pen to mark changes near a widget, then tap the AI Refine button that appears.",
      canvasHintWidgetAddedAlt: "In Pen, notes anywhere in this view can reveal AI Refine on the target widget.",
      canvasHintRefineInPlace: "In Pen, add an instruction, then tap AI Refine on the target widget.",
      canvasHintAIAddsOnly: "Auto AI and manual AI add new widgets; they do not replace existing widgets in place.",
      canvasHintHand: "Hand lets you interact directly with widget content.",
      canvasHintHandAlt: "For pinch or two-finger widget gestures, lock the canvas first.",
      canvasHintWidgetTouchHand: "Use Hand mode to interact directly with this widget's content.",
      canvasHintLasso: "Lasso handwriting to move, resize, or send only that selection to AI.",
      canvasHintLassoAlt: "Drag an edge to resize one axis, or a corner to scale uniformly.",
      canvasHintText: "Text supports Markdown and LaTeX; press Ctrl/Cmd + Enter to confirm.",
      canvasHintTextAlt: "After confirming text near a widget, switch to Pen and tap AI Refine.",
      canvasHintEraser: "Eraser removes ink only; use Hand controls to delete canvas objects.",
      canvasHintEraserAlt: "Erase an instruction before AI runs without changing widgets beneath it.",
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
      batchDraftReady: "Drag an item to move it; drag the group frame or blank space to move all; use the group corner to resize",
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
      pendingConfirm: "Confirm or discard the current AI draft first",
      merged: "AI merged",
      plugins: "Plugins",
      savedCrafts: "Favorites",
      savedCraftsTitle: "Favorites",
      savedLoading: "Loading favorites…",
      savedRefreshing: "Refreshing…",
      savedEmptyIn: "No favorite Canvases or Widgets yet.",
      savedEmptyOut: "No local favorite Widgets yet. Sign in to see Cloud favorites.",
      savedAdd: "Add",
      savedAdding: "Adding…",
      savedOpen: "Open",
      savedOpening: "Opening…",
      savedCanvas: "Canvas",
      savedWidget: "Widget",
      savedRemoveTitle: "Remove from favorites",
      savedSourceLocal: "Local",
      savedSourceCloud: "Cloud",
      savedSourceCommunity: "Cloud community",
      savedSourceSynced: "Cloud + local",
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
      widgetDelete: "Delete widget",
      widgetDeleted: "Widget deleted",
      widgetSourceCopied: "Widget source copied",
      widgetSourceCopyFailed: "Widget source could not be copied",
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
      clearConfirm: "Clear the whole canvas?",
      timeout: "Request timed out",
      aiNoVisibleResponse: "AI returned no displayable content. Please retry or rephrase the request.",
      aiError: "AI: ",
    },
    zh: ZH,
  };
  const PLUGIN_STORAGE_KEY = "penecho-plugins",
    SUPPORTED_THEMES = new Set(["arcane", "scifi", "research", "studio"]),
    DIAGRAM_RUNTIME_VERSION = "penecho-diagram-source-v1",
    DIAGRAM_SOURCE_FORMATS = new Set(["mermaid", "dot", "bpmn-xml", "vega-lite", "geojson", "smiles", "cytoscape-json"]),
    BUILTIN_PLUGIN_DEFINITIONS = Object.freeze([]);
  const PLUGIN_DEFINITIONS = [...BUILTIN_PLUGIN_DEFINITIONS];
  const pluginManifests = new Map(),
    pluginLoadErrors = new Map(),
    widgetSnapshotRequests = new Map(),
    widgetHostPointerAnchors = new Map(),
    screenCalibration = new Map();
  let diagramRuntimePromise = null;
  let screenClientRatio = 1;
  function normalizeTheme(theme) {
    return SUPPORTED_THEMES.has(theme) ? theme : "studio";
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
  const storedPrimaryLanguage = localStorage.getItem("penecho-language"),
    storedLegacyLanguage = localStorage.getItem("ghostboard-language"),
    storedTheme = localStorage.getItem("penecho-theme") || localStorage.getItem("ghostboard-theme"),
    storedGrid = localStorage.getItem("penecho-grid") ?? localStorage.getItem("ghostboard-grid"),
    storedResearchGrid = localStorage.getItem("penecho-research-grid"),
    storedAutoEnabled = localStorage.getItem("penecho-auto-ai"),
    storedAutoDelayText = localStorage.getItem("penecho-auto-delay-ms"),
    storedSummonEnabled = localStorage.getItem("penecho-summon-enabled"),
    storedWidgetShadowEnabled = localStorage.getItem("penecho-widget-shadow"),
    storedSnapshotLocation = localStorage.getItem("penecho-snapshot-location"),
    storedAiEffortText = String(localStorage.getItem("penecho-ai-effort") || "").trim().toLowerCase(),
    storedAiEffort = storedAiEffortText === "xhigh" ? "max" : storedAiEffortText,
    storedAutoDelay = storedAutoDelayText === null ? NaN : Number(storedAutoDelayText),
    initialLanguage = TOUR.resolveInitialLanguage(storedPrimaryLanguage, storedLegacyLanguage),
    initialTheme = normalizeTheme(storedTheme),
    initialGrid = storedGrid === null ? true : storedGrid === "true",
    initialResearchGrid = storedResearchGrid === "true",
    configuredAutoDelay = Number(window.PENECHO_CONFIG?.autoAiDelayMs),
    configuredAiTimeout = Number(window.PENECHO_CONFIG?.aiRequestTimeoutMs),
    configuredAiEffort = String(window.PENECHO_CONFIG?.aiEffort || "").trim().toLowerCase(),
    configuredAccessSession = String(window.PENECHO_CONFIG?.accessSessionToken || sessionStorage.getItem("penecho-access-session") || ""),
    serverAutoDelay = Number.isFinite(configuredAutoDelay) && configuredAutoDelay >= 0 ? configuredAutoDelay : DEFAULT_AUTO_DELAY,
    initialAutoDelay = Number.isFinite(storedAutoDelay) && storedAutoDelay >= 0 && storedAutoDelay <= 10000 ? storedAutoDelay : Math.min(10000, serverAutoDelay),
    initialAutoEnabled = storedAutoEnabled === null ? true : storedAutoEnabled === "true",
    initialSummonEnabled = storedSummonEnabled === null ? true : storedSummonEnabled === "true",
    initialWidgetShadowEnabled = storedWidgetShadowEnabled === "true",
    // The public viewer shares the Cloud origin (and therefore localStorage)
    // with editable Cloud Canvases. Never inherit their last-selected Cloud
    // history location: the read-only shell has no /api/cloud/library route.
    initialSnapshotLocation = window.PENECHO_CONFIG?.runtime === "viewer"
      ? "device"
      : ["device", "server", "cloud"].includes(storedSnapshotLocation) ? storedSnapshotLocation : "device",
    initialAiEffort = EFFORT_OPTIONS.includes(storedAiEffort) ? storedAiEffort : EFFORT_OPTIONS.includes(configuredAiEffort) ? configuredAiEffort : "config",
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
  function selectedAiConnectionId() {
    const id = String(localStorage.getItem(AI_CONNECTION_STORAGE_KEY) || "default").trim();
    return id === "default" || /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id) ? id : "default";
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
    return { ...authenticatedApiHeaders(headers), "X-PenEcho-Connection":selectedAiConnectionId() };
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
      scale: 0.1,
      panX: 0,
      panY: 0,
      pen: 4,
      eraser: 35,
      aiFont: "ui-rounded, system-ui, sans-serif",
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
      textEditors: new Map(),
      textBoxes: [],
      textEditorStyleSheet: null,
      nextTextEditorId: 1,
      nextTextBoxId: 1,
      nextTextEditorZ: 1,
      activeTextEditorId: null,
      selectedTextBoxId: null,
      textBoxGesture: null,
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
      copyGeneration: 0,
      selection: null,
      selectionGesture: null,
      hotspotTrail: [],
      auto: initialAutoEnabled,
      summonEnabled: initialSummonEnabled,
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
      currentSnapshotLocation: null,
      currentSnapshotProjectId: null,
      currentSnapshotRevisionId: null,
      currentSnapshotBundleExtensions: {},
      currentSnapshotManifestExtensions: {},
      currentSnapshotPreservedAssets: [],
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
      gridVisible: initialTheme === "research" ? initialResearchGrid : initialGrid,
      paint: { paper: "#ead9ad", paperGrid: "#c8ae7155", outside: "#090814", border: "#7f693b" },
      navigationTimer: 0,
      aiOrbIdleTimer: 0,
      radialGesture: null,
      radialCloseTimer: 0,
      radialSuppressClickUntil: 0,
      statusKey: "ready",
      aiProgressEvent: null,
      canvasHintKey: null,
    };
  let textHelpInvoker = null;
  let pluginStylesPreviewReady = false,
    pluginStylesPreviewPayload = null;
  const AI_CANCELLED = "AI_CANCELLED";
  const AI_REJECTED = "AI_REJECTED";
  const AI_SUPERSEDED = "AI_SUPERSEDED";
  const FEATURE_TOUR_STORAGE_KEY = "penecho-tour-progress";
  const CHANGELOG_STORAGE_KEY = "penecho-changelog-seen";
  const CHANGELOG_VERSION = "1.0.0";
  // Keep seen IDs stable. Add a new ID (or bump its -vN suffix) to show only that feature to returning users.
  const FEATURE_TOUR_STEPS = Object.freeze([
    { id: "core-effort-v1", targets: ["#aiEffortButton"], titleKey: "tourEffortTitle", bodyKey: "tourEffortBody", placement: "bottom", radius: 8 },
    { id: "plugins-v3", targets: ["#pluginButton"], titleKey: "tourPluginsTitle", bodyKey: "tourPluginsBody", placement: "bottom", radius: 8 },
    { id: "hand-v1", targets: ["#handToolBtn"], titleKey: "tourHandTitle", bodyKey: "tourHandBody", placement: "bottom", radius: 7 },
    { id: "studio-theme-v1", targets: ["#theme"], titleKey: "tourStudioThemeTitle", bodyKey: "tourStudioThemeBody", placement: "bottom", radius: 8 },
    { id: "core-lasso-v1", targets: ["#lassoToolBtn"], titleKey: "tourLassoTitle", bodyKey: "tourLassoBody", placement: "bottom", radius: 7 },
    { id: "core-text-v1", targets: ["#textToolBtn"], titleKey: "tourTextTitle", bodyKey: "tourTextBody", placement: "bottom", radius: 7 },
    { id: "core-image-v1", targets: ["#imagePickerBtn"], titleKey: "tourImageTitle", bodyKey: "tourImageBody", placement: "bottom", radius: 7 },
    { id: "core-fullscreen-v1", targets: ["#fullscreenBtn"], titleKey: "tourFullscreenTitle", bodyKey: "tourFullscreenBody", placement: "bottom", radius: 7 },
    { id: "core-files-v1", targets: ["#canvasFileActions"], titleKey: "tourFilesTitle", bodyKey: "tourFilesBody", placement: "bottom", radius: 8 },
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
  const AI_NON_PROGRESS_STATUS_KEYS = new Set(["aiBusy", "aiDone", "aiNoVisibleResponse", "aiError", "aiCancelled", "aiCancelledForInput"]);
  const setStatus = (text, key = null) => {
    status.textContent = text;
    state.statusKey = key;
    const progress=typeof key==="string"&&key.startsWith("ai")&&!AI_NON_PROGRESS_STATUS_KEYS.has(key);
    if(!progress)state.aiProgressEvent=null;
    status.dataset.aiProgress=String(progress);
    status.title=progress?text:"";
  };
  const setStatusKey = (key) => setStatus(t(key), key);
  const t = (key) => I18N[state.language]?.[key] || I18N.en[key] || key;
  window.PenEchoI18n = Object.freeze({
    t,
    currentLanguage:() => state.language,
  });
  function fitCanvasHint() {
    if (!canvasHint) return;
    canvasHint.classList.remove("two-line");
    if (canvasHint.scrollWidth > canvasHint.clientWidth) canvasHint.classList.add("two-line");
  }

  function renderCanvasHint(restart = false) {
    if (!canvasHint || !state.canvasHintKey) return;
    canvasHint.textContent = `${t("hintPrefix")}: ${t(state.canvasHintKey)}`;
    canvasHint.hidden = false;
    fitCanvasHint();
    if (!restart) return;
    canvasHint.classList.remove("is-new");
    void canvasHint.offsetWidth;
    canvasHint.classList.add("is-new");
  }
  function showCanvasHint(keys) {
    const candidates = (Array.isArray(keys) ? keys : [keys]).filter((key) => key && (I18N[state.language][key] || I18N.zh[key]));
    if (!candidates.length) return;
    const alternatives = candidates.filter((key) => key !== state.canvasHintKey),
      choices = alternatives.length ? alternatives : candidates;
    state.canvasHintKey = choices[Math.floor(Math.random() * choices.length)];
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
    styleFor: (element) => runtimeElementStyle(element, "summon-copy"),
  });
  function summonBlockers() {
    const visible = viewportRect(),
      rects = [];
    if (visible) {
      for (const [k, c] of tiles) {
        const [tx, ty] = k.split(",").map(Number),
          tileBox = { x: tx * TILE, y: ty * TILE, w: TILE, h: TILE };
        if (!intersection(tileBox, visible)) continue;
        let ink = state.inkBounds.get(k);
        if (ink === undefined) {
          ink = c ? inkBox(c, Math.min(TILE, SIZE - tx * TILE), Math.min(TILE, SIZE - ty * TILE)) : null;
          state.inkBounds.set(k, ink);
        }
        if (ink) rects.push({ x: tileBox.x + ink.x, y: tileBox.y + ink.y, w: ink.w, h: ink.h });
      }
    }
    for (const widget of state.widgets) rects.push({ x: widget.x, y: widget.y, w: widget.w, h: widget.h });
    if (state.pendingWidget) rects.push({ x:state.pendingWidget.x, y:state.pendingWidget.y, w:state.pendingWidget.w, h:state.pendingWidget.h });
    for (const item of state.textBoxes) rects.push({ x:item.x, y:item.y, w:item.w, h:item.h });
    for (const editor of state.textEditors.values()) {
      const scale = Math.max(0.03, state.scale);
      rects.push({ x: editor.x, y: editor.y, w: editor.widthCss / scale, h: editor.heightCss / scale });
    }
    for (const image of state.images)
      if (Number.isFinite(image.x) && Number.isFinite(image.y)) rects.push({ x: image.x, y: image.y, w: image.logicalWidth || image.width || 0, h: image.logicalHeight || image.height || 0 });
    for (const animation of state.animations)
      if (Number.isFinite(animation.x)) rects.push({ x: animation.x, y: animation.y, w: animation.w, h: animation.h });
    for (const item of state.pending?.items || [])
      if (item && Number.isFinite(item.x)) rects.push({ x: item.x, y: item.y, w: item.layoutWidth || item.w || 0, h: item.layoutHeight || item.h || 0 });
    return rects.filter((r) => r.w > 0 && r.h > 0);
  }
  function summonControlBlockers() {
    const viewRect = view.getBoundingClientRect(),
      viewport = { x:0, y:0, w:view.clientWidth, h:view.clientHeight },
      selectors = [
        ".object-chrome-button",
        ".animation-controls:not([hidden])",
        ".image-edit-bar:not([hidden])",
        ".selection-context-toolbar",
        ".text-editor",
        ".text-input-hint:not([hidden])",
        ".ai-embodiment",
        ".ai-embodiment.menu-open .radial-action",
        "#tip",
      ].join(","),
      rects = [];
    for (const element of view.querySelectorAll(selectors)) {
      const style = getComputedStyle(element),
        rect = element.getBoundingClientRect();
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) <= 0.02
        || rect.width <= 0 || rect.height <= 0) continue;
      const padding = 8,
        clipped = intersection({
          x:rect.left - viewRect.left - padding,
          y:rect.top - viewRect.top - padding,
          w:rect.width + padding * 2,
          h:rect.height + padding * 2,
        }, viewport);
      if (clipped) rects.push({ ...clipped, weight:4 });
    }
    return rects;
  }
  function summonScreenBlockers() {
    const scale = Math.max(0.03, state.scale),
      viewport = { x:0, y:0, w:view.clientWidth, h:view.clientHeight },
      padding = 8,
      rects = [];
    for (const rect of summonBlockers()) {
      const clipped = intersection({
        x:rect.x * scale + state.panX - padding,
        y:rect.y * scale + state.panY - padding,
        w:rect.w * scale + padding * 2,
        h:rect.h * scale + padding * 2,
      }, viewport);
      if (clipped) rects.push({ ...clipped, weight:1 });
    }
    return rects.concat(summonControlBlockers());
  }
  function summonPlacement() {
    const width = view.clientWidth,
      height = view.clientHeight,
      scale = Math.max(0.03, state.scale);
    if (width <= 0 || height <= 0 || !SUMMON?.chooseThinkingPlacement) return null;
    const anchor = state.summonAnchor
        ? {
            x:state.summonAnchor.x * scale + state.panX,
            y:state.summonAnchor.y * scale + state.panY,
            w:state.summonAnchor.w * scale,
            h:state.summonAnchor.h * scale,
          }
        : null,
      placement = SUMMON.chooseThinkingPlacement({
        width,
        height,
        anchor,
        blockers:summonScreenBlockers(),
      });
    return {
      x:(placement.x - state.panX) / scale,
      y:(placement.y - state.panY) / scale,
    };
  }
  function showSummon() {
    if (!summonFX || !state.summonEnabled) return;
    const spot = summonPlacement();
    if (spot) summonFX.show(spot);
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
    const visual = window.visualViewport;
    return visual
      ? { left: visual.offsetLeft, top: visual.offsetTop, width: visual.width, height: visual.height }
      : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
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
    return TOUR.unionRects(elements.map((element) => element.getBoundingClientRect()));
  }
  function availableFeatureTourSteps(steps) {
    return (Array.isArray(steps) ? steps : []).filter((step) => featureTourTargetRect(step));
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
    const cardRect = tourCard.getBoundingClientRect(),
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
    closeRadialMenu();
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
    tourLayer.hidden = true;
    tourLayer.setAttribute("aria-hidden", "true");
    tourMain.inert = false;
    document.body.classList.remove("tour-open");
    runtimeElementStyle(tourHighlight, "tour-highlight")?.setProperty("visibility", "hidden");
    runtimeElementStyle(tourCard, "tour-card")?.setProperty("visibility", "hidden");
    if (restoreScroll) window.scrollTo({ left: featureTour.restoreScrollX, top: featureTour.restoreScrollY, behavior: "auto" });
    requestAnimationFrame(() => {
      if (featureTour.active) return;
      if (options.changelog !== false && maybeShowChangelog()) return;
      if (restore) {
        const target = restoreFocus?.isConnected && restoreFocus !== document.body ? restoreFocus : settingsButton;
        target?.focus({ preventScroll: true });
      }
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
    closeRadialMenu();
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
    changelogLayer.hidden = true;
    changelogLayer.setAttribute("aria-hidden", "true");
    document.body.classList.remove("changelog-open");
    tourMain.inert = featureTour.active || !pluginPopover.hidden;
    requestAnimationFrame(() => {
      if (!featureTour.active && !changelog.active) restoreFocus?.focus({ preventScroll: true });
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
  const settings = { open:false, restoreFocus:null, requestTrace:false, cli:{}, currentProvider:"api", configurationMode:"", configurationRestoreFocus:null, connections:[], activeConnectionId:"default", connectionLimit:10, editingConnectionId:null };
  function syncLocalConnectionSelection() {
    const selected = selectedAiConnectionId(), activeId = settings.connections.some(connection => connection.id === selected) ? selected : "default";
    if (activeId !== selected) localStorage.setItem(AI_CONNECTION_STORAGE_KEY, activeId);
    settings.activeConnectionId = activeId;
    settings.connections = settings.connections.map(connection => ({ ...connection, active:connection.id === activeId }));
  }
  function setConfigurationSection(section, visible) {
    if (!section) return;
    section.hidden = !visible;
    for (const control of section.querySelectorAll("input, select, button")) control.disabled = !visible;
  }
  function openConfiguration(mode) {
    if (!configurationLayer || !canvasSettingsForm) return false;
    closeSettings(false);
    settings.configurationMode = mode;
    settings.configurationRestoreFocus = mode === "api" ? settingsOpenApi : settingsOpenSystem;
    configurationTitle.textContent = t(mode === "api" ? "settingsApiDialogTitle" : "settingsSystemDialogTitle");
    configurationSubtitle.textContent = t(mode === "api" ? "settingsApiDialogSubtitle" : "settingsSystemDialogSubtitle");
    setConfigurationSection(canvasSettingsForm.querySelector(".settings-api-group"), mode === "api");
    setConfigurationSection(canvasSettingsForm.querySelector(".settings-system-group"), mode === "system");
    connectionManager.hidden = mode !== "api";
    canvasSettingsForm.dataset.editorHidden = String(mode === "api");
    settingsEditorCancel.hidden = mode !== "api";
    settingsTestConnection.hidden = mode !== "api";
    settingsInstallCli.hidden = true;
    settingsSaveButton.textContent = t(mode === "api" ? "settingsSaveConnection" : "settingsSave");
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
    const restoreFocus = settings.configurationRestoreFocus;
    settings.configurationMode = "";
    settings.configurationRestoreFocus = null;
    configurationLayer.hidden = true;
    configurationLayer.setAttribute("aria-hidden", "true");
    canvasSettingsForm.hidden = true;
    if (restore) requestAnimationFrame(() => restoreFocus?.focus({ preventScroll:true }));
    return true;
  }
  function updateSettingsProviderFields() {
    const provider = settingsProvider?.value || "api", api = provider === "api";
    if (settings.currentProvider !== "api" && settings.currentProvider !== provider) settings.cli[settings.currentProvider] = { model:settingsCliModel.value, path:settingsCliPath.value };
    settings.currentProvider = provider;
    settingsApiFields.hidden = !api;
    settingsCliFields.hidden = api;
    for (const control of settingsApiFields.querySelectorAll("input, select")) control.disabled = !api || settings.configurationMode !== "api";
    for (const control of settingsCliFields.querySelectorAll("input, select")) control.disabled = api || settings.configurationMode !== "api";
    settingsApiSaved.hidden = !api || settingsApiSaved.dataset.saved !== "true";
    showCliInstaller("", false);
    if (!api) {
      const values = settings.cli[provider] || {};
      settingsCliModel.value = values.model || "";
      settingsCliPath.value = values.path || ({ "kimi-cli":"kimi", "codex-cli":"codex", "claude-cli":"claude" }[provider] || "");
    }
    updateApiPresetFields(false);
  }
  function defaultConnectionEffort(provider = settingsProvider?.value || "api") {
    return "medium";
  }
  function selectDefaultConnectionEffort() {
    settingsEffort.value = defaultConnectionEffort();
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
  function updateApiModelPresets(family) {
    if (!settingsApiModelPresets) return;
    settingsApiModelPresets.replaceChildren(...(API_MODELS[family] || []).map(model => {
      const option = document.createElement("option");
      option.value = model;
      return option;
    }));
  }
  function updateApiPresetFields(applyDefaults = false, resetModel = false) {
    if (!settingsApiFormat || !settingsApiPresetFields) return;
    const family = settingsApiFormat.value, presetFamily = family === "kimi" || family === "minimax",
      enabled = presetFamily && settingsProvider?.value === "api" && settings.configurationMode === "api";
    settingsApiPresetFields.hidden = !presetFamily;
    for (const control of settingsApiPresetFields.querySelectorAll("select")) control.disabled = !enabled;
    updateApiModelPresets(family);
    const preset = selectedApiPreset();
    if (!applyDefaults || !preset) return;
    settingsApiUrl.value = preset.url;
    if (resetModel || !settingsApiModel.value.trim()) settingsApiModel.value = preset.model;
  }
  function fillApiEditor(connection = {}) {
    const matched = apiPresetForConnection(connection), preset = matched?.[1] || null;
    settingsApiFormat.value = preset?.family || (connection.apiFormat === "anthropic" ? "anthropic" : "openai");
    settingsApiRegion.value = preset?.region || "global";
    settingsApiService.value = preset?.service || "api";
    updateApiPresetFields(false);
    settingsApiUrl.value = connection.apiUrl || (connection.apiFormat === "anthropic" ? "https://api.anthropic.com" : "https://api.openai.com/v1");
    settingsApiModel.value = connection.apiModel || "";
  }
  function connectionProviderLabel(connection) {
    return { "kimi-cli":"Kimi CLI", "codex-cli":"Codex CLI", "claude-cli":"Claude CLI" }[connection.provider] || connection.provider;
  }
  function connectionTitle(connection) {
    return connection.provider === "api" ? connection.apiModel || "API" : connection.cliModel || t("settingsCliDefaultModel");
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
    for (const connection of settings.connections) {
      const quick = document.createElement("button"), quickMark = document.createElement("span"), quickCopy = document.createElement("span"), quickName = document.createElement("strong"), quickSummary = document.createElement("small");
      quick.type = "button";
      quick.className = `settings-connection-quick${connection.active ? " active" : ""}`;
      quick.dataset.connectionActivate = connection.id;
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
        use.dataset.connectionActivate = connection.id;
        use.textContent = t("settingsUse");
        actions.append(use);
      }
      const edit = document.createElement("button");
      edit.type = "button";
      edit.dataset.connectionEdit = connection.id;
      edit.textContent = t("settingsEdit");
      actions.append(edit);
      if (connection.removable) {
        const remove = document.createElement("button");
        remove.type = "button";
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
  }
  function fillConnectionEditor(connection = null) {
    settings.editingConnectionId = connection?.id || null;
    const provider = connection?.provider || "api";
    settingsProvider.value = provider;
    settings.currentProvider = provider;
    fillApiEditor(connection || { apiFormat:"openai", apiUrl:"https://api.openai.com/v1", apiModel:"gpt-5.6-sol" });
    settingsApiKey.value = "";
    settingsApiSaved.dataset.saved = String(connection?.hasApiKey === true);
    settings.cli[provider] = { model:connection?.cliModel || "", path:connection?.cliPath || provider.replace("-cli", "") };
    settingsEffort.value = connection?.effort || defaultConnectionEffort(provider);
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
  function setConnectionTestBusy(busy) {
    settingsTestConnection.disabled = busy;
    settingsSaveButton.disabled = busy;
    settingsInstallCli.disabled = busy;
  }
  function showCliInstaller(provider, visible) {
    settingsInstallCli.hidden = !visible || !window.penechoDesktop?.installCli || !["kimi-cli", "codex-cli", "claude-cli"].includes(provider);
    settingsInstallCli.dataset.provider = settingsInstallCli.hidden ? "" : provider;
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
        showCliInstaller(body?.provider || connection.provider, body?.installable === true);
        throw new Error([body?.error, body?.guidance].filter(Boolean).join(" ") || t("settingsConnectionTestFailed"));
      }
      setSettingsStatus(body?.message || t("settingsConnectionTestPassed"), "success");
    } catch (error) { setSettingsStatus(error?.message || t("settingsConnectionTestFailed"), "error"); }
    finally { setConnectionTestBusy(false); }
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
      showCliInstaller("", false);
      setSettingsStatus(t("settingsCliInstalled"), "success");
    } catch (error) {
      setSettingsStatus(error?.message || t("settingsCliInstallFailed"), "error");
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
  async function loadCanvasSettings() {
    if (!canvasSettingsForm) return;
    setSettingsStatus(t("settingsLoading"));
    try {
      const response = await fetch("/api/settings", { headers:authenticatedApiHeaders() }), body = await response.json();
      if (!response.ok) throw new Error(body?.error || t("settingsLoadFailed"));
      settings.connections = Array.isArray(body.connections) ? body.connections : [];
      syncLocalConnectionSelection();
      settings.connectionLimit = Number(body.connectionLimit) || 10;
      settingsProvider.value = body.provider;
      settings.currentProvider = body.provider;
      fillApiEditor({ apiPreset:body.apiPreset, apiFormat:body.apiFormat, apiUrl:body.apiUrl, apiModel:body.apiModel });
      settingsApiKey.value = "";
      settingsApiSaved.dataset.saved = String(body.hasApiKey);
      settings.cli = {
        "kimi-cli":{ model:body.kimiCliModel, path:body.kimiCliPath },
        "codex-cli":{ model:body.codexModel, path:body.codexPath },
        "claude-cli":{ model:body.claudeModel, path:body.claudePath },
      };
      settingsEffort.value = body.effort || defaultConnectionEffort(body.provider);
      settingsMaxTokens.value = String(body.maxTokens);
      settingsTimeout.value = String(body.timeoutSeconds);
      settingsAutoDelay.value = String(body.autoDelaySeconds);
      settingsImageFormat.value = body.imageFormat;
      settingsTraceLimit.value = String(body.requestTraceLimit);
      settings.requestTrace = body.requestTrace === true;
      updateTraceToggle();
      updateSettingsProviderFields();
      renderConnectionLists();
      setSettingsStatus();
    } catch (error) { setSettingsStatus(error?.message || t("settingsLoadFailed"), "error"); }
  }
  async function saveCanvasSettings(event) {
    event?.preventDefault();
    if (!canvasSettingsForm || !canvasSettingsForm.reportValidity()) return;
    setConnectionTestBusy(true);
    setSettingsStatus(t("settingsSaving"));
    try {
      const provider = settingsProvider.value, scope = settings.configurationMode, connectionPayload = connectionEditorPayload(), apiPreset = provider === "api" ? selectedApiPreset() : null;
      const endpoint = scope === "api" ? "/api/settings/connections" : "/api/settings", payload = scope === "api" ? { action:"save", id:settings.editingConnectionId, connection:connectionPayload } : {
        scope, provider, apiFormat:apiPreset?.format || settingsApiFormat.value, apiPreset:apiPreset ? `${apiPreset.family}-${apiPreset.region}-${apiPreset.service}` : "", apiUrl:settingsApiUrl.value, apiModel:settingsApiModel.value,
        apiKey:settingsApiKey.value, effort:settingsEffort.value, maxTokens:Number(settingsMaxTokens.value), timeoutSeconds:Number(settingsTimeout.value),
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
        settings.connections = body.connections || settings.connections;
        syncLocalConnectionSelection();
        renderConnectionLists();
        hideConnectionEditor();
        setConnectionStatus(t("settingsConnectionSaved"), "success");
      } else setSettingsStatus(t("settingsSystemSaved"), "success");
    } catch (error) { setSettingsStatus(error?.message || t("settingsLoadFailed"), "error"); }
    finally { setConnectionTestBusy(false); }
  }
  async function updateConnection(action, id) {
    setConnectionStatus(t("settingsSaving"));
    try {
      const response = await fetch("/api/settings/connections", { method:"POST", headers:authenticatedApiHeaders({ "Content-Type":"application/json" }), body:JSON.stringify({ action, id }) }), body = await response.json();
      if (!response.ok) throw new Error(body?.error || t("settingsLoadFailed"));
      settings.connections = body.connections || [];
      syncLocalConnectionSelection();
      renderConnectionLists();
      setConnectionStatus(t(action === "delete" ? "settingsConnectionDeleted" : "settingsConnectionActivated"), "success");
    } catch (error) { setConnectionStatus(error?.message || t("settingsLoadFailed"), "error"); }
  }
  function handleConnectionAction(event) {
    const button = event.target.closest("button[data-connection-activate],button[data-connection-edit],button[data-connection-delete]");
    if (!button) return;
    if (button.dataset.connectionActivate) {
      const id = button.dataset.connectionActivate,
        closeAfterActivation = settingsConnectionQuickList?.contains(button) === true;
      if (!settings.connections.some(connection => connection.id === id)) return;
      localStorage.setItem(AI_CONNECTION_STORAGE_KEY, id);
      syncLocalConnectionSelection();
      renderConnectionLists();
      setConnectionStatus(t("settingsConnectionActivated"), "success");
      if (closeAfterActivation) closeSettings();
      return;
    }
    const connection = settings.connections.find(item => item.id === button.dataset.connectionEdit || item.id === button.dataset.connectionDelete);
    if (!connection) return;
    if (button.dataset.connectionEdit) fillConnectionEditor(connection);
    else if (window.confirm(t("settingsDeleteConfirm"))) void updateConnection("delete", connection.id);
  }
  function updateSettingsPanel() {
    if (!settingsPanel) return;
    settingsAutoToggle.classList.toggle("on", state.auto);
    settingsAutoToggle.setAttribute("aria-checked", String(state.auto));
    summonToggle.classList.toggle("on", state.summonEnabled);
    summonToggle.setAttribute("aria-checked", String(state.summonEnabled));
    settingsWidgetShadowToggle.classList.toggle("on", state.widgetShadowEnabled);
    settingsWidgetShadowToggle.setAttribute("aria-checked", String(state.widgetShadowEnabled));
    void loadCanvasSettings();
  }
  function openSettings() {
    if (window.penechoDesktop?.openSettings) {
      void window.penechoDesktop.openSettings();
      return true;
    }
    if (settings.open || !settingsLayer) return false;
    hideAutoDelayControl();
    hideEffortControl();
    hidePluginControl();
    closeRadialMenu();
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
  function setWidgetShadowEnabled(enabled) {
    state.widgetShadowEnabled = Boolean(enabled);
    localStorage.setItem("penecho-widget-shadow", String(state.widgetShadowEnabled));
    view.classList.toggle("widget-shadows", state.widgetShadowEnabled);
    settingsWidgetShadowToggle.classList.toggle("on", state.widgetShadowEnabled);
    settingsWidgetShadowToggle.setAttribute("aria-checked", String(state.widgetShadowEnabled));
    requestRender();
  }
  function maybeStartOnboarding() {
    if (window.PENECHO_CONFIG?.runtime === "viewer") return false;
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
  function updateEffortControl() {
    if (!EFFORT_OPTIONS.includes(state.reasoningEffort)) state.reasoningEffort = "config";
    const control = document.querySelector("#effortControl"),
      button = document.querySelector("#aiEffortButton"),
      label = document.querySelector("#aiEffortLabel"),
      levelKey = { config:"effortConfigured", none:"effortNone", low:"effortLow", medium:"effortMedium", high:"effortHigh", max:"effortMaximum" }[state.reasoningEffort] || "effortConfigured",
      level = t({ config:"effortConfiguredShort", medium:"effortMediumShort" }[state.reasoningEffort] || levelKey),
      text = t("reasoningEffortDisplay").replace("{level}", level);
    label.textContent = text;
    button.setAttribute("aria-label", text);
    button.setAttribute("title", text);
    button.setAttribute("aria-expanded", String(!document.querySelector("#effortPopover").hidden));
    control.dataset.effort = state.reasoningEffort;
    document.querySelectorAll("#effortOptions .effort-option").forEach((option) => {
      const optionKey = { config:"effortConfigured", none:"effortNone", low:"effortLow", medium:"effortMedium", high:"effortHigh", max:"effortMaximum" }[option.dataset.effort] || "effortConfigured";
      option.querySelector("[data-effort-label]").textContent = t(optionKey);
      option.setAttribute("aria-selected", String(option.dataset.effort === state.reasoningEffort));
      option.classList.toggle("active", option.dataset.effort === state.reasoningEffort);
    });
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
    keepAutoDelayControlOpen();
  }
  function hideEffortControl() {
    clearTimeout(state.effortPopoverTimer);
    state.effortPopoverTimer = 0;
    document.querySelector("#effortPopover").hidden = true;
    document.querySelector("#aiEffortButton").setAttribute("aria-expanded", "false");
  }
  function keepEffortControlOpen() {
    clearTimeout(state.effortPopoverTimer);
    state.effortPopoverTimer = setTimeout(hideEffortControl, 5000);
  }
  function showEffortControl() {
    document.querySelector("#effortPopover").hidden = false;
    document.querySelector("#aiEffortButton").setAttribute("aria-expanded", "true");
    updateEffortControl();
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
  async function loadPluginDocuments() {
    if (state.pluginCatalogLoading) return false;
    state.pluginCatalogLoading = true;
    state.pluginCatalogError = "";
    updatePluginControl();
    updatePluginAuthoringUi();
    try {
      const response = await fetch("/api/plugins", { credentials:"same-origin", cache:"no-store" });
      if (!response.ok) throw Error(`HTTP ${response.status}`);
      const catalog = await response.json(), entries = (Array.isArray(catalog?.plugins) ? catalog.plugins : [])
        .map((entry) => ({
          path:validPluginCatalogPath(entry?.path, "md"),
          stylePath:entry?.stylePath ? validPluginCatalogPath(entry.stylePath, "css") : null,
          builtIn:entry?.builtIn !== false,
          error:typeof entry?.error === "string" ? entry.error : "",
        }))
        .filter((entry) => entry.path), uniqueEntries = [...new Map(entries.map((entry) => [entry.path, entry])).values()];
      const loaded = await Promise.all(uniqueEntries.map(async ({ path:documentPath, stylePath, builtIn, error:catalogError }) => {
        if (catalogError) return { documentPath, error:catalogError };
        try {
          const [documentResponse, styleResponse] = await Promise.all([
            fetch(canvasAssetUrl(documentPath), { credentials:"same-origin", cache:"no-store" }),
            stylePath ? fetch(canvasAssetUrl(stylePath), { credentials:"same-origin", cache:"no-store" }) : null,
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
      return true;
    } catch (error) {
      state.pluginCatalogError = error.message;
      return false;
    } finally {
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
    const anyEnabled = PLUGIN_DEFINITIONS.some((plugin) => pluginEnabled(plugin.id));
    pluginButton.classList.toggle("active", anyEnabled);
    pluginButton.setAttribute("aria-pressed", String(anyEnabled));
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
  let canvasHintResizeScheduled = false;
  window.addEventListener("resize", () => {
    if (canvasHintResizeScheduled) return;
    canvasHintResizeScheduled = true;
    requestAnimationFrame(() => { canvasHintResizeScheduled = false; fitCanvasHint(); });
  });
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
    pluginPopover.hidden = true;
    pluginPopover.setAttribute("aria-hidden", "true");
    document.body.classList.remove("plugin-open");
    if (!featureTour.active) tourMain.inert = false;
    pluginButton.setAttribute("aria-expanded", "false");
    const restore = state.pluginDialogRestoreFocus;
    state.pluginDialogRestoreFocus = null;
    if (restore?.isConnected) restore.focus({ preventScroll:true });
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
    return true;
  }
  function setEffort(value) {
    state.reasoningEffort = EFFORT_OPTIONS.includes(value) ? value : "config";
    localStorage.setItem("penecho-ai-effort", state.reasoningEffort);
    updateEffortControl();
    hideEffortControl();
  }
  function setAutoEnabled(enabled, showDelay = false) {
    state.auto = enabled;
    clearTimeout(state.timer);
    state.timer = 0;
    localStorage.setItem("penecho-auto-ai", String(enabled));
    updateAutoControl();
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
    };
  }
  function applyLanguage() {
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
    updateThemeCopy();
    updateEmbodimentLabel();
    updateGridButton();
    updateHistorySaveFeedbackLanguage();
    renderSnapshotList();
    renderConnectionLists();
    updateNewCanvasDialog();
    renderCanvasHint(false);
    if (state.aiProgressEvent) setStatus(aiProgressText(state.aiProgressEvent),AI_PROGRESS_STATUS_KEYS[state.aiProgressEvent.phase]);
    else if (state.statusKey) setStatusKey(state.statusKey);
    updateSelectionToolbar();
    updateFeatureTourLanguage();
    summonFX?.refreshText();
    positionAnimationControls();
    requestInteractionLayerRender();
    window.dispatchEvent(new CustomEvent("penecho:languagechange", { detail:{ language:state.language } }));
  }
  function updateThemeCopy() {
    const focus = t({ arcane: "themeFocusArcane", scifi: "themeFocusScifi", research: "themeFocusResearch", studio: "themeFocusStudio" }[state.theme]);
    document.querySelector("#theme").setAttribute("title", focus);
    document.querySelector("#theme").setAttribute("aria-description", focus);
  }
  function updateEmbodimentLabel() {
    const label = t({ arcane: "guideArcane", scifi: "guideScifi", research: "guideResearch", studio: "guideStudio" }[state.theme]);
    embodiment.setAttribute("aria-label", label);
    const orbLabel = state.busy ? t("stopAIRequest") : t("openAIMenu");
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
    theme = normalizeTheme(theme);
    state.theme = theme;
    document.body.dataset.theme = theme;
    embodiment.dataset.theme = theme;
    document.querySelector("#theme").value = theme;
    localStorage.setItem("penecho-theme", theme);
    if (theme === "research") state.gridVisible = localStorage.getItem("penecho-research-grid") === "true";
    else state.gridVisible = (localStorage.getItem("penecho-grid") ?? localStorage.getItem("ghostboard-grid")) !== "false";
    updateThemeCopy();
    updateEmbodimentLabel();
    updateGridButton();
    updatePaint();
    requestRender();
  }
  function setBusy(value) {
    state.busy = Boolean(value);
    embodiment.classList.toggle("working", state.busy);
    embodiment.setAttribute("aria-busy", String(state.busy));
    aiOrb.setAttribute("aria-haspopup", state.busy ? "false" : "menu");
    if (state.busy) {
      state.radialGesture = null;
      closeRadialMenu();
      revealAIOrb();
      showSummon();
    } else {
      hideSummon();
      scheduleAIOrbIdle();
    }
    updateEmbodimentLabel();
  }
  function setNavigating(value) {
    clearTimeout(state.navigationTimer);
    if (value) view.classList.add("is-navigating");
    if (!view.classList.contains("is-navigating")) return;
    state.navigationTimer = setTimeout(() => {
      state.navigationTimer = 0;
      view.classList.remove("is-navigating");
    }, NAVIGATION_HINT_VISIBLE_MS);
  }
  function wheelNavigating() {
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
    if (state.busy || embodiment.classList.contains("menu-open")) return;
    state.aiOrbIdleTimer = setTimeout(() => {
      state.aiOrbIdleTimer = 0;
      if (!state.busy && !state.radialGesture && !embodiment.classList.contains("menu-open")) embodiment.classList.add("idle-dim");
    }, AI_ORB_IDLE_DELAY_MS);
  }
  function openRadialMenu() {
    if (state.busy) return;
    revealAIOrb();
    clearTimeout(state.radialCloseTimer);
    embodiment.classList.add("menu-open");
    aiOrb.setAttribute("aria-expanded", "true");
    aiRadial.setAttribute("aria-hidden", "false");
    document.querySelectorAll(".radial-action").forEach((button) => button.setAttribute("tabindex", "0"));
  }
  function closeRadialMenu() {
    if (state.radialGesture) return;
    embodiment.classList.remove("menu-open");
    aiOrb.setAttribute("aria-expanded", "false");
    aiRadial.setAttribute("aria-hidden", "true");
    document.querySelectorAll(".radial-action").forEach((button) => {
      button.classList.remove("is-highlighted");
      button.setAttribute("tabindex", "-1");
    });
    if (!state.busy) scheduleAIOrbIdle();
  }
  function chooseRadialAction(clientX, clientY) {
    const orbRect = aiOrb.getBoundingClientRect(),
      origin = { x: orbRect.left + orbRect.width / 2, y: orbRect.top + orbRect.height / 2 },
      pointerDistance = Math.hypot(clientX - origin.x, clientY - origin.y);
    let selected = null,
      angleDistance = Infinity;
    if (pointerDistance < 22) {
      document.querySelectorAll(".radial-action").forEach((button) => button.classList.remove("is-highlighted"));
      return null;
    }
    const pointerAngle = Math.atan2(clientY - origin.y, clientX - origin.x);
    document.querySelectorAll(".radial-action").forEach((button) => {
      const r = button.getBoundingClientRect(),
        buttonAngle = Math.atan2(r.top + r.height / 2 - origin.y, r.left + r.width / 2 - origin.x),
        next = Math.abs(Math.atan2(Math.sin(pointerAngle - buttonAngle), Math.cos(pointerAngle - buttonAngle)));
      if (next < angleDistance) {
        angleDistance = next;
        selected = button;
      }
    });
    if (angleDistance > 0.42) selected = null;
    document.querySelectorAll(".radial-action").forEach((button) => button.classList.toggle("is-highlighted", button === selected));
    return selected;
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
