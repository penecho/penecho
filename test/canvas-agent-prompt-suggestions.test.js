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
  const signature=runtime.indexOf("(",start);let parentheses=0,signatureEnd=-1;
  for(let index=signature;index<runtime.length;index++){
    if(runtime[index]==="(")parentheses++;
    else if(runtime[index]===")"&&--parentheses===0){signatureEnd=index;break;}
  }
  assert.notEqual(signatureEnd,-1,`unterminated signature ${name}`);
  const body=runtime.indexOf("{",signatureEnd);let depth=0;
  for(let index=body;index<runtime.length;index++){
    if(runtime[index]==="{")depth++;
    else if(runtime[index]==="}"&&--depth===0)return runtime.slice(start,index+1);
  }
  assert.fail(`unterminated function ${name}`);
}

function promptConstants(){
  const start=runtime.indexOf("CANVAS_AGENT_PROMPT_LIBRARY ="),end=runtime.indexOf("  const canvasAgent =",start);
  assert.notEqual(start,-1);assert.notEqual(end,-1);
  const declarations=runtime.slice(start,end).trim();
  return vm.runInNewContext(`(()=>{const ${declarations}\nreturn {library:CANVAS_AGENT_PROMPT_LIBRARY,iconPaths:CANVAS_AGENT_PROMPT_ICON_PATHS,additional:CANVAS_AGENT_PROMPT_ADDITIONAL,primary:CANVAS_AGENT_PROMPT_PRIMARY};})()`);
}

function translation(source,key){
  const match=source.match(new RegExp(`(?:^|\\n)\\s*${key}: "((?:\\\\.|[^"\\\\])*)"`));
  assert.ok(match,`missing translation ${key}`);
  return JSON.parse(`"${match[1]}"`);
}

test("PenEcho Agent keeps the Revise pencil seam inside its icon viewBox",()=>{
  const {iconPaths}=promptConstants();
  assert.equal(iconPaths.revise[1],"M13.5 9l3.5 3.5M4 5h6M4 9h5");
});

test("Agent suggestion eligibility is independent of input text and panel presentation",()=>{
  const input={value:"",disabled:false},form={contains:node=>node===input},document={activeElement:null},panel={hidden:true,dataset:{}},control={hidden:true},suggestions={contains:()=>false},canvasAgent={inputMode:"text",inkPresent:false,attachments:[],references:[],requestPending:false,running:false,viewingHistoryId:"",pendingApproval:null,attachmentBusy:false,projectUploadBusy:false},referencePicker={hidden:true},approval={hidden:true},context={canvasAgentPromptControl:control,canvasAgentPromptSuggestions:suggestions,canvasAgentPanel:panel,canvasAgentForm:form,document,canvasAgent,canvasAgentInput:input,canvasAgentReferencePicker:referencePicker,canvasAgentApproval:approval};
  const available=vm.runInNewContext(`(()=>{${functionSource("canvasAgentPromptSuggestionsAvailable")}return canvasAgentPromptSuggestionsAvailable;})()`,context);
  assert.equal(available(),true,"new/load can prepare the top view before the panel becomes visible");
  const blockers=[[canvasAgent,"requestPending",true],[canvasAgent,"running",true],[canvasAgent,"inputMode","ink"],[canvasAgent,"inkPresent",true],[canvasAgent,"viewingHistoryId","history"],[canvasAgent,"pendingApproval",{}],[canvasAgent,"attachmentBusy",true],[canvasAgent,"projectUploadBusy",true],[input,"disabled",true],[referencePicker,"hidden",false],[approval,"hidden",false]];
  for(const [target,key,value] of blockers){const previous=target[key];target[key]=value;assert.equal(available(),false,`${key} should hide suggestions`);target[key]=previous;}
});

test("PenEcho Agent classifies image, Office, document, code, and generic files",()=>{
  const classify=vm.runInNewContext(`(()=>{${functionSource("canvasAgentPromptFileContext")}return canvasAgentPromptFileContext;})()`);
  assert.equal(classify({kind:"image",name:"photo.bin"}),"image");assert.equal(classify({name:"budget.xlsx",mediaType:"application/octet-stream"}),"spreadsheet");assert.equal(classify({name:"deck.pptx"}),"presentation");assert.equal(classify({name:"paper.pdf"}),"document");assert.equal(classify({name:"agent.ts"}),"code");assert.equal(classify({name:"archive.bin"}),"file");
});

test("PenEcho Agent intent precedence follows explicit choices before inferred canvas content",()=>{
  let selected=false,project=null,hasInk=false,hasContent=false;
  const canvasAgent={attachments:[],projectId:""},state={selection:null,images:[],widgets:[],textBoxes:[],animations:[],preservedSnapshotAnimations:[]},scope={canvasAgent,state,SIZE:100,canvasAgentReferencedIds:()=>selected?["selected"]:[],canvasAgentProjectById:()=>project,visibleInkBounds:()=>hasInk?{x:1,y:1,w:2,h:2}:null,canvasAgentContentBounds:()=>hasContent?{x:1,y:1,w:2,h:2}:null};
  scope.canvasAgentPromptFileContext=vm.runInNewContext(`(()=>{${functionSource("canvasAgentPromptFileContext")}return canvasAgentPromptFileContext;})()`);
  const context=vm.runInNewContext(`(()=>{${functionSource("canvasAgentPromptContext")}return canvasAgentPromptContext;})()`,scope);
  assert.equal(context(),"blank");hasContent=true;assert.equal(context(),"canvas");state.images.push({});assert.equal(context(),"image");hasInk=true;assert.equal(context(),"notes");project={kind:"folder"};canvasAgent.projectId="folder-1";assert.equal(context(),"project");selected=true;assert.equal(context(),"selection");canvasAgent.attachments=[{kind:"file",name:"budget.xlsx"}];assert.equal(context(),"spreadsheet");canvasAgent.attachments=[{kind:"image",name:"photo.png"}];assert.equal(context(),"image");
});

test("PenEcho Agent adds three distinct Files requests and three distinct Create requests",()=>{
  const constants=promptConstants(),expected=[
    ["compareFiles","files","Compare Related Files","比较相关文件"],
    ["projectEvidence","files","Find Evidence Across the Project","查找项目依据"],
    ["releaseReadiness","files","Review the Project for Release","检查发布就绪状态"],
    ["interactivePrototype","create","Clickable prototype","可点击原型"],
    ["interactiveCalculator","create","Create an Interactive Calculator","创建交互式计算器"],
    ["selfCheckQuiz","create","Self-check quiz","自测测验"],
  ];
  assert.equal(new Set(constants.additional).size,constants.additional.length);
  for (const [id] of expected) assert.ok(constants.additional.includes(id));
  assert.deepEqual(Array.from(constants.additional.slice(0,5)),["architecture","sequenceDiagramSource","workflow","interactivePrototype","selfCheckQuiz"]);
  for(const [id,category,enTitle,zhTitle] of expected){
    const item=constants.library[id];
    assert.equal(item.category,category);assert.equal(translation(english,item.title),enTitle);assert.equal(translation(chinese,item.title),zhTitle);
    const enPrompt=translation(english,item.prompt),zhPrompt=translation(chinese,item.prompt);
    assert.notEqual(enPrompt,enTitle,"the selected value must use the full request, not its visible title");
    assert.notEqual(zhPrompt,zhTitle,"the selected value must use the localized full request, not its visible title");
    assert.match(enPrompt,/Canvas/);assert.match(enPrompt,/visual|display/i,"English requests must require a visual result, not a text-only reply");
    assert.match(zhPrompt,/Canvas/);assert.match(zhPrompt,/不要只/);assert.match(zhPrompt,/图文结合/,"Chinese requests must require a visual result, not a text-only reply");
  }
  const additions=expected.map(([id])=>constants.library[id]);
  assert.equal(new Set(additions.map(item=>item.prompt)).size,6);assert.equal(new Set(additions.map(item=>item.title)).size,6);
});

test("visual prompt presets require a Canvas artifact without changing free-form chat",()=>{
  const constants=promptConstants(),visualPresetIds=[
    "file","architecture","simpleDiagram","sequenceDiagramSource","workflow","excel","transformer","ukTrip","organize","imageVisual","spreadsheetVisual","presentationVisual","documentVisual","documentStudy","codeVisual","codeLayer","projectPlan","projectPublish","selectionVisual","notesVisual","notesPublish","canvasVisual","canvasPublish",
  ];
  for(const id of visualPresetIds){
    const item=constants.library[id],enPrompt=translation(english,item.prompt),zhPrompt=translation(chinese,item.prompt);
    assert.match(enPrompt,/Do not (?:return|only)/,`${id} must reject a text-only result in English`);
    assert.match(enPrompt,/Canvas/,`${id} must name the visual destination in English`);
    assert.match(enPrompt,/visual|display/i,`${id} must require a displayed visual result in English`);
    assert.match(zhPrompt,/不要只/,`${id} must reject a text-only result in Chinese`);
    assert.match(zhPrompt,/Canvas/,`${id} must name the visual destination in Chinese`);
    assert.match(zhPrompt,/图文结合/,`${id} must require a visual result in Chinese`);
  }
  assert.doesNotMatch(runtime,/canvasAgentSubmitMessage[\s\S]*?Do not (?:return|only)[\s\S]*?canvasAgentSendRequest/,"free-form submissions must not gain a global visual-output suffix");
});

test("PenEcho Agent ships localized titles and full prompts and concise summaries in the list",()=>{
  const {library}=promptConstants(),items=Object.values(library),promptKeys=[...new Set(items.map(item=>item.prompt))],titleKeys=[...new Set(items.map(item=>item.title))];
  for(const key of promptKeys){const en=translation(english,key),zh=translation(chinese,key),summaryKey=`${key}Summary`,enSummary=translation(english,summaryKey),zhSummary=translation(chinese,summaryKey);assert.equal(en.length>25,true,`English ${key} is incomplete`);assert.equal(zh.length>12,true,`Chinese ${key} is incomplete`);assert.equal(enSummary.length>=20,true,`English ${summaryKey} is incomplete`);assert.equal(zhSummary.length>=8,true,`Chinese ${summaryKey} is incomplete`);}
  for(const key of titleKeys){const words=translation(english,key).trim().split(/\s+/),zh=translation(chinese,key);assert.equal(words.length>=2&&words.length<=5,true,`English ${key} must be 2-5 words`);assert.equal(zh.length>=3&&zh.length<=24,true,`Chinese ${key} should stay compact`);}
  assert.deepEqual(["canvasAgentPromptCategoryNotes","canvasAgentPromptCategoryFiles","canvasAgentPromptCategoryCreate"].map(key=>translation(english,key)),["Notes","Files & Projects","Diagrams & More"]);
  assert.deepEqual(["canvasAgentPromptCategoryNotes","canvasAgentPromptCategoryFiles","canvasAgentPromptCategoryCreate"].map(key=>translation(chinese,key)),["笔记","文件与项目","图表与创作"]);
  assert.equal(translation(english,"canvasAgentEmptyTitle"),"Turn your ideas into professional diagrams.");assert.equal(translation(chinese,"canvasAgentEmptyTitle"),"用一句话，画出专业图表。");assert.ok(translation(english,"canvasAgentPromptSuggestionsHint"));assert.ok(translation(chinese,"canvasAgentPromptSuggestionsHint"));
});


test("the composer preserves default categories alongside an exclusive Suggest view without Try asking",()=>{
  const {document}=parseHTML(html),region=document.querySelector('#canvasAgentPromptSuggestions'),transcript=document.querySelector('#canvasAgentTranscript');
  assert.equal(region.previousElementSibling,transcript);
  assert.equal(region.hasAttribute('hidden'),true);
  assert.ok(region.querySelector('#canvasAgentSuggestClose'));
  assert.equal(region.querySelectorAll('[role=tab]').length,3);
  assert.equal(region.querySelectorAll('.canvas-agent-prompt-group').length,4);
  assert.equal(document.querySelector('#canvasAgentPromptControl'),null);
  assert.equal(document.querySelector('#canvasAgentPromptToggle'),null);
  assert.equal(transcript.contains(region),false);
  assert.equal(region.contains(document.querySelector('#canvasAgentSuggestLoading')),false,'loading does not prematurely open the result panel');
  assert.match(css,/\[data-prompt-presentation="conversation"\] \.canvas-agent-prompt-suggestions\s*\{[^}]*max-height:\s*min\(45%, 320px\)/);
});

test("typed input still forwards focus intent, while programmatic focus after close/selection is suppressed",()=>{
  const canvasAgent={promptSuggestionsSuppressFocus:false},input={value:'Already writing'},context={canvasAgent,canvasAgentInput:input,calls:0};
  context.agentSuggestComposerFocused=()=>context.calls++;
  const focus=vm.runInNewContext(`(()=>{${functionSource('canvasAgentFocusPromptSuggestions')}return canvasAgentFocusPromptSuggestions;})()`,context);
  focus();assert.equal(context.calls,1);
  canvasAgent.promptSuggestionsSuppressFocus=true;focus();assert.equal(context.calls,1);
  canvasAgent.promptSuggestionsSuppressFocus=false;input.focus=()=>focus();context.canvasAgentTranscript={focus(){}};
  const restore=vm.runInNewContext(`(()=>{${functionSource('canvasAgentRestoreSuggestionFocus')}return canvasAgentRestoreSuggestionFocus;})()`,context);
  restore();assert.equal(context.calls,1);assert.equal(canvasAgent.promptSuggestionsSuppressFocus,false);
  assert.match(runtime,/canvasAgentInput\.addEventListener\("focus",canvasAgentFocusPromptSuggestions\)/);
  const inputHandler=runtime.match(/canvasAgentInput\.addEventListener\("input",[^\n]+/)[0];
  assert.doesNotMatch(inputHandler,/Dismiss|ComposerFocused|Consider/,'typing neither starts nor cancels a focus request');
});

test("dismissal invalidates background focus work and hides both loading and result surfaces",()=>{
  const canvasAgent={promptSuggestionsIntent:true,promptSuggestionsDismissed:false},loading={hidden:false};let cancelled=0,expanded=true;
  const dismiss=vm.runInNewContext(`(()=>{${functionSource('canvasAgentDismissPromptSuggestions')}return canvasAgentDismissPromptSuggestions;})()`,{canvasAgent,canvasAgentSuggestLoading:loading,agentSuggestCancelPending:()=>cancelled++,canvasAgentSyncPromptPresentation:value=>expanded=value});
  dismiss();assert.equal(canvasAgent.promptSuggestionsIntent,false);assert.equal(canvasAgent.promptSuggestionsDismissed,true);
  assert.equal(expanded,false);assert.equal(loading.hidden,true);assert.equal(cancelled,1);
  assert.match(runtime,/canvasAgentForm\.addEventListener\("submit",event=>\{\s*event.preventDefault\(\);\s*canvasAgentDismissPromptSuggestions\(\)/);
});

function presentationScene(){
  const {document,window}=parseHTML(html),constants=promptConstants(),scope={document,Event:window.Event,
    t:key=>translation(english,key),CANVAS_AGENT_PROMPT_LIBRARY:constants.library,
    CANVAS_AGENT_PROMPT_ICON_PATHS:constants.iconPaths,CANVAS_AGENT_PROMPT_ADDITIONAL:constants.additional,
    CANVAS_AGENT_PROMPT_PRIMARY:constants.primary,
    canvasAgent:{inputMode:'text',attachments:[],references:[],promptSuggestionContextKey:'',promptSuggestionCategory:'create',followLatest:false},
    canvasAgentPromptContext:()=>scope.context,context:'blank',canvasAgentClearPromptSuggestionPointer(){},
    agentSuggestCancelPending(){},canvasAgentScrollToLatest(){},focusRequests:0,
    agentSuggestComposerFocused:()=>scope.focusRequests++,
  };
  for(const id of ['PromptSuggestions','PromptCategories','SuggestHeader','PromptSuggestList','SuggestLoading','Panel','Input','Transcript','PromptPopup','ReferencePicker','Approval'])scope['canvasAgent'+id]=document.querySelector('#canvasAgent'+id);
  scope.canvasAgentPromptCategoryTabs=[...document.querySelectorAll('#canvasAgentPromptCategories [role=tab]')];
  scope.canvasAgentPromptCategoryLists=[...document.querySelectorAll('#canvasAgentPromptPopup [role=tabpanel]')];
  const names=['PromptText','PromptSuggestionSet','PromptHasDraft','PromptHasConversation','PromptSuggestionsAvailable','ShouldShowDefaultPrompts','SetPromptSuggestionsExpanded','SyncPromptPresentation','RenderDefaultPromptSuggestions','DefaultPromptCategory','SelectPromptCategory','HandlePromptCategoryKeydown','CreatePromptIcon','ChoosePromptSuggestion','ActivatePromptSuggestion','DismissPromptSuggestions','RestoreSuggestionFocus','FocusPromptSuggestions'].map(name=>'canvasAgent'+name);
  vm.createContext(scope);vm.runInContext(names.map(functionSource).join('\n'),scope);
  scope.canvasAgentInput.value='';scope.canvasAgentInput.focus=()=>scope.canvasAgentFocusPromptSuggestions();scope.canvasAgentTranscript.focus=()=>{};
  scope.canvasAgentInput.addEventListener('input',()=>scope.canvasAgentSyncPromptPresentation(false));
  scope.canvasAgentSyncPromptPresentation(false);
  return scope;
}

test('welcome presets are automatic, keyboard accessible, and return after clearing a draft',()=>{
  const s=presentationScene(),region=s.canvasAgentPromptSuggestions;
  assert.equal(region.hidden,false);assert.equal(region.dataset.mode,'default');
  assert.equal(s.document.querySelector("#canvasAgentInputHint"),null);
  assert.equal(s.canvasAgentPromptCategories.hidden,false);assert.equal(s.canvasAgentSuggestHeader.hidden,true);
  assert.equal(s.canvasAgentPromptSuggestList.hidden,true);assert.equal(s.canvasAgent.promptSuggestionCategory,'create');
  for(const list of s.canvasAgentPromptCategoryLists)assert.ok(list.children.length>0);
  const create=s.canvasAgentPromptCategoryTabs[2];
  s.canvasAgentHandlePromptCategoryKeydown({key:'ArrowLeft',currentTarget:create,preventDefault(){}});
  assert.equal(s.canvasAgent.promptSuggestionCategory,'files');
  assert.equal(s.canvasAgentPromptCategoryLists.filter(list=>!list.hidden).length,1);
  s.canvasAgentInput.value='My question';s.canvasAgentSyncPromptPresentation(false);assert.equal(region.hidden,true);
  s.canvasAgentInput.value='';s.canvasAgentSyncPromptPresentation(false);assert.equal(region.hidden,false);
  assert.equal(s.canvasAgent.promptSuggestionCategory,'files','keep the selected default tab');
  assert.equal(s.focusRequests,0);
});

test('ranked results replace all presets; dismissal restores only the appropriate welcome or chat view',()=>{
  const s=presentationScene(),region=s.canvasAgentPromptSuggestions;
  s.canvasAgentSelectPromptCategory('files');s.canvasAgentSyncPromptPresentation(true);
  assert.equal(region.dataset.mode,'suggest');assert.equal(s.canvasAgentPromptCategories.hidden,true);
  assert.equal(s.canvasAgentSuggestHeader.hidden,false);assert.equal(s.canvasAgentPromptSuggestList.hidden,false);
  assert.ok(s.canvasAgentPromptCategoryLists.every(list=>list.hidden));
  s.canvasAgentDismissPromptSuggestions();assert.equal(region.dataset.mode,'default');
  assert.equal(s.canvasAgent.promptSuggestionCategory,'files');assert.equal(s.canvasAgentPromptSuggestList.hidden,true);
  s.canvasAgentTranscript.innerHTML='<article class="canvas-agent-message">Keep this conversation</article>';
  s.canvasAgentSyncPromptPresentation(true);assert.equal(s.canvasAgentPanel.dataset.promptPresentation,'conversation');
  s.canvasAgentDismissPromptSuggestions();assert.equal(region.hidden,true);
  assert.equal(s.canvasAgentTranscript.textContent,'Keep this conversation');
  s.canvasAgentSyncPromptPresentation(false);assert.equal(region.hidden,true,'empty composer does not replace existing chat with presets');
});

test('choosing a default preset inserts its full prompt without submitting or triggering focus inference',()=>{
  const s=presentationScene(),button=s.canvasAgentPromptCategoryLists.find(list=>!list.hidden).querySelector('button');
  const expected=s.t(button.dataset.promptKey);button.click();
  assert.equal(s.canvasAgentInput.value,expected);assert.equal(s.canvasAgentPromptSuggestions.hidden,true);
  assert.equal(s.focusRequests,0);assert.equal(s.canvasAgent.promptSuggestionsIntent,false);
});
