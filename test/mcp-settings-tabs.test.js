const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function setup(runtime,online=false){
  const nodes=new Map();let document;
  function node(id){if(!nodes.has(id))nodes.set(id,{id,hidden:false,attrs:{},listeners:{},setAttribute(key,value){this.attrs[key]=value;},addEventListener(key,fn){this.listeners[key]=fn;},focus(){document.activeElement=this;},querySelector:selector=>node(`${id} ${selector}`),querySelectorAll:()=>[node('help-one'),node('help-two')]});return nodes.get(id);}
  document={documentElement:{lang:'en'},activeElement:null,getElementById:node,querySelector:node};node('settingsPageMcp').hidden=true;
  const window=new EventTarget();window.PENECHO_CONFIG={runtime};window.PENECHO_REMOTE_CLOUD_STATUS={deviceOnline:online};let options,lastDevice,refreshes=0;
  window.PenEchoCloudSettings={api:async()=>({}),origin:()=> 'https://penecho.test',signIn:()=>{},signInState:()=>({})};
  window.PenEchoCloudMcp={mount:(_root,value)=>{options=value;return {refresh:async()=>{refreshes++;},setLanguage(){},updateConnection(){},updateDeviceStatus:value=>{lastDevice=value;}};}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/mcp-settings.js'),'utf8'),{window,document,CustomEvent:class extends Event{constructor(type,options={}){super(type);this.detail=options.detail;}}});
  return {window,document,node,get options(){return options;},get lastDevice(){return lastDevice;},get refreshes(){return refreshes;}};
}
test('Cloud hides Local when no device is online and keyboard never selects a hidden tab',()=>{
  const h=setup('cloud');assert.equal(h.node('mcpLocalTab').hidden,true);h.window.PenEchoMcpSettings.select('local');assert.equal(h.node('mcpLocalPanel').hidden,true);
  h.node('.mcp-settings-tabs').listeners.keydown({key:'End',preventDefault(){}});assert.equal(h.document.activeElement,h.node('mcpCloudTab'));assert.equal(h.node('mcpLocalPanel').hidden,true);
});
test('device presence changes reveal Local, then safely return an offline selection to Cloud without refetching settings',()=>{
  const h=setup('cloud');h.window.PENECHO_REMOTE_CLOUD_STATUS={deviceOnline:true};h.window.dispatchEvent(new Event('penecho:remote-cloud-status'));
  assert.equal(h.node('mcpLocalTab').hidden,false);h.window.PenEchoMcpSettings.select('local');h.node('mcpLocalTab').focus();
  h.window.PENECHO_REMOTE_CLOUD_STATUS={deviceOnline:false};h.window.dispatchEvent(new Event('penecho:remote-cloud-status'));
  assert.equal(h.node('mcpLocalTab').hidden,true);assert.equal(h.node('mcpCloudPanel').hidden,false);assert.equal(h.document.activeElement,h.node('mcpCloudTab'));assert.equal(h.refreshes,0);
});
test('local Canvas preserves both existing tabs and enable action, and supplies offline status to its warning',async()=>{
  const h=setup('local');assert.equal(h.node('mcpLocalTab').hidden,false);h.window.PenEchoMcpSettings.open();assert.equal(typeof h.options.enable,'function');
  h.window.PenEchoMcpSettings.setDeviceStatus({connected:false});assert.equal(h.lastDevice.connected,false);
  h.window.PenEchoMcpSettings.select('local');assert.equal(h.node('mcpLocalPanel').hidden,false);
});
test('opening MCP settings after a language change refreshes both tab labels',()=>{
  const h=setup('local');h.document.documentElement.lang='zh-CN';h.window.PenEchoMcpSettings.open();
  assert.equal(h.node('mcpCloudTab').textContent,'云端 MCP');assert.equal(h.node('mcpLocalTab').textContent,'本地 MCP');
});
