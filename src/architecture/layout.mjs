import schema from './schema.js';
import { normalizeRoutePoints, rectsOverlap, segmentIntersectsRect } from './vendor/archify/geometry.mjs';

import { FONT, wrap, measureFallback } from '../diagrams/text.mjs';
export { FONT, wrap };
export const MIN_MAP_SCALE = 0.9;

// ELK owns both node placement and orthogonal routing, including compound frames.
// A caller may supply measured browser text widths; the fallback is conservative CJK-aware.
export function buildGraph(input, measure = measureFallback, options = {}) {
  const data = schema.validateArchitecture(input);
  const direction = options.direction || data.direction || 'RIGHT';
  const spacing = { 'elk.algorithm':'layered', 'elk.direction':direction, 'elk.edgeRouting':'ORTHOGONAL',
    'elk.hierarchyHandling':'INCLUDE_CHILDREN', 'elk.padding':'[top=28,left=24,bottom=24,right=24]',
    'elk.spacing.nodeNode':'28', 'elk.layered.spacing.nodeNodeBetweenLayers':'24',
    'elk.spacing.edgeNode':'12', 'elk.spacing.edgeEdge':'16', 'elk.layered.spacing.edgeNodeBetweenLayers':'10',
    'elk.randomSeed':'1',
    'elk.layered.nodePlacement.strategy':'NETWORK_SIMPLEX', 'elk.layered.nodePlacement.bk.fixedAlignment':'BALANCED', 'elk.layered.nodePlacement.favorStraightEdges':'true', 'elk.layered.unnecessaryBendpoints':'true' };
  if (options.wrap) Object.assign(spacing, {'elk.layered.wrapping.strategy':'MULTI_EDGE', 'elk.aspectRatio':String(options.aspectRatio)});
  if (options.compact) Object.assign(spacing, {'elk.layered.layering.strategy':'COFFMAN_GRAHAM', 'elk.layered.layering.coffmanGraham.layerBound':'1'});
  const graph = { id:'_root', layoutOptions:spacing, children:[], edges:[] };
  const groups = new Map((data.groups || []).map(g => {
    const headerHeight = direction === 'DOWN' ? Math.max(64, 28 + wrap(g.label,160,14,measure).length*17) : 48;
    return [g.id, {id:`g_${g.id}`, children:[], layoutOptions:{...spacing,
      'elk.padding':`[top=${headerHeight},left=22,bottom=24,right=22]`, 'elk.nodeSize.constraints':'MINIMUM_SIZE',
      'elk.nodeSize.minimum':`(${Math.ceil(measure(g.label,14) + 48)},100)`}, data:{...g,headerHeight,titleWidth:Math.ceil(measure(g.label,14))}}];
  }));
  for (const g of data.groups || []) (g.parent ? groups.get(g.parent) : graph).children.push(groups.get(g.id));
  for (const n of data.nodes) {
    const width = Math.max(156, Math.min(208, Math.ceil(Math.max(measure(n.label,16) + 32, measure(n.subtitle || '',12) + 24))));
    const title = wrap(n.label, width - 30, 16, measure), subtitle = wrap(n.subtitle, width - 24, 12, measure);
    const height = Math.max(76, 26 + title.length * 22 + (subtitle.length ? 5 + subtitle.length * 17 : 0));
    const down=direction==='DOWN';
    (n.group ? groups.get(n.group) : graph).children.push({id:`n_${n.id}`, width, height, layoutOptions:{'elk.portConstraints':'FIXED_POS'}, ports:[{id:`${n.id}_in`,x:down?width/2:0,y:down?0:height/2,width:0,height:0,layoutOptions:{'elk.port.side':down?'NORTH':'WEST'}},{id:`${n.id}_out`,x:down?width/2:width,y:down?height:height/2,width:0,height:0,layoutOptions:{'elk.port.side':down?'SOUTH':'EAST'}}], data:{...n, titleLines:title, subtitleLines:subtitle}});
  }
  const adjacency = new Map(data.nodes.map(n=>[n.id, []]));
  data.edges.forEach((e,i)=>{ if(!['optional','return','config'].includes(e.kind)) adjacency.get(e.from).push([e.to,i]); });
  const memo = new Map();
  function chain(id, seen=new Set()) {
    if(seen.has(id)) return []; if(memo.has(id)) return memo.get(id);
    const nextSeen=new Set([...seen,id]); let best=[];
    for(const [to,i] of adjacency.get(id)) { const p=[i,...chain(to,nextSeen)]; if(p.length>best.length)best=p; }
    memo.set(id,best); return best;
  }
  const primary=new Set(data.nodes.map(n=>chain(n.id)).sort((a,b)=>b.length-a.length)[0]);
  data.edges.forEach((e, i) => {
    const lines = wrap(e.label, 110, 12, measure);
    graph.edges.push({id:`e_${i}`, sources:[`${e.from}_out`], targets:[`${e.to}_in`], data:{...e, lines}, layoutOptions:{'elk.layered.priority.straightness':primary.has(i)?'100':'0', 'elk.layered.priority.direction':primary.has(i)?'100':e.kind==='return'?'0':'1'},
      ...(lines.length ? {labels:[{text:e.label, width:Math.ceil(Math.max(...lines.map(s => measure(s,12))) + 12),
        height:lines.length * 17 + 8, layoutOptions:{'elk.edgeLabels.placement':'CENTER','elk.edgeLabels.inline':'false'}}]} : {})});
  });
  return {data, graph};
}

async function layoutCandidate(input, elk, measure, options) {
  const {data, graph} = buildGraph(input, measure, options);
  const start = performance.now();
  const output = await elk.layout(graph);
  const nodes = [], groups = [], edges = [];
  const origins = new Map();
  function visit(g, x = 0, y = 0) {
    origins.set(g.id, [x, y]);
    for (const n of g.children || []) {
      const item = {...n.data, x:x+n.x, y:y+n.y, width:n.width, height:n.height};
      if (n.children) { groups.push(item); visit(n, item.x, item.y); }
      else nodes.push(item);
    }
  }
  visit(output);
  function collect(g) {
    for (const e of g.edges || []) {
      const [x,y] = origins.get(e.container || g.id) || [0,0];
      const sections = (e.sections || []).map(s => normalizeRoutePoints([s.startPoint,...s.bendPoints || [],s.endPoint].map(p => [p.x+x,p.y+y])));
      edges.push({...e.data, id:e.id, sections, labels:(e.labels || []).map(l => ({x:x+l.x,y:y+l.y,width:l.width,height:l.height, lines:e.data.lines}))});
    }
    for (const child of g.children || []) if (child.children) collect(child);
  }
  collect(output);
  placeGroupTitles(groups,edges,measure);
  const result = {data, width:output.width, height:output.height, nodes, groups, edges, layoutMs:performance.now()-start};
  result.issues = inspectGeometry(result);
  return result;
}

export async function layoutArchitecture(input, elk, measure = measureFallback, options = {}) {
  const start = performance.now(), preferred = input.direction || 'RIGHT';
  const width = Number(options.width), constrained = Number.isFinite(width) && width > 0;
  const budget = width / MIN_MAP_SCALE, candidates = [];
  async function attempt(config, mode) {
    const layout = await layoutCandidate(input, elk, measure, config);
    layout.mode = mode; candidates.push(layout); return layout;
  }
  const natural = await attempt({direction:preferred}, preferred.toLowerCase());
  if (constrained && (natural.width > budget || natural.issues.length)) {
    if (preferred === 'RIGHT') {
      // ELK's ratio is a target, not a hard width constraint. Inspect its result
      // rather than assuming the wrapped graph fits or routes correctly.
      const rows = Math.max(2, Math.ceil(natural.width / budget));
      const aspectRatio = Math.max(.2, Math.min(4, budget / (natural.height * rows * 2)));
      await attempt({direction:'RIGHT', wrap:true, aspectRatio}, 'wrapped');
      await attempt({direction:'DOWN'}, 'down');
    }
    if (!candidates.some(c => !c.issues.length && c.width <= budget)) await attempt({direction:'DOWN',compact:true}, 'compact');
  }
  const valid = candidates.filter(c => !c.issues.length);
  const fitting = constrained ? valid.filter(c => c.width <= budget) : valid;
  const choices = fitting.length ? fitting : valid.length ? valid : candidates;
  // Prefer a compact page with short routes over a nominal fit with long wrapped
  // detours around compound frames. If none fits at readable scale, use the
  // narrowest valid graph and retain local horizontal scrolling as a fallback.
  const score = c => {
    if (!constrained) return 0;
    if (!fitting.length) return c.width;
    const distance = c.edges.reduce((sum,e) => sum + e.sections.reduce((n,points) => n + points.slice(1).reduce((d,p,i) => d + Math.abs(p[0]-points[i][0]) + Math.abs(p[1]-points[i][1]),0),0),0);
    return (c.height + distance*.08) * Math.min(1,width/c.width);
  };
  const result = choices.reduce((best,c) => score(c) < score(best) ? c : best);
  return {...result, layoutMs:performance.now()-start, attempts:candidates.length, availableWidth:constrained ? width : null};
}

// Compound edges must cross a frame boundary to reach nodes inside it. Keep the
// title on that boundary, but choose a clear horizontal slot after ELK routes the
// edges instead of treating the whole top rail as occupied text.
function placeGroupTitles(groups, edges, measure) {
  const segments=edges.flatMap(edge=>edge.sections.flatMap(points=>points.slice(1).map((end,i)=>({start:points[i],end}))));
  const labels=edges.flatMap(edge=>edge.labels);
  for(const group of groups) {
    const y=group.y+8, height=group.headerHeight-16;
    let gaps=[[group.x+14,group.x+group.width-14]];
    const cut=(left,right)=>{gaps=gaps.flatMap(([a,b])=>right<=a || left>=b ? [[a,b]] : [[a,Math.max(a,left)],[Math.min(b,right),b]]).filter(([a,b])=>b-a>=16);};
    for(const {start:a,end:b} of segments) if(Math.max(a[1],b[1])>=y-4 && Math.min(a[1],b[1])<=y+height+4) cut(Math.min(a[0],b[0])-10,Math.max(a[0],b[0])+10);
    for(const l of labels) if(l.y<y+height+4 && l.y+l.height>y-4)cut(l.x-6,l.x+l.width+6);
    const choices=gaps.map(([a,b])=>({x:a,lines:wrap(group.label,b-a-8,14,measure)}))
      .filter(t=>t.lines.length*17+5<=height).sort((a,b)=>a.lines.length-b.lines.length || a.x-b.x);
    const title=choices[0] || {x:group.x+14,lines:[group.label]};
    group.titleX=title.x;group.titleLines=title.lines;
    group.titleRect={x:title.x-4,y,width:Math.max(...title.lines.map(t=>measure(t,14)))+8,height:title.lines.length*17+5};
  }
}

export function inspectGeometry(layout) {
  const issues = [];
  const {nodes, edges} = layout;
  for (let i=0;i<nodes.length;i++) for(let j=i+1;j<nodes.length;j++) if(rectsOverlap(nodes[i],nodes[j])) issues.push(`Nodes overlap: ${nodes[i].id}/${nodes[j].id}`);
  for (const e of edges) {
    if (!e.sections.length) issues.push(`Missing route: ${e.id}`);
    for (const points of e.sections) for(let i=1;i<points.length;i++) {
      const start=points[i-1], end=points[i];
      if (Math.abs(start[0]-end[0])>0.01 && Math.abs(start[1]-end[1])>0.01) issues.push(`Diagonal route: ${e.id}`);
      for (const n of nodes) if(n.id!==e.from && n.id!==e.to && segmentIntersectsRect({start,end},n,1)) issues.push(`Route crosses node: ${e.id}/${n.id}`);
    }
    for (const label of e.labels) for (const n of nodes) if(rectsOverlap(label,n,2)) issues.push(`Label crosses node: ${e.id}/${n.id}`);
  }
  const labels = edges.flatMap(e => e.labels.map(l => ({...l,id:e.id})));
  for(let i=0;i<labels.length;i++) for(let j=i+1;j<labels.length;j++) if(rectsOverlap(labels[i],labels[j],2)) issues.push(`Labels overlap: ${labels[i].id}/${labels[j].id}`);
  for(const e of edges) for(const points of e.sections) for(let i=1;i<points.length;i++) {
    const segment={start:points[i-1],end:points[i]};
    for(const l of labels) if(l.id!==e.id && segmentIntersectsRect(segment,l,2)) issues.push(`Route crosses label: ${e.id}/${l.id}`);
    for(const g of layout.groups) if(g.titleRect && segmentIntersectsRect(segment,g.titleRect,1)) issues.push(`Route crosses frame title: ${e.id}/${g.id}`);
  }
  for(const g of layout.groups) if(g.titleRect) {
    if(g.titleRect.y+g.titleRect.height>g.y+g.headerHeight-6)issues.push(`Frame title exceeds reserved space: ${g.id}`);
    for(const label of labels)if(rectsOverlap(g.titleRect,label,2))issues.push(`Frame title crosses label: ${g.id}/${label.id}`);
  }
  return [...new Set(issues)];
}
