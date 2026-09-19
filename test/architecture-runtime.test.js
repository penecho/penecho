const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {validateArchitecture,architectureHtml}=require('../src/architecture/schema.js');
const {validateToolArguments}=require('../src/server/mcp/schema.js');
const simple={version:1,title:'Architecture',nodes:[{id:'a',label:'Client'},{id:'b',label:'Server'},{id:'c',label:'Database'}],edges:[{from:'a',to:'b',label:'Request'},{from:'b',to:'c',label:'Read/write'}]};
test('architecture input rejects bad references, cycles, duplicate IDs, geometry and executable markup',()=>{
 for(const data of [{...simple,nodes:[...simple.nodes,simple.nodes[0]]},{...simple,edges:[{from:'a',to:'missing'}]},{...simple,groups:[{id:'g',label:'G',parent:'g'}]},{...simple,nodes:[{id:'a',label:'A',x:40}]},{...simple,version:undefined}])assert.throws(()=>validateArchitecture(data),/Architecture:/);
 const data={...simple,title:'</script><img src=x onerror=alert(1)>'};const html=architectureHtml(data);assert.equal((html.match(/<script/g)||[]).length,1);assert.ok(!html.includes('<img'));assert.match(html,/\\u003c/);
 assert.match(html,/lang="en"/);assert.match(html,/Laying out architecture diagram/);assert.match(architectureHtml(simple,{language:'zh'}),/正在布局架构图/);
 assert.throws(()=>validateArchitecture({...simple,artifactId:'wrong-level'}),/belong beside architecture/);
});
test('MCP accepts semantic architecture and preserves existing HTML-only requests',()=>{
 const base={sessionId:'s',artifactId:'a',title:'T',requestId:'req'};
 const parsed=validateToolArguments('penecho_present_widget',{...base,architecture:simple});assert.match(parsed.html,/data-architecture-source/);
 assert.equal(validateToolArguments('penecho_present_widget',{...base,html:'<h1>Old</h1>'}).html,'<h1>Old</h1>');
 assert.throws(()=>validateToolArguments('penecho_present_widget',{...base,html:'<p>x</p>',architecture:simple}),/exactly one/);
 assert.throws(()=>validateToolArguments('penecho_present_widget',{...base,architecture:{...simple,edges:[{from:'no',to:'a'}]}}),/unknown endpoint/);
});
test('local routing preserves topology, avoids nodes/labels, wraps long Chinese, supports compound frames and cycles',async()=>{
 const ELK=require('elkjs/lib/elk.bundled.js'),{layoutArchitecture}=await import('../src/architecture/layout.mjs');
 const fixtures=[simple,{...simple,direction:'DOWN'}, {...simple,edges:[...simple.edges,{from:'c',to:'a',label:'回传',kind:'return'}]},
  {...simple,nodes:[...simple.nodes,{id:'d',label:'非常长的中文参与实体名称与接口服务',subtitle:'长名称自动换行，不缩小文字'}],edges:[...simple.edges,{from:'b',to:'d',label:'一个需要换行展示的较长关系说明'}]},
  JSON.parse(fs.readFileSync('testcase/archify-local/2026-09-18/mcp.semantic.json','utf8'))];
 const elk=new ELK();
 for(const data of fixtures){const l=await layoutArchitecture(data,elk);assert.deepEqual(l.issues,[],JSON.stringify(l.issues));assert.equal(l.nodes.length,data.nodes.length);assert.equal(l.edges.length,data.edges.length);assert.ok(Number.isFinite(l.width)&&l.width>0);for(const n of l.nodes)assert.ok(n.x>=0&&n.y>=0&&n.x+n.width<=l.width&&n.y+n.height<=l.height);}
 const first=await layoutArchitecture(simple,elk),second=await layoutArchitecture(simple,elk);assert.deepEqual(first.nodes,second.nodes);assert.deepEqual(first.edges,second.edges);
});
test('semantic return edges do not reverse the main call chain; words and punctuation stay readable',async()=>{
 const ELK=require('elkjs/lib/elk.bundled.js'),{layoutArchitecture,wrap}=await import('../src/architecture/layout.mjs');
 const data=JSON.parse(fs.readFileSync('testcase/archify-local/2026-09-18/glm-json-reviewed/response.json','utf8'));
 const l=await layoutArchitecture(data,new ELK());assert.deepEqual(l.issues,[]);
 const chain=['aiclient','bridge','https','rpc','service','boundops','runtime','canvas','widgethost'].map(id=>l.nodes.find(n=>n.id===id));
 for(let i=1;i<chain.length;i++)assert.ok(chain[i].x>chain[i-1].x,`${chain[i-1].id} → ${chain[i].id}`);
 const lines=wrap('Widget Host（沙箱 iframe）',178,16);
 assert.ok(lines.some(line=>line.includes('iframe')));assert.ok(!lines.some(line=>/^[）】,。]$/u.test(line)));
 assert.deepEqual(wrap('get_guidance（只读）',110,12),['get_guidance','（只读）']);
});
test('compound edge entry paths avoid frame titles in the accepted UK power regression',async()=>{
 const ELK=require('elkjs/lib/elk.bundled.js'),{layoutArchitecture}=await import('../src/architecture/layout.mjs');
 const data=JSON.parse(fs.readFileSync('testcase/archify-local/2026-09-18/uk-power-regression.json','utf8'));
 const layout=await layoutArchitecture(data,new ELK());
 assert.deepEqual(layout.issues,[]);
 assert.ok(layout.groups.every(group=>Number.isFinite(group.titleX)&&group.titleRect));
});
test('renderer escapes text and reuses domain colors independent of card order',async()=>{
 const {renderSvg,tone}=await import('../src/architecture/render.mjs');
 assert.deepEqual(tone({domains:[{id:'x',label:'X',color:'purple'}]},'x'),['#7540d5','#f7f2ff']);
 assert.deepEqual(tone({domains:[]},undefined),['#5d6b80','#f7f9fc']);
 const svg=renderSvg({data:{title:'<bad>'},width:100,height:100,groups:[],nodes:[{id:'a',label:'<script>',x:0,y:0,width:100,height:80,titleLines:['<script>'],subtitleLines:[]}],edges:[]},'test');
 assert.ok(!svg.includes('<script>'));assert.match(svg,/&lt;script&gt;/);assert.match(svg,/role="button"/);
});
