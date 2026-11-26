// Statistics: calm project overview — spend, savings, tokens, one unified Agents view, quick rating queue, and model prices.
// Every number in #statsBody and #statsRate is counted from project state already on this computer; nothing here calls a model.
'use strict';

(function (root) {
  const pricing = typeof module !== 'undefined' && module.exports ? require('./work-pricing.js') : WORK_PRICING;
  const usd = value => value == null ? '—' : value > 0 && value < .0001 ? '&lt;$0.0001' : `$${value.toLocaleString('en-US', { minimumFractionDigits:2, maximumFractionDigits:value > 0 && value < .01 ? 4 : 2 })}`;
  const STATS_STATE = { period:'30d', agent:'all', sort:'works', open:'', lineSort:'works', day:'', rateAll:false, agentsAll:false, dayBy:'', indexKind:'all', indexView:'', exampleView:'', exampleProject:'' };
  // Kinds of job in a fixed order, each with its own colour (checked for colour-blind separation in stats.css).
  const JOB_KINDS = [['code', 'Code'], ['chat', 'Chat'], ['design', 'Design'], ['research', 'Research'], ['docs', 'Docs']];
  const DAY = 86400000;
  const RATED_ENOUGH = 5;
  const RATE_SHOWN = 7, AGENTS_SHOWN = 10;
  const PERIODS = [['today', 'Today', 1], ['7d', '7 days', 7], ['30d', '30 days', 30], ['all', 'All', 0]];
  const FAILS = ['error', 'limit', 'stopped', 'discarded'];
  const RESULT = { done:'Finished', error:'Error', limit:'Token limit', stopped:'Stopped', discarded:'Discarded', active:'Working', wait:'Needs you', todo:'Waiting its turn' };
  const LINE_KINDS = [
    ['working', 'Working', 'var(--c-run)'], ['waiting', 'Needs you', 'var(--amber-mark)'], ['ready', 'Ready', 'var(--c-ask)'],
    ['notes', 'Notes only', 'var(--line2)'], ['queued', 'Not started', 'var(--ink4, #b8bec8)'],
    ['done', 'Finished', 'var(--c-end)'], ['stopped', 'Stopped', 'var(--red)'], ['archived', 'Archived', '#64748b'],
  ];
  const LINE_OF_STATUS = { working:'working', waiting:'waiting', ready:'ready', notes:'notes', 'not-started':'queued', done:'done', stopped:'stopped', landed:'done', closed:'archived' };
  const OWN_SCORE = { good:4.5, bad:2 };

  // ---------- Small helpers, with stand-ins so the counting also runs outside the page (tests) ----------
  const escHtml = s => typeof esc === 'function' ? esc(s) : String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const icon = (name, size) => typeof ic === 'function' ? ic(name, size) : '';
  function agentMeta(id) {
    if (typeof agentInfo === 'function') return agentInfo(id);
    const name = String(id || 'Agent');
    return { id, name:name[0].toUpperCase() + name.slice(1), mono:name.slice(0, 2), color:'#5b6472' };
  }
  const avatar = (id, size = 22) => typeof av === 'function' ? av(id, size) : `<span class="av" style="--av:${escHtml(agentMeta(id).color)};--s:${size}px">${escHtml(agentMeta(id).mono)}</span>`;
  const linesOf = p => !p ? [] : typeof allLines === 'function' ? allLines(p) : [...(p.lines || []), ...(p.landed || []), ...(p.backlog || [])];
  const YOURS = new Set(['ask', 'note', 'canvas', 'meeting', 'merge', 'deliver']);
  const isWorkStep = s => s && !s.unsent && (typeof LINE_STATUS !== 'undefined' ? LINE_STATUS.isWork(s) : !YOURS.has(s.kind));
  const needsYou = l => typeof LINE_STATUS !== 'undefined' ? LINE_STATUS.lineNeedsYou(l) : !l.archived && (l.status === 'waiting' || Boolean(l.asking));
  const titleOf = l => l.title || l.name || l.slug || 'Line';
  function labelMs(label) {
    const m = /^(\d{4})-(\d\d)-(\d\d)(?:[ T](\d\d):(\d\d))?/.exec(String(label || ''));
    return m ? new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)).getTime() : 0;
  }
  function dayStart(ms) { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function dayKey(ms) { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
  function tookMs(took) {
    let total = 0;
    for (const m of String(took || '').matchAll(/(\d+(?:\.\d+)?)\s*(ms|s|min|m|h|d)\b/gi)) total += parseFloat(m[1]) * ({ ms:1, s:1e3, min:6e4, m:6e4, h:36e5, d:DAY }[m[2].toLowerCase()]);
    return Math.round(total);
  }
  const fmt = n => n == null ? '—' : n >= 1e9 ? `${+(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(Math.round(n));
  const round1 = n => n == null ? null : Math.round(n * 10) / 10;
  function fmtTime(ms) {
    if (!(ms > 0)) return '—';
    const min = Math.round(ms / 6e4);
    return min < 1 ? `${Math.max(1, Math.round(ms / 1e3))} s` : min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}`;
  }
  function median(xs) {
    if (!xs.length) return 0;
    const s = [...xs].sort((a, b) => a - b), mid = s.length >> 1;
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }
  const whenText = ms => !ms ? '' : typeof shortWhen === 'function' ? shortWhen(ms) : new Date(ms).toLocaleDateString([], { month:'short', day:'numeric' });
  // The orchestrator's score is 1 to 5 to one decimal.
  const orchScoreOf = value => { const n = Number(value); return value != null && value !== '' && n >= 1 && n <= 5 ? n : null; };
  function combinedScore(orchScore, ownRating) {
    const orch = orchScoreOf(orchScore);
    const own = OWN_SCORE[ownRating] ?? null;
    return orch == null ? own : own == null ? orch : (orch + 2 * own) / 3;
  }

  function outcomeOf(s) {
    if (s.state === 'done') return 'done';
    if (s.state === 'off') return s.off === 'discarded' ? 'discarded' : s.stopWhy === 'limit' ? 'limit' : s.stopWhy === 'error' ? 'error' : 'stopped';
    if (s.state === 'error') return s.stopWhy === 'limit' ? 'limit' : s.stopWhy === 'stopped' ? 'stopped' : 'error';
    if (s.state === 'active' || s.state === 'wait') return s.state;
    return 'todo';
  }
  function tokensOf(t) {
    if (!t || t.inputTokens == null) return null;
    const cache = t.cacheReadInputTokens || 0, newIn = Math.max(0, t.inputTokens - cache), out = t.outputTokens || 0;
    return { newIn, out, cache, used:newIn + out };
  }
  function savingsOf(works) {
    const rows = works.map(w => w.cost).filter(Boolean);
    if (!rows.length) return null;
    const sum = (side, key) => rows.reduce((n, r) => n + (r[side]?.[key] || 0), 0);
    const share = (a, b) => b > 0 ? Math.round(1000 * (b - a) / b) / 10 : null;
    const fresh = sum('fresh', 'tokensIn'), resumed = sum('resumed', 'tokensIn');
    // Dollars when every Work's price is saved: Works of models priced apart only add up as money.
    const priced = rows.every(r => r.fresh?.usd != null && r.resumed?.usd != null);
    return { works:rows.length, fewer:resumed - fresh, tokensPercent:share(fresh, resumed), costPercent:priced ? share(sum('fresh', 'usd'), sum('resumed', 'usd')) : share(sum('fresh', 'cost'), sum('resumed', 'cost')) };
  }
  const LINE_OF_STATE = { working:'working', wait:'waiting', ready:'ready', notes:'notes', backlog:'queued', landed:'done', error:'stopped' };
  function lineKind(l) {
    if (l.status === 'closed' || l.archived || l.closed) return 'archived';
    if (l.status === 'landed') return LINE_OF_STATUS.landed;
    if (needsYou(l)) return 'waiting';
    if (LINE_OF_STATUS[l.status]) return LINE_OF_STATUS[l.status];
    const state = typeof LINE_STATUS !== 'undefined' ? LINE_STATUS.lineState(l) : (l.status === 'paused' ? 'error' : 'working');
    return LINE_OF_STATE[state] || 'working';
  }
  function periodStart(period, now) {
    const days = PERIODS.find(x => x[0] === period)?.[2] || 0;
    return days ? dayStart(now) - (days - 1) * DAY : 0;
  }
  function periodDays(period = STATS_STATE.period) {
    return PERIODS.find(x => x[0] === period)?.[2] || 0;
  }
  function sumOf(works) {
    const done = works.filter(w => w.outcome === 'done').length, ended = works.filter(w => w.ended).length;
    const good = works.filter(w => w.rating === 'good').length, bad = works.filter(w => w.rating === 'bad').length;
    const orchScores = works.map(w => orchScoreOf(w.orchScore)).filter(n => n != null);
    const combined = works.map(w => combinedScore(w.orchScore, w.rating)).filter(n => n != null);
    const measured = works.filter(w => w.tokens);
    const priced = works.filter(work => work.estimatedCost != null);
    const used = measured.length ? measured.reduce((n, w) => n + w.tokens.used, 0) : null;
    const totalCost = priced.length ? priced.reduce((sum, work) => sum + work.estimatedCost, 0) : null;
    return {
      works:works.length, done, ended, failed:ended - done, good, bad, rated:good + bad,
      score:orchScores.length ? round1(orchScores.reduce((a, b) => a + b, 0) / orchScores.length) : null,
      scored:orchScores.length,
      rating:combined.length ? round1(combined.reduce((a, b) => a + b, 0) / combined.length) : null,
      combinedRated:combined.length,
      estimatedCost:totalCost, priced:priced.length,
      costPerWork:priced.length ? totalCost / priced.length : null,
      rateable:works.filter(w => w.canRate).length,
      finishedPct:ended ? Math.round(100 * done / ended) : null, goodPct:good + bad ? Math.round(100 * good / (good + bad)) : null,
      tokens:used, cache:measured.length ? measured.reduce((n, w) => n + w.tokens.cache, 0) : null,
      tokensPerWork:measured.length ? Math.round(used / measured.length) : null,
      perGood:used != null && good ? used / good : null,
      typicalMs:median(works.filter(w => w.ended && w.durMs > 0).map(w => w.durMs)),
      add:works.reduce((n, w) => n + (w.diff?.add || 0), 0), del:works.reduce((n, w) => n + (w.diff?.del || 0), 0),
      lines:new Set(works.map(w => w.lineId)).size,
      fails:Object.fromEntries(FAILS.map(k => [k, works.filter(w => w.outcome === k).length])),
    };
  }

  // ---------- Counting ----------
  function computeProjectStats(p, opts = {}) {
    const now = opts.now || Date.now(), period = opts.period || STATS_STATE.period, agent = opts.agent || 'all';
    const since = periodStart(period, now), all = linesOf(p);
    const prices = opts.prices ?? (typeof ORCH !== 'undefined' && ORCH.project === p?.id ? ORCH.stats?.models : null) ?? [];
    const everyWork = [], live = [];
    for (const l of all) {
      const kind = lineKind(l);
      for (const s of l.stations || []) {
        if (!isWorkStep(s)) continue;
        const outcome = outcomeOf(s), id = String(s.agent || l.agent || 'agent').replace(/^@/, '');
        if (outcome === 'todo' && !s.startedAt) continue;
        const time = s.endedAt || s.startedAt || labelMs(s.when);
        const durMs = s.startedAt && s.endedAt > s.startedAt ? s.endedAt - s.startedAt : tookMs(s.took);
        const startup = s.tokens?.startup;
        const model = pricing.modelOf(s), effort = s.picked?.effort || s.selected?.effort || '';
        const isReview = s.kind === 'review' || s.isReview;
        const w = {
          lineId:l.id, lineTitle:titleOf(l), lineKind:kind, stepId:s.id, label:typeof stepLabel === 'function' ? stepLabel(s) : s.label || 'Work',
          agent:id, savedAgent:s.savedAgent || '', model, effort,
          estimatedCost:pricing.estimate(s.tokens, pricing.priceFor(pricing.priceModelOf(s), prices)), outcome, ended:outcome === 'done' || FAILS.includes(outcome),
          live:outcome === 'active' || outcome === 'wait', time, day:time ? dayKey(time) : '', durMs, tokens:tokensOf(s.tokens),
          cost:startup?.status === 'compared' && startup.cost ? startup.cost : null, diff:s.diff || null,
          rating:!isReview && (s.rating === 'good' || s.rating === 'bad') ? s.rating : '', note:isReview ? '' : s.ratingNote || '', ratedAt:isReview ? 0 : labelMs(s.ratedAt),
          orchScore:isReview ? null : s.orchScore, orchNote:isReview ? '' : s.orchNote || '',
          canRate:!isReview && (s.state === 'done' || s.state === 'off'), carriedFrom:s.carriedFrom?.agent ? String(s.carriedFrom.agent).replace(/^@/, '') : '',
          now:s.now || '', why:s.why || '',
        };
        everyWork.push(w);
        if (w.live || (s.state === 'error' && l.status === 'stopped')) live.push({ ...w, status:outcome === 'active' ? 'working' : outcome === 'wait' ? 'waiting' : 'failed' });
      }
      if (kind === 'waiting' && !live.some(x => x.lineId === l.id)) {
        const last = [...(l.stations || [])].reverse().find(isWorkStep);
        live.push({ lineId:l.id, lineTitle:titleOf(l), stepId:last?.id || '', agent:String(last?.agent || l.agent || 'agent').replace(/^@/, ''), status:'waiting', why:'' });
      }
    }
    const inPeriod = w => w.live || (since ? w.time >= since : true);
    const periodWorks = everyWork.filter(inPeriod);
    const works = agent === 'all' ? periodWorks : periodWorks.filter(w => w.agent === agent);
    works.sort((a, b) => b.time - a.time);
    const totals = sumOf(works);
    totals.saved = savingsOf(works);
    const nowList = agent === 'all' ? live : live.filter(x => x.agent === agent);

    const agentIds = [...new Set(works.map(w => w.agent))];
    if (agent !== 'all' && !agentIds.includes(agent)) agentIds.push(agent);
    const agents = agentIds.map(id => {
      const mine = works.filter(w => w.agent === id), sum = sumOf(mine);
      const models = [...new Set(mine.map(w => w.model || 'Not recorded'))].map(m => ({ model:m, ...sumOf(mine.filter(w => (w.model || 'Not recorded') === m)) })).sort((a, b) => b.works - a.works);
      return {
        id, name:agentMeta(id).name, color:agentMeta(id).color, ...sum, models,
        working:live.some(x => x.agent === id && x.status === 'working'), waiting:live.some(x => x.agent === id && x.status === 'waiting'),
        share:totals.works ? Math.round(100 * sum.works / totals.works) : 0,
        rescued:periodWorks.filter(w => w.agent === id && w.carriedFrom && w.carriedFrom !== id && w.outcome === 'done').length,
        handedOff:periodWorks.filter(w => w.carriedFrom === id && w.agent !== id && w.outcome === 'done').length,
      };
    });
    const enough = agents.filter(a => a.rated >= RATED_ENOUGH);
    const best = enough.length > 1 ? enough.reduce((a, b) => (b.goodPct > a.goodPct ? b : a)).id : '';
    const enoughGood = enough.filter(a => a.perGood != null);
    const least = enoughGood.length > 1 ? enoughGood.reduce((a, b) => (b.perGood < a.perGood ? b : a)).id : '';

    // Unified per-(agent, model, effort) rows used when hosted or standalone without Orchestrator stats.
    const groups = new Map();
    for (const w of works) {
      const key = JSON.stringify([w.agent, (w.model || '').toLowerCase(), w.effort || '']);
      if (!groups.has(key)) groups.set(key, { key, runner:w.agent, name:agentMeta(w.agent).name, model:w.model || '', effort:w.effort || '', items:[] });
      groups.get(key).items.push(w);
    }
    const agentModels = [...groups.values()].map(g => {
      const sum = sumOf(g.items);
      return {
        key:g.key, runner:g.runner, name:g.name, model:g.model, effort:g.effort,
        running:g.items.filter(w => w.live).length, ...sum,
      };
    }).sort((a, b) => b.works - a.works || a.name.localeCompare(b.name));

    const workLines = new Set(works.map(w => w.lineId));
    const lines = all.filter(l => workLines.has(l.id) || (agent === 'all' && (!since || (l.lastActivityAt || l.updatedAt || labelMs(l.started)) >= since))).map(l => {
      const mine = works.filter(w => w.lineId === l.id);
      return { id:l.id, title:titleOf(l), kind:lineKind(l), works:mine.slice().sort((a, b) => a.time - b.time),
        issues:mine.filter(w => FAILS.includes(w.outcome) || w.rating === 'bad').length, tokens:mine.reduce((n, w) => n + (w.tokens?.used || 0), 0) };
    });
    const breakdown = LINE_KINDS.map(([k, label, color]) => ({ kind:k, label, color, count:lines.filter(l => l.kind === k).length })).filter(x => x.count);

    const models = [...new Set(works.map(w => w.model || 'Not recorded'))].map(m => {
      const mine = works.filter(w => (w.model || 'Not recorded') === m), by = {};
      for (const w of mine) by[w.agent] = (by[w.agent] || 0) + 1;
      return { model:m, agent:Object.entries(by).sort((a, b) => b[1] - a[1])[0][0], ...sumOf(mine) };
    }).sort((a, b) => b.works - a.works);

    const why = agents.map(a => ({ id:a.id, name:a.name, fails:a.fails,
      notes:works.filter(w => w.agent === a.id && w.rating && w.note).sort((x, y) => (y.ratedAt || y.time) - (x.ratedAt || x.time)) }))
      .filter(x => x.notes.length || FAILS.some(k => x.fails[k]));

    const toRate = works.filter(w => w.canRate && !w.rating);
    const days = dayColumns(period, now, works);
    return { period, agent, since, totals, now:nowList, agents, agentModels, best, least, lines, breakdown, models, why, toRate, days, works,
      agentChoices:[...new Set([...periodWorks.map(w => w.agent), ...(agent === 'all' ? [] : [agent])])],
      openLines:typeof MAP_FILTERS !== 'undefined'
        ? lines.filter(l => !MAP_FILTERS.done(null, all.find(x => x.id === l.id))).length
        : lines.filter(l => ['working', 'waiting', 'ready'].includes(l.kind)).length };
  }
  function dayColumns(period, now, works) {
    let n = PERIODS.find(x => x[0] === period)?.[2] || 0;
    if (!n) { const oldest = Math.min(now, ...works.filter(w => w.time).map(w => w.time)); n = Math.max(14, Math.min(90, Math.round((dayStart(now) - dayStart(oldest)) / DAY) + 1)); }
    return Array.from({ length:n }, (_, i) => { const ms = dayStart(now) - (n - 1 - i) * DAY; return { key:dayKey(ms), ms, ago:n - 1 - i }; });
  }

  // ---------- Page rendering ----------
  const rateTone = r => r >= 4 ? 'is-high' : r >= 3 ? 'is-mid' : 'is-low';
  function ratingCellHTML(r) {
    if (!Number.isFinite(r.rating)) return '<span class="sx-muted">—</span>';
    const pct = Math.round(Math.max(0, Math.min(5, r.rating)) / 5 * 100);
    const parts = [Number.isFinite(r.score) && `Orch ${r.score.toFixed(1)}`, (r.good || r.bad) && `${r.good} good${r.bad ? ` · ${r.bad} not` : ''}`].filter(Boolean).join(' · ');
    return `<div class="sx-rating-cell"><span class="sx-rating-val">${r.rating.toFixed(1)}<small class="sx-inline"> /5</small></span><span class="sx-rbar" aria-hidden="true"><i class="${rateTone(r.rating)}" style="width:${pct}%"></i></span></div>${parts ? `<small>${escHtml(parts)}</small>` : ''}`;
  }
  const rateButtons = w => !w.canRate ? '' : `<span class="sx-rate" role="group" aria-label="Rate ${escHtml(w.label)}">
    <button type="button" class="sx-rb is-good" data-act="work-rate" data-line="${escHtml(w.lineId)}" data-step="${escHtml(w.stepId)}" data-rating="good" aria-pressed="${w.rating === 'good'}" aria-label="Good" title="Good">${icon('thumbUp', 14)}</button>
    <button type="button" class="sx-rb is-bad" data-act="work-rate" data-line="${escHtml(w.lineId)}" data-step="${escHtml(w.stepId)}" data-rating="bad" aria-pressed="${w.rating === 'bad'}" aria-label="Not good" title="Not good">${icon('thumbDown', 14)}</button></span>`;
  const workLink = (w, words) => `<button type="button" class="sx-link" data-act="open-step" data-line="${escHtml(w.lineId)}" data-step="${escHtml(w.stepId)}">${escHtml(words)}</button>`;
  const card = (cls, head, body) => `<section class="sx-card ${cls}">${head ? `<header class="sx-hd">${head}</header>` : ''}${body}</section>`;

  // Five high-signal KPIs: spend, savings, tokens, volume, and unified rating.
  function totalsHTML(st) {
    const t = st.totals, k = t.saved;
    const working = st.now.filter(x => x.status === 'working').length;
    const worksSub = [working ? `${working} working now` : '', `${st.lines.length} Line${st.lines.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
    const ratingVal = t.rating != null ? `${t.rating.toFixed(1)}<span class="sx-of5"> /5</span>` : '—';
    const ratingSub = t.combinedRated
      ? [`${t.combinedRated} rated`, (t.good || t.bad) ? `${t.good} good${t.bad ? ` · ${t.bad} not` : ''}` : ''].filter(Boolean).join(' · ')
      : 'Not rated yet';
    const cells = [
      ['Est. cost (USD)', usd(t.estimatedCost), t.works ? `${t.priced} of ${t.works} Works priced` : 'No Works yet'],
      ['Saved', k?.costPercent == null ? '—' : `${Math.round(k.costPercent)}%`, k?.costPercent == null ? 'Nothing compared yet' : `less cost · ${k.fewer >= 0 ? '≈ ' + fmt(k.fewer) + ' fewer' : '≈ ' + fmt(-k.fewer) + ' more'} tokens`],
      ['Tokens', fmt(t.tokens), t.cache == null ? 'Not reported' : `${fmt(t.cache)} cache reads`],
      ['Works', t.works, worksSub],
      ['Rating', ratingVal, ratingSub],
    ];
    return `<section class="sx-card sx-sum" aria-label="Totals">${cells.map(([label, value, sub]) => `<div><span>${label}</span><b>${value}</b><small>${sub}</small></div>`).join('')}</section>`;
  }

  // Hosted / standalone fallback: ONE unified Agents & models card (never rendered beside #statsRecord on local).
  const HOSTED_SORTS = {
    name:a => `${a.name} ${a.model}`.toLowerCase(),
    works:a => -a.works,
    rating:a => -(a.rating ?? -1),
    time:a => a.typicalMs || Infinity,
    tokens:a => -(a.tokensPerWork ?? -1),
    cost:a => -(a.costPerWork ?? -1),
  };
  function hostedAgentsHTML(st) {
    const by = HOSTED_SORTS[STATS_STATE.sort] || HOSTED_SORTS.works;
    const rows = [...st.agentModels].sort((a, b) => { const x = by(a), y = by(b); return x < y ? -1 : x > y ? 1 : b.works - a.works; });
    const shown = STATS_STATE.agentsAll ? rows : rows.slice(0, AGENTS_SHOWN);
    const cols = [
      ['name', 'Agent'],
      ['works', 'Works'],
      ['rating', 'Rating'],
      ['time', 'Time', 'sx-wide'],
      ['tokens', 'Tokens / Work', 'sx-wide'],
      ['cost', 'Est. cost'],
    ];
    const head = `<tr>${cols.map(([k, label, cls]) => `<th class="${cls || ''}" aria-sort="${STATS_STATE.sort === k ? 'ascending' : 'none'}"><button type="button" class="sx-th${STATS_STATE.sort === k ? ' on' : ''}" data-act="stats-sort" data-sort="${k}">${label}</button></th>`).join('')}</tr>`;
    const body = shown.map(a => {
      const sub = [a.model, a.effort ? `${a.effort} effort` : ''].filter(Boolean).join(' · ');
      const costCell = a.costPerWork != null
        ? `${usd(a.costPerWork)}${a.works > 1 && a.estimatedCost != null ? `<small>${usd(a.estimatedCost)} total</small>` : ''}`
        : '—';
      return `<tr>
        <td><span class="sx-who">${avatar(a.runner, 22)}<span><b>${escHtml(a.name)}</b>${sub ? `<small>${escHtml(sub)}</small>` : ''}</span></span></td>
        <td class="sx-num">${a.works}${a.running ? `<small>${a.running} working</small>` : ''}</td>
        <td class="sx-num">${ratingCellHTML(a)}</td>
        <td class="sx-num sx-wide">${fmtTime(a.typicalMs)}</td>
        <td class="sx-num sx-wide">${fmt(a.tokensPerWork)}</td>
        <td class="sx-num">${costCell}</td>
      </tr>`;
    }).join('');
    const more = rows.length > AGENTS_SHOWN ? `<button type="button" class="sx-showall" data-act="stats-agents-all">${STATS_STATE.agentsAll ? 'Show fewer' : `Show all ${rows.length} agents`}</button>` : '';
    return card('sx-agents', '<div><h2>Agents</h2><p class="sx-muted">Grouped by agent and model · combined rating, tokens and cost</p></div>', rows.length ? `<div class="sx-scroll"><table class="sx-table">${head}${body}</table></div>${more}` : '<p class="sx-muted">No Works in this period.</p>');
  }

  function rateHTML(st) {
    if (!st.toRate.length) return '';
    const list = STATS_STATE.rateAll ? st.toRate : st.toRate.slice(0, RATE_SHOWN);
    const rows = list.map(w => `<div class="sx-rq">${avatar(w.agent, 22)}<span class="sx-rq-t">${workLink(w, `${w.lineTitle} · ${w.label}`)}</span><span class="sx-muted sx-num">${escHtml(whenText(w.time))}</span>${rateButtons(w)}</div>`).join('');
    const more = st.toRate.length > RATE_SHOWN ? `<button type="button" class="sx-showall" data-act="stats-rate-all">${STATS_STATE.rateAll ? 'Show fewer' : `Show all ${st.toRate.length}`}</button>` : '';
    return card('sx-rate-card', `<div><h2>Needs your rating <em class="sx-muted sx-num">${st.toRate.length}</em></h2><p class="sx-muted">Your feedback counts twice in each agent’s rating</p></div>`, `<div class="sx-rqs">${rows}</div>${more}`);
  }

  // ---------- Work by day (by kind of job or by agent) and the agents' share ----------
  // One colour per agent app in the charts, from the same checked palette as the kinds; any other agent is grey.
  const AGENT_COLORS = { codex:'var(--k-test)', claude:'var(--k-fix)', opencode:'var(--k-code)', kimi:'var(--k-design)', pi:'var(--k-docs)', omp:'var(--k-review)', antigravity:'var(--k-research)', penecho:'var(--k-code)', dsh:'var(--k-docs)' };
  const agentColor = id => AGENT_COLORS[String(id || '').toLowerCase()] || 'var(--k-other)';
  const shortDay = ms => new Date(ms).toLocaleDateString([], { month:'short', day:'numeric' });
  function serverDaily(p) {
    return typeof ORCH !== 'undefined' && ORCH.project === p?.id && Array.isArray(ORCH.stats?.daily) ? ORCH.stats.daily : null;
  }
  function dailySeries(st, p, by, rowsOverride) {
    const columns = st.days.map(d => ({ ...d, parts:new Map(), total:0 })), at = new Map(columns.map(c => [c.key, c]));
    const add = (day, key, n) => { const c = at.get(day); if (!c) return; c.parts.set(key, (c.parts.get(key) || 0) + n); c.total += n; };
    if (by === 'kind') {
      for (const row of rowsOverride || serverDaily(p) || []) {
        if (st.agent !== 'all' && row.runner !== st.agent) continue;
        const raw = String(row.kind || '').trim().toLowerCase(), kind = raw === 'fix' || raw === 'test' ? 'code' : raw;
        if (!JOB_KINDS.some(([k]) => k === kind)) continue;
        add(row.day, kind, row.works);
      }
    } else for (const w of st.works) if (w.day && !(w.outcome === 'todo')) add(w.day, w.agent, 1);
    const keys = by === 'kind' ? JOB_KINDS.map(([k]) => k) : [...new Set(st.works.map(w => w.agent))].sort((a, b) => st.works.filter(w => w.agent === b).length - st.works.filter(w => w.agent === a).length);
    const totals = new Map(keys.map(k => [k, columns.reduce((n, c) => n + (c.parts.get(k) || 0), 0)]));
    return { columns, keys:keys.filter(k => totals.get(k)), totals, max:Math.max(1, ...columns.map(c => c.total)) };
  }
  function dailyHTML(st, p, opts = {}) {
    const rawDaily = opts.dailyRows || serverDaily(p);
    const kindSeries = rawDaily ? dailySeries(st, p, 'kind', rawDaily) : null;
    const hasKinds = Boolean(kindSeries?.columns.some(c => c.total > 0));
    const by = hasKinds && STATS_STATE.dayBy === 'kind' ? 'kind' : 'agent';
    const series = by === 'kind' ? kindSeries : dailySeries(st, p, 'agent', rawDaily);
    const colorOf = key => by === 'kind' ? `var(--k-${key})` : agentColor(key);
    const nameOf = key => by === 'kind' ? JOB_KINDS.find(([k]) => k === key)?.[1] || key : agentMeta(key).name;
    const step = Math.max(1, Math.ceil(series.columns.length / 10));
    const toggle = hasKinds ? `<div class="seg sx-seg-sm" role="tablist" aria-label="Group by"><button type="button" role="tab" aria-selected="${by === 'kind'}" data-act="stats-day-by" data-by="kind">Kind of job</button><button type="button" role="tab" aria-selected="${by === 'agent'}" data-act="stats-day-by" data-by="agent">Agent</button></div>` : '';
    const total = series.columns.reduce((n, c) => n + c.total, 0);
    const plot = !total ? '<p class="sx-muted">No Works in this period.</p>' : `<div class="sx-days" style="--n:${series.columns.length}">
      <div class="sx-days-plot">${series.columns.map(c => `<div class="sx-day" title="${escHtml(`${shortDay(c.ms)} · ${c.total} Work${c.total === 1 ? '' : 's'}${series.keys.filter(k => c.parts.get(k)).map(k => `\n${nameOf(k)}: ${c.parts.get(k)}`).join('')}`)}">${c.total ? `<span class="sx-day-n">${c.total}</span>` : ''}<span class="sx-day-stack" style="height:${(100 * c.total / series.max).toFixed(1)}%">${series.keys.filter(k => c.parts.get(k)).map(k => `<i style="flex:${c.parts.get(k)};background:${escHtml(colorOf(k))}"></i>`).join('')}</span></div>`).join('')}</div>
      <div class="sx-days-x">${series.columns.map((c, i) => `<span>${(series.columns.length - 1 - i) % step === 0 ? escHtml(shortDay(c.ms)) : ''}</span>`).join('')}</div>
    </div>
    <div class="sx-legend">${series.keys.map(k => `<span><i style="background:${escHtml(colorOf(k))}"></i>${escHtml(nameOf(k))}<b>${series.totals.get(k)}</b></span>`).join('')}</div>`;
    return card('sx-daily', `<div><p class="sx-eyebrow">${escHtml(opts.eyebrow || `${p?.name || 'This project'} · Works by day`)}</p><h2>${total} Work${total === 1 ? '' : 's'}${by === 'kind' ? ' by kind of job' : ' by agent'}</h2></div>${toggle}`, plot);
  }
  function agentShareHTML(st, p, opts = {}) {
    const rows = [...st.agents].sort((a, b) => b.works - a.works);
    if (!rows.length && !opts.empty) return '';
    const max = rows.length ? Math.max(...rows.map(a => a.works)) : 1;
    const body = rows.map((a, i) => `<li><span class="sx-share-rank${i < 3 ? ` medal-${i + 1}` : ''}">${i + 1}</span><span class="sx-who">${avatar(a.id, 22)}<b>${escHtml(a.name)}</b></span>
      <span class="sx-share-track" title="${a.works} Works · ${a.share}%"><i style="width:${(100 * a.works / max).toFixed(1)}%;background:${escHtml(agentColor(a.id))}"></i></span>
      <span class="sx-share-n"><b>${a.share}%</b><small>${a.works} Work${a.works === 1 ? '' : 's'}</small></span>
      <span class="sx-share-n"><b>${a.rating == null ? '—' : a.rating.toFixed(1)}</b><small>rating</small></span></li>`).join('');
    const titleAttr = opts.titleId ? ` id="${escHtml(opts.titleId)}"` : '';
    const head = `<div><p class="sx-eyebrow">${escHtml(opts.eyebrow || `${p?.name || 'This project'} · Agents`)}</p><h2${titleAttr}>Who did the work</h2></div>${opts.action || ''}`;
    const content = rows.length ? `<ol class="sx-share-list">${body}</ol>` : `<p class="sx-muted">${escHtml(opts.empty)}</p>`;
    return card(opts.className ? `sx-share ${opts.className}` : 'sx-share', head, content);
  }
  // A line's Works by when and by whom, worked out once for each version of the line: the Home counts every Work of the project each time it is drawn.
  const LINE_WORKS = new WeakMap();
  function lineWorks(l) {
    let rows = LINE_WORKS.get(l);
    if (!rows) {
      rows = [];
      for (const s of l.stations || []) {
        if (!isWorkStep(s)) continue;
        const outcome = outcomeOf(s);
        if (outcome === 'todo' && !s.startedAt) continue;
        const time = s.endedAt || s.startedAt || labelMs(s.when);
        rows.push({ agent:String(s.agent || l.agent || 'agent').replace(/^@/, ''), outcome, time, day:time ? dayKey(time) : '', live:outcome === 'active' || outcome === 'wait' });
      }
      LINE_WORKS.set(l, rows);
    }
    return rows;
  }
  // The part of computeProjectStats the chart of days is drawn from.
  function daysOf(p, now) {
    const since = periodStart('30d', now), works = [];
    for (const l of linesOf(p)) for (const w of lineWorks(l)) if (w.live || w.time >= since) works.push(w);
    return { agent:'all', works, days:dayColumns('30d', now, works) };
  }
  function projectDailySeries(p, opts = {}) {
    const st = daysOf(p, opts.now || Date.now());
    const rawDaily = opts.dailyRows ?? serverDaily(p);
    const kindSeries = rawDaily ? dailySeries(st, p, 'kind', rawDaily) : null;
    const hasKinds = Boolean(kindSeries?.columns.some(c => c.total > 0));
    const mode = hasKinds && opts.by === 'kind' ? 'kind' : 'agent';
    const series = mode === 'kind' ? kindSeries : dailySeries(st, p, 'agent', rawDaily);
    const colorOf = key => mode === 'kind' ? `var(--k-${key})` : agentColor(key);
    const nameOf = key => mode === 'kind' ? JOB_KINDS.find(([k]) => k === key)?.[1] || key : agentMeta(key).name;
    const total = series.columns.reduce((n, c) => n + c.total, 0);
    return {
      mode,
      hasKinds,
      total,
      max:series.max,
      keys:series.keys.map(key => ({ key, name:nameOf(key), color:colorOf(key), total:series.totals.get(key) || 0 })),
      columns:series.columns.map(c => ({ key:c.key, ms:c.ms, ago:c.ago, total:c.total, parts:Object.fromEntries(c.parts) })),
    };
  }
  function projectAgentShareHTML(p, opts = {}) {
    const st = computeProjectStats(p, { period:opts.period || 'all', agent:'all' });
    return agentShareHTML(st, p, opts);
  }

  // ---------- Agent index: every project on this computer, as on penecho.ai/leaderboard ----------
  const INDEX = { key:'', data:null, loading:'', error:'', at:0 };
  const MAKER_COLORS = { Google:'var(--k-code)', Anthropic:'var(--k-fix)', OpenAI:'var(--k-test)', Alibaba:'var(--k-review)', 'Moonshot AI':'var(--k-design)', 'Zhipu AI':'var(--k-research)', DeepSeek:'var(--k-docs)', xAI:'var(--k-red)', Meta:'var(--k-red)', Mistral:'var(--k-red)', MiniMax:'var(--k-red)' };
  const makerColor = provider => MAKER_COLORS[provider] || 'var(--k-other)';
  const swatch = provider => `<i class="sx-sw" style="background:${makerColor(provider)}" aria-hidden="true"></i>`;
  const money = v => v == null ? '—' : v < 0.1 ? `$${v.toFixed(3)}` : `$${v.toFixed(2)}`;
  const pairName = r => `${r.agentName} · ${r.model}${r.effort ? ` · ${r.effort}` : ''}`;
  const tierSummary = r => {
    if (!r?.tiers) return '';
    const t = r.tiers;
    if (r.lightOnly && t.light) return ` · ${t.light.rating.toFixed(2)} on Light · Standard not tried`;
    return ` · Light ${t.light.rating.toFixed(2)} / Std ${t.standard.rating.toFixed(2)} / Heavy ${t.heavy.rating.toFixed(2)}`;
  };
  const scopeTagHTML = r => r?.lightOnly
    ? ` · <em class="sx-scope-tag" title="${escHtml(`${r.tiers?.light ? `${r.tiers.light.rating.toFixed(2)} on Light · ` : ''}Standard not tried`)}">Light only</em>`
    : '';
  const tipOf = r => `${pairName(r)}: score ${r.score.toFixed(1)} (95% ${r.low.toFixed(1)}–${r.high.toFixed(1)}), rating ${r.rating.toFixed(2)}, ${r.works} Works${tierSummary(r)}`;
  const onCloud = () => typeof HOSTED !== 'undefined' && Boolean(HOSTED);
  // On penecho.ai the index is every PenEcho user's ratings (the public leaderboard, last 30 days); on a computer, every project on it.
  function fetchIndex(p, days) {
    if (onCloud()) return fetch('/leaderboard.json', { headers:{ accept:'application/json' } }).then(r => { if (!r.ok) throw new Error('Could not load the leaderboard.'); return r.json(); }).then(d => ({ ...d, allUsers:true }));
    return api(`${pathFor(p.id)}/orchestrator/index${days ? `?days=${days}` : ''}`);
  }
  function loadIndex(p) {
    const days = onCloud() ? 30 : periodDays(), key = String(days);
    if ((INDEX.key === key && Date.now() - INDEX.at < (onCloud() ? 600000 : 60000)) || INDEX.loading === key || (!onCloud() && (typeof api !== 'function' || typeof pathFor !== 'function'))) return;
    INDEX.loading = key;
    fetchIndex(p, days).then(data => { if (INDEX.loading !== key) return; INDEX.data = data; INDEX.key = key; INDEX.error = ''; INDEX.at = Date.now(); })
      .catch(error => { if (INDEX.loading === key) { INDEX.error = error.message || 'Could not count the agent index.'; INDEX.key = key; INDEX.at = Date.now(); } })
      .finally(() => { if (INDEX.loading === key) INDEX.loading = ''; refreshStats(true); });
  }
  function makerLegend(rows, interval = true) {
    const makers = [...new Set(rows.map(r => r.provider || 'Other'))];
    return `<div class="sx-legend">${makers.map(m => `<span>${swatch(m === 'Other' ? '' : m)}${escHtml(m)}</span>`).join('')}${interval ? '<span class="sx-legend-ci"><em aria-hidden="true"></em>95% interval</span>' : ''}</div>`;
  }
  function indexColumns(ranked) {
    if (ranked.length < 2) return '';
    const rows = ranked.slice(0, 15), top = Math.min(100, Math.ceil(Math.max(...rows.map(r => r.high)) / 10) * 10 || 100), floor = Math.max(0, Math.floor((Math.min(...rows.map(r => r.low)) - 10) / 10) * 10);
    const h = v => `${(100 * (Math.max(floor, v) - floor) / Math.max(1, top - floor)).toFixed(2)}%`;
    const ticks = []; for (let v = floor; v <= top; v += 10) ticks.push(v);
    return `<figure class="sx-cols" aria-label="Top pairings by score with 95% intervals">
      <div class="sx-cols-plot" style="--n:${rows.length}"><div class="sx-cols-grid" aria-hidden="true">${ticks.map(v => `<span style="bottom:${h(v)}"><b>${v}</b></span>`).join('')}</div>
      ${rows.map(r => `<div class="sx-col" title="${escHtml(tipOf(r))}"><span class="sx-col-bar" style="height:${h(r.score)};background:${makerColor(r.provider)}"></span><span class="sx-col-ci" style="bottom:${h(r.low)};height:calc(${h(r.high)} - ${h(r.low)})"></span><b class="sx-col-val" style="bottom:calc(${h(r.high)} + 5px)">${r.score.toFixed(1)}</b></div>`).join('')}</div>
      <div class="sx-cols-labels" style="--n:${rows.length}">${rows.map(r => `<div>${swatch(r.provider)}<strong>${escHtml(r.model)}</strong><span>${escHtml(r.agentName)}</span><span>${escHtml(r.effort || 'default')}</span>${r.lightOnly ? '<em class="sx-scope-tag">Light only</em>' : ''}</div>`).join('')}</div>
      ${makerLegend(rows)}</figure>`;
  }
  function indexTable(ranked) {
    const maxCost = Math.max(0, ...ranked.map(r => r.costPerWork || 0)), maxMin = Math.max(0, ...ranked.map(r => r.minutes || 0));
    const bar = (v, max) => `<span class="sx-inbar"><i style="width:${max > 0 ? Math.max(2, 100 * v / max).toFixed(1) : 0}%"></i></span>`;
    const rows = ranked.map(r => `<tr title="${escHtml(tipOf(r))}">
      <td><span class="sx-pill${r.rank <= 3 ? ` medal-${r.rank}` : ''}">${r.rank}</span></td>
      <td><span class="sx-ix-name">${swatch(r.provider)}<span><b>${escHtml(r.model)}</b><small>${escHtml(r.agentName)} · ${escHtml(r.effort ? `${r.effort} effort` : 'default effort')}${r.provider ? ` · ${escHtml(r.provider)}` : ''}${scopeTagHTML(r)}</small></span></span></td>
      <td class="sx-ix-score"><b>${r.score.toFixed(1)}</b><span class="sx-ci"><i style="width:${r.score.toFixed(1)}%;background:${makerColor(r.provider)}"></i><em style="left:${r.low.toFixed(1)}%;width:${Math.max(0.5, r.high - r.low).toFixed(1)}%"></em></span></td>
      <td class="sx-num sx-wide">${money(r.costPerWork)}${r.costPerWork == null ? '' : bar(r.costPerWork, maxCost)}</td>
      <td class="sx-num sx-wide">${r.minutes == null ? '—' : `${r.minutes.toFixed(1)} min`}${r.minutes == null ? '' : bar(r.minutes, maxMin)}</td>
      <td class="sx-num">${r.rating.toFixed(2)}</td><td class="sx-num">${r.works}</td></tr>`).join('');
    return `<div class="sx-scroll"><table class="sx-table sx-ix-table"><tr><th>Rank</th><th>Model · Agent · Effort</th><th>Score</th><th class="sx-wide">Cost / Work</th><th class="sx-wide">Time / Work</th><th title="Orchestrator score and yours, combined; yours counts twice">Rating</th><th>Works</th></tr>${rows}</table></div>`;
  }
  function indexHeatmap(data, current, example = false) {
    const kinds = JOB_KINDS, models = [];
    for (const r of data.tables.all.ranked) if (!models.some(m => m.model === r.model)) models.push(r);
    if (models.length < 2) return '';
    const best = new Map();
    for (const [k] of kinds) for (const r of data.tables[k]?.ranked || []) { const key = `${r.model}\0${k}`; if (!best.has(key) || best.get(key).score < r.score) best.set(key, r); }
    if (!best.size) return '';
    const values = [...best.values()].map(r => r.score), lo = Math.min(...values), hi = Math.max(...values);
    const STEPS = ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95'];
    const shade = v => { const i = hi > lo ? Math.round((v - lo) / (hi - lo) * (STEPS.length - 1)) : STEPS.length - 1; return [STEPS[i], i >= 6 ? '#fff' : '#0f172a']; };
    const eyebrow = `${example ? 'Example · ' : ''}${onCloud() ? 'All PenEcho users' : 'All projects on this computer'}`;
    return card('sx-heat-card', `<div><p class="sx-eyebrow">${eyebrow}</p><h2>Where each model is strong</h2><p class="sx-muted">Each cell is the model’s best ranked pairing for that kind of job. Darker is better; a dot means not enough Works yet.</p></div>`,
      `<div class="sx-scroll"><table class="sx-heat"><tr><th>Model</th>${kinds.map(([k, l]) => `<th class="${k === current ? 'on' : ''}">${l}</th>`).join('')}</tr>
      ${models.slice(0, 14).map(m => `<tr><th><span class="sx-ix-name">${swatch(m.provider)}<span><b>${escHtml(m.model)}</b><small>${escHtml(m.provider || '')}</small></span></span></th>${kinds.map(([k, l]) => {
        const r = best.get(`${m.model}\0${k}`);
        if (!r) return `<td class="none${k === current ? ' on' : ''}">·</td>`;
        const [bg, ink] = shade(r.score);
        return `<td class="${k === current ? 'on' : ''}" style="background:${bg};color:${ink}" title="${escHtml(`${l}: ${tipOf(r)}`)}">${r.score.toFixed(0)}</td>`;
      }).join('')}</tr>`).join('')}</table></div>
      <div class="sx-heat-scale"><span>${lo.toFixed(0)}</span><i style="background:linear-gradient(90deg,${STEPS.join(',')})"></i><span>${hi.toFixed(0)}</span></div>`);
  }
  function indexValue(ranked, example = false) {
    const points = ranked.filter(r => r.costPerWork > 0);
    if (points.length < 3) return '';
    const W = 960, H = 400, L = 56, R = 24, T = 20, B = 52;
    const costs = points.map(r => r.costPerWork), lo = Math.log10(Math.min(...costs) / 1.4), hi = Math.log10(Math.max(...costs) * 1.4);
    const scores = points.map(r => r.score), yMin = Math.max(0, Math.floor((Math.min(...scores) - 8) / 10) * 10), yMax = Math.min(100, Math.ceil((Math.max(...scores) + 6) / 10) * 10);
    const x = c => L + (Math.log10(c) - lo) / Math.max(1e-9, hi - lo) * (W - L - R), y = v => T + (1 - (v - yMin) / Math.max(1, yMax - yMin)) * (H - T - B);
    const ticks = []; for (let e = Math.floor(lo); e <= Math.ceil(hi); e++) for (const m of [1, 2, 5]) { const v = m * 10 ** e; if (Math.log10(v) >= lo && Math.log10(v) <= hi) ticks.push(v); }
    const yTicks = []; for (let v = yMin; v <= yMax; v += 10) yTicks.push(v);
    const frontier = [...points].sort((a, b) => a.costPerWork - b.costPerWork).reduce((line, r) => (!line.length || r.score > line.at(-1).score ? [...line, r] : line), []);
    const placed = [], labelled = new Set(), labelPos = new Map();
    for (const r of [...frontier, ...[...points].sort((a, b) => b.score - a.score).slice(0, 6)]) {
      const px = x(r.costPerWork), py = y(r.score), w = 7 * `${r.model} ${r.effort}`.length;
      const flip = px + 11 + w > W - R, bx = flip ? px - 11 - w : px + 11;
      if (labelled.has(r) || placed.some(b => Math.abs(b.y - py) < 16 && bx < b.x + b.w && b.x < bx + w + 10)) continue;
      labelled.add(r); labelPos.set(r, { x:flip ? px - 11 : px + 11, anchor:flip ? 'end' : 'start' });
      placed.push({ x:bx, y:py, w:w + 10 });
    }
    const eyebrow = `${example ? 'Example · ' : ''}${onCloud() ? 'All PenEcho users' : 'All projects on this computer'}`;
    return card('sx-value-card', `<div><p class="sx-eyebrow">${eyebrow}</p><h2>Score against cost</h2><p class="sx-muted">Higher is better, further left is cheaper. The line joins pairings no other pairing beats on both.</p></div>`,
      `<svg class="sx-value" viewBox="0 0 ${W} ${H}" role="img" aria-label="Score against cost per Work">
        <g class="sx-v-grid">${yTicks.map(v => `<line x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text x="${L - 10}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${v}</text>`).join('')}${ticks.map(v => `<text x="${x(v).toFixed(1)}" y="${H - B + 22}" text-anchor="middle">${money(v)}</text>`).join('')}</g>
        <text class="sx-v-axis" x="${(L + W - R) / 2}" y="${H - 8}" text-anchor="middle">Cost per Work (log scale)</text>
        <polyline class="sx-v-front" points="${frontier.map(r => `${x(r.costPerWork).toFixed(1)},${y(r.score).toFixed(1)}`).join(' ')}"/>
        ${points.map(r => `<g class="sx-v-dot${frontier.includes(r) ? ' best' : ''}"><title>${escHtml(`${tipOf(r)}, ${money(r.costPerWork)} per Work`)}</title><circle cx="${x(r.costPerWork).toFixed(1)}" cy="${y(r.score).toFixed(1)}" r="${frontier.includes(r) ? 8 : 6}" style="fill:${makerColor(r.provider)}"/>${labelled.has(r) ? `<text x="${labelPos.get(r).x.toFixed(1)}" y="${(y(r.score) + 4).toFixed(1)}" text-anchor="${labelPos.get(r).anchor}">${escHtml(`${r.model}${r.effort ? ` ${r.effort}` : ''}`)}</text>` : ''}</g>`).join('')}
      </svg>${makerLegend(points, false)}`);
  }
  const AGENTS_RATINGS = 'https://penecho.ai/leaderboard';
  function agentsRatingsCard() {
    return `<section class="sx-card sx-ar-card"><div><p class="sx-eyebrow">Leaderboard</p><h2>PenEcho Real-World AI Agent Leaderboard</h2><p class="sx-muted">Agent apps, models and effort levels ranked from real use, not benchmarks or votes.</p></div><a class="btn sx-ar-go" href="/leaderboard" target="_top">Open Leaderboard</a></section>`;
  }
  function indexCardsHTML(data, { scope, about, example = false } = {}) {
    const kind = STATS_STATE.indexKind || 'all';
    const table = data.tables[kind] || data.tables.all;
    const tabs = `<div class="seg sx-seg-sm" role="tablist" aria-label="Kind of job">${[['all', 'All jobs'], ...JOB_KINDS].map(([k, l]) => `<button type="button" role="tab" aria-selected="${kind === k}" data-act="stats-index-kind" data-kind="${k}">${l}<em>${data.tables[k]?.ranked.length || 0}</em></button>`).join('')}</div>`;
    const head = `<div><p class="sx-eyebrow">${escHtml(scope)}</p><h2>Agent index</h2><p class="sx-muted">${about}</p></div>${tabs}`;
    const hint = !onCloud() ? ' Rate Works yourself (optional) or use the Orchestrator (auto-rates) to rank pairings and make Orchestrator decisions more accurate.' : '';
    const body = table.ranked.length ? `${indexColumns(table.ranked)}${indexTable(table.ranked)}`
      : `<div class="sx-empty"><b>Not enough rated Works yet</b><p class="sx-muted">A pairing is ranked after ${data.thresholds.works} Works with at least ${data.thresholds.rated} rating${data.thresholds.rated === 1 ? '' : 's'}${data.thresholds.installs ? `, from ${data.thresholds.installs} installs` : ''}, from the Orchestrator or from ${onCloud() ? 'people' : 'you'}.${hint}</p></div>`;
    const waiting = table.collecting.length ? `<details class="sx-collect"><summary>Not ranked yet (${table.collecting.length})</summary><ul>${table.collecting.slice(0, 40).map(r => `<li><span>${escHtml(pairName(r))}</span><span class="sx-muted">${r.works} Work${r.works === 1 ? '' : 's'} · ${r.rated != null ? `${r.rated} rated` : `${r.installs} install${r.installs === 1 ? '' : 's'}`}</span></li>`).join('')}</ul></details>` : '';
    return `${card('sx-index', head, body + waiting)}${indexHeatmap(data, kind, example)}${indexValue(table.ranked, example)}`;
  }
  function indexHTML(p) {
    if (onCloud()) return agentsRatingsCard();
    loadIndex(p);
    const data = INDEX.key === String(periodDays()) ? INDEX.data : null;
    const span = PERIODS.find(x => x[0] === STATS_STATE.period)?.[1] || '';
    const scope = data ? `${data.projects === 1 ? 'The only project' : `All ${data.projects} projects`} on this computer · ${STATS_STATE.period === 'all' ? 'all time' : span.toLowerCase()}` : 'All projects on this computer';
    if (!data) return card('sx-index', `<div><p class="sx-eyebrow">${escHtml(scope)}</p><h2>Agent index</h2></div>`, `<p class="sx-muted" role="status">${escHtml(INDEX.error || 'Counting every project…')}</p>`);
    const about = `Ranked by the Orchestrator’s scores and your own ratings across every project here, with how long it took and what it cost. <a class="sx-link-inline" href="${AGENTS_RATINGS}" target="_blank" rel="noopener">Compare with every user on the PenEcho Real-World AI Agent Leaderboard</a>`;
    return indexCardsHTML(data, { scope, about });
  }

  // ---------- Example Statistics (shown automatically whenever no ratings can be shown yet) ----------
  const EXAMPLE_AGENT_NAMES = { claude:'Claude Code', codex:'Codex', antigravity:'Antigravity', kimi:'Kimi Code', opencode:'OpenCode', pi:'Pi', omp:'omp', dsh:'dsh' };
  const EXAMPLE_PROVIDERS = [
    [/^claude|^anthropic|^opus$|^sonnet$|^haiku$/i, 'Anthropic'],
    [/^gpt|^o\d|^codex|^openai/i, 'OpenAI'],
    [/^gemini|^gemma/i, 'Google'],
    [/^deepseek/i, 'DeepSeek'],
    [/^kimi|^moonshot/i, 'Moonshot AI'],
    [/^glm|^zhipu|^z-ai/i, 'Zhipu AI'],
    [/^qwen/i, 'Alibaba'],
    [/^grok/i, 'xAI'],
    [/^mistral|^codestral|^devstral/i, 'Mistral'],
    [/^llama/i, 'Meta'],
    [/^minimax/i, 'MiniMax'],
  ];
  const EXAMPLE_AGENT_PROVIDER = { claude:'Anthropic', codex:'OpenAI', antigravity:'Google', kimi:'Moonshot AI' };
  const exampleModelKey = model => String(model || '').trim().replace(/^.*\//, '').replace(/^(?:us|eu|apac)\.anthropic\./i, '').replace(/^anthropic\./i, '');
  const exampleProviderOf = (model, agent) => EXAMPLE_PROVIDERS.find(([re]) => re.test(model))?.[1] || EXAMPLE_AGENT_PROVIDER[String(agent || '').toLowerCase()] || '';
  const exampleAgentName = id => EXAMPLE_AGENT_NAMES[String(id || '').toLowerCase()] || agentMeta(id).name;
  const exampleModelTier = (model, effort) => {
    const m = String(model || '').toLowerCase(), e = String(effort || '').toLowerCase();
    if (/flash|mini|haiku|nano|lite/.test(m) || e === 'low') return 1;
    if (/opus|astra|fable/.test(m)) return 3;
    return 2;
  };
  const EXAMPLE_SLOT_TEMPLATES = [
    { costPerWork:1.42, minutes:7.8, tokens:195000, recordWorks:15, recordGood:6, recordBad:0, recordKinds:'5 kinds',
      all:[90.2, 87.0, 92.8, 4.61, 38],
      kinds:{ code:[91.2, 86.2, 95.0, 4.65, 11], chat:[92.4, 87.1, 96.2, 4.70, 9], design:[88.6, 82.8, 93.1, 4.54, 7], docs:[85.4, 79.6, 90.4, 4.42, 6], research:[86.2, 80.5, 91.0, 4.45, 5] } },
    { costPerWork:1.18, minutes:6.6, tokens:172000, recordWorks:13, recordGood:5, recordBad:1, recordKinds:'4 kinds',
      all:[84.6, 81.2, 86.8, 4.38, 32],
      kinds:{ code:[88.2, 82.9, 92.4, 4.53, 18], docs:[89.5, 84.4, 93.4, 4.58, 5], research:[86.4, 81.0, 90.8, 4.46, 4], chat:[82.8, 76.5, 87.9, 4.31, 5] } },
    { costPerWork:0.68, minutes:5.4, tokens:142000, recordWorks:6, recordGood:2, recordBad:0, recordKinds:'3 kinds',
      all:[79.4, 75.6, 81.0, 4.18, 24],
      kinds:{ research:[89.4, 84.0, 93.6, 4.58, 9], design:[85.2, 79.4, 89.8, 4.41, 7], code:[77.8, 71.5, 83.0, 4.11, 8] } },
    { costPerWork:0.34, minutes:3.4, tokens:126000, recordWorks:4, recordGood:1, recordBad:1, recordKinds:'3 kinds',
      all:[74.2, 70.1, 75.4, 3.97, 22],
      kinds:{ code:[78.5, 72.0, 83.8, 4.14, 8], research:[79.6, 73.2, 84.8, 4.18, 8], docs:[75.4, 68.8, 81.0, 4.02, 6] } },
    { costPerWork:0.28, minutes:4.6, tokens:118000, recordWorks:3, recordGood:1, recordBad:0, recordKinds:'3 kinds',
      all:[69.0, 64.5, 69.9, 3.76, 16],
      kinds:{ research:[78.6, 71.2, 84.6, 4.14, 6], docs:[73.2, 65.8, 79.6, 3.93, 5], code:[68.5, 60.8, 75.4, 3.74, 5] } },
    { costPerWork:0.08, minutes:3.8, tokens:96000, recordWorks:3, recordGood:1, recordBad:0, recordKinds:'3 kinds',
      all:[64.0, 59.2, 64.3, 3.56, 14],
      kinds:{ code:[70.2, 62.1, 77.2, 3.81, 5], chat:[69.4, 61.2, 76.5, 3.78, 5], docs:[65.8, 57.5, 73.4, 3.63, 4] } },
  ];
  const DEFAULT_EXAMPLE_MODELS = [
    { agent:'claude', model:'claude-opus-5-5', effort:'high' },
    { agent:'codex', model:'gpt-6.2-astra', effort:'xhigh' },
    { agent:'antigravity', model:'gemini-4-neon', effort:'high' },
    { agent:'codex', model:'gpt-6.2-sol', effort:'max' },
    { agent:'kimi', model:'kimi-k3.1-pro', effort:'max' },
    { agent:'opencode', model:'deepseek-v4.1-flash', effort:'low' },
  ];
  const DEFAULT_EXAMPLE_COLLECTING = [
    { agent:'claude', model:'claude-sonnet-5-5', effort:'high', works:2, rated:1 },
    { agent:'antigravity', model:'gemini-4-hydrogen', effort:'xhigh', works:2, rated:0 },
  ];
  function resolveExampleCatalog(opts = {}) {
    const raw = Array.isArray(opts.presets) ? opts.presets : (typeof S !== 'undefined' && Array.isArray(S.presets?.presets) ? S.presets.presets : []);
    const candidates = [], seenKey = new Set();
    for (const p of raw) {
      if (!p || p.auto) continue;
      const agent = String(p.agent || '').trim().toLowerCase();
      if (!agent || agent === 'penecho') continue;
      const model = exampleModelKey(p.model);
      if (!model) continue;
      const effort = String(p.effort || '').trim();
      const key = `${agent}\0${model.toLowerCase()}\0${effort.toLowerCase()}`;
      if (seenKey.has(key)) continue;
      seenKey.add(key);
      candidates.push({ agent, model, effort });
    }
    // Prefer distinct models (with an explicit effort first) so the heatmap, picks and scatter show broad coverage.
    const rankedRaw = [], usedIdx = new Set(), usedModels = new Set();
    const pickWhere = pred => {
      for (let i = 0; i < candidates.length && rankedRaw.length < EXAMPLE_SLOT_TEMPLATES.length; i++) {
        if (usedIdx.has(i) || !pred(candidates[i])) continue;
        usedIdx.add(i); usedModels.add(candidates[i].model.toLowerCase()); rankedRaw.push(candidates[i]);
      }
    };
    pickWhere(c => Boolean(c.effort) && !usedModels.has(c.model.toLowerCase()));
    pickWhere(c => !usedModels.has(c.model.toLowerCase()));
    pickWhere(c => Boolean(c.effort));
    pickWhere(() => true);
    const fromPresets = rankedRaw.length > 0;
    for (const d of DEFAULT_EXAMPLE_MODELS) {
      if (rankedRaw.length >= EXAMPLE_SLOT_TEMPLATES.length) break;
      if (usedModels.has(d.model.toLowerCase())) continue;
      usedModels.add(d.model.toLowerCase());
      rankedRaw.push(d);
    }
    // Order stably from flagship/higher-cost models down to fast/budget models so sample costs and picks stay realistic.
    const ordered = rankedRaw.map((item, idx) => ({ item, idx, tier:exampleModelTier(item.model, item.effort) }))
      .sort((a, b) => b.tier - a.tier || a.idx - b.idx)
      .map(x => x.item);
    const specs = ordered.map((item, i) => {
      const tpl = EXAMPLE_SLOT_TEMPLATES[i];
      return {
        agent:item.agent, agentName:exampleAgentName(item.agent), model:item.model,
        provider:exampleProviderOf(item.model, item.agent), effort:item.effort || '',
        ...tpl,
      };
    });
    const collecting = [], collectModels = new Set();
    const addCollect = (c, works, rated) => {
      collecting.push({ agent:c.agent, agentName:exampleAgentName(c.agent), model:c.model, provider:exampleProviderOf(c.model, c.agent), effort:c.effort || '', works, rated });
      collectModels.add(c.model.toLowerCase());
    };
    const rest = candidates.filter((_, i) => !usedIdx.has(i));
    for (const c of rest) {
      if (collecting.length >= 2) break;
      if (usedModels.has(c.model.toLowerCase()) || collectModels.has(c.model.toLowerCase())) continue;
      addCollect(c, 2, collecting.length === 0 ? 1 : 0);
    }
    for (const c of rest) {
      if (collecting.length >= 2) break;
      if (collecting.some(x => x.agent === c.agent && x.model.toLowerCase() === c.model.toLowerCase() && x.effort.toLowerCase() === c.effort.toLowerCase())) continue;
      addCollect(c, 2, collecting.length === 0 ? 1 : 0);
    }
    if (!fromPresets) {
      for (const d of DEFAULT_EXAMPLE_COLLECTING) {
        if (collecting.length >= 2) break;
        if (usedModels.has(d.model.toLowerCase()) || collectModels.has(d.model.toLowerCase())) continue;
        addCollect(d, d.works, d.rated);
      }
    }
    return { specs, collecting, fromPresets };
  }
  function exampleIndexData(catalog) {
    const makeRow = (spec, [score, low, high, rating, works]) => ({
      agent:spec.agent, agentName:spec.agentName, model:spec.model, provider:spec.provider, effort:spec.effort,
      score, low, high, rating, rated:works, minutes:spec.minutes, costPerWork:spec.costPerWork, works,
    });
    const rankRows = rows => {
      const sorted = rows.sort((a, b) => b.score - a.score || b.works - a.works || a.model.localeCompare(b.model));
      for (let i = 0; i < sorted.length; i++) sorted[i].rank = i > 0 && sorted[i].score === sorted[i - 1].score ? sorted[i - 1].rank : i + 1;
      return sorted;
    };
    const tables = { all:{ ranked:rankRows(catalog.specs.map(s => makeRow(s, s.all))), collecting:catalog.collecting } };
    for (const [kind] of JOB_KINDS) {
      const ranked = rankRows(catalog.specs.filter(s => s.kinds[kind]).map(s => makeRow(s, s.kinds[kind])));
      tables[kind] = { ranked, collecting:[] };
    }
    return { projects:3, works:74, thresholds:{ works:3, rated:1 }, tables };
  }
  // Deterministic 30-day sample Works so the example Works-by-day, Who-did-the-work, KPIs and Agent record stay consistent.
  const EXAMPLE_DAYS_PATTERN = [
    [0, 'code'], [1, 'code'], [0, 'chat'], [1, 'code'], [2, 'research'],
    [0, 'design'], [1, 'code'], [3, 'docs'], [0, 'code'], [1, 'code'],
    [2, 'design'], [0, 'chat'], [1, 'code'], [3, 'research'], [0, 'code'],
    [1, 'chat'], [0, 'docs'], [1, 'code'], [2, 'code'], [0, 'chat'],
    [1, 'code'], [3, 'docs'], [0, 'code'], [1, 'code'], [2, 'research'],
    [0, 'design'], [1, 'code'], [0, 'code'], [1, 'code'], [3, 'code'],
    [0, 'chat'], [1, 'code'], [2, 'design'], [0, 'code'], [1, 'code'],
    [0, 'docs'], [0, 'code'], [2, 'research'],
  ];
  const EXAMPLE_DAY_OFFSETS = [0, 0, 1, 1, 1, 2, 2, 3, 4, 4, 5, 6, 6, 7, 8, 9, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 27, 28, 29];
  const EXAMPLE_RECENT_TEMPLATES = [
    { score:5, context:'Chat · Auth token refresh Q&A · Work 2', note:'Explained when the app refreshes a session and answered both follow-up questions.' },
    { score:4, context:'Code · Retry backoff on offline save · Work 1', note:'Clean patch with full unit coverage; minor copy tweak remained.' },
    { score:4, context:'Research · Compare caching strategies · Work 1', note:'Clear side-by-side tradeoffs grounded in the current server layout.' },
  ];
  function exampleProjectBundle(now, period, catalog) {
    const days = dayColumns(period === 'all' ? '30d' : period, now, []);
    const valid = new Set(days.map(d => d.key));
    const distinctAgents = [];
    for (const s of catalog.specs) if (!distinctAgents.some(a => a.agent === s.agent)) distinctAgents.push(s);
    const slotAgent = idx => (distinctAgents[idx] || distinctAgents[idx % distinctAgents.length] || catalog.specs[0]);
    const works = [], daily = [];
    for (let i = 0; i < EXAMPLE_DAYS_PATTERN.length; i++) {
      const ago = EXAMPLE_DAY_OFFSETS[i], ms = dayStart(now) - ago * DAY, key = dayKey(ms);
      if (!valid.has(key)) continue;
      const [slotIdx, kind] = EXAMPLE_DAYS_PATTERN[i];
      const runner = slotAgent(slotIdx).agent;
      works.push({ agent:runner, day:key, outcome:'done' });
      daily.push({ day:key, runner, kind, works:1 });
    }
    const scale = Math.max(1, works.length) / EXAMPLE_DAYS_PATTERN.length;
    const byAgent = new Map();
    for (const w of works) byAgent.set(w.agent, (byAgent.get(w.agent) || 0) + 1);
    const rateByAgent = new Map(distinctAgents.map(s => [s.agent, round1(s.all[3])]));
    const agents = [...byAgent.entries()].map(([id, count]) => ({
      id, name:exampleAgentName(id), color:agentMeta(id).color, works:count,
      share:works.length ? Math.round(100 * count / works.length) : 0,
      rating:rateByAgent.get(id) || 4.2,
    })).sort((a, b) => b.works - a.works);
    const rated = Math.max(1, Math.round(34 * scale)), good = Math.max(1, Math.round(14 * scale)), bad = scale >= 0.4 ? Math.max(1, Math.round(2 * scale)) : 0;
    const st = {
      period, agent:'all', days, works, now:[],
      lines:Array.from({ length:Math.max(1, Math.round(14 * scale)) }),
      agents,
      totals:{
        estimatedCost:Math.round(18.42 * scale * 100) / 100,
        priced:Math.max(1, Math.round(36 * scale)),
        works:works.length,
        saved:{ works:Math.max(1, Math.round(24 * scale)), fewer:Math.round(1840000 * scale), tokensPercent:36.4, costPercent:38 },
        tokens:Math.round(6420000 * scale),
        cache:Math.round(19800000 * scale),
        rating:4.5, combinedRated:rated, good, bad,
      },
    };
    return { st, daily };
  }
  function exampleRecordHTML(catalog) {
    const head = '<tr><th>Agent</th><th>Works</th><th>Rating</th><th class="sx-wide">Time</th><th class="sx-wide">Tokens / Work</th><th>Cost</th></tr>';
    const recordSpecs = catalog.specs.slice(0, 4);
    const rows = recordSpecs.map(s => {
      const rating = round1(s.all[3]), score = round1(Math.max(3.5, s.all[3] - 0.1));
      const totalCost = Math.round(s.costPerWork * s.recordWorks * 100) / 100;
      const sub = [s.model, s.effort ? `${s.effort} effort` : '', s.recordKinds].filter(Boolean).join(' · ');
      return `<tr>
      <td><span class="sx-who">${avatar(s.agent, 22)}<span><b>${escHtml(s.agentName)}</b><small>${escHtml(sub)}</small></span></span></td>
      <td class="sx-num">${s.recordWorks}</td>
      <td class="sx-num">${ratingCellHTML({ rating, score, good:s.recordGood, bad:s.recordBad })}</td>
      <td class="sx-num sx-wide">${s.minutes.toFixed(1)} min</td>
      <td class="sx-num sx-wide">${fmt(s.tokens)}</td>
      <td class="sx-num">${usd(s.costPerWork)}<small>${usd(totalCost)} total</small></td></tr>`;
    }).join('');
    const distinctAgents = [];
    for (const s of catalog.specs) if (!distinctAgents.some(a => a.agent === s.agent)) distinctAgents.push(s);
    const recentItems = EXAMPLE_RECENT_TEMPLATES.map((tpl, i) => ({ ...tpl, agent:(distinctAgents[i] || catalog.specs[i] || catalog.specs[0]).agentName }));
    const recent = `<div class="sx-orch-ratings"><div class="sx-orch-ratings-hd"><h3>Recent ratings <em class="sx-muted sx-num">${recentItems.length}</em></h3></div>
      <div class="sx-orch-ratings-list">${recentItems.map(r => `<div class="sx-ex-rating"><b>${escHtml(r.agent)}</b><span class="sx-ex-rscore">${r.score}/5</span><span class="sx-muted">${escHtml(r.context)}</span><span class="sx-ex-rnote">${escHtml(r.note)}</span></div>`).join('')}</div></div>`;
    return card('sx-agents', '<div><p class="sx-eyebrow">Example project only</p><h2>Agent record</h2><p class="sx-muted">Per agent, model and effort · combined rating, tokens and cost</p></div>', `<div class="sx-scroll"><table class="sx-table orch-table">${head}${rows}</table></div>${recent}`);
  }
  function exampleBannerHTML(stAll) {
    const canRate = stAll.toRate.length > 0 && !(typeof HOSTED !== 'undefined' && HOSTED?.read);
    const orchBtn = !(onCloud() && !HOSTED.onComputer) ? '<button type="button" class="btn sx-ex-primary" data-act="go-view" data-view="orchestrator">Open Orchestrator</button>' : '';
    const rateBtn = canRate ? `<button type="button" class="btn" data-act="stats-jump-rate">Rate ${stAll.toRate.length} Work${stAll.toRate.length === 1 ? '' : 's'}</button>` : '';
    const toggleBtn = '<button type="button" class="sx-showall sx-ex-toggle" data-act="stats-example-toggle">Show my current stats</button>';
    return `<section class="sx-card sx-ex-banner" role="region" aria-label="Example statistics notice">
      <div class="sx-ex-head">
        <div>
          <p class="sx-eyebrow">Example statistics · Sample data</p>
          <h2>No ratings to show yet — here is an example</h2>
          <p class="sx-muted">Everything in the preview below uses sample data. Your real statistics replace it automatically as soon as ratings exist.</p>
        </div>
        <div class="sx-ex-actions">${orchBtn}${rateBtn}${toggleBtn}</div>
      </div>
      <div class="sx-ex-steps">
        <div class="sx-ex-step">
          <b>Rate Works yourself <span class="sx-ex-opt">optional</span></b>
          <p class="sx-muted">Give an eligible finished Work a quick thumbs up or down${canRate ? ' (or use Needs your rating below)' : ''}. Your feedback counts twice in each agent’s rating.</p>
        </div>
        <div class="sx-ex-step">
          <b>Use the Orchestrator <span class="sx-ex-opt">auto-rates</span></b>
          <p class="sx-muted">The Orchestrator scores eligible delegated Works by kind of job and skips review tasks.</p>
        </div>
      </div>
      <p class="sx-ex-payoff">Rating Works (optional) and using the Orchestrator (auto-rate) teach PenEcho which agent, model, and effort work best for each kind of job — making <strong>Orchestrator decisions more and more accurate</strong> over time.</p>
    </section>`;
  }
  function exampleMiniNoticeHTML() {
    return `<section class="sx-card sx-ex-mini" role="region" aria-label="No ratings yet">
      <div><p class="sx-eyebrow">No ratings yet</p><p class="sx-muted">Rate Works yourself (optional) and use the Orchestrator (auto-rates) so Orchestrator decisions become more and more accurate over time.</p></div>
      <button type="button" class="btn sm" data-act="stats-example-toggle">View example</button>
    </section>`;
  }
  function hasOrchRatings(p) {
    if (typeof ORCH === 'undefined' || !ORCH || ORCH.project !== p?.id || !ORCH.stats) return false;
    if (Array.isArray(ORCH.stats.ratings) && ORCH.stats.ratings.length > 0) return true;
    return (ORCH.stats.rows || []).some(r => Number.isFinite(r.rating) || Number.isFinite(r.score) || r.good > 0 || r.bad > 0 || r.scored > 0);
  }
  function statsRatingState(p, opts = {}) {
    const period = opts.period || STATS_STATE.period, agent = opts.agent || STATS_STATE.agent;
    const st = computeProjectStats(p, { period, agent, ...opts });
    const stAll = period === 'all' && agent === 'all' ? st : computeProjectStats(p, { ...opts, period:'all', agent:'all' });
    const projectHasRatings = st.totals.combinedRated > 0 || stAll.totals.combinedRated > 0 || hasOrchRatings(p);
    const key = String(onCloud() ? 30 : periodDays(period));
    const indexData = INDEX.key === key ? INDEX.data : null;
    const indexHasRanked = !onCloud() && Boolean(indexData?.tables?.all?.ranked?.length);
    const indexPending = !onCloud() && !projectHasRatings && typeof api === 'function' && typeof pathFor === 'function' && !INDEX.data && !INDEX.error;
    const noRatings = !projectHasRatings && !indexHasRanked && !indexPending;
    if (p?.id && STATS_STATE.exampleProject !== p.id) {
      STATS_STATE.exampleProject = p.id;
      STATS_STATE.exampleView = '';
    }
    const showExample = noRatings && STATS_STATE.exampleView !== 'real';
    return { st, stAll, projectHasRatings, indexData, indexHasRanked, indexPending, noRatings, showExample };
  }
  const isExampleStats = (p, opts = {}) => statsRatingState(p, opts).showExample;

  const hasLocalRecord = () => typeof statsRecordHTML === 'function' && !(typeof HOSTED !== 'undefined' && HOSTED);

  function renderStatsBody(p, opts = {}) {
    if (!onCloud()) loadIndex(p);
    const state = statsRatingState(p, opts), { st, stAll, noRatings, showExample } = state;
    const periods = PERIODS.map(([k, label]) => `<button type="button" role="tab" aria-selected="${STATS_STATE.period === k}" data-act="stats-period" data-period="${k}">${label}</button>`).join('');
    if (showExample) {
      const period = opts.period || STATS_STATE.period;
      const catalog = resolveExampleCatalog(opts);
      const ex = exampleProjectBundle(opts.now || Date.now(), period, catalog);
      const span = PERIODS.find(x => x[0] === period)?.[1] || '';
      const exScope = onCloud() ? 'Example · All PenEcho users · last 30 days'
        : `Example · All 3 projects on this computer · ${period === 'all' ? 'all time' : span.toLowerCase()}`;
      const exAbout = 'Sample rankings showing how the Orchestrator’s auto-ratings and your optional ratings rank each agent, model, and effort by kind of job.';
      const exIndex = indexCardsHTML(exampleIndexData(catalog), { scope:exScope, about:exAbout, example:true });
      const cloudCard = onCloud() ? agentsRatingsCard() : '';
      const html = `<div class="sx-top"><div class="sx-title"><p class="sx-eyebrow">Project statistics</p><h1>Statistics <span class="sx-ex-pill">Example</span></h1></div><div class="sx-filters"><div class="seg" role="tablist" aria-label="Period">${periods}</div></div></div>
        ${exampleBannerHTML(stAll)}
        <div class="sx-ex-frame" aria-label="Example statistics preview">
          <div class="sx-ex-strip"><span>Example preview · Sample data for illustration</span></div>
          ${totalsHTML(ex.st)}
          <div class="sx-charts">${dailyHTML(ex.st, p, { dailyRows:ex.daily, eyebrow:'Example project · Works by day' })}${agentShareHTML(ex.st, p, { eyebrow:'Example project · Agents' })}</div>
          ${exIndex}${cloudCard}${exampleRecordHTML(catalog)}
        </div>`;
      return { html, showExample:true };
    }
    const agents = [['all', 'All agents'], ...st.agentChoices.map(id => [id, agentMeta(id).name])].map(([k, label]) => `<button type="button" role="tab" aria-selected="${STATS_STATE.agent === k}" data-act="stats-agent" data-agent="${escHtml(k)}">${escHtml(label)}</button>`).join('');
    const html = `<div class="sx-top"><div class="sx-title"><p class="sx-eyebrow">Project statistics</p><h1>Statistics</h1></div><div class="sx-filters"><div class="seg" role="tablist" aria-label="Period">${periods}</div>${st.agentChoices.length > 1 || STATS_STATE.agent !== 'all' ? `<div class="seg sx-agent-seg" role="tablist" aria-label="Agent">${agents}</div>` : ''}</div></div>
      ${noRatings ? exampleMiniNoticeHTML() : ''}
      ${totalsHTML(st)}<div class="sx-charts">${dailyHTML(st, p)}${agentShareHTML(st, p)}</div>${indexHTML(p)}${hasLocalRecord() ? '' : hostedAgentsHTML(st)}`;
    return { html, showExample:false };
  }
  const statsInnerHTML = (p, opts = {}) => renderStatsBody(p, opts).html;
  function statsRateSlotHTML(p, opts = {}) {
    const st = computeProjectStats(p, { period:STATS_STATE.period, agent:STATS_STATE.agent, ...opts });
    return rateHTML(st);
  }
  // Order on page: Overview (#statsBody) -> One unified Agents section (#statsRecord) -> Needs your rating (#statsRate) -> Model prices (#statsPrices).
  function statsHTML(p) {
    const { html, showExample } = renderStatsBody(p);
    return `<div class="page sx-page${showExample ? ' is-example' : ''}"><div class="sx-body" id="statsBody">${html}</div>
    ${typeof statsRecordHTML === 'function' ? statsRecordHTML(p) : ''}<div class="sx-rate-slot" id="statsRate">${statsRateSlotHTML(p)}</div>${typeof statsPricesHTML === 'function' ? statsPricesHTML(p) : ''}</div>`;
  }

  // Redrawn only when something changed. The control in use keeps the keyboard, found again by what it does.
  function paintSlot(el, next, force) {
    if (!el || (!force && el.dataset.h === next)) return;
    const active = document.activeElement, keep = el.contains(active) && active.dataset.act ? { ...active.dataset } : null;
    el.innerHTML = el.dataset.h = next;
    if (keep) [...el.querySelectorAll('[data-act]')].find(x => Object.entries(keep).every(([k, v]) => x.dataset[k] === v))?.focus({ preventScroll:true });
  }
  function refreshStats(force) {
    const body = typeof $ === 'function' ? $('#statsBody') : null, p = typeof project === 'function' ? project() : null;
    if (!body || !p) return;
    const rate = typeof $ === 'function' ? $('#statsRate') : null;
    const { html, showExample } = renderStatsBody(p);
    body.closest?.('.sx-page')?.classList.toggle('is-example', showExample);
    paintSlot(body, html, force);
    if (rate) paintSlot(rate, statsRateSlotHTML(p), force);
  }
  function bindStatsPage(el) {
    if (el) el.dataset.h = el.innerHTML;
    const rate = typeof $ === 'function' ? $('#statsRate') : null;
    if (rate) rate.dataset.h = rate.innerHTML;
  }

  if (typeof ACT !== 'undefined') {
    const set = (key, value) => { STATS_STATE[key] = value; refreshStats(true); };
    ACT['stats-period'] = el => {
      STATS_STATE.day = '';
      set('period', el.dataset.period || '30d');
      if (typeof orchSyncStatsFilter === 'function') orchSyncStatsFilter(STATS_STATE.period, STATS_STATE.agent, true);
    };
    ACT['stats-agent'] = el => {
      STATS_STATE.open = '';
      set('agent', el.dataset.agent || 'all');
      if (typeof orchSyncStatsFilter === 'function') orchSyncStatsFilter(STATS_STATE.period, STATS_STATE.agent, false);
    };
    ACT['stats-sort'] = el => set('sort', el.dataset.sort || 'works');
    ACT['stats-agent-open'] = el => set('open', STATS_STATE.open === el.dataset.agent ? '' : el.dataset.agent);
    ACT['stats-agents-all'] = () => set('agentsAll', !STATS_STATE.agentsAll);
    ACT['stats-line-sort'] = el => set('lineSort', el.dataset.sort || 'works');
    ACT['stats-day'] = el => set('day', STATS_STATE.day === el.dataset.day ? '' : el.dataset.day);
    ACT['stats-rate-all'] = () => set('rateAll', !STATS_STATE.rateAll);
    ACT['stats-index-kind'] = el => set('indexKind', el.dataset.kind || 'all');
    ACT['stats-day-by'] = el => set('dayBy', el.dataset.by === 'kind' ? 'kind' : 'agent');
    ACT['stats-example-toggle'] = () => set('exampleView', STATS_STATE.exampleView === 'real' ? '' : 'real');
    ACT['stats-jump-rate'] = () => {
      const rate = typeof $ === 'function' ? $('#statsRate') : null;
      rate?.scrollIntoView?.({ behavior:'smooth', block:'start' });
      rate?.querySelector?.('[data-act="work-rate"]')?.focus?.({ preventScroll:true });
    };
  }

  const exported = { computeProjectStats, statsHTML, statsInnerHTML, statsRateSlotHTML, agentShareHTML, projectAgentShareHTML, projectDailySeries, periodDays, refreshStats, bindStatsPage, isExampleStats, STATS_STATE, STATS_INDEX:INDEX };
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  else Object.assign(root, exported);
})(typeof window !== 'undefined' ? window : globalThis);
