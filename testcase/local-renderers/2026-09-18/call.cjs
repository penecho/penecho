const fs=require('node:fs');
const {discoverRecords}=require('../../../src/server/mcp/records.js');
const {bridgeRequest}=require('../../../src/server/mcp/stdio.js');
async function call(name,args){
 const record=discoverRecords().find(r=>r.port===3921&&r.rootDirectory==='/Users/heack/workspace/penecho_071_version');
 if(!record)throw Error('The explicitly selected 071 / 3921 instance is unavailable.');
 return bridgeRequest(record,{ownerId:'d4c7df02-c185-4e29-b8a6-c48256d8a290',operation:'call',name,arguments:args});
}
module.exports={call};
if(require.main===module){let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',async()=>{try{const {name,args}=JSON.parse(input);console.log(JSON.stringify(await call(name,args)));}catch(e){console.error(e.message);process.exitCode=1;}});}
