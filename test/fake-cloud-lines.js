"use strict";
// A stand-in for PenEcho Cloud's Lines routes, in the shapes the Cloud side answers (penecho_cloud src/routes/line-projects.mjs, B3):
// device-sync line projects with a revision, blobs by SHA-256, one commit naming the revision (409 stale), one hold per line with a beat
// (ARCHITECTURE.md A and B), the credits summary, MeetCue, and /api/v1/line-projects/* echoed back.
const crypto = require("node:crypto");
const http = require("node:http");
const CA = require("../src/server/project-lines/computer-asks.js");
const sha =bytes => crypto.createHash("sha256").update(bytes).digest("hex");

async function fakeCloud({ limit = 3 } = {}) {
  const cloud = { projects:new Map(), blobs:new Map(), runs:new Map(), computers:new Map(), down:false, requests:[], limit, plan:"free", available:1500,
    // MeetCue, as Cloud's /api/v1/meetcue routes answer for a linked account (penecho_cloud_meetcue docs/meetcue-link.md).
    meetings:new Map([["m-1", { meeting:{ id:"m-1", title:"Supplier call", status:"ended", started_at:"2026-11-10T08:00:00.000Z", ended_at:"2026-11-10T08:30:00.000Z", duration_ms:1800000, minutes_ready:true, action_count:2, gist:"Prices agreed for next year." },
      markdown:"# Supplier call\n\n## Decisions\n\n- Prices agreed.\n", actions:[{ task:"Send the quote", owner:"Dana", due:"Friday" }, { task:"Book the next call" }] }]]),
    mcProjects:new Map(), mcFiles:new Map(), uploads:new Map(), failUpload:0 };
  const json = (res, status, body) => { res.writeHead(status, { "content-type":"application/json" }); res.end(JSON.stringify(body)); };
  const fail = (res, status, error, message, details) => json(res, status, { error, message, ...(details ? { details } : {}) });
  const view = p => ({ key:p.key, name:p.name, files:p.files.length, sizeBytes:p.files.reduce((n, f) => n + f.size, 0), maxBytes:200 * 1048576, updatedAt:new Date(p.updatedAt).toISOString(), rev:p.rev, plus:false, share:p.share || null, lines:p.files.filter(f => /^topics\/[^/]+\.md$/.test(f.path)).length, ...(p.system ? { system:p.system } : {}), ...(p.cloudMade ? { cloudMade:true } : {}), ...(p.archived ? { archived:true } : {}) });
  const running = p => [...cloud.runs.values()].filter(r => r.key === p.key && Date.now() - r.touched < 120000).map(r => ({ id:r.id, line:r.line, where:r.where, since:r.since }));
  const sameFiles = (a, b) => JSON.stringify(a.map(f => [f.path, f.sha256]).sort()) === JSON.stringify(b.map(f => [f.path, f.sha256]).sort());
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", c => chunks.push(c)).on("end", () => {
      const url = new URL(req.url, "http://x"), body = Buffer.concat(chunks), parts = url.pathname.split("/").filter(Boolean);
      cloud.requests.push({ method:req.method, path:url.pathname + url.search, product:req.headers["x-penecho-product"] });
      if (cloud.down) { res.writeHead(503); return res.end(); }
      // MeetCue's presigned upload: straight to its store, not through Cloud.
      if (parts[0] === "upload" && req.method === "PUT") { if (cloud.failUpload > 0 && --cloud.failUpload === 0) { res.writeHead(500); return res.end(); } cloud.uploads.set(parts[1], body); res.writeHead(200); return res.end(); }
      if (req.headers.authorization !== "Bearer account-token") return fail(res, 401, "unauthorized", "Sign in.");
      if (url.pathname === "/api/v1/credits/summary") {
        if (cloud.noSummary) return fail(res, 404, "not_found", "No such route.");
        const bytes = [...cloud.projects.values()].reduce((n, p) => n + p.files.reduce((m, f) => m + f.size, 0), 0);
        return json(res, 200, { available:cloud.available, plan:cloud.plan, renewsAt:null, lots:[], used:{ lines:0, canvas:0, meetcue:0 }, kept:{ projects:[...cloud.projects.values()].length, limit:cloud.limit, bytes, maxBytes:200 * 1048576 } });
      }
      if (parts[0] === "api" && parts[2] === "meetcue") {
        if (parts.length === 3) return json(res, 200, cloud.mcUnlinked ? { available:true, linked:false } : { available:true, linked:true, link:{ meetcueUser:{ id:"u1", name:"Ann", email:"ann@example.com" }, linkedAt:"2026-11-10T08:00:00.000Z" }, meetcue:{ plan:null, balance:{ credits:12 }, storage:null } });
        if (parts[3] === "link" && !parts[4] && req.method === "DELETE") {
          if (cloud.mcUnlinked) return fail(res, 404, "not_linked", "This account is not linked to MeetCue.");
          cloud.mcUnlinked = true;
          return json(res, 200, { linked:false, meetcueNotified:true });
        }
        if (cloud.mcUnlinked) return fail(res, 404, "not_linked", "This account is not linked to MeetCue.");
        if (parts[3] === "meetings" && !parts[4]) return json(res, 200, { meetings:[...cloud.meetings.values()].map(m => m.meeting) });
        if (parts[3] === "meetings") { const m = cloud.meetings.get(parts[4]); if (!m) return fail(res, 404, "not_found", "No such meeting."); if (req.method === "DELETE") { cloud.meetings.delete(parts[4]); return json(res, 200, { ok:true }); } return json(res, 200, m); }
        if (parts[3] === "projects" && !parts[4] && req.method === "POST") {
          const name = JSON.parse(body.toString("utf8")).name, had = [...cloud.mcProjects.values()].find(p => p.name.toLowerCase() === name.toLowerCase());
          const project = had || { id:crypto.randomUUID(), name, updated_at:new Date().toISOString() };
          cloud.mcProjects.set(project.id, project);
          return json(res, 200, { project, created:!had });
        }
        if (parts[3] === "projects" && parts[5] === "files" && req.method === "POST") {
          if (!cloud.mcProjects.has(parts[4])) return fail(res, 404, "not_found", "No such project.");
          const input = JSON.parse(body.toString("utf8")), file = { id:crypto.randomUUID(), name:input.name, size:input.size, project:parts[4], done:false };
          cloud.mcFiles.set(file.id, file);
          return json(res, 200, { file:{ id:file.id, name:file.name }, upload:{ url:`${cloud.origin}/upload/${file.id}`, method:"PUT", headers:{ "Content-Type":"text/markdown" } } });
        }
        if (parts[3] === "files" && parts[5] === "complete") {
          const file = cloud.mcFiles.get(parts[4]), bytes = cloud.uploads.get(parts[4]);
          if (!file) return fail(res, 404, "not_found", "No such file.");
          if (!bytes) return fail(res, 409, "not_uploaded", "Upload first.");
          if (bytes.length !== file.size) return fail(res, 400, "size_mismatch", "Size differs.");
          file.done = true; file.text = bytes.toString("utf8");
          return json(res, 200, { file:{ id:file.id, name:file.name } });
        }
        return fail(res, 404, "not_found", "No such route.");
      }
      if (parts[0] === "api" && parts[2] === "line-projects") return json(res, 200, { echo:{ method:req.method, path:url.pathname, search:url.search, body:body.toString("utf8"), type:req.headers["content-type"] || "" } });
      // A computer's round (R4, penecho_cloud src/routes/computers.mjs): who it is, each project's revision, and the holds that are gone.
      if (url.pathname === "/api/v1/device-sync/computer" && req.method === "POST") {
        if (cloud.noComputerRoute) return fail(res, 404, "not_found", "No such route.");
        const input = JSON.parse(body.toString("utf8"));
        cloud.computers.set(input.id, { ...input, seenAt:Date.now() });
        const projects = Object.entries(input.projects || {}).map(([key, rev]) => { const p = cloud.projects.get(key); return p ? { key, rev:p.rev, changed:p.rev !== Number(rev) } : { key, rev:null, changed:true }; });
        return json(res, 200, { computer:{ id:input.id, name:input.name, runsAsks:input.runsAsks }, projects, dropped:(input.holding || []).filter(h => !cloud.runs.has(h.hold)).map(h => h.hold) });
      }
      if (parts.slice(0, 4).join("/") !== "api/v1/device-sync/line-projects") return fail(res, 404, "not_found", "No such route.");
      const key = parts[4] ? decodeURIComponent(parts[4]) : "";
      let p = cloud.projects.get(key);
      if (!key && req.method === "GET") return json(res, 200, { projects:[...cloud.projects.values()].map(view), kept:{ projects:cloud.projects.size, limit:cloud.limit } });
      if (parts.length === 5) {
        if (req.method === "GET") {
          // penecho.ai before the sync routes (PR #78): the project as the dashboard shows it, no revision, no list of files, `since` not read.
          if (cloud.old) return json(res, 200, { project:p ? { ...view(p), rev:undefined } : null });
          if (!p) return json(res, 200, { project:null });
          const since = url.searchParams.get("since");
          if (since !== null && p.rev <= Number(since)) return json(res, 200, { rev:p.rev, changed:false });
          return json(res, 200, { project:view(p), rev:p.rev, changed:true, files:p.files.map(f => ({ ...f })), running:running(p) });
        }
        if (req.method === "PUT") {
          const input = JSON.parse(body.toString("utf8"));
          if (!p && cloud.limit !== null && cloud.projects.size >= cloud.limit) return fail(res, 409, "project_limit", "A free account keeps 3 projects in Cloud.", { kept:cloud.projects.size, limit:cloud.limit });
          if (p && input.baseRev !== undefined && input.baseRev !== p.rev) return fail(res, 409, "line_project_changed", "This project changed in Cloud since you last read it.", { rev:p.rev });
          // As Cloud does: the project is made first, then the files it lacks are asked for.
          const project = p || { key, name:input.name, files:[], rev:0, updatedAt:Date.now() };
          cloud.projects.set(key, project);
          const missing = input.files.map(f => f.sha256).filter(h => !cloud.blobs.has(h));
          if (missing.length) return fail(res, 409, "line_project_missing_files", "Upload these first.", { missing:[...new Set(missing)] });
          const changed = JSON.stringify(project.files.map(f => [f.path, f.sha256]).sort()) !== JSON.stringify(input.files.map(f => [f.path, f.sha256]).sort());
          if (input.summary) project.summary = input.summary;
          Object.assign(project, { name:input.name, files:input.files.map(f => ({ path:f.path, sha256:f.sha256, size:f.size, ...(f.modified ? { modified:f.modified } : {}) })), updatedAt:Date.now() });
          if (changed || !project.rev) project.rev++;
          cloud.projects.set(key, project);
          return json(res, 200, { project:view(project) });
        }
        if (req.method === "DELETE") { cloud.projects.delete(key); return json(res, 200, { ok:true }); }
      }
      if (!p && parts[5] === "commit" && req.method === "POST" && !cloud.old) {
        const input = JSON.parse(body.toString("utf8"));
        if (input.rev !== 0) return fail(res, 404, "not_found", "This project is not in Cloud.");
        if (cloud.limit !== null && cloud.projects.size >= cloud.limit) return fail(res, 409, "project_limit", "A free account keeps 3 projects in Cloud.", { kept:cloud.projects.size, limit:cloud.limit });
        p = { key, name:input.name, files:[], rev:0, updatedAt:Date.now() };
        cloud.projects.set(key, p);
      }
      if (!p) return fail(res, 404, "not_found", "This project is not in Cloud.");
      if (parts[5] === "blobs" && parts[7] === "parts" && req.method === "PUT") {
        // A big file in parts (PE-1067, penecho_cloud putLineBlobPart); cloud.noParts is a Cloud from before them. partFail(n) answers the n-th part's status.
        if (cloud.noParts) return fail(res, 404, "not_found", "No such route.");
        cloud.partCalls = (cloud.partCalls || 0) + 1;
        const cut = cloud.partFail?.(cloud.partCalls);
        if (cut) { res.writeHead(cut); return res.end(); }
        const hash = parts[6], index = Number(parts[8]), count = Number(url.searchParams.get("count"));
        (cloud.partsSent ||= []).push({ hash, index, count, bytes:body.length });
        if (cloud.blobs.has(hash)) return json(res, 200, { added:false, stored:true });
        const held = (cloud.parts ||= new Map()).get(hash) || [];
        held[index] = Buffer.from(body); cloud.parts.set(hash, held);
        if (index < count - 1) return json(res, 200, { part:index });
        const whole = Buffer.concat(held.slice(0, count));
        cloud.parts.delete(hash);
        if (sha(whole) !== hash) return fail(res, 400, "checksum_mismatch", "Bad bytes.");
        cloud.blobs.set(hash, whole);
        return json(res, 200, { added:true, stored:true });
      }
      if (parts[5] === "blobs") {
        if (req.method === "GET") { const bytes = cloud.blobs.get(parts[6]); if (!bytes) return fail(res, 404, "not_found", "No such file."); res.writeHead(200, { "content-type":"application/octet-stream" }); return res.end(bytes); }
        if (req.method === "PUT") { if (sha(body) !== parts[6]) return fail(res, 400, "checksum_mismatch", "Bad bytes."); cloud.blobs.set(parts[6], body); return json(res, 200, { added:true }); }
        if (req.method === "POST") {
          // A batch cut off on the way (PE-574): blobFail(n) for the n-th batch answers its status, or nothing for a stored batch.
          cloud.batches = (cloud.batches || 0) + 1;
          const cut = cloud.blobFail?.(cloud.batches);
          if (cut) { res.writeHead(cut); return res.end(); }
          const length = body.readUInt32BE(0), header = JSON.parse(body.subarray(4, 4 + length).toString("utf8"));
          let at = 4 + length;
          for (const file of header) { const bytes = body.subarray(at, at + file.size); at += file.size; if (sha(bytes) !== file.sha256) return fail(res, 400, "checksum_mismatch", "Bad bytes."); cloud.blobs.set(file.sha256, Buffer.from(bytes)); }
          return json(res, 200, { added:header.length });
        }
      }
      if (cloud.old && ["commit", "holds"].includes(parts[5])) return fail(res, 404, "not_found", "No such route.");
      if (parts[5] === "commit" && req.method === "POST") {
        const input = JSON.parse(body.toString("utf8"));
        if (Number(input.rev) !== p.rev || cloud.staleOnce) { cloud.staleOnce = false; return fail(res, 409, "stale", "Cloud moved on since that revision.", { rev:p.rev }); }
        const missing = input.put.map(f => f.sha256).filter(h => !cloud.blobs.has(h));
        if (missing.length) return fail(res, 409, "line_project_missing_files", "Upload these first.", { missing });
        const next = new Map(p.files.map(f => [f.path, f]));
        for (const f of input.put) next.set(f.path, { path:f.path, sha256:f.sha256, size:f.size, ...(f.modified ? { modified:f.modified } : {}) });
        for (const path of input.remove || []) next.delete(path);
        const files = [...next.values()];
        if (!sameFiles(files, p.files)) { p.files = files; p.rev++; p.updatedAt = Date.now(); }
        if (input.summary) p.summary = input.summary;
        cloud.commits = (cloud.commits || 0) + 1;
        return json(res, 200, { rev:p.rev });
      }
      // One Ask at a time on a line: a hold, a beat every 30 s, given back at the end. Silent for two minutes, it is lost.
      if (parts[5] === "holds") {
        if (req.method === "POST" && !parts[6]) {
          const input = JSON.parse(body.toString("utf8")), busy = running(p).find(r => r.line === input.line);
          if (busy) return fail(res, 409, "line_busy", `This line is working on ${busy.where}.`, { where:busy.where, since:busy.since });
          const hold = { id:crypto.randomUUID(), key, line:input.line, where:input.where, since:new Date().toISOString(), touched:Date.now() };
          cloud.runs.set(hold.id, hold);
          return json(res, 201, { hold:{ id:hold.id } });
        }
        const hold = cloud.runs.get(parts[6]);
        if (req.method === "POST" && parts[7] === "beat") { if (!hold || Date.now() - hold.touched >= 120000) { cloud.runs.delete(parts[6]); return fail(res, 410, "hold_lost", "This hold was lost."); } hold.touched = Date.now(); res.writeHead(204); return res.end(); }
        if (req.method === "DELETE") { cloud.runs.delete(parts[6]); return json(res, 200, { hold:null }); }
      }
      if (parts[5] === "share") {
        if (req.method === "POST") {
          if (!p.share) { const token = crypto.randomUUID(); p.share = { token, url:`/l/${token}`, expiresAt:Date.now() + 7 * 86400000, ended:false }; }
          return json(res, 200, { project:view(p) });
        }
        if (req.method === "DELETE") { p.share = null; return json(res, 200, { project:view(p) }); }
      }
      return fail(res, 404, "not_found", "No such route.");
    });
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  cloud.origin = `http://127.0.0.1:${server.address().port}`;
  cloud.close = () => new Promise(done => { server.closeAllConnections?.(); server.close(() => done()); });
  // Another computer (or penecho.ai) changing a file: the blob, the manifest, a new revision.
  cloud.edit = (key, rel, text) => { const p = cloud.projects.get(key), bytes = Buffer.from(text), h = sha(bytes); cloud.blobs.set(h, bytes); p.files = [...p.files.filter(f => f.path !== rel), { path:rel, sha256:h, size:bytes.length }]; p.rev++; };
  cloud.text = (key, rel) => { const f = cloud.projects.get(key)?.files.find(x => x.path === rel); return f ? cloud.blobs.get(f.sha256).toString("utf8") : null; };
  // penecho.ai holding an Ask Not sent for a computer (Run on a synced project), and its Stop: the hold off the Ask, the line's hold gone.
  cloud.holdAsk = (key, slug, options = {}) => { const done = CA.holdUnsentText(cloud.text(key, `topics/${slug}.md`), options); cloud.edit(key, `topics/${slug}.md`, done.md); return done; };
  cloud.stop = (key, slug) => {
    const done = CA.unholdText(cloud.text(key, `topics/${slug}.md`));
    if (done.count) cloud.edit(key, `topics/${slug}.md`, done.md);
    for (const [id, hold] of cloud.runs) if (hold.key === key && hold.line === slug) cloud.runs.delete(id);
    return done.count;
  };
  return cloud;
}
// What the local app's CloudConnector offers Lines, talking to the fake: status, cloudRequest (JSON, errors with status/code/details) and accountFetch (raw).
function fakeConnector(cloud, { signedIn = true } = {}) {
  const connector = { signedIn };
  // The account as the connector last heard it (at sign-in); library() asks Cloud again, as the real connector's does.
  connector.workspace = { storageUsedBytes:0, storageLimitBytes:200 * 1048576 };
  connector.status = () => ({ origin:cloud.origin, accountSession:{ signedIn:connector.signedIn }, account:connector.signedIn ? { name:"Test User", workspace:connector.workspace } : null });
  connector.library = async () => { connector.libraryCalls = (connector.libraryCalls || 0) + 1; connector.workspace = { storageUsedBytes:cloud.storageUsed ?? 0, storageLimitBytes:200 * 1048576 }; return { canvases:[], projects:[], workspace:connector.workspace }; };
  connector.accountFetch = async (pathname, { method = "GET", body, headers = {}, timeoutMs = 30000 } = {}) => {
    if (!connector.signedIn) throw Object.assign(new Error("Sign in."), { status:401 });
    return fetch(`${cloud.origin}${pathname}`, { method, headers:{ ...Object.fromEntries(Object.entries(headers).filter(([, v]) => v)), authorization:"Bearer account-token" }, body, signal:AbortSignal.timeout(timeoutMs) });
  };
  connector.cloudRequest = async (pathname, { method = "GET", body, bytes, timeoutMs = 30000 } = {}) => {
    let response;
    try { response = await fetch(`${cloud.origin}${pathname}`, { method, headers:{ authorization:"Bearer account-token", ...(bytes ? { "content-type":"application/octet-stream" } : body !== undefined ? { "content-type":"application/json" } : {}) }, body:bytes || (body !== undefined ? JSON.stringify(body) : undefined), signal:AbortSignal.timeout(timeoutMs) }); }
    catch (error) { throw Object.assign(new Error("PenEcho Cloud is not reachable."), { status:503, code:"cloud_unreachable" }); }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(payload.message || `HTTP ${response.status}`), { status:response.status, code:[502, 503, 504].includes(response.status) ? "cloud_temporarily_unavailable" : payload.error, ...(payload.details ? { details:payload.details } : {}) });
    return payload;
  };
  connector.signOut = async () => { connector.signedIn = false; };
  return connector;
}
module.exports = { fakeCloud, fakeConnector, sha };
