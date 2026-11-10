"use strict";
// Disposable local preview: never loads or rewrites the user's PenEcho state.
const fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const directory=fs.mkdtempSync(path.join(os.tmpdir(),"penecho-ink-lab-"));
Object.assign(process.env,{NODE_ENV:"test",PENECHO_TEST_OPEN_ACCESS:"1",PENECHO_STATE_DIR:directory,PENECHO_CLOUD_STATE_DIR:directory,HOST:"127.0.0.1",PORT:process.env.INK_LAB_PORT||"3922",AI_PROVIDER:"api",PENECHO_JEVISION_ENABLED:"false"});
const standalone=process.env.INK_LAB_STANDALONE === "1";
const server=standalone ? require("node:http").createServer((req,res)=>{
  const M=require("../public/living-ink-model.js"),UI=require("../public/living-ink.js"),vendor=fs.readFileSync(path.join(__dirname,"../public/vendor/ink-lab-vendor.js"),"utf8");
  const html=UI.createHtml(M.preset("blank"),"zh").replace("</head>",()=>`<script id="ink-lab-vendor">${vendor.replace(/<\/script/gi,"<\\/script")}</script></head>`);
  res.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"});res.end(html);
}) : require("../server.js");
if(standalone)server.listen(Number(process.env.PORT),"127.0.0.1",()=>console.log(`Ink Lab standalone: http://127.0.0.1:${server.address().port}`));
let closing=false;
function close(){if(closing)return;closing=true;server.close(()=>{fs.rmSync(directory,{recursive:true,force:true});process.exit(0);});server.closeAllConnections();setTimeout(()=>{fs.rmSync(directory,{recursive:true,force:true});process.exit(0);},1500).unref();}
process.on("SIGINT",close);process.on("SIGTERM",close);
server.on("error",()=>{fs.rmSync(directory,{recursive:true,force:true});process.exitCode=1;});
