"use strict";
const { failure } = require("./store.js");

// The old Library, as My Canvases sees it: the Canvases this server keeps (`server:<id>`) and, signed in, the account's
// Cloud Canvases (`cloud:<id>`). Canvases kept in a browser ("This device") are not reachable from here; the page sends
// those itself with their content. Nothing here changes the Library: a Canvas is copied in, and its original stays.
//   local: { list() → [{ id, name, projectId, updatedAt }], projects() → [{ id, name, system }], read(id) → version 2 bundle }
//   cloud: () → the Cloud connector, or null
const MAX_CLOUD = 1000;
const ID = /^(server|cloud):([A-Za-z0-9._:-]{1,200})$/;

function createLibrary({ local = null, cloud = () => null } = {}) {
  const connector = () => { try { return cloud() || null; } catch { return null; } };
  const signedIn = () => { try { return Boolean(connector()?.status?.().accountSession?.signedIn); } catch { return false; } };
  function localProjects() {
    try { return new Map((local?.projects() || []).map(p => [p.id, p])); } catch { return new Map(); }
  }
  // Uncategorized is no project: its Canvases come in with no label.
  const label = project => (project && !project.system && project.name ? { id:project.id, name:project.name } : null);
  function localCanvases() {
    if (!local) return [];
    const projects = localProjects();
    let items = [];
    try { items = local.list() || []; } catch { return []; }
    return items.map(item => ({ from:`server:${item.id}`, title:String(item.name || "").trim() || "Canvas", kept:"server", updatedAt:Number(item.updatedAt) || 0, project:label(projects.get(item.projectId)) }));
  }
  async function cloudCanvases() {
    const c = connector();
    if (!c || !signedIn()) return [];
    const out = [];
    for (let offset = 0; out.length < MAX_CLOUD;) {
      const page = await c.library(new URLSearchParams({ limit:"100", offset:String(offset), previews:"0" }));
      const canvases = Array.isArray(page?.canvases) ? page.canvases : [], projects = new Map((Array.isArray(page?.projects) ? page.projects : []).map(p => [p.id, p]));
      for (const item of canvases) {
        if (!item?.id) continue;
        const project = projects.get(item.projectId);
        out.push({ from:`cloud:${item.id}`, title:String(item.name || "").trim() || "Canvas", kept:"cloud", updatedAt:Date.parse(item.updatedAt) || Number(item.updatedAt) || 0, project:project && !project.system && !project.isDefault && project.name ? { id:project.id, name:project.name } : null });
      }
      const next = page?.page?.nextOffset;
      if (!canvases.length || next === null || next === undefined || next <= offset) break;
      offset = next;
    }
    return out;
  }
  // { canvases, cloud:{ signedIn, error? } }. A Cloud that does not answer leaves the computer's own list.
  async function list() {
    const cloudState = { signedIn:signedIn() };
    let fromCloud = [];
    try { fromCloud = await cloudCanvases(); } catch (error) { cloudState.error = String(error?.message || "PenEcho Cloud did not answer.").slice(0, 300); }
    return { canvases:[...localCanvases(), ...fromCloud].sort((a, b) => b.updatedAt - a.updatedAt), cloud:cloudState };
  }
  // The Canvas behind one `from`, as a version 2 bundle, with the title and label it carries in the Library.
  async function fetch(from) {
    const m = ID.exec(String(from || ""));
    if (!m) throw failure("BAD_FROM", "That is not a Library Canvas.", 400);
    if (m[1] === "server") {
      if (!local) throw failure("NOT_FOUND", "That Canvas is not in this computer's Library.", 404);
      const item = (local.list() || []).find(c => c.id === m[2]);
      if (!item) throw failure("NOT_FOUND", "That Canvas is not in this computer's Library.", 404);
      let bundle;
      try { bundle = local.read(m[2]); } catch (error) { throw failure(error.status === 400 || error.status === 404 ? "NOT_FOUND" : "LIBRARY_FAILED", error.status === 400 || error.status === 404 ? "That Canvas is not in this computer's Library." : "That Canvas could not be read.", error.status === 400 || error.status === 404 ? 404 : 500); }
      return { bundle, title:String(item.name || "").trim(), group:label(localProjects().get(item.projectId))?.name || "" };
    }
    const c = connector();
    if (!c || !signedIn()) throw failure("SIGN_IN", "Sign in to PenEcho Cloud to bring in this Canvas.", 401);
    const entry = (await cloudCanvases()).find(item => item.from === from);
    if (!entry) throw failure("NOT_FOUND", "That Canvas is not in your PenEcho Cloud Library.", 404);
    let loaded;
    try { loaded = await c.loadCloudCanvas(m[2]); } catch (error) { throw failure("CLOUD_FAILED", String(error?.message || "PenEcho Cloud did not answer.").slice(0, 300), 502); }
    if (!loaded?.bundle) throw failure("NOT_FOUND", "That Canvas has nothing saved in PenEcho Cloud yet.", 404);
    return { bundle:loaded.bundle, title:entry.title, group:entry.project?.name || "" };
  }
  return { list, fetch, signedIn };
}

module.exports = { createLibrary };
