#!/usr/bin/env node
"use strict";
const {spawn,execFileSync}=require("node:child_process"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),assert=require("node:assert/strict");
const root=path.resolve(process.argv[2]),state=fs.mkdtempSync(path.join(os.tmpdir(),"penecho-bundle-smoke-"));
const env={...process.env,PATH:path.join(process.env.SystemRoot,"System32"),PENECHO_STATE_DIR:state,PENECHO_CLOUD_STATE_DIR:path.join(state,"cloud"),PENECHO_SKIP_UPDATE_CHECK:"1",HOST:"127.0.0.1"};
const launcher=path.join(root,"penecho.cmd"),node=path.join(root,"runtime","node.exe"),app=path.join(root,"app");
console.log("Bundled launcher version:",execFileSync(process.env.ComSpec||"cmd.exe",["/d","/s","/c",`"${launcher}" --version`],{env,encoding:"utf8",windowsVerbatimArguments:true}).trim());
const child=spawn(node,[path.join(app,"cli.js"),"--config",path.join(state,"empty.env"),"--port","0"],{env,cwd:state,stdio:["ignore","pipe","pipe"]});
let output="",begun=false,passed=false;
const timer=setTimeout(()=>finish(Error("Startup timeout: "+output)),45000);
function finish(error){clearTimeout(timer);passed=!error;child.kill();if(error){console.error(error.message);process.exitCode=1;}}
child.stderr.on("data",x=>{output+=x;});
child.stdout.on("data",async x=>{output+=x;const m=output.match(/PenEcho: (http:\/\/127\.0\.0\.1:\d+)/);if(!m||begun)return;begun=true;try{for(const route of ["/","/projects.html","/lines/main.js","/app.js"]){const r=await fetch(m[1]+route);assert.equal(r.status,200);assert.ok((await r.text()).length);}
await require(path.join(app,"node_modules","sharp"))({create:{width:2,height:2,channels:3,background:"white"}}).png().toBuffer();finish();}catch(error){finish(error);}});
child.on("exit",()=>{clearTimeout(timer);fs.rmSync(state,{recursive:true,force:true});if(passed)console.log("PASS: installed CLI, isolated HTTP service, native Windows sharp; no global Node/npm on PATH.");else{console.error(output);process.exitCode=1;}});
