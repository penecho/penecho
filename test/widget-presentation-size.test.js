"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../src/client/app/canvas-runtime.js'),'utf8');
// Execute the real message admission and retired-size branch, without unrelated handlers.
const start=source.indexOf('  async function handleWidgetMessage(');
const end=source.indexOf('    if (message.type === "penecho-widget-fit-result")',start);
test('stale host size reports cannot change the browser viewport or saved Canvas geometry',async()=>{
 const win={},widget={frame:{contentWindow:win},hostOrigin:'https://widget.test',contentW:1939,contentH:1134,w:3878,h:2268};
 const before=JSON.stringify(widget);
 const handler=vm.runInNewContext(source.slice(start,end)+'};handleWidgetMessage',{state:{widgets:[widget]},location:{origin:'https://canvas.test'}});
 for(const dimensions of [{width:100000,height:100000},{width:1,height:1,preserveViewport:true},{width:640,height:3000}]){
  await handler({source:win,origin:'https://widget.test',data:{type:'penecho-widget-presentation-size',...dimensions}});
 }
 assert.equal(JSON.stringify(widget),before);
});
