// UAT-only drawing experiment. No real Canvas, account or provider mutations.
// Examples and fixes remain in the canonical repository. Credentials stay in UAT.
import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import sharp from 'sharp';

const require = createRequire(import.meta.url), DRAW = require('../public/draw.js'), FINISH_DRAWING = require('../src/shared/finish-drawing.js');
const root = resolve(import.meta.dirname, '..');
const option = (key, fallback) => process.argv.find(v => v.startsWith(`--${key}=`))?.slice(key.length + 3) ?? fallback;
const directory = resolve(root, option('output', 'docs/verification/finish-drawing-20261002'));
const source = await readFile(join(root, 'src/server/main.js'), 'utf8');
const context = vm.createContext({ fs:require('node:fs'), path:require('node:path'), FINISH_DRAWING, __dirname:join(root, 'src/server'), MODEL_FINAL_JSON_TARGET_TOKENS:6144, MODEL_REASONING_BUDGET_FRACTION:'one half' });
vm.runInContext(source.slice(source.indexOf('const SYSTEM_PROMPT ='), source.indexOf('function systemPromptBase(')), context);
const system = vm.runInContext('[ACTIVE_SYSTEM_PROMPT_BASE,PLUGIN_ROUTING_PROMPT,PLUGIN_SYSTEM_PROMPT,SCENE_CONTRACT_PROMPT,MANDATORY_VISIBLE_RESPONSE_PROMPT,REFINE_MODE_GATE_PROMPT,JSON_RESPONSE_SCHEMA_PROMPT].join(String.fromCharCode(10,10))', context);
vm.runInContext(source.slice(source.indexOf('const SUGGESTION_FOCUS ='), source.indexOf('function finiteDebugBox(')), context);
const baseline = vm.runInContext('SUGGESTION_FOCUS.finish_drawing[1]', context);
const contour = `Finish this drawing in place with one native draw command. Infer the most likely subject and intended outline from the existing ink before choosing missing contours. Preserve its pose, scale, proportions and level of detail. Add the smallest coherent set of missing structural contours that makes that same drawing look complete; do not add a new scene, decorative background, labels or unrelated details. Existing lines are fixed anchors, not approximate references: start or end each connecting stroke on the actual open endpoint, continue its local tangent smoothly, and avoid crossing or tracing existing ink. Distinguish open structural contours from intentional interior lines. For curves use smooth with a compact sequence of well-spaced points following the contour, not a chain of straight zigzags; for straight edges use line. Match the existing stroke width. Use one common global integer origin and relative integer point coordinates. Privately check the completed silhouette, joints, relative sizes and accidental overlaps before returning. Keep at most 48 items. If the subject is unclear, prefer a small plausible continuation rather than inventing a detailed subject. Return only the missing strokes; never redraw or move the user's ink.`;
const structure = `Finish the intended object in place using one native draw command. Make one brief plan: identify the subject and pose, identify all missing structural parts, then choose their anchors. Treat existing ink as fixed geometry. Preserve the existing composition, proportions and level of detail. Complete the object's main silhouette and missing repeated parts, not just the nearest local gap. For a radial or repeated pattern, compare the existing parts around their shared center or axis and fill the clearly missing sectors with matching size, orientation and spacing. Do not extend an already complete stem, mast or handle as a substitute for completing missing petals, hull or base. Add only necessary structural ink; omit decorative background, labels, accessories and new subjects. Start and end connecting strokes at the exact existing open endpoints and follow their local tangent smoothly. Use the supplied source stroke width exactly. For a rounded contour use smooth with about 5–10 well-spaced on-curve points over its whole span, concentrating points only at real curvature changes; avoid a sparse three-point V-shaped curve or an oversized sag. Prefer ellipse or arc for a genuinely elliptical repeated part; use line for straight edges. Keep one common global integer origin and integer relative coordinates. Before emitting, mentally combine old and new ink and check that the whole object is complete, repeated parts are balanced, joints connect, proportions fit and no existing ink is traced. Do this check once; revisit the plan only for a specific geometry error. Return only the missing marks, at most 48 items, without moving, erasing or redrawing existing strokes. Native closed, fill and arrows are arrays of item indices, never booleans; omit unused optional fields.`;
const variants = { baseline:{prompt:baseline}, contour:{prompt:contour}, vectors:{prompt:contour,vectorContext:true}, structure:{prompt:structure,vectorContext:true}, integrated:{prompt:FINISH_DRAWING.canvasPrompt,globalContext:true} };
const width = 640, height = 480, origin = [8000,5000], ink = '#263443', strokeWidth = 6;
const line = (...points) => ({ points:points.map(([x,y])=>({x,y})), width:strokeWidth, color:ink });
const curve = (points, count=24) => {
  const [a,b,c,d]=points, out=[];
  for(let i=0;i<=count;i++){const t=i/count,u=1-t;out.push([Math.round(u*u*u*a[0]+3*u*u*t*b[0]+3*u*t*t*c[0]+t*t*t*d[0]),Math.round(u*u*u*a[1]+3*u*u*t*b[1]+3*u*t*t*c[1]+t*t*t*d[1])]);}
  return line(...out);
};
const ellipse=(cx,cy,rx,ry,start=0,sweep=360)=>line(...Array.from({length:33},(_,i)=>{const t=(start+sweep*i/32)*Math.PI/180;return[Math.round(cx+rx*Math.cos(t)),Math.round(cy+ry*Math.sin(t))];}));
const fixtures = [
  { id:'cat', title:'Cat: open jaw contour', strokes:[line([202,248],[190,159],[231,188]),curve([[231,188],[278,153],[353,153],[405,188]]),line([405,188],[445,154],[431,247]),ellipse(267,237,7,10),ellipse(366,237,7,10),line([309,266],[324,266],[317,275],[309,266]),line([317,275],[317,290]),curve([[317,290],[305,301],[292,300],[290,292]]),curve([[317,290],[330,301],[343,300],[346,292]])], expected:'Complete the lower head outline between (202,248) and (431,247). Keep the existing face; avoid an invented body or scene.', anchors:[[202,248],[431,247]] },
  { id:'sailboat', title:'Sailboat: missing hull', strokes:[line([310,114],[310,326]),line([299,140],[199,298],[299,298],[299,140]),line([322,158],[409,298],[322,298],[322,158]),curve([[146,372],[183,353],[216,387],[249,371]]),curve([[265,372],[302,353],[335,387],[368,371]]),curve([[384,372],[421,353],[454,387],[487,371]])], expected:'Add a hull beneath the two sails and mast, centered around x=310, ending above the existing waves. Preserve both sails.', anchors:[[310,326]] },
  { id:'mug', title:'Mug: open base and handle', strokes:[ellipse(280,177,85,23),curve([[195,177],[196,228],[198,282],[213,315]]),curve([[365,177],[365,224],[365,278],[350,315]]),curve([[365,220],[440,208],[447,297],[365,292]])], expected:'Join the open base endpoints (213,315) and (350,315), and make a coherent handle without retracing the outer handle or rim.', anchors:[[213,315],[350,315],[365,220],[365,292]] },
  { id:'flower', title:'Flower: incomplete radial pattern', strokes:[ellipse(316,221,26,26),ellipse(316,154,28,41),ellipse(380,211,40,28),ellipse(354,279,29,39),line([316,306],[313,393]),curve([[313,353],[274,315],[252,338],[313,373]])], expected:'Continue the visible radial flower pattern with missing petals to the left/lower-left. Keep the stem and leaf; preserve center and petal scale.', anchors:[], center:[316,221] },
];
const esc = text => String(text).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const strokeSvg = (strokes,color=ink) => strokes.map(s=>`<polyline points="${s.points.map(p=>`${p.x},${p.y}`).join(' ')}" stroke="${color}" stroke-width="${s.width}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
const sourceSvg = f => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="white"/>${strokeSvg(f.strokes)}</svg>`;
await mkdir(directory,{recursive:true});
for(const f of fixtures){f.image=(await sharp(Buffer.from(sourceSvg(f))).png().toBuffer()).toString('base64');await writeFile(join(directory,`${f.id}-source.png`),Buffer.from(f.image,'base64'));}
const selectedModels = option('models','luna,glm').split(','), selectedVariants=option('variants','baseline,contour,vectors').split(','), selectedCases=option('cases',fixtures.map(f=>f.id).join(',')).split(',');
const modelIds={luna:'4a6dcc5b-e770-4f7d-9b45-b0ac82ead3e9',glm:'db6e5128-0ec7-4a2a-a9bd-6b20c49c322b',vision:'e882d84a-5490-4d37-90dd-a143fd8431a0'};
const jobs=[];
for(const model of selectedModels)for(let i=0;i<selectedCases.length;i++)for(let j=0;j<selectedVariants.length;j++){
  const variant=selectedVariants[(i+j)%selectedVariants.length],f=fixtures.find(f=>f.id===selectedCases[i]);
  if(!f||!variants[variant]||!modelIds[model])throw Error('Unknown experiment selection');
  const input={trigger:'manual',userAction:'continue',actionMeaning:'continue the newest user content. Suggestion chosen by the user: '+variants[variant].prompt,languagePolicy:'follow the newest substantive user content',canvasSize:{w:20000,h:20000},visibleRect:{x:origin[0],y:origin[1],w:width,h:height},captureRect:{x:origin[0],y:origin[1],w:width,h:height},sourceRect:{x:origin[0],y:origin[1],w:width,h:height},imageSize:{w:width,h:height},imageScale:1,latestInput:{imageRect:{x:0,y:0,w:width,h:height},globalRect:{x:origin[0],y:origin[1],w:width,h:height}},typedInput:null,selectionContext:null,focusInset:null,hotspotGrid:{columns:8,rows:8,order:'oldest-to-newest',hotspots:[]},enabledPlugins:[{id:'general',document:await readFile(join(root,'public/plugins/general/plugin.md'),'utf8')}],note:'The image is the fixed source drawing. The newest user action is Finish drawing. Global canvas coordinates map to image pixels by subtracting sourceRect.x and sourceRect.y.'};
  if(variants[variant].vectorContext)input.sourceInk={coordinateSpace:'image pixels, translate by sourceRect.x/y for global coordinates',strokeWidth,strokes:f.strokes.map(s=>({points:s.points.map(p=>[p.x,p.y])})),instruction:'These are the existing ink strokes. Use their geometry as fixed anchors; never copy them into output.'};
  if(variants[variant].globalContext)input.sourceInk=FINISH_DRAWING.sourceInk(f.strokes.map(s=>({size:s.width,points:s.points.map(p=>({x:p.x+origin[0],y:p.y+origin[1]}))})),input.sourceRect);
  jobs.push({id:`${model}-${f.id}-${variant}`,model,case:f.id,variant,system,input,image:f.image});
}
if(!process.argv.includes('--render-only')){
  await writeFile(join(directory,'manifest.json'),JSON.stringify({createdAt:new Date().toISOString(),purpose:'Controlled Canvas AI native-drawing stage comparison; no full Agent execution',sourceSha256:createHash('sha256').update(source).digest('hex'),models:modelIds,variants,controls:{effort:'high',maxTokens:10000,concurrencyPerModel:1},jobs:jobs.map(({id,model,case:caseId,variant})=>({id,model,case:caseId,variant})),fixtures:fixtures.map(({image,...f})=>f)},null,2)+'\n');
  await writeFile(join(directory,'prompts.json'),JSON.stringify({system,variants},null,2)+'\n');
}
if(process.argv.includes('--prepare-only')){console.log(JSON.stringify({prepared:jobs.length,directory}));process.exit(0);}
if(process.argv.includes('--render-only')){
  const rows=(await readFile(join(directory,'events.jsonl'),'utf8')).split('\n').filter(Boolean).map(s=>JSON.parse(s)).filter(r=>r.type==='sample');
  for(const row of rows){if(!row.error)await render(row);await writeFile(join(directory,row.id+'.json'),JSON.stringify(row,null,2)+'\n');}
  await writeFile(join(directory,'results.json'),JSON.stringify({renderedAt:new Date().toISOString(),samples:rows},null,2)+'\n');
  console.log(JSON.stringify({rendered:rows.length,directory}));process.exit(0);
}

async function inside(payload){
  process.title='penecho-finish-drawing-benchmark';
  const {loadConfig}=await import('/app/src/config.mjs'),{createDatabasePool}=await import('/app/src/db/pool.mjs');
  const {createProviderSecretCipher}=await import('/app/src/services/provider-crypto.mjs'),{PostgresProviderStore}=await import('/app/src/services/provider-store-postgres.mjs');
  const {ProviderHttpClient}=await import('/app/src/services/provider-http.mjs'),{ProviderExecutor}=await import('/app/src/services/provider-executor.mjs');
  const {randomUUID}=await import('node:crypto');
  const config=loadConfig();if(config.production||config.appOrigin!=='https://internaltest.penecho.ai')throw Error('UAT only');
  const pool=createDatabasePool(config),cipher=createProviderSecretCipher(config),store=new PostgresProviderStore({config,pool,cipher});
  const client=new ProviderHttpClient({allowedPorts:config.providerAllowedPorts,maxResponseBytes:config.hostedMaxResponseBytes}),executor=new ProviderExecutor({client,timeoutMs:180000});
  try{
    for(const key of Object.keys(payload.modelIds)){
      if(!payload.jobs.some(j=>j.model===key))continue;
      const {rows}=await pool.query('SELECT id,model_id,upstream_model,endpoint_url,protocol,thinking FROM provider_endpoints WHERE model_id=$1 AND enabled AND retired_at IS NULL AND protocol IN (\'openai-compatible\',\'anthropic-compatible\') ORDER BY priority,id LIMIT 1',[payload.modelIds[key]]);
      if(!rows[0])throw Error('UAT provider unavailable: '+key);
      payload.providers??={};const p=rows[0];payload.providers[key]={provider:{id:p.id,modelId:p.model_id,upstreamModel:p.upstream_model,endpointUrl:p.endpoint_url,protocol:p.protocol,thinking:p.thinking},secret:await store.providerSecret(p.id)};
      console.log(JSON.stringify({type:'model',key,upstreamModel:p.upstream_model,protocol:p.protocol}));
    }
    await Promise.all(Object.keys(payload.providers).map(async key=>{
      const {provider,secret}=payload.providers[key],apiFormat=provider.protocol==='anthropic-compatible'?'anthropic':'openai';
      for(const job of payload.jobs.filter(j=>j.model===key)){
        console.log(JSON.stringify({type:'start',id:job.id}));
        const started=performance.now(),text=JSON.stringify(job.input),image=job.image;
        const content=apiFormat==='openai'?[{type:'text',text},{type:'image_url',image_url:{url:'data:image/png;base64,'+image,detail:'high'}}]:[{type:'text',text},{type:'image',source:{type:'base64',media_type:'image/png',data:image}}];
        const request=apiFormat==='openai'?{model:provider.upstreamModel,messages:[{role:'system',content:job.system},{role:'user',content}],max_tokens:10000,reasoning_effort:'high',response_format:{type:'json_object'}}:{model:provider.upstreamModel,system:job.system,messages:[{role:'user',content}],max_tokens:10000,thinking:{type:'adaptive'},output_config:{effort:'high'}};
        const controller=new AbortController(),timer=setTimeout(()=>controller.abort(Error('experiment timeout')),240000);
        try{
          const result=await executor.executeChat({provider,secret,request,requestId:randomUUID(),apiFormat,directCanvas:true,signal:controller.signal});
          const output=apiFormat==='openai'?result.response.choices[0].message.content:result.response.content.filter(b=>b.type==='text').map(b=>b.text).join('\n');
          console.log(JSON.stringify({type:'sample',id:job.id,model:key,case:job.case,variant:job.variant,ms:Math.round(performance.now()-started),usage:result.usage,output}));
        }catch(e){console.log(JSON.stringify({type:'sample',id:job.id,model:key,case:job.case,variant:job.variant,ms:Math.round(performance.now()-started),error:{code:e.code||e.name,message:String(e.message).replaceAll(secret,'[redacted]').slice(0,400)}}));if(e.code==='provider_request_failed')break;}
        finally{clearTimeout(timer);}
      }
    }));
  }finally{client.close();cipher.close();await pool.end();}
}
function primitiveSvg(p,color){
  if(['line','smooth'].includes(p.type)){
    const points=p.points.map(q=>({x:q.x-origin[0],y:q.y-origin[1]}));
    const d=p.segments?.length?`M${points[0].x},${points[0].y} `+p.segments.map(s=>`C${s.c1.x-origin[0]},${s.c1.y-origin[1]} ${s.c2.x-origin[0]},${s.c2.y-origin[1]} ${s.to.x-origin[0]},${s.to.y-origin[1]}`).join(' '):`M${points.map(q=>`${q.x},${q.y}`).join(' L')}`;
    return `<path d="${d}${p.closed?' Z':''}" fill="${p.fill?color:'none'}" stroke="${color}" stroke-width="${p.width||6}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  if(p.type==='ellipse'||p.type==='circle')return `<ellipse cx="${p.cx-origin[0]}" cy="${p.cy-origin[1]}" rx="${p.rx}" ry="${p.ry}" fill="${p.fill?color:'none'}" stroke="${color}" stroke-width="${p.width}"/>`;
  if(p.type==='rect')return `<rect x="${p.x-origin[0]}" y="${p.y-origin[1]}" width="${p.w}" height="${p.h}" fill="${p.fill?color:'none'}" stroke="${color}" stroke-width="${p.width}"/>`;
  if(p.type==='arc'){
    const point=t=>[p.cx-origin[0]+p.rx*Math.cos(t),p.cy-origin[1]+p.ry*Math.sin(t)],a=point(p.start),b=point(p.start+p.sweep),direction=p.sweep>0?1:0;
    const path=Math.abs(p.sweep)>=2*Math.PI?`M${a} A${p.rx},${p.ry} 0 1,${direction} ${point(p.start+p.sweep/2)} A${p.rx},${p.ry} 0 1,${direction} ${a}`:`M${a} A${p.rx},${p.ry} 0 ${Math.abs(p.sweep)>Math.PI?1:0},${direction} ${b}`;
    return `<path d="${path}${p.closed?' Z':''}" fill="${p.fill?color:'none'}" stroke="${color}" stroke-width="${p.width}" stroke-linecap="round"/>`;
  }
  throw Error('Unsupported normalized primitive '+p.type);
}
async function render(row){
  const f=fixtures.find(f=>f.id===row.case);if(!f)return;
  let result;try{result=JSON.parse(row.output.replace(/^```(?:json)?\s*|\s*```$/g,''));}catch{row.invalid='Invalid final JSON';return;}
  row.result=result;row.draws=[];
  for(const c of result.commands||[]){if(c.tool!=='draw'){row.invalid='Unexpected output tool: '+c.tool;continue;}const n=DRAW.normalize(c);if(!n){row.invalid='Native draw validation failed';continue;}for(const p of n._draw.primitives)p.width=n.width;row.draws.push(n);}
  if(!row.draws.length){row.invalid??='No native drawing';return;}
  for(const [kind,color] of [['result',ink],['overlay','#008f85']]){
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="white"/>${strokeSvg(f.strokes)}${row.draws.flatMap(n=>n._draw.primitives.map(p=>primitiveSvg(p,color))).join('')}</svg>`;
    await writeFile(join(directory,`${row.id}-${kind}.png`),await sharp(Buffer.from(svg)).png().toBuffer());
  }
  row.primitiveCount=row.draws.reduce((n,d)=>n+d._draw.primitives.length,0);
  row.numericValues=(result.commands||[]).reduce((n,c)=>n+(c.items||[]).flat().length,0);
  row.widths=row.draws.map(d=>d.width);
  const allPoints=row.draws.flatMap(d=>d._draw.primitives.flatMap(p=>p.points||[]));
  row.anchorDistances=f.anchors.map(([x,y])=>({anchor:[x,y],distance:allPoints.length?Math.round(Math.min(...allPoints.map(p=>Math.hypot(p.x-origin[0]-x,p.y-origin[1]-y)))*10)/10:null}));
}
const rows=[];
const child=spawn('docker',['exec','-i','penecho-uat-local-app-1','node','--input-type=module','-'],{cwd:root,stdio:['pipe','pipe','inherit']});
child.stdin.end(`(${inside.toString()})(${JSON.stringify({jobs,modelIds})}).catch(e=>{console.error(JSON.stringify({fatal:e.code||e.name,message:e.message}));process.exitCode=1;});`);
let pending='',writes=Promise.resolve();
child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{pending+=chunk;let end;while((end=pending.indexOf('\n'))>=0){const line=pending.slice(0,end);pending=pending.slice(end+1);if(!line.trim())continue;let v;try{v=JSON.parse(line);}catch{continue;}writes=writes.then(()=>appendFile(join(directory,'events.jsonl'),JSON.stringify(v)+'\n'));if(v.type==='sample'){rows.push(v);writes=writes.then(async()=>{if(!v.error)await render(v);await writeFile(join(directory,v.id+'.json'),JSON.stringify(v,null,2)+'\n');});}console.log(JSON.stringify(v.type==='sample'?{id:v.id,ms:v.ms,usage:v.usage,error:v.error}:v));}});
const exitCode=await new Promise((done,reject)=>{child.on('error',reject);child.on('close',done);});await writes;
await writeFile(join(directory,'results.json'),JSON.stringify({checkedAt:new Date().toISOString(),planned:jobs.length,exitCode,samples:rows},null,2)+'\n');
console.log(JSON.stringify({finished:true,planned:jobs.length,completed:rows.length,invalid:rows.filter(r=>r.invalid||r.error).length,directory}));
if(exitCode||rows.length!==jobs.length)process.exitCode=1;
