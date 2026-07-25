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
    DEFAULT_AUTO_DELAY = 1200,
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
    MAX_IMAGE_DIMENSION = 1024,
    MAX_IMAGE_PIXELS = 16 * 1024 * 1024,
    MAX_WIDGET_HTML_LENGTH = 40000,
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
      autoEnabled: "Auto AI ({delay}s)",
      autoDisabled: "Manual AI",
      autoDelay: "Auto AI delay",
      autoToolboxPending: "Auto AI paused: settle the open toolbox or trigger AI manually",
      grid: "Canvas grid",
      gridOn: "Show canvas grid",
      gridOff: "Hide canvas grid",
      researchGridDefault: "Research grid (off by default)",
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
      tip: "Stylus writes · finger pans · pinch zooms · wheel zooms · middle or Alt drag pans",
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
      tourPluginsTitle: "Choose which plugins AI can use",
      tourPluginsBody: "Only checked plugins are included in the next LLM request, so the model can use their declared capabilities and return the matching widget. Unchecked plugins are completely omitted: they add no prompt, hooks, or runtime behavior. Create your own local plugin from a template, or download community plugins when the marketplace opens.",
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
      changelogTitle: "Images and photos, right on the canvas",
      changelogIntro: "Version 0.7.1 adds images and photos: keep them floating under your ink, draw over them, or merge them into erasable strokes.",
      changelogImages: "Add images or photos through the system picker—photo library or camera on phones and tablets, image files on desktop. Large pictures are downscaled and compressed automatically, so canvases and snapshots stay lightweight.",
      changelogImageEdit: "Long-press an image to move or resize it, with clear Place, Merge, and Delete actions. Place keeps it floating under your ink; Merge turns it into real strokes you can erase.",
      changelogImageAi: "Images never start AI requests on their own. If you work with an image while AI is still processing, the in-flight result is discarded and handwriting recognition resumes automatically. Images are included in undo and redo, local snapshots, and PNG export.",
      changelogEarlierTitle: "Earlier highlights",
      changelogPluginsSummary: "0.7.0 introduced the plugin system: sandboxed HTML widgets and focused data plugins for richer live and interactive work.",
      changelogAnimation: "0.6.0 introduced controllable, persistent animation scenes with a safe declarative Canvas2D renderer.",
      changelogFoundation: "0.5.x added lasso editing and Typeset, Markdown and LaTeX text, reasoning controls, PNG export, the Studio theme, and the feature tour.",
      changelogDone: "Got it",
      debugTitle: "PenEcho debug",
      openLocalLog: "Open local server log",
      history: "Local history",
      historyTitle: "Local canvas history",
      historyDescription: "Stores confirmed canvas content, including restorable animation scenes. Unconfirmed AI drafts are excluded.",
      closeHistory: "Close history",
      newCanvas: "New",
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
      saveSnapshot: "Save canvas",
      snapshotSaving: "Saving canvas...",
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
      pluginPromptEstimate: "about {tokens} prompt tokens",
      pluginRefreshRate: "refresh {time}",
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
      widgetExportFailed: "A live widget could not be captured. Wait for it to finish loading and try again.",
      widgetPluginUnavailable: "The plugin document could not be loaded",
      widgetLimitReached: "Live widget limit reached (20). Delete a widget before adding another.",
      snapshotWidgets: "live widgets",
      clearConfirm: "Clear the whole canvas?",
      timeout: "Request timed out",
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
    serverAutoDelay = Number.isFinite(configuredAutoDelay) && configuredAutoDelay >= 0 ? configuredAutoDelay : DEFAULT_AUTO_DELAY,
    initialAutoDelay = Number.isFinite(storedAutoDelay) && storedAutoDelay >= 0 && storedAutoDelay <= 10000 ? storedAutoDelay : Math.min(10000, serverAutoDelay),
    initialAutoEnabled = storedAutoEnabled === null ? true : storedAutoEnabled === "true",
    initialAiEffort = EFFORT_OPTIONS.includes(storedAiEffort) ? storedAiEffort : EFFORT_OPTIONS.includes(configuredAiEffort) ? configuredAiEffort : "config",
    initialAiTimeout = Number.isFinite(configuredAiTimeout) && configuredAiTimeout >= 10000 ? configuredAiTimeout : DEFAULT_AI_TIMEOUT;
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
  const CHANGELOG_VERSION = "0.7.1";
  // Keep seen IDs stable. Add a new ID (or bump its -vN suffix) to show only that feature to returning users.
  const FEATURE_TOUR_STEPS = Object.freeze([
    { id: "core-effort-v1", targets: ["#aiEffortButton"], titleKey: "tourEffortTitle", bodyKey: "tourEffortBody", placement: "bottom", radius: 8 },
    { id: "plugins-v2", targets: ["#pluginButton"], titleKey: "tourPluginsTitle", bodyKey: "tourPluginsBody", placement: "bottom", radius: 8 },
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
          defaultEnabled:["general", "weather"].includes(item.manifest.id),
        }));
      }
      definitions.sort((a, b) => (manifests.get(a.id)?.name || a.id).localeCompare(manifests.get(b.id)?.name || b.id));
      const generalDefinitions = definitions.filter((definition) => definition.id === "general"),
        remainingDefinitions = definitions.filter((definition) => definition.id !== "general"),
        previousIds = new Set(dataPluginDefinitions().map((plugin) => plugin.id)), nextIds = new Set(definitions.map((plugin) => plugin.id));
      for (const widget of [...state.widgets, ...(state.pendingWidget ? [state.pendingWidget] : [])]) unmountWidget(widget);
      PLUGIN_DEFINITIONS.splice(0, PLUGIN_DEFINITIONS.length, ...generalDefinitions, ...BUILTIN_PLUGIN_DEFINITIONS, ...remainingDefinitions);
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
        if (plugin.documentPath && plugin.builtIn === false) {
          const deleteButton = document.createElement("button");
          deleteButton.className = "plugin-delete-button";
          deleteButton.type = "button";
          deleteButton.dataset.pluginDelete = plugin.id;
          deleteButton.disabled = Boolean(state.pluginDeleting);
          deleteButton.setAttribute("aria-label", t("deletePlugin"));
          deleteButton.setAttribute("title", t("deletePlugin"));
          deleteButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"/></svg>';
          option.append(deleteButton);
        }
        option.prepend(label);
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
        headers:{ "Content-Type":"application/json" },
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
        headers:{ "Content-Type":"application/json" },
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
      const response = await fetch(`/api/plugins/${encodeURIComponent(pluginId)}`, { method:"DELETE", credentials:"same-origin" });
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
    else view.classList.remove("is-navigating");
  }
  function wheelNavigating() {
    setNavigating(true);
    state.navigationTimer = setTimeout(() => setNavigating(false), 700);
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
    requestAI(action);
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
    fetch("/api/debug/client", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ event, details }),
    }).catch(() => {});
  }
  function rememberRequest(id) {
    if (!id) return;
    state.lastRequestId = id;
    debugRequest.textContent = `request: ${id}`;
  }
  const key = (x, y) => `${x},${y}`;
  function tile(tx, ty, create = true) {
    const k = key(tx, ty);
    if (!tiles.has(k) && create) {
      const c = document.createElement("canvas");
      c.width = c.height = TILE;
      c.getContext("2d", { willReadFrequently: true });
      tiles.set(k, c);
      state.inkBounds.set(k, null);
    }
    return tiles.get(k);
  }
  function retainSharpOverlay(image, box) {
    if (!image || !box) return;
    const pixels = image.width * image.height;
    if (!Number.isFinite(pixels) || pixels <= 0 || pixels > MAX_SHARP_OVERLAY_ITEM_PIXELS) return;
    const overlay = { image, box: { ...box }, pixels };
    state.sharpOverlays.push(overlay);
    state.sharpOverlayPixels += pixels;
    while (state.sharpOverlayPixels > MAX_SHARP_OVERLAY_PIXELS && state.sharpOverlays.length > 1) {
      const removed = state.sharpOverlays.shift();
      state.sharpOverlayPixels -= removed.pixels;
    }
  }
  function clearSharpOverlays() {
    state.sharpOverlays = [];
    state.sharpOverlayPixels = 0;
  }
  function invalidateSharpOverlays(box) {
    if (!box || !state.sharpOverlays.length) return;
    state.sharpOverlays = state.sharpOverlays.filter((overlay) => {
      if (!intersection(overlay.box, box)) return true;
      state.sharpOverlayPixels -= overlay.pixels;
      return false;
    });
    state.sharpOverlayPixels = Math.max(0, state.sharpOverlayPixels);
  }
  function drawSharpOverlays(context, region = null) {
    for (const overlay of state.sharpOverlays) {
      if (region && !intersection(overlay.box, region)) continue;
      context.drawImage(overlay.image, overlay.box.x, overlay.box.y, overlay.box.w, overlay.box.h);
    }
  }

  function imageBox(item) {
    return { x:item.x, y:item.y, w:item.w, h:item.h };
  }
  function imageLayout(item) {
    return imageBox(item);
  }
  function imageHistoryRecord(item) {
    return {
      id:item.id,
      x:item.x,
      y:item.y,
      w:item.w,
      h:item.h,
      naturalW:item.naturalW,
      naturalH:item.naturalH,
      sourceName:item.sourceName,
      blob:item.blob,
      image:item.image,
    };
  }
  function storedImageRecord(item) {
    return {
      id:item.id,
      x:item.x,
      y:item.y,
      w:item.w,
      h:item.h,
      naturalW:item.naturalW,
      naturalH:item.naturalH,
      sourceName:item.sourceName,
      blob:item.blob,
    };
  }
  function imageRecord(item) {
    if (!item || typeof item !== "object" || !(item.blob instanceof Blob) || !item.image || item.blob.size <= 0 || item.blob.size > MAX_IMAGE_SOURCE_BYTES) return null;
    if (!n(item.x) || !n(item.y) || !n(item.w, 80, 6000) || !n(item.h, 80, 6000) || item.w * item.h > MAX_IMAGE_PIXELS * 2 || item.x + item.w > SIZE || item.y + item.h > SIZE) return null;
    const naturalW = Number(item.naturalW) || item.image.naturalWidth || item.image.width,
      naturalH = Number(item.naturalH) || item.image.naturalHeight || item.image.height;
    if (!n(naturalW, 1, MAX_IMAGE_DIMENSION) || !n(naturalH, 1, MAX_IMAGE_DIMENSION) || naturalW * naturalH > MAX_IMAGE_PIXELS) return null;
    return {
      id:typeof item.id === "string" && /^image-\d+$/.test(item.id) ? item.id : `image-${state.nextImageId++}`,
      x:Math.round(item.x),
      y:Math.round(item.y),
      w:Math.round(item.w),
      h:Math.round(item.h),
      naturalW:Math.round(naturalW),
      naturalH:Math.round(naturalH),
      sourceName:typeof item.sourceName === "string" ? item.sourceName.trim().slice(0, 160) : "",
      blob:item.blob,
      image:item.image,
    };
  }
  function imageHistoryState() {
    return state.images.map(imageHistoryRecord);
  }
  function storedImages() {
    return state.images.map(storedImageRecord);
  }
  function recordImagesBefore() {
    if (!state.imageHistoryBefore) state.imageHistoryBefore = imageHistoryState();
  }
  function restoreImages(items) {
    state.images = [];
    state.nextImageId = 1;
    state.selectedImageId = null;
    state.imageEdit = null;
    state.imageGesture = null;
    cancelImageTouchHold();
    for (const item of Array.isArray(items) ? items.slice(0, MAX_VISIBLE_IMAGES) : []) {
      const record = imageRecord(item);
      if (!record || state.images.some((existing) => existing.id === record.id)) continue;
      const numbered = /^image-(\d+)$/.exec(record.id);
      if (numbered) state.nextImageId = Math.max(state.nextImageId, Number(numbered[1]) + 1);
      state.images.push(record);
    }
  }
  async function decodeStoredImage(item) {
    if (!item || !(item.blob instanceof Blob)) return null;
    try {
      const image = await imageFromBlob(item.blob);
      return imageRecord({ ...item, image });
    } catch {
      return null;
    }
  }
  async function decodeStoredImages(items) {
    return (await Promise.all((Array.isArray(items) ? items.slice(0, MAX_VISIBLE_IMAGES) : []).map(decodeStoredImage))).filter(Boolean);
  }
  function visibleImages(region = null) {
    return state.images.filter((item) => !region || intersection(imageBox(item), region));
  }
  function imageBounds(region = null) {
    let bounds = null;
    for (const item of visibleImages(region)) bounds = unionLocalBounds(bounds, region ? intersection(imageBox(item), region) : imageBox(item));
    return bounds;
  }
  function drawImagesToContext(context, region = null) {
    for (const item of visibleImages(region)) context.drawImage(item.image, item.x, item.y, item.w, item.h);
  }
  function selectedImage() {
    return state.images.find((item) => item.id === state.selectedImageId) || null;
  }
  function beginImageEdit(item) {
    if (!item || !state.images.includes(item)) return false;
    if (state.imageEdit?.id === item.id) return true;
    if (state.widgetEdit) acceptWidgetEdit();
    if (state.animationEdit) acceptAnimationEdit();
    if (state.imageEdit) acceptImageEdit();
    recordImagesBefore();
    state.selectedImageId = item.id;
    state.imageEdit = { id:item.id, before:imageLayout(item), changed:false };
    requestInteractionLayerRender();
    setStatusKey("imageSelected");
    return true;
  }
  function acceptImageEdit() {
    const edit = state.imageEdit;
    state.imageGesture = null;
    state.imageEdit = null;
    state.selectedImageId = null;
    if (edit?.changed) {
      state.userRevision++;
      save();
    } else if (edit) state.imageHistoryBefore = null;
    if (edit) schedule();
    requestRender();
    if (edit) setStatusKey("ready");
    return Boolean(edit);
  }
  function cancelImageEdit() {
    const edit = state.imageEdit,
      item = edit ? state.images.find((candidate) => candidate.id === edit.id) : null;
    if (item) Object.assign(item, edit.before);
    state.imageHistoryBefore = null;
    state.imageGesture = null;
    state.imageEdit = null;
    state.selectedImageId = null;
    if (edit) schedule();
    requestRender();
    if (edit) setStatusKey("ready");
    return Boolean(edit);
  }
  function imageControlHit(item, point, pointerType = "mouse") {
    const box = imageBox(item),
      handle = 14 / state.scale,
      radius = (pointerType === "touch" ? 24 : 14) / state.scale,
      controls = [
        { hit:"resize", target:{ x:box.x + box.w, y:box.y + box.h }, radius },
        { hit:"width", target:{ x:box.x + box.w + handle * 0.08, y:box.y + box.h / 2 }, radius },
        { hit:"height", target:{ x:box.x + box.w / 2, y:box.y + box.h + handle * 0.08 }, radius },
      ],
      control = controls
        .map((candidate) => ({ ...candidate, distance:Math.hypot(point.x - candidate.target.x, point.y - candidate.target.y) }))
        .filter((candidate) => candidate.distance <= candidate.radius)
        .sort((a, b) => a.distance - b.distance)[0];
    if (control) return control.hit;
    return point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h ? "move" : null;
  }
  function imageAtPoint(point) {
    for (let index = state.images.length - 1; index >= 0; index--) {
      const item = state.images[index], box = imageBox(item);
      if (point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h) return item;
    }
    return null;
  }
  function imagePointerHit(point, pointerType = "mouse", includeUnselected = false) {
    const selected = selectedImage();
    if (selected && state.imageEdit) {
      const hit = imageControlHit(selected, point, pointerType);
      if (hit) return { image:selected, hit };
    }
    if (!includeUnselected) return null;
    const item = imageAtPoint(point);
    return item ? { image:item, hit:"move" } : null;
  }
  function resizeImageBox(start, point, hit) {
    const minimumWidth = 80, minimumHeight = 80,
      maximumWidth = Math.min(6000, SIZE - start.x),
      maximumHeight = Math.min(6000, SIZE - start.y);
    if (hit === "width") return { ...start, w:Math.max(minimumWidth, Math.min(maximumWidth, point.x - start.x)) };
    if (hit === "height") return { ...start, h:Math.max(minimumHeight, Math.min(maximumHeight, point.y - start.y)) };
    const minimumScale = Math.max(minimumWidth / start.w, minimumHeight / start.h),
      maximumScale = Math.min(maximumWidth / start.w, maximumHeight / start.h, Math.sqrt(MAX_IMAGE_PIXELS * 2 / (start.w * start.h))),
      requestedScale = Math.max((point.x - start.x) / start.w, (point.y - start.y) / start.h),
      scale = Math.max(minimumScale, Math.min(maximumScale, requestedScale));
    return { ...start, w:start.w * scale, h:start.h * scale };
  }
  function beginImageGesture(event, point, result) {
    if (!result?.image) return false;
    beginImageEdit(result.image);
    state.imageGesture = {
      id:event.pointerId,
      image:result.image,
      hit:result.hit,
      startPoint:point,
      start:imageLayout(result.image),
      changed:false,
    };
    setCanvasCursor(result.hit === "resize" ? "nwse-resize" : result.hit === "width" ? "ew-resize" : result.hit === "height" ? "ns-resize" : "grabbing");
    requestInteractionLayerRender();
    return true;
  }
  function updateImageGesture(event) {
    const gesture = state.imageGesture;
    if (!gesture || gesture.id !== event.pointerId) return false;
    const point = clientPoint(event), item = gesture.image;
    if (gesture.hit === "move") {
      item.x = Math.max(0, Math.min(SIZE - item.w, gesture.start.x + point.x - gesture.startPoint.x));
      item.y = Math.max(0, Math.min(SIZE - item.h, gesture.start.y + point.y - gesture.startPoint.y));
    } else Object.assign(item, resizeImageBox(gesture.start, point, gesture.hit));
    gesture.changed = ["x", "y", "w", "h"].some((key) => Math.abs(item[key] - gesture.start[key]) > 0.01);
    requestRender();
    requestInteractionLayerRender();
    return true;
  }
  function finishImageGesture(event) {
    const gesture = state.imageGesture;
    if (!gesture || gesture.id !== event.pointerId) return false;
    state.imageGesture = null;
    setCanvasCursor("crosshair");
    if (gesture.changed && state.imageEdit?.id === gesture.image.id) state.imageEdit.changed = true;
    requestInteractionLayerRender();
    return true;
  }
  function cancelImageTouchHold(pointerId = null) {
    const hold = state.imageTouchHold;
    if (!hold || pointerId !== null && hold.id !== pointerId) return false;
    clearTimeout(hold.timer);
    state.imageTouchHold = null;
    return true;
  }
  function beginImageTouchHold(event, point, item) {
    cancelImageTouchHold();
    const hold = { id:event.pointerId, pointerType:event.pointerType, startX:event.clientX, startY:event.clientY, point, image:item, downEvent:event, timer:0 };
    hold.timer = setTimeout(() => {
      if (state.imageTouchHold !== hold) return;
      state.imageTouchHold = null;
      if (!state.pointers.has(hold.id)) return;
      if (hold.pointerType === "touch" && (state.touches.size !== 1 || !state.touches.has(hold.id))) return;
      if (!state.images.includes(item)) return;
      state.panGesture = null;
      setNavigating(false);
      beginImageGesture({ pointerId:hold.id }, hold.point, { image:item, hit:"move" });
    }, IMAGE_TOUCH_HOLD_MS);
    state.imageTouchHold = hold;
    return true;
  }
  function deleteImage(item) {
    if (!item || !state.images.includes(item)) return false;
    recordImagesBefore();
    state.images = state.images.filter((candidate) => candidate !== item);
    if (state.selectedImageId === item.id) {
      state.selectedImageId = null;
      state.imageEdit = null;
      state.imageGesture = null;
    }
    state.userRevision++;
    save();
    schedule();
    requestRender();
    setStatusKey("imageDeleted");
    return true;
  }
  function mergeImage(item) {
    if (!item || !state.images.includes(item)) return false;
    recordImagesBefore();
    const box = imageBox(item);
    invalidateSharpOverlays(box);
    const x0 = Math.max(0, Math.floor(box.x / TILE)),
      y0 = Math.max(0, Math.floor(box.y / TILE)),
      x1 = Math.min(Math.ceil(SIZE / TILE) - 1, Math.ceil((box.x + box.w) / TILE) - 1),
      y1 = Math.min(Math.ceil(SIZE / TILE) - 1, Math.ceil((box.y + box.h) / TILE) - 1);
    for (let ty = y0; ty <= y1; ty++)
      for (let tx = x0; tx <= x1; tx++) {
        recordBefore(tx, ty);
        const canvas = tile(tx, ty);
        canvas.getContext("2d").drawImage(item.image, item.x - tx * TILE, item.y - ty * TILE, item.w, item.h);
        extendInkBounds(key(tx, ty), {
          x: Math.max(0, item.x - tx * TILE),
          y: Math.max(0, item.y - ty * TILE),
          w: Math.min(TILE, item.x + item.w - tx * TILE) - Math.max(0, item.x - tx * TILE),
          h: Math.min(TILE, item.y + item.h - ty * TILE) - Math.max(0, item.y - ty * TILE),
        });
      }
    state.images = state.images.filter((candidate) => candidate !== item);
    if (state.selectedImageId === item.id) {
      state.selectedImageId = null;
      state.imageEdit = null;
      state.imageGesture = null;
    }
    state.userRevision++;
    mergeDirty(box.x, box.y, 0);
    mergeDirty(box.x + box.w, box.y + box.h, 0);
    state.autoEligible = true;
    schedule();
    save();
    requestRender();
    setStatusKey("imageMerged");
    return true;
  }
  function importedImagePlacement(naturalW, naturalH) {
    const visible = viewportRect() || { x:0, y:0, w:SIZE, h:SIZE },
      rect = view.getBoundingClientRect(),
      maxW = Math.max(80, Math.min(6000, visible.w * 0.72, Math.max(240, rect.width * 0.52) / state.scale)),
      maxH = Math.max(80, Math.min(6000, visible.h * 0.72, Math.max(200, rect.height * 0.52) / state.scale)),
      scale = Math.min(maxW / naturalW, maxH / naturalH),
      w = Math.max(80, naturalW * scale),
      h = Math.max(80, naturalH * scale),
      x = Math.max(0, Math.min(SIZE - w, visible.x + (visible.w - w) / 2)),
      y = Math.max(0, Math.min(SIZE - h, visible.y + (visible.h - h) / 2));
    return { x, y, w, h };
  }
  function imageImportError(key) {
    const error = Error(t(key));
    error.statusKey = key;
    return error;
  }
  async function prepareImportedImage(file) {
    if (!(file instanceof Blob) || file.size <= 0 || file.size > MAX_IMAGE_SOURCE_BYTES) throw imageImportError("imageTooLarge");
    if (file.type && !file.type.toLowerCase().startsWith("image/")) throw imageImportError("imageUnsupported");
    let source;
    try { source = await imageFromBlob(file); } catch { throw imageImportError("imageUnsupported"); }
    const sourceW = source.naturalWidth || source.width,
      sourceH = source.naturalHeight || source.height;
    if (!Number.isFinite(sourceW) || !Number.isFinite(sourceH) || sourceW <= 0 || sourceH <= 0) throw imageImportError("imageUnsupported");
    const scale = Math.min(1, MAX_IMAGE_DIMENSION / sourceW, MAX_IMAGE_DIMENSION / sourceH, Math.sqrt(MAX_IMAGE_PIXELS / (sourceW * sourceH))),
      naturalW = Math.max(1, Math.round(sourceW * scale)),
      naturalH = Math.max(1, Math.round(sourceH * scale)),
      canvas = offscreen(naturalW, naturalH),
      context = canvas.getContext("2d");
    context.drawImage(source, 0, 0, naturalW, naturalH);
    const blob = await canvasBlob(canvas, "image/webp", 0.92);
    canvas.width = canvas.height = 1;
    if (!blob || blob.size <= 0 || blob.size > MAX_IMAGE_SOURCE_BYTES) throw imageImportError("imageTooLarge");
    const image = await imageFromBlob(blob);
    return { blob, image, naturalW, naturalH };
  }
  function canvasIdentityGeneration() {
    return state.snapshotLoadGeneration;
  }
  async function addImageFile(file) {
    if (state.imageImporting) return;
    if (state.images.length >= MAX_VISIBLE_IMAGES) {
      setStatusKey("imageLimitReached");
      return;
    }
    if (selectionAIBusy()) {
      setStatusKey(selectionAIStatusKey());
      return;
    }
    const expectedIdentityGeneration = canvasIdentityGeneration();
    state.imageImporting = true;
    imagePickerButton.disabled = true;
    setStatusKey("imageLoading");
    try {
      const prepared = await prepareImportedImage(file);
      if (expectedIdentityGeneration !== canvasIdentityGeneration()) return;
      if (state.pending) acceptPending();
      if (state.pendingWidget) acceptPendingWidget();
      if (state.images.length >= MAX_VISIBLE_IMAGES) throw imageImportError("imageLimitReached");
      if (state.selection) commitSelection();
      if (state.selection) {
        setStatusKey(selectionAIStatusKey());
        return;
      }
      if (state.widgetEdit) acceptWidgetEdit();
      if (state.animationEdit) acceptAnimationEdit();
      if (state.imageEdit) acceptImageEdit();
      recordImagesBefore();
      const item = imageRecord({
        id:`image-${state.nextImageId++}`,
        ...importedImagePlacement(prepared.naturalW, prepared.naturalH),
        ...prepared,
        sourceName:typeof file.name === "string" ? file.name : "",
      });
      if (!item) throw imageImportError("imageImportFailed");
      state.images.push(item);
      state.userRevision++;
      save();
      requestRender();
      beginImageEdit(item);
      setStatusKey("imageAdded");
    } catch (error) {
      setStatusKey(error?.statusKey || "imageImportFailed");
    } finally {
      state.imageImporting = false;
      imagePickerButton.disabled = false;
      imagePickerInput.value = "";
    }
  }
  function widgetBox(widget) {
    return { x: widget.x, y: widget.y, w: widget.w, h: widget.h };
  }
  function widgetLayout(widget) {
    return { ...widgetBox(widget), contentW:widget.contentW, contentH:widget.contentH };
  }
  function visibleWidgets(region = null) {
    if (!widgetRuntimeEnabled()) return [];
    return state.widgets.filter((widget) => pluginEnabled(widget.pluginId) && pluginManifests.has(widget.pluginId) && (!region || intersection(widgetBox(widget), region)));
  }
  function serializedWidgets() {
    return state.widgets.map((widget) => ({
      id: widget.id,
      pluginId: widget.pluginId,
      x: widget.x,
      y: widget.y,
      w: widget.w,
      h: widget.h,
      contentW: widget.contentW,
      contentH: widget.contentH,
      title: widget.title,
      refreshSeconds: widget.refreshSeconds,
      html: widget.html,
    }));
  }
  function recordWidgetsBefore() {
    if (!state.widgetHistoryBefore) state.widgetHistoryBefore = serializedWidgets();
  }
  function widgetRecord(item) {
    if (!item || typeof item !== "object" || typeof item.pluginId !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.pluginId) || item.pluginId.length > 64
      || typeof item.html !== "string" || !item.html.trim() || item.html.length > MAX_WIDGET_HTML_LENGTH) return null;
    if (!n(item.x) || !n(item.y) || !n(item.w, 300, 5000) || !n(item.h, 200, 4000) || item.w * item.h > 12000000 || item.x + item.w > SIZE || item.y + item.h > SIZE) return null;
    const contentW = item.contentW ?? item.w,
      contentH = item.contentH ?? item.h;
    if (!n(contentW, 300, 5000) || !n(contentH, 200, 4000) || contentW * contentH > 12000000) return null;
    if (typeof item.title !== "string" || !item.title.trim() || item.title.length > 120 || !n(item.refreshSeconds, 60, 86400)) return null;
    return {
      id: typeof item.id === "string" && /^widget-\d+$/.test(item.id) ? item.id : `widget-${state.nextWidgetId++}`,
      pluginId: item.pluginId,
      x: Math.round(item.x),
      y: Math.round(item.y),
      w: Math.round(item.w),
      h: Math.round(item.h),
      contentW: Math.round(contentW),
      contentH: Math.round(contentH),
      title: item.title.trim(),
      refreshSeconds: Math.round(item.refreshSeconds),
      html: item.html,
      snapshotImage: null,
      shell: null,
      frame: null,
      pending: false,
    };
  }
  function restoreWidgets(items) {
    for (const widget of state.widgets) unmountWidget(widget);
    state.widgets = [];
    state.selectedWidgetId = null;
    state.widgetEdit = null;
    state.widgetGesture = null;
    state.nextWidgetId = 1;
    for (const item of Array.isArray(items) ? items.slice(0, MAX_VISIBLE_WIDGETS) : []) {
      const widget = widgetRecord(item);
      if (!widget || state.widgets.some((existing) => existing.id === widget.id)) continue;
      const numbered = /^widget-(\d+)$/.exec(widget.id);
      if (numbered) state.nextWidgetId = Math.max(state.nextWidgetId, Number(numbered[1]) + 1);
      state.widgets.push(widget);
      if (pluginEnabled(widget.pluginId)) mountWidget(widget);
    }
  }
  function widgetHostUrl(manifest) {
    const url = new URL("widget-host.html", location.href);
    for (const origin of manifest.connect) url.searchParams.append("connect", origin);
    return url.href;
  }
  function mountWidget(widget) {
    if (widget.shell || !pluginEnabled(widget.pluginId)) return;
    const manifest = pluginManifests.get(widget.pluginId);
    if (!manifest) return;
    const shell = document.createElement("section"),
      frame = document.createElement("iframe");
    shell.className = `canvas-widget${widget.pending ? " pending" : ""}`;
    shell.dataset.widgetId = widget.id;
    shell.classList.add(`canvas-widget-instance-${widget.id.replace(/[^a-z0-9-]/g, "")}`);
    frame.className = "canvas-widget-frame";
    frame.title = widget.title;
    frame.referrerPolicy = "no-referrer";
    frame.src = widgetHostUrl(manifest);
    shell.append(frame);
    widgetLayer.append(shell);
    widget.shell = shell;
    widget.frame = frame;
    widget.initialized = false;
    widget.hostReady = false;
    widget.hostStateKey = null;
    widget.contentReady = false;
    widget.readyPromise = new Promise((resolve) => (widget.resolveReady = resolve));
    addWidgetStyleRule(widget);
    positionWidget(widget);
  }
  function unmountWidget(widget) {
    clearTimeout(widget.snapshotTimer);
    widget.snapshotTimer = 0;
    removeWidgetStyleRule(widget);
    widget.shell?.remove();
    widget.shell = null;
    widget.frame = null;
    widget.initialized = false;
    widget.hostReady = false;
    widget.contentReady = false;
    widget.resolveReady = null;
    widget.readyPromise = null;
    for (const [requestId, pending] of widgetSnapshotRequests) {
      if (pending.widget !== widget) continue;
      clearTimeout(pending.timer);
      pending.reject(Error(t("widgetExportFailed")));
      widgetSnapshotRequests.delete(requestId);
    }
  }
  function addWidgetStyleRule(widget) {
    const sheet = textEditorStyleSheet(), className = `canvas-widget-instance-${widget.id.replace(/[^a-z0-9-]/g, "")}`;
    if (!sheet) return;
    try {
      sheet.insertRule(`.${className} { width: ${widget.contentW}px; height: ${widget.contentH}px; }`, sheet.cssRules.length);
      widget.styleRule = [...sheet.cssRules].find((rule) => rule.selectorText === `.${className}`) || null;
    } catch {
      widget.styleRule = null;
    }
  }
  function removeWidgetStyleRule(widget) {
    const sheet = textEditorStyleSheet(), rule = widget?.styleRule;
    if (!sheet || !rule) return;
    const index = [...sheet.cssRules].indexOf(rule);
    if (index >= 0) {
      try { sheet.deleteRule(index); } catch {}
    }
    widget.styleRule = null;
  }
  function positionWidget(widget) {
    if (!widget.shell) return;
    const screenX = state.panX + widget.x * state.scale,
      screenY = state.panY + widget.y * state.scale,
      scaleX = state.scale * widget.w / widget.contentW,
      scaleY = state.scale * widget.h / widget.contentH,
      declaration = widget.styleRule?.style;
    if (!declaration) return;
    declaration.width = `${widget.contentW}px`;
    declaration.height = `${widget.contentH}px`;
    declaration.transform = `translate3d(${screenX}px,${screenY}px,0) scale(${scaleX},${scaleY})`;
    sendWidgetHostState(widget, scaleX, scaleY);
  }
  function positionWidgets() {
    if (!widgetRuntimeEnabled()) return;
    for (const widget of [...state.widgets, ...(state.pendingWidget ? [state.pendingWidget] : [])]) positionWidget(widget);
  }
  function sendWidgetInit(widget) {
    if (!widget.frame?.contentWindow || !widget.hostReady || widget.initialized) return;
    widget.initialized = true;
    widget.frame.contentWindow.postMessage({ type:"penecho-widget-init", title:widget.title, html:widget.html }, location.origin);
  }
  function sendWidgetHostState(widget, scaleX = state.scale * widget.w / widget.contentW, scaleY = state.scale * widget.h / widget.contentH, force = false) {
    if (!widget.frame?.contentWindow || !widget.hostReady || !Number.isFinite(scaleX) || scaleX <= 0 || !Number.isFinite(scaleY) || scaleY <= 0) return;
    const selected = widget.pending === true || (state.widgetEdit?.id === widget.id && state.selectedWidgetId === widget.id),
      key = `${selected ? 1 : 0}:${scaleX.toFixed(6)}:${scaleY.toFixed(6)}`;
    if (!force && widget.hostStateKey === key) return;
    widget.hostStateKey = key;
    widget.frame.contentWindow.postMessage({ type:"penecho-widget-state", selected, scaleX, scaleY }, location.origin);
  }
  function syncWidgetHostStates() {
    for (const widget of [...state.widgets, ...(state.pendingWidget ? [state.pendingWidget] : [])]) sendWidgetHostState(widget);
  }
  function decodeWidgetSnapshot(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(Error("Widget snapshot could not be decoded"));
      image.src = dataUrl;
    });
  }
  async function waitForWidgetContent(widget) {
    if (widget.contentReady) return;
    if (!widget.readyPromise) throw Error(t("widgetExportFailed"));
    await Promise.race([
      widget.readyPromise,
      new Promise((_, reject) => setTimeout(() => reject(Error(t("widgetExportFailed"))), WIDGET_SNAPSHOT_TIMEOUT_MS)),
    ]);
  }
  async function requestWidgetSnapshot(widget) {
    if (widget.snapshotPromise) return widget.snapshotPromise;
    const snapshotPromise = (async () => {
      await waitForWidgetContent(widget);
      if (!widget.frame?.contentWindow) throw Error(t("widgetExportFailed"));
      const requestId = crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          widgetSnapshotRequests.delete(requestId);
          reject(Error(t("widgetExportFailed")));
        }, WIDGET_SNAPSHOT_TIMEOUT_MS);
        widgetSnapshotRequests.set(requestId, { widget, resolve, reject, timer });
        widget.frame.contentWindow.postMessage({ type:"penecho-widget-snapshot-request", requestId, width:widget.contentW, height:widget.contentH }, location.origin);
      });
    })();
    widget.snapshotPromise = snapshotPromise;
    try {
      return await snapshotPromise;
    } finally {
      if (widget.snapshotPromise === snapshotPromise) widget.snapshotPromise = null;
    }
  }
  function scheduleWidgetSnapshot(widget) {
    clearTimeout(widget.snapshotTimer);
    widget.snapshotTimer = setTimeout(() => requestWidgetSnapshot(widget).catch(() => {}), 350);
  }
  async function handleWidgetMessage(event) {
    if (event.origin !== location.origin || !event.data || typeof event.data !== "object") return;
    const widget = [...state.widgets, ...(state.pendingWidget ? [state.pendingWidget] : [])].find((item) => item.frame?.contentWindow === event.source);
    if (!widget) return;
    const message = event.data;
    if (message.type === "penecho-widget-host-ready") {
      widget.hostReady = true;
      sendWidgetInit(widget);
      sendWidgetHostState(widget, undefined, undefined, true);
      return;
    }
    if (validWidgetHostDrag(message)) {
      if (message.type === "penecho-widget-drag-start") beginWidgetHostDrag(widget, message);
      else if (message.type === "penecho-widget-drag-move") {
        if (!updateWidgetHostDrag(widget, message) && message.pointerType === "touch") updateWidgetHostTouch(widget, { ...message, type:"penecho-widget-touch-move" });
      }
      else finishWidgetHostDrag(widget, message);
      return;
    }
    if (validWidgetHostTouch(message)) {
      if (message.type === "penecho-widget-touch-start") beginWidgetHostTouch(widget, message);
      else if (message.type === "penecho-widget-touch-move") updateWidgetHostTouch(widget, message);
      else finishWidgetHostTouch(widget, message);
      return;
    }
    if (message.type === "penecho-widget-updated") {
      widget.contentReady = true;
      widget.resolveReady?.();
      widget.resolveReady = null;
      scheduleWidgetSnapshot(widget);
      return;
    }
    if (!["penecho-widget-snapshot", "penecho-widget-snapshot-error"].includes(message.type)) return;
    const pending = widgetSnapshotRequests.get(message.requestId);
    if (!pending || pending.widget !== widget) return;
    widgetSnapshotRequests.delete(message.requestId);
    clearTimeout(pending.timer);
    if (message.type === "penecho-widget-snapshot-error" || typeof message.dataUrl !== "string" || !message.dataUrl.startsWith("data:image/png;base64,")) {
      pending.reject(Error(t("widgetExportFailed")));
      return;
    }
    try {
      widget.snapshotImage = await decodeWidgetSnapshot(message.dataUrl);
      pending.resolve(widget.snapshotImage);
    } catch (error) {
      pending.reject(error);
    }
  }
  function selectedWidget() {
    return state.widgets.find((widget) => widget.id === state.selectedWidgetId) || null;
  }
  function beginWidgetEdit(widget) {
    if (!widget || widget.pending) return false;
    if (state.imageEdit) acceptImageEdit();
    if (state.widgetEdit?.id === widget.id) return true;
    if (state.widgetEdit) acceptWidgetEdit();
    recordWidgetsBefore();
    state.selectedWidgetId = widget.id;
    state.widgetEdit = { id:widget.id, before:widgetLayout(widget), changed:false };
    syncWidgetHostStates();
    requestInteractionLayerRender();
    return true;
  }
  function acceptWidgetEdit() {
    const edit = state.widgetEdit;
    state.widgetGesture = null;
    state.widgetEdit = null;
    state.selectedWidgetId = null;
    if (edit?.changed) {
      state.userRevision++;
      save();
    } else if (edit) state.widgetHistoryBefore = null;
    syncWidgetHostStates();
    requestInteractionLayerRender();
    if (edit) setStatusKey("ready");
    return Boolean(edit);
  }
  function cancelWidgetEdit() {
    const edit = state.widgetEdit,
      widget = edit ? state.widgets.find((item) => item.id === edit.id) : null;
    if (widget) {
      Object.assign(widget, edit.before);
      positionWidget(widget);
    }
    state.widgetHistoryBefore = null;
    state.widgetGesture = null;
    state.widgetEdit = null;
    state.selectedWidgetId = null;
    syncWidgetHostStates();
    requestInteractionLayerRender();
    if (edit) setStatusKey("ready");
    return Boolean(edit);
  }
  function widgetControlHit(widget, point, pointerType = "mouse") {
    const box = widgetBox(widget),
      handle = 14 / state.scale,
      radius = (pointerType === "touch" ? 24 : 14) / state.scale,
      actionRadius = pointerType === "touch" ? 22 / state.scale : Math.max(handle * 0.8, 9 / state.scale),
      controls = [
        ...Object.entries(draftActionPoints(box, handle, false, true)).map(([hit, target]) => ({ hit, target, radius:actionRadius })),
        { hit:"resize", target:{ x:box.x + box.w, y:box.y + box.h }, radius },
        { hit:"width", target:{ x:box.x + box.w + handle * 0.08, y:box.y + box.h / 2 }, radius },
        { hit:"height", target:{ x:box.x + box.w / 2, y:box.y + box.h + handle * 0.08 }, radius },
      ],
      control = controls
        .map((item) => ({ ...item, distance:Math.hypot(point.x - item.target.x, point.y - item.target.y) }))
        .filter((item) => item.distance <= item.radius)
        .sort((a, b) => a.distance - b.distance)[0];
    if (control) return control.hit;
    return point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h ? "move" : null;
  }
  function widgetPointerHit(point, pointerType = "mouse") {
    if (!widgetRuntimeEnabled()) return null;
    if (state.pendingWidget) {
      const hit = widgetControlHit(state.pendingWidget, point, pointerType);
      if (hit && hit !== "move") return { widget:state.pendingWidget, hit, pending:true };
    }
    const selected = selectedWidget();
    if (selected && state.widgetEdit) {
      const hit = widgetControlHit(selected, point, pointerType);
      if (hit && hit !== "move") return { widget:selected, hit, pending:false };
    }
    return null;
  }
  function resizeWidgetBox(start, point, hit, minimumWidth = 300, minimumHeight = 200, limit = SIZE, maximumWidth = 5000, maximumHeight = 4000, maximumArea = 12000000) {
    const contentW = start.contentW ?? start.w,
      contentH = start.contentH ?? start.h;
    if (hit === "width") {
      const displayScale = start.h / contentH,
        minimum = Math.max(minimumWidth, minimumWidth * displayScale),
        maximum = Math.min(limit - start.x, maximumWidth, maximumWidth * displayScale, maximumArea / start.h, maximumArea / contentH * displayScale),
        width = Math.max(minimum, Math.min(maximum, point.x - start.x));
      return { ...start, w:width, contentW:width / displayScale };
    }
    if (hit === "height") {
      const displayScale = start.w / contentW,
        minimum = Math.max(minimumHeight, minimumHeight * displayScale),
        maximum = Math.min(limit - start.y, maximumHeight, maximumHeight * displayScale, maximumArea / start.w, maximumArea / contentW * displayScale),
        height = Math.max(minimum, Math.min(maximum, point.y - start.y));
      return { ...start, h:height, contentH:height / displayScale };
    }
    const minimumScale = Math.max(minimumWidth / start.w, minimumHeight / start.h),
      maximumScale = Math.min((limit - start.x) / start.w, (limit - start.y) / start.h, maximumWidth / start.w, maximumHeight / start.h, Math.sqrt(maximumArea / (start.w * start.h))),
      requestedScale = Math.max((point.x - start.x) / start.w, (point.y - start.y) / start.h),
      scale = Math.max(minimumScale, Math.min(maximumScale, requestedScale));
    return { ...start, w:start.w * scale, h:start.h * scale };
  }
  function beginWidgetGesture(event, point, result) {
    if (!result?.widget) return false;
    if (result.hit === "accept") return (result.pending ? acceptPendingWidget() : acceptWidgetEdit()) || true;
    if (result.hit === "cancel") return (result.pending ? rejectPendingWidget() : deleteWidget(result.widget)) || true;
    if (!result.pending) beginWidgetEdit(result.widget);
    state.widgetGesture = {
      id:event.pointerId,
      widget:result.widget,
      pending:result.pending,
      hit:result.hit,
      startPoint:point,
      start:widgetLayout(result.widget),
      changed:false,
    };
    setCanvasCursor(result.hit === "resize" ? "nwse-resize" : result.hit === "width" ? "ew-resize" : result.hit === "height" ? "ns-resize" : "grabbing");
    requestInteractionLayerRender();
    return true;
  }
  function updateWidgetGesturePoint(gesture, point) {
    const widget = gesture.widget;
    if (gesture.hit === "move") {
      widget.x = Math.max(0, Math.min(SIZE - widget.w, gesture.start.x + point.x - gesture.startPoint.x));
      widget.y = Math.max(0, Math.min(SIZE - widget.h, gesture.start.y + point.y - gesture.startPoint.y));
    } else Object.assign(widget, resizeWidgetBox(gesture.start, point, gesture.hit));
    gesture.changed = ["x", "y", "w", "h"].some((key) => Math.abs(widget[key] - gesture.start[key]) > 0.01);
    positionWidget(widget);
    requestInteractionLayerRender();
    return true;
  }
  function updateWidgetGesture(event) {
    const gesture = state.widgetGesture;
    if (!gesture || gesture.id !== event.pointerId) return false;
    return updateWidgetGesturePoint(gesture, clientPoint(event));
  }
  function validWidgetHostDrag(message) {
    return message && ["penecho-widget-drag-start", "penecho-widget-drag-move", "penecho-widget-drag-end"].includes(message.type)
      && Number.isInteger(message.pointerId) && Math.abs(message.pointerId) <= 0x7fffffff
      && ["mouse", "pen", "touch"].includes(message.pointerType)
      && ["move", "width", "height", "resize"].includes(message.hit)
      && [message.localX, message.localY, message.screenX, message.screenY].every(value => Number.isFinite(value) && Math.abs(value) <= 10000000);
  }
  function validWidgetHostTouch(message) {
    return message && ["penecho-widget-touch-start", "penecho-widget-touch-move", "penecho-widget-touch-end"].includes(message.type)
      && Number.isInteger(message.pointerId) && Math.abs(message.pointerId) <= 0x7fffffff
      && message.pointerType === "touch"
      && [message.localX, message.localY, message.screenX, message.screenY].every(value => Number.isFinite(value) && Math.abs(value) <= 10000000);
  }
  function widgetHostPointerId(widget, pointerId) {
    return `widget-host:${widget.id}:${pointerId}`;
  }
  function widgetHostViewportPoint(widget, message) {
    const rect = widget.frame?.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return null;
    return {
      x:rect.left + message.localX * rect.width / widget.contentW,
      y:rect.top + message.localY * rect.height / widget.contentH,
    };
  }
  function widgetHostTrackedPoint(anchor, message) {
    if (!anchor) return null;
    return {
      x:anchor.clientX + (message.screenX - anchor.screenX) * screenClientRatio,
      y:anchor.clientY + (message.screenY - anchor.screenY) * screenClientRatio,
    };
  }
  function calibrateScreenClientRatio(event, moved) {
    const current = { screenX:event.screenX, screenY:event.screenY, clientX:event.clientX, clientY:event.clientY };
    if (![current.screenX, current.screenY, current.clientX, current.clientY].every(Number.isFinite)) return;
    const previous = screenCalibration.get(event.pointerId);
    screenCalibration.set(event.pointerId, current);
    if (!moved || !previous) return;
    const dsX = current.screenX - previous.screenX, dsY = current.screenY - previous.screenY,
      dcX = current.clientX - previous.clientX, dcY = current.clientY - previous.clientY,
      ds2 = dsX * dsX + dsY * dsY;
    if (ds2 < 16) return;
    const candidate = (dcX * dsX + dcY * dsY) / ds2;
    if (!Number.isFinite(candidate) || candidate <= 0.25 || candidate >= 4) return;
    screenClientRatio = Math.min(4, Math.max(0.25, screenClientRatio * 0.7 + candidate * 0.3));
  }
  function releaseWidgetHostTouch(widget, pointerId) {
    const id = widgetHostPointerId(widget, pointerId);
    widgetHostPointerAnchors.delete(id);
    state.pointers.delete(id);
    state.touches.delete(id);
    if (state.panGesture?.id === id) state.panGesture = null;
    if (state.touchGesture?.ids?.includes(id)) state.touchGesture = null;
    if (!state.touches.size) setNavigating(false);
  }
  function beginWidgetHostTouch(widget, message) {
    if (!validWidgetHostTouch(message) || message.type !== "penecho-widget-touch-start") return false;
    const point = widgetHostViewportPoint(widget, message);
    if (!point) return false;
    const id = widgetHostPointerId(widget, message.pointerId);
    state.pointers.set(id, point);
    state.touches.set(id, point);
    widgetHostPointerAnchors.set(id, { clientX:point.x, clientY:point.y, screenX:message.screenX, screenY:message.screenY });
    if (state.touches.size < 2) return true;
    cancelAnimationTouchHold();
    state.textTap = null;
    if (state.pendingGesture) state.pendingGesture = null;
    if (state.widgetGesture) finishWidgetGesture({ pointerId:state.widgetGesture.id });
    if (state.selectedWidgetId) acceptWidgetEdit();
    if (state.animationGesture) finishAnimationGesture({ pointerId:state.animationGesture.id });
    if (state.selectedAnimationId) acceptAnimationEdit();
    finishDrawing("pen");
    beginTouchGesture();
    return true;
  }
  function updateWidgetHostTouch(widget, message) {
    if (!validWidgetHostTouch(message) || message.type !== "penecho-widget-touch-move") return false;
    const id = widgetHostPointerId(widget, message.pointerId),
      old = state.pointers.get(id),
      point = widgetHostTrackedPoint(widgetHostPointerAnchors.get(id), message) || widgetHostViewportPoint(widget, message);
    if (!old || !point || !state.touches.has(id)) return false;
    state.pointers.set(id, point);
    state.touches.set(id, point);
    if (state.touches.size >= 2) {
      if (!state.touchGesture) beginTouchGesture();
      return updateTouchGesture();
    }
    if (!state.panGesture || state.panGesture.id !== id) state.panGesture = { id, last:old };
    moveCanvas(point.x - old.x, point.y - old.y);
    state.panGesture.last = point;
    setNavigating(true);
    return true;
  }
  function finishWidgetHostTouch(widget, message) {
    if (!validWidgetHostTouch(message) || message.type !== "penecho-widget-touch-end") return false;
    const id = widgetHostPointerId(widget, message.pointerId);
    if (!state.pointers.has(id) && !state.touches.has(id)) return false;
    state.pointers.delete(id);
    state.touches.delete(id);
    widgetHostPointerAnchors.delete(id);
    state.touchGesture = null;
    if (state.touches.size === 1) {
      const [remainingId, point] = state.touches.entries().next().value;
      state.panGesture = { id:remainingId, last:point };
    } else state.panGesture = null;
    if (!state.touches.size) setNavigating(false);
    return true;
  }
  function beginWidgetHostDrag(widget, message) {
    if (!validWidgetHostDrag(message) || message.type !== "penecho-widget-drag-start") return false;
    if (message.pointerType === "touch") {
      const id = widgetHostPointerId(widget, message.pointerId);
      if ([...state.touches.keys()].some((pointerId) => pointerId !== id)) return false;
      releaseWidgetHostTouch(widget, message.pointerId);
    }
    if (state.widgetGesture || state.pendingGesture || state.animationGesture || state.selectionGesture || state.drawing || state.panGesture || state.touchGesture) return false;
    const pending = widget === state.pendingWidget && widget.pending === true;
    if (!pending && (!state.widgets.includes(widget) || !beginWidgetEdit(widget))) return false;
    const viewportPoint = widgetHostViewportPoint(widget, message);
    if (!viewportPoint) return false;
    state.widgetGesture = {
      id:widgetHostPointerId(widget, message.pointerId),
      hostPointerId:message.pointerId,
      source:"widget-host",
      widget,
      pending,
      hit:message.hit,
      startPoint:clientPoint({ clientX:viewportPoint.x, clientY:viewportPoint.y }),
      hostAnchor:{ clientX:viewportPoint.x, clientY:viewportPoint.y, screenX:message.screenX, screenY:message.screenY },
      start:widgetLayout(widget),
      changed:false,
    };
    setCanvasCursor(message.hit === "resize" ? "nwse-resize" : message.hit === "width" ? "ew-resize" : message.hit === "height" ? "ns-resize" : "grabbing");
    requestInteractionLayerRender();
    return true;
  }
  function updateWidgetHostDrag(widget, message) {
    const gesture = state.widgetGesture;
    if (!validWidgetHostDrag(message) || !gesture || gesture.source !== "widget-host" || gesture.widget !== widget || gesture.hostPointerId !== message.pointerId) return false;
    const viewportPoint = widgetHostTrackedPoint(gesture.hostAnchor, message) || widgetHostViewportPoint(widget, message);
    if (!viewportPoint) return false;
    return updateWidgetGesturePoint(gesture, clientPoint({ clientX:viewportPoint.x, clientY:viewportPoint.y }));
  }
  function finishWidgetHostDrag(widget, message) {
    const gesture = state.widgetGesture;
    if (!validWidgetHostDrag(message) || message.type !== "penecho-widget-drag-end" || !gesture || gesture.source !== "widget-host" || gesture.widget !== widget || gesture.hostPointerId !== message.pointerId) return false;
    updateWidgetHostDrag(widget, message);
    return finishWidgetGesture({ pointerId:gesture.id });
  }
  function finishWidgetGesture(event) {
    const gesture = state.widgetGesture;
    if (!gesture || gesture.id !== event.pointerId) return false;
    state.widgetGesture = null;
    setCanvasCursor("crosshair");
    if (gesture.changed && !gesture.pending && state.widgetEdit?.id === gesture.widget.id) state.widgetEdit.changed = true;
    if (gesture.changed && (gesture.hit === "width" || gesture.hit === "height")) scheduleWidgetSnapshot(gesture.widget);
    requestInteractionLayerRender();
    return true;
  }
  function deleteWidget(widget) {
    if (!widget || widget.pending || !state.widgets.includes(widget)) return false;
    recordWidgetsBefore();
    unmountWidget(widget);
    state.widgets = state.widgets.filter((item) => item !== widget);
    if (state.selectedWidgetId === widget.id) {
      state.selectedWidgetId = null;
      state.widgetEdit = null;
      state.widgetGesture = null;
    }
    state.userRevision++;
    save();
    requestInteractionLayerRender();
    setStatusKey("widgetDeleted");
    return true;
  }
  function acceptPendingWidget() {
    const widget = state.pendingWidget;
    if (!widget) return;
    if (widget.revision !== state.userRevision) {
      rejectPendingWidget(AI_CANCELLED);
      setStatusKey("canvasChanged");
      return;
    }
    recordWidgetsBefore();
    state.pendingWidget = null;
    widget.pending = false;
    const resolve = widget.resolve;
    widget.resolve = null;
    unmountWidget(widget);
    state.widgets.push(widget);
    mountWidget(widget);
    save();
    requestInteractionLayerRender();
    setStatusKey("merged");
    resolve?.(true);
  }
  function rejectPendingWidget(result = AI_REJECTED) {
    const widget = state.pendingWidget;
    if (!widget) return;
    state.pendingWidget = null;
    const resolve = widget.resolve;
    widget.resolve = null;
    unmountWidget(widget);
    requestInteractionLayerRender();
    setStatusKey(result === AI_CANCELLED ? "canvasChanged" : "draftRejected");
    resolve?.(result);
  }
  function startPendingWidget(command, revision) {
    if (state.pendingWidget || state.widgets.length >= MAX_VISIBLE_WIDGETS) return Promise.resolve(false);
    const widget = widgetRecord({ ...command, id:`widget-${state.nextWidgetId++}` });
    if (!widget || !pluginEnabled(widget.pluginId)) return Promise.resolve(false);
    widget.pending = true;
    widget.revision = revision;
    state.pendingWidget = widget;
    mountWidget(widget);
    requestInteractionLayerRender();
    setStatusKey("draftReady");
    return new Promise((resolve) => (widget.resolve = resolve));
  }
  function widgetBounds(region = null) {
    let bounds = null;
    for (const widget of visibleWidgets(region)) bounds = unionLocalBounds(bounds, region ? intersection(widgetBox(widget), region) : widgetBox(widget));
    return bounds;
  }
  function drawWidgetsToContext(context, region = null) {
    for (const widget of visibleWidgets(region)) {
      if (!widget.snapshotImage) continue;
      context.drawImage(widget.snapshotImage, widget.x, widget.y, widget.w, widget.h);
    }
  }
  async function snapshotVisibleWidgets() {
    for (const widget of visibleWidgets()) await requestWidgetSnapshot(widget);
  }

  function animationBox(animation) {
    return { x: animation.x, y: animation.y, w: animation.w, h: animation.h };
  }
  function createAnimationPlayback(now = performance.now()) {
    return { playheadMs: 0, paused: false, startedAt: now };
  }
  function playbackPlayhead(scene, playback, now = performance.now()) {
    const base = Math.max(0, playback?.playheadMs || 0),
      elapsed = playback?.paused ? 0 : Math.max(0, now - (playback?.startedAt || now)),
      total = base + elapsed,
      duration = Math.max(1, scene.durationMs);
    return scene.loop ? total % duration : Math.min(duration, total);
  }
  function selectedAnimation() {
    return state.animations.find((animation) => animation.id === state.selectedAnimationId) || null;
  }
  function animationPlayhead(animation, now = performance.now()) {
    return playbackPlayhead(animation.scene, animation, now);
  }
  function pendingAnimationEntries(pending = state.pending) {
    if (!pending) return [];
    if (!pending.items) {
      if (!pending.animationScene) return [];
      pending.animationPlayback ||= createAnimationPlayback();
      return [{ kind: "pending", owner: pending, pending, itemIndex: null, scene: pending.animationScene, playback: pending.animationPlayback, box: draftBounds(pending) }];
    }
    return pending.items.flatMap((item, itemIndex) => {
      if (!item.animationScene) return [];
      item.animationPlayback ||= createAnimationPlayback();
      return [{ kind: "pending", owner: item, pending, itemIndex, scene: item.animationScene, playback: item.animationPlayback, box: pendingItemBounds(item) }];
    });
  }
  function pendingAnimationControlTarget() {
    const entries = pendingAnimationEntries();
    if (!entries.length) return null;
    if (!state.pending?.items) return entries[0];
    return entries.find((entry) => entry.itemIndex === state.pending.selectedIndex) || null;
  }
  function animationControlTarget() {
    const pending = pendingAnimationControlTarget();
    if (pending) return pending;
    const animation = selectedAnimation();
    return animation ? { kind: "confirmed", animation, scene: animation.scene, playback: animation, box: animationBox(animation) } : null;
  }
  function animationTargetPlayhead(target, now = performance.now()) {
    return target?.kind === "confirmed" ? animationPlayhead(target.animation, now) : playbackPlayhead(target.scene, target.playback, now);
  }
  function serializedAnimations(now = performance.now()) {
    return state.animations.map((animation) => ({
      id: animation.id,
      rendererVersion: 1,
      transform: animationBox(animation),
      scene: ANIMATION.serialize(animation.scene),
      playback: { playheadMs: animationPlayhead(animation, now), paused: Boolean(animation.paused) },
    }));
  }
  function restoreAnimations(items) {
    state.animations = [];
    state.selectedAnimationId = null;
    state.animationEdit = null;
    hideAnimationControls();
    const now = performance.now(),
      usedIds = new Set();
    for (const saved of Array.isArray(items) ? items : []) {
      if (state.animations.length >= MAX_VISIBLE_ANIMATIONS) break;
      const scene = ANIMATION?.normalize(saved?.scene, SIZE),
        transform = saved?.transform;
      if (!scene || !transform || ![transform.x, transform.y, transform.w, transform.h].every(Number.isFinite) || transform.w <= 0 || transform.h <= 0 || transform.x < 0 || transform.y < 0 || transform.x + transform.w > SIZE || transform.y + transform.h > SIZE) continue;
      const playheadMs = Math.max(0, Math.min(scene.durationMs, Number(saved.playback?.playheadMs) || 0)),
        paused = Boolean(saved.playback?.paused);
      let id = typeof saved.id === "string" && saved.id.length <= 128 && !usedIds.has(saved.id) ? saved.id : "";
      const numberedId = /^animation-(\d+)$/.exec(id);
      if (numberedId) state.nextAnimationId = Math.max(state.nextAnimationId, Number(numberedId[1]) + 1);
      if (!id) {
        do id = "animation-" + state.nextAnimationId++;
        while (usedIds.has(id));
      }
      usedIds.add(id);
      state.animations.push({
        id,
        scene,
        x: transform.x,
        y: transform.y,
        w: transform.w,
        h: transform.h,
        playheadMs,
        paused,
        startedAt: now,
      });
    }
    requestAnimationLayerRender();
  }
  function recordAnimationsBefore() {
    if (!state.animationHistoryBefore) state.animationHistoryBefore = serializedAnimations();
  }
  function beginAnimationEdit(animation) {
    if (!animation) return false;
    if (state.imageEdit) acceptImageEdit();
    if (state.animationEdit?.id === animation.id) return true;
    if (state.animationEdit) acceptAnimationEdit();
    const now = performance.now();
    recordAnimationsBefore();
    state.selectedAnimationId = animation.id;
    state.animationEdit = {
      id: animation.id,
      before: {
        x: animation.x,
        y: animation.y,
        w: animation.w,
        h: animation.h,
        playheadMs: animationPlayhead(animation, now),
        paused: Boolean(animation.paused),
      },
      changed: false,
    };
    return true;
  }
  function acceptAnimationEdit() {
    const edit = state.animationEdit;
    state.animationGesture = null;
    state.animationEdit = null;
    state.selectedAnimationId = null;
    hideAnimationControls();
    if (edit?.changed) {
      state.userRevision++;
      save();
    } else if (edit) state.animationHistoryBefore = null;
    requestAnimationLayerRender();
    requestInteractionLayerRender();
    if (edit) setStatusKey("ready");
    return Boolean(edit);
  }
  function cancelAnimationEdit() {
    const edit = state.animationEdit,
      animation = edit ? state.animations.find((item) => item.id === edit.id) : null;
    if (animation) {
      Object.assign(animation, edit.before, { startedAt: performance.now() });
    }
    state.animationHistoryBefore = null;
    state.animationGesture = null;
    state.animationEdit = null;
    state.selectedAnimationId = null;
    hideAnimationControls();
    requestAnimationLayerRender();
    requestInteractionLayerRender();
    if (edit) setStatusKey("ready");
    return Boolean(edit);
  }
  function addAnimation(scene, transform = scene, playback = null) {
    if (!pluginEnabled("animation") || state.animations.length >= MAX_VISIBLE_ANIMATIONS) return null;
    const normalized = ANIMATION?.normalize(scene, SIZE);
    if (!normalized) return null;
    recordAnimationsBefore();
    const now = performance.now(),
      playheadMs = playback ? playbackPlayhead(normalized, playback, now) : 0,
      paused = Boolean(playback?.paused);
    const animation = {
      id: "animation-" + state.nextAnimationId++,
      scene: normalized,
      x: transform.x,
      y: transform.y,
      w: transform.w,
      h: transform.h,
      playheadMs,
      paused,
      startedAt: now,
    };
    state.animations.push(animation);
    requestAnimationLayerRender();
    return animation;
  }
  function deleteSelectedAnimation() {
    const target = animationControlTarget();
    if (target?.kind === "pending") {
      hideAnimationControls();
      if (target.itemIndex == null) rejectPending();
      else rejectPendingItem(target.itemIndex);
      return;
    }
    const animation = selectedAnimation();
    if (!animation) return;
    recordAnimationsBefore();
    state.animations = state.animations.filter((item) => item !== animation);
    state.selectedAnimationId = null;
    state.animationEdit = null;
    hideAnimationControls();
    state.userRevision++;
    save();
    requestAnimationLayerRender();
    requestInteractionLayerRender();
    setStatusKey("animationDeleted");
  }
  function toggleSelectedAnimationPlayback() {
    const target = animationControlTarget();
    if (!target) return;
    const playback = target.playback;
    if (target.kind === "confirmed") beginAnimationEdit(target.animation);
    const now = performance.now();
    if (playback.paused) {
      playback.paused = false;
      playback.startedAt = now;
    } else {
      playback.playheadMs = animationTargetPlayhead(target, now);
      playback.paused = true;
    }
    if (target.kind === "confirmed" && state.animationEdit) state.animationEdit.changed = true;
    showAnimationControls();
    requestAnimationLayerRender();
    requestInteractionLayerRender();
  }
  function restartSelectedAnimation() {
    const target = animationControlTarget();
    if (!target) return;
    if (target.kind === "confirmed") beginAnimationEdit(target.animation);
    target.playback.playheadMs = 0;
    target.playback.startedAt = performance.now();
    if (target.kind === "confirmed" && state.animationEdit) state.animationEdit.changed = true;
    showAnimationControls();
    requestAnimationLayerRender();
    requestInteractionLayerRender();
  }
  function drawAnimationInstance(context, animation, now) {
    const playhead = animationPlayhead(animation, now);
    context.save();
    context.translate(animation.x, animation.y);
    context.scale(animation.w / animation.scene.w, animation.h / animation.scene.h);
    ANIMATION.render(context, animation.scene, playhead);
    context.restore();
  }
  function visibleAnimations(region = null) {
    if (!pluginEnabled("animation")) return [];
    return state.animations.filter((animation) => !region || intersection(animationBox(animation), region));
  }
  function drawAnimationsToContext(context, region, now = performance.now()) {
    for (const animation of visibleAnimations(region)) drawAnimationInstance(context, animation, now);
  }
  function visiblePlayingAnimations(region = viewportRect()) {
    if (!pluginEnabled("animation") || document.hidden || !region) return [];
    return visibleAnimations(region).filter((animation) => !animation.paused && (animation.scene.loop || animationPlayhead(animation) < animation.scene.durationMs));
  }
  function hideAnimationControls() {
    clearTimeout(state.animationControlsTimer);
    state.animationControlsTimer = 0;
    state.animationControlsUntil = 0;
    if (!animationControls.hidden) animationControls.hidden = true;
    requestInteractionLayerRender();
  }
  function animationControlChromeVisible(target = animationControlTarget(), now = performance.now()) {
    return Boolean(pluginEnabled("animation") && target && state.animationControlsUntil > now);
  }
  function pendingAnimationChromeVisible(pending, itemIndex = null, now = performance.now()) {
    const target = pendingAnimationControlTarget();
    return Boolean(target && target.pending === pending && target.itemIndex === itemIndex && animationControlChromeVisible(target, now));
  }
  function animationEditChromeVisible(now = performance.now()) {
    const target = animationControlTarget();
    return Boolean(target?.kind === "confirmed" && state.animationEdit && selectedAnimation() && animationControlChromeVisible(target, now));
  }
  function expireAnimationControls() {
    hideAnimationControls();
    if (selectedAnimation()) acceptAnimationEdit();
  }
  function showAnimationControls(duration = ANIMATION_CONTROLS_VISIBLE_MS) {
    if (!pluginEnabled("animation") || !animationControlTarget()) {
      hideAnimationControls();
      return;
    }
    clearTimeout(state.animationControlsTimer);
    state.animationControlsUntil = performance.now() + duration;
    if (animationControls.hidden) animationControls.hidden = false;
    positionAnimationControls();
    state.animationControlsTimer = setTimeout(expireAnimationControls, duration);
  }
  function positionAnimationControls() {
    const target = animationControlTarget();
    if (!pluginEnabled("animation") || !target) {
      if (!animationControls.hidden) animationControls.hidden = true;
      return;
    }
    if (performance.now() >= state.animationControlsUntil) {
      if (!animationControls.hidden) animationControls.hidden = true;
      if (target.kind === "confirmed") acceptAnimationEdit();
      return;
    }
    const rect = view.getBoundingClientRect(),
      box = target.box,
      left = state.panX + box.x * state.scale,
      top = state.panY + box.y * state.scale,
      width = box.w * state.scale,
      controlsWidth = animationControls.offsetWidth || 210,
      controlsHeight = animationControls.offsetHeight || 36,
      editControlsClearance = 28,
      controlsStyle = Reflect.get(animationControls, "style"),
      x = Math.max(8, Math.min(rect.width - controlsWidth - 8, left + width / 2 - controlsWidth / 2)),
      y = top - controlsHeight - editControlsClearance >= 8 ? top - controlsHeight - editControlsClearance : Math.min(rect.height - controlsHeight - 8, top + box.h * state.scale + editControlsClearance),
      nextX = Math.round(x) + "px",
      nextY = Math.round(y) + "px",
      nextLabel = t(target.playback.paused ? "animationPlay" : "animationPause");
    if (animationControls.hidden) animationControls.hidden = false;
    if (controlsStyle.getPropertyValue("--animation-controls-x") !== nextX) controlsStyle.setProperty("--animation-controls-x", nextX);
    if (controlsStyle.getPropertyValue("--animation-controls-y") !== nextY) controlsStyle.setProperty("--animation-controls-y", nextY);
    if (animationPlayPause.textContent !== nextLabel) animationPlayPause.textContent = nextLabel;
  }
  function animationScreenBox(animation, padding = 3) {
    const box = animationBox(animation);
    return {
      x: state.panX + box.x * state.scale - padding,
      y: state.panY + box.y * state.scale - padding,
      w: box.w * state.scale + padding * 2,
      h: box.h * state.scale + padding * 2,
    };
  }
  function sameAnimationScreenBox(a, b) {
    return a && b && Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01 && Math.abs(a.w - b.w) < 0.01 && Math.abs(a.h - b.h) < 0.01;
  }
  function clippedScreenBox(box, rect) {
    const left = Math.max(0, box.x),
      top = Math.max(0, box.y),
      right = Math.min(rect.width, box.x + box.w),
      bottom = Math.min(rect.height, box.y + box.h);
    return right > left && bottom > top ? { x: left, y: top, w: right - left, h: bottom - top } : null;
  }
  function mergeAnimationDirtyRects(rects) {
    const merged = [];
    for (const rect of rects) {
      let next = rect;
      for (let index = merged.length - 1; index >= 0; index--) {
        const prior = merged[index],
          touches = next.x <= prior.x + prior.w && next.x + next.w >= prior.x && next.y <= prior.y + prior.h && next.y + next.h >= prior.y;
        if (!touches) continue;
        next = unionLocalBounds(next, prior);
        merged.splice(index, 1);
      }
      merged.push(next);
    }
    return merged;
  }
  function drawAnimationScreenRegion(screenRegion, now) {
    const logicalRegion = {
      x: (screenRegion.x - state.panX) / state.scale,
      y: (screenRegion.y - state.panY) / state.scale,
      w: screenRegion.w / state.scale,
      h: screenRegion.h / state.scale,
    };
    animationCtx.save();
    animationCtx.beginPath();
    animationCtx.rect(screenRegion.x, screenRegion.y, screenRegion.w, screenRegion.h);
    animationCtx.clip();
    animationCtx.translate(state.panX, state.panY);
    animationCtx.scale(state.scale, state.scale);
    animationCtx.beginPath();
    animationCtx.rect(0, 0, SIZE, SIZE);
    animationCtx.clip();
    drawAnimationsToContext(animationCtx, logicalRegion, now);
    animationCtx.restore();
  }
  function clearAnimationLayer() {
    const d = devicePixelRatio || 1,
      rect = view.getBoundingClientRect();
    animationCtx.setTransform(d, 0, 0, d, 0, 0);
    animationCtx.clearRect(0, 0, rect.width, rect.height);
    state.animationScreenBoxes.clear();
    state.animationRenderedPlayheads.clear();
    state.animationFullRedraw = true;
  }
  function renderAnimationLayer(now = performance.now()) {
    if (!pluginEnabled("animation")) {
      clearAnimationLayer();
      return;
    }
    const d = devicePixelRatio || 1,
      rect = view.getBoundingClientRect(),
      visible = viewportRect(),
      animations = visibleAnimations(visible),
      currentBoxes = new Map(animations.map((animation) => [animation.id, animationScreenBox(animation)])),
      currentPlayheads = new Map(animations.map((animation) => [animation.id, animationPlayhead(animation, now)]));
    let dirty = [];
    if (state.animationFullRedraw) dirty.push({ x: 0, y: 0, w: rect.width, h: rect.height });
    else {
      for (const [id, oldBox] of state.animationScreenBoxes) {
        const nextBox = currentBoxes.get(id);
        if (!sameAnimationScreenBox(oldBox, nextBox)) dirty.push(oldBox);
      }
      for (const [id, nextBox] of currentBoxes) {
        const oldBox = state.animationScreenBoxes.get(id),
          previousPlayhead = state.animationRenderedPlayheads.get(id),
          nextPlayhead = currentPlayheads.get(id);
        if (!sameAnimationScreenBox(oldBox, nextBox) || previousPlayhead === undefined || Math.abs(previousPlayhead - nextPlayhead) > 0.01) dirty.push(nextBox);
      }
    }
    dirty = mergeAnimationDirtyRects(dirty.map((box) => clippedScreenBox(box, rect)).filter(Boolean));
    animationCtx.setTransform(d, 0, 0, d, 0, 0);
    for (const region of dirty) {
      animationCtx.clearRect(region.x, region.y, region.w, region.h);
      drawAnimationScreenRegion(region, now);
    }
    state.animationScreenBoxes = currentBoxes;
    state.animationRenderedPlayheads = currentPlayheads;
    state.animationFullRedraw = false;
  }
  function animationFrameStep(now) {
    state.animationFrame = 0;
    const playing = visiblePlayingAnimations(),
      pendingAnimations = pendingAnimationEntries(),
      pendingPlaying = pendingAnimations.filter((entry) => !document.hidden && !entry.playback.paused && (entry.scene.loop || animationTargetPlayhead(entry, now) < entry.scene.durationMs)),
      renderObjectCount = playing.reduce((sum, animation) => sum + animation.scene.objects.length, 0) + pendingPlaying.reduce((sum, entry) => sum + entry.scene.objects.length, 0),
      minimumFrameMs = 1000 / (renderObjectCount > 24 ? 30 : 60);
    if (!playing.length && !pendingPlaying.length || now - state.animationLastFrame >= minimumFrameMs - 0.5) {
      state.animationLastFrame = now;
      renderAnimationLayer(now);
      if (pendingAnimations.length) renderInteractionLayer();
    }
    if (playing.length || pendingPlaying.length) state.animationFrame = requestAnimationFrame(animationFrameStep);
  }
  function requestAnimationLayerRender() {
    if (!pluginEnabled("animation") || state.animationFrame || document.hidden) return;
    state.animationFrame = requestAnimationFrame(animationFrameStep);
  }
  function stopAnimationFrames() {
    if (state.animationFrame) cancelAnimationFrame(state.animationFrame);
    state.animationFrame = 0;
  }
  function requestRender() {
    requestAnimationLayerRender();
    if (state.renderQueued) return;
    state.renderQueued = true;
    requestAnimationFrame(() => {
      state.renderQueued = false;
      render();
    });
  }
  function requestInteractionLayerRender() {
    if (state.interactionRenderQueued) return;
    state.interactionRenderQueued = true;
    requestAnimationFrame(() => {
      state.interactionRenderQueued = false;
      renderInteractionLayer();
    });
  }
  function forTiles(x, y, w, h, fn, create = true) {
    if (w <= 0 || h <= 0) return;
    const x0 = Math.max(0, Math.floor(x / TILE)),
      y0 = Math.max(0, Math.floor(y / TILE)),
      x1 = Math.min(Math.ceil(SIZE / TILE) - 1, Math.ceil((x + w) / TILE) - 1),
      y1 = Math.min(Math.ceil(SIZE / TILE) - 1, Math.ceil((y + h) / TILE) - 1);
    if (x1 < x0 || y1 < y0) return;
    for (let ty = y0; ty <= y1; ty++)
      for (let tx = x0; tx <= x1; tx++) {
        const c = tile(tx, ty, create);
        if (c) fn(c, tx, ty);
      }
  }
  function fit() {
    const r = view.getBoundingClientRect(),
      d = devicePixelRatio || 1;
    screen.width = Math.round(r.width * d);
    screen.height = Math.round(r.height * d);
    animationLayer.width = screen.width;
    animationLayer.height = screen.height;
    interactionLayer.width = screen.width;
    interactionLayer.height = screen.height;
    state.animationFullRedraw = true;
    if (!state.viewInitialized && r.width > 0 && r.height > 0) {
      state.scale = Math.max(0.03, Math.min(2, Math.max(r.width, r.height) / 10000));
      state.panX = (r.width - SIZE * state.scale) / 2;
      state.panY = (r.height - SIZE * state.scale) / 2;
      state.viewInitialized = true;
    }
    updateCoordinates();
    requestRender();
  }
  function updateCoordinates() {
    const r = view.getBoundingClientRect(),
      x = (r.width / 2 - state.panX) / state.scale,
      y = (r.height / 2 - state.panY) / state.scale;
    coords.textContent = `x ${Math.round(x)} · y ${Math.round(y)} · ${Math.round(state.scale * 100)}%`;
  }
  function render() {
    const d = devicePixelRatio || 1,
      r = view.getBoundingClientRect();
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.clearRect(0, 0, r.width, r.height);
    ctx.fillStyle = state.paint.outside;
    ctx.fillRect(0, 0, r.width, r.height);
    ctx.save();
    ctx.translate(state.panX, state.panY);
    ctx.scale(state.scale, state.scale);
    ctx.fillStyle = state.paint.paper;
    ctx.fillRect(0, 0, SIZE, SIZE);
    const l = Math.max(0, -state.panX / state.scale),
      t = Math.max(0, -state.panY / state.scale),
      rr = Math.min(SIZE, (r.width - state.panX) / state.scale),
      b = Math.min(SIZE, (r.height - state.panY) / state.scale);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, SIZE, SIZE);
    ctx.clip();
    if (state.gridVisible) {
      ctx.strokeStyle = state.paint.paperGrid;
      ctx.lineWidth = 1 / state.scale;
      ctx.beginPath();
      for (let x = Math.floor(l / 500) * 500; x < rr; x += 500) {
        ctx.moveTo(x, t);
        ctx.lineTo(x, b);
      }
      for (let y = Math.floor(t / 500) * 500; y < b; y += 500) {
        ctx.moveTo(l, y);
        ctx.lineTo(rr, y);
      }
      ctx.stroke();
    }
    drawImagesToContext(ctx, { x:l, y:t, w:rr - l, h:b - t });
    forTiles(l, t, rr - l, b - t, (c, tx, ty) => ctx.drawImage(c, tx * TILE, ty * TILE), false);
    drawSharpOverlays(ctx, { x: l, y: t, w: rr - l, h: b - t });
    ctx.restore();
    ctx.strokeStyle = state.paint.border;
    ctx.lineWidth = 2 / state.scale;
    ctx.strokeRect(0, 0, SIZE, SIZE);
    ctx.restore();
    renderInteractionLayer();
    positionWidgets();
    positionTextEditors();
    updateSelectionToolbar();
  }
  function drawSelectedAnimation(context) {
    const selected = pluginEnabled("animation") && animationEditChromeVisible() ? selectedAnimation() : null;
    if (!selected) return;
    const box = animationBox(selected),
      unit = 1 / state.scale,
      handle = 14 * unit;
    context.save();
    context.strokeStyle = "#2679b8";
    context.lineWidth = 2 * unit;
    context.setLineDash([7 * unit, 6 * unit]);
    context.strokeRect(box.x, box.y, box.w, box.h);
    context.setLineDash([]);
    drawDraftActions(context, box, handle, false, true);
    context.beginPath();
    drawResizeHandle(context, box, handle);
    context.moveTo(box.x + box.w + handle * 0.08, box.y + box.h / 2 - handle * 0.48);
    context.lineTo(box.x + box.w + handle * 0.08, box.y + box.h / 2 + handle * 0.48);
    context.moveTo(box.x + box.w / 2 - handle * 0.48, box.y + box.h + handle * 0.08);
    context.lineTo(box.x + box.w / 2 + handle * 0.48, box.y + box.h + handle * 0.08);
    context.stroke();
    context.restore();
  }
  function drawWidgetChrome(context) {
    if (!widgetRuntimeEnabled()) return;
    const widget = state.pendingWidget || (state.widgetEdit ? selectedWidget() : null);
    if (!widget) return;
    const box = widgetBox(widget),
      unit = 1 / state.scale,
      handle = 14 * unit;
    context.save();
    context.strokeStyle = widget.pending ? "#72b7e5" : "#2679b8";
    context.lineWidth = 2 * unit;
    context.setLineDash([7 * unit, 6 * unit]);
    context.strokeRect(box.x, box.y, box.w, box.h);
    context.setLineDash([]);
    drawDraftActions(context, box, handle, false, true);
    context.beginPath();
    drawResizeHandle(context, box, handle);
    context.moveTo(box.x + box.w + handle * 0.08, box.y + box.h / 2 - handle * 0.48);
    context.lineTo(box.x + box.w + handle * 0.08, box.y + box.h / 2 + handle * 0.48);
    context.moveTo(box.x + box.w / 2 - handle * 0.48, box.y + box.h + handle * 0.08);
    context.lineTo(box.x + box.w / 2 + handle * 0.48, box.y + box.h + handle * 0.08);
    context.stroke();
    context.restore();
  }
  function positionImageEditBar() {
    const item = state.imageEdit ? selectedImage() : null;
    if (!item) {
      if (!imageEditBar.hidden) imageEditBar.hidden = true;
      return;
    }
    if (imageEditBar.hidden) imageEditBar.hidden = false;
    const rect = view.getBoundingClientRect(),
      box = imageBox(item),
      left = state.panX + box.x * state.scale,
      top = state.panY + box.y * state.scale,
      width = box.w * state.scale,
      height = box.h * state.scale,
      barWidth = imageEditBar.offsetWidth || 200,
      barHeight = imageEditBar.offsetHeight || 210,
      gap = 12,
      style = Reflect.get(imageEditBar, "style");
    let x = left + width + gap;
    if (x + barWidth > rect.width - 8) x = left - barWidth - gap;
    if (x < 8) x = Math.max(8, Math.min(rect.width - barWidth - 8, left + width / 2 - barWidth / 2));
    const y = Math.max(8, Math.min(rect.height - barHeight - 8, top + height / 2 - barHeight / 2));
    style.setProperty("--image-edit-bar-x", `${x.toFixed(1)}px`);
    style.setProperty("--image-edit-bar-y", `${y.toFixed(1)}px`);
  }
  function drawImageChrome(context) {
    const item = state.imageEdit ? selectedImage() : null;
    if (!item) return;
    const box = imageBox(item),
      unit = 1 / state.scale,
      handle = 14 * unit;
    context.save();
    context.strokeStyle = "#2679b8";
    context.lineWidth = 2 * unit;
    context.setLineDash([7 * unit, 6 * unit]);
    context.strokeRect(box.x, box.y, box.w, box.h);
    context.setLineDash([]);
    context.beginPath();
    drawResizeHandle(context, box, handle);
    context.moveTo(box.x + box.w + handle * 0.08, box.y + box.h / 2 - handle * 0.48);
    context.lineTo(box.x + box.w + handle * 0.08, box.y + box.h / 2 + handle * 0.48);
    context.moveTo(box.x + box.w / 2 - handle * 0.48, box.y + box.h + handle * 0.08);
    context.lineTo(box.x + box.w / 2 + handle * 0.48, box.y + box.h + handle * 0.08);
    context.stroke();
    context.restore();
  }
  function renderInteractionLayer() {
    const d = devicePixelRatio || 1,
      r = view.getBoundingClientRect();
    interactionCtx.setTransform(d, 0, 0, d, 0, 0);
    interactionCtx.clearRect(0, 0, r.width, r.height);
    interactionCtx.save();
    interactionCtx.translate(state.panX, state.panY);
    interactionCtx.scale(state.scale, state.scale);
    interactionCtx.beginPath();
    interactionCtx.rect(0, 0, SIZE, SIZE);
    interactionCtx.clip();
    if (state.drawing?.preview) drawPreview(state.drawing.preview, interactionCtx);
    if (state.selection) drawSelection(state.selection, interactionCtx);
    drawSelectedAnimation(interactionCtx);
    if (state.pending) {
      interactionCtx.save();
      interactionCtx.globalAlpha = 1 - (state.pending.fadeProgress || 0);
      drawPending(state.pending, interactionCtx);
      interactionCtx.restore();
    }
    drawWidgetChrome(interactionCtx);
    drawImageChrome(interactionCtx);
    interactionCtx.restore();
    positionAnimationControls();
    positionImageEditBar();
  }
  function clientPoint(e) {
    const r = view.getBoundingClientRect();
    return {
      x: (e.clientX - r.left - state.panX) / state.scale,
      y: (e.clientY - r.top - state.panY) / state.scale,
    };
  }
  function blockCanvasInput(duration = 1000) {
    state.textInputBlockedUntil = Math.max(state.textInputBlockedUntil, Date.now() + duration);
    setCanvasCursor("crosshair");
  }
  function mergeDirtyBox(box) {
    if (!box) return;
    if (!state.dirty) {
      state.dirty = { ...box };
      return;
    }
    const right = Math.max(state.dirty.x + state.dirty.w, box.x + box.w),
      bottom = Math.max(state.dirty.y + state.dirty.h, box.y + box.h);
    state.dirty = {
      x: Math.min(state.dirty.x, box.x),
      y: Math.min(state.dirty.y, box.y),
      w: right - Math.min(state.dirty.x, box.x),
      h: bottom - Math.min(state.dirty.y, box.y),
    };
  }
  function textEditorScreenPoint(editor) {
    return { left: editor.x * state.scale + state.panX, top: editor.y * state.scale + state.panY };
  }
  function textEditorViewportSize() {
    const rect = view.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }
  function resizeTextEditorDimensions(gesture, hit, dx, dy, minWidth, minHeight, maxWidth, maxHeight) {
    const startWidth = gesture.startWidth,
      startHeight = gesture.startHeight,
      startFontCss = gesture.startFontCss;
    if (hit === "width") {
      return { widthCss: Math.max(minWidth, Math.min(maxWidth, startWidth + dx)), heightCss: startHeight, fontCss: startFontCss };
    }
    if (hit === "height") {
      return { widthCss: startWidth, heightCss: Math.max(minHeight, Math.min(maxHeight, startHeight + dy)), fontCss: startFontCss };
    }
    const minimumScale = Math.max(minWidth / startWidth, minHeight / startHeight),
      maximumScale = Math.max(minimumScale, Math.min(maxWidth / startWidth, maxHeight / startHeight)),
      requestedScale = Math.max((startWidth + dx) / startWidth, (startHeight + dy) / startHeight),
      scale = Math.max(minimumScale, Math.min(maximumScale, requestedScale));
    return { widthCss: startWidth * scale, heightCss: startHeight * scale, fontCss: startFontCss * scale };
  }
  function keepTextEditorInsideCanvas(editor) {
    const logicalWidth = editor.widthCss / Math.max(0.03, state.scale),
      logicalHeight = editor.heightCss / Math.max(0.03, state.scale);
    editor.x = Math.max(0, Math.min(SIZE - logicalWidth, editor.x));
    editor.y = Math.max(0, Math.min(SIZE - logicalHeight, editor.y));
  }
  function keepTextEditorVisible(editor) {
    const viewport = textEditorViewportSize(),
      inset = 8,
      scale = Math.max(0.03, state.scale),
      point = textEditorScreenPoint(editor),
      maxLeft = Math.max(inset, viewport.width - editor.widthCss - inset),
      maxTop = Math.max(inset, viewport.height - editor.heightCss - inset),
      canvasLeft = state.panX,
      canvasTop = state.panY,
      canvasRight = state.panX + SIZE * scale - editor.widthCss,
      canvasBottom = state.panY + SIZE * scale - editor.heightCss,
      minLeft = Math.max(inset, canvasLeft),
      minTop = Math.max(inset, canvasTop),
      boundedMaxLeft = Math.min(maxLeft, canvasRight),
      boundedMaxTop = Math.min(maxTop, canvasBottom),
      left = boundedMaxLeft >= minLeft ? Math.min(boundedMaxLeft, Math.max(minLeft, point.left)) : Math.min(maxLeft, Math.max(inset, point.left)),
      top = boundedMaxTop >= minTop ? Math.min(boundedMaxTop, Math.max(minTop, point.top)) : Math.min(maxTop, Math.max(inset, point.top));
    if (Math.abs(left - point.left) > 0.5) editor.x = (left - state.panX) / scale;
    if (Math.abs(top - point.top) > 0.5) editor.y = (top - state.panY) / scale;
    keepTextEditorInsideCanvas(editor);
  }
  function positionTextEditors() {
    const visible = state.textEditors.size > 0;
    textEditorLayer.hidden = !visible;
    textInputHint.hidden = !visible;
    for (const editor of state.textEditors.values()) {
      keepTextEditorInsideCanvas(editor);
      keepTextEditorVisible(editor);
      const point = textEditorScreenPoint(editor),
        active = editor.id === state.activeTextEditorId,
        declaration = editor.styleRule?.["style"];
      if (declaration) {
        declaration.left = `${Math.round(point.left)}px`;
        declaration.top = `${Math.round(point.top)}px`;
        declaration.width = `${Math.round(editor.widthCss)}px`;
        declaration.height = `${Math.round(editor.heightCss)}px`;
        declaration.zIndex = String(editor.zIndex || 1);
        declaration.setProperty("--text-editor-font-size", `${editor.fontCss}px`);
        declaration.setProperty("--text-editor-ink", state.inkColor);
        if (editor.previewLogicalWidth) declaration.setProperty("--text-editor-preview-width", `${editor.previewLogicalWidth}px`);
        else declaration.removeProperty("--text-editor-preview-width");
        if (editor.previewLogicalHeight) declaration.setProperty("--text-editor-preview-height", `${editor.previewLogicalHeight}px`);
        else declaration.removeProperty("--text-editor-preview-height");
      }
      editor.element.classList.toggle("active", active);
    }
  }
  function textEditorStyleSheet() {
    if (state.textEditorStyleSheet) return state.textEditorStyleSheet;
    state.textEditorStyleSheet = [...document.styleSheets].find((sheet) => /(?:^|\/)style\.css(?:\?|$)/.test(sheet.href || "")) || null;
    return state.textEditorStyleSheet;
  }
  function addTextEditorStyleRule(editor) {
    const sheet = textEditorStyleSheet();
    if (!sheet) return;
    const className = `text-editor-instance-${editor.id}`;
    editor.element.classList.add(className);
    try {
      sheet.insertRule(`.${className} { left: 0px; top: 0px; width: ${Math.round(editor.widthCss)}px; height: ${Math.round(editor.heightCss)}px; }`, sheet.cssRules.length);
      editor.styleRule = [...sheet.cssRules].find((rule) => rule.selectorText === `.${className}`) || null;
    } catch {
      editor.styleRule = null;
    }
  }
  function removeTextEditorStyleRule(editor) {
    const rule = editor?.styleRule,
      sheet = textEditorStyleSheet();
    if (!rule || !sheet) return;
    const index = [...sheet.cssRules].indexOf(rule);
    if (index >= 0) {
      try { sheet.deleteRule(index); } catch {}
    }
    editor.styleRule = null;
  }
  function focusTextEditor(editor, input = false) {
    if (!editor) return;
    state.activeTextEditorId = editor.id;
    editor.zIndex = ++state.nextTextEditorZ;
    positionTextEditors();
    if (input && !editor.textarea.hidden) editor.textarea.focus({ preventScroll: true });
  }
  function textEditorPointerDown(event, editor, hit) {
    event.preventDefault();
    event.stopPropagation();
    focusTextEditor(editor, hit === "body");
    if (hit === "body") return;
    editor.gesture = {
      id: event.pointerId,
      hit,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: editor.x,
      startY: editor.y,
      startWidth: editor.widthCss,
      startHeight: editor.heightCss,
      startFontCss: editor.fontCss,
    };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch {}
  }
  function updateTextEditorGesture(event, editor) {
    const gesture = editor.gesture;
    if (!gesture || gesture.id !== event.pointerId) return;
    const dx = event.clientX - gesture.startClientX,
      dy = event.clientY - gesture.startClientY,
      viewport = textEditorViewportSize();
    if (gesture.hit === "move") {
      editor.x = gesture.startX + dx / Math.max(0.03, state.scale);
      editor.y = gesture.startY + dy / Math.max(0.03, state.scale);
    } else {
      const point = textEditorScreenPoint(editor),
        maxWidth = Math.max(TEXT_EDITOR_MIN_WIDTH, viewport.width - Math.max(8, point.left) - 8),
        maxHeight = Math.max(TEXT_EDITOR_MIN_HEIGHT, viewport.height - Math.max(8, point.top) - 8),
        next = resizeTextEditorDimensions(gesture, gesture.hit, dx, dy, TEXT_EDITOR_MIN_WIDTH, TEXT_EDITOR_MIN_HEIGHT, maxWidth, maxHeight);
      editor.widthCss = next.widthCss;
      editor.heightCss = next.heightCss;
      editor.fontCss = next.fontCss;
      if (editor.mixedMode && (gesture.hit === "width" || gesture.hit === "corner")) scheduleTextEditorPreview(editor);
    }
    positionTextEditors();
  }
  function finishTextEditorGesture(event, editor) {
    if (editor.gesture?.id !== event.pointerId) return;
    const hit = editor.gesture.hit;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch {}
    editor.gesture = null;
    if (editor.mixedMode && (hit === "width" || hit === "corner")) scheduleTextEditorPreview(editor, 0);
  }
  function textEditorButton(button, key, className) {
    button.type = "button";
    button.className = `text-editor-button ${className || ""}`;
    button.dataset.i18nTitle = key;
    button.dataset.i18nAria = key;
    button.setAttribute("aria-label", t(key));
    button.setAttribute("title", t(key));
    if (className === "confirm") button.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m4.5 10.3 3.4 3.4 7.8-8"/></svg>';
    else if (className === "cancel") button.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5.5 5.5 14.5 14.5M14.5 5.5 5.5 14.5"/></svg>';
    else button.textContent = t(key);
    return button;
  }
  function removeTextEditor(editor) {
    if (!editor) return;
    editor.cancelled = true;
    cancelTextEditorPreview(editor, true);
    removeTextEditorStyleRule(editor);
    editor.element.remove();
    state.textEditors.delete(editor.id);
    if (state.activeTextEditorId === editor.id) {
      const next = state.textEditors.values().next().value || null;
      if (next) focusTextEditor(next);
      else state.activeTextEditorId = null;
    }
    positionTextEditors();
  }
  function clearTextEditors() {
    for (const editor of state.textEditors.values()) {
      editor.cancelled = true;
      cancelTextEditorPreview(editor, true);
      removeTextEditorStyleRule(editor);
      editor.element.remove();
    }
    state.textEditors.clear();
    state.activeTextEditorId = null;
    state.textTap = null;
    positionTextEditors();
  }
  function cancelTextEditorPreview(editor, clear = false) {
    if (!editor) return;
    clearTimeout(editor.previewTimer);
    editor.previewTimer = 0;
    editor.previewRevision++;
    if (!clear || !editor.preview) return;
    editor.preview.replaceChildren();
    editor.preview.removeAttribute("aria-busy");
    editor.preview.removeAttribute("data-fallback");
    editor.previewLogicalWidth = 0;
    editor.previewLogicalHeight = 0;
  }
  async function renderTextEditorPreview(editor) {
    if (!editor || !editor.mixedMode || editor.committing || editor.cancelled || state.textEditors.get(editor.id) !== editor) return;
    const revision = ++editor.previewRevision,
      text = editor.textarea.value,
      fontCss = editor.fontCss,
      maxWidth = Math.max(fontCss * 3, editor.widthCss - 16),
      color = state.inkColor;
    editor.preview.setAttribute("aria-busy", "true");
    let image,
      fallback = false;
    try {
      image = await mixedTextImage(text, fontCss, color, maxWidth, 1.35, TEXT_EDITOR_FONT_FAMILY, Math.min(3, devicePixelRatio || 1));
    } catch {
      image = textImage(text, fontCss, color, maxWidth, 1.35, TEXT_EDITOR_FONT_FAMILY, TEXT_INPUT_MAX_LENGTH, Math.min(3, devicePixelRatio || 1));
      fallback = true;
    }
    if (editor.cancelled || editor.committing || !editor.mixedMode || editor.previewRevision !== revision || state.textEditors.get(editor.id) !== editor) return;
    image.classList.add("text-editor-preview-canvas");
    editor.previewLogicalWidth = image.logicalWidth || image.width;
    editor.previewLogicalHeight = image.logicalHeight || image.height;
    editor.preview.replaceChildren(image);
    editor.preview.toggleAttribute("data-fallback", fallback);
    editor.preview.setAttribute("aria-label", text || t("textPreview"));
    editor.preview.setAttribute("aria-busy", "false");
    positionTextEditors();
  }
  function scheduleTextEditorPreview(editor, delay = TEXT_EDITOR_PREVIEW_INTERVAL_MS) {
    if (!editor?.mixedMode || editor.committing || editor.cancelled) return;
    if (delay > 0 && editor.previewTimer) return;
    clearTimeout(editor.previewTimer);
    editor.previewTimer = setTimeout(() => {
      editor.previewTimer = 0;
      void renderTextEditorPreview(editor);
    }, Math.max(0, delay));
  }
  function updateTextEditorMixedMode(editor) {
    const button = editor?.mixedModeButton;
    if (!button) return;
    const labelKey = editor.mixedMode ? "textEditMode" : "textMixedMode";
    button.classList.toggle("active", editor.mixedMode);
    button.setAttribute("aria-pressed", String(editor.mixedMode));
    button.dataset.i18nTitle = labelKey;
    button.dataset.i18nAria = labelKey;
    button.setAttribute("aria-label", t(labelKey));
    button.setAttribute("title", t(labelKey));
    editor.element.classList.toggle("previewing", editor.mixedMode);
    editor.textarea.hidden = editor.mixedMode;
    editor.preview.hidden = !editor.mixedMode;
  }
  function toggleTextEditorMixedMode(editor) {
    if (!editor || editor.committing) return;
    editor.mixedMode = !editor.mixedMode;
    updateTextEditorMixedMode(editor);
    if (editor.mixedMode) {
      focusTextEditor(editor);
      scheduleTextEditorPreview(editor, 0);
      editor.preview.focus({ preventScroll: true });
    } else {
      cancelTextEditorPreview(editor, true);
      focusTextEditor(editor, true);
    }
  }
  function openTextHelp(editor, invoker) {
    const dialog = document.querySelector("#textHelpDialog");
    if (!dialog) return;
    if (editor && state.textEditors.get(editor.id) === editor) focusTextEditor(editor);
    textHelpInvoker = invoker || null;
    if (!dialog.open) dialog.showModal();
  }
  function closeTextHelp() {
    const dialog = document.querySelector("#textHelpDialog");
    if (dialog?.open) dialog.close();
  }
  function restoreTextEditorAfterHelp() {
    blockCanvasInput(300);
    const invoker = textHelpInvoker;
    textHelpInvoker = null;
    if (invoker?.isConnected && !invoker.disabled) invoker.focus({ preventScroll: true });
  }
  function textEditorContentOffset(editor) {
    const body = editor?.body || editor?.element?.querySelector(".text-editor-body"),
      left = body?.offsetLeft || 0,
      top = body?.offsetTop || 28;
    return { x: left + 8, y: top + 8 };
  }

  async function confirmTextEditor(editor) {
    if (!editor || editor.committing) return;
    const text = editor.textarea.value;
    if (!text.trim()) {
      setStatusKey("textEmpty");
      return;
    }
    editor.committing = true;
    editor.cancelled = false;
    cancelTextEditorPreview(editor);
    blockCanvasInput(TEXT_INPUT_GUARD_MS);
    setCanvasMode("pen");
    supersedeActiveAI("text-input-confirmed");
    clearTimeout(state.timer);
    state.timer = 0;
    editor.element.querySelectorAll("button").forEach((button) => (button.disabled = true));
    const contentOffset = textEditorContentOffset(editor),
      editorScale = Math.max(0.03, state.scale);
    editor.x += contentOffset.x / editorScale;
    editor.y += contentOffset.y / editorScale;
    editor.mixedMode = true;
    const fontSize = editor.fontCss / Math.max(0.03, state.scale),
      maxWidth = Math.max(fontSize * 3, (editor.widthCss - 16) / Math.max(0.03, state.scale)),
      x = editor.x,
      y = editor.y;
    let image,
      mixedFallback = false;
    try {
      image = editor.mixedMode
        ? await mixedTextImage(text, fontSize, state.inkColor, maxWidth, 1.35, TEXT_EDITOR_FONT_FAMILY)
        : textImage(text, fontSize, state.inkColor, maxWidth, 1.35, TEXT_EDITOR_FONT_FAMILY, TEXT_INPUT_MAX_LENGTH);
    } catch {
      image = textImage(text, fontSize, state.inkColor, maxWidth, 1.35, TEXT_EDITOR_FONT_FAMILY, TEXT_INPUT_MAX_LENGTH);
      mixedFallback = editor.mixedMode;
    }
    if (editor.cancelled || state.textEditors.get(editor.id) !== editor) return;
    const width = image.logicalWidth || image.width,
      height = image.logicalHeight || image.height,
      box = { x, y, w: width, h: height };
    state.userRevision++;
    blitSized(image, x, y, width, height);
    retainSharpOverlay(image, box);
    mergeDirtyBox(box);
    state.latestTypedInput = { text: text.slice(0, TEXT_INPUT_MAX_LENGTH), box };
    state.hotspotTrail.push({ x: x + width / 2, y: y + height / 2 });
    if (state.hotspotTrail.length > 512) state.hotspotTrail.splice(0, state.hotspotTrail.length - 512);
    state.autoEligible = true;
    removeTextEditor(editor);
    blockCanvasInput(TEXT_INPUT_GUARD_MS);
    save();
    render();
    setStatusKey(mixedFallback ? "textMixedModeError" : "ready");
    if (state.auto) schedule(Math.max(1000, state.autoDelayMs));
  }
  function cancelTextEditor(editor) {
    if (!editor || editor.committing) return;
    removeTextEditor(editor);
    blockCanvasInput(TEXT_INPUT_GUARD_MS);
    setCanvasMode("pen");
    setStatusKey("ready");
    if (!state.textEditors.size && state.auto && state.autoEligible) schedule(Math.max(1000, state.autoDelayMs));
  }
  function createTextEditor(point) {
    supersedeActiveAI("text-input-started");
    if (!state.timer && state.auto && state.dirty && state.autoEligible) schedule();
    const viewport = textEditorViewportSize(),
      widthCss = Math.min(TEXT_EDITOR_DEFAULT_WIDTH, Math.max(TEXT_EDITOR_MIN_WIDTH, viewport.width - 24)),
      heightCss = Math.min(TEXT_EDITOR_DEFAULT_HEIGHT, Math.max(TEXT_EDITOR_MIN_HEIGHT, viewport.height - 24)),
      editor = {
        id: state.nextTextEditorId++,
        x: point.x,
        y: point.y,
        widthCss,
        heightCss,
        fontCss: TEXT_EDITOR_FONT_CSS,
        zIndex: 1,
        mixedMode: false,
        previewRevision: 0,
        previewTimer: 0,
        previewLogicalWidth: 0,
        previewLogicalHeight: 0,
        committing: false,
        cancelled: false,
        gesture: null,
      },
      root = document.createElement("section"),
      header = document.createElement("header"),
      title = document.createElement("span"),
      mixedModeButton = document.createElement("button"),
      body = document.createElement("div"),
      textarea = document.createElement("textarea"),
      preview = document.createElement("div");
    const helpButton = textEditorButton(document.createElement("button"), "textHelp", "help"),
      acceptButton = textEditorButton(document.createElement("button"), "textConfirm", "confirm"),
      cancelButton = textEditorButton(document.createElement("button"), "textCancel", "cancel");
    editor.element = root;
    editor.textarea = textarea;
    editor.preview = preview;
    editor.body = body;
    editor.mixedModeButton = mixedModeButton;
    root.className = "text-editor active";
    root.dataset.editorId = String(editor.id);
    root.dataset.i18nAria = "text";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", t("text"));
    header.className = "text-editor-header";
    title.className = "text-editor-title";
    title.dataset.i18n = "text";
    title.textContent = t("text");
    mixedModeButton.className = "text-editor-button mixed-mode";
    mixedModeButton.type = "button";
    mixedModeButton.dataset.i18n = "textMixedModeShort";
    mixedModeButton.dataset.i18nTitle = "textMixedMode";
    mixedModeButton.dataset.i18nAria = "textMixedMode";
    mixedModeButton.textContent = t("textMixedModeShort");
    mixedModeButton.setAttribute("aria-label", t("textMixedMode"));
    mixedModeButton.setAttribute("title", t("textMixedMode"));
    mixedModeButton.setAttribute("aria-pressed", "false");
    preview.id = `textEditorPreview${editor.id}`;
    mixedModeButton.setAttribute("aria-controls", preview.id);
    helpButton.textContent = "?";
    helpButton.setAttribute("aria-haspopup", "dialog");
    helpButton.setAttribute("aria-controls", "textHelpDialog");
    acceptButton.textContent = "✓";
    cancelButton.textContent = "×";
    header.append(title, helpButton, mixedModeButton, acceptButton, cancelButton);
    body.className = "text-editor-body";
    textarea.className = "text-editor-input";
    textarea.rows = 4;
    textarea.maxLength = TEXT_INPUT_MAX_LENGTH;
    textarea.dataset.i18nPlaceholder = "textPlaceholder";
    textarea.dataset.i18nAria = "text";
    textarea.placeholder = t("textPlaceholder");
    textarea.setAttribute("aria-label", t("text"));
    preview.className = "text-editor-preview";
    preview.hidden = true;
    preview.tabIndex = 0;
    preview.setAttribute("role", "region");
    preview.setAttribute("aria-label", t("textPreview"));
    body.append(textarea, preview);
    root.append(header, body);
    for (const kind of ["width", "height", "corner"]) {
      const handle = document.createElement("span");
      handle.className = `text-editor-handle ${kind}`;
      handle.dataset.textHandle = kind;
      root.append(handle);
      handle.addEventListener("pointerdown", (event) => textEditorPointerDown(event, editor, kind));
    }
    header.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button")) return;
      textEditorPointerDown(event, editor, "move");
    });
    root.addEventListener("pointerdown", (event) => {
      if (event.target === textarea || event.target.closest("button") || event.target.closest(".text-editor-preview") || event.target.closest(".text-editor-handle")) return;
      textEditorPointerDown(event, editor, "body");
    });
    root.addEventListener("pointermove", (event) => updateTextEditorGesture(event, editor));
    root.addEventListener("pointerup", (event) => finishTextEditorGesture(event, editor));
    root.addEventListener("pointercancel", (event) => finishTextEditorGesture(event, editor));
    textarea.addEventListener("focus", () => focusTextEditor(editor));
    textarea.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !event.isComposing) {
        event.preventDefault();
        confirmTextEditor(editor);
      } else if (event.key === "Escape") {
        event.preventDefault();
        cancelTextEditor(editor);
      }
    });
    preview.addEventListener("focus", () => focusTextEditor(editor));
    preview.addEventListener("pointerdown", () => focusTextEditor(editor));
    preview.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !event.isComposing) {
        event.preventDefault();
        confirmTextEditor(editor);
      } else if (event.key === "Escape") {
        event.preventDefault();
        cancelTextEditor(editor);
      }
    });
    helpButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openTextHelp(editor, helpButton);
    });
    mixedModeButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleTextEditorMixedMode(editor);
    });
    acceptButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      confirmTextEditor(editor);
    });
    cancelButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      cancelTextEditor(editor);
    });
    textEditorLayer.append(root);
    addTextEditorStyleRule(editor);
    updateTextEditorMixedMode(editor);
    keepTextEditorInsideCanvas(editor);
    state.textEditors.set(editor.id, editor);
    focusTextEditor(editor, true);
    positionTextEditors();
    return editor;
  }
  function setCanvasCursor(cursor) {
    screen.classList.remove("cursor-crosshair", "cursor-grab", "cursor-grabbing", "cursor-nwse-resize", "cursor-ew-resize", "cursor-ns-resize");
    screen.classList.add(`cursor-${cursor}`);
  }
  function beginTouchGesture() {
    if (state.touches.size < 2) return;
    const ids = [...state.touches.keys()].slice(0, 2),
      points = ids.map((id) => state.touches.get(id));
    state.touchGesture = {
      ids,
      center: {
        x: (points[0].x + points[1].x) / 2,
        y: (points[0].y + points[1].y) / 2,
      },
      distance: Math.max(1, Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)),
      scale: state.scale,
      panX: state.panX,
      panY: state.panY,
    };
    state.panGesture = null;
  }
  function updateTouchGesture() {
    const g = state.touchGesture;
    if (!g) return false;
    const points = g.ids.map((id) => state.touches.get(id));
    if (points.some((p) => !p)) return false;
    const center = {
        x: (points[0].x + points[1].x) / 2,
        y: (points[0].y + points[1].y) / 2,
      },
      distance = Math.max(1, Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)),
      r = view.getBoundingClientRect(),
      next = Math.max(0.03, Math.min(2, (g.scale * distance) / g.distance)),
      anchorX = (g.center.x - r.left - g.panX) / g.scale,
      anchorY = (g.center.y - r.top - g.panY) / g.scale;
    state.scale = next;
    state.panX = center.x - r.left - anchorX * next;
    state.panY = center.y - r.top - anchorY * next;
    updateCoordinates();
    setNavigating(true);
    render();
    return true;
  }
  function moveCanvas(dx, dy) {
    state.panX += dx;
    state.panY += dy;
    updateCoordinates();
    requestRender();
  }
  function valid(p) {
    return p.x >= 0 && p.x <= SIZE && p.y >= 0 && p.y <= SIZE;
  }
  function mergeDirty(x, y, p = 10) {
    const a = {
      x: Math.max(0, x - p),
      y: Math.max(0, y - p),
      w: Math.min(SIZE, x + p) - Math.max(0, x - p),
      h: Math.min(SIZE, y + p) - Math.max(0, y - p),
    };
    if (!state.dirty) state.dirty = a;
    else {
      const b = state.dirty,
        x1 = Math.min(a.x, b.x),
        y1 = Math.min(a.y, b.y),
        x2 = Math.max(a.x + a.w, b.x + b.w),
        y2 = Math.max(a.y + a.h, b.y + b.h);
      state.dirty = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    }
  }
  function restoreDirty(box) {
    if (!box) return;
    if (!state.dirty) {
      state.dirty = box;
      return;
    }
    const x = Math.min(box.x, state.dirty.x),
      y = Math.min(box.y, state.dirty.y),
      right = Math.max(box.x + box.w, state.dirty.x + state.dirty.w),
      bottom = Math.max(box.y + box.h, state.dirty.y + state.dirty.h);
    state.dirty = { x, y, w: right - x, h: bottom - y };
  }
  function discardUncapturableInput(hotspotCount, usedDirty) {
    if (hotspotCount) state.hotspotTrail.splice(0, hotspotCount);
    state.dirty = null;
    state.autoEligible = false;
    if (!usedDirty) state.lastUserBox = null;
  }
  function invalidateRecognition() {
    const active=state.activeAI;
    if(active&&!active.superseded){active.superseded=true;active.dirtyRestored=true;active.controller.abort();if(state.activeAI===active){state.activeAI=null;setBusy(false)}}
    clearTimeout(state.timer);
    state.timer = 0;
    state.recognitionGeneration++;
    state.hotspotTrail = [];
    state.dirty = null;
    state.autoEligible = false;
    state.lastUserBox = null;
  }
  function cloneCanvas(source) {
    if (!source) return null;
    const copy = document.createElement("canvas");
    copy.width = copy.height = TILE;
    copy.getContext("2d").drawImage(source, 0, 0);
    return copy;
  }
  const SNAPSHOT_DB = "penecho-canvas-history",
    SNAPSHOT_STORE = "snapshots",
    SNAPSHOT_TILE_STORE = "snapshot-tiles";
  let snapshotDbPromise = null,
    snapshotItems = [],
    snapshotSaveInProgress = false,
    historyNoticeTimer = 0;
  function updateHistorySaveFeedbackLanguage() {
    const button = document.querySelector("#historySave"),
      notice = document.querySelector("#historyNotice");
    if (button) button.textContent = t(snapshotSaveInProgress ? "snapshotSaving" : "saveSnapshot");
    if (notice?.dataset.messageKey) notice.textContent = t(notice.dataset.messageKey);
  }
  function showHistoryNotice(text, tone = "info", { messageKey = "", duration = 2800 } = {}) {
    const notice = document.querySelector("#historyNotice");
    if (!notice) return;
    clearTimeout(historyNoticeTimer);
    notice.textContent = text;
    notice.dataset.messageKey = messageKey;
    notice.dataset.tone = tone;
    notice.classList.add("visible");
    if (duration > 0) {
      historyNoticeTimer = setTimeout(() => {
        notice.classList.remove("visible");
        notice.dataset.messageKey = "";
        notice.textContent = "";
      }, duration);
    }
  }
  function showHistoryNoticeKey(key, tone = "info", duration = 2800) {
    showHistoryNotice(t(key), tone, { messageKey: key, duration });
  }
  function setHistorySaveBusy(busy) {
    const button = document.querySelector("#historySave");
    snapshotSaveInProgress = busy;
    if (!button) return;
    button.disabled = busy;
    button.classList.toggle("is-saving", busy);
    button.setAttribute("aria-busy", String(busy));
    button.textContent = t(busy ? "snapshotSaving" : "saveSnapshot");
  }
  async function saveSnapshotFromHistory() {
    if (snapshotSaveInProgress) return;
    setHistorySaveBusy(true);
    showHistoryNoticeKey("snapshotSaving", "busy", 0);
    try {
      const selectionBusy = selectionAIBusy(),
        selectionBusyKey = selectionAIStatusKey(),
        id = await saveSnapshot();
      showHistoryNoticeKey(id ? "snapshotSaved" : selectionBusy ? selectionBusyKey : "emptyCanvas", id ? "success" : "info");
    } catch (error) {
      const message = `${t("snapshotError")}${error.message}`;
      setStatus(message);
      showHistoryNotice(message, "error", { duration: 5000 });
    } finally {
      setHistorySaveBusy(false);
    }
  }
  function snapshotDb() {
    if (snapshotDbPromise) return snapshotDbPromise;
    snapshotDbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(SNAPSHOT_DB, 2);
      request.onupgradeneeded = (event) => {
        const db = request.result;
        if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) db.createObjectStore(SNAPSHOT_STORE, { keyPath: "id" });
        if (!db.objectStoreNames.contains(SNAPSHOT_TILE_STORE)) {
          const store = db.createObjectStore(SNAPSHOT_TILE_STORE, { keyPath: "id" });
          store.createIndex("snapshotId", "snapshotId", { unique: false });
        }
        if (event.oldVersion === 1) request.transaction.objectStore(SNAPSHOT_STORE).clear();
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || Error("Could not open IndexedDB"));
    });
    return snapshotDbPromise;
  }
  function canvasBlob(canvas, type = "image/png", quality) {
    return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(Error("Could not encode canvas"))), type, quality));
  }
  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || Error("IndexedDB request failed"));
    });
  }
  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = transaction.onabort = () => reject(transaction.error || Error("IndexedDB transaction failed"));
    });
  }
  async function allSnapshots() {
    const db = await snapshotDb(),
      items = await requestResult(db.transaction(SNAPSHOT_STORE, "readonly").objectStore(SNAPSHOT_STORE).getAll());
    return items.sort((a, b) => b.createdAt - a.createdAt);
  }
  function animationBounds(region = null) {
    if (!pluginEnabled("animation")) return null;
    let bounds = null;
    for (const animation of visibleAnimations(region)) {
      const box = animationBox(animation),
        visible = region ? intersection(box, region) : box;
      if (visible) bounds = unionLocalBounds(bounds, visible);
    }
    return bounds;
  }
  function snapshotPreview() {
    const preview = offscreen(180, 120),
      q = preview.getContext("2d"),
      bounds = unionLocalBounds(unionLocalBounds(unionLocalBounds(visibleInkBounds({ x:0, y:0, w:SIZE, h:SIZE }), imageBounds()), animationBounds()), widgetBounds());
    q.fillStyle = state.paint.paper;
    q.fillRect(0, 0, preview.width, preview.height);
    if (!bounds) return preview;
    const pad = 8,
      scale = Math.min((preview.width - pad * 2) / bounds.w, (preview.height - pad * 2) / bounds.h),
      dx = (preview.width - bounds.w * scale) / 2,
      dy = (preview.height - bounds.h * scale) / 2;
    const captureTime = performance.now();
    q.save();
    q.setTransform(scale, 0, 0, scale, dx - bounds.x * scale, dy - bounds.y * scale);
    drawImagesToContext(q, bounds);
    q.restore();
    for (const [k, canvas] of tiles) {
      const [tx, ty] = k.split(",").map(Number),
        x = tx * TILE,
        y = ty * TILE;
      if (!intersection({ x, y, w: TILE, h: TILE }, bounds)) continue;
      q.drawImage(canvas, dx + (x - bounds.x) * scale, dy + (y - bounds.y) * scale, TILE * scale, TILE * scale);
    }
    q.save();
    q.setTransform(scale, 0, 0, scale, dx - bounds.x * scale, dy - bounds.y * scale);
    drawSharpOverlays(q, bounds);
    drawAnimationsToContext(q, bounds, captureTime);
    drawWidgetsToContext(q, bounds);
    q.restore();
    return preview;
  }
  function exportInkBounds() {
    let bounds = null;
    for (const [tileKey, tileCanvas] of tiles) {
      const [tx, ty] = tileKey.split(",").map(Number),
        ink = inkBox(tileCanvas, Math.min(TILE, SIZE - tx * TILE), Math.min(TILE, SIZE - ty * TILE));
      if (!ink) continue;
      state.inkBounds.set(tileKey, ink);
      bounds = unionLocalBounds(bounds, { x: tx * TILE + ink.x, y: ty * TILE + ink.y, w: ink.w, h: ink.h });
    }
    bounds = unionLocalBounds(bounds, animationBounds());
    bounds = unionLocalBounds(bounds, imageBounds());
    bounds = unionLocalBounds(bounds, widgetBounds());
    const selection = state.selection;
    if (selection?.phase !== "active") return bounds;
    for (const fragment of selection.fragments) {
      const target = SELECT.mapFragment(fragment, selection.originalBox, selection.box);
      bounds = unionLocalBounds(bounds, target);
    }
    return bounds;
  }
  function exportRegion() {
    const ink = exportInkBounds();
    if (!ink) return null;
    const x = Math.floor(ink.x) - TILE,
      y = Math.floor(ink.y) - TILE,
      right = Math.ceil(ink.x + ink.w) + TILE,
      bottom = Math.ceil(ink.y + ink.h) + TILE;
    return { x, y, w: right - x, h: bottom - y };
  }
  async function renderExportCanvas() {
    await snapshotVisibleWidgets();
    const region = exportRegion();
    if (!region) return null;
    const scale = Math.min(1, EXPORT_MAX_DIMENSION / region.w, EXPORT_MAX_DIMENSION / region.h, Math.sqrt(EXPORT_MAX_PIXELS / (region.w * region.h))),
      canvas = offscreen(Math.max(1, Math.ceil(region.w * scale)), Math.max(1, Math.ceil(region.h * scale))),
      context = canvas.getContext("2d");
    const captureTime = performance.now();
    context.fillStyle = state.paint.paper;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.save();
    context.setTransform(scale, 0, 0, scale, -region.x * scale, -region.y * scale);
    if (state.gridVisible) {
      const right = region.x + region.w,
        bottom = region.y + region.h;
      context.strokeStyle = state.paint.paperGrid;
      context.lineWidth = 1 / scale;
      context.beginPath();
      for (let x = Math.floor(region.x / 500) * 500; x <= right; x += 500) {
        context.moveTo(x, region.y);
        context.lineTo(x, bottom);
      }
      for (let y = Math.floor(region.y / 500) * 500; y <= bottom; y += 500) {
        context.moveTo(region.x, y);
        context.lineTo(right, y);
      }
      context.stroke();
    }
    drawImagesToContext(context, region);
    for (const [tileKey, tileCanvas] of tiles) {
      const [tx, ty] = tileKey.split(",").map(Number),
        x = tx * TILE,
        y = ty * TILE;
      if (intersection({ x, y, w: TILE, h: TILE }, region)) context.drawImage(tileCanvas, x, y);
    }
    drawSharpOverlays(context, region);
    drawAnimationsToContext(context, region, captureTime);
    drawWidgetsToContext(context, region);
    const selection = state.selection;
    if (selection?.phase === "active")
      for (const fragment of selection.fragments) {
        const target = SELECT.mapFragment(fragment, selection.originalBox, selection.box);
        context.drawImage(fragment.renderImage || fragment.image, target.x, target.y, target.w, target.h);
      }
    context.restore();
    return canvas;
  }
  function exportFilename() {
    const now = new Date(),
      pad = (value) => String(value).padStart(2, "0");
    return `penecho-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.png`;
  }
  async function exportCanvasPng() {
    const button = document.querySelector("#exportPngBtn");
    if (button.disabled) return;
    button.disabled = true;
    let canvas = null;
    try {
      canvas = await renderExportCanvas();
      if (!canvas) {
        setStatusKey("emptyCanvas");
        return;
      }
      const blob = await canvasBlob(canvas),
        url = URL.createObjectURL(blob),
        link = document.createElement("a");
      link.href = url;
      link.download = exportFilename();
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatusKey("exportComplete");
    } catch (error) {
      setStatus(`${t("exportError")}${error.message}`);
    } finally {
      if (canvas) canvas.width = canvas.height = 1;
      button.disabled = false;
    }
  }
  function imageFromBlob(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob),
        image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(Error("Could not decode snapshot tile"));
      };
      image.src = url;
    });
  }
  async function saveSnapshot({ overwriteId = null, name = null } = {}) {
    if (selectionAIBusy()) {
      setStatusKey(selectionAIStatusKey());
      return null;
    }
    if (state.selection) commitSelection();
    if (!tiles.size && !state.images.length && (!pluginEnabled("animation") || !state.animations.length) && !visibleWidgets().length) {
      setStatusKey("emptyCanvas");
      return null;
    }
    await snapshotVisibleWidgets();
    const nameInput = document.querySelector("#historyName"),
      existing = overwriteId ? snapshotItems.find((item) => item.id === overwriteId) : null,
      id = overwriteId || `${Date.now()}-${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`,
      createdAt = Date.now(),
      animations = serializedAnimations(),
      widgets = serializedWidgets(),
      images = storedImages(),
      tileEntries = await Promise.all([...tiles].map(async ([k, canvas]) => ({ k, blob: await canvasBlob(canvas) }))),
      preview = await canvasBlob(snapshotPreview()),
      requestedName = String(name === null ? nameInput.value : name).trim().slice(0, 48),
      item = {
        id,
        createdAt,
        name: requestedName || (overwriteId ? (existing ? existing.name : state.currentSnapshotName) : ""),
        theme: state.theme,
        view: { scale: state.scale, panX: state.panX, panY: state.panY },
        tileCount: tileEntries.length,
        animationCount: animations.length,
        animations,
        widgetCount: widgets.length,
        widgets,
        imageCount: images.length,
        images,
        preview,
      },
      db = await snapshotDb();
    if (overwriteId && !existing && overwriteId !== state.currentSnapshotId) throw Error(t("noCurrentSnapshot"));
    let oldTileKeys = [];
    if (overwriteId) oldTileKeys = await requestResult(db.transaction(SNAPSHOT_TILE_STORE, "readonly").objectStore(SNAPSHOT_TILE_STORE).index("snapshotId").getAllKeys(overwriteId));
    const transaction = db.transaction([SNAPSHOT_STORE, SNAPSHOT_TILE_STORE], "readwrite");
    transaction.objectStore(SNAPSHOT_STORE).put(item);
    const tileStore = transaction.objectStore(SNAPSHOT_TILE_STORE);
    oldTileKeys.forEach((key) => tileStore.delete(key));
    tileEntries.forEach(({ k, blob }) => tileStore.put({ id: `${id}:${k}`, snapshotId: id, k, blob }));
    await transactionDone(transaction);
    nameInput.value = "";
    state.currentSnapshotId = id;
    state.currentSnapshotName = snapshotName(item);
    await refreshSnapshots();
    setStatusKey(overwriteId ? "snapshotOverwritten" : "snapshotSaved");
    return id;
  }
  async function loadSnapshot(id) {
    const loadGeneration=++state.snapshotLoadGeneration;
    if (state.selection) cancelSelection(true);
    clearTextEditors();
    state.userRevision++;
    invalidateRecognition();
    cancelPendingForRevision();
    const expectedRevision=state.userRevision;
    const db = await snapshotDb(),
      transaction = db.transaction([SNAPSHOT_STORE, SNAPSHOT_TILE_STORE], "readonly"),
      itemRequest = transaction.objectStore(SNAPSHOT_STORE).get(id),
      tilesRequest = transaction.objectStore(SNAPSHOT_TILE_STORE).index("snapshotId").getAll(id),
      [item, tileEntries] = await Promise.all([requestResult(itemRequest), requestResult(tilesRequest)]);
    if (!item) return;
    const [decoded, images] = await Promise.all([
      Promise.all(tileEntries.map(async ({ k, blob }) => ({ k, image: await imageFromBlob(blob) }))),
      decodeStoredImages(item.images),
    ]);
    if(loadGeneration!==state.snapshotLoadGeneration||state.userRevision!==expectedRevision)return;
    state.userRevision++;
    invalidateRecognition();
    cancelPendingForRevision();
    clearTextEditors();
    tiles.clear();
    clearSharpOverlays();
    state.inkBounds.clear();
    state.history = [];
    state.future = [];
    state.animationHistoryBefore = null;
    state.widgetHistoryBefore = null;
    state.historyBefore.clear();
    state.imageHistoryBefore = null;
    for (const { k, image } of decoded) {
      const canvas = offscreen(TILE, TILE);
      canvas.getContext("2d").drawImage(image, 0, 0);
      tiles.set(k, canvas);
    }
    restoreAnimations(item.animations);
    restoreWidgets(item.widgets);
    if (["arcane", "scifi", "research", "studio"].includes(item.theme)) applyTheme(item.theme);
    restoreImages(images);
    if (item.view) {
      state.scale = Math.max(0.03, Math.min(2, item.view.scale));
      state.panX = item.view.panX;
      state.panY = item.view.panY;
      updateCoordinates();
    }
    state.currentSnapshotId = item.id;
    state.currentSnapshotName = snapshotName(item);
    render();
    closeHistoryPanel();
    setStatusKey("snapshotLoaded");
  }
  async function deleteSnapshot(id) {
    if (!confirm(t("deleteSnapshotConfirm"))) return;
    const db = await snapshotDb(),
      readTransaction = db.transaction(SNAPSHOT_TILE_STORE, "readonly"),
      tileKeys = await requestResult(readTransaction.objectStore(SNAPSHOT_TILE_STORE).index("snapshotId").getAllKeys(id)),
      transaction = db.transaction([SNAPSHOT_STORE, SNAPSHOT_TILE_STORE], "readwrite");
    transaction.objectStore(SNAPSHOT_STORE).delete(id);
    const tileStore = transaction.objectStore(SNAPSHOT_TILE_STORE);
    tileKeys.forEach((key) => tileStore.delete(key));
    await transactionDone(transaction);
    if (state.currentSnapshotId === id) {
      state.currentSnapshotId = null;
      state.currentSnapshotName = "";
    }
    await refreshSnapshots();
    setStatusKey("snapshotDeleted");
  }
  function updateNewCanvasDialog() {
    const label = document.querySelector("#currentSnapshotLabel"),
      overwrite = document.querySelector("#newOverwrite");
    if (!label || !overwrite) return;
    label.textContent = state.currentSnapshotId ? t("currentSnapshot").replace("{name}", state.currentSnapshotName || state.currentSnapshotId) : t("noCurrentSnapshot");
    overwrite.disabled = !state.currentSnapshotId;
  }
  function setNewCanvasDialogBusy(busy) {
    const dialog = document.querySelector("#newCanvasDialog");
    dialog.dataset.busy = String(busy);
    dialog.querySelectorAll("button, input").forEach((control) => (control.disabled = busy));
    if (!busy) updateNewCanvasDialog();
  }
  function startBlankCanvas() {
    const dialog = document.querySelector("#newCanvasDialog");
    if (state.selection) cancelSelection(true);
    clearTextEditors();
    state.snapshotLoadGeneration++;
    state.userRevision++;
    invalidateRecognition();
    cancelPendingForRevision();
    tiles.clear();
    clearSharpOverlays();
    state.inkBounds.clear();
    state.history = [];
    state.future = [];
    state.animationHistoryBefore = null;
    restoreAnimations([]);
    state.widgetHistoryBefore = null;
    restoreWidgets([]);
    state.imageHistoryBefore = null;
    restoreImages([]);
    state.historyBefore.clear();
    state.currentSnapshotId = null;
    state.currentSnapshotName = "";
    state.viewInitialized = false;
    document.querySelector("#newSnapshotName").value = "";
    if (dialog.open) dialog.close();
    if (document.querySelector("#historyPanel").classList.contains("open")) closeHistoryPanel();
    fit();
    setStatusKey("newCanvasReady");
  }
  function openNewCanvasDialog() {
    if (!tiles.size && !state.images.length && (!pluginEnabled("animation") || !state.animations.length) && !visibleWidgets().length) {
      startBlankCanvas();
      return;
    }
    const dialog = document.querySelector("#newCanvasDialog");
    document.querySelector("#newSnapshotName").value = "";
    setNewCanvasDialogBusy(false);
    updateNewCanvasDialog();
    if (!dialog.open) dialog.showModal();
  }
  async function completeNewCanvas(saveMode) {
    const name = document.querySelector("#newSnapshotName").value;
    setNewCanvasDialogBusy(true);
    try {
      let saved = true;
      if (saveMode === "new") saved = await saveSnapshot({ name });
      else if (saveMode === "overwrite") saved = await saveSnapshot({ overwriteId: state.currentSnapshotId, name });
      if (saved === null) {
        setNewCanvasDialogBusy(false);
        return;
      }
      startBlankCanvas();
    } catch (error) {
      setStatus(`${t("snapshotError")}${error.message}`);
      setNewCanvasDialogBusy(false);
    }
  }
  function snapshotName(item) {
    return item.name || new Intl.DateTimeFormat(state.language === "zh" ? "zh-CN" : "en", { dateStyle: "medium", timeStyle: "short" }).format(item.createdAt);
  }
  function renderSnapshotList() {
    const list = document.querySelector("#historyList");
    if (!list) return;
    list.replaceChildren();
    if (!snapshotItems.length) {
      const empty = document.createElement("div");
      empty.className = "history-empty";
      empty.textContent = t("emptyHistory");
      list.append(empty);
      return;
    }
    for (const item of snapshotItems) {
      const card = document.createElement("article"),
        preview = document.createElement("div"),
        image = document.createElement("img"),
        meta = document.createElement("div"),
        title = document.createElement("strong"),
        detail = document.createElement("small"),
        actions = document.createElement("div"),
        load = document.createElement("button"),
        remove = document.createElement("button"),
        url = URL.createObjectURL(item.preview);
      card.className = "history-card";
      card.classList.toggle("current", item.id === state.currentSnapshotId);
      if (item.id === state.currentSnapshotId) card.setAttribute("aria-current", "true");
      preview.className = "history-preview";
      image.alt = "";
      image.src = url;
      image.onload = image.onerror = () => URL.revokeObjectURL(url);
      preview.append(image);
      meta.className = "history-meta";
      title.textContent = snapshotName(item);
      detail.textContent = `${new Intl.DateTimeFormat(state.language === "zh" ? "zh-CN" : "en", { dateStyle: "short", timeStyle: "short" }).format(item.createdAt)} · ${item.tileCount} ${t("snapshotTiles")}`;
      if (pluginEnabled("animation") && item.animationCount) detail.textContent += " · " + item.animationCount + " " + t("snapshotAnimations");
      if (item.widgetCount) detail.textContent += " · " + item.widgetCount + " " + t("snapshotWidgets");
      if (item.imageCount) detail.textContent += " · " + item.imageCount + " " + t("snapshotImages");
      actions.className = "history-actions";
      load.textContent = t("loadSnapshot");
      load.onclick = () => runSnapshotAction(() => loadSnapshot(item.id));
      remove.className = "history-delete";
      remove.textContent = t("deleteSnapshot");
      remove.onclick = () => runSnapshotAction(() => deleteSnapshot(item.id));
      actions.append(load, remove);
      meta.append(title, detail, actions);
      card.append(preview, meta);
      list.append(card);
    }
  }
  async function refreshSnapshots() {
    snapshotItems = await allSnapshots();
    renderSnapshotList();
  }
  async function runSnapshotAction(action) {
    try {
      await action();
    } catch (error) {
      setStatus(`${t("snapshotError")}${error.message}`);
    }
  }
  function openHistoryPanel() {
    const panel = document.querySelector("#historyPanel"),
      backdrop = document.querySelector("#historyBackdrop"),
      button = document.querySelector("#historyBtn");
    backdrop.hidden = false;
    panel.classList.add("open");
    panel.setAttribute("aria-hidden", "false");
    button.setAttribute("aria-expanded", "true");
    refreshSnapshots().catch((error) => setStatus(`${t("snapshotError")}${error.message}`));
  }
  function closeHistoryPanel() {
    const panel = document.querySelector("#historyPanel"),
      backdrop = document.querySelector("#historyBackdrop"),
      button = document.querySelector("#historyBtn");
    panel.classList.remove("open");
    panel.setAttribute("aria-hidden", "true");
    button.setAttribute("aria-expanded", "false");
    setTimeout(() => {
      if (!panel.classList.contains("open")) backdrop.hidden = true;
    }, 220);
  }
  function recordBefore(tx, ty) {
    const k = key(tx, ty);
    if (!state.historyBefore.has(k)) state.historyBefore.set(k, cloneCanvas(tiles.get(k)));
  }
  function unionLocalBounds(current, next) {
    if (!current) return next;
    if (!next) return current;
    const x = Math.min(current.x, next.x),
      y = Math.min(current.y, next.y),
      right = Math.max(current.x + current.w, next.x + next.w),
      bottom = Math.max(current.y + current.h, next.y + next.h);
    return { x, y, w: right - x, h: bottom - y };
  }
  function extendInkBounds(k, next) {
    if (!state.inkBounds.has(k)) return;
    state.inkBounds.set(k, unionLocalBounds(state.inkBounds.get(k), next));
  }
  function lineIntersectsRect(a, b, rect) {
    let t0 = 0,
      t1 = 1;
    const dx = b.x - a.x,
      dy = b.y - a.y,
      tests = [
        [-dx, a.x - rect.x],
        [dx, rect.x + rect.w - a.x],
        [-dy, a.y - rect.y],
        [dy, rect.y + rect.h - a.y],
      ];
    for (const [p, q] of tests) {
      if (!p) {
        if (q < 0) return false;
        continue;
      }
      const ratio = q / p;
      if (p < 0) t0 = Math.max(t0, ratio);
      else t1 = Math.min(t1, ratio);
      if (t0 > t1) return false;
    }
    return true;
  }
  function stroke(a, b, erase = false, size = state.pen, userChange = false) {
    if (!valid(a) || !valid(b)) return;
    const pad = size / 2 + 2,
      x = Math.min(a.x, b.x) - pad,
      y = Math.min(a.y, b.y) - pad,
      w = Math.abs(a.x - b.x) + pad * 2,
      h = Math.abs(a.y - b.y) + pad * 2;
    invalidateSharpOverlays({ x, y, w, h });
    const x0 = Math.max(0, Math.floor(x / TILE)),
      y0 = Math.max(0, Math.floor(y / TILE)),
      x1 = Math.min(Math.ceil(SIZE / TILE) - 1, Math.floor((x + w) / TILE)),
      y1 = Math.min(Math.ceil(SIZE / TILE) - 1, Math.floor((y + h) / TILE));
    for (let ty = y0; ty <= y1; ty++)
      for (let tx = x0; tx <= x1; tx++) {
        const expanded = { x: tx * TILE - pad, y: ty * TILE - pad, w: TILE + pad * 2, h: TILE + pad * 2 };
        if (!lineIntersectsRect(a, b, expanded)) continue;
        const existing = tile(tx, ty, false);
        if (erase && !existing) continue;
        recordBefore(tx, ty);
        const c = existing || tile(tx, ty),
          q = c.getContext("2d");
        q.save();
        q.globalCompositeOperation = erase ? "destination-out" : "source-over";
        q.strokeStyle = state.inkColor;
        q.lineWidth = size;
        q.lineCap = q.lineJoin = "round";
        q.beginPath();
        q.moveTo(a.x - tx * TILE, a.y - ty * TILE);
        q.lineTo(b.x - tx * TILE, b.y - ty * TILE);
        q.stroke();
        q.restore();
        const k = key(tx, ty);
        if (erase) state.inkBounds.delete(k);
        else {
          const local = {
            x: Math.max(0, Math.min(a.x, b.x) - tx * TILE - pad),
            y: Math.max(0, Math.min(a.y, b.y) - ty * TILE - pad),
            w: Math.min(TILE, Math.max(a.x, b.x) - tx * TILE + pad) - Math.max(0, Math.min(a.x, b.x) - tx * TILE - pad),
            h: Math.min(TILE, Math.max(a.y, b.y) - ty * TILE + pad) - Math.max(0, Math.min(a.y, b.y) - ty * TILE - pad),
          };
          extendInkBounds(k, local);
        }
      }
    if (userChange) {
      mergeDirty(a.x, a.y, pad);
      mergeDirty(b.x, b.y, pad);
    }
  }
  function dot(p, erase = false, size = state.pen, userChange = false) {
    stroke(p, { x: p.x + 0.01, y: p.y + 0.01 }, erase, size, userChange);
  }
  function pressureWidth(e) {
    if (e.pointerType !== "pen" || !Number.isFinite(e.pressure) || e.pressure <= 0) return state.pen;
    return Math.max(3, Math.min(16, state.pen * (0.72 + e.pressure * 0.7)));
  }
  function logicalWidth(cssWidth) {
    const maximum = state.mode === "eraser" ? 1600 : 320;
    return Math.max(1, Math.min(maximum, cssWidth / Math.max(0.03, state.scale)));
  }
  function drawPreview(s, context = ctx) {
    const ctx = context;
    ctx.strokeStyle = s.erase ? "#dc262666" : `${state.inkColor}88`;
    ctx.lineWidth = s.size;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(s.a.x, s.a.y);
    ctx.lineTo(s.b.x, s.b.y);
    ctx.stroke();
  }
  function save() {
    if (!state.historyBefore.size && !state.animationHistoryBefore && !state.widgetHistoryBefore && !state.imageHistoryBefore) return;
    const changes = [];
    const animationsBefore = state.animationHistoryBefore,
      animationsAfter = animationsBefore ? serializedAnimations() : null,
      widgetsBefore = state.widgetHistoryBefore,
      widgetsAfter = widgetsBefore ? serializedWidgets() : null,
      imagesBefore = state.imageHistoryBefore,
      imagesAfter = imagesBefore ? imageHistoryState() : null;
    for (const [k, before] of state.historyBefore) {
      let current = tiles.get(k);
      if (current && state.inkBounds.get(k) === undefined) {
        const [tx, ty] = k.split(",").map(Number),
          ink = inkBox(current, Math.min(TILE, SIZE - tx * TILE), Math.min(TILE, SIZE - ty * TILE));
        if (ink) state.inkBounds.set(k, ink);
        else {
          tiles.delete(k);
          state.inkBounds.delete(k);
          current = null;
        }
      }
      changes.push({ k, before, after: cloneCanvas(current) });
    }
    state.historyBefore.clear();
    state.history.push({ tiles: changes, animationsBefore, animationsAfter, widgetsBefore, widgetsAfter, imagesBefore, imagesAfter });
    state.animationHistoryBefore = null;
    state.widgetHistoryBefore = null;
    state.imageHistoryBefore = null;
    if (state.history.length > MAX_HISTORY) state.history.shift();
    state.future = [];
  }
  function applyHistory(entry, side) {
    const changes = Array.isArray(entry) ? entry : entry?.tiles || [];
    for (const change of changes) {
      const value = change[side];
      if (value) tiles.set(change.k, cloneCanvas(value));
      else tiles.delete(change.k);
      state.inkBounds.delete(change.k);
    }
    const animationState = !Array.isArray(entry) ? entry?.[side === "before" ? "animationsBefore" : "animationsAfter"] : null;
    if (animationState) restoreAnimations(animationState);
    const widgetState = !Array.isArray(entry) ? entry?.[side === "before" ? "widgetsBefore" : "widgetsAfter"] : null;
    if (widgetState) restoreWidgets(widgetState);
    const imageState = !Array.isArray(entry) ? entry?.[side === "before" ? "imagesBefore" : "imagesAfter"] : null;
    if (imageState) restoreImages(imageState);
    clearSharpOverlays();
    requestAnimationLayerRender();
    render();
  }
  function undo() {
    save();
    const change = state.history.pop();
    if (!change) return;
    invalidateRecognition();
    state.future.push(change);
    applyHistory(change, "before");
  }
  function redo() {
    const change = state.future.pop();
    if (!change) return;
    invalidateRecognition();
    state.history.push(change);
    applyHistory(change, "after");
  }
  function sameBox(a, b) {
    return a && b && Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01 && Math.abs(a.w - b.w) < 0.01 && Math.abs(a.h - b.h) < 0.01;
  }
  function selectionHasChanges(selection) {
    return Boolean(selection?.color) || !sameBox(selection?.box, selection?.originalBox);
  }
  function recolorSelectionImage(image, color) {
    const recolored = offscreen(image.width, image.height),
      context = recolored.getContext("2d");
    context.drawImage(image, 0, 0);
    context.globalCompositeOperation = "source-in";
    context.fillStyle = color;
    context.fillRect(0, 0, recolored.width, recolored.height);
    return recolored;
  }
  function traceSelectionPath(context, points, offsetX = 0, offsetY = 0, close = true) {
    if (!points.length) return;
    context.beginPath();
    context.moveTo(points[0].x - offsetX, points[0].y - offsetY);
    for (let index = 1; index < points.length; index++) context.lineTo(points[index].x - offsetX, points[index].y - offsetY);
    if (close) context.closePath();
  }
  function selectionPathFor(selection, box = selection.box) {
    const source = selection.originalPath || selection.points || [];
    return selection.originalBox && box ? SELECT.mapPath(source, selection.originalBox, box) : source.map((point) => ({ ...point }));
  }
  function selectionContentBounds(selection) {
    let bounds = null;
    for (const fragment of selection.fragments || []) {
      const target = SELECT.mapFragment(fragment, selection.originalBox, selection.box);
      bounds = SELECT.unionBox(bounds, target);
    }
    return bounds;
  }
  function drawSelectionAxisHandles(context, box, size) {
    context.moveTo(box.x + box.w, box.y + box.h / 2 - size * 0.48);
    context.lineTo(box.x + box.w, box.y + box.h / 2 + size * 0.48);
    context.moveTo(box.x + box.w / 2 - size * 0.48, box.y + box.h);
    context.lineTo(box.x + box.w / 2 + size * 0.48, box.y + box.h);
  }
  function drawSelection(selection, context = ctx) {
    const ctx = context,
      unit = 1 / state.scale,
      size = 14 * unit;
    if (selection.phase === "lasso") {
      ctx.save();
      ctx.fillStyle = "#2679b81a";
      ctx.strokeStyle = "#2679b8";
      ctx.lineWidth = 1.5 * unit;
      ctx.setLineDash([7 * unit, 6 * unit]);
      traceSelectionPath(ctx, selection.points);
      ctx.fill("evenodd");
      ctx.stroke();
      ctx.restore();
      return;
    }
    for (const fragment of selection.fragments) {
      const target = SELECT.mapFragment(fragment, selection.originalBox, selection.box);
      ctx.drawImage(fragment.renderImage || fragment.image, target.x, target.y, target.w, target.h);
    }
    const path = selectionPathFor(selection);
    ctx.save();
    ctx.strokeStyle = "#2679b8";
    ctx.lineWidth = 1.8 * unit;
    ctx.setLineDash([7 * unit, 6 * unit]);
    traceSelectionPath(ctx, path);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineCap = "round";
    ctx.beginPath();
    drawResizeHandle(ctx, selection.box, size);
    drawSelectionAxisHandles(ctx, selection.box, size);
    ctx.stroke();
    ctx.restore();
    if (selection.showMoveHandle) drawMoveHandle(ctx, selection.box, size, true);
    // Keep the legacy call shape available for integrations that opt into the old controls.
    if (selection.legacyActions) drawDraftActions(ctx, selection.box, size);
  }
  function captureSelection(points) {
    const box = SELECT.polygonBounds(points, SIZE);
    if (!box || points.length < 3 || SELECT.pathLength(points, state.scale) < 12 || box.w * state.scale < 4 || box.h * state.scale < 4) {
      setStatusKey("selectionTooSmall");
      return false;
    }
    const fragments = [];
    const originalBox = { ...box };
    forTiles(
      box.x,
      box.y,
      box.w,
      box.h,
      (canvas, tx, ty) => {
        const tileBox = { x: tx * TILE, y: ty * TILE, w: TILE, h: TILE },
          part = intersection(tileBox, box);
        if (!part) return;
        const clipped = offscreen(part.w, part.h, true),
          clippedContext = clipped.getContext("2d", { willReadFrequently: true });
        clippedContext.save();
        traceSelectionPath(clippedContext, points, part.x, part.y);
        clippedContext.clip("evenodd");
        clippedContext.drawImage(canvas, part.x - tileBox.x, part.y - tileBox.y, part.w, part.h, 0, 0, part.w, part.h);
        clippedContext.restore();
        const ink = inkBox(clipped);
        if (!ink) return;
        const image = offscreen(ink.w, ink.h);
        image.getContext("2d").drawImage(clipped, ink.x, ink.y, ink.w, ink.h, 0, 0, ink.w, ink.h);
        const fragment = { image, x: part.x + ink.x, y: part.y + ink.y, w: ink.w, h: ink.h };
        fragments.push(fragment);
      },
      false,
    );
    if (!fragments.length) {
      state.selection = null;
      setStatusKey("selectionEmpty");
      render();
      return false;
    }
    invalidateSharpOverlays(box);
    save();
    invalidateRecognition();
    state.userRevision++;
    const beforeTiles = new Map();
    forTiles(
      box.x,
      box.y,
      box.w,
      box.h,
      (canvas, tx, ty) => {
        const tileKey = key(tx, ty),
          before = cloneCanvas(canvas);
        beforeTiles.set(tileKey, before);
        state.historyBefore.set(tileKey, before);
      },
      false,
    );
    forTiles(
      box.x,
      box.y,
      box.w,
      box.h,
      (canvas, tx, ty) => {
        recordBefore(tx, ty);
        const tileContext = canvas.getContext("2d");
        tileContext.save();
        tileContext.globalCompositeOperation = "destination-out";
        tileContext.fillStyle = "#000";
        traceSelectionPath(tileContext, points, tx * TILE, ty * TILE);
        tileContext.fill("evenodd");
        tileContext.restore();
        state.inkBounds.delete(key(tx, ty));
      },
      false,
    );
    state.selection = {
      phase: "active",
      originalPath: points.map((point) => ({ ...point })),
      path: points.map((point) => ({ ...point })),
      originalBox,
      box: { ...originalBox },
      fragments,
      contentBox: selectionContentBounds({ fragments, originalBox, box: originalBox }),
      beforeTiles,
      color: null,
    };
    state.selectionGesture = null;
    setStatusKey("selectionReady");
    render();
    return true;
  }
  function restoreSelectionSource(selection) {
    for (const [tileKey, before] of selection.beforeTiles) {
      if (before) tiles.set(tileKey, cloneCanvas(before));
      else tiles.delete(tileKey);
      state.inkBounds.delete(tileKey);
    }
    state.historyBefore.clear();
  }
  function cancelSelection(silent = false) {
    const selection = state.selection;
    if (!selection) return false;
    const pending = state.pending,
      selectionRequest = state.activeAI?.selection === selection,
      pendingSelection = pending?.selection === selection || (pending?.isolatedSelection && selectionRequest);
    if (pendingSelection) rejectPending();
    if (selectionAIBusy(selection) || selectionRequest) supersedeActiveAI("selection-cancelled");
    if (selection.phase === "active" && !selection.acceptedDraft) restoreSelectionSource(selection);
    state.selection = null;
    state.selectionGesture = null;
    setCanvasCursor("crosshair");
    render();
    if (!silent) setStatusKey("selectionCancelled");
    return true;
  }
  function commitSelection() {
    const selection = state.selection;
    if (!selection) return false;
    if (selectionAIBusy(selection)) return false;
    if (selection.phase !== "active") {
      state.selection = null;
      state.selectionGesture = null;
      render();
      return false;
    }
    if (!selectionHasChanges(selection)) {
      cancelSelection(true);
      setStatusKey("selectionCommitted");
      return false;
    }
    state.selection = null;
    state.selectionGesture = null;
    for (const fragment of selection.fragments) {
      const target = SELECT.mapFragment(fragment, selection.originalBox, selection.box);
      blitSized(fragment.renderImage || fragment.image, target.x, target.y, target.w, target.h);
    }
    state.userRevision++;
    save();
    setCanvasCursor("crosshair");
    render();
    setStatusKey("selectionCommitted");
    return true;
  }
  function applySelectionColor(color) {
    const selection = state.selection;
    if (!selection || selection.phase !== "active" || selection.color === color) return false;
    selection.color = color;
    for (const fragment of selection.fragments) fragment.renderImage = recolorSelectionImage(fragment.image, color);
    render();
    setStatusKey("selectionRecolored");
    return true;
  }
  function updateSelectionToolbar() {
    if (!selectionOverlayLayer || !selectionToolbar) return;
    const selection = state.selection,
      active = selection?.phase === "active";
    selectionOverlayLayer.hidden = !active;
    selectionOverlayLayer.setAttribute("aria-hidden", String(!active));
    if (!active) return;
    const viewport = view.getBoundingClientRect(),
      box = selection.box,
      toolbarStyle = Reflect.get(selectionToolbar, "style"),
      selectionBusy = selectionAIBusy(selection),
      isTypesetting = selectionIsTypesetting(selection);
    selectionToolbar.hidden = false;
    selectionToolbar.setAttribute("aria-busy", String(selectionBusy));
    if (selectionTypesetButton) {
      selectionTypesetButton.disabled = false;
      selectionTypesetButton.setAttribute("aria-busy", String(isTypesetting));
      selectionTypesetButton.textContent = t(isTypesetting ? "selectionTypesetting" : "selectionTypeset");
    }
    if (selectionDeleteButton) selectionDeleteButton.disabled = selectionBusy;
    const width = selectionToolbar.offsetWidth || 280,
      height = selectionToolbar.offsetHeight || 36,
      left = box.x * state.scale + state.panX,
      top = box.y * state.scale + state.panY,
      bottom = (box.y + box.h) * state.scale + state.panY,
      maxX = Math.max(8, viewport.width - width - 8),
      x = Math.max(8, Math.min(maxX, left + (box.w * state.scale - width) / 2)),
      preferredY = top - height - 8,
      y = preferredY >= 8 ? preferredY : bottom + 8,
      maxY = Math.max(8, viewport.height - height - 8);
    toolbarStyle.setProperty("--selection-toolbar-x", `${x}px`);
    toolbarStyle.setProperty("--selection-toolbar-y", `${Math.max(8, Math.min(maxY, y))}px`);
  }
  function releaseSelectionAITransformLock(run = state.activeAI) {
    const selection = run?.isolatedSelection ? run.selection : null,
      token = run?.selectionRequestToken;
    if (!selection || !token || selection.aiRequest?.token !== token || state.selection !== selection) return;
    selection.aiRequest = null;
    updateSelectionToolbar();
  }
  function preservePendingAfterSelectionDelete(selection, pending = state.pending, selectionRequest = false) {
    if (!pending || (pending.selection !== selection && !(pending.isolatedSelection && selectionRequest))) return;
    pending.revision = state.userRevision;
    pending.latestUserRevision = state.userRevision;
  }
  function deleteSelection() {
    const selection = state.selection;
    if (!selection || selection.phase !== "active") return false;
    const pending = state.pending,
      selectionRequest = state.activeAI?.selection === selection || pending?.selection === selection;
    supersedeActiveAI("selection-deleted");
    state.selection = null;
    state.selectionGesture = null;
    state.userRevision++;
    preservePendingAfterSelectionDelete(selection, pending, selectionRequest);
    save();
    setCanvasCursor("crosshair");
    render();
    setStatusKey("selectionDeleted");
    return true;
  }
  function buildSelectionTypesetRequest(selection) {
    const packed = buildSelectionImage(selection);
    if (!packed) {
      setStatusKey("selectionEmpty");
      return null;
    }
    return packed;
  }
  function normalizeSelectionForAI() {
    const selection = state.selection;
    if (!selection || selection.phase !== "active") return false;
    const packed = buildSelectionTypesetRequest(selection);
    if (!packed) return false;
    return requestSelectionAI("normalize", selection, packed);
  }
  function selectionHit(selection, event) {
    const point = clientPoint(event),
      size = 14 / state.scale;
    const includeLegacyActions = Boolean(selection.legacyActions);
    return selection.path?.length >= 3
      ? SELECT.hitTestPath(selection.path, selection.box, point, size, includeLegacyActions)
      : SELECT.hitTest(selection.box, point, size, includeLegacyActions);
  }
  function beginSelectionLasso(event, point) {
    state.selection = { phase: "lasso", points: [SELECT.clipPoint(point, SIZE)], box: null };
    state.selectionGesture = { id: event.pointerId, hit: "lasso" };
    setCanvasCursor("crosshair");
    requestRender();
  }
  function beginSelectionTransform(event, hit) {
    if (selectionAIBusy()) return false;
    const point = clientPoint(event);
    state.selectionGesture = {
      id: event.pointerId,
      hit,
      startPoint: point,
      startBox: { ...state.selection.box },
    };
    setCanvasCursor(hit === "resize" ? "nwse-resize" : hit === "width" ? "ew-resize" : hit === "height" ? "ns-resize" : "grabbing");
  }
  function addLassoPoint(selection, point, minimumDistance) {
    if (!SELECT.shouldAddPoint(selection.points, point, minimumDistance)) return false;
    if (selection.points.length >= MAX_LASSO_POINTS) selection.points = selection.points.filter((_, index) => index % 2 === 0);
    selection.points.push(point);
    return true;
  }
  function updateSelectionGesture(event) {
    const gesture = state.selectionGesture,
      selection = state.selection;
    if (!gesture || !selection || gesture.id !== event.pointerId || selectionAIBusy(selection)) return false;
    const point = clientPoint(event);
    if (gesture.hit === "lasso") {
      const samples = typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [],
        events = samples.length ? samples : [event],
        minimumDistance = 0.75 / Math.max(0.03, state.scale);
      for (const sample of events) addLassoPoint(selection, SELECT.clipPoint(clientPoint(sample), SIZE), minimumDistance);
      selection.box = SELECT.polygonBounds(selection.points, SIZE);
    } else if (gesture.hit === "move") selection.box = SELECT.moveBox(gesture.startBox, point.x - gesture.startPoint.x, point.y - gesture.startPoint.y, SIZE);
    else if (gesture.hit === "resize") selection.box = SELECT.resizeBox(gesture.startBox, point, 24 / state.scale, SIZE);
    else if (gesture.hit === "width" || gesture.hit === "height") selection.box = SELECT.resizeBoxAxis(gesture.startBox, point, gesture.hit, 24 / state.scale, SIZE);
    if (selection.phase === "active") selection.path = selectionPathFor(selection);
    requestRender();
    return true;
  }
  function finishSelectionGesture(event) {
    const gesture = state.selectionGesture,
      selection = state.selection;
    if (!gesture || gesture.id !== event.pointerId) return false;
    state.selectionGesture = null;
    setCanvasCursor("crosshair");
    if (gesture.hit === "lasso") {
      if (selection && event.type !== "pointercancel") {
        const point = SELECT.clipPoint(clientPoint(event), SIZE);
        addLassoPoint(selection, point, 0.5 / state.scale);
      }
      const points = selection?.points || [];
      state.selection = null;
      if (event.type !== "pointercancel") captureSelection(points);
      else requestRender();
      return true;
    }
    if (selection) {
      selection.path = selectionPathFor(selection);
      selection.changed = selectionHasChanges(selection);
    }
    requestRender();
    return true;
  }
  function handleSelectionPointerDown(event, point) {
    const selection = state.selection;
    if (selection?.phase === "active") {
      if (selectionAIBusy(selection)) return true;
      const hit = selectionHit(selection, event);
      if (hit === "cancel") {
        cancelSelection();
        return true;
      }
      if (hit === "accept") {
        commitSelection();
        return true;
      }
      if (hit) {
        beginSelectionTransform(event, hit);
        return true;
      }
      commitSelection();
    } else if (selection) cancelSelection(true);
    beginSelectionLasso(event, point);
    return true;
  }
  function supersedeActiveAI(reason) {
    const active = state.activeAI;
    if (active && !active.superseded) {
      active.superseded = true;
      active.controller.abort();
      if (state.activeAI === active) {
        state.activeAI = null;
        setBusy(false);
      }
      if (!active.dirtyRestored && !active.oneShotInput && active.recognitionGeneration === state.recognitionGeneration) {
        restoreDirty(active.dirtySnapshot);
        active.dirtyRestored = true;
        state.autoEligible = Boolean(state.dirty);
      }
      debug("ai-deferred", { requestId: state.lastRequestId, reason });
    }
  }
  function hasUnsettledToolbox() {
    return Boolean(state.pending || state.pendingWidget || state.pendingGesture || state.widgetEdit || state.widgetGesture || state.imageEdit || state.imageGesture || state.imageImporting || state.selection || state.selectionGesture || state.textEditors.size);
  }
  function launchAutomaticAI(reason) {
    if (!state.auto || !state.dirty || !state.autoEligible || state.drawing) return;
    if (hasUnsettledToolbox()) {
      if (state.statusKey !== "autoToolboxPending") setStatusKey("autoToolboxPending");
      return;
    }
    supersedeActiveAI(reason);
    requestAI("auto");
  }
  function schedule(delay = state.autoDelayMs) {
    clearTimeout(state.timer);
    state.timer = 0;
    if (!state.auto || !state.dirty || !state.autoEligible) return;
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
  async function requestAI(action, packedOverride = null, requestOptions = null) {
    requestOptions = requestOptions || {};
    const automatic = action === "auto",
      isolatedSelection = Boolean(requestOptions.isolatedSelection),
      oneShotInput = Boolean(requestOptions.oneShotInput),
      revision = state.userRevision,
      recognitionGeneration = state.recognitionGeneration,
      aiColor = state.aiColor,
      dirtySnapshot = state.dirty ? { ...state.dirty } : null,
      latestBox = dirtySnapshot || state.lastUserBox,
      typedInput = isolatedSelection ? null : state.latestTypedInput,
      hotspotCount = isolatedSelection ? 0 : state.hotspotTrail.length,
      packed = packedOverride || (latestBox ? buildViewportImage(state.hotspotTrail.slice(0, hotspotCount), latestBox) : null),
      preservedRecognition = isolatedSelection
        ? {
            dirty: state.dirty ? { ...state.dirty } : null,
            autoEligible: state.autoEligible,
            lastUserBox: state.lastUserBox ? { ...state.lastUserBox } : null,
            hotspotTrail: state.hotspotTrail.slice(),
            latestTypedInput: state.latestTypedInput,
          }
        : null;
    if (!packed) {
      discardUncapturableInput(hotspotCount, Boolean(dirtySnapshot));
      if (preservedRecognition) {
        state.dirty = preservedRecognition.dirty;
        state.autoEligible = preservedRecognition.autoEligible;
        state.lastUserBox = preservedRecognition.lastUserBox;
        state.hotspotTrail = preservedRecognition.hotspotTrail;
        state.latestTypedInput = preservedRecognition.latestTypedInput;
      }
      setStatusKey(latestBox ? "cannotCapture" : "noInk");
      return;
    }
    const requestBox = packed.changedBox;
    if (!isolatedSelection) {
      state.dirty = null;
      state.autoEligible = false;
    }
    const controller = new AbortController(),
      // A selection-scoped request never consumes the normal recognition state. Mark its
      // snapshot as already preserved so superseding it cannot merge stale dirty ink back in.
      run = { controller, dirtySnapshot, recognitionGeneration, superseded: false, dirtyRestored: isolatedSelection, isolatedSelection, oneShotInput, selection: requestOptions.selection || null, selectionRequestToken: requestOptions.selectionRequestToken || null, action };
    state.activeAI = run;
    setBusy(true);
    setStatusKey(isolatedSelection && action === "normalize" ? "selectionTypesetting" : "observing");
    const timeout = setTimeout(() => controller.abort(), state.aiRequestTimeoutMs);
    try {
      const res = await fetch("/api/ai/command", {
          signal: controller.signal,
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...packed,
            trigger: automatic ? "user_paused" : "manual",
            userAction: action,
            ...(state.reasoningEffort === "config" ? {} : { reasoningEffort: state.reasoningEffort }),
            ...pluginRequestPayload(),
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
        data = await res.json();
      if (run.superseded || state.activeAI !== run) throw Error(AI_SUPERSEDED);
      rememberRequest(data.requestId);
      if (!res.ok) {
        const error = Error(data.error || `HTTP ${res.status}`);
        error.status = res.status;
        throw error;
      }
      const rawCommands = Array.isArray(data.commands) ? data.commands : [],
        rawCount = rawCommands.length,
        animationLimitReached = pluginEnabled("animation") && state.animations.length >= MAX_VISIBLE_ANIMATIONS && rawCommands.some((command) => (command?.tool || command?.type || command?.name) === "animate_scene"),
        widgetLimitReached = state.widgets.length >= MAX_VISIBLE_WIDGETS && rawCommands.some((command) => (command?.tool || command?.type || command?.name) === "html_widget"),
        commands = normalizeCommandPlacements(validate(rawCommands, aiColor), packed, requestBox),
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
        if (!isolatedSelection && !oneShotInput && state.recognitionGeneration === recognitionGeneration) {
          restoreDirty(dirtySnapshot);
          state.autoEligible = Boolean(state.dirty);
          schedule();
        }
        setStatusKey("deferred");
        debug("ai-deferred", { ...meta, reason: "user-revision-changed" });
        return;
      }
      if (commands.length) {
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
          if (!activeItems.length) throw Error(AI_REJECTED);
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
          }
          run.inputConsumed = true;
        }
        if (!isolatedSelection) save();
        if (animationLimitReached) setStatusKey("animationLimitReached");
        else if (widgetLimitReached) setStatusKey("widgetLimitReached");
        else if (data.message) setStatus(data.message);
        else setStatusKey("aiDone");
      } else {
        if (!isolatedSelection) {
          state.lastUserBox = requestBox;
          if (hotspotCount) state.hotspotTrail.splice(0, hotspotCount);
          if (state.latestTypedInput === typedInput) state.latestTypedInput = null;
        }
        setStatusKey(animationLimitReached ? "animationLimitReached" : widgetLimitReached ? "widgetLimitReached" : "ready");
      }
    } catch (e) {
      if (run.superseded) {
        debug("ai-deferred", { requestId: state.lastRequestId, reason: "request-superseded" });
      } else if (e.message === AI_REJECTED) {
        if (!isolatedSelection && !oneShotInput && !run.inputConsumed && state.recognitionGeneration === recognitionGeneration) {
          state.lastUserBox = requestBox;
          if (hotspotCount) state.hotspotTrail.splice(0, hotspotCount);
        }
        setStatusKey("draftRejected");
      } else if (e.message === AI_SUPERSEDED) {
        if (!isolatedSelection && !run.inputConsumed && state.recognitionGeneration === recognitionGeneration) {
          state.lastUserBox = requestBox;
          if (hotspotCount) state.hotspotTrail.splice(0, hotspotCount);
        }
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
      clearTimeout(timeout);
      if (state.activeAI === run) {
        state.activeAI = null;
        setBusy(false);
      }
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
      attention: "use only to refine reading order inside latestInput.imageRect",
      hotspots: result.slice(-64),
    };
  }
  function captureRectFor(latestBox, visible) {
    // Retained dirty ink from a failed request must never expand the next capture beyond what the user can currently see.
    return visible;
  }
  function buildViewportImage(hotspotPoints, latestBox) {
    const visible = viewportRect();
    if (!visible) return null;
    const captureRect = captureRectFor(latestBox, visible),
      ink = unionLocalBounds(unionLocalBounds(visibleInkBounds(captureRect), imageBounds(captureRect)), animationBounds(captureRect));
    if (!ink) return null;
    const margin = Math.max(120, Math.min(640, 160 / state.scale)),
      left = Math.max(captureRect.x, ink.x - margin),
      top = Math.max(captureRect.y, ink.y - margin),
      right = Math.min(captureRect.x + captureRect.w, ink.x + ink.w + margin),
      bottom = Math.min(captureRect.y + captureRect.h, ink.y + ink.h + margin),
      sourceRect = { x: left, y: top, w: right - left, h: bottom - top },
      // Keep ceil(source * scale) inside the server limits despite floating-point drift.
      imageScale = Math.min(1, MAX_ATLAS_WIDTH / sourceRect.w, MAX_ATLAS_HEIGHT / sourceRect.h) * (1 - Number.EPSILON * 4),
      imageSize = {
        w: Math.max(1, Math.min(MAX_ATLAS_WIDTH, Math.ceil(sourceRect.w * imageScale))),
        h: Math.max(1, Math.min(MAX_ATLAS_HEIGHT, Math.ceil(sourceRect.h * imageScale))),
      },
      out = offscreen(imageSize.w, imageSize.h),
      q = out.getContext("2d");
    const latestVisible = intersection(latestBox, sourceRect),
      captureTime = performance.now();
    if (!latestVisible) return null;
    q.fillStyle = "#fff";
    q.fillRect(0, 0, out.width, out.height);
    q.setTransform(imageScale, 0, 0, imageScale, -sourceRect.x * imageScale, -sourceRect.y * imageScale);
    q.globalAlpha = 0.42;
    drawImagesToContext(q, sourceRect);
    forTiles(sourceRect.x, sourceRect.y, sourceRect.w, sourceRect.h, (c, tx, ty) => q.drawImage(c, tx * TILE, ty * TILE), false);
    drawSharpOverlays(q, sourceRect);
    drawAnimationsToContext(q, sourceRect, captureTime);
    q.globalAlpha = 1;
    q.save();
    q.beginPath();
    q.rect(latestVisible.x, latestVisible.y, latestVisible.w, latestVisible.h);
    q.clip();
    drawImagesToContext(q, latestVisible);
    forTiles(latestVisible.x, latestVisible.y, latestVisible.w, latestVisible.h, (c, tx, ty) => q.drawImage(c, tx * TILE, ty * TILE), false);
    drawSharpOverlays(q, latestVisible);
    drawAnimationsToContext(q, latestVisible, captureTime);
    q.restore();
    const focusInset = FOCUS_INSET_ENABLED ? drawFocusInset(out, latestVisible, sourceRect, imageScale, captureTime) : null,
      hotspotGrid = mapHotspots(sourceRect, imageSize, hotspotPoints);
    debug("atlas-built", {
      scope: "visible-content",
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
      hotspotGrid: { columns: 8, rows: 8, order: "oldest-to-newest", attention: "use only to refine reading order inside latestInput.imageRect", hotspots: [] },
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
    forTiles(focusRect.x, focusRect.y, focusRect.w, focusRect.h, (c, tx, ty) => q.drawImage(c, tx * TILE, ty * TILE), false);
    q.globalAlpha = 1;
    drawSharpOverlays(q, focusRect);
    drawAnimationsToContext(q, focusRect, captureTime);
    q.save();
    q.beginPath();
    q.rect(latestBox.x, latestBox.y, latestBox.w, latestBox.h);
    q.clip();
    drawImagesToContext(q, latestBox);
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
  function validate(cmds, aiColor = state.aiColor) {
    if (!Array.isArray(cmds)) return [];
    let plotPixels = 0,
      animationSlots = pluginEnabled("animation") ? Math.max(0, MAX_VISIBLE_ANIMATIONS - state.animations.length) : 0,
      widgetSlots = Math.max(0, MAX_VISIBLE_WIDGETS - state.widgets.length),
      widgetPluginIds = new Set(enabledPluginDescriptors().map((plugin) => plugin.id));
    const acceptedTools = pluginEnabled("animation")
      ? ["write_text", "draw_formula", "plot_function", "draw", "animate_scene", "erase"]
      : ["write_text", "draw_formula", "plot_function", "draw", "erase"];
    if (widgetPluginIds.size) acceptedTools.push("html_widget");
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
        if (c.tool === "plot_function" && (!n(c.x) || !n(c.y) || !n(c.w, 240, 6000) || !n(c.h, 180, 6000) || c.w * c.h > 8000000 || Math.max(c.w / c.h, c.h / c.w) > 6 || plotPixels + c.w * c.h > 12000000 || c.x + c.w > SIZE || c.y + c.h > SIZE || typeof c.expression !== "string" || c.expression.length > 180)) return null;
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
          c = { ...normalized, color: aiColor };
        }
        if (c.tool === "animate_scene") {
          if (animationSlots <= 0) return null;
          const normalized = ANIMATION?.normalize(c, SIZE);
          if (!normalized) return null;
          c = normalized;
          animationSlots--;
        }
        if (c.tool === "html_widget") {
          if (widgetSlots <= 0 || !widgetPluginIds.has(c.pluginId) || !n(c.x) || !n(c.y) || !n(c.w, 300, 5000) || !n(c.h, 200, 4000) || c.w * c.h > 12000000 || c.x + c.w > SIZE || c.y + c.h > SIZE || typeof c.title !== "string" || !c.title.trim() || c.title.length > 120 || !n(c.refreshSeconds, 60, 86400) || typeof c.html !== "string" || !c.html.trim() || c.html.length > MAX_WIDGET_HTML_LENGTH) return null;
          c = { tool:"html_widget", pluginId:c.pluginId, x:Math.round(c.x), y:Math.round(c.y), w:Math.round(c.w), h:Math.round(c.h), title:c.title.trim(), refreshSeconds:Math.round(c.refreshSeconds), html:c.html };
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
    const widget = validated.find((command) => command.tool === "html_widget");
    return widget ? [widget] : validated;
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
      if (c.tool === "animate_scene" && !pluginEnabled("animation")) throw Error(AI_REJECTED);
      if (c.tool === "html_widget") {
        if (!pluginEnabled(c.pluginId) || !pluginManifests.has(c.pluginId)) throw Error(AI_REJECTED);
        const accepted = await startPendingWidget(c, revision);
        if (accepted === AI_CANCELLED) throw Error(AI_CANCELLED);
        if (accepted === AI_SUPERSEDED) throw Error(AI_SUPERSEDED);
        if (!accepted) throw Error(AI_REJECTED);
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
        }
        else if (c.tool === "draw") {
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
          if (!accepted) throw Error(AI_REJECTED);
        }
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
    }
    else if (c.tool === "draw") {
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
    drawDraftActions(ctx, b, s, pendingCopyable(p), true);
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
      drawDraftActions(ctx, box, s, pendingCopyable(item));
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
  function acceptPending() {
    const p = state.pending;
    if (!p) return;
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
    save();
    render();
    setStatusKey("merged");
    resolvePending(p, p.items ? { acceptedCount } : true);
  }
  function acceptPendingItem(index) {
    const p = state.pending,
      item = p?.items?.[index];
    if (!item) return;
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
    save();
    finishPendingItemAction(p, "itemAccepted");
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
  }
  function rejectPending() {
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
    setCanvasCursor("crosshair");
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
    showAnimationControls();
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
    setCanvasCursor("crosshair");
    if (gesture.changed && state.animationEdit) state.animationEdit.changed = true;
    showAnimationControls();
    requestAnimationLayerRender();
    requestInteractionLayerRender();
    return true;
  }
  function cancelAnimationTouchHold(pointerId = null) {
    const hold = state.animationTouchHold;
    if (!hold || pointerId !== null && hold.id !== pointerId) return false;
    clearTimeout(hold.timer);
    state.animationTouchHold = null;
    return true;
  }
  function beginAnimationTouchHold(event, point, result) {
    cancelAnimationTouchHold();
    const hold = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      point,
      result,
      timer: 0,
    };
    hold.timer = setTimeout(() => {
      if (state.animationTouchHold !== hold) return;
      state.animationTouchHold = null;
      if (state.touches.size !== 1 || !state.touches.has(hold.id) || !state.animations.includes(result.animation)) return;
      state.panGesture = null;
      setNavigating(false);
      beginAnimationGesture({ pointerId: hold.id }, hold.point, hold.result);
    }, ANIMATION_TOUCH_HOLD_MS);
    state.animationTouchHold = hold;
    return true;
  }
  function deselectAnimation() {
    if (!state.selectedAnimationId) return;
    acceptAnimationEdit();
  }
  function isMousePan(e) {
    return e.pointerType === "mouse" && (e.button === 1 || e.altKey);
  }
  function isAnimationActivationPointer(event) {
    return (event.pointerType === "mouse" || event.pointerType === "pen") && event.button === 0;
  }
  function finishDrawing(pointerType) {
    if (!state.drawing) return;
    const d = state.drawing;
    state.drawing = null;
    const shouldRequest = !d.erase;
    if (shouldRequest) {
      for (const point of d.trail) state.hotspotTrail.push(point);
      if (state.hotspotTrail.length > 512) state.hotspotTrail.splice(0, state.hotspotTrail.length - 512);
    }
    notePendingContinuedInput(d);
    state.autoEligible ||= shouldRequest;
    if (shouldRequest && state.autoEligible) schedule();
    save();
    debug("stroke-summary", {
      pointerType,
      points: d.points,
      screenDistance: Math.round(d.screenDistance),
      logicalBbox: d.bbox,
      scale: Number(state.scale.toFixed(3)),
      widthCss: {
        min: Number(d.widthMin.toFixed(2)),
        max: Number(d.widthMax.toFixed(2)),
      },
    });
    if (shouldRequest) setStatusKey(state.pending?.items ? "batchDraftReady" : state.pending ? "draftReady" : "ready");
  }
  function beginCanvasPointerAction(e, point) {
    if (state.selectedAnimationId) acceptAnimationEdit();
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (state.mode === "text" && e.pointerType === "touch") {
      if (!valid(point)) {
        setStatusKey("outsideCanvas");
        return;
      }
      state.textTap = { id: e.pointerId, startX: e.clientX, startY: e.clientY, point };
      return;
    }
    if (state.mode === "text") {
      if (!valid(point)) {
        setStatusKey("outsideCanvas");
        return;
      }
      createTextEditor(point);
      return;
    }
    if (state.mode === "select" && e.pointerType !== "touch") {
      if (state.pending) {
        setStatusKey("pendingConfirm");
        return;
      }
      if (!valid(point)) {
        setStatusKey("outsideCanvas");
        return;
      }
      deselectAnimation();
      handleSelectionPointerDown(e, point);
      return;
    }
    if (e.pointerType === "touch") {
      state.panGesture = {
        id: e.pointerId,
        last: { x: e.clientX, y: e.clientY },
      };
      setNavigating(true);
      return;
    }
    const p = point;
    if (!valid(p)) {
      setStatusKey("outsideCanvas");
      debug("stroke-outside-canvas", {
        x: Math.round(p.x),
        y: Math.round(p.y),
        scale: Number(state.scale.toFixed(3)),
      });
      return;
    }
    supersedeActiveAI("user-input-started");
    clearTimeout(state.timer);
    state.timer = 0;
    state.latestTypedInput = null;
    const erasing = state.mode === "eraser";
    if (erasing) invalidateRecognition();
    const cssSize = erasing ? state.eraser : pressureWidth(e),
      size = logicalWidth(cssSize);
    state.userRevision++;
    state.drawing = {
      id: e.pointerId,
      last: p,
      size,
      start: p,
      points: 1,
      screenDistance: 0,
      widthMin: cssSize,
      widthMax: cssSize,
      bbox: { x: p.x, y: p.y, w: 0, h: 0 },
      trail: [p],
      erase: erasing,
    };
    dot(p, erasing, size, !erasing);
    requestRender();
  }
  screen.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (Date.now() < state.textInputBlockedUntil) return;
    try {
      screen.setPointerCapture(e.pointerId);
    } catch {}
    calibrateScreenClientRatio(e, false);
    state.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (e.pointerType === "touch") {
      state.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (state.touches.size >= 2) {
        cancelAnimationTouchHold();
        cancelImageTouchHold();
        state.textTap = null;
        if (state.pendingGesture) state.pendingGesture = null;
        if (state.widgetGesture) finishWidgetGesture({ pointerId:state.widgetGesture.id });
        if (state.selectedWidgetId) acceptWidgetEdit();
        if (state.imageGesture) finishImageGesture({ pointerId:state.imageGesture.id });
        if (state.selectedImageId) acceptImageEdit();
        if (state.animationGesture) finishAnimationGesture({ pointerId: state.animationGesture.id });
        if (state.selectedAnimationId) acceptAnimationEdit();
        finishDrawing("pen");
        beginTouchGesture();
        return;
      }
    }
    if (isMousePan(e)) {
      if (state.selectedImageId) acceptImageEdit();
      if (state.selectedWidgetId) acceptWidgetEdit();
      if (state.selectedAnimationId) acceptAnimationEdit();
      state.panGesture = {
        id: e.pointerId,
        last: { x: e.clientX, y: e.clientY },
      };
      setCanvasCursor("grabbing");
      setNavigating(true);
      return;
    }
    if (state.pending) {
      const result = pendingHit(state.pending, e, state.pending.revealProgress < 1),
        hit = typeof result === "string" ? result : result?.hit,
        itemIndex = result && typeof result === "object" ? result.itemIndex : null;
      if (hit) {
        if (hit === "copy" || hit === "item-copy") {
          armPendingCopy(e, hit, itemIndex);
          return;
        }
        if (hit === "accept") return acceptPending();
        if (hit === "cancel") return rejectPending();
        if (hit === "item-accept") return acceptPendingItem(itemIndex);
        if (hit === "item-cancel") return rejectPendingItem(itemIndex);
        beginPendingGesture(e, hit, itemIndex);
        return;
      }
    }
    const point = clientPoint(e);
    const widgetResult = widgetRuntimeEnabled() && valid(point) ? widgetPointerHit(point, e.pointerType) : null;
    if (widgetResult) {
      beginWidgetGesture(e, point, widgetResult);
      return;
    }
    if (state.selectedWidgetId) acceptWidgetEdit();
    const selectedImageResult = valid(point) ? imagePointerHit(point, e.pointerType) : null;
    if (selectedImageResult) {
      if (state.selectedAnimationId) acceptAnimationEdit();
      if (e.pointerType === "touch" && selectedImageResult.hit === "move") {
        beginImageTouchHold(e, point, selectedImageResult.image);
        return;
      }
      beginImageGesture(e, point, selectedImageResult);
      return;
    }
    if (state.selectedImageId) acceptImageEdit();
    if (e.pointerType === "touch" && valid(point)) {
      const animationResult = animationPointerHit(point, e.pointerType);
      if (animationResult) {
        beginAnimationTouchHold(e, point, animationResult);
        return;
      }
    }
    if (isAnimationActivationPointer(e) && valid(point)) {
      const animationResult = animationPointerHit(point, e.pointerType);
      if (animationResult) {
        beginAnimationGesture(e, point, animationResult);
        return;
      }
    }
    if (e.pointerType === "touch" && valid(point)) {
      const item = imageAtPoint(point);
      if (item) {
        if (state.selectedAnimationId) acceptAnimationEdit();
        beginImageTouchHold(e, point, item);
        return;
      }
    }
    if (isAnimationActivationPointer(e) && valid(point)) {
      const item = imageAtPoint(point);
      if (item) {
        if (state.selectedAnimationId) acceptAnimationEdit();
        beginImageTouchHold(e, point, item);
        return;
      }
    }
    beginCanvasPointerAction(e, point);
  });
  screen.addEventListener("pointermove", (e) => {
    e.preventDefault();
    const old = state.pointers.get(e.pointerId);
    calibrateScreenClientRatio(e, true);
    state.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (e.pointerType === "touch") state.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (state.pendingGesture?.id === e.pointerId) {
      updatePendingGesture(e);
      return;
    }
    if (state.widgetGesture?.id === e.pointerId) {
      updateWidgetGesture(e);
      return;
    }
    if (state.imageGesture?.id === e.pointerId) {
      updateImageGesture(e);
      return;
    }
    if (state.animationGesture?.id === e.pointerId) {
      updateAnimationGesture(e);
      return;
    }
    if (state.selectionGesture?.id === e.pointerId) {
      updateSelectionGesture(e);
      const point = clientPoint(e);
      coords.textContent = `x ${Math.round(point.x)} · y ${Math.round(point.y)} · ${Math.round(state.scale * 100)}%`;
      return;
    }
    if (state.textTap?.id === e.pointerId) {
      const tap = state.textTap,
        distance = Math.hypot(e.clientX - tap.startX, e.clientY - tap.startY);
      if (distance > 8) {
        state.textTap = null;
        state.panGesture = { id: e.pointerId, last: { x: e.clientX, y: e.clientY } };
        setNavigating(true);
      } else return;
    }
    if (state.imageTouchHold?.id === e.pointerId) {
      const hold = state.imageTouchHold,
        distance = Math.hypot(e.clientX - hold.startX, e.clientY - hold.startY);
      if (distance <= IMAGE_TOUCH_HOLD_MOVE_PX) return;
      cancelImageTouchHold(e.pointerId);
      if (hold.pointerType === "touch") {
        state.panGesture = { id:e.pointerId, last:old || { x:hold.startX, y:hold.startY } };
        setNavigating(true);
      } else beginCanvasPointerAction(hold.downEvent, hold.point);
    }
    if (state.animationTouchHold?.id === e.pointerId) {
      const hold = state.animationTouchHold,
        distance = Math.hypot(e.clientX - hold.startX, e.clientY - hold.startY);
      if (distance <= ANIMATION_TOUCH_HOLD_MOVE_PX) return;
      cancelAnimationTouchHold(e.pointerId);
      state.panGesture = { id: e.pointerId, last: old || { x: hold.startX, y: hold.startY } };
      setNavigating(true);
    }
    if (e.pointerType === "touch") {
      if (state.touches.size >= 2) {
        updateTouchGesture();
        return;
      }
      if (state.panGesture?.id === e.pointerId && old) {
        moveCanvas(e.clientX - old.x, e.clientY - old.y);
        state.panGesture.last = { x: e.clientX, y: e.clientY };
        setNavigating(true);
      }
      return;
    }
    if (state.panGesture?.id === e.pointerId) {
      if (old) {
        moveCanvas(e.clientX - old.x, e.clientY - old.y);
        setNavigating(true);
      }
      return;
    }
    if (!state.drawing || state.drawing.id !== e.pointerId) return;
    const p = clientPoint(e),
      a = state.drawing.last,
      d = state.drawing,
      cssSize = d.erase ? state.eraser : pressureWidth(e),
      size = logicalWidth(cssSize);
    state.userRevision++;
    stroke(a, p, d.erase, size, !d.erase);
    d.last = p;
    d.size = size;
    d.points++;
    d.screenDistance += old ? Math.hypot(e.clientX - old.x, e.clientY - old.y) : 0;
    if (d.points % 8 === 0) d.trail.push(p);
    d.widthMin = Math.min(d.widthMin, cssSize);
    d.widthMax = Math.max(d.widthMax, cssSize);
    const x1 = Math.min(d.bbox.x, p.x),
      y1 = Math.min(d.bbox.y, p.y),
      x2 = Math.max(d.bbox.x + d.bbox.w, p.x),
      y2 = Math.max(d.bbox.y + d.bbox.h, p.y);
    d.bbox = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    requestRender();
    coords.textContent = `x ${Math.round(p.x)} · y ${Math.round(p.y)} · ${Math.round(state.scale * 100)}%`;
  });
  function end(e) {
    state.pointers.delete(e.pointerId);
    if (e.pointerType === "touch") state.touches.delete(e.pointerId);
    cancelAnimationTouchHold(e.pointerId);
    const imageTapHold = state.imageTouchHold?.id === e.pointerId ? state.imageTouchHold : null;
    cancelImageTouchHold(e.pointerId);
    if (imageTapHold && imageTapHold.pointerType !== "touch" && e.type !== "pointercancel") beginCanvasPointerAction(imageTapHold.downEvent, imageTapHold.point);
    if (state.widgetGesture?.id === e.pointerId) {
      finishWidgetGesture(e);
      return;
    }
    if (state.imageGesture?.id === e.pointerId) {
      finishImageGesture(e);
      return;
    }
    if (state.pendingGesture?.id === e.pointerId) {
      if (!finishPendingCopy(e)) {
        if (state.pendingGesture.armed) setCanvasCursor("crosshair");
        state.pendingGesture = null;
      }
      if (e.pointerType === "touch") {
        state.touchGesture = null;
        if (state.touches.size === 1) {
          const [id, p] = state.touches.entries().next().value;
          state.panGesture = { id, last: p };
        } else state.panGesture = null;
        if (!state.touches.size) setNavigating(false);
      }
      return;
    }
    if (state.animationGesture?.id === e.pointerId) {
      finishAnimationGesture(e);
      return;
    }
    if (state.selectionGesture?.id === e.pointerId) {
      finishSelectionGesture(e);
      return;
    }
    if (state.textTap?.id === e.pointerId) {
      const tap = state.textTap;
      state.textTap = null;
      if (e.type !== "pointercancel" && state.mode === "text") createTextEditor(tap.point);
      state.touchGesture = null;
      state.panGesture = null;
      if (!state.touches.size) setNavigating(false);
      return;
    }
    if (e.pointerType === "touch") {
      state.touchGesture = null;
      if (state.touches.size === 1) {
        const [id, p] = state.touches.entries().next().value;
        state.panGesture = { id, last: p };
      } else state.panGesture = null;
      if (!state.touches.size) setNavigating(false);
      return;
    }
    if (state.panGesture?.id === e.pointerId) {
      state.panGesture = null;
      setCanvasCursor("crosshair");
      setNavigating(false);
      return;
    }
    if (state.drawing?.id === e.pointerId) finishDrawing(e.pointerType);
  }
  screen.addEventListener("pointerup", end);
  screen.addEventListener("pointercancel", end);
  screen.addEventListener("contextmenu", (e) => e.preventDefault());
  view.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const r = view.getBoundingClientRect(),
        factor = e.deltaY < 0 ? 1.12 : 0.89,
        n = Math.max(0.03, Math.min(2, state.scale * factor)),
        px = e.clientX - r.left,
        py = e.clientY - r.top;
      state.panX = px - ((px - state.panX) * n) / state.scale;
      state.panY = py - ((py - state.panY) * n) / state.scale;
      state.scale = n;
      updateCoordinates();
      requestRender();
      wheelNavigating();
    },
    { passive: false },
  );
  function setCanvasMode(mode) {
    const button = document.querySelector(`[data-mode="${mode}"]`);
    if (!button) return;
    if (state.mode === "select" && mode !== "select" && state.selection) {
      if (selectionAIBusy(state.selection)) {
        setStatusKey(selectionAIStatusKey(state.selection));
        return;
      }
      commitSelection();
    }
    state.mode = mode;
    if (mode !== "select") deselectAnimation();
    document.querySelectorAll("[data-mode]").forEach((item) => item.classList.toggle("active", item === button));
    setCanvasCursor("crosshair");
  }
  document.querySelectorAll("[data-mode]").forEach((button) => {
    button.onclick = () => setCanvasMode(button.dataset.mode);
  });
  [selectionTypesetButton, selectionDeleteButton, selectionCancelButton].filter(Boolean).forEach((button) => {
    button.addEventListener("pointerdown", (event) => event.stopPropagation());
    button.addEventListener("click", (event) => event.stopPropagation());
  });
  imagePlaceButton.onclick = () => acceptImageEdit();
  imageMergeButton.onclick = () => {
    const item = selectedImage();
    if (item) mergeImage(item);
  };
  imageDeleteButton.onclick = () => {
    const item = selectedImage();
    if (item) deleteImage(item);
  };
  for (const button of [imagePlaceButton, imageMergeButton, imageDeleteButton]) {
    button.addEventListener("pointerdown", (event) => event.stopPropagation());
    button.addEventListener("click", (event) => event.stopPropagation());
  }
  imagePickerButton.addEventListener("click", () => {
    if (state.imageImporting) return;
    if (selectionAIBusy()) {
      setStatusKey(selectionAIStatusKey());
      return;
    }
    if (state.images.length >= MAX_VISIBLE_IMAGES) {
      setStatusKey("imageLimitReached");
      return;
    }
    imagePickerInput.value = "";
    imagePickerInput.click();
  });
  imagePickerInput.addEventListener("change", () => {
    const file = imagePickerInput.files?.[0];
    if (file) void addImageFile(file);
    else imagePickerInput.value = "";
  });
  if (selectionTypesetButton) selectionTypesetButton.onclick = normalizeSelectionForAI;
  if (selectionDeleteButton) selectionDeleteButton.onclick = deleteSelection;
  if (selectionCancelButton) selectionCancelButton.onclick = () => cancelSelection();
  [animationPlayPause, animationRestart, animationDelete].forEach((button) => button.addEventListener("pointerdown", (event) => event.stopPropagation()));
  animationPlayPause.onclick = toggleSelectedAnimationPlayback;
  animationRestart.onclick = restartSelectedAnimation;
  animationDelete.onclick = deleteSelectedAnimation;
  animationControls.addEventListener("click", (event) => event.stopPropagation());
  animationControls.addEventListener("pointerdown", (event) => event.stopPropagation());

  document.querySelector("#penSize").oninput = (e) => {
    state.pen = +e.target.value;
    document.querySelector("#penSizeValue").textContent = `${state.pen} px`;
  };
  document.querySelector("#aiFont").onchange = (e) => {
    state.aiFont = e.target.value;
  };
  function closeColorOrbs(except = null) {
    document.querySelectorAll("[data-color-control]").forEach((control) => {
      if (control === except) return;
      const trigger = control.querySelector(".color-orb-trigger"),
        focusedInside = control.contains(document.activeElement) && document.activeElement !== trigger;
      control.classList.remove("open");
      trigger.setAttribute("aria-expanded", "false");
      control.querySelector(".color-orbit").setAttribute("aria-hidden", "true");
      control.querySelectorAll(".orbit-swatch").forEach((button) => button.setAttribute("tabindex", "-1"));
      if (focusedInside) trigger.focus();
    });
  }
  document.querySelectorAll("[data-color-control]").forEach((control) => {
    const trigger = control.querySelector(".color-orb-trigger"),
      orbit = control.querySelector(".color-orbit"),
      type = control.dataset.colorControl;
    trigger.onclick = (event) => {
      event.stopPropagation();
      const open = !control.classList.contains("open");
      closeColorOrbs(control);
      control.classList.toggle("open", open);
      trigger.setAttribute("aria-expanded", String(open));
      orbit.setAttribute("aria-hidden", String(!open));
      control.querySelectorAll(".orbit-swatch").forEach((button) => button.setAttribute("tabindex", open ? "0" : "-1"));
    };
    control.querySelectorAll(".orbit-swatch").forEach((button) => {
      button.onclick = (event) => {
        event.stopPropagation();
        const color = type === "ink" ? button.dataset.inkColor : button.dataset.aiColor;
        if (type === "ink") {
          state.inkColor = color;
          applySelectionColor(color);
          positionTextEditors();
          for (const editor of state.textEditors.values()) if (editor.mixedMode) scheduleTextEditorPreview(editor, 0);
        }
        else state.aiColor = color;
        trigger.classList.remove(...Object.values(COLOR_CLASS));
        trigger.classList.add(COLOR_CLASS[color]);
        control.querySelectorAll(".orbit-swatch").forEach((item) => {
          const active = item === button;
          item.classList.toggle("active", active);
          item.setAttribute("aria-checked", String(active));
        });
        closeColorOrbs();
      };
    });
  });
  document.querySelectorAll(".orbit-swatch").forEach((button) => {
    button.setAttribute("role", "menuitemradio");
    button.setAttribute("tabindex", "-1");
    button.setAttribute("aria-checked", String(button.classList.contains("active")));
  });
  document.addEventListener("click", () => closeColorOrbs());
  document.querySelector("#rejectBatch").onclick = rejectPending;
  document.querySelector("#acceptBatch").onclick = acceptPending;
  document.querySelector("#auto").onclick = () => {
    if (state.auto) setAutoEnabled(false);
    else setAutoEnabled(true, true);
  };
  document.querySelector("#autoDelayRange").oninput = (event) => {
    state.autoDelayMs = Math.round(Math.max(0, Math.min(10, Number(event.target.value))) * 1000);
    localStorage.setItem("penecho-auto-delay-ms", String(state.autoDelayMs));
    updateAutoControl();
    schedule();
    keepAutoDelayControlOpen();
  };
  document.querySelector("#aiEffortButton").onclick = () => {
    if (document.querySelector("#effortPopover").hidden) showEffortControl();
    else hideEffortControl();
  };
  pluginButton.onclick = () => {
    if (pluginPopover.hidden) showPluginControl();
    else hidePluginControl();
  };
  pluginClose.onclick = hidePluginControl;
  pluginRefresh.onclick = () => {
    state.pluginCatalogNotice = null;
    void loadPluginDocuments();
  };
  pluginLocalTab.onclick = () => setPluginTab("local");
  pluginCreateTab.onclick = () => setPluginTab("create");
  pluginServerTab.onclick = () => setPluginTab("server");
  pluginSimpleTemplate.onclick = () => setPluginTemplate("simple");
  pluginTitle.addEventListener("input", () => {
    if (state.pluginAuthoringStatus?.type === "error") state.pluginAuthoringStatus = null;
    updatePluginAuthoringUi();
  });
  pluginDocumentEditor.addEventListener("input", () => {
    state.pluginAuthoringStatus = null;
    updatePluginAuthoringUi();
  });
  pluginImprove.onclick = () => void improvePluginDraft();
  pluginCreateForm.addEventListener("submit", (event) => void savePluginDraft(event));
  pluginOptions.addEventListener("click", (event) => {
    const deleteButton = event.target.closest("button[data-plugin-delete]");
    if (!deleteButton) return;
    event.preventDefault();
    event.stopPropagation();
    void deleteLocalPlugin(deleteButton.dataset.pluginDelete);
  });
  pluginOptions.addEventListener("change", (event) => {
    const input = event.target.closest("input[data-plugin-id]");
    if (!input) return;
    setPluginEnabled(input.dataset.pluginId, input.checked);
  });
  pluginPopover.addEventListener("pointerdown", (event) => {
    if (event.target === pluginPopover) hidePluginControl();
  });
  pluginPopover.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      hidePluginControl();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...pluginPopover.querySelectorAll("button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled)")].filter((element) => !element.closest("[hidden]"));
    if (!focusable.length) return;
    const current = focusable.indexOf(document.activeElement), next = event.shiftKey ? (current <= 0 ? focusable.length - 1 : current - 1) : current < 0 || current === focusable.length - 1 ? 0 : current + 1;
    event.preventDefault();
    focusable[next].focus();
  });
  document.querySelectorAll("#effortOptions .effort-option").forEach((option) => {
    option.onclick = () => setEffort(option.dataset.effort);
  });
  document.querySelector("#effortPopover").addEventListener("pointerdown", keepEffortControlOpen);
  document.querySelector("#autoDelayPopover").addEventListener("pointerdown", keepAutoDelayControlOpen);
  document.addEventListener("pointerdown", (event) => {
    if (!document.querySelector("#autoControl").contains(event.target)) hideAutoDelayControl();
    if (!document.querySelector("#effortControl").contains(event.target)) hideEffortControl();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hideEffortControl();
    if (event.key === "Escape") hidePluginControl();
  });
  document.querySelectorAll("[data-language]").forEach((button) => {
    button.onclick = () => {
      state.language = button.dataset.language;
      localStorage.setItem("penecho-language", state.language);
      applyLanguage();
    };
  });
  document.querySelector("#theme").onchange = (e) => applyTheme(e.target.value);
  document.querySelector("#gridToggle").onclick = () => {
    state.gridVisible = !state.gridVisible;
    localStorage.setItem(state.theme === "research" ? "penecho-research-grid" : "penecho-grid", String(state.gridVisible));
    updateGridButton();
    requestRender();
  };
  document.querySelector("#fullscreenBtn").onclick = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (error) {
      setStatus(`${t("aiError")}${error.message}`);
    }
  };
  document.querySelector("#newCanvasBtn").onclick = openNewCanvasDialog;
  document.querySelector("#exportPngBtn").onclick = exportCanvasPng;
  document.querySelector("#historyBtn").onclick = openHistoryPanel;
  document.querySelector("#historyClose").onclick = closeHistoryPanel;
  document.querySelector("#historyBackdrop").onclick = closeHistoryPanel;
  document.querySelector("#historySave").onclick = saveSnapshotFromHistory;
  document.querySelector("#historyNew").onclick = openNewCanvasDialog;
  document.querySelector("#newCanvasClose").onclick = () => document.querySelector("#newCanvasDialog").close("cancel");
  document.querySelector("#newCanvasCancel").onclick = () => document.querySelector("#newCanvasDialog").close("cancel");
  document.querySelector("#textHelpClose").onclick = closeTextHelp;
  document.querySelector("#textHelpDone").onclick = closeTextHelp;
  document.querySelector("#textHelpDialog").addEventListener("close", restoreTextEditorAfterHelp);
  document.querySelector("#newDiscard").onclick = startBlankCanvas;
  document.querySelector("#newSaveCopy").onclick = () => completeNewCanvas("new");
  document.querySelector("#newOverwrite").onclick = () => completeNewCanvas("overwrite");
  document.querySelector("#newCanvasDialog").addEventListener("cancel", (event) => {
    if (event.currentTarget.dataset.busy === "true") event.preventDefault();
  });
  document.querySelector("#historyName").addEventListener("keydown", (event) => {
    if (event.key === "Enter") saveSnapshotFromHistory();
  });
  document.querySelector("#newSnapshotName").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      completeNewCanvas("new");
    }
  });
  document.addEventListener("fullscreenchange", () => {
    updateFullscreenButton();
    requestAnimationFrame(fit);
  });
  document.querySelector("#debugBtn").onclick = (e) => {
    const panel = document.querySelector("#debugPanel");
    panel.hidden = !panel.hidden;
    e.currentTarget.setAttribute("aria-expanded", String(!panel.hidden));
    e.currentTarget.classList.toggle("active", !panel.hidden);
  };
  document.querySelectorAll("[data-action]").forEach(
      (b) =>
      (b.onclick = () => {
        const a = b.dataset.action;
        if (selectionAIBusy()) {
          setStatusKey(selectionAIStatusKey());
          return;
        }
        if ((state.pending || state.pendingWidget) && a !== "clear") {
          setStatusKey("pendingConfirm");
          return;
        }
        if (a === "undo") {
          if (state.selection) commitSelection();
          state.userRevision++;
          undo();
        } else if (a === "redo") {
          if (state.selection) commitSelection();
          state.userRevision++;
          redo();
        } else if (a === "clear") {
          if (confirm(t("clearConfirm"))) {
            if (state.selection) commitSelection();
            clearTextEditors();
            state.userRevision++;
            state.snapshotLoadGeneration++;
            invalidateRecognition();
            state.historyBefore.clear();
            clearSharpOverlays();
            for (const [k, c] of tiles) state.historyBefore.set(k, cloneCanvas(c));
            recordAnimationsBefore();
            recordWidgetsBefore();
            recordImagesBefore();
            state.animations = [];
            state.selectedAnimationId = null;
            state.animationGesture = null;
            state.animationEdit = null;
            hideAnimationControls();
            requestAnimationLayerRender();
            restoreWidgets([]);
            restoreImages([]);
            tiles.clear();
            state.inkBounds.clear();
            cancelPendingForRevision();
            save();
            render();
          }
        } else invokeAIAction(a);
      }),
  );
  embodiment.addEventListener("pointerenter", (e) => {
    if (e.pointerType === "mouse" || e.pointerType === "pen") openRadialMenu();
  });
  embodiment.addEventListener("pointerleave", (e) => {
    if (e.pointerType !== "mouse" && e.pointerType !== "pen") return;
    if (!state.radialGesture) {
      state.radialCloseTimer = setTimeout(closeRadialMenu, 2000);
    }
  });
  aiOrb.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openRadialMenu();
    state.radialGesture = { id: e.pointerId, moved: false, selected: null };
    try {
      aiOrb.setPointerCapture(e.pointerId);
    } catch {}
  });
  aiOrb.addEventListener("pointermove", (e) => {
    const gesture = state.radialGesture;
    if (!gesture || gesture.id !== e.pointerId) return;
    e.preventDefault();
    e.stopPropagation();
    const r = aiOrb.getBoundingClientRect(),
      distance = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
    if (distance > 12) gesture.moved = true;
    gesture.selected = gesture.moved ? chooseRadialAction(e.clientX, e.clientY) : null;
  });
  function finishRadialGesture(e) {
    const gesture = state.radialGesture;
    if (!gesture || gesture.id !== e.pointerId) return;
    e.preventDefault();
    e.stopPropagation();
    const selected = gesture.selected;
    state.radialGesture = null;
    state.radialSuppressClickUntil = performance.now() + 450;
    if (selected) {
      invokeAIAction(selected.dataset.aiAction);
      closeRadialMenu();
      return;
    }
    if (gesture.moved) {
      closeRadialMenu();
    }
  }
  aiOrb.addEventListener("pointerup", finishRadialGesture);
  aiOrb.addEventListener("pointercancel", (e) => {
    if (state.radialGesture?.id !== e.pointerId) return;
    state.radialGesture = null;
    state.radialSuppressClickUntil = performance.now() + 450;
    closeRadialMenu();
  });
  aiOrb.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (performance.now() < state.radialSuppressClickUntil) return;
    if (embodiment.classList.contains("menu-open")) closeRadialMenu();
    else openRadialMenu();
  });
  document.querySelectorAll(".radial-action").forEach((button) => {
    button.addEventListener("pointerenter", (e) => {
      if (e.pointerType !== "mouse" && e.pointerType !== "pen") return;
      clearTimeout(state.radialCloseTimer);
      openRadialMenu();
    });
    button.addEventListener("pointerleave", (e) => {
      if ((e.pointerType !== "mouse" && e.pointerType !== "pen") || state.radialGesture) return;
      state.radialCloseTimer = setTimeout(closeRadialMenu, 2000);
    });
    button.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
    });
    button.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      invokeAIAction(button.dataset.aiAction);
      closeRadialMenu();
    });
  });
  tourReplayButton.addEventListener("click", replayFeatureTour);
  tourBackButton.addEventListener("click", previousFeatureTourStep);
  tourNextButton.addEventListener("click", nextFeatureTourStep);
  tourSkipButton.addEventListener("click", skipFeatureTour);
  changelogCloseButton.addEventListener("click", closeChangelog);
  changelogDoneButton.addEventListener("click", closeChangelog);
  changelogLayer.addEventListener("pointerdown", (event) => {
    if (event.target === changelogLayer) closeChangelog();
  });
  changelogLayer.addEventListener("keydown", handleChangelogKeydown);
  window.addEventListener("keydown", handleFeatureTourKeydown, true);
  window.addEventListener("resize", handleFeatureTourViewportChange);
  window.addEventListener("scroll", scheduleFeatureTourPosition, true);
  window.visualViewport?.addEventListener("resize", handleFeatureTourViewportChange);
  window.visualViewport?.addEventListener("scroll", scheduleFeatureTourPosition);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && (document.querySelector("#newCanvasDialog").open || document.querySelector("#textHelpDialog").open)) return;
    if (e.key === "Escape" && state.selection) {
      cancelSelection();
      return;
    }
    if (e.key === "Escape" && state.pendingWidget) {
      rejectPendingWidget();
      return;
    }
    if (e.key === "Escape" && state.imageEdit) {
      cancelImageEdit();
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && state.imageEdit && !/^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(e.target.tagName)) {
      deleteImage(selectedImage());
      return;
    }
    if (e.key === "Escape" && state.widgetEdit) {
      cancelWidgetEdit();
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && state.widgetEdit && !/^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(e.target.tagName)) {
      deleteWidget(selectedWidget());
      return;
    }
    if (e.key === "Enter" && state.selection?.phase === "active" && !/^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(e.target.tagName)) {
      commitSelection();
      return;
    }
    if (e.key === "Escape" && !document.querySelector("#autoDelayPopover").hidden) {
      hideAutoDelayControl();
      document.querySelector("#auto").focus();
      return;
    }
    if (e.key === "Escape" && document.querySelector("#historyPanel").classList.contains("open")) {
      closeHistoryPanel();
      document.querySelector("#historyBtn").focus();
      return;
    }
    if (e.key === "Escape" && embodiment.classList.contains("menu-open")) {
      state.radialGesture = null;
      closeRadialMenu();
      aiOrb.focus();
      return;
    }
    if (e.key === "Alt" && !state.drawing && !state.pending && !state.pendingWidget) setCanvasCursor("grab");
  });
  window.addEventListener("keyup", (e) => {
    if (e.key === "Alt" && !state.panGesture && !state.drawing && !state.pending && !state.pendingWidget) setCanvasCursor("crosshair");
  });
  new ResizeObserver(fit).observe(view);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopAnimationFrames();
    else requestAnimationLayerRender();
  });

  document.querySelectorAll(".radial-action").forEach((button) => button.setAttribute("tabindex", "-1"));
  setPluginTemplate("simple");
  applyLanguage();
  applyTheme(state.theme);
  loadPluginDocuments().catch(() => {});
  refreshSnapshots().catch(() => {});
  fit();
  requestAnimationFrame(() => requestAnimationFrame(maybeStartOnboarding));
})();
