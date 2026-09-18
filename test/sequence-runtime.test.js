'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {validateSequence,sequenceHtml}=require('../src/sequence/schema.js');
const {validateToolArguments}=require('../src/server/mcp/schema.js');
const fixture=name=>JSON.parse(fs.readFileSync(`testcase/sequence-local/2026-09-18/${name}.semantic.json`));
const simple={version:1,title:'Sequence',participants:[{id:'a',label:'Client'},{id:'b',label:'Server'}],messages:[{id:'one',from:'a',to:'b',label:'Request'},{id:'two',from:'b',to:'a',label:'Reply',kind:'return'}]};
test('sequence accepts semantic JSON only and preserves existing MCP formats',()=>{
 const base={sessionId:'s',artifactId:'seq',title:'T',requestId:'idempotent'};
 assert.match(validateToolArguments('penecho_present_widget',{...base,sequence:simple}).html,/data-sequence-source/);
 assert.equal(validateToolArguments('penecho_present_widget',{...base,html:'<h1>Old</h1>'}).html,'<h1>Old</h1>');
 for(const extra of [{html:'old'},{architecture:{}},{html:'old',architecture:{}}])assert.throws(()=>validateToolArguments('penecho_present_widget',{...base,sequence:simple,...extra}),/exactly one/);
 for(const bad of [null,'text',{}, {...simple,messages:[]},{...simple,participants:[]},{...simple,participants:[...simple.participants,simple.participants[0]]},{...simple,messages:[{...simple.messages[0],to:'missing'}]},{...simple,messages:[{...simple.messages[0],y:180}]},{...simple,participants:[{id:'a',label:'Client',x:80}]},{...simple,sessionId:'wrong'}])assert.throws(()=>validateSequence(bad),/Sequence:/);
 const html=sequenceHtml({...simple,title:'</script><img onerror=alert(1)>'});assert.equal((html.match(/<script/g)||[]).length,1);assert.ok(!html.includes('<img'));
});
test('sequence ranges reject unknown, reversed, crossing and cross-branch references',()=>{
 const base={...simple,messages:[...simple.messages,{id:'three',from:'a',to:'a',label:'Self'},{id:'four',from:'b',to:'a',label:'Done'}]};
 for(const fragments of [[{kind:'alt',label:'X',from:'bad',to:'two'}],[{kind:'loop',label:'X',from:'two',to:'one'}],[{kind:'opt',label:'X',from:'one',to:'three'},{kind:'loop',label:'Y',from:'two',to:'four'}],[{kind:'alt',label:'X',from:'one',to:'four',branches:[{from:'three',label:'Y'}]},{kind:'loop',label:'Z',from:'two',to:'four'}]])assert.throws(()=>validateSequence({...base,fragments}),/Sequence:/);
 assert.throws(()=>validateSequence({...base,activations:[{participant:'missing',from:'one',to:'two'}]}),/unknown activation/);
 validateSequence({...base,fragments:[{kind:'loop',label:'Outer',from:'one',to:'four'},{kind:'opt',label:'Inner',from:'two',to:'three'}]});
});
test('ordered temporal grid wraps long labels, stays orthogonal and contains message notes and nested frames',async()=>{
 const {layoutSequence}=await import('../src/sequence/layout.mjs');
 const {measureFallback,wrap}=await import('../src/diagrams/text.mjs');
 assert.ok(wrap('AI 客户端（Codex / Claude / ZCode）',112,15).some(line=>line.includes('Codex')));
 assert.ok(wrap('AI 客户端（Codex / Claude / ZCode）',112,15).some(line=>line.includes('ZCode')));
 assert.deepEqual(wrap('Claude / ZCode）',112,15,s=>Array.from(s).reduce((sum,c)=>sum+(/[A-Za-z]/.test(c)?8:c===' '?4:15),0)),['Claude /','ZCode）']);
 const nested={...fixture('mcp'),fragments:[{kind:'loop',label:'Outer 条件'.repeat(8),from:'read',to:'result'},...fixture('mcp').fragments]};
 for(const data of [simple,fixture('mcp'),fixture('payment'),fixture('async'),nested,{...simple,participants:[simple.participants[0]],messages:[{from:'a',to:'a',label:'最后一个参与者的超长自调用标题'.repeat(4),note:'A long note '.repeat(20)}]}])for(const width of [360,760,1280,1920]){
  const layout=layoutSequence(data,undefined,{width});
  assert.deepEqual(layout.participants.map(p=>p.id),data.participants.map(p=>p.id));
  let previous=layout.lifelineTop;
  for(const m of layout.messages){assert.ok(m.labelY>previous);previous=m.bottom+m.noteLines.length*17;for(let i=1;i<m.points.length;i++)assert.ok(m.points[i][0]===m.points[i-1][0]||m.points[i][1]===m.points[i-1][1]);for(const [x,y] of m.points)assert.ok(x>=0&&x<=layout.width&&y>layout.lifelineTop&&y<layout.height);for(const line of m.titleLines)assert.ok(measureFallback(line,13)<=m.labelWidth+1);}
  for(const p of layout.participants){assert.equal(p.height,layout.participants[0].height);for(const line of p.titleLines)assert.ok(measureFallback(line,15)<=p.width-24+1);}
  for(const f of layout.fragments){assert.ok(layout.messages[f.start].labelY>f.y+f.titleLines.length*18);assert.ok(layout.messages[f.end].bottom<f.y+f.height);}
  if(width===360 && data.participants.length>1)assert.equal(layout.mode,'scroll');
 }
});
test('fragment headers stay transparent; message and participant detail targets and colors survive SVG export',async()=>{
 const {layoutSequence}=await import('../src/sequence/layout.mjs'),{renderSvg}=await import('../src/sequence/render.mjs');
 const svg=renderSvg(layoutSequence(fixture('payment')));
 assert.equal((svg.match(/data-message-id=/g)||[]).length,9);assert.equal((svg.match(/data-node-id=/g)||[]).length,4);
 assert.match(svg,/stroke-dasharray="6 4"/);assert.match(svg,/stroke-dasharray="5 4"/);
 for(const header of svg.matchAll(/<g data-fragment-label=.*?<\/g>/g)) assert.doesNotMatch(header[0],/<rect/);
 assert.match(svg,/#7540d5/);assert.doesNotMatch(renderSvg(layoutSequence({...simple,title:'<script>alert(1)</script>'})),/<script>/);
});
test('mixed local diagram readiness waits for both runtimes and handles a missing module without hanging',()=>{
 const host=fs.readFileSync('public/widget-host.js','utf8');
 const body=host.match(/localReady.textContent = `([\s\S]*?)`;/)[1];
 for(const failed of [false,true]){
  const events=new Map(),messages=[];
  const ctx={Set,addEventListener:(type,fn)=>events.set(type,fn),parent:{postMessage:m=>messages.push(m)},document:{querySelectorAll:()=>[]}};
  vm.runInNewContext(body.replace('${JSON.stringify(localDiagrams)}','["architecture","sequence"]').replace('${JSON.stringify(documentVersion)}','7'),ctx);
  ctx.__penechoLocalDiagramsRendererReady();events.get('penecho-sequence-ready')();assert.equal(messages.length,0);
  if(failed)ctx.__penechoLocalDiagramLoadError('architecture');else events.get('penecho-architecture-ready')();
  assert.equal(messages.length,1);ctx.__penechoLocalDiagramsRendererReady();assert.equal(messages.length,1);
 }
});
