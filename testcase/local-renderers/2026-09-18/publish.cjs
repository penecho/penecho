const fs=require('node:fs');const path=require('node:path');const {call}=require('./call.cjs');
const fixtures=require('./fixtures.cjs');
async function main(){
 const id=process.argv[2];const fixture=fixtures.find(f=>f.id===id);if(!fixture)throw Error('Unknown fixture');
 const sessionPath=path.join(__dirname,id+'.session.json');
 const session=fs.existsSync(sessionPath)?JSON.parse(fs.readFileSync(sessionPath)):await call('penecho_start_session',{instanceId:'4f97dde8-4842-420d-871e-d2905d2c1c27',canvasId:'c8b49c3c-b5dc-450d-a9c8-8d9f79e5e7cc',title:fixture.title,client:'codex-renderer-audit',sessionKey:'renderer-audit-20260918-'+id,show:true});
 fs.writeFileSync(sessionPath,JSON.stringify(session,null,2));
 const result=await call('penecho_present_widget',{sessionId:session.sessionId,artifactId:id,title:fixture.title,html:fs.readFileSync(path.join(__dirname,id+'.html'),'utf8'),width:1200,height:700,presentation:{intent:'review'},requestId:'renderer-audit-'+id+'-v2'});
 fs.writeFileSync(path.join(__dirname,id+'.result.json'),JSON.stringify(result,null,2));
 console.log(JSON.stringify({id,sessionId:session.sessionId,documentId:session.documentId,...result}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
