// Deterministic Visual Explainer plan validation and single-Widget compilation.
  const VISUAL_EXPLAINER_VERSION = 1,
    VISUAL_EXPLAINER_SOURCE_FORMAT = "penecho-visual-explainer-plan+json",
    VISUAL_EXPLAINER_FRAMEWORK_VERSION = "penecho-visual-explainer/2 antv-infographic/0.2.20",
    VISUAL_EXPLAINER_SECTION_KINDS = new Set(["flow","timeline","hierarchy","relationship","comparison","cards","metrics","schedule","table","map","notes","matrix"]),
    VISUAL_EXPLAINER_INTENTS = new Set(["explain","organize","plan"]),
    VISUAL_EXPLAINER_IMPORTANCE = new Set(["primary","standard","supporting"]),
    VISUAL_EXPLAINER_STATUSES = new Set(["planned","active","done","blocked","warning","info"]),
    VISUAL_EXPLAINER_MAX_SECTIONS = 8,
    VISUAL_EXPLAINER_MAX_ITEMS = 64;

  function visualExplainerError(code,message,details) {
    const error = Error(message);
    error.code = code;
    if (details !== undefined) error.details = details;
    return error;
  }
  function visualExplainerText(value,name,maxLength,{required=false}={}) {
    if (value === undefined || value === null) {
      if (required) throw visualExplainerError("INVALID_VISUAL_PLAN",`${name} is required.`);
      return "";
    }
    if (typeof value !== "string") throw visualExplainerError("INVALID_VISUAL_PLAN",`${name} must be text.`);
    const text=value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,"").replace(/\r\n/g,"\n").trim();
    if (required&&!text)throw visualExplainerError("INVALID_VISUAL_PLAN",`${name} cannot be empty.`);
    if(text.length>maxLength)throw visualExplainerError("INVALID_VISUAL_PLAN",`${name} exceeds ${maxLength} characters.`);
    return text;
  }
  function visualExplainerStringList(value,name,maxItems,maxLength) {
    if(value===undefined)return [];
    if(!Array.isArray(value)||value.length>maxItems)throw visualExplainerError("INVALID_VISUAL_PLAN",`${name} must contain at most ${maxItems} text values.`);
    return value.map((item,index)=>visualExplainerText(item,`${name}[${index}]`,maxLength,{required:true}));
  }
  function visualExplainerNormalizeItem(value,sectionIndex,itemIndex) {
    if(!value||typeof value!=="object"||Array.isArray(value))throw visualExplainerError("INVALID_VISUAL_PLAN",`sections[${sectionIndex}].items[${itemIndex}] must be an object.`);
    const allowed=new Set(["id","label","description","value","time","location","status","group","parentId","details"]),extra=Object.keys(value).find(key=>!allowed.has(key));
    if(extra)throw visualExplainerError("INVALID_VISUAL_PLAN",`Unexpected item field: ${extra}.`);
    const status=value.status===undefined?"":String(value.status);
    if(status&&!VISUAL_EXPLAINER_STATUSES.has(status))throw visualExplainerError("INVALID_VISUAL_PLAN",`Unsupported item status: ${status}.`);
    const numericValue=typeof value.value === "number" ? value.value : null;
    if(numericValue!==null&&!Number.isFinite(numericValue))throw visualExplainerError("INVALID_VISUAL_PLAN","Item value must be finite.");
    return {
      id:visualExplainerText(value.id,`sections[${sectionIndex}].items[${itemIndex}].id`,64,{required:true}),
      label:visualExplainerText(value.label,`sections[${sectionIndex}].items[${itemIndex}].label`,160,{required:true}),
      ...(value.description!==undefined?{description:visualExplainerText(value.description,"item.description",600)}:{}),
      ...(value.value!==undefined?{value:numericValue===null?visualExplainerText(value.value,"item.value",80):numericValue}:{}),
      ...(value.time!==undefined?{time:visualExplainerText(value.time,"item.time",120)}:{}),
      ...(value.location!==undefined?{location:visualExplainerText(value.location,"item.location",160)}:{}),
      ...(status?{status}:{}),
      ...(value.group!==undefined?{group:visualExplainerText(value.group,"item.group",120)}:{}),
      ...(value.parentId!==undefined?{parentId:visualExplainerText(value.parentId,"item.parentId",64)}:{}),
      ...(value.details!==undefined?{details:visualExplainerStringList(value.details,"item.details",8,240)}:{}),
    };
  }
  function visualExplainerNormalizeLink(value,sectionIndex,linkIndex) {
    if(!value||typeof value!=="object"||Array.isArray(value))throw visualExplainerError("INVALID_VISUAL_PLAN",`sections[${sectionIndex}].links[${linkIndex}] must be an object.`);
    const allowed=new Set(["from","to","label","direction"]),extra=Object.keys(value).find(key=>!allowed.has(key));
    if(extra)throw visualExplainerError("INVALID_VISUAL_PLAN",`Unexpected link field: ${extra}.`);
    const direction=value.direction===undefined?"forward":String(value.direction);
    if(!["forward","both","none"].includes(direction))throw visualExplainerError("INVALID_VISUAL_PLAN",`Unsupported link direction: ${direction}.`);
    return {
      from:visualExplainerText(value.from,"link.from",64,{required:true}),
      to:visualExplainerText(value.to,"link.to",64,{required:true}),
      ...(value.label!==undefined?{label:visualExplainerText(value.label,"link.label",120)}:{}),
      direction,
    };
  }
  function visualExplainerNormalizeSection(value,index) {
    if(!value||typeof value!=="object"||Array.isArray(value))throw visualExplainerError("INVALID_VISUAL_PLAN",`sections[${index}] must be an object.`);
    const allowed=new Set(["id","title","kind","summary","importance","items","links"]),extra=Object.keys(value).find(key=>!allowed.has(key));
    if(extra)throw visualExplainerError("INVALID_VISUAL_PLAN",`Unexpected section field: ${extra}.`);
    const kind=String(value.kind||""),importance=value.importance===undefined?"standard":String(value.importance);
    if(!VISUAL_EXPLAINER_SECTION_KINDS.has(kind))throw visualExplainerError("INVALID_VISUAL_PLAN",`Unsupported section kind: ${kind||"(missing)"}.`);
    if(!VISUAL_EXPLAINER_IMPORTANCE.has(importance))throw visualExplainerError("INVALID_VISUAL_PLAN",`Unsupported section importance: ${importance}.`);
    if(!Array.isArray(value.items)||!value.items.length||value.items.length>16)throw visualExplainerError("INVALID_VISUAL_PLAN",`sections[${index}].items must contain 1 to 16 items.`);
    const items=value.items.map((item,itemIndex)=>visualExplainerNormalizeItem(item,index,itemIndex)),ids=new Set();
    for(const item of items){if(ids.has(item.id))throw visualExplainerError("INVALID_VISUAL_PLAN",`Duplicate item id in section ${value.id||index}: ${item.id}.`);ids.add(item.id);}
    const links=value.links===undefined?[]:Array.isArray(value.links)&&value.links.length<=24?value.links.map((link,linkIndex)=>visualExplainerNormalizeLink(link,index,linkIndex)):(()=>{throw visualExplainerError("INVALID_VISUAL_PLAN",`sections[${index}].links must contain at most 24 links.`);})();
    for(const link of links)if(!ids.has(link.from)||!ids.has(link.to))throw visualExplainerError("INVALID_VISUAL_PLAN",`Link ${link.from} → ${link.to} references an unknown item.`);
    for(const item of items)if(item.parentId&&!ids.has(item.parentId))throw visualExplainerError("INVALID_VISUAL_PLAN",`Item ${item.id} has an unknown parentId.`);
    return {
      id:visualExplainerText(value.id,`sections[${index}].id`,64,{required:true}),
      title:visualExplainerText(value.title,`sections[${index}].title`,160,{required:true}),
      kind,
      ...(value.summary!==undefined?{summary:visualExplainerText(value.summary,"section.summary",600)}:{}),
      importance,
      items,
      ...(links.length?{links}:{}),
    };
  }
  function visualExplainerNormalizePlan(value) {
    if(!value||typeof value!=="object"||Array.isArray(value))throw visualExplainerError("INVALID_VISUAL_PLAN","VisualExplainerPlan must be an object.");
    const allowed=new Set(["version","intent","title","subtitle","takeaways","sections","annotations","theme"]),extra=Object.keys(value).find(key=>!allowed.has(key));
    if(extra)throw visualExplainerError("INVALID_VISUAL_PLAN",`Unexpected plan field: ${extra}.`);
    if(value.version!==VISUAL_EXPLAINER_VERSION)throw visualExplainerError("INVALID_VISUAL_PLAN",`VisualExplainerPlan version must be ${VISUAL_EXPLAINER_VERSION}.`);
    const intent=String(value.intent||"");
    if(!VISUAL_EXPLAINER_INTENTS.has(intent))throw visualExplainerError("INVALID_VISUAL_PLAN",`Unsupported visual intent: ${intent||"(missing)"}.`);
    if(!Array.isArray(value.sections)||!value.sections.length||value.sections.length>VISUAL_EXPLAINER_MAX_SECTIONS)throw visualExplainerError("INVALID_VISUAL_PLAN",`sections must contain 1 to ${VISUAL_EXPLAINER_MAX_SECTIONS} entries.`);
    const sections=value.sections.map(visualExplainerNormalizeSection),sectionIds=new Set(),totalItems=sections.reduce((sum,section)=>sum+section.items.length,0);
    if(totalItems>VISUAL_EXPLAINER_MAX_ITEMS)throw visualExplainerError("INVALID_VISUAL_PLAN",`The plan exceeds ${VISUAL_EXPLAINER_MAX_ITEMS} total items.`);
    for(const section of sections){if(sectionIds.has(section.id))throw visualExplainerError("INVALID_VISUAL_PLAN",`Duplicate section id: ${section.id}.`);sectionIds.add(section.id);}
    const theme=value.theme===undefined?{}:value.theme;
    if(!theme||typeof theme!=="object"||Array.isArray(theme))throw visualExplainerError("INVALID_VISUAL_PLAN","theme must be an object.");
    const themeExtra=Object.keys(theme).find(key=>!["tone","accent"].includes(key));
    if(themeExtra)throw visualExplainerError("INVALID_VISUAL_PLAN",`Unexpected theme field: ${themeExtra}.`);
    const tone=theme.tone===undefined?"clear":String(theme.tone);
    if(!["clear","warm","technical","playful"].includes(tone))throw visualExplainerError("INVALID_VISUAL_PLAN",`Unsupported theme tone: ${tone}.`);
    const accent=theme.accent===undefined?"":String(theme.accent).trim();
    if(accent&&!/^#[0-9a-f]{6}$/i.test(accent))throw visualExplainerError("INVALID_VISUAL_PLAN","theme.accent must be a six-digit hex color.");
    return {
      version:VISUAL_EXPLAINER_VERSION,
      intent,
      title:visualExplainerText(value.title,"title",180,{required:true}),
      ...(value.subtitle!==undefined?{subtitle:visualExplainerText(value.subtitle,"subtitle",500)}:{}),
      ...(value.takeaways!==undefined?{takeaways:visualExplainerStringList(value.takeaways,"takeaways",6,240)}:{}),
      sections,
      ...(value.annotations!==undefined?{annotations:visualExplainerStringList(value.annotations,"annotations",8,280)}:{}),
      theme:{ tone, ...(accent?{accent}: {}) },
    };
  }
  function visualExplainerEscapeHtml(value) {
    return String(value).replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);
  }
  function visualExplainerDocument(plan) {
    const normalized=visualExplainerNormalizePlan(plan),json=JSON.stringify(normalized).replace(/</g,"\\u003c").replace(/>/g,"\\u003e").replace(/&/g,"\\u0026");
    return `<!doctype html>
<html lang="${/[\u3400-\u9fff]/.test(normalized.title)?"zh-CN":"en"}">
<head>
  <meta charset="utf-8">
  <title>${visualExplainerEscapeHtml(normalized.title)}</title>
  <style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent;font-family:Inter,"PingFang SC","Microsoft YaHei",system-ui,sans-serif}.penecho-visual-loading{box-sizing:border-box;width:100%;height:100%;display:grid;place-content:center;padding:48px;color:#334155;text-align:center}.penecho-visual-loading h1{margin:0 0 12px;font-size:clamp(30px,4vw,56px)}.penecho-visual-loading p{margin:0;color:#64748b}</style>
</head>
<body>
  <main id="penecho-visual-explainer" class="penecho-visual-loading" aria-live="polite">
    <h1>${visualExplainerEscapeHtml(normalized.title)}</h1>
    <p>${visualExplainerEscapeHtml(normalized.subtitle||"Preparing visual explanation…")}</p>
  </main>
  <script type="application/json" data-penecho-visual-explainer>${json}</script>
</body>
</html>`;
  }
  function visualExplainerWidgetItem(plan,{title,width,height,placement}={}) {
    const normalized=visualExplainerNormalizePlan(plan),source=JSON.stringify(normalized,null,2);
    return {
      type:"widget",widgetType:"html_widget",pluginId:"general",title:String(title||normalized.title).trim().slice(0,120),
      html:visualExplainerDocument(normalized),sourceFormat:VISUAL_EXPLAINER_SOURCE_FORMAT,frameworkVersion:VISUAL_EXPLAINER_FRAMEWORK_VERSION,
      copyText:source,copyLabel:"Copy visual plan",width,height,placement,
    };
  }
  function visualExplainerWaitForDiagnostics(widget,timeoutMs=3800) {
    if(widget?.visualDiagnostics)return Promise.resolve(structuredClone(widget.visualDiagnostics));
    if(!widget)return Promise.resolve(null);
    if(!(widget.visualDiagnosticWaiters instanceof Set))widget.visualDiagnosticWaiters=new Set();
    return new Promise(resolve=>{
      let settled=false;
      const finish=value=>{if(settled)return;settled=true;clearTimeout(timer);widget.visualDiagnosticWaiters?.delete(finish);resolve(value?structuredClone(value):null);},
        timer=setTimeout(()=>finish(null),Math.max(500,Math.min(5000,Number(timeoutMs)||3800)));
      widget.visualDiagnosticWaiters.add(finish);
    });
  }
