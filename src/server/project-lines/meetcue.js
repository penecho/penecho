"use strict";
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const F = require("./format.js");
const { failure, clip } = require("./store.js");
const { checkPicture, canvasBase } = require("./canvas-file.js");
const { isExampleId, getExample } = require("./meetcue-examples.js");

// Meetings and projects together, through the account this computer is signed in to (Cloud's /api/v1/meetcue…, which asks
// MeetCue). Signed out, every read says so and nothing fails. Meetings stay in MeetCue: a project gets their minutes and actions.
const MEETINGS_GET = /^\/api\/v1\/meetcue(?:\/meetings(?:\/[A-Za-z0-9-]{1,80})?)?$/;
const MEETINGS_DELETE = /^\/api\/v1\/meetcue(?:\/link|\/meetings\/[A-Za-z0-9-]{1,80})$/;
const signedOutView = { available:false, signedIn:false };
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const minutesLong = ms => { const m = Math.round(Number(ms) / 60000); return Number.isFinite(m) && m > 0 ? (m >= 60 ? `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ""}`.trim() : `${m} min`) : ""; };
const when = iso => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 16).replace("T", " "); };

// MeetCue's map, one diagram per topic (`diagrams` in its answer): a topic's headline, its boxes with their notes, the labelled
// links between them, what is known so far and what is still open. Each becomes a diagram file PenEcho draws as it draws an
// agent's: an editable Canvas and a picture, shown on the meeting's node. A MeetCue that sends none gives none.
function diagramOf(d) {
  const nodes = (Array.isArray(d?.nodes) ? d.nodes : []).filter(n => n && String(n.label || "").trim()).slice(0, 60);
  if (!nodes.length) return null;
  const ids = new Map(nodes.map((n, i) => [String(n.id), `n${i + 1}`]));
  const words = (list, max) => (Array.isArray(list) ? list : []).map(x => clip(x, max).trim()).filter(Boolean);
  const known = words(d.sofar, 160).join(" · "), open = words(d.ahead, 160).slice(0, 8);
  return {
    type:"architecture", title:clip(d.topic, 160).trim() || "Topic",
    ...(known ? { description:clip(known, 600) } : {}),
    nodes:nodes.map(n => ({ id:ids.get(String(n.id)), label:clip(n.label, 100).trim(), ...(String(n.note || "").trim() ? { subtitle:clip(n.note, 160).trim() } : {}) })),
    edges:(Array.isArray(d.edges) ? d.edges : []).filter(e => ids.has(String(e?.from)) && ids.has(String(e?.to)) && e.from !== e.to).slice(0, 120)
      .map(e => ({ from:ids.get(String(e.from)), to:ids.get(String(e.to)), ...(String(e.label || "").trim() ? { label:clip(e.label, 120).trim() } : {}) })),
    ...(open.length ? { notes:open.map(q => `? ${q}`) } : {}),
  };
}

// Build a unified whole-meeting diagram from native `map`, legacy `whole_diagram`, or per-topic `diagrams`.
function wholeDiagramOf(whole, diagrams, title, map = null) {
  if (map && typeof map === "object" && Array.isArray(map.nodes) && map.nodes.some(n => n && String(n.label || "").trim())) {
    const topics = Array.isArray(map.topics) ? map.topics : [];
    const topicLabels = new Map(topics.map(t => [String(t?.id || ""), String(t?.label || "").trim()]));
    const sofar = [], ahead = [];
    for (const t of topics) {
      for (const s of (Array.isArray(t?.sofar) ? t.sofar : [])) if (s && !sofar.includes(s)) sofar.push(s);
      for (const a of (Array.isArray(t?.ahead) ? t.ahead : [])) if (a && !ahead.includes(a)) ahead.push(a);
    }
    const nodes = map.nodes.filter(n => n && String(n.label || "").trim()).map(n => ({
      ...n,
      id:String(n.id ?? n.label),
      topic:topicLabels.get(String(n.topic || "")) || String(n.topic || ""),
    }));
    const nodeIds = new Set(nodes.map(n => n.id));
    const edges = (Array.isArray(map.edges) ? map.edges : [])
      .filter(e => e && nodeIds.has(String(e.from)) && nodeIds.has(String(e.to)) && String(e.from) !== String(e.to))
      .map(e => ({ from:String(e.from), to:String(e.to), label:String(e.label || "").trim() }));
    if (nodes.length) {
      return { topic:clip(title || map.title || "Full meeting map", 160).trim() || "Full meeting map", sofar:sofar.slice(0, 6), ahead:ahead.slice(0, 6), nodes, edges };
    }
  }
  if (whole && Array.isArray(whole.nodes) && whole.nodes.some(n => n && String(n.label || "").trim())) {
    return { ...whole, topic:clip(whole.topic || title || "Full meeting map", 160).trim() || "Full meeting map" };
  }
  const list = (Array.isArray(diagrams) ? diagrams : []).filter(d => Array.isArray(d?.nodes) && d.nodes.some(n => n && String(n.label || "").trim()));
  if (list.length < 2) return null;
  const nodesById = new Map(), edges = [], edgeKeys = new Set(), sofar = [], ahead = [];
  for (const d of list) {
    for (const s of (Array.isArray(d.sofar) ? d.sofar : [])) if (s && !sofar.includes(s)) sofar.push(s);
    for (const a of (Array.isArray(d.ahead) ? d.ahead : [])) if (a && !ahead.includes(a)) ahead.push(a);
    for (const n of d.nodes) {
      if (!n || !String(n.label || "").trim()) continue;
      const key = String(n.id ?? n.label);
      if (!nodesById.has(key)) nodesById.set(key, { ...n, id:key, ...(d.topic && !n.topic ? { topic:d.topic } : {}) });
    }
    for (const e of (Array.isArray(d.edges) ? d.edges : [])) {
      if (!e || e.from == null || e.to == null) continue;
      const from = String(e.from), to = String(e.to), label = String(e.label || "").trim();
      const k = `${from}|${to}|${label}`;
      if (from !== to && !edgeKeys.has(k)) { edgeKeys.add(k); edges.push({ from, to, label }); }
    }
  }
  if (!nodesById.size) return null;
  return { topic:"Full meeting map", sofar:sofar.slice(0, 6), ahead:ahead.slice(0, 6), nodes:[...nodesById.values()], edges };
}

function topicDiagramsFromMap(map) {
  if (!map || typeof map !== "object" || !Array.isArray(map.topics) || !map.topics.length) return [];
  const rawNodes = (Array.isArray(map.nodes) ? map.nodes : []).filter(n => n && String(n.label || "").trim());
  const byId = new Map(rawNodes.map(n => [String(n.id), n]));
  const rawEdges = (Array.isArray(map.edges) ? map.edges : []).filter(e => e && byId.has(String(e.from)) && byId.has(String(e.to)) && String(e.from) !== String(e.to));
  const out = [];
  for (const t of map.topics) {
    if (!t || !t.id) continue;
    const mine = new Set(rawNodes.filter(n => String(n.topic || "") === String(t.id)).map(n => String(n.id)));
    if (!mine.size) continue;
    for (const e of rawEdges) {
      const a = String(e.from), b = String(e.to);
      if (mine.has(a) && !String(byId.get(b)?.topic || "").trim()) mine.add(b);
      else if (mine.has(b) && !String(byId.get(a)?.topic || "").trim()) mine.add(a);
    }
    out.push({
      topic:t.label || "Topic",
      status:t.status || "",
      sofar:Array.isArray(t.sofar) ? t.sofar : [],
      ahead:Array.isArray(t.ahead) ? t.ahead : [],
      nodes:rawNodes.filter(n => mine.has(String(n.id))),
      edges:rawEdges.filter(e => mine.has(String(e.from)) && mine.has(String(e.to))),
    });
  }
  return out;
}

function createMeetCue({ service, cloud }) {
  const { store } = service;
  const connector = () => { try { return cloud() || null; } catch { return null; } };
  const signedIn = () => { try { return Boolean(connector()?.status().accountSession?.signedIn); } catch { return false; } };
  async function ask(pathname, { method = "GET", body } = {}) {
    const response = await connector().accountFetch(pathname, { method, ...(body !== undefined ? { body:JSON.stringify(body), headers:{ "content-type":"application/json" } } : {}), timeoutMs:60_000 });
    const text = await response.text();
    let json = null; try { json = text ? JSON.parse(text) : {}; } catch { json = { error:"cloud_request_failed", message:text.slice(0, 300) }; }
    return { status:response.status, body:json };
  }
  function meetingLinks() {
    const out = {};
    const add = (id, entry) => { if (id) (out[id] ||= []).push(entry); };
    for (const project of store.projects) {
      let topics = [];
      // The folder's list its watcher keeps (as the list of projects uses), not a walk of every project's folder for each request.
      try { topics = store.scan(project, service.folderList?.(project, 4000) || null).topics; } catch { continue; }
      for (const t of topics) {
        const ownId = String(t.doc.front.meeting || "").trim();
        const byMeeting = new Map();
        if (ownId) byMeeting.set(ownId, { ownLine:true, step:"" });
        for (const s of t.doc.steps) {
          if (s.kind !== "meeting") continue;
          const mid = String(s.meetingId || ownId || "").trim();
          if (!mid) continue;
          if (!byMeeting.has(mid)) byMeeting.set(mid, { ownLine:false, step:s.id });
          else if (!byMeeting.get(mid).step) byMeeting.get(mid).step = s.id;
        }
        for (const [id, info] of byMeeting) {
          add(id, {
            projectId:project.id,
            projectName:project.name,
            color:project.color || "",
            slug:t.slug,
            title:t.title || t.slug,
            status:t.doc.status,
            ownLine:info.ownLine,
            step:info.step,
            updatedAt:t.mtime || 0,
          });
        }
      }
    }
    for (const list of Object.values(out)) list.sort((a, b) => (b.ownLine - a.ownLine) || (b.updatedAt - a.updatedAt));
    return out;
  }

  // GET /api/lines/meetcue, …/meetings, GET|DELETE …/meetings/:id, DELETE …/link, plus local …/links across all projects.
  // Built-in example meetings (example-*) work locally even when signed out or not connected to MeetCue.
  async function passThrough(method, rest, search) {
    if (method === "GET" && rest === "links") return { status:200, body:{ signedIn:signedIn(), links:meetingLinks() } };
    const exampleMatch = rest.match(/^meetings\/([A-Za-z0-9-]{1,80})$/);
    if (exampleMatch && isExampleId(exampleMatch[1])) {
      if (method === "DELETE") throw failure("EXAMPLE_READONLY", "Example meetings cannot be deleted.", 403);
      if (method === "GET") return { status:200, body:{ ...getExample(exampleMatch[1]), links:meetingLinks()[exampleMatch[1]] || [] } };
      throw failure("NOT_FOUND", "Not found.", 404);
    }
    if (!signedIn()) {
      if (method === "GET") return { status:200, body:signedOutView };
      throw failure("SIGN_IN", "Sign in to PenEcho Cloud to use MeetCue.", 401);
    }
    const pathname = `/api/v1/meetcue${rest ? `/${rest}` : ""}`;
    const allowed = (method === "GET" && MEETINGS_GET.test(pathname)) || (method === "DELETE" && MEETINGS_DELETE.test(pathname));
    if (!allowed) throw failure("NOT_FOUND", "Not found.", 404);
    const answer = await ask(`${pathname}${search || ""}`, { method });
    const one = method === "GET" && answer.status === 200 ? rest.match(/^meetings\/([A-Za-z0-9-]{1,80})$/) : null;
    const links = method === "GET" && answer.status === 200 ? (!rest ? { links:meetingLinks() } : one ? { links:meetingLinks()[one[1]] || [] } : {}) : {};
    return { status:answer.status, body:{ ...answer.body, ...(rest ? {} : { signedIn:true }), ...links } };
  }
  // The meeting's diagrams (whole meeting map + one per topic), written beside its minutes in a folder of their own
  // (so no Canvas of the line takes them in). Answers each picture that is to be, for the meeting's node; PenEcho draws them straight after.
  function writeDiagrams(project, slug, title, diagrams, whole = null, map = null) {
    const topicList = Array.isArray(diagrams) && diagrams.length ? diagrams : topicDiagramsFromMap(map);
    const rawWhole = wholeDiagramOf(whole, topicList, "Full meeting map", map);
    const rawList = [...(rawWhole ? [rawWhole] : []), ...topicList];
    const made = rawList.slice(0, 25).map(diagramOf).filter(Boolean).filter(d => {
      try { checkPicture("x.diagram.json", JSON.stringify(d)); return true; } catch { return false; }
    });
    if (!made.length) return [];
    const stem = `files/${slug}/${F.slugify(title, "meeting")}-diagrams`;
    let dir = stem;
    for (let n = 2; fs.existsSync(store.resolve(project, dir, { forWrite:true })); n++) dir = `${stem}-${n}`;
    return made.map((d, i) => {
      const idx = rawWhole ? i : i + 1;
      const base = `${dir}/${String(idx).padStart(2, "0")}-${F.slugify(d.title, "topic")}`;
      store.writeText(project, `${base}.diagram.json`, `${JSON.stringify(d, null, 2)}\n`);
      return { title:d.title, source:`${base}.diagram.json`, picture:`../${base}.png` };
    });
  }
  function drawSoon(project, made) {
    if (!made.length) return;
    (async () => {
      for (const { source } of made) await service.withCanvas(project, `${canvasBase(source)}.penecho.json`, () => service.pictureFrom(project, source, [], { now:true })).catch(() => {});
      service.sync(project);
    })().catch(() => {});
  }
  const requireSigned = () => { if (!signedIn()) throw failure("SIGN_IN", "Sign in to PenEcho Cloud to use MeetCue.", 401); };
  const cloudFailure = answer => Object.assign(failure(answer.body?.error || "cloud_request_failed", answer.body?.message || `PenEcho Cloud answered HTTP ${answer.status}.`, answer.status), { body:answer.body });

  async function fetchMeetingData(id) {
    if (isExampleId(id)) return getExample(id);
    requireSigned();
    const answer = await ask(`/api/v1/meetcue/meetings/${encodeURIComponent(id)}`);
    if (answer.status !== 200) throw cloudFailure(answer);
    return answer.body || {};
  }

  // A meeting becomes one line (or a meeting node on an existing line when `topic` is named).
  // Adding the same meeting again to that project's dedicated line, or as a node to the same line, gives what is already there.
  async function addMeeting(project, { meetingId, topic } = {}) {
    const id = String(meetingId || "");
    if (!/^[A-Za-z0-9-]{1,80}$/.test(id)) throw failure("BAD_MEETING", "Say which meeting.", 400);
    const slugArg = String(topic || "").trim();
    if (slugArg) {
      if (!service.isLine(project, slugArg)) throw failure("NOT_FOUND", "That Line does not exist.", 404);
      const already = () => F.parseLine(service.readDoc(project, slugArg)).steps.find(s => s.kind === "meeting" && s.meetingId === id);
      const dup = already();
      if (dup) return { slug:slugArg, step:dup.id, existed:true };
      const data = await fetchMeetingData(id);
      // Read the line again after waiting on Cloud: an Ask, a status or a second click may have changed it meanwhile.
      if (!service.isLine(project, slugArg)) throw failure("NOT_FOUND", "That Line does not exist.", 404);
      const raced = already();
      if (raced) return { slug:slugArg, step:raced.id, existed:true };
      const existingMd = service.readDoc(project, slugArg);
      const { meeting = {}, markdown = "", diagrams = [], whole_diagram = null, map = null } = data;
      const title = clip(meeting.title, 120).trim() || "Meeting";
      const minutes = store.uniquePath(project, `files/${slugArg}`, "minutes.md");
      store.writeText(project, minutes, String(markdown || `# ${title}\n`));
      const drawn = writeDiagrams(project, slugArg, title, diagrams, whole_diagram, map);
      const step = F.meetingStep({ title, when:when(meeting.started_at), length:minutesLong(meeting.duration_ms), gist:meeting.gist, minutes:`../${minutes}`, meetingId:id, pictures:drawn });
      const nextMd = F.addYours(existingMd, step);
      service.writeDoc(project, slugArg, nextMd);
      const added = F.parseLine(nextMd).steps.filter(s => s.kind === "meeting").at(-1)?.id || "";
      service.markSeen?.(project, slugArg);
      service.sync(project);
      drawSoon(project, drawn);
      return { slug:slugArg, step:added, existed:false };
    }
    const lineOf = () => store.scan(project).topics.find(t => t.doc.front.meeting === id);
    const had = lineOf();
    if (had) return { slug:had.slug, existed:true };
    const data = await fetchMeetingData(id);
    const raced = lineOf();
    if (raced) return { slug:raced.slug, existed:true };
    const { meeting = {}, markdown = "", actions = [], diagrams = [], whole_diagram = null, map = null } = data;
    const title = clip(meeting.title, 120).trim() || "Meeting";
    const slug = await service.newYoursLine(project, { title });
    const minutes = `files/${slug}/minutes.md`;
    store.writeText(project, minutes, String(markdown || `# ${title}\n`));
    const drawn = writeDiagrams(project, slug, title, diagrams, whole_diagram, map);
    const asks = (Array.isArray(actions) ? actions : []).slice(0, 100).map(a => {
      const who = [a?.owner ? String(a.owner).trim() : "", a?.due ? `by ${String(a.due).trim()}` : ""].filter(Boolean).join(", ");
      return F.askStep({ words:`${String(a?.task || "").trim() || "Follow up"}${who ? ` (${who})` : ""}`, via:F.NOT_SENT });
    });
    let md = service.readDoc(project, slug);
    md = F.updateSteps(md, steps => { steps.push(F.meetingStep({ title, when:when(meeting.started_at), length:minutesLong(meeting.duration_ms), gist:meeting.gist, minutes:`../${minutes}`, meetingId:id, pictures:drawn }), ...asks); });
    md = F.setFront(md, { meeting:id, ...(asks.length ? { status:"waiting", why:F.NOT_SENT } : {}) });
    service.writeDoc(project, slug, md);
    service.markSeen?.(project, slug);
    service.sync(project);
    drawSoon(project, drawn);
    return { slug, existed:false };
  }

  // "Use in MeetCue": the project's MEMORY.md (or the files named, such as one line) goes to the MeetCue project of the same name.
  // Never every line by itself: the owner, 2026-11-12, a project with many lines would cost the person too many tokens in MeetCue.
  // Only what changed since the last time is sent; a send that stops half way sends only what is missing when run again.
  async function sendToMeetCue(project, { files } = {}) {
    requireSigned();
    let wanted = Array.isArray(files) && files.length ? files.map(String) : ["MEMORY.md"];
    wanted = [...new Set(wanted)].filter(rel => /\.md$/i.test(rel) && !rel.split("/").includes(".."));
    const made = await ask("/api/v1/meetcue/projects", { method:"POST", body:{ name:clip(project.name, 80) } });
    if (made.status !== 200 && made.status !== 201) throw cloudFailure(made);
    const there = made.body.project;
    const kept = project.meetcue?.projectId === there.id ? project.meetcue : { projectId:there.id, sent:{} };
    project.meetcue = kept; store.save();
    const sent = [], skipped = [];
    for (const rel of wanted) {
      let bytes;
      try { bytes = fs.readFileSync(store.resolve(project, rel)); } catch { skipped.push(rel); continue; }
      const hash = sha(bytes);
      if (kept.sent[rel] === hash) { skipped.push(rel); continue; }
      const name = rel === "MEMORY.md" ? "MEMORY.md" : path.posix.basename(rel);
      const slot = await ask(`/api/v1/meetcue/projects/${encodeURIComponent(there.id)}/files`, { method:"POST", body:{ name, size:bytes.length } });
      if (slot.status !== 200 && slot.status !== 201) throw cloudFailure(slot);
      const upload = slot.body.upload || {};
      const put = await fetch(upload.url, { method:upload.method || "PUT", headers:upload.headers || {}, body:bytes, redirect:"error", signal:AbortSignal.timeout(120_000) });
      if (!put.ok) throw failure("UPLOAD_FAILED", `${rel} did not reach MeetCue (HTTP ${put.status}). Run it again to send what is missing.`, 502);
      const done = await ask(`/api/v1/meetcue/files/${encodeURIComponent(slot.body.file.id)}/complete`, { method:"POST", body:{} });
      if (done.status !== 200) throw cloudFailure(done);
      kept.sent[rel] = hash; store.save();
      sent.push(rel);
    }
    return { project:{ id:there.id, name:there.name }, sent, skipped };
  }
  return { passThrough, addMeeting, sendToMeetCue, signedIn };
}

module.exports = { createMeetCue, diagramOf, wholeDiagramOf };
