"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const host=fs.readFileSync(path.join(__dirname,"../public/widget-host.js"),"utf8"),vendor=fs.readFileSync(path.join(__dirname,"../public/vendor/penecho-dom-renderer.js"),"utf8");
function fn(name){const start=host.indexOf(`    function ${name}(`),end=host.indexOf("\n    function ",start+1);return host.slice(start,end);}
function element(tagName="DIV"){
  const attributes=new Map(),styles=new Map(),children=[];
  return {tagName,type:"checkbox",checked:true,namespaceURI:"http://www.w3.org/1999/xhtml",children,styles,attributes,
    offsetLeft:42,offsetTop:27,offsetWidth:20,offsetHeight:20,
    style:{setProperty:(key,value)=>styles.set(key,value)},
    getAttribute:key=>attributes.get(key)??null,setAttribute:(key,value)=>attributes.set(key,value),removeAttribute:key=>attributes.delete(key),hasAttribute:key=>attributes.has(key),
    get firstChild(){return children[0]||null;},get nextSibling(){const siblings=this.parentNode?.children||[];return siblings[siblings.indexOf(this)+1]||null;},
    insertBefore(node,before){const index=before?children.indexOf(before):children.length;children.splice(index,0,node);node.parentNode=this;},
    appendChild(node){this.insertBefore(node,null);},remove(){const index=this.parentNode?.children.indexOf(this)??-1;if(index>=0)this.parentNode.children.splice(index,1);this.parentNode=null;},
  };
}
function computed(values){const keys=Object.keys(values);return{length:keys.length,item:i=>keys[i],getPropertyValue:key=>values[key]||""};}
function harness({native=false,fail=false}={}){
  const root=element(),parent=element(),input=element("INPUT"),unchecked=element("INPUT"),tail=element();unchecked.checked=false;root.appendChild(parent);parent.appendChild(input);parent.appendChild(unchecked);parent.appendChild(tail);
  const inputStyle=computed({appearance:native?"auto":"none",position:"relative",transform:"matrix(0.9, 0, 0, 0.9, 0, 0)","transform-origin":"10px 10px","border-left-width":"2px","border-top-width":"2px",opacity:"0.8"}),
    after=computed({content:'"✓"',display:"flex",position:"absolute",inset:"0px",color:"rgb(255, 255, 255)","font-size":"15px"}),none=computed({content:"none"});
  const context={document:{documentElement:root,activeElement:input,querySelectorAll:()=>[parent,input,unchecked,tail],createElement:tag=>{if(fail&&tag==="penecho-snapshot-input")throw Error("carrier failed");return element(tag.toUpperCase());}},
    SNAPSHOT_GENERATED_PSEUDOS:[{selector:"::before",placement:"prepend"},{selector:"::after",placement:"append"}],
    getComputedStyle:(item,pseudo)=>!pseudo?inputStyle:item===input&&pseudo==="::after"?after:none};
  vm.runInNewContext(fn("snapshotPseudoContentText")+fn("materializeSnapshotGeneratedContent")+";this.materialize=materializeSnapshotGeneratedContent;",context);
  return {...context,input,unchecked,parent,tail};
}
test("custom checkbox pseudo uses an adjacent containing box without moving the live input",()=>{
  const h=harness(),originalChildren=[...h.parent.children],restore=h.materialize(),carrier=h.parent.children.at(-1);
  assert.equal(h.parent.children[0],h.input);assert.equal(h.input.children.length,0);assert.equal(h.document.activeElement,h.input);assert.equal(h.input.checked,true);
  assert.equal(h.input.nextSibling,h.unchecked);assert.equal(h.unchecked.nextSibling,h.tail);
  assert.equal(carrier.tagName,"PENECHO-SNAPSHOT-INPUT");assert.equal(carrier.styles.get("left"),"42px");assert.equal(carrier.styles.get("top"),"27px");assert.equal(carrier.styles.get("width"),"20px");
  assert.equal(carrier.styles.get("transform"),"matrix(0.9, 0, 0, 0.9, 0, 0)");assert.equal(carrier.styles.get("transform-origin"),"10px 10px");assert.equal(carrier.styles.get("border-left-width"),"2px");
  assert.equal(carrier.styles.get("background-color"),"transparent");assert.equal(carrier.children[0].textContent,"✓");assert.equal(carrier.children[0].styles.get("display"),"flex");
  assert.equal(h.input.hasAttribute("data-penecho-snapshot-custom-input"),true);assert.equal(h.unchecked.hasAttribute("data-penecho-snapshot-custom-input"),true);
  restore();assert.deepEqual(h.parent.children,originalChildren);assert.equal(h.input.hasAttribute("data-penecho-snapshot-custom-input"),false);assert.equal(h.unchecked.hasAttribute("data-penecho-snapshot-custom-input"),false);assert.equal(h.document.activeElement,h.input);
});
test("cleanup restores an existing marker, including materialization failures",()=>{
  const h=harness();h.input.setAttribute("data-penecho-snapshot-custom-input","previous");const restore=h.materialize();restore();assert.equal(h.input.getAttribute("data-penecho-snapshot-custom-input"),"previous");
  const failed=harness({fail:true}),originalChildren=[...failed.parent.children];assert.throws(()=>failed.materialize(),/carrier failed/);assert.deepEqual(failed.parent.children,originalChildren);assert.equal(failed.input.hasAttribute("data-penecho-snapshot-custom-input"),false);
});
test("renderer uses normal CSS for marked custom inputs and retains native input rendering otherwise",()=>{
  const source=vendor.slice(vendor.indexOf("VB=function")+3,vendor.indexOf(",kB=function")),
    plain=class Plain{},native=class Native{},context={ur:plain,pB:native,_B:node=>node.tagName==="INPUT"};
  for(const predicate of ["$B","zB","qB","WB","ZB","tn","en","An"])context[predicate]=()=>false;
  const factory=vm.runInNewContext(`(${source})`,context),input=element("INPUT");
  assert.ok(factory({},input) instanceof native);input.setAttribute("data-penecho-snapshot-custom-input","");assert.ok(factory({},input) instanceof plain);
});
