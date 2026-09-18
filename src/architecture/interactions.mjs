import { esc } from './vendor/archify/utils.mjs';
import { tone } from './render.mjs';

export function bindInteractions(root, data) {
  const popover=root.querySelector('.pa-popover');
  let selected=null;
  function close() { popover.hidden=true; selected?.removeAttribute('data-selected'); selected=null; }
  function open(nodeElement) {
    const node=data.nodes.find(n=>n.id===nodeElement.dataset.nodeId); if(!node)return;
    close(); selected=nodeElement; nodeElement.setAttribute('data-selected','');
    const related=data.edges.filter(e=>e.from===node.id || e.to===node.id);
    popover.style.setProperty('--tone',tone(data,node.domain)[0]);
    popover.innerHTML=`<button aria-label="关闭详情" data-close>×</button><h2>${esc(node.label)}</h2>${node.subtitle?`<p>${esc(node.subtitle)}</p>`:''}<ul>${(node.details || []).map(t=>`<li>${esc(t)}</li>`).join('')}</ul>${related.length?'<hr><p>相关关系</p>':''}<ul>${related.map(e=>`<li>${esc(data.nodes.find(n=>n.id===e.from).label)} ${e.bidirectional?'↔':'→'} ${esc(data.nodes.find(n=>n.id===e.to).label)}${e.label?` · ${esc(e.label)}`:''}</li>`).join('')}</ul>`;
    popover.hidden=false;
    position();
    popover.querySelector('button').focus();
  }
  function position() {
    if (!selected || popover.hidden) return;
    const box=selected.getBoundingClientRect(), w=popover.offsetWidth, h=popover.offsetHeight;
    popover.style.left=`${Math.max(12,Math.min(innerWidth-w-12,box.right+12))}px`;
    popover.style.top=`${Math.max(12,Math.min(innerHeight-h-12,box.top))}px`;
  }
  root.addEventListener('click', event=>{
    if(event.target.closest('[data-close]')) { const previous=selected; close(); previous?.focus(); return; }
    const node=event.target.closest('[data-node-id]'); if(node){open(node);return;}
    const button=event.target.closest('[data-export]'); if(button) void exportDiagram(button.dataset.export);
    else if(!event.target.closest('.pa-popover'))close();
  });
  root.addEventListener('keydown',event=>{
    if(event.key==='Escape'){const previous=selected;close();previous?.focus();}
    if(['Enter',' '].includes(event.key) && event.target.matches('[data-node-id]')){event.preventDefault();open(event.target);}
  });
  function download(blob, extension) {
    const url=URL.createObjectURL(blob), link=document.createElement('a');
    link.href=url;link.download=`${data.title.replace(/[\\/:*?"<>|]/g,'_')}.${extension}`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function exportDiagram(format) {
    const status=root.querySelector('.pa-status');
    try {
      await globalThis.__penechoArchitectureWhenSettled?.();
      const svg=root.querySelector('svg');
      const clone=svg.cloneNode(true);clone.querySelectorAll('[data-selected]').forEach(n=>n.removeAttribute('data-selected'));
      const xml=new XMLSerializer().serializeToString(clone), blob=new Blob([xml],{type:'image/svg+xml;charset=utf-8'});
      if(format==='svg'){download(blob,'svg');return;}
      const url=URL.createObjectURL(blob);
      try {
        const img=new Image(); await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(new Error('无法编码 SVG'));img.src=url;});
        const canvas=document.createElement('canvas'), scale=Math.min(2,4096/img.width,4096/img.height,Math.sqrt(12e6/(img.width*img.height)));
        canvas.width=Math.ceil(img.width*scale);canvas.height=Math.ceil(img.height*scale);
        const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(img,0,0,canvas.width,canvas.height);
        const png=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!png)throw new Error('PNG 编码失败');download(png,'png');
      } finally {URL.revokeObjectURL(url);}
      status.textContent='';
    } catch(error){status.textContent=`导出失败：${error.message}`;}
  }
  return {refresh() {
    if(selected) {
      selected=root.querySelector(`[data-node-id="${selected.dataset.nodeId}"]`);
      if(selected)selected.setAttribute('data-selected','');else close();
      position();
    }
  }};
}
