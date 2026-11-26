// Model prices, US$ per million tokens: one list for this computer, in Settings → Agents → Model prices and in Statistics.
// A price comes from a click on Sync, from a prompt any agent can answer, or from the person. penecho.ai's pages have none of this.
const PRICES = { data:null, loading:null, again:false, changes:0, old:false, drafts:{}, edit:'', adding:false, ask:false, pasted:'', askError:'', saving:'', syncing:false, said:'', error:'', target:'', timer:0 };
const pricesHere = () => !(typeof HOSTED !== 'undefined' && HOSTED);
const priceKeyOf = model => String(model || '').toLowerCase();

// ---------- What a model is called ----------
const orchCatalogId = model => /^(?:hosted:)?([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i.exec(model)?.[1]?.toLowerCase();
function orchCatalogName(model) {
  const id = orchCatalogId(model);
  const entry = id && SET.cloud?.models.find(m => String(m.id).toLowerCase() === id);
  return entry?.displayName || entry?.name || '';
}
function orchPriceLabel(model) {
  return orchCatalogName(model) || (orchCatalogId(model) ? `Unidentified model (…${model.slice(-6)})` : model);
}
// The models the saved agents and recent Works ran with, that have no price yet.
const priceMissing = () => PRICES.data?.missing || [];
const orchUnpriced = () => priceMissing().map(m => m.model);
// Those the saved agents run: what the tab counts and the agents' rows mark.
const priceWanted = () => priceMissing().filter(m => m.agents.length);
const presetNoPrice = x => pricesHere() && PRICES.data?.agents?.[x.id]?.priced === false;

// ---------- Loading ----------
function usePrices(data) {
  if (!data || !Array.isArray(data.models)) return;
  PRICES.data = { ...data, missing:data.missing || [], agents:data.agents || {} };
  PRICES.old = false;
  // Statistics works out each Work's cost with the same list.
  if (ORCH.stats) ORCH.stats.models = data.models;
  if (data.inbox?.taken) toast(`${orchPlural(data.inbox.taken, 'price')} added`);
}
async function loadPrices(force = false) {
  if (!pricesHere()) return;
  // One read at a time. A read asked for meanwhile follows it, and one that a save overtook is not used.
  if (PRICES.loading) { PRICES.again ||= force; return PRICES.loading; }
  if (PRICES.data && !force) return;
  const before = JSON.stringify(PRICES.data?.models), changes = PRICES.changes;
  const run = PRICES.loading = api('/model-prices')
    .then(data => { if (changes === PRICES.changes) usePrices(data); else PRICES.again = true; }, error => { if (error?.status === 404) PRICES.old = true; else if (!PRICES.data) PRICES.error = error?.message || 'Could not load the model prices.'; })
    .finally(() => { if (PRICES.loading === run) PRICES.loading = null; });
  await run;
  // Cloud models are listed by ID: their names come from PenEcho Cloud.
  if ([...(PRICES.data?.models || []), ...priceMissing()].some(m => orchCatalogId(m.model)) && (!SET.cloudAsked || Date.now() >= SET.cloudRefreshAt)) loadCloudModels();
  paintPrices();
  if (before && JSON.stringify(PRICES.data?.models) !== before) pricesChanged();
  if (PRICES.again) { PRICES.again = false; return loadPrices(true); }
}
// New prices change what Statistics says each Work cost, and whether the Orchestrator can compare costs.
function pricesChanged() {
  const p = project();
  if (!p) return;
  if (S.route?.view === 'stats' && ORCH.project === p.id) loadOrchestrator(p, true);
  if (ORCHSET.project === p.id && ORCHSET.data) loadOrchSettings(p, true);
}
async function priceCall(path, body) {
  const data = await api(`/model-prices${path}`, { method:'POST', body });
  PRICES.changes += 1;
  usePrices(data);
  pricesChanged();
  return data;
}

// ---------- Drawing ----------
const priceDraft = key => PRICES.drafts[key] || {};
const priceOf = model => (PRICES.data?.models || []).find(m => priceKeyOf(m.model) === priceKeyOf(model));
function priceInputsHTML(key, label) {
  const draft = priceDraft(key);
  return [['input', 'Input'], ['output', 'Output'], ['cached', 'Cached']].map(([field, name]) =>
    `<td><input type="number" min="0" step="any" inputmode="decimal" data-price-row="${esc(key)}" data-price-field="${field}" value="${esc(draft[field] ?? '')}" placeholder=" " aria-label="${esc(`${name} price of ${label}, US$ per million tokens`)}"></td>`).join('');
}
const priceButton = (act, key, icon, title) => `<button type="button" class="icon-btn" data-act="${act}" data-key="${esc(key)}" title="${title}" aria-label="${esc(title)}" ${PRICES.saving && PRICES.saving === key ? 'disabled' : ''}>${ic(icon, 15)}</button>`;
function priceSourceHTML(m) {
  if (!m.source) return 'You';
  let url = null; try { url = new URL(m.source); } catch { /* A name, as penecho.ai. */ }
  return url && /^https?:$/.test(url.protocol) ? `<a href="${esc(url.href)}" target="_blank" rel="noopener noreferrer">${esc(url.hostname.replace(/^www\./, ''))}</a>` : esc(m.source);
}
function priceRowHTML(m) {
  const key = priceKeyOf(m.model), label = orchPriceLabel(m.model);
  if (PRICES.edit === key) return `<tr class="is-editing" data-price-model="${esc(key)}"><td class="price-model">${esc(label)}</td>${priceInputsHTML(key, label)}<td class="price-source"></td><td class="price-acts">${priceButton('price-save', key, 'check', 'Save')}${priceButton('price-cancel', key, 'x', 'Cancel')}</td></tr>`;
  return `<tr data-price-model="${esc(key)}"><td class="price-model">${esc(label)}</td><td class="sx-num">${m.input}</td><td class="sx-num">${m.output}</td><td class="sx-num">${m.cached ?? '—'}</td>
    <td class="price-source" ${m.updated ? `title="${esc(m.updated)}"` : ''}>${priceSourceHTML(m)}</td>
    <td class="price-acts">${priceButton('price-edit', key, 'pen', `Edit ${label}`)}${priceButton('price-remove', key, 'trash', `Remove ${label}`)}</td></tr>`;
}
function priceMissingRowHTML(m) {
  const key = priceKeyOf(m.model), label = orchPriceLabel(m.model), who = [...new Set(m.agents.map(a => agentInfo(a.agent).name))].join(', ');
  return `<tr class="is-missing ${PRICES.target === key ? 'is-target' : ''}" data-price-model="${esc(key)}"><td class="price-model">${esc(label)} <span class="kind-tag is-amber">No price</span>${who ? `<small>${esc(who)}</small>` : ''}</td>${priceInputsHTML(key, label)}<td class="price-source"></td><td class="price-acts">${priceButton('price-save', key, 'check', `Save ${label}`)}</td></tr>`;
}
const priceNewRowHTML = () => `<tr class="is-editing"><td class="price-model"><input type="text" data-price-row="+" data-price-field="model" value="${esc(priceDraft('+').model ?? '')}" placeholder="Model" aria-label="Model" maxlength="120" autocomplete="off" spellcheck="false"></td>${priceInputsHTML('+', 'the new model')}<td class="price-source"></td><td class="price-acts">${priceButton('price-save', '+', 'check', 'Save')}${priceButton('price-cancel', '+', 'x', 'Cancel')}</td></tr>`;
// The line under the buttons: when it last synced, and what this sync brought or left.
function priceStateHTML() {
  if (PRICES.error) return `<p class="price-state is-error" role="alert">${esc(PRICES.error)}</p>`;
  const at = PRICES.data?.sync?.at, left = PRICES.said ? priceWanted().length : 0;
  const said = [at ? `Synced ${orchSyncDay(at)}` : '', PRICES.said, left ? `penecho.ai has no price for ${left === 1 ? 'one model' : `${left} models`}: use the prompt, or type it in` : ''].filter(Boolean);
  return `<p class="price-state">${said.map(esc).join(' · ')}</p>`;
}
function priceAskHTML(place) {
  if (!PRICES.ask) return '';
  return `<div class="price-ask">
    <div class="price-ask-head"><strong>Paste this into any agent</strong><button type="button" class="btn sm" data-act="price-copy">${ic('copy', 14)}Copy prompt</button></div>
    <pre tabindex="0" aria-label="Prompt">${esc(pricePrompt())}</pre>
    <label for="pricePasted-${place}">If it answers in a chat, paste the answer here</label>
    <textarea id="pricePasted-${place}" data-price-pasted rows="3" spellcheck="false">${esc(PRICES.pasted)}</textarea>
    <div class="price-ask-foot">${PRICES.askError || PRICES.data?.inbox?.error ? `<span class="is-error" role="alert">${esc(PRICES.askError || PRICES.data.inbox.error)}</span>` : ''}<button type="button" class="btn sm primary" data-act="price-paste" ${PRICES.saving === '*' ? 'disabled' : ''}>Save prices</button></div>
  </div>`;
}
function pricesHTML(place) {
  const stats = place === 'stats';
  const head = acts => (stats ? `<div class="sx-hd"><div><h2>Model prices</h2><p class="sx-muted">US$ / 1M tokens</p></div>${acts}</div>`
    : `<header class="sys-head"><div><h2>Model prices</h2><p class="sys-sub">US$ per 1M tokens</p></div>${acts}</header>`);
  if (PRICES.old) return `${head('')}<p class="empty-line">Restart PenEcho to set model prices here.</p>`;
  if (!PRICES.data) return `${head('')}<p class="empty-line" ${PRICES.error ? 'role="alert"' : ''}>${esc(PRICES.error || 'Loading…')}</p>`;
  const { models, missing } = PRICES.data;
  const acts = `<div class="price-ways"><button type="button" class="btn sm primary" data-act="price-sync" ${PRICES.syncing ? 'disabled' : ''}>${PRICES.syncing ? '<i class="spin" aria-hidden="true"></i>Syncing…' : `${ic('cloud', 14)}Sync from penecho.ai`}</button>
    <button type="button" class="btn sm" data-act="price-ask" aria-expanded="${PRICES.ask}">${ic('copy', 14)}Use a prompt</button>
    <button type="button" class="btn sm" data-act="price-add">${ic('plus', 14)}Add price</button>
    ${stats ? `<span id="orchLookup" class="orch-look sx-muted" aria-live="polite">${orchLookupHTML()}</span>` : ''}</div>`;
  const rows = `${PRICES.adding ? priceNewRowHTML() : ''}${missing.map(priceMissingRowHTML).join('')}${models.map(priceRowHTML).join('')}`;
  return `${head(acts)}<div aria-live="polite">${priceStateHTML()}</div>${priceAskHTML(place)}
    ${rows ? `<div class="sx-scroll"><table class="sx-table price-table"><thead><tr><th>Model</th><th>Input</th><th>Output</th><th>Cached</th><th class="price-source">From</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="empty-line">No model prices yet.</p>'}`;
}
// Every list on show: Settings opens over Statistics, so there can be two. One you are typing in is left as it is, unless it was your own click.
const priceShown = new WeakMap();
function paintPriceLists(force = false) {
  for (const host of $$('[data-prices]')) {
    const active = document.activeElement, inside = Boolean(active && host.contains(active)), typing = inside && /^(INPUT|TEXTAREA)$/.test(active.tagName);
    const html = pricesHTML(host.dataset.prices);
    if ((typing && !force) || priceShown.get(host) === html) continue;
    const back = inside ? { row:active.dataset.priceRow, field:active.dataset.priceField, act:active.dataset.act, key:active.dataset.key, at:active.selectionStart } : null;
    const top = $('.price-ask pre', host)?.scrollTop || 0;
    host.innerHTML = html; priceShown.set(host, html);
    if (top && $('.price-ask pre', host)) $('.price-ask pre', host).scrollTop = top;
    if (back) [...host.querySelectorAll('input, button, textarea')].find(el => (back.field ? el.dataset.priceRow === back.row && el.dataset.priceField === back.field : back.act && el.dataset.act === back.act && el.dataset.key === back.key))?.focus({ preventScroll:true });
  }
}
// The lists, and in Settings the agents' rows and the tab's number. A form being filled in there is not redrawn under its boxes.
function paintPrices(force = false) {
  paintPriceLists(force);
  if (typeof settingsUp === 'function' && settingsUp() && sysTabNow() === 'agents' && !SET.form && !SET.pinAll && !SET.drawing) render();
}
// Empty until it is painted, so that a page drawn again around it leaves what is in it alone.
const pricesHostHTML = (place, inner = '') => `<section class="prices ${place === 'stats' ? 'sx-card' : 'sys-sec'}" data-prices="${place}">${inner}</section>`;
function priceFocus(key, field) {
  const host = [...$$('[data-prices]')].at(-1);
  [...(host?.querySelectorAll(`[data-price-field="${field}"]`) || [])].find(el => el.dataset.priceRow === key)?.focus({ preventScroll:false });
}

// ---------- Sync ----------
ACT['price-sync'] = async () => {
  if (PRICES.syncing) return;
  Object.assign(PRICES, { syncing:true, said:'', error:'' });
  paintPrices(true);
  try {
    PRICES.said = orchSyncSaid(await priceCall('/sync', {}));
  } catch (error) { PRICES.error = error.message || 'Could not sync.'; }
  PRICES.syncing = false;
  paintPrices(true);
};

// ---------- A prompt for any agent ----------
// The models with no price, or every one here when all have one. An agent on this computer leaves its answer in a file PenEcho takes in.
function pricePrompt() {
  const missing = priceMissing(), rows = missing.length ? missing : (PRICES.data?.models || []).map(m => ({ model:m.model, agents:[] }));
  const list = rows.map(m => {
    const about = [orchCatalogName(m.model), ...new Set(m.agents.map(a => agentInfo(a.agent).name))].filter(Boolean).join(', ');
    return `- ${m.model}${about ? ` (${about})` : ''}`;
  }).join('\n');
  const inbox = PRICES.data?.inbox?.file;
  return `Find the current list price of each AI model below, in US$ per million tokens, on its provider's own pricing page. Do not answer from memory.

${list || '- the models your agents use'}

Write it as JSON like this, with each model's name exactly as above. "cached" is cached input: leave it out where the provider has none. Leave out a model whose price you cannot confirm.

{"models":[{"model":"example-model","input":1.5,"output":6,"cached":0.15,"source":"https://provider.example/pricing"}]}

${inbox ? `If you can write files on this computer, save it as:\n${inbox}\nOtherwise reply with only the JSON.` : 'Reply with only the JSON.'}`;
}
// The prices in an answer: JSON anywhere in it, else a table with Model, Input and Output columns.
function pricesFromAnswer(answer) {
  const text = String(answer || ''), number = value => (typeof value === 'number' ? value : /\d/.test(String(value ?? '')) ? Number(String(value).replace(/[$,\s]|US/g, '')) : NaN);
  const tidy = list => list.map(m => {
    const model = String(m?.model ?? m?.name ?? '').replace(/[`*]/g, '').trim(), input = number(m?.input), output = number(m?.output);
    if (!model || model === 'example-model' || !(input >= 0) || !(output >= 0)) return null;
    const out = { model, input, output };
    for (const field of ['cached', 'cacheWrite']) { const value = number(m[field]); if (value >= 0) out[field] = value; }
    if (m.source) out.source = String(m.source);
    return out;
  }).filter(Boolean);
  const fenced = [...text.matchAll(/```[a-z]*\s*([\s\S]*?)```/gi)].map(m => m[1]);
  const cut = (open, close) => { const a = text.indexOf(open), b = text.lastIndexOf(close); return a >= 0 && b > a ? text.slice(a, b + 1) : ''; };
  for (const part of [text, ...fenced, cut('{', '}'), cut('[', ']')]) {
    try {
      const read = JSON.parse(part), list = tidy(Array.isArray(read) ? read : Array.isArray(read?.models) ? read.models : [read]);
      if (list.length) return list;
    } catch { /* Not JSON: the next part, then a table. */ }
  }
  const cells = text.split(/\r?\n/).map(line => (line.includes('|') ? line.trim().replace(/^\||\|$/g, '').split('|') : line.split(/\t|,/)).map(c => c.trim())).filter(row => row.length >= 3);
  const at = cells.findIndex(row => /model/i.test(row[0]) && row.some(c => /input/i.test(c)) && row.some(c => /output/i.test(c)));
  if (at < 0) return [];
  const head = cells[at], col = test => head.findIndex(c => test.test(c)), cached = col(/cach/i);
  const input = head.findIndex(c => /input/i.test(c) && !/cach/i.test(c)), output = col(/output/i);
  return tidy(cells.slice(at + 1).map(row => ({ model:row[0], input:row[input], output:row[output], cached:cached >= 0 ? row[cached] : undefined })));
}
// While the prompt is open, an agent's answer left on this computer shows by itself.
function watchPrices() {
  clearInterval(PRICES.timer); PRICES.timer = 0;
  if (PRICES.ask) PRICES.timer = setInterval(() => {
    if (!PRICES.ask || !$('[data-prices]')) { PRICES.ask = false; watchPrices(); return; }
    if (!document.hidden) loadPrices(true);
  }, 4000);
}
ACT['price-ask'] = () => { PRICES.ask = !PRICES.ask; PRICES.askError = ''; watchPrices(); paintPrices(true); };
ACT['price-copy'] = () => copyText(pricePrompt(), 'Prompt copied. Paste it into any agent.');
ACT['price-paste'] = async () => {
  if (PRICES.saving) return;
  const models = pricesFromAnswer(PRICES.pasted);
  if (!models.length) { PRICES.askError = 'No prices in that answer. It needs each model with its input and output price.'; paintPrices(true); return; }
  PRICES.saving = '*'; PRICES.askError = '';
  paintPrices(true);
  try {
    await priceCall('', { models });
    Object.assign(PRICES, { pasted:'', ask:false });
    watchPrices();
    toast(`${orchPlural(models.length, 'price')} saved`);
  } catch (error) { PRICES.askError = error.message; }
  PRICES.saving = '';
  paintPrices(true);
};

// ---------- By hand ----------
async function savePrice(key) {
  const draft = priceDraft(key), known = key !== '+' && priceOf(key), model = key === '+' ? String(draft.model || '').trim() : known?.model || priceMissing().find(m => priceKeyOf(m.model) === key)?.model;
  const empty = [...(key === '+' ? ['model'] : []), 'input', 'output'].find(field => String(draft[field] ?? '').trim() === '');
  if (empty) { priceFocus(key, empty); return; }
  if (!model || PRICES.saving) return;
  PRICES.saving = key;
  try {
    // A price you typed is yours: a later sync leaves it alone.
    await priceCall('', { model, input:draft.input, output:draft.output, ...(String(draft.cached ?? '') !== '' ? { cached:draft.cached } : {}), ...(known?.cacheWrite != null ? { cacheWrite:known.cacheWrite } : {}) });
    delete PRICES.drafts[key];
    if (PRICES.edit === key) PRICES.edit = '';
    if (key === '+') PRICES.adding = false;
  } catch (error) { toast(error.message); }
  PRICES.saving = '';
  paintPrices(true);
  const next = priceMissing()[0];
  if (next && key !== '+' && !known) priceFocus(priceKeyOf(next.model), 'input');
}
ACT['price-save'] = el => savePrice(el.dataset.key);
ACT['price-edit'] = el => {
  const m = priceOf(el.dataset.key); if (!m) return;
  PRICES.edit = el.dataset.key;
  PRICES.drafts[PRICES.edit] = { input:String(m.input), output:String(m.output), cached:m.cached == null ? '' : String(m.cached) };
  paintPrices(true); priceFocus(PRICES.edit, 'input');
};
ACT['price-cancel'] = el => {
  delete PRICES.drafts[el.dataset.key];
  if (el.dataset.key === '+') PRICES.adding = false; else PRICES.edit = '';
  paintPrices(true);
};
ACT['price-add'] = () => { PRICES.adding = true; paintPrices(true); priceFocus('+', 'model'); };
ACT['price-remove'] = async el => {
  const m = priceOf(el.dataset.key); if (!m) return;
  try {
    await priceCall('', { model:m.model, remove:true });
    toast(`Removed ${orchPriceLabel(m.model)}`, { label:'Undo', fn:() => priceCall('', m).then(() => paintPrices(true)).catch(error => toast(error.message)) });
  } catch (error) { toast(error.message); }
  paintPrices(true);
};
// An agent's No price mark opens the list, with its model's row lit and Sync ready under Enter.
ACT['prices-open'] = el => {
  PRICES.target = priceKeyOf(PRICES.data?.agents?.[el.dataset.id]?.model);
  openSettings('agents', { sub:'prices' });
  requestAnimationFrame(() => $('#sysPanel [data-act="price-sync"]')?.focus({ preventScroll:true }));
};

document.addEventListener('input', e => {
  const el = e.target;
  if (el.dataset?.priceField) (PRICES.drafts[el.dataset.priceRow] ||= {})[el.dataset.priceField] = el.value;
  else if (el.hasAttribute?.('data-price-pasted')) PRICES.pasted = el.value;
});
document.addEventListener('keydown', e => {
  const row = e.target.dataset?.priceRow;
  if (!row || e.isComposing) return;
  if (e.key === 'Enter') { e.preventDefault(); savePrice(row); }
  if (e.key === 'Escape' && (row === '+' || PRICES.edit === row)) { e.preventDefault(); ACT['price-cancel']({ dataset:{ key:row } }); }
});

// ---------- Statistics ----------
// Outside the period/agent-filtered body, so what is typed stays.
function statsPricesHTML(p) {
  if (!pricesHere()) return '';
  orchUseProject(p);
  return `<div id="statsPrices">${pricesHostHTML('stats', pricesHTML('stats'))}</div>`;
}
