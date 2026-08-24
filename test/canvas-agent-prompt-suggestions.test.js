"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const {parseHTML} = require("linkedom");

const ROOT=path.resolve(__dirname,".."),
  runtime=fs.readFileSync(path.join(ROOT,"src/client/app/canvas-agent-runtime.js"),"utf8"),
  html=fs.readFileSync(path.join(ROOT,"public/index.html"),"utf8"),
  css=fs.readFileSync(path.join(ROOT,"public/style.css"),"utf8"),
  english=fs.readFileSync(path.join(ROOT,"src/client/app/core.js"),"utf8"),
  chinese=fs.readFileSync(path.join(ROOT,"public/locales/zh.js"),"utf8");

function functionSource(name){
  const start=runtime.indexOf(`function ${name}(`);
  assert.notEqual(start,-1,`missing function ${name}`);
  const body=runtime.indexOf("{",start);let depth=0;
  for(let index=body;index<runtime.length;index++){
    if(runtime[index]==="{")depth++;
    else if(runtime[index]==="}"&&--depth===0)return runtime.slice(start,index+1);
  }
  assert.fail(`unterminated function ${name}`);
}

test("Canvas Agent prompt suggestions use one compact expandable shelf above the input",()=>{
  const {document}=parseHTML(html),form=document.querySelector("#canvasAgentForm"),suggestions=document.querySelector("#canvasAgentPromptSuggestions"),surface=form.querySelector(".canvas-agent-composer-surface");
  assert.ok(suggestions);
  assert.equal(suggestions.nextElementSibling,surface);
  assert.equal(suggestions.hasAttribute("hidden"),true);
  assert.equal(suggestions.getAttribute("role"),"group");
  assert.equal(suggestions.querySelector("#canvasAgentPromptToggle")?.getAttribute("aria-expanded"),"false");
  assert.match(css,/\.canvas-agent-prompt-list\s*\{[^}]*repeat\(3,/);
  assert.match(css,/\.canvas-agent-prompt-suggestions:not\(\.expanded\)[^{]*nth-child\(n\+4\)/);
});

test("Canvas Agent prompt suggestions appear only for an idle empty text composer",()=>{
  const input={value:"",disabled:false},form={contains:node=>node===input},document={activeElement:input},panel={hidden:false},referencePicker={hidden:true},approval={hidden:true},suggestions={},canvasAgent={
    inputMode:"text",inkPresent:false,requestPending:false,running:false,viewingHistoryId:"",pendingApproval:null,attachmentBusy:false,projectUploadBusy:false,
  },shouldShow=vm.runInNewContext(`(()=>{${functionSource("canvasAgentShouldShowPromptSuggestions")}return canvasAgentShouldShowPromptSuggestions;})()`,{
    canvasAgentPromptSuggestions:suggestions,canvasAgentPanel:panel,canvasAgentForm:form,document,canvasAgent,canvasAgentInput:input,canvasAgentReferencePicker:referencePicker,canvasAgentApproval:approval,
  });
  assert.equal(shouldShow(),true);
  const blockers=[
    [input,"value","draft"],[canvasAgent,"requestPending",true],[canvasAgent,"running",true],[canvasAgent,"inputMode","ink"],[canvasAgent,"inkPresent",true],
    [canvasAgent,"viewingHistoryId","history"],[canvasAgent,"pendingApproval",{}],[canvasAgent,"attachmentBusy",true],[canvasAgent,"projectUploadBusy",true],
    [input,"disabled",true],[referencePicker,"hidden",false],[approval,"hidden",false],[panel,"hidden",true],[document,"activeElement",{}],
  ];
  for(const [target,key,value] of blockers){
    const previous=target[key];target[key]=value;
    assert.equal(shouldShow(),false,`${key} should hide suggestions`);
    target[key]=previous;
  }
});

test("Choosing a Canvas Agent suggestion fills the composer without submitting",()=>{
  const input={value:"",disabled:false,events:0,focused:false,selection:null,dispatchEvent(){this.events++;},focus(){this.focused=true;},setSelectionRange(start,end){this.selection=[start,end];}},
    suggestions=[{label:"label",prompt:"prompt"}],expansions=[],translations={prompt:"Polished prompt"},
    choose=vm.runInNewContext(`(()=>{${functionSource("canvasAgentChoosePromptSuggestion")}return canvasAgentChoosePromptSuggestion;})()`,{
      CANVAS_AGENT_PROMPT_SUGGESTIONS:suggestions,canvasAgentInput:input,t:key=>translations[key]||key,canvasAgentSetPromptSuggestionsExpanded:value=>expansions.push(value),Event:class Event{constructor(type,options){this.type=type;this.options=options;}},
    });
  assert.equal(choose("prompt"),true);
  assert.equal(input.value,"Polished prompt");
  assert.deepEqual(expansions,[false]);
  assert.equal(input.events,1);
  assert.equal(input.focused,true);
  assert.deepEqual(input.selection,[15,15]);
});

test("Canvas Agent ships nine localized, reusable prompt examples",()=>{
  const labels=["File","Architecture","SimpleDiagram","Ppt","Handwriting","Excel","Transformer","UkTrip","Organize"];
  for(const label of labels){
    assert.match(runtime,new RegExp(`canvasAgentPrompt${label}Label`));
    assert.match(english,new RegExp(`canvasAgentPrompt${label}:`));
    assert.match(chinese,new RegExp(`canvasAgentPrompt${label}:`));
  }
  assert.equal((runtime.match(/\{label:"canvasAgentPrompt/g)||[]).length,9);
});
