"use strict";
// Load the shipped desktop main/server/preload in an isolated Electron profile.
const {app,BrowserWindow}=require("electron"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),assert=require("node:assert/strict");
const archive=path.resolve(process.argv[2]),out=path.resolve(process.argv[3]);
const temp=fs.mkdtempSync(path.join(os.tmpdir(),"penecho-desktop-launch-")),profile=path.join(temp,"profile"),bin=path.join(temp,"DeepSeek Harness 中文");
fs.mkdirSync(profile);fs.mkdirSync(bin);fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,"temporary-profile.txt"),temp);
app.setPath("userData",profile);app.disableHardwareAcceleration();
Object.assign(process.env,{NODE_ENV:"test",PENECHO_TEST_OPEN_ACCESS:"1",PENECHO_DISABLE_AUTO_UPDATE:"1",DSH_CLI_PATH:path.join(bin,"dsh.cmd"),DSH_HOME:path.join(temp,"dsh"),DEEPSEEK_API_KEY:"isolated-fixture-not-a-real-key"});
fs.writeFileSync(path.join(profile,"config.env"),"HOST=127.0.0.1\nPORT=0\nAI_PROVIDER=api\nAI_API_URL=http://127.0.0.1:1/v1\nAI_API_KEY=fixture\nAI_API_MODEL=fixture\nPENECHO_REQUEST_TRACE=false\n");
fs.writeFileSync(path.join(bin,"dsh.cmd"),`@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${process.execPath}" "%~dp0fake.cjs" %*\r\n`);
const iconv=require(require.resolve("iconv-lite",{paths:[archive]})),message="不是内部或外部命令，也不是可运行的程序。",hex=iconv.encode(message+"\r\n","cp936").toString("hex");
fs.writeFileSync(path.join(bin,"fake.cjs"),`const fs=require('fs'),path=require('path');if(process.argv.includes('--version')){console.log('0.2.2');process.exit(0)}process.stdin.resume();process.stdin.on('end',()=>{if(fs.existsSync(path.join(__dirname,'fail'))){process.stderr.write(Buffer.from('${hex}','hex'));process.exitCode=1}else console.log(JSON.stringify({type:'text',text:'OK'}));});`);
const pause=ms=>new Promise(r=>setTimeout(r,ms));async function until(fn,label){for(let i=0;i<200;i++){if(await fn())return;await pause(150);}throw Error('Timeout: '+label);}
const deadline=setTimeout(()=>{console.error('Desktop launch verification timeout');app.exit(1);},90000);
require(path.join(archive,"desktop/main.js"));
(async()=>{try{
 await app.whenReady();let win;
 await until(()=>{win=BrowserWindow.getAllWindows().find(w=>/^http:/.test(w.webContents.getURL()));return win&&!win.webContents.isLoading();},'desktop window');
 const origin=new URL(win.webContents.getURL()).origin;
 await win.loadURL(origin+"/projects.html#setup");
 const js=code=>win.webContents.executeJavaScript(code);
 await until(()=>js(`document.querySelector('[data-agent="dsh"]')?.textContent.includes('0.2.2')`),'dsh version in Agent setup');
 await js(`document.querySelector('[data-agent="dsh"] [data-act="setup-try"]').click()`);
 await until(()=>js(`document.querySelector('[data-agent="dsh"]')?.textContent.includes('Answered')`),'Answered');
 fs.writeFileSync(path.join(out,'answered.png'),(await win.webContents.capturePage()).toPNG());
 fs.writeFileSync(path.join(bin,'fail'),'1');
 await js(`document.querySelector('[data-agent="dsh"] [data-act="setup-try"]').click()`);
 await until(()=>js(`document.querySelector('[data-agent="dsh"]')?.textContent.includes(${JSON.stringify(message)})`),'Chinese diagnostic');
 const row=await js(`document.querySelector('[data-agent="dsh"]').textContent`);assert.ok(!row.includes('�')&&!row.includes('锟斤拷'));
 fs.writeFileSync(path.join(out,'chinese-diagnostic.png'),(await win.webContents.capturePage()).toPNG());
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({desktopStartup:true,packagedSource:archive,spacedChinesePath:true,version:'0.2.2',tryRunAnswered:true,chineseDiagnostic:true,paidModelRequests:0},null,2));
 console.log('PASS: shipped desktop startup, Agent setup version, Answered, and readable Chinese error');clearTimeout(deadline);app.exit(0);
}catch(e){console.error(e.stack);clearTimeout(deadline);app.exit(1);}})();
