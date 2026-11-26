// A line's Topic (P4, PE-457, PE-459). A line's page shows, on its right while no Work is open, the line's knowledge Topic: its name, counts,
// goal and what is left. Merging lines into one is gone (PE-459): a Topic already holds what its lines are about, so its lines are not listed
// here either. Two Topics still merge, from the Topics page. Steps a line took in from another line before then keep that line's colour.
const MERGE_COLORS = ['#e4572e', '#0d9488', '#7c3aed', '#d98a1f', '#db2777', '#0891b2'];
// A synced Cloud Topic uses the same panel as a local Topic. The compact Canvas embed has no room for it.
const topicHere = (p, l) => Boolean(p && l) && p.projectTopics !== false && !EMBED && !l.archived && !l.mergedInto && !l.parent;
// The Topic whose Lines table names this line (knowledge.js), or null.
const topicOf = (p, l) => (p.knowledge || []).find(t => t.lines.includes(l.slug)) || null;
// With no Work picked, the right panel is the line's Topic when it has one (PE-457); without one, the latest Work opens as before.
const topicFirst = (p, l) => topicHere(p, l) && Boolean(topicOf(p, l));

// ---------- On the line's page ----------
// A few of its latest nodes, as on the Home.
function miniTrack(l) {
  const steps = l.stations.filter(s => !isEnd(s) && (s.state !== 'todo' || s.unsent)).slice(-6);
  return `<span class="sim-track" aria-hidden="true">${steps.map(s => `<i class="k-${isYours(s) ? s.kind : 'work'}${s.unsent ? ' is-unsent' : ''}"></i>`).join('')}</span>`;
}
const whenOf = ms => (ms ? shortWhen(ms) : '');
// The line's Topic: its name opens its file, with how many of its lines are open and done; its goal; what is left, from the Topic's
// "What is left, in order".
function topicPanelHTML(p, l, t) {
  const left = (t.left || []).length ? `<div class="sim-left"><h3>What is left</h3><ol>${t.left.map(x => `<li>${esc(x)}</li>`).join('')}</ol></div>` : '';
  return `<section class="sim sim-topic" aria-labelledby="simTopicHead">
    <header class="sim-head"><h2 id="simTopicHead"><button type="button" class="sim-topic-name" data-act="open-doc" data-doc="${esc(t.path)}">${ic('note', 16)}<span>${esc(t.title)}</span></button></h2>${countsHTML(topicCounts(p)(t))}</header>
    ${t.goal ? `<p class="sim-goal">${esc(t.goal)}</p>` : ''}
    ${left}
  </section>`;
}
function sidePanelHTML(p, l) {
  const t = topicHere(p, l) && topicOf(p, l);
  return t ? `<div class="sim-all">${topicPanelHTML(p, l, t)}</div>` : '';
}
// Where the Topic goes: the right panel when there is room for it; else under the line's track in its own column, so it shows without
// scrolling; under the line only when that column is folded or is a drawer (narrow screens). '' when the line is in no Topic.
const sideShown = () => { const side = $('#lpSide'); return Boolean(side) && !S.lineFolded && getComputedStyle(side).position !== 'absolute'; };
function topicPlaceHTML(p, l) {
  const html = sidePanelHTML(p, l), wide = ($('#view')?.clientWidth || innerWidth) >= 1180;
  const where = wide ? 'panel' : sideShown() ? 'side' : 'under';
  const fill = (el, next) => { if (el && el.dataset.h !== next) { el.dataset.h = next; el.innerHTML = next; } };
  fill($('#lpTopicSide'), where === 'side' ? html : '');
  fill($('#lpTopic'), where === 'under' ? html : '');
  return where === 'panel' ? html : '';
}
// A node merged in from another line, before merging lines was removed, is edged in that line's colour, with its title when you point at it.
function fromColor(l, slug) {
  const order = [...new Set([...(l.mergedFrom || []), ...l.stations.map(s => s.from?.slug).filter(Boolean)])];
  return MERGE_COLORS[Math.max(0, order.indexOf(slug)) % MERGE_COLORS.length];
}
const fromMark = (l, s) => (s.from ? ` data-from="${esc(s.from.slug)}" style="--from:${fromColor(l, s.from.slug)}" title="From ${esc(s.from.title || s.from.slug)}"` : '');
function openCompare(html) {
  const box = $('#lightbox');
  box.innerHTML = html;
  box.hidden = false;
  $('[data-act="merge-cancel"]', box)?.focus();
}
ACT['merge-cancel'] = () => closeLightbox();
// ---------- Two Topics into one (PE-457) ----------
// Merge on a Topic, on the Topics page, picks the other Topic, shows the two side by side, and Accept merge starts a line whose agent writes
// them as one (service.mergeTopics). The Topic you started from is the one kept.
function topicMergeButton(p, t) {
  if (HOSTED || (p.knowledge || []).length < 2) return '';
  return `<button type="button" class="btn sm sim-merge" data-act="topic-merge" data-topic="${esc(t.path)}">${ic('merge', 14)}Merge</button>`;
}
const topicByPath = (p, path) => (p.knowledge || []).find(t => t.path === path) || null;
ACT['topic-merge'] = el => {
  const p = project(), t = topicByPath(p, el.dataset.topic); if (!t) return;
  const others = (p.knowledge || []).filter(o => o.path !== t.path).sort((a, b) => a.title.localeCompare(b.title));
  openMenu(el, [{ head:`Merge into ${t.title}` }, ...others.map(o => ({ label:o.title, icon:'note', fn:() => openTopicCompare(p, t, o) }))], { align:'right' });
};
function topicCompareHTML(p, t, o) {
  const counts = topicCounts(p);
  const col = (x, color, mine) => {
    const lines = x.lines.map(slug => lineById(p, slug)).filter(l => l && !l.archived && !l.mergedInto).sort((a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0));
    return `<section class="mg-col${mine ? '' : ' is-other'}" style="--mc:${color}" aria-label="${esc(x.title)}"><header><i></i><h3 title="${esc(x.title)}">${esc(x.title)}</h3>${countsHTML(counts(x))}</header>
      <div class="mg-track">${x.goal ? `<p class="mg-goal">${esc(x.goal)}</p>` : ''}${lines.map(l => `<div class="mg-tline"><strong>${esc(l.title)}</strong><div class="sim-foot">${miniTrack(l)}<time>${esc(whenOf(l.lastActivityAt))}</time></div></div>`).join('')}</div></section>`;
  };
  const busy = topicsBuilding(p);
  const note = busy ? `"${busy.title}" is writing the Topics now. Merge once it finishes.` : 'An agent writes them as one. Recover on the Topics page brings these two back.';
  return `<div class="mg" role="dialog" aria-modal="true" aria-label="Merge two Topics">
    <div class="mg-cols">${col(t, 'var(--l-topic)', true)}${col(o, MERGE_COLORS[0], false)}</div>
    <footer class="mg-bar"><p class="mg-say">${esc(note)}</p><button type="button" class="btn" data-act="merge-cancel">Cancel</button><button type="button" class="btn primary" data-act="topic-merge-accept" data-into="${esc(t.path)}" data-from="${esc(o.path)}" ${busy ? 'disabled' : ''}>${ic('merge', 15)}Accept merge</button></footer>
  </div>`;
}
const openTopicCompare = (p, t, o) => openCompare(topicCompareHTML(p, t, o));
ACT['topic-merge-accept'] = async el => {
  const p = project();
  el.disabled = true;
  let made;
  try { made = await api(`${pathFor(p.id)}/merge-topics`, { method:'POST', body:{ into:el.dataset.into, from:el.dataset.from } }); }
  catch (error) { el.disabled = false; toast(error.message); return; }
  closeLightbox();
  await loadState(p.id, { force:true }).catch(() => {});
  go({ view:'line', line:made.slug });
};
