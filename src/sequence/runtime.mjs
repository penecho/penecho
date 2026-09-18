import { styles, renderContent, renderSvg } from './render.mjs';
import { FONT } from '../diagrams/text.mjs';
import { layoutSequence } from './layout.mjs';
import { bindInteractions } from '../architecture/interactions.mjs';
import { createReflow, serialLayouts } from '../architecture/reflow.mjs';
const style = document.createElement('style'); style.textContent = styles; document.head.append(style);
const roots = [...document.querySelectorAll('[data-penecho-sequence]')].filter(root => root.querySelector('script[data-sequence-source]'));
const enqueue = serialLayouts(), states = new Map();
const textContext = document.createElement('canvas').getContext('2d');
const measure = (text,size) => { textContext.font = `${size === 15 || size === 13 ? '600 ' : ''}${size}px ${FONT}`; return textContext.measureText(text).width; };
const contentWidth = root => {
  const css = getComputedStyle(root);
  return root.clientWidth - parseFloat(css.paddingLeft || 0) - parseFloat(css.paddingRight || 0);
};

function mount(root,index) {
  const source = root.querySelector('script[data-sequence-source]');
  let data, interactions, startedAt;
  function report(error) {
    const message = root.querySelector('.pa-status') || document.createElement('p');
    message.className = 'pa-status'; message.role = 'alert';
    message.textContent = `时序图未能完成：${error.message}`;
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
        root.insertAdjacentHTML('beforeend',renderContent(layout,`seq-${index}`));
        interactions = bindInteractions(root,data);
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
      delete root.dataset.sequenceError;
      Object.assign(root.dataset, {sequenceReady:'true', layoutMode:layout.mode, layoutWidth:String(width),
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
globalThis.__penechoSequenceWhenSettled = async () => {
  resize(); await Promise.all([...states.values()].map(controller => controller.whenSettled()));
};
void globalThis.__penechoSequenceWhenSettled().then(() => dispatchEvent(new Event('penecho-sequence-ready')));
addEventListener('pagehide',() => {
  observer?.disconnect(); removeEventListener('resize',resize);
  for (const controller of states.values()) controller.dispose(); states.clear();
  delete globalThis.__penechoSequenceWhenSettled;
},{once:true});
