"use strict";
// Bounded live UAT check through an isolated local Canvas, never production.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'penecho-llm-uat-'));
Object.assign(process.env,{NODE_ENV:'test',PENECHO_TEST_OPEN_ACCESS:'1',PENECHO_STATE_DIR:directory,PENECHO_CONFIG_FILE:path.join(directory,'config.env'),PENECHO_CLOUD_ENV:'uat',PENECHO_CLOUD_ORIGIN:'https://internaltest.penecho.ai',HOST:'0.0.0.0',PORT:'0',AI_PROVIDER:'api',AI_API_KEY:'test-unused',AI_API_URL:'http://127.0.0.1:1/v1',AI_API_MODEL:'test-unused',PENECHO_CANVAS_AGENT_AUTO_OPEN:'false',PENECHO_REQUEST_TRACE:'false',PENECHO_JEVISION_ENABLED:'true',PENECHO_JEVISION_MOCK:'false'});
const server=require('../server.js');
(async()=>{
 try {
  await new Promise(resolve=>server.listening?resolve():server.once('listening',resolve));
  const address=Object.values(os.networkInterfaces()).flat().find(item=>item.family==='IPv4'&&!item.internal&&/^192\.168\.|^10\.|^172\.(1[6-9]|2\d|3[01])\./.test(item.address))?.address||'127.0.0.1';
  const origin=`http://${address}:${server.address().port}`,session=await(await fetch(`${origin}/api/local-access/status`)).json();
  const headers={origin,'content-type':'application/json','x-penecho-session':session.accessSessionToken};
  const status=await(await fetch(`${origin}/api/suggest/status`,{headers})).json();
  assert.equal(status.configured,true);assert.equal(status.access.remaining,200);assert.equal(status.guestToken,undefined);
  const image=/const SAMPLE_IMAGE = "([^"]+)"/.exec(fs.readFileSync(path.join(__dirname,'jevision-probe.js'),'utf8'))[1];
  const payload={version:1,mode:'ink',image,context:{shapesFit:false}},results=[];
  for(let n=0;n<2;n++){
   const response=await fetch(`${origin}/api/suggest`,{method:'POST',headers,body:JSON.stringify(payload),signal:AbortSignal.timeout(12000)}),body=await response.json();
   assert.equal(response.status,200);assert.equal(body.ok,true,JSON.stringify(body));assert.equal(body.model,'PenEchoLLM');assert.equal(body.access.remaining,199);assert.equal(body.guestToken,undefined);assert.equal(body.answers.kind.choice,'math_expr');
   results.push({status:response.status,remaining:body.access.remaining,cached:body.cached,model:body.model,action:body.answers.action.choice});
  }
  assert.equal(results[1].cached,true);
  console.log(JSON.stringify({lan:address!=='127.0.0.1',cloud:'UAT',results,existingSessionsUntouched:true}));
 } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(directory,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
