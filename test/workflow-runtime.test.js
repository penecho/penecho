const test=require('node:test'),assert=require('node:assert/strict');
const {validateWorkflow,workflowHtml}=require('../src/workflow/schema.js');
const {validateToolArguments}=require('../src/server/mcp/schema.js');
const fixtures=require('../testcase/workflow-local/2026-09-18/fixtures.cjs');
test('reported retry workflows start before their main chain regardless of input order',async()=>{
 const fs=require('node:fs'),ELK=require('elkjs/lib/elk.bundled.js'),{layoutWorkflow}=await import('../src/workflow/layout.mjs');
 for(const name of ['wf-02-leave-zh','wf-04-order-zh','wf-07-onboarding-groups','wf-09-ml-pipeline']){
  const data=JSON.parse(fs.readFileSync(`testcase/mcp-layout-capture/2026-09-18/${name}.json`));
  for(const width of [390,2011])for(const reversed of [false,true]){
   const layout=await layoutWorkflow({...data,nodes:reversed?data.nodes.toReversed():data.nodes},new ELK(),undefined,{width});
   const axis=layout.mode==='down'?'y':'x',start=layout.nodes.find(n=>n.type==='start');
   assert.deepEqual(layout.issues,[],`${name} ${width}`);
   assert.equal(start[axis],Math.min(...layout.nodes.map(n=>n[axis])),`${name}: start leads the flow`);
   for(const edge of data.edges.filter(e=>e.kind!=='loop')){
    const a=layout.nodes.find(n=>n.id===edge.from),b=layout.nodes.find(n=>n.id===edge.to);
    // A recovery branch may return to a shared responsibility group (W07).
    if(!data.groups?.length)assert.ok(a[axis]<b[axis],`${name}: ${a.id} precedes ${b.id}`);
   }
  }
 }
});
test('workflow validates semantic process types, branches and cycles and rejects geometry',()=>{
  for(const data of Object.values(fixtures))assert.deepEqual(validateWorkflow(data),data);
  const base=fixtures.linear;
  for(const bad of [{...base,nodes:base.nodes.map((n,i)=>i?n:{...n,type:undefined})},{...base,nodes:base.nodes.map((n,i)=>i?n:{...n,x:2})},{...base,edges:[{from:'start',to:'missing'}]},{...fixtures.retry,edges:fixtures.retry.edges.map(e=>({...e,kind:'flow'}))},{...fixtures.approval,edges:fixtures.approval.edges.map(e=>e.from==='review'?{...e,label:undefined}:e)},{...base,edges:[...base.edges,{from:'end',to:'start',kind:'loop',label:'again'}]}])assert.throws(()=>validateWorkflow(bad),/Workflow:/);
  const html=workflowHtml({...base,title:'</script><img onerror=alert(1)>'});assert.equal((html.match(/<script/g)||[]).length,1);assert.ok(!html.includes('<img'));
  assert.match(html,/lang="en"/);assert.match(html,/Laying out workflow/);assert.match(workflowHtml(base,{language:'zh'}),/正在布局流程图/);
});
test('MCP accepts workflow as exactly one content type and leaves existing HTML intact',()=>{
  const base={sessionId:'s',artifactId:'f',title:'T',requestId:'r'};
  assert.match(validateToolArguments('penecho_present_widget',{...base,workflow:fixtures.linear}).html,/data-workflow-source/);
  for(const other of ['html','architecture','sequence'])assert.throws(()=>validateToolArguments('penecho_present_widget',{...base,workflow:fixtures.linear,[other]:{}}),/exactly one/);
  assert.equal(validateToolArguments('penecho_present_widget',{...base,html:'<h1>Original</h1>'}).html,'<h1>Original</h1>');
});
test('workflow lays out ordinary, decision, return and parallel cases at wide and narrow widths',async()=>{
  const ELK=require('elkjs/lib/elk.bundled.js');
  const {layoutWorkflow}=await import('../src/workflow/layout.mjs');
  for(const [name,data] of Object.entries(fixtures))for(const width of [1230,640,320]){
    const layout=await layoutWorkflow(data,new ELK(),undefined,{width});
    assert.deepEqual(layout.issues,[],`${name} ${width}: ${layout.issues}`);
    assert.equal(layout.nodes.length,data.nodes.length);assert.equal(layout.edges.length,data.edges.length);
    for(const node of layout.nodes)assert.ok(node.x>=0&&node.y>=0&&node.x+node.width<=layout.width&&node.y+node.height<=layout.height);
    for(const edge of layout.edges)assert.equal(edge.labels.length,edge.label?1:0);
  }
});
test('workflow rendering escapes labels and provides distinct semantic shapes',async()=>{
  const ELK=require('elkjs/lib/elk.bundled.js'),{layoutWorkflow}=await import('../src/workflow/layout.mjs'),{renderContent}=await import('../src/workflow/render.mjs');
  const data={...fixtures.approval,title:'<unsafe>'},svg=renderContent(await layoutWorkflow(data,new ELK(),undefined,{width:1280}),'test');
  assert.match(svg,/<polygon/);assert.match(svg,/data-node-type="end"/);assert.match(svg,/stroke-dasharray="5 4"/);
  assert.ok(!svg.includes('<unsafe>'));assert.match(svg,/&lt;unsafe&gt;/);assert.match(svg,/data-export="png"/);
});
test('compound boundaries wrap long titles, keep explicit ports distinct and never cover an incoming route',async()=>{
  const ELK=require('elkjs/lib/elk.bundled.js'),{layoutWorkflow}=await import('../src/workflow/layout.mjs');
  const data={version:1,title:'Grouped workflow',groups:[{id:'root',label:'企业跨部门联合发布工作组与自动化质量检查职责边界'},{id:'a_in',label:'内部审核',parent:'root'}],nodes:[{id:'outside',type:'start',label:'开始'},{id:'g_a',type:'process',label:'检查',group:'a_in'},{id:'end',type:'end',label:'结束'}],edges:[{from:'outside',to:'g_a',label:'提交'},{from:'g_a',to:'end',label:'通过'}]};
  for(const width of [1280,640])assert.deepEqual((await layoutWorkflow(data,new ELK(),undefined,{width})).issues,[]);
});
test('three diagram readiness waits for every local renderer, including load failures',()=>{
  const fs=require('node:fs'),vm=require('node:vm'),host=fs.readFileSync('public/widget-host.js','utf8');
  const body=host.match(/localReady.textContent = `([\s\S]*?)`;/)[1];
  for(const failed of [false,true]){
    const listeners=new Map(),messages=[],ctx={Set,addEventListener:(name,fn)=>listeners.set(name,fn),parent:{postMessage:m=>messages.push(m)},document:{querySelectorAll:()=>[]}};
    vm.runInNewContext(body.replace('${JSON.stringify(localDiagrams)}','["architecture","sequence","workflow"]').replace('${JSON.stringify(documentVersion)}','7'),ctx);
    ctx.__penechoLocalDiagramsRendererReady();listeners.get('penecho-sequence-ready')();listeners.get('penecho-architecture-ready')();assert.equal(messages.length,0);
    if(failed)ctx.__penechoLocalDiagramLoadError('workflow');else listeners.get('penecho-workflow-ready')();
    assert.equal(messages.length,1);ctx.__penechoLocalDiagramsRendererReady();assert.equal(messages.length,1);
  }
});
