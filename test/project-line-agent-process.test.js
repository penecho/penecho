"use strict";
require("./helpers/safety.js");
const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),iconv=require("iconv-lite");
const {runCommand,spawnSync,decodeDiagnostic,diagnosticDecoder,StringDecoder}=require("../src/server/project-lines/agent-process.js");
const {createAgents}=require("../src/server/project-lines/agents.js");
const {tryOne}=require("../src/server/project-lines/agent-check.js");

test("diagnostics prefer valid UTF-8 and decode legacy Windows errors only when necessary",()=>{
 const chinese="不是内部或外部命令，也不是可运行的程序。";
 assert.equal(decodeDiagnostic(iconv.encode(chinese,"cp936"),{encoding:"cp936"}),chinese);
 assert.equal(decodeDiagnostic(Buffer.from("中文 😀"),{encoding:"cp936"}),"中文 😀");
 assert.equal(decodeDiagnostic(iconv.encode("café","cp1252"),{encoding:"cp1252"}),"café");
 for(const encoding of ["utf8","cp936"]){const decoder=diagnosticDecoder({encoding:"cp936"}),bytes=iconv.encode(chinese+"\n尾行",encoding);let out="";for(const byte of bytes)out+=decoder.write(Buffer.from([byte]));out+=decoder.end();assert.equal(out,chinese+"\n尾行");}
 const d=diagnosticDecoder({maxPending:8,encoding:"cp936"});assert.match(d.write(Buffer.from("a".repeat(20))),/omitted/);assert.equal(d.write(Buffer.from("discard\n中文\n")),"中文\n");
});
test("protocol UTF-8 remains intact across multibyte chunks",()=>{const decoder=new StringDecoder("utf8"),raw=Buffer.from('{"text":"中文😀"}\n');let text="";for(const byte of raw)text+=decoder.write(Buffer.from([byte]));text+=decoder.end();assert.equal(JSON.parse(text).text,"中文😀");});
test("command probes preserve failure, timeout, missing-file and output bounds",async()=>{
 assert.equal((await runCommand(process.execPath,["--version"])).status,0);
 assert.equal((await runCommand("penecho-missing-probe-command",[])).missing,true);
 assert.equal((await runCommand(process.execPath,["-e","setInterval(()=>{},1000)"],{timeout:100})).timedOut,true);
 const over=await runCommand(process.execPath,["-e","process.stdout.write('x'.repeat(10000))"],{maxBuffer:50});assert.equal(over.status,-1);assert.match(over.stderr,/limit/);
});

test("Windows spaced batch paths preserve arguments and support dsh version and Try a run",{skip:process.platform!=="win32"},async t=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),"penecho batch 中文 "));t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
 const dir=path.join(temp,"DeepSeek Harness"),file=path.join(dir,"dsh.cmd"),js=path.join(dir,"agent.cjs");fs.mkdirSync(dir);
 fs.writeFileSync(file,`@echo off\r\n"${process.execPath}" "%~dp0agent.cjs" %*\r\n`);
 fs.writeFileSync(js,`const fs=require('node:fs'),args=process.argv.slice(2);if(args.includes('--version')){console.log('0.2.2');process.exit(0)}if(args[0]==='--echo'){console.log(JSON.stringify(args.slice(1)));process.exit(0)}const at=args.indexOf('--patch');if(at===-1||JSON.parse(fs.readFileSync(args[at+1],'utf8'))[0].config.model!=='deepseek-v4-pro')process.exit(2);let input='';process.stdin.on('data',x=>input+=x).on('end',()=>console.log(JSON.stringify({type:'text',text:'OK 中文'})));`);
 const version=await runCommand(file,["--version"]);assert.equal(version.status,0,version.stderr);assert.equal(version.stdout.trim(),"0.2.2");
 const args=["two words","中文路径","a&b","(parentheses)","quote\"inside","ends\\",""];
 const echoed=spawnSync(file,["--echo",...args],{encoding:"utf8",env:process.env});assert.equal(echoed.status,0,echoed.stderr);assert.deepEqual(JSON.parse(echoed.stdout),args);
 const env={...process.env,DSH_CLI_PATH:file,DSH_HOME:path.join(temp,"empty-home")};delete env.DEEPSEEK_API_KEY;
 const profile=path.join(env.DSH_HOME,"profiles","headless");fs.mkdirSync(profile,{recursive:true});
 fs.writeFileSync(path.join(profile,"package.json"),JSON.stringify({dsh:{profile:{bundles:["@deepseek-ai/dsh-base","@deepseek-ai/dsh-headless"]}}}));
 const agents=createAgents({env});assert.equal(agents.launch("dsh").command,file);
 agents.pickModel("dsh","deepseek-official/deepseek-v4-pro","max");
 const result=await tryOne(agents,"dsh",{env});assert.equal(result.ok,true,JSON.stringify(result));
});
