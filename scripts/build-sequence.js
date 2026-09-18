#!/usr/bin/env node
"use strict";
const fs=require('node:fs'),path=require('node:path'),esbuild=require('esbuild');
const ROOT=path.resolve(__dirname,'..');
async function main() {
  const check=process.argv.includes('--check');
  const result=await esbuild.build({absWorkingDir:ROOT,entryPoints:['src/sequence/runtime.mjs'],bundle:true,format:'iife',platform:'browser',target:'es2022',minify:true,write:false,legalComments:'eof',banner:{js:'/*! PenEcho sequence; Archify (MIT). See sequence-LICENSES.txt. */'}});
  const outputs=[['public/vendor/sequence-runtime.js',Buffer.from(result.outputFiles[0].text)],['public/vendor/sequence-LICENSES.txt',Buffer.from('Archify 2.17 — https://github.com/tt-a1i/archify\n'+fs.readFileSync(path.join(ROOT,'src/architecture/vendor/archify/LICENSE'),'utf8'))]];
  for (const [file,expected] of outputs) {
    const target=path.join(ROOT,file);
    if (check) { if (!fs.existsSync(target)||!fs.readFileSync(target).equals(expected)) throw new Error(`${file} is stale; run npm run build:sequence`); }
    else { fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,expected); }
    console.log(`${check?'Checked':'Built'} ${file} (${expected.length} bytes)`);
  }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
