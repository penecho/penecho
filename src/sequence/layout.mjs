import schema from './schema.js';
import { wrap, measureFallback } from '../diagrams/text.mjs';

// Archify sequence's ordered participant columns, lifelines, horizontal messages,
// return dashes and temporal frames, with measured geometry owned by PenEcho.
// Unlike its CLI format, semantic input never needs x/y or a fixed viewBox.
export function layoutSequence(input, measure=measureFallback, options={}) {
  const started=performance.now(), data=schema.validateSequence(input), count=data.participants.length;
  const requested=Number(options.width), available=Number.isFinite(requested) && requested>0 ? requested : 1200;
  const lastSelf=data.messages.some(m => m.from === m.to && m.from === data.participants.at(-1).id);
  const margin=32, gap=60, tail=lastSelf?132:0;
  const boxWidth=Math.floor(Math.max(136,Math.min(204,(available-margin*2-tail-gap*(count-1))/count)));
  const width=margin*2+boxWidth*count+gap*(count-1)+tail;
  const participants=data.participants.map((p,i) => ({...p,x:margin+i*(boxWidth+gap),y:16,width:boxWidth,
    cx:margin+boxWidth/2+i*(boxWidth+gap),titleLines:wrap(p.label,boxWidth-24,15,measure),subtitleLines:wrap(p.subtitle,boxWidth-24,12,measure)}));
  const headerHeight=Math.max(...participants.map(p => 28+p.titleLines.length*21+(p.subtitleLines.length?6+p.subtitleLines.length*17:0)));
  participants.forEach(p => p.height=headerHeight);
  const byId=new Map(participants.map(p => [p.id,p])), indices=new Map(data.messages.map((m,i) => [m.id,i]));
  const fragments=(data.fragments || []).map((f,i) => ({...f,index:i,start:indices.get(f.from),end:indices.get(f.to)}));
  for (const f of fragments) {
    f.depth=fragments.filter(p => p!==f && p.start<=f.start && p.end>=f.end).length;
    f.x=12+f.depth*10; f.width=width-2*f.x;
    // Keep temporal-frame labels in the clear lane beside the first lifeline,
    // rather than painting them across a long-lived activation bar.
    f.titleX=Math.max(f.x+12,participants[0].cx+18);
    f.titleWidth=Math.max(1,Math.min(f.x+f.width-14,participants[1]?.cx-18 || Infinity)-f.titleX);
    f.titleLines=wrap(`${f.kind}  [${f.label}]`,f.titleWidth,13,measure);
    f.branches=(f.branches || []).map(b => ({...b,index:indices.get(b.from),lines:wrap(`[${b.label}]`,f.titleWidth,13,measure)}));
  }
  const messages=[]; let cursor=16+headerHeight+32;
  data.messages.forEach((message,index) => {
    // Branch dividers belong outside child frames that start at the same message.
    for (const f of fragments) for (const b of f.branches) if (b.index===index) {
      b.y=cursor; cursor+=b.lines.length*18+18;
    }
    for (const f of fragments.filter(f=>f.start===index).sort((a,b)=>a.depth-b.depth)) {
      f.y=cursor;cursor+=f.titleLines.length*18+20;
    }
    const from=byId.get(message.from), to=byId.get(message.to), self=from===to, direction=to.cx>=from.cx?1:-1;
    const start=from.cx+direction*7, end=to.cx-direction*7;
    const loopWidth=Math.min(172,boxWidth+gap-28);
    const labelWidth=self?loopWidth-18:Math.abs(to.cx-from.cx)-32;
    const labelX=self?from.cx+16:Math.min(from.cx,to.cx)+16;
    const titleLines=wrap(`${index+1}. ${message.label}`,labelWidth,13,measure);
    const noteLines=wrap(message.note,labelWidth,12,measure);
    const labelY=cursor, arrowY=cursor+titleLines.length*18+9;
    const bottom=arrowY+(self?26:0);
    const points=self?[[start,arrowY],[from.cx+loopWidth,arrowY],[from.cx+loopWidth,bottom],[start,bottom]]:[[start,arrowY],[end,arrowY]];
    messages.push({...message,index,key:`message-${index}`,kind:message.kind || 'call',self,points,arrowY,bottom,labelX,labelY,labelWidth,titleLines,noteLines,
      noteY:bottom+14,domain:from.domain});
    cursor=bottom+(noteLines.length?18+noteLines.length*17:0)+26;
    for (const f of fragments.filter(f=>f.end===index).sort((a,b)=>b.depth-a.depth)) { f.height=cursor-f.y;cursor+=12; }
  });
  const activations=(data.activations || []).map(a => ({...a,start:indices.get(a.from),end:indices.get(a.to)}));
  for (const a of activations) {
    const depth=activations.filter(p => p!==a && p.participant===a.participant && p.start<=a.start && p.end>=a.end).length;
    a.x=byId.get(a.participant).cx-6+depth*5; a.width=12;
    a.y=messages[a.start].arrowY; a.height=Math.max(18,messages[a.end].bottom-a.y+8);
    a.domain=byId.get(a.participant).domain;
  }
  return {data,participants,messages,fragments,activations,width,height:cursor+24,lifelineTop:16+headerHeight,lifelineBottom:cursor+4,
    mode:width>available?'scroll':'fit',layoutMs:performance.now()-started};
}
