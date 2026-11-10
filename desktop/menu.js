"use strict";

// The native menu delegates document operations to the Canvas that owns them.
const COMMANDS = Object.freeze([
  "new-canvas", "canvas-library", "save-canvas", "save-copy", "export-png", "close-canvas",
  "undo", "redo", "search-work", "focus-agent", "canvas-view", "fit-content",
  "zoom-in", "zoom-out", "zoom-reset", "toggle-fullscreen", "open-settings",
  "connections", "agent-history", "ai-settings", "shortcuts", "mcp-status", "mcp-local", "mcp-cloud", "tour",
]);
const LABELS = {
  en:{ file:"File", edit:"Edit", view:"View", window:"Window", help:"Help", about:"About PenEcho", settings:"Settings…", updates:"Check for Updates…", hide:"Hide PenEcho", hideOthers:"Hide Others", unhide:"Show All", quit:"Quit PenEcho", close:"Close Window", minimize:"Minimize", zoom:"Zoom", cut:"Cut", copy:"Copy", paste:"Paste", selectAll:"Select All", lan:"Local Network Access", unavailable:"No local network address available", guide:"Getting Started", services:"Services", "new-canvas":"New Canvas…", "close-canvas":"Close Canvas…", "canvas-library":"Canvas Library…", "save-canvas":"Save Canvas", "save-copy":"Save a Copy…", "export-png":"Export as PNG…", undo:"Undo", redo:"Redo", "search-work":"Search Canvases…", "focus-agent":"Toggle Canvas Agent", "canvas-view":"Canvas View Mode", "fit-content":"Fit All Content", "zoom-in":"Zoom In", "zoom-out":"Zoom Out", "zoom-reset":"Actual Size (100%)", "toggle-fullscreen":"Toggle Full Screen", "open-settings":"Settings…", connections:"AI Connections…", "agent-history":"Conversation History…", "ai-settings":"AI & Canvas Settings…", shortcuts:"Keyboard Shortcuts…", "mcp-status":"MCP Status & Sessions", "mcp-local":"Set Up Local MCP…", "mcp-cloud":"Set Up Cloud MCP…", tour:"Feature Tour…" },
  zh:{ file:"文件", edit:"编辑", view:"视图", window:"窗口", help:"帮助", about:"关于 PenEcho", settings:"设置…", updates:"检查更新…", hide:"隐藏 PenEcho", hideOthers:"隐藏其他", unhide:"显示全部", quit:"退出 PenEcho", close:"关闭窗口", minimize:"最小化", zoom:"缩放窗口", cut:"剪切", copy:"复制", paste:"粘贴", selectAll:"全选", lan:"局域网访问", unavailable:"暂无可用的局域网地址", guide:"使用指南", services:"服务", "new-canvas":"新建画布…", "close-canvas":"关闭画布…", "canvas-library":"画布库…", "save-canvas":"保存画布", "save-copy":"保存副本…", "export-png":"导出为 PNG…", undo:"撤销", redo:"重做", "search-work":"搜索画布…", "focus-agent":"显示 / 隐藏 Canvas Agent", "canvas-view":"画布浏览模式", "fit-content":"适应全部内容", "zoom-in":"放大", "zoom-out":"缩小", "zoom-reset":"实际大小（100%）", "toggle-fullscreen":"切换全屏", "open-settings":"设置…", connections:"AI 连接…", "agent-history":"对话记录…", "ai-settings":"AI 与画布设置…", shortcuts:"键盘快捷键…", "mcp-status":"MCP 状态与会话", "mcp-local":"配置本地 MCP…", "mcp-cloud":"配置云端 MCP…", tour:"功能导览…" },
};

function acceleratorFor(chord) {
  if (typeof chord !== "string" || chord.length > 64) return undefined;
  // Single-key Canvas shortcuts (notably Tab) must retain normal text/navigation use.
  if (!/^(?:(?:Mod|Alt|Shift)\+)+[a-z0-9,./;='\-]$/i.test(chord)) return undefined;
  return chord.replace(/\bMod\b/g, "CommandOrControl");
}

function inputChord(input) {
  const key = String(input.key || "");
  return [...(input.control || input.meta ? ["Mod"] : []), ...(input.alt ? ["Alt"] : []), ...(input.shift ? ["Shift"] : []), key.length === 1 ? key.toLowerCase() : key].join("+");
}

function canvasOwnsShortcut(input, state) {
  return state?.recording === true || Object.values(state?.bindings || {}).includes(inputChord(input));
}

function normalizeMenuState(value) {
  const state = { enabled:{}, bindings:{}, recording:value?.recording === true, canvasView:value?.canvasView === true };
  for (const command of COMMANDS) state.enabled[command] = value?.enabled?.[command] === true;
  for (const [id, chord] of Object.entries(value?.bindings || {}).slice(0, 40)) {
    if (typeof chord === "string" && chord.length <= 64) state.bindings[id] = chord;
  }
  return state;
}

function createMenuTemplate({ platform, language, state = {}, canvasFocused = false, dispatch, edit, checkUpdates, openHelp, lanUrls = [], openLan }) {
  const words = LABELS[language] || LABELS.en, mac = platform === "darwin", separator = { type:"separator" };
  const action = command => ({
    id:command, label:words[command], enabled:canvasFocused && state.enabled?.[command] === true,
    accelerator:acceleratorFor(state.bindings?.[command]),
    ...(command === "canvas-view" ? { type:"checkbox", checked:state.canvasView === true } : {}),
    click:() => dispatch(command),
  });
  const editing = command => ({ ...action(command), enabled:!canvasFocused || state.enabled?.[command] === true, click:(_item, window) => edit(command, window) });
  const role = name => ({ role:name, label:words[name] });
  const updates = { id:"check-updates", label:words.updates, click:checkUpdates };
  return [
    ...(mac ? [{ label:"PenEcho", submenu:[{ role:"about", label:words.about }, updates, separator, action("open-settings"), separator, { role:"services", label:words.services }, separator, role("hide"), role("hideOthers"), role("unhide"), separator, role("quit")] }] : []),
    { label:words.file, submenu:[action("new-canvas"), action("canvas-library"), separator, action("save-canvas"), action("save-copy"), action("export-png"), separator, action("close-canvas"), separator, ...(!mac ? [action("open-settings"), separator] : []), role("close"), ...(!mac ? [role("quit")] : [])] },
    { label:words.edit, submenu:[editing("undo"), editing("redo"), separator, role("cut"), role("copy"), role("paste"), role("selectAll")] },
    { label:words.view, submenu:[action("search-work"), separator, action("canvas-view"), action("fit-content"), action("zoom-in"), action("zoom-out"), action("zoom-reset"), separator, action("toggle-fullscreen")] },
    { id:"ai-menu", label:"AI", submenu:[action("focus-agent"), action("agent-history"), separator, action("connections"), action("ai-settings")] },
    { id:"mcp-menu", label:"MCP", submenu:[action("mcp-status"), separator, action("mcp-local"), action("mcp-cloud")] },
    { id:"local-network-menu", label:words.lan, submenu:lanUrls.length ? lanUrls.map(url => ({ label:url, click:() => openLan(url) })) : [{ label:words.unavailable, enabled:false }] },
    { label:words.window, submenu:[role("minimize"), role("zoom")] },
    { label:words.help, submenu:[{ label:words.guide, click:openHelp }, action("tour"), action("shortcuts"), ...(!mac ? [separator, updates, { role:"about", label:words.about }] : [])] },
  ];
}

module.exports = { COMMANDS, createMenuTemplate, normalizeMenuState, canvasOwnsShortcut, acceleratorFor };
