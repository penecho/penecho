// The home's list of lines: one lane for each, the one with the newest note, Ask or Work on top. Finished lines you have read stay out until you ask for them.
// By time, each day is a clock and each lane's marks sit where they happened that day. A lane opens in place to show its last Ask and result.
const STATE_COLOR = { working:'var(--c-run)', wait:'var(--amber-mark)', ready:'var(--c-end)', error:'var(--red)' };
// The turn a line takes where it leaves the page it was on (the moving line, line.js).
const MAP = { turn:14 };
// Main, what hangs off it, and what hangs off that: what Archive on a whole branch takes.
function mapTree(p) {
  const info = p.branches || {}, names = [...new Set(p.lines.map(l => l.branch).filter(name => name && name !== p.trunk))];
  const node = name => ({ name, info:info[name] || {}, lines:p.lines.filter(l => l.branch === name), kids:names.filter(x => info[x]?.parent === name).map(node) });
  const waiting = l => !l.branch && l.newBranchFrom;
  const root = { isMain:true, name:p.trunk, info:{}, lines:p.lines.filter(l => (!l.branch || l.branch === p.trunk) && !waiting(l) && !l.offMain), kids:names.filter(x => !names.includes(info[x]?.parent)).map(node) };
  const find = (n, name) => (n.name === name ? n : n.kids.map(k => find(k, name)).find(Boolean));
  for (const l of p.lines.filter(waiting)) (find(root, l.newBranchFrom) || root).kids.push({ name:`new:${l.id}`, isNew:true, info:{}, lines:[l], kids:[] });
  return root;
}
const linesUnder = n => [...n.lines, ...n.kids.flatMap(linesUnder)];

// ---------- When a line was last touched, and what it last said ----------
// A note, an Ask and a finished line say when. A Work says only how long it took, so a line whose last word is an agent's goes by when its file last changed.
const stepTime = s => { const m = /^(\d{4})-(\d\d)-(\d\d)(?:[ T](\d\d):(\d\d))?/.exec(s.when || s.took || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)).getTime() : 0; };
function lastActivity(l) {
  // The server's own word for it, once it gives one.
  if (l.lastActivityAt) return typeof l.lastActivityAt === 'number' ? l.lastActivityAt : Date.parse(l.lastActivityAt) || 0;
  let at = 0, open = false;
  for (const s of l.stations) {
    const t = stepTime(s);
    if (t) { at = Math.max(at, t); open = false; }
    else if (!isYours(s) && !isEnd(s) && s.state !== 'todo') open = true;
  }
  if ((open || !at) && l.updatedAt > at) at = l.updatedAt;
  return at || l.statusAt || 0;
}
function lastWords(l) {
  // What an agent is asking you, or else the last thing said: an Ask not sent yet counts, Work not started does not.
  const asked = l.asking?.questions?.[0]?.text, s = [...l.stations].reverse().find(x => !isEnd(x) && (x.unsent || (x.state !== 'todo' && x.state !== 'off'))) || l.stations[0];
  const words = plainOut(asked || (s ? stopWords(s) : '')).replace(/\s+/g, ' ').trim(), title = String(l.title || '').replace(/…$/, '').toLowerCase();
  // A line named from its first words does not say them twice.
  return title && words.toLowerCase().startsWith(title) ? words.slice(title.length).replace(/^[\s.:,;!?…-]+/, '') : words;
}
// Worked out once for each version of a line: the state gives new lines whenever something changed.
const ROW_FACTS = new WeakMap();
function rowFacts(l) {
  let f = ROW_FACTS.get(l);
  if (!f) { const words = lastWords(l); f = { at:lastActivity(l), words, text:`${l.title}\n${words}\n${l.code || ''}\n${l.orchestratorRef || ''}\n${l.orchestratedBy || ''}`.toLowerCase() }; ROW_FACTS.set(l, f); }
  return f;
}
// Where a line stands, in one word, for its row's class.
function rowMark(p, l) {
  const state = lineState(l);
  if (state === 'error') return 'bad';
  if (lineNeedsYou(l)) return 'you';
  if (state === 'working') return 'run';
  if (l.stations.some(s => s.unsent)) return 'unsent';
  if (isTodo(l)) return 'todo';
  if (toReview(l)) return 'review';
  if (typeof isReviewPending === 'function' ? isReviewPending(l) : typeof LINE_STATUS !== 'undefined' && Boolean(LINE_STATUS.isReviewPending?.(l))) return 'run';
  if ((state === 'ready' || state === 'landed') && hasWork(l)) return 'done';
  return 'notes';
}
// A line of only your notes and drawings has nothing to finish, whatever its status says once it is back from the Archive.
const hasWork = l => l.stations.some(s => s.kind === 'ask' || isWork(s));

// ---------- Which lines show ----------
// Each count selects only that kind of line. All, or pressing the selected count again, clears the status filter.
const MAP_FILTERS = {
  working: (p, l) => lineState(l) === 'working' || (typeof isReviewPending === 'function' ? isReviewPending(l) : typeof LINE_STATUS !== 'undefined' && Boolean(LINE_STATUS.isReviewPending?.(l))),
  stopped: (p, l) => lineState(l) === 'error',
  you: (p, l) => lineNeedsYou(l),
  todo: (p, l) => isTodo(l),
  review: (p, l) => toReview(l),
  done: (p, l) => ['ready', 'landed'].includes(lineState(l)) && !toLookAt(l) && !(typeof isReviewPending === 'function' ? isReviewPending(l) : typeof LINE_STATUS !== 'undefined' && Boolean(LINE_STATUS.isReviewPending?.(l))) && hasWork(l),
  unread: (p, l) => lineHint(p, l) === 'unread',
};
// The choice is kept for each project on this browser.
const HOME_KEY = 'penecho-lines-home-v1';
function normalizeHomeChoice(choice) {
  if (!choice || typeof choice !== 'object' || Array.isArray(choice)) return {};
  const next = { ...choice }, f = Object.hasOwn(MAP_FILTERS, next.f) ? next.f : !next.f && next.done === true ? 'done' : '';
  delete next.done;
  if (f) next.f = f; else delete next.f;
  return next;
}
const HOME_CHOICE = (() => {
  try {
    const old = JSON.parse(localStorage.getItem(HOME_KEY) || '{}');
    if (!old || typeof old !== 'object' || Array.isArray(old)) return {};
    const next = Object.fromEntries(Object.entries(old).map(([id, choice]) => [id, normalizeHomeChoice(choice)]));
    if (JSON.stringify(old) !== JSON.stringify(next)) { try { localStorage.setItem(HOME_KEY, JSON.stringify(next)); } catch { /* The migration still applies for this visit. */ } }
    return next;
  } catch { return {}; }
})();
const homeChoice = p => HOME_CHOICE[p.id] || {};
function setHomeChoice(p, change) {
  const next = normalizeHomeChoice({ ...homeChoice(p), ...change });
  for (const key of Object.keys(next)) if (!next[key]) delete next[key];
  if (Object.keys(next).length) HOME_CHOICE[p.id] = next; else delete HOME_CHOICE[p.id];
  try { localStorage.setItem(HOME_KEY, JSON.stringify(HOME_CHOICE)); } catch { /* It still holds for this visit. */ }
}
const mapFilter = p => { const f = homeChoice(p).f; return Object.hasOwn(MAP_FILTERS, f) ? f : ''; };
// Finished and read: nothing in it is news, so it is out of the way.
const restsDone = (p, l) => MAP_FILTERS.done(p, l) && lineHint(p, l) !== 'unread';
// By time is newest first. Any saved My order or By topic reads as By time.
function sortLines(_p, list) {
  return list.sort((a, b) => rowFacts(b).at - rowFacts(a).at || a.id.localeCompare(b.id));
}
// What you type in the filter box looks through every line of the project, the finished ones too.
// Finished lines you have read are listed too, folded under their day.
function shownLines(p) {
  const f = mapFilter(p), q = (Pano.words[p.id] || '').trim().toLowerCase();
  return sortLines(p, p.lines.filter(l => (!f || MAP_FILTERS[f](p, l)) && (!q || rowFacts(l).text.includes(q)) && inTopic(p, l)));
}

// A Topic tile on the Home shows only the lines of that Topic (desk.js topicFilter).
const inTopic = (p, l) => { const path = typeof topicFilter === "function" ? topicFilter(p) : ""; return !path || l.knowledgeTopic?.path === path; };

// Group matching Lines before the day and page boundaries. The first match places the
// session at its latest matching activity. A filtered-out parent supplies just its title.
function sessionRootOf(p) {
  const byRef = new Map();
  for (const l of allLines(p)) {
    if (l.orchestratorRef) byRef.set(l.orchestratorRef, byRef.has(l.orchestratorRef) ? null : l);
  }
  return l => {
    const parent = !l.orchestratorRef && byRef.get(l.orchestratedBy);
    return parent && !parent.archived && !parent.queued ? parent : l;
  };
}
function homeSessions(matches, rootOf) {
  const groups = new Map();
  for (const l of matches) {
    const root = rootOf(l);
    if (!groups.has(root)) groups.set(root, { members:[], children:[] });
    const group = groups.get(root);
    group.members.push(l);
    if (l !== root) group.children.push(l);
  }
  return groups;
}

// ---------- Days ----------
const dayKeyOf = ms => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
// "Today", the days of this week as "Wed 11", older ones as "6 Oct".
function lineDayName(ms) {
  const day = dayStart(ms), today = dayStart(Date.now()), d = new Date(day);
  if (day === today) return 'Today';
  if (today - day < 6.5 * 86400000 && day < today) return `${d.toLocaleDateString('en', { weekday:'short' })} ${d.getDate()}`;
  return d.toLocaleDateString('en-GB', { day:'numeric', month:'short', ...(d.getFullYear() !== new Date().getFullYear() ? { year:'numeric' } : {}) });
}
ACT['day-open'] = el => { const p = project(); (Pano.dayOpen[p.id] ||= new Set()).add(el.dataset.day); Pano.update(); };

// ---------- A day's lines, by branch ----------
// By time, the lines of one day that work on the same branch hang together under that branch, which forks off the trunk.
// A group stands where its newest line would; lines on the trunk stay one by one, newest first.
// Lines on the trunk that a knowledge Topic names hang together under that Topic the same way; a branch comes first.
function branchGroups(p, lines, locationOf = l => l) {
  const out = [], by = new Map(), topics = new Map(), groupByTopic = p?.projectTopics !== false;
  for (const l of lines) {
    const location = locationOf(l), name = location?.branch && location.branch !== p.trunk ? location.branch : '';
    if (!name && groupByTopic && location?.knowledgeTopic) {
      const t = location.knowledgeTopic;
      if (!topics.has(t.path)) { const g = { branch:'', topic:t, lines:[] }; topics.set(t.path, g); out.push(g); }
      topics.get(t.path).lines.push(l);
      continue;
    }
    if (!name) { out.push({ branch:'', lines:[l] }); continue; }
    if (!by.has(name)) { const g = { branch:name, lines:[] }; by.set(name, g); out.push(g); }
    by.get(name).lines.push(l);
  }
  return out;
}
// Where your code folder is, shown only while that is not the trunk: checking a branch out moves no line.
const hereMark = (p, name) => (p.here && p.here !== p.trunk && name === p.here ? `<i class="bh-here" title="Checked out in your folder" aria-label="Checked out in your folder">${ic('files', 12)}</i>` : '');
// The branch's head: its name, how many of the day's lines are on it, what Git says of it, its changes, and a new line on it.
function branchHeadHTML(p, name, n) {
  const info = p.branches?.[name] || {};
  const diff = p.lines.filter(l => l.branch === name && l.diff).reduce((d, l) => ((l.diff.add || 0) + (l.diff.del || 0) > d.add + d.del ? { add:l.diff.add || 0, del:l.diff.del || 0 } : d), { add:0, del:0 });
  const note = info.note ? `<span class="bh-note${info.merged ? ' is-merged' : ''}">${esc(info.note)}</span>` : '';
  // A branch made from another line's branch says which, so a branch of a branch reads as one.
  const from = info.parent && !info.merged ? `<span class="bh-from" title="Made from ${esc(info.parent)}">from <b>${esc(info.parent)}</b></span>` : '';
  return `<div class="hl-bhead"><span class="trunk-label bh-pill" title="${esc(name)}">${ic('branch', 14)}<span>${esc(name)}</span>${hereMark(p, name)}</span>${from}<span class="bh-n">${esc(plural(n, 'line', 'lines'))}</span>${note}${diff.add || diff.del ? `<span class="row-diff"><i>+${diff.add}</i> <u>−${diff.del}</u></span>` : ''}${newLineOn(p, name)}${archiveBranchOn(p, name)}</div>`;
}

// A Topic's head: its name, which opens the Topic, and how many of the day's lines are in it.
function topicHeadHTML(p, t, n) {
  return `<div class="hl-bhead"><button type="button" class="trunk-label bh-pill bh-topic" data-act="open-doc" data-doc="${esc(t.path)}" title="${esc(t.title)}">${ic('note', 14)}<span>${esc(t.title)}</span></button><span class="bh-n">${esc(plural(n, 'line', 'lines'))}</span></div>`;
}

// ---------- Off main ----------
// Lines with no Git stand apart, in a card of their own under the whole of main, never on main's trunk.
function offHeadHTML(p, rootOf) {
  const open = p.lines.filter(l => rootOf(l).offMain && !MAP_FILTERS.done(p, l)).length;
  return `<span class="trunk-label is-off">${ic('note', 14)}Off main</span><span class="hl-count">${open} ${open === 1 ? 'line' : 'lines'} open</span>${boxTarget(homeBox(p), p) ? newLineOn(p, '', true) + drawLineOn(p, '', true) : ''}`;
}

// ---------- Starting a line ----------
// The chip beside Send says which branch the box is set to.
function newLineOn(p, name, off = false) {
  if (!boxTarget(homeBox(p), p)) return `<button type="button" class="new-line-on" data-act="new-line-here" aria-label="New line" title="Write the first thing of a new line in the box">${ic('plus', 13)}New line</button>`;
  const on = off ? 'off main' : `on ${name}`;
  return `<button type="button" class="new-line-on" data-act="new-line-on" ${off ? 'data-off="1"' : `data-branch="${esc(name)}"`} aria-label="New line ${esc(on)}" title="New line ${esc(on)}">${ic('plus', 13)}New line</button>`;
}
// A new line whose first node is a drawing: the real Canvas opens, and Done brings the drawing back as that line.
function drawLineOn(p, where, off = false) {
  const on = !boxTarget(homeBox(p), p) ? '' : off ? ' off main' : ` on ${where}`;
  return `<button type="button" class="new-line-on draw-line-on" data-act="draw-line-on" ${off ? 'data-off="1"' : `data-where="${esc(where)}"`} aria-label="Start a line with a drawing${esc(on)}" title="Opens the Canvas. What you draw starts a new line${esc(on)}.">${ic('pen', 13)}Start with a drawing</button>`;
}
// The latest 50 conversations in this project's folders, as lines; once synced, up to 50 more not yet here.
function syncOn(p) {
  if (!p.code) return '';
  const more = Boolean(p.synced);
  const tip = more && typeof SYNC_MORE_WHY === 'string' ? SYNC_MORE_WHY : SYNC_WHY;
  return `<button type="button" class="new-line-on" data-act="sync-recent" ${S.syncing ? 'disabled' : ''} title="${esc(tip)}">${ic('retry', 13)}${S.syncing ? 'Syncing…' : more ? 'Sync more' : 'Sync conversations'}</button>`;
}
ACT['new-line-here'] = () => { const p = project(), form = $(`.composer[data-comp="home-${p.id}"]`), ta = form && $('.cmp-input', form); if (ta) { ta.focus(); form.classList.remove('pulse'); void form.offsetWidth; form.classList.add('pulse'); } };
ACT['draw-line-on'] = el => {
  const p = project(), where = el.dataset.where;
  if (boxTarget(homeBox(p), p)) chooseTarget(el.dataset.off ? { off:true } : where === folderBranch(p) ? { main:true } : { branch:where });
  ACT['draw-line'](el);
};
// Only a code folder is offered this, and nothing happens until you say yes twice.
function trackHTML(p) {
  if (p.git !== false || !p.code) return '';
  if (S.trackAsk !== p.id) return '<button type="button" class="new-line-on" data-act="track-ask" title="Keep a history, so work can go on branches">Track changes</button>';
  return '<span class="track-ask">Run git init and commit this folder\'s files? Nothing leaves this computer.</span><button type="button" class="track-yes" data-act="track-yes">Track changes</button><button type="button" class="new-line-on" data-act="track-no">Not now</button>';
}

// ---------- A line as a lane ----------
// Its title and last words at the left, its track in the middle, where it stands at the right. Clicked, it shows its last Ask and result under it.
// By time the track is its day's clock, each mark where it happened; when a day has no clock yet, the last steps stand evenly spaced.
// The line so far: what has not started is not part of it, and Finished is the state at the end, not a step.
function trackSteps(l) {
  let end = l.stations.length;
  while (end > 1 && l.stations[end - 1].state === 'todo' && !l.stations[end - 1].unsent) end--;
  return l.stations.slice(0, end).filter(s => !isEnd(s));
}
// A picture the step holds: a drawing, a picture an Ask attached, the first picture a Work made. Only one the project has.
const FILE_SET = new WeakMap();
const hasFile = (p, path) => { let set = FILE_SET.get(p); if (!set) { set = new Set([...(p.files || []).map(f => f.path), ...(p.pictures || []).filter(c => c.hasPicture).map(c => c.path)]); FILE_SET.set(p, set); } return set.has(path); };
function stepPicture(p, s) {
  const pics = s.kind === 'ask' ? (s.files || []).filter(f => f.image) : s.pictures || [];
  return pics.find(pic => pic.path && hasFile(p, pic.path)) || null;
}
// ---------- When each step happened ----------
const LANE_MIN = 60000, LANE_HOUR = 3600000;
const floorHour = t => { const d = new Date(t); d.setMinutes(0, 0, 0); return d.getTime(); };
const tookMins = s => { const m = /^(\d+)\s*min/.exec(String(s.took || '')); return m ? +m[1] : 0; };
// An Ask, a note, a Canvas or a meeting says when. A Work's own file says when it started and ended (the server's startedAt and endedAt);
// a Work from before those files starts where the step before it stands and lasts what it took. A Work running now has no end yet: it ends now.
// Worked out once for each version of a line.
const LANE_STEPS = new WeakMap();
function laneSteps(l) {
  let found = LANE_STEPS.get(l);
  if (found) return found;
  found = [];
  let last = 0;
  for (const s of trackSteps(l)) {
    if (isYours(s)) { const t = stepTime(s) || last; last = Math.max(last, t); found.push({ s, yours:true, t }); continue; }
    if (s.state === 'todo') continue;
    const running = s.state === 'active', t = s.startedAt || (running && l.runStarted) || last;
    const t1 = running ? 0 : s.endedAt || (t && tookMins(s) ? t + tookMins(s) * LANE_MIN : stepTime(s) || t);
    last = Math.max(last, t1 || t);
    found.push({ s, t, t1, running, agent:s.agent && s.agent !== 'you' ? s.agent : '' });
  }
  LANE_STEPS.set(l, found);
  return found;
}

// ---------- A day's clock ----------
// From the hour of the day's first step to the hour after its last; today's runs to now. Hour ticks far enough apart that their words never touch.
const dayFromKey = key => { const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(key || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : 0; };
function dayClock(key, lines, now, W) {
  const from = dayFromKey(key);
  if (!from || !(W > 0)) return null;
  const to = dayStart(from + 30 * LANE_HOUR), today = from === dayStart(now);
  let lo = Infinity, hi = -Infinity;
  const see = t => { if (t >= from && t < to) { lo = Math.min(lo, t); hi = Math.max(hi, t); } };
  for (const l of lines) { see(rowFacts(l).at); for (const e of laneSteps(l)) { see(e.t); see(e.t1); } }
  if (!today && lo === Infinity) return null;
  const start = today ? Math.max(from, floorHour(Math.min(lo, now - LANE_HOUR))) : floorHour(lo), end = today ? Math.max(now, start + LANE_MIN) : Math.max(floorHour(hi), start) + LANE_HOUR;
  const perHour = W * LANE_HOUR / (end - start), step = [1, 2, 3, 4, 6, 12].find(h => h * perHour >= 58) || 24, ticks = [];
  for (let t = floorHour(start); t <= end; t += LANE_HOUR) if (t >= start && new Date(t).getHours() % step === 0) ticks.push(t);
  return { start, end, now, today, W, step, perHour, ticks, x:t => Math.max(0, Math.min(W, (t - start) / (end - start) * W)) };
}
const clockTime = t => { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
// Places on a day's track are kept as shares of its width, so a track that changes width keeps its marks where they were until it is laid out again.
const lanePx = (n, W = 0) => (W ? `${Math.round(n / W * 10000) / 100}%` : `${Math.round(n * 10) / 10}px`);
// A day's head: its name and how many lines, its clock along the track, and for today where now is. It stays in view while you scroll through the day.
function dayHeadHTML(key, words, n, clock) {
  const marks = clock ? clock.ticks.map(t => { const x = clock.x(t), side = x < 18 ? ' is-first' : clock.W - x < 18 ? ' is-last' : ''; return `<span class="hc-l${side}" style="left:${lanePx(x, clock.W)}">${clockTime(t)}</span><i class="hc-t" style="left:${lanePx(x, clock.W)}"></i>`; }).join('') : '';
  return `<div class="hl-day" data-day="${esc(key)}"><span class="hl-day-w"><span class="hl-day-name">${esc(words)}</span><em>${esc(plural(n, 'line', 'lines'))}</em></span><div class="hl-clock" aria-hidden="true">${clock ? `${marks}<i class="hc-trunk"></i>${clock.today ? '<i class="hc-now"></i>' : ''}` : ''}</div><span class="hl-now">${clock?.today ? `Now · ${clockTime(clock.now)}` : ''}</span></div>`;
}
// The day's hour lines run down through its lanes, under the ticks.
// A background placed by a share is placed by what is left beside one tile, so the first hour line's share is divided by that.
function dayGridStyle(clock) {
  if (!clock?.ticks.length) return '';
  const size = clock.step * clock.perHour / clock.W, first = clock.x(clock.ticks[0]) / clock.W;
  return ` style="--hx:${size < 1 ? Math.round(first / (1 - size) * 10000) / 100 : 0}%;--hs:${Math.round(size * 10000) / 100}%"`;
}

// ---------- The marks on a lane ----------
// Your Ask is the blue ring, an Ask not sent the dashed amber one; a note, a Canvas and a meeting have their own small marks.
// A Work is its agent's face where it started and, when longer than the circle, a bar in that agent's colour. Where the line stands circles the last agent's face (or sits at the end when there is none).
const LANE_GAP = 4, LANE_FACE = 9, LANE_RING = 14, LANE_ASK = 19, LANE_PITCH = 26, LANE_EVEN = 8;
const LANE_END = { run:7, todo:7, review:7, done:8, bad:7, you:8 };
const laneMarkHTML = (s, at, W) => `<span class="st dm dm-${s.unsent ? 'unsent' : s.kind}" data-step="${esc(s.id)}" style="left:${lanePx(at, W)}"><span class="nd"></span></span>`;
function laneFaceHTML(p, l, e, at, W, ring = '') {
  if (!e.agent) return `<span class="st dm dm-work" data-step="${esc(e.s.id)}" style="left:${lanePx(at, W)}"><span class="nd"></span></span>`;
  const asked = ring === 'you' && (l.asking || openQuestions(l).length);
  const cls = ring ? ` has-end e-${ring}${asked ? ' is-asked' : ''}` : '';
  return `<span class="st dm dm-face${cls}" data-step="${esc(e.s.id)}" style="left:${lanePx(at, W)}"><span class="nd">${av(e.agent, 18)}${asked ? '<b class="dm-q">?</b>' : ''}</span></span>`;
}
const laneBarHTML = (e, at, len, W) => `<span class="dm-bar" style="left:${lanePx(at, W)};width:${lanePx(len, W)}${e.agent ? `;--av:${esc(agentInfo(e.agent).color)}` : ''}"></span>`;
// A question waiting for you is a ? mark; anything else waiting on you is an amber dot.
function laneEndHTML(p, l, mark, at, W) {
  const asked = mark === 'you' && (l.asking || openQuestions(l).length), done = mark === 'done';
  return `<span class="st st-end dm dm-end e-${mark}${asked ? ' is-asked' : ''}" style="left:${lanePx(at, W)}"><span class="nd">${done ? ic('check', 10) : asked ? '<b>?</b>' : ''}</span></span>`;
}
const laneJoin = (j0, j1, W) => (j1 > j0 ? `--j0:${lanePx(j0, W)};--jw:${lanePx(j1 - j0, W)}` : '');
// By time: each mark at its moment on the day's clock, W px wide. Marks keep their order and never touch: an Ask that started a Work sits
// tight at the left of the agent's face, a bar shows only when a Work outlasts its circle, and when they do not all fit the earliest go, and the line runs in from the left edge.
function timedTrackHTML(p, l, clock) {
  const { W, x } = clock, mark = rowMark(p, l), steps = laneSteps(l), end = LANE_END[mark] || 0, wait = mark === 'you';
  let items = [];
  for (let i = 0; i < steps.length; i++) {
    const e = steps[i], next = steps[i + 1];
    if (e.yours && e.s.kind === 'ask' && !e.s.unsent && next && !next.yours) { items.push({ ask:e, work:next, t:next.t }); i++; }
    else items.push(e.yours ? { mine:e, t:e.t } : { work:e, t:e.t });
  }
  let earlier = items.some(it => !(it.t >= clock.start));
  items = items.filter(it => it.t >= clock.start);
  items.forEach((it, i) => {
    if (!it.work?.agent) return;
    it.ring = it.work.running ? 'run' : (end && mark !== 'run' && i === items.length - 1 ? mark : '');
  });
  const shape = (it, short) => {
    if (it.mine) { const r = it.mine.s.unsent ? 7 : 6; return { L:r, R:r, bar:0, faceR:r, askDist:0 }; }
    const w = it.work, faceR = w.agent ? (it.ring ? LANE_RING : LANE_FACE) : 5;
    const raw = short ? 0 : w.running ? Math.max(0, W - x(w.t)) : Math.max(0, x(w.t1 || w.t) - x(w.t));
    const bar = raw > faceR + 4 ? raw : 0;
    const askDist = it.ask ? LANE_ASK + (faceR > LANE_FACE ? faceR - LANE_FACE : 0) : 0;
    return { L:it.ask ? askDist + 6 : faceR, R:Math.max(faceR, bar), bar, faceR, askDist };
  };
  const willShowEnd = Boolean(end && (mark === 'run' ? !items.some(it => it.ring === 'run') : !items[items.length - 1]?.ring));
  // How far the last mark may reach: a running Work's bar runs on to now, and a standalone end mark or wait needs its room.
  const reach = willShowEnd ? (mark === 'run' ? W - 4 : W - LANE_GAP - end - (wait ? 14 : 0)) : (wait ? W - 14 : W);
  const lay = short => {
    const g = items.map(it => shape(it, short)), a = [];
    let edge = -Infinity;
    g.forEach((s, i) => { const at = Math.max(x(items[i].t), s.L, edge + LANE_GAP + s.L); a.push(at); edge = at + s.R; });
    if (edge > reach) { let limit = reach; for (let i = g.length - 1; i >= 0; i--) { a[i] = Math.min(a[i], limit - g[i].R); limit = a[i] - g[i].L - LANE_GAP; } }
    return { g, a, fits:!g.length || a[0] >= g[0].L - .5 };
  };
  let laid = lay(false);
  while (!laid.fits) { const short = lay(true); if (short.fits) { laid = short; break; } items.shift(); earlier = true; laid = lay(false); }
  const { g, a } = laid, out = [];
  let edge = 0, lastSpan = 0;
  items.forEach((it, i) => {
    const at = a[i];
    if (it.mine) { out.push(laneMarkHTML(it.mine.s, at, W)); edge = at + g[i].R; lastSpan = g[i].R; return; }
    const w = it.work, raw = w.running ? Math.max(0, W - at) : g[i].bar, bar = raw > g[i].faceR + 4 ? raw : 0;
    if (bar) out.push(laneBarHTML(w, at, bar, W));
    if (it.ask) out.push(laneMarkHTML(it.ask.s, at - g[i].askDist, W));
    out.push(laneFaceHTML(p, l, w, at, W, it.ring));
    lastSpan = Math.max(g[i].faceR, bar);
    edge = at + lastSpan;
  });
  const showEnd = Boolean(end && (mark === 'run' ? !items.some(it => it.ring === 'run') : !items[items.length - 1]?.ring));
  const at = !showEnd ? 0 : mark === 'run' ? W : items.length ? Math.min(W, edge + LANE_GAP + end) : Math.max(end, x(rowFacts(l).at));
  if (showEnd) out.push(laneEndHTML(p, l, mark, at, W));
  const waitFrom = showEnd ? at + end + 2 : items.length ? a[a.length - 1] + lastSpan + 2 : at + 2;
  if (wait && W - waitFrom > 2) out.push(`<span class="dm-wait" style="left:${lanePx(waitFrom, W)};width:${lanePx(W - waitFrom, W)}"></span>`);
  const first = items.length ? a[0] - (items[0].ask ? g[0].askDist : 0) : at, last = showEnd ? at : items.length ? a[a.length - 1] : 0;
  return `<div class="hl-track" aria-hidden="true" style="${laneJoin(earlier ? 0 : first, last, W)}">${out.join('')}</div>`;
}
// Fallback when a day has no clock: the last steps, evenly spaced, in order.
function evenTrackHTML(p, l) {
  const mark = rowMark(p, l), all = laneSteps(l), steps = all.slice(-LANE_EVEN), end = LANE_END[mark] || 0, out = [];
  const lastStep = steps[steps.length - 1];
  const ringFor = e => (e.running && e.agent ? 'run' : end && mark !== 'run' && e === lastStep && e.agent ? mark : '');
  const showEnd = Boolean(end && (mark === 'run' ? !steps.some(e => e.running && e.agent) : !lastStep?.agent));
  let at = 14, first = 0, lastAt = 0;
  for (const e of steps) {
    const ring = ringFor(e);
    if (ring && at > 14) at += 4;
    if (!first) first = at;
    out.push(e.yours ? laneMarkHTML(e.s, at) : laneFaceHTML(p, l, e, at, undefined, ring));
    lastAt = at;
    at += LANE_PITCH + (ring ? 4 : 0);
  }
  const stop = showEnd ? (steps.length ? lastAt + LANE_PITCH - 2 : 14) : lastAt;
  if (showEnd) out.push(laneEndHTML(p, l, mark, stop));
  return `<div class="hl-track is-even" aria-hidden="true" style="${laneJoin(all.length > steps.length ? 0 : first || stop, stop)}">${out.join('')}</div>`;
}

// ---------- Where a lane stands, and what opens under it ----------
const LANE_WORDS = { todo:'Todo', review:'To review', you:'Needs you', unsent:'Not sent', bad:'Stopped' };
function laneSince(l) {
  const start = laneSteps(l).find(e => e.running)?.t || l.runStarted, m = start ? Math.max(1, Math.round((Math.floor(Date.now() / LANE_MIN) * LANE_MIN - start) / LANE_MIN)) : 0;
  return !m ? 'Working' : `Working · ${m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h` : `${Math.floor(m / 1440)} d`}`;
}
// Answer goes where the agent asks: its own app when a click opens it, else the box on this line's page. Under the lane, answerAct says it in full.
function answerButton(l) {
  const a = l.asking, line = esc(l.id);
  const canChooseLocal = Boolean(l && !l.closed && !l.archived && !l.elsewhere && !(typeof HOSTED !== 'undefined' && HOSTED?.read));
  const localWork = l.stations?.find(s => isWork(s) && ((s.asking?.kind === 'tool' && s.asking.answerable && s.asking.isBlocking !== false) || (canChooseLocal && s.questions?.length)))
    || (canChooseLocal ? l.stations?.find(s => isWork(s) && s.waitingReply) : null);
  const waitWork = localWork || l.stations?.find(s => isWork(s) && (s.asked || (s.asking?.kind === 'tool' && s.asking.isBlocking !== false))) || l.stations?.find(s => isWork(s) && s.state === 'wait');
  const localReady = Boolean(localWork || (a?.kind === 'tool' && a.answerable) || (canChooseLocal && openQuestions(l).length));
  const chat = !localReady && !HOSTED && !a?.answerable && a?.kind === 'tool' ? l.conversations?.[a.agent] || l.conversation : null;
  const stepId = localWork?.id || a?.step || waitWork?.id || '';
  const stepAttr = stepId ? ` data-step="${esc(stepId)}"` : '';
  const act = chat?.canOpen || chat?.opensApp ? `data-act="open-desktop" data-line="${line}" data-agent="${esc(a.agent)}"` : `data-act="${a || waitWork || l.questions?.length || l.waitingForReply ? 'need-reply' : 'open-line'}" data-line="${line}"${stepAttr}`;
  return `<button type="button" class="hl-answer" ${act}>Answer</button>`;
}
function laneStateHTML(p, l) {
  const mark = rowMark(p, l);
  if (mark === 'you' && (l.asking || openQuestions(l).length || l.waitingForReply)) return answerButton(l);
  const words = mark === 'run' ? laneSince(l) : mark === 'done' ? (lineReviewed(l) ? STATE_TEXT.reviewed : STATE_TEXT.ready) : LANE_WORDS[mark];
  const status = words ? `<span class="hl-say s-${mark}">${esc(words)}</span>` : '';
  const stop = mark === 'bad' ? lineStopButton(l, 'btn sm hl-stop') : '';
  return status + stop;
}
const laneTrackHTML = (p, l, clock) => (clock ? timedTrackHTML(p, l, clock) : evenTrackHTML(p, l));
// Under a lane you opened: the last thing asked, the last result with its agent's face, the one thing to do next, Open line; then its code and time.
function laneDetailHTML(p, l) {
  const steps = trackSteps(l), line = esc(l.id), f = rowFacts(l);
  const pic = s => { const found = s && stepPicture(p, s); return found ? `<button type="button" class="st-pic" data-act="home-picture" data-path="${esc(found.path)}" data-line="${line}" data-step="${esc(s.id)}" aria-label="Open image: ${esc(found.title || found.name || 'Picture')}"><img src="${esc(assetUrl(p, found.path))}" alt="${esc(found.title || found.name || 'Picture')}" loading="lazy"></button>` : ''; };
  const content = s => {
    if (!s) return null;
    // Imported protocol messages may clean to nothing. An empty Work's generic "Done" fallback is not a result.
    const raw = isWork(s) ? s.out || s.why || s.now || (s.stopWhy ? stopWhyWords(s) : '') : s.kind === 'ask' && !String(s.text || '').trim() && !s.files?.length && !s.pictures?.length ? '' : stopWords(s);
    const words = plainOut(raw).replace(/\s+/g, ' ').trim(), picture = pic(s);
    const files = (s.files || []).filter(file => file.path && (!file.image || !picture)).map(file => file.image
      ? `<button type="button" class="file-ref" data-act="home-picture" data-path="${esc(file.path)}" data-line="${line}" data-step="${esc(s.id)}">${ic('image', 16)}<span>${esc(file.name || 'Picture')}</span></button>`
      : fileChip(file)).join('');
    const media = picture + (files ? `<span class="hd-files">${files}</span>` : '');
    return words || media ? { s, words:esc(words), media } : null;
  };
  // The most recent meaningful Ask is the context; a later hidden protocol envelope must not replace it with an empty shell.
  const latest = [...steps].reverse(), asked = latest.filter(s => s.kind === 'ask').map(content).find(Boolean) || latest.filter(isYours).map(content).find(Boolean);
  const work = content(latest.find(s => isWork(s) && s.state !== 'todo'));
  const meta = `${l.code && l.code !== l.slug ? `<span class="hl-code">${esc(l.code)}</span>` : ''}${f.at ? `<time class="hl-time" title="${esc(new Date(f.at).toLocaleString())}">${esc(shortWhen(f.at))}</time>` : ''}${l.branch ? branchChip(p, l) : ''}${l.diff && (l.diff.add || l.diff.del) ? `<span class="row-diff"><i>+${l.diff.add}</i> <u>−${l.diff.del}</u></span>` : ''}`;
  return `<div class="hl-detail" id="hd-${line}">
      ${asked ? `<div class="hd-ask${asked.s.kind === 'ask' ? '' : ' is-note'}${asked.s.unsent ? ' is-unsent' : ''}">${asked.media}${asked.words ? `<p>${asked.words}</p>` : ''}</div>` : ''}
      ${work ? `<div class="hd-result">${work.s.agent && work.s.agent !== 'you' ? av(work.s.agent, 22) : ''}${work.words ? `<p>${work.words}</p>` : ''}${work.media}</div>` : ''}
      <div class="hd-acts">${rowActions(p, l)}<button type="button" class="hd-open" data-act="open-line" data-line="${line}">Open line</button></div>
      ${meta ? `<div class="hd-meta">${meta}</div>` : ''}
    </div>`;
}
const dayStart = ms => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
// So a long project opens at once, the list starts with this many lines. A button under them shows the rest.
const ROWS_FIRST = 40;
// One family occupies one place in the day, even when it crosses the initial row limit.
// A family folds with the day's finished work only when every matching member can rest.
function homeDayParts(p, matches, { now, W, split, shownDone, opened, all, collapsedIds, rootOf }) {
  const sessions = homeSessions(matches, rootOf), parts = [];
  // A family can span branches or Topics. Give it an outer heading only when that heading
  // describes every matching Line, including when search only matched the children.
  const groupByTopic = p?.projectTopics !== false;
  const locationKey = l => l.branch && l.branch !== p.trunk ? 'branch:' + l.branch : (groupByTopic ? l.knowledgeTopic?.path || '' : '');
  const locationOf = root => {
    const { members } = sessions.get(root), first = members[0], key = locationKey(first);
    return members.every(l => locationKey(l) === key) ? first : null;
  };
  let placed = 0, foldedCount = 0, collapsedCount = 0;
  const lay = roots => {
    const days = new Map();
    let rows = 0;
    for (const root of roots) {
      const { members } = sessions.get(root), at = rowFacts(members[0]).at, key = at ? dayKeyOf(at) : '';
      if (!days.has(key)) days.set(key, { at, roots:[], lines:[] });
      const day = days.get(key);
      day.roots.push(root);
      day.lines.push(...members);
    }
    for (const [key, day] of days) {
      const take = [];
      let folded = 0;
      for (const root of day.roots) {
        const { members } = sessions.get(root);
        if (!shownDone && !opened?.has(key) && members.every(l => restsDone(p, l))) folded += members.length;
        else if (rows < all) { take.push(root); rows += members.length; placed += members.length; }
      }
      foldedCount += folded;
      if (!take.length && (!folded || rows >= all)) continue;
      const clock = dayClock(key, day.lines, now, W);
      parts.push({ head:key, clock, html:dayHeadHTML(key, day.at ? lineDayName(day.at) : '', day.lines.length, clock) });
      for (const g of branchGroups(p, take, locationOf)) {
        const head = g.branch || g.topic?.path;
        const count = g.lines.reduce((n, root) => n + sessions.get(root).members.length, 0);
        if (g.branch) parts.push({ bhead:g.branch, html:branchHeadHTML(p, g.branch, count) });
        else if (g.topic) parts.push({ bhead:g.topic.path, topic:true, html:topicHeadHTML(p, g.topic, count) });
        g.lines.forEach((root, i) => {
          const { members, children } = sessions.get(root), last = Boolean(head) && i === g.lines.length - 1;
          const collapsed = children.length > 0 && collapsedIds.has(root.id);
          const row = l => ({ l, day:key, clock, earlierDay:rowFacts(l).at && dayKeyOf(rowFacts(l).at) !== key });
          parts.push({ ...row(root), branch:head, last, context:!members.includes(root), children:children.length, collapsed });
          if (!children.length) return;
          parts.push({ subs:root, collapsed, branch:head, last });
          if (collapsed) collapsedCount += children.length;
          else for (const child of children) parts.push({ ...row(child), sub:root });
          parts.push({ bend:root.id });
        });
        if (head) parts.push({ bend:head });
      }
      if (folded) { parts.push({ fold:key, n:folded }); placed += folded; }
    }
  };
  const roots = [...sessions.keys()];
  lay(split ? roots.filter(l => !l.offMain) : roots);
  if (split) { parts.push({ off:true, html:offHeadHTML(p, rootOf) }); lay(roots.filter(l => l.offMain)); }
  return { parts, rest:matches.length - placed, foldedCount, collapsedCount };
}
const Pano = {
  el:null, sheet:null, rowsEl:null, tray:null, owner:null, sig:{}, order:null, known:{}, kept:{}, words:{}, topic:{}, opened:{}, whole:{}, dayOpen:{}, sessionFolds:{}, trackW:0, rowsW:0, sizes:null, tick:0, relay:0,
  mount(root) {
    this.owner = project()?.id;
    this.el = root; this.sheet = $('#panoSheet', root); this.rowsEl = $('#panoRows', root); this.tray = $('#planTray');
    this.sig = {}; this.order = null;
    const box = $('#homeFilter', root);
    box.value = this.words[this.owner] || '';
    // A finished line's row has only the first of its last words: the rest is read as soon as there is something to look for.
    const readWords = () => { const p = project(), id = p.id; if (lacks(p, { parts:['words'] })) readNeeds(p, { parts:['words'] }).then(() => { if (project()?.id === id && this.sheet?.isConnected) this.update(); }, () => { /* The next letter asks again. */ }); };
    box.addEventListener('focus', readWords);
    box.addEventListener('input', () => { this.words[project().id] = box.value; this.update(); if (box.value.trim()) readWords(); });
    // Escape clears it, and leaves it when it is already clear.
    box.addEventListener('keydown', e => { if (e.key !== 'Escape') return; e.stopPropagation(); if (box.value) { box.value = ''; this.words[project().id] = ''; this.update(); } else box.blur(); });
    // A day's head sticks just under the heading with the counts, however tall that is; the clocks are laid out for the track's real width.
    // Both are read only when a size changes, not while you scroll.
    this.sizes?.disconnect();
    const head = $('.pano-head', root);
    if (typeof ResizeObserver === 'function') {
      this.sizes = new ResizeObserver(() => {
        if (head?.isConnected) root.style.setProperty('--day-top', `${head.offsetHeight}px`);
        // A first width is taken before the page is painted. After that the page may still be settling (the column beside it fills in, a line flies in):
        // the marks keep their shares meanwhile, and they are laid out again once it has.
        clearTimeout(this.relay);
        if (!this.trackW) this.relayout(); else this.relay = setTimeout(() => this.relayout(), 300);
      });
      if (head) this.sizes.observe(head);
      this.sizes.observe(this.rowsEl);
    }
    this.update(true);
    this.clockTick();
  },
  // The width of a day's track, once the page has laid one out. Until then, what the columns in desk.css leave for it.
  trackWidth() {
    if (this.trackW) return this.trackW;
    const w = this.rowsEl?.clientWidth || 800;
    if (typeof matchMedia === 'function' && matchMedia('(max-width: 700px)').matches) return Math.max(160, w - 24);
    // By time the trunk's gutter (desk.css --g) stands left of the lanes.
    const inner = w - 14 - 34;
    return Math.max(120, Math.round(inner - Math.min(560, Math.max(240, inner * .43)) - 112 - 32));
  },
  relayout() {
    if (!this.rowsEl?.isConnected) return;
    if (S.flying) { this.relay = setTimeout(() => this.relayout(), 300); return; }
    if (this.measure()) this.update();
  },
  measure() {
    const clock = $('.hl-clock', this.rowsEl), w = clock ? Math.round((typeof pageRect === 'function' ? pageRect(clock) : clock.getBoundingClientRect()).width) : 0;
    // The list changed width with no clock to measure: the next clocks start from a guess again.
    if (!clock && this.rowsEl.clientWidth !== this.rowsW) this.trackW = 0;
    this.rowsW = this.rowsEl.clientWidth;
    if (!w || w === this.trackW) return false;
    this.trackW = w;
    return true;
  },
  // Today's clock ends at now: it moves on once a minute, and only while the Home is on screen.
  clockTick() {
    clearTimeout(this.tick);
    if (typeof EMBED !== 'undefined' && EMBED) return;
    this.tick = setTimeout(() => { if (!this.sheet?.isConnected) return; if (!document.hidden) this.update(); this.clockTick(); }, LANE_MIN - Date.now() % LANE_MIN + 250);
  },
  rowEl(id) { return $(`.hl-row[data-row="${CSS.escape(id)}"]`, this.rowsEl); },
  // One lane is open at a time.
  isOpen(p, l) { return this.opened[p.id] === l.id; },
  rowHTML(p, l, clock = null, layout = {}) {
    const open = this.isOpen(p, l), pinned = isPinned(p, l), line = esc(l.id), title = esc(l.title), words = rowFacts(l).words;
    const toggle = layout.children ? `<button type="button" class="hl-session-toggle" data-act="session-fold" data-line="${line}" aria-expanded="${!layout.collapsed}" aria-controls="subs-${line}" aria-label="${layout.collapsed ? 'Show' : 'Hide'} ${plural(layout.children, 'sub-session', 'sub-sessions')} for ${title}" title="${plural(layout.children, 'sub-session', 'sub-sessions')}">${ic(layout.collapsed ? 'right' : 'down', 12)}${ic('branch', 14)}${layout.children}</button>` : '';
    const root = layout.sub;
    const ownBranch = root && p.code && (Boolean(l.offMain) !== Boolean(root.offMain) || l.branch !== root.branch)
      ? (l.offMain ? 'Off main' : l.branch || p.trunk) : '';
    const preview = [ownBranch, words].filter(Boolean).map(esc).join(' · ');
    const name = `<button type="button" class="hl-main" data-act="open-line" data-line="${line}"><span class="hl-title" title="${title}">${layout.context ? '' : lineHintTag(p, l)}<span class="row-title-text">${title}</span></span></button>${toggle}`;
    if (layout.context) return `<div class="hl-lane"><div class="hl-name"><div class="hl-tline">${name}</div></div></div>`;
    // The whole lane opens its details; its title and its buttons stand above that and do their own thing.
    return `<div class="hl-lane"><button type="button" class="hl-hit" data-act="row-open" data-line="${line}" aria-expanded="${open}" aria-controls="hd-${line}" aria-label="${title}: last steps"></button>
      <div class="hl-name"><div class="hl-tline">${name}${lineHint(p, l) === 'unread' ? '<i class="hl-new" title="Unread" aria-label="Unread"></i>' : ''}<span class="hl-tools">${l.archived ? '' : `<button type="button" class="icon-btn hl-pin" data-act="line-pin" data-line="${line}" aria-pressed="${pinned}" aria-label="${pinned ? 'Unpin' : 'Pin'} ${title}" title="${pinned ? 'Unpin' : 'Pin'} this line">${ic('star', 15)}</button>`}<button type="button" class="icon-btn more-btn" data-act="line-menu" data-line="${line}" aria-label="More for ${title}">${ic('more', 17)}</button></span></div>${preview ? `<div class="hl-words">${preview}</div>` : ''}</div>
      ${layout.earlierDay ? `<time class="hl-session-date" title="${esc(new Date(rowFacts(l).at).toLocaleString())}">${esc(shortWhen(rowFacts(l).at))}</time>` : laneTrackHTML(p, l, clock)}
      <div class="hl-state">${laneStateHTML(p, l)}</div></div>
      ${open ? laneDetailHTML(p, l) : ''}`;
  },
  // Nothing is written unless it differs from what is shown: a lane whose line changed is written alone, and the whole list only when its lines,
  // their order or a day's clock changed (today's moves on once a minute).
  update(force) {
    const p = project();
    if (!this.sheet?.isConnected) return;
    this.keepNewInView(p);
    this.summary(p);
    const rootOf = sessionRootOf(p), split = Boolean(p.code && p.lines.some(l => rootOf(l).offMain));
    this.start(p, split, rootOf);
    const every = shownLines(p), q = (this.words[p.id] || '').trim(), picked = Boolean(topicFilter(p));
    this.rowsEl.classList.toggle('is-split', split);
    // By time, one clock for each day, newest first. Finished lines you have read fold under their day, unless finished is pressed,
    // you are looking for something, or you opened that day. The first lines only, until you ask for the rest.
    // Off main comes after the whole of main, with days and clocks of its own and the same number of first lines.
    const shownDone = q || picked || mapFilter(p) === 'done', opened = this.dayOpen[p.id], all = !q && !this.whole[p.id] ? ROWS_FIRST : Infinity;
    const filterKey = JSON.stringify([q, topicFilter(p), mapFilter(p)]);
    if (this.sessionFolds[p.id]?.filter !== filterKey) this.sessionFolds[p.id] = { filter:filterKey, ids:new Set() };
    const { parts, rest, foldedCount, collapsedCount } = homeDayParts(p, every, {
      now:Math.floor(Date.now() / LANE_MIN) * LANE_MIN, W:this.trackWidth(), split, shownDone, opened, all, rootOf, collapsedIds:this.sessionFolds[p.id].ids,
    });
    const lanes = parts.filter(x => x.l);
    const shown = lanes.filter(x => !x.context).length;
    this.results(p, every, shown, foldedCount, every.length - shown - foldedCount - collapsedCount, collapsedCount);
    const noneWords = q ? `Nothing matches “${q}”.` : picked ? 'No lines about this.' : mapFilter(p) ? 'None right now.' : 'No open lines.';
    const none = lanes.length || parts.some(x => x.fold) ? '' : noneWords;
    const order = (split ? 'split\n' : '') + parts.map(x => (x.l ? `r\t${x.l.id}\t${x.day}\t${x.branch || ''}\t${x.last ? 1 : 0}` : x.subs ? `s\t${x.subs.id}\t${x.subs.title}\t${x.collapsed}\t${x.last}` : x.head !== undefined ? `d\t${x.head}\t${x.html}` : x.off ? `o\t${x.html}` : x.bhead ? `b\t${x.bhead}\t${x.html}` : x.bend ? 'e' : `f\t${x.fold}\t${x.n}`)).join('\n') + none + rest;
    const cls = x => `hl-row m-${rowMark(p, x.l)}${lineHintClass(p, x.l)}${this.isOpen(p, x.l) ? ' is-open' : ''}${x.branch ? ' on-branch' : ''}${x.last ? ' is-last-b' : ''}${x.children ? ' hl-session-parent' : ''}${x.sub ? ' hl-sub-row' : ''}${x.context ? ' hl-session-context' : ''}`;
    const active = document.activeElement, held = this.rowsEl.contains(active) ? { row:active.closest('.hl-row')?.dataset.row, step:active.dataset.step, act:active.dataset.act } : null;
    const refocus = () => { const row = held?.row && this.rowEl(held.row); if (row && !row.contains(document.activeElement)) (held.step && $(`[data-act="${held.act}"][data-step="${CSS.escape(held.step)}"]`, row) || $(`[data-act="${held.act}"]`, row))?.focus(); };
    if (force || order !== this.order) {
      this.sig = {};
      // Each day is a section, so its head sticks only while its own lanes pass under it, and the next day's head pushes it away.
      // Split, main and Off main are each a card; one with nothing to show says so.
      let html = split ? '<div class="hl-card">' : '', inDay = false, filled = false;
      const endCard = () => { const end = `${inDay ? '</section>' : ''}${filled ? '' : `<p class="hl-none">${esc(noneWords)}</p>`}</div>`; inDay = false; filled = false; return end; };
      for (const x of parts) {
        if (x.off) { html += `${endCard()}<div class="hl-start hl-off-head">${x.html}</div><div class="hl-card hl-off">`; continue; }
        filled = true;
        if (x.head !== undefined) { html += `${inDay ? '</section>' : ''}<section class="hl-dayset" data-day="${esc(x.head)}"${dayGridStyle(x.clock)}>${x.html}`; inDay = true; continue; }
        if (x.fold) { html += `<div class="hl-folded" data-day="${esc(x.fold)}"><button type="button" class="hl-fold-day" data-act="day-open" data-day="${esc(x.fold)}">+ ${x.n} finished</button></div>`; continue; }
        if (x.bhead) { html += `<div class="hl-branch${x.topic ? ' is-topic' : ''}" data-branch="${esc(x.bhead)}">${x.html}`; continue; }
        if (x.subs) {
          html += `<div class="hl-sub-sessions${x.branch && !x.last ? ' branch-continues' : ''}" id="subs-${esc(x.subs.id)}" role="group" aria-label="Sub-sessions of ${esc(x.subs.title)}"${x.collapsed ? ' hidden' : ''}>`;
          continue;
        }
        if (x.bend) { html += '</div>'; continue; }
        const row = this.rowHTML(p, x.l, x.clock, x), c = cls(x); this.sig[x.l.id] = c + row;
        html += `<div class="${c}" data-row="${esc(x.l.id)}" data-day="${esc(x.day)}">${row}</div>`;
      }
      this.rowsEl.innerHTML = (split ? html + endCard() : html ? html + (inDay ? '</section>' : '') : `<p class="hl-none">${esc(none)}</p>`)
        + (rest ? `<div class="hl-foot"><button type="button" class="btn sm" data-act="rows-more">${rest} earlier ${rest === 1 ? 'line' : 'lines'}</button></div>` : '');
      this.order = order;
      // With no track measured yet, the width was guessed: once the page is laid out, and before it is painted, the size watcher measures it and draws again if it differs.
      if (!this.trackW && this.sizes) { this.sizes.unobserve(this.rowsEl); this.sizes.observe(this.rowsEl); }
      refocus();
    } else for (const x of lanes) {
      const { l, clock } = x, html = this.rowHTML(p, l, clock, x), c = cls(x);
      if (this.sig[l.id] === c + html) continue;
      const el = this.rowEl(l.id);
      el.innerHTML = html; el.className = c; this.sig[l.id] = c + html;
      if (held?.row === l.id) refocus();
    }
    // Agents at work can change which branch is the latest.
    const box = $(`.composer[data-comp="home-${p.id}"]`);
    if (box) renderPathPreview(box, comp(box.dataset.comp));
  },
  // Status counts are project totals. This nearby summary says what this view actually contains, including its rendering limit.
  results(p, lines, shown, folded, remaining, collapsed = 0) {
    const el = $('#panoResults', this.el); if (!el) return;
    const f = mapFilter(p), topic = (p.knowledge || []).find(t => t.path === topicFilter(p)), active = Boolean(f || topic || (this.words[p.id] || '').trim() || remaining);
    if (el.hidden === active) el.hidden = !active;
    if (!active) return;
    const label = { working:'Working', stopped:'Stopped', you:'Needs you', todo:'Todo', review:'To review', done:'Finished', unread:'Unread' }[f] || 'All';
    const count = lines.length - folded, words = !lines.length ? `${label} · No lines match these filters` : `${label} · ${shown < count ? `${shown} of ${plural(count, 'line', 'lines')} shown` : plural(count, 'line', 'lines')}${folded ? ` · ${folded} finished folded` : ''}${collapsed ? ` · ${plural(collapsed, 'sub-session', 'sub-sessions')} collapsed` : ''}`;
    const chip = topic ? `<span class="tp-filter">${ic('note', 13)}<span>${esc(topic.title)}</span><button type="button" data-act="topic-filter-clear" aria-label="Show all lines" title="Show all lines">${ic('x', 12)}</button></span>` : '';
    const html = `${chip}<span role="status" aria-live="polite">${esc(words)}</span> ${remaining > 0 ? `<button type="button" data-act="rows-more">Show all ${count}</button>` : ''}`;
    if (el.dataset.h !== html) { el.innerHTML = html; el.dataset.h = html; }
  },
  summary(p) {
    const w = working(p), stopped = p.lines.filter(l => lineState(l) === 'error').length, you = p.lines.filter(lineNeedsYou).length, todo = p.lines.filter(isTodo).length, review = p.lines.filter(toReview).length, done = p.lines.filter(l => MAP_FILTERS.done(p, l)).length, unread = p.lines.filter(l => lineHint(p, l) === 'unread').length, el = $('#panoSum', this.el); if (!el) return;
    // The one you pressed stays shown at 0, so it can be pressed again.
    const f = mapFilter(p), filter = (key, n, cls, words, on = f === key) => (n || on ? `<button type="button" class="sum-f ${cls}" data-act="map-filter" data-f="${key}" aria-pressed="${on}">${words}</button>` : '');
    const html = `${filter('', 1, 'sum-all', 'All')}${filter('working', w, 'sum-work', `<i class="spin"></i>${w} working`)}${filter('stopped', stopped, 'sum-stop', `${ic('x', 14)}${stopped} stopped`)}${filter('you', you, 'sum-you', `<b class="dot-b" aria-hidden="true">!</b>${you} need you`)}${filter('todo', todo, 'sum-todo', `${ic('box', 14)}${todo} todo`)}${filter('review', review, 'sum-review', `${ic('eye', 14)}${review} to review`)}${filter('done', done, 'sum-done', `${ic('check', 14)}${done} finished`)}${filter('unread', unread, 'sum-unread', `<i aria-hidden="true"></i>${unread} unread`)}`;
    if (el.dataset.h === html) return;
    const held = el.contains(document.activeElement) ? document.activeElement.dataset : null;
    el.innerHTML = el.dataset.h = html;
    if (held?.f !== undefined) $(`[data-f="${held.f}"]`, el)?.focus();
  },
  // The head of the trunk: the branch the code is on, or the project's name; how many lines are open; and the ways to begin one.
  start(p, split, rootOf) {
    const el = $('#panoStart', this.el); if (!el) return;
    // Off main lines are counted under Off main.
    const open = p.lines.filter(l => !(split && rootOf(l).offMain) && !MAP_FILTERS.done(p, l)).length;
    const html = `<span class="trunk-label">${p.code && p.git !== false ? `${ic('branch', 14)}${esc(p.trunk)}` : esc(p.name)}</span><span class="hl-count">${open} ${open === 1 ? 'line' : 'lines'} open</span>${newLineOn(p, p.trunk)}${drawLineOn(p, p.trunk)}${syncOn(p)}${trackHTML(p)}`;
    if (el.dataset.h !== html) el.innerHTML = el.dataset.h = html;
  },
  // Keep track of new lines without bypassing the selected status predicate in shownLines.
  keepNewInView(p) {
    const f = mapFilter(p), known = this.known[p.id];
    if (f && known) for (const l of p.lines) if (!known.has(l.id)) (this.kept[p.id] ||= new Set()).add(l.id);
    this.known[p.id] = new Set(p.lines.map(l => l.id));
  },
  // Each planned merge starts a line whose Ask says how to merge, and the agent merges. PenEcho never merges. The first refusal stops the rest and says why, and what is left stays planned.
  async runPlan() {
    const p = project(), trunk = p.trunk;
    const plan = [...S.plan].sort((a, b) => (a.to === trunk) - (b.to === trunk));
    S.plan = []; renderTray();
    const made = [];
    for (const it of plan) {
      try {
        const { slug, step } = await act(lineById(project(), it.from), 'merge', { to:it.to === trunk ? null : it.to, scope:'branch' });
        made.push({ slug, step, into:arrowGoal(p, it) });
      } catch (error) {
        S.plan = plan.slice(plan.indexOf(it));
        toast(error.message);
        await loadState(p.id, { force:true });
        this.update(); renderTray(); refreshChrome();
        return;
      }
      this.update();
    }
    // One merge opens its new line at once. Several stay on the home, each a line of its own, with a way to open each.
    if (made.length === 1) { const [m] = made; go({ view:'line', line:m.slug }); if (m.step) setTimeout(() => scrollToItem(m.step), 400); return; }
    S.next = { made };
    renderTray();
    refreshChrome(); refreshBelow(); refreshDesk();
  },
};
function nodeIcon(s, isPort) {
  if (s.isTodo) return ic('box', 12);
  if (s.toReview) return ic('eye', 12);
  if (isPort) return ic('check', 14);
  if (s.state === 'wait' && (s.finished || s.kind === 'merge')) return ic('check', 12);
  if (s.state === 'done') return ic('check', 11);
  if (s.state === 'wait') return '<b>!</b>';
  if (s.state === 'error') return ic('x', 12);
  if (s.state === 'active') return '<i class="spin"></i>';
  if (s.state === 'off') return ic('minus', 11);
  return '';
}
// All statuses take turns, including Finished. Pressing All or the selected status returns to All.
ACT['map-filter'] = el => {
  const p = project(), key = el.dataset.f;
  setHomeChoice(p, { f:mapFilter(p) === key ? '' : key });
  delete Pano.kept[p.id];
  Pano.update();
};
// Return the Home's filters and expanded views to their default state for the current project.
function resetHomeFilters(p = project()) {
  if (!p) return;
  setHomeChoice(p, { f:'' });
  for (const store of [Pano.kept, Pano.words, Pano.whole, Pano.dayOpen, Pano.sessionFolds, Pano.opened, Pano.topic]) delete store[p.id];
  const box = $('#homeFilter', Pano.el || document);
  if (box) box.value = '';
  if (typeof homeTop === 'object' && homeTop) homeTop[p.id] = 0;
  const view = $('#view');
  if (view) view.scrollTop = 0;
  Pano.update();
  if (typeof refreshDesk === 'function') refreshDesk();
}
ACT['session-fold'] = el => {
  const { ids } = Pano.sessionFolds[project().id], id = el.dataset.line;
  if (ids.has(id)) ids.delete(id); else ids.add(id);
  Pano.update();
};
ACT['rows-more'] = () => { const p = project(); Pano.whole[p.id] = true; Pano.update(); };
// A lane opens its details under it, and closes the same way. One is open at a time.
// What it says is read as it opens, when it is not read yet, and stays read while it is open.
ACT['row-open'] = el => {
  const p = project(), id = el.dataset.line, open = Pano.opened[p.id] = Pano.opened[p.id] === id ? '' : id;
  if (open) keepWants(p.id, { lines:[open] });
  const show = () => { if (project()?.id === p.id && S.route.view === 'home') Pano.update(); };
  if (!open || !lineById(p, open)?.light) return show();
  const hold = setTimeout(show, HOLD_MS);
  readLines(p, [open]).then(() => { clearTimeout(hold); if (Pano.opened[p.id] === open) show(); }, error => { clearTimeout(hold); show(); toast(error.message); });
};
// Mark reviewed ticks every finished Work on the line (line.js all-reviewed). The lane follows at once, and again once it is saved.
ACT['lane-reviewed'] = async el => { const saved = ACT['all-reviewed'](el); Pano.update(); await saved; Pano.update(); };
function stateChip(state, l) {
  if (state === 'notes') return '';
  // Outdated (PE-425): in the Archive, and greyed, as what it says no longer holds.
  if (l?.outdated) return '<span class="chip c-outdated">Outdated</span>';
  if (l && lineNeedsYou(l)) state = 'wait';
  else if (l && isTodo(l)) state = 'todo';
  else if (l && toReview(l)) state = 'review';
  else if (l && (typeof isReviewPending === 'function' ? isReviewPending(l) : typeof LINE_STATUS !== 'undefined' && Boolean(LINE_STATUS.isReviewPending?.(l)))) state = 'working';
  const icon = { working: '<i class="spin"></i>', wait: '<b class="dot-b">!</b>', ready: ic('check', 14), todo: ic('box', 14), review: ic('eye', 14), error: ic('x', 14) }[state] || '';
  // Landed is the folder's word. On the page it says what happened.
  const text = (state === 'landed' || state === 'ready') && l ? (l.closed || l.archived ? STATE_TEXT.archived : lineReviewed(l) ? STATE_TEXT.reviewed : STATE_TEXT.ready) : STATE_TEXT[state];
  return `<span class="chip c-${state}">${icon}${esc(text)}</span>`;
}
// Next actions under an opened lane. Keep Todo beside review; Archive is in the menu.
function rowActions(p, l) {
  const state = lineState(l), mark = rowMark(p, l), cur = currentStation(l), line = esc(l.id);
  const verb = (v, icon, words) => `<button type="button" class="btn sm" data-act="line-do" data-verb="${v}" data-line="${line}">${ic(icon, 14)}${words}</button>`;
  if (mark === 'you') {
    const canChooseLocal = Boolean(l && !l.closed && !l.archived && !l.elsewhere && !(typeof HOSTED !== 'undefined' && HOSTED?.read));
    const localWork = l.stations?.find(s => isWork(s) && ((s.asking?.kind === 'tool' && s.asking.answerable && s.asking.isBlocking !== false) || (canChooseLocal && s.questions?.length)))
      || (canChooseLocal ? l.stations?.find(s => isWork(s) && s.waitingReply) : null);
    const replyBtn = localWork
      ? `<button type="button" class="btn sm primary" data-act="need-reply" data-line="${line}" data-step="${esc(localWork.id)}">Answer</button>`
      : l.asking ? answerAct(l)
        : canChooseLocal && openQuestions(l).length ? `<button type="button" class="btn sm primary" data-act="need-reply" data-line="${line}">Answer</button>`
          : cur.id ? `<button type="button" class="btn sm primary" data-act="open-step" data-line="${line}" data-step="${esc(cur.id)}">Review</button>` : '';
    return `${replyBtn}${endStoppedButton(p, l)}`;
  }
  if (mark === 'unsent') return laneSendHTML(p, l, l.stations.find(s => s.unsent)) + endStoppedButton(p, l);
  if (mark === 'run') return l.elsewhere || !canStop(l) ? '' : verb('stop', 'stop', 'Stop');
  if (mark === 'bad') return lineWorking(l) ? '' : lineContinue(l) + verb('retry', 'retry', 'Retry') + endStoppedButton(p, l);
  const review = todoMark(l, p) + (!lineWorking(l) && (mark === 'review' || (mark === 'todo' && nextToReview(l)) || canMarkReviewed(l)) ? `<button type="button" class="hd-go" data-act="lane-reviewed" data-line="${line}"${S.lineMarkSaving?.has(`${p.id}:${l.id}`) ? ' disabled aria-busy="true"' : ''}><i aria-hidden="true"></i>Mark reviewed</button>` : '');
  if (state !== 'ready' || !canMerge(p, l)) return review;
  // A merge takes the whole branch, so every line on it says so, and none offers a second one.
  const planned = S.plan.find(x => lineById(p, x.from)?.branch === l.branch);
  return review + (planned ? `<button type="button" class="btn sm in-plan row-merge" data-act="plan-remove" data-line="${esc(planned.from)}">In plan ${ic('x', 13)}</button>`
    : `<button type="button" class="btn sm row-merge" data-act="merge-line" data-line="${line}" title="Merge ${esc(l.branch)} into ${esc(mergeTarget(p, l).name)}" aria-label="Merge ${esc(l.branch)} into ${esc(mergeTarget(p, l).name)}">${ic('merge', 14)}Merge</button>`);
}
// Send for an Ask not sent runs it as Run with does on the line's page; with no agent here, it opens that Ask.
function laneSendHTML(p, l, s) {
  if (!s) return '';
  return unsentSendHTML(p, l, s, 'Send');
}
// Where a planned merge goes, in the words of the branch it goes to.
function arrowGoal(p, it) {
  if (it.to === p.trunk) return lineById(p, it.from)?.base || p.trunk;
  const to = lineById(p, it.to);
  return to?.branch || to?.title || it.to;
}
function renderTray() {
  const tray = $('#planTray'); if (!tray) return;
  const p = project();
  if (S.plan.length) {
    tray.hidden = false; tray.className = 'plan-tray';
    const goals = [...new Set(S.plan.map(it => arrowGoal(p, it)))];
    const toTrunk = [...new Map(S.plan.filter(it => it.to === p.trunk).map(it => lineById(p, it.from)).filter(l => l?.branch).map(l => [l.branch, l])).values()];
    tray.innerHTML = `<div class="tray-list">${S.plan.map(it => `<div class="tray-item"><strong>${esc(lineById(p, it.from).title)}</strong>${ic('right', 15)}<span>${esc(arrowGoal(p, it))}</span><button type="button" class="icon-btn tiny" data-act="plan-remove" data-line="${it.from}" aria-label="Remove from plan">${ic('x', 14)}</button></div>`).join('')}</div>${toTrunk.map(l => mergeOutcomeHTML(p, l)).join('')}
      <div class="tray-foot"><button type="button" class="btn" data-act="plan-clear">Clear</button>
      <button type="button" class="btn primary" data-act="plan-run" id="planRun">${ic('merge', 16)}Merge ${S.plan.length} ${S.plan.length === 1 ? 'Topic' : 'Topics'}${goals.length === 1 ? ` into ${esc(goals[0])}` : ''}</button></div>`;
    return;
  }
  if (S.next) {
    tray.hidden = false; tray.className = 'plan-tray next';
    tray.innerHTML = `<div class="next-text"><span class="next-ok">${ic('check', 16)}</span><div><strong>Started ${S.next.made.length} lines to merge</strong></div></div>
      <div class="tray-list">${S.next.made.map(m => { const l = lineById(p, m.slug); return `<div class="tray-item"><strong>${esc(l?.title || m.slug)}</strong><button type="button" class="btn sm" data-act="next-open" data-line="${esc(m.slug)}" data-step="${esc(m.step || '')}">Open</button></div>`; }).join('')}</div>
      <div class="tray-foot"><button type="button" class="icon-btn" data-act="next-close" aria-label="Close">${ic('x', 16)}</button></div>`;
    return;
  }
  tray.hidden = true; tray.innerHTML = '';
}
// A project, small, for the switcher: main down the side and the latest lines off it.
const MINI_END = { wait:'var(--amber-mark)', error:'var(--red)', active:'var(--c-run)' };
function miniMap(p) {
  const W = 420, rows = (p.lines || []).slice(0, 5), gap = 25, top = 6, mainX = 10, H = top + 14 + Math.max(rows.length, 1) * gap;
  let s = `<path d="M${mainX},${top}L${mainX},${H - 6}" stroke="var(--l-main)" stroke-width="3" stroke-linecap="round"/>`;
  rows.forEach((l, i) => {
    const y = top + 18 + i * gap, x0 = mainX + 26, n = l.stations.length, sp = Math.min(44, (W - x0 - 14) / Math.max(1, n - 1)), cur = Math.max(0, l.stations.indexOf(currentStation(l)));
    s += `<path d="M${mainX},${y - 8}Q${mainX},${y} ${mainX + 8},${y}L${x0 + cur * sp},${y}" fill="none" stroke="var(--l-line)" stroke-width="2" stroke-linecap="round"/>`;
    if (cur < n - 1) s += `<path d="M${x0 + cur * sp},${y}L${x0 + (n - 1) * sp},${y}" stroke="var(--l-todo)" stroke-width="2" stroke-dasharray="1 6" stroke-linecap="round"/>`;
    l.stations.forEach((st, j) => {
      const todo = st.state === 'todo', ask = st.kind === 'ask', end = isEnd(st), fill = todo ? 'var(--paper)' : ask ? 'var(--c-ask-fill)' : MINI_END[st.state] && !end ? MINI_END[st.state] : end ? 'var(--c-end)' : 'var(--c-work)', ring = todo ? 'var(--l-todo)' : ask ? 'var(--c-ask)' : fill;
      s += `<circle cx="${x0 + j * sp}" cy="${y}" r="${j === cur ? 4.500 : 3}" fill="${fill}" stroke="${ring}" stroke-width="1.500"/>`;
    });
  });
  return `<svg viewBox="0 0 ${W} ${H}" class="mini-map" aria-hidden="true">${s}</svg>`;
}
// Archive for a whole branch takes every line on it and on the branches off it, whatever the filters show, with one Undo for them all.
// The trunk is the whole project, every line on every branch: that is not one branch's tidy-up.
function branchLines(p, name) {
  const find = n => (n.name === name ? n : n.kids.map(find).find(Boolean)), node = find(mapTree(p));
  return node && !node.isMain ? linesUnder(node).filter(l => !l.archived) : [];
}
// It sits beside New line on the branch's head, hidden like it until the head is hovered, and asks once more before anything goes.
function archiveBranchOn(p, name) {
  if (!name || name === p.trunk) return '';
  const lines = branchLines(p, name), n = lines.length; if (!n) return '';
  if (S.archiveAsk !== `${p.id}\t${name}`) return `<button type="button" class="new-line-on bh-archive" data-act="archive-branch-ask" data-branch="${esc(name)}" aria-label="Archive all on ${esc(name)}" title="Archive all on ${esc(name)}">${ic('archive', 13)}Archive all</button>`;
  const extra = archiveScope(p, lines).moving.length - n;
  return `<span class="bh-ask"><span>Archive ${esc(plural(n, 'line', 'lines'))} on <b>${esc(name)}</b>${extra ? ` and ${extra} ${extra === 1 ? 'sub-session' : 'sub-sessions'} elsewhere` : ''}?</span><button type="button" class="track-yes" data-act="archive-branch" data-branch="${esc(name)}">Archive all</button><button type="button" class="new-line-on" data-act="archive-branch-no">Cancel</button></span>`;
}
ACT['archive-branch-ask'] = el => { S.archiveAsk = `${project().id}\t${el.dataset.branch}`; Pano.update(true); $(`.bh-ask [data-act="archive-branch-no"]`)?.focus(); };
ACT['archive-branch-no'] = () => { S.archiveAsk = null; Pano.update(true); };
ACT['archive-branch'] = async el => {
  const p = project(), name = el.dataset.branch, lines = branchLines(p, name);
  S.archiveAsk = null; Pano.update(true);
  if (!lines.length) return;
  const { roots, moving } = archiveScope(p, lines);
  const answer = await archiveWarning(p, moving, el);
  if (answer?.choice === 'merge') { openMergeFor(answer.line, answer.step); return; }
  if (answer?.choice !== 'archive') return;
  const settle = async (verb, list) => {
    const done = [];
    for (const entry of list) {
      const { line, children, result } = entry;
      const body = verb === 'close' && line.orchestratorRef ? { expectedChildren:children.map(child => child.id) }
        : verb === 'reopen' && result?.archiveOperation ? { archiveOperation:result.archiveOperation } : {};
      try {
        const receipt = await api(`${pathFor(p.id)}/topics/${encodeURIComponent(line.slug)}/${verb}`, { method:'POST', body });
        done.push({ ...entry, result:receipt });
      } catch (error) { toast(error.message); break; }
    }
    await loadState(p.id, { force:true });
    return done;
  };
  el.disabled = true;
  const done = await settle('close', roots);
  el.disabled = false;
  const archived = new Set(done.flatMap(({ line, result }) => result?.archivedLines || [line.id]));
  S.plan = S.plan.filter(x => !archived.has(x.from));
  if (done.length) toast(`Archived ${name}${archived.size > 1 ? ` and its ${archived.size} lines` : ''}.`, { label:'Undo', fn:() => settle('reopen', done).then(refreshAfterChange) });
  refreshAfterChange();
};
// Merge puts the line's branch in the plan under the list. Nothing merges until you press Merge there.
ACT['merge-line'] = el => {
  const p = project(), line = el.dataset.line, to = mergeTarget(p, lineById(p, line)).to || p.trunk;
  S.plan = S.plan.filter(x => x.from !== line); S.plan.push({ from:line, to });
  Pano.update(); renderTray();
};
ACT['plan-remove'] = el => { S.plan = S.plan.filter(x => x.from !== el.dataset.line); Pano.update(); renderTray(); };
ACT['plan-clear'] = () => { S.plan = []; Pano.update(); renderTray(); };
ACT['plan-run'] = () => Pano.runPlan();
ACT['next-close'] = () => { S.next = null; renderTray(); };
ACT['next-open'] = el => { const { line, step } = el.dataset; S.next = null; go({ view:'line', line }); if (step) setTimeout(() => scrollToItem(step), 400); };
