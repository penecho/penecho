// Workflow geometry uses the same Archify-derived SVG routing primitives and
// PenEcho panel as the accepted renderers, without altering either renderer.
import {esc} from '../architecture/vendor/archify/utils.mjs';
import {roundedPath} from '../architecture/vendor/archify/geometry.mjs';
import {FONT} from '../diagrams/text.mjs';
import {tone,renderPanel,styles as panelStyles} from '../architecture/render.mjs';
export const styles = panelStyles.replaceAll(':is([data-penecho-architecture],[data-penecho-sequence])','[data-penecho-workflow]') + '\n[data-penecho-workflow] .pa-header>div{min-width:0;flex:1 1 240px;overflow-wrap:anywhere}';
const lines=(items,x,y,size,color,weight=400,anchor='middle') => items.map((s,i)=>`<text x="${x}" y="${y+i*(size===16?22:17)}" text-anchor="${anchor}" font-size="${size}" font-weight="${weight}" fill="${color}">${esc(s)}</text>`).join('');
export function renderSvg(layout,prefix='workflow') {
  const {data,nodes,edges,groups,width,height}=layout, marker=`${prefix}-arrow`;
  const frames=groups.map(g=>{const [stroke,fill]=tone(data,g.domain);return `<g data-group-id="${esc(g.id)}"><rect x="${g.x}" y="${g.y}" width="${g.width}" height="${g.height}" fill="${fill}" fill-opacity=".65" stroke="${stroke}" stroke-dasharray="6 5" rx="10"/>${lines(g.titleLines,g.titleX,g.y+26,14,stroke,600,'start')}</g>`;}).join('');
  const routes=edges.map(e=>e.sections.map(p=>`<path data-edge-id="${e.id}" data-from="${esc(e.from)}" data-to="${esc(e.to)}" d="${roundedPath(p,6)}" fill="none" stroke="#65748a" stroke-width="1.5" ${e.kind==='loop'?'stroke-dasharray="5 4"':''} marker-end="url(#${marker})"/>`).join('')).join('');
  const boxes=nodes.map(n=>{
    const [stroke,fill]=tone(data,n.domain),cx=n.x+n.width/2,cy=n.y+n.height/2;
    const attrs=`data-node-box="" fill="${fill}" stroke="${stroke}" stroke-width="1.5"`;
    const shape=n.type==='decision'?`<polygon points="${cx},${n.y} ${n.x+n.width},${cy} ${cx},${n.y+n.height} ${n.x},${cy}" ${attrs}/>`:
      `<rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="${['start','end'].includes(n.type)?n.height/2:7}" ${attrs}/>`;
    const bar=['fork','join'].includes(n.type)?`<rect x="${n.x+18}" y="${n.y+9}" width="${n.width-36}" height="4" rx="2" fill="${stroke}"/>`:'';
    const block=n.titleLines.length*22+(n.subtitleLines.length?5+n.subtitleLines.length*17:0), y=n.y+(n.height-block)/2+17+(bar?4:0);
    return `<g data-node-id="${esc(n.id)}" data-node-type="${n.type}" tabindex="0" role="button" aria-label="${esc(n.label)}" style="cursor:pointer"><title>${esc(n.label)}</title>${shape}${bar}${lines(n.titleLines,cx,y,16,stroke,600)}${lines(n.subtitleLines,cx,y+n.titleLines.length*22+2,12,'#526277')}</g>`;
  }).join('');
  const labels=edges.map(e=>e.labels.map(l=>`<g data-edge-label="${e.id}"><rect x="${l.x}" y="${l.y}" width="${l.width}" height="${l.height}" rx="3" fill="white"/>${lines(l.lines,l.x+l.width/2,l.y+16,12,'#526277')}</g>`).join('')).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${esc(data.title)}" style="font-family:${esc(FONT)};background:white"><style>[data-node-id]:focus{outline:none}[data-node-id]:focus [data-node-box],[data-node-id][data-selected] [data-node-box]{stroke-width:3}</style><defs><marker id="${marker}" viewBox="0 0 10 8" markerWidth="8" markerHeight="7" refX="9" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0 L10 4 L0 8 Z" fill="#65748a"/></marker></defs>${frames}${routes}${boxes}${labels}</svg>`;
}
export const renderContent=(layout,prefix,copy)=>renderPanel(layout.data,renderSvg(layout,prefix),copy);
