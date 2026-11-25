"use strict";
require("./helpers/safety.js");
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),os=require("node:os");
const F=require("../src/server/project-lines/format.js"),Repair=require("../src/server/project-lines/import-repair.js"),{Service}=require("../src/server/project-lines/service.js");
const agents={available:()=>[],list:()=>[],get:()=>null,has:()=>false,defaultId:()=>""};
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"penecho-import-repair-")),docs=path.join(root,"docs"),states=[path.join(root,"one"),path.join(root,"two")];states.forEach(p=>fs.mkdirSync(p));
 const services=states.map(directory=>new Service({directory,agents,autoWatch:false,conversations:{home:path.join(root,"home")}}));
 const projects=[services[0].store.create({name:"Repair",docsPath:docs})];projects.push(services[1].store.importFolder({docsPath:docs}));
 const steps=[F.askStep({words:"First request",when:"2026-11-17 10:00"}),F.workStep({who:"claude",done:true,body:"Done"})];
 const kept=F.initialLine({title:"Kept",id:"R-1",status:"done",steps:[...steps,F.askStep({words:"Later request"}),F.workStep({who:"claude",done:true,body:"Later done"})]});
 const gone=F.initialLine({title:"Copy",id:"R-2",status:"done",steps:[...steps,F.askStep({words:"A distinct unsent Ask",via:F.NOT_SENT})]});
 services[0].writeDoc(projects[0],"kept",kept);services[0].writeDoc(projects[0],"copy",gone);
 for(const slug of["kept","copy"]){fs.mkdirSync(path.join(docs,"works",slug),{recursive:true});fs.writeFileSync(path.join(docs,"works",slug,"work-1.md"),`---\nline: ../../lines/${slug}.md\nstep: Work 1\nstarted: 2026-11-17 10:00\n${slug==="copy"?"reviewed: 2026-11-17 11:00\n":""}---\n\n## Result\n\nThe same completed result.\n`);}
 fs.mkdirSync(path.join(docs,"files/copy"),{recursive:true});fs.writeFileSync(path.join(docs,"files/copy/picture.png"),"preserved bytes");
 states.forEach((state,i)=>{const slug=i?"copy":"kept",rec={agent:"claude",id:"same",projectId:projects[i].id,slug,stepId:"work-1",appStep:"work-1",offset:100,size:100,doneTurns:{},lastSay:"The same completed result."};fs.writeFileSync(path.join(state,"conversations.json"),JSON.stringify({"claude:same":rec}));fs.writeFileSync(path.join(state,"sessions.json"),JSON.stringify({[`${projects[i].id}/${slug}`]:{claude:{id:"same",workId:"work-1"}}}));});
 t.after(()=>{services.forEach(s=>s.close());fs.rmSync(root,{recursive:true,force:true});});return{root,docs,states,services,projects};
}
test("repair preserves later work, distinct unsent Asks, review state and all attachments",t=>{
 const f=fixture(t),p=Repair.plan(f.docs,f.states);assert.equal(p.pairs.length,1);assert.equal(p.pairs[0].blocked,"");
 const r=Repair.apply(p,path.join(f.root,"backup"));assert.equal(r.extraSteps,1);
 const kept=F.parseLine(fs.readFileSync(path.join(f.docs,"lines/kept.md"),"utf8"));assert.equal(kept.asks.length,3);assert.equal(kept.steps.filter(s=>s.kind==="work").length,2);assert.equal(kept.asks[2].via,F.NOT_SENT);
 assert.match(fs.readFileSync(path.join(f.docs,"works/kept/work-1.md"),"utf8"),/reviewed: 2026-11-17 11:00/);
 assert.equal(fs.readFileSync(path.join(f.docs,"archive/files/copy/picture.png"),"utf8"),"preserved bytes");assert.ok(!fs.existsSync(path.join(f.docs,"lines/copy.md")));
 assert.ok(fs.existsSync(path.join(f.root,"backup/lines/copy.md")));
 const fresh=new Service({directory:f.states[1],agents,autoWatch:false,conversations:{home:path.join(f.root,"home")}});
 assert.equal(fresh.conversations.records["claude:same"].slug,"kept");assert.ok(fresh.sessions[`${f.projects[1].id}/kept`]);assert.ok(!fresh.sessions[`${f.projects[1].id}/copy`]);fresh.close();
});
test("repair refuses a stale plan before changing any history",t=>{
 const f=fixture(t),p=Repair.plan(f.docs,f.states);fs.appendFileSync(path.join(f.docs,"lines/kept.md"),"\nNew words\n");
 assert.throws(()=>Repair.apply(p,path.join(f.root,"backup")),/changed since/);assert.ok(fs.existsSync(path.join(f.docs,"lines/copy.md")));
});
test("a genuinely different completed Work is preserved and flagged for a reviewed merge",t=>{
 const f=fixture(t);fs.appendFileSync(path.join(f.docs,"works/copy/work-1.md"),"\nA different outcome.\n");const p=Repair.plan(f.docs,f.states);assert.match(p.pairs[0].blocked,/Distinct Work/);assert.throws(()=>Repair.apply(p,path.join(f.root,"backup")),/Distinct Work/);
});
test("fixed-code startup resumes only the import preference paused for this repair",t=>{
 const f=fixture(t),state=f.states[1],project=f.projects[1];f.services[1].store.update(project.id,{follow:false});
 const hash=require("node:crypto").createHash("sha256").update(state).digest("hex"),file=path.join(f.docs,".penecho/imports/resume",hash+".json");fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify({projectId:project.id,follow:true}));
 const fresh=new Service({directory:state,agents,autoWatch:false,conversations:{home:path.join(f.root,"home")}});assert.equal(fresh.store.get(project.id).follow,false,"a passive reader leaves the pause intact");fresh.startRuntime({recoverOnStart:false});assert.equal(fresh.store.get(project.id).follow,true);assert.ok(!fs.existsSync(file));fresh.close();
});
