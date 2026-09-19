// Isolated adapter: preserve the baseline architecture/sequence export behavior.
import { esc } from '../architecture/vendor/archify/utils.mjs';
import { tone } from '../architecture/render.mjs';
import {diagramError,diagramErrorMessage} from '../architecture/i18n.mjs';
import {bindDiagramViewport} from '../diagrams/viewport.mjs';

export function bindInteractions(root, data, copyFor) {
  const viewport=bindDiagramViewport(root);
  const popover=root.querySelector('.pa-popover');
  const nodes=data.nodes || data.participants, edges=data.edges || data.messages;
  const selector='[data-node-id],[data-message-id]';
  let selected=null;
  function close() { popover.hidden=true; selected?.removeAttribute('data-selected'); selected=null; }
  function renderPopover(nodeElement, focus=true) {
    const copy=copyFor();
    const message=nodeElement.dataset.messageId ? data.messages?.[Number(nodeElement.dataset.messageId.replace('message-',''))] : null;
    const node=message ? {...message,subtitle:`${nodes.find(n=>n.id===message.from).label} → ${nodes.find(n=>n.id===message.to).label}`,domain:nodes.find(n=>n.id===message.from).domain,details:[...(message.note?[message.note]:[]),...(message.details || [])]} : nodes.find(n=>n.id===nodeElement.dataset.nodeId); if(!node)return;
    const detailKind=message?'message':data.participants?'participant':'node';
    popover.dataset.detailKind=detailKind;
    popover.setAttribute('aria-label',detailKind==='message'?copy.messageDetails:detailKind==='participant'?copy.participantDetails:copy.nodeDetails);
    const related=message?[]:edges.filter(e=>e.from===node.id || e.to===node.id);
    popover.style.setProperty('--tone',tone(data,node.domain)[0]);
    popover.innerHTML=`<button aria-label="${esc(copy.closeDetails)}" data-close>×</button><h2>${esc(node.label)}</h2>${node.subtitle?`<p>${esc(node.subtitle)}</p>`:''}<ul>${(node.details || []).map(t=>`<li>${esc(t)}</li>`).join('')}</ul>${related.length?`<hr><p>${esc(copy.related)}</p>`:''}<ul>${related.map(e=>`<li>${esc(nodes.find(n=>n.id===e.from).label)} ${e.bidirectional?'↔':'→'} ${esc(nodes.find(n=>n.id===e.to).label)}${e.label?` · ${esc(e.label)}`:''}</li>`).join('')}</ul>`;
    popover.hidden=false;
    position();
    if(focus)popover.querySelector('button').focus();
  }
  function open(nodeElement) {
    close(); selected=nodeElement; nodeElement.setAttribute('data-selected','');
    renderPopover(nodeElement);
  }
  function position() {
    if (!selected || popover.hidden) return;
    const box=selected.getBoundingClientRect(), w=popover.offsetWidth, h=popover.offsetHeight;
    popover.style.left=`${Math.max(12,Math.min(innerWidth-w-12,box.right+12))}px`;
    popover.style.top=`${Math.max(12,Math.min(innerHeight-h-12,box.top))}px`;
  }
  root.addEventListener('click', event=>{
    if(event.target.closest('[data-close]')) { const previous=selected; close(); previous?.focus(); return; }
    const node=event.target.closest(selector); if(node){open(node);return;}
    const button=event.target.closest('[data-export]'); if(button) void exportDiagram(button.dataset.export);
    else if(!event.target.closest('.pa-popover'))close();
  });
  root.addEventListener('keydown',event=>{
    if(event.key==='Escape'){const previous=selected;close();previous?.focus();}
    if(['Enter',' '].includes(event.key) && event.target.matches(selector)){event.preventDefault();open(event.target);}
  });
  function download(blob, extension) {
    const url=URL.createObjectURL(blob), link=document.createElement('a');
    link.href=url;link.download=`${data.title.replace(/[\\/:*?"<>|]/g,'_')}.${extension}`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function exportDiagram(format) {
    const status=root.querySelector('.pa-status');
    try {
      await globalThis.__penechoWorkflowWhenSettled?.();
      const svg=root.querySelector('svg');
      const clone=svg.cloneNode(true);clone.querySelectorAll('[data-selected]').forEach(n=>n.removeAttribute('data-selected'));
      if(clone.dataset.fullViewBox)clone.setAttribute('viewBox',clone.dataset.fullViewBox);
      clone.style.removeProperty('width');clone.style.removeProperty('height');
      const xml=new XMLSerializer().serializeToString(clone), blob=new Blob([xml],{type:'image/svg+xml;charset=utf-8'});
      if(format==='svg'){download(blob,'svg');return;}
      const url=URL.createObjectURL(blob);
      try {
        const img=new Image(); await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(diagramError('svgEncodeFailed'));img.src=url;});
        const canvas=document.createElement('canvas'), scale=Math.min(2,4096/img.width,4096/img.height,Math.sqrt(12e6/(img.width*img.height)));
        canvas.width=Math.ceil(img.width*scale);canvas.height=Math.ceil(img.height*scale);
        const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(img,0,0,canvas.width,canvas.height);
        const png=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!png)throw diagramError('pngEncodeFailed');download(png,'png');
      } finally {URL.revokeObjectURL(url);}
      status.textContent='';
    } catch(error){const copy=copyFor();status.textContent=copy.exportFailed(diagramErrorMessage(error,copy));}
  }
  return {refreshCopy(){if(selected)renderPopover(selected,false);},refresh() {
    viewport.refresh();
    if(selected) {
      const attribute=selected.hasAttribute("data-message-id")?"data-message-id":"data-node-id";
      selected=root.querySelector(`[${attribute}="${selected.getAttribute(attribute)}"]`);
      if(selected)selected.setAttribute('data-selected','');else close();
      position();
    }
  }};
}
