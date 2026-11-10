"use strict";
const fs=require("node:fs"),path=require("node:path"),esbuild=require("esbuild");
const root=path.resolve(__dirname,".."),output=path.join(root,"public/vendor/ink-lab-vendor.js");
async function build(){
  const result=await esbuild.build({entryPoints:[path.join(root,"src/client/ink-lab-tools.js")],bundle:true,minify:true,platform:"browser",format:"iife",target:"es2020",legalComments:"inline",write:false});
  const body=result.outputFiles[0].text;
  const notices=["Nerdamer 1.1.13 — https://github.com/jiggzson/nerdamer\n"+fs.readFileSync(path.join(root,"node_modules/nerdamer/license.txt"),"utf8"),"PptxGenJS 4.0.0 — https://github.com/gitbrent/PptxGenJS\n"+fs.readFileSync(path.join(root,"node_modules/pptxgenjs/LICENSE"),"utf8"),"JSZip 3.10.1 — https://github.com/Stuk/jszip\n"+fs.readFileSync(path.join(root,"node_modules/jszip/LICENSE.markdown"),"utf8")].join("\n\n").replace(/\r\n?/g,"\n");
  const code="/*!\n"+notices.replace(/\*\//g,"* /")+"\n*/\n"+body;
  const files=[[output,code],[path.join(root,"public/vendor/ink-lab-LICENSE.txt"),notices]];
  for(const [file,data] of files){if(process.argv.includes("--check")){if(!fs.existsSync(file)||fs.readFileSync(file,"utf8")!==data)throw Error(path.relative(root,file)+" is stale. Run npm run build:ink-lab");}else fs.writeFileSync(file,data);}
  console.log(`Ink Lab vendor: ${Math.round(code.length/1024)} KB`);
}
build().catch(error=>{console.error(error);process.exitCode=1;});
