#!/usr/bin/env node
"use strict";
// Run with Node or packaged Electron (ELECTRON_RUN_AS_NODE=1); all writes are isolated.
const fs=require("node:fs"),os=require("node:os"),path=require("node:path"),assert=require("node:assert/strict"),{createRequire}=require("node:module");
const root=path.resolve(process.argv[2]),load=createRequire(path.join(root,"package.json"));
const {runCommand}=load("./src/server/project-lines/agent-process.js"),{createAgents}=load("./src/server/project-lines/agents.js"),{Service}=load("./src/server/project-lines/service.js");
const temp=fs.mkdtempSync(path.join(os.tmpdir(),"penecho DeepSeek 中文 "));let service;
(async()=>{try{
 const bin=path.join(temp,"DeepSeek Harness"),cmd=path.join(bin,"dsh.cmd");fs.mkdirSync(bin);
 fs.writeFileSync(cmd,`@echo off\r\n"${process.execPath}" "%~dp0fake.cjs" %*\r\n`);
 fs.writeFileSync(path.join(bin,"fake.cjs"),`if(process.argv.includes('--version')){console.log('0.2.2');process.exit(0)}let text='';process.stdin.on('data',x=>text+=x).on('end',()=>{for(const row of [{type:'session',sessionId:'fixture-1'},{type:'text',text:'OK 中文任务完成'},{type:'status',phase:'turn_end',reason:{kind:'completed'}}])console.log(JSON.stringify(row));});`);
 const env={...process.env,DSH_CLI_PATH:cmd,DSH_HOME:path.join(temp,"dsh-home")},agents=createAgents({env});
 assert.equal((await runCommand(cmd,["--version"])).stdout.trim(),"0.2.2");
 const state=path.join(temp,"state");fs.mkdirSync(state);service=new Service({directory:state,agents,autoWatch:false});
 const project=service.store.create({name:"Batch launch acceptance",docsPath:path.join(temp,"docs space 中文")});
 const {slug}=await service.createTopic(project,{text:"Reply OK in Chinese without tools.",agent:"dsh",kinds:["ask","work"],start:true});
 const end=Date.now()+15000;while(service.runs.size&&Date.now()<end)await new Promise(r=>setTimeout(r,50));
 assert.equal(service.runs.size,0,"fixture run must finish");
 const doc=service.readDoc(project,slug);assert.match(doc,/中文任务完成/);
 const legacy=await runCommand(process.env.ComSpec||"cmd.exe",["/d","/c","penecho_nonexistent_command_873492"]);
 assert.notEqual(legacy.status,0);assert.ok(!legacy.stderr.includes("�"),"shell diagnostics must decode without replacement characters");
 const actual=process.argv[3];
 if(actual){const copied=path.join(bin,"real-dsh.cmd");fs.copyFileSync(actual,copied);const version=await runCommand(copied,["--version"],{timeout:30000});assert.equal(version.status,0,version.stderr);console.log("Real Harness shim from spaced path:",version.stdout.trim());}
 console.log("PASS: packaged real-job dispatch, Chinese UTF-8 result, Windows shell error decoding, and spaced batch version probe");
}finally{service?.close();fs.rmSync(temp,{recursive:true,force:true});}})().catch(e=>{console.error(e.stack);process.exitCode=1;});
