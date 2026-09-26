#!/usr/bin/env node
'use strict';
// Generate a SHA-pinned Hermes submission only after this package is committed.
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),relative='integrations/penecho-cloud',dir=path.join(root,relative);
const sha=process.argv.find(arg=>arg.startsWith('--sha='))?.slice(6);
if(!/^[a-f0-9]{40}$/.test(sha||''))throw Error('Pass --sha=<40-character release commit>. Branch names and placeholder pins are not publishable.');
const manifest=JSON.parse(fs.readFileSync(path.join(dir,'plugin.json'),'utf8'));
const committed=JSON.parse(execFileSync('git',['show',`${sha}:${relative}/plugin.json`],{cwd:root,encoding:'utf8'}));
if(committed.version!==manifest.version)throw Error('The release commit does not contain this plugin version.');
const changed=execFileSync('git',['diff',sha,'--',relative],{cwd:root,encoding:'utf8'});
const untracked=execFileSync('git',['ls-files','--others','--exclude-standard',relative],{cwd:root,encoding:'utf8'});
if(changed.trim()||untracked.trim())throw Error('Commit the complete plugin package before pinning it.');
const entry=JSON.parse(fs.readFileSync(path.join(dir,'hermes/catalog-entry.json'),'utf8'));entry.sha=sha;
const output=path.join(root,'dist','penecho-marketplaces',manifest.version);fs.mkdirSync(output,{recursive:true});
// JSON is a YAML 1.2 document; using it preserves strings without escaping ambiguities.
fs.writeFileSync(path.join(output,'penecho.yaml'),JSON.stringify(entry,null,2)+'\n');
fs.writeFileSync(path.join(output,'hermes-pack.yaml'),JSON.stringify({name:'penecho',version:manifest.version,plugins:[{repo:entry.repo,ref:sha,subdir:relative}]},null,2)+'\n');
fs.copyFileSync(path.join(dir,'hermes/optional-mcps/penecho/manifest.yaml'),path.join(output,'mcp-manifest.yaml'));
console.log(`Prepared marketplace files at ${output}. Push/tag the same commit before submitting; this command does not publish anything.`);
