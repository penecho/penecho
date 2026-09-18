// Adapted from Archify 2.17 renderers/architecture/render-architecture.mjs (MIT).
// Keep its frame → routes → nodes → labels paint order, semantic sigils and rounded paths.
// ELK supplies measured geometry. PenEcho supplies the light palette and compact widget shell.
import { esc, renderSemanticSigil } from './vendor/archify/utils.mjs';
import { roundedPath } from './vendor/archify/geometry.mjs';
import { FONT } from './layout.mjs';
export const PALETTE = {
  blue:['#315eea','#f2f6ff'], teal:['#087f88','#effbfa'], orange:['#c65316','#fff7ed'],
  purple:['#7540d5','#f7f2ff'], green:['#17814a','#f0fbf4'], slate:['#5d6b80','#f7f9fc']
};
export function tone(data, domain) {
  const domains = data.domains || [], i = domains.findIndex(d => d.id === domain);
  if(i<0)return PALETTE.slate;
  return PALETTE[domains[i]?.color || Object.keys(PALETTE)[Math.max(0,i) % 6]] || PALETTE.slate;
}
function lines(content, x, y, size, color, weight=400, anchor='middle') {
  return content.map((s,i) => `<text x="${x}" y="${y+i*(size===16?22:17)}" text-anchor="${anchor}" fill="${color}" font-size="${size}" font-weight="${weight}">${esc(s)}</text>`).join('');
}
export function renderSvg(layout, prefix='arch') {
  const {data,nodes,groups,edges,width,height} = layout;
  const marker = `${prefix}-arrow`;
  const frames = groups.map(g => {
    const [stroke,fill] = tone(data,g.domain);
    return `<g data-group-id="${esc(g.id)}"><rect x="${g.x}" y="${g.y}" width="${g.width}" height="${g.height}" rx="10" fill="${fill}" fill-opacity=".65" stroke="${stroke}" stroke-width="1.2" stroke-dasharray="6 5"/>${lines(g.titleLines || [g.label],g.titleX ?? g.x+14,g.y+25,14,stroke,600,'start')}</g>`;
  }).join('');
  const routes = edges.map(e => e.sections.map(points => `<path data-edge-id="${e.id}" data-from="${esc(e.from)}" data-to="${esc(e.to)}" d="${roundedPath(points,6)}" fill="none" stroke="#65748a" stroke-width="1.5" ${e.kind==='optional'?'stroke-dasharray="5 4"':''} marker-end="url(#${marker})" ${e.bidirectional?`marker-start="url(#${marker})"`:''}/>`).join('')).join('');
  const boxes = nodes.map(n => {
    const [stroke,fill] = tone(data,n.domain);
    const block = n.titleLines.length*22+(n.subtitleLines.length?5+n.subtitleLines.length*17:0);
    const y = n.y+(n.height-block)/2+17;
    return `<g data-node-id="${esc(n.id)}" tabindex="0" role="button" aria-label="${esc(n.label)}" style="cursor:pointer;color:${stroke}"><title>${esc(n.label)}</title><rect data-node-box="" x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="7" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>${renderSemanticSigil(n.type || 'backend',{x:n.x+6,y:n.y+5,size:10})}${lines(n.titleLines,n.x+n.width/2,y,16,stroke,600)}${lines(n.subtitleLines,n.x+n.width/2,y+n.titleLines.length*22+2,12,'#526277')}</g>`;
  }).join('');
  const labels = edges.map(e => e.labels.map(l => `<g data-edge-label="${e.id}"><rect x="${l.x}" y="${l.y}" width="${l.width}" height="${l.height}" rx="3" fill="white" fill-opacity=".97"/>${lines(l.lines,l.x+l.width/2,l.y+16,12,'#526277')}</g>`).join('')).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${esc(data.title)}" style="font-family:${esc(FONT)};background:white"><style>.semantic-sigil{fill:none;stroke:currentColor;stroke-width:1.25;opacity:.55}.sigil-fill{fill:currentColor;stroke:none}[data-node-id]:focus{outline:none}[data-node-id]:focus [data-node-box],[data-node-id][data-selected] [data-node-box]{stroke-width:3}</style><defs><marker id="${marker}" viewBox="0 0 10 8" markerWidth="8" markerHeight="7" refX="9" refY="4" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M0 0 L10 4 L0 8 Z" fill="#65748a"/></marker></defs>${frames}${routes}${boxes}${labels}</svg>`;
}
export function renderContent(layout, prefix) {
  const {data}=layout;
  return `<header class="pa-header"><div><h1>${esc(data.title)}</h1>${data.description?`<p>${esc(data.description)}</p>`:''}</div><nav aria-label="图表导出"><button data-export="svg">SVG</button><button data-export="png">PNG</button></nav></header><div class="pa-legend">${(data.domains || []).map(d=>`<span style="--tone:${tone(data,d.id)[0]}"><i></i>${esc(d.label)}</span>`).join('')}</div><div class="pa-map">${renderSvg(layout,prefix)}</div><div class="pa-details">${(data.details || []).map(d=>`<section style="--tone:${tone(data,d.domain)[0]}"><h2>${esc(d.title)}</h2><ul>${d.items.map(item=>`<li>${esc(item)}</li>`).join('')}</ul></section>`).join('')}</div>${(data.notes||[]).map(n=>`<p class="pa-note">${esc(n)}</p>`).join('')}<aside class="pa-popover" role="dialog" aria-label="节点详情" hidden></aside><p class="pa-status" role="status"></p>`;
}
export const styles = `
[data-penecho-architecture]{width:100%;min-width:0;max-width:100%;--pa-ink:#172638;box-sizing:border-box;font-family:${FONT};font-size:14px;line-height:1.55;color:var(--pa-ink);background:white;padding:24px;border:1px solid #dbe3ed;border-radius:12px;position:relative}
[data-penecho-architecture] *{box-sizing:border-box}[data-penecho-architecture] button{font:inherit;border:1px solid #d7e0ec;border-radius:5px;background:#fff;padding:5px 10px;cursor:pointer;color:#39516d}[data-penecho-architecture] button:focus-visible{outline:2px solid #315eea;outline-offset:2px}
.pa-header{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:start;gap:18px;padding-bottom:16px;border-bottom:1px solid #dce3ec}.pa-header h1{margin:0;font-size:24px;line-height:1.3}.pa-header p{margin:6px 0 0;color:#65748a;font-size:14px}.pa-header nav{display:flex;gap:6px;flex:none}.pa-legend{display:flex;gap:18px;flex-wrap:wrap;margin:14px 0 6px;color:#526277;font-size:13px}.pa-legend span{display:flex;align-items:center;gap:6px}.pa-legend i{width:9px;height:9px;border:1.5px solid var(--tone);border-radius:2px}.pa-map{overflow:auto;margin:8px 0 20px}.pa-map>svg{display:block;width:min(100%,var(--pa-map-width,100%));height:auto;min-width:var(--pa-map-min,0px);margin-inline:auto}.pa-details{display:grid;grid-template-columns:repeat(auto-fit,minmax(max(min(235px,100%),calc((100% - 36px)/4)),1fr));gap:12px}.pa-details>section{border:1px solid #dde4ef;border-top:3px solid var(--tone);border-radius:7px;padding:13px 15px}.pa-details h2{font-size:15px;margin:0 0 8px;color:var(--tone)}.pa-details ul{margin:0;padding-left:18px}.pa-details li{margin:4px 0;overflow-wrap:anywhere;color:#526277;font-size:13px}.pa-note{background:#f7f9fc;border-radius:6px;padding:12px 14px;margin:14px 0 0;color:#5d6b80;font-size:13px;overflow-wrap:anywhere}.pa-popover{position:fixed;z-index:10000;max-height:70vh;overflow:auto;width:340px;max-width:calc(100vw - 24px);padding:18px;border:1.5px solid var(--tone,#315eea);border-radius:12px;background:white;box-shadow:0 12px 42px #17263830}.pa-popover h2{font-size:17px;margin:0 26px 6px 0}.pa-popover button{float:right}.pa-popover p,.pa-popover li{font-size:13px;overflow-wrap:anywhere}.pa-popover ul{padding-left:18px}.pa-status:empty{display:none}.pa-status{font-size:12px;color:#a14b19}
`;
