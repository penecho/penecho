"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const {parseHTML}=require("linkedom");
const root=path.resolve(__dirname,".."),source=fs.readFileSync(path.join(root,"src/client/app/core.js"),"utf8");
function extract(name){const start=source.indexOf(`function ${name}(`),body=source.indexOf("{",start);assert.ok(start>=0,name);let depth=0;for(let i=body;i<source.length;i++){if(source[i]==="{")depth++;else if(source[i]==="}"&&!--depth)return source.slice(start,i+1);}throw Error(name);}
function harness(){
 const {document,window}=parseHTML(fs.readFileSync(path.join(root,"public/index.html"),"utf8"));
 window.PENECHO_CONFIG={cloudOrigin:"https://example.test"};
 const settings={connections:[],editingConnectionId:null,connectionLimit:10},hostedSettings={models:[],credits:null,signedIn:false,loading:false,error:false};
 let selected="default";
 const context=vm.createContext({document,window,location:{origin:"https://example.test"},settings,hostedSettings,selectedAiConnectionId:()=>selected,t:key=>key});
 for(const id of ["settingsOpenApi","settingsOpenSearch","settingsOpenSystem","settingsConnectionList","settingsConnectionQuickList","connectionLimitText","settingsAddConnection"])context[id]=document.getElementById(id);
 vm.runInContext(["peButton","peChoice","hostedMultiplierLabel","renderHostedModels","connectionProviderLabel","connectionTitle","connectionSummary","renderConnectionLists"].map(extract).join("\n"),context);
 return {document,window,settings,hostedSettings,context,select:id=>{selected=id;}};
}
test("connection page switches cloud invitation to account summary and selectable hosted models",()=>{
 const h=harness(),get=id=>h.document.getElementById(id);
 h.context.renderConnectionLists();
 assert.equal(get("settingsCloudSetup").hidden,false);assert.equal(get("settingsCloudAccount").hidden,true);assert.equal(get("settingsHostedSection").hidden,true);assert.equal(get("settingsLocalConnectionsEmpty").hidden,false);
 h.hostedSettings.signedIn=true;h.hostedSettings.credits=1240;h.hostedSettings.models=[{id:"model-a",displayName:"<model label>",multiplier:0.8}];h.select("hosted:model-a");h.context.renderHostedModels();
 assert.equal(get("settingsCloudSetup").hidden,true);assert.equal(get("settingsCloudAccount").hidden,false);assert.equal(get("settingsHostedSection").hidden,false);
 const button=get("settingsHostedList").querySelector("button");assert.equal(button.getAttribute("aria-pressed"),"true");assert.equal(button.querySelector("strong").textContent,"<model label>");assert.equal(button.querySelector("strong").children.length,0);assert.equal(button.querySelector("small").textContent,"0.8×");
 assert.equal(get("settingsHostedBilling").getAttribute("href"),"https://example.test/dashboard.html#billing");
 h.hostedSettings.signedIn=false;h.hostedSettings.models=[];h.context.renderHostedModels();assert.equal(get("settingsCloudAccount").hidden,true);assert.equal(get("settingsHostedList").children.length,0);
});
test("hosted credit rates render whole numbers in a table and hide without models",()=>{
 const h=harness(),get=id=>h.document.getElementById(id),pricing=get("settingsHostedPricing"),rates=get("settingsHostedRates");
 h.hostedSettings.signedIn=true;h.hostedSettings.models=[];h.context.renderHostedModels();
 assert.equal(pricing.hidden,true);assert.equal(rates.children.length,0);
 h.hostedSettings.models=[
  {id:"model-a",displayName:"model one",multiplier:1,inputCreditsPerMillion:548.52,cacheReadInputCreditsPerMillion:15.672,cacheWriteInputCreditsPerMillion:548.52,outputCreditsPerMillion:940.32},
  {id:"model-b",displayName:"model two",multiplier:2,inputCreditsPerMillion:227.032,cacheReadInputCreditsPerMillion:65.2717,cacheWriteInputCreditsPerMillion:227.032,outputCreditsPerMillion:794.612}
 ];
 h.context.renderHostedModels();
 assert.equal(pricing.hidden,false);
 const rows=[...rates.querySelectorAll("tbody tr")];assert.equal(rows.length,2);
 assert.deepEqual([...rows[0].querySelectorAll("th, td")].map(cell=>cell.textContent),["model one","1×","549","16","940"]);
 assert.deepEqual([...rows[1].querySelectorAll("th, td")].map(cell=>cell.textContent),["model two","2×","227","65","795"]);
 assert.deepEqual([...rates.querySelectorAll("thead th")].map(cell=>cell.textContent),["settingsHostedRateModel","settingsHostedRateMultiplier","settingsHostedRateInput","settingsHostedRateRead","settingsHostedRateOutput"]);
 h.hostedSettings.models=[];h.context.renderHostedModels();
 assert.equal(pricing.hidden,true);assert.equal(rates.children.length,0);
});
test("loading and errors remain recoverable; browser-only Canvas cannot configure host settings",()=>{
 const h=harness(),get=id=>h.document.getElementById(id);
 h.hostedSettings.loading=true;h.context.renderHostedModels();assert.equal(get("settingsHostedStatus").hidden,false);assert.equal(get("settingsHostedRefresh").disabled,true);
 h.hostedSettings.loading=false;h.hostedSettings.error=true;h.context.renderHostedModels();assert.equal(get("settingsHostedSection").hidden,false);assert.equal(get("settingsHostedRefresh").disabled,false);assert.equal(get("settingsHostedStatus").textContent,"settingsHostedError");
 h.window.PENECHO_CONFIG.browserCanvasEditing=true;h.context.renderHostedModels();
 for(const id of ["settingsOpenApi","settingsOpenSearch","settingsOpenSystem"]){assert.equal(get(id).disabled,true);assert.equal(get(id).getAttribute("aria-describedby"),"settingsHostedBrowserNotice");}
 assert.equal(get("settingsHostedBrowserNotice").hidden,false);assert.equal(get("settingsHostedLinkDevice").hidden,false);
});
test("local connection rows preserve model, endpoint, and accessible selection state",()=>{
 const h=harness();h.settings.connections=[{id:"default",provider:"api",apiModel:"model one",apiUrl:"https://example.test/v1",active:true},{id:"second",provider:"codex-cli",cliModel:"model two",active:false}];h.context.renderConnectionLists();
 const buttons=[...h.document.querySelectorAll("#settingsConnectionQuickList > button")];assert.equal(buttons.length,2);assert.equal(buttons[0].dataset.connectionActivate,"default");assert.equal(buttons[0].getAttribute("aria-pressed"),"true");assert.equal(buttons[1].getAttribute("aria-pressed"),"false");assert.equal(buttons[0].querySelector("small").textContent,"https://example.test/v1");
 assert.equal(h.document.getElementById("settingsLocalConnectionsEmpty").hidden,true);
});

test("online linked device adds local connections without removing hosted models or account controls",()=>{
 const h=harness(),get=id=>h.document.getElementById(id);
 Object.assign(h.window.PENECHO_CONFIG,{runtime:"cloud",browserCanvasEditing:true,linkedDeviceLinked:true,linkedDeviceOnline:true});
 h.hostedSettings.signedIn=true;h.hostedSettings.models=[{id:"model-a",displayName:"Cloud model",multiplier:1}];
 h.settings.connections=[{id:"default",provider:"api",apiModel:"Local model",apiUrl:"https://local-provider.test/v1",active:true}];
 h.context.renderConnectionLists();
 assert.equal(get("settingsHostedList").querySelectorAll("button").length,1);
 assert.equal(get("settingsConnectionQuickList").querySelectorAll("button").length,1);
 assert.equal(get("settingsCloudAccount").hidden,false);
 for(const id of ["settingsOpenApi","settingsOpenSearch","settingsOpenSystem"]){assert.equal(get(id).disabled,false);assert.equal(get(id).hasAttribute("aria-describedby"),false);}
 assert.equal(get("settingsHostedBrowserNotice").hidden,true);
 assert.equal(get("settingsHostedLinkDevice").hidden,true);
});

test("linked offline state explains recovery instead of claiming no connections or asking to link again",()=>{
 const h=harness(),get=id=>h.document.getElementById(id);
 Object.assign(h.window.PENECHO_CONFIG,{runtime:"cloud",browserCanvasEditing:true,linkedDeviceLinked:true,linkedDeviceOnline:false});
 h.hostedSettings.signedIn=true;h.hostedSettings.models=[{id:"model-a",displayName:"Cloud model",multiplier:1}];
 h.context.renderConnectionLists();
 assert.equal(get("settingsHostedBrowserNotice").textContent,"settingsLinkedDeviceOffline");
 assert.equal(get("settingsHostedBrowserNotice").hidden,false);
 assert.equal(get("settingsHostedLinkDevice").hidden,true);
 assert.equal(get("settingsLocalConnectionsEmpty").hidden,true);
 assert.equal(get("settingsHostedList").querySelectorAll("button").length,1);
});

test("sign-in opens the local Cloud account area and retains web authentication fallback",()=>{
 const script=fs.readFileSync(path.join(root,"public/cloud-connect.js"),"utf8");
 const start=script.indexOf('  document.getElementById("settingsCloudSetupLink")?.addEventListener');
 const end=script.indexOf('\n  });',start)+6;
 assert.ok(start>=0 && end>start);
 for(const localHostControlsAvailable of [true,false]){
  const h=harness();h.context.renderHostedModels();
  const state={cloudSection:"projects"};let opened=0;
  vm.runInNewContext(script.slice(start,end),{document:h.document,state,localHostControlsAvailable,openCloud:()=>{opened++;}});
  const event=new h.window.Event("click",{cancelable:true});
  const link=h.document.getElementById("settingsCloudSetupLink");link.dispatchEvent(event);
  assert.equal(event.defaultPrevented,localHostControlsAvailable);
  assert.equal(opened,localHostControlsAvailable?1:0);
  assert.equal(state.cloudSection,localHostControlsAvailable?"account":"projects");
  assert.equal(link.getAttribute("href"),"https://example.test/auth.html");
 }
});

test("missing and invalid rates stay distinct from zero and model names remain text",()=>{
 const h=harness();h.hostedSettings.signedIn=true;
 h.hostedSettings.models=[{id:"edge",displayName:"<img src=x>",multiplier:0.8,inputCreditsPerMillion:0,cacheReadInputCreditsPerMillion:null,outputCreditsPerMillion:"invalid"}];
 h.context.renderHostedModels();
 const rates=h.document.getElementById("settingsHostedRates");
 assert.deepEqual([...rates.querySelectorAll("tbody th, tbody td")].map(cell=>cell.textContent),["<img src=x>","0.8×","0","—","—"]);
 assert.equal(rates.querySelector("img"),null);
 for (const missing of [undefined, "", "   "]) {
  h.hostedSettings.models[0].cacheReadInputCreditsPerMillion=missing;h.context.renderHostedModels();
  assert.equal(rates.querySelectorAll("tbody td")[2].textContent,"—");
 }
});
