// Deterministic Visual Explainer validation and single-Widget compilation.
  const VISUAL_EXPLAINER_SOURCE_FORMAT = "penecho-visual-explainer-plan+json",
    VISUAL_EXPLAINER_FRAMEWORK_VERSION = "penecho-visual-explainer/3 antv-infographic/0.2.20",
    VISUAL_EXPLAINER_SECTION_KINDS = new Set(["flow","timeline","hierarchy","relationship","comparison","cards","metrics","schedule","table","map","notes","matrix"]),
    VISUAL_EXPLAINER_INTENTS = new Set(["explain","organize","plan"]),
    VISUAL_EXPLAINER_IMPORTANCE = new Set(["primary","standard","supporting"]),
    VISUAL_EXPLAINER_STATUSES = new Set(["planned","active","done","blocked","warning","info"]),
    VISUAL_EXPLAINER_RENDERERS = new Set([...VISUAL_EXPLAINER_SECTION_KINDS,"embedded-html"]),
    VISUAL_EXPLAINER_RELATION_KINDS = new Set(["flow","drilldown","dependency","feedback","reference"]),
    VISUAL_EXPLAINER_PORT_SIDES = new Set(["top","right","bottom","left"]),
    VISUAL_EXPLAINER_MAX_ITEMS = 64,
    VISUAL_EXPLAINER_MAX_ARTIFACT_HTML = 48000,
    VISUAL_EXPLAINER_MAX_ARTIFACT_HTML_TOTAL = 160000;

  function visualExplainerError(code,message,details) {
    const error = Error(message);error.code=code;if(details!==undefined)error.details=details;return error;
  }
  function visualExplainerText(value,name,maxLength,{required=false,preserve=false}={}) {
    if(value===undefined||value===null){if(required)throw visualExplainerError("INVALID_VISUAL_PLAN",`${name} is required.`);return "";}
    if(typeof value!=="string")throw visualExplainerError("INVALID_VISUAL_PLAN",`${name} must be text.`);
    const text=value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,"").replace(/\r\n/g,"\n"),normalized=preserve?text:text.trim();
    if(required&&!normalized.trim())throw visualExplainerError("INVALID_VISUAL_PLAN",`${name} cannot be empty.`);
    if(normalized.length>maxLength)throw visualExplainerError("INVALID_VISUAL_PLAN",`${name} exceeds ${maxLength} characters.`);return normalized;
  }
  function visualExplainerStringList(value,name,maxItems,maxLength) {
    if(value===undefined)return [];
    if(!Array.isArray(value)||value.length>maxItems)throw visualExplainerError("INVALID_VISUAL_PLAN",`${name} must contain at most ${maxItems} text values.`);
    return value.map((item,index)=>visualExplainerText(item,`${name}[${index}]`,maxLength,{required:true}));
  }
  function visualExplainerInteger(value,name,min,max,fallback) {
    const number=value===undefined?fallback:Number(value);
    if(!Number.isInteger(number)||number<min||number>max)throw visualExplainerError("INVALID_VISUAL_PLAN",`${name} must be an integer from ${min} to ${max}.`);return number;
  }
  function visualExplainerExactObject(value,name,allowed) {
    if(!value||typeof value!=="object"||Array.isArray(value))throw visualExplainerError("INVALID_VISUAL_PLAN",`${name} must be an object.`);
    const extra=Object.keys(value).find(key=>!allowed.has(key));if(extra)throw visualExplainerError("INVALID_VISUAL_PLAN",`Unexpected ${name} field: ${extra}.`);
  }
  function visualExplainerNormalizeItem(value,sectionIndex,itemIndex,label="regions") {
    visualExplainerExactObject(value,`${label}[${sectionIndex}].items[${itemIndex}]`,new Set(["id","label","description","value","time","location","status","group","parentId","details"]));
    const status=value.status===undefined?"":String(value.status),numericValue=typeof value.value==="number"?value.value:null;
    if(status&&!VISUAL_EXPLAINER_STATUSES.has(status))throw visualExplainerError("INVALID_VISUAL_PLAN",`Unsupported item status: ${status}.`);
    if(numericValue!==null&&!Number.isFinite(numericValue))throw visualExplainerError("INVALID_VISUAL_PLAN","Item value must be finite.");
    return {id:visualExplainerText(value.id,`${label}[${sectionIndex}].items[${itemIndex}].id`,64,{required:true}),label:visualExplainerText(value.label,`${label}[${sectionIndex}].items[${itemIndex}].label`,160,{required:true}),...(value.description!==undefined?{description:visualExplainerText(value.description,"item.description",600)}:{}),...(value.value!==undefined?{value:numericValue===null?visualExplainerText(value.value,"item.value",80):numericValue}:{}),...(value.time!==undefined?{time:visualExplainerText(value.time,"item.time",120)}:{}),...(value.location!==undefined?{location:visualExplainerText(value.location,"item.location",160)}:{}),...(status?{status}:{}),...(value.group!==undefined?{group:visualExplainerText(value.group,"item.group",120)}:{}),...(value.parentId!==undefined?{parentId:visualExplainerText(value.parentId,"item.parentId",64)}:{}),...(value.details!==undefined?{details:visualExplainerStringList(value.details,"item.details",8,240)}:{})};
  }
  function visualExplainerNormalizeLink(value,sectionIndex,linkIndex,label="regions") {
    visualExplainerExactObject(value,`${label}[${sectionIndex}].links[${linkIndex}]`,new Set(["from","to","label","direction"]));
    const direction=value.direction===undefined?"forward":String(value.direction);if(!["forward","both","none"].includes(direction))throw visualExplainerError("INVALID_VISUAL_PLAN",`Unsupported link direction: ${direction}.`);
    return {from:visualExplainerText(value.from,"link.from",64,{required:true}),to:visualExplainerText(value.to,"link.to",64,{required:true}),...(value.label!==undefined?{label:visualExplainerText(value.label,"link.label",120)}:{}),direction};
  }
  function visualExplainerNormalizeSemanticContent(value,index,label="regions") {
    if(!Array.isArray(value.items)||!value.items.length||value.items.length>16)throw visualExplainerError("INVALID_VISUAL_PLAN",`${label}[${index}].items must contain 1 to 16 items.`);
    const items=value.items.map((item,itemIndex)=>visualExplainerNormalizeItem(item,index,itemIndex,label)),ids=new Set();
    for(const item of items){if(ids.has(item.id))throw visualExplainerError("INVALID_VISUAL_PLAN",`Duplicate item id in ${value.id||index}: ${item.id}.`);ids.add(item.id);}
    const links=value.links===undefined?[]:Array.isArray(value.links)&&value.links.length<=24?value.links.map((link,linkIndex)=>visualExplainerNormalizeLink(link,index,linkIndex,label)):(()=>{throw visualExplainerError("INVALID_VISUAL_PLAN",`${label}[${index}].links must contain at most 24 links.`);})();
    for(const link of links)if(!ids.has(link.from)||!ids.has(link.to))throw visualExplainerError("INVALID_VISUAL_PLAN",`Link ${link.from} → ${link.to} references an unknown item.`);
    for(const item of items)if(item.parentId&&!ids.has(item.parentId))throw visualExplainerError("INVALID_VISUAL_PLAN",`Item ${item.id} has an unknown parentId.`);
    return {items,...(links.length?{links}:{})};
  }
  function visualExplainerNormalizeTheme(value) {
    const theme=value===undefined?{}:value;visualExplainerExactObject(theme,"theme",new Set(["tone","accent"]));
    const tone=theme.tone===undefined?"clear":String(theme.tone),accent=theme.accent===undefined?"":String(theme.accent).trim();
    if(!["clear","warm","technical","playful"].includes(tone))throw visualExplainerError("INVALID_VISUAL_PLAN",`Unsupported theme tone: ${tone}.`);
    if(accent&&!/^#[0-9a-f]{6}$/i.test(accent))throw visualExplainerError("INVALID_VISUAL_PLAN","theme.accent must be a six-digit hex color.");return {tone,...(accent?{accent}:{})};
  }
  function visualExplainerCommon(value) {
    const intent=String(value.intent||"");if(!VISUAL_EXPLAINER_INTENTS.has(intent))throw visualExplainerError("INVALID_VISUAL_PLAN",`Unsupported visual intent: ${intent||"(missing)"}.`);
    return {intent,title:visualExplainerText(value.title,"title",180,{required:true}),...(value.subtitle!==undefined?{subtitle:visualExplainerText(value.subtitle,"subtitle",500)}:{}),...(value.takeaways!==undefined?{takeaways:visualExplainerStringList(value.takeaways,"takeaways",6,240)}:{}),...(value.annotations!==undefined?{annotations:visualExplainerStringList(value.annotations,"annotations",8,280)}:{}),theme:visualExplainerNormalizeTheme(value.theme)};
  }
  function visualExplainerNormalizeTypography(value) {
    const typography=value===undefined?{}:value;visualExplainerExactObject(typography,"typography",new Set(["titlePx","subtitlePx","regionTitlePx","bodyPx","captionPx"]));
    return {titlePx:visualExplainerInteger(typography.titlePx,"typography.titlePx",28,96,52),subtitlePx:visualExplainerInteger(typography.subtitlePx,"typography.subtitlePx",14,40,22),regionTitlePx:visualExplainerInteger(typography.regionTitlePx,"typography.regionTitlePx",16,44,25),bodyPx:visualExplainerInteger(typography.bodyPx,"typography.bodyPx",12,32,18),captionPx:visualExplainerInteger(typography.captionPx,"typography.captionPx",10,26,15)};
  }
  function visualExplainerNormalizePort(value,regionIndex,portIndex) {
    visualExplainerExactObject(value,`regions[${regionIndex}].ports[${portIndex}]`,new Set(["id","side","offset"]));
    const side=String(value.side||"");if(!VISUAL_EXPLAINER_PORT_SIDES.has(side))throw visualExplainerError("INVALID_VISUAL_PLAN",`Unsupported port side: ${side||"(missing)"}.`);
    const offset=value.offset===undefined?.5:Number(value.offset);if(!Number.isFinite(offset)||offset<0||offset>1)throw visualExplainerError("INVALID_VISUAL_PLAN","Port offset must be between 0 and 1.");return {id:visualExplainerText(value.id,"port.id",64,{required:true}),side,offset};
  }
  function visualExplainerNormalizeRegion(value,index) {
    visualExplainerExactObject(value,`regions[${index}]`,new Set(["id","title","summary","importance","renderer","artifactId","items","links","layout","ports","showHeader"]));
    const renderer=String(value.renderer||""),importance=value.importance===undefined?"standard":String(value.importance);
    if(!VISUAL_EXPLAINER_RENDERERS.has(renderer))throw visualExplainerError("INVALID_VISUAL_PLAN",`Unsupported region renderer: ${renderer||"(missing)"}.`);
    if(!VISUAL_EXPLAINER_IMPORTANCE.has(importance))throw visualExplainerError("INVALID_VISUAL_PLAN",`Unsupported region importance: ${importance}.`);
    const layout=value.layout||{};visualExplainerExactObject(layout,`regions[${index}].layout`,new Set(["columnStart","columnSpan","rowStart","rowSpan"]));
    const ports=value.ports===undefined?[]:Array.isArray(value.ports)&&value.ports.length<=12?value.ports.map((port,portIndex)=>visualExplainerNormalizePort(port,index,portIndex)):(()=>{throw visualExplainerError("INVALID_VISUAL_PLAN",`regions[${index}].ports must contain at most 12 ports.`);})();
    if(new Set(ports.map(port=>port.id)).size!==ports.length)throw visualExplainerError("INVALID_VISUAL_PLAN",`Region ${value.id||index} has duplicate port ids.`);
    const common={id:visualExplainerText(value.id,`regions[${index}].id`,64,{required:true}),title:visualExplainerText(value.title,`regions[${index}].title`,160,{required:true}),...(value.summary!==undefined?{summary:visualExplainerText(value.summary,"region.summary",600)}:{}),importance,renderer,layout:{columnStart:visualExplainerInteger(layout.columnStart,"layout.columnStart",1,12,1),columnSpan:visualExplainerInteger(layout.columnSpan,"layout.columnSpan",1,12,12),rowStart:visualExplainerInteger(layout.rowStart,"layout.rowStart",1,12,1),rowSpan:visualExplainerInteger(layout.rowSpan,"layout.rowSpan",1,6,1)},...(ports.length?{ports}:{}),...(value.showHeader===false?{showHeader:false}:{})};
    if(renderer==="embedded-html"){if(value.items!==undefined||value.links!==undefined)throw visualExplainerError("INVALID_VISUAL_PLAN",`Embedded region ${common.id} cannot contain semantic items or links.`);return {...common,artifactId:visualExplainerText(value.artifactId,`regions[${index}].artifactId`,64,{required:true})};}
    if(value.artifactId!==undefined)throw visualExplainerError("INVALID_VISUAL_PLAN",`Semantic region ${common.id} cannot reference an artifact.`);return {...common,...visualExplainerNormalizeSemanticContent(value,index,"regions")};
  }
  function visualExplainerNormalizeArtifact(value,index) {
    visualExplainerExactObject(value,`artifacts[${index}]`,new Set(["id","title","html","sourceFormat","frameworkVersion","refreshSeconds"]));
    return {id:visualExplainerText(value.id,`artifacts[${index}].id`,64,{required:true}),title:visualExplainerText(value.title,`artifacts[${index}].title`,120,{required:true}),html:visualExplainerText(value.html,`artifacts[${index}].html`,VISUAL_EXPLAINER_MAX_ARTIFACT_HTML,{required:true,preserve:true}),sourceFormat:visualExplainerText(value.sourceFormat===undefined?"html":value.sourceFormat,"artifact.sourceFormat",80,{required:true}),...(value.frameworkVersion!==undefined?{frameworkVersion:visualExplainerText(value.frameworkVersion,"artifact.frameworkVersion",120)}:{}),refreshSeconds:visualExplainerInteger(value.refreshSeconds,"artifact.refreshSeconds",0,86400,0)};
  }
  function visualExplainerNormalizeEndpoint(value,name) {visualExplainerExactObject(value,name,new Set(["regionId","port"]));return {regionId:visualExplainerText(value.regionId,`${name}.regionId`,64,{required:true}),port:visualExplainerText(value.port,`${name}.port`,64,{required:true})};}
  function visualExplainerNormalizeRelation(value,index) {
    visualExplainerExactObject(value,`relations[${index}]`,new Set(["id","from","to","kind","label"]));const kind=value.kind===undefined?"flow":String(value.kind);if(!VISUAL_EXPLAINER_RELATION_KINDS.has(kind))throw visualExplainerError("INVALID_VISUAL_PLAN",`Unsupported relation kind: ${kind}.`);
    return {id:visualExplainerText(value.id,`relations[${index}].id`,64,{required:true}),from:visualExplainerNormalizeEndpoint(value.from,"relation.from"),to:visualExplainerNormalizeEndpoint(value.to,"relation.to"),kind,...(value.label!==undefined?{label:visualExplainerText(value.label,"relation.label",120)}:{})};
  }
  function visualExplainerNormalizePlan(value) {
    if(!value||typeof value!=="object"||Array.isArray(value))throw visualExplainerError("INVALID_VISUAL_PLAN","VisualExplainerPlan must be an object.");
    visualExplainerExactObject(value,"plan",new Set(["intent","title","subtitle","takeaways","regions","relations","artifacts","annotations","theme","typography"]));
    if(!Array.isArray(value.regions)||!value.regions.length||value.regions.length>8)throw visualExplainerError("INVALID_VISUAL_PLAN","regions must contain 1 to 8 entries.");
    const regions=value.regions.map(visualExplainerNormalizeRegion),regionIds=new Set(),totalItems=regions.reduce((sum,region)=>sum+(region.items?.length||0),0);if(totalItems>VISUAL_EXPLAINER_MAX_ITEMS)throw visualExplainerError("INVALID_VISUAL_PLAN",`The plan exceeds ${VISUAL_EXPLAINER_MAX_ITEMS} total items.`);
    for(const region of regions){if(regionIds.has(region.id))throw visualExplainerError("INVALID_VISUAL_PLAN",`Duplicate region id: ${region.id}.`);regionIds.add(region.id);if(region.layout.columnStart+region.layout.columnSpan>13)throw visualExplainerError("INVALID_VISUAL_PLAN",`Region ${region.id} exceeds the 12-column layout.`);}
    const artifacts=value.artifacts===undefined?[]:Array.isArray(value.artifacts)&&value.artifacts.length<=8?value.artifacts.map(visualExplainerNormalizeArtifact):(()=>{throw visualExplainerError("INVALID_VISUAL_PLAN","artifacts must contain at most 8 entries.");})();
    const artifactIds=new Set();let artifactHtmlTotal=0;for(const artifact of artifacts){if(artifactIds.has(artifact.id))throw visualExplainerError("INVALID_VISUAL_PLAN",`Duplicate artifact id: ${artifact.id}.`);artifactIds.add(artifact.id);artifactHtmlTotal+=artifact.html.length;}if(artifactHtmlTotal>VISUAL_EXPLAINER_MAX_ARTIFACT_HTML_TOTAL)throw visualExplainerError("INVALID_VISUAL_PLAN",`Embedded artifact HTML exceeds ${VISUAL_EXPLAINER_MAX_ARTIFACT_HTML_TOTAL} total characters.`);
    for(const region of regions)if(region.renderer==="embedded-html"&&!artifactIds.has(region.artifactId))throw visualExplainerError("INVALID_VISUAL_PLAN",`Region ${region.id} references unknown artifact ${region.artifactId}.`);
    const relations=value.relations===undefined?[]:Array.isArray(value.relations)&&value.relations.length<=24?value.relations.map(visualExplainerNormalizeRelation):(()=>{throw visualExplainerError("INVALID_VISUAL_PLAN","relations must contain at most 24 entries.");})();
    const relationIds=new Set();for(const relation of relations){if(relationIds.has(relation.id))throw visualExplainerError("INVALID_VISUAL_PLAN",`Duplicate relation id: ${relation.id}.`);relationIds.add(relation.id);for(const endpoint of [relation.from,relation.to]){const region=regions.find(item=>item.id===endpoint.regionId),ports=new Set(region?.ports?.map(port=>port.id)||[]);if(!region)throw visualExplainerError("INVALID_VISUAL_PLAN",`Relation ${relation.id} references unknown region ${endpoint.regionId}.`);if(!ports.has(endpoint.port))throw visualExplainerError("INVALID_VISUAL_PLAN",`Relation ${relation.id} references unknown port ${endpoint.regionId}.${endpoint.port}.`);}}
    return {...visualExplainerCommon(value),typography:visualExplainerNormalizeTypography(value.typography),regions,...(relations.length?{relations}:{}),...(artifacts.length?{artifacts}:{})};
  }
  function visualExplainerEscapeHtml(value) {return String(value).replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);}
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
  <main id="penecho-visual-explainer" class="penecho-visual-loading" aria-live="polite"><h1>${visualExplainerEscapeHtml(normalized.title)}</h1><p>${visualExplainerEscapeHtml(normalized.subtitle||"Preparing visual explanation…")}</p></main>
  <script type="application/json" data-penecho-visual-explainer>${json}</script>
</body>
</html>`;
  }
  function visualExplainerWidgetItem(plan,{title,width,height,placement}={}) {
    const normalized=visualExplainerNormalizePlan(plan),source=JSON.stringify(normalized,null,2);return {type:"widget",widgetType:"html_widget",pluginId:"general",title:String(title||normalized.title).trim().slice(0,120),html:visualExplainerDocument(normalized),sourceFormat:VISUAL_EXPLAINER_SOURCE_FORMAT,frameworkVersion:VISUAL_EXPLAINER_FRAMEWORK_VERSION,copyText:source,copyLabel:"Copy visual plan",width,height,placement};
  }
  function visualExplainerArtifactWidgetEdit(plan,artifactId,box={}) {
    const normalized=visualExplainerNormalizePlan(plan);
    const artifact=normalized.artifacts?.find(item=>item.id===String(artifactId||""));if(!artifact)throw visualExplainerError("VISUAL_ARTIFACT_NOT_FOUND",`Embedded artifact ${artifactId||"(missing)"} was not found.`);
    return {widgetType:"html_widget",pluginId:"general",title:artifact.title,refreshSeconds:artifact.refreshSeconds,html:artifact.html,source:artifact.html,sourceMirrorsHtml:true,sourceFormat:artifact.sourceFormat,frameworkVersion:artifact.frameworkVersion||null,copyLabel:null,box:{x:Number(box.x)||0,y:Number(box.y)||0,w:Number(box.w)||800,h:Number(box.h)||500}};
  }
  function visualExplainerReplaceArtifact(plan,artifactId,command) {
    const normalized=visualExplainerNormalizePlan(plan),id=String(artifactId||""),index=normalized.artifacts?.findIndex(item=>item.id===id)??-1;if(index<0)throw visualExplainerError("VISUAL_ARTIFACT_NOT_FOUND",`Embedded artifact ${id||"(missing)"} was not found.`);
    if(!command||command.tool!=="html_widget"||command.pluginId!=="general")throw visualExplainerError("INVALID_VISUAL_ARTIFACT_PATCH","Embedded artifact patch must remain a General HTML widget.");
    const next=structuredClone(normalized);next.artifacts[index]={id,title:String(command.title||next.artifacts[index].title),html:String(command.html||""),sourceFormat:String(command.sourceFormat||"html"),...(command.frameworkVersion?{frameworkVersion:String(command.frameworkVersion)}:{}),refreshSeconds:Number(command.refreshSeconds)||0};return visualExplainerNormalizePlan(next);
  }
  function visualExplainerWaitForDiagnostics(widget,timeoutMs=3800) {
    if(widget?.visualDiagnostics)return Promise.resolve(structuredClone(widget.visualDiagnostics));if(!widget)return Promise.resolve(null);if(!(widget.visualDiagnosticWaiters instanceof Set))widget.visualDiagnosticWaiters=new Set();
    return new Promise(resolve=>{let settled=false;const finish=value=>{if(settled)return;settled=true;clearTimeout(timer);widget.visualDiagnosticWaiters?.delete(finish);resolve(value?structuredClone(value):null);},timer=setTimeout(()=>finish(null),Math.max(500,Math.min(5000,Number(timeoutMs)||3800)));widget.visualDiagnosticWaiters.add(finish);});
  }
