import fs from 'node:fs';
import ELK from 'elkjs/lib/elk.bundled.js';
import {layoutArchitecture} from '../../src/architecture/layout.mjs';
import {layoutWorkflow} from '../../src/workflow/layout.mjs';
import {layoutSequence} from '../../src/sequence/layout.mjs';
const fixtures=JSON.parse(fs.readFileSync(new URL('./original-models.json',import.meta.url)));
const results=[];
for(const [kind,models] of Object.entries(fixtures)) for(const [i,data] of models.entries()) {
  const layout=kind==='sequence'?layoutSequence(data,undefined,{width:1280}):await (kind==='architecture'?layoutArchitecture:layoutWorkflow)(data,new ELK(),undefined,{width:1280});
  const axis=layout.mode==='right'?'x':'y', nodes=new Map((layout.nodes||[]).map(n=>[n.id,n]));
  const backwards=(layout.edges||[]).filter(e=>e.kind!=='loop'&&e.kind!=='return'&&nodes.get(e.from)?.[axis]>=nodes.get(e.to)?.[axis]).map(e=>e.id);
  const row={kind,index:i+1,width:layout.width,height:layout.height,mode:layout.mode,issues:layout.issues,backwards};
  results.push(row); console.log(JSON.stringify(row));
}
if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(results,null,2)+'\n');
