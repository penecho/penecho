// Zoom changes the SVG's painted size inside one native scrolling region.
// The complete viewBox, semantic layout and outer Canvas camera stay unchanged.
export function bindDiagramViewport(root) {
  const map=root.querySelector('.pa-map'), controls=root.querySelector('.pa-view-controls');
  let svg, full, scale=1, overview=1;
  const offsetX=()=>Math.max(0,(map.clientWidth-full.width*scale)/2);
  function zoom(next,center) {
    if(!svg)return;
    const width=map.clientWidth,height=map.clientHeight;
    const anchor=center||{x:(map.scrollLeft+width/2-offsetX())/scale,y:(map.scrollTop+height/2)/scale};
    scale=Math.max(overview,Math.min(4,next));
    svg.style.width=`${full.width*scale}px`;svg.style.height=`${full.height*scale}px`;
    controls.querySelector('output').textContent=`${Math.round(scale*100)}%`;
    controls.querySelector('[data-view="out"]').disabled=scale<=overview;
    controls.querySelector('[data-view="in"]').disabled=scale>=4;
    map.scrollLeft=anchor.x*scale+Math.max(0,(width-full.width*scale)/2)-width/2;
    map.scrollTop=anchor.y*scale-height/2;
  }
  function fit(){
    // Reserve the rendered header/toolbar inside this Widget's viewport. A fixed
    // 1600px map can otherwise make "overview" extend below a 1479px Widget.
    controls.hidden=false;
    const maximumHeight=svg.querySelectorAll('[data-node-id],[data-message-id]').length>24?900:1600;
    const nodeHeight=Math.max(0,...Array.from(svg.querySelectorAll('[data-node-id]'),node=>node.getBBox().height+24));
    const view=root.ownerDocument?.defaultView;
    let availableHeight=maximumHeight;
    if(view?.innerHeight>0){
      const rootTop=root.getBoundingClientRect().top,mapTop=map.getBoundingClientRect().top;
      // Each diagram can have preceding content. Budget its own chrome, not the
      // whole document's offset, and keep a usable scrolling area in short views.
      const topInset=Math.max(0,mapTop-rootTop)+Math.min(24,Math.max(0,rootTop+view.scrollY));
      availableHeight=Math.max(240,view.innerHeight-topInset-24);
    }
    map.style.height=`${Math.min(maximumHeight,availableHeight,Math.max(nodeHeight,full.height*Math.min(1,map.clientWidth/full.width)))}px`;
    overview=Math.min(1,map.clientWidth/full.width,map.clientHeight/full.height);
    controls.hidden=overview>=1;
    zoom(overview,{x:full.width/2,y:0});map.scrollLeft=0;map.scrollTop=0;
  }
  controls.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button||!svg)return;
    const action=button.dataset.view;
    if(action==='fit')fit();
    if(action==='actual')zoom(1);
    if(action==='in')zoom(scale/0.7);
    if(action==='out')zoom(scale*0.7);
  });
  controls.querySelector('select').addEventListener('change',event=>{
    if(!svg)return;
    const node=[...svg.querySelectorAll('[data-node-id]')].find(n=>n.dataset.nodeId===event.target.value);if(!node)return;
    const box=node.getBBox();zoom(1,{x:box.x+box.width/2,y:box.y+box.height/2});
  });
  map.addEventListener('keydown',event=>{
    if(event.target!==map||!svg)return;
    // Arrow, Page Up/Down, wheel and touch keep the browser's native scrolling.
    if(event.key==='+'||event.key==='='){event.preventDefault();zoom(scale/0.7);}
    if(event.key==='-'){event.preventDefault();zoom(scale*0.7);}
    if(event.key==='Home'){event.preventDefault();fit();}
  });
  return {refresh(){
    svg=map.querySelector('svg');if(!svg)return;
    full={width:Number(svg.getAttribute('width')),height:Number(svg.getAttribute('height'))};
    svg.dataset.fullViewBox=`0 0 ${full.width} ${full.height}`;
    svg.setAttribute('viewBox',svg.dataset.fullViewBox);
    fit();
  }};
}
