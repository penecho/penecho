'use strict';
// Canonical browser assets, isolated profile and in-memory document fixtures.
// No document writes reach the user's running server.
const {app,BrowserWindow,session,net}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),origin=process.env.PENECHO_TEST_ORIGIN||'http://127.0.0.1:3921';
const out=path.join(root,'test-results/sidebar-four-views');fs.mkdirSync(out,{recursive:true});
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'penecho-four-views-'));app.setPath('userData',profile);
const report={checks:[],errors:[],previewRequests:[]};let win;const pause=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{try{
 const partition=session.fromPartition('four-views');
 await partition.protocol.handle('http',async request=>{
  const url=new URL(request.url);if(url.origin!==origin)return new Response('',{status:403});
  if(url.pathname==='/app.js'){
   let source=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
   source=source.replace('window.PenEchoStudioNavigator = Object.freeze({',`window.sidebarTest={setGroups(groups){
     studioNavigatorWorkGroups=()=>groups;studioNavigatorQueueCanvasGroupSnapshots=()=>{};
     for(const source of studioNavigatorSourceStates.values()){source.items=[];source.status='ready';source.loadedAt=Date.now();}
     for(const group of groups){if(group.item&&!group.item.hasPreview)group.item.preview=new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="400" height="250"><g fill="white" stroke="#9ba2b2" stroke-width="2"><rect x="45" y="65" width="90" height="55"/><rect x="240" y="65" width="90" height="55"/><path d="M135 92h105"/><rect x="150" y="165" width="90" height="50" stroke="#6354ff"/><path d="M195 92v73"/></g></svg>'],{type:'image/svg+xml'});}
     renderStudioNavigator();},setCloudError(){const source=studioNavigatorSourceStates.get('cloud');source.status='error';source.error='Test offline';source.signIn=false;renderStudioNavigator();},
     setTab:setStudioNavigatorTab,render:renderStudioNavigator,groups:()=>studioNavigatorWorkGroups(),setMcp:syncStudioNavigatorMcp,
     status:syncStudioNavigatorMcpPresentation,opened:[],installSpies(){openStudioConversation=async(group,conversation)=>sidebarTest.opened.push([group.canvasKey,conversation.id]);},
     follow:()=>studioMcpFollowLatest};window.PenEchoStudioNavigator = Object.freeze({`);
   source=source.replace(/\}\)\(\);\s*$/,`window.sidebarRuntime={state,canvasDocuments,mcpRuntime,canvasAgent,setLanguage(value){state.language=value;applyLanguage();},loadCount:0};requestLoadSnapshot=async()=>{sidebarRuntime.loadCount++;return true;};})();`);
   return new Response(source,{headers:{'Content-Type':'text/javascript'}});
  }
  if(/\/api\/canvases\/test-\d+\/preview/.test(url.pathname)){
    report.previewRequests.push(url.pathname);
    return new Response(JSON.stringify({preview:'data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="250"><rect x="70" y="70" width="260" height="110" fill="white" stroke="#6354ff"/><path d="M90 100h160m-160 30h120" stroke="#9ba2b2"/></svg>').toString('base64')}),{headers:{'Content-Type':'application/json'}});
  }
  if(request.method!=='GET')return new Response('{}',{status:403,headers:{'Content-Type':'application/json'}});
  const filename=path.join(root,'public',url.pathname==='/'?'index.html':url.pathname);
  if(fs.existsSync(filename)&&fs.statSync(filename).isFile())return new Response(fs.readFileSync(filename),{headers:{'Content-Type':filename.endsWith('.css')?'text/css':filename.endsWith('.js')?'text/javascript':filename.endsWith('.html')?'text/html':'application/octet-stream'}});
  return net.fetch(request,{bypassCustomProtocolHandlers:true});
 });
 win=new BrowserWindow({show:false,width:1440,height:1050,webPreferences:{session:partition,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
 await win.loadURL(origin);const js=code=>win.webContents.executeJavaScript(code,true);
 for(let i=0;i<100&&!await js('!!window.sidebarTest&&!!window.sidebarRuntime');i++)await pause(100);
 assert.equal(await js('!!window.sidebarTest&&!!window.sidebarRuntime'),true,'Runtime initialized');
 await js(`window.addEventListener('error',e=>{window.sidebarErrors??=[];sidebarErrors.push(e.message)});document.querySelector('#tourSkip')?.click();document.querySelector('#changelogClose')?.click();document.querySelectorAll('dialog[open]').forEach(d=>d.close());sidebarRuntime.setLanguage('en');document.body.dataset.theme='studio';if(document.querySelector('#studioNavigatorToggle').getAttribute('aria-expanded')!=='true')document.querySelector('#studioNavigatorToggle').click();`);await pause(500);
 const current=await js('sidebarRuntime.canvasDocuments.activeId'),now=Date.now();
 const names=['PenEcho 项目架构图','图形类型实测 · 架构图','英国 15 天环岛旅行地图','Untitled Canvas','PenEcho 用户使用工作流','图形类型实测 · 时序图','交互式公式计算器','会议手写记录','Greeting and introduction'];
 const groups=names.map((name,i)=>({canvasKey:i===3?'draft:unsaved':`${['server','cloud','device'][i%3]}:test-${i}`,documentId:i===0?current:i<6||i===8?'doc-'+i:undefined,current:i===0,name,location:i===3?'':['server','cloud','device'][i%3],item:i===3?null:{id:'test-'+i,hasPreview:i===0,createdAt:now-i*86400000},savedAt:now-i*86400000,updatedAt:now-i*86400000,unseen:i===1||i===4,conversations:i===0?[{id:'chat-a',title:'补充 MCP 服务层',updatedAt:now-60000,items:[{type:'message',role:'user',text:'补充服务层'},{type:'message',role:'assistant',text:'已在右侧新增 MCP 服务与 Cloud 中继两个节点。'}]},{id:'chat-b',title:'解释桌面封装链路',updatedAt:now-120000,items:[{type:'message',role:'assistant',text:'Electron 主进程负责窗口与本地服务启动。'}]}]:i===4?[{id:'chat-c',title:'画出注册到首次保存的流程',updatedAt:now-30000,items:[{type:'message',role:'assistant',text:'好的，我按用户旅程分成 5 个阶段。'}]}]:i===5?[{id:'chat-d',title:'时序图：OAuth 登录',updatedAt:now-3*86400000,items:[{type:'message',role:'assistant',text:'浏览器 → 网关 → 认证服务，共 7 步。'}]}]:[]}));
 await js(`sidebarTest.setGroups(${JSON.stringify(groups)});sidebarTest.installSpies();sidebarRuntime.canvasAgent.currentConversation={id:'chat-a'};sidebarRuntime.state.currentSnapshotId='test-0';sidebarRuntime.state.currentSnapshotLocation='server';sidebarTest.setTab('all');`);
 const screenshot=async name=>{await pause(150);const r=await js(`(()=>{const r=document.querySelector('#studioNavigator').getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)}})()`);fs.writeFileSync(path.join(out,name+'.png'),(await win.webContents.capturePage(r)).toPNG());};
 const checkGeometry=async()=>{const info=await js(`(()=>{const nav=document.querySelector('#studioNavigator'),body=nav.querySelector('.studio-navigator-body'),foot=nav.querySelector('footer');return {width:nav.clientWidth,scroll:nav.scrollWidth,bodyRight:body.getBoundingClientRect().right,navRight:nav.getBoundingClientRect().right,searchHit:(()=>{const input=nav.querySelector("input"),r=input.getBoundingClientRect();return document.elementFromPoint(r.x+5,r.y+5)===input;})(),footerBottom:foot.getBoundingClientRect().bottom,navBottom:nav.getBoundingClientRect().bottom,tabs:[...nav.querySelectorAll('[role=tab]')].filter(e=>e.getClientRects().length).length}})()`);assert.ok(info.scroll<=info.width+1,JSON.stringify(info));assert.ok(Math.abs(info.navBottom-info.footerBottom)<2,JSON.stringify(info));assert.equal(info.tabs,4);assert.equal(info.searchHit,true,"Search field must remain clickable above the scroll body");};
 assert.equal(await js(`document.querySelectorAll('#studioNavigatorOpenList .studio-navigator-open-item').length`),4);
 await js(`document.querySelector('#studioNavigatorOpenMore').click()`);assert.equal(await js(`document.querySelectorAll('#studioNavigatorOpenList .studio-navigator-open-item').length`),7);
 await js(`document.querySelector('#studioNavigatorOpenToggle').click()`);assert.equal(await js(`document.querySelector('#studioNavigatorOpenList').hidden`),true);
 await js(`document.querySelector('#studioNavigatorOpenToggle').click();document.querySelector('#studioNavigatorOpenMore').click();document.querySelector('#studioWorkRecentList .studio-navigator-chat-toggle').click()`);
 assert.equal(await js(`document.querySelector('#studioWorkRecentList .studio-navigator-group-conversations').hidden`),false);
 await checkGeometry();await screenshot('all');assert.ok(report.previewRequests.includes('/api/canvases/test-0/preview'),'Server metadata loads a thumbnail lazily');assert.equal(await js(`document.querySelector('#studioWorkRecentList img').naturalWidth`),400);report.checks.push('All: four initial open rows, seven expanded rows, section collapse, nested conversations and fixed footer.');
 await js(`sidebarTest.setTab('canvas');sidebarTest.setCloudError()`);
 assert.equal(await js(`document.querySelectorAll('#studioCanvasRecentList .studio-navigator-canvas-card').length`),8);
 assert.equal(await js(`getComputedStyle(document.querySelector('#studioCanvasRecentList')).gridTemplateColumns.split(' ').length`),2);
 assert.equal(await js(`document.querySelectorAll('#studioCanvasRecentList .studio-navigator-canvas-state').length`),6);
 assert.equal(await js(`document.querySelector('#studioNavigatorOpenSection').hidden`),true);
 await checkGeometry();await screenshot('canvases');
 await js(`document.querySelector('#studioNavigatorLocations [data-location=device]').click()`);assert.equal(await js(`document.querySelectorAll('#studioCanvasRecentList .studio-navigator-canvas-card').length`),3);
 assert.equal(await js(`!!document.querySelector('#studioCanvasRecentList .studio-navigator-source-state[data-tone=error]')`),false);
 await js(`document.querySelector('#studioNavigatorLocations [data-location=all]').click();document.querySelector('#studioNavigatorSort').value='name';document.querySelector('#studioNavigatorSort').dispatchEvent(new Event('change'));`);
 const sorted=await js(`[...document.querySelectorAll('#studioCanvasRecentList .studio-navigator-item-body strong')].map(e=>e.textContent)`);assert.deepEqual(sorted,[...sorted].sort((a,b)=>a.localeCompare(b,'en')));
 report.checks.push('Canvases: real counts, two columns, current/open badges, location filtering, name sorting and scoped Cloud failure.');
 await js(`sidebarTest.setTab('agent')`);
 assert.deepEqual(await js(`[...document.querySelectorAll('#studioAgentRecentList [data-conversation-id]')].map(e=>e.dataset.conversationId)`),['chat-c','chat-a','chat-b','chat-d']);
 assert.ok(await js(`document.querySelector('#studioAgentRecentList .studio-navigator-chat-context').textContent.includes('1 message')`));
 await screenshot('chats');await checkGeometry();
 await js(`document.querySelector('#studioAgentRecentList [data-conversation-id=chat-a]').click()`);assert.deepEqual(await js(`sidebarTest.opened.at(-1)`),['server:test-0','chat-a']);
 await js(`document.querySelector('#studioAgentRecentList .studio-navigator-session-delete').click()`);assert.equal(await js(`document.querySelector('#studioSessionDeleteDialog').open`),true);await js(`document.querySelector('#studioSessionDeleteDialog').close()`);
 await js(`document.querySelector('#studioNavigatorSearch').value='Electron';document.querySelector('#studioNavigatorSearch').dispatchEvent(new Event('input'));`);assert.equal(await js(`document.querySelectorAll('#studioAgentRecentList [data-conversation-id]').length`),1);
 await js(`document.querySelector('#studioNavigatorSearch').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));`);assert.deepEqual(await js(`sidebarTest.opened.at(-1)`),['server:test-0','chat-b']);
 await js(`document.querySelector('#studioNavigatorSearch').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));`);
 report.checks.push('Chats: independent conversation chronology, summaries/counts, correct canvas/conversation target, deletion dialog and summary search with Enter.');
 await js(`for(const group of sidebarTest.groups().filter(g=>g.documentId)){let doc=sidebarRuntime.canvasDocuments.records.get(group.documentId);if(!doc){doc={id:group.documentId,changes:[]};sidebarRuntime.canvasDocuments.records.set(doc.id,doc);}doc.title=group.name;doc.unseen=group.unseen?3:0;if(group.documentId!=='doc-3')doc.bindings=[{}];}
  const r=sidebarRuntime.mcpRuntime;r.ready=true;r.socket={readyState:1,availability:{local:true,cloud:true},send(){}};r.sessions=new Map([['claude',{sessionId:'claude',documentId:${JSON.stringify(current)},client:'Claude Code',artifacts:new Map()}],['codex',{sessionId:'codex',documentId:'doc-1',client:'Codex',artifacts:new Map()}]]);r.activeMutation='Claude Code';r.mutationDocumentId=${JSON.stringify(current)};sidebarTest.setMcp(true,{reveal:false});sidebarTest.setTab('mcp');`);
 assert.equal(await js(`document.querySelectorAll('.studio-navigator-mcp-session').length`),2);
 assert.equal(await js(`document.querySelector('.studio-navigator-mcp-status-heading').textContent`),'MCP · OnlineLocal + Cloud');
 assert.equal(await js(`document.querySelectorAll('#studioMcpRecentList .studio-navigator-ai-canvas').length`),5);
 assert.equal(await js(`document.querySelector('#studioNavigatorAiTitle').textContent`),'Canvases from AI · 6');
 assert.equal(await js(`!!document.querySelector('#studioMcpRecentList [data-workspace-document-id="doc-3"]')`),false);
 assert.equal(await js(`document.querySelector('#studioMcpRecentList .studio-navigator-ai-canvas').dataset.updating`),'true');
 const follow=await js('sidebarTest.follow()');await js(`document.querySelector('#studioMcpFollowLatest').click()`);assert.equal(await js('sidebarTest.follow()'),!follow);
 await checkGeometry();await screenshot('mcp');await js(`sidebarTest.setTab('all')`);await screenshot('all-connected');assert.equal(await js(`document.querySelector('#studioNavigatorOpenList .mcp-sidebar-badge').textContent`),'Claude Code');await js(`sidebarTest.setTab('mcp')`);
 await js(`document.querySelector('#studioMcpRecentList .studio-navigator-show-more').click()`);assert.equal(await js(`document.querySelectorAll('#studioMcpRecentList .studio-navigator-ai-canvas').length`),6);
 await js(`document.querySelector('#studioMcpMore').click()`);assert.equal(await js(`document.querySelector('#studioMcpMenu').hidden`),false);await js(`document.querySelector('#studioMcpMore').click()`);
 await js(`sidebarRuntime.mcpRuntime.ready=false;sidebarRuntime.mcpRuntime.socket=null;sidebarRuntime.mcpRuntime.activeMutation=null;sidebarTest.setMcp(false);sidebarTest.status();`);
 assert.equal(await js(`document.querySelector('#studioNavigator').dataset.tab`),'mcp');assert.equal(await js(`document.querySelectorAll('.studio-navigator-mcp-session').length`),0);assert.equal(await js(`!!document.querySelector('.studio-navigator-mcp-connect')`),true);
 await screenshot('mcp-offline');report.checks.push('MCP: live clients/status, AI-only documents, unread groups, pagination, Follow switch, overflow actions and retained offline view.');
 await js(`sidebarRuntime.setLanguage('zh');sidebarTest.setTab('canvas');document.querySelector('#studioNavigatorSort').value='modified';document.querySelector('#studioNavigatorSort').dispatchEvent(new Event('change'));`);await screenshot('canvases-zh');
 assert.equal(await js(`document.querySelector('#studioNavigatorSearch').placeholder`),'搜索画布…');
 win.webContents.sendInputEvent({type:'keyDown',keyCode:'K',modifiers:['meta']});win.webContents.sendInputEvent({type:'keyUp',keyCode:'K',modifiers:['meta']});await pause(250);assert.equal(await js(`document.activeElement.id`),'studioNavigatorSearch');
 await js(`document.querySelector('#studioNavigatorManage').click()`);await pause(150);assert.equal(await js(`document.querySelector('#historyPanel').classList.contains('open')`),true);await js(`document.querySelector('#historyClose').click()`);
 win.setSize(390,844);await pause(350);await js(`sidebarTest.setTab('canvas');if(document.querySelector('#studioNavigatorToggle').getAttribute('aria-expanded')!=='true')document.querySelector('#studioNavigatorToggle').click();`);await pause(400);await checkGeometry();await screenshot('narrow-zh');
 report.checks.push('Lazy Server thumbnail retrieval and connected client badges; Chinese copy, Command+K search, Library destination and 390px viewport without overflow.');
 win.setSize(1440,1050);await pause(200);await js(`sidebarRuntime.setLanguage('en');sidebarTest.setTab('agent');sidebarRuntime.canvasAgent.currentConversation=null;sidebarRuntime.canvasAgent.history=[];sidebarRuntime.canvasAgent.running=false;sidebarRuntime.canvasAgent.socket=null;`);
 await js(`document.querySelector('#studioNavigatorNewChat').click()`);await pause(250);assert.equal(await js(`document.body.classList.contains('canvas-agent-open')`),true);assert.ok(await js(`!!sidebarRuntime.canvasAgent.currentConversation?.id`));report.checks.push('New chat opens the Agent and creates a fresh local conversation.');
 report.errors=await js('window.sidebarErrors||[]');assert.deepEqual(report.errors,[]);
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }catch(error){console.error(error);if(win)fs.writeFileSync(path.join(out,'failure.png'),(await win.webContents.capturePage()).toPNG());app.exitCode=1;}finally{win?.destroy();app.exit(app.exitCode||0);}});
