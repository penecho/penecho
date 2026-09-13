"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm"),path=require("node:path");
const root=path.join(__dirname,".."),source=fs.readFileSync(path.join(root,"src/client/app/studio-navigator.js"),"utf8");
function extract(name,input=source){
  const start=input.indexOf(`function ${name}(`);assert.ok(start>=0);
  const lineEnd=input.indexOf("\n",start),body=input.lastIndexOf("{",lineEnd);let depth=0;
  for(let i=body;i<input.length;i++){if(input[i]==="{")depth++;else if(input[i]==="}"&&--depth===0)return input.slice(start,i+1);}
  throw Error(name);
}
test("Recent Work merges saved documents once and prioritizes open canvases",()=>{
  const records=new Map([
    ["active",{id:"active",title:"Current",locator:{location:"server",id:"one"},unseen:0}],
    ["background",{id:"background",title:"AI draft",unseen:4,stored:{item:{name:"AI draft"}}}],
  ]);
  const groups=vm.runInNewContext(`(${extract("studioNavigatorWorkGroups")})()`,{
    canvasDocuments:{records,activeId:"active"},state:{canvasAgentCanvasKey:"server:one",language:"en"},
    studioCanvasOpenedAt:()=>0,canvasAgentStoredHistoryGroups:()=>[],studioNavigatorSnapshots:()=>[{id:"one",location:"server",name:"Old title",updatedAt:20},{id:"older",location:"server",name:"Older saved",updatedAt:100}],
    snapshotName:item=>item.name,canvasAgentHistoryForCanvas:()=>[],t:key=>key,
  });
  assert.equal(groups.length,3);
  assert.deepEqual(Array.from(groups,group=>group.documentId||group.canvasKey),["active","background","server:older"]);
  assert.equal(groups[0].name,"Current");assert.equal(groups[1].unseen,true);
});
test("unread dots update in place and opening the sidebar does not acknowledge updates",()=>{
  let open=false,renders=0;const doc={id:"background",title:"AI draft",unseen:2};
  const dot={hidden:true,setAttribute(){}},row={dataset:{workspaceDocumentId:doc.id},querySelector:()=>dot};
  const toggle={dataset:{}},hint={textContent:""};
  const context=vm.createContext({canvasDocuments:{records:new Map([[doc.id,doc]]),activeId:"other",switching:false,error:null},
    studioNavigatorToggle:toggle,document:{getElementById:()=>hint},studioNavigator:{querySelectorAll:()=>[row]},
    canvasDocumentsCopy:en=>en,studioNavigatorIsOpen:()=>open,renderActiveStudioNavigatorHistory:()=>{if(open)renders++;},
    rememberStudioCanvasOpened:()=>{},studioNavigatorHistoryDirty:false,syncStudioMcpActions:()=>{},
  });
  vm.runInContext(`let studioWorkspaceSignature="";${extract("studioWorkspaceChanged")}`,context);
  context.studioWorkspaceChanged();assert.equal(toggle.dataset.workspaceUpdates,"true");assert.equal(renders,0);
  open=true;context.studioWorkspaceChanged();assert.equal(doc.unseen,2);assert.equal(dot.hidden,false);
  doc.unseen=3;context.studioWorkspaceChanged();assert.equal(renders,0,"content updates must not rebuild lists or previews");
  doc.title="Renamed";context.studioWorkspaceChanged();assert.equal(renders,1);
  doc.unseen=0;context.studioWorkspaceChanged();assert.equal(dot.hidden,true);assert.equal(toggle.dataset.workspaceUpdates,"false");assert.equal(hint.textContent,"");
  context.canvasDocuments.error="Reconnect and retry";context.studioWorkspaceChanged();assert.equal(toggle.dataset.workspaceUpdates,"true");assert.match(hint.textContent,/retry/);
});
test("workspace navigation is in the sidebar and MCP activity has no blurred wash",()=>{
  const html=fs.readFileSync(path.join(root,"public/index.html"),"utf8"),css=fs.readFileSync(path.join(root,"public/style.css"),"utf8");
  const sidebar=html.slice(html.indexOf('<aside id="studioNavigator"'),html.indexOf('</aside>',html.indexOf('<aside id="studioNavigator"')));
  assert.match(sidebar,/id="canvasWorkspaceClose"/);assert.match(sidebar,/id="studioMcpCloseAll"/);assert.match(sidebar,/id="studioMcpCloseOthers"/);assert.match(sidebar,/id="canvasWorkspaceRetry"/);
  assert.doesNotMatch(sidebar,/id="canvasWorkspaceNew"/);
  assert.doesNotMatch(html,/canvasWorkspaceSelect/);
  const ring=css.match(/\.mcp-canvas-ring \{[^}]*\}/)[0];
  assert.match(ring,/border:1px solid/);assert.doesNotMatch(css,/\.mcp-canvas-ring::after/);
  assert.doesNotMatch(ring,/box-shadow|filter|background/);
});
test("opening the update indicator reveals Recent Work without a stale search filter",()=>{
  let tab="agent",opened=false;const search={value:"older search"};
  vm.runInNewContext(`(${extract("toggleStudioWorkspaceNavigator")})()`,{
    studioNavigatorMcpEnabled:false,studioNavigatorIsOpen:()=>false,studioNavigatorToggle:{dataset:{workspaceUpdates:"true"}},studioNavigatorSearch:search,
    setStudioNavigatorTab:value=>{tab=value;},setStudioNavigatorOpen:value=>{opened=value;},
  });
  assert.equal(tab,"all");assert.equal(search.value,"");assert.equal(opened,true);
});

test("background MCP activity does not highlight the visible Canvas",()=>{
  const runtimeSource=fs.readFileSync(path.join(root,"src/client/app/mcp-runtime.js"),"utf8");
  const ring={setAttribute(key,value){this[key]=value;}},button={},newButton={},notice={};
  const runtime={ready:true,socket:{readyState:1},sessions:new Map(),pendingView:new Map(),glowing:true,activeMutation:"AI",mutationDocumentId:"background"};
  const context=vm.createContext({mcpRuntime:runtime,window:{PENECHO_CONFIG:{runtime:"local"}},WebSocket:{OPEN:1},canvasDocuments:{activeId:"visible"},mcpLocal:()=>true,mcpSessionVisible:()=>true,mcpText:key=>key,
    mcpEl:id=>({mcpCanvasRing:ring,mcpCanvasNotice:notice,mcpCanvasNoticeButton:button,mcpShowNewContent:newButton})[id],
  });
  vm.runInContext(extract("mcpAccessLabel",runtimeSource)+extract("mcpRenderCanvasStatus",runtimeSource),context);
  context.mcpRenderCanvasStatus();assert.equal(ring["data-state"],"open");assert.doesNotMatch(button.textContent,/canvasApplying/);
  runtime.mutationDocumentId="visible";context.mcpRenderCanvasStatus();assert.equal(ring["data-state"],"updating");
});

test("MCP connection opens its tab once, preserves Follow latest and clears pending on disconnect",()=>{
  const actions=[],search={value:"stale"},tab={hidden:true};
  const context=vm.createContext({studioNavigatorMcpEnabled:false,studioNavigatorSuspendedAgent:true,studioNavigatorActiveTab:"agent",studioNavigatorMcpTab:tab,studioNavigatorSearch:search,
    studioMcpFollowLatest:true,studioMcpLatestDocumentId:null,studioMcpLatestRegion:null,studioMcpPendingDocumentId:"stale",studioMcpPendingRegion:{x:1,y:2,w:3,h:4},
    syncStudioMcpActions:()=>actions.push(["follow",context.studioMcpFollowLatest]),
    selectCanvasToolMode:mode=>actions.push(["tool",mode]),
    closeCanvasAgent:options=>actions.push(["close",options.focus]),setStudioNavigatorTab:value=>{context.studioNavigatorActiveTab=value;actions.push(["tab",value]);},setStudioNavigatorOpen:value=>actions.push(["open",value]),
  });
  vm.runInContext(extract("syncStudioNavigatorMcp"),context);
  context.syncStudioNavigatorMcp(true);
  assert.deepEqual(actions,[["tool","hand"],["close",false],["tab","mcp"],["open",true],["follow",true]]);assert.equal(tab.hidden,false);assert.equal(search.value,"");assert.equal(context.studioNavigatorSuspendedAgent,false);
  assert.equal(context.studioMcpFollowLatest,true,"Follow latest is on by default for a live MCP connection");
  assert.equal(context.studioMcpPendingDocumentId,null);assert.equal(context.studioMcpPendingRegion,null);
  context.syncStudioNavigatorMcp(true);assert.equal(actions.length,5,"heartbeat/status renders must not reopen navigation");
  context.syncStudioNavigatorMcp(false);assert.equal(tab.hidden,true);assert.equal(context.studioNavigatorActiveTab,"all");assert.equal(context.studioMcpFollowLatest,true);
  const before=actions.length;context.syncStudioNavigatorMcp(true,{reveal:false});assert.equal(tab.hidden,false);assert.equal(context.studioNavigatorActiveTab,"all");assert.equal(actions.length,before,"automatic recovery must not open sidebar, switch tool or close Agent");
});
test("MCP list contains only participating canvases, including retained and live sessions",()=>{
  const docs=[{id:"ordinary"},{id:"bound",bindings:[{}]},{id:"retained",sessions:[{}]},{id:"live"}];
  const result=vm.runInNewContext(`(${extract("studioNavigatorMcpGroups")})()`,{
    studioMcpOrder:new Map(),studioMcpOrderSequence:0,
    studioNavigatorWorkGroups:()=>[...docs.map(doc=>({documentId:doc.id})),{canvasKey:"server:unrelated"}],
    canvasDocuments:{records:new Map(docs.map(doc=>[doc.id,doc]))},mcpRuntime:{sessions:new Map([["s",{documentId:"live"}]])},
  });
  assert.deepEqual(Array.from(result,group=>group.documentId),["live","retained","bound"]);
});
test("tab keyboard navigation includes MCP only while enabled",()=>{
  for(const enabled of [false,true]){
    let selected;
    const context={studioNavigatorMcpEnabled:enabled,studioNavigatorActiveTab:"all",setStudioNavigatorTab:tab=>{selected=tab;}};
    const handle=vm.runInNewContext(`(${extract("handleStudioNavigatorTabKeydown")})`,context);
    handle({key:"ArrowRight",preventDefault(){}});assert.equal(selected,enabled?"mcp":"canvas");
  }
});

test("only an open selected MCP tab is docked",()=>{
  for(const open of [false,true])for(const tab of ["all","canvas","agent","mcp"])for(const enabled of [false,true]){
    const docked=vm.runInNewContext(`(${extract("studioNavigatorIsMcpDocked")})()`,{studioNavigatorIsOpen:()=>open,studioNavigatorActiveTab:tab,studioNavigatorMcpEnabled:enabled});
    assert.equal(docked,open&&tab==="mcp"&&enabled);
  }
});
test("MCP dock stays open during workspace focus and compact Canvas selection",()=>{
  for(const docked of [false,true]){
    const closed=[],context={studioNavigatorIsMcpDocked:()=>docked,studioNavigatorIsOpen:()=>true,studioNavigatorIsCompact:()=>true,studioNavigator:{contains:()=>false},studioNavigatorToggle:{contains:()=>false},setStudioNavigatorOpen:value=>closed.push(value)};
    const focus=vm.runInNewContext(`(${extract("collapseStudioNavigatorForWorkspaceFocus")})`,context);
    assert.equal(focus({target:{}}),!docked);
    vm.runInNewContext(`(${extract("closeStudioNavigatorAfterCompactAction")})()`,context);
    assert.equal(closed.length,docked?0:2);
  }
});
test("Canvas changes suppress automatic Agent opening only while MCP is docked",()=>{
  const agentSource=fs.readFileSync(path.join(root,"src/client/app/canvas-agent-runtime.js"),"utf8");
  for(const docked of [false,true]){
    let opened=0;
    const context={window:{PenEchoStudioNavigator:{isMcpDocked:()=>docked}},canvasDocuments:{},canvasAgent:{},state:{canvasAgentAutoOpen:true},canvasAgentPanel:{hidden:true},WebSocket:{OPEN:1},
      canvasAgentReconcileCloudCanvas(){},canvasAgentCancelInitialAutoHide(){},canvasAgentPersistCurrentConversation(){},canvasAgentCanvasIdentity:()=>"test",canvasAgentBeginLocalConversation(){},canvasAgentDropSessionIdentity(){},canvasAgentSyncPromptSuggestions(){},openCanvasAgent:()=>opened++,
    };
    vm.runInNewContext(`(${extract("canvasAgentCanvasDidChange",agentSource)})()`,context);
    assert.equal(opened,docked?0:1);
  }
});

test("opening Agent or Library never automatically hides the MCP dock",()=>{
  for(const docked of [false,true])for(const name of ["studioNavigatorAgentWillOpen","historyManagerWillOpen"]){
    let closed=0;
    const context={studioNavigatorIsCompact:()=>true,studioNavigatorIsOpen:()=>true,studioNavigatorIsMcpDocked:()=>docked,studioNavigatorSuspendedAgent:false,setStudioNavigatorOpen:()=>closed++};
    vm.runInNewContext(`(${extract(name)})()`,context);
    assert.equal(closed,docked?0:1,`${name}: ordinary tabs retain their existing auto-collapse`);
  }
});
test("manually closing and reopening MCP preserves its selected tab and persistence",()=>{
  const classes=new Set(["studio-navigator-open"]);
  const context=vm.createContext({studioNavigatorActiveTab:"mcp",studioNavigatorMcpEnabled:true,studioNavigatorIsStudio:()=>true,
    document:{body:{classList:{contains:key=>classes.has(key),toggle:(key,value)=>value?classes.add(key):classes.delete(key)}},activeElement:{}},
    studioNavigator:{contains:()=>false},restoreCanvasChromeMaterial(){},updateStudioNavigatorA11y(){},suspendStudioAgentForNavigator(){},scheduleStudioNavigatorOpenWork(){},
  });
  vm.runInContext(["studioNavigatorIsOpen","studioNavigatorIsMcpDocked","setStudioNavigatorOpen","collapseStudioNavigatorForWorkspaceFocus"].map(name=>extract(name)).join("\n"),context);
  context.setStudioNavigatorOpen(false);assert.equal(context.studioNavigatorIsOpen(),false);assert.equal(context.studioNavigatorActiveTab,"mcp");
  context.setStudioNavigatorOpen(true);assert.equal(context.studioNavigatorIsMcpDocked(),true);
  assert.equal(context.collapseStudioNavigatorForWorkspaceFocus({target:{}}),false);assert.equal(context.studioNavigatorIsOpen(),true);
});
test("canvas metadata distinguishes current, background open and closed saved canvases",()=>{
  for(const language of ["en","zh"]){
    const labels=language==="en"?{studioNavigatorCurrent:"Current",studioNavigatorOpened:"Open",studioNavigatorNotOpened:"Not open"}:{studioNavigatorCurrent:"当前",studioNavigatorOpened:"已打开",studioNavigatorNotOpened:"未打开"};
    const meta=vm.runInNewContext(`(${extract("studioNavigatorCanvasMeta")})`,{
      t:key=>labels[key],snapshotLocationLabel:location=>location,studioNavigatorMetaTime:()=>"Sep 8",
    });
    assert.equal(meta(true,true,"server",1),`${labels.studioNavigatorCurrent} · server · Sep 8`);
    assert.equal(meta(false,true,"server",1),`${labels.studioNavigatorOpened} · server · Sep 8`);
    assert.equal(meta(false,false,"server",1),`${labels.studioNavigatorNotOpened} · server · Sep 8`);
    assert.equal(meta(false,true,"",1),`${labels.studioNavigatorOpened} · Sep 8`);
  }
});

 test("MCP keeps arrival order across updates and selection, inserting new entries first",()=>{
  const records=new Map([
    ["new",{id:"new",title:"New current",bindings:[{}],stored:{item:{createdAt:200}},changes:[]}],
    ["old",{id:"old",title:"Older edited",bindings:[{}],stored:{item:{createdAt:100}},changes:[{at:300}]}],
  ]);
  const context=vm.createContext({studioMcpOrder:new Map(),studioMcpOrderSequence:0,canvasDocuments:{records,activeId:"new"},state:{canvasAgentCanvasKey:""},
    studioCanvasOpenedAt:()=>0,canvasAgentStoredHistoryGroups:()=>[],studioNavigatorSnapshots:()=>[],t:key=>key,mcpRuntime:{sessions:new Map()}});
  vm.runInContext(extract("studioNavigatorWorkGroups")+"\n"+extract("studioNavigatorMcpGroups"),context);
  assert.deepEqual(Array.from(context.studioNavigatorMcpGroups(),g=>g.documentId),["old","new"]);
  assert.equal(context.studioNavigatorMcpGroups()[0].updatedAt,300);
  records.get("new").changes.push({at:400});
  assert.deepEqual(Array.from(context.studioNavigatorMcpGroups(),g=>g.documentId),["old","new"]);
  context.canvasDocuments.activeId="old";
  assert.deepEqual(Array.from(context.studioNavigatorMcpGroups(),g=>g.documentId),["old","new"]);
  records.set("latest",{id:"latest",title:"Latest",bindings:[{}],changes:[]});
  assert.deepEqual(Array.from(context.studioNavigatorMcpGroups(),g=>g.documentId),["latest","old","new"]);
  records.delete("old");
  assert.deepEqual(Array.from(context.studioNavigatorMcpGroups(),g=>g.documentId),["latest","new"]);
 });

test("sidebar visits persist locally without rewriting content timestamps or counting rerenders",()=>{
  const storage=new Map(), context=vm.createContext({localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)}});
  vm.runInContext(`const STUDIO_CANVAS_OPENED_KEY="visits";let studioCanvasOpened=new Map(),studioLastOpenedKey="";${extract("readStudioCanvasOpened")}${extract("rememberStudioCanvasOpened")}${extract("studioCanvasOpenedAt")}`,context);
  context.rememberStudioCanvasOpened("server:old");
  const first=context.studioCanvasOpenedAt("server:old");
  context.rememberStudioCanvasOpened("server:old");
  assert.equal(context.studioCanvasOpenedAt("server:old"),first);
  context.rememberStudioCanvasOpened("server:other");
  context.rememberStudioCanvasOpened("server:old");
  assert.ok(context.studioCanvasOpenedAt("server:old")>context.studioCanvasOpenedAt("server:other"));
  assert.equal(context.readStudioCanvasOpened().get("server:old"),context.studioCanvasOpenedAt("server:old"));
  assert.equal(context.studioCanvasOpenedAt("cloud:old"),0);
});
test("recently viewed saved Canvas precedes newer unvisited content",()=>{
  const items=[{id:"old",location:"server",updatedAt:1},{id:"new",location:"server",updatedAt:999}];
  const groups=vm.runInNewContext(`(${extract("studioNavigatorWorkGroups")})()`,{
    canvasDocuments:{records:new Map(),activeId:null},state:{canvasAgentCanvasKey:"",language:"en"},
    studioCanvasOpenedAt:key=>key==="server:old"?10:0,canvasAgentStoredHistoryGroups:()=>[],studioNavigatorSnapshots:()=>items,
    snapshotName:item=>item.id,canvasAgentHistoryForCanvas:()=>[],t:key=>key,
  });
  assert.deepEqual(Array.from(groups,g=>g.canvasKey),["server:old","server:new"]);
  assert.equal(items[0].updatedAt,1);
});
