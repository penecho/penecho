// Project-level pages, navigation and the project switcher.
const glyph = (p, size = 22) => `<span class="pglyph" style="--g:${esc(p.color)};--s:${size}px">${esc(p.name[0] || '?')}</span>`;
const brandMark = () => `<img src="penecho-favicon.png" width="26" height="26" alt="">`;
// Projects sit down the left, so moving between them is one click.
function chromeHTML() {
  return `<aside class="rail" id="rail" aria-label="Projects">
      <div class="rail-top">
        <span class="brand">${brandMark()}<span>PenEcho <span class="brand-lines">Lines</span></span><span class="brand-release">rc1</span></span>
        ${projectsToggleHTML(true)}
      </div>
      <div id="railMine"></div>
      <nav class="rail-list" id="railList" aria-label="Projects"></nav>
      <div id="railUpdate"></div>
      <div class="rail-foot" id="railAccount"></div>
    </aside>
    <div class="shell"><div class="projbar" id="projbar"></div><main id="view" tabindex="-1"></main><section id="canvasStage" class="canvas-stage" hidden aria-label="Canvas"></section></div>`;
}
function tabStatus(s) {
  // The project on screen is always current. Others catch up with the slower list.
  const live = s.id === S.cur ? project() : null, n = live ? needsYou(live) : summaryNeeds(s), w = live ? working(live) : summaryWorking(s);
  if (n) return `<span class="tab-badge" aria-label="${n} need you">${n}</span>`;
  if (w) return `<i class="spin" aria-label="working"></i>`;
  return '';
}
const summaryOf = id => S.projects.find(x => x.id === id);
// Favourites have their own group; both groups keep their saved order from the first render.
function railGroups() {
  // My Canvases has its own place above the list. All other projects stay reachable by scrolling.
  const live = S.projects.filter(p => !p.archived && !p.myCanvases);
  return { pinned:railProjectOrder('pinned', live.filter(p => p.pinned)), recent:railProjectOrder('recent', live.filter(p => !p.pinned)) };
}
const railOrder = () => { const g = railGroups(); return [...g.pinned, ...g.recent]; };
// Under every project: newest creation first, with browser-local positions for rows the person moves.
const RAIL_LINES = 5;
const RAIL_MORE_PREFIX = 'penecho-rail-more-v1:';
const RAIL_SUBS_KEY = 'penecho-rail-subs-open-v1';
const railLineModes = new Map();
let railSubsOpen = readLists(RAIL_SUBS_KEY);
function railLineMode(id) {
  if (!railLineModes.has(id)) {
    let saved;
    try { saved = localStorage.getItem(RAIL_MORE_PREFIX + id); } catch { /* Use the default for this visit. */ }
    railLineModes.set(id, saved === 'all' || saved === 'few' ? saved : null);
  }
  return railLineModes.get(id);
}
addEventListener('storage', e => {
  if (e.key === null) railLineModes.clear();
  else if (e.key.startsWith(RAIL_MORE_PREFIX)) railLineModes.delete(e.key.slice(RAIL_MORE_PREFIX.length));
  else if (e.key !== RAIL_SUBS_KEY) return;
  if (e.key === null || e.key === RAIL_SUBS_KEY) railSubsOpen = readLists(RAIL_SUBS_KEY);
  renderRail();
});
const railLineKey = (pid, id) => JSON.stringify([pid, id]);
function railLineOrder(a, b) {
  return b.at - a.at || a.rank - b.rank || b.serial - a.serial || a.key.localeCompare(b.key);
}
const RAIL_NOT_WORK = new Set(['note', 'canvas', 'meeting', 'merge', 'deliver']);
function railIsOpen(p) {
  if (Object.hasOwn(railChoice, p.id)) return Boolean(railChoice[p.id]);
  // Choosing a list length keeps its folder open even when other projects become more recent.
  if (p.id === S.cur || railLineMode(p.id) !== null) return true;
  return S.projects.filter(x => !x.archived && !x.myCanvases).sort((a, b) => (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0)).slice(0, 3).some(x => x.id === p.id);
}
function railLineHidden(l, state, deletedIds) {
  if (!l || l.archived || l.closed || l.deleted || l.deletedAt) return true;
  if (l.status === 'closed' || l.status === 'landed' || state === 'closed') return true;
  if (deletedIds && (deletedIds.has(l.id) || (l.slug && deletedIds.has(l.slug)))) return true;
  if (l.running || l.asking || (Array.isArray(l.questions) ? l.questions.length : l.questions)) return false;
  if (state !== 'ready' && state !== 'landed') return false;
  if (l.unsent || (Array.isArray(l.stations) && l.stations.some(s => s.unsent))) return false;
  return !Array.isArray(l.stations) || !l.stations.length || l.stations.some(s => !RAIL_NOT_WORK.has(s.kind));
}
// One line as the sidebar shows it. The project on screen is read from its page; the others from the list the server sends every few seconds.
function railFacts(p, live, l, pins, told, deletedIds) {
  const state = live ? shownState(l) : l.shown || 'working';
  if (railLineHidden(l, state, deletedIds)) return null;
  const need = live ? Boolean(l.asking || needsLook(live, l)) : Boolean(l.asking || l.unsent || l.questions || state === 'wait' || state === 'error');
  const unread = live ? lineUnread(live, l) : !told && l.readRevision && lineReads[`${p.id}:${l.id}`] !== l.readRevision;
  const key = railLineKey(p.id, l.id), position = railLinePositions[key];
  // Older servers supplied only a start label on the page and an activity date in project summaries.
  const createdAt = l.createdAt || Date.parse(l.started || '') || l.at || 0;
  const canReviewLine = live
    ? (typeof canMarkReviewed === 'function' ? canMarkReviewed(l) : !l.running && (state === 'review' || state === 'todo' || state === 'error'))
    : !l.running && (typeof l.canReviewLine === 'boolean' ? l.canReviewLine : (state === 'review' || state === 'todo' || state === 'error' || state === 'wait'));
  return { id:l.id, pid:p.id, key, title:l.title, at:position?.at ?? createdAt, rank:position?.rank || 0, serial:Number(/-(\d+)$/.exec(l.code || '')?.[1]) || 0,
    state, need, running:Boolean(l.running), bad:state === 'error', canReviewLine, unread:unread && (need || state === 'working' || state === 'review'), pinned:live ? pins.has(l.id) : Boolean(l.pinned),
    orchestratorRef:l.orchestratorRef, orchestratedBy:l.orchestratedBy,
    // needsLook also flags stopped work. A family gives that its own priority below actual replies.
    needsReply:state === 'wait' || Boolean(l.asking || (Array.isArray(l.questions) ? l.questions.length : l.questions)) || (state !== 'error' && need) };
}
const RAIL_FAMILY_STATUS = ['need', 'bad', 'work', 'review', 'unread'];
const railFamilyStatus = f => f.needsReply ? 'need' : f.bad ? 'bad' : f.running || f.state === 'working' ? 'work' : f.state === 'review' ? 'review' : f.unread ? 'unread' : '';
function railFamilies(all, byId, source, here, ambiguousRefs) {
  // Index even the ineligible parents. Two different Lines claiming a ref make it ambiguous.
  const refs = new Map();
  if (Array.isArray(ambiguousRefs)) for (const ref of ambiguousRefs) if (ref) refs.set(ref, null);
  for (const l of source) {
    if (!l?.orchestratorRef) continue;
    const prior = refs.get(l.orchestratorRef);
    if (prior === undefined) refs.set(l.orchestratorRef, l.id);
    else if (prior !== l.id) refs.set(l.orchestratorRef, null);
  }
  for (const l of source) {
    if (!l?.orchestratedBy) continue;
    const parentId = refs.get(l.orchestratedBy), parent = byId.get(parentId);
    if (parent && parentId !== l.id) parent.hasSubLines = true;
  }
  for (const f of all) {
    f.children = [];
    if (!f.orchestratedBy) continue;
    const parentId = refs.get(f.orchestratedBy);
    f.parent = byId.get(parentId);
    if (!f.parent) {
      f.orphan = parentId === null ? 'ambiguous parent ref'
        : parentId === undefined ? 'parent not in this project' : 'archived, reviewed or deleted parent not listed';
    }
  }
  // Follow each parent link once. Remove every edge in a cycle, including self-links.
  const seen = new Set();
  for (const f of all) {
    const path = new Set();
    let node = f;
    while (node && !seen.has(node)) {
      path.add(node);
      seen.add(node);
      node = node.parent;
    }
    if (!path.has(node)) continue;
    const start = node;
    do {
      const parent = node.parent;
      node.parent = null;
      node.orphan = 'cyclic parent ref';
      node = parent;
    } while (node !== start);
  }
  for (const f of all) f.parent?.children.push(f);
  const walk = all.filter(f => !f.parent);
  for (const f of walk) {
    f.inPins = f.pinned || Boolean(f.parent?.inPins);
    f.children = f.children.filter(child => {
      walk.push(child);
      if (!child.pinned || f.inPins) return true;
      child.parent = null;
      child.orphan = `pinned separately from ${f.title}`;
      return false;
    });
  }
  // Reduce from the leaves so each parent reads only its own direct children.
  for (let i = walk.length - 1; i >= 0; i--) {
    const f = walk[i], own = railFamilyStatus(f), totals = f.totals = {};
    if (own) totals[own] = 1;
    let selectedChild = false;
    for (const child of f.children) {
      selectedChild ||= child.selected;
      for (const status of RAIL_FAMILY_STATUS) if (child.totals[status]) totals[status] = (totals[status] || 0) + child.totals[status];
    }
    f.selected = selectedChild || f.id === here;
    const saved = railSubsOpen[f.key];
    f.forcedOpen = selectedChild;
    f.savedOpen = saved;
    f.open = selectedChild || (typeof saved === 'boolean' ? saved : f.selected || Boolean(totals.need || totals.bad || totals.work));
  }
  return all.filter(f => !f.parent);
}
function railPick(p) {
  const live = p.id === S.cur && !S.newPage && !S.shelfPage ? project() : null;
  const data = live || p, pins = live && new Set(linePins(live));
  const source = [...(data.lines || []), ...(data.backlog || [])];
  // adoptState can replace a background summary with its own compact rows. The two
  // lifecycle fields identify those rows, so a newer server summary always takes precedence.
  const first = !HOSTED && !live && source.find(Boolean);
  const cached = !HOSTED && !live && first && Object.hasOwn(first, 'closed') && Object.hasOwn(first, 'archived') ? project(p.id) : null;
  const context = cached ? [...cached.lines, ...cached.backlog, ...cached.landed] : null;
  const cachedRefs = cached && new Map(context.map(l => [l.id, l]));
  const deleted = (live || cached)?.deleted?.lines;
  const deletedIds = deleted?.length ? new Set(deleted.flatMap(d => [d?.id, d?.slug].filter(Boolean))) : null;
  const told = !live && Boolean(p.example) && !Object.keys(lineReads).some(k => k.startsWith(`${p.id}:`));
  const canvasShell = typeof window !== 'undefined' && window.PenEchoCanvasShell?.active ? window.PenEchoCanvasShell : null;
  const here = canvasShell ? (p.id === canvasShell.activeProject ? canvasShell.activeLine : '') : (p.id === S.cur ? (S.route.view === 'line' ? S.route.line : EMBED?.rail && S.cur === EMBED.project ? EMBED.line : '') : '');
  const byId = new Map();
  for (const l of source) {
    if (!l?.id || byId.has(l.id)) continue;
    const f = railFacts(p, live, l, pins, told, deletedIds);
    if (!f) continue;
    const related = cachedRefs && cachedRefs.get(l.id);
    if (related) {
      f.orchestratorRef = related.orchestratorRef;
      f.orchestratedBy = related.orchestratedBy;
    }
    byId.set(l.id, f);
  }
  const all = [...byId.values()].sort(railLineOrder);
  const roots = !HOSTED && all.some(f => f.orchestratorRef || f.orchestratedBy) ? railFamilies(all, byId, context || [...source, ...(data.landed || [])], here, data.ambiguousOrchestratorRefs) : all;
  const pinned = [], rest = [];
  for (const f of roots) (f.pinned ? pinned : rest).push(f);
  return { pinned, rest, shown:railLineMode(p.id) === 'all' ? rest : rest.filter((f, i) => i < RAIL_LINES || f.selected || f.id === here), here, byId };
}
// Give only the moved row a position when there's room between its neighbours' ranks.
// Older rows can have exactly the same date and rank. Space out those ties within this scope.
function moveRailLine(rows, key, target, after) {
  const from = rows.findIndex(f => f.key === key), to = rows.findIndex(f => f.key === target);
  if (from < 0 || to < 0 || from === to || from === to + (after ? 1 : -1)) return false;
  const at = rows[to].at, tied = rows.filter(f => f.key !== key && f.at === at);
  const slot = tied.indexOf(rows[to]) + Number(after);
  const before = tied[slot - 1]?.rank, next = tied[slot]?.rank;
  const rank = before === undefined ? next - 1 : next === undefined ? before + 1 : before + (next - before) / 2;
  railLinePositions = { ...railLinePositions, ...readLists(LINE_ORDER_KEY) };
  if ((before === undefined || rank > before) && (next === undefined || rank < next)) railLinePositions[key] = { at, rank };
  else {
    tied.splice(slot, 0, rows[from]);
    tied.forEach((f, i) => { railLinePositions[f.key] = { at, rank:i + 1 }; });
  }
  writeLists(LINE_ORDER_KEY, railLinePositions);
  return true;
}
// One sign for each line: at work, waiting for you, stopped, or new to you.
const railSign = f => (f.state === 'working' ? '<i class="spin" aria-hidden="true"></i>' : f.bad ? '<i class="rail-sign s-bad" aria-hidden="true"></i>' : f.need ? '<i class="rail-sign s-need" aria-hidden="true"></i>' : f.unread ? '<i class="rail-sign s-new" aria-hidden="true"></i>' : '');
const RAIL_FAMILY_WORDS = { need:'awaiting reply', bad:'stopped', work:'working', review:'to review', unread:'unread' };
function railRow(p, f, group, here, depth = 0) {
  const on = !S.railTo && p.id === S.cur && f.id === here, status = STATE_TEXT[f.state] || '';
  const count = f.children?.length || 0, collapsed = count && !f.open;
  const subLabel = `${count} sub-Line${count === 1 ? '' : 's'}`;
  const marks = collapsed ? RAIL_FAMILY_STATUS.filter(status => f.totals[status]) : [];
  const rollup = [subLabel, ...marks.map(status => `${f.totals[status]} ${RAIL_FAMILY_WORDS[status]}`)].join(', ');
  const mark = marks[0], sign = collapsed ? railSign({ state:mark === 'work' ? 'working' : '', bad:mark === 'bad', need:mark === 'need', unread:mark === 'review' || mark === 'unread' }) : railSign(f);
  const orphan = f.orphan ? ` · Sub-Line of ${f.orchestratedBy} (${f.orphan})` : '';
  const description = `${f.title} — ${p.name}${status ? ` · ${status}` : ''}${orphan}${collapsed ? ` · ${rollup}` : ''}`;
  const subId = count ? `rail-subs-${encodeURIComponent(f.key)}` : '';
  const discLabel = f.forcedOpen
    ? (f.savedOpen === false ? `Keep ${subLabel} of ${f.title} open after leaving the selected sub-Line` : `Fold ${subLabel} of ${f.title} after leaving the selected sub-Line`)
    : `${f.open ? 'Hide' : 'Show'} ${subLabel} of ${f.title}`;
  const disclosure = count ? `<button type="button" class="rail-disclosure" data-act="rail-subs-fold" data-rail-parent="${esc(f.key)}"${f.forcedOpen ? ' data-forced-open="1"' : ''} aria-expanded="${f.open}" aria-controls="${subId}" aria-label="${esc(discLabel)}" title="${esc(discLabel)}">${ic('orchestrate', 14)}</button>` : '';
  const cue = f.orphan ? '<span class="rail-sub-cue" aria-hidden="true">Sub-Line</span>' : '';
  const pill = collapsed ? `<span class="rail-sub-count" aria-hidden="true">${count}</span>` : '';
  const row = `<div class="rail-line-item${count ? ' is-parent' : ''}${depth ? ' is-child' : ''}" data-rail-key="${esc(f.key)}"${depth ? ` style="--rail-depth:${Math.min(depth, 3)}"` : ''}>${disclosure}<button type="button" class="rail-line ${on ? 'on' : ''}${f.unread ? ' unread' : ''}" data-act="open-line" data-line="${esc(f.id)}" data-rail-group="${group}" data-p="${esc(p.id)}" ${on ? 'aria-current="page"' : ''} aria-keyshortcuts="Alt+Shift+ArrowUp Alt+Shift+ArrowDown" aria-description="Drag to reorder, hold then drag on touch, or press Alt+Shift+Up or Down." aria-label="${esc(description)}" title="${esc(description)}">${cue}<span class="rail-title">${esc(f.title)}</span>${pill}${sign}</button><button type="button" class="rail-line-more" data-act="rail-line-menu" aria-label="Actions for ${esc(f.title)}" aria-haspopup="menu">${ic('more', 16)}</button></div>`;
  if (HOSTED || !(f.orchestratorRef || count)) return row;
  const subs = count ? `<div class="rail-sub-lines${depth >= 3 ? ' depth-capped' : ''}" id="${subId}" data-rail-parent="${esc(f.id)}" role="group" aria-label="Sub-Lines of ${esc(f.title)}" style="--rail-depth:${Math.min(depth + 1, 3)}"${collapsed ? ' hidden' : ''}>${f.open ? f.children.map(child => railRow(p, child, group, here, depth + 1)).join('') : ''}</div>` : '';
  return `<div class="rail-line-unit" data-rail-key="${esc(f.key)}">${row}${subs}</div>`;
}
const railGroupOf = f => (f.pinned ? 'pinned' : f.state === 'working' ? 'working' : 'recent');
function railLines(p, { rest, shown, here } = railPick(p)) {
  // The line you are starting is listed first, empty, until its first node makes it real.
  const fresh = p.id === S.cur && S.route.view === 'newline' ? '<span class="rail-line on is-new"><span class="rail-title">New line</span></span>' : '';
  if (!fresh && !shown.length) return '';
  const left = rest.length - shown.length;
  const toggle = left > 0 ? `${left} more` : railLineMode(p.id) === 'all' && rest.length > RAIL_LINES ? 'Show fewer' : '';
  const moreLabel = left && !HOSTED ? ` aria-label="${left} more top-level Lines or orchestrator groups"` : '';
  const foot = toggle ? `<button type="button" class="rail-more" data-act="rail-more"${moreLabel} aria-expanded="${!left}" data-p="${esc(p.id)}">${toggle}</button>` : '';
  return `<div class="rail-lines" aria-label="Lines in ${esc(p.name)}">${fresh}${shown.map(f => railRow(p, f, railGroupOf(f), here)).join('')}${foot}</div>`;
}
// Pinned lines of every project, together at the top. Their project is in the row's tooltip.
function railPinnedLines(projects, picks) {
  return projects.flatMap(p => picks.get(p.id).pinned).sort(railLineOrder);
}
function railPinned(projects = railOrder(), picks = new Map(projects.map(p => [p.id, railPick(p)]))) {
  const rows = railPinnedLines(projects, picks).map(f => railRow(summaryOf(f.pid), f, 'pinned', picks.get(f.pid).here));
  return rows.length ? `<div class="rail-sec">Pinned</div><div class="rail-pins" aria-label="Pinned lines">${rows.join('')}</div>` : '';
}
function railProjectsHead() {
  return `<div class="rail-sec rail-sec-projects"><span>Projects</span><button type="button" class="rail-new ${S.newPage ? 'on' : ''}" data-act="new-project" ${S.newPage ? 'aria-current="page"' : ''} aria-label="New project" title="New project">${ic('plus', 20)}</button></div>`;
}
function railSetOpen(p, open) {
  if (railIsOpen(p) === open) return;
  railChoice = { ...railChoice, ...readLists(RAIL_KEY), [p.id]:open };
  writeLists(RAIL_KEY, railChoice);
  renderRail();
}
ACT['rail-fold'] = el => { const p = summaryOf(el.dataset.p); if (p) railSetOpen(p, !railIsOpen(p)); };
// The name in the sidebar folds too, where the folder shows: it opens a project with its lines showing, and on that project's home it shuts or opens them.
const railNameFolds = el => el.closest?.('#railList .rail-item.has-fold') && !matchMedia('(max-width: 1100px)').matches;
ACT['rail-more'] = el => {
  const id = el.dataset.p, mode = el.getAttribute('aria-expanded') === 'false' ? 'all' : 'few';
  railLineModes.set(id, mode);
  try { localStorage.setItem(RAIL_MORE_PREFIX + id, mode); } catch { /* Keep the choice for this visit. */ }
  renderRail();
};
function railExpandParent(el) {
  if (HOSTED) return false;
  const row = el?.closest?.('.rail-line-item');
  const item = row?.classList?.contains('is-parent') ? row : null;
  if (row && !item) return false;
  const pid = el?.dataset?.p || S.cur, id = el?.dataset?.line;
  const key = item?.dataset?.railKey || (pid && id ? railLineKey(pid, id) : '');
  if (!key) return false;
  const latest = { ...railSubsOpen, ...readLists(RAIL_SUBS_KEY) };
  if (item) {
    const disc = item.querySelector?.('.rail-disclosure');
    if (disc && disc.getAttribute('aria-expanded') === 'true' && latest[key] !== false) return false;
  } else if (latest[key] !== false) {
    return false;
  }
  railSubsOpen = { ...latest, [key]: true };
  writeLists(RAIL_SUBS_KEY, railSubsOpen);
  if (typeof renderRail === 'function') renderRail();
  return true;
}
ACT['rail-subs-fold'] = el => {
  if (HOSTED) return;
  const key = el.dataset.railParent, latest = { ...railSubsOpen, ...readLists(RAIL_SUBS_KEY) };
  const forced = el.dataset.forcedOpen === '1';
  const next = forced ? latest[key] === false : el.getAttribute('aria-expanded') !== 'true';
  railSubsOpen = { ...latest, [key]: next };
  writeLists(RAIL_SUBS_KEY, railSubsOpen);
  if (forced && typeof toast === 'function') toast(next ? 'Will stay open after leaving this sub-Line' : 'Will fold after leaving this sub-Line');
  renderRail();
};
ACT['rail-new-line'] = el => { const id = el.dataset.p; if (id === S.cur && !S.newPage && !S.shelfPage) go({ view:'newline' }); else switchProject(id, { view:'newline' }); };
const railAdd = p => p.missing ? '' : `<button type="button" class="rail-add" data-act="rail-new-line" data-p="${esc(p.id)}" aria-label="Start a new line in ${esc(p.name)}" title="Start a new line">${ic('plus', 14)}</button>`;
const railFold = p => { const open = railIsOpen(p); return `<button type="button" class="rail-fold" data-act="rail-fold" data-p="${esc(p.id)}" aria-expanded="${open}" aria-label="${open ? 'Fold' : 'Unfold'} ${esc(p.name)}" title="${open ? 'Fold' : 'Unfold'}">${ic(open ? 'filesOpen' : 'files', 16)}</button>`; };
const railItem = (p, i, pick) => `<div class="rail-project" data-project="${esc(p.id)}" data-project-group="${p.pinned ? 'pinned' : 'recent'}"><div class="rail-item has-fold${railIsOpen(p) ? ' is-open' : ''}">${railFold(p)}<button type="button" class="rail-row ${railLit(p) ? 'on' : ''} ${p.missing ? 'gone' : ''}" data-act="switch-project" data-p="${esc(p.id)}" aria-label="${esc(p.name)}" ${(S.railTo || S.cur) === p.id ? 'aria-current="page"' : ''} aria-keyshortcuts="Alt+Shift+ArrowUp Alt+Shift+ArrowDown" aria-description="Drag to reorder within this group (hold then drag on touch), or press Alt+Shift+Up or Down." ${railHasCard(p) ? (i < 9 ? `data-key="⌥${i + 1}"` : '') : `title="${esc(p.name)}${i < 9 ? ` (⌥${i + 1})` : ''}"`}>${glyph(p, 22)}<span class="rail-name">${esc(p.name)}</span></button>${railAdd(p)}<button type="button" class="rail-pin ${p.pinned ? 'on' : ''}" data-act="sw-pin" data-p="${esc(p.id)}" aria-pressed="${!!p.pinned}" aria-label="${p.pinned ? 'Unpin' : 'Pin'} ${esc(p.name)}">${ic('star', 14)}</button></div>${railIsOpen(p) ? railLines(p, pick) : ''}</div>`;
// Resting on a project's name for a second shows its folders, beside the sidebar so its lines stay in sight.
// penecho.ai has no folders to show: there the row keeps its title.
const railHasCard = p => Boolean(!HOSTED && p.docsPath);
const RAIL_CARD_WAIT = 1000, RAIL_CARD_GRACE = 220;
const RailCard = { el:null, row:null, wait:0, leave:0 };
function railCardHide() {
  clearTimeout(RailCard.wait); clearTimeout(RailCard.leave);
  RailCard.el?.remove();
  Object.assign(RailCard, { el:null, row:null, wait:0, leave:0 });
}
function railCardShow(row) {
  const p = summaryOf(row.dataset.p), rail = $('#rail');
  if (!p || !rail || !row.isConnected || !row.matches(':hover') || railProjectGesture || $('#menu') || document.querySelector('dialog[open]')) { railCardHide(); return; }
  const folder = (which, icon, path) => path ? `<button type="button" tabindex="-1" data-act="project-folder" data-which="${which}" data-p="${esc(p.id)}" data-path="${esc(path)}" aria-label="${which === 'docs' ? 'Docs' : 'Project'} folder ${esc(path)}">${ic(icon, 16)}<span>${esc(shortPath(path))}</span></button>` : '';
  const card = RailCard.el = document.createElement('div');
  card.className = 'rail-card';
  card.innerHTML = `<div class="rail-card-name">${glyph(p, 18)}<b>${esc(p.name)}</b>${row.dataset.key ? `<kbd>${esc(row.dataset.key)}</kbd>` : ''}</div>${folder('docs', 'files', p.docsPath)}${folder('code', 'code', p.code)}`;
  document.body.append(card);
  const vp = typeof pageViewport === 'function' ? pageViewport() : { width:innerWidth, height:innerHeight };
  const rectOf = el => typeof pageRect === 'function' ? pageRect(el) : el.getBoundingClientRect();
  const at = rectOf(row), left = rectOf(rail).right + 6;
  // With no room beside the sidebar it would cover what is under the pointer.
  if (vp.width - left < 220) { railCardHide(); return; }
  card.style.left = `${Math.round(left)}px`;
  card.style.maxWidth = `${Math.min(460, vp.width - left - 8)}px`;
  card.style.top = `${Math.round(Math.max(8, Math.min(at.top, vp.height - card.offsetHeight - 8)))}px`;
}
document.addEventListener('pointerover', e => {
  if (e.pointerType === 'touch') return;
  const over = e.target.closest?.('#railList .rail-project > .rail-item > .rail-row[data-p]:not([title])');
  const row = over && !railPictureOnly && !e.target.closest('[title]') ? over : null;
  if (RailCard.el && (RailCard.el.contains(e.target) || over === RailCard.row)) { clearTimeout(RailCard.leave); RailCard.leave = 0; return; }
  if (RailCard.el && !row) { RailCard.leave ||= setTimeout(railCardHide, RAIL_CARD_GRACE); return; }
  if (row && row === RailCard.row) return;
  railCardHide();
  if (row && !e.buttons) { RailCard.row = row; RailCard.wait = setTimeout(() => railCardShow(row), RAIL_CARD_WAIT); }
}, { passive:true });
document.documentElement.addEventListener('pointerleave', railCardHide);
['pointerdown', 'wheel', 'scroll'].forEach(t => addEventListener(t, e => { if (RailCard.row && !RailCard.el?.contains(e.target)) railCardHide(); }, { capture:true, passive:true }));
['blur', 'resize', 'keydown', 'penecho:page-scale-change'].forEach(t => addEventListener(t, e => { if (RailCard.row && (t !== 'blur' || e.target === window)) railCardHide(); }, true));
// Settings opens over the page, so the project beneath stays lit and its bar stays as it was.
const underPage = () => !S.shelfPage || (typeof settingsUp === 'function' && settingsUp());
// A project you click is lit at once, even while it is still being read: the wait shows only where its page will be.
const railLit = p => (S.railTo ? p.id === S.railTo : p.id === S.cur && !S.newPage && underPage());
function railGoing(id, { draw = true } = {}) {
  if ((S.railTo || null) === (id || null)) return;
  S.railTo = id || null;
  $('#view')?.classList.toggle('view-wait', Boolean(id));
  if (draw) renderRail();
}
function renderRail() {
  // The sidebar kept from the last page stays as it is until this page has the projects to draw it with (railFromList).
  if (railPictureOnly) return;
  // The foot is the account, with the gear for Settings beside it.
  let footChanged = false;
  const acct = $('#railAccount'), acctNext = (typeof railAccountHTML === 'function' ? railAccountHTML() : '') + railSettingsHTML();
  if (acct && acct.dataset.h !== acctNext) { acct.innerHTML = acctNext; acct.dataset.h = acctNext; footChanged = true; }
  if (typeof railUpdateRender === 'function') railUpdateRender();   // A newer PenEcho, above the foot (desktop-update.js)
  const mine = $('#railMine'), mineNext = typeof railMineHTML === 'function' ? railMineHTML() : '';
  if (mine && mine.dataset.h !== mineNext) { mine.innerHTML = mineNext; mine.dataset.h = mineNext; footChanged = true; }
  const host = $('#railList'); if (!host) return;
  // A poll may update the data during a gesture, but must not replace the row being held.
  if (railProjectGesture) return;
  // The list is put together apart and written only when it differs from what is shown. Written again every few seconds it
  // flickered, lost the pointer's place and made a click miss.
  const { pinned, recent } = railGroups(), draft = document.createElement('div');
  const projects = [...pinned, ...recent], picks = new Map(projects.map(p => [p.id, railPick(p)]));
  draft.innerHTML = railPinned(projects, picks) + railProjectsHead() + pinned.map((p, i) => railItem(p, i, picks.get(p.id))).join('') + (pinned.length && recent.length ? '<hr>' : '') + recent.map((p, i) => railItem(p, pinned.length + i, picks.get(p.id))).join('');
  if (typeof cloudRail === 'function') cloudRail(draft);   // Cloud: a mark on projects kept there, and the ones that are only there (cloud.js)
  if (host.innerHTML === draft.innerHTML) { if (footChanged) keepRailSoon(); return; }
  // Only the rows that changed are written, so the row under the pointer or holding the focus stays where it is.
  const top = host.scrollTop, focused = document.activeElement;
  railMorphChildren(host, draft);
  if (host.contains(focused) && document.activeElement !== focused) focused.focus({ preventScroll:true });
  host.scrollTop = top;
  keepRailSoon();
}
// Keep keyed controls even when a sibling appears, disappears, or changes position.
function railKey(n) {
  if (n.nodeType !== 1) return '';
  const { railKey:key, project, act, p, line } = n.dataset, id = key || project || n.id;
  return id || act ? JSON.stringify([id, act, p, line]) : '';
}
function railMorphChildren(from, to) {
  const old = [...from.childNodes], keyed = new Map(), kept = new Set();
  for (const node of old) {
    const key = railKey(node);
    if (key) keyed.set(key, node);
  }
  let before = from.firstChild;
  for (const next of [...to.childNodes]) {
    const key = railKey(next), current = key ? keyed.get(key) : before && !railKey(before) ? before : null;
    if (!current || current.nodeType !== next.nodeType || current.nodeName !== next.nodeName) {
      from.insertBefore(next, before);
      continue;
    }
    if (current !== before) from.insertBefore(current, before);
    railMorph(current, next);
    kept.add(current);
    before = current.nextSibling;
  }
  for (const node of old) if (!kept.has(node)) node.remove();
}
function railMorph(from, to) {
  if (from.isEqualNode(to)) return;
  if (from.nodeType !== 1) { from.nodeValue = to.nodeValue; return; }
  for (const { name } of [...from.attributes]) if (!to.hasAttribute(name)) from.removeAttribute(name);
  for (const { name, value } of [...to.attributes]) if (from.getAttribute(name) !== value) from.setAttribute(name, value);
  railMorphChildren(from, to);
}

// ---------- The sidebar between pages ----------
// Opening a Canvas, or a project from beside one, loads another page. The sidebar is kept for this tab and drawn again the
// moment the next page starts, scrolled where it was, so it stays in place instead of going blank while the projects are read.
// Until that page has read them it is only a picture of the sidebar: nothing in it can be clicked.
const RAIL_KEPT_KEY = 'penecho-lines-rail-kept';
// The panel beside a Canvas has a rail of its own that nobody sees: it neither keeps nor shows one.
const railKeeps = () => !EMBED || EMBED.rail;
let railKeepTimer = 0, railPictureOnly = false;
function keepRailSoon() { clearTimeout(railKeepTimer); railKeepTimer = setTimeout(keepRail, 400); }
function keepRail() {
  const list = $('#railList');
  if (!railKeeps() || !list || $('#rail')?.inert) return;
  const part = id => { const el = $(`#${id}`); return el ? { html:el.innerHTML, h:el.dataset.h || '' } : null; };
  try { sessionStorage.setItem(RAIL_KEPT_KEY, JSON.stringify({ v:1, mine:part('railMine'), acct:part('railAccount'), list:list.innerHTML, top:list.scrollTop })); } catch { /* The next page draws its sidebar once it has read the projects. */ }
  if (typeof saveWarmRail === 'function') saveWarmRail();
}
function showKeptRail() {
  const rail = $('#rail'), list = $('#railList');
  if (!railKeeps() || !rail || !list) return false;
  let kept = null;
  try { kept = JSON.parse(sessionStorage.getItem(RAIL_KEPT_KEY) || 'null'); } catch { return false; }
  if (kept?.v !== 1 || typeof kept.list !== 'string') return false;
  for (const [id, part] of [['railMine', kept.mine], ['railAccount', kept.acct]]) {
    const el = $(`#${id}`);
    if (el && typeof part?.html === 'string') { el.innerHTML = part.html; el.dataset.h = part.h || ''; }
  }
  list.innerHTML = kept.list;
  // The project and line this page opens on are the lit ones, not the ones the last page had.
  let parts = [];
  try { parts = location.hash.slice(1).split('/').map(decodeURIComponent); } catch { /* Lit as it was. */ }
  const id = EMBED?.rail ? EMBED.project : parts[0], line = EMBED?.rail ? EMBED.line : parts[1] === 'line' ? parts[2] || '' : '';
  const isNew = !EMBED?.rail && location.hash === '#new';
  const newBtn = $('.rail-new', list);
  if (newBtn) { newBtn.classList.toggle('on', isNew); if (isNew) newBtn.setAttribute('aria-current', 'page'); else newBtn.removeAttribute('aria-current'); }
  if (isNew || (id && $$('.rail-row[data-p]', list).some(row => row.dataset.p === id))) {
    for (const row of $$('.rail-row', list)) { const on = !isNew && row.dataset.p === id; row.classList.toggle('on', on); if (on) row.setAttribute('aria-current', 'page'); else row.removeAttribute('aria-current'); }
    for (const row of $$('.rail-line', list)) { const on = !isNew && Boolean(line) && row.dataset.p === id && row.dataset.line === line; row.classList.toggle('on', on); if (on) row.setAttribute('aria-current', 'page'); else row.removeAttribute('aria-current'); }
  }
  list.scrollTop = Number(kept.top) || 0;
  rail.inert = true;
  railPictureOnly = true;
  return true;
}
// The page beside it is kept too, for the place this tab left (PE-586). Coming back there from a Canvas, it shows at once as it was,
// as a picture, and the page draws itself over it as soon as it has read the project. Anywhere else waits for the project as before.
const PAGE_KEPT_KEY = 'penecho-lines-page-kept', PAGE_KEPT_MS = 30 * 60 * 1000;
// A kept snapshot outlives the document that created any blob: URLs, and a picture just edited on Canvas has not reconciled yet.
// Remove those images inside an inert template before saving or showing, leaving their sized container as a clean blank placeholder.
function sanitizeKeptTemplate(html, pending = null) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const root = tpl.content;
  for (const bar of root.querySelectorAll('#projbar')) bar.removeAttribute('data-projbar-sig');
  // The Canvas is not part of the picture: kept, its frame would load and open that Canvas a second time, with nobody holding it.
  for (const stage of root.querySelectorAll('#canvasStage')) { stage.replaceChildren(); stage.className = 'canvas-stage'; stage.hidden = true; stage.removeAttribute('inert'); }
  for (const img of [...root.querySelectorAll('img')]) {
    const src = img.getAttribute('src') || '';
    if (/^blob:/i.test(src)) {
      if (img.closest('.cmp-file-pic, .orch-file-pic, .pic-preview')) img.remove();
      else { img.removeAttribute('src'); img.classList.remove('is-loaded'); img.style.visibility = 'hidden'; }
    }
  }
  if (pending?.file) {
    for (const btn of root.querySelectorAll('[data-act="cmp-preview"], [data-act="orch-preview"]')) {
      if (btn.dataset.file === pending.file) btn.querySelectorAll('img').forEach(img => img.remove());
    }
  }
  if (pending?.ask?.path) {
    for (const btn of root.querySelectorAll('[data-act="preview-asset"]')) {
      if (btn.dataset.path === pending.ask.path) btn.querySelectorAll('img').forEach(img => img.remove());
    }
  }
  return tpl;
}
function keepPage() {
  const shell = $('.shell'), view = $('#view');
  if (EMBED || HOSTED || !shell || !view || shell.inert || view.classList.contains('view-wait') || S.newPage) return;
  const all = [view, ...view.querySelectorAll('*')], tops = [];
  all.forEach((el, i) => { if (el.scrollTop) tops.push([i, el.scrollTop]); });
  const body = ['is-full', 'on-line'].filter(c => document.body.classList.contains(c));
  const html = typeof document.createElement === 'function' ? sanitizeKeptTemplate(shell.innerHTML).innerHTML : shell.innerHTML;
  try { sessionStorage.setItem(PAGE_KEPT_KEY, JSON.stringify({ v:2, hash:location.hash, at:Date.now(), html, body, tops })); }
  catch { try { sessionStorage.removeItem(PAGE_KEPT_KEY); } catch { /* The page draws itself when it has read the project. */ } }
}
function showKeptPage() {
  const shell = $('.shell');
  if (EMBED || HOSTED || !shell) return false;
  let kept = null;
  try { kept = JSON.parse(sessionStorage.getItem(PAGE_KEPT_KEY) || 'null'); sessionStorage.removeItem(PAGE_KEPT_KEY); } catch { return false; }
  if (kept?.v !== 2 || typeof kept.html !== 'string' || !location.hash || kept.hash !== location.hash || !(Date.now() - kept.at < PAGE_KEPT_MS)) return false;
  const pending = typeof pendingDrawing === 'function' ? pendingDrawing() : null;
  if (typeof document.createElement === 'function') {
    const tpl = sanitizeKeptTemplate(kept.html, pending);
    shell.innerHTML = '';
    shell.append(tpl.content);
  } else {
    shell.innerHTML = kept.html;
  }
  if (typeof syncAttachmentImages === 'function') syncAttachmentImages(shell);
  shell.inert = true;
  for (const c of kept.body || []) document.body.classList.add(c);
  const view = $('#view'), all = view ? [view, ...view.querySelectorAll('*')] : [];
  for (const [i, top] of kept.tops || []) if (all[i]) all[i].scrollTop = top;
  return true;
}
// The page has read its projects and drawn them: the sidebar, and the page beside it, are its own again.
function railLive() { const rail = $('#rail'), shell = $('.shell'); if (shell?.inert) shell.inert = false; if (rail?.inert) { rail.inert = false; keepRailSoon(); } }
// Warm sidebar cache across cold desktop launches (localStorage) + structured skeletons when truly cold.
const RAIL_WARM_KEY = 'penecho-lines-rail-warm-v1';
function saveWarmRail() {
  if (EMBED || HOSTED || !Array.isArray(S.projects) || !S.projects.length) return;
  try {
    const items = railOrder().slice(0, 20).map(p => ({ id:p.id, name:p.name, color:p.color || '#2563eb', pinned:Boolean(p.pinned) }));
    localStorage.setItem(RAIL_WARM_KEY, JSON.stringify({ v:1, cur:S.cur || '', items }));
  } catch { /* Private browsing still works without warm cache. */ }
}
function showWarmRail() {
  const rail = $('#rail'), list = $('#railList');
  if (EMBED || HOSTED || !rail || !list) return false;
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(RAIL_WARM_KEY) || 'null'); } catch { return false; }
  if (saved?.v !== 1 || !Array.isArray(saved.items) || !saved.items.length) return false;
  const rows = saved.items.map(p => `<div class="rail-project" data-project="${esc(p.id)}"><div class="rail-item has-fold"><span class="rail-fold" aria-hidden="true">${ic('files', 16)}</span><button type="button" class="rail-row${p.id === saved.cur ? ' on' : ''}" data-p="${esc(p.id)}" tabindex="-1">${glyph(p, 22)}<span class="rail-name">${esc(p.name)}</span></button></div></div>`).join('');
  list.innerHTML = railProjectsHead() + rows;
  rail.inert = true;
  railPictureOnly = true;
  return true;
}
function showColdSkeleton({ rail = false, view = false } = {}) {
  if (rail) {
    const list = $('#railList');
    if (list && !list.children.length) {
      list.innerHTML = '<div class="sk-rail" aria-hidden="true"><div class="sk-rail-head"></div><div class="sk-rail-row"></div><div class="sk-rail-row is-short"></div><div class="sk-rail-row"></div><div class="sk-rail-row is-mid"></div></div>';
    }
  }
  if (view && !EMBED) {
    const host = $('#view'), bar = $('#projbar');
    if (bar && !bar.children.length) {
      bar.innerHTML = '<div class="sk-bar" aria-hidden="true"><span class="sk-pill is-title"></span><span class="sk-pill"></span><span class="sk-pill"></span><span class="sk-pill is-sm"></span></div>';
    }
    if (host && !host.children.length) {
      host.innerHTML = '<div class="page sk-page" aria-hidden="true"><div class="sk-sheet"><div class="sk-row"><i></i><b></b><span></span></div><div class="sk-row"><i></i><b class="is-mid"></b><span class="is-sm"></span></div><div class="sk-row"><i></i><b class="is-short"></b><span></span></div><div class="sk-row"><i></i><b></b><span class="is-mid"></span></div></div></div>';
    }
  }
}
function renderProjbar() {
  const bar = $('#projbar'); if (!bar) return;
  const p = project(), standalone = !p || Boolean(S.newPage) || !underPage();
  const toggle = projectsToggleHTML(), railHidden = typeof lineProjectsHidden !== 'undefined' && lineProjectsHidden;
  const signature = (html, ...inputs) => JSON.stringify([standalone, railHidden, S.statsInMore, S.orchInMore, S.navFold, S.projbarResize || 0, ...inputs, html]);
  // With no project on screen the bar only brings the projects back, and shows only while they are hidden.
  if (standalone) {
    const sig = signature(toggle);
    if (bar.dataset.projbarSig === sig) return;
    bar.classList.add('bare');
    bar.innerHTML = toggle;
    bar.dataset.projbarSig = sig;
    return;
  }
  const v = S.route.view, hasWork = allLines(p).length > 0;
  // Canvases & files (files.js); My Canvases opens it on its Canvases.
  const canvases = [p.myCanvases ? 'canvases' : 'files', 'Canvases & files', 'navCanvases'], bare = p.myCanvases && !hasWork;
  const showTopics = topicsViewAvailable(p, hasWork);
  // My Canvases is its Canvases: no map or archive of its own until one of them becomes a line.
  const items = bare ? [canvases, ['deleted', 'Deleted', 'navDeleted']]
    : [['home', 'Home', 'navHome'], ...(orchOnBar(p) ? [['orchestrator', 'Orchestrator', 'orchestrate']] : []), ...(showTopics ? [['topics', 'Topics', 'navTopics']] : []), canvases, ...(statsOnBar(p) ? [['stats', 'Statistics', 'navStats']] : [])]
      .filter(([k]) => !foldedOff(k));
  // The pages visited less sit under More (grouped with dividers); on one of them, More says its name.
  const moreItems = moreViews();
  const more = moreItems.find(([k]) => k === v || isFilesView(k) && isFilesView(v));
  const moreBtn = moreItems.length ? `<button type="button" data-act="more-views" class="subnav-more${more ? ' on' : ''}" aria-haspopup="menu"${more ? ' aria-current="page"' : ''}>${more ? ic(more[2], 17) : ''}<span>${more ? more[1] : 'More'}</span>${ic('down', 13)}</button>` : '';
  const tabHint = items.some(([k]) => k === 'topics') ? topicsTabHint(p, v === 'topics') : (v === 'topics' ? topicsTabHint(p, true) : null);
  const name = esc(p.name), identity = HOSTED?.shared
    ? `<span class="project-name" title="${name}"><span>${name}</span></span>`
    : `<button type="button" class="project-name proj-switch" data-act="open-switcher" aria-label="Switch project, current project ${name}" title="${name}"><span>${name}</span>${ic('down', 14)}</button>`;
  const html = `${toggle}${typeof historyHTML === 'function' ? historyHTML() : ''}${identity}
    <nav class="subnav" aria-label="${esc(p.name)}">${items.map(([k, label, icon]) => { const on = v === k || (k === 'files' || k === 'canvases') && (v === 'files' || v === 'canvases'); const grewHere = k === 'topics' && !on && Boolean(tabHint); return `<button type="button" data-act="go-view" data-view="${k}" class="${[on ? 'on' : '', grewHere ? 'grew' : ''].filter(Boolean).join(' ')}" ${on ? 'aria-current="page"' : ''}>${ic(icon, 17)}<span>${label}</span>${grewHere ? `<i class="grew-spark" aria-label="Topics changed">${ic('spark', 13)}</i>` : ''}</button>`; }).join('')}${moreBtn}</nav>
    <div class="bar-right"><button type="button" class="canvas-link bar-search" data-act="go-view" data-view="find" aria-label="Search project" title="Search project"${v === 'find' ? ' aria-current="page"' : ''}>${ic('navSearch', 16)}<span>Search</span></button><button type="button" class="canvas-link bar-share" data-act="project-share" aria-label="Share project" title="Share project">${ic('navShare', 16)}<span>Share</span></button></div>`;
  const keep = typeof keepable === 'function' && keepable(p);
  const syncedAt = HOSTED?.onComputer && !HOSTED.shared ? Number((HOSTED.list || []).find(c => c.key === HOSTED.key)?.computerSyncedAt) || 0 : 0;
  const syncAge = syncedAt && typeof cloudAgo === 'function' ? cloudAgo(syncedAt) : '';
  const sig = signature(html, p.id, v, tabHint?.at, keep, keep && isKept(p), syncedAt, syncAge);
  if (bar.dataset.projbarSig === sig) return;
  delete bar.dataset.projbarSig;
  bar.classList.remove('bare');
  bar.innerHTML = html;
  if (tabHint) $('.subnav .grew', bar)?.setAttribute('style', `--grew-ms:${tabHint.duration}ms;--grew-delay:-${tabHint.elapsed}ms`);
  if (typeof cloudBar === 'function') cloudBar(bar, p);   // Cloud: Keep in Cloud, before Share (cloud.js)
  // Statistics, then Orchestrator, go back under More when the bar has no room for them (PE-431, PE-613).
  const nav = $('.subnav', bar), full = nav && nav.scrollWidth > nav.clientWidth + 1;
  if (full && statsOnBar(p)) { S.statsInMore = true; renderProjbar(); }
  else if (full && orchOnBar(p)) { S.orchInMore = true; renderProjbar(); }
  // A narrow window (a side panel, a phone): Canvases & files, then Topics, go under More too, so More itself never leaves the bar.
  else if (full && !bare && (S.navFold || 0) < FOLDABLE.length) { S.navFold = (S.navFold || 0) + 1; renderProjbar(); }
  else { bar.dataset.projbarSig = sig; scheduleProjectNameFade(bar); }
}
let projNameFadeFrame = 0, projNameObserver = null, projNameObservedBar = null;
function syncProjectNameFade(bar = $('#projbar')) {
  const nameEl = bar && $('.project-name', bar), textEl = nameEl && $('span', nameEl);
  if (!textEl || !textEl.clientWidth) return;
  nameEl.classList.toggle('is-overflow', textEl.scrollWidth > textEl.clientWidth + 1);
}
function scheduleProjectNameFade(bar) {
  if (!bar) return;
  if (typeof ResizeObserver === 'function' && projNameObservedBar !== bar) {
    projNameObserver?.disconnect();
    projNameObserver = new ResizeObserver(() => syncProjectNameFade(bar));
    projNameObserver.observe(bar);
    projNameObservedBar = bar;
  }
  if (typeof requestAnimationFrame !== 'function') return;
  if (projNameFadeFrame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(projNameFadeFrame);
  projNameFadeFrame = requestAnimationFrame(() => {
    projNameFadeFrame = 0;
    syncProjectNameFade(bar);
  });
}
const TOPIC_TAB_FADE_MS = 10000;
let topicsTabTimer = 0;
// The Topics tab's pink highlight gradually fades back to normal instead of staying lit forever; redraws keep the same elapsed time.
function topicsTabHint(p, onTopics) {
  if (!p) return null;
  const fresh = S.topicsTabFresh;
  if (onTopics) {
    if (fresh?.[p.id]) fresh[p.id] = { at:0, done:true };
    if (typeof clearTimeout === 'function') { clearTimeout(topicsTabTimer); topicsTabTimer = 0; }
    return null;
  }
  if (!topicsGrew(p)) {
    if (fresh) delete fresh[p.id];
    if (typeof clearTimeout === 'function') { clearTimeout(topicsTabTimer); topicsTabTimer = 0; }
    return null;
  }
  const store = (S.topicsTabFresh ||= {});
  const entry = (store[p.id] ||= { at:0, done:false });
  if (entry.done) return null;
  if (!entry.at) {
    if (document.hidden) return { at:0, elapsed:0, duration:TOPIC_TAB_FADE_MS };
    entry.at = Date.now();
  }
  const elapsed = Math.max(0, Date.now() - entry.at);
  if (elapsed >= TOPIC_TAB_FADE_MS) {
    entry.done = true;
    return null;
  }
  if (typeof clearTimeout === 'function' && typeof setTimeout === 'function') {
    clearTimeout(topicsTabTimer);
    const id = p.id;
    topicsTabTimer = setTimeout(() => {
      topicsTabTimer = 0;
      if (S.topicsTabFresh?.[id] !== entry) return;
      entry.done = true;
      if (project()?.id === id) renderProjbar();
    }, TOPIC_TAB_FADE_MS - elapsed + 50);
  }
  return { at:entry.at, elapsed, duration:TOPIC_TAB_FADE_MS };
}
const FOLDABLE = ['files', 'topics'], isFilesView = k => k === 'files' || k === 'canvases';
const foldedOff = k => FOLDABLE.slice(0, S.navFold || 0).some(f => f === k || f === 'files' && isFilesView(k));
function refreshChrome() { refreshProjectsVisibility(); applyRoles(project()); renderRail(); renderProjbar(); }

// ---------- Home ----------
// All lines (panorama.js): the heading with the counts that filter them and a box to type in, then the trunk with a tick for each day and one drawn row for each line.
function panoHTML() {
  return `<section class="pano" id="pano" aria-label="All lines">
    <header class="pano-head"><h2>All lines</h2><div class="pano-sum" id="panoSum"></div><label class="hl-find">${ic('search', 15)}<input type="text" id="homeFilter" inputmode="search" placeholder="Filter" aria-label="Filter lines" autocomplete="off" spellcheck="false"></label><div class="pano-results" id="panoResults" hidden></div></header>
    <div class="pano-sheet" id="panoSheet"><div class="hl-start" id="panoStart"></div><div class="hl-rows" id="panoRows"></div></div>
  </section>`;
}
const inlineText = t => esc(String(t).replace(/\*\*/g, '').replace(/`/g, ''));
const shortWhen = ms => { const d = new Date(ms), now = new Date(); return d.toDateString() === now.toDateString() ? d.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }) : d.toLocaleDateString([], { month:'short', day:'numeric' }); };
// Pictures and notes, newest first. Everything else stays in the Vault.
function shelfItems(p) {
  const items = [];
  // What came of each request: its picture and its words, together.
  const used = new Set();
  for (const l of allLines(p)) {
    const pics = resultPictures(p, l);
    pics.forEach(pic => used.add(pic.path));
    [...l.ask.files, ...l.ask.later.flatMap(x => x.files || [])].forEach(f => used.add(f.path));
    if (l.result?.text || pics.length) items.push({ type:'result', line:l.id, path:pics[0]?.path || '', title:l.title, excerpt:plainOut(l.result?.text || ''), mtime:l.statusAt });
  }
  for (const c of p.pictures) if (c.hasPicture && !used.has(c.path)) items.push({ type:'canvas', source:c.source, path:c.path, title:c.title, mtime:c.mtime, topic:c.topic });
  for (const n of p.notes) items.push({ type:'note', path:n.path, title:n.title, excerpt:n.excerpt, mtime:n.mtime });
  const owned = new Set(p.pictures.flatMap(c => [c.path, c.source]));
  for (const f of p.files) {
    if (!f.path.startsWith('files/') || owned.has(f.path) || used.has(f.path) || /\.(tmp|penecho\.json|diagram\.json|explorer\.html)$/.test(f.path) || /merge-arrow\.svg$/.test(f.path) || f.path.includes('/_incoming/')) continue;
    items.push({ type:/\.md$/.test(f.path) ? 'doc' : /\.(png|jpe?g|gif|webp|svg)$/i.test(f.path) ? 'image' : 'file', path:f.path, title:f.path.split('/').pop(), mtime:f.mtime, size:f.size });
  }
  return items.sort((a, b) => b.mtime - a.mtime);
}
function fileThumb(item, p) {
  if (item.type === 'result') return item.path ? `<div class="ft ft-both"><div class="ft-img"><img src="${esc(assetUrl(p, item.path))}" alt=""></div>${item.excerpt ? `<p>${inlineText(item.excerpt.slice(0, 220))}</p>` : ''}</div>` : `<div class="ft ft-doc"><p>${inlineText(item.excerpt.slice(0, 320))}</p></div>`;
  if (item.type === 'canvas' || item.type === 'image') return `<div class="ft ft-img"><img src="${esc(assetUrl(p, item.path))}" alt=""></div>`;
  if (item.type === 'note') return `<div class="ft ft-doc"><p>${inlineText(item.excerpt || item.title)}</p></div>`;
  if (item.type === 'doc') return `<div class="ft ft-doc ft-icon">${ic('doc', 30)}</div>`;
  return `<div class="ft ft-file">${ic(FILE_ICON(item.title), 30)}<span>${esc(item.title.split('.').pop().toUpperCase())}</span></div>`;
}
const fileCard = (item, p, i, solo) => `<button type="button" class="file-card ${solo && i === 0 && item.type === 'canvas' ? 'big' : ''}" ${item.type === 'result' ? `data-act="open-line" data-line="${esc(item.line)}"` : `data-act="open-shelf" data-path="${esc(item.path)}" data-source="${esc(item.source || '')}" data-kind="${item.type}"`}>${fileThumb(item, p)}<div class="fc-foot"><span class="fc-ic">${ic({ result:'check', canvas:'canvas', note:'note', doc:'doc', image:'image', file:'file' }[item.type], 15)}</span><strong>${esc(item.title)}</strong><span class="fc-when">${esc(shortWhen(item.mtime))}</span></div></button>`;
// A folder of notes, Canvases or slides with no list of lines still needs somewhere to see what is in it. With a list, the page ends at the list.
function belowHTML(p) {
  const shape = homeShape(p), inHero = shape === 'deck' ? heroPaths(p) : new Set();
  const items = shelfItems(p).filter(x => !inHero.has(x.path)).slice(0, 12), heading = shape === 'notes' ? 'Notes' : 'Results and notes';
  const tile = shape === 'notes' ? `<button type="button" class="add-tile" data-act="new-note-quick">${ic('plus', 20)}<span>New note</span></button>` : shape === 'canvas' ? `<button type="button" class="add-tile" data-act="new-canvas">${ic('plus', 20)}<span>New Canvas</span></button>` : '';
  return `<div class="below solo">
    <section class="shelf shape-${shape}" aria-label="${heading}">
      <header class="sec-head"><h2>${heading}</h2></header>
      ${items.length || tile ? `<div class="file-grid">${items.map((it, i) => fileCard(it, p, i, true)).join('')}${tile}</div>` : '<p class="empty-line">Nothing here yet.</p>'}
    </section>
  </div>`;
}
function refreshBelow() {
  const host = $('#homeBelow'), p = project(); if (!host || !p) return;
  const next = belowHTML(p);
  if (host.dataset.h !== next) { host.innerHTML = next; host.dataset.h = next; }
}
function presetArt(k) {
  const a = {
    map:'<rect x="8" y="24" width="30" height="20" rx="3" fill="#fff" stroke="#9aa1ad"/><rect x="62" y="10" width="30" height="20" rx="3" fill="#fff" stroke="#9aa1ad"/><rect x="62" y="40" width="30" height="20" rx="3" fill="#fff" stroke="#9aa1ad"/><path d="M38 31l24-11M38 37l24 13" stroke="#4f46e5" stroke-width="2" fill="none"/>',
    doc:'<rect x="28" y="6" width="44" height="58" rx="3" fill="#fff" stroke="#9aa1ad"/><path d="M36 18h22" stroke="#20242c" stroke-width="3"/><path d="M36 28h28M36 35h28M36 42h20M36 50h24" stroke="#b8bdc7" stroke-width="2"/>',
    slides:'<rect x="14" y="10" width="72" height="44" rx="3" fill="#fff" stroke="#9aa1ad"/><path d="M26 44V34M38 44V26M50 44V30M62 44V20M74 44V28" stroke="#4f46e5" stroke-width="5"/>',
    proto:'<rect x="12" y="8" width="76" height="54" rx="4" fill="#fff" stroke="#9aa1ad"/><path d="M12 18h76" stroke="#d6d9df"/><rect x="20" y="26" width="26" height="28" rx="2" fill="#eeedfc"/><rect x="52" y="26" width="30" height="9" rx="2" fill="#4f46e5"/><path d="M52 44h30M52 50h22" stroke="#b8bdc7" stroke-width="2"/>',
    explorer:'<rect x="8" y="8" width="84" height="54" rx="3" fill="#fff" stroke="#9aa1ad"/><path d="M15 17h40" stroke="#20242c" stroke-width="3"/><rect x="15" y="24" width="20" height="8" rx="2" fill="#eeedfc" stroke="#4f46e5"/><rect x="40" y="24" width="20" height="8" rx="2" fill="#eeedfc" stroke="#4f46e5"/><rect x="65" y="24" width="20" height="8" rx="2" fill="#eeedfc" stroke="#4f46e5"/><rect x="15" y="37" width="33" height="18" rx="2" fill="#f2f3f6"/><rect x="52" y="37" width="33" height="18" rx="2" fill="#f2f3f6"/>',
    code:'<rect x="12" y="10" width="76" height="50" rx="4" fill="#fff" stroke="#9aa1ad"/><path d="M22 22h24" stroke="#b8bdc7" stroke-width="3"/><path d="M22 32h40" stroke="#277a4c" stroke-width="3"/><path d="M22 42h30" stroke="#b4232c" stroke-width="3"/><path d="M22 52h18" stroke="#b8bdc7" stroke-width="3"/>',
    blank:'<rect x="12" y="8" width="76" height="54" rx="4" fill="#fff" stroke="#9aa1ad"/><path d="M26 44c10-18 18-22 26-10s14 8 22-10" fill="none" stroke="#c94f3d" stroke-width="3" stroke-linecap="round"/>',
    note:'<path d="M22 10h56v36L60 62H22z" fill="#fff3bf" stroke="#d9bf5e"/><path d="M60 62V46h18" fill="none" stroke="#d9bf5e"/><path d="M32 24h34M32 34h26" stroke="#8d7a2c" stroke-width="2.500"/>',
  }[k];
  return `<svg viewBox="0 0 100 70" aria-hidden="true">${a}</svg>`;
}
// The Vault only shows where the folders are. Changing them is in Settings.
// On this computer a folder opens in Finder or Explorer from where its path is shown.
const folderOpens = (which, folder) => (S.thisComputer && S.openFolderLabel ? `<button type="button" class="icon-btn tiny" data-act="project-folder" data-which="${which}" data-path="${esc(folder)}" aria-label="${esc(S.openFolderLabel)}" title="${esc(S.openFolderLabel)}">${ic('arrow', 14)}</button>` : '');
const CODE_WHY = 'Link one to sync the latest conversations from every agent in that folder.';
function whereRow(p, { compact = false, change = true } = {}) {
  const code = (p.vault.code[0] || {}).path;
  const codeConflict = p.codeConflict ? `<span class="where-hint code-conflict">Already used by “${esc(p.codeConflict.name)}”${p.codeConflict.archived ? ' (archived)' : ''} — conversations synced there won't sync here.</span>` : '';
  return `<div class="where ${compact ? 'compact' : ''}">
    <div class="where-item"><span class="where-k">${ic('files', 16)}Docs folder</span><code title="${esc(p.vault.path)}">${esc(p.vault.path)}</code>${folderOpens('docs', p.vault.path)}${change ? '<button type="button" class="btn sm" data-act="choose-folder">Change</button>' : ''}</div>
    <div class="where-item"><span class="where-k">${ic('code', 16)}Code folder</span>${code ? `<code title="${esc(code)}">${esc(code)}</code>${folderOpens('code', code)}` : change ? '' : '<span class="muted">None</span>'}${change || !code ? `<button type="button" class="btn sm" data-act="edit-code">${code ? 'Change' : 'Add'}</button>` : ''}${!code && change ? `<span class="where-hint">${CODE_WHY}</span>` : ''}${code ?`<button type="button" class="ghost tiny-g" data-act="copy-pointer" title="Tell agents in the code folder where these docs are">Copy pointer for AGENTS.md</button>` : ''}${codeConflict}</div>
  </div>`;
}
const modelExplainerHTML = () => `<div class="pls">${PenEchoProjects.followHTML('en', S.agents)}${PenEchoProjects.visionHTML('en')}${PenEchoProjects.explainerHTML()}</div>`;
// ---------- The drawing skill ----------
const MEMORY_WHY = "Tells Claude, Codex and your other agents, in their own apps too, to read MEMORY.md first and to change it only with its command, which keeps it to 60 short lines.";
const SKILL_WHY = "When you ask Claude or Codex to draw in their own app, they don't know about PenEcho's Canvas, so you get text art. This skill tells them, and the picture shows up here, ready to edit.";
// A project with lines shows the same pair while the drawing skill is still offered. Adding it or Later hides both.
const skillOfferHTML = p => p.offerSkill && !p.canvasSkill ? skillPairHTML(p) : '';
// Offer only skills that still need adding, memory first. Installed skills are managed in Settings.
function skillPairHTML(p, { slim = false } = {}) {
  const memory = !p.memorySkill && p.projectMemory !== false ? (slim
    ? `<section class="skill-offer is-slim" aria-label="Memory skill"><span class="skill-mark">${ic('memory', 15)}</span><div class="skill-text"><strong>Let agents keep project memory</strong><span>Adds a skill so Claude &amp; Codex read MEMORY.md first and update it safely.</span></div><div class="skill-acts"><button type="button" class="btn sm primary" data-act="memory-skill-add">Add skill</button></div></section>`
    : `<section class="skill-offer" aria-label="Memory skill"><span class="skill-mark">${ic('memory', 18)}</span><div class="skill-text"><strong>Let your agents keep this project's memory</strong><p>${esc(MEMORY_WHY)}</p></div><div class="skill-acts"><button type="button" class="btn sm primary" data-act="memory-skill-add">Add skill</button></div></section>`) : '';
  const drawing = p.offerSkill && !p.canvasSkill ? (slim
    ? `<section class="skill-offer is-slim" aria-label="Add the drawing skill"><span class="skill-mark">${ic('pen', 15)}</span><div class="skill-text"><strong>Let agents draw on Canvas</strong><span>Adds a skill so Claude &amp; Codex draw editable diagrams here instead of text art.</span></div><div class="skill-acts"><button type="button" class="btn sm primary" data-act="skill-add">Add skill</button><button type="button" class="btn sm ghost-b" data-act="skill-later">Later</button></div></section>`
    : `<section class="skill-offer" aria-label="Add the drawing skill"><span class="skill-mark">${ic('pen', 18)}</span><div class="skill-text"><strong>Let your agents draw on this project's Canvas</strong><p>${esc(SKILL_WHY)}</p></div><div class="skill-acts"><button type="button" class="btn sm primary" data-act="skill-add">Add skill</button><button type="button" class="btn sm" data-act="skill-later">Later</button></div></section>`) : '';
  return memory || drawing ? `<div class="skill-pair${slim ? ' is-slim' : ''}">${memory}${drawing}</div>` : '';
}
// Conversations from before the project was linked come in only when you ask.
const syncButton = (primary = true, synced = false) => `<button type="button" class="btn ${primary ? 'primary' : 'sm'} sync-btn" data-act="sync-recent" ${S.syncing ? 'disabled' : ''}>${ic('retry', 15)}${S.syncing ? 'Syncing…' : synced ? 'Sync more' : 'Sync recent conversations'}</button>`;
const SYNC_WHY = 'Your latest 50 conversations in this project\'s folders.';
const SYNC_MORE_WHY = 'Up to 50 more unsynced conversations in this project\'s folders, newest first.';
const syncOfferHTML = () => `<section class="sync-offer" aria-label="Sync recent conversations">${syncButton()}<p>${SYNC_WHY}</p></section>`;
// Each conversation becomes a line as soon as it is read, so the page looks again often while a sync runs: the first line shows at once, not after all 50.
ACT['sync-recent'] = async () => {
  const p = project();
  if (S.syncing) return;
  S.syncing = true; render();
  const looking = setInterval(() => { if (S.cur === p.id) poll(); }, 600);
  try {
    const { added, elsewhere = [], warnings = [] } = await api(`${pathFor(p.id)}/sync`, { method:'POST', body:{} });
    toast(warnings.length ? `Synced ${added}. ${warnings.length === 1 ? '1 warning:' : `${warnings.length} warnings:`} ${warnings[0]}` : added ? `Synced ${added} ${added === 1 ? 'conversation' : 'conversations'}.` : elsewhere.length ? `These folders' conversations are already in ${elsewhere.join(', ')}.` : 'No other conversations in these folders.');
    await loadState(p.id, { force:true });
    await loadProjects();
  } catch (error) { toast(error.message); }
  finally { clearInterval(looking); S.syncing = false; render(); }
};
// A new project made with a code folder brings in its conversations by itself. If none come, its empty page stays, with the other ways to start.
function syncIfNew(id) {
  const p = project();
  if (p?.id === id && p.code && !p.synced && !allLines(p).length && !HOSTED) ACT['sync-recent']();
}
function toastCodeConflict(conflict) {
  if (conflict) toast(`Docs folder opened without linking ${conflict.path}: already used by ${conflict.archived ? 'archived ' : ''}project “${conflict.name}”. Choose another code folder in Project settings.`);
}
async function openMade(made, extra = {}) {
  await loadProjects();
  await switchProject(made.id);
  syncIfNew(made.id);
  toastCodeConflict(extra.codeConflict);
}
// The third way to start an empty project. Without a code folder it asks for one, then syncs at once.
ACT['start-sync'] = () => {
  const p = project();
  if (p.code) return ACT['sync-recent']();
  pathForm({ title:'Code folder', label:'Where the code for this project is. Conversations with your agents there come in as lines.', value:'', pick:'Choose the code folder', code:true, onSave:async v => { await patchProject({ codePath:v }); render(); if (v) ACT['sync-recent'](); } });
};
function settingsHTML(p) {
  return `<div class="page settings-page"><h1>Project settings</h1>
    <section class="set-row" aria-label="Name"><div class="set-text"><strong>Name</strong><p>${esc(p.name)}</p></div><button type="button" class="btn sm" data-act="project-rename">Rename</button></section>
    ${whereRow(p)}
    ${typeof projectCloudSettingsHTML === 'function' ? projectCloudSettingsHTML(p) : ''}
    ${typeof topicsSettingsRow === 'function' ? topicsSettingsRow(p) : ''}
    <section class="set-row" aria-label="Project knowledge"><div class="set-text"><strong>Project knowledge</strong><div class="set-switches">
      <label class="wake" title="MEMORY.md: what every agent should know before it starts, kept by the agents"><input type="checkbox" id="projectMemory" ${p.projectMemory !== false ? 'checked' : ''}><span>Project memory</span></label>
      ${p.topicsHidden ? '' : `<label class="wake" title="topics/ and understanding.md: each task filed under its Topic, kept by the agents"><input type="checkbox" id="projectTopics" ${p.projectTopics !== false ? 'checked' : ''}><span>Project Topics</span></label>`}
    </div></div></section>
    <section class="set-row" aria-label="Recent conversations"><div class="set-text"><strong>Recent conversations</strong><p>${p.synced && typeof SYNC_MORE_WHY === 'string' ? SYNC_MORE_WHY : SYNC_WHY}</p></div>${syncButton(false, Boolean(p.synced))}</section>
    <section class="set-row" aria-label="Archive"><div class="set-text"><strong>${p.archived ? 'Archived' : 'Archive this project'}</strong><p>${HOSTED ? (p.archived ? 'It is out of the sidebar. Archived at the end of the sidebar lists it.' : 'It leaves the sidebar. Its lines and files stay in PenEcho Cloud, and Restore brings it back.') : p.archived ? 'It is out of the sidebar list and the Canvas. Settings › Archived lists it.' : 'It leaves the sidebar and the Canvas. Its folders and lines stay as they are, and Restore brings it back.'}</p></div>${p.archived ? '<button type="button" class="btn sm primary" data-act="project-restore">Restore</button>' : '<button type="button" class="btn sm" data-act="project-archive">Archive</button>'}</section>
    ${typeof hostedDeleteRow === 'function' ? hostedDeleteRow(p) : ''}
    <section class="set-row" aria-label="Drawing skill"><div class="set-text"><strong>Drawing skill</strong><p>${esc(SKILL_WHY)}</p></div>
      ${p.canvasSkill ? `<button type="button" class="btn sm" data-act="skill-remove">Remove</button>` : `<button type="button" class="btn sm primary" data-act="skill-add">Add skill</button>`}</section>
    ${p.projectMemory === false ? '' : `<section class="set-row" aria-label="Memory skill"><div class="set-text"><strong>Memory skill</strong><p>${esc(MEMORY_WHY)}</p></div>
      ${p.memorySkill ? `<button type="button" class="btn sm" data-act="memory-skill-remove">Remove</button>` : `<button type="button" class="btn sm primary" data-act="memory-skill-add">Add skill</button>`}</section>`}
  </div>`;
}
// Light, Dark or System holds on every project's pages on this device. The Canvas keeps its own look.
const THEMES = [['light', 'Light'], ['dark', 'Dark'], ['system', 'System']];
const themeRow = () => window.linesTheme ? `<section class="set-row set-theme" aria-label="Appearance"><div class="set-text"><strong>Appearance</strong></div><div class="seg" role="radiogroup" aria-label="Appearance">${THEMES.map(([k, label]) => `<button type="button" role="radio" aria-checked="${linesTheme.get() === k}" data-act="set-theme" data-theme="${k}"><span>${label}</span></button>`).join('')}</div></section>` : '';
ACT['set-theme'] = el => {
  linesTheme.set(el.dataset.theme);
  $$('[data-act="set-theme"]').forEach(b => b.setAttribute('aria-checked', String(b === el)));
};
async function setArchived(on) {
  const p = project(); if (!p) return;
  try {
    await patchProject({ archived:on });
    await loadProjects(); await loadState(p.id, { force:true });
    refreshChrome(); render();
    toast(on ? `Archived ${p.name}` : `Restored ${p.name}`, on ? { label:'Undo', fn:() => setArchived(false) } : null);
  } catch (error) { toast(error.message); }
}
ACT['project-archive'] = () => setArchived(true);
ACT['project-restore'] = () => setArchived(false);
// The name shown in PenEcho. The folders keep their own names. Any project can be renamed, not only the one on screen.
ACT['project-rename'] = el => {
  const cur = project(), id = el?.dataset?.p || cur?.id, p = id === cur?.id ? cur : summaryOf(id), dialog = document.createElement('dialog');
  if (!p) return;
  dialog.className = 'line-command-dialog';
  dialog.setAttribute('aria-labelledby', 'projectNameTitle');
  dialog.innerHTML = `<form><h2 id="projectNameTitle">Rename project</h2><label for="projectNameInput">Name</label><input id="projectNameInput" name="name" maxlength="80" required value="${esc(p.name)}" autocomplete="off"><p class="command-error" role="alert" hidden></p><footer><button type="button" class="btn" data-cancel>Cancel</button><button type="submit" class="btn primary">Save name</button></footer></form>`;
  document.body.append(dialog);
  dialog.addEventListener('close', () => { dialog.remove(); if (el?.isConnected) el.focus(); });
  $('[data-cancel]', dialog).onclick = () => dialog.close();
  $('form', dialog).onsubmit = async e => {
    e.preventDefault();
    const name = $('input', dialog).value.trim(), submit = $('button[type="submit"]', dialog);
    if (!name || name === p.name) { dialog.close(); return; }
    submit.disabled = true;
    try {
      if (id === cur?.id) { await patchProject({ name }); document.title = `${name} · PenEcho Lines`; }
      else { await api(pathFor(id), { method:'PATCH', body:{ name } }); await loadProjects(); }
      dialog.close();
      refreshChrome(); if (id === cur?.id) { if (S.route.view === 'settings') render(); else refreshDesk(); }
      if (!$('#switcher').hidden) renderSwitcher();
    } catch (error) { const message = $('.command-error', dialog); message.hidden = false; message.textContent = error.message; submit.disabled = false; }
  };
  dialog.showModal();
  $('input', dialog).select();
};
// On this computer a folder opens in Finder. From another device its path is copied instead.
ACT['project-folder'] = el => {
  railCardHide();
  if (!(S.thisComputer && S.openFolderLabel)) { copyText(el.dataset.path, `Copied ${el.dataset.path}`); return; }
  api(`${pathFor(el.dataset.p || project().id)}/open-folder`, { method:'POST', body:{ which:el.dataset.which } }).catch(error => toast(error.status === 404 && !error.code ? 'Restart PenEcho to open folders from here.' : error.message));
};
const afterSkill = async p => { await loadState(p.id, { force:true }); refreshChrome(); if (S.route.view === 'home' || S.route.view === 'settings') render(); };
async function setSkill(on) {
  const p = project();
  await api(`${pathFor(p.id)}/skill`, { method:on ? 'POST' : 'DELETE', body:on ? {} : undefined });
  await afterSkill(p);
  toast(on ? "Added. Your agents now draw on this project's Canvas." : 'Removed the drawing skill.', { label:'Undo', fn:() => setSkill(!on).catch(error => toast(error.message)) });
}
ACT['skill-add'] = () => setSkill(true).catch(error => toast(error.message));
ACT['skill-remove'] = () => setSkill(false).catch(error => toast(error.message));
async function setMemorySkill(on) {
  const p = project();
  await api(`${pathFor(p.id)}/memory-skill`, { method:on ? 'POST' : 'DELETE', body:on ? {} : undefined });
  await afterSkill(p);
  toast(on ? 'Added. Your agents now keep MEMORY.md with its command.' : 'Removed the memory skill.', { label:'Undo', fn:() => setMemorySkill(!on).catch(error => toast(error.message)) });
}
ACT['memory-skill-add'] = () => setMemorySkill(true).catch(error => toast(error.message));
ACT['memory-skill-remove'] = () => setMemorySkill(false).catch(error => toast(error.message));
ACT['skill-later'] = () => patchProject({ offerSkill:false }).then(render).catch(error => toast(error.message));
// Example projects show what a project can hold, on an empty project. Someone with no project of their own already has them in the sidebar; anywhere else the first click makes the one you pick.
const EXAMPLE_PROJECTS = [
  { kind:'app', name:'Timeline app (Demo)', icon:'code', type:'Code', lines:3 },
  { kind:'class', name:'Calculus class notes (Demo)', icon:'pen', type:'Class notes', lines:2 },
  { kind:'deck', name:'Sales review deck (Demo)', icon:'slides', type:'Excel to PPT', lines:1 },
];
const examplesHTML = () => `<section class="examples" aria-label="Example projects">
        <header><strong>Example projects</strong></header>
        <div class="ex-row">${EXAMPLE_PROJECTS.map(x => `<button type="button" class="ex-card k-${x.kind}" data-act="open-example" data-kind="${x.kind}"><span class="ex-ic">${ic(x.icon, 18)}</span><span class="ex-t"><strong>${esc(x.name)}</strong><span>${esc(`${x.type} · ${x.lines} line${x.lines === 1 ? '' : 's'}`)}</span></span><span class="ex-go">${ic('right', 14)}</span></button>`).join('')}</div>
      </section>`;
ACT['open-example'] = async el => {
  const kind = el.dataset.kind;
  let s = S.projects.find(p => p.example === kind && !p.missing && !p.archived);
  if (!s) {
    el.disabled = true;
    try { const { project } = await api('/examples', { method:'POST', body:{ kind } }); await loadProjects(); s = summaryOf(project.id); }
    catch (error) { toast(error.message); return; }
    finally { el.disabled = false; }
  }
  if (s) switchProject(s.id);
};
const LEGEND = [['note', 'Note', 'your words'], ['ask', 'Ask', 'for an agent'], ['canvas', 'Canvas', 'a drawing'], ['work', 'Work', 'agent reply']];
const legendHTML = () => `<div class="node-legend" aria-label="What a line holds"><div class="legend-row">${LEGEND.map(([k, name, words]) => `<span><i class="mk mk-${k}"></i><b>${name}</b>${words}</span>`).join('')}</div></div>`;
function emptyWhereHTML(p) {
  const docs = p.vault?.path || '', code = (p.vault?.code?.[0] || {}).path || '';
  const openable = Boolean(S.thisComputer && S.openFolderLabel);
  const pathBtn = (which, folder, prefix = '') => `<button type="button" class="empty-path" data-act="project-folder" data-which="${which}" data-path="${esc(folder)}" title="${esc(openable ? `${S.openFolderLabel}: ${folder}` : `Copy ${folder}`)}">${prefix}<code>${esc(folder)}</code>${openable ? ic('arrow', 12) : ''}</button>`;
  return `<div class="where empty-meta">
    <span class="empty-meta-item">${pathBtn('docs', docs)}<button type="button" class="empty-meta-link" data-act="choose-folder">Change</button></span>
    <span class="empty-meta-dot" aria-hidden="true">·</span>
    <span class="empty-meta-item">${code
      ? `${pathBtn('code', code, ic('code', 13))}<button type="button" class="empty-meta-link" data-act="edit-code">Change</button>`
      : `<button type="button" class="empty-meta-link is-accent" data-act="edit-code">+ Link code folder</button>`}</span>
  </div>`;
}
// Compact agent status pill bar at the top right of an empty project, with a direct link to Your agents (presets/default model).
function emptyAgentsHTML() {
  const agents = S.agents || [], known = typeof S.thisComputer === 'boolean', state = a => npAgentState(a);
  const ready = agents.filter(a => state(a) === 'ready' && a.runs !== false), apps = agents.filter(a => state(a) === 'ready' && a.runs === false);
  const fix = agents.filter(a => state(a) === 'fix'), checking = !known || agents.some(a => state(a) === 'checking');
  const available = [...ready, ...apps], total = available.length;
  const tip = [ready.length ? `Ready: ${ready.map(a => a.name).join(', ')}` : '', apps.length ? `In their apps: ${apps.map(a => a.name).join(', ')}` : ''].filter(Boolean).join(' · ');
  const avatars = !checking && total ? `<span class="avs" aria-hidden="true">${available.slice(0, 4).map(a => av(a.id, 22)).join('')}</span>` : '';
  const count = checking
    ? `<span class="empty-agent-state"><i class="spin"></i>Checking…</span>`
    : total
      ? `<span class="empty-agents-count" title="${esc(tip)}">${ready.length ? `${total} ${total === 1 ? 'agent' : 'agents'} ready` : `${apps.length} in ${apps.length === 1 ? 'its app' : 'their apps'}`}</span>`
      : `<span class="empty-agent-state">${known ? 'No agent found' : 'Finding agents…'}</span>`;
  const warn = fix.length && !checking
    ? `<button type="button" class="empty-agents-warn" data-act="open-setup" title="${esc(`${fix.map(a => a.name).join(', ')} cannot run an Ask until fixed`)}">${fix.length} need${fix.length === 1 ? 's' : ''} a fix</button>`
    : '';
  const manage = `<button type="button" class="empty-agents-manage" data-act="open-agents" title="Manage presets, default model and effort"><span>Your agents</span>${ic('right', 13)}</button>`;
  const more = S.thisComputer ? `<button type="button" class="icon-btn tiny empty-agents-more" data-act="empty-agents-menu" aria-haspopup="menu" aria-label="Agent setup options" title="Set up agents or check again">${ic('more', 15)}</button>` : '';
  return `<div class="empty-agents-bar">${avatars}${count}${warn}${manage}${more}</div>`;
}
ACT['empty-agents-menu'] = el => {
  const checking = typeof S.thisComputer !== 'boolean' || (S.agents || []).some(a => npAgentState(a) === 'checking');
  openMenu(el, [
    { label:'Your agents', icon:'agents', fn:() => ACT['open-agents']() },
    { label:'Set up agents', icon:'gear', fn:() => ACT['open-setup']() },
    { label:checking ? 'Checking…' : 'Check again', icon:'retry', disabled:checking, fn:() => ACT['np-recheck']() },
  ], { align:'right' });
};
// Repainted only when something changed, so a click or focus survives a check.
function refreshEmptyAgents() {
  const host = $('#emptyAgents');
  if (host) {
    const html = emptyAgentsHTML();
    if (host.dataset.h !== html) {
      const focused = host.contains(document.activeElement) ? document.activeElement.dataset.act : '';
      host.innerHTML = host.dataset.h = html;
      if (focused) host.querySelector(`[data-act="${focused}"]:not([disabled])`)?.focus();
    }
  }
}
function emptyHTML(p) {
  return `<div class="page empty-page fresh-page">
    <div class="empty-inner">
      <div id="agentsHint">${typeof agentsSetupHintHTML === 'function' ? agentsSetupHintHTML() : ''}</div>
      <header class="empty-head">
        <div class="empty-title-col">
          <h1>${esc(p.name)}</h1>
          ${emptyWhereHTML(p)}
        </div>
        <section class="empty-agents" id="emptyAgents" aria-label="Your agents">${emptyAgentsHTML()}</section>
      </header>
      ${typeof hostedMcpHandoffHTML === 'function' ? hostedMcpHandoffHTML(p) : ''}
      <section class="empty-hero" aria-label="Start your first line">
        <div class="dock-wrap is-inline is-inviting">${composerHTML('home-' + p.id, { placeholder:can('canvas') ? 'Ask an agent, write a note, or type / for quick starts…' : 'Write a note, ask an agent, or type / for quick starts…', preview:true })}</div>
      </section>
      <div class="start-two">
        <button type="button" class="start-action start-canvas start-canvas-btn" data-act="draw-line">
          <span class="start-action-ic">${ic('pen', 19)}</span>
          <span class="start-action-body"><strong>Open the Canvas</strong><span>Draw a diagram or note — it becomes your first line.</span></span>
          <span class="start-action-go" aria-hidden="true">${ic('right', 15)}</span>
        </button>
        <button type="button" class="start-action start-code start-code-btn" data-act="start-sync" ${S.syncing ? 'disabled' : ''}>
          <span class="start-action-ic">${S.syncing ? '<i class="spin"></i>' : ic(p.code ? 'retry' : 'code', 19)}</span>
          <span class="start-action-body"><strong>${S.syncing ? 'Syncing…' : p.code ? 'Sync recent conversations' : 'Sync from a code folder'}</strong><span>${esc(p.code ? SYNC_WHY : 'Import recent conversations from agents in that folder.')}</span></span>
          <span class="start-action-go" aria-hidden="true">${ic('right', 15)}</span>
        </button>
      </div>
      ${skillPairHTML(p, { slim:true })}
      ${examplesHTML()}
      <footer class="empty-foot">
        ${legendHTML()}
        <button type="button" class="link starter" data-act="starter-prompt">Working in your own agent? Copy starter prompt</button>
      </footer>
    </div>
  </div>`;
}
const hasContent = p => allLines(p).length || p.notes.length || p.pictures.length || p.files.some(f => f.path.startsWith('files/'));
function homeHTML(p) {
  fvBackTo(`${p.id}:home`);
  requestAnimationFrame(fvPendingTry);
  if (homeShape(p) === 'empty' && !p.tokens?.records?.length) return emptyHTML(p);
  // When Topics are hidden, Recent lines, Works by day, and Token savings sit across the opening row above All lines.
  return `<div class="page home desk">
    <div class="desk-main">
      <div id="agentsHint">${typeof agentsSetupHintHTML === 'function' ? agentsSetupHintHTML() : ''}</div>
      ${typeof hostedMcpHandoffHTML === 'function' ? hostedMcpHandoffHTML(p) : ''}
      <div class="hm-overview-wrap">
        <div class="hm-overview">
          <div id="hmRecent">${typeof recentLinesHTML === 'function' ? recentLinesHTML(p) : ''}</div>
          <div id="hmChart">${typeof homeChartHTML === 'function' ? homeChartHTML(p) : ''}</div>
          <div id="hmWeek"></div>
          <div id="hmTokens">${typeof tokenProjectHTML === 'function' ? tokenProjectHTML(p) : ''}</div>
        </div>
      </div>
      ${p.archived ? `<section class="archived-note" aria-label="Archived"><span>${ic('archive', 15)}This project is archived.</span><button type="button" class="btn sm" data-act="project-restore">Restore</button></section>` : ''}
      ${p.lines.length || p.synced ? '' : syncOfferHTML()}
      ${skillOfferHTML(p)}
      <div id="lineWarnings">${lineWarningsHTML(p)}</div>
      <div id="cloudConflicts">${typeof cloudConflictsHTML === 'function' ? cloudConflictsHTML(p) : ''}</div>
      ${HOSTED ? '' : `<div id="deckHero">${deckHeroHTML(p)}</div>`}
      <div id="hmNeeds"></div>
      ${showsMap(p) ? panoHTML() : `<div id="homeBelow">${belowHTML(p)}</div>`}
      <div class="dock-spacer"></div>
    </div>
    <div class="dock-wrap"><div class="plan-tray" id="planTray" hidden></div>${composerHTML('home-' + p.id, { placeholder:composerWords(p), preview:true })}</div>
  </div>`;
}
// From a conversation (`here`) a message stays there, and only a prototype or being grilled starts something new.
SEND.home = async ({ text, files, refers = [], quotes = [], box = '', flags, cmd }, here = null) => {
  const p = project(), c = { flags, files, cmd };
  const plan = detectPath(text || files.map(f => f.name).join(', '), c, p);
  if (plan.kind === 'canvas') { newCanvas(); return; }
  if (plan.kind === 'note' && !here) { if (plan.stay) await quickNote(text, files); else await newNote(text.replace(/^(note|remember)[:\s]*/i, ''), files); return; }
  if (!here && !text && files.length && !flags.topic && homeShape(p) === 'deck') { await addSources(p, files); return; }
  const words = text || (files.every(f => f.source) ? 'See the picture.' : `Use ${files.map(f => f.name).join(', ')}`);
  // A prototype or being grilled starts something new. Anything else may belong to work already here.
  const kinds = plan.kinds || ['ask', 'work'], plain = kinds.every(k => k === 'ask' || k === 'work');
  // A line chosen while it was still being saved is asked for by the name the server gave it.
  const chosen = flags.topic ? savedId(flags.topic) : '';
  const topic = !plain && here && chosen === here.id ? 'new' : chosen || 'new';
  // An existing Topic in a conversation stays with its agent unless you chose another. A new Topic uses Settings' default agent (or legacy project fallback).
  const defaultAgent = (typeof defaultPreset === 'function' && defaultPreset()?.agent) || p.defaultAgent;
  const agent = flags.agent || (topic === 'new' ? defaultAgent : '');
  const beside = embedCanvas();
  // The Ask is on its line at once, and the agent is starting while you read it. The folder is written behind it.
  const onto = topic === 'new' ? null : lineById(p, topic) || null, working = availableAgents().length > 0;
  if (onto && working) Object.assign(onto, { status:'working', statusAt:Date.now() });
  if (onto && onto === here) S.panelShut = null;
  const make = flags.make || null, took = { text, files:[...files], refers:[...quotes], make }, off = !onto && Boolean(targetBody(p, boxTarget(c, p)).offMain);
  const e = showAtOnce(p, { kind:'ask', text:words, took, here:onto, sent:true, status:working ? 'working' : 'not-started', offMain:off });
  if (onto && onto !== here) go({ view:'line', line:onto.id });
  saveBehind(e, box || boxKey(onto ? `conv-${p.id}-${onto.slug}` : `home-${p.id}`), took, async line => {
    const attachments = files.length ? await uploadFiles(p, files) : [];
    if (beside.canvas) {
      const view = await embedCanvasReady();
      if (view) beside.canvasView = view;
    }
    return api(`${pathFor(p.id)}/topics`, { method:'POST', body:{ text:words, kinds, path:plan.path, agent, attachments, refers:refers.map(savedId), topic:onto ? line : topic, ...(make ? { make } : {}), ...(off ? { offMain:true } : {}), ...beside } });
  }).then(made => {
    if (!made) return;
    if (S.cur === p.id && S.route.view === 'line' && S.route.line === made.slug) pollActivity();
    if (!working) toast('No agent is installed here, so copy the prompt into one you run yourself.', { label:'Copy prompt', fn:() => { const l = lineById(project(), made.slug); if (l) copyText(agentPrompt(project(), l).text, 'Copied the prompt'); } });
  });
};

SEND.step = payload => SEND.home(payload, lineById(project(), S.route.line));

// ---------- Vault: the docs folder itself ----------
function treeNode(p, name, node, depth = 0) {
  const dirOrder = d => d === 'topics' ? 0 : d === 'lines' ? 1 : d === 'works' ? 2 : d === 'files' ? 3 : d === 'archive' ? 5 : d === '.history' ? 6 : 4;
  const dirs = Object.keys(node.dirs).sort((a, b) => dirOrder(a) - dirOrder(b) || a.localeCompare(b));
  const fileKey = n => n.name;
  const files = node.files.sort((a, b) => (depth === 0 ? (a.name === 'README.md' ? -1 : b.name === 'README.md' ? 1 : 0) : 0) || fileKey(a).localeCompare(fileKey(b)));
  const sel = S.vaultSel[p.id], openMap = S.vaultDirs?.[p.id];
  const fileRow = e => {
    const kind = /\.md$/.test(e.path) ? docKind(p, e.path) : null, line = kind === 'topic' ? allLines(p).find(l => l.topicPath === e.path) : null, state = line && shownState(line);
    const icon = kind === 'detail' ? 'check' : kind === 'memory' ? 'memory' : /\.penecho\.json$/.test(e.path) ? 'code' : FILE_ICON(e.name);
    return `<button type="button" class="tree-file ${sel === e.path ? 'on' : ''}" data-act="vault-open" data-path="${esc(e.path)}" style="--d:${depth}" title="${esc(e.name)}">${ic(icon, 15)}<span>${esc(e.name)}</span>${state ? `<i class="tree-state s-${state}" title="${esc(STATE_TEXT[state])}"></i>` : ''}</button>`;
  };
  const dirRows = dirs.map(d => {
    const dir = name + '/' + d;
    const isOpen = openMap && Object.hasOwn(openMap, dir) ? openMap[dir] : depth === 0 && d !== '.history';
    return `<details class="tree-dir" data-dir="${esc(dir)}"${isOpen ? ' open' : ''}><summary style="--d:${depth}" title="${esc(d)}">${ic('files', 15)}<span>${esc(d)}</span></summary>${treeNode(p, dir, node.dirs[d], depth + 1)}</details>`;
  }).join('');
  return depth === 0 ? files.map(fileRow).join('') + dirRows : dirRows + files.map(fileRow).join('');
}
function vaultTree(p) {
  const root = { dirs:{}, files:[] };
  for (const f of p.files) {
    const parts = f.path.split('/'); let n = root;
    parts.slice(0, -1).forEach(seg => { n = n.dirs[seg] ||= { dirs:{}, files:[] }; });
    n.files.push({ ...f, name:parts[parts.length - 1] });
  }
  return treeNode(p, '', root);
}
function vaultHTML(p) {
  S.vaultSel[p.id] ||= 'README.md';
  return `<div class="page vault-page">
    <div class="vault-head">${whereRow(p, { change:false })}
      <div class="vault-acts">
        <button type="button" class="btn" data-act="download-folder">${ic('down', 15)}Download folder as zip</button>
        <button type="button" class="icon-btn" data-act="how-it-works" aria-label="How this folder works" title="How this folder works">${ic('hint', 19)}</button>
      </div>
    </div>
    <div class="vault-body">
      <nav class="tree" id="vaultTree" aria-label="Files in the docs folder">${vaultTree(p)}</nav>
      <div class="vault-preview" id="vaultPreview"></div>
    </div>
  </div>`;
}
async function vaultPreview(p) {
  const host = $('#vaultPreview'); if (!host) return;
  const path = S.vaultSel[p.id], entry = fileEntry(p, path) || fileEntry(p, 'README.md') || p.files[0];
  if (!entry) { host.innerHTML = '<p class="empty-line">This folder is empty.</p>'; return; }
  if (/\.md$/.test(entry.path)) {
    const doc = await loadDoc(p, entry.path);
    if (S.vaultSel[p.id] !== path && path) return;
    host.innerHTML = Reader.html(doc, p, { embedded:true });
    const el = $('.reader', host); Reader.bind(el, doc, p, () => {}); el._md = doc.md;
    return;
  }
  const canvas = canvasByPath(p, entry.path);
  if (canvas && entry.path === canvas.path) {
    host.innerHTML = `<div class="vp-file"><header><code>${esc(entry.path)}</code><span class="vp-tools"><button type="button" class="btn sm" data-act="open-canvas" data-canvas="${esc(canvas.source)}">${ic('pen', 14)}Edit on Canvas</button>${pptDownloadButton(canvas)}<a class="btn sm" href="${esc(fileUrl(p, entry.path, true))}">${ic('down', 14)}Download PNG</a></span></header><div class="vp-img"><img alt="${esc(canvas.title)}" src="${esc(assetUrl(p, entry.path))}"></div></div>`;
  } else if (/\.penecho\.json$/.test(entry.path)) {
    host.innerHTML = `<div class="vp-file"><header><code>${esc(entry.path)}</code></header><div class="lb-file">${ic('code', 44)}<p class="muted">The editable source of a Canvas picture. PenEcho opens it on the Canvas.</p>${canvas ? `<button type="button" class="btn" data-act="open-canvas" data-canvas="${esc(canvas.source)}">${ic('pen', 14)}Open on Canvas</button>` : ''}</div></div>`;
  } else if (/\.(png|jpe?g|gif|webp|svg)$/i.test(entry.path)) {
    host.innerHTML = `<div class="vp-file"><header><code>${esc(entry.path)}</code><a class="btn sm" href="${esc(fileUrl(p, entry.path, true))}">${ic('down', 14)}Download</a></header><div class="vp-img"><img alt="" src="${esc(assetUrl(p, entry.path))}"></div></div>`;
  } else {
    host.innerHTML = `<div class="vp-file"><header><code>${esc(entry.path)}</code><a class="btn sm" href="${esc(fileUrl(p, entry.path, true))}">${ic('down', 14)}Download</a></header><div class="lb-file">${ic(FILE_ICON(entry.path), 44)}<p class="muted">A file in the folder. Topics link to it, and agents open it only when they need it.</p></div></div>`;
  }
}
function refreshVault(p = project()) {
  const t = $('#vaultTree'); if (!t) return;
  const dirs = ((S.vaultDirs ||= Object.create(null))[p.id] ||= Object.create(null));
  $$('details.tree-dir', t).forEach(d => { dirs[d.dataset.dir] = d.open; });
  const html = vaultTree(p);
  if (t.dataset.h === html) return;
  const top = t.scrollTop;
  t.innerHTML = t.dataset.h = html;
  t.scrollTop = top;
}
// Remember folder open/closed state across polls and page switches; toggle does not bubble, so capture it.
document.addEventListener('toggle', e => {
  const d = e.target;
  if (!d?.matches?.('#vaultTree details.tree-dir')) return;
  const p = project(); if (!p) return;
  ((S.vaultDirs ||= Object.create(null))[p.id] ||= Object.create(null))[d.dataset.dir] = d.open;
}, true);
ACT['vault-open'] = el => { const p = project(); S.vaultSel[p.id] = el.dataset.path; $$('.tree-file.on').forEach(x => x.classList.remove('on')); el.classList.add('on'); vaultPreview(p); };
function pathForm({ title, label, value, hint = '', onSave, pick, code = false }) {
  const b = $('#lightbox');
  b.innerHTML = `<form class="lb-card path-form" id="pathForm" role="dialog" aria-label="${esc(title)}"><header><strong>${esc(title)}</strong><button type="button" class="icon-btn" data-act="lb-close" aria-label="Close">${ic('x', 18)}</button></header>
    <div class="path-body"><label for="pathInput">${esc(label)}</label><div class="path-row"><input id="pathInput" type="text" value="${esc(value)}" autocomplete="off" spellcheck="false"><button type="button" class="btn" id="pathPick">Choose…</button></div>
    ${hint ? `<p class="muted">${esc(hint)}</p>` : ''}${code ? '<p class="code-folder-hint" id="pathCodeHint" hidden></p>' : ''}<p class="form-error" id="pathError" hidden></p>
    <div class="path-acts"><button type="button" class="btn" data-act="lb-close">Cancel</button><button type="submit" class="btn primary">Save</button></div></div></form>`;
  b.hidden = false; const input = $('#pathInput'); input.focus(); input.select();
  const updateHint = () => {
    if (!code) return null;
    const owner = PenEchoProjects.codeFolderOwner?.(input.value, S.projects, { excludeId:S.cur }) || null, el = $('#pathCodeHint');
    el.hidden = !owner;
    el.textContent = owner ? `Already used by ${owner.archived ? 'archived ' : ''}project “${owner.name}”. Choose another code folder.` : '';
    return owner;
  };
  if (code) {
    input.setAttribute('aria-describedby', 'pathCodeHint');
    input.addEventListener('input', () => { input.removeAttribute('aria-invalid'); $('#pathError').hidden = true; updateHint(); });
    updateHint();
  }
  $('#pathPick').addEventListener('click', async () => {
    try {
      const chosen = await PenEchoProjects.pickFolder(pick);
      if (chosen) { input.value = chosen; input.removeAttribute('aria-invalid'); $('#pathError').hidden = true; updateHint(); }
    }
    catch (error) { const e = $('#pathError'); e.hidden = false; e.textContent = error.message; }
  });
  $('#pathForm').addEventListener('submit', async e => {
    e.preventDefault();
    input.removeAttribute('aria-invalid'); $('#pathError').hidden = true;
    try { await onSave(input.value.trim()); closeLightbox(); }
    catch (error) { const el = $('#pathError'); el.hidden = false; el.textContent = error.message; if (error.code === 'CODE_FOLDER_IN_USE') input.setAttribute('aria-invalid', 'true'); }
  });
}
async function patchProject(body) { const p = project(); await api(pathFor(p.id), { method:'PATCH', body }); await loadState(p.id, { force:true }); await loadProjects(); }
ACT['choose-folder'] = () => { const p = project(); pathForm({ title:'Docs folder', label:'Where PenEcho stores your Lines as plain Markdown (.md) files, along with drawings, notes, and project memory.', value:p.vault.path, hint:'PenEcho reads the folder you choose. Moving files between folders is up to you.', pick:'Choose the docs folder', onSave:async v => { await patchProject({ docsPath:v }); S.docs = {}; render(); } }); };
ACT['edit-code'] = () => { const p = project(); pathForm({ title:'Code folder', label:'Your existing source code or repository folder, kept separate from Docs. Leave empty if there is no code.', value:(p.vault.code[0] || {}).path || '', pick:'Choose the code folder', code:true, onSave:async v => { await patchProject({ codePath:v }); render(); } }); };
ACT['download-folder'] = () => downloadFolder(project());
// The computer running PenEcho can write its own clipboard, whatever this window is allowed to do.
async function pasteboard(body) {
  const p = project();
  if (!S.thisComputer || !p) return false;
  return api(`${pathFor(p.id)}/copy`, { method:'POST', body }).then(sent => sent?.copied === true, () => false);
}
function selectionCopy(text) {
  const area = document.createElement('textarea'), was = document.activeElement;
  area.value = text; area.readOnly = true; area.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
  document.body.append(area); area.select();
  let done = false;
  try { done = document.execCommand('copy'); } catch { /* Not allowed here. */ }
  area.remove(); was?.focus?.();
  return done;
}
// By whichever way is open. An embedded window can deny the first, and a plain http address has no such thing.
async function writeClipboard(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* Try the next way. */ }
  return await pasteboard({ text }) || selectionCopy(text);
}
// The box to copy by hand is only for when every way has failed.
async function copyText(text, ok) {
  if (await writeClipboard(text)) { toast(ok); return true; }
  const b = $('#lightbox');
  b.innerHTML = `<div class="lb-card path-form" role="dialog" aria-label="Copy this"><header><strong>Copy this</strong><button type="button" class="icon-btn" data-act="lb-close" aria-label="Close">${ic('x', 18)}</button></header><div class="path-body"><textarea id="copyArea" rows="12" readonly>${esc(text)}</textarea></div></div>`;
  b.hidden = false; const a = $('#copyArea'); a.focus(); a.select();
  return false;
}
ACT['copy-prompt'] = el => { const p = project(), l = el.dataset.line ? lineById(p, el.dataset.line) : null, pr = agentPrompt(p, l); copyText(pr.text, `Copied. A new agent reads ${pr.files.length} files, about ${fmtTokens(pr.tokens)} tokens, and can carry on.`); };
ACT['copy-pointer'] = () => copyText(codePointer(project()), 'Copied. Paste it into AGENTS.md or CLAUDE.md in your code folder.');
ACT['starter-prompt'] = () => { const p = project(); copyText(`Project: "${p.name}"\nDocs folder: ${p.vault.path}\n${(p.vault.code[0] || {}).path ? `Code folder: ${p.vault.code[0].path}\n` : ''}\nThis folder is a PenEcho project. Each piece of work is one Line file in lines/: what was asked and what was done, in order${p.projectTopics === false ? '' : '; what is known about each subject is in topics/'}. Read MEMORY.md${p.projectTopics === false ? '' : ' and understanding.md'}, then help me start. Put pictures from PenEcho Canvas in the Line when they explain something better than words.\n\nMy goal: [describe what you want to achieve]`, 'Copied. Paste it into your agent.'); };
ACT['how-it-works'] = () => {
  const b = $('#lightbox');
  b.innerHTML = `<div class="lb-card model-card" role="dialog" aria-label="How this folder works"><header><strong>How this folder works</strong><button type="button" class="icon-btn" data-act="lb-close" aria-label="Close">${ic('x', 18)}</button></header>${modelExplainerHTML()}</div>`;
  b.hidden = false; $('.icon-btn', b).focus();
};
ACT['hand-note'] = async el => {
  const p = project(), doc = await loadDoc(p, el.dataset.doc, { force:true });
  const body = doc.md.replace(/^---[\s\S]*?---\n/, '').replace(/^# .*\n/m, '').trim() || doc.title;
  const plan = detectPath(body, { flags:{}, cmd:null, fromDoc:true }, p);
  const kinds = plan.kind === 'line' ? plan.kinds : ['ask', 'work'];
  try {
    const made = await api(`${pathFor(p.id)}/topics`, { method:'POST', body:{ text:body, title:doc.title, kinds, path:plan.path, fromNote:doc.path } });
    await loadState(p.id, { force:true }); await loadProjects();
    toast('Handed over.');
    go({ view:'line', line:made.slug });
  } catch (error) { toast(error.message); }
};
// newCanvas is in canvases.js: a new Canvas gets a folder of its own.
async function newNote(text = '', files = [], template = null) {
  const p = project(), title = text ? titleFromText(text) : template && template.id !== 'blank' ? `New ${template.label.toLowerCase()} Topic` : 'Untitled Topic';
  const made = await api(`${pathFor(p.id)}/notes`, { method:'POST', body:{ title, template:template?.sections || [], text:text && text !== title ? text : '' } });
  await loadState(p.id, { force:true });
  if (files.length) {
    const refs = await uploadFiles(p, files, 'files');
    await loadState(p.id, { force:true });
    const doc = await loadDoc(project(), made.path, { force:true });
    await saveDoc(project(), doc, appendedMd(doc, '', refs));
    await loadState(p.id, { force:true });
  }
  S.freshDoc = made.path;
  Reader.mode = 'split';
  go({ view:'doc', doc:made.path });
}
ACT['new-canvas'] = () => newCanvas();
ACT['preset'] = el => { const f = $('.composer'); applyCommand(f, el.dataset.cmd); };
ACT['open-shelf'] = el => {
  ++FV.opening;
  const p = project(), { path, kind, source } = el.dataset;
  if (kind === 'canvas') { const c = canvasByPath(p, source); openCanvasPage(canvasUrl(p, { source, doc:c?.topic ? `lines/${c.topic}.md` : '', title:c?.title }), el); }
  else if (kind === 'note' || kind === 'doc') openDoc(path, el);
  else if (kind === 'image') fvOpenHome(p, path);
  else openLightbox(p, path);
};
ACT['open-asset'] = el => {
  const p = project(), path = el.dataset.path, c = canvasByPath(p, path);
  if (c) { openCanvasPage(canvasUrl(p, { source:c.source, doc:c.topic ? `lines/${c.topic}.md` : '', title:c.title }), el); return; }
  openLightbox(p, path, { list:picturesNear(el), from:el });
};
// A picture preview always stays a preview, even when an editable Canvas sits behind it.
ACT['preview-asset'] = el => openLightbox(project(), el.dataset.path, { list:picturesNear(el), from:el });
const previewable = path => /\.(png|jpe?g|gif|webp|svg)$/i.test(path || '');
const canWriteImageClipboard = () => typeof ClipboardItem === 'function' && Boolean(navigator.clipboard?.write);
async function clipboardPng(src) {
  const response = await fetch(src);
  if (!response.ok) throw new Error('Could not load the image');
  const blob = await response.blob();
  if (blob.type === 'image/png') return blob;
  const bitmap = await createImageBitmap(blob), canvas = document.createElement('canvas');
  try {
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    return await new Promise((resolve, reject) => canvas.toBlob(png => png ? resolve(png) : reject(new Error('Could not encode the image')), 'image/png'));
  } finally { bitmap.close(); }
}
async function writeImageClipboard(src) {
  if (!src || !canWriteImageClipboard()) return false;
  try {
    // Start the clipboard write during the click, even if the PNG takes time to prepare.
    const png = clipboardPng(src);
    png.catch(() => {});
    await navigator.clipboard.write([new ClipboardItem({ 'image/png':png })]);
    return true;
  } catch { return false; }
}
// The pictures of the Work, Ask, note or drawing a picture was opened from, in the order they show: ← and → go round them.
const LB_PICTURES = '[data-act="preview-asset"], [data-act="open-asset"]';
const lbPictureGroup = el => el?.closest?.('.lp-work, .lp-ask, .lp-note, .lp-drawing, .result-pics, .t-pics, .lp-pics');
function picturesNear(el) {
  const p = project(), group = lbPictureGroup(el);
  if (!p || !group) return [];
  const paths = $$(LB_PICTURES, group)
    .filter(b => previewable(b.dataset.path) && (b.dataset.act === 'preview-asset' || !canvasByPath(p, b.dataset.path)))
    .map(b => b.dataset.path);
  return [...new Set(paths)].filter(path => fileEntry(p, path));
}
const LB = { list:[], i:0 };
const lbItemKey = (p, target) => typeof target === 'string' ? target : target?.id || (target?.path && fileEntry(p, target.path) ? target.path : target?.url || '');
function lightboxItem(p, target) {
  if (typeof target === 'string') {
    const entry = fileEntry(p, target);
    return { key:target, path:target, name:target.split('/').pop(), image:previewable(target), html:/\.html?$/i.test(target), ready:Boolean(entry), src:entry ? assetUrl(p, target) : '', download:entry ? fileUrl(p, target, true) : '', downloadName:'' };
  }
  const path = target?.path || '', entry = path && fileEntry(p, path);
  if (entry) return { ...lightboxItem(p, path), key:target.id || path };
  const src = target?.url || '', name = target?.name || 'image';
  const image = target?.workFile ? previewable(name) : Boolean(src);
  const frame = target?.workFile && (LINE_STATUS.workSourceFile(name) || /\.(?:md|txt|json|html)$/i.test(name));
  return { key:target?.id || src, name, image, html:frame, ready:Boolean(src), src, download:src, downloadName:name };
}
function lbProjectImageEdit(p, item, from) {
  const path = item.path;
  if (!path || !fileEntry(p, path)) return null;
  const group = lbPictureGroup(from), step = from?.closest?.('[data-step]')?.dataset.step;
  const liveGroup = step && group?.isConnected === false ? $(`#linePage [data-step="${CSS.escape(step)}"]`) : group;
  const preview = from?.isConnected && from.dataset.path === path ? from : liveGroup && $$(LB_PICTURES, liveGroup).find(el => el.dataset.path === path);
  const pictureCard = preview?.closest('.t-pic, .lp-big-pic'), draw = pictureCard && $('[data-act="draw-picture"]', pictureCard);
  if (draw && !draw.disabled && draw.dataset.path === path) return beforeOpen => drawPicture(draw, beforeOpen);
  const canvas = canvasByPath(p, path);
  if (canvas) return beforeOpen => {
    if (beforeOpen()) return openCanvasPage(canvasUrl(p, { source:canvas.source, doc:canvas.topic ? `lines/${canvas.topic}.md` : '', title:canvas.title }), preview);
  };
  if (!/\.(png|jpe?g|gif|webp)$/i.test(path)) return null;
  return beforeOpen => {
    const source = sourceBeside(p, path, { keepOriginal:true }), title = `${item.name.replace(/\.[^.]+$/, '')} edit`;
    if (beforeOpen()) return openCanvasPage(canvasUrl(p, { source, title, seed:path }), preview, { seeded:true, fresh:true });
  };
}
function lbImageEdit(p, target, item, { from, editImage }) {
  if (!p || !can('canvas') || HOSTED?.shared || project()?.id !== p.id) return null;
  const l = S.route?.view === 'line' ? lineById(p, S.route.line) : null;
  if (l?.closed || l?.archived) return null;
  return editImage ? editImage(target) : lbProjectImageEdit(p, item, from);
}
function lbImageHTML({ name, src, many, edit, copy, download, favorite, close, count }) {
  const controls = `<button type="button" class="icon-btn" data-zoom="out" aria-label="Zoom out" title="Zoom out" disabled>${ic('minus', 16)}</button><output aria-label="Image zoom">—</output><button type="button" class="icon-btn" data-zoom="in" aria-label="Zoom in" title="Zoom in" disabled>${ic('plus', 16)}</button><button type="button" class="btn ghost-b" data-zoom="fit" aria-label="Fit image to view" title="Fit image to view" disabled>Fit</button>`;
  const gallery = many ? `<div class="lb-gallery" role="group" aria-label="Browse images"><button type="button" class="icon-btn" data-act="lb-step" data-d="-1" aria-label="Previous image" title="Previous image">${ic('left', 18)}</button>${count}<button type="button" class="icon-btn" data-act="lb-step" data-d="1" aria-label="Next image" title="Next image">${ic('right', 18)}</button></div>` : '<span class="lb-image-hint">Scroll to zoom · Drag to pan</span>';
  const actions = `${edit ? `<button type="button" class="btn primary" data-act="lb-edit">${ic('pen', 16)}Edit on canvas</button>` : ''}${copy}${download}${favorite}`;
  return `<div class="lb-card lb-image-card lb-photo-preview" role="dialog" aria-modal="true" aria-label="${esc(name)}"${many ? ' data-many="1"' : ''}>
    <header><strong title="${esc(name)}">${esc(name)}</strong><div class="lb-image-actions" role="group" aria-label="Image actions">${actions}</div>${close}</header>
    <div class="lb-image-stage"><div class="lb-image-viewport" tabindex="0" role="group" aria-label="Image preview. Plus and minus zoom. Zero fits the image. ${many ? 'Use up and down or Shift with left and right to pan.' : 'Use arrow keys to pan.'}"><img src="${esc(src)}" alt="${esc(name)}" draggable="false"></div><p class="lb-image-error" role="status" hidden>Couldn’t load this image.</p></div>
    <footer class="lb-image-tools">${gallery}<div class="lb-image-controls" role="group" aria-label="Zoom controls">${controls}</div></footer>
  </div>`;
}
function openLightbox(p, target, { list = [], from = null, editImage = null } = {}) {
  ++FV.opening;
  const options = { list, from, editImage };
  const b = $('#lightbox'), item = lightboxItem(p, target), { name, image, html, ready, src, download, downloadName } = item;
  const photo = image && ready;
  const text = ready && !image && !html && typeof target === 'string' && fvIsText(item.key);
  const i = photo ? list.findIndex(x => lbItemKey(p, x) === item.key) : -1, many = i >= 0 && list.length > 1;
  Object.assign(LB, { list:many ? list : [], i:Math.max(0, i), options, edit:null });
  const count = many ? `<span class="lb-count" aria-label="Image ${i + 1} of ${list.length}">${i + 1} / ${list.length}</span>` : '';
  const favorite = lbFavHTML(p, item);
  const close = `<button type="button" class="icon-btn lb-close" data-act="lb-close" aria-label="Close preview" title="Close preview">${ic('x', 18)}</button>`;
  const dl = download ? `<a class="btn${photo ? ' ghost-b lb-file-action' : ' sm'}" href="${esc(download)}"${downloadName ? ` download="${esc(downloadName)}"` : ''} aria-label="Download ${photo ? 'image' : 'file'}" title="Download">${ic('download', 16)}${photo ? '<span>Download</span>' : 'Download'}</a>` : '';
  if (photo) {
    const edit = lbImageEdit(p, target, item, options);
    const copy = canWriteImageClipboard() ? `<button type="button" class="btn ghost-b lb-file-action" data-copy-image aria-label="Copy image" title="Copy image" disabled>${ic('copy', 16)}<span>Copy image</span></button>` : '';
    const app = $('#app');
    if (app && !app.inert) {
      app.inert = true;
      b.addEventListener('penecho-lightbox-closed', () => { app.inert = false; if (from?.isConnected) from.focus({ preventScroll:true }); }, { once:true });
    }
    b.innerHTML = lbImageHTML({ name, src, many, edit, copy, download:dl, favorite, close, count });
    b.hidden = false;
    const card = $('.lb-photo-preview', b);
    wireImagePreview(card, { copyImage:true });
    card.addEventListener('keydown', e => {
      if (e.key !== 'Tab' || $('#menu')) return;
      const controls = $$('button:not(:disabled), a[href], [tabindex="0"]', card), end = e.shiftKey ? controls[0] : controls.at(-1);
      if (e.target === end) { e.preventDefault(); (e.shiftKey ? controls.at(-1) : controls[0]).focus(); }
    });
    if (edit) LB.edit = button => launchLightboxEdit(button, card, p, target, options);
  } else {
    const body = !ready ? `<div class="lb-file">${ic('file', 44)}<p class="muted">This file is no longer in the project.</p></div>` : html ? `<iframe class="lb-frame" sandbox="${target?.workFile ? '' : 'allow-scripts'}" src="${esc(src)}" title="${esc(name)}"></iframe>` : text ? `<pre class="lb-text fv-text" tabindex="0" aria-label="${esc(name)}"></pre>` : `<div class="lb-file">${ic(FILE_ICON(name), 44)}<p class="muted">Download this file to open it.</p></div>`;
    b.innerHTML = `<div class="lb-card" role="dialog" aria-label="${esc(name)}"><header><strong>${esc(name)}</strong>${favorite}${dl}${close}</header>${body}</div>`;
  }
  b.hidden = false;
  ($('[data-act="lb-edit"]', b) || $('[data-act="lb-close"]', b)).focus({ preventScroll:true });
  const pre = text && $('.lb-text', b);
  if (pre) fvLoadText(p, item.key).then(({ text:t, cut }) => { if (pre.isConnected) pre.textContent = cut ? `${t}\n\n… Only the first 1 MB is shown. Download the file to read all of it.` : t; }, error => { if (pre.isConnected) pre.textContent = error.message; });
}
async function launchLightboxEdit(button, card, p, target, options) {
  const current = project();
  const item = current?.id === p.id && lightboxItem(current, target);
  const edit = item?.ready && lbImageEdit(current, target, item, options);
  if (!edit) { toast('This image is no longer available to edit.'); return; }
  const opening = FV.opening;
  let closed = false;
  button.disabled = true;
  try {
    await edit(() => {
      if (!card.isConnected || project()?.id !== p.id) return false;
      closeLightbox(); closed = true;
      return true;
    });
  } catch (error) {
    if (closed && FV.opening === opening && $('#lightbox').hidden && project()?.id === p.id) {
      openLightbox(project(), target, options);
      $('#lightbox [data-act="lb-edit"]')?.focus({ preventScroll:true });
    }
    toast(error.message || 'Couldn’t open this image on canvas.');
  } finally { button.disabled = false; }
}
ACT['lb-edit'] = el => LB.edit?.(el);
// A file of the folder gets the same star as on Canvases & files; a Canvas's picture stars its Canvas.
const lbFavKey = (p, item) => (item.ready && p?.files?.some(f => f.path === item.path) ? canvasByPath(p, item.path)?.source || item.path : '');
const lbFavHTML = (p, item, key = lbFavKey(p, item)) => (key && typeof flFavButton === 'function' && typeof flIsFav === 'function' ? flFavButton(p, { key }, `lb-fav fl-fav${flIsFav(p, key) ? ' on' : ''}`) : '');
function lbFavRefresh(p) {
  const star = $('#lightbox > .lb-card > header .lb-fav');
  if (star && p) star.outerHTML = lbFavHTML(p, null, star.dataset.key);
}
function lbStep(d) {
  const p = project(), { list, i, options } = LB;
  if (!p || list.length < 2) return;
  openLightbox(p, list[(i + d + list.length) % list.length], options);
  $(`#lightbox [data-act="lb-step"][data-d="${d}"]`)?.focus({ preventScroll:true });
}
ACT['lb-step'] = el => lbStep(+el.dataset.d);
// ← and → go to the other pictures while there are several, before the picture takes them to move.
document.addEventListener('keydown', e => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || $('#lightbox').hidden || !$('#lightbox > .lb-card[data-many]') || $('#menu') || $('dialog[open]') || e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
  e.preventDefault(); e.stopPropagation(); lbStep(e.key === 'ArrowLeft' ? -1 : 1);
}, true);
function wireImagePreview(card, { copyImage = false } = {}) {
  const viewport = $('.lb-image-viewport', card), image = $('img', viewport), output = $('output', card);
  const zoomOut = $('[data-zoom="out"]', card), zoomIn = $('[data-zoom="in"]', card), zoomFit = $('[data-zoom="fit"]', card);
  const copyButton = $('[data-copy-image]', card), errorMessage = $('.lb-image-error', card);
  const copy = async () => {
    const copied = image.naturalWidth && await writeImageClipboard(image.currentSrc || image.src);
    toast(copied ? 'Copied the image' : 'Could not copy the image');
  };
  let zoom = 1, x = 0, y = 0, drag = null;
  const fitScale = () => Math.min(1, viewport.clientWidth / image.naturalWidth, viewport.clientHeight / image.naturalHeight);
  const paint = () => {
    if (!image.naturalWidth || !viewport.clientWidth || !viewport.clientHeight) return;
    const scale = fitScale() * zoom, width = image.naturalWidth * scale, height = image.naturalHeight * scale;
    const maxX = Math.max(0, (width - viewport.clientWidth) / 2), maxY = Math.max(0, (height - viewport.clientHeight) / 2);
    x = clamp(x, -maxX, maxX); y = clamp(y, -maxY, maxY);
    image.style.width = width + 'px'; image.style.height = height + 'px';
    image.style.transform = `translate(${x - width / 2}px, ${y - height / 2}px)`;
    output.value = `${Math.round(scale * 100)}%`;
    zoomOut.disabled = zoom <= .25;
    zoomIn.disabled = zoom >= 8;
    if (zoomFit) zoomFit.disabled = false;
    if (copyButton) copyButton.disabled = false;
  };
  const changeZoom = (next, px = 0, py = 0) => {
    next = clamp(next, .25, 8);
    const ratio = next / zoom;
    x = px - (px - x) * ratio; y = py - (py - y) * ratio;
    zoom = next; paint();
  };
  const fit = () => { zoom = 1; x = 0; y = 0; paint(); };
  viewport.addEventListener('wheel', e => {
    e.preventDefault();
    const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? viewport.clientHeight : 1);
    const rect = typeof pageRect === 'function' ? pageRect(viewport) : viewport.getBoundingClientRect();
    const pt = typeof pagePoint === 'function' ? pagePoint(e.clientX, e.clientY) : { x:e.clientX, y:e.clientY };
    changeZoom(zoom * Math.exp(clamp(-delta * .002, -.6, .6)), pt.x - rect.left - rect.width / 2, pt.y - rect.top - rect.height / 2);
  }, { passive:false });
  card.addEventListener('click', e => {
    if (e.target.closest('[data-copy-image]')) { void copy(); return; }
    const button = e.target.closest('[data-zoom]'); if (!button) return;
    if (button.dataset.zoom === 'fit') fit(); else changeZoom(zoom * (button.dataset.zoom === 'in' ? 1.25 : .8));
  });
  if (copyImage) viewport.addEventListener('contextmenu', e => {
    if (!image.naturalWidth || !canWriteImageClipboard()) return;
    e.preventDefault();
    const point = e.clientX || e.clientY ? { x:e.clientX, y:e.clientY } : null;
    openMenu(viewport, [{ label:'Copy image', icon:'copy', fn:copy }], { className:'lb-image-menu', point });
  });
  viewport.addEventListener('pointerdown', e => {
    if (e.button !== 0 || drag) return;
    if (copyImage && $('#menu.lb-image-menu')) closeMenu();
    e.preventDefault(); viewport.focus(); viewport.setPointerCapture(e.pointerId);
    drag = { id:e.pointerId, clientX:e.clientX, clientY:e.clientY, x, y }; viewport.classList.add('dragging');
  });
  viewport.addEventListener('pointermove', e => {
    if (drag?.id !== e.pointerId) return;
    const z = typeof pageZoomScale === 'function' ? pageZoomScale() : 1;
    x = drag.x + (e.clientX - drag.clientX) / z; y = drag.y + (e.clientY - drag.clientY) / z; paint();
  });
  viewport.addEventListener('pointerup', e => { if (viewport.hasPointerCapture(e.pointerId)) viewport.releasePointerCapture(e.pointerId); });
  viewport.addEventListener('lostpointercapture', () => { drag = null; viewport.classList.remove('dragging'); });
  viewport.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === '+' || e.key === '=') changeZoom(zoom * 1.25);
    else if (e.key === '-') changeZoom(zoom * .8);
    else if (e.key === '0') fit();
    else if (e.key === 'ArrowLeft') { x += 40; paint(); }
    else if (e.key === 'ArrowRight') { x -= 40; paint(); }
    else if (e.key === 'ArrowUp') { y += 40; paint(); }
    else if (e.key === 'ArrowDown') { y -= 40; paint(); }
    else return;
    e.preventDefault();
  });
  image.addEventListener('load', fit, { once:true });
  if (errorMessage) {
    const showError = () => { image.hidden = true; errorMessage.hidden = false; };
    image.addEventListener('error', showError, { once:true });
    if (image.complete && !image.naturalWidth) showError();
  }
  const resize = new ResizeObserver(() => { if (viewport.isConnected) paint(); else resize.disconnect(); });
  resize.observe(viewport);
  paint();
}
ACT['lb-close'] = () => { closeLightbox(); };

async function refreshReaders() {
  const p = project(); if (!p) return;
  for (const el of $$('.reader')) {
    const path = el.dataset.doc, entry = fileEntry(p, path), doc = docById(path, p);
    if (!doc || !entry || entry.mtime <= doc.mtime) continue;
    const area = $('#rdArea', el);
    if (area && !area.hidden) continue;
    try { const fresh = await loadDoc(p, path, { force:true }); Reader.refresh(el, fresh, p); } catch { /* It may have been removed. */ }
  }
}
function refreshAfterChange() {
  // A line on its way across the page finishes first. Its own end catches up with whatever changed.
  if (S.flying) { S.flyMissed = true; return; }
  refreshChrome();
  // The New project and Archived pages are no project's page, so a change in the open project leaves them as they are.
  if (S.newPage || S.shelfPage) return;
  // A page still an outline is drawn once what it shows is here.
  if (S.outline) { if (S.outline === viewKey() && !lacks(project(), routeNeeds(S.route))) render(); return; }
  const v = S.route.view;
  // Background refreshes from other pages leave More's pages (Memory, Vault, Archive, Deleted) and Search alone.
  if (v === 'find' || v === 'memory' || v === 'vault' || v === 'archive' || v === 'deleted') return;
  refreshReaders();
  if (v === 'home') {
    const p = project();
    refreshEmptyAgents();
    // What the folder holds decides what the home shows, so a change there redraws it.
    const shape = homeShape(p);
    if (S.shapeShown !== shape || (shape !== 'empty' && showsMap(p)) !== !!$('#pano')) render();
    else {
      if ($('#pano')) { Pano.update(); renderTray(); }
      else {
        const box = $(`.composer[data-comp="home-${p.id}"]`);
        if (box) renderPathPreview(box, comp(box.dataset.comp));
      }
      refreshBelow(); refreshDesk();
    }
    fvRefresh();
  }
  if (v === 'topics') {
    if (project()?.projectTopics === false) { render(); return; }
    if (typeof refreshTopicsPage === 'function') refreshTopicsPage();
  }
  let orchRefreshed = false;
  if (v === 'stats') { refreshStats(); if (typeof refreshStatsPrices === 'function') orchRefreshed = refreshStatsPrices(); }
  if (v === 'orchestrator' && typeof refreshOrchestrator === 'function') { refreshOrchestrator(); orchRefreshed = true; }
  if (v === 'line') { refreshLine(); if (typeof fvRefresh === 'function') fvRefresh(); }
  if (v === 'canvases' || v === 'files') refreshFiles();   // Canvases & files: what an agent made since shows where you are (files.js)
  if (typeof cloudRefresh === 'function') cloudRefresh();   // Cloud: the banners for a file with two versions (cloud.js)
  return orchRefreshed;
}

// ---------- Memory and files ----------
function readerHost(p, path) {
  const doc = docById(path, p);
  // A copy from earlier shows at once, and the file as it is now takes its place.
  if (doc) { if ((fileEntry(p, path)?.mtime || 0) > doc.mtime) setTimeout(refreshReaders, 0); return Reader.html(doc, p); }
  loadDoc(p, path).then(() => { if (project()?.id === p.id && ['memory', 'doc', 'line'].includes(S.route.view)) render(); }).catch(error => toast(error.message));
  return '<div class="reader-loading">Opening…</div>';
}
// The Topics update card sits above the bottom controls.
function growNote(id) {
  let host = $('#growNotes'), el = $(`#${id}`);
  if (!host) { host = document.createElement('div'); host.id = 'growNotes'; document.body.append(host); }
  if (!el) { el = document.createElement('div'); el.id = id; el.className = 'grow-note'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite'); host.append(el); }
  return el;
}
// When an agent makes or changes a Topic, a card says which and where it stands, and the Topics tab wears a fading highlight.
let topicNoteTimer = 0;
function announceTopics(p, fresh) {
  if (!fresh.length || project()?.id !== p.id || p.projectTopics === false) return;
  renderProjbar();
  if (S.route.view === 'topics') { if (typeof refreshTopicsPage === 'function') refreshTopicsPage(); return; }
  if (S.route.view === 'home' && typeof refreshDesk === 'function') refreshDesk();
  const el = growNote('topicNote'), last = fresh[fresh.length - 1];
  const head = fresh.length > 1 ? `${fresh.length} Topics updated` : last.isNew ? 'New Topic' : 'Topic updated';
  el.innerHTML = `<button type="button" class="mem-note topic-note" data-act="topic-note-open" data-topic="${esc(last.path)}">
    <span class="mem-note-icon">${ic('note', 18)}<i>${ic('spark', 11)}</i><i>${ic('spark', 9)}</i><i>${ic('spark', 7)}</i></span>
    <span class="mem-note-text"><strong>${head}</strong><span><b>${esc(last.title)}</b>${last.status ? ` · ${esc(last.status)}` : ''}</span></span>
  </button><button type="button" class="mem-note-x" data-act="topic-note-close" aria-label="Close">${ic('x', 14)}</button>`;
  el.hidden = false; el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  clearTimeout(topicNoteTimer);
  topicNoteTimer = setTimeout(() => { el.hidden = true; }, 9000);
}
ACT['topic-note-open'] = el => { $('#topicNote').hidden = true; go({ view:'topics', topic:el.dataset.topic }); };
ACT['topic-note-close'] = () => { $('#topicNote').hidden = true; };
// An earlier MEMORY.md back, from the versions PenEcho and the memory command keep. Undo puts the one it replaced back.
ACT['memory-recover'] = async el => {
  const p = project();
  let versions;
  try { ({ versions } = await api(`${pathFor(p.id)}/memory-versions`)); } catch (error) { toast(error.message); return; }
  if (!versions.length) { toast('No earlier version is kept.'); return; }
  const when = at => new Date(at).toLocaleString('en', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
  openMenu(el, versions.map(v => ({ label:`${when(v.at)}${v.lines == null ? '' : ` · ${plural(v.lines, 'line', 'lines')}`}`, icon:'undo', fn:() => restoreMemory(p, v.id) })), { align:'right' });
};
async function restoreMemory(p, id) {
  try {
    const { undo } = await api(`${pathFor(p.id)}/memory-restore`, { method:'POST', body:{ id } });
    await loadDoc(p, 'MEMORY.md', { force:true });
    await loadState(p.id, { force:true });
    render();
    toast('MEMORY.md is back to that version.', undo ? { label:'Undo', fn:() => restoreMemory(p, undo) } : undefined);
  } catch (error) { toast(error.message); }
}
function memoryHTML(p) {
  loadMemoryLists(p);
  return `<div class="page doc-page memory-page">
    <div class="mem-body">
      <div class="reader-host" id="readerHost">${readerHost(p, 'MEMORY.md')}</div>
      <aside class="mem-side" id="memSide" aria-label="What agents remember and project files">${memSideHTML(p)}</aside>
    </div>
    <div class="dock-wrap doc-dock">${composerHTML('mem-' + p.id, { placeholder:'Add what every agent here should know', on:'doc' })}</div>
  </div>`;
}
// What each agent has saved about this project and the project's own files, read as they are now each time you come here.
function loadMemoryLists(p) {
  const had = S.memLists?.[p.id];
  if (S.memLoading === p.id || (had && Date.now() - had.at < 15000)) return;
  S.memLoading = p.id;
  api(`${pathFor(p.id)}/memory`).then(lists => {
    (S.memLists ||= {})[p.id] = { ...lists, at:Date.now() };
    const side = $('#memSide');
    if (side && project()?.id === p.id) side.innerHTML = memSideHTML(p);
  }).catch(() => { /* A server not restarted yet has no lists. The page still reads without them. */ }).finally(() => { S.memLoading = ''; });
}
const MEM_SHOWN = 5;
const memRow = (attrs, name, about) => `<button type="button" class="mem-row" ${attrs}><span><strong>${esc(name)}</strong>${about ? `<small>${esc(about)}</small>` : ''}</span></button>`;
function memGroup(key, head, rows) {
  const open = S.memOpen?.has(key);
  return `<section class="mem-group"><h3>${head}<small>${rows.length}</small></h3>${(open ? rows : rows.slice(0, MEM_SHOWN)).join('')}${rows.length > MEM_SHOWN && !open ? `<button type="button" class="link mem-all" data-act="mem-show-all" data-key="${esc(key)}">Show all ${rows.length}</button>` : ''}</section>`;
}
function memSideHTML(p) {
  const lists = S.memLists?.[p.id]; if (!lists) return '';
  const files = lists.files.map(f => f.rule ? memRow(`data-act="open-project-rule" data-file="${esc(f.name)}"`, f.name, shortPath(p.vault.code[0]?.path || '')) : memRow(`data-act="open-branch-doc" data-line="${esc(f.line)}" data-path="${esc(f.path)}" title="${esc(f.path)}"`, f.name, f.branch));
  return [
    files.length ? memGroup('files', `${ic('doc', 16)}<span>Project files</span>`, files) : '',
    ...lists.agents.map(a => memGroup(a.agent, `${av(a.agent, 20)}<span>${esc(agentInfo(a.agent).name)}</span>`, a.rows.map(r => memRow(`data-act="open-agent-note" data-agent="${esc(a.agent)}" data-id="${esc(r.id)}"`, r.name, r.about)))),
  ].join('');
}
ACT['mem-show-all'] = el => { (S.memOpen ||= new Set()).add(el.dataset.key); const side = $('#memSide'); if (side) side.innerHTML = memSideHTML(project()); };
ACT['open-agent-note'] = async el => {
  try { const { name, md } = await api(`${pathFor(S.cur)}/memory/read?agent=${encodeURIComponent(el.dataset.agent)}&id=${encodeURIComponent(el.dataset.id)}`); showViewer(name, md, true); } catch (error) { toast(error.message); }
};
ACT['open-project-rule'] = async el => {
  try { const { name, md } = await api(`${pathFor(S.cur)}/memory/read?file=${encodeURIComponent(el.dataset.file)}`); showViewer(name, md, true); } catch (error) { toast(error.message); }
};
// What you add goes under What matters, where the next agent looks, and not after Landed at the end of the file.
function addedToMemory(doc, text, refs) {
  // Your own one-line note is a line under Decisions; anything longer goes under its own heading at the end, where the memory command leaves it alone.
  const decisions = doc.md.match(/^## Decisions[ \t]*$/m), line = text.trim();
  if (decisions && !doc.md.match(/^## What matters[ \t]*$/m)) {
    if (line && !line.includes('\n') && !refs.length) {
      const from = decisions.index + decisions[0].length, rest = doc.md.slice(from), end = rest.search(/^## /m), now = (end < 0 ? rest : rest.slice(0, end)).trim().replace(/^Nothing yet\.$/, '');
      const before = `${doc.md.slice(0, from)}\n\n${now ? `${now}\n` : ''}`;
      doc.lastAddedAt = before.split('\n').length;
      return `${before}- ${line.replace(/^[-*]\s+/, '')}\n${end < 0 ? '' : `\n${rest.slice(end)}`}`;
    }
    return appendedMd(doc, text, refs);
  }
  const head = doc.md.match(/^## What matters[ \t]*$/m);
  if (!head) return appendedMd(doc, text, refs);
  const from = head.index + head[0].length, rest = doc.md.slice(from), end = rest.search(/^## /m), now = (end < 0 ? rest : rest.slice(0, end)).trim().replace(/^Nothing recorded yet\.$/, '');
  const words = text.trim(), entry = [words && !words.includes('\n') ? `- ${words}` : words, ...refs.map(f => { const rel = relPath(doc.path, f.path); return /\.(png|jpe?g|gif|webp|svg)$/i.test(f.name) ? `![${f.name}](${rel})` : `[${f.name}](${rel})`; })].filter(Boolean).join('\n\n');
  const before = `${doc.md.slice(0, from)}\n\n${now ? `${now}\n` : ''}`;
  doc.lastAddedAt = before.split('\n').length;
  return `${before}${entry}\n${end < 0 ? '' : `\n${rest.slice(end)}`}`;
}
function docHTML(p, r) {
  const doc = docById(r.doc, p), isNote = docKind(p, r.doc) === 'note', owner = lineOfDoc(p, { path:r.doc }), step = owner?.stations.find(s => s.detail === r.doc);
  const back = typeof docBackTarget === 'function' ? docBackTarget(p, r.doc) : null;
  const backBtn = back ? `<button type="button" class="ghost" data-act="doc-back">${ic('left', 16)}${esc(back.label)}</button>`
    : owner ? `<button type="button" class="ghost" ${step ? `data-act="open-step" data-step="${esc(step.id)}"` : 'data-act="open-line"'} data-line="${esc(owner.id)}">${ic('left', 16)}${esc(owner.title)}</button>`
    : `<button type="button" class="ghost" data-act="go-view" data-view="home">${ic('left', 16)}${esc(p.name)}</button>`;
  return `<div class="page doc-page">
    <div class="doc-back">${backBtn}<strong>${esc(doc?.title || r.doc)}</strong>
      <span class="doc-hint">${isNote ? `<button type="button" class="btn sm" data-act="hand-note" data-doc="${esc(r.doc)}">${ic('spark', 14)}Hand to an agent</button>` : ''}<button type="button" class="icon-btn" data-act="how-it-works" aria-label="How this folder works" title="How this folder works">${ic('hint', 18)}</button></span></div>
    <div class="reader-host" id="readerHost">${readerHost(p, r.doc)}</div>
    <div class="dock-wrap doc-dock">${composerHTML('doc-' + r.doc, { placeholder:'Add to this file. Images and files become references in the Markdown.', on:'doc' })}</div>
  </div>`;
}
SEND.doc = async ({ text, files }) => {
  const p = project(), r = S.route, path = r.view === 'memory' ? 'MEMORY.md' : r.doc, doc = await loadDoc(p, path, { force:true }), host = $('.reader'), line = allLines(p).find(l => l.topicPath === path);
  // Words added to a Topic's file are one more thing asked, the same as anywhere else.
  if (line) {
    await sendFeedback(line, { text, files });
    const fresh = await loadDoc(project(), path, { force:true });
    Reader.refresh(host, fresh, project());
    Reader.flashEnd(host, fresh);
    toast(`Added to ${line.slug}.md`);
    return;
  }
  const refs = files.length ? await uploadFiles(p, files, 'files') : [];
  await saveDoc(p, doc, path === 'MEMORY.md' ? addedToMemory(doc, text, refs) : appendedMd(doc, text, refs));
  await loadState(p.id, { force:true });
  Reader.refresh(host, doc, project());
  Reader.flashEnd(host, doc);
  toast(`Updated ${doc.path.split('/').pop()}${refs.length ? ` with ${refs.length} ${refs.length === 1 ? 'reference' : 'references'}` : ''}`);
};

// ---------- Archive ----------
// An archived line keeps showing what it holds: the pictures and files you attached or drew, and what the agent made in its folder.
const AR_PICS = 6, AR_FILES = 6;
function lineFilesOf(p, l) {
  const paths = [...l.stations.flatMap(s => [...(s.files || []), ...(s.pictures || [])].map(f => f.path)), ...topicFiles(p, l).map(f => f.path)];
  const all = [...new Set(paths)].filter(path => path !== l.arrow && fileEntry(p, path));
  return { pics:all.filter(isPicturePath), others:all.filter(path => !isPicturePath(path)) };
}
function archiveFiles(p, l) {
  const { pics, others } = lineFilesOf(p, l), more = Math.max(0, pics.length - AR_PICS) + Math.max(0, others.length - AR_FILES);
  if (!pics.length && !others.length) return '';
  return `<div class="ar-files">${pics.slice(0, AR_PICS).map(path => { const name = path.split('/').pop(); return `<button type="button" class="ar-pic" data-act="open-asset" data-path="${esc(path)}" title="${esc(name)}"><img src="${esc(assetUrl(p, path))}" alt="${esc(name)}" loading="lazy"></button>`; }).join('')}${others.slice(0, AR_FILES).map(path => fileChip({ path })).join('')}${more ? `<button type="button" class="ar-more" data-act="open-line" data-line="${esc(l.id)}">+${more}</button>` : ''}</div>`;
}
function archiveHTML(p) {
  const { parents } = orchestratorLinks(p), archived = new Set(p.landed.map(line => line.id)), groups = new Map();
  for (const line of p.landed) {
    let root = line.id;
    const seen = new Set([root]);
    for (let parent = parents.get(root); parent; parent = parents.get(parent.id)) {
      if (seen.has(parent.id)) { root = line.id; break; }
      seen.add(parent.id);
      if (archived.has(parent.id)) root = parent.id;
    }
    if (root !== line.id) {
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root).push(line);
    }
  }
  const grouped = new Set([...groups.values()].flatMap(lines => lines.map(line => line.id)));
  // A hosted update can append a row, and older synced views may still lack archivedAt.
  const rows = p.landed.filter(line => !grouped.has(line.id)).map(l => {
    const at = l.archivedAt || (l.status === 'landed' && Date.parse(String(l.landedAt || '').replace(' ', 'T'))) ||
      l.statusAt || l.lastActivityAt || l.createdAt || NaN;
    return { l, at:new Date(at) };
  }).sort((a, b) => (+b.at || 0) - (+a.at || 0) || a.l.id.localeCompare(b.l.id));
  return `<div class="page archive-page"><div class="ar-list">${rows.map(({ l, at }) => {
    const lastAgent = [...l.stations].reverse().find(s => s.agent && s.agent !== 'you' && s.kind !== 'orch-review')?.agent || 'you';
    const done = l.mergedInto ? `Merged into ${esc(lineById(p, l.mergedInto)?.title || l.mergedInto)}` : l.commit ? `Merged into ${esc(l.base || p.trunk)} · <code>${esc(l.commit)}</code>` : l.closed ? 'Archived' : l.branch ? 'Combined into another Topic' : 'Finished, in the docs folder';
    // Outdated (PE-425) says so first; "Archived" would only repeat the page.
    const what = l.outdated ? `Outdated${done === 'Archived' ? '' : ` · ${done}`}` : done;
    const subSessions = groups.get(l.id) || [];
    const restored = subSessions.filter(child => child.archivedWith === l.id && child.archiveOperation === l.archiveOperation).length;
    const scope = subSessions.length ? ` · ${subSessions.length} ${subSessions.length === 1 ? 'sub-session' : 'sub-sessions'}${restored < subSessions.length ? restored ? ` · ${restored} restore with this job` : ' · Only the job restores' : ''}` : '';
    return `<article class="ar-row ${l.outdated ? 'is-outdated' : ''}">
      ${l.arrow && fileEntry(p, l.arrow) ? `<img class="ar-ink" src="${esc(assetUrl(p, l.arrow))}" alt="The arrow you drew">` : `<span class="ar-doc">${ic(l.closed ? 'archive' : 'files', 24)}</span>`}
      <div class="ar-main"><button type="button" class="row-name" data-act="open-line" data-line="${esc(l.id)}">${esc(l.title)}</button><div class="ar-meta">${what}${scope}</div>${archiveFiles(p, l)}</div>
      <div class="ar-who">${av(lastAgent, 22)}${Number.isFinite(+at) ? `<time datetime="${at.toISOString()}">${nowWhen(at)}</time>` : ''}</div>
      <button type="button" class="btn sm" data-act="reopen-line" data-line="${esc(l.id)}">Back to lines</button>
    </article>`;
  }).join('') || '<p class="empty-line">Nothing archived.</p>'}</div></div>`;
}

// ---------- Deleted: lines, notes, drawings, Canvases and files, for a week ----------
const daysLeft = goneAt => { const d = Math.max(0, Math.ceil((goneAt - Date.now()) / 86400000)); return d <= 1 ? 'Gone for good within a day' : `Gone for good in ${d} days`; };
const agoWords = ms => { const m = Math.max(0, Math.round((Date.now() - ms) / 60000)); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
const DELETED_PAGE_SIZE = 20, DELETED_TABS = [['lines', 'Lines'], ['items', 'Items']];
const deletedViews = new Map();

function deletedPager(page, pages, bottom = false) {
  const button = (step, label, icon, disabled) => `<button type="button" class="btn sm" data-act="deleted-page" data-step="${step}" aria-label="${label} page" aria-describedby="deleted-page-status" ${disabled ? 'disabled' : ''}>${ic(icon, 16)}</button>`;
  return `<nav class="del-pager${bottom ? ' del-pager-bottom' : ''}" aria-label="Deleted pages">${button(-1, 'Previous', 'left', page === 1)}<span ${bottom ? 'aria-hidden="true"' : 'id="deleted-page-status" tabindex="-1"'}>Page ${page} of ${pages}</span>${button(1, 'Next', 'right', page === pages)}</nav>`;
}

function deletedLineHTML(l) {
  return `<article class="del-row"><span class="del-ic">${ic('doc', 20)}</span><div class="del-main"><strong>${esc(l.title)}</strong><span>Line · deleted ${esc(agoWords(l.deletedAt))} · ${esc(daysLeft(l.goneAt))}</span></div><button type="button" class="btn sm" data-act="restore-line" data-slug="${esc(l.slug)}">Restore</button></article>`;
}

function deletedItemHTML(p, { kind, item:n }) {
  if (kind !== 'nodes') return deletedFileHTML(p, n, kind);
  const label = removedWord(n.kind);
  return `<article class="del-row"><span class="del-ic">${ic(n.kind === 'canvas' ? 'canvas' : n.kind === 'note' ? 'note' : 'check', 20)}</span><div class="del-main"><strong>${esc(n.words || label)}</strong><span>${label} from ${esc(n.line || n.slug)} · removed ${esc(agoWords(Date.parse(n.removedAt)))} · ${esc(daysLeft(n.goneAt))}</span></div>${n.lineGone ? '<span class="del-wait">Restore its line first</span>' : `<button type="button" class="btn sm" data-act="restore-node" data-line="${esc(n.slug)}" data-removed="${esc(n.removed)}">Restore</button>`}</article>`;
}

function deletedHTML(p) {
  const d = p.deleted || {}, lines = d.lines || [];
  const itemGroups = [['nodes', d.nodes || []], ['canvases', d.canvases || []], ['files', d.files || []]];
  const counts = { lines:lines.length, items:itemGroups.reduce((sum, [, items]) => sum + items.length, 0) };
  let state = deletedViews.get(p.id);
  if (!state) {
    state = { tab:!counts.lines && counts.items ? 'items' : 'lines', pages:{ lines:1, items:1 } };
    deletedViews.set(p.id, state);
  }
  const { tab } = state;
  const pages = Math.max(1, Math.ceil(counts[tab] / DELETED_PAGE_SIZE));
  const page = state.pages[tab] = Math.min(state.pages[tab], pages);
  const start = (page - 1) * DELETED_PAGE_SIZE, end = start + DELETED_PAGE_SIZE;
  const rows = tab === 'lines'
    ? lines.slice(start, end).map(deletedLineHTML)
    : itemGroups.flatMap(([kind, items]) => items.map(item => ({ kind, item, at:item.deletedAt || Date.parse(item.removedAt) || 0 })))
      .sort((a, b) => b.at - a.at).slice(start, end).map(row => deletedItemHTML(p, row));
  const empty = counts.lines || counts.items ? `No deleted ${tab}.` : 'Nothing deleted in the last week.';
  return `<div class="page deleted-page"><p class="del-why">What you delete stays here for ${d.days ?? 7} days, then it is gone for good.</p>
    <div class="del-toolbar"><div class="seg del-tabs" role="tablist" aria-label="Deleted">
      ${DELETED_TABS.map(([key, label]) => `<button type="button" role="tab" id="deleted-${key}-tab" aria-controls="deleted-${key}-panel" aria-selected="${tab === key}" tabindex="${tab === key ? 0 : -1}" data-act="deleted-tab" data-tab="${key}">${label} <span class="del-count">${counts[key]}</span></button>`).join('')}
    </div>${pages > 1 ? deletedPager(page, pages) : ''}</div>
    ${DELETED_TABS.map(([key]) => `<section role="tabpanel" id="deleted-${key}-panel" aria-labelledby="deleted-${key}-tab" ${key === tab ? 'tabindex="0"' : 'hidden'}>${key === tab ? `<div class="del-group">${rows.join('') || `<p class="empty-line">${empty}</p>`}</div>${pages > 1 ? deletedPager(page, pages, true) : ''}` : ''}</section>`).join('')}</div>`;
}
ACT['deleted-tab'] = el => {
  const state = deletedViews.get(project()?.id);
  if (!state || state.tab === el.dataset.tab) return;
  state.tab = el.dataset.tab;
  render();
  $('#view .del-tabs [aria-selected="true"]')?.focus({ preventScroll:true });
};
ACT['deleted-page'] = el => {
  const state = deletedViews.get(project()?.id);
  if (!state) return;
  const { step } = el.dataset;
  state.pages[state.tab] += Number(step);
  render();
  const next = $(`#view .del-toolbar [data-step="${step}"]:enabled`) || $('#deleted-page-status');
  next?.focus({ preventScroll:true });
};
document.addEventListener('keydown', e => {
  const tab = e.target.closest?.('.del-tabs [role="tab"]');
  if (!tab || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  const tabs = tab.parentElement;
  const next = e.key === 'Home' ? tabs.firstElementChild : e.key === 'End' ? tabs.lastElementChild
    : e.key === 'ArrowLeft' || e.key === 'ArrowRight' ? tab.nextElementSibling || tab.previousElementSibling : null;
  if (next) { e.preventDefault(); ACT['deleted-tab'](next); }
});
async function restoreLine(slug, p = project()) {
  try { await api(`${pathFor(p.id)}/restore-line`, { method:'POST', body:{ slug } }); await loadState(p.id, { force:true, view:S.cur !== p.id ? 'rail' : undefined }); await loadProjects(); refreshChrome(); render(); toast('Line restored', { label:'Open', fn:() => ACT['open-line']({ dataset:{ p:p.id, line:slug } }) }); }
  catch (error) { toast(error.message); }
}
ACT['restore-line'] = el => restoreLine(el.dataset.slug);
ACT['restore-node'] = el => { const l = lineById(project(), el.dataset.line); if (!l) { toast('Restore its line first.'); return; } act(l, 'restore-yours', { removed:el.dataset.removed }).then(() => { refreshChrome(); render(); toast('Restored', { label:'Open', fn:() => go({ view:'line', line:l.id }) }); }).catch(error => toast(error.message)); };

// ---------- Switching projects ----------
const SW = { i:0, list:[] };
function statusLine(s) {
  const n = summaryNeeds(s), w = summaryWorking(s), bits = [];
  if (s.missing) return 'Folder not found';
  if (n) bits.push(`${n} need${n === 1 ? 's' : ''} you`);
  if (w) bits.push(`${w} working`);
  if (!bits.length) { if (s.pictures) bits.push(`${s.pictures} ${s.pictures === 1 ? 'picture' : 'pictures'}`); if (s.notes) bits.push(`${s.notes} ${s.notes === 1 ? 'note' : 'notes'}`); if (s.landed?.length) bits.push(`${s.landed.length} landed`); if (!bits.length) bits.push('Empty'); }
  return bits.join(' · ');
}
function switcherGroups() {
  const shelf = S.projects.filter(p => p.archived), all = S.projects.filter(p => !p.archived);
  const need = all.filter(p => summaryNeeds(p)), work = all.filter(p => !summaryNeeds(p) && summaryWorking(p));
  const used = new Set([...need, ...work].map(p => p.id));
  const pinned = all.filter(p => p.pinned && !used.has(p.id)); pinned.forEach(p => used.add(p.id));
  const recent = S.tabs.map(summaryOf).filter(p => p && !used.has(p.id)); recent.forEach(p => used.add(p.id));
  const rest = all.filter(p => !used.has(p.id)).sort((a, b) => a.name.localeCompare(b.name));
  const cloud = !(typeof HOSTED !== 'undefined' && HOSTED) && typeof cloudAway === 'function' ? cloudAway().map(c => ({ ...c, id:'', color:cloudColor(c.key), cloudOnly:true })) : [];
  return [{ title:'Needs you', items:need }, { title:'Working', items:work }, { title:'Pinned', items:pinned }, { title:'Recent', items:recent }, { title:'All projects', items:rest }, { title:'In PenEcho Cloud', items:cloud }, { title:'Archived', items:shelf }].filter(g => g.items.length);
}
function renderSwitcher() {
  const host = $('#switcher'); if (!host || host.hidden) return;
  const hadFocus = host.contains(document.activeElement), groups = switcherGroups();
  SW.list = groups.flatMap(g => g.items);
  SW.i = clamp(SW.i, 0, Math.max(0, SW.list.length - 1));
  let n = -1;
  $('#swList').innerHTML = groups.map(g => `${g.title ? `<div class="sw-group">${g.title}</div>` : ''}${g.items.map(p => { n++;
    if (p.cloudOnly) {
      const sub = p.cloudMade ? 'Cloud-only · Open on penecho.ai' : 'PenEcho Cloud · Open on penecho.ai';
      return `<div class="sw-row ${n === SW.i ? 'on' : ''}" data-i="${n}" role="option" aria-selected="${n === SW.i}">
      <button type="button" class="sw-open" data-act="open-cloud-project" data-key="${esc(p.key)}" title="${esc(p.name)} · Open on penecho.ai">${glyph(p, 28)}<span class="sw-text"><strong>${esc(p.name)}</strong><span>${esc(sub)}</span></span>${ic('cloud', 15)}</button>
    </div>`;
    }
    return `<div class="sw-row ${n === SW.i ? 'on' : ''}" data-i="${n}" role="option" aria-selected="${n === SW.i}">
      <button type="button" class="sw-open" data-act="sw-open" data-p="${esc(p.id)}">${glyph(p, 28)}<span class="sw-text"><strong>${esc(p.name)}</strong><span>${esc(statusLine(p))}</span></span>${tabStatus(p)}</button>
      <button type="button" class="icon-btn tiny sw-star ${p.pinned ? 'pinned' : ''}" data-act="sw-pin" data-p="${esc(p.id)}" aria-label="${p.pinned ? 'Unpin' : 'Pin'} ${esc(p.name)}" aria-pressed="${!!p.pinned}">${ic('star', 16)}</button>
    </div>`; }).join('')}`).join('') || '<p class="empty-line">No projects yet.</p>';
  const cur = SW.list[SW.i];
  $('#swPreview').innerHTML = cur ? previewHTML(cur) : '';
  $('#swList .on')?.scrollIntoView({ block:'nearest' });
  if (hadFocus) $('#swList .sw-row.on .sw-open')?.focus();
}
function previewHTML(p) {
  if (p.cloudOnly) {
    const facts = [Number.isFinite(p.lines) && p.lines !== null ? `${p.lines} line${p.lines === 1 ? '' : 's'}` : '', p.sizeBytes ? cloudSize(p.sizeBytes) : '', cloudAgo(p.updatedAt)].filter(Boolean);
    return `<div class="sw-p-head">${glyph(p, 36)}<div><h3>${esc(p.name)}</h3><p>${esc(p.cloudMade ? 'Cloud-only project' : 'In PenEcho Cloud')}</p></div></div>
      <div class="sw-p-thumb empty">${ic('cloud', 22)}${esc(facts.length ? facts.join(' · ') : 'Opens on penecho.ai')}</div>
      <button type="button" class="btn primary sw-go" data-act="open-cloud-project" data-key="${esc(p.key)}">Open on penecho.ai</button>`;
  }
  if (p.missing) return `<div class="sw-p-head">${glyph(p, 36)}<div><h3>${esc(p.name)}</h3><p>Folder not found</p></div></div>
    <code class="sw-p-path" title="${esc(p.docsPath)}">${esc(p.docsPath)}</code>
    <div class="sw-p-fix"><button type="button" class="btn primary" data-act="sw-relocate" data-p="${esc(p.id)}">Choose its new place</button><button type="button" class="btn" data-act="sw-forget" data-p="${esc(p.id)}">Remove from this list</button></div>`;
  const url = p.thumb ? `/api/lines/projects/${encodeURIComponent(p.id)}/file?path=${encodeURIComponent(p.thumb)}` : '';
  return `<div class="sw-p-head">${glyph(p, 36)}<div><h3>${esc(p.name)}</h3><p>${esc(statusLine(p))}</p></div></div>
    <code class="sw-p-path" title="${esc(p.docsPath)}">${esc(p.docsPath)}</code>
    ${(p.lines?.length || p.landed?.length) ? `<div class="sw-p-map">${miniMap(p)}</div>` : url ? `<div class="sw-p-thumb"><div class="ft ft-img"><img src="${esc(url)}" alt=""></div></div>` : `<div class="sw-p-thumb empty">${ic('spark', 22)}Ready for its first request</div>`}
    ${p.lines?.length ? `<ul class="sw-p-lines">${p.lines.slice(0, 4).map(l => `<li>${stateChip(lineState(l), l)}<span>${esc(l.title)}</span></li>`).join('')}</ul>` : ''}
    <button type="button" class="btn primary sw-go" data-act="sw-open" data-p="${esc(p.id)}">Open ${esc(p.name)}</button>
    <button type="button" class="ghost tiny-g sw-forget" data-act="sw-forget" data-p="${esc(p.id)}">Remove from this list</button>`;
}
async function openSwitcher() {
  const host = $('#switcher'); host.hidden = false; SW.i = 0; SW.returnTo = document.activeElement;
  renderSwitcher();
  $('#swList .sw-row.on .sw-open')?.focus();
  loadProjects().then(renderSwitcher).catch(() => {});
}
function closeSwitcher() { const h = $('#switcher'); if (h.hidden) return; h.hidden = true; SW.returnTo?.focus?.(); }
// `fresh` is for a caller that has just changed something in that project and opens it to show the change.
async function switchProject(id, { view, route:wanted, fresh = false } = {}) {
  // Beside a Canvas the rail only says where to go. The Canvas page saves its Canvas and the project opens there, read once, not here first.
  if (EMBED?.rail) {
    const route = wanted || (view ? { view } : lastProjectRoute(id)), was = S.cur;
    railGoing(id);
    api(`${pathFor(id)}?opened=1`, { method:'PATCH', body:{ opened:true } }).catch(() => {});
    S.cur = id;
    try { embedTell({ leave:`/projects.html#${routeToHash(route)}` }); } finally { S.cur = was; }
    return;
  }
  const transition = ++navigationTransition;
  if (typeof window !== 'undefined' && window.PenEchoCanvasShell?.active) {
    railGoing(id);
    const closed = await window.PenEchoCanvasShell.close({ refresh:false });
    if (transition !== navigationTransition) return;
    if (!closed) { railGoing(null); return; }
  }
  if (!await saveOpenEdit()) return;
  if (transition !== navigationTransition) return;
  captureProjectPosition(); rememberProjectRoute();
  // A project this page has already read opens at once from what it has, and is read again right after (the look below).
  const known = !fresh && Boolean(S.data[id]);
  if (!known) railGoing(id);
  try { if (!known) await loadState(id, { force:true, route:wanted || (view ? { view } : lastProjectRoute(id)) }); else await holdFor(S.data[id], wanted || (view ? { view } : lastProjectRoute(id))); }
  catch (error) {
    if (transition !== navigationTransition) return;
    railGoing(null);
    toast(error.message);
    if (error.status === 410) { await loadProjects().catch(() => {}); if (transition !== navigationTransition) return; openSwitcher(); SW.i = Math.max(0, SW.list.findIndex(x => x.id === id)); renderSwitcher(); }
    return;
  }
  if (transition !== navigationTransition) return;
  const route = wanted || (view ? { view } : lastProjectRoute(id)), position = view && !wanted ? null : projectPosition(id, route);
  const projectChanged = id !== S.cur;
  if (projectChanged) S.panelPopped = false;
  S.cur = id; S.plan = []; S.next = null;
  S.panelShut = position?.panelShut ? route.line : null;
  S.lineFilter = projectLineFilter(id, route);
  boxUrls(project());
  if (!S.tabs.includes(id)) S.tabs.push(id);
  rememberTabs();
  const s = summaryOf(id); if (s) s.lastOpenedAt = Date.now();
  api(`${pathFor(id)}?opened=1`, { method:'PATCH', body:{ opened:true } }).catch(() => {});
  go(route, { savedEdit:true, keepDocTrail:true, projectChanged });
  restoreProjectPosition(position);
  // Read again after switching so any in-progress transition finishes cleanly before redrawing.
  if (known) setTimeout(poll, Math.max(0, zoomEnds - performance.now()));
}
function rememberTabs() { try { localStorage.setItem('penecho-lines', JSON.stringify({ tabs:S.tabs, cur:S.cur, routes:S.routes })); } catch { /* Keep this visit's routes. */ } }
ACT['open-switcher'] = () => openSwitcher();
ACT['switch-project'] = el => {
  const s = summaryOf(el.dataset.p);
  if (s?.missing) { openSwitcher(); SW.i = Math.max(0, SW.list.indexOf(s)); renderSwitcher(); return; }
  // The project you were last in still opens from New project, or from anywhere but its home; on its home, clicking it resets filters to the default page. In the sidebar it also folds (railNameFolds).
  const folds = Boolean(s) && typeof railNameFolds === 'function' && railNameFolds(el);
  if (el.dataset.p === S.cur) {
    const onCanvas = typeof window !== 'undefined' && window.PenEchoCanvasShell?.active;
    if (onCanvas || S.newPage || S.shelfPage || S.route.view !== 'home') { if (folds) railSetOpen(s, true); go({ view:'home' }); }
    else { if (folds) railSetOpen(s, !railIsOpen(s)); if (typeof resetHomeFilters === 'function') resetHomeFilters(); }
    return;
  }
  if (folds) railSetOpen(s, true);
  switchProject(el.dataset.p);
};
// New project is a page: what a project and its lines are, a picture of it, then the form. The empty Canvas links here.
ACT['new-project'] = () => { closeSwitcher(); location.hash = 'new'; };
// Archived projects are a tab of Settings. A row opens the project; Restore puts it back in the sidebar.
ACT['open-archived'] = () => openSettings('archived');
function archivedProjectsHTML() {
  const shelf = S.projects.filter(p => p.archived).sort((a, b) => (b.archivedAt || 0) - (a.archivedAt || 0));
  return `<div class="shelf-page sys-archived">
    ${shelf.length ? `<div class="shelf-list">${shelf.map(p => `<div class="shelf-row">
      <button type="button" class="shelf-open" data-act="switch-project" data-p="${esc(p.id)}">${glyph(p, 30)}<span class="shelf-text"><strong>${esc(p.name)}</strong><code title="${esc(p.docsPath)}">${esc(homeShort(p.docsPath))}</code></span>${p.archivedAt ? `<time>${esc(dayWhen(p.archivedAt))}</time>` : ''}</button>
      <button type="button" class="btn sm" data-act="shelf-restore" data-p="${esc(p.id)}">Restore</button>
      <button type="button" class="ghost tiny-g shelf-delete" data-act="shelf-delete" data-p="${esc(p.id)}" title="Delete ${esc(p.name)}" aria-label="Delete ${esc(p.name)}">${ic('trash', 15)}</button>
    </div>`).join('')}</div>` : '<p class="empty-line">Nothing archived.</p>'}
  </div>`;
}
// Delete takes an archived project out of PenEcho for good. Your folders stay; an example's, which PenEcho made, go with it.
ACT['shelf-delete'] = el => {
  const s = summaryOf(el.dataset.p); if (!s) return;
  const dialog = document.createElement('dialog');
  dialog.className = 'line-command-dialog';
  dialog.setAttribute('aria-labelledby', 'shelfDeleteTitle');
  dialog.innerHTML = `<form><h2 id="shelfDeleteTitle">Delete project?</h2><p><strong>${esc(s.name)}</strong> will leave PenEcho for good. This cannot be undone.</p><p>${s.example ? 'Its example folders, which PenEcho made, are deleted too.' : `Its folders stay where they are: <code>${esc(homeShort(s.docsPath))}</code>${s.code && s.code !== s.docsPath ? ` and <code>${esc(homeShort(s.code))}</code>` : ''}.`}</p><p class="command-error" role="alert" hidden></p><footer><button type="button" class="btn" data-cancel>Cancel</button><button type="submit" class="btn danger">Delete project</button></footer></form>`;
  document.body.append(dialog);
  dialog.addEventListener('close', () => { dialog.remove(); if (el.isConnected) el.focus(); });
  $('[data-cancel]', dialog).onclick = () => dialog.close();
  $('form', dialog).onsubmit = async e => {
    e.preventDefault(); const submit = $('button[type="submit"]', dialog); submit.disabled = true;
    try {
      await api(pathFor(s.id), { method:'DELETE' });
      dialog.close();
      S.tabs = S.tabs.filter(x => x !== s.id); delete S.data[s.id]; rememberTabs();
      if (S.cur === s.id) S.cur = S.projects.find(x => !x.archived && !x.missing && x.id !== s.id)?.id || null;
      await loadProjects();
      render();
      toast(`Deleted ${s.name}`);
    } catch (error) { const message = $('.command-error', dialog); message.hidden = false; message.textContent = error.message; submit.disabled = false; }
  };
  dialog.showModal();
  $('[data-cancel]', dialog).focus();
};
ACT['shelf-restore'] = async el => {
  const s = summaryOf(el.dataset.p); if (!s) return;
  el.disabled = true;
  try {
    await api(pathFor(s.id), { method:'PATCH', body:{ archived:false } });
    await loadProjects();
    if (s.id === S.cur) await loadState(s.id, { force:true });
    render();
    toast(`Restored ${s.name}`, { label:'Open', fn:() => switchProject(s.id, { fresh:true }) });
  } catch (error) { toast(error.message); el.disabled = false; }
};
// The agents on this computer while they are checked, then which can run, which need a fix and which are not installed.
function npAgentState(a) {
  const found = S.agentCheck?.agents?.find(x => x.id === a.id);
  if (canCheckAgents() && (S.agentChecking || (!S.agentCheck && !S.agentCheckError))) return 'checking';
  if (found) return found.state === 'ready' ? 'ready' : found.state === 'problem' ? 'fix' : 'off';
  return a.available ? 'ready' : 'off';
}
ACT['np-recheck'] = async () => { const run = checkAgents({ fresh:true }); refreshEmptyAgents(); await run; refreshEmptyAgents(); };
// New project: header, the 8 simple feature points above, and the Create project form centered below (PE-823).
// The example projects are in the sidebar already; penecho.ai has no Orchestrator, so hosted copy omits it.
const newProjectHTML = () => `<div class="page np-page">
    <div class="np-grid">
      <header class="np-head">
        <h1 class="np-title">New project</h1>
        <p class="np-tagline">Not another AI agent. A better way to work with yours.</p>
      </header>
      <section class="np-gives">${PenEchoProjects.benefitsHTML('en', S.agents, { agentsRow:false, heading:false, orchestrator:!HOSTED })}</section>
      <section class="np-card" aria-label="Create a project"><div id="startPanel"></div></section>
    </div>
  </div>`;
function mountNewProject() {
  // On penecho.ai a project needs only its name, and the examples are offered here to add one by one (each takes room in Cloud).
  const cloud = typeof hostedNewProject === 'function' ? hostedNewProject() : null;
  PenEchoProjects.mount($('#startPanel'), { projects:S.projects, agents:S.agents, showExamples:Boolean(cloud), showTitle:false, showBenefits:false, ...(cloud || {}), onCreated:async (made, extra) => {
    S.newPage = false;
    await openMade(made, extra);
  } });
  $('#startPanel [name=name]')?.focus();
}
ACT['sw-open'] = el => { const s = summaryOf(el.dataset.p); if (s?.missing) { SW.i = SW.list.indexOf(s); renderSwitcher(); return; } closeSwitcher(); switchProject(el.dataset.p); };
ACT['sw-relocate'] = el => {
  const s = summaryOf(el.dataset.p);
  closeSwitcher();
  pathForm({ title:'Docs folder', label:`Where ${s.name} keeps its files now`, value:s.docsPath, pick:'Choose the docs folder', onSave:async value => {
    await api(pathFor(s.id), { method:'PATCH', body:{ docsPath:value } });
    S.docs = {};
    await loadProjects();
    await switchProject(s.id);
  } });
};
ACT['sw-forget'] = async el => {
  const id = el.dataset.p, s = summaryOf(id), wasOpen = S.cur === id;
  try {
    await api(pathFor(id), { method:'DELETE' });
    S.tabs = S.tabs.filter(x => x !== id); delete S.data[id]; rememberTabs();
    await loadProjects();
    toast(`Removed ${s.name} from this list. Its folder is untouched.`);
    if (wasOpen) { const next = S.projects.find(x => !x.missing); S.cur = null; closeSwitcher(); if (next) await switchProject(next.id); else go({ view:'home' }); }
    else { renderRail(); renderSwitcher(); }
  } catch (error) { toast(error.message); }
};
ACT['sw-pin'] = async el => { const s = summaryOf(el.dataset.p); s.pinned = !s.pinned; renderSwitcher(); renderRail(); await api(pathFor(s.id), { method:'PATCH', body:{ pinned:s.pinned } }).catch(error => toast(error.message)); };
ACT['go-view'] = el => go({ view:el.dataset.view });
// The project bar's More (PE-478): secondary project views grouped with dividers (Insights & Context, Lifecycle, Configuration).
// Statistics stays on the bar for a project with lines while the bar has room for it (PE-431); otherwise it folds into More.
const statsOnBar = p => Boolean(p && !p.myCanvases && allLines(p).length && !S.statsInMore);
const canCreateKnowledgeTopic = projectData => Boolean(projectData && projectData.projectTopics !== false && !projectData.myCanvases && !HOSTED && S.thisComputer !== false);
const topicsViewAvailable = (projectData, hasWork = projectData && allLines(projectData).length > 0) => Boolean(projectData && projectData.projectTopics !== false && (hasWork || projectData.knowledge?.length || projectData.understanding || canCreateKnowledgeTopic(projectData)));
// The Orchestrator (PE-613) is on the bar too while there is room: on a computer, and on penecho.ai for a project that lives on one
// (it runs that computer's saved agents).
const orchOnBar = p => Boolean(p && !(HOSTED && !HOSTED.onComputer) && !(p.myCanvases && !allLines(p).length) && !S.orchInMore);
const moreViewAllowed = k => (typeof viewHere !== 'function' || viewHere(k)) && !(HOSTED?.read && (k === 'settings' || k === 'deleted'));
function moreViewGroups() {
  const p = project(), bare = Boolean(p?.myCanvases && !allLines(p).length);
  const groups = bare ? [
    [['settings', 'Project settings', 'gear']],
  ] : [
    [
      ...(foldedOff('topics') && topicsViewAvailable(p) ? [['topics', 'Topics', 'navTopics']] : []),
      ...(foldedOff('files') ? [[p?.myCanvases ? 'canvases' : 'files', 'Canvases & files', 'navCanvases']] : []),
      ...(orchOnBar(p) ? [] : [['orchestrator', 'Orchestrator', 'orchestrate']]),
    ],
    [
      ...(statsOnBar(p) ? [] : [['stats', 'Statistics', 'navStats']]),
      ['memory', 'Memory', 'navMemory'],
      ['vault', 'Vault', 'navVault'],
    ],
    [
      ['archive', 'Archive', 'navArchive'],
      ['deleted', 'Deleted', 'navDeleted'],
    ],
    [
      ['settings', 'Project settings', 'gear'],
    ],
  ];
  return groups.map(g => g.filter(([k]) => moreViewAllowed(k))).filter(g => g.length);
}
const moreViews = () => moreViewGroups().flat();
ACT['more-views'] = el => {
  if ($('#menu.more-views-menu')) { closeMenu(); return; }
  const pid = S.cur, view = S.route.view, nav = typeof navigationTransition === 'number' ? navigationTransition : 0;
  const items = moreViewGroups().flatMap((group, i) => [
    ...(i ? [{ sep:true }] : []),
    ...group.map(([k, label, icon]) => ({ label, icon, on:view === k || isFilesView(k) && isFilesView(view), fn:() => go({ view:k }) })),
  ]);
  openMenu(el, items, {
    className:'more-views-menu',
    resolveAnchor:() => {
      if (S.cur !== pid || S.route.view !== view || S.newPage || S.shelfPage) return null;
      if (typeof navigationTransition === 'number' && navigationTransition !== nav) return null;
      return el.isConnected ? el : $('#projbar [data-act="more-views"]');
    },
  });
};
const welcomeHTML = () => `<div class="page empty-page welcome-page"><div class="empty-inner" id="welcomePanel"></div></div>`;
function mountWelcome() {
  PenEchoProjects.mount($('#welcomePanel'), { projects:S.projects, agents:S.agents, showModel:true, onExample:async made => { await loadProjects(); await switchProject(made.id); }, onCreated:openMade });
}

// A warning closes like the Needs you strip, and a different warning for the same line still shows.
const warningMark = w => needMark({ kind:'deletion', step:w.slug, words:w.message });
const lineWarningsHTML = p => (p.deletionWarnings || []).filter(w => !needIsHidden(`${p.id}:warnings`, warningMark(w))).map(w => `<p class="deletion-warning" role="alert"><span>${esc(w.slug)}: ${esc(w.message)} Original: <code>${esc(w.original)}</code>. Recovery: <code>${esc(w.recovery)}</code>.</span><button type="button" class="need-close" data-act="warning-close" data-mark="${esc(warningMark(w))}" aria-label="Close" title="Close">${ic('x', 15)}</button></p>`).join('');
ACT['warning-close'] = el => {
  const p = project(), host = $('#lineWarnings');
  if (!p || !host) return;
  hideNeedMark(`${p.id}:warnings`, el.dataset.mark, (p.deletionWarnings || []).map(warningMark));
  host.innerHTML = host.dataset.h = lineWarningsHTML(p);
};
