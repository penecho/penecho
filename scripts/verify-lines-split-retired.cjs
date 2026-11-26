#!/usr/bin/env node
'use strict';
// Checks the removed split workflow, saved plans, and direct Pin controls against isolated data.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'penecho-split-browser-'));
const docs = path.join(temp, 'docs'), shots = process.argv[2] || path.join(temp, 'shots');
fs.mkdirSync(path.join(docs, 'lines'), { recursive:true });
fs.mkdirSync(shots, { recursive:true });
const read = slug => fs.readFileSync(path.join(docs, 'lines', `${slug}.md`), 'utf8');
const write = (slug, text) => fs.writeFileSync(path.join(docs, 'lines', `${slug}.md`), text);
const stamp = new Date().toLocaleDateString('en-CA') + ' 09:00';
const head = (id, status, extra = '') => `---\nid: T-${id}\nstatus: ${status}\ncreated: ${stamp}\n${extra}---\n\n`;
write('parent', head(1, 'notes') + '# Saved project plan\n\n## Parts\n\n1. **Unstarted instructions** · quick\n\n   Keep the original unstarted instructions.\n\n2. **Existing child** · normal · [child](child.md)\n\n   Keep the existing child result.\n\n## Note · ' + stamp + '\n\nSaved plan history.\n');
write('child', head(2, 'notes', 'parent: parent\n') + '# Existing child\n\n## Note · ' + stamp + '\n\nWork that remains accessible.\n');
write('long', head(3, 'notes') + '# A long line title about invoices and supplier contracts that wraps naturally on narrow screens\n\n## Note · ' + stamp + '\n\nA realistic longer title.\n');
const agent = path.join(temp, 'agent.cjs');
fs.writeFileSync(agent, `process.stdin.resume(); process.stdin.on('end', () => console.log(JSON.stringify({type:'result',result:'Ordinary work completed.\\n<!-- penecho: tags="ordinary work" parts=[{"title":"Do not create","words":"Do not launch"}] -->'})));`);
const server = spawn(process.execPath, [path.join(root, 'server.js')], { cwd:root, stdio:['ignore', 'pipe', 'pipe'], env:{ ...process.env, NODE_ENV:'test', HOST:'127.0.0.1', PORT:'0', PENECHO_TEST_OPEN_ACCESS:'1', PENECHO_STATE_DIR:path.join(temp, 'state'), PENECHO_CLOUD_STATE_DIR:path.join(temp, 'cloud'), PENECHO_CONFIG_FILE:path.join(temp, 'config.env'), PENECHO_LINES_TEST_AGENT:agent, CLAUDE_CLI_PATH:'/nonexistent', CODEX_CLI_PATH:'/nonexistent', PATH:'/usr/bin:/bin' } });
let log = ''; server.stdout.on('data', d => log += d); server.stderr.on('data', d => log += d);
let browser, passed = 0;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, name) { const end = Date.now() + 20000; while (!await fn()) { if (Date.now() > end) throw Error(`Timed out: ${name}`); await wait(60); } }
const check = (label, value) => { assert.ok(value, label); console.log(`ok ${++passed} - ${label}`); };
(async () => {
  await until(() => {
    if (server.exitCode !== null || server.signalCode) throw Error(`Test server exited before startup:\n${log.slice(-2500)}`);
    return /PenEcho: http:\/\/127\.0\.0\.1:\d+/.test(log);
  }, 'server start');
  const base = log.match(/PenEcho: (http:\/\/127\.0\.0\.1:\d+)/)[1];
  browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath:process.env.CHROME_PATH } : { channel:'chrome' });
  const context = await browser.newContext({ viewport:{ width:1440, height:1000 } });
  const send = async (method, suffix, data) => context.request.fetch(`${base}/api/lines${suffix}`, { method, data, headers:{ origin:base } });
  const made = await send('POST', '/projects', { name:'Split retirement', docsPath:docs });
  const id = (await made.json()).project.id, prefix = `/projects/${id}`;
  await send('PATCH', prefix, { defaultAgent:'tester', offerSkill:false });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const home = async () => { await page.goto(`${base}/projects.html#${id}`); await page.waitForSelector('.hl-row[data-row="child"]'); };
  const open = async slug => { await page.goto(`${base}/projects.html#${id}/line/${slug}`); await page.waitForSelector('#linePage'); };
  const pin = slug => page.locator(`.hl-row[data-row="${slug}"] [data-act="line-pin"]`);
  await home();
  check('former children have independent home rows', await page.locator('.hl-row[data-row="parent"]').count() === 1 && await page.locator('.hl-row[data-row="child"]').count() === 1);
  const before = ['parent', 'child', 'long'].map(read);
  for (const [method, suffix, body] of [
    ['POST', '/topics', { text:'Old request', plan:true }],
    ['POST', '/topics', { topic:'parent', text:'Old request', agent:'tester', plan:true }],
    ['POST', '/topics/parent/plan', { agent:'tester' }],
    ['PUT', '/topics/parent/parts', { parts:[] }],
    ['POST', '/topics/parent/parts/start', {}],
    ['POST', '/topics/parent/parts/together', { agent:'tester' }],
  ]) {
    const response = await send(method, prefix + suffix, body), bodyOut = await response.json();
    check(`${method} ${suffix} is retired`, response.status() === 410 && bodyOut.code === 'SPLIT_RETIRED');
  }
  check('rejected calls preserve every topic byte', JSON.stringify(before) === JSON.stringify(['parent', 'child', 'long'].map(read)));
  check('no split work or extra topic was created', fs.readdirSync(path.join(docs, 'lines')).filter(n => n.endsWith('.md')).length === 3);
  await page.mouse.move(0, 0);
  check('Pin is visible without hover or a menu', await pin('child').evaluate(el => getComputedStyle(el).opacity === '1' && el.getBoundingClientRect().width > 0));
  await pin('child').click();
  await until(() => pin('child').getAttribute('aria-pressed').then(v => v === 'true'), 'pinned row');
  check('one click pins and persists the line', /^pinned: yes$/m.test(read('child')) && await page.locator('#railList [data-rail-group="pinned"][data-line="child"]').count() === 1);
  await page.reload(); await page.waitForSelector('.hl-row[data-row="child"]');
  check('pin state survives reload', await pin('child').getAttribute('aria-pressed') === 'true');
  await pin('child').focus(); await page.keyboard.press('Enter');
  await until(() => pin('child').getAttribute('aria-pressed').then(v => v === 'false'), 'keyboard unpin');
  check('keyboard Unpin restores focus and the file state', await pin('child').evaluate(el => document.activeElement === el) && !/^pinned:/m.test(read('child')));
  await page.locator('.hl-row[data-row="child"] .more-btn').click();
  check('line menu has neither Pin nor Plan and split', !/^(Pin|Unpin|Plan and split)$/m.test((await page.locator('#menu button').allTextContents()).map(t => t.trim()).join('\n')));
  await page.keyboard.press('Escape');
  await page.locator('.composer [data-act="cmp-plus"]').click();
  check('composer menu has no Plan and split', !/Plan and split/.test(await page.locator('#menu').textContent()));
  await page.keyboard.press('Escape');
  await page.mouse.move(0, 0); await page.screenshot({ path:path.join(shots, 'desktop.png') });
  await open('parent');
  check('saved instructions remain readable without execution or editing controls', /Keep the original unstarted instructions/.test(await page.locator('#lpLegacyParts').textContent()) && await page.locator('#lpLegacyParts input, #lpLegacyParts textarea, [data-act="crew-start"], [data-act="crew-together"]').count() === 0);
  await page.locator('#lpLegacyParts [data-line="child"]').click();
  await page.waitForSelector('.legacy-parent [data-line="parent"]');
  check('the child and its saved parent have direct navigation links', await page.locator('.legacy-parent').count() === 1);
  await page.locator('#lpHead [data-act="line-pin"]').click();
  await until(() => page.locator('#lpHead [data-act="line-pin"]').getAttribute('aria-pressed').then(v => v === 'true'), 'detail pin');
  check('the detail-page Pin still works', /^pinned: yes$/m.test(read('child')));
  const childBefore = read('child');
  await send('POST', prefix + '/topics/parent/close', {});
  check('archiving a parent leaves the child unchanged', read('child') === childBefore);
  await home(); check('the child remains on Home when its parent is archived', await page.locator('.hl-row[data-row="child"]').count() === 1);
  await send('POST', prefix + '/topics/parent/reopen', {});
  const parentBefore = read('parent');
  await send('POST', prefix + '/topics/child/close', {});
  check('archiving a child leaves the parent unchanged', read('parent') === parentBefore);
  await send('POST', prefix + '/topics/child/reopen', {});
  await page.goto(`${base}/projects.html#${id}/archive`); await page.waitForSelector('.archive-page');
  await home();
  const asked = await send('POST', prefix + '/topics', { text:'Complete ordinary work', topic:'new', agent:'tester' });
  const slug = (await asked.json()).slug;
  await until(() => /Ordinary work completed/.test(read(slug)), 'ordinary agent result');
  check('ordinary Ask execution remains functional and ignores old parts metadata', !/## Parts|Do not create/.test(read(slug)) && fs.readdirSync(path.join(docs, 'lines')).filter(n => n.endsWith('.md')).length === 4);
  for (const width of [768, 390]) {
    const touch = await browser.newContext({ viewport:{ width, height:1000 }, hasTouch:true, isMobile:width < 600 });
    const narrow = await touch.newPage(); narrow.on('pageerror', e => errors.push(e.message));
    await narrow.goto(`${base}/projects.html#${id}`); await narrow.waitForSelector('.hl-row[data-row="long"]');
    const target = narrow.locator('.hl-row[data-row="long"] [data-act="line-pin"]');
    check(`${width}px touch Pin is visible, fits, and has a 44px target`, await target.evaluate(el => { const b = el.getBoundingClientRect(); return b.width >= 44 && b.height >= 44 && b.left >= 0 && b.right <= innerWidth && getComputedStyle(el).opacity === '1'; }));
    await target.tap(); await until(() => target.getAttribute('aria-pressed').then(v => v === 'true'), 'touch pin');
    check(`${width}px touch Pin works directly`, /^pinned: yes$/m.test(read('long')));
    check(`${width}px has no horizontal page overflow`, await narrow.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await target.tap(); await until(() => target.getAttribute('aria-pressed').then(v => v === 'false'), 'touch unpin');
    await narrow.screenshot({ path:path.join(shots, `touch-${width}.png`) });
    await touch.close();
  }
  check('no browser script errors', errors.length === 0);
  console.log(`${passed} checks passed. Screenshots: ${shots}`);
})().catch(error => { console.error(error.stack); console.error(log.slice(-2500)); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  if (server.exitCode === null && !server.signalCode) {
    const exited = new Promise(resolve => server.once('exit', resolve)); server.kill(); await exited;
  }
  fs.rmSync(temp, { recursive:true, force:true });
});
