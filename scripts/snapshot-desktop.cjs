#!/usr/bin/env node
"use strict";
// Build input snapshot: official npm runtime output plus canonical desktop/build sources.
const fs=require("node:fs"),os=require("node:os"),path=require("node:path"),crypto=require("node:crypto"),{execFileSync}=require("node:child_process");
const [packageFile,outputFile,...options]=process.argv.slice(2);
if(!packageFile||!outputFile||options.length>1||options.some(option=>!option.startsWith("--desktop-version="))){
 throw new Error("Usage: snapshot-desktop.cjs <npm-package.tgz> <output.tgz> [--desktop-version=X.Y.Z]");
}
const desktopVersionOverride=options[0]?.slice("--desktop-version=".length)||"";
if(options.length&&(!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(desktopVersionOverride)||desktopVersionOverride.split(".").some(part=>Number(part)>65535))){
 throw new Error("The desktop version override must be stable X.Y.Z, with each component from 0 to 65535.");
}
const root=path.resolve(__dirname,".."),pkg=path.resolve(packageFile),output=path.resolve(outputFile),canonicalDesktopVersion=require("../package.json").config.desktopVersion;
const temp=fs.mkdtempSync(path.join(os.tmpdir(),"penecho-desktop-source-"));
// macOS tar otherwise adds AppleDouble ._ files that Windows extracts as source.
const archiveEnvironment={...process.env,COPYFILE_DISABLE:"1"};
try{
 execFileSync("tar",["-xzf",pkg,"-C",temp],{env:archiveEnvironment});const stage=path.join(temp,"package");
 for(const relative of ["desktop","scripts","test","build","forge.config.js","package-lock.json","integrations/penecho-cloud/assets","docs/readme",".github/workflows/desktop-release.yml","tools/electron/package.json","tools/electron/package-lock.json","tools/electron/run-forge.js"]){const source=path.join(root,relative);if(fs.existsSync(source)){fs.mkdirSync(path.dirname(path.join(stage,relative)),{recursive:true});fs.cpSync(source,path.join(stage,relative),{recursive:true,filter:file=>!file.split(path.sep).includes("node_modules")});}}
 if(desktopVersionOverride){
  const packagePath=path.join(stage,"package.json"),stagedPackage=JSON.parse(fs.readFileSync(packagePath,"utf8"));
  stagedPackage.config={...stagedPackage.config,desktopVersion:desktopVersionOverride};
  fs.writeFileSync(packagePath,JSON.stringify(stagedPackage,null,2)+"\n");
 }
 const files=[];function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const full=path.join(dir,e.name);if(e.isDirectory())walk(full);else if(e.isFile())files.push({path:path.relative(stage,full).split(path.sep).join("/"),sha256:crypto.createHash("sha256").update(fs.readFileSync(full)).digest("hex")});}}
 walk(stage);const meta={revision:execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim(),desktopVersion:JSON.parse(fs.readFileSync(path.join(stage,"package.json"))).config.desktopVersion,canonicalDesktopVersion,desktopVersionOverride:desktopVersionOverride||null,sourceDirty:true,createdAt:new Date().toISOString(),files};
 fs.writeFileSync(path.join(stage,".penecho-build-manifest.json"),JSON.stringify(meta,null,2)+"\n");fs.mkdirSync(path.dirname(output),{recursive:true});execFileSync("tar",["-czf",output,"-C",stage,"."],{env:archiveEnvironment});
 console.log(JSON.stringify({snapshot:output,sourceFiles:files.length,revision:meta.revision,desktopVersion:meta.desktopVersion}));
}finally{fs.rmSync(temp,{recursive:true,force:true});}
