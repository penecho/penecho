import { textUnits } from '../architecture/vendor/archify/utils.mjs';
export const FONT = 'Arial, "PingFang SC", "Microsoft YaHei", sans-serif';
export const measureFallback = (s, px) => textUnits(s) * px * 0.58;
export function wrap(text, width, size, measure = (s, px) => textUnits(s) * px * 0.58) {
  const lines = []; let line = '';
  const flush=()=>{if(line.trim())lines.push(line.trim());line='';};
  // Preserve short Latin words/paths and parenthetical phrases. Oversized tokens
  // can still wrap; a closing punctuation mark must not occupy a line by itself.
  const tokens=String(text || '').match(/\([^()\n]*\)|（[^（）\n]*）|[A-Za-z0-9_./:+-]+|[ \t]+|\n|[^\s]/gu) || [];
  for (const token of tokens) {
    if(token==='\n'){flush();continue;}
    const parts=measure(token,size)>width
      ? (token.match(/[A-Za-z0-9_./:+-]+|[ \t]+|[^\s]/gu) || []).flatMap(part=>measure(part,size)>width?Array.from(part):[part])
      : [token];
    for(const part of parts) {
      if(!line){line=part.trimStart();continue;}
      if(measure(line+part,size)<=width){line+=part;continue;}
      if(/^[，。！？；：、）】》〉”’.,!?;:)\]}]$/u.test(part)) {
        const trimmed=line.trimEnd(), word=trimmed.match(/[A-Za-z0-9_./:+-]+$/u)?.[0];
        const tail=word && measure(word+part,size)<=width ? word : Array.from(trimmed).at(-1) || '';
        line=trimmed.slice(0,-tail.length);flush();line=tail+part;
      } else {
        let opening='';if(/[（(【《“‘]$/u.test(line)){opening=line.slice(-1);line=line.slice(0,-1);}
        flush();line=opening+part.trimStart();
      }
    }
  }
  flush();
  return lines;
}

