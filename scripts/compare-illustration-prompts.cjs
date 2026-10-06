#!/usr/bin/env node
'use strict';
// Rendered prompt comparison for the sketch-illustration suggestion (Storybook / 3D).
// Sends real Canvas AI requests through a running local PenEcho server, exactly like the
// Canvas does, and saves each returned html_widget. The server owns provider credentials.
//
//   node scripts/compare-illustration-prompts.cjs --cases=<dir of PNG drawings> \
//     --variants=<variants.json> --output=<dir> [--server=http://localhost:3921] \
//     [--connection=hosted:<model id>] [--only=a,b] [--case=x,y] [--concurrency=4] [--render]
//
// variants.json maps a name to {"style":"storybook","background":"auto"} (the maintained
// suggestion, sent as suggestion "vivid") or {"prompt":"..."} (a candidate prompt of at most
// 2000 characters, sent as the user's typed request for the same Plot action).
const fs = require('node:fs'), path = require('node:path');
const args = Object.fromEntries(process.argv.slice(2).map(value => { const i = value.indexOf('='); return i < 0 ? [value.slice(2), true] : [value.slice(2, i), value.slice(i + 1)]; }));
const server = new URL(args.server || 'http://localhost:3921'), output = path.resolve(args.output), casesDir = path.resolve(args.cases);
const variants = JSON.parse(fs.readFileSync(path.resolve(args.variants), 'utf8')), names = args.only ? args.only.split(',') : Object.keys(variants);
const cases = fs.readdirSync(casesDir).filter(name => name.endsWith('.png') && (!args.case || args.case.split(',').includes(name.slice(0, -4))));
const PERSONA = 'Minimal, well-organized general-purpose studio assistant. Prioritize clear structure, legible formatting, concise step-by-step reasoning, and practical actionable answers. Keep visual output clean and uncluttered; avoid decorative flourishes.';
const PLUGINS = { general:{ name:'General HTML', version:'1', recommendedRefreshSeconds:60 }, flowchart:{ name:'Professional Diagrams', version:'2', recommendedRefreshSeconds:86400 } };

async function session() {
  // The page receives its local access session from the same server.
  const config = await (await fetch(new URL('/api/config.js', server))).text();
  return /"accessSessionToken":"([^"]*)"/.exec(config)?.[1] || '';
}
function headers(token, client) {
  return { 'content-type':'application/json', accept:'application/x-ndjson, application/json', origin:server.origin,
    'x-penecho-client':client, 'x-penecho-session':token, ...(args.connection ? { 'x-penecho-connection':args.connection } : {}) };
}
async function plugins(token) {
  const list = [];
  for (const [id, meta] of Object.entries(PLUGINS)) {
    const document = (await (await fetch(new URL(`/plugins/${id}/plugin.md`, server), { headers:headers(token, 'illustration-compare') })).text()).trimEnd();
    list.push({ id, name:meta.name, version:meta.version, connect:[], recommendedRefreshSeconds:meta.recommendedRefreshSeconds, document });
  }
  return list;
}
function payload(bytes, variant, pluginList) {
  const w = bytes.readUInt32BE(16), h = bytes.readUInt32BE(20), source = { x:1000, y:1000, w, h };
  if (variant.prompt && variant.prompt.length > 2000) throw new Error('Typed candidate prompts are limited to 2000 characters.');
  return { atlasImage:`data:image/png;base64,${bytes.toString('base64')}`, atlasSize:{ w, h }, imageScale:1, changedBox:{ ...source },
    visibleRect:{ x:500, y:500, w:3000, h:2200 }, captureRect:{ ...source }, sourceRect:{ ...source }, focusInset:null,
    hotspotGrid:{ columns:8, rows:8, order:'oldest-to-newest', hotspots:[] }, trigger:'manual', userAction:'plot', reasoningEffort:'medium',
    animationEnabled:true, plugins:pluginList, canvasSize:{ w:20000, h:20000 }, uiTheme:'studio', persona:PERSONA,
    ...(variant.prompt ? { typedInput:{ text:variant.prompt, box:{ x:source.x, y:source.y, w:Math.min(240, w), h:40 } } }
      : { suggestion:'vivid', illustrationStyle:variant.style || 'storybook', illustrationBackground:variant.background || 'auto' }) };
}
async function run(token, pluginList, name, caseName) {
  const directory = path.join(output, name, caseName.slice(0, -4)), started = Date.now();
  fs.mkdirSync(directory, { recursive:true });
  const response = await fetch(new URL('/api/ai/command', server), { method:'POST', headers:headers(token, `illustration-compare-${name}-${caseName}`),
    body:JSON.stringify(payload(fs.readFileSync(path.join(casesDir, caseName)), variants[name], pluginList)) });
  let terminal = null;
  for (const line of (await response.text()).split('\n')) {
    if (!line.trim()) continue;
    try { const event = JSON.parse(line); if (event.type === 'result' || event.type === 'error' || !event.type) terminal = event.type ? event : { type:'result', data:event }; } catch {}
  }
  const data = terminal?.data || {}, command = (data.commands || []).find(item => item.tool === 'html_widget' && item.html);
  if (command) fs.writeFileSync(path.join(directory, 'illustration.html'), command.html);
  const report = { variant:name, case:caseName, status:terminal?.status ?? response.status, requestId:data.requestId, elapsedMs:Date.now() - started,
    tools:(data.commands || []).map(item => item.tool), widget:command ? { w:command.w, h:command.h, title:command.title } : null, error:data.error || null };
  fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
  return report;
}
async function render() {
  const { chromium } = require(process.env.PENECHO_PLAYWRIGHT || 'playwright');
  const browser = await chromium.launch();
  try {
    for (const name of names) for (const caseName of cases) {
      const directory = path.join(output, name, caseName.slice(0, -4)), file = path.join(directory, 'illustration.html');
      if (!fs.existsSync(file)) continue;
      const report = JSON.parse(fs.readFileSync(path.join(directory, 'report.json'), 'utf8')), w = report.widget?.w || 720, h = report.widget?.h || 540, scale = Math.min(720 / w, 540 / h);
      const page = await browser.newPage({ viewport:{ width:Math.round(w * scale), height:Math.round(h * scale) }, deviceScaleFactor:1.5 });
      await page.route(/^https?:\/\//, route => route.abort());
      await page.setContent(fs.readFileSync(file, 'utf8'), { waitUntil:'load' });
      await page.screenshot({ path:path.join(directory, 'render.png') });
      await page.close();
    }
  } finally { await browser.close(); }
}
(async () => {
  const token = await session(), pluginList = await plugins(token);
  const jobs = names.flatMap(name => cases.map(caseName => [name, caseName])), limit = Number(args.concurrency || 4);
  let next = 0;
  await Promise.all(Array.from({ length:Math.min(limit, jobs.length) }, async () => {
    while (next < jobs.length) {
      const [name, caseName] = jobs[next++];
      const report = await run(token, pluginList, name, caseName).catch(error => ({ variant:name, case:caseName, error:error.message }));
      console.log(JSON.stringify(report));
    }
  }));
  if (args.render) await render();
})().catch(error => { console.error(error.message); process.exitCode = 1; });
