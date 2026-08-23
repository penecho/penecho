"use strict";
(() => {
  const PLAN_SELECTOR = "script[type='application/json'][data-penecho-visual-explainer]",
    ROOT_ID = "penecho-visual-explainer",
    STYLE_ID = "penecho-visual-explainer-style",
    ANT_KINDS = new Set(["flow","timeline","hierarchy","relationship"]),
    DEFAULT_PALETTE = ["#2563eb","#0891b2","#16a34a","#ea580c","#7c3aed","#dc2626"];

  const text = value => String(value ?? ""),
    element = (tag,className,content) => {
      const node=document.createElement(tag);
      if(className)node.className=className;
      if(content!==undefined)node.textContent=text(content);
      return node;
    };
  function addText(parent,tag,className,value) {
    if(value===undefined||value===null||value==="")return null;
    const node=element(tag,className,value);parent.append(node);return node;
  }
  function styleSheet(accent) {
    const style=element("style");
    style.id=STYLE_ID;
    style.textContent=`
      :root{
        --vex-accent:${accent};
        --vex-ink:#172033;
        --vex-muted:#526278;
        --vex-line:#d9e1ec;
        --vex-panel:rgba(255,255,255,.94);
        --vex-soft:#f5f8fc;
        --vex-good:#15803d;
        --vex-warn:#c2410c;
        --vex-blocked:#b91c1c;
        color-scheme:light;
      }
      *{box-sizing:border-box}
      html,body{
        margin:0;
        width:100%;
        height:100%;
        overflow:hidden;
        background:transparent;
        color:var(--vex-ink);
        font-family:Inter,"PingFang SC","Microsoft YaHei",system-ui,sans-serif;
      }
      #${ROOT_ID}{
        container-type:inline-size;
        width:100%;
        height:100%;
        display:grid;
        grid-template-rows:auto auto minmax(0,1fr) auto;
        gap:18px;
        padding:24px;
        overflow:hidden;
        border:1px solid rgba(148,163,184,.42);
        border-radius:24px;
        background:linear-gradient(145deg,rgba(255,255,255,.98),rgba(246,249,253,.96));
        box-shadow:0 18px 56px rgba(15,23,42,.12);
      }
      .vex-head{display:flex;align-items:flex-start;justify-content:space-between;gap:24px}
      .vex-eyebrow{margin-bottom:6px;color:var(--vex-accent);font-size:clamp(16px,.72cqw,20px);font-weight:800;letter-spacing:.09em;text-transform:uppercase}
      .vex-title{margin:0;font-size:clamp(42px,3.1cqw,68px);line-height:1.05;letter-spacing:-.035em}
      .vex-subtitle{max-width:1100px;margin:10px 0 0;color:var(--vex-muted);font-size:clamp(19px,1cqw,24px);line-height:1.5}
      .vex-count{flex:none;padding:10px 14px;border:1px solid color-mix(in srgb,var(--vex-accent) 40%,white);border-radius:999px;background:color-mix(in srgb,var(--vex-accent) 8%,white);color:var(--vex-accent);font-size:clamp(15px,.7cqw,18px);font-weight:750;white-space:nowrap}
      .vex-takeaways{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px}
      .vex-takeaway{display:flex;gap:10px;align-items:flex-start;min-width:0;padding:10px 13px;border-radius:11px;background:color-mix(in srgb,var(--vex-accent) 7%,white);font-size:clamp(18px,.9cqw,23px);line-height:1.45}
      .vex-takeaway::before{content:"◆";flex:none;margin-top:.45em;color:var(--vex-accent);font-size:.55em}
      .vex-antv{width:100%;height:100%;min-height:0;overflow:hidden}
      .vex-antv svg{display:block;width:100%!important;height:100%!important;max-width:100%;max-height:100%;overflow:visible}
      .vex-fallback{height:100%;display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;align-content:center;overflow:hidden}
      .vex-card{min-width:0;padding:11px 12px;border:1px solid var(--vex-line);border-radius:11px;background:var(--vex-soft)}
      .vex-card-line{display:flex;align-items:flex-start;gap:10px}
      .vex-index{display:grid;place-items:center;flex:none;width:30px;height:30px;border-radius:50%;background:var(--vex-accent);color:white;font-size:15px;font-weight:800}
      .vex-card-title{font-size:clamp(20px,1cqw,26px);font-weight:800;line-height:1.3}
      .vex-card-desc,.vex-meta{margin-top:5px;color:var(--vex-muted);font-size:clamp(18px,.9cqw,23px);line-height:1.48}
      .vex-details{margin:8px 0 0;padding-left:20px;color:#475569;font-size:clamp(17px,.82cqw,21px);line-height:1.48}
      .vex-value{margin-top:7px;color:var(--vex-accent);font-size:clamp(22px,1.05cqw,29px);font-weight:850}
      .vex-status{display:inline-flex;margin-top:7px;padding:4px 8px;border-radius:999px;background:#e2e8f0;color:#475569;font-size:14px;font-weight:750;text-transform:uppercase}
      .vex-status[data-status="done"]{background:#dcfce7;color:var(--vex-good)}
      .vex-status[data-status="warning"]{background:#ffedd5;color:var(--vex-warn)}
      .vex-status[data-status="blocked"]{background:#fee2e2;color:var(--vex-blocked)}
      .vex-timeline{height:100%;display:grid;align-content:center;gap:9px;overflow:hidden}
      .vex-event{display:grid;grid-template-columns:minmax(90px,.28fr) 22px minmax(0,1fr);gap:10px;align-items:start}
      .vex-event-time{padding-top:2px;color:var(--vex-accent);font-size:clamp(18px,.85cqw,22px);font-weight:800;text-align:right}
      .vex-rail{position:relative;align-self:stretch;min-height:42px}
      .vex-rail::before{content:"";position:absolute;left:10px;top:0;bottom:-10px;width:2px;background:var(--vex-line)}
      .vex-rail::after{content:"";position:absolute;left:4px;top:3px;width:13px;height:13px;border:2px solid white;border-radius:50%;background:var(--vex-accent);box-shadow:0 0 0 1px var(--vex-accent)}
      .vex-event:last-child .vex-rail::before{bottom:calc(100% - 16px)}
      .vex-event-body{padding-bottom:5px}
      .vex-event-title{font-size:clamp(19px,.95cqw,24px);font-weight:800}
      .vex-event-desc{margin-top:3px;color:var(--vex-muted);font-size:clamp(17px,.82cqw,21px);line-height:1.45}
      .vex-route{height:100%;display:flex;align-items:center;gap:6px;overflow:hidden}
      .vex-stop{flex:1;min-width:0;text-align:center}
      .vex-stop-dot{display:grid;place-items:center;width:34px;height:34px;margin:0 auto 8px;border-radius:50%;background:var(--vex-accent);color:white;font-size:16px;font-weight:850}
      .vex-stop-title{font-size:clamp(19px,.95cqw,24px);font-weight:800;line-height:1.25}
      .vex-stop-place{margin-top:4px;color:var(--vex-muted);font-size:clamp(17px,.82cqw,21px);line-height:1.35}
      .vex-route-arrow{flex:none;color:var(--vex-accent);font-size:26px;font-weight:900}
      .vex-table-wrap{height:100%;display:grid;align-content:center;overflow:hidden}
      .vex-table{width:100%;border-collapse:separate;border-spacing:0;font-size:clamp(18px,.85cqw,22px);line-height:1.4}
      .vex-table th,.vex-table td{padding:8px 9px;border-right:1px solid var(--vex-line);border-bottom:1px solid var(--vex-line);text-align:left;vertical-align:top}
      .vex-table th{background:color-mix(in srgb,var(--vex-accent) 9%,white);font-weight:800}
      .vex-table tr:first-child th{border-top:1px solid var(--vex-line)}
      .vex-table th:first-child,.vex-table td:first-child{border-left:1px solid var(--vex-line)}
      .vex-table tr:first-child th:first-child{border-top-left-radius:8px}
      .vex-table tr:first-child th:last-child{border-top-right-radius:8px}
      .vex-matrix{height:100%;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;align-content:center;overflow:hidden}
      .vex-matrix-group{min-width:0;align-self:start;padding:11px;border:1px solid var(--vex-line);border-radius:10px;background:var(--vex-soft)}
      .vex-matrix-label{margin-bottom:7px;color:var(--vex-accent);font-size:clamp(19px,.95cqw,24px);font-weight:850}
      .vex-matrix-item{padding:6px 0;border-top:1px dashed var(--vex-line);font-size:clamp(18px,.88cqw,22px);line-height:1.4}
      .vex-matrix-item:first-of-type{border-top:0}
      .vex-annotations{display:flex;gap:10px;overflow:hidden}
      .vex-note{min-width:0;flex:1;padding:10px 12px;border-left:3px solid var(--vex-accent);border-radius:5px;background:rgba(241,245,249,.86);color:#475569;font-size:clamp(18px,.85cqw,22px);line-height:1.45}
      #${ROOT_ID}[data-mode="current"]{
        --vex-title-px:52px;
        --vex-subtitle-px:22px;
        --vex-region-title-px:25px;
        --vex-body-px:18px;
        --vex-caption-px:15px;
        position:relative;
        grid-template-rows:auto auto minmax(0,1fr) auto;
        gap:12px;
        padding:18px;
        border-radius:18px;
      }
      #${ROOT_ID}[data-mode="current"] .vex-title{font-size:var(--vex-title-px)}
      #${ROOT_ID}[data-mode="current"] .vex-subtitle{font-size:var(--vex-subtitle-px)}
      .vex-region-grid{position:relative;z-index:1;min-height:0;display:grid;grid-template-columns:repeat(var(--vex-region-columns,12),minmax(0,1fr));grid-template-rows:repeat(var(--vex-region-rows,1),minmax(0,1fr));gap:12px;overflow:hidden}
      .vex-region{position:relative;min-width:0;min-height:0;grid-column:var(--vex-column-start)/span var(--vex-column-span);grid-row:var(--vex-row-start)/span var(--vex-row-span);display:grid;grid-template-rows:auto minmax(0,1fr);overflow:hidden;border:1.5px solid color-mix(in srgb,var(--vex-accent) 48%,var(--vex-line));border-radius:13px;background:rgba(255,255,255,.95);box-shadow:0 4px 14px rgba(15,23,42,.045)}
      .vex-region[data-importance="primary"]{border-width:2px;box-shadow:0 7px 20px color-mix(in srgb,var(--vex-accent) 11%,transparent)}
      .vex-region[data-show-header="false"]{grid-template-rows:minmax(0,1fr)}
      .vex-region[data-show-header="false"]>.vex-region-head{display:none}
      .vex-region-head{position:relative;z-index:3;padding:9px 11px 7px;background:linear-gradient(180deg,color-mix(in srgb,var(--vex-accent) 7%,white),rgba(255,255,255,.85))}
      .vex-region-title{margin:0;font-size:var(--vex-region-title-px);line-height:1.18}
      .vex-region-summary{margin:3px 0 0;color:var(--vex-muted);font-size:var(--vex-caption-px);line-height:1.35}
      .vex-region-body{position:relative;z-index:1;min-height:0;overflow:hidden;padding:7px 9px 9px;font-size:var(--vex-body-px)}
      .vex-region-body>.vex-fallback,.vex-region-body>.vex-timeline,.vex-region-body>.vex-route,.vex-region-body>.vex-table-wrap,.vex-region-body>.vex-matrix{font-size:inherit}
      .vex-embedded{padding:0;background:color-mix(in srgb,var(--vex-accent) 2%,white)}
      .vex-embedded-frame{position:relative;z-index:1;display:block;width:100%;height:100%;border:0;background:transparent}
      .vex-embedded-snapshot{position:absolute;z-index:0;inset:0;width:100%;height:100%;object-fit:fill;pointer-events:none}
      .vex-port{position:absolute;z-index:4;width:10px;height:10px;border:2px solid white;border-radius:50%;background:var(--vex-accent);box-shadow:0 0 0 1px var(--vex-accent);transform:translate(-50%,-50%)}
      .vex-relations{position:absolute;z-index:2;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none}
      .vex-relation{fill:none;stroke:var(--vex-accent);stroke-width:2.2;stroke-linecap:round;opacity:.88;vector-effect:non-scaling-stroke}
      .vex-relation[data-kind="reference"]{stroke-dasharray:6 5;opacity:.65}
      .vex-relation-label{fill:var(--vex-ink);font-size:var(--vex-caption-px);font-weight:700;paint-order:stroke;stroke:white;stroke-width:5px;stroke-linejoin:round;text-anchor:middle}
      #${ROOT_ID}[data-region-columns="1"] .vex-count{display:none}
    `;
    return style;
  }
  function card(item,index) {
    const node=element("article","vex-card"),line=element("div","vex-card-line"),copy=element("div");
    line.append(element("span","vex-index",index+1),copy);addText(copy,"div","vex-card-title",item.label);addText(copy,"div","vex-card-desc",item.description);node.append(line);
    const meta=[item.time,item.location].filter(Boolean).join(" · ");addText(node,"div","vex-meta",meta);addText(node,"div","vex-value",item.value);
    if(item.status){const status=addText(node,"span","vex-status",item.status);status.dataset.status=item.status;}
    if(item.details?.length){const list=element("ul","vex-details");item.details.forEach(value=>list.append(element("li","",value)));node.append(list);}
    return node;
  }
  function renderCards(section) {
    const root=element("div","vex-fallback");section.items.forEach((item,index)=>root.append(card(item,index)));return root;
  }
  function renderSchedule(section) {
    const root=element("div","vex-timeline");section.items.forEach(item=>{const row=element("div","vex-event"),body=element("div","vex-event-body");row.append(element("div","vex-event-time",item.time||"—"),element("div","vex-rail"),body);addText(body,"div","vex-event-title",item.label);addText(body,"div","vex-event-desc",[item.location,item.description].filter(Boolean).join(" · "));root.append(row);});return root;
  }
  function renderRoute(section) {
    const root=element("div","vex-route");section.items.forEach((item,index)=>{if(index)root.append(element("span","vex-route-arrow","→"));const stop=element("div","vex-stop");stop.append(element("div","vex-stop-dot",index+1));addText(stop,"div","vex-stop-title",item.label);addText(stop,"div","vex-stop-place",item.location||item.time||item.description);root.append(stop);});return root;
  }
  function detailColumns(section) {
    const columns=[];for(const item of section.items)for(const detail of item.details||[]){const match=/^([^:：]{1,30})[:：]\s*(.+)$/.exec(detail);if(match&&!columns.includes(match[1]))columns.push(match[1]);}return columns.slice(0,6);
  }
  function renderTable(section) {
    const wrap=element("div","vex-table-wrap"),table=element("table","vex-table"),head=element("tr"),columns=detailColumns(section);
    [section.title,...columns,"状态"].forEach(label=>head.append(element("th","",label)));const thead=element("thead");thead.append(head);table.append(thead);const body=element("tbody");
    for(const item of section.items){const row=element("tr");row.append(element("td","",item.label));const pairs=new Map((item.details||[]).map(detail=>{const match=/^([^:：]{1,30})[:：]\s*(.+)$/.exec(detail);return match?[match[1],match[2]]:[detail,""];}));columns.forEach(column=>row.append(element("td","",pairs.get(column)||"—")));row.append(element("td","",item.status||item.value||item.time||"—"));body.append(row);}table.append(body);wrap.append(table);return wrap;
  }
  function renderMatrix(section) {
    const root=element("div","vex-matrix"),groups=new Map();for(const item of section.items){const group=item.group||item.status||"其他";if(!groups.has(group))groups.set(group,[]);groups.get(group).push(item);}for(const [label,items] of groups){const group=element("section","vex-matrix-group");group.append(element("div","vex-matrix-label",label));for(const item of items)group.append(element("div","vex-matrix-item",item.label));root.append(group);}return root;
  }
  function renderNative(section) {
    if(["schedule","timeline"].includes(section.kind))return renderSchedule(section);
    if(section.kind==="map")return renderRoute(section);
    if(section.kind==="table")return renderTable(section);
    if(section.kind==="matrix"||section.kind==="comparison")return renderMatrix(section);
    return renderCards(section);
  }
  function hierarchyRoot(section) {
    const byId=new Map(section.items.map(item=>[item.id,{label:item.label,desc:item.description||"",children:[]}])) , roots=[];
    for(const item of section.items){const node=byId.get(item.id);if(item.parentId&&byId.has(item.parentId))byId.get(item.parentId).children.push(node);else roots.push(node);}
    if(roots.length===1)return roots[0];return {label:section.title,desc:section.summary||"",children:roots};
  }
  function antvOptions(section,palette,shape) {
    shape=shape||{};
    const horizontal=Number(shape.width||0)>=Math.max(1,Number(shape.height||0))*1.18;
    const base={data:{},themeConfig:{palette},svg:{background:false}};
    if(section.kind==="flow")return {...base,template:horizontal?(section.items.length<=6?"sequence-steps-simple":"sequence-horizontal-zigzag-plain-text"):"sequence-roadmap-vertical-plain-text",data:{...base.data,sequences:section.items.map(item=>({label:item.label,desc:item.description||item.time||""}))}};
    if(section.kind==="timeline")return {...base,template:"sequence-timeline-rounded-rect-node",data:{...base.data,sequences:section.items.map(item=>({label:[item.time,item.label].filter(Boolean).join(" · "),desc:item.description||item.location||""}))}};
    if(section.kind==="hierarchy")return {...base,template:horizontal?"hierarchy-tree-lr-tech-style-compact-card":"hierarchy-tree-tech-style-compact-card",data:{...base.data,root:hierarchyRoot(section)}};
    if(section.kind==="relationship")return {...base,template:horizontal?"relation-dagre-flow-lr-compact-card":"relation-dagre-flow-tb-compact-card",data:{...base.data,items:section.items.map(item=>({id:item.id,label:item.label,desc:item.description||"",group:item.group||""})),relations:(section.links||[]).map((link,index)=>({id:`edge-${index}`,from:link.from,to:link.to,label:link.label||"",direction:link.direction||"forward",showArrow:link.direction!=="none"}))}};
    return null;
  }
  function fitInfographicSvg(container) {
    const svg=container.querySelector("svg");
    if(!svg||typeof svg.getBBox!=="function")return false;
    try{
      const box=svg.getBBox();
      if(![box.x,box.y,box.width,box.height].every(Number.isFinite)||box.width<=0||box.height<=0)return false;
      const padding=Math.max(10,Math.min(box.width,box.height)*.045);
      svg.setAttribute("viewBox",`${box.x-padding} ${box.y-padding} ${box.width+padding*2} ${box.height+padding*2}`);
      svg.setAttribute("preserveAspectRatio","xMidYMid meet");
      return true;
    }catch{return false;}
  }
  function renderAntv(section,container,palette,issues) {
    const rect=container.getBoundingClientRect(),options=antvOptions(section,palette,{width:rect.width,height:rect.height}),Infographic=globalThis.AntVInfographic?.Infographic;
    if(!options||typeof Infographic!=="function")return Promise.resolve(false);
    return new Promise(resolve=>{
      let settled=false,instance;
      const finish=ok=>{if(settled)return;settled=true;clearTimeout(timer);if(!ok)try{instance?.destroy?.();}catch{}resolve(ok);};
      const timer=setTimeout(()=>{issues.push({code:"ANTV_RENDER_TIMEOUT",severity:"warning",sectionId:section.id,message:"Infographic rendering timed out; deterministic fallback was used."});try{instance?.destroy?.();}catch{}finish(false);},2200);
      try{
        instance=new Infographic({container,width:"100%",height:"100%",editable:false});container._penechoInfographic=instance;
        instance.on?.("warning",warnings=>issues.push({code:"ANTV_RENDER_WARNING",severity:"warning",sectionId:section.id,message:`AntV reported ${Array.isArray(warnings)?warnings.length:1} warning(s).`}));
        instance.on?.("error",error=>{issues.push({code:"ANTV_RENDER_ERROR",severity:"warning",sectionId:section.id,message:text(error?.message||"AntV could not render this panel.").slice(0,240)});finish(false);});
        instance.on?.("rendered",()=>requestAnimationFrame(()=>{fitInfographicSvg(container);finish(true);}));instance.render(options);
      }catch(error){issues.push({code:"ANTV_RENDER_ERROR",severity:"warning",sectionId:section.id,message:text(error?.message||error).slice(0,240)});finish(false);}
    });
  }
  function responsiveRegionLayout(width,regions) {
    const safeWidth=Math.max(1,Number(width)||1),columns=safeWidth<900?1:safeWidth<1450?6:12,placements=[];
    if(columns===1){regions.forEach((region,index)=>placements.push({columnStart:1,columnSpan:1,rowStart:index+1,rowSpan:1}));return {columns,rows:regions.length,placements};}
    for(const region of regions){
      const scale=12/columns,columnStart=Math.max(1,Math.min(columns,Math.ceil(region.layout.columnStart/scale))),columnSpan=Math.max(1,Math.min(columns-columnStart+1,Math.ceil(region.layout.columnSpan/scale)));
      placements.push({columnStart,columnSpan,rowStart:region.layout.rowStart,rowSpan:region.layout.rowSpan});
    }
    return {columns,rows:Math.max(1,...placements.map(item=>item.rowStart+item.rowSpan-1)),placements};
  }
  function portPositionStyle(port) {
    const offset=`${Math.round(port.offset*10000)/100}%`;
    if(port.side==="top")return {left:offset,top:"0%"};
    if(port.side==="bottom")return {left:offset,top:"100%"};
    if(port.side==="left")return {left:"0%",top:offset};
    return {left:"100%",top:offset};
  }
  function embeddedDocument(artifact) {
    const parsed=new DOMParser().parseFromString(text(artifact.html),"text/html");
    parsed.querySelectorAll("base,iframe,object,embed,form,meta[http-equiv]").forEach(node=>node.remove());
    parsed.querySelectorAll("a[href]").forEach(link=>{link.target="_blank";link.rel="noopener noreferrer";});
    const meta=parsed.createElement("meta");meta.httpEquiv="Content-Security-Policy";meta.content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' https:; style-src 'unsafe-inline' https:; connect-src https:; img-src data: blob: https:; font-src data: https:; media-src data: blob: https:; frame-src 'none'; worker-src blob: https:; object-src 'none'; form-action 'none'; base-uri 'none'";parsed.head.prepend(meta);
    const bridge=parsed.createElement("script"),artifactId=JSON.stringify(artifact.id);
    bridge.textContent=`(()=>{const artifactId=${artifactId};let timer,snapshotTimer,snapshotRunning=false;const snapshot=()=>{clearTimeout(snapshotTimer);snapshotTimer=setTimeout(async()=>{if(snapshotRunning)return;snapshotRunning=true;let url,canvas;try{const width=Math.max(1,document.documentElement.clientWidth),height=Math.max(1,document.documentElement.clientHeight),clone=document.body.cloneNode(true);clone.querySelectorAll('script').forEach(node=>node.remove());clone.setAttribute('xmlns','http://www.w3.org/1999/xhtml');for(const style of [...document.querySelectorAll('style')].reverse())clone.prepend(style.cloneNode(true));clone.style.cssText+=';width:'+width+'px;height:'+height+'px;overflow:hidden;margin:0';const content=new XMLSerializer().serializeToString(clone),svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+width+'" height="'+height+'"><foreignObject width="100%" height="100%">'+content+'</foreignObject></svg>';url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));const image=await new Promise((resolve,reject)=>{const value=new Image();value.onload=()=>resolve(value);value.onerror=reject;value.src=url});canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;canvas.getContext('2d').drawImage(image,0,0,width,height);const dataUrl=canvas.toDataURL('image/png');if(dataUrl.length<8*1024*1024)parent.postMessage({type:'penecho-visual-artifact-snapshot',artifactId,dataUrl},'*')}catch{}finally{if(url)URL.revokeObjectURL(url);if(canvas)canvas.width=canvas.height=1;snapshotRunning=false}},90)};const send=()=>{clearTimeout(timer);timer=setTimeout(()=>{const page=document.documentElement.getBoundingClientRect(),ports=[...document.querySelectorAll('[data-penecho-port]')].slice(0,32).map(node=>{const rect=node.getBoundingClientRect();return{id:String(node.dataset.penechoPort||''),x:(rect.left+rect.width/2-page.left)/Math.max(1,page.width),y:(rect.top+rect.height/2-page.top)/Math.max(1,page.height)}}).filter(port=>port.id);parent.postMessage({type:'penecho-visual-artifact-ports',artifactId,ports},'*');snapshot()},32)};addEventListener('DOMContentLoaded',send);addEventListener('resize',send);new MutationObserver(send).observe(document.documentElement,{subtree:true,childList:true,attributes:true});addEventListener('message',event=>{if(event.data?.type==='penecho-visual-request-ports')send()});send()})()`;
    parsed.body.append(bridge);return `<!doctype html>\n${parsed.documentElement.outerHTML}`;
  }
  function relationAnchor(root,plan,endpoint,artifactAnchors) {
    const region=plan.regions.find(item=>item.id===endpoint.regionId),panel=root.querySelector(`[data-region-id="${CSS.escape(endpoint.regionId)}"]`),rootRect=root.getBoundingClientRect();if(!region||!panel)return null;
    const iframe=region.renderer==="embedded-html"?panel.querySelector(".vex-embedded-frame"):null,artifactPoint=iframe?artifactAnchors.get(`${region.artifactId}:${endpoint.port}`):null;
    if(artifactPoint){const rect=iframe.getBoundingClientRect();return {x:rect.left-rootRect.left+artifactPoint.x*rect.width,y:rect.top-rootRect.top+artifactPoint.y*rect.height};}
    const marker=panel.querySelector(`[data-port-id="${CSS.escape(endpoint.port)}"]`);if(!marker)return null;const rect=marker.getBoundingClientRect();return {x:rect.left+rect.width/2-rootRect.left,y:rect.top+rect.height/2-rootRect.top};
  }
  function drawRelations(root,plan,artifactAnchors) {
    root.querySelector(".vex-relations")?.remove();if(!plan.relations?.length)return;
    const namespace="http://www.w3.org/2000/svg",svg=document.createElementNS(namespace,"svg");svg.classList.add("vex-relations");svg.setAttribute("aria-hidden","true");
    const defs=document.createElementNS(namespace,"defs"),marker=document.createElementNS(namespace,"marker"),tip=document.createElementNS(namespace,"path");marker.id="vex-arrow";marker.setAttribute("viewBox","0 0 10 10");marker.setAttribute("refX","9");marker.setAttribute("refY","5");marker.setAttribute("markerWidth","7");marker.setAttribute("markerHeight","7");marker.setAttribute("orient","auto-start-reverse");tip.setAttribute("d","M 0 0 L 10 5 L 0 10 z");tip.setAttribute("fill","var(--vex-accent)");marker.append(tip);defs.append(marker);svg.append(defs);
    for(const relation of plan.relations){const from=relationAnchor(root,plan,relation.from,artifactAnchors),to=relationAnchor(root,plan,relation.to,artifactAnchors);if(!from||!to)continue;const path=document.createElementNS(namespace,"path"),dx=Math.max(36,Math.abs(to.x-from.x)*.42),vertical=Math.abs(to.y-from.y)>Math.abs(to.x-from.x)*1.2,d=vertical?`M ${from.x} ${from.y} C ${from.x} ${from.y+(to.y-from.y)*.46}, ${to.x} ${from.y+(to.y-from.y)*.54}, ${to.x} ${to.y}`:`M ${from.x} ${from.y} C ${from.x+(to.x>=from.x?dx:-dx)} ${from.y}, ${to.x-(to.x>=from.x?dx:-dx)} ${to.y}, ${to.x} ${to.y}`;path.setAttribute("d",d);path.classList.add("vex-relation");path.dataset.kind=relation.kind;path.setAttribute("marker-end","url(#vex-arrow)");svg.append(path);if(relation.label){const label=document.createElementNS(namespace,"text");label.classList.add("vex-relation-label");label.setAttribute("x",String((from.x+to.x)/2));label.setAttribute("y",String((from.y+to.y)/2-7));label.textContent=relation.label;svg.append(label);}}
    root.append(svg);
  }
  async function renderCurrentPlan(root,plan) {
    const accent=plan.theme?.accent||DEFAULT_PALETTE[0],palette=[accent,...DEFAULT_PALETTE.filter(color=>color.toLowerCase()!==accent.toLowerCase())],issues=[],artifactAnchors=new Map();
    if(!document.getElementById(STYLE_ID))document.head.append(styleSheet(accent));destroyInfographics(root);root._vexMessageCleanup?.();for(const url of root._vexArtifactUrls||[])URL.revokeObjectURL(url);root._vexArtifactUrls=[];root.className="";root.replaceChildren();root.dataset.intent=plan.intent;root.dataset.mode="current";root.dataset.density="comfortable";root.style.setProperty("--vex-accent",accent);
    for(const [key,value] of Object.entries({"--vex-title-px":plan.typography.titlePx,"--vex-subtitle-px":plan.typography.subtitlePx,"--vex-region-title-px":plan.typography.regionTitlePx,"--vex-body-px":plan.typography.bodyPx,"--vex-caption-px":plan.typography.captionPx}))root.style.setProperty(key,`${value}px`);
    const head=element("header","vex-head"),titles=element("div");addText(titles,"div","vex-eyebrow","Visual explainer");addText(titles,"h1","vex-title",plan.title);addText(titles,"p","vex-subtitle",plan.subtitle);head.append(titles,element("div","vex-count",`${plan.regions.length} regions · ${(plan.artifacts||[]).length} live artifacts`));root.append(head);
    if(plan.takeaways?.length){const takeaways=element("section","vex-takeaways");plan.takeaways.forEach(value=>takeaways.append(element("div","vex-takeaway",value)));root.append(takeaways);}else root.append(element("div"));
    const layout=responsiveRegionLayout(root.getBoundingClientRect().width,plan.regions),grid=element("section","vex-region-grid"),pending=[],frames=new Map();root.dataset.regionColumns=String(layout.columns);grid.style.setProperty("--vex-region-columns",String(layout.columns));grid.style.setProperty("--vex-region-rows",String(layout.rows));root.append(grid);
    plan.regions.forEach((region,index)=>{const placement=layout.placements[index],panel=element("section","vex-region"),header=element("header","vex-region-head"),body=element("div","vex-region-body");panel.dataset.regionId=region.id;panel.dataset.importance=region.importance;panel.dataset.renderer=region.renderer;panel.dataset.showHeader=String(region.showHeader!==false);panel.style.setProperty("--vex-column-start",placement.columnStart);panel.style.setProperty("--vex-column-span",placement.columnSpan);panel.style.setProperty("--vex-row-start",placement.rowStart);panel.style.setProperty("--vex-row-span",placement.rowSpan);addText(header,"h2","vex-region-title",region.title);addText(header,"p","vex-region-summary",region.summary);panel.append(header,body);for(const port of region.ports||[]){const marker=element("span","vex-port"),position=portPositionStyle(port);marker.dataset.portId=port.id;marker.style.left=position.left;marker.style.top=position.top;panel.append(marker);}grid.append(panel);
      if(region.renderer==="embedded-html"){body.classList.add("vex-embedded");const artifact=plan.artifacts?.find(item=>item.id===region.artifactId);if(!artifact){issues.push({code:"EMBEDDED_ARTIFACT_MISSING",severity:"error",sectionId:region.id,message:`Artifact ${region.artifactId} is unavailable.`});body.append(element("div","vex-card-desc","Embedded artifact unavailable"));return;}const frame=element("iframe","vex-embedded-frame"),url=URL.createObjectURL(new Blob([embeddedDocument(artifact)],{type:"text/html"}));frame.title=artifact.title;frame.sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox";frame.referrerPolicy="no-referrer";frame.src=url;root._vexArtifactUrls.push(url);body.append(frame);if(!frames.has(artifact.id))frames.set(artifact.id,[]);frames.get(artifact.id).push(frame);}
      else if(ANT_KINDS.has(region.renderer)){const antv=element("div","vex-antv");body.append(antv);pending.push(renderAntv({...region,kind:region.renderer},antv,palette,issues).then(ok=>{if(!ok){antv.remove();body.append(renderNative({...region,kind:region.renderer}));}}));}
      else body.append(renderNative({...region,kind:region.renderer}));
    });
    if(plan.annotations?.length){const notes=element("footer","vex-annotations");plan.annotations.forEach(value=>notes.append(element("div","vex-note",value)));root.append(notes);}else root.append(element("div"));
    const onMessage=event=>{const data=event.data,frame=(frames.get(String(data?.artifactId||""))||[]).find(value=>value.contentWindow===event.source),allFrames=[...frames.values()].flat();if(data?.type==="penecho-visual-artifact-ports"&&frame){for(const port of Array.isArray(data.ports)?data.ports:[]){if(typeof port?.id!=="string"||!Number.isFinite(port.x)||!Number.isFinite(port.y)||port.x<0||port.x>1||port.y<0||port.y>1)continue;artifactAnchors.set(`${data.artifactId}:${port.id}`,{x:port.x,y:port.y});}drawRelations(root,plan,artifactAnchors);}if(data?.type==="penecho-visual-artifact-snapshot"&&frame&&typeof data.dataUrl==="string"&&data.dataUrl.startsWith("data:image/png;base64,")&&data.dataUrl.length<8*1024*1024){let preview=frame.parentElement.querySelector(".vex-embedded-snapshot");if(!preview){preview=element("img","vex-embedded-snapshot");preview.alt="";frame.before(preview);}preview.src=data.dataUrl;}if(data?.type==="penecho-widget-updated"&&allFrames.some(value=>value.contentWindow===event.source)){event.source.postMessage({type:"penecho-visual-request-ports"},"*");parent.postMessage({type:"penecho-widget-updated"},"*");}};addEventListener("message",onMessage);root._vexMessageCleanup=()=>removeEventListener("message",onMessage);
    await Promise.all(pending);await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));drawRelations(root,plan,artifactAnchors);const geometry=geometryIssues(root),finalIssues=uniqueIssues([...issues,...geometry]),score=scoreFor(finalIssues,plan.regions),status=finalIssues.some(issue=>issue.severity==="error")?"fail":finalIssues.length?"warn":"pass",signature=finalIssues.map(issue=>`${issue.code}:${issue.sectionId||"all"}`).sort().join("|")||"none";
    return {version:1,status,score,density:"comfortable",deterministicAttempts:1,issues:finalIssues,issueSignature:signature,semanticReplanRecommended:status==="fail"||finalIssues.some(issue=>issue.code==="TEXT_OVERFLOW")};
  }
  function geometryIssues(root) {
    const issues=[],rootRect=root.getBoundingClientRect();
    if(root.scrollWidth>root.clientWidth+2||root.scrollHeight>root.clientHeight+2)issues.push({code:"LAYOUT_OVERFLOW",severity:"error",message:"The composed explanation exceeds the Widget bounds."});
    const panels=[...root.querySelectorAll(".vex-region")];
    for(const panel of panels){const rect=panel.getBoundingClientRect(),sectionId=panel.dataset.sectionId||panel.dataset.regionId;if(rect.width<180||rect.height<105)issues.push({code:"PANEL_TOO_SMALL",severity:"warning",sectionId,message:"A panel has insufficient room for its content."});if(rect.left<rootRect.left-1||rect.top<rootRect.top-1||rect.right>rootRect.right+1||rect.bottom>rootRect.bottom+1)issues.push({code:"PANEL_OUT_OF_BOUNDS",severity:"error",sectionId,message:"A panel leaves the Widget bounds."});}
    const overflow=[...root.querySelectorAll(".vex-region-body:not(.vex-embedded),.vex-fallback,.vex-timeline,.vex-route,.vex-table-wrap,.vex-matrix,.vex-card-title,.vex-card-desc,.vex-event-title,.vex-event-desc,.vex-matrix-item")].filter(node=>node.scrollWidth>node.clientWidth+2||node.scrollHeight>node.clientHeight+2);
    if(overflow.length)issues.push({code:"TEXT_OVERFLOW",severity:"warning",message:`${overflow.length} text block(s) need more semantic compression.`});
    return issues;
  }
  function scoreFor(issues,regions) {
    let score=100;for(const issue of issues)score-=issue.severity==="error"?28:7;if(regions.length>6)score-=5;return Math.max(0,Math.min(100,score));
  }
  function uniqueIssues(issues) {
    const seen=new Set();return issues.filter(issue=>{const key=[issue.code,issue.sectionId||""].join(":");if(seen.has(key))return false;seen.add(key);return true;}).slice(0,12);
  }
  function destroyInfographics(root) {
    root.querySelectorAll(".vex-antv").forEach(node=>{try{node._penechoInfographic?.destroy?.();}catch{}});
  }
  async function renderPlan(root,plan) {
    if(!Array.isArray(plan?.regions)||!plan.regions.length)throw Error("Unsupported VisualExplainerPlan contract.");
    return renderCurrentPlan(root,plan);
  }
  let readySent=false;
  function finish(diagnostics) {
    parent.postMessage({type:"penecho-visual-explainer-diagnostics",diagnostics},"*");
    if(readySent)parent.postMessage({type:"penecho-widget-updated"},"*");
    else{readySent=true;dispatchEvent(new Event("penecho-visual-explainer-ready"));}
  }
  function observePlanResize(root,plan) {
    if(typeof ResizeObserver!=="function")return null;
    let timer=null,running=false,rerun=false,last=root.getBoundingClientRect();
    const render=async()=>{
      if(running){rerun=true;return;}
      running=true;
      try{finish(await renderPlan(root,plan));}
      finally{
        running=false;
        if(rerun){rerun=false;timer=setTimeout(render,120);}
      }
    },observer=new ResizeObserver(entries=>{
      const borderSize=entries[0]?.borderBoxSize,box=Array.isArray(borderSize)?borderSize[0]:borderSize,
        rect=box?{width:Number(box.inlineSize)||0,height:Number(box.blockSize)||0}:root.getBoundingClientRect();
      if(Math.abs(rect.width-last.width)<2&&Math.abs(rect.height-last.height)<2)return;
      last=rect;
      clearTimeout(timer);
      timer=setTimeout(render,140);
    });
    observer.observe(root);
    addEventListener("pagehide",()=>{clearTimeout(timer);observer.disconnect();destroyInfographics(root);root._vexMessageCleanup?.();for(const url of root._vexArtifactUrls||[])URL.revokeObjectURL(url);root._vexArtifactUrls=[];},{once:true});
    return observer;
  }
  async function main() {
    const source=document.querySelector(PLAN_SELECTOR),root=document.getElementById(ROOT_ID);
    if(!source||!root)return;
    try{const plan=JSON.parse(source.textContent||"");finish(await renderPlan(root,plan));observePlanResize(root,plan);}
    catch(error){root.className="penecho-visual-loading";root.replaceChildren(element("h1","", "Visual explanation unavailable"),element("p","",text(error?.message||error)));finish({version:1,status:"fail",score:0,density:"comfortable",deterministicAttempts:1,issues:[{code:"PLAN_OR_RENDER_FAILURE",severity:"error",message:text(error?.message||error).slice(0,240)}],issueSignature:"PLAN_OR_RENDER_FAILURE:all",semanticReplanRecommended:true});}
  }
  void main();
})();
