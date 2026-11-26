"use strict";
// Controlled A/B: identical canonical adapters, with only shared coordination
// bypassed in the control. No real project or agent data is used.
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { performance } = require("node:perf_hooks");
const { Service } = require("../src/server/project-lines/service.js");
const agents = { available:() => [], list:() => [], get:() => null, has:() => false, defaultId:() => "" };
async function sample(shared) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-import-bench-")), directory = path.join(root, "state"), home = path.join(root, "home"), docs = path.join(root, "docs");
  fs.mkdirSync(directory);
  const s = new Service({ directory, agents, autoWatch:false, conversations:{ home } });
  const p = s.store.create({ name:"Benchmark", docsPath:docs }); p.followSince = 1;
  if (!shared) {
    s.conversations.shared.run = async (_p,_r,fn) => { await fn(); return true; };
    s.conversations.shared.writing = async (_p,fn) => fn();
    s.conversations.shared.reserve = (_p,rec,base,available) => { let slug=base,n=2; while(!available(slug))slug=`${base}-${n++}`; return rec.reservedSlug=slug; };
    s.conversations.shared.bind = () => {};
    s.store.nextId = project => { const id=`${project.prefix}-${project.seq++}`; s.store.save(); return id; };
  }
  const folder = path.join(home, ".claude/projects", fs.realpathSync(docs).replace(/[^A-Za-z0-9]/g,"-")); fs.mkdirSync(folder,{recursive:true});
  const row = i => JSON.stringify({type:"user",timestamp:"2026-11-17T10:00:00Z",cwd:docs,message:{role:"user",content:`Request ${i}`}})+"\n";
  try {
    for(let i=0;i<100;i++)fs.writeFileSync(path.join(folder,`${i}.jsonl`),row(i));
    let start=performance.now(); await s.conversations.tick(); const new100Ms=performance.now()-start;
    start=performance.now(); for(let i=0;i<100;i++)await s.conversations.tick(); const idle100Ms=performance.now()-start;
    const projectReads=[]; for(let i=0;i<30;i++){start=performance.now();s.stateOf(p);projectReads.push(performance.now()-start);}
    start=performance.now();for(let i=0;i<100;i++)s.store.nextId(p);const allocate100Ms=performance.now()-start;
    return { new100Ms,idle100Ms,stateMedianMs:projectReads.sort((a,b)=>a-b)[15],allocate100Ms };
  } finally {s.close();fs.rmSync(root,{recursive:true,force:true});}
}
(async()=>{const runs=[];for(let i=0;i<3;i++)for(const shared of i%2?[true,false]:[false,true])runs.push({shared,...await sample(shared)});const summary={};for(const shared of [false,true]){const rows=runs.filter(r=>r.shared===shared),out={};for(const key of Object.keys(rows[0]).filter(k=>k!=="shared"))out[key]=rows.map(r=>r[key]).sort((a,b)=>a-b)[1];summary[shared?"shared":"control"]=out;}console.log(JSON.stringify({method:"3 alternating samples; 100 conversations; 100 unchanged scans; 30 page-state reads; 100 ID allocations",summary,runs},null,2));})().catch(e=>{console.error(e);process.exitCode=1;});
