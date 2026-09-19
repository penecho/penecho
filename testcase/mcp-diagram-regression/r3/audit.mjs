import fs from 'node:fs';
import ELK from 'elkjs/lib/elk.bundled.js';
import {layoutArchitecture} from '../../../src/architecture/layout.mjs';
import {layoutWorkflow} from '../../../src/workflow/layout.mjs';
import {layoutSequence} from '../../../src/sequence/layout.mjs';
const sources=JSON.parse(fs.readFileSync(new URL('./sources.json',import.meta.url)));
const output=[];
for(const item of sources){
  const match=item.html.match(/<script[^>]*data-(architecture|sequence|workflow)-source[^>]*>([\s\S]*?)<\/script>/i);
  const model=JSON.parse(match[2]);
  for(const width of [640,1960]){
    const started=performance.now();
    try{
      const result=item.kind==='sequence'?layoutSequence(model,undefined,{width}):await (item.kind==='architecture'?layoutArchitecture:layoutWorkflow)(model,new ELK(),undefined,{width});
      const row={kind:item.kind,id:item.id,title:item.title,width,layoutWidth:result.width,layoutHeight:result.height,ms:Math.round(performance.now()-started),mode:result.mode,issues:result.issues||[],nodes:result.nodes?.length,edges:result.edges?.length,participants:result.participants?.length,messages:result.messages?.length};
      output.push(row);console.log(JSON.stringify(row));
    }catch(error){const row={kind:item.kind,id:item.id,title:item.title,width,error:error.message};output.push(row);console.log(JSON.stringify(row));}
  }
}
fs.writeFileSync(new URL('./layout-audit.json',import.meta.url),JSON.stringify(output,null,2)+'\n');
