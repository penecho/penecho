#!/usr/bin/env node
"use strict";
// Exercise the unsent Ask's split Paste control against an isolated real server.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const { createProjectLines } = require('../src/server/project-lines/http.js');
const F = require('../src/server/project-lines/format.js');
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lines-paste-'));
const shots = path.resolve(process.argv[2] || path.join(temp, 'shots'));
fs.mkdirSync(shots, { recursive:true });
let browser, server, passed = 0, runnable = true;
const copied = [], opened = [], requests = [], errors = [];
const check = (label, value) => { assert.ok(value, label); passed++; console.log(`ok ${label}`); };
const agents = {
  available:() => ['codex', 'claude'].map(id => ({ id, name:id === 'codex' ? 'Codex' : 'Claude', mono:id === 'codex' ? 'Cx' : 'Cl', color:'#334155', available:true, runs:runnable, app:id === 'codex' ? 'Codex' : 'Claude', opens:true })),
  nameOf:id => id === 'codex' ? 'Codex' : 'Claude', desktop:() => ({ command:'stub', args:[] }),
};
const api = createProjectLines({ directory:path.join(temp, 'state'), agents, serviceOptions:{ autoWatch:false, memory:{ home:path.join(temp, 'home'), env:{} } }, isThisComputer:() => true, authorizeRead:() => null, authorizeWrite:() => null,
  readJson:async req => { let text = ''; for await (const chunk of req) text += chunk; return JSON.parse(text || '{}'); },
  send:(res, status, data) => { res.writeHead(status, { 'content-type':'application/json' }); res.end(JSON.stringify(data)); },
});
const s = api.service, p = s.store.create({ name:'Paste controls', docsPath:path.join(temp, 'Project docs') });
p.follow = false; p.offerSkill = false; p.defaultAgent = 'codex'; s.store.save();
s.writeDoc(p, 'one', F.initialLine({ title:'Review a pending request', status:'done', steps:[F.askStep({ words:'An earlier request' }), { ...F.workStep({ who:'codex' }), done:true, out:'Earlier work is ready.' }] }));
s.remember(p, 'one', 'codex', 'saved-conversation', 'work', p.docsPath);
s.clipboard = text => copied.push(text);
s.openForPaste = async (project, slug, agent) => { opened.push({ slug, agent, copied:copied.at(-1) }); return { opened:true, app:'Codex', fresh:false }; };
const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.svg':'image/svg+xml', '.webp':'image/webp' };
(async () => {
  await s.saveUnsent(p, { topic:'one', text:'Please review these changes' });
  const before = s.readDoc(p, 'one');
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'POST' && url.pathname.endsWith('/paste')) requests.push(url.pathname);
    if (await api.handle(req, res, url)) return;
    const file = path.resolve(root, 'public', '.' + url.pathname);
    if (!file.startsWith(path.join(root, 'public') + path.sep) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type':mime[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/projects.html#${p.id}/line/one`;
  browser = await chromium.launch({ channel:'chrome' });
  const context = await browser.newContext({ viewport:{ width:1440, height:900 }, reducedMotion:'reduce' });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(url); await page.waitForSelector('.lp-ask.is-unsent .paste-split');
  const ask = page.locator('.lp-ask.is-unsent').first(), split = ask.locator('.paste-split'), pick = split.getByRole('button', { name:'Choose paste mode' });
  const main = () => split.locator('button').first();
  const paste = async click => {
    const count = copied.length, response = page.waitForResponse(res => res.request().method() === 'POST' && new URL(res.url()).pathname.endsWith('/paste'));
    await click();
    const res = await response, mode = res.request().postDataJSON().context;
    assert.equal(res.status(), 200);
    await page.waitForFunction(mode => Object.values(S.handed || {})[0]?.context === mode && document.querySelector('.unsent-hint'), mode);
    assert.equal(copied.length, count + 1);
  };
  check('one Paste split control defaults to with context, including in an existing conversation', await split.locator('button').count() === 2 && await main().innerText() === 'Paste with context' && await ask.locator('[data-act="unsent-plain"]').count() === 0);
  check('Run stays primary and Paste stays secondary', await ask.locator('.run-main').isVisible() && !await main().evaluate(el => el.classList.contains('unsent-go')));
  check('Paste matches Run height, joined corners and dropdown width', await split.evaluate(el => { const [main, pick] = el.children, run = document.querySelector('.run-main'); return main.offsetHeight === run.offsetHeight && getComputedStyle(main).borderTopRightRadius === '0px' && getComputedStyle(pick).borderTopLeftRadius === '0px' && pick.offsetWidth === document.querySelector('.run-pick').offsetWidth; }));
  await ask.scrollIntoViewIfNeeded(); await page.screenshot({ path:path.join(shots, 'paste-default.png') });
  await pick.focus(); await page.keyboard.press('Enter');
  check('the dropdown lists both modes, marks the default and copies nothing', await page.getByRole('menuitem').count() === 2 && await page.locator('#menu button.on').innerText() === 'Paste with context' && copied.length === 0 && opened.length === 0);
  await page.screenshot({ path:path.join(shots, 'paste-menu.png') });
  await page.keyboard.press('ArrowDown');
  check('arrow keys reach without context', await page.getByRole('menuitem', { name:'Paste without context', exact:true }).evaluate(el => el === document.activeElement));
  await page.keyboard.press('Escape');
  check('Escape closes without pasting and restores focus', await page.locator('#menu').count() === 0 && await pick.evaluate(el => el === document.activeElement) && copied.length === 0);
  await paste(() => main().click());
  check('one click copies with the Topic reference before opening the agent', copied.at(-1).includes(path.join(p.docsPath, 'lines/one.md')) && opened.length === 1 && opened[0].copied === copied.at(-1));
  await pick.click(); await page.keyboard.press('ArrowDown'); await paste(() => page.keyboard.press('Enter'));
  check('without context copies the words without a Topic reference or app launch', copied.at(-1) === 'Please review these changes' && opened.length === 1 && await main().innerText() === 'Paste without context' && await page.locator('#menu').count() === 0);
  await paste(() => main().click());
  check('the main button repeats the chosen mode', copied.at(-1) === 'Please review these changes' && opened.length === 1);
  await pick.click(); check('the menu marks the current mode', await page.locator('#menu button.on').innerText() === 'Paste without context');
  await paste(() => page.getByRole('menuitem', { name:'Paste with context', exact:true }).click());
  check('switching back restores the main context action', await main().innerText() === 'Paste with context' && copied.at(-1).includes('lines/one.md') && opened.length === 2);
  check('pasting leaves the Ask unsent and its document intact', await ask.locator('.unsent-mark').innerText() === 'Not sent yet.' && s.readDoc(p, 'one') === before && requests.length === 4);
  await page.reload(); await split.waitFor();
  check('a fresh page defaults to with context', await main().innerText() === 'Paste with context');
  runnable = false; await page.evaluate(async () => { await loadAgents(); refreshLine(); });
  check('when no agent can run, both halves of Paste become primary', await ask.locator('.run-split').count() === 0 && await split.locator('.unsent-go').count() === 2);
  s.runs.set(s.key(p, 'one'), { agent:'codex', stepId:'work-1', started:Date.now() });
  await page.evaluate(async () => { S.handed = {}; await loadState(project().id, { force:true }); refreshLine(); });
  await page.waitForFunction(() => lineById(project(), 'one')?.running);
  const openedBeforeRun = opened.length;
  check('while a line is running, Paste with context drops the open-app arrow', await main().innerText() === 'Paste with context' && await main().locator('svg').count() === 1);
  await paste(() => main().click());
  check('while a line is running, Paste with context still copies and opens no app', copied.at(-1).includes('lines/one.md') && opened.length === openedBeforeRun);
  s.runs.delete(s.key(p, 'one'));
  await page.evaluate(async () => { await loadState(project().id, { force:true }); refreshLine(); });
  await page.evaluate(() => document.documentElement.dataset.mode = 'dark');
  await page.screenshot({ path:path.join(shots, 'paste-dark.png') });
  await context.close();
  const touch = await browser.newContext({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true, reducedMotion:'reduce' });
  const mobile = await touch.newPage(); mobile.on('pageerror', error => errors.push(error.message)); await mobile.goto(url);
  const touchPick = mobile.locator('.lp-ask.is-unsent .paste-pick'); await touchPick.tap();
  check('touch opens both options without horizontal overflow', await mobile.getByRole('menuitem').count() === 2 && await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector('#menu').getBoundingClientRect().right <= innerWidth));
  await mobile.screenshot({ path:path.join(shots, 'paste-narrow.png') });
  const count = copied.length; await mobile.getByRole('menuitem', { name:'Paste without context', exact:true }).tap();
  await mobile.waitForSelector('.paste-split [data-act="unsent-plain"]');
  check('touch selects and pastes without context', copied.length === count + 1 && copied.at(-1) === 'Please review these changes');
  check('no browser errors', errors.length === 0);
  console.log(`${passed} browser checks passed; screenshots: ${shots}`);
})().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(async () => {
  await browser?.close(); api.close(); if (server?.listening) await new Promise(resolve => server.close(resolve)); fs.rmSync(temp, { recursive:true, force:true });
});
