#!/usr/bin/env node
"use strict";
const fs=require('node:fs'),path=require('node:path'),esbuild=require('esbuild');
const ROOT=path.resolve(__dirname,'..');
async function main() {
  const check=process.argv.includes('--check');
  const outputs=[];
  for(const name of ['runtime','worker']) {
    const program = name === 'worker' ? fs.readFileSync(path.join(ROOT,'node_modules/elkjs/lib/elk-worker.min.js'),'utf8') : (await esbuild.build({absWorkingDir:ROOT,entryPoints:['src/architecture/runtime.mjs'],bundle:true,format:'iife',platform:'browser',target:'es2022',minify:true,write:false,legalComments:'eof',banner:{js:'/*! PenEcho architecture; Archify (MIT) + ELK (EPL-2.0). See architecture-LICENSES.txt. */'}})).outputFiles[0].text;
    // Load the trusted worker program as an ordinary local script. Opaque Widget
    // origins cannot reliably importScripts from loopback; the code runs only
    // after runtime creates a Blob Worker, never on the UI thread.
    const content = name === 'worker'
      ? `/*! ELK worker source; see architecture-LICENSES.txt */\nglobalThis.__penechoArchitectureWorkerCode=${JSON.stringify(program)};\n`
      : program;
    outputs.push([`public/vendor/architecture-${name}.js`,Buffer.from(content)]);
  }
  outputs.push(['public/vendor/architecture-LICENSES.txt',Buffer.from('Archify 2.17 — https://github.com/tt-a1i/archify\n'+fs.readFileSync(path.join(ROOT,'src/architecture/vendor/archify/LICENSE'),'utf8')+'\nELK / elkjs 0.12.0 — https://github.com/kieler/elkjs\n'+fs.readFileSync(path.join(ROOT,'node_modules/elkjs/LICENSE.md'),'utf8'))]);
  for(const [file,expected] of outputs) {
    const target=path.join(ROOT,file);
    if(check) {if(!fs.existsSync(target)||!fs.readFileSync(target).equals(expected))throw new Error(`${file} is stale; run npm run build:architecture`);}
    else {fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,expected);}
    console.log(`${check?'Checked':'Built'} ${file} (${expected.length} bytes)`);
  }
  require('./stamp-diagram-assets')(ROOT,outputs,check);
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
