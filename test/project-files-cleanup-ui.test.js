'use strict';
require('./helpers/safety.js');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function setup(files) {
  const p = {id:'test', files}, calls = [], messages = [];
  const ctx = vm.createContext({ ICONS:{}, S:{}, ACT:{}, document:{addEventListener(){}}, addEventListener(){}, console, Set, Map,
    project:()=>p, can:()=>true, confirm:()=>true, pathFor:()=>'/project', afterCanvasChange:async()=>{}, needsNewServer:e=>e.message,
    toast:(message, action)=>messages.push({message,action}), api:async(url, options)=>{calls.push([url,options.body]);return {removed:String(calls.length)};}, lineById:()=>null });
  vm.runInContext(fs.readFileSync('public/lines/files.js','utf8')+'\nflRedraw = () => {};', ctx);
  return {ctx,p,calls,messages, run:code=>vm.runInContext(code,ctx)};
}
const file = (path,size=1,extra={}) => ({path,size,kind:'document',usage:'unlinked',...extra});
test('threshold boundaries, unknown sizes, largest first and all matching beyond rendered limit', () => {
  const {run} = setup([file('files/below.txt',1048575),file('files/exact.txt',1048576),file('files/unknown.txt',NaN), ...Array.from({length:70},(_,i)=>file(`files/n${i}.txt`,2*1048576))]);
  run("flState().size='1048576'; flState().by='size'");
  assert.equal(run('flShown(project()).length'),71);
  assert.equal(run('flShown(project()).at(-1).path'),'files/exact.txt');
  run("ACT['file-select-all']()");
  assert.equal(run('flSelected().size'),71);
});
test('Canvas and its source delete once and Undo reverses successful operations', async () => {
  const {run,p,calls,messages} = setup([file('files/a.penecho.json',10,{kind:'canvas',deletion:{files:['files/a.penecho.json','files/a.html']}}),file('files/a.html'),file('files/b.txt')]);
  p.pictures=[{source:'files/a.penecho.json',title:'Canvas'}];
  run("ACT['file-select-all']()"); await run("ACT['file-delete-selected']()");
  assert.equal(calls.length,2); assert.equal(calls[0][0],'/project/canvases/delete');
  assert.equal(calls[1][1].path,'files/b.txt'); assert.equal(run('flSelected().size'),0);
  await messages.at(-1).action.fn();
  assert.equal(calls[2][0],'/project/files/restore'); assert.equal(calls[3][0],'/project/canvases/restore');
});
test('busy Canvas stops the batch before touching its selected source; partial successes remain undoable', async () => {
  const {run,p,ctx,calls,messages} = setup([file('files/a.penecho.json',10,{kind:'canvas'}),file('files/b.penecho.json',10,{kind:'canvas'}),file('files/b.html')]);
  p.pictures=[{source:'files/a.penecho.json',title:'First'},{source:'files/b.penecho.json',title:'Busy'}];
  ctx.api=async(url,options)=>{calls.push(options.body.path);if(calls.length===2)throw Error('Canvas busy');return {removed:'ok'};};
  run("ACT['file-select-all']()"); await run("ACT['file-delete-selected']()");
  assert.deepEqual(calls,['files/a.penecho.json','files/b.penecho.json']);
  assert.equal(run('flSelected().size'),2); assert.match(run('flState().deleteError'),/Remaining items/); assert.ok(messages.at(-1).action);
});
test('folder coverage honors path boundaries', () => {
  const {run} = setup([]);
  assert.equal(run("flCovers({deletion:{folder:'files/page'}}, 'files/page/a.png')"),true);
  assert.equal(run("flCovers({deletion:{folder:'files/page'}}, 'files/page-two/a.png')"),false);
});
