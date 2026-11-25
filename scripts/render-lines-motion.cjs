#!/usr/bin/env node
"use strict";
// A read-only, offline browser fixture using canonical page scripts/styles and the real folder parser.
// node scripts/render-lines-motion.cjs /path/to/seeded/docs /tmp/lines-motion.html
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { Service } = require("../src/server/project-lines/service.js");
const { createAgents } = require("../src/server/project-lines/agents.js");
const root = path.resolve(__dirname, ".."), output = process.argv[3] || "/tmp/penecho-lines-motion.html";
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-motion-fixture-"));
const docs = path.join(temp, "docs"); fs.cpSync(process.argv[2], docs, { recursive:true });
const service = new Service({ directory:temp, agents:createAgents({ env:{ PATH:"" } }), autoWatch:false });
const project = service.store.create({ name:"Drawing and motion verification", docsPath:docs });
project.offerSkill = false;
const state = service.stateOf(project), images = {};
for (const f of state.files) if (/\.png$/.test(f.path)) images[f.path] = "data:image/png;base64," + fs.readFileSync(path.join(docs, f.path)).toString("base64");
const inline = s => s.replace(/<\/script/gi, "<\\/script");
let html = fs.readFileSync(path.join(root, "public/projects.html"), "utf8")
  .replace(/<link[^>]*href="([^"]+\.css)"[^>]*>/g, (_, file) => `<style>${fs.readFileSync(path.join(root, "public", file), "utf8")}</style>`)
  .replace(/<script src="([^"]+)"><\/script>/g, (_, file) => `<script>${inline(fs.readFileSync(path.join(root, "public", file), "utf8").replace(file === "lines/main.js" ? /boot\(\);\s*$/ : /$^/, ""))}</script>`);
const setup = `
const fixtureState = ${JSON.stringify(state)}, fixtureImages = ${JSON.stringify(images)};
api = async () => ({}); loadState = async () => false; loadProjects = async () => {}; loadDoc = async () => ({md:'The complete garden plan is ready.'});
syncHash = () => {}; readOpenedLine = () => {}; poll = () => {}; pollActivity = () => {}; checkAgents = () => {};
assetUrl = (p, file) => fixtureImages[file] || ''; loadDeskFiles = () => {};
S.projects = [fixtureState.project]; S.cur = fixtureState.project.id; adoptState(fixtureState);
document.querySelector('#app').innerHTML = chromeHTML(); bindGlobal(); render();
const results = []; const check = (name, ok) => results.push((ok ? 'PASS ' : 'FAIL ') + name);
const pause = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const row = document.querySelector('.hl-row[data-row="garden"]'); row.scrollIntoView({block:'center'});
  const p = project(), geo = lineOnHome('garden'), track = row.querySelector('.hl-track'), curve = getComputedStyle(track, '::before');
  check('measured visible node geometry', Object.keys(geo?.stops || {}).length >= 2);
  check('branch meets the horizontal line', parseFloat(curve.left) + parseFloat(curve.width) >= 0);
  const title = row.querySelector('.hl-title'), lineHeight = parseFloat(getComputedStyle(title).lineHeight); check('a lane keeps a long title on one line', title.offsetHeight <= lineHeight + 1);
  row.querySelector('.hl-hit').click(); await pause(50);
  const img = row.querySelector('.hl-detail .st-pic img'); await img.decode();
  check('the opened lane shows the Canvas picture', getComputedStyle(img).objectFit === 'cover' && img.naturalWidth > 0);
  check('the picture is a button of its own', img.closest('button').dataset.act === 'home-picture' && !document.querySelector('button button'));
  row.querySelector('.hl-hit').click(); await pause(50);
  for (const r of document.querySelectorAll('.hl-row')) {
    const t = r.querySelector('.hl-track'), join = getComputedStyle(t, '::before'), last = [...t.querySelectorAll('.dm')].pop();
    check('line ends at its last mark', !last || !parseFloat(join.width) || Math.abs(t.getBoundingClientRect().left + parseFloat(join.left) + parseFloat(join.width) - centerOf(last).x) < 2);
  }
  go({view:'line',line:'garden'}, {from:row.querySelector('.hl-main')});
  check('opening moves the line', !!document.querySelector('.fly-layer'));
  check('opening moves the title', document.querySelector('#lpTitle').getAnimations().length > 0);
  await pause(850);
  go({view:'home'});
  check('return moves the line', !!document.querySelector('.fly-layer'));
  check('return moves the title', document.querySelector('.hl-row[data-row="garden"] .hl-title').getAnimations().length > 0);
  await pause(850);
  go({view:'line',line:'garden'}); go({view:'home'}); await pause(850);
  check('quick reversal cleans motion and visibility', !document.querySelector('.fly-layer,.fly-ghost') && getComputedStyle(document.querySelector('.hl-row[data-row="garden"] .hl-track')).visibility === 'visible');
  check('no horizontal overflow', document.querySelector('#view').scrollWidth <= document.querySelector('#view').clientWidth);
  const actualMedia = window.matchMedia; window.matchMedia = q => q.includes('prefers-reduced-motion') ? {matches:true} : actualMedia(q);
  go({view:'line',line:'garden'}); check('reduced motion opens with no flight', !document.querySelector('.fly-layer') && !!document.querySelector('#linePage')); go({view:'home'}); window.matchMedia = actualMedia;
  go({view:'home'}); await pause(850);
  document.querySelector('.hl-row[data-row="garden"] .hl-hit').click(); await pause(50);
  const preview = document.querySelector('.hl-row[data-row="garden"] .hl-detail .st-pic'); preview.focus(); check('the picture is keyboard focusable', document.activeElement === preview);
  document.querySelector('.hl-row[data-row="garden"] .hl-hit').click(); await pause(50);
  document.querySelector('.hl-row[data-row="garden"]').scrollIntoView({block:'center'});
})().catch(e => results.push('FAIL ' + e.stack)).finally(() => {
  const report = document.createElement('pre'); report.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:1000;background:white;color:#172034;font:12px/1.4 monospace;margin:0;padding:8px;max-height:135px;overflow:auto;border:2px solid ' + (results.some(x=>x.startsWith('FAIL')) ? '#b91c1c' : '#15803d');
  report.textContent = results.join('\\n'); document.body.append(report); window.parent.postMessage({fixture:true, results}, '*');
});`;
html = html.replace("</body>", `<script>${inline(setup)}</script></body>`);
const frame = (width, label) => `<h2>${label}</h2><iframe width="${width}" height="900" srcdoc="${html.replace(/&/g,"&amp;").replace(/"/g,"&quot;")}"></iframe>`;
fs.writeFileSync(output, `<!doctype html><meta charset="utf-8"><title>Drawing and motion checks</title><style>body{font:14px system-ui;background:#e9edf3}iframe{border:1px solid #aab2c0;display:block}pre{white-space:pre-wrap}</style><h1>Canonical Home and line: offline verification</h1><pre id="results">Running desktop and phone checks…</pre>${frame(1440,"Desktop · 1440 px")}${frame(390,"Phone · 390 px")}<script>const results=[];addEventListener('message', e=>{if(e.data.fixture){results.push(e.data.results);document.querySelector('#results').textContent=results.map((r,i)=>(i?'Phone or desktop':'Desktop or phone')+'\\n'+r.join('\\n')).join('\\n\\n');}});</script>`);
service.close?.(); fs.rmSync(temp, { recursive:true, force:true }); console.log(output);
