import ELK from 'elkjs/lib/elk-api.js';
import { styles, renderContent, renderSvg } from './render.mjs';
import { FONT, MIN_MAP_SCALE, layoutArchitecture } from './layout.mjs';
import { bindInteractions } from './interactions.mjs';
import { createReflow, serialLayouts } from './reflow.mjs';
const workerCode = globalThis.__penechoArchitectureWorkerCode;
delete globalThis.__penechoArchitectureWorkerCode;
const style = document.createElement('style'); style.textContent = styles; document.head.append(style);
const roots = [...document.querySelectorAll('[data-penecho-architecture]')].filter(root => root.querySelector('script[data-architecture-source]'));
const enqueue = serialLayouts(), states = new Map();
const textContext = document.createElement('canvas').getContext('2d');
const measure = (text,size) => { textContext.font = `${size === 16 || size === 14 ? '600 ' : ''}${size}px ${FONT}`; return textContext.measureText(text).width; };
const contentWidth = root => {
  const css = getComputedStyle(root);
  return root.clientWidth - parseFloat(css.paddingLeft || 0) - parseFloat(css.paddingRight || 0);
};

async function compute(data, width, signal) {
  let worker, blobUrl, timer, abort;
  try {
    if (typeof workerCode !== 'string') throw new Error('本地布局模块加载失败');
    blobUrl = URL.createObjectURL(new Blob([workerCode],{type:'text/javascript'}));
    worker = new Worker(blobUrl);
    const elk = new ELK({workerFactory:() => worker, algorithms:['layered']});
    const layout = await new Promise((resolve,reject) => {
      const fail = message => reject(new Error(message));
      abort = () => { worker.terminate(); fail('布局已取消'); };
      signal.addEventListener('abort',abort,{once:true});
      if (signal.aborted) { abort(); return; }
      timer = setTimeout(() => { worker.terminate(); fail('布局超时，请减少当前视图中的实体和关系'); },12000);
      worker.onerror = event => fail(event.message || '本地布局模块加载失败');
      layoutArchitecture(data,elk,measure,{width}).then(resolve,reject);
    });
    if (layout.issues.length) throw new Error(layout.issues.slice(0,4).join('; '));
    return layout;
  } finally {
    clearTimeout(timer); signal.removeEventListener('abort',abort);
    worker?.terminate(); if (blobUrl) URL.revokeObjectURL(blobUrl);
  }
}

function mount(root,index) {
  const source = root.querySelector('script[data-architecture-source]');
  let data, interactions, startedAt;
  function report(error) {
    const message = root.querySelector('.pa-status') || document.createElement('p');
    message.className = 'pa-status'; message.role = 'alert';
    message.textContent = `架构图未能完成：${error.message}`;
    if (!message.isConnected) root.append(message);
    root.dataset.architectureError = 'true';
  }
  try { data = JSON.parse(source.textContent); } catch(error) { report(error); return; }
  const controller = createReflow({
    enqueue,
    compute:(width,signal) => { startedAt = performance.now(); return compute(data,width,signal); },
    commit(layout,width,{cached}) {
      if (cached) startedAt = performance.now();
      const map = root.querySelector('.pa-map'), focusedId = document.activeElement?.dataset.nodeId;
      if (!map) {
        root.querySelectorAll(':scope > :not(script[data-architecture-source])').forEach(n => n.remove());
        root.insertAdjacentHTML('beforeend',renderContent(layout,`arch-${index}`));
        interactions = bindInteractions(root,data);
      } else {
        map.innerHTML = renderSvg(layout,`arch-${index}`);
        map.scrollLeft = 0;
        if (focusedId) root.querySelector(`[data-node-id="${focusedId}"]`)?.focus({preventScroll:true});
      }
      root.style.setProperty('--pa-map-min',`${Math.ceil(layout.width * MIN_MAP_SCALE)}px`);
      root.style.setProperty('--pa-map-width',`${Math.ceil(layout.width)}px`);
      interactions.refresh();
      root.querySelector('.pa-status').textContent = '';
      delete root.dataset.architectureError;
      Object.assign(root.dataset, {architectureReady:'true', layoutMode:layout.mode, layoutWidth:String(width),
        layoutMs:String(Math.round(layout.layoutMs)), renderMs:String(Math.round(performance.now()-(startedAt || performance.now()))),
        layoutCount:String(Number(root.dataset.layoutCount || 0)+1)});
    },
    report,
  });
  states.set(root,controller);
  controller.request(contentWidth(root),true);
}

roots.forEach(mount);
const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(entries => {
  for (const entry of entries) states.get(entry.target)?.request(entry.contentRect.width);
}) : null;
for (const root of states.keys()) observer?.observe(root);
const resize = () => { for (const [root,controller] of states) controller.request(contentWidth(root)); };
if (!observer) addEventListener('resize',resize);
// Captures and SVG/PNG exports wait for the current width, including pending debounce.
globalThis.__penechoArchitectureWhenSettled = async () => {
  resize(); await Promise.all([...states.values()].map(controller => controller.whenSettled()));
};
void globalThis.__penechoArchitectureWhenSettled().then(() => dispatchEvent(new Event('penecho-architecture-ready')));
addEventListener('pagehide',() => {
  observer?.disconnect(); removeEventListener('resize',resize);
  for (const controller of states.values()) controller.dispose(); states.clear();
  delete globalThis.__penechoArchitectureWhenSettled;
},{once:true});
