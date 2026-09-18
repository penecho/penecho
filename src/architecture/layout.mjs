import schema from './schema.js';
import { textUnits } from './vendor/archify/utils.mjs';
import { normalizeRoutePoints, rectsOverlap, segmentIntersectsRect } from './vendor/archify/geometry.mjs';

export const FONT = 'Arial, "PingFang SC", "Microsoft YaHei", sans-serif';
export function wrap(text, width, size, measure = (s, px) => textUnits(s) * px * 0.58) {
  const lines = []; let line = '';
  const flush=()=>{if(line.trim())lines.push(line.trim());line='';};
  // Preserve short Latin words/paths and parenthetical phrases. Oversized tokens
  // can still wrap; a closing punctuation mark must not occupy a line by itself.
  const tokens=String(text || '').match(/\([^()\n]*\)|（[^（）\n]*）|[A-Za-z0-9_./:+-]+|[ \t]+|\n|[^\s]/gu) || [];
  for (const token of tokens) {
    if(token==='\n'){flush();continue;}
    for(const part of measure(token,size)>width?Array.from(token):[token]) {
      if(!line){line=part.trimStart();continue;}
      if(measure(line+part,size)<=width){line+=part;continue;}
      if(/^[，。！？；：、）】》〉”’.,!?;:)\]}]$/u.test(part)) {
        const chars=Array.from(line.trimEnd()),last=chars.pop();line=chars.join('');flush();line=(last||'')+part;
      } else {
        let opening='';if(/[（(【《“‘]$/u.test(line)){opening=line.slice(-1);line=line.slice(0,-1);}
        flush();line=opening+part.trimStart();
      }
    }
  }
  flush();
  return lines;
}

// ELK owns both node placement and orthogonal routing, including compound frames.
// A caller may supply measured browser text widths; the fallback is conservative CJK-aware.
export function buildGraph(input, measure = (s, px) => textUnits(s) * px * 0.58) {
  const data = schema.validateArchitecture(input);
  const spacing = { 'elk.algorithm':'layered', 'elk.direction':data.direction || 'RIGHT', 'elk.edgeRouting':'ORTHOGONAL',
    'elk.hierarchyHandling':'INCLUDE_CHILDREN', 'elk.padding':'[top=28,left=24,bottom=24,right=24]',
    'elk.spacing.nodeNode':'28', 'elk.layered.spacing.nodeNodeBetweenLayers':'24',
    'elk.spacing.edgeNode':'12', 'elk.spacing.edgeEdge':'16', 'elk.layered.spacing.edgeNodeBetweenLayers':'10',
    'elk.randomSeed':'1',
    'elk.layered.nodePlacement.strategy':'NETWORK_SIMPLEX', 'elk.layered.nodePlacement.bk.fixedAlignment':'BALANCED', 'elk.layered.nodePlacement.favorStraightEdges':'true', 'elk.layered.unnecessaryBendpoints':'true' };
  const graph = { id:'_root', layoutOptions:spacing, children:[], edges:[] };
  const groups = new Map((data.groups || []).map(g => [g.id, {id:`g_${g.id}`, children:[], layoutOptions:{...spacing,
    'elk.padding':'[top=48,left=22,bottom=24,right=22]', 'elk.nodeSize.constraints':'MINIMUM_SIZE',
    'elk.nodeSize.minimum':`(${Math.ceil(measure(g.label,14) + 48)},100)`}, data:g}]));
  for (const g of data.groups || []) (g.parent ? groups.get(g.parent) : graph).children.push(groups.get(g.id));
  for (const n of data.nodes) {
    const width = Math.max(156, Math.min(208, Math.ceil(Math.max(measure(n.label,16) + 32, measure(n.subtitle || '',12) + 24))));
    const title = wrap(n.label, width - 30, 16, measure), subtitle = wrap(n.subtitle, width - 24, 12, measure);
    const height = Math.max(76, 26 + title.length * 22 + (subtitle.length ? 5 + subtitle.length * 17 : 0));
    const down=data.direction==='DOWN';
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

export async function layoutArchitecture(input, elk, measure) {
  const {data, graph} = buildGraph(input, measure);
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
  const result = {data, width:output.width, height:output.height, nodes, groups, edges, layoutMs:performance.now()-start};
  result.issues = inspectGeometry(result);
  return result;
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
    for(const g of layout.groups) if(segmentIntersectsRect(segment,{x:g.x+10,y:g.y+8,width:g.width-20,height:22},1)) issues.push(`Route crosses frame title: ${e.id}/${g.id}`);
  }
  return [...new Set(issues)];
}
