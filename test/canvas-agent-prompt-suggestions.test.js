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

test("PenEcho Agent places its categorized prompt list at the top of the content area without repeated guidance",()=>{
  const {document}=parseHTML(html),panel=document.querySelector("#canvasAgentPanel"),prompts=document.querySelector("#canvasAgentPromptSuggestions"),transcript=document.querySelector("#canvasAgentTranscript"),form=document.querySelector("#canvasAgentForm"),categories=document.querySelector("#canvasAgentPromptCategories"),list=document.querySelector("#canvasAgentPromptPopup");
  assert.equal(prompts.parentElement,panel);
  assert.equal(prompts.nextElementSibling,transcript);
  assert.equal(form.previousElementSibling.id,"canvasAgentApproval","the composer remains the fixed final panel item");
  assert.deepEqual([...prompts.children],[categories,list]);
  assert.equal(prompts.querySelector(".canvas-agent-prompt-intro"),null);
  assert.equal(prompts.querySelector('[data-i18n="canvasAgentEmptyTitle"]'),null);
  assert.equal(prompts.querySelector(".canvas-agent-prompt-section-head"),null,"the redundant Try asking heading is removed");
  assert.doesNotMatch(css,/\.canvas-agent-prompt-intro\s*\{/);
  assert.match(css,/\.canvas-agent-empty\s*\{[^}]*margin:\s*auto 8px/,"the collapsed empty state is centered in the transcript's available height");
  assert.match(css,/\.canvas-agent-panel\[data-prompt-suggestions-open="true"\] \.canvas-agent-transcript\s*\{\s*display:\s*none/);
  assert.doesNotMatch(css,/canvas-agent-prompt-popup:not\(\[hidden\]\)[^}]*canvas-agent-empty/);
});

test("PenEcho Agent keeps the Try asking trigger in the composer and its content above the transcript",()=>{
  const {document}=parseHTML(html),form=document.querySelector("#canvasAgentForm"),surface=form.querySelector(".canvas-agent-composer-surface"),toolbar=form.querySelector(".canvas-agent-composer-toolbar"),control=document.querySelector("#canvasAgentPromptControl"),project=document.querySelector("#canvasAgentProjectControl"),connection=document.querySelector("#canvasAgentConnection"),toggle=document.querySelector("#canvasAgentPromptToggle"),prompts=document.querySelector("#canvasAgentPromptSuggestions"),categories=document.querySelector("#canvasAgentPromptCategories"),list=document.querySelector("#canvasAgentPromptPopup"),tabs=[...categories.querySelectorAll('[role="tab"]')],panels=[...list.querySelectorAll('[role="tabpanel"]')];
  assert.equal(toolbar.parentElement,surface);
  assert.deepEqual([...toolbar.children],[project,control,connection]);
  assert.equal(control.hasAttribute("hidden"),true);
  assert.equal(toggle.getAttribute("aria-controls"),prompts.id);
  assert.equal(categories.dataset.peControl,"tab");assert.equal(categories.dataset.peBehavior,"product");
  assert.deepEqual(tabs.map(tab=>tab.dataset.promptCategory),["notes","files","create"]);
  assert.deepEqual(tabs.map(tab=>tab.getAttribute("data-i18n")),["canvasAgentPromptCategoryNotes","canvasAgentPromptCategoryFiles","canvasAgentPromptCategoryCreate"]);
  for(const [index,tab] of tabs.entries()){assert.equal(tab.getAttribute("aria-controls"),panels[index].id);assert.equal(panels[index].getAttribute("aria-labelledby"),tab.id);assert.equal(panels[index].dataset.promptCategory,tab.dataset.promptCategory);}
  assert.equal(list.dataset.peList,"icon-copy");
  assert.deepEqual([...list.children],panels);
  assert.equal(list.querySelector('[data-pe-region="group-label"]'),null);
  assert.doesNotMatch(html,/canvasAgentPromptCurrentCanvas|canvasAgentPromptMoreInspiration|Current Canvas|More inspiration/);
  assert.match(css,/\.canvas-agent-composer-toolbar:has\(\.canvas-agent-prompt-control\[hidden\]\)\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css,/\.canvas-agent-prompt-control > button\s*\{[^}]*height:\s*28px/);
  assert.doesNotMatch(toggle.innerHTML,/canvas-agent-prompt-spark/);
});

test("Try asking uses the full remaining height and only its content view scrolls",()=>{
  const viewRule=css.match(/\.canvas-agent-prompt-suggestions\s*\{([^}]*)\}/)?.[1]||"",listRule=css.match(/\.canvas-agent-prompt-popup\s*\{([^}]*)\}/)?.[1]||"";
  assert.match(viewRule,/min-height:\s*0/);
  assert.match(viewRule,/flex:\s*1 1 auto/);
  assert.match(viewRule,/overflow:\s*hidden/);
  assert.doesNotMatch(viewRule,/max-height|position:\s*absolute/);
  assert.match(listRule,/min-height:\s*0/);
  assert.match(listRule,/flex:\s*1 1 auto/);
  assert.match(listRule,/overflow-y:\s*auto/);
  assert.match(listRule,/touch-action:\s*pan-y/);
  assert.match(listRule,/-webkit-overflow-scrolling:\s*touch/);
  assert.doesNotMatch(listRule,/max-height|position:\s*absolute|bottom:/);
  assert.match(css,/\.canvas-agent-prompt-group\[hidden\]\s*\{\s*display:\s*none/);
  assert.doesNotMatch(css,/\.canvas-agent-prompt-group \+ \.canvas-agent-prompt-group/);
  assert.match(css,/\.canvas-agent-prompt-row\s*\{[^}]*min-height:\s*44px;[^}]*grid-template-columns:\s*24px minmax\(0, 1fr\);[^}]*padding:\s*6px 10px/);
  assert.match(css,/\.canvas-agent-prompt-row > \[data-pe-region="media"\]\s*\{[^}]*color:\s*var\(--pe-accent-label,[^}]*background:\s*transparent/);
  assert.doesNotMatch(css,/\.canvas-agent-prompt-copy > \[data-pe-region="description"\]/);
});

test("PenEcho Agent keeps the Try asking trigger available without requiring panel focus",()=>{
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

test("PenEcho Agent chooses three context-specific primary intents",()=>{
  const constants=promptConstants(),expected={blank:["file","architecture","handwriting"],image:["imageVisual","imageLayer","imagePublish"],spreadsheet:["spreadsheetVisual","spreadsheetLayer","spreadsheetPublish"],presentation:["presentationVisual","presentationLayer","presentationPublish"],document:["documentVisual","documentStudy","documentPublish"],code:["codeVisual","codeLayer","codePlan"],file:["file","fileLayer","filePublish"],project:["architecture","projectPlan","projectPublish"],selection:["selectionVisual","selectionLayer","selectionPublish"],notes:["notesVisual","applyAnnotations","handwriting"],canvas:["canvasVisual","canvasLayer","canvasPublish"]},defaultCategory=vm.runInNewContext(`(()=>{${functionSource("canvasAgentDefaultPromptCategory")}return canvasAgentDefaultPromptCategory;})()`);
  for(const item of Object.values(constants.library))assert.ok(["notes","files","create"].includes(item.category),`${item.prompt} needs one prompt category`);
  for(const [context,ids] of Object.entries(expected)){
    const set=vm.runInNewContext(`(()=>{${functionSource("canvasAgentPromptSuggestionSet")}return canvasAgentPromptSuggestionSet;})()`,{CANVAS_AGENT_PROMPT_LIBRARY:constants.library,CANVAS_AGENT_PROMPT_ADDITIONAL:constants.additional,CANVAS_AGENT_PROMPT_PRIMARY:constants.primary,canvasAgentPromptContext:()=>context})();
    const suggestionIds=Array.from(set.suggestions,item=>item.id);
    assert.equal(set.suggestions.length,["blank","project","notes"].includes(context)?20:21);
    for(const id of ids)assert.ok(suggestionIds.includes(id),`${context} keeps its ${id} suggestion`);
    assert.equal(new Set(suggestionIds).size,suggestionIds.length,"shared and contextual prompts must not repeat");
    assert.deepEqual(Array.from(set.suggestions.filter(item=>item.category==="create").slice(0,3),item=>item.id),["architecture","sequenceDiagramSource","workflow"]);
    assert.equal(defaultCategory(context),context==="blank"?"create":["image","spreadsheet","presentation","document","code","file","project"].includes(context)?"files":"notes");
  }
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

function interactiveScene(){
  const constants=promptConstants(),set={key:"blank",suggestions:[...new Set([...constants.additional,...constants.primary.blank])].map(id=>({id,...constants.library[id]}))},active={element:null,insideForm:false,insideSuggestions:false};
  function node(tag){return {tag,handlers:{},children:[],dataset:{},className:"",attributes:{},hidden:false,focusOptions:null,scrollTop:0,tabIndex:0,_textContent:"",get textContent(){return this.children.length?this.children.map(child=>child.textContent||"").join(""):this._textContent;},set textContent(value){this._textContent=String(value);this.children=[];},closest(selector){return selector==="button"&&this.tag==="button"?this:null;},append(...items){this.children.push(...items);},replaceChildren(...items){this.children=[...items];},setAttribute(name,value){this.attributes[name]=String(value);this[name]=String(value);},getAttribute(name){return this.attributes[name]??null;},addEventListener(type,handler){this.handlers[type]=handler;},click(event={}){this.handlers.click?.({target:this,currentTarget:this,...event});},focus(options){this.focusOptions=options;active.element=this;active.insideForm=false;active.insideSuggestions=true;}};}
  const document={get activeElement(){return active.element;},set activeElement(value){active.element=value;},createElement:node,createElementNS(_namespace,tag){return node(tag);}},input={value:"",disabled:false,events:0,focused:false,blurred:false,selection:null,dispatchEvent(event){this.events++;if(event.type==="input")sync();},focus(){this.focused=true;active.element=this;active.insideForm=true;active.insideSuggestions=false;},blur(){this.blurred=true;if(active.element===this){active.element=null;active.insideForm=false;}},setSelectionRange(start,end){this.selection=[start,end];}},form={contains(candidate){return candidate===input||candidate===active.element&&active.insideForm;}},control={hidden:true},panel={hidden:false,dataset:{}},suggestions={hidden:true,dataset:{},attributes:{},classList:{expanded:false,toggle(name,value){if(name==="expanded")this.expanded=Boolean(value);}},setAttribute(name,value){this.attributes[name]=String(value);},contains(candidate){return candidate===active.element&&active.insideSuggestions;}},makeCategoryNode=(tag,category)=>{const item=node(tag);item.dataset.promptCategory=category;return item;},notes=makeCategoryNode("section","notes"),files=makeCategoryNode("section","files"),create=makeCategoryNode("section","create"),notesTab=makeCategoryNode("button","notes"),filesTab=makeCategoryNode("button","files"),createTab=makeCategoryNode("button","create"),tabs=[notesTab,filesTab,createTab],lists=[notes,files,create],popup={scrollTop:19},toggle=node("button"),disclosure=node("span"),hint={hidden:false},referencePicker={hidden:true},approval={hidden:true},canvasAgent={inputMode:"text",inkPresent:false,attachments:[],references:[],currentConversation:{items:[]},requestPending:false,running:false,viewingHistoryId:"",pendingApproval:null,attachmentBusy:false,projectUploadBusy:false,promptSuggestionsExpanded:false,promptSuggestionsManual:false,promptSuggestionCategory:"notes",promptSuggestionPointerClearTimer:0,promptSuggestionPointerType:"",promptSuggestionPointerButton:null,promptSuggestionContextKey:"",promptSuggestions:[]};
  const translations={canvasAgentPromptHandwriting:"Polished prompt",canvasAgentPromptHandwritingTitle:"Enhance My Handwritten Notes",canvasAgentPromptHandwritingSummary:"Preserve the handwriting and add a transparent explanation layer.",canvasAgentPromptMore:"Show",canvasAgentPromptLess:"Hide",canvasAgentPromptDisclosureMore:"More",canvasAgentPromptDisclosureLess:"Less"},t=key=>translations[key]||(/Summary$/.test(key)?"Useful two-line summary":key),context={canvasAgentSyncSendAvailability(){},canvasAgentTranscript:{querySelector(){return null;}},canvasAgentInput:input,canvasAgentInputHint:hint,canvasAgentPromptControl:control,canvasAgentPromptSuggestions:suggestions,canvasAgentPromptCategoryTabs:tabs,canvasAgentPromptCategoryLists:lists,canvasAgentPromptPopup:popup,canvasAgentPromptToggle:toggle,canvasAgentPromptDisclosureCopy:disclosure,canvasAgentPanel:panel,canvasAgentForm:form,canvasAgentReferencePicker:referencePicker,canvasAgentApproval:approval,document,canvasAgent,CANVAS_AGENT_PROMPT_ICON_PATHS:constants.iconPaths,t,canvasAgentSyncInputHint(){},canvasAgentPromptSuggestionSet:()=>set,setTimeout,clearTimeout,Event:class Event{constructor(type){this.type=type;}}};
  const bind=name=>context[name]=vm.runInNewContext(`(()=>{${functionSource(name)}return ${name};})()`,context);
  bind("canvasAgentPromptHasDraft");bind("canvasAgentSetPromptSuggestionsExpanded");bind("canvasAgentCreatePromptIcon");bind("canvasAgentDefaultPromptCategory");bind("canvasAgentSelectPromptCategory");bind("canvasAgentHandlePromptCategoryKeydown");bind("canvasAgentRenderPromptSuggestions");bind("canvasAgentPromptSuggestionsAvailable");bind("canvasAgentShouldShowPromptSuggestions");bind("canvasAgentSyncPromptSuggestions");bind("canvasAgentChoosePromptSuggestion");bind("canvasAgentClearPromptSuggestionPointer");bind("canvasAgentActivatePromptSuggestion");bind("canvasAgentPreventPromptSuggestionFocusLoss");bind("canvasAgentFinishPromptSuggestionPointer");bind("canvasAgentTogglePromptSuggestions");
  const sync=context.canvasAgentSyncPromptSuggestions;
  return {set,input,active,document,form,control,panel,suggestions,notes,files,create,tabs,lists,popup,toggle,canvasAgent,render:context.canvasAgentRenderPromptSuggestions,selectCategory:context.canvasAgentSelectPromptCategory,handleCategoryKey:context.canvasAgentHandlePromptCategoryKeydown,setExpanded:context.canvasAgentSetPromptSuggestionsExpanded,sync,choose:context.canvasAgentChoosePromptSuggestion,activate:context.canvasAgentActivatePromptSuggestion,preventFocusLoss:context.canvasAgentPreventPromptSuggestionFocusLoss,finishPointer:context.canvasAgentFinishPromptSuggestionPointer,toggleExpanded:context.canvasAgentTogglePromptSuggestions};
}

test("PenEcho Agent renders contextual ideas as titles with descriptive subtitles",()=>{
  const scene=interactiveScene();scene.render(scene.set);
  assert.deepEqual(scene.lists.map(list=>list.children.length),[7,6,7]);
  assert.equal(scene.notes.hidden,true);assert.equal(scene.files.hidden,true);assert.equal(scene.create.hidden,false);
  scene.selectCategory("notes");
  const button=scene.notes.children.at(-1),preview=button.children[0],copy=button.children[1],title=copy.children[0];
  assert.equal(button.dataset.peItem,"icon-copy-action");assert.equal(button.dataset.peState,"default");assert.equal(button.className,"canvas-agent-prompt-row");assert.equal(preview.dataset.peRegion,"media");assert.equal(copy.dataset.peRegion,"copy");assert.equal(copy.children.length,2);assert.equal(copy.children[1].tag,"small");assert.equal(title.tag,"strong");assert.equal(title.dataset.peRegion,"title");assert.equal(title.textContent,"Enhance My Handwritten Notes");assert.equal(button.getAttribute("aria-label"),"Enhance My Handwritten Notes");
  assert.equal(scene.choose("canvasAgentPromptHandwriting"),true);assert.equal(scene.input.value,"Polished prompt");assert.equal(scene.input.focused,true);assert.deepEqual(scene.input.selection,[15,15]);
});

test("prompt category tabs switch one panel at a time and support roving keyboard focus",()=>{
  const scene=interactiveScene();scene.render(scene.set);scene.popup.scrollTop=44;scene.selectCategory("files");
  assert.equal(scene.popup.scrollTop,0);assert.deepEqual(scene.tabs.map(tab=>tab.getAttribute("aria-selected")),["false","true","false"]);assert.deepEqual(scene.tabs.map(tab=>tab.tabIndex),[-1,0,-1]);assert.deepEqual(scene.lists.map(list=>list.hidden),[true,false,true]);
  const event={key:"ArrowRight",currentTarget:scene.tabs[1],prevented:false,preventDefault(){this.prevented=true;}};scene.handleCategoryKey(event);
  assert.equal(event.prevented,true);assert.equal(scene.canvasAgent.promptSuggestionCategory,"create");assert.equal(scene.document.activeElement,scene.tabs[2]);assert.equal(scene.tabs[2].focusOptions?.preventScroll,true);
  const home={key:"Home",currentTarget:scene.tabs[2],preventDefault(){}};scene.handleCategoryKey(home);assert.equal(scene.canvasAgent.promptSuggestionCategory,"notes");
});

test("new conversations and Canvas loads reset Try asking to the full top view",()=>{
  assert.match(functionSource("canvasAgentBeginLocalConversation"),/canvasAgentSetPromptSuggestionsExpanded\(true,\{manual:false\}\);[\s\S]*canvasAgentSyncPromptSuggestions\(\)/);
  assert.match(functionSource("canvasAgentCanvasDidChange"),/canvasAgentBeginLocalConversation\(\{persistCurrent:false\}\)/);
  assert.match(functionSource("canvasAgentCanvasDidChange"),/openCanvasAgent\(\{focus:false\}\)/);
  const scene=interactiveScene();scene.render(scene.set);scene.setExpanded(true,{manual:false});assert.equal(scene.suggestions.hidden,false);assert.equal(scene.panel.dataset.promptSuggestionsOpen,"true");assert.equal(scene.toggle.getAttribute("aria-expanded"),"true");
});

test("Try asking explicitly fills the upper view even when a conversation exists",()=>{
  const scene=interactiveScene();scene.render(scene.set);scene.canvasAgent.currentConversation.items.push({role:"user",text:"Earlier message"});scene.active.element=scene.input;scene.active.insideForm=true;
  scene.toggleExpanded();assert.equal(scene.input.blurred,true);assert.equal(scene.suggestions.hidden,false);assert.equal(scene.panel.dataset.promptSuggestionsOpen,"true");assert.equal(scene.document.activeElement,scene.toggle);assert.equal(scene.toggle.focusOptions?.preventScroll,true);
  scene.toggleExpanded();assert.equal(scene.suggestions.hidden,true);assert.equal(scene.panel.dataset.promptSuggestionsOpen,"false");
  assert.doesNotMatch(runtime,/canvasAgentPromptSuggestions\?\.addEventListener\("pointerenter"|canvasAgentPanel\.addEventListener\("click",canvasAgentCollapsePromptSuggestions/);
  assert.match(runtime,/if \(canvasAgent\.promptSuggestionsExpanded\) \{[\s\S]*canvasAgentSetPromptSuggestionsExpanded\(false,\{manual:false\}\)/,"Escape leaves the prompt view before closing Agent");
});

test("touch and pen select in one tap without opening the soft keyboard",()=>{
  for(const pointerType of ["touch","pen"]){
    const scene=interactiveScene();scene.render(scene.set);scene.setExpanded(true);const button=scene.notes.children.at(-1),pointerEvent={pointerType,target:button,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}};
    scene.preventFocusLoss(pointerEvent);assert.equal(pointerEvent.defaultPrevented,false);assert.equal(scene.document.activeElement,button);scene.finishPointer({type:"pointerup"});button.click();assert.equal(scene.input.value,"Polished prompt");assert.equal(scene.input.focused,false,`${pointerType} selection must not summon the keyboard`);assert.equal(scene.suggestions.hidden,true);
  }
  const mouse=interactiveScene();mouse.render(mouse.set);mouse.setExpanded(true);const mouseButton=mouse.notes.children.at(-1),mouseEvent={pointerType:"mouse",target:mouseButton,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}};
  mouse.preventFocusLoss(mouseEvent);mouse.finishPointer({type:"pointerup"});mouseButton.click();assert.equal(mouseEvent.defaultPrevented,true);assert.equal(mouse.input.focused,true,"mouse selection keeps the editable draft ready");
  const keyboard=interactiveScene();keyboard.render(keyboard.set);keyboard.setExpanded(true);keyboard.notes.children.at(-1).click();assert.equal(keyboard.input.focused,true,"keyboard activation keeps the standard focus path");
});

test("PenEcho Agent ships localized titles and full prompts and concise summaries in the list",()=>{
  const {library}=promptConstants(),items=Object.values(library),promptKeys=[...new Set(items.map(item=>item.prompt))],titleKeys=[...new Set(items.map(item=>item.title))];
  for(const key of promptKeys){const en=translation(english,key),zh=translation(chinese,key),summaryKey=`${key}Summary`,enSummary=translation(english,summaryKey),zhSummary=translation(chinese,summaryKey);assert.equal(en.length>25,true,`English ${key} is incomplete`);assert.equal(zh.length>12,true,`Chinese ${key} is incomplete`);assert.equal(enSummary.length>=20,true,`English ${summaryKey} is incomplete`);assert.equal(zhSummary.length>=8,true,`Chinese ${summaryKey} is incomplete`);}
  for(const key of titleKeys){const words=translation(english,key).trim().split(/\s+/),zh=translation(chinese,key);assert.equal(words.length>=2&&words.length<=5,true,`English ${key} must be 2-5 words`);assert.equal(zh.length>=3&&zh.length<=24,true,`Chinese ${key} should stay compact`);}
  assert.deepEqual(["canvasAgentPromptCategoryNotes","canvasAgentPromptCategoryFiles","canvasAgentPromptCategoryCreate"].map(key=>translation(english,key)),["Notes","Files & Projects","Diagrams & More"]);
  assert.deepEqual(["canvasAgentPromptCategoryNotes","canvasAgentPromptCategoryFiles","canvasAgentPromptCategoryCreate"].map(key=>translation(chinese,key)),["笔记","文件与项目","图表与创作"]);
  assert.equal(translation(english,"canvasAgentEmptyTitle"),"Turn your ideas into professional diagrams.");assert.equal(translation(chinese,"canvasAgentEmptyTitle"),"用一句话，画出专业图表。");assert.ok(translation(english,"canvasAgentPromptSuggestionsHint"));assert.ok(translation(chinese,"canvasAgentPromptSuggestionsHint"));assert.match(functionSource("canvasAgentRenderPromptSuggestions"),/Summary/);
});

test("PenEcho Agent refreshes prompt intent when attachments, references, projects, or canvas state change",()=>{
  assert.match(functionSource("canvasAgentRenderAttachments"),/canvasAgentSyncPromptSuggestions\(\)/);assert.match(functionSource("canvasAgentSyncSelection"),/canvasAgentSyncPromptSuggestions\(\)/);assert.match(functionSource("canvasAgentSelectProject"),/canvasAgentSyncPromptSuggestions\(\)/);assert.match(functionSource("canvasAgentEnsureProjects"),/canvasAgentSyncPromptSuggestions\(\)/);assert.match(functionSource("canvasAgentCanvasDidChange"),/canvasAgentSyncPromptSuggestions\(\)/);assert.match(functionSource("canvasAgentSyncPromptSuggestions"),/suggestionSet\.key!==canvasAgent\.promptSuggestionContextKey/);
});
