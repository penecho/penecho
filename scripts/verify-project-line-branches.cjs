#!/usr/bin/env node
"use strict";
// Real-browser check of choosing a branch for a new line, on a real Git repository in a throwaway folder.
// PLAYWRIGHT_PATH=... node scripts/verify-project-line-branches.cjs [folder for screenshots]
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const { createProjectLines } = require('../src/server/project-lines/http.js');
const F = require('../src/server/project-lines/format.js');
const root = path.resolve(__dirname, '..'), temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'line-branches-browser-')));
const shots = path.resolve(process.argv[2] || path.join(temp, 'shots')); fs.mkdirSync(shots, { recursive:true });
let browser, server, passed = 0;
const wordsCopied = [], filesCopied = [];
const errors = [], check = (label, value, more = '') => { assert.ok(value, `${label} ${more}`); passed++; console.log(`ok ${label}`); };
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding:'utf8', stdio:['ignore', 'pipe', 'pipe'] }).trim();
function repo(name) {
  const dir = path.join(temp, name);
  fs.mkdirSync(dir, { recursive:true });
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'Test'); git(dir, 'config', 'user.email', 'test@example.com');
  fs.writeFileSync(path.join(dir, 'README.md'), 'hello\n');
  git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'first');
  return dir;
}
function onBranch(code, branch, name = branch.replace(/\W/g, '-')) {
  git(code, 'checkout', '-q', '-b', branch, 'main');
  fs.writeFileSync(path.join(code, `${name}.txt`), branch);
  git(code, 'add', '-A'); git(code, 'commit', '-q', '-m', branch);
  git(code, 'checkout', '-q', 'main');
}
const agents = { available:() => [{ id:'claude', name:'Claude', mono:'Cl', color:'#c2572f', available:true, app:'Claude', role:'Build' }, { id:'codex', name:'Codex', mono:'Co', color:'#333', available:true, app:'Codex', role:'Build' }, { id:'opencode', name:'OpenCode', mono:'Op', color:'#555', available:true, app:'OpenCode', role:'Build' }], command:() => null, desktop:() => null, nameOf:id => id, terminal:() => '' };
const api = createProjectLines({ directory:path.join(temp, 'state'), agents, serviceOptions:{ autoWatch:false }, isThisComputer:() => true, authorizeRead:() => null, authorizeWrite:() => null, readJson:async req => { let s = ''; for await (const b of req) s += b; return JSON.parse(s || '{}'); }, send:(res, status, data) => { res.writeHead(status, { 'content-type':'application/json' }); res.end(JSON.stringify(data)); } });
const s = api.service;
s.clipboard = async text => { wordsCopied.push(text); };
s.clipboardFiles = async files => { filesCopied.push(files); };
const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.svg':'image/svg+xml', '.webp':'image/webp' };
const finished = (title, created, branch) => F.initialLine({ title, id:title.replace(/\W/g, ''), status:'done', created, source:'Claude desktop', branch, base:'main', steps:[F.askStep({ words:title, via:'Claude desktop', when:created }), { ...F.workStep({ who:'claude' }), done:true, took:'1 min' }] });
function project(name, code, lines = []) {
  const p = s.store.create({ name, docsPath:path.join(temp, `docs-${name}`), codePath:code });
  p.follow = false; p.offerSkill = false; p.defaultAgent = 'claude'; s.store.save();
  for (const [slug, title, created, branch] of lines) s.writeDoc(p, slug, finished(title, created, branch));
  s.sync(p);
  return p;
}

(async () => {
  // Three projects: branches on the map and more in Git, only main, and a folder with no Git.
  const code = repo('code');
  onBranch(code, 'work/older'); onBranch(code, 'work/latest'); onBranch(code, 'work/not-on-the-map');
  for (let i = 0; i < 6; i++) onBranch(code, `extra/branch-${i}`);
  const branched = project('Branched', code, [['on-main', 'A question on main', '2026-11-01 09:00', ''], ['older-line', 'Older work', '2026-11-02 09:00', 'work/older'], ['latest-line', 'Latest work', '2026-11-03 09:00', 'work/latest']]);
  const onlyMain = project('OnlyMain', repo('only-main'), [['first', 'A first question', '2026-11-01 09:00', '']]);
  const plainFolder = path.join(temp, 'plain'); fs.mkdirSync(plainFolder); fs.writeFileSync(path.join(plainFolder, 'notes.md'), 'notes\n');
  const noGit = project('Plain folder', plainFolder, [['plain-line', 'Tidy the notes', '2026-11-01 09:00', '']]);
  // Lines on main stay newest in the file, and must not become the default.
  const later = Date.now() + 60000; fs.utimesSync(path.join(branched.docsPath, 'lines/on-main.md'), new Date(later), new Date(later));
  const older = Date.now() - 3600000; fs.utimesSync(path.join(branched.docsPath, 'lines/older-line.md'), new Date(older), new Date(older));

  server = http.createServer(async (req, res) => { const url = new URL(req.url, 'http://localhost'); if (await api.handle(req, res, url)) return; const file = path.resolve(root, 'public', `.${url.pathname}`); if (!file.startsWith(path.join(root, 'public') + path.sep) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type':mime[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ channel:'chrome' });
  const ctx = await browser.newContext({ viewport:{ width:1440, height:900 }, reducedMotion:'reduce', permissions:['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  const open = async p => { await page.goto(`${base}/projects.html#${p.id}`); await page.waitForFunction(id => window.__lines?.project()?.id === id && document.querySelector('.pano-sheet'), p.id); await page.waitForTimeout(250); };
  const chip = () => page.locator('.dock-wrap .box-branch').innerText().then(x => x.trim());
  const pick = selector => page.locator(`#menu ${selector}`).first().click();
  const shot = name => page.screenshot({ path:path.join(shots, `${name}.png`) });
  const back = async p => { await page.evaluate(id => window.__lines.go({ view:'home' }), p.id); await page.waitForSelector('.pano-sheet'); await page.waitForTimeout(200); };

  // ---------- The default ----------
  await open(branched);
  await shot('1-default');
  check('the default is the latest branch, not main', await chip() === 'work/latest', await chip());
  check('the box has no agent chip any more', await page.locator('.dock-wrap .pv-agent, .dock-wrap [data-act="cmp-agent"]').count() === 0);
  check('the map does not draw the line you are writing', await page.locator('.ghost-title, .ghost-dot, .ghost-line, #panoGhost').count() === 0);
  check('main and each unmerged branch offer New line', await page.locator('.new-line-on').count() === 3);
  const plain = await page.locator('.new-line-on[data-act="new-line-on"]').evaluateAll(bs => bs.map(b => { const s = getComputedStyle(b); return [b.classList.contains('on'), s.backgroundColor, s.color, s.borderTopColor].join(' '); }));
  check('every New line button looks the same, whichever branch the box is set to', new Set(plain).size === 1 && plain[0] === 'false rgb(255, 255, 255) rgb(100, 116, 139) rgba(31, 36, 45, 0.24)', plain.join(' / '));

  // ---------- New line on a branch ----------
  await page.locator('.bhead[data-branch="work/older"] .new-line-on').click();
  await page.waitForTimeout(150);
  check('New line on a branch sets the box', await chip() === 'work/older');
  check('and puts the cursor there', await page.evaluate(() => document.activeElement?.classList.contains('cmp-input')));
  check('the button stays as it was, filled in nowhere', await page.locator('.new-line-on.on').count() === 0);
  await page.keyboard.type('Fix the older thing');
  check('your words stay in the box and off the map', await page.locator('.ghost-title, .ghost-dot, .ghost-line, #panoGhost').count() === 0 && !(await page.locator('#panoSheet').innerText()).includes('Fix the older thing'));
  await shot('2-on-a-branch');

  // ---------- The menu ----------
  await page.locator('.dock-wrap .box-branch').click();
  await page.waitForSelector('#menu.branch-menu');
  await shot('3-menu');
  const menu = await page.locator('#menu').innerText();
  check('the menu offers new branches from main and from here', menu.includes('New branch from main') && menu.includes('New branch from work/older'));
  check('branches on the map come first, with their lines', /work\/latest[\s\S]*1 line[\s\S]*work\/older/.test(menu));
  check('then the rest from Git', menu.includes('work/not-on-the-map') && menu.includes('extra/branch-0'));
  check('main is the first row under the search box', await page.locator('#menu .branch-find + .branch-trunk').count() === 1);
  check('the branch chosen now is marked', await page.locator('#menu .branch-list button.on code').innerText() === 'work/older');
  const box = await page.locator('.dock-wrap .composer').boundingBox(), hold = await page.locator('#menu').boundingBox();
  check('it sits above the box, on screen', hold.y + hold.height <= box.y && hold.y >= 0 && hold.x >= 0 && hold.x + hold.width <= 1440);
  await page.keyboard.type('not-on');
  await page.waitForTimeout(60);
  check('finding narrows the list', await page.locator('#menu .branch-list button').count() === 1);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  check('Enter picks it, and nothing was sent', await chip() === 'work/not-on-the-map' && await page.locator('.dock-wrap .cmp-input').inputValue() === 'Fix the older thing');
  check('a branch with no lines stays off the map until one lands there', await page.locator('.bhead[data-branch="work/not-on-the-map"]').count() === 0);
  await shot('4-off-the-map');
  await page.locator('.dock-wrap .box-branch').click(); await page.waitForSelector('#menu.branch-menu');
  await page.keyboard.press('Escape');
  check('Escape closes the menu', await page.locator('#menu').count() === 0);

  // ---------- Sending to a branch ----------
  await page.locator('.dock-wrap .cmp-input').fill('Work on a branch with no folder');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#linePage');
  await page.waitForFunction(() => document.querySelector('.lp-meta .row-branch'));
  check('the new line is on that branch', (await page.locator('.lp-meta .row-branch').innerText()).includes('work/not-on-the-map'));
  check('it is Not sent', await page.locator('.unsent-box').count() === 1);
  await page.locator('[data-act="unsent-context"]').click();
  await page.waitForSelector('.unsent-hint');
  const onPage = await page.evaluate(() => window.__lines.S.route.line);
  const copied = await s.pasteUnsent(branched, onPage, { step:F.parseLine(s.readDoc(branched, onPage)).steps.find(F.isUnsent).id, context:true }, { local:false });
  check('what you paste names the branch and its folder', copied.text.includes(', on branch work/not-on-the-map.') && copied.branch === 'work/not-on-the-map');
  check('and the folder really is on that branch', git(copied.folder, 'symbolic-ref', '--short', 'HEAD') === 'work/not-on-the-map');
  await shot('5-line-page');
  await back(branched);
  check('after sending, the box goes back to the latest branch', await chip() === 'work/not-on-the-map', await chip());

  // ---------- Main, once ----------
  await page.locator('.trunk-head .new-line-on').click();
  await page.waitForTimeout(150);
  check('main is chosen on purpose, and says so', await chip() === 'main' && await page.locator('.cmp-warn').count() === 0);
  check('in amber', await page.locator('.box-branch.is-main').count() === 1);
  await shot('6-main');
  await page.locator('.dock-wrap .cmp-input').fill('A small fix straight on main');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#linePage');
  await page.waitForFunction(() => document.querySelector('.unsent-box'));
  check('a line on main has no branch', await page.locator('.lp-meta .row-branch').count() === 0);
  await back(branched);
  check('main is for that one line', await chip() !== 'main', await chip());

  // ---------- A new branch ----------
  const before = git(code, 'for-each-ref', '--format=%(refname:short)', 'refs/heads').split('\n').length;
  await page.locator('.dock-wrap .box-branch').click(); await page.waitForSelector('#menu.branch-menu');
  await pick('[data-new="main"]');
  await page.waitForTimeout(150);
  check('a new branch is dashed in the box', await chip() === 'New branch' && await page.locator('.box-branch.is-new').count() === 1);
  check('and the map stays as it was', await page.locator('.bhead[data-branch="new:box"], .ghost-title, .ghost-dot').count() === 0);
  await shot('7-new-branch');
  await page.locator('.dock-wrap .cmp-input').fill('Add dark mode to the map');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#linePage');
  await page.waitForFunction(() => document.querySelector('.lp-meta .row-branch.is-new'));
  const dark = await page.evaluate(() => window.__lines.S.route.line);
  check('the line waits for its branch', (await page.locator('.lp-meta .row-branch').innerText()).includes('New branch from main'));
  check('no branch has been made yet', git(code, 'for-each-ref', '--format=%(refname:short)', 'refs/heads').split('\n').length === before);
  await back(branched);
  check('it hangs under a label that says so', await page.locator(`.bhead[data-branch="new:${dark}"] code`).count() === 1);
  await shot('8-waiting-for-paste');
  await page.evaluate(line => window.__lines.go({ view:'line', line }), dark);
  await page.waitForSelector('#linePage .unsent-box');
  await page.locator('[data-act="unsent-context"]').click();
  await page.waitForFunction(() => document.querySelector('.lp-meta .row-branch:not(.is-new)'));
  check('Paste makes the branch', (await page.locator('.lp-meta .row-branch').innerText()).includes(`penecho/${dark}`));
  check('in Git as well', git(code, 'for-each-ref', '--format=%(refname:short)', `refs/heads/penecho/${dark}`) === `penecho/${dark}`);
  await back(branched);
  check('and it is now the latest', await chip() === `penecho/${dark}`, await chip());
  await shot('9-after-paste');
  check('the page does not scroll sideways', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

  // ---------- Only main ----------
  await open(onlyMain);
  check('with only main, the default is a new branch', await chip() === 'New branch');
  await page.locator('.dock-wrap .box-branch').click(); await page.waitForSelector('#menu.branch-menu');
  const small = await page.locator('#menu').innerText();
  check('the menu is short, with no search', await page.locator('#menu .branch-find').count() === 0 && small.includes('New branch from main') && small.includes('In your folder') && await page.locator('#menu .branch-list').count() === 0);
  await shot('10-only-main');
  await page.keyboard.press('Escape');

  // ---------- No Git ----------
  await open(noGit);
  check('no Git: no branch chip', await page.locator('.box-branch').count() === 0);
  check('no New line buttons', await page.locator('.new-line-on[data-act="new-line-on"]').count() === 0);
  check('no branch labels', await page.locator('.bhead').count() === 0);
  check('the line is named after the project, with no branch icon', (await page.locator('.trunk-label').innerText()).trim() === 'Plain folder' && await page.locator('.trunk-label svg').count() === 0);
  check('the map still draws nothing for the line you are writing', await page.locator('.ghost-title, .ghost-dot, .ghost-line, #panoGhost').count() === 0);
  await shot('11-no-git');
  await page.locator('[data-act="track-ask"]').click();
  await page.waitForSelector('.track-ask');
  check('Track changes asks first, and says what it does', (await page.locator('.track-ask').innerText()).includes('git init') && !fs.existsSync(path.join(plainFolder, '.git')));
  await shot('12-no-git-ask');
  await page.locator('[data-act="track-no"]').click();
  await page.waitForTimeout(80);
  check('Not now changes nothing', await page.locator('[data-act="track-ask"]').count() === 1 && !fs.existsSync(path.join(plainFolder, '.git')));
  await page.locator('[data-act="track-ask"]').click();
  await page.locator('[data-act="track-yes"]').click();
  await page.waitForSelector('.dock-wrap .box-branch');
  check('Track changes makes it a Git project, with main and a new branch by default', (await page.locator('.trunk-label').innerText()).trim() === 'main' && await chip() === 'New branch');
  check('with one first commit', git(plainFolder, 'rev-list', '--count', 'HEAD') === '1');
  await shot('13-tracked');

  // ---------- A picture goes with the words ----------
  const png = fs.readFileSync(path.join(root, 'public/penecho-mark.png'));
  const clipboardHolds = () => page.evaluate(async () => { const [item] = await navigator.clipboard.read(), text = item.types.includes('text/plain') ? await (await item.getType('text/plain')).text() : ''; return { types:[...item.types].sort(), text, size:item.types.includes('image/png') ? (await item.getType('image/png')).size : 0 }; });
  const askWithPicture = async (words, file = { name:'mark.png', mimeType:'image/png', buffer:png }) => {
    await open(branched);
    await page.locator('.dock-wrap [data-act="cmp-attach"]').evaluate(el => { window.__lines.S.pickFor = el.closest('.composer').dataset.comp; });
    await page.locator('#filePick').setInputFiles(file);
    await page.waitForSelector('.dock-wrap .cmp-file, .dock-wrap .cmp-files .t-pic, .dock-wrap [data-act="cmp-remove"]');
    await page.locator('.dock-wrap .cmp-input').fill(words);
    await page.keyboard.press('Enter');
    await page.waitForSelector('#linePage .unsent-box');
  };
  // Words and a picture never share a paste: Claude's and OpenCode's boxes keep only the picture, Codex's only the words.
  await askWithPicture('Fix what this picture shows');
  await page.evaluate(() => navigator.clipboard.writeText('nothing yet'));
  await page.locator('[data-act="unsent-context"]').click();
  await page.waitForSelector('[data-act="unsent-files"].unsent-go');
  let held = await clipboardHolds();
  check('with context no picture goes beside the words', held.types.join() === 'text/plain' && held.text === 'nothing yet', JSON.stringify(held));
  check('the words still name the picture', wordsCopied.at(-1).startsWith('Fix what this picture shows') && /Attached:\n.*mark\.png/.test(wordsCopied.at(-1)), wordsCopied.at(-1));
  check('and the picture is the next step', /then copy the picture\.$/.test(await page.locator('.unsent-hint > span').textContent()));
  check('nothing offers to put them together', await page.locator('[data-act="unsent-apart"]').count() === 0);
  await shot('15-paste-with-picture');
  await page.locator('[data-act="unsent-files"]').click();
  await page.waitForFunction(() => /Copied the picture/.test(document.querySelector('.unsent-hint > span')?.textContent || ''));
  check('that copies the file for its own paste', filesCopied.at(-1)?.[0]?.endsWith('mark.png'), JSON.stringify(filesCopied));
  for (const other of ['claude', 'codex', 'opencode']) {
    await askWithPicture(`Picture for ${other}`);
    await page.evaluate(id => { const { S, project, lineById } = window.__lines, l = lineById(project(), S.route.line); S.askFor = { ...(S.askFor || {}), [`${l.id}/${l.stations.find(x => x.unsent).id}`]:id }; }, other);
    await page.evaluate(() => navigator.clipboard.writeText('nothing yet'));
    await page.locator('[data-act="unsent-plain"]').click();
    await page.waitForSelector('[data-act="unsent-files"].unsent-go');
    held = await clipboardHolds();
    check(`${other} gets the words, with the picture as a second paste`, held.text === 'nothing yet' && wordsCopied.at(-1).startsWith(`Picture for ${other}`) && !wordsCopied.at(-1).includes('Read this first'), JSON.stringify(held));
    if (other === 'claude') await shot('16-paste-into-claude');
  }
  // Two pictures cannot share one paste, so they keep the second button.
  await open(branched);
  await page.locator('.dock-wrap [data-act="cmp-attach"]').evaluate(el => { window.__lines.S.pickFor = el.closest('.composer').dataset.comp; });
  await page.locator('#filePick').setInputFiles([{ name:'one.png', mimeType:'image/png', buffer:png }, { name:'two.png', mimeType:'image/png', buffer:png }]);
  await page.waitForFunction(() => document.querySelectorAll('.dock-wrap .cmp-files > *').length >= 2);
  await page.locator('.dock-wrap .cmp-input').fill('Two pictures');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#linePage .unsent-box');
  await page.evaluate(() => navigator.clipboard.writeText('nothing yet'));
  await page.locator('[data-act="unsent-plain"]').click();
  await page.waitForSelector('[data-act="unsent-files"].unsent-go');
  held = await clipboardHolds();
  check('two pictures stay a second paste, and the words are not lost', held.text === 'nothing yet' && wordsCopied.at(-1).startsWith('Two pictures') && /Copy 2 pictures/.test(await page.locator('[data-act="unsent-files"]').textContent()), JSON.stringify(held));

  // ---------- Narrow ----------
  await page.setViewportSize({ width:600, height:800 });
  await open(branched);
  check('on a narrow page the chip stays in the box', await page.evaluate(() => { const b = document.querySelector('.dock-wrap .composer').getBoundingClientRect(), c = document.querySelector('.box-branch').getBoundingClientRect(), s = document.querySelector('.send-btn').getBoundingClientRect(); return c.right <= s.left && c.left >= b.left && s.right <= b.right; }));
  check('and nothing scrolls sideways', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await shot('14-narrow');

  check('no browser errors', !errors.length, errors.join(' | '));
  console.log(`${passed} browser checks passed; screenshots: ${shots}`);
})().catch(e => { console.error(e.stack); process.exitCode = 1; }).finally(async () => { await browser?.close(); api.close(); if (server?.listening) await new Promise(r => server.close(r)); fs.rmSync(temp, { recursive:true, force:true }); });
