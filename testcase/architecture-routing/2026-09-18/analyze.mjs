import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import ELK from 'elkjs/lib/elk.bundled.js';
import {layoutArchitecture} from '../../../src/architecture/layout.mjs';
import {renderContent,styles} from '../../../src/architecture/render.mjs';
const dir=path.dirname(fileURLToPath(import.meta.url));
const data=JSON.parse(fs.readFileSync(path.join(dir,'input.json')));
export function metrics(layout) {
 const routes=layout.edges.map(e=>{
  const points=e.sections.flat(),length=e.sections.reduce((sum,ps)=>sum+ps.slice(1).reduce((s,p,i)=>s+Math.abs(p[0]-ps[i][0])+Math.abs(p[1]-ps[i][1]),0),0);
  const first=points[0],last=points.at(-1),direct=Math.abs(last[0]-first[0])+Math.abs(last[1]-first[1]);
  return {from:e.from,to:e.to,length:Math.round(length),direct:Math.round(direct),ratio:Math.round(length/Math.max(1,direct)*100)/100,bends:points.length-2};
 });
 return {mode:layout.mode,width:Math.round(layout.width),height:Math.round(layout.height),issues:layout.issues,
  totalLength:routes.reduce((n,e)=>n+e.length,0),bends:routes.reduce((n,e)=>n+e.bends,0),routes:routes.sort((a,b)=>b.ratio-a.ratio)};
}
const results=[];
for(const width of [undefined,1450,900,390]) {
 const layout=await layoutArchitecture(data,new ELK(),undefined,{width});
 const name='auto-'+(width||'natural');
 results.push({name,...metrics(layout)});
 fs.writeFileSync(path.join(dir,name+'.layout.json'),JSON.stringify(layout,null,2));
}
for(const variant of [
 {name:'right',direction:'RIGHT'},
 {name:'wrapped',direction:'RIGHT',wrap:true},
 {name:'down',direction:'DOWN'},
 {name:'compact',direction:'DOWN',compact:true},
 {name:'down-clear-title',direction:'DOWN',header:96},
 {name:'compact-clear-title',direction:'DOWN',compact:true,header:96},
]) {
 const elk=new ELK(),engine={layout(graph){
  const visit=g=>{if(variant.header&&g.data){g.data.headerHeight=variant.header;g.layoutOptions['elk.padding']='[top='+variant.header+',left=22,bottom=24,right=22]';}
   if(variant.wrap)Object.assign(g.layoutOptions,{'elk.layered.wrapping.strategy':'MULTI_EDGE','elk.aspectRatio':'.8'});
   if(variant.compact)Object.assign(g.layoutOptions,{'elk.layered.layering.strategy':'COFFMAN_GRAHAM','elk.layered.layering.coffmanGraham.layerBound':'1'});
   for(const c of g.children||[])if(c.children)visit(c);
  };visit(graph);return elk.layout(graph);
 }};
 const layout=await layoutArchitecture({...data,direction:variant.direction},engine);
 const html='<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0}'+styles+'</style></head><body><section data-penecho-architecture style="--pa-map-width:'+layout.width+'px;--pa-map-min:'+Math.ceil(layout.width*.9)+'px">'+renderContent(layout,'routing-'+variant.name)+'</section></body></html>';
 results.push({name:variant.name,...metrics(layout)});
 fs.writeFileSync(path.join(dir,variant.name+'.layout.json'),JSON.stringify(layout,null,2));
 fs.writeFileSync(path.join(dir,variant.name+'.html'),html);
}
fs.writeFileSync(path.join(dir,'metrics.json'),JSON.stringify(results,null,2));
console.log(JSON.stringify(results.map(({routes,...m})=>({...m,worst:routes.slice(0,4)})),null,2));
