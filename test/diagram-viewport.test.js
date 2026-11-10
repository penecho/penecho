const test=require('node:test'),assert=require('node:assert/strict');
function fixture(width,height,available=1280,nodeHeight=0,viewportHeight){
  const events=new Map(),mapEvents=new Map(),buttons=new Map(),output={},select={addEventListener:(name,fn)=>events.set('select:'+name,fn)};
  const node={dataset:{nodeId:'last'},getBBox:()=>({x:width-160,y:height-Math.max(80,nodeHeight),width:120,height:Math.max(60,nodeHeight)})};
  let left=0,top=0;
  const map={style:{},clientWidth:available,addEventListener:(name,fn)=>mapEvents.set(name,fn),querySelector:()=>svg,
    get clientHeight(){return parseFloat(this.style.height)},get scrollWidth(){return Math.max(available,svg.clientWidth)},get scrollHeight(){return Math.max(this.clientHeight,svg.clientHeight)},
    get scrollLeft(){return left},set scrollLeft(v){left=Math.max(0,Math.min(this.scrollWidth-this.clientWidth,v))},
    get scrollTop(){return top},set scrollTop(v){top=Math.max(0,Math.min(this.scrollHeight-this.clientHeight,v))}};
  const attrs={width:String(width),height:String(height)},svg={style:{},dataset:{},getAttribute:n=>attrs[n],setAttribute:(n,v)=>attrs[n]=v,querySelectorAll:()=>[node],get clientWidth(){return parseFloat(this.style.width)},get clientHeight(){return parseFloat(this.style.height)}};
  const controls={querySelector:s=>s==='output'?output:s==='select'?select:buttons.get(s)||buttons.set(s,{}).get(s),addEventListener:(n,f)=>events.set(n,f)};
  const view={innerHeight:viewportHeight,scrollY:0};
  map.getBoundingClientRect=()=>({top:controls.hidden?150:197});
  const root={ownerDocument:{defaultView:view},getBoundingClientRect:()=>({top:8}),querySelector:s=>s==='.pa-map'?map:controls};
  return {root,svg,map,mapEvents,output,attrs,node,view,selectNode:()=>events.get('select:change')({target:{value:'last'}}),click:action=>events.get('click')({target:{closest:()=>({dataset:{view:action}})}})};
}
test('zoom creates native scroll extents on both axes while preserving full source geometry',async()=>{
  const {bindDiagramViewport}=await import('../src/diagrams/viewport.mjs');
  for(const [width,height]of [[3415,329],[2356,3329],[1600,6440],[2677,402]]) {
    const h=fixture(width,height);bindDiagramViewport(h.root).refresh();
    const box=h.attrs.viewBox,heightBefore=h.map.clientHeight;
    assert.equal(box,`0 0 ${width} ${height}`);
    assert.ok(h.svg.clientWidth<=1280&&h.svg.clientHeight<=heightBefore);
    h.click('actual');assert.equal(h.output.textContent,'100%');
    assert.equal(h.svg.clientWidth,width);assert.equal(h.svg.clientHeight,height);
    assert.equal(h.map.clientHeight,heightBefore);
    h.map.scrollLeft=h.map.scrollTop=Infinity;
    assert.equal(h.map.scrollLeft+h.map.clientWidth,h.map.scrollWidth);
    assert.equal(h.map.scrollTop+h.map.clientHeight,h.map.scrollHeight);
    h.click('fit');assert.equal(h.map.scrollLeft,0);assert.equal(h.map.scrollTop,0);
    assert.equal(h.attrs.viewBox,box);assert.equal(h.attrs.width,String(width));assert.equal(h.attrs.height,String(height));
    assert.equal(h.mapEvents.has('wheel'),false);assert.equal(h.mapEvents.has('pointerdown'),false);
  }
});
test('overview fits a tall diagram inside the actual Widget height and keeps native scrolling at 100%',async()=>{
  const {bindDiagramViewport}=await import('../src/diagrams/viewport.mjs');
  for(const viewportHeight of [1479,800]){
    const f=fixture(723,2757,1930,0,viewportHeight);bindDiagramViewport(f.root).refresh();
    assert.ok(f.map.getBoundingClientRect().top+f.map.clientHeight<=viewportHeight-24);
    assert.ok(f.svg.clientHeight<=f.map.clientHeight);
    const height=f.map.clientHeight;f.click('actual');
    assert.equal(f.map.clientHeight,height);assert.equal(f.output.textContent,'100%');
    f.selectNode();const b=f.node.getBBox();
    assert.ok(f.map.scrollTop<=b.y&&f.map.scrollTop+f.map.clientHeight>=b.y+b.height);
    // Refitting after a height-only resize must use the new available height.
    f.view.innerHeight=700;f.click('fit');
    assert.ok(f.map.getBoundingClientRect().top+f.map.clientHeight<=676);
    assert.ok(f.svg.clientHeight<=f.map.clientHeight);
  }
});
test('node locator scrolls a complete node into view at 100%, including a tall decision',async()=>{
  const {bindDiagramViewport}=await import('../src/diagrams/viewport.mjs');
  for(const [w,h,n]of [[2677,402,272],[1600,6440,100]]){
    const f=fixture(w,h,1280,n);bindDiagramViewport(f.root).refresh();f.selectNode();
    const b=f.node.getBBox();assert.equal(f.output.textContent,'100%');
    assert.ok(f.map.scrollLeft<=b.x&&f.map.scrollLeft+f.map.clientWidth>=b.x+b.width);
    assert.ok(f.map.scrollTop<=b.y&&f.map.scrollTop+f.map.clientHeight>=b.y+b.height);
  }
});
