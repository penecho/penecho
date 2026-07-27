"use strict";
(() => {
  const SIZE = 20000,
    TILE = 512,
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
    ctx = screen.getContext("2d"),
    animationLayer = document.querySelector("#animationLayer"),
    animationCtx = animationLayer.getContext("2d"),
    widgetLayer = document.querySelector("#widgetLayer"),
    interactionLayer = document.querySelector("#interactionLayer"),
    interactionCtx = interactionLayer.getContext("2d"),
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
    pluginDocumentStatus = document.querySelector("#pluginDocumentStatus"),
    pluginImprove = document.querySelector("#pluginImprove"),
    pluginSave = document.querySelector("#pluginSave"),
    status = document.querySelector("#status"),
    coords = document.querySelector("#coords"),
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
    imagePickerInput = document.querySelector("#imagePickerInput"),
    imageEditBar = document.querySelector("#imageEditBar"),
    imagePlaceButton = document.querySelector("#imagePlaceBtn"),
    imageMergeButton = document.querySelector("#imageMergeBtn"),
    imageDeleteButton = document.querySelector("#imageDeleteBtn"),
    textEditorLayer = document.querySelector("#textEditorLayer"),
    textInputHint = document.querySelector("#textInputHint"),
    tourMain = document.querySelector("main"),
    tourReplayButton = document.querySelector("#tourReplayBtn"),
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
    changelogDoneButton = document.querySelector("#changelogDone");
  const ZH = window.PENECHO_LOCALES?.zh || {};
  const DRAW = window.PENECHO_DRAW;
  const SELECT = window.PENECHO_SELECTION;
  const TOUR = window.PENECHO_TOUR;
  const MIXED_TEXT = window.PENECHO_MIXED_TEXT;
  const ANIMATION = window.PENECHO_ANIMATION;
  const PLUGINS = window.PENECHO_PLUGINS;
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
    MIXED_FORMULA_MAX_LENGTH = 512,
    AI_TEXT_MAX_LENGTH = 1000,
    COPY_FEEDBACK_MS = 1600,
    NAVIGATION_HINT_VISIBLE_MS = 10000,
    ANIMATION_CONTROLS_VISIBLE_MS = 10000,
    ANIMATION_TOUCH_HOLD_MS = 1000,
    ANIMATION_TOUCH_HOLD_MOVE_PX = 10,
    IMAGE_TOUCH_HOLD_MS = 500,
    IMAGE_TOUCH_HOLD_MOVE_PX = 8;
  const MAX_SHARP_OVERLAY_PIXELS = 8000000,
    MAX_SHARP_OVERLAY_ITEM_PIXELS = 2500000,
    MAX_VISIBLE_ANIMATIONS = 20,
    MAX_VISIBLE_WIDGETS = 20,
    MAX_VISIBLE_IMAGES = 20,
    MAX_IMAGE_SOURCE_BYTES = 32 * 1024 * 1024,
    MAX_IMAGE_DIMENSION = 2048,
    MAX_IMAGE_PIXELS = 16 * 1024 * 1024,
    MAX_WIDGET_HTML_LENGTH = 40000,
    MAX_WIDGET_COPY_TEXT_LENGTH = 16000,
    MAX_WIDGET_CONTENT_DIMENSION = 1000000,
    WIDGET_SNAPSHOT_TIMEOUT_MS = 12000;
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
  const I18N = {
    en: {
      title: "PenEcho | Handwritten AI Canvas",
      tagline: "Write across twenty thousand squares and summon knowledge",
      taglineArcane: "Interdisciplinary intuition, creative synthesis, and exploratory explanation",
      taglineScifi: "Engineering, programming, system design, and future-technology analysis",
      taglineResearch: "Mathematical physics, rigorous teaching, and verifiable code",
      taglineStudio: "A clean, focused studio for clear structure and practical answers",
      language: "Language",
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
      imageLoading: "Preparing image...",
      imageAdded: "Image added",
      imageSelected: "Editing image: drag to move, handles to resize — use the side buttons to place, merge, or delete",
      imageMerged: "Merged into canvas ink — the eraser now works on it",
      imageEditBarLabel: "Image actions",
      imagePlace: "Place image",
      imagePlaceHint: "Keep it as an image; long-press to edit again",
      imageMerge: "Merge into ink",
      imageMergeHint: "Fuse into the canvas; the eraser then works on it",
      imageDelete: "Delete image",
      imageDeleteHint: "Remove this image from the canvas",
      imageDeleted: "Image deleted",
      imageLimitReached: "Image limit reached (20). Delete an image before adding another.",
      imageTooLarge: "The selected image is too large (32 MB maximum)",
      imageUnsupported: "This image format could not be opened",
      imageImportFailed: "The image could not be added",
      textHelpTitle: "Markdown + LaTeX",
      textHelpClose: "Close text help",
      textHelpIntro: "Type normally; line breaks are preserved. Markdown and likely LaTeX are formatted automatically when confirmed; Preview shows the result.",
      textHelpMarkdown: "Use # for headings, - for lists, **text** for bold, and *text* for italic.",
      textHelpMath: "You may use $...$, but common bare TeX such as \\pi, \\frac{a}{b}, A_x, and \\sin(x) is recognized too.",
      textHelpConfirm: "Press Ctrl/Cmd + Enter to confirm.",
      textHelpExampleTitle: "Example",
      textHelpExample: "# Kinematics\n**Speed:** $v=\\frac{d}{t}$\n- Area: $A=\\pi r^2$",
      textHelpDone: "Got it",
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
      tourPluginsTitle: "Real photos and flowcharts",
      tourPluginsBody: "Real Photos is on by default and usually shows one web photo. Flowchart is off by default and creates diagrams with copyable Mermaid source. Manage both in Plugins.",
      tourHandTitle: "Move objects with the Hand tool",
      tourHandBody: "Choose Hand, then drag anything outlined by a thin blue dashed box: images, animations, and HTML widgets returned by AI. Content merged into canvas ink has no outline; use the lasso to move it. Drag empty space to pan the canvas.",
      tourStudioThemeTitle: "Try the new Studio theme",
      tourStudioThemeBody: "Open Theme to switch the canvas's visual style and the AI's response emphasis. The new Studio theme uses a clean, focused interface and favors concise, well-structured, practical answers. You can switch themes at any time.",
      tourLassoTitle: "Work with exactly the content you select",
      tourLassoBody: "With a mouse or stylus, draw a closed loop around handwriting. Drag the selected region to move it; use the right edge, bottom edge, or lower-right corner to resize it. The selection toolbar can typeset handwriting, delete it, or cancel. Selection-scoped AI requests do not reference the rest of the canvas.",
      tourTextTitle: "Add editable text and formulas",
      tourTextBody: "Choose Text, then click the canvas to create an input box. Markdown and likely LaTeX are formatted automatically; Preview shows the exact placement before confirmation. Confirm with the check button or Ctrl/Cmd + Enter.",
      tourImageTitle: "Add images and photos",
      tourImageBody: "Add a picture from your device—photo library or camera on phones and tablets, image files on desktop; large pictures are compressed automatically. Long-press an image to move or resize it again. Place keeps it floating under your ink so you can draw over it, and Merge turns it into erasable strokes. Simply adding an image never triggers an AI request.",
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
      changelogTitle: "Real photos, flowcharts, and smoother canvas work",
      changelogIntro: "Version 0.7.2 adds built-in visual tools, more reliable canvas persistence, and simpler local access.",
      changelogVisualPlugins: "Use built-in Real Photo Search for sourced web images and Flowchart for professional diagrams with copyable Mermaid source.",
      changelogCanvasWorkflow: "Move AI widgets directly with Hand, resize images and widgets freely, and preserve remote images when saving, loading, or exporting the canvas.",
      changelogDesktopAccess: "Protect local and LAN access with a six-digit code, connect through Kimi API or Kimi CLI, and use improved desktop updates and packaging.",
      changelogEarlierTitle: "Earlier highlights",
      changelogImagesSummary: "0.7.1 added local images and photos with canvas-native editing, snapshots, and PNG export.",
      changelogPluginsSummary: "0.7.0 introduced the plugin system: sandboxed HTML widgets and focused data plugins for richer live and interactive work.",
      changelogAnimation: "0.6.0 introduced controllable, persistent animation scenes with a safe declarative Canvas2D renderer.",
      changelogDone: "Got it",
      debugTitle: "PenEcho debug",
      openLocalLog: "Open local server log",
      history: "Local history",
      historyTitle: "Local canvas history",
      historyDescription: "Stores confirmed canvas content, including restorable animation scenes. Unconfirmed AI drafts are excluded.",
      closeHistory: "Close history",
      newCanvas: "New",
      saveCanvas: "Save canvas",
      saveCurrentSnapshot: "Save",
      exportPng: "Export PNG",
      newCanvasTitle: "Start a new canvas?",
      newCanvasDescription: "Save confirmed content and animation scenes before starting over. Unconfirmed AI drafts are not included.",
      currentSnapshot: "Current snapshot: {name}",
      noCurrentSnapshot: "There is no current snapshot to overwrite.",
      newSnapshotName: "Name for new snapshot (optional)",
      cancel: "Cancel",
      newWithoutSave: "Don't save",
      saveAsNewAndCreate: "Save as new",
      overwriteAndCreate: "Overwrite current",
      snapshotName: "Snapshot name (optional)",
      saveSnapshot: "Save New",
      snapshotSaving: "Saving canvas...",
      snapshotSavingShort: "Saving...",
      loadSnapshot: "Load",
      deleteSnapshot: "Delete",
      emptyHistory: "No local snapshots yet",
      emptyCanvas: "The canvas is empty",
      snapshotSaved: "Canvas snapshot saved",
      snapshotOverwritten: "Current snapshot overwritten",
      snapshotLoaded: "Canvas snapshot loaded",
      snapshotDeleted: "Canvas snapshot deleted",
      newCanvasReady: "New canvas ready",
      exportComplete: "PNG exported",
      exportError: "Export: ",
      snapshotError: "Local history: ",
      snapshotTiles: "canvas tiles",
      snapshotImages: "images",
      deleteSnapshotConfirm: "Delete this local snapshot?",
      footerTip: "AI drafts: move the whole group or adjust, accept, and discard items independently",
      ready: "Ready",
      aiBusy: "AI is working. Please wait.",
      noInk: "Write something first",
      cannotCapture: "Could not capture the newest handwriting",
      observing: "Observing...",
      deferred: "New ink found; this AI result was deferred",
      writing: "Writing...",
      aiDone: "AI complete",
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
      serverPluginsComingDescription: "Published plugins, free or points-priced downloads, server selection, trust details, and updates will appear here after the PenEcho website launches.",
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
      pluginPromptEstimate: "adds about {tokens} prompt tokens to each AI request while enabled; once on canvas, display, interaction, refresh, and rendering use no tokens",
      pluginRefreshRate: "refresh {time}",
      pluginDetails: "Details",
      pluginDetailsFor: "{name} plugin details",
      copyPluginMarkdown: "Copy Markdown",
      pluginMarkdownCopied: "Copied",
      pluginMarkdownCopyFailed: "Copy failed",
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
      sharePluginComing: "Share for points · Coming soon",
      pluginTemplateLabel: "Template",
      pluginSimpleTemplate: "Simple HTML",
      pluginTitleLabel: "Plugin title",
      pluginTitlePlaceholder: "Filled automatically by Improve with AI, or enter your own",
      pluginDocumentLabel: "Plugin Markdown",
      pluginDocumentHint: "Prefer Improve with AI before saving. The final document needs frontmatter, an exact One-shot example, and no more than 3000 UTF-8 bytes.",
      improvePluginWithAi: "Improve with AI",
      saveAndEnablePlugin: "Save and enable",
      pluginMarketplaceNote: "The future marketplace will support free or points-priced downloads. Authors will be able to share plugins and earn points.",
      pluginBytes: "{bytes} / 3000 bytes",
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
      animationSelected: "Editing animation; drag to move, resize with edge or corner handles, then confirm or cancel",
      animationDeleted: "Animation deleted",
      animationLimitReached: "Animation limit reached (20). Delete an animation before adding another.",
      snapshotAnimations: "animations",
      widgetAccept: "Keep widget",
      widgetDiscard: "Discard widget",
      widgetMove: "Move widget",
      widgetDelete: "Delete widget",
      widgetDeleted: "Widget deleted",
      widgetSourceCopied: "Widget source copied",
      widgetSourceCopyFailed: "Widget source could not be copied",
      widgetExportFailed: "A live widget could not be captured. Wait for it to finish loading and try again.",
      widgetPluginUnavailable: "The plugin document could not be loaded",
      widgetLimitReached: "Live widget limit reached (20). Delete a widget before adding another.",
      snapshotWidgets: "live widgets",
      clearConfirm: "Clear the whole canvas?",
      timeout: "Request timed out",
      aiNoVisibleResponse: "AI returned no displayable content. Please retry or rephrase the request.",
      aiError: "AI: ",
    },
    zh: ZH,
  };
  const PLUGIN_STORAGE_KEY = "penecho-plugins",
    BUILTIN_PLUGIN_DEFINITIONS = Object.freeze([
      Object.freeze({
        id: "animation",
        labelKey: "animationPlugin",
        costKey: "animationPluginCost",
        helpKey: "animationPluginDisabledHelp",
        requestField: "animationEnabled",
        builtIn: true,
        defaultEnabled: true,
        legacyStorageKey: "penecho-animation-plugin",
        onChange: applyAnimationPluginState,
      }),
    ]);
  const PLUGIN_DEFINITIONS = [...BUILTIN_PLUGIN_DEFINITIONS];
  const pluginManifests = new Map(),
    pluginLoadErrors = new Map(),
    widgetSnapshotRequests = new Map(),
    widgetHostPointerAnchors = new Map(),
    screenCalibration = new Map();
  let screenClientRatio = 1;
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
    storedAiEffortText = String(localStorage.getItem("penecho-ai-effort") || "").trim().toLowerCase(),
    storedAiEffort = storedAiEffortText === "xhigh" ? "max" : storedAiEffortText,
    storedAutoDelay = storedAutoDelayText === null ? NaN : Number(storedAutoDelayText),
    initialLanguage = TOUR.resolveInitialLanguage(storedPrimaryLanguage, storedLegacyLanguage),
    initialTheme = ["arcane", "scifi", "research", "studio"].includes(storedTheme) ? storedTheme : "studio",
    initialGrid = storedGrid === null ? true : storedGrid === "true",
    initialResearchGrid = storedResearchGrid === "true",
    configuredAutoDelay = Number(window.PENECHO_CONFIG?.autoAiDelayMs),
    configuredAiTimeout = Number(window.PENECHO_CONFIG?.aiRequestTimeoutMs),
    configuredAiEffort = String(window.PENECHO_CONFIG?.aiEffort || "").trim().toLowerCase(),
    configuredAccessSession = String(window.PENECHO_CONFIG?.accessSessionToken || sessionStorage.getItem("penecho-access-session") || ""),
    serverAutoDelay = Number.isFinite(configuredAutoDelay) && configuredAutoDelay >= 0 ? configuredAutoDelay : DEFAULT_AUTO_DELAY,
    initialAutoDelay = Number.isFinite(storedAutoDelay) && storedAutoDelay >= 0 && storedAutoDelay <= 10000 ? storedAutoDelay : Math.min(10000, serverAutoDelay),
    initialAutoEnabled = storedAutoEnabled === null ? true : storedAutoEnabled === "true",
    initialAiEffort = EFFORT_OPTIONS.includes(storedAiEffort) ? storedAiEffort : EFFORT_OPTIONS.includes(configuredAiEffort) ? configuredAiEffort : "config",
    initialAiTimeout = Number.isFinite(configuredAiTimeout) && configuredAiTimeout >= 10000 ? configuredAiTimeout : DEFAULT_AI_TIMEOUT;
  function authenticatedApiHeaders(headers = {}) {
    return configuredAccessSession ? { ...headers, "X-PenEcho-Session":configuredAccessSession } : { ...headers };
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
      textEditors: new Map(),
      textEditorStyleSheet: null,
      nextTextEditorId: 1,
      nextTextEditorZ: 1,
      activeTextEditorId: null,
      animations: [],
      nextAnimationId: 1,
      selectedAnimationId: null,
      animationGesture: null,
      animationTouchHold: null,
      animationEdit: null,
      widgets: [],
      nextWidgetId: 1,
      pendingWidget: null,
      selectedWidgetId: null,
      widgetEdit: null,
      widgetGesture: null,
      widgetHistoryBefore: null,
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
      imageTouchHold: null,
      imageHistoryBefore: null,
      imageImporting: false,
      textInputBlockedUntil: 0,
      textTap: null,
      latestTypedInput: null,
      pending: null,
      pendingGesture: null,
      copyGeneration: 0,
      selection: null,
      selectionGesture: null,
      hotspotTrail: [],
      auto: initialAutoEnabled,
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
      autoEligible: false,
      lastUserBox: null,
      history: [],
      future: [],
      historyBefore: new Map(),
      inkBounds: new Map(),
      busy: false,
      activeAI: null,
      snapshotLoadGeneration: 0,
      currentSnapshotId: null,
      currentSnapshotName: "",
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
      radialGesture: null,
      radialCloseTimer: 0,
      radialSuppressClickUntil: 0,
      statusKey: "ready",
    };
  let textHelpInvoker = null;
  const AI_CANCELLED = "AI_CANCELLED";
  const AI_REJECTED = "AI_REJECTED";
  const AI_SUPERSEDED = "AI_SUPERSEDED";
  const FEATURE_TOUR_STORAGE_KEY = "penecho-tour-progress";
  const CHANGELOG_STORAGE_KEY = "penecho-changelog-seen";
  const CHANGELOG_VERSION = "0.7.2";
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
  const setStatus = (text, key = null) => {
    status.textContent = text;
    state.statusKey = key;
  };
  const setStatusKey = (key) => setStatus(t(key), key);
  const t = (key) => I18N[state.language][key] || I18N.zh[key] || key;
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
  function observeActiveFeatureTour() {
    stopActiveFeatureTourObserver();
    if (typeof MutationObserver !== "function") return false;
    featureTour.activeObserver = new MutationObserver((records) => {
      if (featureTour.active && records.some((record) => !tourLayer.contains(record.target))) scheduleFeatureTourPosition();
    });
    featureTour.activeObserver.observe(document.body, {
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
      Reflect.get(tourHighlight, "style").setProperty("visibility", "hidden");
      Reflect.get(tourCard, "style").setProperty("visibility", "hidden");
      showFeatureTourStep(featureTour.index + 1, 1);
      return;
    }
    featureTour.targets = elements;
    const viewport = featureTourViewport(),
      layerStyle = Reflect.get(tourLayer, "style"),
      padding = step.padding ?? 7,
      viewportRight = viewport.left + viewport.width,
      viewportBottom = viewport.top + viewport.height,
      left = Math.max(viewport.left + 2, target.left - padding),
      top = Math.max(viewport.top + 2, target.top - padding),
      right = Math.min(viewportRight - 2, target.right + padding),
      bottom = Math.min(viewportBottom - 2, target.bottom + padding);
    layerStyle.setProperty("--tour-viewport-width", `${Math.max(1, Math.floor(viewport.width))}px`);
    layerStyle.setProperty("--tour-viewport-height", `${Math.max(1, Math.floor(viewport.height))}px`);
    tourCard.classList.toggle("tour-compact", viewport.width < 300);
    const highlightStyle = Reflect.get(tourHighlight, "style"),
      cardStyle = Reflect.get(tourCard, "style");
    highlightStyle.setProperty("left", `${Math.round(left)}px`);
    highlightStyle.setProperty("top", `${Math.round(top)}px`);
    highlightStyle.setProperty("width", `${Math.max(2, Math.round(right - left))}px`);
    highlightStyle.setProperty("height", `${Math.max(2, Math.round(bottom - top))}px`);
    highlightStyle.setProperty("border-radius", `${step.radius ?? 10}px`);
    const cardRect = tourCard.getBoundingClientRect(),
      coachmarkMargin = viewport.width <= 620 ? 8 : 12,
      position = TOUR.placeCoachmark(target, { width: cardRect.width, height: cardRect.height }, viewport, step.placement, { margin: coachmarkMargin, gap: 15, arrowMargin: 23 });
    cardStyle.setProperty("left", `${Math.round(position.x)}px`);
    cardStyle.setProperty("top", `${Math.round(position.y)}px`);
    cardStyle.setProperty("--tour-arrow-offset", `${Math.round(position.arrowOffset)}px`);
    tourCard.dataset.placement = position.placement;
    highlightStyle.setProperty("visibility", "visible");
    cardStyle.setProperty("visibility", "visible");
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
    Reflect.get(tourProgressBar, "style").setProperty("width", `${(current / total) * 100}%`);
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
    Reflect.get(tourCard, "style").setProperty("visibility", "hidden");
    Reflect.get(tourHighlight, "style").setProperty("visibility", "hidden");
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
    Reflect.get(tourHighlight, "style").setProperty("visibility", "hidden");
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
    Reflect.get(tourHighlight, "style").setProperty("visibility", "hidden");
    Reflect.get(tourCard, "style").setProperty("visibility", "hidden");
    if (restoreScroll) window.scrollTo({ left: featureTour.restoreScrollX, top: featureTour.restoreScrollY, behavior: "auto" });
    requestAnimationFrame(() => {
      if (featureTour.active) return;
      if (options.changelog !== false && maybeShowChangelog()) return;
      if (restore) {
        const target = restoreFocus?.isConnected && restoreFocus !== document.body ? restoreFocus : tourReplayButton;
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
    if (featureTour.pendingObserver || typeof MutationObserver !== "function") return false;
    featureTour.pendingObserver = new MutationObserver((records) => {
      if (!featureTour.active && records.some((record) => !tourLayer.contains(record.target))) scheduleFeatureTourPendingRetry();
    });
    featureTour.pendingObserver.observe(document.body, {
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
  function maybeShowChangelog() {
    if (!changelogLayer || !changelogDialog || changelog.active || featureTour.active || !pluginPopover.hidden || changelogSeen()) return false;
    hideAutoDelayControl();
    hideEffortControl();
    hidePluginControl();
    closeRadialMenu();
    const active = document.activeElement;
    changelog.restoreFocus = active?.isConnected && active !== document.body && !tourLayer.contains(active) ? active : tourReplayButton;
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
    const focusable = [changelogCloseButton, changelogDoneButton].filter((button) => button && !button.disabled && !button.hidden),
      current = focusable.indexOf(document.activeElement),
      next = event.shiftKey ? (current <= 0 ? focusable.length - 1 : current - 1) : current < 0 || current === focusable.length - 1 ? 0 : current + 1;
    event.preventDefault();
    event.stopPropagation();
    focusable[next]?.focus();
    return true;
  }
  function maybeStartOnboarding() {
    if (!maybeStartFeatureTour()) maybeShowChangelog();
  }
  function autoDelayText() {
    const seconds = state.autoDelayMs / 1000;
    return Number.isInteger(seconds) ? String(seconds) : String(Number(seconds.toFixed(1)));
  }
  function updateAutoControl() {
    const button = document.querySelector("#auto"),
      range = document.querySelector("#autoDelayRange"),
      value = document.querySelector("#autoDelayValue");
    button.classList.toggle("active", state.auto);
    button.setAttribute("aria-pressed", String(state.auto));
    document.querySelector("#autoLabel").textContent = state.auto ? t("autoEnabled").replace("{delay}", autoDelayText()) : t("autoDisabled");
    range.value = String(state.autoDelayMs / 1000);
    value.textContent = `${autoDelayText()} s`;
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
    return state.plugins[pluginId] === true;
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
  function validPluginCatalogPath(value) {
    return typeof value === "string" && /^plugins\/(?:private\/)?[a-z0-9][a-z0-9-]{0,63}\.md$/.test(value) ? value : null;
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
        .map((entry) => ({ path:validPluginCatalogPath(entry?.path), builtIn:entry?.builtIn !== false }))
        .filter((entry) => entry.path), uniqueEntries = [...new Map(entries.map((entry) => [entry.path, entry])).values()];
      const loaded = await Promise.all(uniqueEntries.map(async ({ path:documentPath, builtIn }) => {
        try {
          const documentResponse = await fetch(documentPath, { credentials:"same-origin", cache:"no-store" });
          if (!documentResponse.ok) throw Error(`HTTP ${documentResponse.status}`);
          const manifest = PLUGINS?.parse(await documentResponse.text());
          if (!manifest) throw Error("Plugin parser is unavailable");
          return { documentPath, manifest, builtIn };
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
          builtIn:item.builtIn,
          defaultEnabled:["general", "image-search", "weather"].includes(item.manifest.id),
        }));
      }
      definitions.sort((a, b) => (manifests.get(a.id)?.name || a.id).localeCompare(manifests.get(b.id)?.name || b.id));
      const generalDefinitions = definitions.filter((definition) => definition.id === "general"),
        promotedDefinitions = ["image-search", "weather"].map((id) => definitions.find((definition) => definition.id === id)).filter(Boolean),
        fixedDefinitionIds = new Set(["general", ...promotedDefinitions.map((definition) => definition.id)]),
        remainingDefinitions = definitions.filter((definition) => !fixedDefinitionIds.has(definition.id)),
        previousIds = new Set(dataPluginDefinitions().map((plugin) => plugin.id)), nextIds = new Set(definitions.map((plugin) => plugin.id));
      for (const widget of [...state.widgets, ...(state.pendingWidget ? [state.pendingWidget] : [])]) unmountWidget(widget);
      PLUGIN_DEFINITIONS.splice(0, PLUGIN_DEFINITIONS.length, ...generalDefinitions, ...BUILTIN_PLUGIN_DEFINITIONS, ...promotedDefinitions, ...remainingDefinitions);
      pluginManifests.clear();
      for (const [id, manifest] of manifests) pluginManifests.set(id, manifest);
      pluginLoadErrors.clear();
      for (const [path, error] of errors) pluginLoadErrors.set(path, error);
      const stored = storedPluginSettings();
      for (const definition of definitions) if (typeof state.plugins[definition.id] !== "boolean") state.plugins[definition.id] = stored[definition.id];
      for (const id of previousIds) if (!nextIds.has(id)) state.plugins[id] = false;
      if (state.pendingWidget && !pluginManifests.has(state.pendingWidget.pluginId)) rejectPendingWidget();
      if (state.widgetEdit && !pluginManifests.has(selectedWidget()?.pluginId)) acceptWidgetEdit();
      for (const widget of state.widgets) if (pluginEnabled(widget.pluginId)) mountWidget(widget);
      if (state.pendingWidget && pluginEnabled(state.pendingWidget.pluginId)) mountWidget(state.pendingWidget);
      state.pluginCatalogLoaded = true;
      syncWidgetRuntime();
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
        input.disabled = Boolean(plugin.documentPath && !pluginManifests.has(plugin.id));
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
          apiItem.textContent = t("pluginApiLabel").replace("{origins}", manifest.connect.length ? manifest.connect.join(" · ") : t("pluginNoNetwork"));
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
      bytes = new TextEncoder().encode(document).length;
    try {
      if (!PLUGINS?.parse) throw Error("Plugin parser is unavailable");
      const manifest = PLUGINS.parse(document);
      if (PLUGIN_DEFINITIONS.some((plugin) => plugin.id === manifest.id && plugin.builtIn !== false) || ["animation", "general"].includes(manifest.id)) throw Error(t("pluginIdReserved").replace("{id}", manifest.id));
      if (pluginManifests.has(manifest.id)) throw Error(t("pluginIdExists").replace("{id}", manifest.id));
      return { bytes, manifest, document, error:"" };
    } catch (error) {
      return { bytes, manifest:null, error:error.message || String(error) };
    }
  }
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
    pluginDocumentBytes.classList.toggle("invalid", validation.bytes > 3000);
    pluginDocumentStatus.textContent = pluginAuthoringText(status);
    pluginDocumentStatus.className = status.type || "";
    pluginTitle.disabled = state.pluginAuthoringBusy;
    pluginDocumentEditor.disabled = state.pluginAuthoringBusy;
    pluginImprove.disabled = state.pluginAuthoringBusy || !pluginDocumentEditor.value.trim() || validation.bytes > 12000;
    pluginSave.disabled = state.pluginAuthoringBusy || state.pluginCatalogLoading || !validation.manifest;
    for (const tab of [pluginLocalTab, pluginCreateTab, pluginServerTab]) tab.disabled = state.pluginAuthoringBusy;
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
    syncPluginTitleFromDocument(pluginDocumentEditor.value);
    updatePluginAuthoringUi();
    return true;
  }
  async function pluginJsonResponse(response) {
    let body = null;
    try { body = await response.json(); } catch {}
    if (!response.ok) throw Error(body?.error || `HTTP ${response.status}`);
    return body;
  }
  async function improvePluginDraft() {
    if (state.pluginAuthoringBusy) return false;
    const document = pluginDocumentWithTitle(pluginDocumentEditor.value);
    if (!document.trim() || new TextEncoder().encode(document).length > 12000) return false;
    state.pluginAuthoringBusy = true;
    setPluginAuthoringStatus("pluginImproving");
    try {
      const response = await fetch("/api/plugins/improve", {
        method:"POST",
        credentials:"same-origin",
        headers:authenticatedApiHeaders({ "Content-Type":"application/json" }),
        body:JSON.stringify({ document, reasoningEffort:state.reasoningEffort }),
      }), body = await pluginJsonResponse(response);
      if (typeof body?.document !== "string") throw Error("The AI response did not contain a plugin document");
      pluginDocumentEditor.value = body.document;
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
        body:JSON.stringify({ document:validation.document }),
      }), body = await pluginJsonResponse(response), savedId = body?.plugin?.id;
      if (typeof savedId !== "string" || !await loadPluginDocuments() || !setPluginEnabled(savedId, true)) throw Error("The plugin was saved, but the local catalog could not be refreshed");
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
      cancelAnimationTouchHold();
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
  function setPluginEnabled(pluginId, enabled) {
    const plugin = PLUGIN_DEFINITIONS.find((item) => item.id === pluginId);
    if (!plugin) return false;
    if (enabled && plugin.documentPath && !pluginManifests.has(pluginId)) return false;
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
    updateNewCanvasDialog();
    if (state.statusKey) status.textContent = t(state.statusKey);
    updateSelectionToolbar();
    updateFeatureTourLanguage();
    positionAnimationControls();
    requestInteractionLayerRender();
  }
  function updateThemeCopy() {
    const key = { arcane: "taglineArcane", scifi: "taglineScifi", research: "taglineResearch", studio: "taglineStudio" }[state.theme];
    document.querySelector("[data-i18n=tagline]").textContent = t(key);
    const focus = t({ arcane: "themeFocusArcane", scifi: "themeFocusScifi", research: "themeFocusResearch", studio: "themeFocusStudio" }[state.theme]);
    document.querySelector("#theme").setAttribute("title", focus);
    document.querySelector("#theme").setAttribute("aria-description", focus);
  }
  function updateEmbodimentLabel() {
    const label = t({ arcane: "guideArcane", scifi: "guideScifi", research: "guideResearch", studio: "guideStudio" }[state.theme]);
    embodiment.setAttribute("aria-label", label);
    aiOrb.setAttribute("title", label);
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
  function openRadialMenu() {
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
