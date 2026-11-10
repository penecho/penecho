"use strict";
// Reproducible local geometry/raster benchmark. The baseline module can be
// supplied explicitly; otherwise it is read from the current Git HEAD.
const fs=require('node:fs'),{Module}=require('node:module'),{execFileSync}=require('node:child_process'),{performance}=require('node:perf_hooks'),path=require('node:path');
const root=path.resolve(__dirname,'..'),PEN=require('../public/pen-intel.js'),baseline=new Module(path.join(root,'public/pen-intel-baseline.js'));
baseline._compile(execFileSync('git',['show','HEAD:public/pen-intel.js'],{cwd:root,encoding:'utf8'}),baseline.id);
const OLD=baseline.exports,points=Array.from({length:2000},(_,i)=>({x:30+100*i/1999,y:60})),word=[{x:50,y:30},{x:50,y:90},{x:65,y:30},{x:80,y:90},{x:95,y:30},{x:110,y:90}],
 strokes=Array.from({length:64},(_,id)=>{const p=word.map(p=>({x:p.x+(id%8)*180,y:p.y+Math.floor(id/8)*100}));return{id,points:p,box:PEN.bounds(p),at:0};}),options={size:4,now:2000,strokes},
 ordinary=Array.from({length:2000},(_,i)=>({x:60+10*Math.cos(i/1999*Math.PI*2),y:60+20*Math.sin(i/1999*Math.PI*2)}));
function measure(fn,n=300){for(let i=0;i<30;i++)fn();const durations=[];for(let i=0;i<n;i++){const t=performance.now();fn();durations.push(performance.now()-t);}durations.sort((a,b)=>a-b);return{medianMs:+durations[Math.floor(n*.5)].toFixed(4),p95Ms:+durations[Math.floor(n*.95)].toFixed(4),maxMs:+durations.at(-1).toFixed(4),samples:n};}
const data=new Uint8ClampedArray(256*128*4);for(let y=30;y<90;y++)for(const x of [50,51,52,80,81,82,110,111,112])data[(y*256+x)*4+3]=255;
const dense=new Uint8ClampedArray(data.length).fill(255),region={x:0,y:0,w:256,h:128},mark=[{x:30,y:60},{x:130,y:60}],scribble=Array.from({length:31},(_,i)=>({x:30+(i%2)*100,y:45+i}));
const report={runtime:process.version,platform:process.platform,arch:process.arch,note:'Synthetic warm CPU timings on this machine; raster readback/scheduling measured separately in Electron. Baseline and current run in the same V8 context.',
 ordinaryShapeGate:measure(()=>PEN.deletionMarkShape(ordinary,4)),
 baselineDenseStrike:measure(()=>OLD.classifyGestureStroke(points,options)),currentDenseStrike:measure(()=>PEN.classifyGestureStroke(points,options)),
 rasterWord:measure(()=>PEN.rasterDeletionTarget(data,256,128,region,mark,4)),rasterDenseWorstCase:measure(()=>PEN.rasterDeletionTarget(dense,256,128,region,scribble,4))};
const output=process.argv.find(x=>x.startsWith('--output='))?.slice(9);if(output){fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');}console.log(JSON.stringify(report,null,2));
