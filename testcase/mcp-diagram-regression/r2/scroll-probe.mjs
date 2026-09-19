// Build an ephemeral MCP inspect document from an unmodified Canvas source.
export function scrollProbe(html,kind,label,{zoom=true}={}) {
  const settledKey='__penecho'+kind[0].toUpperCase()+kind.slice(1)+'WhenSettled';
  const script=`addEventListener('penecho-${kind}-ready',()=>{
    const originalSettled=globalThis['${settledKey}'];
    const inspection=(async()=>{
    await new Promise(resolve=>setTimeout(resolve,250));await originalSettled();
    const root=document.querySelector('[data-penecho-${kind}]'),map=root.querySelector('.pa-map'),svg=map.querySelector('svg'),source=root.querySelector('[data-${kind}-source]').textContent;
    const overview={width:map.clientWidth,height:map.clientHeight,outerHeight:map.getBoundingClientRect().height,scrollWidth:map.scrollWidth,scrollHeight:map.scrollHeight};
    const nodes=[...svg.querySelectorAll('[data-node-id]')],select=root.querySelector('.pa-view-controls select');
    let allNodesReachable=true;const failures=[];
    for(const node of nodes){select.value=node.dataset.nodeId;select.dispatchEvent(new Event('change'));const b=node.getBoundingClientRect(),m=map.getBoundingClientRect(),x=m.left+map.clientLeft,y=m.top+map.clientTop;const ok=b.left>=x-1&&b.top>=y-1&&b.right<=x+map.clientWidth+1&&b.bottom<=y+map.clientHeight+1;allNodesReachable&&=ok;if(!ok)failures.push(node.dataset.nodeId);}
    root.querySelector('[data-view="actual"]').click();
    const at100={width:map.clientWidth,height:map.clientHeight,outerHeight:map.getBoundingClientRect().height,scrollWidth:map.scrollWidth,scrollHeight:map.scrollHeight};
    map.scrollLeft=map.scrollTop=0;map.scrollBy({left:500,top:500,behavior:'instant'});
    const scrollMoved=(at100.scrollWidth<=at100.width||map.scrollLeft>0)&&(at100.scrollHeight<=at100.height||map.scrollTop>0);
    const wheel=new WheelEvent('wheel',{deltaY:120,bubbles:true,cancelable:true});map.dispatchEvent(wheel);
    map.scrollLeft=map.scrollWidth;map.scrollTop=map.scrollHeight;
    const reachedEnd=map.scrollLeft+map.clientWidth>=map.scrollWidth-1&&map.scrollTop+map.clientHeight>=map.scrollHeight-1;
    await new Promise(resolve=>setTimeout(resolve,250));
    const zoomRetained=root.querySelector('.pa-view-controls output')?.textContent==='100%';
    const report=document.getElementById('r2-report');
    report.textContent=JSON.stringify({test:${JSON.stringify(label)},nodes:nodes.length,noArrowButtons:!root.querySelector('[data-pan]'),overview,at100,containerHeightStable:overview.outerHeight===at100.outerHeight,zoomRetained,nativeScrollMoved:scrollMoved,reachedEnd,wheelDefaultNotPrevented:!wheel.defaultPrevented,allNodesReachable,failures,fullViewBox:svg.getAttribute('viewBox'),sourceUnchanged:source===root.querySelector('[data-${kind}-source]').textContent});
    ${zoom?'':'root.querySelector(\'[data-view="fit"]\').click();'}
    })();
    globalThis['${settledKey}']=async()=>{await originalSettled();await inspection;};
  },{once:true});`;
  return html.replace(/<body([^>]*)>/i,`<body$1><pre id="r2-report" style="box-sizing:border-box;height:200px;overflow:auto;margin:0;font:13px/1.4 Arial;padding:12px;background:#ecfdf5;color:#166534;white-space:pre-wrap">检查中…</pre>`).replace(/<\/body>/i,`<script>${script}</script></body>`);
}
