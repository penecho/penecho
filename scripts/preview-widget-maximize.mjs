// Serve canonical editor and officially mirrored share pages with isolated data.
// Usage: node scripts/preview-widget-maximize.mjs <saved-share-response.json>
// Stop with Ctrl-C; no existing services or user documents are changed.
import fs from 'node:fs';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {Readable} from 'node:stream';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cloudRoot = path.resolve(root, '../penecho_cloud');
const payload = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const bundle = payload.artifact || payload;
const widgets = bundle.assets.filter(asset=>asset.kind==='widget').map(asset=>JSON.parse(Buffer.from(asset.dataBase64,'base64')));
assert.ok(widgets.length, 'The saved share must contain a widget');
const temporary = await mkdtemp(path.join(os.tmpdir(),'penecho-maximize-preview-'));
const readout = `window.widgetMaximizeVerification={read:()=>({
  selected:state.selectedWidgetId,viewerSelected:state.viewerSelectedWidgetId,
  editing:state.widgetEdit?.id||null,interacting:state.interactingWidgetId,
  widgets:state.widgets.map(w=>({id:w.id,x:w.x,y:w.y,w:w.w,h:w.h})),
  history:state.history.length,revision:state.userRevision,
  camera:{scale:state.scale,panX:state.panX,panY:state.panY}
})};`;
const inject = (code, setup='') => code.replace(/\}\)\(\);\s*$/, readout+setup+'})();');
const editorWidgets = widgets.map((widget,index)=>({...widget,id:`maximize-preview-${index+1}`,x:90+index*520,y:210,w:420,h:560}));
if (editorWidgets.length===1) editorWidgets.push({...editorWidgets[0],id:'maximize-preview-2',x:610,title:'Second Widget'});
const setup = `canvasDocumentsReady().then(()=>{
  state.auto=false;setSmartSuggestEnabled(false);
  markChangelogSeen();markFeatureTourStepsSeen(FEATURE_TOUR_STEPS);
  closeFeatureTour({restore:false,scroll:false,changelog:false,retry:false});closeChangelog();
  restoreWidgets(${JSON.stringify(editorWidgets)});setCanvasMode('hand');
  state.scale=1;state.panX=0;state.panY=0;render();
  document.querySelector('#canvasWelcome').hidden=true;
});`;
const originalStream = fs.createReadStream;
fs.createReadStream = function(file,...args) {
  if (path.resolve(String(file))===path.join(root,'public/app.js')) return Readable.from([inject(fs.readFileSync(file,'utf8'),setup)]);
  return originalStream.call(this,file,...args);
};
Object.assign(process.env,{NODE_ENV:'test',PENECHO_TEST_OPEN_ACCESS:'1',PENECHO_STATE_DIR:path.join(temporary,'state'),
  PENECHO_CONFIG_FILE:path.join(temporary,'config.env'),HOST:'127.0.0.1',PORT:'0',AI_PROVIDER:'api',AI_API_KEY:'test-only',
  AI_API_URL:'http://127.0.0.1:1/v1',AI_API_MODEL:'test',PENECHO_CANVAS_AGENT_AUTO_OPEN:'false',PENECHO_REQUEST_TRACE:'false',PENECHO_JEVISION_ENABLED:'false'});
const require = createRequire(import.meta.url);
const local = require('../server.js');
await new Promise(resolve=>local.listening ? resolve() : local.once('listening',resolve));
const reservation = net.createServer();
await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));
const port = reservation.address().port;
await new Promise(resolve=>reservation.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const {buildApp} = await import(pathToFileURL(path.join(cloudRoot,'src/app.mjs')));
const {completeCanvasBundle} = await import(pathToFileURL(path.join(cloudRoot,'src/routes/canvas-bundle-flow.mjs')));
const {encodeBundle,sha256} = await import(pathToFileURL(path.join(cloudRoot,'src/services/canvas-bundle.mjs')));
const cloud = await buildApp({logger:false,env:{NODE_ENV:'test',APP_ORIGIN:origin,AUTH_MODE:'development',DATA_MODE:'memory',SESSION_MODE:'memory',STORAGE_MODE:'memory',CLOUD_NATIVE_CANVAS_ENABLED:'true'}});
cloud.get('/canvas/app.js',{config:{rateLimit:false},compress:false},async(_request,reply)=>
  reply.type('application/javascript').send(inject(fs.readFileSync(path.join(cloudRoot,'public/canvas/app.js'),'utf8'))));
const email='maximize-preview@isolated.test',password='Maximize preview A9';
const registered = await cloud.inject({method:'POST',url:'/api/v1/auth/register',payload:{email,name:'Preview',password,termsAccepted:true,privacyAccepted:true}});
await cloud.inject({method:'POST',url:'/api/v1/auth/verify-email',payload:{email,code:registered.json().developmentCode}});
const login = await cloud.inject({method:'POST',url:'/api/v1/auth/login',payload:{email,password}});
assert.equal(login.statusCode,200);
const account = login.json().account;
const {repository,storage} = cloud.services;
const project = (await repository.listProjects(account.id))[0];
async function share(data) {
  const canvas = await repository.createCanvas(account.id,project.id,{name:data.name||'Maximize preview'});
  const bytes = encodeBundle(data);
  const plan = await repository.reserveRevision(account.id,project.id,{baseRevisionId:null,formatVersion:data.formatVersion,mode:'snapshot',bundle:{sha256:sha256(bytes),sizeBytes:bytes.length,contentType:'application/json'}},canvas.id);
  await storage.put(plan.bundle.objectKey,bytes,'application/json');
  await completeCanvasBundle({repository,storage,userId:account.id,revisionId:plan.revision.id});
  return repository.enableLiveShare(account.id,canvas.id);
}
const actual = await share(bundle);
const multiple = {...bundle,name:'Multiple Widget selection',assets:[
  ...bundle.assets.filter(asset=>asset.kind!=='widget'),
  ...editorWidgets.map(widget=>({kind:'widget',contentType:'application/json',metadata:{widgetId:widget.id},dataBase64:Buffer.from(JSON.stringify(widget)).toString('base64')})),
]};
const two = await share(multiple);
await cloud.listen({port,host:'127.0.0.1'});
console.log(JSON.stringify({editor:`http://127.0.0.1:${local.address().port}`,share:`${origin}/canvas/share/${actual.token}`,multiple:`${origin}/canvas/share/${two.token}`,
  inputs:Object.fromEntries(['app.js','style.css','viewer.css'].map(file=>[file,createHash('sha256').update(fs.readFileSync(path.join(root,'public',file))).digest('hex')]))}));
for (const signal of ['SIGINT','SIGTERM']) process.once(signal,async()=>{await cloud.close();await new Promise(resolve=>local.close(resolve));await rm(temporary,{recursive:true,force:true});process.exit(0);});
