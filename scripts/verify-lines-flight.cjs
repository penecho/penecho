#!/usr/bin/env node
"use strict";
// Offline browser acceptance fixture for the real Home/line transition. No server or user data.
// node scripts/verify-lines-flight.cjs [/tmp/penecho-line-flight.html]
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { Service } = require("../src/server/project-lines/service.js");
const { createAgents } = require("../src/server/project-lines/agents.js");
const root = path.resolve(__dirname, ".."), output = process.argv[2] || "/tmp/penecho-line-flight.html";
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-flight-")), docs = path.join(temp, "docs");
let service;
try {
  fs.mkdirSync(path.join(docs, "lines"), { recursive:true });
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  for (const [slug, count] of [["short", 1], ["earlier", 5], ["long", 22]]) {
    fs.writeFileSync(path.join(docs, "lines", `${slug}.md`), `---\nid: flight-${slug}\nstatus: ready\ncreated: ${stamp}\nwho: @codex\n---\n\n# ${slug === "short" ? "A short line" : slug === "earlier" ? "Calmer All Lines design prototype" : "A long line with many earlier steps and a title that wraps on a phone"}\n\n` + Array.from({ length:count }, (_, i) => `## Ask · ${stamp}\n\nPlease refine part ${i + 1} of the design.\n\n## [x] Work ${i + 1} · @codex · 2 min\n\nUpdated the prototype with part ${i + 1}.\n\n`).join(""));
  }
  service = new Service({ directory:temp, agents:createAgents({ env:{ PATH:"" } }), autoWatch:false });
  const project = service.store.create({ name:"Line motion checks", docsPath:docs }); project.offerSkill = false;
  const state = service.stateOf(project), inline = s => s.replace(/<\/script/gi, "<\\/script");
  let html = fs.readFileSync(path.join(root, "public/projects.html"), "utf8")
    .replace(/<link[^>]*href="([^"]+\.css)"[^>]*>/g, (_, file) => `<style>${fs.readFileSync(path.join(root, "public", file), "utf8")}</style>`)
    .replace(/<script src="([^"]+)"><\/script>/g, (_, file) => `<script>${inline(fs.readFileSync(path.join(root, "public", file), "utf8").replace(file === "lines/main.js" ? /boot\(\);\s*$/ : /$^/, ""))}</script>`);
  const setup = `
api = async () => ({}); loadState = async () => false; loadProjects = async () => {}; loadDoc = async () => ({md:'The design is ready.'});
syncHash = () => {}; readOpenedLine = () => {}; poll = () => {}; pollActivity = () => {}; checkAgents = () => {}; loadDeskFiles = () => {};
const fixture = ${JSON.stringify(state)};
S.projects = [fixture.project]; S.cur = fixture.project.id; adoptState(fixture);
document.querySelector('#app').innerHTML = chromeHTML(); bindGlobal(); render();
const results = [], check = (name, ok, detail = '') => results.push((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ': ' + detail : ''));
const nativeRAF = window.requestAnimationFrame, nativeCancel = window.cancelAnimationFrame, nativeNow = performance.now.bind(performance), nativeMedia = window.matchMedia;
let clock = 0, queue = new Map(), serial = 0;
const manualRAF = fn => { queue.set(++serial,fn); return serial; };
window.requestAnimationFrame = manualRAF; window.cancelAnimationFrame = id => queue.delete(id);
performance.now = () => clock;
const tick = t => { clock = t; const jobs = [...queue.values()]; queue.clear(); jobs.forEach(fn => fn(t)); };
const settle = () => { tick(clock + 3000); endFlight(); };
const home = id => { settle(); go({view:'home'}); document.querySelector('.hl-row[data-row="'+id+'"]').scrollIntoView({block:'center'}); };
const inspect = (id, returning) => {
  home(id);
  const from = lineOnHome(id), first = Object.values(from.stops)[0];
  if (id !== 'short') check(id+' hidden nodes start on the track', Math.abs(from.first.y-first.y)<1, (from.first.y-first.y).toFixed(2)+' px');
  check(id+' connector starts on the track centre', Math.abs(from.fork.y-first.y)<.6, (from.fork.y-first.y).toFixed(2)+' px');
  go({view:'line',line:id});
  if (returning) { settle(); go({view:'home'}); }
  const label = id+(returning?' closing':' opening'), started = clock;
  tick(started);
  let svg = document.querySelector('.fly-layer');
  check(label+' overlay exists', !!svg);
  if (!svg) return;
  const children = [...svg.children], firstPath = svg.querySelector('path'), initial = firstPath.getAttribute('d');
  let sharpest = 0, folds = 0;
  for (const t of [0,16,32,64,100,180,260,360,450]) {
    tick(started+t);
    const paths = [...svg.querySelectorAll('path')];
    for (const p of paths) {
      const len = p.getTotalLength(), stride = 2;
      for (let d = stride; d < len-stride; d += stride) {
        const a = p.getPointAtLength(d-stride), b = p.getPointAtLength(d), c = p.getPointAtLength(d+stride);
        const u = {x:b.x-a.x,y:b.y-a.y}, v = {x:c.x-b.x,y:c.y-b.y};
        if (Math.hypot(u.x,u.y)>.1 && Math.hypot(v.x,v.y)>.1) {
          const angle = Math.acos(Math.max(-1,Math.min(1,(u.x*v.x+u.y*v.y)/Math.hypot(u.x,u.y)/Math.hypot(v.x,v.y))))*180/Math.PI;
          sharpest = Math.max(sharpest,angle);
        }
        if (u.x < -.2 || u.y < -.2) folds++;
      }
    }
  }
  check(label+' no abrupt corners', sharpest < 20, sharpest.toFixed(1)+' degrees per 2 px');
  check(label+' no backward folds', folds === 0, String(folds));
  check(label+' SVG nodes stay allocated', children.length === svg.children.length && children.every((n,i)=>n === svg.children[i]));
  check(label+' path changes during travel', firstPath.getAttribute('d') !== initial);
  settle();
  check(label+' cleans overlay and hidden destination', !document.querySelector('.fly-layer,.fly-ghost') && (returning ? getComputedStyle(document.querySelector('.hl-row[data-row="'+id+'"] .hl-track')).visibility : getComputedStyle(document.querySelector('#lpList')).visibility) === 'visible');
};
try {
  for (const id of ['short','earlier','long']) { inspect(id,false); inspect(id,true); }
  home('earlier'); go({view:'line',line:'earlier'}); tick(clock+150); go({view:'home'}); settle();
  check('quick reversal clears layers and hidden nodes', !document.querySelector('.fly-layer,.fly-ghost') && getComputedStyle(document.querySelector('.hl-row[data-row="earlier"] .hl-track')).visibility === 'visible');
  window.matchMedia = q => q.includes('prefers-reduced-motion') ? {matches:true} : nativeMedia(q); home('earlier'); go({view:'line',line:'earlier'});
  check('reduced motion opens without overlay', !!document.querySelector('#linePage') && !document.querySelector('.fly-layer'));
  go({view:'home'}); check('reduced motion closes without overlay', !document.querySelector('.fly-layer')); window.matchMedia = nativeMedia;
  check('Home fits the viewport', document.querySelector('#view').scrollWidth <= document.querySelector('#view').clientWidth);
} catch(e) { results.push('FAIL '+e.stack); }
settle(); home('earlier'); window.requestAnimationFrame = nativeRAF; window.cancelAnimationFrame = nativeCancel; performance.now = nativeNow;
const report = document.createElement('pre'); report.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:1000;background:white;color:#172034;font:12px/1.35 monospace;margin:0;padding:6px;max-height:80px;overflow:auto;border:2px solid '+(results.some(x=>x.startsWith('FAIL'))?'#b91c1c':'#15803d'); report.textContent=results.join('\\n'); document.body.append(report);
window.parent.postMessage({flightChecks:innerWidth,results},'*');
// The controls outside this iframe can pause the actual canonical transition for visual inspection.
addEventListener('message', e => {
  if (!e.data.flightPreview) return;
  endFlight(); queue.clear(); clock=0; window.requestAnimationFrame=manualRAF; window.cancelAnimationFrame=id=>queue.delete(id); performance.now=()=>clock;
  go({view:'home'}); document.querySelector('.hl-row[data-row="earlier"]').scrollIntoView({block:'center'});
  go({view:'line',line:'earlier'}); if(e.data.back){tick(2000);go({view:'home'});}
  tick(clock+e.data.at);
  document.getAnimations().forEach(a=>{a.pause(); a.currentTime=e.data.at;});
});`;
  html = html.replace("</body>", `<script>${inline(setup)}</script></body>`);
  const frame = width => `<h2>${width}px</h2><iframe width="${width}" height="900" srcdoc="${html.replace(/&/g,"&amp;").replace(/"/g,"&quot;")}"></iframe>`;
  fs.writeFileSync(output, `<!doctype html><meta charset="utf-8"><title>Line transition acceptance</title><style>body{font:14px system-ui;background:#edf0f4}pre{white-space:pre-wrap}button{padding:8px;margin:4px}iframe{display:block;border:1px solid #aab2c0}</style><h1>Canonical line transition checks</h1><details open><summary id="summary">Running…</summary><pre id="results"></pre></details><p>Freeze opening: ${[0,32,100,250,450].map(at=>`<button onclick="preview(${at},false)">${at} ms</button>`).join('')} Closing: ${[0,100,250,450].map(at=>`<button onclick="preview(${at},true)">${at} ms</button>`).join('')}</p>${frame(1440)}${frame(390)}<script>const reports=[];addEventListener('message',e=>{if(e.data.flightChecks){reports.push(e.data);document.querySelector('#results').textContent=reports.map(r=>r.flightChecks+'px\\n'+r.results.join('\\n')).join('\\n\\n');const all=reports.flatMap(r=>r.results);document.querySelector('#summary').textContent=all.filter(x=>x.startsWith('PASS')).length+' passed, '+all.filter(x=>x.startsWith('FAIL')).length+' failed ('+reports.length+' viewports)';}});function preview(at,back){document.querySelector('details').open=false;document.querySelectorAll('iframe').forEach(f=>f.contentWindow.postMessage({flightPreview:true,at,back},'*'));}</script>`);
  console.log(output);
} finally { service?.close?.(); fs.rmSync(temp, { recursive:true, force:true }); }
