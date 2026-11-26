"use strict";
const L = require("./layout.js");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const Git = require("./git.js");
const { Service, runtimeBusy } = require("./service.js");
const CanvasMove = require("./canvas-move.js");
const { createAgents } = require("./agents.js");
const { createAgentCheck } = require("./agent-check.js");
const { createAgentUpdates } = require("./agent-updates.js");
const { createAgentPresets } = require("./agent-presets.js");
const { createFolderPicker } = require("./pick-folder.js");
const { createFolderOpener } = require("./open-folder.js");
const { addExample, seedExamples } = require("./examples.js");
const { failure, clip, defaultBase, MY_CANVASES_ID } = require("./store.js");
const F = require("./format.js");
const { linkedFilePath, workSourceFile } = require("../../../public/lines/line-status.js");
const { find:findIn } = require("./find.js");
const { askProject, askHistory } = require("./ask.js");
const { createOrchestrator } = require("./orchestrator.js");
const Tokens = require("./token-evidence.js");
const WorkPricing = require("../../../public/lines/work-pricing.js");
const { syncScope } = require("./sync-scope.js");
const { viewFor } = require("./cloud-view.js");
const { createCloudShare } = require("./cloud-share.js");
const UserSkill = require("../draw.js");
const { createLibrary } = require("./library.js");
const { createMeetCue } = require("./meetcue.js");
const { summaryOf } = require("./summary.js");
const { createComputer, ROUND_MS } = require("./computer.js");
const { fitPicture } = require("./picture-size.js");
const { annotateUsage } = require("../usage-stats.js");

// The local API for project folders. Every read and write goes through the same origin and access
// checks as the Canvas agent, and every path is checked against the project's docs folder.
const MAX_UPLOAD = 64 * 1024 * 1024, MAX_CANVAS = 96 * 1024 * 1024;
const TYPES = { ".png":"image/png", ".jpg":"image/jpeg", ".jpeg":"image/jpeg", ".gif":"image/gif", ".webp":"image/webp", ".svg":"image/svg+xml", ".pdf":"application/pdf", ".md":"text/plain; charset=utf-8", ".txt":"text/plain; charset=utf-8", ".json":"application/json; charset=utf-8", ".csv":"text/plain; charset=utf-8", ".html":"text/html; charset=utf-8" };
const PAGE_TYPES = { ".css":"text/css; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".mjs":"text/javascript; charset=utf-8", ".htm":"text/html; charset=utf-8", ".woff2":"font/woff2", ".woff":"font/woff", ".mp4":"video/mp4", ".mp3":"audio/mpeg" };
const INLINE = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".md", ".txt", ".json", ".html"]);

function zip(entries) {
  const locals = [], centrals = []; let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8"), data = entry.data, packed = !/\.(png|jpe?g|gif|webp|zip|pptx|xlsx|docx)$/i.test(entry.name);
    const body = packed ? zlib.deflateRawSync(data) : data, crc = zlib.crc32 ? zlib.crc32(data) : crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(packed ? 8 : 0, 8);
    local.writeUInt16LE(0x21, 12); local.writeUInt32LE(crc >>> 0, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(packed ? 8 : 0, 10);
    central.writeUInt16LE(0x21, 14); central.writeUInt32LE(crc >>> 0, 16); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, name, body); centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const directory = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32(buffer) { let c = -1; for (const byte of buffer) c = CRC[(c ^ byte) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }

// A deleted example takes the folders PenEcho made for it. Nothing outside PenEcho's examples folder is touched.
function removeExampleFolders(store, project) {
  if (!project.example) return;
  const root = path.join(store.directory, "examples") + path.sep;
  for (const dir of [project.docsPath, ...project.codePaths]) {
    if (dir && path.resolve(dir).startsWith(root)) { try { fs.rmSync(dir, { recursive:true, force:true }); } catch { /* The project is already gone from the list. */ } }
  }
}
function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on("data", chunk => { size += chunk.length; if (size > limit) { reject(failure("TOO_LARGE", "That file is too large.", 413)); req.destroy(); return; } chunks.push(chunk); });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
const TAKE_OVER_MS = 3000;
// On a Mac the first look into Documents, Desktop or Downloads waits until the person answers macOS's question about it, and the
// desktop app's window is served by this thread: kept waiting about 15 seconds, the window cannot load at all.
// Each folder is looked into here off that thread, one at a time, so the question holds one of Node's helper threads instead.
// Answered either way, the folder then reads as before, allowed or refused at once. A folder not made yet is asked about by its parent.
async function reachFolders(folders) {
  for (const folder of new Set(folders.filter(f => typeof f === "string" && path.isAbsolute(f)))) {
    for (let at = folder; ; at = path.dirname(at)) {
      try { await (await fs.promises.opendir(at)).close(); break; }
      catch (error) { if (error.code !== "ENOENT" || path.dirname(at) === at) break; }
    }
  }
}
function createProjectLines({ library = null, directory, authorizeRead, authorizeWrite, readJson, send, isThisComputer = () => true, folders = null, folderOpener = createFolderOpener(), agents, agentPaths = {}, serviceOptions = {}, examples = false, cloud = null, cloudSignIn = null, cloudSyncLogger = null, computerRounds = process.env.NODE_ENV === "test" ? 0 : ROUND_MS, onRuntimeAcquired = null, holdFolders = false } = {}) {
  const agentList = agents || createAgents({ paths:agentPaths });
  // PenEcho always starts. When another PenEcho runs these Lines (a second server on the same state folder, or the old one
  // still closing after Ctrl-C), this one reads them without running them, says where they run, and takes over once that one has gone.
  let service, takeOver = null;
  const userHome = serviceOptions.home ?? agentPaths.home ?? "";
  const options = { directory, agents:agentList, autoWatch:true, recoverOnStart:true, ...serviceOptions, home:userHome };
  const freeHeld = () => { for (const project of service.store.projects) if (project.cloud) service.freeHeld(project); };
  const notifyAcquired = () => {
    try { onRuntimeAcquired?.(); } catch { /* Best-effort owner hook. */ }
    if (service.runtimeInfo?.port) orchestrator?.announce?.(service.runtimeInfo.port);
  };
  const waitToTakeOver = error => {
    service.runtimeBusy = error.owner || {};
    takeOver = setInterval(() => {
      if (service.closed) { clearInterval(takeOver); return; }
      try {
        service.startRuntime({ autoWatch:options.autoWatch !== false, carryOn:options.carryOn ?? options.autoWatch !== false, recoverOnStart:true });
        service.runtimeBusy = null;
        clearInterval(takeOver);
        freeHeld();
        notifyAcquired();
        service.changed?.();
      }
      catch (again) { if (again.code === "RUNTIME_BUSY") service.runtimeBusy = again.owner || {}; }
    }, TAKE_OVER_MS);
    takeOver.unref?.();
  };
  // Held (the desktop app), the Lines start reading nothing in the projects' folders, and run once something needs them (openFolders).
  if (holdFolders) service = new Service({ ...options, autoWatch:false, recoverOnStart:false, foldersHeld:true });
  else try { service = new Service(options); }
  catch (error) {
    if (error.code !== "RUNTIME_BUSY") throw error;
    service = new Service({ ...options, autoWatch:false, recoverOnStart:false });
    waitToTakeOver(error);
  }
  const assertOwner = () => {
    if (service.closed || service.closing) throw failure("CLOSING", "PenEcho is shutting down.", 503);
    if (service.foldersHeld) throw failure("FOLDERS_HELD", "PenEcho has not opened the projects' folders yet.", 503);
    if (service.runtimeBusy && !service.releaseRuntime) throw runtimeBusy(service.runtimeBusy);
  };
  const origReadJson = readJson;
  const readOwnerJson = async (req, limit) => {
    assertOwner();
    const body = await origReadJson(req, limit);
    assertOwner();
    return body;
  };
  const readOwnerRaw = async (req, limit) => {
    assertOwner();
    const raw = await readRaw(req, limit);
    assertOwner();
    return raw;
  };
  readJson = readOwnerJson;
  const asks = askHistory(directory);
  // A project's state is kept by the service and made again only when something it is made from changed (S1, service.stateOf).
  // The old Library, so its Canvases can come into My Canvases.
  if (library) service.library = createLibrary(library);
  // Meetings from MeetCue, through the signed-in account. Signed out (or no Cloud here), it says so instead of failing.
  const meetcue = createMeetCue({ service, cloud:typeof cloud === "function" ? cloud : () => cloud });
  // What the Cloud view draws as the project's home: its lines, where each stands, and its steps (summary.js).
  const summarize = (project, opts) => summaryOf(service, project, opts);
  // This computer as Cloud knows it, and the Asks from penecho.ai it runs (R4, computer.js), after each sync round.
  let computer = null;
  const viewHolders = new Map();
  const cloudShare = cloud ? createCloudShare({ store:service.store, connector:cloud, assertOwner, signIn:cloudSignIn, logger:cloudSyncLogger, summarize, scope:serviceOptions.cloudScope === false ? null : (project, opts) => syncScope(service, project, opts),
    // penecho.ai's page data for each synced project, made here and sent after sync rounds (cloud-view.js).
    pageView:serviceOptions.cloudView === false || serviceOptions.cloudScope === false ? null : (project, base, dbRev, opts) => viewFor(service, project, viewHolders, base, dbRev, (p, o) => syncScope(service, p, o?.knownRemote !== undefined || !(p?.cloud?.syncSince > 0) ? o : { ...o, knownRemote:cloudShare?.knownRemote?.(p) || null }), opts), directory, where:() => computer?.name() || os.hostname(), ...(serviceOptions.cloudRetryMs ? { retryMs:serviceOptions.cloudRetryMs } : {}), ...(serviceOptions.cloudMaxFiles ? { maxFiles:serviceOptions.cloudMaxFiles } : {}), onChanged:project => { service.changed(project); service.sync(project); }, onSynced:async (project, opts) => { service.freeHeld(project, opts?.files); await computer?.runHeld(project, opts); } }) : null;
  if (cloudShare) computer = createComputer({ directory, service, cloudShare, connector:cloud, everyMs:computerRounds });
  // A project kept in Cloud: its lines shown as working there while they run here, and the files waiting for the person's choice.
  if (cloudShare) {
    service.cloudLine = { take:(project, slug) => cloudShare.takeLine(project, slug), hold:(project, lease) => cloudShare.holdLine(project, lease), give:(project, lease) => cloudShare.giveLine(project, lease) };
    service.cloudConflicts = project => cloudShare.conflicts(project);
  }
  // Asks an older PenEcho held back for a busy line in Cloud are plain Not sent again from the start, even while sync cannot reach Cloud (PE-583).
  if (!service.runtimeBusy && !service.foldersHeld) freeHeld();
  const requireCloud = () => { if (!cloudShare) throw failure("NO_CLOUD", "PenEcho Cloud is not available here.", 503); return cloudShare; };
  agentList.useModelFile?.(path.join(directory, "agent-models.json"));
  const agentCheck = createAgentCheck(agentList, { runtimeDirectory:directory, updates:process.env.NODE_ENV === "test" || process.env.NODE_TEST_CONTEXT ? null : createAgentUpdates({ file:path.join(directory, "agent-updates.json") }) });
  const presets = service.presets = createAgentPresets({ file:path.join(directory, "agent-presets.json"), agents:agentList });
  async function readPreset(req, previous) {
    const body = await readJson(req, 4096);
    const agent = String(body.agent ?? previous?.agent ?? "").trim(), model = String(body.model ?? previous?.model ?? "").trim();
    if (agent === "penecho" && model && (agent !== previous?.agent || model !== previous?.model)) {
      const source = agentList.launch(agent)?.source;
      if (!source?.models().choices.includes(model)) await source?.refresh();
      if (!source?.models().choices.includes(model)) throw failure("BAD_PRESET", "Choose a model from PenEcho Cloud.", 400);
    }
    // A level the agent says this model does not take is turned down here, where it is picked or typed, and not only when a Work starts with it.
    // Only when one of the three is changed, so a saved agent from before can still be renamed.
    const effort = String(body.effort ?? previous?.effort ?? "").trim();
    if (effort && (agent !== previous?.agent || model !== (previous?.model || "") || effort !== (previous?.effort || ""))) {
      await agentList.listLevels?.(agent).catch(() => null);
      const refused = agentList.refusal?.(agent, model, effort);
      if (refused) throw failure("BAD_PRESET", refused, 400);
    }
    return body;
  }
  // Orchestrator tab (PE-613): PenEcho's functions for the tab and for the orchestrator's own agent.
  const orchestrator = service.orchestrator = createOrchestrator({ service, directory, onUsage:serviceOptions.onUsage });
  // Token savings are weighed by the prices the person saved, the ones each Work's cost is worked out with. Read at most every few seconds.
  let pricesAt = 0, priceList = [];
  Tokens.usePrices(model => {
    if (Date.now() - pricesAt > 5000) { try { priceList = orchestrator.prices(); } catch { priceList = []; } pricesAt = Date.now(); }
    return WorkPricing.priceFor(String(model || ""), priceList) || null;
  });
  if (examples) for (const project of seedExamples(service.store)) service.sync(project);
  const picker = createFolderPicker();
  const { store } = service;
  // Held, the projects' folders are first looked into when something needs them: a Projects page, a project's Canvas, an agent drawing.
  // So macOS asks about Documents then, after the window is up, and not at all for someone who stays on a Canvas of their own.
  // PenEcho's own folder (the examples) is never asked about.
  let opened = null;
  const inStateFolder = folder => { const rel = path.relative(directory, folder); return !rel.startsWith("..") && !path.isAbsolute(rel); };
  const heldFolders = project => [project.docsPath, ...(project.codePaths || [])].filter(folder => folder && !inStateFolder(folder));
  function openFolders() {
    if (!service.foldersHeld) return Promise.resolve();
    return opened ||= (async () => {
      await reachFolders(store.projects.flatMap(heldFolders));
      if (service.closed || !service.foldersHeld) return;
      service.foldersHeld = false;
      const { autoWatch, recoverOnStart } = options;
      if (autoWatch || recoverOnStart) {
        try { service.startRuntime({ autoWatch, carryOn:options.carryOn ?? autoWatch, recoverOnStart }); }
        catch (error) {
          if (error.code === "RUNTIME_BUSY") waitToTakeOver(error);
          else process.emitWarning(`PenEcho could not start running its Lines: ${error.message}`);
        }
      }
      if (!service.runtimeBusy) freeHeld();
      if (service.releaseRuntime) notifyAcquired();
      service.changed?.();
    })();
  }
  // A folder a route is about to make or fill, looked into off this thread first (reachFolders). Only the desktop app holds folders.
  const reach = folders => holdFolders ? reachFolders(folders.map(folder => String(folder || "").trim().replace(/^~(?=$|[\\/])/, () => os.homedir()))) : Promise.resolve();
  // The projects as listed. `held`: the Canvas page opening by itself, before anything opened the folders. A project there is named from
  // PenEcho's own record, without looking into its folder; the examples are read as always.
  function projectList({ held = false } = {}) {
    const unread = project => held && heldFolders(project).length > 0, mine = store.myCanvases({ create:false });
    return {
      projects:store.projects.map(p => {
        const summary = unread(p) ? { ...service.summaryFrom(p, null), missing:false } : service.summaryOf(p), notice = cloudShare?.noticeFor(p), syncedAt = cloudShare?.syncedAtFor?.(p) || 0;
        return { ...summary, ...(notice ? { cloudNotice:notice } : {}), ...(syncedAt ? { cloudSyncedAt:syncedAt } : {}) };
      }),
      base:defaultBase(), caseInsensitive:process.platform === "darwin" || process.platform === "win32", myCanvases:mine?.id || "",
      ...(!(mine && unread(mine)) && service.firstOpen() ? { firstOpen:true } : {}),
    };
  }
  // penecho.ai answered but nothing it sent could be kept here: say so, with the system's reason, not "Something went wrong reading this project".
  async function syncFromCloud() {
    try { return await orchestrator.sync(); }
    catch (error) {
      if (error.status) throw error;
      console.error("[lines] sync from penecho.ai could not save:", error);
      throw failure("SYNC_SAVE_FAILED", `PenEcho could not save what penecho.ai sent on this computer${error.code ? ` (${error.code})` : ""}. Try again.`, 500);
    }
  }
  async function route(req, res, url, parts) {
    const method = req.method;
    // Agent setup's checks, a short Try and the model an agent runs with: they run on this computer, and answer any device that may use
    // PenEcho, a tablet included (F5). The access checks above already decided who that is.
    if (parts[0] === "agents" && parts[1] === "check" && method === "GET") return send(res, 200, await agentCheck.check({ fresh:url.searchParams.get("fresh") === "1" }));
    if (parts[0] === "agents" && parts[1] === "try" && parts[2] && method === "POST") {
      // A body picks the model and effort to try, from a saved agent's form; none tries the agent as it is set up.
      const body = Number(req.headers["content-length"]) > 0 ? await readJson(req, 4096) : null, text = value => (typeof value === "string" ? value : "");
      const result = await agentCheck.tryRun(decodeURIComponent(parts[2]), body ? { model:text(body.model), effort:text(body.effort) } : undefined);
      if (result.error) throw failure("BAD_MODEL", result.error, 400);
      return send(res, 200, result);
    }
    // A click runs the agent's own updater.
    if (parts[0] === "agents" && parts[1] === "update" && parts[2] && method === "POST") {
      const result = await agentCheck.update(decodeURIComponent(parts[2]));
      if (result.error) throw failure("NO_UPDATES", result.error, 400);
      return send(res, 200, result);
    }
    if (parts[0] === "agents" && parts[1] === "model" && parts[2] && method === "POST") {
      const body = await readJson(req, 4096), text = value => (typeof value === "string" ? value : undefined);
      const result = await agentCheck.pickModel(decodeURIComponent(parts[2]), { model:text(body.model), effort:text(body.effort) });
      if (result.error) throw failure("BAD_MODEL", result.error, 400);
      return send(res, 200, result);
    }
    // Saved agents (F1): runner, model and effort under a name, and the one PenEcho uses when nothing else is picked.
    if (parts[0] === "agent-presets") {
      const id = decodeURIComponent(parts[1] || "");
      const list = () => presets.list({ pickerDetails:true });
      try {
        if (!id && method === "GET") return send(res, 200, list());
        if (!id && method === "POST") { const made = presets.add(await readPreset(req)); return send(res, 200, { preset:made, ...list() }); }
        if (id === "order" && method === "POST") { presets.order((await readJson(req, 16384))?.ids); return send(res, 200, list()); }
        if (id === "default" && method === "POST") { presets.setDefault((await readJson(req, 4096))?.id || ""); return send(res, 200, list()); }
        if (id === "jobs" && method === "POST") { const body = await readJson(req, 4096); presets.setJob(String(body?.job || ""), body?.id || ""); return send(res, 200, list()); }
        if (id && !parts[2] && method === "PATCH") { presets.update(id, await readPreset(req, presets.get(id))); return send(res, 200, list()); }
        if (id && !parts[2] && method === "DELETE") { presets.remove(id); return send(res, 200, list()); }
      } catch (error) { if (error.code && !error.status) error.status = 400; throw error; }
      return send(res, 405, { error:"Method Not Allowed" });
    }
    // Model prices, kept once for this computer: Settings → Agents → Model prices, and Statistics (public/lines/prices.js). Syncing is only ever a click.
    if (parts[0] === "model-prices") {
      if (!parts[1] && method === "GET") return send(res, 200, orchestrator.modelPrices());
      if (!parts[1] && method === "POST") { orchestrator.setPrice(await readJson(req, 65536)); return send(res, 200, orchestrator.modelPrices()); }
      if (parts[1] === "sync" && !parts[2] && method === "POST") { const done = await syncFromCloud(); return send(res, 200, { ...orchestrator.modelPrices(), addedPrices:done.addedPrices, missed:done.missed }); }
      return send(res, 405, { error:"Method Not Allowed" });
    }
    // The drawing skill once for every project, in this user's own skill folders: what is there, add it ({ install:true }) or take it out ({ install:false }).
    if (parts[0] === "agents" && parts[1] === "skill" && !parts[2] && (method === "GET" || method === "POST")) {
      const home = userHome;
      if (method === "GET") return send(res, 200, UserSkill.userSkillStatus(home));
      const body = await readJson(req, 4096);
      if (typeof body?.install !== "boolean") throw failure("BAD_REQUEST", "Send { install: true } or { install: false }.");
      if (!home) throw failure("NO_HOME", "No user home folder is configured for user-level skills.", 400);
      return send(res, 200, body.install ? UserSkill.installUserSkill(home, { force:true }) : UserSkill.removeUserSkill(home));
    }
    if (parts[0] === "agents" && method === "GET") return send(res, 200, { agents:agentList.available(), thisComputer:isThisComputer(req), openFolderLabel:isThisComputer(req) ? folderOpener.label : "", revealFileLabel:isThisComputer(req) ? (folderOpener.revealLabel || "") : "" });
    if (parts[0] === "pick-folder" && method === "POST") {
      // The system's dialog can only open on the screen of the computer running PenEcho. From another machine, the page shows that computer's folders instead.
      if (!isThisComputer(req)) return send(res, 200, { unavailable:true });
      const body = await readJson(req, 4096);
      return send(res, 200, await picker.pick({ prompt:clip(body.prompt, 120) || "Choose a folder" }));
    }
    if (parts[0] === "folders" && method === "GET") {
      if (!folders) return send(res, 200, { roots:[] });
      if (!parts[1]) return send(res, 200, { roots:await folders.roots() });
      return send(res, 200, await folders.browse(parts[1], url.searchParams.get("path") || "", { approved:url.searchParams.get("approved") === "1" }));
    }
    // An example project, made again if it was removed. A new computer already has all three.
    if (parts[0] === "examples" && method === "POST") {
      const body = await readJson(req, 4096), project = addExample(store, String(body?.kind || ""));
      service.sync(project);
      return send(res, 200, { project:service.summaryOf(project) });
    }
    // Signing in to PenEcho Cloud answers with the link to open, on whichever device asked; the account then lives on this computer.
    if (parts[0] === "cloud" && parts[1] === "sign-in" && method === "POST") {
      if (!cloudShare?.signIn) throw failure("NO_CLOUD", "PenEcho Cloud is not available here.", 503);
      return send(res, 200, await cloudShare.signIn(req));
    }
    if (parts[0] === "cloud" && parts[1] === "account" && method === "GET") return send(res, 200, cloudShare ? await cloudShare.accountSummary() : { signedIn:false, unavailable:true });
    // This computer as penecho.ai knows it, and the switch "Run Asks sent from penecho.ai" (R4). It is turned on or off on this computer only.
    if (parts[0] === "computer" && parts.length === 1 && (method === "GET" || method === "POST")) {
      if (!computer) throw failure("NO_CLOUD", "PenEcho Cloud is not available here.", 503);
      if (method === "GET") return send(res, 200, computer.view());
      if (!isThisComputer(req)) throw failure("LOCAL_ONLY", "Change this on the computer running PenEcho.", 403);
      return send(res, 200, computer.set(await readJson(req, 4096)));
    }
    // The account's projects in Cloud, and a project used through Cloud before (or instead of) keeping a copy here.
    if (parts[0] === "cloud" && parts[1] === "projects" && parts.length === 2 && method === "GET") return send(res, 200, await requireCloud().cloudProjects());
    if (parts[0] === "cloud" && parts[1] === "projects" && parts[3] === "copy" && parts.length === 4 && method === "POST") {
      const body = await readJson(req, 4096).catch(() => ({}));
      await reach([typeof body?.folder === "string" && body.folder ? body.folder : store.docsBase]);
      const made = await requireCloud().copyToComputer(parts[2], { folder:typeof body?.folder === "string" ? body.folder : "", docsBase:store.docsBase });
      service.sync(made.project);
      if (made.existed === false) annotateUsage(res, "project-new");
      return send(res, 200, { project:service.summaryOf(made.project), existed:made.existed });
    }
    if (parts[0] === "cloud" && parts[1] === "p" && parts[2]) {
      const rest = url.pathname.slice("/api/lines/".length).split("/").slice(3).join("/");
      await requireCloud().passThrough(req, res, parts[2], rest, url.search, () => readRaw(req, MAX_UPLOAD));
      return;
    }
    if (parts[0] === "cloud" && parts[1] === "sign-out" && method === "POST") {
      if (!isThisComputer(req)) throw failure("LOCAL_ONLY", "Sign out on the computer running PenEcho.", 403);
      return send(res, 200, await requireCloud().signOut());
    }
    // My Canvases, the project for Canvases that belong to no other, made the first time it is asked for.
    if (parts[0] === MY_CANVASES_ID && parts.length === 1 && method === "POST") { if (!store.myCanvases({ create:false })) await reach([store.docsBase]); const project = store.myCanvases(); store.syncGenerated(project, "Project"); return send(res, 200, { project:service.summaryOf(project) }); }
    if (parts[0] === "meetcue" && (method === "GET" || method === "DELETE")) {
      const answer = await meetcue.passThrough(method, parts.slice(1).map(encodeURIComponent).join("/"), url.search);
      return send(res, answer.status, answer.body);
    }
    // Every Canvas of the old Library that this server can reach, and whether it is already in a project.
    if (parts[0] === "library" && parts.length === 1 && method === "GET") return send(res, 200, await service.libraryList());
    if (parts[0] !== "projects") return false;
    if (parts.length === 1) {
      if (method === "GET") return send(res, 200, projectList());
      if (method === "POST") {
        const body = await readJson(req, 16384), known = new Set(store.projects.map(p => p.id));
        await reach(body?.fromGroup !== undefined ? [store.docsBase] : [body?.docsPath, body?.codePath]);
        // From a label of My Canvases: the project is made and its Canvases move into it.
        let made;
        if (body?.fromGroup !== undefined) made = await service.projectFromGroup(body);
        else { const project = store.create(body); store.syncGenerated(project, "Project"); made = { project:service.summaryOf(project) }; }
        if (!known.has(made.project.id)) annotateUsage(res, "project-new");
        return send(res, 200, made);
      }
      return false;
    }
    if (parts[1] === "import" && parts.length === 2 && method === "POST") {
      const known = new Set(store.projects.map(p => p.id)), body = await readJson(req, 16384);
      await reach([body?.docsPath]);
      const project = store.importFolder(body);
      const codeConflict = store.importCodeConflict(project);
      store.syncGenerated(project, "Project");
      if (!known.has(project.id)) annotateUsage(res, "project-new");
      return send(res, 200, { project:service.summaryOf(project), ...(codeConflict ? { codeConflict } : {}) });
    }
    // `my-canvases` stands for that project wherever a project id goes. Anything that writes makes it if it is not there yet.
    const project = parts[1] === MY_CANVASES_ID && method !== "GET" ? store.myCanvases() : store.get(parts[1]), action = parts[2];
    if (!action) {
      if (method === "PATCH") {
        const body = await readJson(req, 16384);
        store.update(project.id, body);
        if (typeof body?.projectMemory === "boolean") await service.memorySwitched(project);
        if (body?.codePath !== undefined) await service.resetCodeFolder(project);
        else if (body?.docsPath) service.conversations.rootsCache.delete(project.id);
        else if (typeof body?.name === "string" && project.trunkCache && !project.trunkCache.git) await service.refreshTrunk(project);
        service.sync(project);
        return send(res, 200, { ok:true });
      }
      if (method === "DELETE") { if (project.myCanvases) throw failure("KEPT", "My Canvases stays where it is. It cannot be removed."); service.stopAll(project); store.forget(project.id); removeExampleFolders(store, project); return send(res, 200, { ok:true }); }
      return false;
    }
    if (action === "state" && method === "GET") {
      // Check Git when first opened or when .git refs changed (e.g. user or agent ran git init / committed / switched branches).
      await service.watchTrunk(project);
      // ?for=light: what a page opens with, and &full= and &parts= for what it shows besides (light-state.js). ?for=rail, ?for=home or
      // ?for=line&line=: the same state with less in it (S1, PE-559). ?rev= answers { same:true } while nothing changed.
      const view = url.searchParams.get("for") || "", line = clip(url.searchParams.get("line") || "", 200);
      const wants = { line, full:clip(url.searchParams.get("full") || "", 8000), parts:clip(url.searchParams.get("parts") || "", 200) };
      const read = () => (view ? service.stateFor(project, view, wants) : service.stateOf(project));
      if (view && !service.stateViews.includes(view)) throw failure("BAD_VIEW", `There is no state for "${clip(view, 40)}".`, 400);
      const state = read();
      if (view === "light") return send(res, 200, service.stateSince(project, state, url.searchParams.get("base") || "", { rev:url.searchParams.get("rev") || "" }));
      // ?base=: a page that keeps the whole state is sent only what changed since the one it has (PE-595).
      if (!view && url.searchParams.has("base")) return send(res, 200, service.stateSince(project, state, url.searchParams.get("base")));
      if (url.searchParams.get("rev") === state.rev) return send(res, 200, { same:true, rev:state.rev });
      // A line's page names the list of files it has (?files=, ?since=) and is sent only what changed in it.
      return send(res, 200, view === "line" ? service.filesSince(state, url.searchParams.get("files") || "", Number(url.searchParams.get("since"))) : state);
    }
    if (action === "doc") {
      if (method === "GET") {
        const detail = url.searchParams.get("path"), doc = store.readText(project, detail);
        const codeLinks = isThisComputer(req) && workCodeLinks(project, detail);
        return send(res, 200, { path:detail, md:doc.text, hash:doc.hash, mtime:doc.mtime, ...(codeLinks?.size ? { codeLinks:[...codeLinks.keys()] } : {}) });
      }
      if (method === "PUT") {
        const body = await readJson(req, 8 * 1024 * 1024);
        const saved = store.writeText(project, clip(body.path, 600), String(body.md ?? ""), { history:true, baseHash:body.baseHash || null });
        const m = String(body.path).match(/^(?:lines|topics)\/([^/]+)\.md$/);
        let picked = false;
        if (m && service.isLine(project, m[1])) picked = await service.pickUp(project, m[1], { wake:true });
        service.sync(project);
        return send(res, 200, { hash:saved.hash, mtime:saved.mtime, picked });
      }
      return false;
    }
    // The agents' own notes and the rules at the top of the code folder are outside the docs folder, so they stay on the computer running PenEcho.
    if (action === "memory" && method === "GET") {
      const local = isThisComputer(req);
      if (!parts[3]) return send(res, 200, await service.memoryLists(project, { local }));
      if (parts[3] !== "read") return false;
      if (!local) throw failure("LOCAL_ONLY", "This can only be read on the computer running PenEcho.", 403);
      return send(res, 200, await service.memoryItem(project, { agent:url.searchParams.get("agent"), id:url.searchParams.get("id"), file:url.searchParams.get("file") }));
    }
    // Ask tab: one saved agent answers a question about the project. Leaving the page stops it.
    if (action === "ask" && method === "POST") {
      const body = await readJson(req, 8192).catch(() => ({})), stop = new AbortController();
      res.on("close", () => { if (!res.writableEnded) stop.abort(); });
      const answered = await askProject(service, project, { question:body?.question, preset:body?.preset, signal:stop.signal });
      return send(res, 200, { ...answered, id:asks.add(project, answered).id });
    }
    // The Asks answered before, newest first; one can be deleted.
    if (action === "asks" && method === "GET" && !parts[3]) return send(res, 200, { asks:asks.list(project) });
    if (action === "asks" && method === "DELETE" && parts[3]) return send(res, 200, { asks:asks.remove(project, clip(parts[3], 40)) });
    // Orchestrator tab: its Lines, starting one, the statistics, model prices, and any of its functions (orchestrator.js).
    if (action === "orchestrator") {
      const what = parts[3] || "";
      if (!what && method === "GET") return send(res, 200, { sessions:orchestrator.sessions(project), tools:orchestrator.TOOLS.map(([n, a, d]) => ({ do:n, args:a, does:d })), kinds:orchestrator.KINDS });
      if (what === "save" && !parts[4] && method === "POST") return send(res, 200, await orchestrator.start(project, await readJson(req, 512 * 1024), { deferred:true }));
      if (!what && method === "POST") return send(res, 200, await orchestrator.start(project, await readJson(req, 512 * 1024)));
      if (what === "stats" && method === "GET") return send(res, 200, { ...orchestrator.stats(project, { kind:url.searchParams.get("kind") || "", days:Number(url.searchParams.get("days")) || 0 }), models:orchestrator.prices() });
      if (what === "agents" && method === "GET") return send(res, 200, orchestrator.agentRecord(project));
      // Every project on this computer, not only this one (the page says so).
      if (what === "index" && method === "GET") return send(res, 200, orchestrator.index({ days:Number(url.searchParams.get("days")) || 0, scope:url.searchParams.get("scope") || "all" }));
      if (what === "prices" && method === "POST") return send(res, 200, orchestrator.setPrice(await readJson(req, 16384)));
      // The reviewer and sync settings by the input box (orch-review.js). Sync only ever runs from this click.
      if (what === "settings" && method === "GET") return send(res, 200, orchestrator.settings());
      if (what === "settings" && method === "POST") return send(res, 200, orchestrator.setSettings(await readJson(req, 4096)));
      if (what === "sync" && method === "POST") return send(res, 200, await syncFromCloud());
      if (what === "review" && !parts[4] && method === "POST") return send(res, 200, orchestrator.requestReview(project, await readJson(req, 4096)));
      if (what === "review" && parts[4] === "stop" && method === "POST") return send(res, 200, orchestrator.stopReview(project, await readJson(req, 4096)));
      if (what === "review" && parts[4] === "continue" && method === "POST") return send(res, 200, orchestrator.continueReview(project, await readJson(req, 4096)));
      if (what === "review" && parts[4] === "resend" && method === "POST") return send(res, 200, orchestrator.resendReview(project, await readJson(req, 4096)));
      if (what === "review" && parts[4] === "ignore" && method === "POST") return send(res, 200, orchestrator.ignoreReview(project, await readJson(req, 4096)));
      if (what === "call" && method === "POST") {
        const body = await readJson(req, 512 * 1024), stop = new AbortController();
        res.on("close", () => { if (!res.writableEnded) stop.abort(); });
        return send(res, 200, await orchestrator.call(project, body, { signal:stop.signal }));
      }
      return false;
    }
    if (action === "find" && method === "GET") return send(res, 200, findIn(service.store, service.activity, project, clip(url.searchParams.get("q"), 300), { tab:url.searchParams.get("tab"), status:url.searchParams.get("status"), state:service.stateOf(project), topics:service.store.scan(project, service.folderList(project), { trust:true }).topics }));
    if (action === "file" && method === "GET") return sendFile(req, res, project, url);
    if (action === "result-file" && method === "GET") {
      if (!isThisComputer(req)) throw failure("LOCAL_ONLY", "Open this code file on the computer running PenEcho.", 403);
      const href = url.searchParams.get("href"), file = workCodeLinks(project, url.searchParams.get("doc"), href).get(href);
      if (!file) throw failure("NOT_FOUND", "This Work no longer links to an available project file.", 404);
      return serveFile(res, file, { code:true });
    }
    // A page folder (N3): its index.html, and what it loads by relative links, at an address that keeps the folder's shape.
    if (action === "page" && method === "GET") return sendPage(res, project, parts.slice(3).join("/"));
    if (action === "sync" && method === "POST") return send(res, 200, await service.syncRecent(project));
    // The project's own folders, picked by name. The path comes from the project, never from the page.
    if (action === "open-folder" && method === "POST") {
      if (!isThisComputer(req)) throw failure("LOCAL_ONLY", "Folders can only be opened on the computer running PenEcho.", 403);
      const body = await readJson(req, 4096).catch(() => ({}));
      let folder = body?.which === "code" ? project.codePaths[0] : project.docsPath;
      if (body?.which === "canvas" && body?.path) {
        const rel = service.checkSource(String(body.path));
        const candidate = service.store.resolve(project, path.dirname(rel));
        folder = fs.existsSync(candidate) && fs.statSync(candidate).isDirectory() ? candidate : project.docsPath;
      }
      if (!folder) throw failure("NOT_FOUND", "This project has no code folder.", 404);
      return send(res, 200, await folderOpener.open(folder));
    }
    // A MeetCue meeting as a line of this project, and this project's memory and finished lines sent to MeetCue.
    if (action === "meetings" && !parts[3] && method === "POST") return send(res, 200, await meetcue.addMeeting(project, await readJson(req, 4096)));
    if (action === "meetcue" && !parts[3] && method === "POST") return send(res, 200, await meetcue.sendToMeetCue(project, await readJson(req, 65536).catch(() => ({}))));
    // A file both sides changed and could not merge: keep this computer's ("mine"), Cloud's ("theirs") or both.
    if (action === "conflicts" && method === "POST") return send(res, 200, await requireCloud().settle(project, await readJson(req, 16384)));
    if (action === "memory-versions" && method === "GET") return send(res, 200, service.memoryVersions(project));
    if (action === "memory-restore" && method === "POST") return send(res, 200, service.restoreMemory(project, await readJson(req, 4096)));
    if (action === "topics-versions" && method === "GET") return send(res, 200, service.topicsVersions(project));
    if (action === "topics-restore" && method === "POST") return send(res, 200, service.restoreTopics(project, await readJson(req, 4096)));
    if (action === "create-knowledge-topic" && method === "POST" && !parts[3]) {
      if (!isThisComputer(req)) throw failure("LOCAL_ONLY", "Add Topics on the computer running PenEcho.", 403);
      return send(res, 201, service.createKnowledgeTopic(project, await readJson(req, 4096)));
    }
    if (action === "update-knowledge-topic" && method === "POST" && !parts[3]) {
      if (!isThisComputer(req)) throw failure("LOCAL_ONLY", "Rename Topics on the computer running PenEcho.", 403);
      return send(res, 200, service.updateKnowledgeTopic(project, await readJson(req, 4096)));
    }
    if (action === "delete-knowledge-topic" && method === "POST" && !parts[3]) {
      if (!isThisComputer(req)) throw failure("LOCAL_ONLY", "Delete Topics on the computer running PenEcho.", 403);
      return send(res, 200, service.deleteKnowledgeTopic(project, await readJson(req, 4096)));
    }
    if (action === "create-topic-area" && method === "POST" && !parts[3]) {
      if (!isThisComputer(req)) throw failure("LOCAL_ONLY", "Add Tier 1 topics on the computer running PenEcho.", 403);
      return send(res, 201, service.createTopicArea(project, await readJson(req, 4096)));
    }
    if (action === "update-topic-area" && method === "POST" && !parts[3]) {
      if (!isThisComputer(req)) throw failure("LOCAL_ONLY", "Rename Tier 1 topics on the computer running PenEcho.", 403);
      return send(res, 200, service.updateTopicArea(project, await readJson(req, 4096)));
    }
    if (action === "delete-topic-area" && method === "POST" && !parts[3]) {
      if (!isThisComputer(req)) throw failure("LOCAL_ONLY", "Delete Tier 1 topics on the computer running PenEcho.", 403);
      return send(res, 200, service.deleteTopicArea(project, await readJson(req, 4096)));
    }
    if (action === "build-topics" && method === "POST") return send(res, 200, await service.buildTopics(project, await readJson(req).catch(() => ({}))));
    if (action === "merge-topics" && method === "POST") return send(res, 200, await service.mergeTopics(project, await readJson(req, 4096)));
    if (action === "restore-line" && method === "POST") return send(res, 200, service.restoreLine(project, await readJson(req)));
    if (action === "branches" && method === "GET") return send(res, 200, await service.branchChoices(project));
    if (action === "track" && method === "POST") return send(res, 200, await service.trackChanges(project));
    if (action === "skill" && method === "POST") return send(res, 200, await service.addSkill(project));
    if (action === "skill" && method === "DELETE") { await service.removeSkill(project); return send(res, 200, { ok:true }); }
    if (action === "memory-skill" && method === "POST") return send(res, 200, await service.addMemorySkill(project));
    if (action === "memory-skill" && method === "DELETE") { await service.removeMemorySkill(project); return send(res, 200, { ok:true }); }
    if (action === "unsent" && method === "POST") {
      const saved = await service.saveUnsent(project, await readJson(req, 512 * 1024));
      if (saved.lineCreated === true) annotateUsage(res, "line-new");
      return send(res, 200, saved);
    }
    if (action === "yours" && method === "POST") {
      const body = await readJson(req, 512 * 1024), saved = await service.saveYours(project, body);
      if (saved.lineCreated === true) annotateUsage(res, "line-new");
      if (body.kind !== "canvas") annotateUsage(res, "line-note");
      return send(res, 200, saved);
    }
    if (action === "copy" && method === "POST") {
      if (!isThisComputer(req)) throw failure("LOCAL_ONLY", "This copies on the computer running PenEcho.", 403);
      const body = await readJson(req, 512 * 1024);
      return send(res, 200, Array.isArray(body?.paths) ? await service.copyFiles(project, body) : await service.copyWords(body));
    }
    if (action === "upload" && method === "POST") {
      const dir = clip(url.searchParams.get("dir"), 300) || "files/_incoming";
      if (!/^files(\/[^/]+)*$/.test(dir) || dir.split("/").includes("..")) throw failure("BAD_PATH", "Uploads go in the files folder.");
      // A picture sent with an Ask or a note is made smaller (picture-size.js); a file added on the Files page is kept as it is.
      const sent = await readOwnerRaw(req, MAX_UPLOAD), bytes = dir === "files/added" ? sent : await fitPicture(sent);
      const relative = store.uniquePath(project, dir, url.searchParams.get("name") || "file");
      store.writeBytes(project, relative, bytes);
      return send(res, 200, { path:relative, name:path.basename(relative), size:bytes.length });
    }
    if (action === "canvas-slides" && method === "GET") return send(res, 200, service.canvasSlides(project, url.searchParams.get("path")));
    // What an agent drew on an open Canvas since its page read it, so the page can show it without saving.
    if (action === "canvas" && parts[3] === "pull" && method === "POST") return send(res, 200, await service.pullCanvas(project, await readJson(req, 512 * 1024)));
    // The open Canvas's picture of what is on its screen, asked for by an agent (GET /api/draw?view=1).
    if (action === "canvas" && parts[3] === "view" && method === "POST") return send(res, 200, service.takeView(project, await readJson(req, 8 * 1024 * 1024)));
    if (action === "canvas") {
      if (method === "GET") return send(res, 200, service.canvasInfo(project, url.searchParams.get("path"), { doc:url.searchParams.get("doc") }));
      if (method === "POST") return send(res, 200, await service.saveCanvas(project, await readJson(req, MAX_CANVAS)));
      return false;
    }
    // Canvases of their own: a new one, one copied in from the Library, and what can be done with any Canvas file in the folder.
    if (action === "canvases" && method === "POST") {
      if (!parts[3]) {
        const made = await service.createCanvas(project, await readJson(req, MAX_CANVAS));
        if (made.existing !== true) annotateUsage(res, "canvas-new");
        return send(res, 200, made);
      }
      const body = await readJson(req, 16384);
      if (parts[3] === "rename") return send(res, 200, await service.renameCanvas(project, body));
      if (parts[3] === "delete") return send(res, 200, await service.deleteCanvas(project, body));
      if (parts[3] === "restore") return send(res, 200, await service.restoreCanvas(project, body));
      if (parts[3] === "loose") return send(res, 200, await service.looseCanvas(project, body));
      if (parts[3] === "attach") return send(res, 200, await service.attachCanvasToLine(project, body));
      if (parts[3] === "detach") return send(res, 200, await service.detachCanvasFromLine(project, body));
      // A Canvas of its own to another project: copied there, then this one goes to Deleted (canvas-move.js).
      if (parts[3] === "move") {
        const target = body?.to === MY_CANVASES_ID ? store.myCanvases() : store.get(String(body?.to || ""));
        if (!target || target.id === project.id || target.missing) throw failure("NOT_FOUND", "There is no such project to move it to.", 404);
        const made = CanvasMove.importCanvas(service, target, CanvasMove.exportCanvas(service, project, body));
        await service.deleteCanvas(project, { path:body.path });
        return send(res, 200, { ...made, to:target.id });
      }
      return false;
    }
    // Any other file the Canvases & files page shows: a new name, to the project's Trash, and back.
    if (action === "files" && method === "POST") {
      const body = await readJson(req, 16384);
      if (parts[3] === "reveal") {
        if (!isThisComputer(req)) throw failure("LOCAL_ONLY", "Files can only be revealed on the computer running PenEcho.", 403);
        if (typeof folderOpener.reveal !== "function") throw failure("UNAVAILABLE", "Revealing files is not supported on this system.", 400);
        const rel = typeof body?.path === "string" ? body.path : "";
        return send(res, 200, await folderOpener.reveal(store.resolve(project, rel)));
      }
      if (parts[3] === "rename") return send(res, 200, await service.renameFile(project, body));
      if (parts[3] === "delete") return send(res, 200, await service.deleteFile(project, body));
      if (parts[3] === "restore") return send(res, 200, await service.restoreFile(project, body));
      return false;
    }
    if (action === "notes" && method === "POST") return send(res, 200, service.createNote(project, await readJson(req, 512 * 1024)));
    // The project's copy in PenEcho Cloud: a read-only link to share, and Sync to keep it there.
    if (action === "cloud") {
      if (method === "GET") return send(res, 200, url.searchParams.get("activity") === "1" ? requireCloud().activity(project) : await requireCloud().status(project));
      if (method === "POST") {
        const body = await readJson(req, 4096);
        return send(res, 200, await requireCloud().setSync(project, Boolean(body?.sync), { syncDays:body?.syncDays }));
      }
      return false;
    }
    if (action === "share") {
      if (method === "POST") {
        const hasBody = Number(req.headers["content-length"]) > 0 || Boolean(req.headers["transfer-encoding"]);
        const body = hasBody ? await readJson(req, 4096) : {};
        return send(res, 200, await requireCloud().share(project, { syncDays:body?.syncDays }));
      }
      if (method === "DELETE") return send(res, 200, await requireCloud().stopSharing(project));
      return false;
    }
    if (action === "zip" && method === "GET") {
      const list = url.searchParams.getAll("path");
      const all = store.walk(project).filter(f => !f.path.startsWith(".history/"));
      const wanted = list.length ? all.filter(f => list.some(p => f.path === p || f.path.startsWith(`${p}/`))) : all;
      const folder = path.basename(project.docsPath);
      const body = zip(wanted.map(f => ({ name:`${folder}/${f.path}`, data:fs.readFileSync(store.resolve(project, f.path)) })));
      const name = (url.searchParams.get("name") || folder).replace(/[^\p{L}\p{N} ._-]+/gu, "-");
      res.writeHead(200, { "Content-Type":"application/zip", "Content-Disposition":`attachment; filename*=UTF-8''${encodeURIComponent(name)}.zip`, "Cache-Control":"no-store", "X-Content-Type-Options":"nosniff" });
      return res.end(body);
    }
    if (action === "topics") {
      if (parts.length === 3 && method === "POST") {
        const made = await service.request(project, await readJson(req, 512 * 1024));
        if (made.lineCreated === true) annotateUsage(res, "line-new");
        return send(res, 200, made);
      }
      const slug = decodeURIComponent(parts[3] || ""), verb = parts[4];
      if (!slug || slug.includes("/")) throw failure("BAD_PATH", "That Topic does not exist.");
      if (verb === "diff" && method === "GET") {
        const doc = F.parseLine(store.readText(project, L.linePath(slug)).text), code = project.codePaths[0], step = String(url.searchParams.get("step") || "");
        // What one piece of work changed, from the commits its detail file names.
        if (step) {
          const detail = F.detailPath(slug, step);
          if (!code || !/^[\p{L}\p{N}-]+$/u.test(step) || !store.exists(project, detail)) return send(res, 200, { files:[] });
          const { from, to } = F.splitFront(store.readText(project, detail).text).front, commit = /^[0-9a-f]{4,64}$/;
          return send(res, 200, commit.test(from || "") && commit.test(to || "") ? await Git.diffFiles(code, from, to) : { files:[] });
        }
        if (!code || !doc.front.branch) return send(res, 200, { files:[] });
        return send(res, 200, await Git.diffFiles(code, doc.front.base || service.trunkOf(project), doc.front.branch));
      }
      // Only files this branch changed can be read this way, so it never exposes the rest of a repository.
      if (verb === "branch-file" && method === "GET") {
        const doc = F.parseLine(store.readText(project, L.linePath(slug)).text), code = project.codePaths[0], file = String(url.searchParams.get("path") || "");
        if (!code || !doc.front.branch) throw failure("NOT_FOUND", "This Topic has no branch.", 404);
        const changed = await Git.changedPaths(code, doc.front.base || service.trunkOf(project), doc.front.branch);
        if (!changed.includes(file)) throw failure("NOT_FOUND", "That file did not change on this branch.", 404);
        const text = await Git.showFile(code, doc.front.branch, file);
        if (text == null) throw failure("NOT_FOUND", "That file is not on this branch.", 404);
        return send(res, 200, { path:file, md:text });
      }
      if (verb === "activity" && method === "GET") return send(res, 200, service.activityOf(project, slug, url.searchParams.get("after")));
      // A picture an agent read while it worked, kept by name only, so nothing else on the computer can be asked for this way.
      if (verb === "activity-picture" && method === "GET") {
        const file = service.activity.pictureFile(project, slug, url.searchParams.get("name"));
        let stat; try { stat = file ? fs.statSync(file) : null; } catch { stat = null; }
        if (!stat?.isFile()) throw failure("NOT_FOUND", "That picture is not kept any more.", 404);
        res.writeHead(200, { "Content-Type":TYPES[path.extname(file)] || "application/octet-stream", "Content-Length":stat.size, "Cache-Control":"private, max-age=86400", "X-Content-Type-Options":"nosniff", "Cross-Origin-Resource-Policy":"same-origin" });
        fs.createReadStream(file).pipe(res);
        return;
      }
      if (verb === "open-folder" && method === "POST") {
        if (!isThisComputer(req)) throw failure("LOCAL_ONLY", "Folders can only be opened on the computer running PenEcho.", 403);
        const topic = store.scan(project).topics.find(t => t.slug === slug);
        if (!topic) throw failure("NOT_FOUND", "This line no longer exists.", 404);
        return send(res, 200, await folderOpener.open(service.lineFrom(project, topic).folder));
      }
      // A page a Work made in the code folder, named by the line itself: the page names the Work and the file, and only an output the line lists opens.
      if (verb === "open-output" && method === "POST") {
        if (!isThisComputer(req)) throw failure("LOCAL_ONLY", "This opens on the computer running PenEcho.", 403);
        const body = await readJson(req, 8192).catch(() => ({}));
        const topic = store.scan(project).topics.find(t => t.slug === slug);
        if (!topic) throw failure("NOT_FOUND", "This line no longer exists.", 404);
        const station = service.lineFrom(project, topic).stations.find(s => s.id === String(body?.step || ""));
        const output = station?.outputs?.find(o => o.code && o.path === String(body?.path || ""));
        if (!output) throw failure("NOT_FOUND", "That is not something this Work made.", 404);
        return send(res, 200, await folderOpener.openFile(output.path));
      }
      if (verb === "open-desktop" && method === "POST") {
        if (!isThisComputer(req)) throw failure("LOCAL_ONLY", "This opens on the computer running PenEcho. Open the app there.", 403);
        const body = await readJson(req, 4096).catch(() => ({}));
        return send(res, 200, await service.openConversation(project, slug, typeof body?.agent === "string" ? body.agent : "", typeof body?.step === "string" ? body.step : "", body?.forStop === true));
      }
      if (verb === "open-agent" && method === "POST") {
        if (!isThisComputer(req)) throw failure("LOCAL_ONLY", "This opens on the computer running PenEcho. Open the app there.", 403);
        const body = await readJson(req, 4096).catch(() => ({}));
        return send(res, 200, await service.openForPaste(project, slug, typeof body?.agent === "string" ? body.agent : ""));
      }
      if (verb === "paste" && method === "POST") return send(res, 200, await service.pasteUnsent(project, slug, await readJson(req, 4096), { local:isThisComputer(req) }));
      if (verb === "paste-files" && method === "POST") {
        if (!isThisComputer(req)) throw failure("LOCAL_ONLY", "This copies on the computer running PenEcho. Copy the files there.", 403);
        return send(res, 200, await service.pasteUnsentFiles(project, slug, await readJson(req, 4096)));
      }
      // To another project, whole. A Canvas that is on no line yet moves the same way, by its folder's name.
      if (verb === "move" && method === "POST") return send(res, 200, await service.moveLine(project, slug, await readJson(req, 4096)));
      // Old clients must not mutate a saved split plan or launch its parts.
      if (verb === "parts") throw failure("SPLIT_RETIRED", "Split jobs have been removed. Existing work is still available as separate lines.", 410);
      // Nor merge lines into one (PE-459): an old page's line merge or its Undo must not reach the branch Merge below.
      if (verb === "merge" && method === "POST") {
        const body = await readJson(req, 512 * 1024);
        if (parts[5] === "undo" || Array.isArray(body?.from)) throw failure("LINE_MERGE_RETIRED", "Merging lines has been removed. Lines on one Topic stay separate lines.", 410);
        return send(res, 200, await service.act(project, slug, verb, body));
      }
      if (verb === "act" && method === "POST") {
        if (parts[5] === "steer" || parts[5] === "answer") return send(res, 200, await service.act(project, slug, parts[5], await readJson(req, 512 * 1024)));
        return false;
      }
      if (verb && method === "POST") return send(res, 200, await service.act(project, slug, verb, await readJson(req, 512 * 1024)));
    }
    return false;
  }
  // Resolve only links written in this Work. Look up code when its detail is read or a link is followed, never on a project poll.
  function workCodeLinks(project, detail, onlyHref) {
    const found = new Map(), work = /^works\/([^/]+)\/[^/]+\.md$/.exec(detail || "");
    if (!work || !project.codePaths.length || !store.exists(project, detail)) return found;
    const links = service.detailOf(project, detail).result.links;
    const roots = [service.worktreeFor(project, work[1]), ...project.codePaths];
    const inside = (root, file) => {
      const rel = path.relative(root, file);
      return rel && rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel);
    };
    for (const { image, href } of links) {
      if (image || (onlyHref !== undefined && href !== onlyHref) || found.has(href)) continue;
      let file = linkedFilePath(href);
      if (!file) continue;
      if (file.startsWith("~/")) file = path.join(os.homedir(), file.slice(2));
      // Markdown paths are relative to the Work. Agents also cite source relative to the code folder.
      const candidates = path.isAbsolute(file) ? [file] : [path.resolve(path.dirname(store.full(project, detail)), file), ...roots.map(root => path.resolve(root, file))];
      for (const candidate of candidates) {
        const root = roots.find(root => inside(root, candidate));
        if (!root) continue;
        try {
          const real = fs.realpathSync(candidate);
          if (inside(fs.realpathSync(root), real) && fs.statSync(real).isFile()) { found.set(href, real); break; }
        } catch { /* Moved, missing, or outside the Work's code folder. */ }
      }
    }
    return found;
  }
  function sendFile(req, res, project, url) {
    return serveFile(res, store.resolve(project, url.searchParams.get("path")), { download:url.searchParams.get("download") === "1" });
  }
  function serveFile(res, file, { code = false, download = false }) {
    const stat = fs.statSync(file);
    if (!stat.isFile()) throw failure("NOT_FOUND", "That is not a file.", 404);
    const ext = path.extname(file).toLowerCase(), source = code && workSourceFile(file);
    res.writeHead(200, {
      "Content-Type":source ? "text/plain; charset=utf-8" : TYPES[ext] || "application/octet-stream", "Content-Length":stat.size, "Cache-Control":"no-cache",
      "Content-Disposition":`${download || (!source && !INLINE.has(ext)) ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(path.basename(file))}`,
      // A result link previews the file. Active content cannot execute in a code preview.
      "Content-Security-Policy":code ? "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'" : "sandbox allow-scripts; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'", "X-Content-Type-Options":"nosniff", "Referrer-Policy":"no-referrer", "Cross-Origin-Resource-Policy":"same-origin",
    });
    fs.createReadStream(file).on("error", () => res.destroy()).pipe(res);
  }
  // Only from the project's files folder, still sandboxed, and never calling anywhere (no fetch, not even to PenEcho): what it may load is its own folder's files.
  function sendPage(res, project, relative) {
    const rel = path.posix.normalize(String(relative || ""));
    if (!rel.startsWith("files/") || rel.split("/").includes("..")) throw failure("BAD_PATH", "Pages open from the files folder.");
    const file = store.resolve(project, rel), stat = fs.statSync(file);
    if (!stat.isFile()) throw failure("NOT_FOUND", "That is not a file.", 404);
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      "Content-Type":PAGE_TYPES[ext] || TYPES[ext] || "application/octet-stream", "Content-Length":stat.size, "Cache-Control":"no-cache",
      "Content-Security-Policy":"sandbox allow-scripts; default-src 'none'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'none'; form-action 'none'", "X-Content-Type-Options":"nosniff", "Referrer-Policy":"no-referrer",
      // Read by its own sandboxed page, whose origin is opaque: a same-origin rule would refuse it its own stylesheet.
      "Cross-Origin-Resource-Policy":"cross-origin",
    });
    fs.createReadStream(file).pipe(res);
  }
  async function handle(req, res, url) {
    if (!url.pathname.startsWith("/api/lines/")) return false;
    const parts = url.pathname.slice("/api/lines/".length).split("/").filter(Boolean).map(decodeURIComponent);
    // The orchestrator's agent calls PenEcho's functions with the pass its run was given, as an agent draws with /api/draw (PE-613).
    if (parts[0] === "orchestrate" && parts[1] === "identity" && parts.length === 2) {
      if (req.method !== "GET") { send(res, 405, { error:"GET /api/lines/orchestrate/identity?nonce=..." }); return true; }
      const ip = String(req.socket?.remoteAddress || "").replace(/^::ffff:/, "");
      if (ip !== "127.0.0.1" && ip !== "::1") { send(res, 403, { error:"This address answers only this computer." }); return true; }
      try {
        // An agent at work needs the folders.
        await openFolders();
        assertOwner();
        const nonce = String(url.searchParams.get("nonce") || "");
        const localPort = Number(req.socket?.localPort) || Number(url.port) || 0;
        send(res, 200, orchestrator.identity(nonce, localPort));
      } catch (error) {
        if (!res.headersSent) send(res, error.status || 500, { error:error.status ? error.message : `Something went wrong: ${error.message}`, code:error.code, ...(error.owner ? { owner:error.owner } : {}), ...(error.conflict ? { conflict:error.conflict } : {}) });
      }
      return true;
    }
    if (parts[0] === "orchestrate" && parts.length === 1) {
      if (req.method !== "POST") { send(res, 405, { error:"POST a JSON body such as {\"do\":\"help\"}." }); return true; }
      try {
        if (req.headers["x-penecho-pass"]) await openFolders();
        assertOwner();
        const body = await readJson(req, 512 * 1024), stop = new AbortController();
        assertOwner();
        res.on("close", () => { if (!res.writableEnded) stop.abort(); });
        const opId = String(req.headers["x-penecho-op-id"] || body?.opId || "").trim();
        send(res, 200, await orchestrator.agentCall(req.headers["x-penecho-pass"], body, stop.signal, { opId }));
      } catch (error) { if (!res.headersSent) send(res, error.status || 500, { error:error.status ? error.message : `Something went wrong: ${error.message}`, code:error.code, ...(error.owner ? { owner:error.owner } : {}), ...(error.conflict ? { conflict:error.conflict } : {}) }); }
      // What an Orchestrator call changes is in memory and its own folder, and what it writes to a project goes through the store, which
      // names the files (or service.changed(project)). Throwing away every project's folder list after each call walked all of them again.
      finally { if (!service.closed) service.changedState(); }
      return true;
    }
    const denied = req.method === "GET" || req.method === "HEAD" ? authorizeRead(req) : authorizeWrite(req);
    if (denied) { send(res, 403, { error:denied }); return true; }
    // While another PenEcho runs these Lines, this one says so and where, rather than showing its projects as missing.
    if (service.closed || service.closing) { send(res, 503, { error:"PenEcho is shutting down.", code:"CLOSING" }); return true; }
    // The Canvas page opening by itself only asks which projects there are (project-lines-cover.js): that does not open the folders.
    if (service.foldersHeld && req.method === "GET" && parts.length === 1 && parts[0] === "projects" && url.searchParams.get("first") === "1") { send(res, 200, projectList({ held:true })); return true; }
    await openFolders();
    if (service.closed || service.closing) { send(res, 503, { error:"PenEcho is shutting down.", code:"CLOSING" }); return true; }
    if (service.runtimeBusy && !service.releaseRuntime) { const busy = runtimeBusy(service.runtimeBusy); send(res, 409, { error:busy.message, code:busy.code, owner:busy.owner }); return true; }
    const changes = req.method !== "GET" && req.method !== "HEAD";
    // Any change through a route still makes the next look fresh (S1), before the folder's watcher could say so: the folder of the project
    // the route names is listed again, and for a route that names none, every folder. A route that writes to another project names it itself
    // (canvas-move.js, moveLineOwned). Each page action used to list every project's folder again.
    // Opening a project only notes when: nothing a page shows of it is made from that.
    if (openedOnly(req, url, parts)) {
      try { store.update((routeProject(parts) || store.get(parts[1])).id, { opened:true }); send(res, 200, { ok:true }); }
      catch (error) { send(res, error.status || 500, { error:error.status ? error.message : "Something went wrong opening this project.", code:error.code }); }
      return true;
    }
    if (changes) service.changed(routeProject(parts));
    try {
      const handled = await route(req, res, url, parts);
      if (handled === false) send(res, 404, { error:"Not found." });
    } catch (error) {
      // What the page only hears as "Something went wrong" is kept in the server's log, so it can be found out afterwards.
      if (!error.status) console.error(`[lines] ${req.method} /${parts.join("/")} failed:`, error);
      // An answer passed through as it came (Cloud's 402 for a run that could not start).
      if (!res.headersSent && error.body && error.status) send(res, error.status, error.body);
      else if (!res.headersSent) send(res, error.status || 500, { error:error.status ? error.message : "Something went wrong reading this project.", code:error.code, ...(error.owner ? { owner:error.owner } : {}), ...(error.conflict ? { conflict:error.conflict } : {}), ...(error.current !== undefined ? { current:error.current, currentHash:error.currentHash } : {}), ...(error.moved ? { moved:error.moved } : {}) });
      else res.destroy();
    } finally { if (changes) service.changed(routeProject(parts)); }
    return true;
  }
  const openedOnly = (req, url, parts) => req.method === "PATCH" && parts.length === 2 && parts[0] === "projects" && url.searchParams.get("opened") === "1";
  // The project a route under /projects/<id>/ is about, or null.
  function routeProject(parts) {
    if (parts[0] !== "projects" || !parts[1] || parts[1] === "import") return null;
    return (parts[1] === MY_CANVASES_ID ? store.myCanvases({ create:false }) : store.projects.find(p => p.id === parts[1])) || null;
  }
  return { handle, service, orchestrator, cloudShare, computer, openFolders, close:() => { clearInterval(takeOver); orchestrator?.close?.(); computer?.close(); cloudShare?.close(); service.close(); } };
}

module.exports = { createProjectLines, zip };
