import { styles, renderContent, renderSvg } from './render.mjs';
import {applyPanelCopy} from '../architecture/render.mjs';
import { FONT } from '../diagrams/text.mjs';
import { layoutSequence } from './layout.mjs';
import { bindInteractions } from '../architecture/interactions.mjs';
import { createReflow, serialLayouts } from '../architecture/reflow.mjs';
import {currentDiagramLanguage,diagramCopy,diagramErrorMessage,normalizeDiagramLanguage} from '../architecture/i18n.mjs';
const style = document.createElement('style'); style.textContent = styles; document.head.append(style);
const roots = [...document.querySelectorAll('[data-penecho-sequence]')].filter(root => root.querySelector('script[data-sequence-source]'));
const enqueue = serialLayouts(), states = new Map(), languageRefreshers=new Set();
let language=currentDiagramLanguage();
const copyFor=()=>diagramCopy(language);
const textContext = document.createElement('canvas').getContext('2d');
const measure = (text,size) => { textContext.font = `${size === 15 || size === 13 ? '600 ' : ''}${size}px ${FONT}`; return textContext.measureText(text).width; };
const contentWidth = root => {
  const css = getComputedStyle(root);
  return root.clientWidth - parseFloat(css.paddingLeft || 0) - parseFloat(css.paddingRight || 0);
};

function mount(root,index) {
  const source = root.querySelector('script[data-sequence-source]');
  let data, interactions, startedAt, lastError=null;
  function report(error) {
    lastError=error;
    const message = root.querySelector('.pa-status') || document.createElement('p');
    message.className = 'pa-status'; message.role = 'alert';
    const copy=copyFor();
    message.textContent = copy.failedMessage(copy.failed.sequence,diagramErrorMessage(error,copy));
    if (!message.isConnected) root.append(message);
    root.dataset.sequenceError = 'true';
  }
  try { data = JSON.parse(source.textContent); } catch(error) { report(error); return; }
  const controller = createReflow({
    enqueue,
    compute:width => { startedAt = performance.now(); return layoutSequence(data,measure,{width}); },
    commit(layout,width,{cached}) {
      if (cached) startedAt = performance.now();
      const map = root.querySelector('.pa-map'), focusedNode = document.activeElement?.dataset.nodeId, focusedMessage = document.activeElement?.dataset.messageId;
      if (!map) {
        root.querySelectorAll(':scope > :not(script[data-sequence-source])').forEach(n => n.remove());
        root.insertAdjacentHTML('beforeend',renderContent(layout,`seq-${index}`,copyFor()));
        interactions = bindInteractions(root,data,copyFor);
      } else {
        map.innerHTML = renderSvg(layout,`seq-${index}`);
        map.scrollLeft = 0;
        if (focusedNode) root.querySelector(`[data-node-id="${focusedNode}"]`)?.focus({preventScroll:true});
        if (focusedMessage) root.querySelector(`[data-message-id="${focusedMessage}"]`)?.focus({preventScroll:true});
      }
      root.style.setProperty('--pa-map-min',`${Math.ceil(layout.width)}px`);
      root.style.setProperty('--pa-map-width',`${Math.ceil(layout.width)}px`);
      interactions.refresh();
      root.querySelector('.pa-status').textContent = '';
      lastError=null;
      delete root.dataset.sequenceError;
      Object.assign(root.dataset, {sequenceReady:'true', layoutMode:layout.mode, layoutWidth:String(width),
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
globalThis.__penechoSequenceWhenSettled = async () => {
  resize(); await Promise.all([...states.values()].map(controller => controller.whenSettled()));
};
void globalThis.__penechoSequenceWhenSettled().then(() => dispatchEvent(new Event('penecho-sequence-ready')));
addEventListener('pagehide',() => {
  removeEventListener('penecho-diagram-languagechange',refreshLanguage);
  observer?.disconnect(); removeEventListener('resize',resize);
  for (const controller of states.values()) controller.dispose(); states.clear();
  delete globalThis.__penechoSequenceWhenSettled;
},{once:true});
