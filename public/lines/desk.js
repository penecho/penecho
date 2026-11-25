// The desk: Token savings, Topics, what needs you, and the lines.
// It is worked out from what is in the folder, so a project has no type to choose.

// ---------- What the folder holds decides what the home shows ----------
const isDeckLine = l => (l.labels || []).includes('Slides');
const deckFiles = p => p.files.filter(f => /\.(pptx?|key|odp)$/i.test(f.path) && !f.path.includes('/_incoming/')).sort((a, b) => b.mtime - a.mtime);
// A project whose lines are all archived or deleted is empty again: it starts over on the empty project page, not on a list of nothing,
// whatever those lines left in the folder. A folder of notes or Canvases that never had a line keeps its own page.
const hadLines = p => p.landed.length > 0 || (p.deleted?.lines.length || 0) > 0;
function homeShape(p) {
  if (!hasContent(p) || (!p.lines.length && hadLines(p))) return 'empty';
  if (!p.code && ([...p.lines, ...p.landed].some(isDeckLine) || deckFiles(p).length)) return 'deck';
  if (p.code || allLines(p).length) return 'map';
  return p.pictures.some(c => c.hasPicture) ? 'canvas' : 'notes';
}
const showsMap = p => [...p.lines, ...p.landed].some(l => p.code || !isDeckLine(l));
const composerWords = p => ({
  map:'Start a new line. Type / for quick starts.',
  deck:'Start a new line, or add a source',
  canvas:'Start a new line. Type / for quick starts.',
  notes:'Write a note. Type / to ask an agent.',
}[homeShape(p)] || 'Start a new line');

const isGrillStop = l => lineState(l) === 'wait' && currentStation(l).kind === 'grill';
// What Reply answers, in the agent's words.
const replyWords = l => { const cur = currentStation(l); return isGrillStop(l) ? questionIn(l.result?.text) || plainOut(cur.out || cur.why) : askedYou(l); };
// The box on that Topic's page is where you answer.
ACT['need-reply'] = el => {
  const p = project(), l = lineById(p, el.dataset.line);
  if (l) rememberReply(p, l, replyWords(l));
  const wantedStep = el.dataset.step || '';
  const canChooseLocal = Boolean(l && !l.closed && !l.archived && !l.elsewhere && !(typeof HOSTED !== 'undefined' && HOSTED?.read));
  const waitStep = (wantedStep && typeof stationById === 'function' && l ? stationById(l, wantedStep) : null)
    || l?.stations?.find(s => isWork(s) && ((s.asking?.kind === 'tool' && s.asking.answerable && s.asking.isBlocking !== false) || (canChooseLocal && s.questions?.length)))
    || (canChooseLocal ? l?.stations?.find(s => isWork(s) && s.waitingReply) : null)
    || l?.stations?.find(s => isWork(s) && (s.asked || (s.asking?.kind === 'tool' && s.asking.isBlocking !== false))) || l?.stations?.find(s => isWork(s) && s.state === 'wait')
    || l?.stations?.find(s => isWork(s) && (s.asking || s.questions?.length));
  go({ view:'line', line:el.dataset.line, ...(waitStep ? { step:waitStep.id } : {}) }, { from:el });
  let tries = 0;
  const focus = () => {
    if (S.route?.line !== el.dataset.line || (waitStep && S.route.step !== waitStep.id)) return;
    const target = S.flying ? null : ($('#lpPanel .q-card .q-input') || $('#lpPanel .q-card button') || $('#lpPanel .q-card'));
    if (target && (!waitStep || !target.closest || target.closest('.q-card')?.dataset.step === waitStep.id)) {
      target.scrollIntoView?.({ block:'nearest' });
      target.focus?.();
    } else if (tries++ < 40) setTimeout(focus, 50);
  };
  focus();
};
// ---------- A small track of stops, for places too small for the map ----------
function miniStops(l) {
  const state = lineState(l), cur = currentStation(l);
  return `<ol class="mini-stops" style="--c:${STATE_COLOR[state] || 'var(--ink3)'}">${l.stations.map(s => `<li class="m-${s.state} ${s === cur ? 'cur' : ''}"><button type="button" data-act="open-step" data-line="${esc(l.id)}" data-step="${esc(s.id)}"><i></i><span>${esc(stepLabel(s))}</span></button></li>`).join('')}</ol>`;
}

// ---------- Slides, when the folder is making some ----------
const outlineOf = p => p.files.find(f => /outline[^/]*\.md$/i.test(f.path));
function deckSources(p, l) {
  const made = new Set(deckFiles(p).map(f => f.path)), seen = new Set(), list = [];
  const add = (path, name) => { if (seen.has(path) || made.has(path)) return; seen.add(path); list.push({ path, name, size:fileEntry(p, path)?.size }); };
  for (const f of l?.ask.files || []) add(f.path, f.name);
  for (const f of p.files) if (f.path.startsWith('files/') && !f.path.includes('/_incoming/') && !/\.(md|png|jpe?g|gif|webp|svg|tmp|penecho\.json|diagram\.json|explorer\.html)$/i.test(f.path)) add(f.path, f.path.split('/').pop());
  return list;
}
const deckLineOf = p => [...p.lines, ...[...p.landed].reverse()].find(isDeckLine);
function heroPaths(p) {
  const l = deckLineOf(p);
  return new Set([...deckFiles(p).map(f => f.path), ...deckSources(p, l).map(f => f.path), outlineOf(p)?.path].filter(Boolean));
}
function deckHeroHTML(p) {
  if (homeShape(p) !== 'deck') return '';
  const l = deckLineOf(p), made = deckFiles(p)[0], title = l?.title || made.path.split('/').pop().replace(/\.[^.]+$/, '');
  const cur = l && currentStation(l), state = l && lineState(l), pic = l && resultPictures(p, l)[0], outline = outlineOf(p), outlineDoc = outline && docById(outline.path, p);
  const open = made ? `data-act="open-asset" data-path="${esc(made.path)}"` : l ? `data-act="open-line" data-line="${esc(l.id)}"` : '';
  const resume = l && lineContinue(l, 'btn primary');
  const stoppedAction = state === 'error' && (lineWorking(l) ? lineStopButton(l, 'btn') :
    `${resume}<button type="button" class="btn${resume ? '' : ' primary'}" data-act="line-do" data-verb="retry" data-line="${esc(l.id)}">${ic('retry', 15)}Retry</button>`);
  const primary = state === 'wait' ? `<button type="button" class="btn primary" data-act="open-step" data-line="${esc(l.id)}" data-step="${esc(cur.id)}">Review ${esc(stepLabel(cur).toLowerCase())}</button>`
    : state === 'error' ? stoppedAction
    : made ? `<button type="button" class="btn primary" data-act="open-asset" data-path="${esc(made.path)}">${ic('slides', 15)}Open slides</button>` : '';
  const sources = deckSources(p, l), heads = outlineDoc ? parseMd(outlineDoc.md).filter(b => b.t === 'h' && b.lvl === 2).map(b => b.text) : [];
  return `<section class="deck-hero" aria-label="Slides">
    <div class="dh-top">
      <button type="button" class="dh-slide" ${open} aria-label="Open ${esc(title)}">${pic ? `<img src="${esc(assetUrl(p, pic.path))}" alt="">` : presetArt('slides')}</button>
      <div class="dh-main">
        <h2>${esc(title)}</h2>
        ${l ? stateChip(state, l) : ''}
        <div class="dh-acts">${primary}${outline ? `<button type="button" class="btn" data-act="open-doc" data-doc="${esc(outline.path)}">${ic('doc', 15)}Outline</button>` : ''}</div>
        ${l ? miniStops(l) : ''}
      </div>
    </div>
    ${sources.length || heads.length ? `<div class="dh-lists">
      ${sources.length ? `<div class="dh-list"><h3>Sources<em>${sources.length}</em></h3><ul>${sources.slice(0, 8).map(f => `<li>${ic(FILE_ICON(f.name), 16)}<span>${esc(f.name)}</span>${f.size ? `<small>${esc(fmtSize(f.size))}</small>` : ''}</li>`).join('')}</ul></div>` : ''}
      ${heads.length ? `<div class="dh-list"><h3>Outline<em>${heads.length}</em></h3><ol>${heads.map(h => `<li>${esc(h)}</li>`).join('')}</ol></div>` : ''}
    </div>` : ''}
  </section>`;
}
// Files dropped on a deck are its sources. You stay where you are.
async function addSources(p, files) {
  await uploadFiles(p, files, 'files');
  await loadState(p.id, { force:true });
  refreshAfterChange();
  toast(files.length === 1 ? `${files[0].name} added to Sources` : `${files.length} files added to Sources`);
}
// A note written in the box lands in the grid. You stay where you are.
async function quickNote(text, files = []) {
  const p = project(), title = titleFromText(text || files[0]?.name || 'Note');
  const made = await api(`${pathFor(p.id)}/notes`, { method:'POST', body:{ title, text:text && text !== title ? text : '' } });
  await loadState(p.id, { force:true });
  if (files.length) {
    const refs = await uploadFiles(p, files, 'files');
    await loadState(p.id, { force:true });
    const doc = await loadDoc(project(), made.path, { force:true });
    await saveDoc(project(), doc, appendedMd(doc, '', refs));
    await loadState(p.id, { force:true });
  }
  await loadProjects();
  refreshAfterChange();
  toast(`Added ${title}`);
}
ACT['new-note-quick'] = () => newNote().catch(error => toast(error.message));

// A folder written the short way inside the home folder, and a day without the time.
const homeShort = path => String(path || '').replace(/^(\/Users|\/home)\/[^/]+(?=\/|$)/, '~').replace(/^[A-Za-z]:\\Users\\[^\\]+(?=\\|$)/, '~');
const dayWhen = ms => { const d = new Date(ms), now = new Date(); return d.toDateString() === now.toDateString() ? 'today' : d.toLocaleDateString([], { month:'short', day:'numeric', ...(d.getFullYear() !== now.getFullYear() ? { year:'numeric' } : {}) }); };
// What the desk reads comes in behind the page, and only once for each change.
function loadDeskFiles(p) {
  for (const path of [outlineOf(p)?.path].filter(Boolean)) {
    const known = docById(path, p), entry = fileEntry(p, path);
    if (!entry || (known && entry.mtime <= known.mtime) || S.deskLoading?.has(path)) continue;
    (S.deskLoading ||= new Set()).add(path);
    loadDoc(p, path).then(() => { S.deskLoading.delete(path); refreshDesk(); }).catch(() => { S.deskLoading.delete(path); });
  }
}
// ---------- The home: the week, what needs you, and the lines ----------
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
// Asks written and not sent yet, newest first.
const unsentAsks = p => p.lines.flatMap(l => l.stations.filter(s => s.unsent).map(s => ({ l, s, at:stepTime(s) }))).sort((a, b) => b.at - a.at);
// When a time comes from the server it may be a number or a date in words.
const timeOf = v => (typeof v === 'number' ? v : v ? Date.parse(v) || 0 : 0);

// ---------- The project's Topics ----------
// The knowledge Topics agents keep in topics/, each a tile with a short line of its own: one node for each of its Lines, drawn as on All lines,
// the newest next to Now. Needs you first, then working, then the newest. A tile shows only its lines in All lines; its icon opens the Topic.
// Today / 7 days / All here is the same choice as Token savings'. Folded, the tiles become compact chips.
const TOPIC_NODES = 8;
const TOPIC_NODE = { you:'you', run:'working', review:'review', done:'done', todo:'todo', bad:'stopped', unsent:'unsent' };
const TOPIC_WORDS = { you:'Needs you', working:'Working', review:'To review', done:'Finished', todo:'Todo', stopped:'Stopped', unsent:'Not sent', quiet:'Notes' };
const TOPIC_RANK = { you:0, stopped:1, working:2, review:3, unsent:4, todo:5, done:6, quiet:7 };
const PERIODS = [['today', 'Today'], ['week', '7 days'], ['all', 'All']];
const periodNow = () => S.tokenPeriod || 'week';
// Where the chosen period starts, as the token totals count it.
const periodSince = (period = periodNow(), now = Date.now()) => { const d = new Date(now); d.setUTCHours(0, 0, 0, 0); return period === 'today' ? +d : period === 'week' ? +d - 6 * 86400000 : 0; };
const topicFilter = p => (p?.projectTopics !== false && Pano.topic?.[p.id] && (p.knowledge || []).some(t => t.path === Pano.topic[p.id]) ? Pano.topic[p.id] : '');
const topicNodeOf = (p, l) => (l.archived ? 'done' : TOPIC_NODE[rowMark(p, l)] || 'quiet');
function periodHTML(label) {
  const period = periodNow();
  return `<div class="tp-period" role="group" aria-label="${esc(label)}">${PERIODS.map(([v, w]) => `<button type="button" data-act="token-period" data-period="${v}" aria-pressed="${period === v}">${w}</button>`).join('')}</div>`;
}
function topicsCardHTML(p) {
  if (p.projectTopics === false) return '';
  const topics = p.knowledge || [];
  if (!topics.length) return buildTopicsHTML(p);
  const bySlug = new Map(allLines(p).map(l => [l.slug, l])), since = periodSince(), on = topicFilter(p), folded = Boolean(homeChoice(p).topicsFolded);
  const list = topics.map(t => {
    const lines = t.lines.map(slug => bySlug.get(slug)).filter(Boolean).map(l => ({ l, at:rowFacts(l).at || 0, s:topicNodeOf(p, l) })).sort((a, b) => a.at - b.at);
    const n = {}; for (const x of lines) n[x.s] = (n[x.s] || 0) + 1;
    return { t, lines, n, rank:Math.min(9, ...lines.map(x => TOPIC_RANK[x.s])), at:Math.max(0, ...lines.map(x => x.at)) };
  }).sort((a, b) => ((a.rank <= 2 || b.rank <= 2) ? a.rank - b.rank : 0) || b.at - a.at || a.t.title.localeCompare(b.t.title));
  const head = `<header class="tp-head"><button type="button" class="tp-fold" data-act="topics-fold" aria-expanded="${!folded}" aria-controls="topicTiles">${ic('down', 16)}<h2>Topics</h2><em>${topics.length}</em></button>${periodHTML('Period for Topics and Token savings')}<button type="button" class="hm-all" data-act="go-view" data-view="topics">All Topics</button></header>`;
  const more = '<button type="button" class="hm-all tp-more" data-act="topics-more" aria-controls="topicTiles" aria-expanded="false" hidden>View more</button>';
  const mark = n => n.you ? `<span class="tp-marks"><span class="tp-mk is-you" title="${esc(plural(n.you, 'needs you', 'need you'))}"><b aria-hidden="true">!</b>${n.you}</span></span>` : '';
  const dot = n => (n.you ? 'you' : n.working ? 'working' : n.review ? 'review' : '');
  if (folded) return `<section class="hm-card hm-topics is-folded" aria-label="Topics">${head}<div class="tp-chips" id="topicTiles">${list.map(({ t, n }) => `<button type="button" class="tp-chip${on === t.path ? ' is-on' : ''}" data-act="topic-filter" data-topic="${esc(t.path)}" aria-pressed="${on === t.path}" title="${esc(t.title)}"><i class="tp-dot ${dot(n)}"></i><span>${esc(t.title)}</span></button>`).join('')}</div>${more}</section>`;
  const node = x => `<button type="button" class="tp-nd s-${x.s}" data-act="open-line" data-line="${esc(x.l.id)}" data-tip="${esc(x.l.title)}" data-tip-s="${x.s}" data-tip-meta="${esc(`${TOPIC_WORDS[x.s]}${x.at ? ` · ${shortWhen(x.at)}` : ''}`)}" aria-label="${esc(`${x.l.title}, ${TOPIC_WORDS[x.s]}`)}"></button>`;
  const lane = ({ lines }) => {
    const live = lines.filter(x => x.at >= since), shown = live.slice(-TOPIC_NODES), before = lines.length - shown.length;
    return `<span class="tp-lane"><i class="tp-rail"></i>${before ? `<i class="tp-old" title="${esc(`${plural(before, 'earlier line', 'earlier lines')}`)}">${'<b></b>'.repeat(Math.min(before, 3))}</i>` : ''}${shown.map(node).join('')}<i class="tp-now"></i></span>`;
  };
  return `<section class="hm-card hm-topics" aria-label="Topics">${head}<div class="tp-tiles" id="topicTiles">${list.map(x => {
    const { t, n } = x, quiet = !x.lines.some(y => y.at >= since), fresh = (S.topicsNew?.[p.id] || []).some(y => y.path === t.path);
    // An agent changed this Topic since you last opened the Topics tab: it carries the memory's spark (state.js).
    return `<div class="tp-tile${on === t.path ? ' is-on' : ''}${quiet && !fresh ? ' is-quiet' : ''}${n.you ? ' has-you' : ''}${fresh ? ' is-new' : ''}">
      <button type="button" class="tp-tile-main" data-act="topic-filter" data-topic="${esc(t.path)}" aria-pressed="${on === t.path}" title="${esc(t.goal ? `${t.title}\n${t.goal}` : t.title)}">${ic('note', 14)}<span class="tp-tt">${esc(t.title)}</span>${fresh ? `<i class="grew-spark" aria-label="Changed">${ic('spark', 12)}</i>` : ''}</button>
      <button type="button" class="tp-doc" data-act="open-doc" data-doc="${esc(t.path)}" aria-label="Open the Topic ${esc(t.title)}" title="Open the Topic">${ic('arrow', 13)}</button>
      <div class="tp-row2">${lane(x)}${mark(n)}</div></div>`;
  }).join('')}</div>${more}</section>`;
}
// Use the actual wrapping of both the tile grid and the variable-width chips.
const topicListWidths = new WeakMap();
function fitTopicRows(list) {
  const items = Array.from(list.children), more = list.nextElementSibling;
  const expanded = Boolean(homeChoice(project()).topicsExpanded);
  for (const item of items) item.hidden = false;
  let rows = 0, lastTop;
  const overflow = items.findIndex(item => {
    const top = item.offsetTop;
    if (top !== lastTop) rows++;
    lastTop = top;
    return rows > 2;
  });
  if (overflow < 0 && document.activeElement === more) {
    const last = items.at(-1);
    (last?.querySelector('button') || last)?.focus();
  }
  more.hidden = overflow < 0;
  more.textContent = expanded ? 'Show fewer' : 'View more';
  more.setAttribute('aria-expanded', String(expanded));
  if (overflow >= 0 && !expanded) {
    for (const item of items.slice(overflow)) {
      if (item.contains(document.activeElement)) more.focus({ preventScroll:true });
      item.hidden = true;
    }
  }
}
const topicSizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(entries => {
  for (const { target, contentRect } of entries) {
    if (!target.isConnected || topicListWidths.get(target) === contentRect.width) continue;
    topicListWidths.set(target, contentRect.width);
    fitTopicRows(target);
    seeChangedTiles(project());
  }
}) : null;
function observeTopicRows(list) {
  if (!list || topicListWidths.has(list)) return;
  topicListWidths.set(list, list.getBoundingClientRect().width);
  fitTopicRows(list);
  topicSizeObserver?.observe(list);
}
ACT['topics-more'] = el => {
  const list = el.previousElementSibling, firstHidden = list.querySelector(':scope > [hidden]');
  setHomeChoice(project(), { topicsExpanded:Boolean(firstHidden) });
  fitTopicRows(list);
  if (firstHidden) {
    const topic = firstHidden.matches('button') ? firstHidden : firstHidden.querySelector('button');
    topic.focus();
    seeChangedTiles(project());
  }
};
// A tile shows only its Topic's lines in All lines; pressing it again, its × or Escape shows them all.
function setTopicFilter(p, path) {
  (Pano.topic ||= {})[p.id] = path;
  if (!path) delete Pano.topic[p.id];
  Pano.update(); refreshDesk();
}
ACT['topic-filter'] = el => { const p = project(), path = el.dataset.topic; seeTopic(p, path); setTopicFilter(p, topicFilter(p) === path ? '' : path); };
// The pink is news once, not for good (PE-545): pressing a tile sees its Topic, and the home that showed the pink for a while sees
// all it showed. Only what was on screen when the wait began is cleared, so a Topic changed meanwhile still gets its turn.
const TILE_PINK_MS = 8000;
let tilePinkTimer = 0;
function seeTopic(p, path) {
  const left = (S.topicsNew?.[p.id] || []).filter(t => t.path !== path);
  if (left.length === (S.topicsNew?.[p.id] || []).length) return;
  if (left.length) S.topicsNew[p.id] = left; else delete S.topicsNew[p.id];
  renderProjbar();
}
function seeChangedTiles(p) {
  if (tilePinkTimer || !topicsGrew(p)) return;
  const visiblePaths = () => new Set($$('#hmWeek .tp-tile.is-new:not([hidden]) [data-topic]').map(el => el.dataset.topic));
  const visible = visiblePaths();
  const shown = new Set(S.topicsNew[p.id].filter(t => visible.has(t.path)));
  if (!shown.size) return;
  const wait = () => {
    if (document.hidden) { tilePinkTimer = setTimeout(wait, 1000); return; }
    tilePinkTimer = 0;
    if (S.route.view !== 'home' || project()?.id !== p.id || !S.topicsNew?.[p.id]) return;
    const gone = visiblePaths();
    const left = S.topicsNew[p.id].filter(t => !shown.has(t) || !gone.has(t.path));
    if (left.length) S.topicsNew[p.id] = left; else delete S.topicsNew[p.id];
    // The pink fades out on the tiles before the card is drawn again without it.
    for (const tile of $$('#hmWeek .tp-tile.is-new')) if (gone.has(tile.querySelector('[data-topic]')?.dataset.topic) && !left.some(t => t.path === tile.querySelector('[data-topic]').dataset.topic)) tile.classList.remove('is-new');
    setTimeout(() => { refreshDesk(); renderProjbar(); }, 600);
  };
  tilePinkTimer = setTimeout(wait, TILE_PINK_MS);
}
ACT['topic-filter-clear'] = () => {
  const p = project(), path = topicFilter(p);
  setTopicFilter(p, '');
  $(`#hmWeek [data-act="topic-filter"][data-topic="${CSS.escape(path)}"]`)?.focus({ preventScroll:true });
};
ACT['topics-fold'] = () => { const p = project(); setHomeChoice(p, { topicsFolded:!homeChoice(p).topicsFolded }); refreshDesk(); $('#hmWeek [data-act="topics-fold"]')?.focus({ preventScroll:true }); };
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || e.defaultPrevented || S.route?.view !== 'home') return;
  const p = project();
  if (!p || !topicFilter(p) || $('#menu') || document.querySelector('dialog[open]') || ['#lightbox', '#switcher'].some(id => $(id) && !$(id).hidden) || e.target.closest?.('input, textarea, select, [contenteditable="true"], .composer')) return;
  e.preventDefault();
  ACT['topic-filter-clear']();
});

// A line's node says what it is the moment the pointer or focus reaches it: the browser's own title tip waits about a second.
// One card for the page, outside the tiles so their lanes do not clip it; moving along a lane moves it without fading again.
const NodeTip = { el:null, at:null };
function nodeTipShow(node) {
  let tip = NodeTip.el;
  if (!tip) { tip = NodeTip.el = document.createElement('div'); tip.className = 'nd-tip'; tip.setAttribute('aria-hidden', 'true'); document.body.append(tip); }
  const again = NodeTip.at && tip.classList.contains('is-on');
  NodeTip.at = node;
  tip.innerHTML = `<b>${esc(node.dataset.tip)}</b><span><i class="nd-tip-dot s-${esc(node.dataset.tipS)}"></i>${esc(node.dataset.tipMeta)}</span>`;
  tip.classList.toggle('is-moving', Boolean(again));
  const vp = typeof pageViewport === 'function' ? pageViewport() : { width:innerWidth, height:innerHeight };
  const r = typeof pageRect === 'function' ? pageRect(node) : node.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight, gap = 9;
  const below = r.top - h - gap < 4;
  const x = Math.round(Math.max(6, Math.min(vp.width - w - 6, r.left + r.width / 2 - w / 2)));
  tip.style.left = `${x}px`;
  tip.style.top = `${Math.round(below ? r.bottom + gap : r.top - h - gap)}px`;
  tip.style.setProperty('--arrow', `${Math.round(r.left + r.width / 2 - x)}px`);
  tip.classList.toggle('is-below', below);
  tip.classList.add('is-on');
}
function nodeTipHide() { NodeTip.at = null; NodeTip.el?.classList.remove('is-on', 'is-moving'); }
// The Topics card repaints in place; the card follows the same line's new node, or goes if it is gone.
function nodeTipFollow() {
  if (!NodeTip.at || NodeTip.at.isConnected) return;
  const next = $(`#hmWeek .tp-nd[data-line="${CSS.escape(NodeTip.at.dataset.line)}"]`);
  next && next.matches(':hover, :focus-visible') ? nodeTipShow(next) : nodeTipHide();
}
document.addEventListener('pointerover', e => { const n = e.target.closest?.('.tp-nd[data-tip]'); if (n) nodeTipShow(n); else if (NodeTip.at) nodeTipHide(); });
document.addEventListener('focusin', e => { const n = e.target.closest?.('.tp-nd[data-tip]'); if (n && n.matches(':focus-visible')) nodeTipShow(n); else if (NodeTip.at) nodeTipHide(); });
['pointerdown', 'click', 'scroll', 'blur'].forEach(t => addEventListener(t, () => NodeTip.at && nodeTipHide(), true));
document.addEventListener('keydown', e => { if (e.key === 'Escape' && NodeTip.at) nodeTipHide(); }, true);

// A project with Lines and no Topics yet builds them on a click: one line whose agent writes them (service.buildTopics).
// While it works, the card opens that line. Only on this computer: penecho.ai builds its own projects' Topics.
const BUILD_TOPICS = 'build-topics';
function buildTopicsHTML(p) {
  if (HOSTED) return '';
  const building = topicsBuilding(p);
  if (building) return `<section class="hm-card hm-topics" aria-label="Topics"><header><h2>Topics</h2></header><button type="button" class="tp-row" data-act="open-line" data-line="${esc(building.id)}"><span class="tp-name"><i class="spin"></i><span>Building Topics</span></span></button></section>`;
  if (!p.lines.some(l => l.job !== BUILD_TOPICS)) return '';
  return `<section class="hm-card hm-topics" aria-label="Topics"><header><h2>Topics</h2><button type="button" class="btn sm primary" data-act="build-topics">Build Topics</button></header></section>`;
}
const topicsBuilding = p => allLines(p).find(l => l.job === BUILD_TOPICS && !l.archived && !['done', 'ready', 'landed', 'closed'].includes(l.status)) || null;
const topicCounts = p => { const bySlug = new Map(allLines(p).map(l => [l.slug, l])); return t => { const lines = t.lines.map(slug => bySlug.get(slug)).filter(Boolean), done = lines.filter(l => l.archived || MAP_FILTERS.done(p, l)).length; return { open:lines.length - done, done }; }; };
const countsHTML = n => `<span class="tp-n">${n.open ? `<b>${n.open} open</b>` : ''}${n.done ? `<i>${n.done} done</i>` : ''}</span>`;
// The Topics tab itself, a tree beside the chosen Topic's page, is topics-page.js.
// In Project settings: Build, or Rebuild once there are Topics.
function topicsSettingsRow(p) {
  if (HOSTED || p.projectTopics === false || !allLines(p).length) return '';
  const n = (p.knowledge || []).length, building = topicsBuilding(p);
  return `<section class="set-row" aria-label="Topics"><div class="set-text"><strong>Topics</strong><p>${building ? 'Being built' : n ? plural(n, 'Topic', 'Topics') : 'None yet'}</p></div>${building ? `<button type="button" class="btn sm" data-act="open-line" data-line="${esc(building.id)}">Open</button>` : n ? '<button type="button" class="btn sm" data-act="rebuild-topics">Rebuild</button>' : '<button type="button" class="btn sm primary" data-act="build-topics">Build Topics</button>'}</section>`;
}
// The saved agent Build and Rebuild Topics run with ('' runs them with the default, as any Ask). The Rebuild box sets it.
const topicsAgent = () => S.presets?.jobs?.topics || '';
function topicsAgentOptionsHTML() {
  const chosen = topicsAgent(), def = defaultPreset(), current = presetById(chosen);
  // Keep an existing assignment when the person hides it from future choices.
  const kept = current?.showInPicker === false ? `<option value="${esc(chosen)}" selected hidden>${esc(current.name)}</option>` : '';
  return `${kept}<option value="">${esc(def ? `Default (${def.name})` : 'Default')}</option>${runPresets().map(x => `<option value="${esc(x.id)}" ${x.id === chosen ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}`;
}
async function setTopicsAgent(id) {
  if (id === topicsAgent()) return;
  S.presets = await api('/agent-presets/jobs', { method:'POST', body:{ job:'topics', id } });
}
// Rebuild asks first: the Topics there are now are put aside, and an agent writes them again from the Lines.
ACT['rebuild-topics'] = el => {
  const p = project(), dialog = document.createElement('dialog');
  dialog.className = 'line-command-dialog';
  dialog.setAttribute('aria-labelledby', 'rebuildTopicsTitle');
  const pick = S.presets ? `<label>Agent<select name="preset">${topicsAgentOptionsHTML()}</select></label>` : '';
  dialog.innerHTML = `<form><h2 id="rebuildTopicsTitle">Rebuild Topics</h2><p>An agent writes them again from this project's Lines. Topics without related Lines may not be recreated. Recover brings the previous Topics back.</p>${pick}<p class="command-error" role="alert" hidden></p><footer><button type="button" class="btn" data-cancel>Cancel</button><button type="submit" class="btn primary">Rebuild</button></footer></form>`;
  document.body.append(dialog);
  dialog.addEventListener('close', () => { dialog.remove(); if (el?.isConnected) el.focus(); });
  $('[data-cancel]', dialog).onclick = () => dialog.close();
  $('form', dialog).onsubmit = async e => {
    e.preventDefault();
    const submit = $('[type="submit"]', dialog);
    submit.disabled = true;
    try {
      const preset = $('[name="preset"]', dialog)?.value;
      if (preset !== undefined) await setTopicsAgent(preset);
      const made = await api(`${pathFor(p.id)}/build-topics`, { method:'POST', body:{ rebuild:true } });
      dialog.close();
      await loadState(p.id, { force:true });
      go({ view:'line', line:made.slug });
    } catch (error) { const message = $('.command-error', dialog); message.hidden = false; message.textContent = error.message; submit.disabled = false; }
  };
  dialog.showModal();
};
// Earlier Topics back, from what a rebuild or a Recover put aside. Undo puts the ones they replaced back.
ACT['topics-recover'] = async el => {
  const p = project();
  let versions;
  try { ({ versions } = await api(`${pathFor(p.id)}/topics-versions`)); } catch (error) { toast(error.message); return; }
  if (!versions.length) { toast('No earlier Topics are kept.'); return; }
  const when = at => new Date(at).toLocaleString('en', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
  openMenu(el, versions.map(v => ({ label:`${when(v.at)} · ${plural(v.topics, 'Topic', 'Topics')}`, icon:'undo', fn:() => restoreTopics(p, v.id) })), { align:'right' });
};
async function restoreTopics(p, id) {
  try {
    const { undo } = await api(`${pathFor(p.id)}/topics-restore`, { method:'POST', body:{ id } });
    await loadState(p.id, { force:true });
    render();
    toast('The earlier Topics are back.', undo ? { label:'Undo', fn:() => restoreTopics(p, undo) } : undefined);
  } catch (error) { toast(error.message); }
}
ACT['build-topics'] = async el => {
  const p = project();
  el.disabled = true;
  try {
    const made = await api(`${pathFor(p.id)}/build-topics`, { method:'POST', body:{} });
    await loadState(p.id, { force:true });
    go({ view:'line', line:made.slug });
  } catch (error) { toast(error.message); el.disabled = false; }
};

// ---------- Compact pending list: unsent Asks and stopped lines; reviews stay in All lines ----------
const NEED_FIRST = 3;
const Needs = { more:{} };
// An Ask not sent: its dashed node, its words, and Send, which runs it as Run with does on the line's page.
function unsentRowHTML(p, { l, s, at }) {
  const step = `data-line="${esc(l.id)}" data-step="${esc(s.id)}"`, send = unsentSendHTML(p, l, s, 'Open line');
  return `<div class="nu-row" data-line="${esc(l.id)}"><span class="st k-ask st-todo is-unsent"><span class="nd"></span></span><button type="button" class="nu-words" data-act="open-step" ${step} title="${esc(l.title)}">${esc(plainOut(stopWords(s)))}</button><time>${at ? esc(shortWhen(at)) : ''}</time>${send}</div>`;
}
function needsHTML(p) {
  // Stopped lines are counted in All lines, where they filter; this box holds only Asks waiting to be sent.
  const unsent = unsentAsks(p);
  if (!unsent.length) return '';
  const folded = Boolean(homeChoice(p).needsFolded), rows = Needs.more[p.id] ? unsent : unsent.slice(0, NEED_FIRST), left = unsent.length - rows.length;
  const foot = left ? `<button type="button" class="btn sm" data-act="needs-more">${left} more not sent</button>` : '';
  return `<section class="hm-card hm-needs nu-box${folded ? ' is-folded' : ''}" aria-label="Pending work">
    <h2 class="nu-heading"><button type="button" class="hm-fold" data-act="needs-fold" aria-expanded="${!folded}" aria-controls="needsItems">${ic(folded ? 'right' : 'down', 17)}<span>Not sent</span><em>${unsent.length}</em><span class="nu-fold-label">${folded ? 'Show' : 'Hide'}</span></button></h2>
    <div id="needsItems"${folded ? ' hidden' : ''}>${folded ? '' : `${rows.map(r => unsentRowHTML(p, r)).join('')}${foot ? `<div class="nu-more">${foot}</div>` : ''}`}</div>
  </section>`;
}
// Written only when it differs; keep keyboard focus on the corresponding control after a refresh.
function paintNeeds(p) {
  const host = $('#hmNeeds'); if (!host) return;
  const html = needsHTML(p);
  if (host.dataset.h === html) return;
  const active = document.activeElement, held = host.contains(active) ? { line:active.closest('[data-line]')?.dataset.line || '', act:active.dataset.act || '', f:active.dataset.f || '' } : null;
  host.innerHTML = host.dataset.h = html;
  if (!held) return;
  const near = (held.line && $(`[data-line="${CSS.escape(held.line)}"]`, host)) || host;
  const next = held.f ? $(`[data-f="${held.f}"]`, host) : held.act ? $(`[data-act="${held.act}"]`, near) : null;
  (next || $('[data-act="needs-fold"]', host))?.focus({ preventScroll:true });
}
// Keep the visibility choice for this project in this browser, using the existing home preferences.
ACT['needs-fold'] = () => { const p = project(); setHomeChoice(p, { needsFolded:!homeChoice(p).needsFolded }); paintNeeds(p); $('#hmNeeds .hm-fold')?.focus({ preventScroll:true }); };
ACT['needs-more'] = () => { const p = project(); Needs.more[p.id] = true; paintNeeds(p); };

// ---------- Top of the desk: Recent lines, Works by day, Token savings, and Topics ----------
const showHomeTopCards = p => Boolean(p && p.projectTopics === false && allLines(p).length > 0);
const HOME_RECENT_MAX = 8;
function recentAgo(ms, now = Date.now()) {
  const diff = Math.max(0, now - ms), m = Math.floor(diff / 60000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.floor(m / 60)}h ago`;
  const d = new Date(ms), today = new Date(now);
  const dayDiff = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
  return dayDiff <= 1 ? 'Yesterday' : `${dayDiff}d ago`;
}
function recentLineStatus(p, l) {
  if (l.archived || l.closed) return { cls:'archived', icon:ic('archive', 14), label:'Archived', tag:'t-archived' };
  const mark = typeof rowMark === 'function' ? rowMark(p, l) : 'notes';
  if (mark === 'run') return { cls:'working', icon:'<i class="spin" aria-hidden="true"></i>', label:'Working', tag:'t-working' };
  if (mark === 'you') return { cls:'you', icon:'<b class="hm-rc-bang" aria-hidden="true">!</b>', label:'Needs you', tag:'t-review' };
  if (mark === 'review') return { cls:'review', icon:ic('eye', 15), label:'To review', tag:'t-review' };
  if (mark === 'bad') return { cls:'stopped', icon:ic('x', 15), label:'Stopped', tag:'t-stopped' };
  if (mark === 'unsent') return { cls:'unsent', icon:'<i class="hm-rc-ring is-unsent" aria-hidden="true"></i>', label:'Not sent', tag:'t-unsent' };
  if (mark === 'todo') return { cls:'todo', icon:ic('box', 14), label:'Todo', tag:'t-todo' };
  if (mark === 'done') return { cls:'done', icon:ic('check', 15), label:'Finished', tag:'t-done' };
  const label = typeof lineState === 'function' && lineState(l) === 'backlog' ? 'Not started' : 'Notes';
  return { cls:'notes', icon:'<i class="hm-rc-ring" aria-hidden="true"></i>', label, tag:'t-notes' };
}
function recentLinesHTML(p, now = Date.now()) {
  if (!showHomeTopCards(p)) return '';
  const visits = typeof projectLineVisits === 'function' ? projectLineVisits(p) : {};
  const byId = new Map(allLines(p).map(l => [l.id, l]));
  const items = Object.entries(visits)
    .filter(([, at]) => typeof at === 'number' && Number.isFinite(at) && at > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([id, at]) => ({ l:byId.get(id), at }))
    .filter(x => x.l)
    .slice(0, HOME_RECENT_MAX);
  const body = items.length
    ? `<ol class="hm-rc-list">${items.map(({ l, at }) => {
        const st = recentLineStatus(p, l);
        const unread = !l.archived && typeof lineUnread === 'function' && lineUnread(p, l);
        const when = recentAgo(at, now);
        const title = l.title || l.slug || 'Line';
        return `<li><button type="button" class="hm-rc${unread ? ' is-unread' : ''}" data-act="open-line" data-line="${esc(l.id)}" title="${esc(title)}"><span class="hm-rc-sy is-${st.cls}" role="img" aria-label="${esc(st.label)}" title="${esc(st.label)}">${st.icon}</span><strong>${esc(title)}</strong>${unread ? '<i class="hm-rc-dot" role="img" aria-label="Unread" title="Unread"></i>' : ''}<span class="hm-rc-tag ${st.tag}" aria-hidden="true">${esc(st.label)}</span><span class="hm-rc-when${when === 'Just now' ? ' is-fresh' : ''}" data-t="${at}">${esc(when)}</span></button></li>`;
      }).join('')}</ol>`
    : '<p class="hm-rc-empty">Lines you open show here.</p>';
  return `<section class="hm-card hm-rec" aria-label="Recent lines"><h2>Recent lines</h2>${body}</section>`;
}
function tickRecentTimes(now = Date.now()) {
  for (const el of $$('#hmRecent .hm-rc-when[data-t]')) {
    const t = Number(el.dataset.t);
    if (!Number.isFinite(t)) continue;
    const text = recentAgo(t, now);
    if (el.textContent !== text) el.textContent = text;
    el.classList.toggle('is-fresh', text === 'Just now');
  }
}

const HOME_CHART = { project:'', pin:'', hot:'', dailyProject:'', dailyRev:'', dailyRows:null, loading:null, last:0, timer:0, series:null };
const HOME_DAILY_EVERY = 3000;
const homeDayLabel = ms => new Date(ms).toLocaleDateString('en-GB', { day:'numeric', month:'short' });
function homeChartChoiceBy(p) {
  const saved = typeof homeChoice === 'function' ? homeChoice(p).chartBy : '';
  return saved === 'kind' ? 'kind' : 'agent';
}
function homeDailyRowsFor(p) {
  if (!p) return null;
  if (HOME_CHART.dailyProject === p.id && Array.isArray(HOME_CHART.dailyRows)) return HOME_CHART.dailyRows;
  if (typeof ORCH !== 'undefined' && ORCH.project === p.id && Array.isArray(ORCH.stats?.daily)) return ORCH.stats.daily;
  return null;
}
function loadHomeDaily(p) {
  if (!p || !showHomeTopCards(p) || (typeof HOSTED !== 'undefined' && HOSTED) || typeof api !== 'function' || typeof pathFor !== 'function') return;
  if (S?.route?.view !== 'home' || (typeof document !== 'undefined' && document.hidden)) return;
  const rev = p.rev ?? '';
  if (HOME_CHART.dailyProject === p.id && HOME_CHART.dailyRev === rev && Array.isArray(HOME_CHART.dailyRows)) return;
  if (HOME_CHART.loading && HOME_CHART.loading.project === p.id && HOME_CHART.loading.rev === rev) return;
  const now = Date.now(), wait = HOME_DAILY_EVERY - (now - HOME_CHART.last);
  if (HOME_CHART.dailyProject === p.id && wait > 0) {
    if (!HOME_CHART.timer && typeof setTimeout === 'function') {
      HOME_CHART.timer = setTimeout(() => {
        HOME_CHART.timer = 0;
        const cur = typeof project === 'function' ? project() : null;
        if (cur && cur.id === p.id && S?.route?.view === 'home') loadHomeDaily(cur);
      }, wait);
    }
    return;
  }
  if (HOME_CHART.timer && typeof clearTimeout === 'function') { clearTimeout(HOME_CHART.timer); HOME_CHART.timer = 0; }
  const req = { project:p.id, rev };
  HOME_CHART.loading = req;
  HOME_CHART.last = now;
  api(`${pathFor(p.id)}/orchestrator/stats?days=30`).then(data => {
    if (HOME_CHART.loading !== req) return;
    HOME_CHART.dailyProject = p.id;
    HOME_CHART.dailyRev = rev;
    HOME_CHART.dailyRows = Array.isArray(data?.daily) ? data.daily : [];
    const cur = typeof project === 'function' ? project() : null;
    if (cur && cur.id === p.id && S?.route?.view === 'home') refreshHomeChart(cur);
  }).catch(() => {
    // Agent mode is already drawn locally; leave Kind of job hidden until available.
  }).finally(() => {
    if (HOME_CHART.loading === req) HOME_CHART.loading = null;
  });
}
function homeChartHTML(p, opts = {}) {
  if (!showHomeTopCards(p) || typeof projectDailySeries !== 'function') return '';
  if (HOME_CHART.project !== p.id) {
    HOME_CHART.project = p.id;
    HOME_CHART.pin = '';
    HOME_CHART.hot = '';
    if (HOME_CHART.dailyProject !== p.id) { HOME_CHART.dailyProject = ''; HOME_CHART.dailyRev = ''; HOME_CHART.dailyRows = null; }
  }
  const by = opts.by || homeChartChoiceBy(p);
  const data = projectDailySeries(p, { by, dailyRows:opts.dailyRows ?? homeDailyRowsFor(p), now:opts.now });
  if (HOME_CHART.pin && !data.keys.some(k => k.key === HOME_CHART.pin)) HOME_CHART.pin = '';
  HOME_CHART.series = data;
  const lastIdx = data.columns.length - 1;
  const peak = data.total ? data.columns.findIndex(c => c.total === data.max) : -1;
  const toggle = data.hasKinds
    ? `<div class="seg hm-ch-seg" role="group" aria-label="Group by">${[['kind', 'Kind of job'], ['agent', 'Agent']].map(([k, label]) => `<button type="button" data-act="home-chart-by" data-by="${k}" aria-pressed="${data.mode === k}">${label}</button>`).join('')}</div>`
    : '';
  const statsBtn = typeof viewHere !== 'function' || viewHere('stats')
    ? '<button type="button" class="hm-ch-go" data-act="go-view" data-view="stats">Statistics</button>'
    : '';
  const body = !data.total
    ? '<p class="hm-ch-empty">No Works in the last 30 days.</p>'
    : `<div class="hm-plot" role="group" aria-label="Last 30 days, use the arrow keys">${data.columns.map((c, i) => {
        const day = homeDayLabel(c.ms);
        const parts = data.keys.filter(k => c.parts[k.key]);
        const label = `${day}: ${c.total} Work${c.total === 1 ? '' : 's'}${parts.map(k => `, ${k.name} ${c.parts[k.key]}`).join('')}`;
        return `<div class="hm-dy${i === peak ? ' is-peak' : ''}" data-i="${i}" tabindex="${i === lastIdx ? 0 : -1}" role="img" aria-label="${esc(label)}">${c.total ? `<b>${c.total}</b><span style="--h:${(c.total / data.max).toFixed(4)}">${parts.map(k => `<i data-k="${esc(k.key)}" style="flex:${c.parts[k.key]};background:${esc(k.color)}"></i>`).join('')}</span>` : ''}</div>`;
      }).join('')}</div>
      <div class="hm-xs" aria-hidden="true">${data.columns.map((c, i) => `<span class="${(lastIdx - i) % 6 ? 'is-odd' : ''}">${(lastIdx - i) % 3 ? '' : esc(homeDayLabel(c.ms))}</span>`).join('')}</div>
      <div class="hm-lg" role="group" aria-label="Highlight series">${data.keys.map(k => `<button type="button" data-act="home-chart-pin" data-k="${esc(k.key)}" aria-pressed="${HOME_CHART.pin === k.key}"><i style="background:${esc(k.color)}"></i><span>${esc(k.name)}</span><b>${k.total}</b></button>`).join('')}</div>
      <div class="hm-tip" id="hmChartTip" hidden></div>`;
  return `<section class="hm-card hm-chart${data.max >= 100 ? ' is-tall-nums' : ''}" id="hmChartCard" aria-label="Works by day">
    <header class="hm-ch-h">
      <div><p class="sx-eyebrow">${esc(`${p.name || 'This project'} · Works by day`)}</p><h2>${data.total} Work${data.total === 1 ? '' : 's'} ${data.mode === 'kind' ? 'by kind of job' : 'by agent'}</h2></div>
      <div class="hm-ch-r">${toggle}${statsBtn}</div>
    </header>
    ${body}
  </section>`;
}
function applyHomeChartHighlight(hoverKey = '') {
  const card = $('#hmChartCard');
  if (!card) return;
  const hot = hoverKey || HOME_CHART.pin;
  HOME_CHART.hot = hot;
  card.classList.toggle('is-hl', Boolean(hot));
  for (const el of $$('[data-k]', card)) {
    const on = Boolean(hot && el.dataset.k === hot);
    el.classList.toggle('is-on', on);
    if (el.matches('button[data-act="home-chart-pin"]')) el.setAttribute('aria-pressed', String(HOME_CHART.pin === el.dataset.k));
  }
}
function showHomeChartTip(dy) {
  const tip = $('#hmChartTip'), card = $('#hmChartCard');
  if (!tip || !card) return;
  if (!dy || !HOME_CHART.series) { tip.hidden = true; return; }
  const idx = Number(dy.dataset.i), c = HOME_CHART.series.columns[idx];
  if (!c) { tip.hidden = true; return; }
  const rows = HOME_CHART.series.keys.filter(k => c.parts[k.key]).reverse()
    .map(k => `<div class="${HOME_CHART.hot === k.key ? 'is-on' : ''}"><i style="background:${esc(k.color)}"></i><span>${esc(k.name)}</span><b>${c.parts[k.key]}</b></div>`).join('');
  tip.innerHTML = `<h3><span>${esc(homeDayLabel(c.ms))}</span><span>${c.total} Work${c.total === 1 ? '' : 's'}</span></h3>${rows}`;
  tip.hidden = false;
  const plot = $('.hm-plot', card);
  if (typeof card.getBoundingClientRect !== 'function' || !plot) return;
  const rectOf = el => typeof pageRect === 'function' ? pageRect(el) : el.getBoundingClientRect();
  const cr = rectOf(card), dr = rectOf(dy), pr = rectOf(plot);
  const w = tip.offsetWidth || 160, h = tip.offsetHeight || 60;
  const rightX = dr.right - cr.left + 6, leftX = dr.left - cr.left - w - 6;
  const x = rightX + w <= card.clientWidth - 6 ? rightX : Math.max(6, leftX);
  const y = Math.min(pr.top - cr.top, Math.max(6, card.clientHeight - h - 6));
  tip.style.left = `${Math.round(Math.max(6, x))}px`;
  tip.style.top = `${Math.round(Math.max(6, y))}px`;
}
function refreshHomeChart(p = project()) {
  const host = $('#hmChart');
  if (!p || !host) return;
  const active = document.activeElement;
  const held = host.contains(active) ? { act:active.dataset.act || '', by:active.dataset.by || '', k:active.dataset.k || '', i:active.dataset.i || '' } : null;
  const html = homeChartHTML(p);
  if (host.dataset.h !== html) {
    host.innerHTML = host.dataset.h = html;
    if (held) {
      const next = held.i ? $(`.hm-dy[data-i="${CSS.escape(held.i)}"]`, host)
        : held.by ? $(`[data-act="home-chart-by"][data-by="${CSS.escape(held.by)}"]`, host)
        : held.k ? $(`[data-act="home-chart-pin"][data-k="${CSS.escape(held.k)}"]`, host)
        : held.act ? $(`[data-act="${CSS.escape(held.act)}"]`, host) : null;
      next?.focus({ preventScroll:true });
    }
  }
  applyHomeChartHighlight();
}
ACT['home-chart-by'] = el => {
  const p = project();
  if (!p) return;
  let keepFocus = false;
  try { keepFocus = typeof el.matches === 'function' && el.matches(':focus-visible'); } catch { /* Non-browser DOM test harness. */ }
  const by = el.dataset.by === 'kind' ? 'kind' : 'agent';
  HOME_CHART.pin = '';
  HOME_CHART.hot = '';
  if (typeof setHomeChoice === 'function') setHomeChoice(p, { chartBy:by === 'kind' ? 'kind' : '' });
  refreshHomeChart(p);
  if (keepFocus) $(`#hmChart [data-act="home-chart-by"][data-by="${by}"]`)?.focus({ preventScroll:true });
};
ACT['home-chart-pin'] = el => {
  const key = el.dataset.k || '';
  HOME_CHART.pin = HOME_CHART.pin === key ? '' : key;
  applyHomeChartHighlight();
};
const onHomeChartOver = e => {
  const card = e.target?.closest?.('#hmChartCard');
  if (!card) {
    if (HOME_CHART.hot && HOME_CHART.hot !== HOME_CHART.pin) applyHomeChartHighlight('');
    showHomeChartTip(null);
    return;
  }
  const legend = e.target.closest?.('.hm-lg [data-k]');
  const dy = e.target.closest?.('.hm-dy');
  applyHomeChartHighlight(legend ? legend.dataset.k : '');
  showHomeChartTip(dy);
};
document.addEventListener('mouseover', onHomeChartOver);
document.addEventListener('pointerover', onHomeChartOver);
document.addEventListener('focusin', onHomeChartOver);
document.documentElement?.addEventListener?.('mouseleave', () => {
  if (HOME_CHART.hot && HOME_CHART.hot !== HOME_CHART.pin) applyHomeChartHighlight('');
  showHomeChartTip(null);
});
document.addEventListener('focusout', e => {
  const card = $('#hmChartCard');
  if (!card || card.contains(e.relatedTarget)) return;
  if (HOME_CHART.hot && HOME_CHART.hot !== HOME_CHART.pin) applyHomeChartHighlight('');
  showHomeChartTip(null);
});
document.addEventListener('keydown', e => {
  const dy = e.target?.closest?.('#hmChartCard .hm-dy');
  if (!dy) return;
  if (e.key === 'Escape') { showHomeChartTip(null); return; }
  const count = HOME_CHART.series?.columns.length || 30;
  const cur = Number(dy.dataset.i);
  const nextIdx = { ArrowLeft:cur - 1, ArrowRight:cur + 1, Home:0, End:count - 1 }[e.key];
  if (nextIdx === undefined) return;
  e.preventDefault();
  const next = $(`#hmChartCard .hm-dy[data-i="${nextIdx}"]`);
  if (next) {
    dy.setAttribute('tabindex', '-1');
    next.setAttribute('tabindex', '0');
    next.focus();
  }
});

// Refreshed without touching the box or the list, so typing and the pointer's place survive.
function refreshDesk() {
  const p = project(), week = $('#hmWeek'); if (!p || !week) return;
  const paint = (el, html) => { if (el && el.dataset.h !== html) { el.innerHTML = html; el.dataset.h = html; } };
  const active = document.activeElement;
  const focus = week.contains(active) && active.dataset.act ? { ...active.dataset } : null;
  const recent = $('#hmRecent');
  const recentFocus = recent && recent.contains(active) && active.dataset.line ? active.dataset.line : '';
  paint($('#hmTokens'), typeof tokenProjectHTML === 'function' ? tokenProjectHTML(p) : '');
  paint(recent, recentLinesHTML(p));
  if (recentFocus && !active.isConnected) {
    $(`[data-act="open-line"][data-line="${CSS.escape(recentFocus)}"]`, recent)?.focus({ preventScroll:true });
  }
  refreshHomeChart(p);
  loadHomeDaily(p);
  // The project's Topics stand where the week's words were (PE-428).
  paint(week, topicsCardHTML(p));
  observeTopicRows(week.querySelector('#topicTiles'));
  seeChangedTiles(p);
  nodeTipFollow();
  if (focus && !active.isConnected) {
    const next = $$('[data-act]', week).find(el => Object.entries(focus).every(([k, v]) => el.dataset[k] === v) && el.getClientRects().length);
    next?.focus({ preventScroll:true });
  }
  paintNeeds(p);
  paint($('#lineWarnings'), lineWarningsHTML(p));
  const deck = $('#deckHero');
  if (deck) {
    loadDeskFiles(p);
    paint(deck, deckHeroHTML(p));
  }
}

ACT['peek-line'] = el => go({ view:'line', line:el.dataset.line }, { from:el });

// Token evidence is calculated from saved counters by PenEcho. This view makes no model requests.
const tokenNumber = n => n == null ? 'Not reported' : new Intl.NumberFormat().format(n);
const tokenShort = n => n == null ? 'Not measured' : Math.abs(n) >= 1e6 ? `${+(Math.abs(n)/1e6).toFixed(2)}M` : Math.abs(n) >= 1000 ? `${+(Math.abs(n)/1000).toFixed(1)}k` : String(Math.abs(n));
const tokenSaved = n => n > 0 ? `≈ ${tokenShort(n)} tokens saved` : '';
// Every agent's input count already includes its cache reads, so this is the share of input served from the cache. Rounded down, so it never shows 100% when some input was new.
const tokenCachePct = t => t?.inputTokens > 0 && t.cacheReadInputTokens != null ? `${Math.floor(1000 * t.cacheReadInputTokens / t.inputTokens) / 10}%` : '';
// Input the model had not cached, as Codex and Claude Code show it first. Null when the agent did not say what came from the cache.
const tokenNewIn = t => t?.inputTokens == null || t.cacheReadInputTokens == null ? null : Math.max(0, t.inputTokens - t.cacheReadInputTokens);
const tokenInWords = t => tokenNewIn(t) == null ? `${tokenShort(t.inputTokens)} tokens in` : `${tokenShort(tokenNewIn(t))} new in${t.cacheReadInputTokens ? ` · ${tokenShort(t.cacheReadInputTokens)} from cache` : ''}`;
// Saving against resuming, as whole percents: cost is every kind of token weighed by its list price, cache hits and writes included.
const tokenPct = n => `${Math.round(Math.abs(n))}%`;
const tokenSavedPct = x => x?.costPercent == null ? '' : x.costPercent > 0 ? `≈ ${tokenPct(x.costPercent)} less cost` : `≈ ${tokenPct(x.costPercent)} more cost`;
const tokenFewer = x => x?.tokensPercent == null ? '' : x.tokensPercent >= 0 ? `${tokenPct(x.tokensPercent)} fewer tokens` : `${tokenPct(x.tokensPercent)} more tokens`;
// The same, with how many tokens that is: "≈ 146M fewer tokens (45%)".
const tokenFewerCount = x => { const d = x?.resumed?.tokensIn - x?.fresh?.tokensIn; return x?.tokensPercent == null || !Number.isFinite(d) ? tokenFewer(x) : `≈ ${tokenBrief(d)} ${d >= 0 ? 'fewer' : 'more'} tokens (${tokenPct(x.tokensPercent)})`; };
// How long the earlier conversation sat unused before this Work: "12 min", "9 h 22 min", "2 days".
const tokenIdle = m => m < 60 ? `${m} min` : m < 2880 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${Math.round(m / 1440)} days`;
const tokenCacheWords = k => k.cache === 'model' ? 'cache lost when the model changed' : k.cache === 'warm' ? `cache still warm after ${tokenIdle(k.idleMinutes)}` : k.cache === 'unknown' ? `cache counted as still warm after ${k.idleMinutes == null ? 'an unknown pause' : tokenIdle(k.idleMinutes)}` : `cache expired after ${k.idleMinutes == null ? 'an unknown pause' : tokenIdle(k.idleMinutes)}`;
// Shown only when there is something measured. A Work with no usage on record shows nothing, not an error.
// The line itself opens its Details (PE-478), so it carries no Details link.
function tokenWorkHTML(s, line = S.route.line) {
  const t = s.tokens, c = t?.startup;
  if (!t || t.inputTokens == null) return '';
  const k = c?.status === 'compared' ? c.cost : null;
  const tok = (cls, label, inner) => `<button type="button" class="token-work ${cls}" data-act="token-proof" data-line="${esc(line)}" data-step="${esc(s.id)}" aria-label="${label}: details" title="Token details">${inner}</button>`;
  if (k?.costPercent != null)
    return tok(k.costPercent > 0 ? 'saved' : 'quiet', 'Token savings for this Work', `<strong>${esc(tokenSavedPct(k))} · ${esc(tokenFewerCount(k))}</strong><span>than resuming the ${esc(tokenShort(c.baseline.input))} conversation, ${esc(tokenCacheWords(k))}</span>`);
  if (c?.status === 'compared' && c.difference > 0)
    return tok('saved', 'Token savings for this Work', `<strong>${esc(tokenSaved(c.taskEstimate ?? c.difference))}</strong><span>Started with ${esc(tokenShort(c.first.input))} instead of ${esc(tokenShort(c.baseline.input))}${c.percent ? ` (−${c.percent}%)` : ''}</span>`);
  if (c?.status === 'compared') return tok('quiet', 'Tokens for this Work', `<span>Started with ${esc(tokenShort(c.first.input))} tokens, ${esc(tokenShort(c.difference))} more than continuing</span>`);
  return tok('quiet', 'Tokens for this Work', `<span>${esc(tokenInWords(t))} · ${esc(tokenShort(t.outputTokens ?? 0))} out</span>`);
}
function tokenLineHTML(l) {
  const t = l.tokens, k = t?.cost, starts = `${t?.compared} fresh start${t?.compared === 1 ? '' : 's'}`;
  if (k?.costPercent != null)
    return `<div class="token-line${k.costPercent > 0 ? '' : ' more'}" aria-label="Token savings for this Line"><strong>${esc(tokenSavedPct(k))} on this Line</strong><span>${esc(tokenFewerCount(k))} · ${esc(starts)}</span><button type="button" class="link" data-act="token-proof" data-line="${esc(l.id)}">Details</button></div>`;
  if (!(t?.taskEstimate > 0)) return '';
  return `<div class="token-line" aria-label="Token savings for this Line"><strong>${esc(tokenSaved(t.taskEstimate))} on this Line</strong><span>${esc(starts)}</span><button type="button" class="link" data-act="token-proof" data-line="${esc(l.id)}">Details</button></div>`;
}
// The same totals as the server's costTotals, for the chosen period.
function tokenCostTotals(starts) {
  const rows = starts.map(x=>x.cost).filter(Boolean);
  if (!rows.length) return null;
  const sum = (side, key) => rows.reduce((n,r)=>n+r[side][key],0), share = (a,b) => b > 0 ? Math.round(1000*(b-a)/b)/10 : null;
  // Dollars when every Work's price is saved: Works of models priced apart only add up as money.
  const priced = rows.every(r => r.fresh.usd != null && r.resumed.usd != null), money = side => Math.round(sum(side, 'usd') * 1e4) / 1e4;
  return { works:rows.length, fresh:{ tokensIn:sum('fresh','tokensIn'), cost:sum('fresh','cost'), ...(priced ? { usd:money('fresh') } : {}) }, resumed:{ tokensIn:sum('resumed','tokensIn'), cost:sum('resumed','cost'), ...(priced ? { usd:money('resumed') } : {}) },
    tokensPercent:share(sum('fresh','tokensIn'),sum('resumed','tokensIn')), costPercent:priced ? share(money('fresh'), money('resumed')) : share(sum('fresh','cost'),sum('resumed','cost')) };
}
function tokenPeriodData(p, period = S.tokenPeriod || 'week', now = Date.now()) {
  const d = p.tokens || {}, since = periodSince(period, now);
  const starts = (d.starts || []).filter(x=>x.at >= since && x.at <= now), compared = starts.filter(x=>x.status === 'compared');
  const days = (d.daily || []).filter(x=>Date.parse(`${x.day}T00:00:00Z`) >= since && Date.parse(`${x.day}T00:00:00Z`) <= now);
  const sum = key => days.some(x=>x[key] != null) ? days.reduce((n,x)=>n+(x[key] || 0),0) : null;
  return { since,tasks:starts.length,compared:compared.length,difference:compared.length ? compared.reduce((n,x)=>n+x.difference,0) : null,
    taskEstimate:compared.length ? compared.reduce((n,x)=>n+(x.taskEstimate ?? x.difference),0) : null,
    baseline:compared.length ? compared.reduce((n,x)=>n+(x.baseline || 0),0) : null, cost:tokenCostTotals(compared),
    inputTokens:period === 'all' ? d.inputTokens ?? null : sum('inputTokens'),outputTokens:period === 'all' ? d.outputTokens ?? null : sum('outputTokens'),
    cacheReadInputTokens:period === 'all' ? d.cacheReadInputTokens ?? null : sum('cacheReadInputTokens'),days };
}
// The most bars the card draws, the newest fresh starts.
const TOKEN_BARS = 40;
// Short enough for three numbers side by side: 1.47B, 41.2M, 7.2M.
const tokenBrief = n => (n == null ? '—' : Math.abs(n) >= 1e9 ? `${+(n / 1e9).toFixed(2)}B` : Math.abs(n) >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : tokenShort(n));
// The saving as a full-width strip above Topics: headline savings, comparison bar + per-start bars, token totals, and Details.
// With Topics on the page their switch sets the period; with none, the strip has its own.
function tokenProjectHTML(p) {
  const period = periodNow(), t = tokenPeriodData(p,period), k = t.cost, own = p.projectTopics === false || !(p.knowledge || []).length;
  if (!p.tokens?.measuredWorks) return '';
  const per = { today:'Today', week:'Last 7 days', all:'All time' }[period];
  const pct = k?.costPercent;
  const usdDiff = k?.resumed?.usd != null && k?.fresh?.usd != null ? k.resumed.usd - k.fresh.usd : null;
  const usdTag = usdDiff != null && Math.abs(usdDiff) >= 0.005 ? ` · ≈ ${esc(tokenMoney(Math.abs(usdDiff)))}` : '';
  const big = pct != null ? `<b>≈ ${esc(tokenPct(pct))}</b> ${pct >= 0 ? 'less cost' : 'more cost'}${usdTag}` : t.taskEstimate > 0 ? `<b>≈ ${esc(tokenShort(t.taskEstimate))}</b> tokens saved` : '<b>—</b> nothing compared yet';
  const sub = t.compared ? `${k ? `${esc(tokenFewerCount(k))} · ` : ''}${esc(plural(t.compared, 'fresh start', 'fresh starts'))}` : '';
  // PenEcho's cost as a share of resuming's; when it cost more, resuming's share of PenEcho's, and the rest is the extra.
  const fc = k?.fresh.cost, rc = k?.resumed.cost, fill = rc > 0 && fc > 0 ? 100 * Math.min(fc, rc) / Math.max(fc, rc) : null, more = k && fc > rc;
  const bar = fill == null ? '' : `<div class="tk-cmp${more ? ' is-more' : ''}" role="img" aria-label="${more ? `PenEcho cost ${esc(tokenPct(pct))} more than resuming` : `PenEcho cost ${Math.round(fill)}% of resuming`}"><span class="tk-pe" style="width:${fill.toFixed(1)}%" title="${more ? 'Resuming' : `With PenEcho: ${Math.round(fill)}% of the cost of resuming`}"></span><span class="tk-saved" title="${more ? 'More than resuming' : 'Saved, compared with resuming the conversation'}">${more ? '+' : '−'}${esc(tokenPct(pct))}</span></div>`;
  const starts = (p.tokens.starts || []).filter(x => x.at >= t.since && x.cost?.costPercent != null).sort((a, b) => a.at - b.at).slice(-TOKEN_BARS), max = Math.max(1, ...starts.map(x => Math.abs(x.cost.costPercent)));
  const spark = starts.length > 1 ? `<div class="tk-spark" aria-hidden="true">${starts.map(x => { const v = x.cost.costPercent, h = 22 * Math.abs(v) / max; return `<i class="${v < 0 ? 'is-more' : ''}" title="${esc(`${tokenPct(v)} ${v < 0 ? 'more' : 'less'} cost · fresh start · ${shortWhen(x.at)}`)}"><b style="${v >= 0 ? `bottom:34%;height:${Math.max(1.5, h).toFixed(1)}px` : `top:66%;height:${Math.max(1.5, h / 2).toFixed(1)}px`}"></b></i>`; }).join('')}</div>` : '';
  const nums = t.inputTokens == null ? '' : `<dl class="tk-nums">${tokenNewIn(t) == null ? `<div><dt>In</dt><dd>${esc(tokenBrief(t.inputTokens))}</dd></div>` : `<div><dt>New in</dt><dd>${esc(tokenBrief(tokenNewIn(t)))}</dd></div><div class="is-cache"><dt>From cache</dt><dd>${esc(tokenBrief(t.cacheReadInputTokens))}</dd></div>`}<div><dt>Out</dt><dd>${esc(tokenBrief(t.outputTokens))}</dd></div></dl>`;
  const head = own ? `<header class="tk-head"><h2>Token savings</h2>${periodHTML('Token savings period')}</header>` : `<div class="tk-eyebrow"><span>Token savings</span><em>${per}</em></div>`;
  const vis = bar || spark ? `<div class="tk-vis">${bar}${spark}</div>` : '';
  return `<section class="hm-card token-project is-strip" aria-label="Project token savings, ${per}">${head}
    <div class="tk-lead"><div class="tk-big${pct < 0 ? ' is-more' : ''}">${big}</div>${sub ? `<p class="tk-sub">${sub}</p>` : ''}</div>
    ${vis}${nums}
    <button type="button" class="tk-details" data-act="token-proof">Details</button>
  </section>`;
}
ACT['token-period'] = el => {
  S.tokenPeriod = el.dataset.period;
  const host = el.closest('#hmWeek, #hmTokens')?.id;
  refreshDesk();
  $(`${host ? `#${host} ` : ''}[data-act="token-period"][data-period="${S.tokenPeriod}"]`)?.focus();
};
// ---- Token savings evidence, drawn (PE-927) ----
// Dollars when the model's price is saved (Agent record & prices); otherwise the cost in that model's own new-input tokens.
const tokenMoney = n => `$${n >= 100 ? Math.round(n) : n >= 0.01 ? n.toFixed(2) : n.toFixed(3)}`;
const tokenAmount = (side, k) => side.usd != null ? tokenMoney(side.usd) : `${tokenBrief(side.cost)}${k ? ' new-input tokens' : ''}`;
// What each side cost and what it is made of: one bar each on the same scale. The earlier conversation, sent again with every
// request, is the part a fresh start does not pay.
const TOKEN_PARTS = [['s-earlier', 'Sent again with every request'], ['s-own', 'This Work’s own context'], ['s-out', 'Output']];
function tokenCostBarsHTML(k, c) {
  const parts = k?.parts;
  if (!parts || parts.fresh.length !== 3 || !(k.resumed.cost > 0) || !(k.fresh.cost > 0)) return '';
  const unit = k.prices?.usd || 0, amount = v => unit ? tokenMoney(v * unit) : tokenBrief(v), whole = Math.max(k.resumed.cost, k.fresh.cost);
  const seg = (i, v, total, what) => v > 0 ? `<i class="tkc-seg ${TOKEN_PARTS[i][0]}" style="flex:${v} 1 0" tabindex="0" data-tip="${esc(what || TOKEN_PARTS[i][1])}" data-value="${esc(`${amount(v)} · ${Math.round(100 * v / total)}%`)}"></i>` : '';
  const row = (name, side, list, carried, about) => `<div class="tkc-row"><span class="tkc-name">${name}</span><div class="tkc-track"><div class="tkc-bar" style="width:${(100 * side.cost / whole).toFixed(2)}%">${seg(0, list[0], side.cost, carried)}${seg(1, list[1], side.cost)}${seg(2, list[2], side.cost)}</div></div><b class="tkc-val">${about ? '≈ ' : ''}${esc(tokenAmount(side))}</b></div>`;
  return `<figure class="tkc"><figcaption>What that costs${unit ? '' : ', in new-input tokens'}</figcaption>
    <div class="tkc-bars" role="img" aria-label="${esc(`Resuming: about ${tokenAmount(k.resumed)}, of which ${amount(parts.resumed[0])} is the earlier conversation sent again with every request. Fresh start: ${tokenAmount(k.fresh)}, of which ${amount(parts.fresh[0])} is the fresh start sent again.`)}">
      ${row('Resuming', k.resumed, parts.resumed, `The earlier conversation${c?.baseline?.input ? ` (${tokenShort(c.baseline.input)} tokens)` : ''}, sent again with every request`, true)}
      ${row('Fresh start', k.fresh, parts.fresh, `The fresh start${c?.first?.input ? ` (${tokenShort(c.first.input)} tokens)` : ''}, sent again with every request`, false)}
    </div>
    <ul class="tkc-legend">${TOKEN_PARTS.map(([cls, name]) => `<li><i class="${cls}"></i>${esc(name)}</li>`).join('')}</ul></figure>`;
}
// The tokens each request sent: what the fresh start really sent, and what resuming would have (the earlier conversation in place of
// the fresh start). Drawn from the Work's own saved record when its evidence is opened; nothing is asked of any model.
const tokenNiceMax = v => { const p = 10 ** Math.floor(Math.log10(Math.max(1, v))), n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; };
function tokenRequestsHTML(fresh, resumed, earlier) {
  const n = fresh.length;
  if (n < 2) return '';
  const W = 640, H = 196, L = 46, R = 132, T = 14, B = 26, pw = W - L - R, ph = H - T - B, max = tokenNiceMax(Math.max(...resumed, ...fresh));
  const x = i => L + pw * i / (n - 1), y = v => T + ph * (1 - v / max), pts = list => list.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const grid = [0, max / 2, max].map(v => `<line class="tkc-grid" x1="${L}" x2="${L + pw}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text class="tkc-tick" x="${L - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${esc(tokenBrief(v))}</text>`).join('');
  // The two ends are labelled where they finish; when they finish close together the labels are moved apart, each still beside its own dot.
  let ya = y(resumed[n - 1]), yb = y(fresh[n - 1]);
  if (Math.abs(ya - yb) < 34) { const mid = (ya + yb) / 2, up = ya <= yb; ya = mid + (up ? -17 : 17); yb = mid + (up ? 17 : -17); }
  const end = (list, cls, yy, value, name) => `<circle class="tkc-dot ${cls}" cx="${x(n - 1).toFixed(1)}" cy="${y(list[n - 1]).toFixed(1)}" r="4"/><text class="tkc-end" x="${(x(n - 1) + 12).toFixed(1)}" y="${(yy - 2).toFixed(1)}"><tspan class="v">${esc(value)}</tspan><tspan class="n" x="${(x(n - 1) + 12).toFixed(1)}" dy="14">${name}</tspan></text>`;
  return `<figure class="tkc"><figcaption>Tokens sent with each request</figcaption>
    <ul class="tkc-legend is-lines"><li><i class="s-earlier"></i>Resuming the ${esc(tokenShort(earlier))} conversation</li><li><i class="s-own"></i>Fresh start</li></ul>
    <div class="tkc-plot" data-fresh="${esc(fresh.join(','))}" data-resumed="${esc(resumed.join(','))}" data-l="${L / W}" data-w="${pw / W}">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`Over ${n} requests the fresh start sent ${tokenBrief(fresh[0])} to ${tokenBrief(fresh[n - 1])} tokens each time; resuming would have sent about ${tokenBrief(resumed[0])} to ${tokenBrief(resumed[n - 1])}.`)}">
        ${grid}<text class="tkc-tick" x="${L}" y="${H - 6}">Request 1</text><text class="tkc-tick" x="${L + pw}" y="${H - 6}" text-anchor="end">${n}</text>
        <polygon class="tkc-wash s-own" points="${L},${y(0)} ${pts(fresh)} ${L + pw},${y(0)}"/>
        <polyline class="tkc-line s-earlier" points="${pts(resumed)}"/><polyline class="tkc-line s-own" points="${pts(fresh)}"/>
        <line class="tkc-cross" y1="${T}" y2="${T + ph}" hidden/><circle class="tkc-dot s-earlier tkc-at" r="4" hidden/><circle class="tkc-dot s-own tkc-at" r="4" hidden/>
        ${end(resumed, 's-earlier', ya, `≈ ${tokenBrief(resumed[n - 1])}`, 'resuming')}${end(fresh, 's-own', yb, tokenBrief(fresh[n - 1]), 'fresh start')}
      </svg></div></figure>`;
}
// A Work's requests from its saved evidence: what each sent, and what resuming would have sent in its place.
function tokenRequestsOf(evidence, c) {
  const fresh = (evidence?.attempts || []).flatMap(a => a.requests || []).map(r => r.inputTokens).filter(Number.isFinite), earlier = c?.baseline?.input, first = fresh[0];
  if (fresh.length < 2 || !Number.isFinite(earlier)) return null;
  return { fresh, resumed:fresh.map(v => Math.max(earlier, earlier + v - first)), earlier };
}
function tokenProofWorkHTML({s,l}, p, open) {
  const t=s.tokens, c=t?.startup, b=c?.baseline, f=c?.first, k=c?.status === 'compared' ? c.cost : null;
  const head = k?.costPercent != null ? `${tokenSavedPct(k)} · ${tokenFewer(k)} than resuming` : c?.status === 'compared' ? (c.difference > 0 ? tokenSaved(c.taskEstimate ?? c.difference) : `${tokenShort(c.difference)} more at the start`) : c?.status === 'continuation' ? 'Continued the same conversation' : c?.status === 'recovered' ? 'Started a new conversation: the earlier one could not be resumed' : c?.status === 'earlier' ? 'Ran before PenEcho chose the context for each task' : c?.status === 'app' || c?.status === 'running' ? c.reason : 'No earlier conversation to compare with';
  const rereads = k ? (k.rereads === 'matched' ? 'matched with what the earlier conversation read' : k.rereads === 'every read counted' ? 'the earlier conversation’s reads were not recorded, so every read counts' : 'not recorded for this Work') : '';
  const pricesUsed = k ? `${k.prices.source === 'saved' ? `${k.prices.model || k.prices.name}, as saved in Agent record & prices` : `typical ${k.prices.name} prices`}: cache hit ${+k.prices.read.toFixed(3)}×, cache write ${+k.prices.write.toFixed(2)}×, output ${+k.prices.output.toFixed(2)}× new input` : '';
  const costRows = k ? `<div><dt>Tokens in: fresh / resumed</dt><dd>${esc(tokenNumber(k.fresh.tokensIn))} / ≈ ${esc(tokenNumber(k.resumed.tokensIn))} (${esc(tokenFewer(k))})</dd></div><div><dt>Cost${k.fresh.usd != null ? '' : ' in new-input tokens'}: fresh / resumed</dt><dd>${esc(k.fresh.usd != null ? tokenMoney(k.fresh.usd) : tokenNumber(k.fresh.cost))} / ≈ ${esc(k.resumed.usd != null ? tokenMoney(k.resumed.usd) : tokenNumber(k.resumed.cost))} (${esc(tokenSavedPct(k))})</dd></div><div><dt>Cache when it would have resumed</dt><dd>${esc(tokenCacheWords(k))}</dd></div>${k.otherCache?.costPercent != null ? `<div><dt>Had the cache ${k.otherCache.cache === 'expired' ? 'expired' : 'been warm'}</dt><dd>${esc(tokenSavedPct(k.otherCache))}</dd></div>` : ''}<div><dt>Read again by the fresh start</dt><dd>${esc(tokenNumber(k.rereadTokens))} tokens, ${esc(rereads)}${k.skippedRequests ? `; ${k.skippedRequests} request${k.skippedRequests === 1 ? '' : 's'} that only re-read left out` : ''}</dd></div><div><dt>Prices used</dt><dd>${esc(pricesUsed)}</dd></div>` : '';
  const evidence = t && s.tokenEvidencePath ? apiUrl(`${pathFor(p.id)}/file?path=${encodeURIComponent(s.tokenEvidencePath)}`) : '';
  // The saving first, then how it comes about, in pictures; the figures behind them stay one click away.
  const hero = k?.costPercent != null ? `<div class="tkp-hero${k.costPercent > 0 ? '' : ' is-more'}"><b>${esc(tokenSavedPct(k))}</b>${k.fresh.usd != null ? `<span>${esc(tokenMoney(k.fresh.usd))} instead of ≈ ${esc(tokenMoney(k.resumed.usd))}</span>` : ''}<span>${esc(tokenFewerCount(k))}</span></div>` : `<strong>${esc(head)}</strong>`;
  const how = k && b ? `<p class="tkp-how">A conversation is sent again, whole, with every request. Resuming would have carried the earlier ${esc(tokenShort(b.input))} tokens through all ${esc(tokenNumber(c.requests))} requests of this Work; the fresh start began with ${esc(tokenShort(f?.input))}.</p>` : '';
  const requests = k && evidence ? `<div class="tkp-requests" data-evidence="${esc(evidence)}" data-earlier="${esc(b.input)}"${open ? ' data-open' : ''}>${open ? '' : '<button type="button" class="link" data-act="token-requests">Show each request</button>'}</div>` : '';
  const unsure = k?.cache === 'model' ? `<p class="tkp-note">The earlier conversation ran on ${esc((b?.models || [b?.model]).join(', '))} and this Work on ${esc(f?.model)}. A model cannot use another’s cache, so resuming would have written the whole conversation to it again.</p>` : k?.cache === 'unknown' ? `<p class="tkp-note">Whether the earlier conversation was still in its agent’s cache after ${k.idleMinutes == null ? 'the pause' : esc(tokenIdle(k.idleMinutes))} is not known, so it is counted as if it were: the smaller saving.${k.otherCache?.costPercent != null ? ` Had it expired: ${esc(tokenSavedPct(k.otherCache))}.` : ''}</p>` : '';
  const numbers = `<dl>${c?.status === 'compared' ? `<div><dt>Conversation it would have resumed (last request)</dt><dd>${esc(tokenNumber(b?.input))}</dd></div><div><dt>Fresh start (first request)</dt><dd>${esc(tokenNumber(f?.input))}</dd></div>${costRows || `<div><dt>Saved at the start</dt><dd>${esc(tokenNumber(c.difference))}${c.percent ? ` (${c.percent}%)` : ''}</dd></div>`}<div><dt>Requests in this task</dt><dd>${esc(tokenNumber(c.requests))}</dd></div>` : ''}${tokenNewIn(t) != null ? `<div><dt>New in / out</dt><dd>${esc(tokenNumber(tokenNewIn(t)))} / ${esc(tokenNumber(t.outputTokens))}</dd></div><div><dt>Tokens in, whole context</dt><dd>${esc(tokenNumber(t.inputTokens))}</dd></div>` : `<div><dt>Tokens in / out</dt><dd>${esc(tokenNumber(t?.inputTokens))} / ${esc(tokenNumber(t?.outputTokens))}</dd></div>`}<div><dt>Of which cache reads / writes</dt><dd>${esc(tokenNumber(t?.cacheReadInputTokens))} / ${esc(tokenNumber(t?.cacheWriteInputTokens))}</dd></div>${tokenCachePct(t) ? `<div><dt>Cache hit rate</dt><dd>${esc(tokenCachePct(t))}</dd></div>` : ''}</dl>
    ${t ? `<p class="token-source">${t.backfilled ? 'Read back from PenEcho’s run log' : 'Recorded as the agent ran'} · ${t.requests ?? 0} requests · ${esc(t.coverage)}<br>Model: ${esc(f?.model || b?.model || t.lastRequest?.model || 'not reported')}${b?.requestId ? `<br>Resumed conversation’s last request: ${esc(b.requestId)}` : ''}${f?.requestId ? `<br>First request: ${esc(f.requestId)}` : ''}</p>` : ''}`;
  return `<section class="token-proof-work"><h3>${esc(l.title)} · ${esc(s.label || s.id)}</h3>${hero}${t?.decision?.why ? `<p class="tkp-why">Why ${t.decision.mode === 'new' ? 'a fresh start' : c?.status === 'recovered' ? 'it was to continue' : 'it continued'}: ${esc(t.decision.why)}.</p>` : ''}
    ${how}${requests}${k ? tokenCostBarsHTML(k, c) : ''}${unsure}
    ${k ? `<details class="tkp-more"><summary>The figures</summary>${numbers}</details>` : numbers}
    <div class="token-proof-acts"><button type="button" class="link" data-act="token-open-work" data-line="${esc(l.id)}" data-step="${esc(s.id)}">Open Work</button>${evidence ? `<a class="link" href="${esc(evidence)}" download>Usage evidence (JSON)</a>` : ''}${t?.manifest ? `<a class="link" href="${esc(apiUrl(`${pathFor(p.id)}/file?path=${encodeURIComponent(t.manifest)}`))}" download>Context sources (JSON)</a>` : ''}</div></section>`;
}
// How many Works the evidence dialog draws at once; more load as you scroll, newest first.
const TOKEN_PROOF_BATCH = 10;
const tokenProofMs = v => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v ? Date.parse(v) || 0 : 0);
const tokenProofStart = ({ s }) => tokenProofMs(s?.tokens?.startup?.first?.at) || tokenProofMs(s?.tokens?.createdAt) || tokenProofMs(s?.startedAt) || 0;
const tokenProofAt = ({ s, l }) => Math.max(tokenProofMs(s?.tokens?.lastRequest?.at), tokenProofMs(s?.endedAt)) || tokenProofStart({ s }) || tokenProofMs(l?.lastActivityAt) || tokenProofMs(l?.updatedAt) || tokenProofMs(l?.createdAt) || 0;
function tokenProofSort(rows) {
  return rows
    .map((row, index) => ({ row, at:tokenProofAt(row), start:tokenProofStart(row), index }))
    .sort((a, b) => (b.at - a.at) || (b.start - a.start) || (b.index - a.index))
    .map(x => x.row);
}
function tokenProofMoreHTML(shown, total) {
  if (shown >= total) return '';
  return `<div class="token-proof-more" data-token-proof-more><span class="token-proof-count">Showing ${esc(tokenNumber(shown))} of ${esc(tokenNumber(total))}</span><button type="button" class="link" data-act="token-proof-more">Load more</button></div>`;
}
function tokenProofBody(rows, p, { limit = TOKEN_PROOF_BATCH, sorted = false } = {}) {
  const ordered = sorted ? rows : tokenProofSort(rows);
  // With a few Works their requests are drawn at once; in a long list each is drawn when asked for.
  const open = ordered.length <= 3;
  const shown = limit > 0 ? ordered.slice(0, limit) : ordered;
  const list = shown.length ? `<div class="token-proof-list">${shown.map(row => tokenProofWorkHTML(row, p, open)).join('')}</div>${tokenProofMoreHTML(shown.length, ordered.length)}` : '<p>No measured Work in this period yet.</p>';
  return `${list}
    <details class="tkp-more tkp-method"><summary>How this is worked out</summary>
    <p>PenEcho continues the last conversation while it is still in its agent’s cache and under that agent’s size limit (Claude Code 80k tokens, Codex 120k, the others 60k), where continuing costs less. An answer to the agent’s question continues at any size while the cache holds. Otherwise, and always after another agent’s Work, it starts the new task fresh, with only the parts of the Line it needs. You never have to choose.</p>
    <p><strong>Each fresh start is compared with resuming the conversation its agent would otherwise have continued, for the same work.</strong></p>
    <ul><li><strong>Fresh:</strong> what the agent reported for this Work.</li>
      <li><strong>Resumed:</strong> every request of this Work carrying the earlier conversation instead of the fresh start. Files and searches this Work read again, that the earlier conversation had already read, are taken out, so the fresh start pays for its own catching up; of a command that showed several things, the share read before. The earlier conversation is taken whole, as it was at its last request.</li>
      <li><strong>Cache:</strong> within the agent’s cache time (Claude Code and Codex 1 hour, as measured on their past resumes; the others taken as 1 hour) the earlier conversation is a cache hit. Claude Code’s cache is known to end after its hour. Codex’s is taken as gone after 3 hours: 18 of 22 past resumes found nothing by then. When the others’ end is not published. Between its hour and then (a day for the others), the saving is counted as if the cache were still warm, which is the smaller figure; the other is given beside it. Each model has its own cache, so after a change of model nothing of the earlier conversation is in it. The pause counts from the earlier conversation’s last request, not from your last message on the Line.</li>
      <li><strong>Cost:</strong> each kind of token weighed by its price: the one saved for the model in Agent record &amp; prices, shown in dollars, or typical list prices when none is saved, shown in that model’s new-input tokens. Each Work names the prices used.</li></ul>
    <p><strong>New in</strong> is input the model had not cached, as Codex and Claude Code show it. <strong>From cache</strong> is the earlier context each request sends again, read from the cache at a fraction of the price. Together they are <strong>tokens in</strong>: every request’s whole context.</p>
    <p>PenEcho works this out from the saved records on this computer. No AI is called to make it.</p></details>`;
}
// One tooltip for the evidence's pictures: a bar's part under the pointer or the keyboard, or the request nearest the pointer.
function tokenProofHover(dialog) {
  const tip = document.createElement('div'); tip.className = 'tkc-tip'; tip.hidden = true; dialog.append(tip);
  const rectOf = el => typeof pageRect === 'function' ? pageRect(el) : el.getBoundingClientRect();
  const pointOf = (x, y) => typeof pagePoint === 'function' ? pagePoint(x, y) : { x, y };
  const show = (lines, cx, cy) => {
    tip.replaceChildren(...lines.map(([value, label, cls]) => { const row = document.createElement('div'); if (cls) { const key = document.createElement('i'); key.className = cls; row.append(key); } const b = document.createElement('b'); b.textContent = value; const span = document.createElement('span'); span.textContent = label; row.append(b, span); return row; }));
    tip.hidden = false;
    const box = rectOf(dialog), w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = `${Math.max(8, Math.min(box.width - w - 8, cx - box.left + 12))}px`; tip.style.top = `${Math.max(8, cy - box.top - h - 10)}px`;
  };
  const hide = plot => { tip.hidden = true; for (const el of (plot || dialog).querySelectorAll('.tkc-cross, .tkc-at')) el.setAttribute('hidden', ''); };
  const part = el => { const r = rectOf(el); show([[el.dataset.value, el.dataset.tip, el.className.replace('tkc-seg ', '')]], r.left + r.width / 2, r.top); };
  dialog.addEventListener('pointermove', e => {
    const seg = e.target.closest?.('.tkc-seg'), plot = e.target.closest?.('.tkc-plot'), pt = pointOf(e.clientX, e.clientY);
    if (seg) { hide(); show([[seg.dataset.value, seg.dataset.tip, seg.className.replace('tkc-seg ', '')]], pt.x, pt.y); return; }
    if (!plot) { hide(); return; }
    const fresh = plot.dataset.fresh.split(',').map(Number), resumed = plot.dataset.resumed.split(',').map(Number), n = fresh.length, svg = plot.querySelector('svg'), r = rectOf(svg);
    const i = Math.max(0, Math.min(n - 1, Math.round((n - 1) * ((pt.x - r.left) / r.width - Number(plot.dataset.l)) / Number(plot.dataset.w))));
    const [vw, vh] = svg.getAttribute('viewBox').split(' ').slice(2).map(Number), L = Number(plot.dataset.l) * vw, pw = Number(plot.dataset.w) * vw, max = tokenNiceMax(Math.max(...resumed, ...fresh)), x = L + pw * i / (n - 1), y = v => 14 + (vh - 40) * (1 - v / max);
    const cross = plot.querySelector('.tkc-cross'), [a, b] = plot.querySelectorAll('.tkc-at');
    cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.removeAttribute('hidden');
    a.setAttribute('cx', x); a.setAttribute('cy', y(resumed[i])); a.removeAttribute('hidden'); b.setAttribute('cx', x); b.setAttribute('cy', y(fresh[i])); b.removeAttribute('hidden');
    show([[`Request ${i + 1}`, ''], [`≈ ${tokenNumber(resumed[i])}`, 'resuming', 's-earlier'], [tokenNumber(fresh[i]), 'fresh start', 's-own']], pt.x, r.top + r.height * y(resumed[i]) / vh);
  });
  dialog.addEventListener('pointerleave', () => hide());
  dialog.addEventListener('focusin', e => { if (e.target.matches?.('.tkc-seg')) part(e.target); });
  dialog.addEventListener('focusout', e => { if (e.target.matches?.('.tkc-seg')) hide(); });
}
// A Work's requests are drawn from its own saved evidence file, read when the picture is wanted.
async function tokenRequestsDraw(host) {
  if (!host || host.dataset.drawn) return;
  host.dataset.drawn = '1';
  try {
    const evidence = await (await fetch(host.dataset.evidence)).json(), d = tokenRequestsOf(evidence, { baseline:{ input:Number(host.dataset.earlier) } });
    host.innerHTML = d ? tokenRequestsHTML(d.fresh, d.resumed, d.earlier) : '';
  } catch { host.innerHTML = ''; }
}
const tokenProofLoaders = new WeakMap();
function tokenProofLazy(dialog, rows, p, batch = TOKEN_PROOF_BATCH) {
  const body = dialog.querySelector('.token-proof-body'), list = body?.querySelector('.token-proof-list');
  if (!body || !list || rows.length <= batch) return () => 0;
  let shown = list.querySelectorAll('.token-proof-work').length, observer = null, raf = 0;
  const moreEl = () => body.querySelector('[data-token-proof-more]');
  const stop = () => {
    if (observer) { observer.disconnect(); observer = null; }
    if (raf && typeof cancelAnimationFrame === 'function') { cancelAnimationFrame(raf); raf = 0; }
    body.removeEventListener('scroll', onScroll);
    tokenProofLoaders.delete(dialog);
  };
  const load = ({ fromClick = false } = {}) => {
    if (shown >= rows.length) { stop(); return 0; }
    const next = rows.slice(shown, shown + batch);
    if (!next.length) { stop(); return 0; }
    const prevCount = list.children.length;
    list.insertAdjacentHTML('beforeend', next.map(row => tokenProofWorkHTML(row, p, false)).join(''));
    shown += next.length;
    const footer = moreEl();
    if (shown >= rows.length) {
      const focused = fromClick && footer?.contains(document.activeElement);
      footer?.remove();
      if (focused) {
        const added = list.children[prevCount];
        if (added) { added.tabIndex = -1; added.focus?.({ preventScroll:true }); }
      }
      stop();
    } else if (footer) {
      const count = footer.querySelector('.token-proof-count');
      if (count) count.textContent = `Showing ${tokenNumber(shown)} of ${tokenNumber(rows.length)}`;
      if (observer) { observer.unobserve(footer); observer.observe(footer); }
    }
    return next.length;
  };
  const nearBottom = () => {
    if (shown >= rows.length) return false;
    const footer = moreEl();
    if (!footer) return false;
    if (body.scrollHeight > body.clientHeight && body.scrollTop + body.clientHeight >= body.scrollHeight - 280) return true;
    const br = body.getBoundingClientRect?.(), fr = footer.getBoundingClientRect?.();
    return Boolean(br && fr && br.height > 0 && fr.top <= br.bottom + 240);
  };
  const onScroll = () => {
    if (shown >= rows.length) { stop(); return; }
    if (nearBottom()) load();
  };
  tokenProofLoaders.set(dialog, load);
  body.addEventListener('scroll', onScroll, { passive:true });
  const footer = moreEl();
  if (footer && typeof IntersectionObserver === 'function') {
    observer = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) load();
    }, { root:body, rootMargin:'240px 0px' });
    observer.observe(footer);
  }
  if (typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(() => { raf = 0; if (nearBottom()) load(); });
  dialog.addEventListener('close', stop, { once:true });
  return load;
}
ACT['token-requests'] = el => tokenRequestsDraw(el.closest('.tkp-requests'));
ACT['token-proof-more'] = el => { const dialog = el.closest('dialog'); if (dialog) tokenProofLoaders.get(dialog)?.({ fromClick:true }); };
// Each Work's own record is read when the evidence for all of them is.
ACT['token-proof'] = el => {
  const p = project(), needs = { parts:['tokens'] };
  if (el.dataset.line || !lacks(p, needs)) return tokenProof(el);
  readNeeds(p, needs).then(() => { if (project()?.id === p.id) tokenProof(el); }, error => toast(error.message));
};
function tokenProof(el) {
  const p = project(), line = el.dataset.line, step = el.dataset.step;
  let rows;
  if (line) {
    const l = allLines(p).find(x => x.id === line);
    rows = l ? l.stations.filter(s => isWork(s) && !s.unsent && (!step || s.id === step)).map(s => ({ s, l })) : [];
  } else {
    const period = S.tokenPeriod || 'week', d = tokenPeriodData(p, period);
    const byLine = new Map(allLines(p).map(l => [l.id, l]));
    rows = (p.tokens?.records || []).filter(r => (r.startup?.first?.at || r.createdAt || r.lastRequest?.at || 0) >= d.since).map(r => {
      const [, oldSlug, oldId] = String(r.workId || '').split('/'), slug = r.lineId || oldSlug, id = r.stepId || oldId;
      const l = byLine.get(slug) || { id:slug, title:slug }, st = l.stations?.find(x => x.id === id);
      return { l, s:{ id, label:r.label || st?.label || id, ...(st?.startedAt ? { startedAt:st.startedAt } : {}), ...(st?.endedAt ? { endedAt:st.endedAt } : {}), tokens:r, tokenEvidencePath:r.evidencePath || `works/${slug}/${id}.tokens.json` } };
    });
  }
  rows = tokenProofSort(rows);
  const dialog = document.createElement('dialog'); dialog.className = 'token-proof-dialog';
  dialog.innerHTML = `<header><h2>Token savings evidence</h2><button type="button" class="icon-btn" data-act="token-close" aria-label="Close token evidence">${ic('x',18)}</button></header><div class="token-proof-body">${tokenProofBody(rows, p, { sorted:true })}</div>`;
  document.body.append(dialog); dialog.addEventListener('close',()=>dialog.remove(),{once:true}); dialog.showModal();
  tokenProofHover(dialog);
  tokenProofLazy(dialog, rows, p);
  for (const host of dialog.querySelectorAll('.tkp-requests[data-open]')) tokenRequestsDraw(host);
}
ACT['token-close'] = el => el.closest('dialog')?.close();
ACT['token-open-work'] = el => { el.closest('dialog')?.close(); go({view:'line',line:el.dataset.line,step:el.dataset.step}); };
