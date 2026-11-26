"use strict";

// The native menu follows the page in front. On the Projects page it drives that page (public/lines/desktop-menu.js);
// on a Canvas it delegates document operations to the Canvas that owns them (src/client/app/desktop-menu.js).
// Settings live on the Projects page, so a Canvas sends those items there.
const CANVAS_COMMANDS = Object.freeze([
  "new-canvas", "canvas-library", "save-canvas", "save-copy", "export-png", "close-canvas",
  "undo", "redo", "search-work", "canvas-view", "fit-content",
  "zoom-in", "zoom-out", "zoom-reset", "toggle-fullscreen", "shortcuts",
]);
// Items that open a place on the Projects page. A Canvas saves and goes there.
const PROJECT_COMMANDS = Object.freeze([
  "show-projects", "new-project", "new-line", "new-note", "lines-new-canvas", "find",
  "view-home", "view-topics", "view-files", "go-back", "go-forward",
  "open-settings", "open-agents", "open-mcp", "open-archived", "theme-light", "theme-dark", "theme-system",
]);
const COMMANDS = Object.freeze([...CANVAS_COMMANDS, ...PROJECT_COMMANDS]);
// What a Canvas can still do from here: the rest needs the Projects page itself.
const CANVAS_LEAVES = new Set(["show-projects", "new-project", "open-settings", "open-agents", "open-mcp", "open-archived"]);
const LABELS = {
  en:{ file:"File", edit:"Edit", view:"View", window:"Window", help:"Help", about:"About PenEcho", updates:"Check for Updates…", hide:"Hide PenEcho", hideOthers:"Hide Others", unhide:"Show All", quit:"Quit PenEcho", exit:"Exit", close:"Close Window", minimize:"Minimize", zoom:"Zoom", front:"Bring All to Front", cut:"Cut", copy:"Copy", paste:"Paste", selectAll:"Select All", undo:"Undo", redo:"Redo", togglefullscreen:"Toggle Full Screen", services:"Services",
    devices:"Open on Another Device", unavailable:"No local network address available", lanOff:"Off for other devices (Settings → General)", guide:"Getting Started", issue:"Report a Problem…", website:"PenEcho Website", appearance:"Appearance",
    docsFolder:{ darwin:"Show Docs Folder in Finder", other:"Show Docs Folder in Explorer" }, codeFolder:{ darwin:"Show Code Folder in Finder", other:"Show Code Folder in Explorer" },
    "new-canvas":"New Canvas…", "close-canvas":"Close Canvas…", "canvas-library":"Canvas Library…", "save-canvas":"Save Canvas", "save-copy":"Save a Copy…", "export-png":"Export as PNG…", "search-work":"Search Canvases…", "canvas-view":"Canvas View Mode", "fit-content":"Fit All Content", "zoom-in":"Zoom In", "zoom-out":"Zoom Out", "zoom-reset":"Actual Size (100%)", "toggle-fullscreen":"Toggle Full Screen", shortcuts:"Keyboard Shortcuts…",
    "show-projects":"Back to Project", "new-project":"New Project…", "new-line":"New Line", "new-note":"New Note", "lines-new-canvas":"New Canvas", find:"Find…", "view-home":"Home", "view-topics":"Topics", "view-files":"Canvases & Files", "go-back":"Back", "go-forward":"Forward",
    "open-settings":"Settings…", "open-agents":"Agents…", "open-mcp":"MCP for AI Apps…", "open-archived":"Archived Projects…", "theme-light":"Light", "theme-dark":"Dark", "theme-system":"System" },
  zh:{ file:"文件", edit:"编辑", view:"视图", window:"窗口", help:"帮助", about:"关于 PenEcho", updates:"检查更新…", hide:"隐藏 PenEcho", hideOthers:"隐藏其他", unhide:"显示全部", quit:"退出 PenEcho", exit:"退出", close:"关闭窗口", minimize:"最小化", zoom:"缩放窗口", front:"全部置于顶层", cut:"剪切", copy:"复制", paste:"粘贴", selectAll:"全选", undo:"撤销", redo:"重做", togglefullscreen:"切换全屏", services:"服务",
    devices:"在其他设备上打开", unavailable:"暂无可用的局域网地址", lanOff:"其他设备已关闭（设置 → 通用）", guide:"使用指南", issue:"报告问题…", website:"PenEcho 网站", appearance:"外观",
    docsFolder:{ darwin:"在访达中显示文档文件夹", other:"在资源管理器中显示文档文件夹" }, codeFolder:{ darwin:"在访达中显示代码文件夹", other:"在资源管理器中显示代码文件夹" },
    "new-canvas":"新建画布…", "close-canvas":"关闭画布…", "canvas-library":"画布库…", "save-canvas":"保存画布", "save-copy":"保存副本…", "export-png":"导出为 PNG…", "search-work":"搜索画布…", "canvas-view":"画布浏览模式", "fit-content":"适应全部内容", "zoom-in":"放大", "zoom-out":"缩小", "zoom-reset":"实际大小（100%）", "toggle-fullscreen":"切换全屏", shortcuts:"键盘快捷键…",
    "show-projects":"回到项目", "new-project":"新建项目…", "new-line":"新建工作线", "new-note":"新建笔记", "lines-new-canvas":"新建画布", find:"查找…", "view-home":"首页", "view-topics":"主题", "view-files":"画布与文件", "go-back":"后退", "go-forward":"前进",
    "open-settings":"设置…", "open-agents":"智能体…", "open-mcp":"AI 应用的 MCP…", "open-archived":"已归档的项目…", "theme-light":"浅色", "theme-dark":"深色", "theme-system":"跟随系统" },
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

const text = (value, max = 200) => (typeof value === "string" ? value.slice(0, max) : "");
// A folder the page names is only ever opened, and only when it is a whole absolute path.
const folder = value => (typeof value === "string" && value.length <= 4096 && (/^\//.test(value) || /^[a-z]:[\\/]/i.test(value)) ? value : "");

function normalizeMenuState(value) {
  const page = value?.page === "projects" ? "projects" : "canvas";
  const state = { page, enabled:{}, bindings:{}, recording:value?.recording === true, canvasView:value?.canvasView === true };
  for (const command of COMMANDS) state.enabled[command] = value?.enabled?.[command] === true;
  for (const [id, chord] of Object.entries(value?.bindings || {}).slice(0, 40)) {
    if (typeof chord === "string" && chord.length <= 64) state.bindings[id] = chord;
  }
  if (page === "projects") {
    state.theme = ["light", "dark", "system"].includes(value?.theme) ? value.theme : "system";
    state.topics = value?.topics === true;
    state.current = text(value?.current);
    state.projects = (Array.isArray(value?.projects) ? value.projects : []).slice(0, 30)
      .map(p => ({ id:text(p?.id), name:text(p?.name, 80) })).filter(p => p.id && p.name);
    state.docsPath = folder(value?.docsPath);
    state.codePath = folder(value?.codePath);
  }
  return state;
}

// The main process sends the page only what its menu offers right now.
function menuCommandAllowed(command, state) {
  if (typeof command !== "string") return false;
  if (command.startsWith("project:")) return state?.page === "projects" && (state.projects || []).some(p => `project:${p.id}` === command);
  if (state?.page !== "projects" && CANVAS_LEAVES.has(command)) return true;
  return COMMANDS.includes(command) && state?.enabled?.[command] === true;
}

function createMenuTemplate({ platform, language, state = {}, canvasFocused = false, dispatch, edit, checkUpdates, openHelp, openIssue = () => {}, openWebsite = () => {}, openFolder = () => {}, lanUrls = [], networkOff = false, openLan }) {
  const words = LABELS[language] || LABELS.en, mac = platform === "darwin", separator = { type:"separator" };
  const projects = state.page === "projects", here = canvasFocused;
  const action = command => ({
    id:command, label:words[command], enabled:here && state.enabled?.[command] === true,
    accelerator:acceleratorFor(state.bindings?.[command]),
    ...(command === "canvas-view" ? { type:"checkbox", checked:state.canvasView === true } : {}),
    click:() => dispatch(command),
  });
  // Projects page items. A Canvas offers only those it can carry out by going to the Projects page.
  const go = (command, accelerator, extra = {}) => ({
    id:command, label:words[command], accelerator,
    enabled:here && (projects ? state.enabled?.[command] === true : CANVAS_LEAVES.has(command)),
    click:() => dispatch(command), ...extra,
  });
  // Shortcuts the page itself already answers are shown, not registered, so the page keeps its own text and dialog guards.
  const shown = { registerAccelerator:false };
  const editing = command => projects
    ? { role:command, label:words[command] }
    : { ...action(command), enabled:!here || state.enabled?.[command] === true, click:(_item, window) => edit(command, window) };
  const role = name => ({ role:name, label:words[name] });
  const updates = { id:"check-updates", label:words.updates, click:checkUpdates };
  const about = { role:"about", label:words.about };
  const settings = [go("open-settings", "CommandOrControl+,"), go("open-agents"), go("open-mcp")];
  const opens = [
    { id:"open-docs-folder", label:words.docsFolder[mac ? "darwin" : "other"], enabled:projects && Boolean(state.docsPath), click:() => openFolder(state.docsPath) },
    ...(projects && state.codePath ? [{ id:"open-code-folder", label:words.codeFolder[mac ? "darwin" : "other"], click:() => openFolder(state.codePath) }] : []),
  ];
  const devices = { id:"local-network-menu", label:words.devices, submenu:networkOff ? [{ label:words.lanOff, enabled:false }] : lanUrls.length ? lanUrls.map(url => ({ label:url, click:() => openLan(url) })) : [{ label:words.unavailable, enabled:false }] };
  const file = projects
    ? [go("new-line", "CommandOrControl+N"), go("new-note"), go("lines-new-canvas"), go("new-project", "Shift+CommandOrControl+N"), separator, ...opens, devices]
    : [action("new-canvas"), action("canvas-library"), separator, action("save-canvas"), action("save-copy"), action("export-png"), separator, action("close-canvas"), go("show-projects"), go("new-project"), separator, devices];
  const view = projects
    ? [go("view-home", "CommandOrControl+1"), ...(state.topics ? [go("view-topics", "CommandOrControl+2")] : []), go("view-files", "CommandOrControl+3"), separator,
      go("go-back", "CommandOrControl+[", shown), go("go-forward", "CommandOrControl+]", shown), separator,
      { label:words.appearance, submenu:["light", "dark", "system"].map(mode => go(`theme-${mode}`, undefined, { type:"radio", checked:state.theme === mode })) },
      separator, role("togglefullscreen")]
    : [action("search-work"), separator, action("canvas-view"), action("fit-content"), action("zoom-in"), action("zoom-out"), action("zoom-reset"), separator, action("toggle-fullscreen")];
  // Projects are listed in the Window menu, as documents are in other apps, with the page's own Alt+1…9.
  const list = projects ? (state.projects || []).map((p, i) => ({
    id:`project:${p.id}`, label:p.name, type:"checkbox", checked:p.id === state.current, enabled:here,
    ...(i < 9 ? { accelerator:`Alt+${i + 1}`, registerAccelerator:false } : {}), click:() => dispatch(`project:${p.id}`),
  })) : [];
  return [
    ...(mac ? [{ label:"PenEcho", submenu:[about, updates, separator, ...settings, separator, role("services"), separator, role("hide"), role("hideOthers"), role("unhide"), separator, role("quit")] }] : []),
    { label:words.file, submenu:[...file, separator, ...(!mac ? [...settings, separator] : []), role("close"), ...(!mac ? [{ role:"quit", label:words.exit }] : [])] },
    { label:words.edit, submenu:[editing("undo"), editing("redo"), separator, role("cut"), role("copy"), role("paste"), role("selectAll"), ...(projects ? [separator, go("find", "CommandOrControl+F")] : [])] },
    { label:words.view, submenu:view },
    { label:words.window, submenu:[role("minimize"), ...(mac ? [role("zoom")] : []), ...(list.length ? [separator, ...list, separator, go("open-archived")] : []), ...(mac ? [separator, role("front")] : [])] },
    { label:words.help, submenu:[{ label:words.guide, click:openHelp }, ...(!projects ? [action("shortcuts")] : []), separator, { label:words.issue, click:openIssue }, { label:words.website, click:openWebsite }, ...(!mac ? [separator, updates, about] : [])] },
  ];
}

module.exports = { COMMANDS, menuCommandAllowed, CANVAS_COMMANDS, PROJECT_COMMANDS, createMenuTemplate, normalizeMenuState, canvasOwnsShortcut, acceleratorFor };
