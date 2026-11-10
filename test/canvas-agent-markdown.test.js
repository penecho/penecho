"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const {parseHTML} = require("linkedom");
const MIXED_TEXT = require("../public/mixed-text.js");

const ROOT=path.resolve(__dirname,"..");
const source=fs.readFileSync(path.join(ROOT,"src/client/app/canvas-agent-runtime.js"),"utf8");
const css=fs.readFileSync(path.join(ROOT,"public/style.css"),"utf8");
function functionSource(name){
  let start=source.indexOf(`function ${name}(`);
  assert.notEqual(start,-1,`missing function ${name}`);
  if(source.slice(Math.max(0,start-6),start)==="async ")start-=6;
  const signatureEnd=source.indexOf(") {",start);
  assert.notEqual(signatureEnd,-1,`missing function body ${name}`);
  const body=signatureEnd+2;let depth=0;
  for(let index=body;index<source.length;index++){
    if(source[index]==="{")depth++;
    else if(source[index]==="}"&&--depth===0)return source.slice(start,index+1);
  }
  assert.fail(`unterminated function ${name}`);
}

function renderer(document,MathJax){
  const names=["canvasAgentFencedSegments","canvasAgentBlockLabel","canvasAgentMarkdownHref","canvasAgentDisplayMathSegments","canvasAgentSafeMathJaxNode","canvasAgentMarkdownMathNode","canvasAgentAppendMarkdownStyled","canvasAgentAppendMarkdownLinks","canvasAgentAppendMarkdownInline","canvasAgentMarkdownSafe","canvasAgentAppendMarkdown","canvasAgentRenderMessageBody"];
  return vm.runInNewContext(`(()=>{${names.map(functionSource).join("\n")}return canvasAgentRenderMessageBody;})()`,{
    document,URL,MIXED_TEXT,MathJax,CANVAS_AGENT_MARKDOWN_TEXT_LIMIT:12000,CANVAS_AGENT_MARKDOWN_LINE_LIMIT:240,CANVAS_AGENT_MARKDOWN_MARKER_LIMIT:800,CANVAS_AGENT_MARKDOWN_BACKSLASH_LIMIT:256,CANVAS_AGENT_MARKDOWN_SEGMENT_LIMIT:48,CANVAS_AGENT_MARKDOWN_MATH_COUNT_LIMIT:64,CANVAS_AGENT_MARKDOWN_MATH_SOURCE_LIMIT:4000,
    t:key=>({canvasAgentCodeBlock:"Code",canvasAgentTextBlock:"Text",canvasAgentCopyBlock:"Copy",canvasAgentBlockCopied:"Copied",canvasAgentBlockCopyFailed:"Copy failed"})[key]||key,
    writeClipboardText:async()=>true,setTimeout,
  });
}

function messageAppender(document,clipboardWrites){
  const names=["canvasAgentFencedSegments","canvasAgentBlockLabel","canvasAgentMarkdownHref","canvasAgentDisplayMathSegments","canvasAgentSafeMathJaxNode","canvasAgentMarkdownMathNode","canvasAgentAppendMarkdownStyled","canvasAgentAppendMarkdownLinks","canvasAgentAppendMarkdownInline","canvasAgentMarkdownSafe","canvasAgentAppendMarkdown","canvasAgentRenderMessageBody","canvasAgentSetAssistantCopyState","canvasAgentCopyAssistantMessage","canvasAgentSetAssistantCopyReady","canvasAgentAssistantPosition","canvasAgentAppendMessageElement"];
  const translations={canvasAgentCodeBlock:"Code",canvasAgentTextBlock:"Text",canvasAgentCopyBlock:"Copy",canvasAgentBlockCopied:"Copied",canvasAgentBlockCopyFailed:"Copy failed",canvasAgentCopyResponse:"Copy response",canvasAgentResponseCopied:"Copied",canvasAgentResponseCopyFailed:"Copy failed",canvasAgentLikeResponse:"Helpful",canvasAgentCriticizeResponse:"Needs improvement",canvasAgentHistoryAttachments:"{count} attachments"};
  const canvasAgentTranscript=document.querySelector("#transcript");
  return vm.runInNewContext(`(()=>{${names.map(functionSource).join("\n")}return {append:canvasAgentAppendMessageElement,copy:canvasAgentCopyAssistantMessage};})()`,{
    document,URL,MIXED_TEXT,canvasAgentTranscript,CANVAS_AGENT_MARKDOWN_TEXT_LIMIT:12000,CANVAS_AGENT_MARKDOWN_LINE_LIMIT:240,CANVAS_AGENT_MARKDOWN_MARKER_LIMIT:800,CANVAS_AGENT_MARKDOWN_BACKSLASH_LIMIT:256,CANVAS_AGENT_MARKDOWN_SEGMENT_LIMIT:48,CANVAS_AGENT_MARKDOWN_MATH_COUNT_LIMIT:64,CANVAS_AGENT_MARKDOWN_MATH_SOURCE_LIMIT:4000,
    t:key=>translations[key]||key,
    writeClipboardText:async value=>{clipboardWrites.push(String(value));return true;},
    canvasAgentActionIcon:()=>document.createElementNS("http://www.w3.org/2000/svg","svg"),
    canvasAgentSyncAssistantActionState:target=>{
      const ready=target.historyItem.copyable===true;
      target.copyActions.hidden=!ready;
      target.copyButton.disabled=!ready;
      for(const feedbackButton of target.feedbackButtons)feedbackButton.hidden=true;
      target.retryButton.hidden=true;
    },
    canvasAgentEvaluateAssistantMessage:()=>false,canvasAgentRetryAssistantMessage:async()=>false,
    setTimeout:()=>0,clearTimeout:()=>{},
  });
}

test("PenEcho Agent final replies use the quiet workbench typography hierarchy",()=>{
  assert.match(css,/\.canvas-agent-message\.assistant:not\(\.error\):not\(\.canvas-agent-public-progress\)\s*\{[\s\S]*?width:\s*min\(100%, 68ch\);[\s\S]*?max-width:\s*100%;/);
  assert.match(css,/\.canvas-agent-message\.assistant:not\(\.error\):not\(\.canvas-agent-public-progress\) \.canvas-agent-message-role\s*\{[^}]*display:\s*none;/);
  assert.match(css,/\.canvas-agent-message\.assistant:not\(\.error\):not\(\.canvas-agent-public-progress\) \.canvas-agent-message-body\s*\{[^}]*padding:\s*0;[^}]*border:\s*0;[^}]*border-radius:\s*0;[^}]*background:\s*transparent;/);
  assert.match(css,/body\[data-theme="studio"\] \.canvas-agent-message\.assistant:not\(\.error\):not\(\.canvas-agent-public-progress\) \.canvas-agent-message-body\s*\{[^}]*border:\s*0;[^}]*background:\s*transparent;/);
  assert.match(css,/\.canvas-agent-message-body\.is-markdown strong\s*\{[^}]*font-weight:\s*500;/);
  assert.match(css,/\.canvas-agent-message-body\.is-markdown \.canvas-agent-markdown-heading\s*\{[^}]*font-size:\s*\.875rem;[^}]*font-weight:\s*600;/);
  assert.match(css,/\.canvas-agent-message-body\.is-markdown blockquote\s*\{[^}]*border-inline-start:\s*1px solid #cbd5e1;[^}]*background:\s*transparent;/);
  assert.match(css,/\.canvas-agent-message-actions\s*\{[^}]*min-height:\s*28px;[^}]*justify-content:\s*flex-start;/);
  assert.match(css,/\.canvas-agent-message\.assistant:not\(\.error\):not\(\.interrupted\):not\(\.canvas-agent-public-progress\)[\s\S]*?\.canvas-agent-markdown-heading,[\s\S]*?p > strong:first-child,[\s\S]*?li > strong:first-child[\s\S]*?color:\s*var\(--pe-accent-label\);/);
  assert.match(css,/\.canvas-agent-message\.interrupted \.canvas-agent-message-body\s*\{[^}]*opacity:\s*1;/);
  assert.doesNotMatch(css,/\.canvas-agent-message\.interrupted \.canvas-agent-message-body\s*\{[^}]*opacity:\s*\.68;/);
});

test("PenEcho Agent final messages render safe compact Markdown while user and streaming text stay literal",()=>{
  const {document}=parseHTML("<!doctype html><html><body><div id=body></div></body></html>"),body=document.querySelector("#body"),render=renderer(document);
  render(body,"# 总结\n\n- **已完成** 画布布局\n- 查看 [参考资料](https://example.com/source)\n\n> 可见结果已核对\n\n行内 `canvas` 代码","assistant");
  assert.equal(body.classList.contains("is-markdown"),true);
  assert.equal(body.querySelector(".canvas-agent-markdown-heading")?.textContent,"总结");
  assert.equal(body.querySelectorAll("li").length,2);
  assert.equal(body.querySelector("strong")?.textContent,"已完成");
  assert.equal(body.querySelector("blockquote")?.textContent,"可见结果已核对");
  assert.equal(body.querySelector("p code")?.textContent,"canvas");
  const link=body.querySelector("a");
  assert.equal(link?.getAttribute("href"),"https://example.com/source");
  assert.equal(link?.target,"_blank");
  assert.match(link?.rel||"",/noopener/);

  render(body,"**streaming**","assistant",{final:false});
  assert.equal(body.textContent,"**streaming**");
  assert.equal(body.querySelector("strong"),null);
  render(body,"**streaming complete**","assistant",{final:true});
  assert.equal(body.querySelector("strong")?.textContent,"streaming complete");

  render(body,"**user text**","user");
  assert.equal(body.textContent,"**user text**");
  assert.equal(body.querySelector("strong"),null);
});

test("PenEcho Agent renders inline and multiline display TeX in final summaries",async()=>{
  const {document}=parseHTML("<!doctype html><html><body><div id=body></div></body></html>"),body=document.querySelector("#body"),calls=[],MathJax={
    async tex2svgPromise(tex,options){
      calls.push({tex,options});
      const container=document.createElement("mjx-container"),svg=document.createElement("svg");
      svg.append(document.createElement("path"));container.append(svg);return container;
    },
  },render=renderer(document,MathJax);
  render(body,"- Odd degree for \\(C^0\\) embeddings.\n\n\\[\nH^4(W,\\partial W;\\mathbb Z)\\cong \\mathbb Z/2,\n\\qquad e(E,n_\\partial)=\\kappa(\\gamma,r)\\bmod 2.\n\\]","assistant");
  await new Promise(resolve=>setImmediate(resolve));
  const math=[...body.querySelectorAll(".canvas-agent-markdown-math")];
  assert.equal(math.length,2);
  assert.equal(math[0].classList.contains("is-inline"),true);
  assert.equal(math[1].classList.contains("is-display"),true);
  assert.equal(math.every(node=>node.classList.contains("is-rendered")),true);
  assert.equal(math.every(node=>node.getAttribute("role")==="math"),true);
  assert.deepEqual(calls.map(call=>call.options.display),[false,true]);
  assert.match(calls[1].tex,/H\^4\(W,\\partial W;\\mathbb Z\)\\cong/);
});

test("PenEcho Agent preserves literal TeX when MathJax output is unavailable or unsafe",async()=>{
  const {document}=parseHTML("<!doctype html><html><body><div id=body></div></body></html>"),body=document.querySelector("#body"),unsafeMathJax={
    async tex2svgPromise(){
      const container=document.createElement("mjx-container"),svg=document.createElement("svg"),link=document.createElement("a");
      link.setAttribute("href","javascript:alert(1)");svg.append(link);container.append(svg);return container;
    },
  },render=renderer(document,unsafeMathJax),source="Unsafe \\(x^2\\)";
  render(body,source,"assistant");
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(body.querySelector(".canvas-agent-markdown-math")?.textContent,"\\(x^2\\)");
  assert.equal(body.querySelector(".canvas-agent-markdown-math")?.classList.contains("is-fallback"),true);
  assert.equal(body.querySelector("a"),null);
});

test("PenEcho Agent keeps display delimiters literal inside inline code",async()=>{
  const {document}=parseHTML("<!doctype html><html><body><div id=body></div></body></html>"),body=document.querySelector("#body"),calls=[],MathJax={
    async tex2svgPromise(tex){
      calls.push(tex);
      const container=document.createElement("mjx-container"),svg=document.createElement("svg");
      svg.append(document.createElement("path"));container.append(svg);return container;
    },
  },render=renderer(document,MathJax);
  render(body,"Keep `\\[literal\\]` and render \\(x^2\\).","assistant");
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(body.querySelector("code")?.textContent,"\\[literal\\]");
  assert.deepEqual(calls,["x^2"]);
});

test("PenEcho Agent Markdown never executes model HTML or unsafe links and preserves fenced payloads",()=>{
  const {document}=parseHTML("<!doctype html><html><body><div id=body></div></body></html>"),body=document.querySelector("#body"),render=renderer(document);
  render(body,'<img src=x onerror="alert(1)"> [bad](javascript:alert(1)) [credentials](https://user:pass@example.com)',"assistant");
  assert.equal(body.querySelector("img"),null);
  assert.equal(body.querySelector("a"),null);
  assert.match(body.textContent,/<img src=x/);
  assert.match(body.textContent,/javascript:alert/);
  render(body,'[mail](mailto:test@example.com?subject=ok%0d%0abcc:other@example.com)',"assistant");
  assert.equal(body.querySelector("a"),null,"encoded mail headers are not exposed as a safe link");

  render(body,"# C#\n\n`[literal](https://example.com)` and **[balanced](https://example.com/a(b))**","assistant");
  assert.equal(body.querySelector(".canvas-agent-markdown-heading")?.textContent,"C#");
  assert.equal(body.querySelector("code")?.textContent,"[literal](https://example.com)");
  assert.equal(body.querySelector("code a"),null);
  assert.equal(body.querySelector("strong a")?.getAttribute("href"),"https://example.com/a(b)");

  render(body,"Before\n```js\nconst value = '**literal**';\n```\nAfter","assistant");
  const block=body.querySelector(".canvas-agent-copy-block");
  assert.equal(block?.querySelector("code")?.textContent,"const value = '**literal**';");
  assert.equal(block?.querySelector("strong"),null,"fenced content is not parsed a second time");
  assert.equal(block?.querySelector("button")?.textContent,"Copy");

  const renderingSource=["canvasAgentMarkdownHref","canvasAgentAppendMarkdownStyled","canvasAgentAppendMarkdownLinks","canvasAgentAppendMarkdownInline","canvasAgentMarkdownSafe","canvasAgentAppendMarkdown","canvasAgentRenderMessageBody"].map(functionSource).join("\n");
  assert.doesNotMatch(renderingSource,/\.innerHTML\s*=/);
});

test("PenEcho Agent Markdown has a bounded fallback for pathological final text",()=>{
  const {document}=parseHTML("<!doctype html><html><body><div id=body></div></body></html>"),body=document.querySelector("#body"),render=renderer(document),pathological=`**title** ${"\\".repeat(300)}`;
  render(body,pathological,"assistant");
  assert.equal(body.classList.contains("is-markdown"),false);
  assert.equal(body.textContent,pathological);
  const nodeHeavy="$x$ ".repeat(500);
  render(body,nodeHeavy,"assistant");
  assert.equal(body.classList.contains("is-markdown"),false,"dense inline math falls back before creating thousands of DOM nodes");
  assert.equal(body.childNodes.length,1);
  const bareNodeHeavy=Array.from({length:65},()=>"A_x").join(" ");
  render(body,bareNodeHeavy,"assistant");
  assert.equal(body.classList.contains("is-markdown"),false,"bare TeX is bounded even without dense delimiter markers");
});

test("PenEcho Agent live and persisted messages share one explicit display limit",()=>{
  const messageText=vm.runInNewContext(`(()=>{${functionSource("canvasAgentMessageText")}return canvasAgentMessageText;})()`,{CANVAS_AGENT_HISTORY_TEXT_LIMIT:20000}),bounded=messageText("x".repeat(25000)),emojiBoundary=messageText(`${"x".repeat(19998)}😀tail`);
  assert.equal(bounded.length,20000);
  assert.equal(bounded.endsWith("…"),true);
  assert.equal(emojiBoundary,`${"x".repeat(19998)}…`,"the display limit never leaves an unmatched emoji surrogate");
  assert.match(source,/text:item\.role==="assistant"\?canvasAgentVisibleAssistantText\(item\.text\):canvasAgentMessageText\(item\.text\)[\s\S]*?final:item\.final!==false/);
  assert.match(source,/target\.messageText = canvasAgentVisibleAssistantText\(target\.messageText \+ \(event\.text \|\| ""\)\)/);
});

function assistantEventHarness(initialTargets=[]) {
  let id=0;
  const created=[],rendered=[],canvasAgent={assistantRows:new Map(),currentConversation:{items:[]},viewingHistoryId:""};
  for(const target of initialTargets){
    canvasAgent.assistantRows.set(target.historyItem.eventKey,target);
    canvasAgent.currentConversation.items.push(target.historyItem);
  }
  const canvasAgentRow=(role,text,attachments,options)=>{
    const item={id:`row-${++id}`,type:"message",role,text,eventKey:options.eventKey,turn:options.turn,step:options.step,final:options.final!==false,copyable:false},
      target={messageText:text,body:{},historyItem:item,row:{classList:{add(){}}},turn:options.turn,step:options.step};
    canvasAgent.currentConversation.items.push(item);created.push(target);return target;
  },names=["canvasAgentAssistantPosition","canvasAgentPendingAssistantRow","canvasAgentCreateAssistantRow","canvasAgentHandleEvent"],
    handleEvent=vm.runInNewContext(`(()=>{${names.map(functionSource).join("\n")}return canvasAgentHandleEvent;})()`,{
      canvasAgent,canvasAgentRow,canvasClientId:()=>`event-${++id}`,canvasAgentMessageText:value=>String(value||""),canvasAgentVisibleAssistantText:value=>String(value||""),
      canvasAgentScheduleAssistantRender:target=>rendered.push({body:target.body,text:target.messageText,role:"assistant",options:{final:false}}),
      canvasAgentRenderFinalAssistantMessage:target=>rendered.push({body:target.body,text:target.messageText,role:"assistant",options:{final:true}}),
      canvasAgentFlushAssistantRenders:()=>{},canvasAgentScheduleHistoryPersist:()=>{},canvasAgentScrollToLatest:()=>{},
    });
  return {canvasAgent,created,rendered,handleEvent};
}

test("PenEcho Agent final assistant_message is authoritative over its streamed deltas",()=>{
  const handle=functionSource("canvasAgentHandleEvent");
  assert.match(handle,/assistant_delta[\s\S]*?canvasAgentScheduleAssistantRender\(target\)/);
  assert.match(handle,/assistant_message[\s\S]*?if\(typeof event\.text==="string"\)target\.messageText=canvasAgentVisibleAssistantText\(event\.text\)[\s\S]*?canvasAgentRenderFinalAssistantMessage\(target\)[\s\S]*?historyItem\.text=target\.messageText/);
  assert.match(handle,/historyItem\.final=false[\s\S]*?historyItem\.final=true/);
  assert.doesNotMatch(handle,/event\.text && !target\.messageText/);
  assert.match(source,/canvasAgentAppendMessageElement\(item[\s\S]*?final:item\.role!=="assistant"\|\|item\.final!==false/);
  const target={messageText:"streamed draft",body:{},historyItem:{type:"message",role:"assistant",text:"streamed draft",eventKey:"7:2:existing",turn:7,step:2,final:false},row:{classList:{add(){}}}},
    {rendered,handleEvent}=assistantEventHarness([target]);
  handleEvent({kind:"assistant_message",turn:7,step:2,text:""});
  assert.equal(target.messageText,"","an explicitly empty authoritative final clears stale streamed text");
  assert.equal(target.historyItem.text,"");
  assert.equal(target.historyItem.final,true);
  assert.equal(rendered.length,1);
  assert.equal(rendered[0].text,"");
  assert.equal(rendered[0].role,"assistant");
  assert.equal(rendered[0].options.final,true);
});

test("PenEcho Agent keeps completed assistant messages distinct and appends the final summary",()=>{
  const progress={messageText:"Progress: translating the widget",body:{},historyItem:{type:"message",role:"assistant",text:"Progress: translating the widget",eventKey:"1:0:progress",turn:1,step:0,final:true},row:{classList:{add(){}}}},
    harness=assistantEventHarness([progress]);
  harness.handleEvent({kind:"assistant_message",turn:1,text:"Translation completed."});
  assert.equal(progress.messageText,"Progress: translating the widget");
  assert.equal(harness.created.length,1);
  assert.equal(harness.created[0].messageText,"Translation completed.");
  assert.equal(harness.created[0].historyItem.final,true);
  assert.equal(harness.canvasAgent.currentConversation.items.at(-1),harness.created[0].historyItem,"the final summary is appended after prior activity");

  harness.handleEvent({kind:"assistant_message",turn:1,text:"A separate completed note."},{replay:true});
  assert.equal(harness.created.length,2,"backlog replay also preserves separate completed messages");
  assert.notEqual(harness.created[0].historyItem.eventKey,harness.created[1].historyItem.eventKey);
});

test("PenEcho Agent starts a new streaming row after a completed assistant message",()=>{
  const completed={messageText:"First completed message",body:{},historyItem:{type:"message",role:"assistant",text:"First completed message",eventKey:"5:3:complete",turn:5,step:3,final:true},row:{classList:{add(){}}}},
    harness=assistantEventHarness([completed]);
  harness.handleEvent({kind:"assistant_delta",turn:5,step:3,text:"New streamed draft"});
  assert.equal(completed.messageText,"First completed message");
  assert.equal(harness.created.length,1);
  assert.equal(harness.created[0].messageText,"New streamed draft");
  assert.equal(harness.created[0].historyItem.final,false);
  harness.handleEvent({kind:"assistant_message",turn:5,step:3,text:"New authoritative final"});
  assert.equal(harness.created.length,1,"the final still merges with its own pending stream");
  assert.equal(harness.created[0].messageText,"New authoritative final");
  assert.equal(harness.created[0].historyItem.final,true);
});

test("PenEcho Agent enables response copy only for the last completed assistant step in a turn",()=>{
  const intermediateItem={type:"message",role:"assistant",turn:4,step:1,final:true,copyable:false},toolItem={type:"tool",turn:4,step:2},summaryItem={type:"message",role:"assistant",turn:4,step:3,final:true,copyable:false},otherTurnItem={type:"message",role:"assistant",turn:3,step:8,final:true,copyable:false},
    intermediate={messageText:"Inspecting the canvas",historyItem:intermediateItem},summary={messageText:"Final summary",historyItem:summaryItem},otherTurn={messageText:"Other turn",historyItem:otherTurnItem},marked=[],
    canvasAgent={currentConversation:{items:[intermediateItem,toolItem,summaryItem,otherTurnItem]},assistantRows:new Map([["4:1:intermediate",intermediate],["3:8:other",otherTurn],["4:3:summary",summary]])};
  const mark=vm.runInNewContext(`(()=>{${functionSource("canvasAgentAssistantPosition")}\n${functionSource("canvasAgentMarkTurnSummaryCopyable")}return canvasAgentMarkTurnSummaryCopyable;})()`,{canvasAgent,canvasAgentSetAssistantCopyReady:(target,ready)=>{target.historyItem.copyable=ready;marked.push(target);},canvasAgentSyncAssistantActions(){}});
  assert.equal(mark(4),true);
  assert.deepEqual(marked,[summary]);
  assert.equal(intermediate.historyItem.copyable,false);
  assert.equal(summary.historyItem.copyable,true);
  assert.equal(otherTurn.historyItem.copyable,false);
  canvasAgent.assistantRows.delete("4:3:summary");
  marked.length=0;
  assert.equal(mark(4),false,"an assistant preamble before the last tool is not treated as a final summary");
  assert.deepEqual(marked,[]);
});

test("PenEcho Agent restores copy only on final summaries from legacy history",()=>{
  const restore=vm.runInNewContext(`(()=>{${functionSource("canvasAgentRestoreLegacyCopyableSummaries")}return canvasAgentRestoreLegacyCopyableSummaries;})()`),items=[
    {type:"message",role:"user",text:"change the canvas"},
    {type:"message",role:"assistant",text:"I will inspect it",final:true},
    {type:"tool",name:"canvas_inspect"},
    {type:"message",role:"assistant",text:"The requested update is complete",final:true},
    {type:"message",role:"user",text:"one more thing"},
    {type:"message",role:"assistant",text:"streaming draft",final:false,copyable:false},
  ];
  restore(items);
  assert.equal(items[1].copyable,false);
  assert.equal(items[3].copyable,true);
  assert.equal(items[5].copyable,false);
});

test("PenEcho Agent copies only the authoritative final assistant response",async()=>{
  const {document}=parseHTML("<!doctype html><html><body><div id=transcript><details>hidden tool execution and reasoning</details></div></body></html>"),clipboardWrites=[],renderer=messageAppender(document,clipboardWrites),append=renderer.append,transcript=document.querySelector("#transcript");
  const partial=append({role:"assistant",text:"temporary streamed draft",final:false},[],true);
  assert.equal(partial.row.getAttribute("aria-label"),"canvasAgent","the visually quiet assistant row keeps an accessible role name");
  assert.equal(partial.copyActions.hasAttribute("hidden"),true,"streamed assistant deltas do not expose copy");
  assert.equal(partial.copyButton.disabled,true);

  const intermediate=append({role:"assistant",text:"I will inspect the canvas now.",final:true,copyable:false},[],true);
  assert.equal(intermediate.copyActions.hasAttribute("hidden"),true,"completed intermediate assistant steps remain outside the copy surface");

  const user=append({role:"user",text:"user prompt"},[],true);
  assert.equal(user.copyButton,null,"user messages do not expose the response copy action");

  const finalText="# Final summary\n\n- Completed the requested canvas change\n- Preserved the result exactly";
  const final=append({role:"assistant",text:finalText,final:true,copyable:true},[],true);
  assert.equal(final.copyActions.hasAttribute("hidden"),false);
  assert.equal(final.copyButton.dataset.peButton,"icon");
  assert.equal(final.copyButton.textContent,"");
  assert.equal(final.copyButton.querySelector("svg")?.getAttribute("viewBox"),"0 0 24 24");
  assert.equal(final.feedbackButtons.map(button=>button.dataset.action).join(","),"like,criticism");
  assert.equal(final.feedbackButtons.map(button=>button.getAttribute("aria-label")).join(","),"Helpful,Needs improvement");
  assert.equal(final.copyActions.querySelectorAll("button").length,4,"copy, helpful, needs-improvement, and retry remain separate actions");
  assert.equal(final.copyButton.getAttribute("aria-label"),"Copy response");
  assert.equal(final.copyButton.dataset.peState,"default");
  await renderer.copy(final);
  assert.deepEqual(clipboardWrites,[finalText]);
  assert.equal(final.copyButton.textContent,"");
  assert.equal(final.copyButton.getAttribute("aria-label"),"Copied");
  assert.equal(final.copyButton.dataset.peState,"success");
  assert.doesNotMatch(clipboardWrites[0],/tool execution|reasoning|user prompt|temporary streamed draft|inspect the canvas/);
  assert.match(transcript.textContent,/hidden tool execution and reasoning/,"execution UI remains visible but outside the copied payload");
});
