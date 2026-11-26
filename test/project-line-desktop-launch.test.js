"use strict";
require("./helpers/safety.js");
const {test}=require("node:test"),assert=require("node:assert/strict"),{spawn}=require("node:child_process"),os=require("node:os");
const {Service}=require("../src/server/project-lines/service.js");
test("a detached desktop launch returns promptly and is not killed after the old 30-second timeout",async t=>{
 let child;const context={directory:os.tmpdir(),spawn:(...args)=>(child=spawn(...args))};
 t.after(()=>child?.kill());const started=Date.now();
 await Service.prototype.runDesktop.call(context,{command:process.execPath,args:["-e","setInterval(()=>{},1000)"],detached:true});
 assert.ok(Date.now()-started<5000);assert.equal(child.killed,false);
 await new Promise(r=>setTimeout(r,31000));
 assert.doesNotThrow(()=>process.kill(child.pid,0));assert.equal(child.killed,false);
});
test("a failed detached desktop spawn rejects",async()=>{
 await assert.rejects(Service.prototype.runDesktop.call({directory:os.tmpdir(),spawn},{command:"penecho-missing-desktop-executable-47328",args:[],detached:true}),/ENOENT/);
});
