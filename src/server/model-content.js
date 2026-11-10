"use strict";

function imageDataUrlParts(dataUrl) {
  const match=/^data:(image\/(?:png|webp));base64,([A-Za-z0-9+/]+={0,2})$/i.exec(String(dataUrl||""));
  if(!match)return null;
  const mimeType=match[1].toLowerCase(),base64=match[2],buffer=Buffer.from(base64,"base64"),extension=mimeType==="image/webp"?"webp":"png";
  return{mimeType,base64,buffer,bytes:buffer.length,extension,file:`atlas.${extension}`};
}
function completeTopLevelJsonObjects(text) {
  const source=String(text??""),objects=[];
  let start=-1,depth=0,inString=false,escaped=false;
  for(let index=0;index<source.length;index++){
    const character=source[index];
    if(start<0){
      if(character==="{"){start=index;depth=1}
      continue;
    }
    if(inString){
      if(escaped)escaped=false;
      else if(character==="\\")escaped=true;
      else if(character==='"')inString=false;
      continue;
    }
    if(character==='"'){inString=true;continue}
    if(character==="{"){depth++;continue}
    if(character!=="}")continue;
    depth--;
    if(depth!==0)continue;
    try { objects.push(JSON.parse(source.slice(start,index+1))); } catch {}
    start=-1;
  }
  return objects;
}

module.exports = { imageDataUrlParts, completeTopLevelJsonObjects };
