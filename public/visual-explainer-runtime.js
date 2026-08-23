"use strict";
(() => {
  const PLAN_SELECTOR = "script[type='application/json'][data-penecho-visual-explainer]",
    ROOT_ID = "penecho-visual-explainer",
    STYLE_ID = "penecho-visual-explainer-style",
    ANT_KINDS = new Set(["flow","timeline","hierarchy","relationship"]),
    DENSITIES = ["comfortable","compact","dense"],
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
      .vex-grid{min-height:0;display:grid;grid-template-columns:repeat(var(--vex-columns,1),minmax(0,1fr));grid-template-rows:repeat(var(--vex-rows,1),minmax(0,1fr));grid-auto-flow:row dense;gap:14px;overflow:hidden}
      .vex-panel{min-width:0;min-height:0;grid-column:span var(--vex-span,1);display:grid;grid-template-rows:auto minmax(0,1fr);overflow:hidden;border:1px solid var(--vex-line);border-top:3px solid var(--vex-accent);border-radius:15px;background:var(--vex-panel);box-shadow:0 6px 18px rgba(15,23,42,.055)}
      .vex-panel-head{padding:13px 15px 9px}
      .vex-panel-title{margin:0;font-size:clamp(21px,1.08cqw,29px);line-height:1.2}
      .vex-panel-summary{margin:5px 0 0;color:var(--vex-muted);font-size:clamp(18px,.9cqw,23px);line-height:1.45}
      .vex-panel-body{min-height:0;overflow:hidden;padding:5px 13px 13px}
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
      #${ROOT_ID}[data-columns="1"] .vex-head{gap:14px}
      #${ROOT_ID}[data-columns="1"] .vex-count{display:none}
      #${ROOT_ID}[data-columns="1"] .vex-takeaways{grid-template-columns:1fr}
      #${ROOT_ID}[data-columns="1"] .vex-matrix{grid-template-columns:1fr}
      #${ROOT_ID}[data-density="compact"]{gap:12px;padding:18px}
      #${ROOT_ID}[data-density="compact"] .vex-grid{gap:10px}
      #${ROOT_ID}[data-density="compact"] .vex-panel-head{padding:10px 12px 7px}
      #${ROOT_ID}[data-density="compact"] .vex-panel-body{padding:3px 10px 10px}
      #${ROOT_ID}[data-density="compact"] .vex-subtitle{margin-top:6px}
      #${ROOT_ID}[data-density="compact"] .vex-card{padding:8px 9px}
      #${ROOT_ID}[data-density="compact"] .vex-details{display:none}
      #${ROOT_ID}[data-density="dense"]{gap:8px;padding:13px;border-radius:16px}
      #${ROOT_ID}[data-density="dense"] .vex-grid{gap:7px}
      #${ROOT_ID}[data-density="dense"] .vex-subtitle,#${ROOT_ID}[data-density="dense"] .vex-takeaways{display:none}
      #${ROOT_ID}[data-density="dense"] .vex-count{padding:6px 9px}
      #${ROOT_ID}[data-density="dense"] .vex-panel-head{padding:8px 10px 5px}
      #${ROOT_ID}[data-density="dense"] .vex-panel-summary{display:none}
      #${ROOT_ID}[data-density="dense"] .vex-panel-body{padding:2px 8px 8px}
      #${ROOT_ID}[data-density="dense"] .vex-card{padding:6px 7px}
      #${ROOT_ID}[data-density="dense"] .vex-card-desc,#${ROOT_ID}[data-density="dense"] .vex-details{display:none}
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
  function responsiveLayout(width,height,sections) {
    const safeWidth=Math.max(1,Number(width)||1),safeHeight=Math.max(1,Number(height)||1),count=Math.max(1,sections.length),aspect=safeWidth/safeHeight,
      secondary=sections.map((section,index)=>section.importance==="primary"?-1:index).filter(index=>index>=0),
      supportsThreeColumns=safeWidth>=1800&&aspect>=1.15&&secondary.length>=3&&secondary.length%3===0,
      supportsTwoColumns=safeWidth>=1280&&aspect>=.68||safeWidth>=900&&aspect>=.9,
      columns=supportsThreeColumns?3:supportsTwoColumns?2:1,
      spans=Array.from({length:count},(_,index)=>sections[index]?.importance==="primary"?columns:1),
      remainder=secondary.length%columns;
    if(columns>1&&remainder)spans[secondary[0]]+=columns-remainder;
    const rows=Math.max(1,Math.ceil(spans.reduce((sum,span)=>sum+span,0)/columns));
    return {columns,rows,spans,aspect};
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
  function panelFor(section,span=1) {
    const panel=element("section","vex-panel");panel.dataset.sectionId=section.id;panel.dataset.importance=section.importance||"standard";panel.dataset.kind=section.kind;
    panel.style.setProperty("--vex-span",String(span));
    const head=element("header","vex-panel-head");addText(head,"h2","vex-panel-title",section.title);addText(head,"p","vex-panel-summary",section.summary);const body=element("div","vex-panel-body");panel.append(head,body);return {panel,body};
  }
  function buildFrame(root,plan,layout) {
    root.className="";root.replaceChildren();root.dataset.intent=plan.intent;
    root.dataset.columns=String(layout.columns);
    const head=element("header","vex-head"),titles=element("div"),total=plan.sections.reduce((sum,section)=>sum+section.items.length,0);
    addText(titles,"div","vex-eyebrow",plan.intent==="plan"?"Visual plan":plan.intent==="organize"?"Visual notes":"Visual explainer");addText(titles,"h1","vex-title",plan.title);addText(titles,"p","vex-subtitle",plan.subtitle);head.append(titles,element("div","vex-count",`${plan.sections.length} sections · ${total} items`));root.append(head);
    if(plan.takeaways?.length){const takeaways=element("section","vex-takeaways");plan.takeaways.forEach(value=>takeaways.append(element("div","vex-takeaway",value)));root.append(takeaways);}else root.append(element("div"));
    const grid=element("section","vex-grid");grid.style.setProperty("--vex-columns",String(layout.columns));grid.style.setProperty("--vex-rows",String(layout.rows));root.append(grid);
    if(plan.annotations?.length){const notes=element("footer","vex-annotations");plan.annotations.forEach(value=>notes.append(element("div","vex-note",value)));root.append(notes);}else root.append(element("div"));
    return grid;
  }
  function geometryIssues(root) {
    const issues=[],rootRect=root.getBoundingClientRect();
    if(root.scrollWidth>root.clientWidth+2||root.scrollHeight>root.clientHeight+2)issues.push({code:"LAYOUT_OVERFLOW",severity:"error",message:"The composed explanation exceeds the Widget bounds."});
    const panels=[...root.querySelectorAll(".vex-panel")];
    for(const panel of panels){const rect=panel.getBoundingClientRect();if(rect.width<180||rect.height<105)issues.push({code:"PANEL_TOO_SMALL",severity:"warning",sectionId:panel.dataset.sectionId,message:"A panel has insufficient room for its content."});if(rect.left<rootRect.left-1||rect.top<rootRect.top-1||rect.right>rootRect.right+1||rect.bottom>rootRect.bottom+1)issues.push({code:"PANEL_OUT_OF_BOUNDS",severity:"error",sectionId:panel.dataset.sectionId,message:"A panel leaves the Widget bounds."});}
    const overflow=[...root.querySelectorAll(".vex-panel-body,.vex-fallback,.vex-timeline,.vex-route,.vex-table-wrap,.vex-matrix,.vex-card-title,.vex-card-desc,.vex-event-title,.vex-event-desc,.vex-matrix-item")].filter(node=>node.scrollWidth>node.clientWidth+2||node.scrollHeight>node.clientHeight+2);
    if(overflow.length)issues.push({code:"TEXT_OVERFLOW",severity:"warning",message:`${overflow.length} text block(s) need more semantic compression.`});
    return issues;
  }
  function scoreFor(issues,plan) {
    let score=100;for(const issue of issues)score-=issue.severity==="error"?28:issue.code==="PLAN_DENSITY_HIGH"?12:7;if(plan.sections.length>6)score-=5;return Math.max(0,Math.min(100,score));
  }
  function uniqueIssues(issues) {
    const seen=new Set();return issues.filter(issue=>{const key=[issue.code,issue.sectionId||""].join(":");if(seen.has(key))return false;seen.add(key);return true;}).slice(0,12);
  }
  function destroyInfographics(root) {
    root.querySelectorAll(".vex-antv").forEach(node=>{try{node._penechoInfographic?.destroy?.();}catch{}});
  }
  async function renderPlan(root,plan) {
    const baseIssues=[],totalItems=plan.sections.reduce((sum,section)=>sum+section.items.length,0),textVolume=JSON.stringify(plan).length;
    if(totalItems>44||textVolume>12000)baseIssues.push({code:"PLAN_DENSITY_HIGH",severity:"warning",message:"The semantic plan is dense; consider splitting or shortening supporting details."});
    const accent=plan.theme?.accent||DEFAULT_PALETTE[0],palette=[accent,...DEFAULT_PALETTE.filter(color=>color.toLowerCase()!==accent.toLowerCase())];
    if(!document.getElementById(STYLE_ID))document.head.append(styleSheet(accent));
    let finalIssues=[],attempt=0;
    for(const density of DENSITIES){
      attempt++;
      root.dataset.density=density;
      const rect=root.getBoundingClientRect(),layout=responsiveLayout(rect.width,rect.height,plan.sections),renderIssues=[];
      destroyInfographics(root);
      const grid=buildFrame(root,plan,layout),pending=[];
      for(let index=0;index<plan.sections.length;index++){
        const section=plan.sections[index],{panel,body}=panelFor(section,layout.spans[index]);
        grid.append(panel);
        if(ANT_KINDS.has(section.kind)){
          const antv=element("div","vex-antv");
          body.append(antv);
          pending.push(renderAntv(section,antv,palette,renderIssues).then(ok=>{if(!ok){antv.remove();body.append(renderNative(section));}}));
        }else body.append(renderNative(section));
      }
      await Promise.all(pending);await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));finalIssues=uniqueIssues([...baseIssues,...renderIssues,...geometryIssues(root)]);
      if(!finalIssues.some(issue=>["LAYOUT_OVERFLOW","PANEL_OUT_OF_BOUNDS","PANEL_TOO_SMALL","TEXT_OVERFLOW"].includes(issue.code)))break;
      destroyInfographics(root);
    }
    const score=scoreFor(finalIssues,plan),status=finalIssues.some(issue=>issue.severity==="error")?"fail":finalIssues.length?"warn":"pass",signature=finalIssues.map(issue=>`${issue.code}:${issue.sectionId||"all"}`).sort().join("|")||"none";
    return {version:1,status,score,density:root.dataset.density,deterministicAttempts:attempt,issues:finalIssues,issueSignature:signature,semanticReplanRecommended:status==="fail"||finalIssues.some(issue=>["PLAN_DENSITY_HIGH","TEXT_OVERFLOW"].includes(issue.code))};
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
    addEventListener("pagehide",()=>{clearTimeout(timer);observer.disconnect();destroyInfographics(root);},{once:true});
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
