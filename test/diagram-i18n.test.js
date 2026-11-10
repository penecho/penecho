'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');

test('professional diagram chrome has complete English and Chinese copy',async()=>{
  const {diagramCopy,diagramError,diagramErrorMessage,localizeLayoutIssue,normalizeDiagramLanguage}=await import('../src/architecture/i18n.mjs');
  const en=diagramCopy('en'),zh=diagramCopy('zh-CN');
  assert.equal(normalizeDiagramLanguage('zh-Hans'),'zh');assert.equal(normalizeDiagramLanguage('fr'),'en');
  for(const key of ['exportNav','viewNav','locateNode','locateNodePlaceholder','overview','zoomOut','zoomIn','mapHelp','nodeDetails','participantDetails','messageDetails','closeDetails','related','svgEncodeFailed','pngEncodeFailed','layoutModuleLoadFailed','layoutCancelled','layoutTimeout']){
    assert.equal(typeof en[key],'string',`English ${key}`);assert.equal(typeof zh[key],'string',`Chinese ${key}`);assert.notEqual(en[key],zh[key],key);
  }
  for(const kind of ['architecture','sequence','workflow']){
    assert.ok(en.loading[kind]);assert.ok(zh.loading[kind]);assert.ok(en.failed[kind]);assert.ok(zh.failed[kind]);assert.ok(en.moduleFailed[kind]);assert.ok(zh.moduleFailed[kind]);
  }
  assert.equal(diagramErrorMessage(diagramError('svgEncodeFailed'),en),'Could not encode the SVG');
  assert.equal(localizeLayoutIssue('Nodes overlap: a/b',zh),'节点重叠：a/b');
  assert.equal(localizeLayoutIssue('Nodes overlap: a/b',en),'Nodes overlap: a/b');
});

test('professional diagram panels render localized controls without changing authored content',async()=>{
  const {diagramCopy}=await import('../src/architecture/i18n.mjs'),{renderPanel}=await import('../src/architecture/render.mjs');
  const data={title:'用户内容',nodes:[{id:'a',label:'API'}],details:[],notes:[]};
  const en=renderPanel(data,'<svg></svg>',diagramCopy('en')),zh=renderPanel(data,'<svg></svg>',diagramCopy('zh'));
  assert.match(en,/aria-label="Diagram export"/);assert.match(en,/>Overview<\/button>/);assert.match(en,/Locate node…/);
  assert.match(zh,/aria-label="图表导出"/);assert.match(zh,/>总览<\/button>/);assert.match(zh,/定位节点…/);
  assert.match(en,/用户内容/);assert.match(zh,/用户内容/);
});

test('mounted professional diagram controls update their visible and accessible copy in place',async()=>{
  const {applyPanelCopy,diagramCopy}=await import('../src/architecture/i18n.mjs');
  const element=()=>({attributes:{},dataset:{},textContent:'',setAttribute(name,value){this.attributes[name]=value;}}),
    nav=element(),controls=element(),select=element(),placeholder=element(),overview=element(),zoomOut=element(),zoomIn=element(),map=element(),popover=element();
  select.querySelector=selector=>selector==='option[value=""]'?placeholder:null;
  controls.querySelector=selector=>({select,'[data-view="fit"]':overview,'[data-view="out"]':zoomOut,'[data-view="in"]':zoomIn}[selector]||null);
  const root={querySelector:selector=>({'.pa-header nav':nav,'.pa-view-controls':controls,'.pa-map':map,'.pa-popover':popover}[selector]||null)};
  applyPanelCopy(root,diagramCopy('en'));
  assert.deepEqual([nav.attributes['aria-label'],controls.attributes['aria-label'],select.attributes['aria-label'],placeholder.textContent,overview.textContent,zoomOut.attributes['aria-label'],zoomIn.attributes['aria-label'],map.attributes['aria-label'],popover.attributes['aria-label']],
    ['Diagram export','Diagram view','Locate node','Locate node…','Overview','Zoom out','Zoom in','Diagram; when zoomed in, use the mouse wheel, trackpad, or scrollbars to browse. Press Home to return to the overview.','Node details']);
  applyPanelCopy(root,diagramCopy('zh'));
  assert.deepEqual([nav.attributes['aria-label'],controls.attributes['aria-label'],select.attributes['aria-label'],placeholder.textContent,overview.textContent,zoomOut.attributes['aria-label'],zoomIn.attributes['aria-label'],map.attributes['aria-label'],popover.attributes['aria-label']],
    ['图表导出','图表视图','定位节点','定位节点…','总览','缩小','放大','图表；放大后使用鼠标滚轮、触控板或滚动条浏览，按 Home 返回总览。','节点详情']);
});

test('Widget language follows PenEcho and can update a mounted diagram without rebuilding it',()=>{
  const root=path.join(__dirname,'..'),canvas=fs.readFileSync(path.join(root,'src/client/app/canvas-runtime.js'),'utf8'),host=fs.readFileSync(path.join(root,'public/widget-host.js'),'utf8');
  assert.match(canvas,/type:"penecho-widget-init",[\s\S]*language:state\.language === "zh" \? "zh" : "en"/);
  assert.match(canvas,/type:"penecho-widget-language"/);
  assert.match(host,/message\?\.type === "penecho-widget-language"/);
  const body=host.match(/localReady\.textContent = `([\s\S]*?)`;/)[1]
    .replace('${JSON.stringify(localDiagrams)}','["architecture"]')
    .replace('${JSON.stringify(documentVersion)}','7');
  const listeners=new Map(),events=[],parent={postMessage(){}},documentElement={lang:'zh-CN'};
  const document={documentElement,querySelectorAll:()=>[]};
  const context={Set,String,document,parent,globalThis:null,addEventListener:(name,listener)=>listeners.set(name,listener),dispatchEvent:event=>events.push(event),CustomEvent:class {constructor(type,options){this.type=type;this.detail=options.detail;}}};
  context.globalThis=context;vm.runInNewContext(body,context);
  assert.equal(context.__penechoDiagramLanguage,'zh');
  listeners.get('message')({source:parent,data:{type:'penecho-diagram-language',language:'en'}});
  assert.equal(context.__penechoDiagramLanguage,'en');assert.equal(documentElement.lang,'en');assert.equal(events.at(-1).type,'penecho-diagram-languagechange');
});

test('language changes reach each ready widget once without replacing its frame',()=>{
  const canvas=fs.readFileSync(path.join(__dirname,'..','src/client/app/canvas-runtime.js'),'utf8'),
    source=canvas.match(/function syncWidgetHostLanguages\(language=state\.language\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(source,'syncWidgetHostLanguages source');
  const calls=[],widget=(name,ready=true)=>{
    const contentWindow={postMessage:(message,origin)=>calls.push({name,message,origin})};
    return {name,hostReady:ready,hostOrigin:`https://${name}.example`,frame:{contentWindow}};
  },current=widget('current'),pending=widget('pending'),preview=widget('preview'),unready=widget('unready',false),
    state={language:'en',widgets:[current,unready],pendingWidget:pending},mcpRuntime={previews:new Map([['duplicate',current],['preview',preview]])},location={origin:'https://penecho.example'};
  const sync=vm.runInNewContext(`(${source})`,{state,mcpRuntime,location,Set});
  const frames=[current.frame,pending.frame,preview.frame,unready.frame];
  sync('en');
  assert.deepEqual(calls.map(call=>call.name),['current','pending','preview']);
  assert.ok(calls.every(call=>call.message.type==='penecho-widget-language'&&call.message.language==='en'));
  assert.deepEqual([current.frame,pending.frame,preview.frame,unready.frame],frames,'language sync must not rebuild widget frames');
  calls.length=0;sync('zh');
  assert.ok(calls.every(call=>call.message.language==='zh'));
});
