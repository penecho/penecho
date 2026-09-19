import ELK from 'elkjs/lib/elk-api.js';
import { styles, renderContent, renderSvg } from './render.mjs';
import {applyPanelCopy} from '../architecture/render.mjs';
import { FONT } from '../diagrams/text.mjs';
import { layoutWorkflow } from './layout.mjs';
import { bindInteractions } from './interactions.mjs';
import { createReflow, serialLayouts } from '../architecture/reflow.mjs';
import {currentDiagramLanguage,diagramCopy,diagramError,diagramErrorMessage,normalizeDiagramLanguage} from '../architecture/i18n.mjs';
const workerCode = globalThis.__penechoWorkflowWorkerCode;
delete globalThis.__penechoWorkflowWorkerCode;
const style = document.createElement('style'); style.textContent = styles; document.head.append(style);
const roots = [...document.querySelectorAll('[data-penecho-workflow]')].filter(root => root.querySelector('script[data-workflow-source]'));
const enqueue = serialLayouts(), states = new Map(), languageRefreshers=new Set();
let language=currentDiagramLanguage();
const copyFor=()=>diagramCopy(language);
const textContext = document.createElement('canvas').getContext('2d');
const measure = (text,size) => { textContext.font = `${size === 16 || size === 14 ? '600 ' : ''}${size}px ${FONT}`; return textContext.measureText(text).width; };
const contentWidth = root => {
  const css = getComputedStyle(root);
  return root.clientWidth - parseFloat(css.paddingLeft || 0) - parseFloat(css.paddingRight || 0);
};

async function compute(data, width, signal) {
  let worker, blobUrl, timer, abort;
  try {
    if (typeof workerCode !== 'string') throw diagramError('layoutModuleLoadFailed');
    blobUrl = URL.createObjectURL(new Blob([workerCode],{type:'text/javascript'}));
    worker = new Worker(blobUrl);
    const elk = new ELK({workerFactory:() => worker, algorithms:['layered']});
    const layout = await new Promise((resolve,reject) => {
      const fail = message => reject(new Error(message));
      abort = () => { worker.terminate(); reject(diagramError('layoutCancelled')); };
      signal.addEventListener('abort',abort,{once:true});
      if (signal.aborted) { abort(); return; }
      timer = setTimeout(() => { worker.terminate(); reject(diagramError('layoutTimeout')); },12000);
      worker.onerror = event => event.message ? fail(event.message) : reject(diagramError('layoutModuleLoadFailed'));
      layoutWorkflow(data,elk,measure,{width}).then(resolve,reject);
    });
    if (layout.issues.length) throw diagramError('layoutIssues',{issues:layout.issues.slice(0,4)});
    return layout;
  } finally {
    clearTimeout(timer); signal.removeEventListener('abort',abort);
    worker?.terminate(); if (blobUrl) URL.revokeObjectURL(blobUrl);
  }
}

function mount(root,index) {
  const source = root.querySelector('script[data-workflow-source]');
  let data, interactions, startedAt, lastError=null;
  function report(error) {
    lastError=error;
    const message = root.querySelector('.pa-status') || document.createElement('p');
    message.className = 'pa-status'; message.role = 'alert';
    const copy=copyFor();
    message.textContent = copy.failedMessage(copy.failed.workflow,diagramErrorMessage(error,copy));
    if (!message.isConnected) root.append(message);
    root.dataset.workflowError = 'true';
  }
  try { data = JSON.parse(source.textContent); } catch(error) { report(error); return; }
  const controller = createReflow({
    enqueue,
    compute:(width,signal) => { startedAt = performance.now(); return compute(data,width,signal); },
    commit(layout,width,{cached}) {
      if (cached) startedAt = performance.now();
      const map = root.querySelector('.pa-map'), focusedId = document.activeElement?.dataset.nodeId;
      if (!map) {
        root.querySelectorAll(':scope > :not(script[data-workflow-source])').forEach(n => n.remove());
        root.insertAdjacentHTML('beforeend',renderContent(layout,`flow-${index}`,copyFor()));
        interactions = bindInteractions(root,data,copyFor);
      } else {
        map.innerHTML = renderSvg(layout,`flow-${index}`);
        map.scrollLeft = 0;
        if (focusedId) root.querySelector(`[data-node-id="${focusedId}"]`)?.focus({preventScroll:true});
      }
      root.style.setProperty('--pa-map-min',`${Math.ceil(layout.width)}px`);
      root.style.setProperty('--pa-map-width',`${Math.ceil(layout.width)}px`);
      interactions.refresh();
      root.querySelector('.pa-status').textContent = '';
      lastError=null;
      delete root.dataset.workflowError;
      Object.assign(root.dataset, {workflowReady:'true', layoutMode:layout.mode, layoutWidth:String(width),
        layoutMs:String(Math.round(layout.layoutMs)), renderMs:String(Math.round(performance.now()-(startedAt || performance.now()))),
        layoutCount:String(Number(root.dataset.layoutCount || 0)+1)});
    },
    report,
  });
  states.set(root,controller);
  languageRefreshers.add(()=>{applyPanelCopy(root,copyFor());interactions?.refreshCopy();if(lastError)report(lastError);});
  controller.request(contentWidth(root),true);
}

roots.forEach(mount);
const refreshLanguage=event=>{language=normalizeDiagramLanguage(event.detail?.language);globalThis.__penechoDiagramLanguage=language;for(const refresh of languageRefreshers)refresh();};
addEventListener('penecho-diagram-languagechange',refreshLanguage);
const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(entries => {
  for (const entry of entries) states.get(entry.target)?.request(entry.contentRect.width);
}) : null;
for (const root of states.keys()) observer?.observe(root);
const resize = () => { for (const [root,controller] of states) controller.request(contentWidth(root)); };
if (!observer) addEventListener('resize',resize);
// Captures and SVG/PNG exports wait for the current width, including pending debounce.
globalThis.__penechoWorkflowWhenSettled = async () => {
  resize(); await Promise.all([...states.values()].map(controller => controller.whenSettled()));
};
void globalThis.__penechoWorkflowWhenSettled().then(() => dispatchEvent(new Event('penecho-workflow-ready')));
addEventListener('pagehide',() => {
  removeEventListener('penecho-diagram-languagechange',refreshLanguage);
  observer?.disconnect(); removeEventListener('resize',resize);
  for (const controller of states.values()) controller.dispose(); states.clear();
  delete globalThis.__penechoWorkflowWhenSettled;
},{once:true});
