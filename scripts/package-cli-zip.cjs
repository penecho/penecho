#!/usr/bin/env node
"use strict";
// Keep both the download name and archive root short for Explorer's default Extract All folder.
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto"),{execFileSync}=require("node:child_process");
const source=path.resolve(process.argv[2]),output=path.resolve(process.argv[3]);
const root=".",budget=160,entries=[];
function walk(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){const full=path.join(dir,item.name),relative=path.relative(source,full).split(path.sep).join("/");const archived=`${root}/${relative}`;if(archived.length>budget)throw Error(`ZIP path exceeds ${budget} characters: ${archived}`);entries.push(archived);if(item.isDirectory())walk(full);}}
walk(source);
fs.mkdirSync(path.dirname(output),{recursive:true});
// Archive the contents directly: Extract All already creates a folder named after the ZIP.
execFileSync("tar",["-a","-cf",output,"-C",source,...fs.readdirSync(source)],{stdio:"inherit"});
const digest=crypto.createHash("sha256").update(fs.readFileSync(output)).digest("hex");
fs.writeFileSync(output+".sha256",`${digest}  ${path.basename(output)}\n`);
console.log(JSON.stringify({zip:output,archiveRoot:root,maxEntryLength:Math.max(...entries.map(e=>e.length)),sha256:digest}));
