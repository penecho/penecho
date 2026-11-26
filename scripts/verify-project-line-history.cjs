#!/usr/bin/env node
"use strict";
// Read real agent history, but write imported Topics only to an isolated temporary directory.
// Usage: node scripts/verify-project-line-history.cjs <package-root> <code-folder>
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), assert = require("node:assert/strict");
const root = path.resolve(process.argv[2] || path.join(__dirname,"..")), code = process.argv[3];
if (!code) throw Error("Pass the code folder whose history should be checked.");
const { Service } = require(path.join(root,"src/server/project-lines/service.js"));
const { createAgents } = require(path.join(root,"src/server/project-lines/agents.js"));
const temp = fs.mkdtempSync(path.join(os.tmpdir(),"penecho-history-check-")), directory = path.join(temp,"state");
fs.mkdirSync(directory);
const service = new Service({directory,agents:createAgents(),autoWatch:false});
const timer = setTimeout(()=>{console.error("History check timed out");service.close();process.exitCode=1;},180000);
(async()=>{try {
  const project = service.store.create({name:"History acceptance",docsPath:path.join(temp,"docs"),codePath:code});
  project.memorySkill=false; project.canvasSkill=false;
  const result = await service.syncRecent(project);
  console.log(JSON.stringify({sync:result}));
  assert.ok(result.added>0,"real project conversations must import");
  assert.equal(result.warnings?.length || 0,0,"all selected histories must be readable");
  const imported = Object.values(service.conversations.records).filter(r=>r.slug), ids=imported.map(r=>`${r.agent}:${r.id}`);
  assert.equal(new Set(ids).size,ids.length);
  assert.ok(imported.every(r=>r.lastAt>0));
  console.log(JSON.stringify({imported:imported.length,agents:[...new Set(imported.map(r=>r.agent))],sourceDates:imported.map(r=>new Date(r.lastAt).toISOString()).slice(0,3)}));
  // A direct replay of an imported thread must not create another Topic.
  const before=service.stateOf(project).lines.length;
  const entries=await service.conversations.recentCodex({project,roots:await service.conversations.rootsOf(project)},0);
  const entry=entries.find(e=>service.conversations.records[`codex:${e.id}`]?.slug);
  if(entry) await entry.read(service.conversations.records[`codex:${entry.id}`]);
  assert.equal(service.stateOf(project).lines.length,before);
  console.log("PASS: real-history import and replay deduplication; output was isolated.");
} finally {clearTimeout(timer);service.close();fs.rmSync(temp,{recursive:true,force:true});}})().catch(error=>{console.error(error.message);process.exitCode=1;});
