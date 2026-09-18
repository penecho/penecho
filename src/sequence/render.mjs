// Minimal local sequence presentation based on Archify's MIT sequence renderer.
// Shared Archify semantic sigils/escaping and PenEcho's established light shell.
import { esc, renderSemanticSigil } from '../architecture/vendor/archify/utils.mjs';
import { FONT } from '../diagrams/text.mjs';
import { tone, renderPanel, styles } from '../architecture/render.mjs';
export { styles };

function lines(items,x,y,{size=13,color='#526277',weight=400,step=18,anchor='middle'}={}) {
  return items.map((text,i) => `<text x="${x}" y="${y+i*step}" text-anchor="${anchor}" font-size="${size}" fill="${color}" font-weight="${weight}">${esc(text)}</text>`).join('');
}
export function renderSvg(layout,prefix='seq') {
  const {data,participants,messages,fragments,activations,width,height,lifelineTop,lifelineBottom}=layout;
  const frameRects=fragments.slice().sort((a,b)=>a.depth-b.depth).map(f => `<rect x="${f.x}" y="${f.y}" width="${f.width}" height="${f.height}" rx="4" fill="none" stroke="#a1afbf" stroke-dasharray="6 4"/>`).join('');
  const lifelines=participants.map(p => `<line x1="${p.cx}" x2="${p.cx}" y1="${lifelineTop}" y2="${lifelineBottom}" stroke="${tone(data,p.domain)[0]}" opacity=".35" stroke-dasharray="5 5"/>`).join('');
  const bars=activations.map(a => `<rect x="${a.x}" y="${a.y}" width="${a.width}" height="${a.height}" rx="2" fill="${tone(data,a.domain)[1]}" stroke="${tone(data,a.domain)[0]}"/>`).join('');
  const headers=participants.map(p => {
    const [stroke,fill]=tone(data,p.domain), block=p.titleLines.length*21+(p.subtitleLines.length?6+p.subtitleLines.length*17:0), top=p.y+(p.height-block)/2+16;
    return `<g data-node-id="${esc(p.id)}" tabindex="0" role="button" aria-label="${esc(p.label)}" style="color:${stroke}"><title>${esc(p.label)}</title><rect data-node-box="" x="${p.x}" y="${p.y}" width="${p.width}" height="${p.height}" rx="7" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>${renderSemanticSigil(p.type || 'backend',{x:p.x+5,y:p.y+4,size:9})}${lines(p.titleLines,p.cx,top,{size:15,color:stroke,weight:600,step:21})}${lines(p.subtitleLines,p.cx,top+p.titleLines.length*21+5,{size:12,step:17})}</g>`;
  }).join('');
  const arrows=messages.map(m => {
    const color=tone(data,m.domain)[0], points=m.points, last=points.at(-1), before=points.at(-2), sign=last[0]>before[0]?1:-1;
    const head=`M${last[0]-sign*8} ${last[1]-4} L${last[0]} ${last[1]} L${last[0]-sign*8} ${last[1]+4}${m.kind==='async'?'':' Z'}`;
    const d=points.map((p,i)=>`${i?'L':'M'}${p[0]} ${p[1]}`).join(' ');
    return `<g data-message-id="${m.key}" tabindex="0" role="button" aria-label="${esc(`${m.index+1}. ${m.label}`)}"><title>${esc(m.label)}</title><path d="${d}" stroke="transparent" stroke-width="14" fill="none"/><path data-message-route="" d="${d}" stroke="${color}" stroke-width="1.5" fill="none" ${m.kind==='return'?'stroke-dasharray="5 4"':''}/><path d="${head}" fill="${m.kind==='async'?'none':color}" stroke="${color}" stroke-width="1.5"/><rect data-message-box="" x="${m.labelX-4}" y="${m.labelY-2}" width="${m.labelWidth+8}" height="${m.titleLines.length*18+3}" fill="white" rx="3"/>${lines(m.titleLines,m.labelX+m.labelWidth/2,m.labelY+13,{color,weight:600})}${m.noteLines.length?`<rect x="${m.labelX-4}" y="${m.noteY-2}" width="${m.labelWidth+8}" height="${m.noteLines.length*17+6}" fill="white" rx="3"/>${lines(m.noteLines,m.labelX+m.labelWidth/2,m.noteY+12,{size:12,step:17})}`:''}</g>`;
  }).join('');
  const frameTitles=fragments.map(f => `<g data-fragment-label="" style="paint-order:stroke;stroke:white;stroke-width:3px;stroke-linejoin:round">${lines(f.titleLines,f.x+12,f.y+20,{color:'#39516d',weight:600,anchor:'start'})}${f.branches.map(b => `<line x1="${f.x}" x2="${f.x+f.width}" y1="${b.y}" y2="${b.y}" stroke="#a1afbf" stroke-dasharray="6 4"/>${lines(b.lines,f.x+12,b.y+19,{color:'#39516d',anchor:'start'})}`).join('')}</g>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" id="${prefix}" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${esc(data.title)}" style="font-family:${esc(FONT)};background:white"><style>.semantic-sigil{fill:none;stroke:currentColor;stroke-width:1.25;opacity:.55}.sigil-fill{fill:currentColor;stroke:none}[data-node-id],[data-message-id]{cursor:pointer;outline:none}[data-node-id]:focus [data-node-box],[data-node-id][data-selected] [data-node-box]{stroke-width:3}[data-message-id]:focus [data-message-box],[data-message-id][data-selected] [data-message-box]{stroke:#315eea;stroke-width:2}</style>${frameRects}${lifelines}${bars}${arrows}${headers}${frameTitles}</svg>`;
}
export function renderContent(layout,prefix) { return renderPanel(layout.data,renderSvg(layout,prefix)); }
