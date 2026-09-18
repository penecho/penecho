// Talk to the isolated acceptance server through the repository's real MCP bridge.
// Input/output paths are explicit; host credentials remain in the local record reader.
const fs=require('node:fs'),path=require('node:path');
const {readRecords,recordsDirectory}=require('../../../src/server/mcp/records.js');
const {bridgeRequest}=require('../../../src/server/mcp/stdio.js');
(async()=>{const records=readRecords(recordsDirectory('/tmp/penecho-architecture-20260918'));if(records.length!==1)throw Error('Expected one isolated MCP record');const input=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));const result=await bridgeRequest(records[0],{ownerId:'0f43e668-280d-4f4f-8f2b-202609181001',operation:'call',name:input.name,arguments:input.arguments});if(process.argv[3])fs.writeFileSync(process.argv[3],JSON.stringify(result,null,2));console.log(JSON.stringify(result,(k,v)=>k==='data'&&typeof v==='string'&&v.length>1000?'[image saved in output file]':v));})().catch(e=>{console.error(e.message);process.exitCode=1;});
