"use strict";
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
module.exports=function stampDiagramAssets(root,outputs,check) {
  const file=path.join(root,'public/widget-host.js'),before=fs.readFileSync(file,'utf8');
  let after=before;
  for(const [name,content]of outputs) {
    if(!name.endsWith('.js'))continue;
    const asset=path.basename(name),version=createHash('sha256').update(content).digest('hex').slice(0,12);
    const pattern=new RegExp(asset.replaceAll('.','\\.')+'\\?v=[a-zA-Z0-9]+','g');
    if(!pattern.test(after))throw Error(`Missing Widget asset URL: ${asset}`);
    after=after.replace(pattern,`${asset}?v=${version}`);
  }
  if(check&&after!==before)throw Error('Widget diagram asset versions are stale; rebuild the diagrams.');
  if(!check&&after!==before)fs.writeFileSync(file,after);
};
