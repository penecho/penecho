import schema from './schema.js';
import {wrap, measureFallback} from '../diagrams/text.mjs';
import {normalizeRoutePoints} from '../architecture/vendor/archify/geometry.mjs';
import {inspectGeometry} from '../architecture/layout.mjs';

export function buildGraph(input, measure = measureFallback, direction = 'RIGHT', staged = false) {
  const data = schema.validateWorkflow(input), down = direction === 'DOWN';
  // Responsibility groups may be revisited later in the process. A single
  // compound frame forces those stages together and reverses forward edges.
  // Split only their visual frames at responsibility transitions; semantic
  // group/node identities and the original source remain unchanged.
  const stages=new Map(), incoming=new Map(data.nodes.map(n=>[n.id,[]])), byId=new Map(data.nodes.map(n=>[n.id,n]));
  for(const e of data.edges)if(e.kind!=='loop')incoming.get(e.to).push(e.from);
  function stage(id){if(stages.has(id))return stages.get(id);const value=Math.max(0,...incoming.get(id).map(from=>stage(from)+(byId.get(from).group!==byId.get(id).group?1:0)));stages.set(id,value);return value;}
  const frameKeys=new Map(), sourceGroups=new Map((data.groups||[]).map(g=>[g.id,g]));
  function frame(id,phase){const key=staged?`${id}@${phase}`:id;if(!frameKeys.has(key)){const g=sourceGroups.get(id);frameKeys.set(key,{...g,frameKey:key,parentKey:g.parent?frame(g.parent,phase):null});}return key;}
  for(const n of data.nodes)if(n.group)frame(n.group,staged?stage(n.id):0);
  const options = {'elk.algorithm':'layered','elk.direction':direction,'elk.edgeRouting':'ORTHOGONAL',
    'elk.hierarchyHandling':'INCLUDE_CHILDREN','elk.padding':'[top=28,left=24,bottom=24,right=24]',
    'elk.spacing.nodeNode':'36','elk.layered.spacing.nodeNodeBetweenLayers':'44',
    'elk.spacing.edgeNode':'18','elk.spacing.edgeEdge':'18','elk.layered.spacing.edgeNodeBetweenLayers':'18',
    'elk.layered.cycleBreaking.strategy':'DEPTH_FIRST',
    'elk.layered.nodePlacement.strategy':'NETWORK_SIMPLEX','elk.layered.nodePlacement.favorStraightEdges':'true',
    'elk.layered.unnecessaryBendpoints':'true','elk.randomSeed':'1'};
  const graph = {id:'wf:root',layoutOptions:options,children:[],edges:[]};
  const groups = new Map([...frameKeys.values()].map(g => {
    const headerHeight=Math.max(64,36+wrap(g.label,240,14,measure).length*17);
    return [g.frameKey,{id:`wf:group:${g.frameKey}`,children:[],
      layoutOptions:{...options,'elk.padding':`[top=${headerHeight},left=24,bottom=24,right=24]`,
        'elk.nodeSize.constraints':'MINIMUM_SIZE','elk.nodeSize.minimum':`(${Math.min(288,Math.ceil(measure(g.label,14)+48))},100)`},
      data:{...g,headerHeight}}];
  }));
  for (const g of frameKeys.values()) (g.parentKey ? groups.get(g.parentKey) : graph).children.push(groups.get(g.frameKey));
  for (const n of data.nodes) {
    const decision = n.type === 'decision', bar = ['fork','join'].includes(n.type);
    const decisionTextWidth = Math.max(96,Math.min(140,Math.ceil(Math.max(measure(n.label,16),measure(n.subtitle || '',12)))));
    const titleLines = wrap(n.label,decision ? decisionTextWidth : 164,16,measure);
    const subtitleLines = wrap(n.subtitle,decision ? decisionTextWidth : 164,12,measure);
    const block = titleLines.length*22 + (subtitleLines.length ? 5+subtitleLines.length*17 : 0);
    // Reserve an inscribed text rectangle inside the diamond; never shrink text.
    const width = decision ? (decisionTextWidth+16)*2 : 196, height = decision ? Math.max(120,block*2+24) : Math.max(n.type==='process'?84:64,block+28+(bar?10:0));
    const port = (name,out) => ({id:`wf:port:${n.id}:${name}`,x:down?width/2:out?width:0,y:down?(out?height:0):height/2,width:0,height:0,
      layoutOptions:{'elk.port.side':down?(out?'SOUTH':'NORTH'):(out?'EAST':'WEST')}});
    (n.group ? groups.get(staged?`${n.group}@${stage(n.id)}`:n.group) : graph).children.push({id:`wf:node:${n.id}`,width,height,
      layoutOptions:{'elk.portConstraints':'FIXED_POS'},ports:[port('in',false),port('out',true)],data:{...n,titleLines,subtitleLines}});
  }
  const order=new Map();
  function rank(id){if(order.has(id))return order.get(id);const value=Math.max(0,...incoming.get(id).map(from=>rank(from)+1));order.set(id,value);return value;}
  data.edges.forEach((edge,i) => {
    const lines = wrap(edge.label,116,12,measure);
    // Route a retry as a forward constraint, then reverse its geometry for the
    // original arrow. ELK cannot choose an ordinary flow edge to break its cycle.
    const reversed=edge.kind==='loop'&&rank(edge.from)>=rank(edge.to);
    graph.edges.push({id:`wf:edge:${i}`,sources:[`wf:port:${reversed?edge.to:edge.from}:out`],targets:[`wf:port:${reversed?edge.from:edge.to}:in`],data:{...edge,lines,reversed},
      layoutOptions:{'elk.layered.priority.direction':edge.kind==='loop'?'0':'100'},
      ...(lines.length ? {labels:[{text:edge.label,width:Math.ceil(Math.max(...lines.map(t=>measure(t,12))))+16,height:lines.length*17+8,
        layoutOptions:{'elk.edgeLabels.placement':'CENTER','elk.edgeLabels.inline':'false'}}]} : {})});
  });
  function sort(g){for(const n of g.children)if(n.children)sort(n);const level=n=>n.children?Math.min(...n.children.map(level)):rank(n.data.id);g.children.sort((a,b)=>level(a)-level(b));}
  sort(graph);
  return {data,graph};
}

async function candidate(data,elk,measure,direction,staged=false) {
  const {graph} = buildGraph(data,measure,direction,staged), output = await elk.layout(graph);
  const nodes=[],groups=[],edges=[],origins=new Map();
  function visit(g,x=0,y=0) {
    origins.set(g.id,[x,y]);
    for (const n of g.children || []) {
      const item={...n.data,x:x+n.x,y:y+n.y,width:n.width,height:n.height};
      if (n.children) { groups.push(item); visit(n,item.x,item.y); } else nodes.push(item);
    }
  }
  visit(output);
  function collect(g) {
    for (const e of g.edges || []) {
      const [x,y]=origins.get(e.container || g.id) || [0,0];
      const sections=(e.sections || []).map(s=>normalizeRoutePoints([s.startPoint,...s.bendPoints || [],s.endPoint].map(p=>[p.x+x,p.y+y])));
      if(e.data.reversed){sections.reverse();sections.forEach(points=>points.reverse());}
      edges.push({...e.data,id:e.id,sections,
        labels:(e.labels || []).map(l=>({x:x+l.x,y:y+l.y,width:l.width,height:l.height,lines:e.data.lines}))});
    }
    for (const n of g.children || []) if(n.children)collect(n);
  }
  collect(output);
  placeTitles(groups,edges,measure);
  const layout={data,nodes,groups,edges,width:output.width,height:output.height,mode:direction.toLowerCase(),staged};
  layout.issues=inspectGeometry(layout);
  return layout;
}

// Reserve text on a clear part of the frame rail, including incoming edges.
// This adapter stays local so the accepted architecture layout remains frozen.
function placeTitles(groups,edges,measure) {
  const segments=edges.flatMap(e=>e.sections.flatMap(points=>points.slice(1).map((p,i)=>[points[i],p])));
  for(const g of groups){
    const y=g.y+8,height=g.headerHeight-16;
    let gaps=[[g.x+14,g.x+g.width-14]];
    const cut=(left,right)=>{gaps=gaps.flatMap(([a,b])=>right<=a||left>=b?[[a,b]]:[[a,Math.max(a,left)],[Math.min(b,right),b]]).filter(([a,b])=>b-a>=16);};
    for(const [a,b]of segments)if(Math.max(a[1],b[1])>=y-4&&Math.min(a[1],b[1])<=y+height+4)cut(Math.min(a[0],b[0])-10,Math.max(a[0],b[0])+10);
    for(const l of edges.flatMap(e=>e.labels))if(l.y<y+height+4&&l.y+l.height>y-4)cut(l.x-6,l.x+l.width+6);
    const title=gaps.map(([a,b])=>({x:a,lines:wrap(g.label,b-a-8,14,measure)})).filter(t=>t.lines.length*17+5<=height).sort((a,b)=>a.lines.length-b.lines.length||a.x-b.x)[0]||{x:g.x+14,lines:wrap(g.label,g.width-28,14,measure)};
    g.titleX=title.x;g.titleLines=title.lines;
    g.titleRect={x:title.x-4,y,width:Math.max(...title.lines.map(t=>measure(t,14)))+8,height:title.lines.length*17+5};
  }
}

export async function layoutWorkflow(input,elk,measure=measureFallback,{width}={}) {
  const start=performance.now(), data=schema.validateWorkflow(input);
  const candidates=[await candidate(data,elk,measure,data.direction || 'RIGHT')];
  if (!data.direction && (candidates[0].issues.length || (width>0 && candidates[0].width>width))) {
    candidates.push(await candidate(data,elk,measure,candidates[0].mode==='right'?'DOWN':'RIGHT'));
  }
  const backwards=c=>{const axis=c.mode==='right'?'x':'y',nodes=new Map(c.nodes.map(n=>[n.id,n]));return c.edges.filter(e=>e.kind!=='loop'&&nodes.get(e.from)[axis]>=nodes.get(e.to)[axis]).length;};
  for(const c of [...candidates])if(data.groups?.length&&backwards(c))candidates.push(await candidate(data,elk,measure,c.mode.toUpperCase(),true));
  const clean=candidates.filter(c=>!c.issues.length), leastBackwards=Math.min(...clean.map(backwards));
  const valid=clean.filter(c=>backwards(c)===leastBackwards), fitting=valid.filter(c=>!(width>0) || c.width<=width);
  const choices=fitting.length?fitting:valid.length?valid:candidates;
  const result=choices.reduce((a,b)=>(fitting.length?b.height<a.height:b.width<a.width)?b:a);
  return {...result,layoutMs:performance.now()-start,attempts:candidates.length};
}
