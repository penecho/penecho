"use strict";
const fs=require("node:fs"),path=require("node:path"),esbuild=require("esbuild");
const root=path.resolve(__dirname,"..");
const output=esbuild.buildSync({entryPoints:[path.join(root,"src/playground/liveclay/src/widget.ts")],bundle:true,minify:true,format:"iife",target:"es2022",write:false,legalComments:"inline"}).outputFiles[0].contents;
const target=path.join(root,"public/playground/liveclay-v1.js");
if(process.argv.includes("--check")){if(!fs.existsSync(target)||!fs.readFileSync(target).equals(Buffer.from(output)))throw Error("Live Clay build is stale; run npm run build:playground");}
else{fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,output);console.log("Built Live Clay runtime");}
