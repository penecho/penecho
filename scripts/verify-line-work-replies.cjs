"use strict";
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), http = require("node:http");
const assert = require("node:assert/strict");
const { callBrowser } = require("../src/server/project-lines/browser-call.js");
const { createProjectLines } = require("../src/server/project-lines/http.js");
const F = require("../src/server/project-lines/format.js");
const root = path.resolve(__dirname, ".."), temp = fs.mkdtempSync(path.join(os.tmpdir(), "line-work-replies-"));
const agents = { available:() => [], nameOf:id => id, desktop:() => null, terminal:() => "" };
const api = createProjectLines({ directory:path.join(temp, "state"), agents, serviceOptions:{ autoWatch:false, memory:{ home:path.join(temp, "home"), env:{} } }, isThisComputer:() => true, authorizeRead:() => null, authorizeWrite:() => null,
  readJson:async req => { let body = ""; for await (const chunk of req) body += chunk; return JSON.parse(body || "{}"); },
  send:(res, status, data) => { res.writeHead(status, { "content-type":"application/json" }); res.end(JSON.stringify(data)); } });
const s = api.service, p = s.store.create({ name:"Work replies", docsPath:path.join(temp, "docs") });
p.follow = false; p.offerSkill = false; s.store.save();
s.writeDoc(p, "safe", F.initialLine({ title:"Reply check", status:"waiting", steps:[
  F.askStep({words:"Review the options"}), F.workStep({who:"claude",done:true}), F.workStep({who:"codex",done:true})
] }));
s.store.writeText(p, F.detailPath('safe','work-2'), '## Questions for you\n\n**Ship now?**\n- [ ] Yes\n- [ ] No\n');
s.sync(p);
let server;
const mime = { ".html":"text/html", ".js":"text/javascript", ".css":"text/css", ".png":"image/png", ".svg":"image/svg+xml", ".webp":"image/webp" };
(async () => {
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (await api.handle(req, res, url)) return;
    const file = path.resolve(root, "public", `.${url.pathname}`);
    if (!file.startsWith(path.join(root, "public") + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type":mime[path.extname(file)] || "application/octet-stream" }); fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const url = `http://127.0.0.1:${server.address().port}/projects.html#${p.id}/line/safe`;
  for (const [viewport, pop] of [['420x800', false], ['1500x900', true]]) {
    const evaluate = expression => ({op:'eval',expression});
    const inspect = async body => { const response=await callBrowser({body:{screenshot:false,...body}}); const data=JSON.parse(response.text); assert.equal(response.status,200,JSON.stringify(data).slice(0,1400)); return data; };
    const opened=await inspect({url,viewport,waitUntil:'domcontentloaded',settleMs:700,keepSession:true});
    const sessionId=opened.sessionId;
    try {
      assert.ok(opened.text.includes('Reply check'), JSON.stringify([opened.text,opened.errors]).slice(0,1600));
      const steps=[
      evaluate(`(()=>{const line=lineById(project(),'safe'); const html=answerButton({...line,asking:{kind:'tool',step:'work-2',agent:'codex',answerable:true},conversations:{codex:{canOpen:true}}});return html.includes('need-reply') && !html.includes('open-desktop');})()`),
      evaluate(`ACT['need-reply']({dataset:{line:'safe'}});go({view:'line',line:'safe',step:'work-1'});true`), {op:'wait',ms:350},
      evaluate(`S.route.step === 'work-1' && !document.activeElement.closest('.q-card[data-step="work-2"]')`),
      evaluate(`ACT['need-reply']({dataset:{line:'safe'}}); true`), {op:'wait',ms:500},
      evaluate(`(async () => {const panel=document.querySelector('#lpPanel'); const card=panel.querySelector('.q-card[data-step="work-2"]'); if (!card || document.querySelector('#lpThread .q-card')) throw Error('Wrong chooser owner'); if (${pop}) { setPanelPopped(true); if (!S.panelPopped) throw Error('Popout did not open'); } const choice=card.querySelector('.q-choice');choice.focus(); await fillPanel(project(),lineById(project(),'safe'),stationById(lineById(project(),'safe'),'work-2')); if(document.activeElement !== choice) throw Error('Polling replaced focus');return true;})()`),
      {op:'press',key:'ArrowDown'}, evaluate(`document.activeElement.textContent.trim() === 'No'`),
      evaluate(`(async()=>{ const line=lineById(project(),'safe'), work=stationById(line,'work-2'); work.questions=[]; work.questionRev='changed';work.waitingReply=false; await fillPanel(project(),line,work); return !document.querySelector('#lpPanel .q-choice'); })()`),
      evaluate(`go({view:'line',line:'safe'}); true`), {op:'wait',ms:300},
      {op:'fill',selector:'.composer .cmp-input',text:`Keyboard draft ${viewport}`},{op:'press',selector:'.composer .cmp-input',key:'Enter'},{op:'wait',ms:500}
      ];
      for(const step of steps) { const result=await inspect({sessionId,steps:[step]}); if(step.op==='eval') assert.equal(result.steps[0].result,true,JSON.stringify(result.steps[0])); }
    } finally { await inspect({action:'close',sessionId}); }
    assert.ok(F.parseLine(s.readDoc(p,'safe')).steps.some(step=>F.isUnsent(step) && step.text==='Keyboard draft '+viewport),'Enter saves an unsent Ask with zero available agents');
    console.log('PASS',viewport,pop?'popout':'narrow','keyboard, focus, polling, removal, unsent Ask');
  }
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{server?.closeAllConnections();server?.close();await s.close();fs.rmSync(temp,{recursive:true,force:true});});
