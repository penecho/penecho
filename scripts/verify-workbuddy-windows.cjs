#!/usr/bin/env node
"use strict";
// Runs against an installed package. Real history is read-only; all generated data is temporary.
// Usage: node verify-workbuddy-windows.cjs <package-root> <real-code-folder>
const fs=require("node:fs"),os=require("node:os"),path=require("node:path"),assert=require("node:assert/strict");
const root=path.resolve(process.argv[2]),code=process.argv[3];
const {Service}=require(path.join(root,"src/server/project-lines/service.js"));
const {createAgents}=require(path.join(root,"src/server/project-lines/agents.js"));
const temp=fs.mkdtempSync(path.join(os.tmpdir(),"penecho-workbuddy-acceptance-"));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check){const end=Date.now()+15000;while(Date.now()<end){if(check())return;await pause(100);}throw Error("WorkBuddy automatic monitoring timed out");}
function make(label,home=os.homedir(),autoWatch=false){
 const directory=path.join(temp,label);fs.mkdirSync(directory,{recursive:true});
 const service=new Service({directory,autoWatch,carryOn:false,agents:createAgents({env:{PATH:"",USERPROFILE:home,HOME:home}}),conversations:{home,env:{},idleMs:30,codex:{call:async()=>({data:[]})},opencode:{list:async()=>[]}}});
 service.conversations.fileAgents=service.conversations.fileAgents.filter(a=>a.agent==="workbuddy");return service;
}
function project(service,label,folder){const p=service.store.create({name:label,docsPath:path.join(temp,label+"-docs"),codePath:folder});Object.assign(p,{memorySkill:false,canvasSkill:false,offerSkill:false,autoWake:false});service.store.save();return p;}
let actual,watcher;
(async()=>{try{
 actual=make("real-state");const p=project(actual,"Real-history",code);
 const candidates=actual.conversations.recentFiles({project:p,roots:await actual.conversations.rootsOf(p)},0);
 assert.ok(candidates.length>=2,"find existing WorkBuddy conversations on Windows");
 const result=await actual.syncRecent(p);assert.ok(result.added>=2);assert.equal(result.warnings?.length||0,0);
 assert.ok(Object.values(actual.conversations.records).filter(r=>r.slug).every(r=>r.agent==="workbuddy"&&r.projectId===p.id));
 assert.equal((await actual.syncRecent(p)).added,0);
 console.log(JSON.stringify({realHistory:{found:candidates.length,imported:result.added,repeatAdded:0}}));actual.close();actual=null;
 const home=path.join(temp,"fixture-home"),folder=path.join(temp,"fixture_code");fs.mkdirSync(folder);
 watcher=make("watch-state",home,true);const watched=project(watcher,"Automatic-monitor",folder);
 const encoded=folder.replace(/^([a-z]):/i,"$1").replace(/[\\/]/g,"-");
 const logDir=path.join(home,".workbuddy","projects",encoded);fs.mkdirSync(logDir,{recursive:true});
 const log=path.join(logDir,"controlled-session.jsonl");
 const append=(text,role="user")=>fs.appendFileSync(log,JSON.stringify({id:Math.random().toString(16),sessionId:"controlled-session",cwd:folder,timestamp:Date.now(),type:"message",role,status:"completed",content:[{type:role==="user"?"input_text":"output_text",text}]})+"\n");
 append("Windows monitor first ask");append("Windows monitor first reply","assistant");
 await until(()=>watcher.store.scan(watched).topics.length===1);
 const slug=watcher.store.scan(watched).topics[0].slug;
 append("Windows monitor appended ask");append("Windows monitor appended reply","assistant");
 await until(()=>watcher.readDoc(watched,slug).includes("Windows monitor appended ask"));
 await until(()=>watcher.readDoc(watched,slug).includes("Windows monitor appended reply"));
 // Wait for the reader to finish before simulating a service restart.
 await until(()=>!watcher.conversations.busy);watcher.close();watcher=make("watch-state",home,true);
 const reopened=watcher.store.projects.find(p=>p.id===watched.id);
 await pause(3500);assert.equal(watcher.store.scan(reopened).topics.length,1);
 const text=watcher.readDoc(reopened,slug);assert.equal(text.split("Windows monitor appended ask").length-1,1);
 console.log(JSON.stringify({automaticMonitoring:{initial:true,append:true,restartNoDuplicate:true},liveNewWorkBuddyConversation:false}));
 console.log("PASS: Windows WorkBuddy real history and automatic incremental monitoring");
}finally{actual?.close();watcher?.close();await pause(250);fs.rmSync(temp,{recursive:true,force:true});}})().catch(e=>{console.error(e.stack);process.exitCode=1;});
