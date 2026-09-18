// End-to-end MCP acceptance against the explicitly isolated local application.
const fs=require('node:fs'),path=require('node:path');
const {readRecords,recordsDirectory}=require('../../../src/server/mcp/records.js');
const {bridgeRequest}=require('../../../src/server/mcp/stdio.js');
const dir=__dirname,slug=process.argv[2]?'glm-reviewed':'reference',ownerId='0f43e668-280d-4f4f-8f2b-202609181002';
(async()=>{const records=readRecords(recordsDirectory('/tmp/penecho-architecture-20260918'));if(records.length!==1||records[0].port!==8771)throw Error('Expected exact isolated instance on 8771');const report={calls:[]};
 const call=async(name,args)=>{const start=performance.now();const result=await bridgeRequest(records[0],{ownerId,operation:'call',name,arguments:args});report.calls.push({name,arguments:args,elapsedMs:Math.round(performance.now()-start),result});fs.writeFileSync(path.join(dir,'local-mcp-'+slug+'-report.json'),JSON.stringify(report,null,2));return result;};
 const list=await call('penecho_list_canvases',{});const target=list.canvases[0];if(!target)throw Error('No authorized local test canvas');
 const session=await call('penecho_start_session',{instanceId:target.instanceId,canvasId:target.canvasId,client:'architecture-local-acceptance',sessionKey:'json-worker-'+slug,title:'MCP 架构 · JSON Worker '+slug,show:true});
 await call('penecho_open_canvas',{instanceId:target.instanceId,canvasId:target.canvasId,documentId:session.documentId,requestId:'open-json-worker-v1-'+slug,show:true});
 const architecture=JSON.parse(fs.readFileSync(process.argv[2]||path.join(dir,'mcp.semantic.json')));
 const shown=await call('penecho_present_widget',{sessionId:session.sessionId,artifactId:'semantic-local',title:architecture.title,architecture,width:2000,height:1100,requestId:'create-semantic-local-v1-'+slug});
 const resized=await call('penecho_edit_canvas',{sessionId:session.sessionId,objectId:shown.objectId,action:'resize',width:4000,height:1740,baseRevision:shown.revision,requestId:'resize-semantic-local-v2-'+slug});
 const shot=await call('penecho_capture_canvas',{sessionId:session.sessionId,target:'artifact',artifactId:'semantic-local',quality:'detail'});
 if(shot.image)fs.writeFileSync(path.join(dir,'local-mcp-'+slug+'-capture.webp'),Buffer.from(shot.image.data,'base64'));
 console.log(JSON.stringify({sessionId:session.sessionId,documentId:session.documentId,objectId:shown.objectId,calls:report.calls.map(c=>({name:c.name,elapsedMs:c.elapsedMs})),captured:!!shot.image,revision:resized.revision}));
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
