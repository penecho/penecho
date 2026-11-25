'use strict';
// Settings → Agents → Model prices and the agents' No price marks (prices.js, settings.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseHTML } = require('./helpers/dom.js');

const read = file => fs.readFileSync(path.join(__dirname, '../public/lines', file), 'utf8');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const DATA = () => ({
  models:[{ model:'gpt-6.2-astra', input:8, output:40, cached:.4, cacheWrite:10, updated:'2026-11-17' }, { model:'gemini-4-neon', input:3, output:15, source:'penecho.ai' }, { model:'kimi', input:2, output:10, source:'https://www.kimi.example/pricing' }],
  agents:{ a1:{ model:'opus', priced:false }, a2:{ model:'gpt-6.2-astra', priced:true } },
  missing:[{ model:'opus', agents:[{ id:'a1', name:'Claude Code · opus', agent:'claude' }] }, { model:'old-one', agents:[] }],
  sync:null, inbox:{ file:'/state/new-prices.json', taken:0 },
});
function harness({ hosted = false, data = DATA(), fail = null } = {}) {
  const { document, window } = parseHTML('<html><body><div id="view"><div data-prices="stats"></div></div></body></html>');
  const calls = [], toasts = [], opened = [], copied = [], answers = { '':null, '/sync':null };
  const c = vm.createContext({
    document, window, console, ACT:{}, HOSTED:hosted, esc, ic:() => '', av:() => '', URL, setInterval:() => 1, clearInterval() {}, requestAnimationFrame:fn => fn(), queueMicrotask:fn => fn(),
    location:{ hash:'', origin:'http://localhost' }, history:{ replaceState() {} }, localStorage:{ getItem:() => null, setItem() {} }, sessionStorage:{ getItem:() => null, removeItem() {} },
    S:{ route:{ view:'stats' }, projects:[], presets:{ presets:[{ id:'a1', agent:'claude', name:'Claude Code · opus', model:'opus', effort:'high', available:true }, { id:'a2', agent:'codex', name:'Codex', model:'gpt-6.2-astra', effort:'high', available:true }], default:'' }, agentCheck:{ agents:[] } },
    ORCH:{ project:'p', stats:{ models:[] } }, ORCHSET:{ project:'', data:null }, project:() => ({ id:'p' }), loadOrchestrator:() => calls.push('reload'), loadOrchSettings() {}, orchUseProject() {},
    orchLookupHTML:() => '<button data-act="orch-prices-ai">Look up with AI</button>', orchPlural:(n, one) => `${n} ${one}${n === 1 ? '' : 's'}`, orchSyncDay:() => 'Nov 25', orchSyncSaid:r => `${r.addedPrices} prices added`,
    agentInfo:id => ({ claude:{ name:'Claude Code' }, codex:{ name:'Codex' } }[id] || { name:id }), copyText:text => copied.push(text), toast:(text, action) => toasts.push({ text, action }),
    $:(sel, root = document) => root.querySelector(sel), $$:(sel, root = document) => [...root.querySelectorAll(sel)], render() {}, runnableAgents:() => [],
  });
  c.api = async (url, options = {}) => {
    calls.push({ url, body:options.body });
    if (fail) throw Object.assign(new Error(fail.message), { status:fail.status });
    if (url === '/model-prices/sync') return { ...data, models:[...data.models, { model:'opus', input:4, output:20, source:'penecho.ai' }], agents:{ ...data.agents, a1:{ model:'opus', priced:true } }, missing:data.missing.slice(1), sync:{ at:'2026-11-25T00:00:00.000Z' }, addedPrices:1 };
    return data;
  };
  vm.runInContext(read('settings.js'), c);
  vm.runInContext(read('prices.js'), c);
  c.openSettings = (id, options) => opened.push([id, options?.sub]);
  c.run = code => vm.runInContext(code, c);
  return { c, document, window, calls, toasts, opened, copied, host:document.querySelector('[data-prices]') };
}
const words = el => el.textContent.replace(/\s+/g, ' ').trim();

test('an agent whose model has no price is marked, and the mark opens Model prices', async () => {
  const h = harness();
  assert.doesNotMatch(h.c.presetRowHTML(h.c.S.presets.presets[0], ''), /No price/, 'nothing is marked before the prices are read');
  await h.c.loadPrices();
  const row = parseHTML(`<body>${h.c.presetRowHTML(h.c.S.presets.presets[0], '')}</body>`).document, mark = row.querySelector('[data-act="prices-open"]');
  assert.equal(words(mark), 'No price');
  assert.doesNotMatch(h.c.presetRowHTML(h.c.S.presets.presets[1], ''), /No price/);
  h.c.ACT['prices-open'](mark);
  assert.deepEqual(h.opened, [['agents', 'prices']]);
  h.c.paintPrices();
  assert.equal(h.host.querySelector('tr.is-target').dataset.priceModel, 'opus');
  // Two tabs on the Agents page; the number is of the models the saved agents run.
  const tabs = parseHTML(`<body>${h.c.agentsTabsHTML()}</body>`).document;
  assert.deepEqual([...tabs.querySelectorAll('[role="tab"]')].map(words), ['Agents', 'Model prices1']);
});

test('the list shows the models with no price first, with boxes, then every price and where it is from', async () => {
  const h = harness();
  await h.c.loadPrices();
  assert.deepEqual([...h.host.querySelectorAll('[data-price-model]')].map(tr => tr.dataset.priceModel), ['opus', 'old-one', 'gpt-6.2-astra', 'gemini-4-neon', 'kimi']);
  assert.deepEqual([...h.host.querySelectorAll('tr.is-missing .price-model')].map(words), ['opus No priceClaude Code', 'old-one No price']);
  assert.equal(h.host.querySelectorAll('tr.is-missing input').length, 6);
  assert.deepEqual([...h.host.querySelectorAll('tbody tr:not(.is-missing) .price-source')].map(words), ['You', 'penecho.ai', 'kimi.example']);
  assert.deepEqual([...h.host.querySelectorAll('.price-ways button')].map(words), ['Sync from penecho.ai', 'Use a prompt', 'Add price', 'Look up with AI']);
  assert.equal(/Look up with AI/.test(h.c.pricesHTML('settings')), false, 'Look up with AI starts a Line in a project, so it stays in Statistics');
  assert.deepEqual(h.c.ORCH.stats.models, h.c.run('PRICES.data.models'), 'Statistics works out costs with the same list');
});

test('Sync brings prices and says what is left', async () => {
  const h = harness();
  await h.c.loadPrices();
  await h.c.ACT['price-sync']();
  assert.ok(h.calls.some(x => x.url === '/model-prices/sync'));
  assert.equal(words(h.host.querySelector('.price-state')), 'Synced Nov 25 · 1 prices added');
  assert.doesNotMatch(h.c.presetRowHTML(h.c.S.presets.presets[0], ''), /No price/);
  assert.ok(h.calls.includes('reload'), 'Statistics works its costs out again');
  const left = harness({ data:{ ...DATA(), missing:[...DATA().missing.slice(1), { model:'nova', agents:[{ id:'a3', name:'Nova', agent:'codex' }] }, { model:'mira', agents:[{ id:'a4', name:'Mira', agent:'codex' }] }] } });
  await left.c.loadPrices(); await left.c.ACT['price-sync']();
  assert.match(words(left.host.querySelector('.price-state')), /penecho\.ai has no price for 2 models: use the prompt, or type it in$/);
});

test('the prompt names the models, their apps and the file; a pasted answer is saved', async () => {
  const h = harness();
  await h.c.loadPrices();
  h.c.ACT['price-ask']();
  h.c.ACT['price-copy']();
  assert.match(h.copied[0], /- opus \(Claude Code\)\n- old-one\n/);
  assert.match(h.copied[0], /\/state\/new-prices\.json\nOtherwise reply with only the JSON\.$/);
  assert.equal(h.host.querySelector('.price-ask pre').textContent, h.copied[0]);
  h.c.run("PRICES.pasted = 'I could not find them.'");
  await h.c.ACT['price-paste']();
  assert.match(h.host.querySelector('.price-ask [role="alert"]').textContent, /No prices in that answer/);
  h.c.run(`PRICES.pasted = 'Here:\\n\`\`\`json\\n{"models":[{"model":"opus","input":4,"output":20,"cached":0.2}]}\\n\`\`\`'`);
  await h.c.ACT['price-paste']();
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls.findLast(x => x.body?.models).body)), { models:[{ model:'opus', input:4, output:20, cached:.2 }] });
  assert.equal(h.host.querySelector('.price-ask'), null);
  const prices = text => JSON.parse(JSON.stringify(h.c.pricesFromAnswer(text)));
  assert.deepEqual(prices('[{"model":"a","input":"$1.50","output":"6"},{"model":"example-model","input":1,"output":2},{"model":"b","input":null,"output":2}]'), [{ model:'a', input:1.5, output:6 }]);
  assert.deepEqual(prices('Prices:\n| Model | Cached input | Input | Output |\n|---|---|---|---|\n| `opus` | $0.20 | $4.00 | $20 |\n| none | - | - | - |'), [{ model:'opus', input:4, output:20, cached:.2 }]);
  assert.deepEqual(prices('model,input,output\nnova,1,2'), [{ model:'nova', input:1, output:2 }]);
  assert.deepEqual(prices('{"model":"solo","input":0,"output":0,"source":"https://x.example"}'), [{ model:'solo', input:0, output:0, source:'https://x.example' }]);
});

test('a typed price is saved from its row, an edit keeps the cache-write price, and Remove can be undone', async () => {
  const h = harness(), draft = (row, fields) => { h.c.draftIn = fields; h.c.run(`PRICES.drafts[${JSON.stringify(row)}] = { ...draftIn }`); };
  const sent = () => JSON.parse(JSON.stringify(h.calls.findLast(x => x.body)?.body ?? null));
  await h.c.loadPrices();
  draft('opus', { input:'4' });
  await h.c.savePrice('opus');
  assert.equal(sent(), null, 'nothing is sent without an output price');
  draft('opus', { input:'4', output:'20', cached:'' });
  await h.c.savePrice('opus');
  assert.deepEqual(sent(), { model:'opus', input:'4', output:'20' });
  h.c.ACT['price-edit']({ dataset:{ key:'gpt-6.2-astra' } });
  assert.deepEqual([...h.host.querySelectorAll('tr.is-editing input')].map(i => i.getAttribute('value')), ['8', '40', '0.4']);
  draft('gpt-6.2-astra', { input:'7', output:'40', cached:'0.4' });
  await h.c.savePrice('gpt-6.2-astra');
  assert.deepEqual(sent(), { model:'gpt-6.2-astra', input:'7', output:'40', cached:'0.4', cacheWrite:10 });
  h.c.ACT['price-add']();
  draft('+', { model:' nova ', input:'1', output:'2' });
  await h.c.savePrice('+');
  assert.deepEqual(sent(), { model:'nova', input:'1', output:'2' });
  await h.c.ACT['price-remove']({ dataset:{ key:'kimi' } });
  assert.deepEqual(sent(), { model:'kimi', remove:true });
  const undo = h.toasts.at(-1).action;
  assert.equal(undo.label, 'Undo');
  await undo.fn();
  assert.deepEqual(sent(), { model:'kimi', input:2, output:10, source:'https://www.kimi.example/pricing' });
});

test('a read that a save overtook is not used', async () => {
  const h = harness(), api = h.c.api;
  await h.c.loadPrices();
  let late;
  h.c.api = (url, options) => (options?.method ? api(url, options) : new Promise(resolve => { late ||= resolve; if (late !== resolve) resolve({ ...DATA(), missing:[] }); }));
  const reading = h.c.loadPrices(true);
  await h.c.priceCall('/sync', {});
  assert.deepEqual(h.c.run('priceWanted().length'), 0);
  late(DATA());
  await reading;
  assert.equal(h.c.run('priceMissing().length'), 0, 'the late answer from before the save is dropped, and the list is read again');
});

test('penecho.ai has no prices of its own, and an older server says to restart', async () => {
  const hosted = harness({ hosted:true });
  await hosted.c.loadPrices();
  assert.equal(hosted.calls.length, 0);
  assert.equal(hosted.c.statsPricesHTML({ id:'p' }), '');
  assert.equal(hosted.c.run('agentsHavePrices()'), false);
  const old = harness({ fail:{ status:404, message:'Not found' } });
  await old.c.loadPrices();
  assert.match(words(old.host), /^Model prices.*Restart PenEcho to set model prices here\.$/);
  const down = harness({ fail:{ status:500, message:'PenEcho could not do that (500).' } });
  await down.c.loadPrices();
  assert.match(words(down.host), /PenEcho could not do that \(500\)\.$/);
});

test('every word from the server is escaped', async () => {
  const evil = '<img src=x onerror=alert(1)>';
  const h = harness({ data:{ models:[{ model:evil, input:1, output:2, source:evil, updated:evil }, { model:'b', input:1, output:2, source:'javascript:alert(1)' }], agents:{}, missing:[{ model:`${evil}2`, agents:[{ id:'x', name:evil, agent:evil }] }], sync:null, inbox:{ file:evil, error:evil } } });
  await h.c.loadPrices();
  h.c.ACT['price-ask']();
  assert.equal(h.host.querySelector('img'), null);
  assert.equal(h.host.querySelector('a[href^="javascript"]'), null);
});
