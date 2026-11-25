"use strict";
const fs=require("node:fs"),path=require("node:path"),{plan,apply}=require("../src/server/project-lines/import-repair.js");
const args=process.argv.slice(2),one=n=>args.find(a=>a.startsWith(`--${n}=`))?.slice(n.length+3),many=n=>args.filter(a=>a.startsWith(`--${n}=`)).map(a=>a.slice(n.length+3));
try{
 if(one("apply")){if(!args.includes("--importers-stopped"))throw Error("Stop all imports before applying; then pass --importers-stopped.");const r=JSON.parse(fs.readFileSync(one("apply"),"utf8"));console.log(JSON.stringify(apply(r,path.resolve(one("backup"))),null,2));}
 else {if(!one("docs")||!one("output")||!many("state").length)throw Error("Use --docs=<folder> --state=<app-state> [--state=<other-app-state>] --output=<plan.json>. Dry run only by default.");const r=plan(path.resolve(one("docs")),many("state").map(p=>path.resolve(p)));fs.writeFileSync(one("output"),JSON.stringify(r,null,2));console.log(JSON.stringify(r.pairs.map(({session,keep,gone,extraSteps,blocked})=>({session,keep,gone,extraSteps,blocked})),null,2));}
}catch(e){console.error(e.message);process.exitCode=1;}
