// What the page knows. Everything comes from the project's files through the local server, so this stays small.
const S = { projects:[], data:{}, docs:{}, tabs:[], cur:null, route:{ view:'home' }, comp:{}, plan:[], next:null, agents:[], marks:{}, vaultSel:{}, vaultDirs:{}, sideHidden:false, panelPopped:false };
const KIND = {
  ask:{ label:'Ask', icon:'spark' }, note:{ label:'Note', icon:'note' }, canvas:{ label:'Canvas', icon:'canvas' }, work:{ label:'Work', icon:'code' }, grill:{ label:'Grill me', icon:'hint' }, discuss:{ label:'Discuss', icon:'canvas' }, spec:{ label:'Spec', icon:'doc' }, prototype:{ label:'Prototype', icon:'image' },
  build:{ label:'Build', icon:'code' }, check:{ label:'Self-review', icon:'check' }, review:{ label:'Review', icon:'read' }, merge:{ label:'Merge', icon:'merge' },
  read:{ label:'Read files', icon:'files' }, outline:{ label:'Outline', icon:'doc' }, slides:{ label:'Slides', icon:'slides' }, draft:{ label:'Draft', icon:'doc' },
  sketch:{ label:'Sketch', icon:'canvas' }, deploy:{ label:'Deploy', icon:'send' }, deliver:{ label:'Done', icon:'check' }, custom:{ label:'Step', icon:'check' },
};
const stepLabel = s => s.isTodo ? STATE_TEXT.todo : s.toReview ? STATE_TEXT.review : s.isReviewed ? STATE_TEXT.reviewed : s.kind === 'merge' || s.kind === 'deliver' ? STATE_TEXT.ready : s.label || KIND[s.kind]?.label || 'Step';
const stepIcon = s => KIND[s.kind]?.icon || 'check';
const STATE_TEXT = { notes:'Notes', working:'Working', wait:'Needs you', ready:'Finished', todo:'Todo', review:'To review', reviewed:'Reviewed', error:'Stopped', landed:'Finished', archived:'Archived', backlog:'Not started' };
// A command that picks what to make (PE-404) chooses a chip in the box; its words never go into the box.
const COMMANDS = [
  { cmd:'/diagram', title:'Diagram', icon:'diagram', make:{ kind:'diagram', sub:'auto' } },
  { cmd:'/architecture', title:'Architecture diagram', icon:'diagram', make:{ kind:'diagram', sub:'architecture' } },
  { cmd:'/workflow', title:'Workflow diagram', icon:'diagram', make:{ kind:'diagram', sub:'workflow' } },
  { cmd:'/sequence', title:'Sequence diagram', icon:'diagram', make:{ kind:'diagram', sub:'sequence' } },
  { cmd:'/explorer', title:'Visual Explorer', icon:'explorer', make:{ kind:'explorer', sub:'explain' } },
  { cmd:'/prototype', title:'Clickable prototype', icon:'explorer', make:{ kind:'explorer', sub:'prototype' } },
  { cmd:'/slides', title:'Slides', icon:'slides', make:{ kind:'slides', sub:'auto' } },
  { cmd:'/card', title:'Knowledge card', icon:'card', make:{ kind:'card', sub:'knowledge' } },
  { cmd:'/flashcards', title:'Flashcards', icon:'card', make:{ kind:'card', sub:'flashcards' } },
  { cmd:'/meeting', title:'A meeting from MeetCue', icon:'meetcue', meetcue:true },
  { cmd:'/brief', title:'Write a one-page brief', text:'Write a one-page brief: what this project is, where it stands, what comes next.', icon:'doc', art:'doc' },
  { cmd:'/grill-me', title:'Grill me before you start', text:'Grill me about this: ', icon:'hint', art:'doc' },
  { cmd:'/fix', title:'Fix something directly', text:'Fix this: ', icon:'code', art:'code' },
  { cmd:'/canvas', title:'Start a blank Canvas', text:'', icon:'pen', art:'blank', instant:'canvas' },
  { cmd:'/topic', title:'Write a new Topic', text:'', icon:'note', art:'note', instant:'topic' },
];
const TOPIC_TEMPLATES = [
  { id:'blank', label:'Blank', icon:'doc', sections:[] },
  { id:'development', label:'Development', icon:'code', sections:['What I asked for', 'Pictures', 'Feedback'] },
  { id:'meeting', label:'Meeting', icon:'agents', sections:['Agenda', 'Notes', 'Decisions', 'Action items'] },
  { id:'study', label:'Study or research', icon:'read', sections:['Goal', 'Notes', 'Sources', 'Questions'] },
];

async function api(path, { method = 'GET', body, raw, signal } = {}) {
  const init = { method, credentials:'same-origin', headers:{ accept:'application/json' }, ...(signal ? { signal } : {}) };
  if (raw !== undefined) init.body = raw;
  else if (body !== undefined) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(body); }
  let response;
  // Only a request that never reached PenEcho means PenEcho is not answering.
  try { response = await (HOSTED ? hostedFetch(path, init) : fetch(`/api/lines${path}`, init)); }   // Hosted: on penecho.ai requests go to Cloud's own routes (hosted.js)
  catch { if (signal?.aborted) throw Object.assign(new Error('Stopped.'), { aborted:true }); throw Object.assign(new Error('PenEcho is not answering. Your files are safe. Trying again.'), { offline:true }); }
  let data = null;
  try { data = await response.json(); } catch { /* A failure may have no body. */ }
  if (response.status === 402 && typeof cloudHeld === 'function') { const held = await cloudHeld(path, body, data); if (held) return held; }   // Cloud: an Ask kept for want of credits was saved, not failed (cloud.js)
  if (!response.ok) throw Object.assign(new Error(data?.error || `PenEcho could not do that (${response.status}).`), { status:response.status, code:data?.code, data });
  return data;
}
const pathFor = id => `/projects/${encodeURIComponent(id)}`;
// The address of something read straight by the browser: a picture, a file to download.
const apiUrl = path => (HOSTED ? `${HOSTED.base}${path.replace(/^\/projects\/[^/]+/, '')}` : `/api/lines${path}`);
const project = (id = S.cur) => S.data[id] || null;
function adoptState(state) {
  if (state.format !== 2) { S.needsRestart = true; throw new Error('Restart PenEcho to finish this update.'); }
  // A light state leaves out what no page has asked for yet (?for=light, ?for=rail). What it leaves out is given its empty form here, so every page can read it.
  const p = { ...state.project, readOnly:Boolean(state.readOnly), partial:statePartial(state), everyLine:!state.view || state.full === '*', openLines:Array.isArray(state.full) ? state.full : [], parts:state.parts || [], deletionWarnings:state.deletionWarnings || [], deleted:state.deleted || { lines:[], nodes:[], days:7 }, rev:state.rev, lines:state.lines, landed:state.landed, backlog:state.backlog, branches:state.branches || {}, notes:state.notes || [], pictures:state.pictures || [], files:state.files || [], artifacts:state.artifacts || [], filesShown:state.filesShown, latestFiles:state.latestFiles };
  const all = [...p.lines, ...p.landed, ...p.backlog];
  p.tokens = state.tokens || null;
  // The knowledge Topics agents keep in topics/; a line is in the Topic whose Lines table names it.
  p.knowledge = state.knowledge || [];
  p.areas = state.areas || [];
  p.areaDetails = state.areaDetails || {};
  p.understanding = Boolean(state.understanding);
  const topicOfLine = new Map();
  if (p.projectTopics !== false) for (const t of p.knowledge) for (const slug of t.lines) if (!topicOfLine.has(slug)) topicOfLine.set(slug, t);
  for (const l of all) l.knowledgeTopic = topicOfLine.get(l.slug) || null;
  if (p.partial) {
    for (const l of all) fillLight(l);
    // Without the folder's list of files, the open line's own files and the pictures the state names stand in for it, so they still show.
    if (!state.files) {
      const named = new Map((state.lineFiles || []).map(f => [f.path, f])), name = (path, mtime) => { if (path && !named.has(path)) named.set(path, { path, mtime, size:0 }); };
      for (const c of p.pictures) { name(c.source, c.mtime || 0); if (c.hasPicture) name(c.path, c.mtime || 0); }
      for (const l of all) { for (const f of l.pictures) name(f.path, l.updatedAt || 0); for (const s of l.stations) { for (const f of s.pictures || []) name(f.path, l.updatedAt || 0); for (const f of s.files || []) name(f.path, l.updatedAt || 0); } for (const f of l.ask.files) name(f.path, l.updatedAt || 0); }
      p.files = [...named.values()];
    }
  }
  all.forEach(l => { withFinishedStop(l); settleEnd(l); });
  // What you just added and the server has not written yet stays on the page (composer.js).
  if (typeof keepSaving === 'function') keepSaving(p);
  if (typeof keepStarting === 'function') keepStarting(p);   // An Ask just run with an agent shows its Work starting (line.js)
  if (typeof keepLineMarks === 'function') keepLineMarks(p);
  movePins(p);
  if (typeof cloudAdopt === 'function') cloudAdopt(p, state);   // Cloud: files that have two versions (cloud.js)
  S.data[p.id] = p;
  if ((typeof HOSTED === 'undefined' || !HOSTED) && Array.isArray(S.projects)) {
    const summary = S.projects.find(x => x.id === p.id);
    const compact = l => ({
      id:l.id, code:l.code, title:l.title, landed:l.landed, status:l.status, closed:l.closed, archived:l.archived,
      stations:l.stations.map(s => ({ kind:s.kind, state:s.state, ...(s.off ? { off:s.off } : {}), ...(s.reviewing ? { reviewing:true } : {}), unsent:Boolean(s.unsent) })),
      questions:(l.questions || []).length, createdAt:l.createdAt, at:l.lastActivityAt || l.statusAt || 0,
      shown:shownState(l), canReviewLine:canMarkReviewed(l), asking:Boolean(l.asking), unsent:l.stations.some(s => s.unsent),
      running:Boolean(l.running), pinned:Boolean(l.pinned), readRevision:l.readRevision || '',
    });
    if (summary) Object.assign(summary, { lines:p.lines.map(compact), backlog:p.backlog.map(compact) });
  }
  if (p.example) readExample(p);
  return p;
}
// A light line (light-state.js on the server) with what it leaves out in its empty form. Once for each: a line that did not change is the same object.
function fillLight(l) {
  if (l.filled) return;
  l.filled = true;
  l.slug ||= l.id; l.topicPath ||= `lines/${l.slug}.md`; l.branch ||= ''; l.code ||= ''; l.parent ||= ''; l.mergedInto ||= '';
  l.ask ||= { text:'', when:'', files:[], later:[] }; l.ask.files ||= []; l.ask.later ||= []; l.result ||= { text:'', files:[] };
  for (const key of ['pictures', 'labels', 'questions', 'parts', 'partList', 'mergedFrom', 'decided', 'handoffs', 'removed']) l[key] ||= [];
  l.conversation ??= null; l.conversations ||= {}; l.asking ??= null; l.diff ??= null;
  l.stations.forEach((s, i) => {
    s.index ??= i;
    const mine = LINE_STATUS.isYours(s);
    s.agent ||= mine ? 'you' : '';
    for (const key of ['took', 'text', 'out', 'off', 'why', 'now', 'via']) s[key] ||= '';
    s.when ||= s.took; s.detail ||= l.light && !mine && s.kind !== 'orch-review' && s.kind !== 'merge' && s.kind !== 'deliver' ? `works/${l.slug}/${s.id}.md` : '';
    for (const key of ['pictures', 'files', 'refers', 'questions']) s[key] ||= [];
    s.unsent = Boolean(s.unsent); s.diff ??= null; s.held ??= null;
  });
}
// A request reads Ask, Work, Finished. Finished is nobody's step: it is where the work stands, and merging from there stays your choice.
function withFinishedStop(l) {
  for (const s of l.stations) if (isEnd(s)) s.label = STATE_TEXT.ready;
  const last = l.stations[l.stations.length - 1];
  // An archived line ends where it did: a merge deleted from it (PE-1144) leaves no stop behind.
  if (l.archived || l.closed || last?.kind === 'merge' || last?.kind === 'deliver') return;
  // A line holding only your own notes and drawings has nothing to finish.
  if (lineState(l) === 'notes' || !l.stations.some(s => s.kind === 'ask' || isWork(s))) return;
  const ready = l.status === 'ready';
  l.stations.push({ id:'finished', index:l.stations.length, kind:l.branch ? 'merge' : 'deliver', label:'Finished', state:ready ? 'wait' : l.landed ? 'done' : 'todo', agent:'', took:l.landedAt || '', when:l.landedAt || '', out:'', wait:false, now:'', why:ready ? 'Not merged' : '', finished:true });
}
// Finished means you have been through it. Until every finished Work is marked Reviewed the line says To review, and it can still be merged or archived.
const nextToReview = LINE_STATUS.nextToReview;
const lineWorking = LINE_STATUS.lineWorking;
const lineReviewing = LINE_STATUS.lineReviewing;
const isReviewPending = LINE_STATUS.isReviewPending;
const toReview = LINE_STATUS.toReview;
const lineReviewed = LINE_STATUS.lineReviewed;
const canMarkReviewed = LINE_STATUS.canMarkReviewed;
const canTodo = LINE_STATUS.canTodo;
const canMarkTodo = LINE_STATUS.canMarkTodo || LINE_STATUS.canTodo;
const isTodo = LINE_STATUS.isTodo;
// Needs you comes before To review: a Work waiting on you, a question for you, or prototypes to choose from.
const lineNeedsYou = LINE_STATUS.lineNeedsYou;
const toLookAt = LINE_STATUS.toLookAt;
function settleEnd(l) {
  const waiting = toReview(l), todo = isTodo(l), reviewed = lineReviewed(l);
  for (const s of l.stations) if (isEnd(s)) {
    s.toReview = waiting && s.state !== 'todo';
    s.isTodo = todo && s.state !== 'todo';
    s.isReviewed = reviewed && s.state !== 'todo';
  }
}
const shownState = LINE_STATUS.shownState;
// A project opens with its light state (PE-1132): every line by its name and where it stands, and whole the lines that are going, wait
// for you or are still to review. What a page shows besides, it asks for before it is drawn (routeNeeds, main.js), so nothing on it
// changes under the hand while more of it comes (PE-594).
// The standalone rail beside a Canvas still needs only names and marks.
const stateView = id => (S.noViews ? '' : EMBED?.rail ? 'rail' : 'light');
const statePartial = state => (!state.view || (state.view === 'light' && state.full === '*' && ['files', 'tokens'].every(part => state.parts?.includes(part))) ? '' : state.view);
// Whether a project's state lists the folder's files.
const listsFiles = p => !p.partial || Boolean(p.parts?.includes('files'));
// What a page shows besides the light state: lines read whole, and parts (light-state.js PARTS).
const PAGE_PARTS = { files:['files'], canvases:['files'], topics:['files'], vault:['files'], memory:['files'], doc:['files'], markup:['files'], stats:['stats'], archive:['archive', 'files'] };
function routeNeeds(route) {
  if (!route) return {};
  if (route.view === 'line') return { lines:[route.line] };
  const owner = route.view === 'doc' || route.view === 'markup' ? /^(?:lines\/([^/]+)\.md$|works\/([^/]+)\/)/.exec(route.doc || '') : null;
  // The Orchestrator's page on a computer counts every agent's Works beside it.
  return { parts:route.view === 'orchestrator' && !HOSTED ? ['stats'] : PAGE_PARTS[route.view] || [], lines:owner ? [owner[1] || owner[2]] : [] };
}
// What of these a project's state does not hold yet, or null.
function lacks(p, { lines = [], parts = [], all = false } = {}) {
  if (!p?.partial || EMBED?.rail) return null;
  const missing = { lines:p.partial === 'rail' ? lines : lines.filter(id => lineById(p, id)?.light), parts:parts.filter(part => !p.parts?.includes(part)), all:all && !p.everyLine };
  return p.partial === 'rail' || missing.lines.length || missing.parts.length || missing.all ? missing : null;
}
// What the pages of each project have asked for this visit: the last lines opened, and the parts. Every look names them, so what is on
// screen stays whole; a project put aside for others starts light again.
const LINES_KEPT = 12, lightWants = new Map();
function keepWants(id, { lines = [], parts = [], all = false } = {}) {
  let had = lightWants.get(id);
  if (!had) lightWants.set(id, had = { lines:[], parts:[], all:false });
  for (const line of lines) if (line) had.lines = [...had.lines.filter(x => x !== line), line].slice(-LINES_KEPT);
  for (const part of parts) if (!had.parts.includes(part)) had.parts.push(part);
  if (all) had.all = true;
  return had;
}
const wantsQuery = wants => [wants.all ? 'full=*' : wants.lines.length ? `full=${wants.lines.map(encodeURIComponent).join(',')}` : '', wants.parts.length ? `parts=${wants.parts.join(',')}` : ''].filter(Boolean);
let stateRequest = 0;
const fullStateAccepted = new Map();
// A completed write supersedes reads started before it, including polls that
// arrive after its optimistic marks have been removed.
function invalidateStateReads(id) { fullStateAccepted.set(id, ++stateRequest); }
// The state as the server last sent it, kept as text part by part (PE-595). A poll names it (?base=) and is sent only what changed:
// the lines, files and token records that differ, and any other part that differs. The page still adopts a whole fresh state each time,
// as if all of it had been sent again; before, every poll that found anything changed took all of it, 13 MB on a big folder.
const sentStates = new Map(), SENT_LISTS = { lines:'id', landed:'id', backlog:'id', files:'path', 'tokens.records':'workId', 'tokens.starts':'workId' }, SENT_KEPT = 8;
const TOKEN_LISTS = ['records', 'starts'];
function keepList(kept, name, items) {
  const key = SENT_LISTS[name], keys = items.map(x => x?.[key]);
  kept.lists.set(name, keys.every(k => typeof k === 'string') && new Set(keys).size === keys.length
    ? { keys, items:new Map(items.map((x, i) => [keys[i], JSON.stringify(x)])) } : { text:JSON.stringify(items) });
}
// The token counts are kept without their records and starts, which are lists. Counts sent without them leave the kept lists as they are;
// the server says when one is gone.
function keepPart(kept, part, value) {
  if (part === 'tokens' && value && typeof value === 'object' && !Array.isArray(value)) {
    const rest = { ...value };
    for (const name of TOKEN_LISTS) if (Array.isArray(rest[name])) { keepList(kept, `tokens.${name}`, rest[name]); delete rest[name]; }
    kept.parts.set(part, JSON.stringify(rest)); return;
  }
  if (part === 'tokens') for (const name of TOKEN_LISTS) kept.lists.delete(`tokens.${name}`);
  kept.parts.set(part, JSON.stringify(value ?? null));
}
function keepSent(id, state) {
  const kept = { tag:state.tag, parts:new Map(), lists:new Map() };
  for (const [part, value] of Object.entries(state)) {
    if (part === 'tag') continue;
    if (SENT_LISTS[part] && Array.isArray(value)) keepList(kept, part, value); else keepPart(kept, part, value);
  }
  setSent(id, kept);
  markParsed(kept, state);
}
function setSent(id, kept) {
  // The one before stays a while: an answer to a question asked just before this one was taken still applies to it.
  kept.before = sentStates.get(id) || null;
  if (kept.before?.before) kept.before.before = null;
  sentStates.delete(id); sentStates.set(id, kept);
  for (const other of sentStates.keys()) if (sentStates.size > SENT_KEPT && other !== id) { sentStates.delete(other); lightWants.delete(other); }
}
// What changed, on the state kept for it. Null when it was not sent for that state or leaves something out: the whole state is asked for then.
function sentWith(id, change) {
  const last = sentStates.get(id), had = last?.tag === change.base ? last : last?.before?.tag === change.base ? last.before : null;
  if (!had) return null;
  const kept = { tag:change.tag, parts:new Map(had.parts), lists:new Map(had.lists) };
  kept.parts.set('rev', JSON.stringify(change.rev));
  // A part the state no longer has (the files of a line no longer open) is sent as null.
  for (const [part, value] of Object.entries(change.set || {})) if (value === null && part === 'lineFiles') kept.parts.delete(part); else keepPart(kept, part, value);
  for (const [name, list] of Object.entries(change.lists || {})) {
    if (!SENT_LISTS[name]) return null;
    if (list.gone) { kept.lists.delete(name); if (!name.includes('.')) kept.parts.delete(name); continue; }
    if (list.all) { keepList(kept, name, list.all); continue; }
    const was = kept.lists.get(name), key = SENT_LISTS[name];
    if (!was?.keys) return null;
    const put = new Map(list.put.map(x => [x[key], JSON.stringify(x)]));
    if (!list.keys && !list.drop && !list.insert) {
      const items = new Map(was.items);
      for (const [key, text] of put) {
        if (!was.items.has(key)) return null;
        items.set(key, text);
      }
      const nextList = { keys:was.keys, items };
      if (DATA_LISTS.includes(name)) previousList.set(nextList, was);
      kept.lists.set(name, nextList);
      continue;
    }
    const items = new Map();
    // The keys now: all of them, or the ones gone and the new ones with where they go (keysChange on the server).
    let keys = list.keys || was.keys;
    if (!list.keys && (list.drop || list.insert)) {
      const gone = new Set(list.drop || []);
      keys = was.keys.filter(k => !gone.has(k));
      for (const [i, k] of list.insert || []) keys.splice(i, 0, k);
    }
    for (const k of keys) { const text = put.get(k) ?? was.items.get(k); if (text === undefined) return null; items.set(k, text); }
    const nextList = { keys, items };
    if (DATA_LISTS.includes(name)) previousList.set(nextList, was);
    kept.lists.set(name, nextList);
  }
  return kept;
}
// The kept state as fresh objects: one JSON.parse of it all, as when it is sent whole. Given the state the page has (`had`), a line
// that did not change and that the page is not still saving something on is given as the page has it, not read again: the lines
// are most of a big project, and reading them all again on every change took longer than the whole state used to.
const LINE_LISTS = ['lines', 'landed', 'backlog'], parsedFrom = new WeakMap();
const DATA_LISTS = ['files', ...TOKEN_LISTS.map(name => `tokens.${name}`)], parsedListItems = new WeakMap(), previousList = new WeakMap();
const listParent = (state, name) => name.startsWith('tokens.') ? state.tokens : state;
const listField = name => name.startsWith('tokens.') ? name.slice('tokens.'.length) : name;
function freezeEntry(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  if (Array.isArray(value)) { for (const item of value) freezeEntry(item); }
  else { for (const key of Object.keys(value)) freezeEntry(value[key]); }
  return value;
}
const savingLines = id => new Set([
  ...(typeof SAVING !== 'undefined' ? SAVING.filter(e => e.project === id).map(e => e.lineId) : []),
  ...(typeof STARTING !== 'undefined' ? [...STARTING.values()].filter(e => e.project === id).map(e => e.line) : []),
  ...(typeof lineMarks !== 'undefined' ? [...lineMarks.values()].filter(e => e.project === id).map(e => e.line) : []),
  ...(typeof treeMarks !== 'undefined' ? [...treeMarks.values()].filter(b => b.project === id).flatMap(b => [...b.ops.keys()]) : []),
]);
function markParsed(kept, state) {
  for (const name of [...LINE_LISTS, ...DATA_LISTS]) {
    const parent = listParent(state, name), field = listField(name);
    const list = kept.lists.get(name), items = parent?.[field];
    if (!list || !Array.isArray(items)) continue;
    let stored = items;
    if (DATA_LISTS.includes(name)) {
      previousList.delete(list);
      stored = Object.freeze(items.map(freezeEntry));
      parsedListItems.set(list, stored);
      parent[field] = [...stored];
    }
    if (list.keys) stored.forEach((item, index) => parsedFrom.set(item, list.items.get(list.keys[index])));
  }
}
function sentState(kept, had = null) {
  const listText = list => list.text ?? `[${list.keys.map(k => list.items.get(k)).join(',')}]`, out = [];
  const reuse = had && had.partial !== 'rail' ? new Map([...had.lines, ...had.landed, ...had.backlog].map(l => [l.id, l])) : null;
  for (const [part, text] of kept.parts) {
    const lists = !reuse && part === 'tokens' && text.startsWith('{') ? TOKEN_LISTS.filter(name => kept.lists.has(`tokens.${name}`)).map(name => `"${name}":${listText(kept.lists.get(`tokens.${name}`))}`) : [];
    if (lists.length) out.push(`"tokens":${text === '{}' ? `{${lists.join(',')}}` : `${text.slice(0, -1)},${lists.join(',')}}`}`);
    else out.push(`${JSON.stringify(part)}:${text}`);
  }
  for (const [name, list] of kept.lists) if (!name.startsWith('tokens.') && !(reuse && (name === 'files' || LINE_LISTS.includes(name) && list.keys))) out.push(`${JSON.stringify(name)}:${listText(list)}`);
  const state = JSON.parse(`{${out.join(',')}}`);
  if (!reuse) { markParsed(kept, state); return state; }
  const saving = savingLines(had.id);
  for (const name of LINE_LISTS) {
    const list = kept.lists.get(name);
    if (!list?.keys) continue;
    state[name] = list.keys.map(k => {
      const text = list.items.get(k), old = reuse.get(k);
      if (old && !saving.has(k) && parsedFrom.get(old) === text) return old;
      const line = JSON.parse(text);
      parsedFrom.set(line, text);
      return line;
    });
  }
  for (const name of DATA_LISTS) {
    const list = kept.lists.get(name), parent = listParent(state, name), field = listField(name);
    if (!list || !parent || typeof parent !== 'object' || Array.isArray(parent)) continue;
    const cached = parsedListItems.get(list);
    if (cached) {
      parent[field] = [...cached];
      continue;
    }
    const prior = previousList.get(list);
    previousList.delete(list);
    const previous = prior ? parsedListItems.get(prior) : null;
    let items;
    if (!list.keys) items = JSON.parse(listText(list)).map(freezeEntry);
    else {
      const key = SENT_LISTS[name], oldItems = new Map((Array.isArray(previous) ? previous : []).map(item => [item?.[key], item]));
      items = list.keys.map(key => {
        const text = list.items.get(key), old = oldItems.get(key);
        if (old && parsedFrom.get(old) === text) return old;
        const item = freezeEntry(JSON.parse(text));
        parsedFrom.set(item, text);
        return item;
      });
    }
    const authoritative = Object.freeze([...items]);
    parsedListItems.set(list, authoritative);
    parent[field] = [...authoritative];
  }
  return state;
}
// needs: what this look needs besides the light state (lacks). route: the page it is for; this project's open page unless said otherwise.
// The address of this look, and what of the state it names is already held.
function stateAsk(id, { force = false, view = stateView(id), route = id === S.cur ? S.route : null, needs = null } = {}) {
  const known = S.data[id], light = view === 'light', wants = light ? (keepWants(id, routeNeeds(route)), keepWants(id, needs || {})) : null;
  // "Nothing changed" is only asked of a state that holds at least as much as the one wanted.
  const opened = line => known.everyLine || known.openLines.includes(line) || !lineById(known, line);
  const holds = known && !force && (light ? known.partial !== 'rail' && !lacks(known, wants) && wants.lines.every(opened) : !known.partial || known.partial === view);
  // penecho.ai's own routes send a whole state as before: only a light one names the state it changes.
  const base = light || (!view && !HOSTED) ? sentStates.get(id)?.tag || '' : null;
  const query = [view ? `for=${view}` : '', holds ? `rev=${encodeURIComponent(known.rev)}` : '', ...(light ? wantsQuery(wants) : []), base !== null ? `base=${encodeURIComponent(base)}` : ''].filter(Boolean).join('&');
  return { view, base, wants, path:`${pathFor(id)}/state${query ? `?${query}` : ''}` };
}
async function loadState(id = S.cur, { force = false, whole = false, again = false, view, route, needs = null } = {}) {
  const request = ++stateRequest, ask = stateAsk(id, { force, view:view && view !== 'light' && stateView(id) === 'light' ? 'light' : view, route, needs:whole ? { all:true, parts:['files', 'tokens'] } : needs }), { base } = ask;
  let state;
  try { state = await api(ask.path); }
  catch (error) {
    // A server that does not know the view is asked for the whole state, from then on.
    if (!ask.view || (error.status !== 400 && error.status !== 404) || error.code === 'NOT_FOUND') throw error;
    S.noViews = true;
    return loadState(id, { force, again });
  }
  // Asked to read it again after a change, the page takes the state again even when nothing changed: from what it kept, not from the server.
  const kept = state.tag && sentStates.get(id);
  if (state.same && kept && state.base && state.base === kept.tag) kept.tag = state.tag;
  if (state.same && !(force && kept?.tag === state.tag)) return false;
  // An older look still on its way must not replace what a newer one brought.
  if (request < (fullStateAccepted.get(id) || 0)) return false;
  if (state.same) state = sentState(kept);
  else if (state.delta) {
    const next = sentWith(id, state);
    if (!next) { sentStates.delete(id); if (again) throw new Error('PenEcho could not read this project. Trying again.'); return loadState(id, { force, whole, view, route, needs, again:true }); }
    setSent(id, next);
    // A read asked for after a change takes every line afresh, so nothing the page changed and the server did not take stays.
    state = sentState(next, force ? null : S.data[id]);
  } else if (base !== null && state.tag) keepSent(id, state);
  if (HOSTED && id === HOSTED.key && typeof hostedHeld === 'function') hostedHeld(state);
  adoptState(state);
  if (state.view !== 'rail') fullStateAccepted.set(id, request);
  return true;
}
// Lines, or parts of the state, a page is about to show: asked for once, however many places ask, and true once they are here.
const reading = new Map();
function readNeeds(p, needs) {
  const missing = lacks(p, needs);
  if (!missing) return Promise.resolve(true);
  const key = JSON.stringify([p.id, missing]), known = reading.get(key);
  if (known) return known;
  const asked = loadState(p.id, { needs:missing }).then(() => !lacks(S.data[p.id], needs)).finally(() => reading.delete(key));
  reading.set(key, asked);
  return asked;
}
const readLines = (p, lines) => readNeeds(p, { lines });
async function loadProjects() {
  const { projects, base, caseInsensitive } = await api('/projects');
  window.PenEchoProjects?.useBase(base, { caseInsensitive });
  S.projects = projects;
  return projects;
}
async function loadAgents() {
  const { agents, thisComputer, openFolderLabel, revealFileLabel } = await api('/agents');
  S.agents = agents;
  S.thisComputer = thisComputer === true;
  S.openFolderLabel = S.thisComputer ? openFolderLabel || "" : "";
  S.revealFileLabel = S.thisComputer ? (revealFileLabel || (/Finder/i.test(S.openFolderLabel) ? 'Reveal in Finder' : /Explorer/i.test(S.openFolderLabel) ? 'Show in File Explorer' : S.openFolderLabel ? 'Show in folder' : '')) : "";
  for (const a of agents) AGENTS[a.id] = { ...a, role:project()?.roles?.[a.id] || a.role };
  // Saved agents (Settings): a runner with a model and effort under a name. A server without them runs each runner as itself.
  // On penecho.ai they are the saved agents of the computers that sync the project (hosted.js).
  if (!HOSTED) S.presets = await api('/agent-presets').catch(() => null);
  else if (typeof hostedPresets === 'function') hostedPresets();
  else S.presets = null;
  if (typeof refreshAgentsSetupHint === 'function') refreshAgentsSetupHint();
}
// The saved agents that can run here, and PenEcho's default one.
const runnablePresets = () => (S.presets?.presets || []).filter(x => x.available && runnableAgents().some(a => a.id === x.agent));
const runPresets = () => runnablePresets().filter(x => x.showInPicker !== false);
const presetById = id => runnablePresets().find(x => x.id === id) || null;
const defaultPreset = () => presetById(S.presets?.default);
const availableAgents = () => S.agents.filter(a => a.available);
function applyRoles(p) { for (const a of S.agents) AGENTS[a.id] = { ...a, role:p?.roles?.[a.id] || a.role }; }

const allLines = p => [...p.lines, ...p.landed, ...p.backlog];
const lineById = (p, id) => allLines(p).find(l => l.id === id);
// Direct sub-Lines and parent Orchestrator Line(s) resolved from the loaded project state (PE-764/PE-765).
function orchestratorLinks(p) {
  const lines = allLines(p), bySlug = new Map(lines.map(line => [line.id, line])), byCode = new Map(), parents = new Map();
  for (const line of lines) {
    const code = line.orchestratorRef || line.code;
    if (code) byCode.set(code, byCode.has(code) ? null : line);
  }
  for (const line of lines) {
    const parent = line.orchestratedBySlug ? bySlug.get(line.orchestratedBySlug) : byCode.get(line.orchestratedBy);
    if (parent?.orchestratorRef && parent.id !== line.id) parents.set(line.id, parent);
  }
  return { bySlug, parents };
}
const subLinesOf = (p, l) => {
  if (!p || !l?.orchestratorRef) return [];
  const { bySlug, parents } = orchestratorLinks(p);
  return [...parents].filter(([, parent]) => parent.id === l.id).map(([id]) => bySlug.get(id));
};
const parentLinesOf = (p, l) => (!p || !l ? [] : l.orchestratedBySlug
  ? allLines(p).filter(parent => parent.id === l.orchestratedBySlug && parent.orchestratorRef && parent.id !== l.id)
  : allLines(p).filter(parent => parent.id !== l.id && parent.orchestratorRef && parent.orchestratorRef === l.orchestratedBy));

function archiveScope(p, selected) {
  const { bySlug, parents } = orchestratorLinks(p);
  const children = new Map();
  for (const [id, parent] of parents) {
    if (!children.has(parent.id)) children.set(parent.id, []);
    children.get(parent.id).push(id);
  }
  const tree = line => {
    const seen = new Set([line.id]), queue = [line.id];
    let cycle = false;
    for (const id of queue) for (const child of children.get(id) || []) {
      if (seen.has(child)) cycle = true;
      else { seen.add(child); queue.push(child); }
    }
    return { cycle, children:queue.slice(1).map(id => bySlug.get(id)).filter(child => !child.archived) };
  };
  const scopes = selected.map(line => ({ line, ...(line.orchestratorRef ? tree(line) : { children:[] }) }));
  const covered = new Set(scopes.flatMap(scope => scope.children.map(child => child.id)));
  const roots = scopes.filter(({ line, cycle }) => cycle || !covered.has(line.id));
  const moving = [...new Map([...selected, ...scopes.flatMap(scope => scope.children)].map(line => [line.id, line])).values()];
  return { roots, moving };
}
// Shared Orchestrator route labels used on both the Orchestrator tab and Line detail (PE-660 / PE-894).
const ORCH_ROUTE = { self:['Worked alone', 'Worked alone'], delegate:['Delegation planned', 'Delegated'], split:['Split planned', 'Split'] };
const orchRouteLabel = (route, hasChildren) => ORCH_ROUTE[route]?.[hasChildren ? 1 : 0] || '';
const orchReviewStepId = workId => `${workId}--review`;
function orchReviewStation(l, s) {
  if (!s || !isWork(s) || s.kind === 'review' || s.isReview || !(s.reviewing || (s.reviewStopped && typeof s.reviewStopped === 'object') || (s.review && typeof s.review === 'object'))) return null;
  const pending = s.reviewing && s.reviewPending && typeof s.reviewPending === 'object' ? s.reviewPending : null;
  const stopped = !s.reviewing && s.reviewStopped && typeof s.reviewStopped === 'object' ? s.reviewStopped : null;
  const r = !s.reviewing && !stopped && s.review && typeof s.review === 'object' ? s.review : null;
  const info = r || pending || stopped || {};
  const unexpected = Boolean(stopped && stopped.stopWhy !== 'stopped');
  const state = s.reviewing ? 'active' : stopped ? (unexpected ? 'error' : 'off') : 'done';
  return {
    id:orchReviewStepId(s.id),
    index:s.index,
    kind:'orch-review',
    isOrchReview:true,
    workId:s.id,
    workLabel:stepLabel(s),
    workAgent:s.agent || '',
    workTook:s.took || '',
    label:'Orchestrator review',
    state,
    ...(stopped && !unexpected ? { off:'stopped' } : {}),
    ...(stopped?.stopWhy ? { stopWhy:stopped.stopWhy } : {}),
    ...(stopped?.reason ? { why:stopped.reason } : {}),
    ...(stopped?.resetsAt ? { resetsAt:stopped.resetsAt } : {}),
    ...(stopped?.canContinue ? { canContinue:true } : {}),
    reviewing:Boolean(s.reviewing),
    review:r,
    reviewPending:pending,
    reviewStopped:stopped,
    agent:info.agent || '',
    took:r?.took || '',
    when:r?.at || stopped?.stoppedAt || pending?.startedAt || '',
    out:r ? (r.note || r.next || (r.verdict === 'unverified' ? 'Unverified' : r.score ? `${r.score}/5` : '')) : stopped ? (stopped.reason || 'Stopped') : 'Reviewing…',
    text:'',
    files:[],
    pictures:[],
    refers:[],
    detail:'',
  };
}
function stationById(l, id) {
  if (!l || !id) return null;
  const direct = l.stations?.find(s => s.id === id);
  if (direct) return direct;
  const m = /^(.+)--review$/.exec(String(id));
  if (!m) return null;
  const work = l.stations?.find(s => s.id === m[1]);
  return work ? orchReviewStation(l, work) : null;
}
// A line can hold nothing yet, or nothing any more once its last note is removed; it is then at an empty stop.
const NO_STATION = Object.freeze({});
const currentStation = l => [...l.stations].reverse().find(s => s.state === 'active') || l.stations.find(s => ['wait', 'error'].includes(s.state)) || (l.landed ? l.stations[l.stations.length - 1] : l.stations.find(s => s.state === 'todo')) || l.stations[l.stations.length - 1] || NO_STATION;
function lineState(l) {
  return LINE_STATUS.lineState(l);
}
const openQuestions = l => l.questions || [];
// The question an agent ended its reply on. In its own app, that is how it waits for you.
function questionIn(text) {
  const last = String(text || '').trim().split(/\n\s*\n/).pop().replace(/[*_`]/g, '');
  const end = last.split(/(?<=[.!?])\s+|(?<=[。！？])|\n/).filter(x => x.trim()).pop()?.replace(/^[\s\-•\d.)]+/, '').trim() || '';
  return /[?？]$/.test(end) ? end : '';
}
function askedYou(l) {
  if (!['ready', 'landed'].includes(lineState(l)) || l.archived || l.stations.some(s => s.unsent)) return '';
  const last = [...l.stations].reverse().find(s => s.kind !== 'merge' && s.kind !== 'deliver' && s.kind !== 'orch-review');
  return last && last.kind !== 'ask' ? questionIn(l.result?.text || last.out) : '';
}
// The branch a line is on, and how many lines share it, so that is plain from either of them.
// A line that only asks for a merge is not work on the branch, so it neither counts here nor offers a merge of its own.
const lineMates = (p, l) => (l.branch ? (p.lines || []).filter(x => x.branch === l.branch && !x.mergeOf).length : 0);
const branchChip = (p, l) => { const mates = lineMates(p, l); return `<span class="row-branch" title="${esc(mates > 1 ? `${mates} lines on ${l.branch}` : l.branch)}">${ic('branch', 13)}${esc(l.branch)}${mates > 1 ? `<em>${mates} lines</em>` : ''}</span>`; };
// What Git says about a line's branch. Until it has said, merging stays on offer and the server has the last word.
const branchInfo = (p, l) => p.branches?.[l.branch] || {};
const canMerge = (p, l) => Boolean(l.branch) && !l.mergeOf && branchInfo(p, l).mergeable !== false;
// A branch merges back to where it came from.
function mergeTarget(p, l) {
  const parent = branchInfo(p, l).parent, host = parent && (p.lines || []).find(x => x.branch === parent);
  return host ? { to:host.id, name:parent } : { to:null, name:l.base || p.trunk };
}
// What a whole branch merged into the trunk does to the lines on it, said before you choose: the Finished ones go to the Archive once Git shows the merge, the rest stay on the home.
function mergeOutcome(p, l) {
  const on = (p.lines || []).filter(x => x.branch === l.branch && !x.mergeOf);
  const goes = on.filter(x => x === l || (['ready', 'done'].includes(x.status) && (x.base || p.trunk) === p.trunk));
  return { goes, stays:on.filter(x => !goes.includes(x)) };
}
function mergeOutcomeHTML(p, l) {
  if (!l?.branch) return '';
  const { goes, stays } = mergeOutcome(p, l);
  const why = x => (x.stations.some(s => s.unsent) ? 'Not sent' : STATE_TEXT[lineState(x)] || '');
  const list = (rows, note) => `<ul>${rows.map(x => `<li><span>${esc(x.title)}</span>${note ? `<em>${esc(note(x))}</em>` : ''}</li>`).join('')}</ul>`;
  return `<div class="merge-after"><p>Once <code>${esc(l.branch)}</code> is in <code>${esc(p.trunk)}</code></p>
    <h4>${ic('archive', 14)}${goes.length === 1 ? 'Goes' : `${goes.length} lines go`} to the Archive after merging</h4>${list(goes)}
    ${stays.length ? `<h4>${ic('branch', 14)}${stays.length === 1 ? 'Stays' : `${stays.length} stay`} on the home</h4>${list(stays, why)}` : ''}</div>`;
}
const needsLook = (p, l) => ['wait', 'error'].includes(lineState(l)) || openQuestions(l).length > 0 || l.stations.some(s => s.unsent) || Boolean(askedYou(l) && !repliedTo(p, l, askedYou(l)));
const needList = p => (p.lines || []).filter(l => needsLook(p, l));
const needsYou = p => needList(p).length;
const working = p => (p.lines || []).filter(l => lineState(l) === 'working' || (typeof isReviewPending === 'function' && isReviewPending(l))).length;
const summaryNeeds = s => (s.lines || []).filter(l => ['waiting', 'stopped'].includes(l.status) || l.questions).length;
const summaryWorking = s => (s.lines || []).filter(l => l.status === 'working' || l.shown === 'working').length;
const folderLabel = p => String(p.vault?.path || p.docsPath || p.name).split('/').filter(Boolean).pop() || p.name;

// ---------- Paths inside the docs folder ----------
function resolvePath(fromFile, href) {
  if (/^(data:|https?:|blob:|#)/.test(href)) return href;
  const parts = fromFile.split('/').slice(0, -1);
  for (const seg of href.split('/')) { if (seg === '..') parts.pop(); else if (seg !== '.') parts.push(seg); }
  return parts.join('/');
}
// Agents also write a link from the docs folder, not from the file it is in: files/<line>/plan.md in a Work.
function linkedPath(fromFile, href) {
  const at = resolvePath(fromFile, href), plain = String(href).replace(/^\.\//, '');
  return /^files\//.test(plain) && !/^files\//.test(at) ? plain : at;
}
function relPath(fromFile, toFile) {
  const from = fromFile.split('/').slice(0, -1), to = toFile.split('/');
  let i = 0;
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++;
  return '../'.repeat(from.length - i) + to.slice(i).join('/');
}
// A knowledge Topic is a file of the project even on the Home, whose state lists no files.
const fileEntry = (p, path) => (p?.files?.length ? filesByPath(p.files).get(path) : undefined) || missedFile(p, path) || (p?.knowledge?.some(t => t.path === path) || (path === 'understanding.md' && p?.understanding) ? { path, mtime:0, size:0 } : undefined);
// The list of files by path, made once for each list: a page looks up hundreds of them in a folder of thousands.
const FILES_BY_PATH = new WeakMap();
function filesByPath(files) {
  let known = FILES_BY_PATH.get(files);
  if (!known || known.count !== files.length) { known = { count:files.length, map:new Map() }; for (const f of files) if (!known.map.has(f.path)) known.map.set(f.path, f); FILES_BY_PATH.set(files, known); }
  return known.map;
}
// A file looked for while the folder's list is not read: an open line's own files are all here, any other may be there after all. The
// list is read when something on the page named one (main.js readLineFiles).
const missedFiles = new Set();
function missedFile(p, path) {
  if (!p?.partial || listsFiles(p) || !path) return undefined;
  const owner = /^(?:files|works)\/([^/]+)\//.exec(path)?.[1];
  if (owner ? !p.openLines?.includes(owner) : path.includes('/')) missedFiles.add(p.id);
  return undefined;
}
const canvasByPath = (p, path) => p?.pictures?.find(c => c.path === path || c.source === path);
// Only files inside the folder are shown. A remote image in a Markdown file is left out, so opening a file never calls anywhere.
function assetUrl(p, src) {
  if (/^(data:|blob:)/.test(src)) return src;
  const entry = fileEntry(p, String(src).replace(/^(\.\.?\/)+/, ''));
  return entry ? apiUrl(`${pathFor(p.id)}/file?path=${encodeURIComponent(entry.path)}&v=${Math.round(entry.mtime)}`) : '';
}
const docKind = (p, path) => path === 'README.md' ? 'readme' : path === 'MEMORY.md' ? 'memory' : /^(?:lines|topics)\/[^/]+\.md$/.test(path) ? (allLines(p).some(l => l.topicPath === path) ? 'topic' : 'note') : /^works\/[^/]+\/[^/]+\.md$/.test(path) ? 'detail' : 'file';
const docByPath = (p, path) => /\.md$/.test(path) && fileEntry(p, path) ? { id:path, path, kind:docKind(p, path) } : null;
const lineOfDoc = (p, doc) => doc && allLines(p).find(l => l.topicPath === doc.path || doc.path.startsWith(`works/${l.slug}/`));
const docKey = (id, path) => `${id}:${path}`;
function docById(path, p = project()) { return S.docs[docKey(p.id, path)]; }
function makeDoc(p, path, data) {
  const kind = docKind(p, path);
  return { id:path, path, kind, md:data.md, codeLinks:new Set(data.codeLinks || []), hash:data.hash, mtime:data.mtime, generated:kind === 'readme', memory:kind === 'memory', title:(data.md.match(/^# (.+)$/m) || [])[1] || path.split('/').pop() };
}
const docLoadSeq = new Map(), docAppliedSeq = new Map();
async function loadDoc(p, path, { force = false } = {}) {
  const key = docKey(p.id, path), known = S.docs[key], entry = fileEntry(p, path);
  const canTrustCache = entry ? entry.mtime <= known?.mtime : (listsFiles(p) && !/^works\//.test(path));
  if (known && !force && canTrustCache) return known;
  const seq = (docLoadSeq.get(key) || 0) + 1;
  docLoadSeq.set(key, seq);
  const data = await api(`${pathFor(p.id)}/doc?path=${encodeURIComponent(path)}`);
  // A slower earlier fetch must never overwrite a newer version already loaded for this file.
  const latest = S.docs[key] || known;
  if (latest && ((docAppliedSeq.get(key) || 0) > seq || (!force && Number.isFinite(latest.mtime) && Number.isFinite(data.mtime) && data.mtime < latest.mtime))) return latest;
  docAppliedSeq.set(key, seq);
  // Open readers hold on to this object, so a fresh copy of the file updates it in place.
  if (latest) return Object.assign(latest, makeDoc(p, path, data));
  return S.docs[key] = makeDoc(p, path, data);
}
async function saveDoc(p, doc, md, { baseHash = doc.hash } = {}) {
  const saved = await api(`${pathFor(p.id)}/doc`, { method:'PUT', body:{ path:doc.path, md, baseHash } });
  const key = docKey(p.id, doc.path), seq = (docLoadSeq.get(key) || 0) + 1;
  docLoadSeq.set(key, seq); docAppliedSeq.set(key, seq);
  doc.md = md; doc.hash = saved.hash; doc.mtime = saved.mtime;
  if (p.knowledge?.some(t => t.path === doc.path)) topicsMine.add(`${p.id}:${doc.path}`);
  return saved;
}

// ---------- Topics that changed ----------
// Each Topic's mark (its text's hash, knowledge.js) this computer has already shown, per project. A Topic an agent
// made or changed, even while PenEcho was closed, is news once; what you edit here yourself is not. The first look only remembers.
const TOPICS_SEEN_KEY = 'penecho-topics-seen-v1';
let topicsSeen = {};
try { topicsSeen = JSON.parse(localStorage.getItem(TOPICS_SEEN_KEY) || '{}') || {}; } catch { /* Private browsing still works for this visit. */ }
const topicsMine = new Set();
function checkTopics(p = project()) {
  // The rail's state has no Topics, and while the Topics job has them moved away the folder shows none: neither is news.
  if (!p || EMBED?.rail || p.projectTopics === false || !p.knowledge?.length) return [];
  const seen = topicsSeen[p.id], now = Object.fromEntries(p.knowledge.map(t => [t.path, t.sig || '']));
  if (seen && Object.keys(now).every(k => seen[k] === now[k])) return [];
  topicsSeen[p.id] = now;
  try { localStorage.setItem(TOPICS_SEEN_KEY, JSON.stringify(topicsSeen)); } catch { /* Keep in memory if storage is unavailable. */ }
  if (!seen) return [];
  const fresh = p.knowledge.filter(t => t.sig && seen[t.path] !== t.sig && !topicsMine.delete(`${p.id}:${t.path}`)).map(t => ({ path:t.path, title:t.title, status:t.status || t.goal || '', isNew:!(t.path in seen) }));
  // A Topic gone again before you looked is no longer news; one changed twice is listed once.
  const kept = [...(S.topicsNew?.[p.id] || []).filter(t => t.path in now && !fresh.some(f => f.path === t.path)), ...fresh].slice(-12);
  if (kept.length) (S.topicsNew ||= {})[p.id] = kept; else if (S.topicsNew) delete S.topicsNew[p.id];
  if (fresh.length) (S.topicsTabFresh ||= {})[p.id] = { at:0, done:false };
  else if (!kept.length && S.topicsTabFresh) delete S.topicsTabFresh[p.id];
  return fresh;
}
const topicsGrew = p => Boolean(p && p.projectTopics !== false && S.topicsNew?.[p.id]?.length);
async function uploadFiles(p, files, dir = 'files/_incoming', uploaded = null) {
  const out = [];
  for (const f of files) {
    // On its way there already, with a drawing.
    if (f.blob && !f.path && typeof boxFilesGoing !== 'undefined') await boxFilesGoing.get(f)?.catch(() => {});
    // Already in the folder, such as something you drew.
    if (f.path) { out.push({ path:f.path, name:f.source ? 'drawing.png' : f.name, type:f.type }); continue; }
    let saved = uploaded?.get(f);
    if (!saved) {
      const upload = () => api(`${pathFor(p.id)}/upload?dir=${encodeURIComponent(dir)}&name=${encodeURIComponent(f.name)}`, { method:'POST', raw:f.blob });
      try { saved = await upload(); }
      catch (error) {
        if (!uploaded || error.status !== 409 || error.code !== 'project_changed') throw error;
        saved = await upload();
      }
      uploaded?.set(f, saved);
    }
    out.push({ path:saved.path, name:saved.name, type:f.type });
  }
  return out;
}
async function act(l, verb, body = {}, p = project()) {
  const result = await api(`${pathFor(p.id)}/topics/${encodeURIComponent(l.slug)}/${verb}`, { method:'POST', body });
  await loadState(p.id, { force:true, view:S.cur !== p.id ? 'rail' : undefined });
  return result;
}

// ---------- What a request turns into ----------
const DECK_WORDS = /\b(slides?|deck|pptx?|powerpoint|presentation)\b|幻灯片/;
// A word somewhere in a message is not a request for it. Only a message that opens by asking counts, or the quick start itself.
const ASKS_PROTOTYPE = /^(please |can you |could you )?((make|build|create|draw|show|design)( me)?( a| an| \d+| some| several| multiple| a few| two| three| four| five)?( \w+)? )?prototypes?\b|^(请|帮我)?(做|画|出|设计)?(一个|几个|多个|两三个|\d+个|个)?原型/, ASKS_GRILL = /^(please |can you |could you )?(grill[- ]me\b|ask me questions?\b)|^(请|帮我)?(先)?(反问|提问|问我问题)/;
const MAKE_WORDS = /\b(slides?|deck|pptx?|powerpoint|presentation|write|draft|summari[sz]e|report|brief|memo|draw|sketch|diagram|architecture|workflow|sequence|visual explorer|prototypes?|grill[- ]me|fix|build|implement)\b|幻灯片|原型|反问|提问/;
// A request is one run of one agent. Only a prototype or being grilled stops to talk to you first. Merging is never part of it: that is yours to choose afterwards.
function detectPath(text, c, p) {
  const t = String(text).trim().toLowerCase(), cmd = c.cmd;
  if (cmd === 'canvas') return { kind:'canvas' };
  // In a Topic you are talking to its agent, so "note: ..." is only more words.
  if (cmd === 'topic' || (!c.flags?.topic && /^(note|remember):/.test(t))) return { kind:'note' };
  // In a folder that only holds notes, what you type is a note, unless you clearly ask for something made.
  if (!cmd && !c.fromDoc && !c.flags?.topic && !c.flags?.make && homeShape(p) === 'notes' && !MAKE_WORDS.test(t)) return { kind:'note', stay:true };
  const grill = cmd === 'grill-me' || ASKS_GRILL.test(t), prototype = cmd === 'prototype' || ASKS_PROTOTYPE.test(t);
  return { kind:'line', path:cmd === 'deck' || c.flags?.make?.kind === 'slides' || DECK_WORDS.test(t) ? 'deck' : 'work', kinds:['ask', ...(grill ? ['grill'] : []), ...(prototype ? ['prototype'] : []), 'work'] };
}
const titleFromText = text => {
  const first = String(text).trim().split(/\n/)[0].replace(/^\/\w+\s*/, '').replace(/^(please|can you|could you)\s+/i, '');
  const sentence = first.split(/(?<=[.!?。！？])\s*/)[0].replace(/[.!?。！？]+$/, '');
  const max = 120, cut = sentence.length > max ? sentence.slice(0, max - 2) : '', byWord = cut ? cut.replace(/\s+\S*$/, '') : '';
  const short = cut ? `${byWord.length >= Math.floor(max / 2) ? byWord : cut.trimEnd()}…` : sentence;
  return short ? short[0].toUpperCase() + short.slice(1) : 'New Topic';
};

// ---------- Handing work to any agent ----------
const tokensForSize = size => Math.ceil((size || 0) / 4);
const fmtTokens = n => n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n);
function agentPrompt(p, l) {
  const code = (p.vault.code[0] || {}).path;
  const files = ['README.md', 'MEMORY.md', ...(l ? [l.topicPath] : [])];
  const text = [
    `You are picking up work in the PenEcho project "${p.name}".`,
    `Docs folder: ${p.vault.path}`,
    code ? `Code folder: ${code}${l?.branch ? ` (branch ${l.branch})` : ''}` : 'This project has no code folder.',
    '',
    'Read only these files first:',
    ...files.map((f, i) => `${i + 1}. ${f}`),
    '',
    l ? `Then carry on with "${l.title}".` : 'Then ask me which line to work on, or start one in lines/.',
    '',
    'Rules:',
    `- Follow the "Keeping this file" part of MEMORY.md. Change MEMORY.md only with \`${p.memoryCommand || 'sh .penecho/memory'}\` (run it with help to see how).`,
    '- The status at the top of the Topic and its steps say where things stand. Each step links a detail file: open one only if you need it.',
    '- Never rewrite the words under an "Ask" heading. New ones at the end are what to do next.',
    '- When a picture explains something better than words, draw it with PenEcho Canvas and link it from the Topic.',
    '- Follow links to pictures and files only when you need them.',
  ].join('\n');
  return { text, files, tokens:files.reduce((n, f) => n + tokensForSize(fileEntry(p, f)?.size), tokensForSize(text.length)) };
}
const codePointer = p => `<!-- penecho:project -->\n## Project docs\nThe docs for this code live in ${p.vault.path}.\nBefore working, read MEMORY.md there and follow its "Keeping this file" part, then README.md and the Topic you are working on. Change MEMORY.md only with ${p.memoryCommand || 'its memory command'}.\nDo not create a second status file here.\n<!-- /penecho:project -->`;
function canvasUrl(p, { source, doc, title, summary, seed, draft }) {
  const q = new URLSearchParams({ linesProject:p.id, linesCanvas:source, linesBack:location.hash.slice(1) });
  if (seed) q.set('linesSeed', seed);
  if (draft) q.set('linesDraft', '1');
  if (doc) q.set('linesDoc', doc);
  if (title) q.set('linesTitle', title);
  if (summary) q.set('linesSummary', summary);
  return `${HOSTED && !HOSTED.read ? '/canvas/project' : '/'}?${q}`;
}
// A picture grows to fill the screen and its Canvas opens under that same picture.
// A picture opened to draw on (seeded) grows only to where its new Canvas will show it, and the Canvas takes it from there (project-lines-cover.js).
async function openCanvasPage(url, from, { seeded = false, fresh = false, picture = null } = {}) {
  if (embedOpens(url)) return;
  if (HOSTED) { if (HOSTED.read) hostedCanvas(url); else hostedGo(url); return; }
  if (typeof window !== 'undefined' && window.PenEchoCanvasShell?.enabled?.()) {
    await window.PenEchoCanvasShell.open(url, { from, seeded, fresh, picture });
    return;
  }
  if (orchFileWrites.size) await Promise.all(orchFileWrites);
  const img = from?.tagName === 'IMG' ? from : from?.querySelector?.('img'), src = img?.naturalWidth ? img.currentSrc || img.src : '';
  const motion = src && !reducedMotion() && document.body.animate, nw = img?.naturalWidth, nh = img?.naturalHeight;
  const end = motion && seeded ? seedLanding(nw, nh) : null;
  const coverSrc = src && !/^blob:/i.test(src) ? src : '';
  try {
    if (coverSrc) sessionStorage.setItem('penecho-lines-opening', coverSrc); else sessionStorage.removeItem('penecho-lines-opening');
    if (coverSrc && end) sessionStorage.setItem('penecho-lines-opening-at', JSON.stringify(end)); else sessionStorage.removeItem('penecho-lines-opening-at');
  } catch { /* It only means a blank cover. */ }
  // The cover hides the sidebar on the way to the Canvas, so it is not carried across the change of page either (lines.css).
  $('#rail')?.classList.add('rail-leaving');
  if (reducedMotion() || !document.body.animate) { location.assign(url); return; }
  const cover = document.createElement('div');
  cover.id = 'canvasZoom';
  document.body.append(cover);
  // The page changes when the animation ends, or soon after in any case: a tab in the background, or a browser that holds
  // animations back, never finishes it, and the cover would then stay over the page with nothing under it.
  let gone = false;
  const go = () => { if (!gone) { gone = true; location.assign(url); } };
  setTimeout(go, src ? 900 : 600);
  const fade = cover.animate([{ opacity:0 }, { opacity:1 }], { duration:src ? 220 : 130, fill:'forwards', easing:'ease-out' });
  if (!src) { fade.onfinish = go; return; }
  const vp = typeof pageViewport === 'function' ? pageViewport() : { width:innerWidth, height:innerHeight };
  const box = typeof pageRect === 'function' ? pageRect(img) : img.getBoundingClientRect(), small = Math.min(box.width / nw, box.height / nh), fromW = nw * small, fromH = nh * small;
  const big = Math.min((vp.width - 128) / nw, (vp.height - 128) / nh), { width:w, height:h, left, top } = end || { width:nw * big, height:nh * big, left:(vp.width - nw * big) / 2, top:(vp.height - nh * big) / 2 };
  const shot = new Image();
  shot.src = src; shot.alt = '';
  shot.style.cssText = `left:${left}px;top:${top}px;width:${w}px;height:${h}px;`;
  cover.append(shot);
  const grow = shot.animate([{ transform:`translate(${box.left + (box.width - fromW) / 2 - left}px,${box.top + (box.height - fromH) / 2 - top}px) scale(${fromW / w})` }, { transform:'none' }], { duration:300, easing:'cubic-bezier(.3,.7,.2,1)', fill:'forwards' });
  grow.onfinish = go;
}
// Where a new Canvas shows a picture it was opened to draw on, as the Canvas places it (projectLinesSeeded and canvasAgentFramePlan):
// 600 to 1800 wide, 60 around it, framed in the view below the Canvas's top bar, never above 100%.
const CANVAS_BAR = 48;
function seedLanding(nw, nh) {
  const vp = typeof pageViewport === 'function' ? pageViewport() : { width:innerWidth, height:innerHeight };
  const w = Math.max(600, Math.min(1800, nw)), h = Math.round(w * nh / nw), vw = vp.width, vh = Math.max(1, vp.height - CANVAS_BAR);
  const scale = Math.max(.03, Math.min(1, vw / (w + 120), vh / (h + 120)));
  return { left:(vw - w * scale) / 2, top:CANVAS_BAR + (vh - h * scale) / 2, width:w * scale, height:h * scale };
}
function freeSource(p, dir, name) {
  let candidate = `${dir}/${name}.penecho.json`, n = 2;
  while (fileEntry(p, candidate)) candidate = `${dir}/${name}-${n++}.penecho.json`;
  return candidate;
}

// Reading is personal to this browser. The server's seen.json is for agent ingestion.
const READ_KEY = 'penecho-line-reads-v1';
let lineReads = {};
try { lineReads = JSON.parse(localStorage.getItem(READ_KEY) || '{}') || {}; } catch { /* Private browsing still works for this visit. */ }
const receiptKey = (p, l) => `${p.id}:${l.id}`;
const lineUnread = (p, l) => Boolean(l.readRevision && lineReads[receiptKey(p, l)] !== l.readRevision);
// One label in one place, before the title, so they line up down the page. A question waiting for you beats Unread, and opening the line does not clear it.
const lineHint = (p, l) => l.asking ? 'asking' : lineUnread(p, l) ? 'unread' : '';
const lineHintClass = (p, l) => { const hint = lineHint(p, l); return hint ? ` is-${hint}` : ''; };
// Unread shows only as a bold title; a question still says Answer.
const lineHintTag = (p, l) => lineHint(p, l) === 'asking' ? '<span class="line-hint line-answer">Answer</span>' : '';
// An example comes with its story already told, so nothing in it is news until it changes on this computer.
function readExample(p) {
  if (Object.keys(lineReads).some(k => k.startsWith(`${p.id}:`))) return;
  for (const l of allLines(p)) if (l.readRevision) lineReads[receiptKey(p, l)] = l.readRevision;
  try { localStorage.setItem(READ_KEY, JSON.stringify(lineReads)); } catch { /* Keep in memory if storage is unavailable. */ }
}
// Capture only the version deliberately opened. A refresh or an incoming reply does not read it.
function readOpenedLine() {
  const p = project(), l = p && S.route.view === 'line' && lineById(p, S.route.line);
  if (!l || !l.readRevision || document.hidden || !$('#linePage')) return;
  try { lineReads = { ...lineReads, ...JSON.parse(localStorage.getItem(READ_KEY) || '{}') }; } catch { /* Keep this visit's receipts. */ }
  lineReads[receiptKey(p, l)] = l.readRevision;
  try { localStorage.setItem(READ_KEY, JSON.stringify(lineReads)); } catch { /* Keep in memory if storage is unavailable. */ }
}
// Mark one or more Lines read in this browser (e.g. after bulk Mark reviewed) so unread dots clear immediately.
function markLinesRead(p, slugs) {
  if (!p || !Array.isArray(slugs) || !slugs.length) return;
  try { lineReads = { ...lineReads, ...JSON.parse(localStorage.getItem(READ_KEY) || '{}') }; } catch { /* Keep this visit's receipts. */ }
  let changed = false;
  for (const id of slugs) {
    const l = lineById(p, id);
    if (!l?.readRevision) continue;
    const key = receiptKey(p, l);
    if (lineReads[key] !== l.readRevision) { lineReads[key] = l.readRevision; changed = true; }
  }
  if (changed) {
    try { localStorage.setItem(READ_KEY, JSON.stringify(lineReads)); } catch { /* Keep in memory if storage is unavailable. */ }
  }
}
// ---------- Lines kept to hand in the sidebar ----------
// The lines you pinned are kept with each line, in its file. Manual sidebar positions are personal to this browser.
// Pins made before the server kept them are in this browser: they are moved to the lines once, and then forgotten here.
const PIN_KEY = 'penecho-line-pins-v1';
const LINE_VISITS_KEY = 'penecho-line-visits-v1';
const LINE_VISITS_MAX = 40;
const readLists = key => { try { const v = JSON.parse(localStorage.getItem(key) || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; } };
const writeLists = (key, lists) => { try { localStorage.setItem(key, JSON.stringify(lists)); } catch { /* Keep in memory if storage is unavailable. */ } };
let linePinned = readLists(PIN_KEY);
let lineVisits = readLists(LINE_VISITS_KEY);
function trimProjectVisits(map) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return {};
  const entries = Object.entries(map).filter(([id, at]) => id && typeof at === 'number' && Number.isFinite(at) && at > 0)
    .sort((a, b) => b[1] - a[1]).slice(0, LINE_VISITS_MAX);
  return Object.fromEntries(entries);
}
function projectLineVisits(p) {
  const mine = p && lineVisits[p.id];
  return mine && typeof mine === 'object' && !Array.isArray(mine) ? { ...mine } : {};
}
function recordLineVisit(projectId, lineId, at = Date.now()) {
  if (!projectId || !lineId || !Number.isFinite(at)) return;
  lineVisits = { ...lineVisits, ...readLists(LINE_VISITS_KEY) };
  const mine = trimProjectVisits(lineVisits[projectId]);
  mine[lineId] = Math.max(at, Number(mine[lineId]) || 0);
  lineVisits[projectId] = trimProjectVisits(mine);
  writeLists(LINE_VISITS_KEY, lineVisits);
}
function renameLineVisit(projectId, fromId, toId) {
  if (!projectId || !fromId || !toId || fromId === toId) return;
  lineVisits = { ...lineVisits, ...readLists(LINE_VISITS_KEY) };
  const mine = trimProjectVisits(lineVisits[projectId]);
  if (!(fromId in mine)) return;
  mine[toId] = Math.max(mine[fromId], Number(mine[toId]) || 0);
  delete mine[fromId];
  lineVisits[projectId] = trimProjectVisits(mine);
  writeLists(LINE_VISITS_KEY, lineVisits);
}
function recordOpenedLine(p = project()) {
  const id = S.route?.view === 'line' ? S.route.line : '';
  const l = p && id && (typeof lineById === 'function' ? lineById(p, id) : allLines(p).find(x => x.id === id));
  if (!l) return;
  recordLineVisit(p.id, l.id);
}
// Which projects the sidebar has open, as you chose. A project you never chose for is open when it is the one on screen or one of the three opened last.
const RAIL_KEY = 'penecho-rail-open-v1';
let railChoice = readLists(RAIL_KEY);
const linePins = p => [...(p.lines || []), ...(p.backlog || [])].filter(l => l.pinned).map(l => l.id).concat(linePinned[p.id] || []);
const isPinned = (p, l) => linePins(p).includes(l.id);
const forgetPin = (p, id) => {
  linePinned = readLists(PIN_KEY);
  const left = (linePinned[p.id] || []).filter(x => x !== id);
  if (left.length) linePinned[p.id] = left; else delete linePinned[p.id];
  writeLists(PIN_KEY, linePinned);
};
async function pinLine(p, l, on) {
  await api(`${pathFor(p.id)}/topics/${encodeURIComponent(l.slug)}/pin`, { method:'POST', body:{ pinned:on } });
  l.pinned = on;
  forgetPin(p, l.id);
  await loadState(p.id, { force:true, view:S.cur !== p.id ? 'rail' : undefined }).catch(() => {});
}
// Once for each project: what this browser pinned goes to the lines themselves. A pin whose line is gone is dropped; one the server refuses stays here.
const pinsMoving = new Set();
function movePins(p) {
  const mine = linePinned[p.id] || [];
  if (!mine.length || HOSTED || pinsMoving.has(p.id)) return;
  pinsMoving.add(p.id);
  (async () => {
    for (const id of mine) {
      const l = [...p.lines, ...p.backlog].find(l => l.id === id);
      if (!l) { if (!p.landed.some(x => x.id === id)) forgetPin(p, id); continue; }
      try { if (!l.pinned) await api(`${pathFor(p.id)}/topics/${encodeURIComponent(l.slug)}/pin`, { method:'POST', body:{ pinned:true } }); l.pinned = true; forgetPin(p, id); }
      catch { break; }
    }
  })().finally(() => pinsMoving.delete(p.id));
}
// A pin made in another window, or beside a Canvas, shows here too.
addEventListener('storage', e => {
  if (e.key !== PIN_KEY && e.key !== RAIL_KEY) return;
  linePinned = readLists(PIN_KEY); railChoice = readLists(RAIL_KEY);
  if (typeof renderRail === 'function') renderRail();
});
// Pressing Reply settles that one hint on this browser. A new question from the same line shows again.
const REPLY_KEY = 'penecho-line-replies-v1';
let lineReplies = {};
try { lineReplies = JSON.parse(localStorage.getItem(REPLY_KEY) || '{}') || {}; } catch { /* Private browsing still works for this visit. */ }
const repliedTo = (p, l, words) => lineReplies[receiptKey(p, l)] === words;
function rememberReply(p, l, words) {
  try { lineReplies = { ...lineReplies, ...JSON.parse(localStorage.getItem(REPLY_KEY) || '{}') }; } catch { /* Keep this visit's replies. */ }
  lineReplies[receiptKey(p, l)] = words;
  try { localStorage.setItem(REPLY_KEY, JSON.stringify(lineReplies)); } catch { /* Keep in memory if storage is unavailable. */ }
}
// Closing a deletion warning hides that message on this browser.
const NEED_HIDE_KEY = 'penecho-need-hidden-v1';
let needHidden = {};
try { needHidden = JSON.parse(localStorage.getItem(NEED_HIDE_KEY) || '{}') || {}; } catch { /* Private browsing still works for this visit. */ }
const needMark = item => [item.kind, item.step || '', item.words || ''].join('\n');
const needIsHidden = (key, mark) => (needHidden[key] || []).includes(mark);
function setNeedHidden(key, marks) {
  try { needHidden = { ...needHidden, ...JSON.parse(localStorage.getItem(NEED_HIDE_KEY) || '{}') }; } catch { /* Keep this visit's choices. */ }
  if (marks.length) needHidden[key] = marks; else delete needHidden[key];
  try { localStorage.setItem(NEED_HIDE_KEY, JSON.stringify(needHidden)); } catch { /* Keep in memory if storage is unavailable. */ }
}
// `still` is every mark that place could show now, so a message that has gone is not remembered for ever.
const hideNeedMark = (key, mark, still) => setNeedHidden(key, [...new Set([...(needHidden[key] || []).filter(m => still.includes(m)), mark])]);
addEventListener('storage', e => {
  if (e.key !== READ_KEY && e.key !== REPLY_KEY && e.key !== NEED_HIDE_KEY && e.key !== LINE_VISITS_KEY) return;
  try {
    const value = JSON.parse(e.newValue || '{}') || {};
    if (e.key === READ_KEY) lineReads = value;
    else if (e.key === REPLY_KEY) lineReplies = value;
    else if (e.key === LINE_VISITS_KEY) lineVisits = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    else needHidden = value;
  } catch { return; }
  if (project() && S.route.view === 'home') refreshAfterChange();
});
