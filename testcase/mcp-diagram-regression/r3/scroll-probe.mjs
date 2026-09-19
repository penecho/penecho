// Ephemeral MCP inspection only: never patch the saved Canvas object.
export function scrollProbe(html,kind,label,{overview=false}={}) {
  const settledKey='__penecho'+kind[0].toUpperCase()+kind.slice(1)+'WhenSettled';
  const script=`addEventListener('penecho-${kind}-ready',()=>{
    const originalSettled=globalThis['${settledKey}'];
    const inspection=(async()=>{
      await new Promise(resolve=>setTimeout(resolve,250));await originalSettled();
      const root=document.querySelector('[data-penecho-${kind}]'),map=root.querySelector('.pa-map'),svg=map.querySelector('svg');
      const source=root.querySelector('[data-${kind}-source]').textContent,scroller=document.scrollingElement;
      const initial={viewport:[innerWidth,innerHeight],map:[map.clientWidth,map.clientHeight],outerHeight:map.getBoundingClientRect().height,mapBottom:Math.round(map.getBoundingClientRect().bottom),bodyHeight:scroller.scrollHeight,bodyOverflow:getComputedStyle(scroller).overflowY,zoom:root.querySelector('.pa-view-controls output').textContent};
      const nodes=[...svg.querySelectorAll('[data-node-id]')],select=root.querySelector('.pa-view-controls select'),failures=[];
      for(const node of nodes){select.value=node.dataset.nodeId;select.dispatchEvent(new Event('change'));const b=node.getBoundingClientRect(),m=map.getBoundingClientRect(),x=m.left+map.clientLeft,y=m.top+map.clientTop;if(!(b.left>=x-1&&b.top>=y-1&&b.right<=x+map.clientWidth+1&&b.bottom<=y+map.clientHeight+1))failures.push(node.dataset.nodeId);}
      root.querySelector('[data-view="actual"]').click();
      const at100={map:[map.clientWidth,map.clientHeight],content:[map.scrollWidth,map.scrollHeight]};
      map.scrollLeft=map.scrollTop=0;map.scrollBy({left:500,top:500,behavior:'instant'});
      const nativeScrollMoved=(at100.content[0]<=at100.map[0]||map.scrollLeft>0)&&(at100.content[1]<=at100.map[1]||map.scrollTop>0);
      const wheel=new WheelEvent('wheel',{deltaY:120,bubbles:true,cancelable:true});map.dispatchEvent(wheel);
      map.scrollLeft=map.scrollWidth;map.scrollTop=map.scrollHeight;
      const mapEnd=map.scrollLeft+map.clientWidth>=map.scrollWidth-1&&map.scrollTop+map.clientHeight>=map.scrollHeight-1;
      scroller.scrollTop=scroller.scrollHeight;
      const bodyEnd=scroller.scrollTop+scroller.clientHeight>=scroller.scrollHeight-1;
      scroller.scrollTop=0;
      await new Promise(resolve=>setTimeout(resolve,250));
      const result={test:${JSON.stringify(label)},nodes:nodes.length,initial,at100,noArrowButtons:!root.querySelector('[data-pan]'),containerHeightStable:initial.outerHeight===map.getBoundingClientRect().height,zoomRetained:root.querySelector('.pa-view-controls output').textContent==='100%',nativeScrollMoved,mapEnd,bodyEnd,wheelDefaultNotPrevented:!wheel.defaultPrevented,allNodesReachable:failures.length===0,failures,sourceUnchanged:source===root.querySelector('[data-${kind}-source]').textContent};
      const report=document.createElement('pre');report.style='position:absolute;top:0;left:0;z-index:99999;max-width:100%;box-sizing:border-box;margin:0;padding:14px;background:#ecfdf5;color:#166534;font:15px/1.5 monospace;white-space:pre-wrap';report.textContent=JSON.stringify(result,null,2);document.body.append(report);
      ${overview?'root.querySelector(\'[data-view="fit"]\').click();':''}
    })();
    globalThis['${settledKey}']=async()=>{await originalSettled();await inspection;};
  },{once:true});`;
  return html.replace(/<\/body>/i,`<script>${script}</script></body>`);
}
