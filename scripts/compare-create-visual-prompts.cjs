#!/usr/bin/env node
'use strict';
// Timed prompt comparison for the Create visual suggestion. Sends real Canvas AI requests through a
// running local PenEcho server (which owns provider credentials) and saves each result with its
// latency and output tokens, read from the server's request trace.
//
//   node scripts/compare-create-visual-prompts.cjs --cases=<dir> --variants=<variants.json> \
//     --output=<dir> [--server=http://localhost:3921] [--connection=hosted:<model id>] \
//     [--effort=high] [--only=a,b] [--case=x,y] [--concurrency=2] [--repeat=1]
//
// Each case is <name>.png (the handwritten request) with an optional <name>.json carrying the
// recorded atlasSize, sourceRect, imageScale, changedBox, visibleRect and captureRect.
// variants.json maps a name to {"suggestion":"create_visual"} (the maintained prompt) or
// {"focus":"..."} (a candidate focus sent as the typed instruction for the same Plot action).
// Concurrency above 2 provoked upstream 504s and stream resets during the 2026-10-06 comparison.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const args = Object.fromEntries(process.argv.slice(2).map(value => { const i = value.indexOf('='); return i < 0 ? [value.slice(2), true] : [value.slice(2, i), value.slice(i + 1)]; }));
const server = new URL(args.server || 'http://localhost:3921'), output = path.resolve(args.output), casesDir = path.resolve(args.cases);
const variants = JSON.parse(fs.readFileSync(path.resolve(args.variants), 'utf8')), names = args.only ? args.only.split(',') : Object.keys(variants);
const cases = fs.readdirSync(casesDir).filter(name => name.endsWith('.png')).map(name => name.slice(0, -4)).filter(name => !args.case || args.case.split(',').includes(name));
const effort = args.effort || 'high', repeat = Number(args.repeat || 1);
const PERSONA = 'Minimal, well-organized general-purpose studio assistant. Prioritize clear structure, legible formatting, concise step-by-step reasoning, and practical actionable answers. Keep visual output clean and uncluttered; avoid decorative flourishes.';
const PLUGINS = { general:{ name:'General HTML', version:'1', recommendedRefreshSeconds:60 }, flowchart:{ name:'Professional Diagrams', version:'2', recommendedRefreshSeconds:86400 } };
const TRACE_DIR = path.join(process.env.PENECHO_STATE_DIR || path.join(os.homedir(), '.penecho'), 'logs', 'requests');

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
    const document = (await (await fetch(new URL(`/plugins/${id}/plugin.md`, server), { headers:headers(token, 'create-visual-compare') })).text()).trimEnd();
    list.push({ id, name:meta.name, version:meta.version, connect:[], recommendedRefreshSeconds:meta.recommendedRefreshSeconds, document });
  }
  return list;
}
function geometry(name, bytes) {
  const file = path.join(casesDir, `${name}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const w = bytes.readUInt32BE(16), h = bytes.readUInt32BE(20), sourceRect = { x:9000, y:9000, w, h }, view = { x:8000, y:8400, w:4400, h:2600 };
  return { atlasSize:{ w, h }, sourceRect, imageScale:1, changedBox:{ x:9100, y:9100, w:w - 200, h:180 }, visibleRect:view, captureRect:{ ...view } };
}
function payload(name, variant, pluginList) {
  const bytes = fs.readFileSync(path.join(casesDir, `${name}.png`)), g = geometry(name, bytes), source = g.sourceRect;
  const instruction = variant.focus && `Suggestion chosen by the user for the handwritten request in latestInput.imageRect (this typed text is the action, not the subject): ${variant.focus}`;
  if (instruction && instruction.length > 2000) throw new Error(`Typed candidate prompts are limited to 2000 characters (${variant.focus.length}).`);
  return { atlasImage:`data:image/png;base64,${bytes.toString('base64')}`, atlasSize:g.atlasSize, imageScale:g.imageScale, changedBox:g.changedBox,
    visibleRect:g.visibleRect, captureRect:g.captureRect, sourceRect:source, focusInset:null,
    hotspotGrid:{ columns:8, rows:8, order:'oldest-to-newest', hotspots:[] }, trigger:'manual', userAction:'plot', reasoningEffort:effort,
    plugins:pluginList, canvasSize:{ w:20000, h:20000 }, uiTheme:'studio', persona:PERSONA,
    ...(instruction ? { typedInput:{ text:instruction, box:{ x:Math.ceil(source.x), y:Math.ceil(source.y), w:Math.min(240, Math.floor(source.w)), h:40 } } }
      : { suggestion:variant.suggestion || 'create_visual' }) };
}
function attempts(requestId) {
  try {
    const directory = fs.readdirSync(TRACE_DIR).find(name => name.endsWith(requestId));
    const trace = JSON.parse(fs.readFileSync(path.join(TRACE_DIR, directory, 'trace.json'), 'utf8'));
    return trace.attempts.map(attempt => { const usage = attempt.response?.upstream?.usage || {};
      return { ms:Date.parse(attempt.completedAt) - Date.parse(attempt.startedAt), outputTokens:usage.output_tokens ?? usage.completion_tokens ?? null }; });
  } catch { return null; }
}
async function run(token, pluginList, name, caseName, rep) {
  const directory = path.join(output, name, repeat > 1 ? `${caseName}-r${rep}` : caseName), started = Date.now();
  fs.mkdirSync(directory, { recursive:true });
  const response = await fetch(new URL('/api/ai/command', server), { method:'POST', headers:headers(token, `create-visual-compare-${name}-${caseName}-${rep}`),
    body:JSON.stringify(payload(caseName, variants[name], pluginList)) });
  let terminal = null;
  for (const line of (await response.text()).split('\n')) {
    if (!line.trim()) continue;
    try { const event = JSON.parse(line); if (event.type === 'result' || event.type === 'error' || !event.type) terminal = event.type ? event : { type:'result', data:event }; } catch {}
  }
  const data = terminal?.data || {}, command = (data.commands || []).find(item => item.tool === 'html_widget' && item.html);
  fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify(data, null, 1));
  if (command) fs.writeFileSync(path.join(directory, 'visual.html'), command.html);
  const report = { variant:name, case:caseName, rep, effort, status:terminal?.status ?? response.status, requestId:data.requestId, elapsedMs:Date.now() - started,
    observedText:data.observedText, tools:(data.commands || []).map(item => item.tool + (item.sourceFormat ? `:${item.sourceFormat}` : '')),
    attempts:data.requestId ? attempts(data.requestId) : null, error:data.error || terminal?.error || null };
  fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
  return report;
}
(async () => {
  const token = await session(), pluginList = await plugins(token), jobs = [];
  for (let rep = 1; rep <= repeat; rep++) for (const caseName of cases) for (const name of names) jobs.push([name, caseName, rep]);
  const limit = Number(args.concurrency || 2);
  let next = 0;
  await Promise.all(Array.from({ length:Math.min(limit, jobs.length) }, async () => {
    while (next < jobs.length) {
      const [name, caseName, rep] = jobs[next++];
      const report = await run(token, pluginList, name, caseName, rep).catch(error => ({ variant:name, case:caseName, rep, error:error.message }));
      console.log(JSON.stringify(report));
    }
  }));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
