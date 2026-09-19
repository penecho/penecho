// Pixel acceptance through the user's existing MCP browser connection. These
// are pre-rendered previews; browser Worker evidence is recorded separately.
const fs=require('node:fs'),path=require('node:path');
const {call}=require('../../local-renderers/2026-09-18/call.cjs');
const fixtures=require('./fixtures.cjs');
const revision=process.argv[2]||'r2';
if(!/^r\d+$/.test(revision))throw Error('Expected revision r1, r2, ...');
async function main(){
  const session=JSON.parse(fs.readFileSync(path.join(__dirname,'session.json')));
  for(const [id,data]of Object.entries(fixtures)){
    const result=await call('penecho_present_widget',{
      sessionId:session.sessionId,artifactId:id+'-inspect-'+revision,
      title:data.title+' · '+revision.toUpperCase()+' 验收',
      html:fs.readFileSync(path.join(__dirname,id+'.preview-'+revision+'.html'),'utf8'),
      width:1280,height:id==='linear'?500:1300,capture:true,quality:'detail',
      presentation:{intent:'inspect',attention:'quiet'},
      requestId:'workflow-inspect-'+revision+'-'+id,
    });
    if(!result.image?.data||!result.pixelVerified)throw Error(id+': screenshot not verified');
    fs.writeFileSync(path.join(__dirname,id+'.'+revision+'.webp'),Buffer.from(result.image.data,'base64'));
    delete result.image.data;
    fs.writeFileSync(path.join(__dirname,id+'.'+revision+'.capture.json'),JSON.stringify(result,null,2));
    console.log(JSON.stringify({id,applied:result.applied,pixelVerified:result.pixelVerified,bytes:result.image.bytes}));
  }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
