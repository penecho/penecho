"use strict";
// Review real local traces without sending source, images or credentials anywhere.
const fs=require("node:fs"),path=require("node:path"),os=require("node:os"),crypto=require("node:crypto");
const SMART=require("../public/smart-suggest.js");
const traces=path.join(os.homedir(),".penecho/logs/requests");
const reviewed={
  "1ad6e191-0b03-44e3-8ea1-bb3e81d56656":{expected:"penecho_agent",request:"Strike marks over IndexedDB snapshot",issue:"The historical observedText names cloud-* / mcp-settings.js, but the captured marks cover IndexedDB snapshot. Routing alone cannot guarantee mark interpretation."},
  "a44c8207-e898-41b8-bc75-10b3d963d98f":{expected:"penecho_agent",request:"Circle and emphasis over IndexedDB snapshot"},
  "2ebd772a-ef41-4791-9126-2ff9e15b6ded":{expected:"canvas_ai",request:"Remove crossed-out New York clock content"},
  "c9b16601-9508-425a-83e1-d17b5dd9604e":{expected:"canvas_ai",request:"Date: add local dates to the three clocks"},
  "8c5ef3a8-324d-404d-b902-79f16d8b6d66":{expected:"canvas_ai",request:"Colorful: adjust clock colors"},
  "621fd528-6e40-4e6d-871d-170eca8ecf25":{expected:"canvas_ai",request:"Remove the crossed-out rainbow legend"},
  "a7f2f9e8-c25c-4ea0-824e-143accedbb6c":{expected:"canvas_ai",request:"Colorful: adjust the single clock colors"},
};
const jsonBlock=html=>{const match=/<script\b[^>]*data-architecture-source[^>]*>([\s\S]*?)<\/script>/i.exec(html||"");try{return match?JSON.parse(match[1]):null;}catch{return null;}};
const cases=[];
for(const directory of fs.readdirSync(traces).sort().reverse()) {
  const filename=path.join(traces,directory,"trace.json");if(!fs.existsSync(filename))continue;
  const trace=JSON.parse(fs.readFileSync(filename,"utf8")),review=reviewed[trace.requestId];if(!review)continue;
  const input=trace.modelInput.widgetEdit,source=input.html||input.source||"",body=trace.final?.body||{},output=body.commands?.[0]?.html||"";
  const route=SMART.widgetRefineRoute(input,{actionId:input.actionId||"apply_marks",instruction:input.instruction||""});
  const scripts=[...source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)],executableChars=scripts.filter(([,attrs])=>!/application\/(?:ld\+)?json/i.test(attrs)).reduce((sum,[,,code])=>sum+code.length,0);
  const before=jsonBlock(source),after=jsonBlock(output);
  cases.push({requestId:trace.requestId,startedAt:trace.startedAt,title:input.title,request:review.request,expected:review.expected,route,matched:route.executor===review.expected,
    sourceFacts:{widgetType:input.widgetType,pluginId:input.pluginId,sourceFormat:input.sourceFormat||null,sourceChars:source.length,executableChars,sha256:crypto.createHash('sha256').update(source).digest('hex')},
    historical:{executor:"canvas_ai",status:trace.status,httpStatus:trace.final?.httpStatus,attempts:trace.attempts?.length,observedText:body.observedText||null,
      ...(before&&after?{semanticDiagramChanged:JSON.stringify(before)!==JSON.stringify(after),nodesBefore:before.nodes.length,nodesAfter:after.nodes.length}:{}),...(review.issue?{issue:review.issue}:{})},traceFile:filename});
}
const report={auditedAt:new Date().toISOString(),scope:"Seven real Widget Refine requests on 2026-10-01; synthetic ranking replays and Delete actions excluded.",
  passed:cases.length===Object.keys(reviewed).length&&cases.every(row=>row.matched),matched:cases.filter(row=>row.matched).length,total:cases.length,
  limitation:"This verifies deterministic executor selection against manually reviewed targets and marks, not actual Agent execution success. Historical HTTP 200 does not prove semantic correctness.",cases};
const output=process.argv.find(arg=>arg.startsWith("--output="))?.slice(9);
if(output){fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+"\n");}
console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
