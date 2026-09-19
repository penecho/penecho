#!/usr/bin/env node
"use strict";
const fs=require('node:fs'),path=require('node:path'),esbuild=require('esbuild');
const ROOT=path.resolve(__dirname,'..');
async function main() {
  const check=process.argv.includes('--check');
  const result=await esbuild.build({absWorkingDir:ROOT,entryPoints:['src/workflow/runtime.mjs'],bundle:true,format:'iife',platform:'browser',target:'es2022',minify:true,write:false,legalComments:'eof',banner:{js:'/*! PenEcho workflow; Archify (MIT) + ELK (EPL-2.0). See workflow-LICENSES.txt. */'}});
  const outputs=[['public/vendor/workflow-runtime.js',Buffer.from(result.outputFiles[0].text)],['public/vendor/workflow-LICENSES.txt',Buffer.from('Archify 2.17 — https://github.com/tt-a1i/archify\n'+fs.readFileSync(path.join(ROOT,'src/architecture/vendor/archify/LICENSE'),'utf8')+'\nELK / elkjs 0.12.0 — https://github.com/kieler/elkjs\n'+fs.readFileSync(path.join(ROOT,'node_modules/elkjs/LICENSE.md'),'utf8'))]];
  for (const [file,expected] of outputs) {
    const target=path.join(ROOT,file);
    if (check) { if (!fs.existsSync(target)||!fs.readFileSync(target).equals(expected)) throw new Error(`${file} is stale; run npm run build:workflow`); }
    else { fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,expected); }
    console.log(`${check?'Checked':'Built'} ${file} (${expected.length} bytes)`);
  }
  require('./stamp-diagram-assets')(ROOT,outputs,check);
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
