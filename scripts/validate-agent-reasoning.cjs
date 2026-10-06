// Independent Chromium checks for isolated real-provider benchmark results.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const directory=path.resolve(process.argv[2]||'docs/verification/agent-reasoning-20261002/pilot');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'penecho-reasoning-validation-'));
app.setPath('userData',path.join(temporary,'profile'));
const fixtures=JSON.parse(fs.readFileSync(path.join(directory,'fixtures.json'),'utf8'));
const samples=fs.readdirSync(directory).filter(n=>/^(deepseek|glm)-.*-r\d+\.json$/.test(n)).map(n=>JSON.parse(fs.readFileSync(path.join(directory,n),'utf8')));
const output=path.join(directory,'validation.json'),rows=[];
let win;
const check=(checks,name,condition,details)=>checks.push({name,passed:!!condition,...(details===undefined?{}:{details})});
const clock=`<script>window.__clock=0;window.__intervals=new Map;window.__nextInterval=1;window.setInterval=(fn)=>{const id=__nextInterval++;__intervals.set(id,fn);return id;};window.clearInterval=id=>__intervals.delete(id);Date.now=()=>__clock;window.__tick=n=>{for(let i=0;i<n;i++){__clock+=1000;for(const f of [...__intervals.values()])f();}};</script>`;
app.whenReady().then(async()=>{
 try{
  win=new BrowserWindow({show:false,width:1000,height:750,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});
  win.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(details,callback)=>callback({cancel:true}));
  let errors=[];win.webContents.on('console-message',(_event,level,message)=>{if(level>=3&&!message.startsWith('ResizeObserver loop'))errors.push(message.slice(0,250));});
  const js=code=>win.webContents.executeJavaScript(code,true);
  const load=async(html,width,height,timer=false)=>{errors=[];win.setSize(width,height);const text=timer?html.replace(/<head[^>]*>/i,match=>match+clock):html;await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(text));await new Promise(done=>setTimeout(done,120));};
  const snapshot=async name=>{fs.writeFileSync(path.join(directory,name+'.png'),(await win.webContents.capturePage()).toPNG());};
  const facts=()=>js(`(()=>{const records=[],occurrences=new Map;for(const e of document.querySelectorAll('body *')){if(['SCRIPT','STYLE'].includes(e.tagName))continue;const text=[...e.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent.trim()).join('').trim();if(!text)continue;const base=e.tagName+'|'+text;const n=occurrences.get(base)||0;occurrences.set(base,n+1);let size=parseFloat(getComputedStyle(e).fontSize);if(e instanceof SVGElement){const m=e.getScreenCTM();if(m)size*=Math.hypot(m.a,m.b);}records.push({key:base+'|'+n,size});}let svgClip=0;for(const e of document.querySelectorAll('svg text')){const a=e.getBoundingClientRect(),b=e.closest('svg').getBoundingClientRect();if(a.left<b.left-1||a.right>b.right+1||a.top<b.top-1||a.bottom>b.bottom+1)svgClip++;}return {text:document.body.innerText.replace(/\\s+/g,' ').trim(),records,svgClip,horizontalOverflow:document.documentElement.scrollWidth>innerWidth+2,svgCount:document.querySelectorAll('svg').length,scriptCount:document.scripts.length};})()`);
  for(const row of samples){
   const f=fixtures.find(c=>c.id===row.case),checks=[];
   check(checks,'Model turn completed',row.termination==='completed',row.termination);
   check(checks,'Unrelated Widgets were not read or changed',row.scopePreserved);
   try{if(f.kind==='answer'){
    const t=row.finalText;check(checks,'Correct final amount and yuan units',/2[,]?098[.]8(?:0)?/.test(t)&&/元/.test(t));
    check(checks,'Correct subtotal and discounted amount',/2[,]?200/.test(t)&&/1[,]?980/.test(t));
    check(checks,'No unrequested Canvas mutation',row.mutations.length===0);
   }else if(f.kind==='clarify'){
    check(checks,'Asks which object or element',/[?？]|哪个|哪一个|指的是|具体/.test(row.finalText));
    check(checks,'Makes no guessed edit',row.mutations.length===0);
   }else{
    const source=f.kind==='edit'?row.resultFiles['objects/widget-13/widget.html']:row.created.at(-1)?.html;
    check(checks,'Required Widget source exists',!!source);
    check(checks,'Only requested object changes',f.kind==='edit'?row.mutations.length>0&&row.mutations.every(m=>m.path==='objects/widget-13/widget.html'):row.created.length===1&&row.mutations.every(m=>m.name==='penecho_present_widget'||m.path?.startsWith('objects/widget-new-')));
    if(source){
     let before;if(f.html){await load(f.html,f.width,f.height);before=await facts();if(f.id==='overview')await snapshot('overview-before');}
     await load(source,f.width||750,f.height||500,f.id==='timer');
     const after=await facts();check(checks,'No Chromium runtime error',errors.length===0,[...errors]);
     if(f.id==='overview'){
      const a=new Map(after.records.map(r=>[r.key,r.size])),ratios=before.records.filter(r=>a.has(r.key)).map(r=>a.get(r.key)/r.size).sort((a,b)=>a-b);
      const median=ratios[Math.floor(ratios.length/2)],enlarged=ratios.filter(r=>r>=1.15).length/ratios.length;
      check(checks,'Preserves all visible text and SVG diagrams',before.text===after.text&&before.svgCount===after.svgCount,{beforeSvg:before.svgCount,afterSvg:after.svgCount,sameText:before.text===after.text});
      check(checks,'Text and SVG labels visibly enlarged',median>=1.15&&enlarged>=.75,{matched:ratios.length,medianRatio:median,enlargedFraction:enlarged});
      check(checks,'No new clipping or horizontal overflow',!after.horizontalOverflow&&after.svgClip<=before.svgClip,{beforeClip:before.svgClip,afterClip:after.svgClip,horizontalOverflow:after.horizontalOverflow});
     }
     if(f.id==='timer'){
      const values=await js(`(()=>{const text=()=>Number(document.querySelector('#display').textContent);document.querySelector('#start').click();__tick(1);const started=text();document.querySelector('#pause').click();__tick(4);const paused=text();document.querySelector('#start').click();__tick(1);const resumed=text();document.querySelector('#start').click();__tick(1);const duplicate=text();document.querySelector('#reset').click();__tick(2);return {started,paused,resumed,duplicate,reset:text(),activeIntervals:__intervals.size};})()`);
      check(checks,'Start, pause, resume and single interval',values.started===9&&values.paused===9&&values.resumed===8&&values.duplicate===7,values);
      check(checks,'Reset stops timer and restores 10',values.reset===10&&values.activeIntervals===0,values);
      check(checks,'Preserves existing visible controls and content',before.text===after.text);
     }
     if(f.id==='labels'){
      check(checks,'Only requested text changes',after.text===before.text.replace('李华','王丽'));
      const behavior=await js(`(()=>{const e=document.querySelector('#detail'),b=document.querySelector('#expand');const first=e.hidden;b.click();const second=e.hidden;b.click();return first===true&&second===false&&e.hidden===true;})()`);
      check(checks,'Existing expand control still works',behavior);
     }
     if(f.id==='graph'){
      const g=await js('JSON.parse(JSON.stringify(graph))'),ids=g.nodes.map(n=>n.id).sort();
      const edgeKeys=g.edges.map(e=>e.from+'>'+e.to).sort();
      check(checks,'Correct retained nodes and labels',JSON.stringify(ids)===JSON.stringify(['a','c','d'])&&g.nodes.every(n=>({a:'客户端',c:'数据库',d:'新网关'}[n.id]===n.label)),g.nodes);
      check(checks,'Correct edges without dangling references',JSON.stringify(edgeKeys)===JSON.stringify(['a>d','d>c'])&&g.edges.every(e=>ids.includes(e.from)&&ids.includes(e.to))&&g.edges.find(e=>e.from==='d'&&e.to==='c')?.id==='dc'&&new Set(g.edges.map(e=>e.id)).size===g.edges.length,g.edges);
      check(checks,'Rendered labels reflect graph',!after.text.includes('旧网关')&&['客户端','数据库','新网关'].every(v=>after.text.includes(v)));
     }
     if(f.id==='calculator'){
      check(checks,'Initial total is 99.75 yuan',/99[.]75/.test(after.text)&&/元|¥|￥/.test(after.text));
      const behavior=await js(`(()=>{const inputs=[...document.querySelectorAll('input')];const q=inputs.find(e=>Number(e.value)===3),p=inputs.find(e=>Number(e.value)===35),d=inputs.find(e=>Number(e.value)===5);if(!q||!p||!d)return {error:'Missing quantity, price or discount inputs'};const set=(e,v)=>{e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));};set(q,5);set(p,20);set(d,10);const updated=document.body.innerText;set(q,0);const zero=document.body.innerText;return {updated,zero};})()`);
      check(checks,'Input changes compute 90 yuan and zero quantity',!behavior.error&&behavior.updated!==behavior.zero&&/(?:^|[^\\d])90(?:[.]0+)?(?:[^\\d]|$)/.test(behavior.updated)&&/(?:^|[^\\d])0(?:[.]0+)?(?:[^\\d]|$)/.test(behavior.zero),behavior);
     }
     if(f.id==='chart'){
      const sourceHas=v=>source.includes(v)||after.text.includes(v);
      check(checks,'All months, values, units and average retained',['1月','2月','3月','12','18','15','万元'].every(sourceHas)&&/平均/.test(source+after.text));
      const chart=await js(`({svg:document.querySelectorAll('svg').length,primitives:document.querySelectorAll('svg rect,svg path,svg polygon').length,canvas:document.querySelectorAll('canvas').length})`);
      check(checks,'Renders a chart locally',chart.primitives>=3||chart.canvas>0,chart);
      if(chart.svg&&chart.primitives>=3){
       const geometry=await js(`(()=>{const rects=[...document.querySelectorAll('svg rect,svg path,svg polygon')].filter(e=>!e.closest('defs')&&getComputedStyle(e).fill!=='none').map(e=>{const b=e.getBoundingClientRect();return {x:b.x,y:b.y,w:b.width,h:b.height};}).filter(r=>r.w>0&&r.h>0);for(const a of rects){const group=rects.filter(r=>Math.abs(r.w-a.w)<.2).sort((a,b)=>a.x-b.x);if(group.length!==3)continue;const [p,q,r]=group,bottoms=group.map(r=>r.y+r.h);if(Math.abs(q.h/p.h-1.5)<.03&&Math.abs(r.h/p.h-1.25)<.03&&Math.max(...bottoms)-Math.min(...bottoms)<2)return {correct:true,bars:group};}return {correct:false,rects};})()`);
       check(checks,'Bar heights correctly encode 12, 18 and 15',geometry.correct,geometry);
      }
     }
     await snapshot(row.id);
    }
   }
   }catch(e){check(checks,'Independent validation executed',false,String(e.message).slice(0,300));}
   const result={id:row.id,model:row.model,variant:row.variant,case:row.case,repeat:row.repeat,passed:checks.every(c=>c.passed),checks};rows.push(result);
   console.log(JSON.stringify({id:row.id,passed:result.passed,failed:checks.filter(c=>!c.passed).map(c=>c.name)}));
  }
  fs.writeFileSync(output,JSON.stringify({checkedAt:new Date().toISOString(),samples:rows},null,2)+'\n');
 }catch(e){console.error(e.stack);process.exitCode=1;}
 finally{win?.destroy();fs.rmSync(temporary,{recursive:true,force:true});app.quit();}
});
