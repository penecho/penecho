const fs=require('node:fs'),path=require('node:path');
const {call}=require('../../local-renderers/2026-09-18/call.cjs');
const fixtures=require('./fixtures.cjs');
const revision=process.argv[2]||'r1';
if(!/^r\d+$/.test(revision))throw Error('Expected revision r1, r2, ...');
async function main(){
  const sp=path.join(__dirname,'session.json');
  let session=fs.existsSync(sp)?JSON.parse(fs.readFileSync(sp)):null;
  if(!session){
    const {canvases}=await call('penecho_list_canvases',{}),target=canvases.find(c=>c.active)||canvases[0];
    if(!target)throw Error('No opted-in browser');
    session=await call('penecho_start_session',{instanceId:target.instanceId,canvasId:target.canvasId,title:'Workflow 流程图 · 四场景验收',client:'codex-workflow-test',sessionKey:'workflow-20260918-four-cases',show:true});
    fs.writeFileSync(sp,JSON.stringify(session,null,2));
  }
  for(const [id,data]of Object.entries(fixtures)){
    const r=await call('penecho_present_widget',{sessionId:session.sessionId,artifactId:id+'-preview-'+revision,title:data.title+' · '+revision.toUpperCase()+' 预览',html:fs.readFileSync(path.join(__dirname,id+'.preview-'+revision+'.html'),'utf8'),width:1280,height:950,presentation:{intent:'review'},requestId:'workflow-preview-'+revision+'-'+id});
    fs.writeFileSync(path.join(__dirname,id+'.preview-'+revision+'.result.json'),JSON.stringify(r,null,2));
    console.log(JSON.stringify({id,documentId:session.documentId,result:r}));
  }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
