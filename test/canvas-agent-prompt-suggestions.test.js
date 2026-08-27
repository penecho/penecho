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

test("PenEcho Agent keeps its default introduction above the Try asking overlay",()=>{
  assert.match(css,/\.canvas-agent-empty\s*\{[^}]*margin:\s*0 10px auto/);
});

test("PenEcho Agent keeps a fixed Try asking row between attachments and the composer",()=>{
  const {document}=parseHTML(html),form=document.querySelector("#canvasAgentForm"),suggestions=document.querySelector("#canvasAgentPromptSuggestions"),attachments=document.querySelector("#canvasAgentAttachments"),approval=document.querySelector("#canvasAgentApproval"),
    popup=document.querySelector("#canvasAgentPromptPopup"),additional=document.querySelector("#canvasAgentAdditionalPromptList"),primary=document.querySelector("#canvasAgentPrimaryPromptList"),
    children=[...suggestions.children],toggle=suggestions.querySelector("#canvasAgentPromptToggle"),additionalRule=css.match(/\.canvas-agent-prompt-additional\s*\{([^}]*)\}/)?.[1]||"";
  assert.equal(suggestions.parentElement,form.parentElement);
  assert.equal(attachments.nextElementSibling,approval);
  assert.equal(approval.nextElementSibling,suggestions,"attachments, references, and approvals stay visible above the prompt card");
  assert.equal(suggestions.nextElementSibling,form,"the composer remains the fixed final panel item");
  assert.equal(suggestions.hasAttribute("hidden"),true);
  assert.equal(suggestions.getAttribute("role"),"group");
  assert.equal(children[0].tagName,"HEADER");
  assert.equal(children[1],popup);
  assert.deepEqual([...popup.children],[additional,primary]);
  assert.equal(toggle.parentElement,children[0],"the full Try asking row is the disclosure button");
  assert.equal(toggle.getAttribute("aria-expanded"),"false");
  assert.equal(toggle.getAttribute("aria-controls"),"canvasAgentPromptPopup");
  assert.match(css,/\.canvas-agent-prompt-suggestions\s*\{[^}]*position:\s*relative;[^}]*min-height:\s*34px;[^}]*flex:\s*0 0 auto;[^}]*overflow:\s*visible/);
  assert.match(css,/\.canvas-agent-prompt-suggestions\s*\{[^}]*border:\s*1px solid #dde4ee;[^}]*border-radius:\s*12px;[^}]*background:\s*linear-gradient\(145deg, #fcfdff, #f7f9fc\);[^}]*box-shadow:\s*0 4px 14px rgba\(15,23,42,\.055\)/,"Try asking keeps its original light card appearance");
  assert.match(css,/\.canvas-agent-prompt-suggestions > header > button\s*\{[^}]*width:\s*100%;[^}]*justify-content:\s*space-between;[^}]*border:\s*0/,"the relocated disclosure never exposes a browser-default black border");
  assert.match(css,/\.canvas-agent-prompt-suggestions > header > button:hover,\s*\.canvas-agent-prompt-suggestions > header > button:active\s*\{[^}]*color:\s*#475569;[^}]*background:\s*transparent;[^}]*transform:\s*none/,"pointer interaction keeps the Try asking disclosure background neutral");
  assert.match(css,/\.canvas-agent-prompt-suggestions > header > button:focus-visible\s*\{[^}]*color:\s*#475569;[^}]*background:\s*transparent;[^}]*outline:\s*2px solid #cbd5e1;[^}]*outline-offset:\s*1px/,"keyboard focus uses a neutral gray outline instead of purple highlighting");
  assert.match(css,/\.canvas-agent-prompt-suggestions:not\(\[hidden\]\) \+ \.canvas-agent-composer\s*\{[^}]*padding-top:\s*5px/,"the prompt card stays close to the composer");
  assert.match(css,/\.canvas-agent-prompt-popup\s*\{[^}]*position:\s*absolute;[^}]*z-index:\s*5;[^}]*bottom:\s*calc\(100% - 1px\);[^}]*max-height:\s*min\(390px, calc\(100cqh - 210px\)\);[^}]*overflow-y:\s*auto/);
  assert.match(css,/\.canvas-agent-prompt-popup\s*\{[^}]*border:\s*1px solid #dde4ee;[^}]*border-bottom:\s*0;[^}]*border-radius:\s*12px 12px 0 0;[^}]*background:\s*linear-gradient\(145deg, #fcfdff, #f7f9fc\);[^}]*box-shadow:\s*none/,"the floating rows extend the header card with the same light border and white background");
  assert.match(css,/\.canvas-agent-prompt-suggestions\.prompt-rows-visible\s*\{[^}]*border-top-color:\s*transparent;[^}]*border-radius:\s*0 0 12px 12px;[^}]*box-shadow:\s*none;[^}]*filter:\s*drop-shadow/,"expanded rows and the fixed header read as one continuous card with a single unified shadow");
  assert.match(css,/\.canvas-agent-history-popover\s*\{[^}]*z-index:\s*6/,"PenEcho Agent popovers remain above prompt options");
  assert.match(css,/\.settings-layer\s*\{[^}]*z-index:\s*74/,"Settings remains above the PenEcho Agent panel and prompt options");
  assert.match(css,/\.canvas-agent-prompt-list\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.doesNotMatch(additionalRule,/position:|bottom:|max-height:|overflow|overscroll|scrollbar|border:|background:|box-shadow:/,"the floating prompt card must have one wheel-scroll owner");
  assert.match(css,/\.canvas-agent-prompt-list > button\s*\{[^}]*height:\s*auto;[^}]*overflow:\s*hidden/);
  assert.match(css,/\.canvas-agent-prompt-list\[hidden\]\s*\{\s*display:\s*none;/,"both the additional rows and the default three must honor hidden");
  assert.match(css,/\.canvas-agent-prompt-copy\s*\{[^}]*overflow:\s*hidden;[^}]*-webkit-line-clamp:\s*2;[^}]*line-clamp:\s*2/);
  assert.match(css,/\.canvas-agent-prompt-icon\s*\{/);
  assert.match(css,/\.canvas-agent-prompt-copy strong\s*\{[^}]*font-weight:/);
});

test("PenEcho Agent keeps its fixed Try asking row whenever suggestions are available",()=>{
  const input={value:"",disabled:false},form={contains:node=>node===input},outside={},document={activeElement:input},panel={hidden:false},referencePicker={hidden:true},approval={hidden:true},suggestions={contains:()=>false},canvasAgent={
    inputMode:"text",inkPresent:false,attachments:[],references:[],requestPending:false,running:false,viewingHistoryId:"",pendingApproval:null,attachmentBusy:false,projectUploadBusy:false,
  },context={canvasAgentPromptSuggestions:suggestions,canvasAgentPanel:panel,canvasAgentForm:form,document,canvasAgent,canvasAgentInput:input,canvasAgentReferencePicker:referencePicker,canvasAgentApproval:approval};
  context.canvasAgentPromptHasDraft=vm.runInNewContext(`(()=>{${functionSource("canvasAgentPromptHasDraft")}return canvasAgentPromptHasDraft;})()`,context);
  context.canvasAgentPromptSuggestionsAvailable=vm.runInNewContext(`(()=>{${functionSource("canvasAgentPromptSuggestionsAvailable")}return canvasAgentPromptSuggestionsAvailable;})()`,context);
  const shouldShow=vm.runInNewContext(`(()=>{${functionSource("canvasAgentShouldShowPromptSuggestions")}return canvasAgentShouldShowPromptSuggestions;})()`,context);
  assert.equal(shouldShow(),true);
  document.activeElement=outside;assert.equal(shouldShow(),true,"the fixed row keeps its layout position after blur");
  input.value="draft";assert.equal(shouldShow(),true,"a text draft keeps the Try asking header visible after blur");
  input.value="";canvasAgent.attachments=[{}];assert.equal(shouldShow(),true,"an attachment is composer content");
  canvasAgent.attachments=[];canvasAgent.references=["widget-1"];assert.equal(shouldShow(),true,"an explicit reference is composer content");
  canvasAgent.references=[];document.activeElement=input;
  const blockers=[
    [canvasAgent,"requestPending",true],[canvasAgent,"running",true],[canvasAgent,"inputMode","ink"],[canvasAgent,"inkPresent",true],
    [canvasAgent,"viewingHistoryId","history"],[canvasAgent,"pendingApproval",{}],[canvasAgent,"attachmentBusy",true],[canvasAgent,"projectUploadBusy",true],
    [input,"disabled",true],[referencePicker,"hidden",false],[approval,"hidden",false],[panel,"hidden",true],
  ];
  for(const [target,key,value] of blockers){const previous=target[key];target[key]=value;assert.equal(shouldShow(),false,`${key} should hide suggestions`);target[key]=previous;}
});

test("PenEcho Agent floats only prompt options without CSP-sensitive inline sizing",()=>{
  assert.doesNotMatch(runtime,/style\.(?:set|remove)Property\([^)]*canvas-agent-prompt/);
  assert.doesNotMatch(css,/canvas-agent-prompt-height-|--canvas-agent-prompt-avoidance|\.canvas-agent-prompt-suggestions\s*\{[^}]*position:\s*absolute/);
  assert.match(css,/\.canvas-agent-prompt-popup\s*\{[^}]*position:\s*absolute/);
});

test("PenEcho Agent classifies image, Office, document, code, and generic files",()=>{
  const classify=vm.runInNewContext(`(()=>{${functionSource("canvasAgentPromptFileContext")}return canvasAgentPromptFileContext;})()`);
  assert.equal(classify({kind:"image",name:"photo.bin"}),"image");
  assert.equal(classify({name:"budget.xlsx",mediaType:"application/octet-stream"}),"spreadsheet");
  assert.equal(classify({name:"deck.pptx"}),"presentation");
  assert.equal(classify({name:"paper.pdf"}),"document");
  assert.equal(classify({name:"agent.ts"}),"code");
  assert.equal(classify({name:"archive.bin"}),"file");
});

test("PenEcho Agent intent precedence follows explicit choices before inferred canvas content",()=>{
  let selected=false,project=null,hasInk=false,hasContent=false;
  const canvasAgent={attachments:[],projectId:""},state={selection:null,images:[],widgets:[],textBoxes:[],animations:[],preservedSnapshotAnimations:[]},scope={
    canvasAgent,state,SIZE:100,canvasAgentReferencedIds:()=>selected?["selected"]:[],canvasAgentProjectById:()=>project,
    visibleInkBounds:()=>hasInk?{x:1,y:1,w:2,h:2}:null,canvasAgentContentBounds:()=>hasContent?{x:1,y:1,w:2,h:2}:null,
  };
  scope.canvasAgentPromptFileContext=vm.runInNewContext(`(()=>{${functionSource("canvasAgentPromptFileContext")}return canvasAgentPromptFileContext;})()`);
  const context=vm.runInNewContext(`(()=>{${functionSource("canvasAgentPromptContext")}return canvasAgentPromptContext;})()`,scope);
  assert.equal(context(),"blank");
  hasContent=true;assert.equal(context(),"canvas");
  state.images.push({});assert.equal(context(),"image");
  hasInk=true;assert.equal(context(),"notes");
  project={kind:"folder"};canvasAgent.projectId="folder-1";assert.equal(context(),"project");
  selected=true;assert.equal(context(),"selection");
  canvasAgent.attachments=[{kind:"file",name:"budget.xlsx"}];assert.equal(context(),"spreadsheet");
  canvasAgent.attachments=[{kind:"image",name:"photo.png"}];assert.equal(context(),"image");
  canvasAgent.attachments=[];selected=false;project={kind:"file",name:"paper.pdf"};assert.equal(context(),"document");
});

test("PenEcho Agent chooses three context-specific primary intents",()=>{
  const constants=promptConstants(),expected={
    blank:["file","architecture","handwriting"],image:["imageVisual","imageLayer","imagePublish"],spreadsheet:["spreadsheetVisual","spreadsheetLayer","spreadsheetPublish"],
    presentation:["presentationVisual","presentationLayer","presentationPublish"],document:["documentVisual","documentStudy","documentPublish"],code:["codeVisual","codeLayer","codePlan"],
    file:["file","fileLayer","filePublish"],project:["architecture","projectPlan","projectPublish"],selection:["selectionVisual","selectionLayer","selectionPublish"],
    notes:["notesVisual","applyAnnotations","handwriting"],canvas:["canvasVisual","canvasLayer","canvasPublish"],
  };
  for(const [context,ids] of Object.entries(expected)){
    const set=vm.runInNewContext(`(()=>{${functionSource("canvasAgentPromptSuggestionSet")}return canvasAgentPromptSuggestionSet;})()`,{
      CANVAS_AGENT_PROMPT_LIBRARY:constants.library,CANVAS_AGENT_PROMPT_ADDITIONAL:constants.additional,CANVAS_AGENT_PROMPT_PRIMARY:constants.primary,canvasAgentPromptContext:()=>context,
    })();
    assert.equal(set.key,context);assert.equal(set.suggestions.length,context==="notes"?11:12);assert.deepEqual(Array.from(set.suggestions.slice(-3),item=>item.id),ids);
  }
});

function interactiveScene(){
  const constants=promptConstants(),set={key:"blank",suggestions:[...constants.additional,...constants.primary.blank].map(id=>({id,...constants.library[id]}))},active={element:null,insideForm:false,insideSuggestions:false},outside={};
  function node(tag){
    return {tag,handlers:{},children:[],dataset:{},className:"",attributes:{},hidden:false,_textContent:"",
      get textContent(){return this.children.length?this.children.map(child=>child.textContent||"").join(""):this._textContent;},set textContent(value){this._textContent=String(value);this.children=[];},
      closest(selector){return selector==="button"&&this.tag==="button"?this:null;},append(...items){this.children.push(...items);},replaceChildren(...items){this.children=[...items];},
      setAttribute(name,value){this.attributes[name]=String(value);this[name]=String(value);},getAttribute(name){return this.attributes[name]??null;},
      addEventListener(type,handler){this.handlers[type]=handler;},click(){this.handlers.click?.();}};
  }
  const document={get activeElement(){return active.element;},set activeElement(value){active.element=value;},createElement:node,createElementNS(_namespace,tag){return node(tag);}},
    input={value:"",disabled:false,events:0,focused:false,selection:null,dispatchEvent(event){this.events++;if(event.type==="input")sync();},focus(){this.focused=true;active.element=this;active.insideForm=true;active.insideSuggestions=false;},setSelectionRange(start,end){this.selection=[start,end];}},
    form={contains(node){return node===input||node===active.element&&active.insideForm;},submitted:false},
    suggestions={hidden:true,attributes:{},classList:{expanded:false,promptRowsVisible:false,toggle(name,value){if(name==="expanded")this.expanded=Boolean(value);if(name==="prompt-rows-visible")this.promptRowsVisible=Boolean(value);}},setAttribute(name,value){this.attributes[name]=String(value);},contains(node){return node===active.element&&active.insideSuggestions;}},
    popup={hidden:true},makeList=()=>({hidden:false,children:[],replaceChildren(){this.children=[];},append(child){this.children.push(child);}}),additional=makeList(),primary=makeList(),toggle=node("button"),
    hint={hidden:false},canvasAgent={inputMode:"text",inkPresent:false,attachments:[],references:[],currentConversation:{items:[]},requestPending:false,running:false,viewingHistoryId:"",pendingApproval:null,attachmentBusy:false,projectUploadBusy:false,promptSuggestionsExpanded:false,promptSuggestionsManual:false,promptSuggestionsCollapsedAll:false,promptSuggestionContextKey:"",promptSuggestions:[]},
    panel={hidden:false},referencePicker={hidden:true},approval={hidden:true},translations={canvasAgentPromptHandwriting:"Polished prompt",canvasAgentPromptFocusEnhance:"Enhance",canvasAgentPromptMore:"Show",canvasAgentPromptLess:"Hide"};
  const context={canvasAgentInput:input,canvasAgentInputHint:hint,canvasAgentPromptSuggestions:suggestions,canvasAgentPromptPopup:popup,canvasAgentAdditionalPromptList:additional,canvasAgentPrimaryPromptList:primary,
    canvasAgentPromptToggle:toggle,canvasAgentPanel:panel,canvasAgentForm:form,canvasAgentReferencePicker:referencePicker,canvasAgentApproval:approval,document,canvasAgent,
    CANVAS_AGENT_PROMPT_ICON_PATHS:constants.iconPaths,t:key=>translations[key]||key,canvasAgentSyncInputHint(){},canvasAgentPromptSuggestionSet:()=>set,Event:class Event{constructor(type){this.type=type;}},
  };
  const hasDraft=vm.runInNewContext(`(()=>{${functionSource("canvasAgentPromptHasDraft")}return canvasAgentPromptHasDraft;})()`,context);
  context.canvasAgentPromptHasDraft=hasDraft;
  const needsManualExpansion=vm.runInNewContext(`(()=>{${functionSource("canvasAgentPromptNeedsManualExpansion")}return canvasAgentPromptNeedsManualExpansion;})()`,context);
  context.canvasAgentPromptNeedsManualExpansion=needsManualExpansion;
  const rowsVisible=vm.runInNewContext(`(()=>{${functionSource("canvasAgentPromptRowsVisible")}return canvasAgentPromptRowsVisible;})()`,context);
  context.canvasAgentPromptRowsVisible=rowsVisible;
  const setExpanded=vm.runInNewContext(`(()=>{${functionSource("canvasAgentSetPromptSuggestionsExpanded")}return canvasAgentSetPromptSuggestionsExpanded;})()`,context);
  context.canvasAgentSetPromptSuggestionsExpanded=setExpanded;
  const createIcon=vm.runInNewContext(`(()=>{${functionSource("canvasAgentCreatePromptIcon")}return canvasAgentCreatePromptIcon;})()`,context);
  context.canvasAgentCreatePromptIcon=createIcon;
  const render=vm.runInNewContext(`(()=>{${functionSource("canvasAgentRenderPromptSuggestions")}return canvasAgentRenderPromptSuggestions;})()`,context);
  context.canvasAgentRenderPromptSuggestions=render;
  const available=vm.runInNewContext(`(()=>{${functionSource("canvasAgentPromptSuggestionsAvailable")}return canvasAgentPromptSuggestionsAvailable;})()`,context);
  context.canvasAgentPromptSuggestionsAvailable=available;
  const shouldShow=vm.runInNewContext(`(()=>{${functionSource("canvasAgentShouldShowPromptSuggestions")}return canvasAgentShouldShowPromptSuggestions;})()`,context);
  context.canvasAgentShouldShowPromptSuggestions=shouldShow;
  const sync=vm.runInNewContext(`(()=>{${functionSource("canvasAgentSyncPromptSuggestions")}return canvasAgentSyncPromptSuggestions;})()`,context);
  context.canvasAgentSyncPromptSuggestions=sync;
  const choose=vm.runInNewContext(`(()=>{${functionSource("canvasAgentChoosePromptSuggestion")}return canvasAgentChoosePromptSuggestion;})()`,context);
  context.canvasAgentChoosePromptSuggestion=choose;
  const preventFocusLoss=vm.runInNewContext(`(()=>{${functionSource("canvasAgentPreventPromptSuggestionFocusLoss")}return canvasAgentPreventPromptSuggestionFocusLoss;})()`,context),
    expandOnEnter=vm.runInNewContext(`(()=>{${functionSource("canvasAgentExpandPromptSuggestionsOnPointerEnter")}return canvasAgentExpandPromptSuggestionsOnPointerEnter;})()`,context),
    collapseOnLeave=vm.runInNewContext(`(()=>{${functionSource("canvasAgentCollapsePromptSuggestionsOnPointerLeave")}return canvasAgentCollapsePromptSuggestionsOnPointerLeave;})()`,context),
    syncFocus=vm.runInNewContext(`(()=>{${functionSource("canvasAgentSyncPromptSuggestionsFocus")}return canvasAgentSyncPromptSuggestionsFocus;})()`,context),
    toggleExpanded=vm.runInNewContext(`(()=>{${functionSource("canvasAgentTogglePromptSuggestions")}return canvasAgentTogglePromptSuggestions;})()`,context),
    collapseFromPanel=vm.runInNewContext(`(()=>{${functionSource("canvasAgentCollapsePromptSuggestionsFromPanel")}return canvasAgentCollapsePromptSuggestionsFromPanel;})()`,context);
  return {set,input,active,outside,document,form,suggestions,popup,additional,primary,toggle,canvasAgent,render,setExpanded,shouldShow,sync,choose,preventFocusLoss,expandOnEnter,collapseOnLeave,syncFocus,toggleExpanded,collapseFromPanel};
}

test("PenEcho Agent renders icons, bold focus words, and full clickable prompts",()=>{
  const scene=interactiveScene();scene.render(scene.set);
  assert.equal(scene.additional.children.length,9);assert.equal(scene.primary.children.length,3);
  const button=scene.primary.children.at(-1),icon=button.children[0],copy=button.children[1],focus=copy.children[0],detail=copy.children[1];
  assert.equal(icon.class,"canvas-agent-prompt-icon");assert.equal(icon.children.length>0,true);
  assert.equal(copy.className,"canvas-agent-prompt-copy");assert.equal(focus.tag,"strong");assert.equal(focus.textContent,"Enhance");assert.equal(detail.textContent,"Polished prompt");assert.equal(button.title,"Polished prompt");
  assert.equal(scene.choose("canvasAgentPromptHandwriting"),true);
  assert.equal(scene.input.value,"Polished prompt");assert.equal(scene.input.events,1);assert.equal(scene.input.focused,true);assert.deepEqual(scene.input.selection,[15,15]);assert.equal(scene.form.submitted,false);
  assert.match(runtime,/canvasAgentInput\.addEventListener\("input",\(\)=>\{[^}]*canvasAgentPromptHasDraft\(\)[^}]*canvasAgentSyncPromptSuggestions\(\)/);
});

test("Empty prompts expand as one card on hover and collapse immediately on leave",()=>{
  const scene=interactiveScene();scene.render(scene.set);scene.active.element=scene.input;scene.active.insideForm=true;scene.sync();
  assert.equal(scene.suggestions.hidden,false);assert.equal(scene.popup.hidden,false);assert.equal(scene.additional.hidden,true);assert.equal(scene.primary.hidden,false);
  scene.expandOnEnter();assert.equal(scene.additional.hidden,false);assert.equal(scene.suggestions.classList.expanded,true);assert.equal(scene.toggle.getAttribute("aria-expanded"),"true");
  scene.collapseOnLeave();assert.equal(scene.additional.hidden,true);
  assert.match(css,/\.canvas-agent-prompt-suggestions > header svg\s*\{[^}]*transform:\s*rotate\(180deg\)/);
  assert.match(css,/\.canvas-agent-prompt-suggestions\.prompt-rows-visible > header svg\s*\{[^}]*transform:\s*rotate\(0\)/);
  assert.match(runtime,/canvasAgentPromptSuggestions\?\.addEventListener\("pointerenter",canvasAgentExpandPromptSuggestionsOnPointerEnter\)/);
  assert.doesNotMatch(functionSource("canvasAgentCollapsePromptSuggestionsOnPointerLeave"),/setTimeout|requestAnimationFrame/);
});

test("The expanded arrow collapses every prompt row and keeps manual collapse stable",()=>{
  const scene=interactiveScene();scene.render(scene.set);scene.active.element=scene.input;scene.active.insideForm=true;scene.sync();
  assert.equal(scene.primary.hidden,false);assert.equal(scene.additional.hidden,true);assert.equal(scene.toggle.getAttribute("aria-expanded"),"true","the default three rows make the arrow a collapse action");
  scene.toggleExpanded();assert.equal(scene.popup.hidden,true);assert.equal(scene.primary.hidden,true);assert.equal(scene.additional.hidden,true);assert.equal(scene.canvasAgent.promptSuggestionsCollapsedAll,true);assert.equal(scene.toggle.getAttribute("aria-expanded"),"false");
  scene.expandOnEnter();assert.equal(scene.primary.hidden,true,"hover must not undo an explicit full collapse");assert.equal(scene.additional.hidden,true);
  scene.toggleExpanded();assert.equal(scene.primary.hidden,false);assert.equal(scene.additional.hidden,false);assert.equal(scene.canvasAgent.promptSuggestionsCollapsedAll,false);
  scene.toggleExpanded();assert.equal(scene.primary.hidden,true);assert.equal(scene.additional.hidden,true,"the same arrow collapses all rows from the fully expanded state");
});

test("Clicking the PenEcho Agent panel collapses Try asking like its disclosure button",()=>{
  const scene=interactiveScene();scene.render(scene.set);scene.active.element=scene.input;scene.active.insideForm=true;scene.sync();
  assert.equal(scene.popup.hidden,false);assert.equal(scene.primary.hidden,false);
  scene.collapseFromPanel({target:scene.outside});
  assert.equal(scene.popup.hidden,true);assert.equal(scene.primary.hidden,true);assert.equal(scene.additional.hidden,true);assert.equal(scene.canvasAgent.promptSuggestionsCollapsedAll,true);assert.equal(scene.toggle.getAttribute("aria-expanded"),"false");
  scene.expandOnEnter();assert.equal(scene.popup.hidden,true,"panel collapse must be as stable as the disclosure collapse");
  scene.toggleExpanded();scene.active.element=scene.toggle;scene.active.insideSuggestions=true;scene.collapseFromPanel({target:scene.toggle});
  assert.equal(scene.popup.hidden,false,"clicks inside Try asking keep their own toggle and suggestion behavior");
  assert.match(runtime,/canvasAgentPanel\.addEventListener\("click",canvasAgentCollapsePromptSuggestionsFromPanel\)/);
});

test("Drafts keep only the header until toggled and external blur always collapses",()=>{
  const scene=interactiveScene();scene.render(scene.set);scene.input.value="draft";scene.active.element=scene.outside;scene.sync();
  assert.equal(scene.suggestions.hidden,false);assert.equal(scene.primary.hidden,true);assert.equal(scene.additional.hidden,true);
  scene.expandOnEnter();assert.equal(scene.additional.hidden,true,"hover must not auto-open a draft");
  scene.toggleExpanded();assert.equal(scene.canvasAgent.promptSuggestionsManual,true);assert.equal(scene.primary.hidden,false);assert.equal(scene.additional.hidden,false);
  scene.collapseOnLeave();assert.equal(scene.additional.hidden,false,"manual expansion survives pointerleave");
  scene.active.insideForm=false;scene.active.insideSuggestions=false;scene.syncFocus();
  assert.equal(scene.suggestions.hidden,false,"draft header remains after blur");assert.equal(scene.primary.hidden,true);assert.equal(scene.additional.hidden,true);assert.equal(scene.canvasAgent.promptSuggestionsManual,false);
  scene.toggleExpanded();scene.toggleExpanded();assert.equal(scene.toggle.getAttribute("aria-expanded"),"false","the arrow toggles both ways");
  assert.match(runtime,/canvasAgent\.promptSuggestionsExpanded&&!canvasAgentForm\.contains\(event\.target\)&&!canvasAgentPromptSuggestions\?\.contains\(event\.target\)\) canvasAgentSetPromptSuggestionsExpanded\(false\)/);
});

test("Existing conversations stay collapsed on focus until the arrow is clicked",()=>{
  const scene=interactiveScene();scene.render(scene.set);scene.canvasAgent.currentConversation.items.push({role:"user",text:"Earlier message"});scene.active.element=scene.input;scene.active.insideForm=true;scene.sync();
  assert.equal(scene.suggestions.hidden,false);assert.equal(scene.primary.hidden,true);assert.equal(scene.additional.hidden,true);
  scene.expandOnEnter();assert.equal(scene.additional.hidden,true,"hover must not auto-open prompts after a conversation has started");
  scene.toggleExpanded();assert.equal(scene.primary.hidden,false);assert.equal(scene.additional.hidden,false);assert.equal(scene.canvasAgent.promptSuggestionsManual,true);
  scene.active.element=scene.outside;scene.active.insideForm=false;scene.syncFocus();assert.equal(scene.suggestions.hidden,false,"the fixed header remains after blur");assert.equal(scene.popup.hidden,true);
});

test("PenEcho Agent suggestion pointer activation survives composer focusout",async()=>{
  const scene=interactiveScene();scene.render(scene.set);const button=scene.primary.children.at(-1);scene.active.element=scene.input;scene.active.insideForm=true;scene.sync();
  const pointerEvent={target:button,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}};
  scene.preventFocusLoss(pointerEvent);if(!pointerEvent.defaultPrevented)scene.active.element=scene.outside;
  queueMicrotask(scene.sync);await Promise.resolve();assert.equal(scene.suggestions.hidden,false);
  button.click();assert.equal(scene.input.value,"Polished prompt");assert.equal(scene.suggestions.hidden,false);assert.equal(scene.primary.hidden,true);assert.equal(scene.form.submitted,false);
});

test("PenEcho Agent ships concise localized prompts and focus words for every intent",()=>{
  const {library}=promptConstants(),items=Object.values(library),keys=[...new Set(items.map(item=>item.prompt))],focusKeys=[...new Set(items.map(item=>item.focus))];
  assert.equal(keys.length>=30,true);
  for(const key of keys){
    const en=translation(english,key),zh=translation(chinese,key);
    assert.equal(en.length>25,true,`English ${key} is incomplete`);
    assert.equal(zh.length>12,true,`Chinese ${key} is incomplete`);
    if(key!=="canvasAgentPromptHandwriting"){
      assert.equal(en.length<=150,true,`English ${key} should stay concise`);
      assert.equal(zh.length<=70,true,`Chinese ${key} should stay concise`);
    }
  }
  for(const key of [...focusKeys,"canvasAgentPromptMore","canvasAgentPromptLess"]){assert.ok(translation(english,key));assert.ok(translation(chinese,key));}
  assert.equal(translation(english,"canvasAgentPromptHandwriting"),"Keep the current handwriting completely unchanged—do not edit, erase, or move it. Add a transparent explanatory layer over it; overlap is acceptable only if the original strokes remain clearly visible, and use annotations, connectors, links, graphics, or motion where appropriate to make the notes more vivid and intuitive.");
  assert.equal(translation(chinese,"canvasAgentPromptHandwriting"),"请保持当前手写笔迹完全不变：不修改、擦除或移动它；在其上添加一层背景透明的解释层，解释层可以适度覆盖但必须让原笔迹清晰透出，并在合适位置用标注、连线、链接、图形或动效让内容更生动直观。");
  assert.equal(translation(english,"canvasAgentPromptSequenceDiagramSource"),"Convert the current diagram into a sequence diagram and return editable diagram source code, such as Mermaid or PlantUML—not HTML.");
  assert.equal(translation(chinese,"canvasAgentPromptSequenceDiagramSource"),"请将当前图表转换为时序图，并返回可编辑的时序图源代码（如 Mermaid 或 PlantUML），不要返回 HTML。");
  assert.equal(translation(english,"canvasAgentPromptFollowCanvasCues"),"Follow my latest Canvas drawings, images, text boxes, and annotations. Continue and refine the work without changing unmarked content; ask if unclear.");
  assert.equal(translation(chinese,"canvasAgentPromptFollowCanvasCues"),"请把我刚在 Canvas 上新增的笔迹、手绘图形、图片、文本框和批注作为指示，按这些线索继续完善当前内容；不要改动未标注处，不清楚时先问我。");
  for(const item of items){assert.ok(item.icon);assert.ok(item.focus);}
  assert.doesNotMatch(runtime,/canvasAgentPrompt[A-Za-z]+Label/);
  assert.doesNotMatch(english,/canvasAgentPrompt[A-Za-z]+Label:/);
  assert.doesNotMatch(chinese,/canvasAgentPrompt[A-Za-z]+Label:/);
});

test("PenEcho Agent refreshes prompt intent when attachments, references, projects, or canvas state change",()=>{
  assert.match(functionSource("canvasAgentRenderAttachments"),/canvasAgentSyncPromptSuggestions\(\)/);
  assert.match(functionSource("canvasAgentSyncSelection"),/canvasAgentSyncPromptSuggestions\(\)/);
  assert.match(functionSource("canvasAgentSelectProject"),/canvasAgentSyncPromptSuggestions\(\)/);
  assert.match(functionSource("canvasAgentEnsureProjects"),/canvasAgentSyncPromptSuggestions\(\)/);
  assert.match(functionSource("canvasAgentCanvasDidChange"),/canvasAgentSyncPromptSuggestions\(\)/);
  assert.match(functionSource("canvasAgentSyncPromptSuggestions"),/suggestionSet\.key!==canvasAgent\.promptSuggestionContextKey/);
});
