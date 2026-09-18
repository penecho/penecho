import ELK from 'elkjs/lib/elk-api.js';
import { styles, renderContent } from './render.mjs';
import { FONT, layoutArchitecture } from './layout.mjs';
import { bindInteractions } from './interactions.mjs';
const workerCode=globalThis.__penechoArchitectureWorkerCode;
delete globalThis.__penechoArchitectureWorkerCode;
const style=document.createElement('style');style.textContent=styles;document.head.append(style);
const roots=[...document.querySelectorAll('[data-penecho-architecture]')].filter(root=>root.querySelector('script[data-architecture-source]'));
const jobs=new Set();
const textContext=document.createElement('canvas').getContext('2d');
const measure=(text,size)=>{textContext.font=`${size===16?'600 ':''}${size}px ${FONT}`;return textContext.measureText(text).width;};
addEventListener('pagehide',()=>{for(const job of jobs)job.cancel();},{once:true});

async function mount(root,index) {
  const start=performance.now(), source=root.querySelector('script[data-architecture-source]');
  let worker, blobUrl, timer, job;
  try {
    const data=JSON.parse(source.textContent);
    if(typeof workerCode!=='string')throw new Error('本地布局模块加载失败');
    blobUrl=URL.createObjectURL(new Blob([workerCode],{type:'text/javascript'}));
    worker=new Worker(blobUrl);
    const elk=new ELK({workerFactory:()=>worker,algorithms:['layered']});
    const layout=await new Promise((resolve,reject)=>{
      const fail=message=>reject(new Error(message));
      job={cancel:()=>{worker.terminate();fail('页面已关闭');}};jobs.add(job);
      timer=setTimeout(()=>{worker.terminate();fail('布局超时，请减少当前视图中的实体和关系');},12000);
      worker.onerror=event=>fail(event.message || '本地布局模块加载失败');
      layoutArchitecture(data,elk,measure).then(resolve,reject);
    });
    if(layout.issues.length)throw new Error(layout.issues.slice(0,4).join('; '));
    root.querySelectorAll(':scope > :not(script[data-architecture-source])').forEach(n=>n.remove());
    root.insertAdjacentHTML('beforeend',renderContent(layout,`arch-${index}`));
    // Do not turn a wide topology into unreadably small type. Narrow widgets scroll the map.
    root.style.setProperty('--pa-map-min',`${Math.round(layout.width*.8)}px`);
    root.dataset.architectureReady='true';root.dataset.layoutMs=String(Math.round(layout.layoutMs));root.dataset.renderMs=String(Math.round(performance.now()-start));
    bindInteractions(root,data);
  } catch(error) {
    const message=document.createElement('p');message.role='alert';message.textContent=`架构图未能完成：${error.message}`;
    root.append(message);root.dataset.architectureError='true';
  } finally {clearTimeout(timer);worker?.terminate();if(blobUrl)URL.revokeObjectURL(blobUrl);if(job)jobs.delete(job);}
}
// Sequential jobs bound peak worker memory when a mixed document contains several diagrams.
(async()=>{for(const [i,root] of roots.entries())await mount(root,i);dispatchEvent(new Event('penecho-architecture-ready'));})();
