"use strict";
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

// A folder is a project. Agents working in one folder share one folder page in
// this app; its tabs are the project's Canvases, which save themselves a few
// seconds after each change. Signed out, the project is a project of this
// computer's Library named after the folder; signed in, it is the account's
// Cloud project for the folder, the one PenEcho Cloud's agents use too. A page
// keeps the project it opened with until it is opened again.

const WORKSPACE_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const LOCAL_CANVAS_ID = /^\d{10,16}-[a-zA-Z0-9-]{8,64}$/;
const MAX_PROJECTS = 500, MAX_TABS = 64, CLOUD_TIMEOUT_MS = 8000;

// Paths and remote URLs normalize to one stable key, as on PenEcho Cloud.
function folderKey(value) {
  if (typeof value !== "string") return null;
  let folder = value.trim();
  if (!folder || folder.length > 512 || /[\u0000-\u001f\u007f]/.test(folder)) return null;
  if (/^(?:[a-z][a-z0-9+.-]*:\/\/|git@)/i.test(folder))
    folder = folder.replace(/^git@([^:/]+):/i, "$1/").replace(/^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?/i, "").replace(/\.git\/?$/i, "").replace(/\/+$/, "").toLowerCase();
  else folder = folder.replace(/\\/g, "/").replace(/\/+$/, "") || "/";
  return folder;
}
const folderName = folder => folder.split("/").filter(Boolean).at(-1)?.slice(0, 48) || "Project";
const failure = (status, code, message) => Object.assign(new Error(message), { status, code });

const OPEN_WORKSPACE_TOOL = {
  name:"penecho_open_workspace",
  description:"Open the page of the folder you work in. Each folder is one project: its Canvases are the page's tabs and save themselves a few seconds after each change, in this computer's Library while PenEcho is signed out and in the account's Cloud library while signed in. Agents in one folder share its page. Returns a url to open once when no page of the folder is connected, and the exact start arguments once one is.",
  inputSchema:{ type:"object", additionalProperties:false, required:["folder"], properties:{
    folder:{ type:"string", minLength:1, maxLength:512, description:"The absolute path of the folder you work in." },
    sessionKey:{ type:"string", minLength:1, maxLength:128 },
  } },
};

function createFolderProjects({ directory, library, cloud, origin, listCanvases, now = Date.now }) {
  const file = path.join(directory, "folder-projects.json"), selections = new Map();
  function readAll() {
    try {
      const stored = JSON.parse(fs.readFileSync(file, "utf8"));
      return Array.isArray(stored?.projects) ? stored.projects.filter(item => WORKSPACE_ID.test(item?.id) && typeof item.folder === "string") : [];
    } catch { return []; }
  }
  function writeAll(projects) {
    fs.mkdirSync(directory, { recursive:true, mode:0o700 });
    const kept = projects.sort((a, b) => (b.usedAt || 0) - (a.usedAt || 0)).slice(0, MAX_PROJECTS);
    const temporary = `${file}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({ version:1, projects:kept }), { mode:0o600 });
    fs.renameSync(temporary, file);
  }
  function update(id, change) {
    const projects = readAll(), index = projects.findIndex(item => item.id === id);
    if (index === -1) throw failure(404, "project_not_found", "This folder page is no longer known to this PenEcho app. Open it again from your agent.");
    projects[index] = change(projects[index]);
    writeAll(projects);
    return projects[index];
  }
  function record(id) {
    const found = WORKSPACE_ID.test(id || "") && readAll().find(item => item.id === id);
    if (!found) throw failure(404, "project_not_found", "This folder page is no longer known to this PenEcho app. Open it again from your agent.");
    return found;
  }
  function ensure(folder) {
    const projects = readAll(), found = projects.find(item => item.folder === folder);
    if (found) { found.usedAt = now(); writeAll(projects); return found; }
    const created = { id:crypto.randomUUID(), folder, name:folderName(folder), localProjectId:null, tabs:[], tabsRevision:0, store:null, createdAt:now(), usedAt:now() };
    writeAll([...projects, created]);
    return created;
  }
  // The Library project for a signed-out folder; made again if it was deleted there.
  function localProject(project) {
    if (project.localProjectId && library.project(project.localProjectId)) return project.localProjectId;
    const created = library.createProject({ name:project.name });
    update(project.id, item => ({ ...item, localProjectId:created.id }));
    return created.id;
  }
  const pageUrl = id => `${origin()}/?${new URLSearchParams({ workspace:id, mcp:"1", mode:"companion" })}`;
  const connected = id => listCanvases().filter(canvas => canvas.canvasId === id && canvas.documentId);

  function selected(id, documents) {
    const selection = selections.get(id);
    return documents.find(doc => doc.documentId === selection?.documentId) || documents.find(doc => doc.active) || documents[0] || null;
  }
  async function open(args = {}) {
    const folder = folderKey(args.folder);
    if (!folder || Object.keys(args).some(key => !["folder", "sessionKey"].includes(key))) throw failure(400, "invalid_request", "folder must be the absolute path of the folder you work in (1–512 characters).");
    if (args.sessionKey !== undefined && (typeof args.sessionKey !== "string" || !args.sessionKey.trim() || args.sessionKey.length > 128)) throw failure(400, "invalid_request", "Use a stable conversation sessionKey (1–128 characters).");
    const project = ensure(folder), documents = connected(project.id), target = selected(project.id, documents);
    const base = { workspaceId:project.id, folder:project.name, sharedWithAgents:true, canvasUrl:pageUrl(project.id) };
    if (target) return { ...base, alreadyConnected:true, url:null, startSession:{ canvasId:project.id, documentId:target.documentId },
      canvases:documents.map(doc => ({ documentId:doc.documentId, title:doc.title, active:!!doc.active })),
      message:"This folder's page is open and connected. Start a session with startSession plus this conversation's own sessionKey and client; existing sessions stay on their Canvases. For a new Canvas of the folder instead, start the session with canvasId alone." };
    return { ...base, alreadyConnected:false, url:pageUrl(project.id),
      message:"Open url once, in the host's embedded side browser if one is available, otherwise in the default browser. Once the page shows, call penecho_open_workspace again with the same folder for the start arguments." };
  }

  // Signed in, the folder's Cloud project is the one on this computer: Cloud's
  // agents here keep its link in .penecho/project.json, and so does this app.
  function folderLink(folder) {
    const origin = cloud.origin?.();
    if (!origin || !path.isAbsolute(folder)) return null;
    try {
      const entry = JSON.parse(fs.readFileSync(path.join(folder, ".penecho", "project.json"), "utf8"))?.projects?.[origin];
      return typeof entry?.project === "string" && entry.project.length >= 20 && entry.project.length <= 100 ? entry.project : null;
    } catch { return null; }
  }
  function keepFolderLink(folder, link) {
    const origin = cloud.origin?.();
    if (!origin || !link?.token || !path.isAbsolute(folder) || folderLink(folder)) return;
    try {
      if (!fs.statSync(folder).isDirectory()) return;
      const metadata = path.join(folder, ".penecho"), file = path.join(metadata, "project.json");
      fs.mkdirSync(metadata, { recursive:true });
      let stored = {};
      try { stored = JSON.parse(fs.readFileSync(file, "utf8")) || {}; } catch {}
      fs.writeFileSync(file, `${JSON.stringify({ ...stored, projects:{ ...stored.projects, [origin]:{ project:link.token, name:link.name } } }, null, 2)}\n`);
      if (!fs.existsSync(path.join(metadata, ".gitignore"))) fs.writeFileSync(path.join(metadata, ".gitignore"), "*\n");
    } catch {}
  }
  // A link this account cannot use (another sign-in's) leaves the app on its own project.
  async function withFolderLink(folder, request) {
    const link = folderLink(folder);
    try { return await request(link ? { project:link } : {}); }
    catch (error) {
      if (!link || !["project_other_identity", "project_not_found"].includes(error?.code)) throw error;
      return request({});
    }
  }
  async function cloudProject(folder, signal) {
    const view = await withFolderLink(folder, link => cloud.project(folder, { signal, ...link }));
    keepFolderLink(folder, view?.project);
    return view;
  }
  const cloudTabs = (folder, change) => withFolderLink(folder, link => cloud.tabs(folder, { ...change, ...link }));

  // What the folder page loads with: its project, fixed until the page opens again.
  const libraryCanvases = project => project.localProjectId && library.project(project.localProjectId) ? library.list().filter(canvas => canvas.projectId === project.localProjectId) : [];
  async function pageConfig(id) {
    const project = record(id);
    let store = null, folderProject = { name:project.name };
    // Signed in, a folder whose Canvases are still in this computer's Library
    // opens there, and the page then keeps them in Cloud.
    if (cloud.signedIn() && !libraryCanvases(project).length) {
      try {
        const view = await cloudProject(project.folder, AbortSignal.timeout(CLOUD_TIMEOUT_MS));
        if (WORKSPACE_ID.test(view?.cloudProjectId || "")) { store = { kind:"cloud", accountId:cloud.accountId(), cloudProjectId:view.cloudProjectId }; folderProject = { name:view.name || project.name, cloudProjectId:view.cloudProjectId }; }
      } catch {}
    } else {
      // A full Library still opens the page, which then keeps its Canvases as drafts.
      try {
        const localProjectId = localProject(project);
        store = { kind:"local", projectId:localProjectId };
        folderProject = { name:project.name, localProjectId, ...(cloud.signedIn() ? { keep:true } : {}) };
      } catch {}
    }
    update(id, item => ({ ...item, store, usedAt:now() }));
    return { browserDraftId:id, browserDraftConnected:true, browserCanvasEditing:true, folderProject };
  }
  function localStore(id) {
    const project = record(id);
    if (project.store?.kind !== "local" || !library.project(project.store.projectId)) throw failure(409, "project_unavailable", "This folder's Canvases are not in this computer's Library. Reopen the page.");
    return { project, projectId:project.store.projectId };
  }
  function cloudStore(id) {
    const project = record(id);
    if (project.store?.kind !== "cloud") return null;
    const accountId = cloud.accountId();
    if (!cloud.signedIn() || accountId && project.store.accountId && accountId !== project.store.accountId) throw failure(403, "project_unavailable", "Sign in with the account that owns this folder project, then reopen the page.");
    return project;
  }
  function localView(project, projectId) {
    const canvases = library.list().filter(canvas => canvas.projectId === projectId), byId = new Map(canvases.map(canvas => [canvas.id, canvas]));
    const open = (project.tabs || []).filter(canvasId => byId.has(canvasId));
    // A changed revision tells the folder's other pages to take the newer save.
    const view = canvas => ({ canvasId:canvas.id, title:canvas.name || "Untitled Canvas", updatedAt:canvas.updatedAt, revisionId:library.revision(canvas) });
    return { name:project.name, revision:project.tabsRevision || 0, tabs:open.map(canvasId => view(byId.get(canvasId))), closed:canvases.filter(canvas => !open.includes(canvas.id)).slice(0, 50).map(view) };
  }
  // Where Canvases kept in Cloud went, so a page that still holds them follows.
  const movedView = project => Object.entries(project.moved || {}).map(([from, entry]) => ({ from, to:entry.to, revisionId:entry.revisionId }));
  async function projectView(id) {
    const remote = cloudStore(id);
    if (remote) return { ...await cloudProject(remote.folder), moved:movedView(remote) };
    const { project, projectId } = localStore(id);
    return localView(project, projectId);
  }
  async function updateTabs(id, { open:opened, close } = {}) {
    const remote = cloudStore(id);
    if (remote) return cloudTabs(remote.folder, { ...(opened ? { open:opened } : {}), ...(close ? { close } : {}) });
    const { projectId } = localStore(id), valid = value => value === undefined || LOCAL_CANVAS_ID.test(value);
    if (!valid(opened) || !valid(close) || !opened && !close) throw failure(400, "invalid_request", "Send the canvasId to open or close.");
    if (opened && library.canvas(opened)?.projectId !== projectId) throw failure(409, "document_unavailable", "Only Canvases saved in this folder's project can be its tabs.");
    const project = update(id, item => {
      const tabs = (item.tabs || []).filter(canvasId => canvasId !== opened && canvasId !== close);
      if (opened) tabs.push(opened);
      return { ...item, tabs:tabs.slice(-MAX_TABS), tabsRevision:(item.tabsRevision || 0) + 1 };
    });
    return localView(project, projectId);
  }
  // The folder's Canvases on this computer, in the shapes of the Cloud Canvas
  // routes. Each save replaces the one it starts from.
  function localCanvas(projectId, canvasId) {
    const canvas = LOCAL_CANVAS_ID.test(canvasId || "") && library.canvas(canvasId);
    if (!canvas || canvas.projectId !== projectId) throw failure(404, "not_found", "This Canvas is no longer in this folder's project.");
    return canvas;
  }
  const canvasView = (canvas, projectId) => ({ id:canvas.id, name:canvas.name, projectId, currentRevisionId:library.revision(canvas), updatedAt:canvas.updatedAt });
  function readCanvas(id, canvasId) {
    const { projectId } = localStore(id), canvas = localCanvas(projectId, canvasId);
    return { canvas:canvasView(canvas, projectId), revision:{ id:library.revision(canvas) }, bundle:library.read(canvasId) };
  }
  function createCanvas(id, { name, bundle } = {}) {
    if (!bundle || typeof bundle !== "object" || name !== undefined && typeof name !== "string") throw failure(400, "invalid_request", "Send a name and a Canvas bundle.");
    const { projectId } = localStore(id), canvasId = `${now()}-${crypto.randomUUID()}`;
    const saved = library.save({ ...bundle, id:canvasId, name:String(name ?? bundle.name ?? "").trim().slice(0, 48) || "Untitled Canvas", projectId });
    return { canvas:canvasView(saved, projectId), revision:{ id:library.revision(saved) } };
  }
  function saveCanvas(id, canvasId, { baseRevisionId, bundle } = {}) {
    if (typeof baseRevisionId !== "string" || !baseRevisionId || baseRevisionId.length > 128 || !bundle || typeof bundle !== "object") throw failure(400, "invalid_request", "Send the revision this save starts from and a Canvas bundle.");
    const { projectId } = localStore(id), canvas = localCanvas(projectId, canvasId);
    const saved = library.save({ ...bundle, id:canvasId, name:typeof bundle.name === "string" && bundle.name.trim() ? bundle.name : canvas.name, projectId }, canvasId, { baseRevisionId });
    return { revision:{ id:library.revision(saved), canvasId, completedAt:saved.updatedAt } };
  }
  // Signing in keeps a folder's Canvases: those in this computer's Library move,
  // as they are, into the account's Cloud project for the folder, and the page
  // reopens saving there. Each leaves the Library only once Cloud has it, and a
  // save made here meanwhile follows it.
  const keeping = new Map();
  function keep(id) {
    if (!keeping.has(id)) keeping.set(id, keepNow(id).finally(() => keeping.delete(id)));
    return keeping.get(id);
  }
  function remember(id, from, entry) {
    update(id, item => ({ ...item, moved:{ ...item.moved, [from]:entry } }));
    return entry;
  }
  async function keepNow(id) {
    const project = record(id);
    if (!cloud.signedIn()) throw failure(401, "sign_in_required", "Sign in to keep this folder's Canvases in your Cloud library.");
    const view = await cloudProject(project.folder), cloudProjectId = view?.cloudProjectId;
    if (!WORKSPACE_ID.test(cloudProjectId || "")) throw failure(502, "cloud_project_unavailable", "PenEcho Cloud did not return this folder's project. Try again.");
    const tabs = project.tabs || [], order = canvas => tabs.includes(canvas.id) ? tabs.indexOf(canvas.id) : tabs.length;
    const canvases = libraryCanvases(project).sort((a, b) => order(a) - order(b) || b.updatedAt - a.updatedAt);
    // Room for everything first, so a full Cloud library never keeps half a folder.
    const needed = canvases.filter(canvas => !project.moved?.[canvas.id]).reduce((sum, canvas) => sum + library.size(canvas.id), 0), room = await cloud.room();
    if (needed > room) throw failure(413, "storage_quota_exceeded", `Free ${Math.ceil((needed - room) / 1048576)} MB in your Cloud storage to keep this folder's Canvases.`);
    for (const { id:canvasId, name } of canvases) {
      let entry = record(id).moved?.[canvasId];
      if (!entry) {
        const current = library.canvas(canvasId);
        if (!current) continue;
        const fromRevision = library.revision(current), created = await cloud.createCanvas({ projectId:cloudProjectId, name:name || "Untitled Canvas", bundle:library.bundle(canvasId) });
        entry = remember(id, canvasId, { to:created.canvas.id, revisionId:created.revision.id, fromRevision, at:now() });
      }
      for (let attempt = 0; ; attempt++) {
        const current = library.canvas(canvasId);
        if (!current) break;
        const revision = library.revision(current);
        if (revision === entry.fromRevision) { library.remove(canvasId); break; }
        if (attempt === 3) throw failure(409, "canvas_busy", "This folder's Canvases kept changing. Try again.");
        const saved = await cloud.saveCanvas({ canvasId:entry.to, baseRevisionId:entry.revisionId, bundle:library.bundle(canvasId) });
        entry = remember(id, canvasId, { ...entry, revisionId:saved.revision.id, fromRevision:revision });
      }
    }
    // Its open tabs stay open, in their order.
    const moved = record(id).moved || {};
    for (const canvasId of tabs) if (moved[canvasId]) await cloudTabs(project.folder, { open:moved[canvasId].to }).catch(() => {});
    const remaining = libraryCanvases(project).length;
    if (project.localProjectId && !remaining && library.project(project.localProjectId)) library.removeProject(project.localProjectId);
    update(id, item => ({ ...item, store:{ kind:"cloud", accountId:cloud.accountId(), cloudProjectId }, localProjectId:remaining ? item.localProjectId : null, tabs:[],
      moved:Object.fromEntries(Object.entries(item.moved || {}).sort((a, b) => (b[1].at || 0) - (a[1].at || 0)).slice(0, 200)) }));
    return { kept:canvases.length, cloudProjectId };
  }
  // The companion's choice of Canvas for the next agent that starts here.
  function documents(id) {
    record(id);
    const documents = connected(id), target = selected(id, documents), selection = selections.get(id);
    return { workspaceId:id, selectedDocumentId:target?.documentId || null, selectionRevision:selection?.revision || 0, state:target ? "ready" : "waiting_for_browser",
      canvases:documents.map(doc => ({ documentId:doc.documentId, title:doc.title || "Untitled canvas", active:!!doc.active, selected:doc.documentId === target?.documentId })),
      ...(target ? { startSession:{ canvasId:id, documentId:target.documentId } } : {}) };
  }
  function select(id, { documentId, expectedRevision, requestId } = {}) {
    record(id);
    if (typeof documentId !== "string" || !documentId || documentId.length > 256 || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || typeof requestId !== "string" || !requestId || requestId.length > 128) throw failure(400, "invalid_request", "Use an exact documentId, expectedRevision and unique requestId.");
    if (!connected(id).some(doc => doc.documentId === documentId)) throw failure(409, "document_unavailable", "This Canvas is not connected to this page. Open it here before selecting it.");
    const current = selections.get(id) || { revision:0 };
    if (current.requestId === requestId) return documents(id);
    if (current.revision !== expectedRevision) throw failure(409, "selection_conflict", "The MCP target changed. Refresh the Canvas list and select again.");
    selections.set(id, { documentId, revision:current.revision + 1, requestId });
    return documents(id);
  }

  return { tools:[OPEN_WORKSPACE_TOOL], open, pageConfig, projectView, updateTabs, readCanvas, createCanvas, saveCanvas, keep, documents, select,
    known:id => WORKSPACE_ID.test(id || "") && readAll().some(item => item.id === id),
    call:(ownerId, name, args) => { if (name !== OPEN_WORKSPACE_TOOL.name) throw failure(404, "tool_not_found", "Unknown PenEcho MCP tool."); return open(args); } };
}

module.exports = { OPEN_WORKSPACE_TOOL, createFolderProjects, folderKey };
