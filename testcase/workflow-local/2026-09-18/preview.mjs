// Pre-rendered baseline for the still-running pre-workflow server. This is not
// evidence of the browser Worker path; native runtime acceptance is separate.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import ELK from 'elkjs/lib/elk.bundled.js';
import fixtures from './fixtures.cjs';
import {layoutWorkflow} from '../../../src/workflow/layout.mjs';
import {renderContent,styles} from '../../../src/workflow/render.mjs';
const dir=path.dirname(fileURLToPath(import.meta.url));
const revision=process.argv[2]||'r1';
if(!/^r\d+$/.test(revision))throw Error('Expected revision r1, r2, ...');
const interactions=(await build({stdin:{contents:"import {bindInteractions} from './src/workflow/interactions.mjs';for(const root of document.querySelectorAll('[data-penecho-workflow]'))bindInteractions(root,JSON.parse(root.querySelector('script[data-preview-source]').textContent));",resolveDir:process.cwd()},bundle:true,platform:'browser',format:'iife',minify:true,write:false})).outputFiles[0].text;
for(const [id,data] of Object.entries(fixtures)){
  const layout=await layoutWorkflow(data,new ELK(),undefined,{width:1180});
  if(layout.issues.length)throw Error(layout.issues.join('; '));
  const json=JSON.stringify(data).replaceAll('<','\\u003c');
  const html=`<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:white;font-family:Arial,sans-serif}body{padding:8px}${styles}</style></head><body><section data-penecho-workflow style="--pa-map-width:${layout.width}px;--pa-map-min:${layout.width}px"><script type="application/json" data-preview-source>${json}</script>${renderContent(layout,'preview-'+id)}</section><script>${interactions}</script></body></html>`;
  fs.writeFileSync(path.join(dir,id+'.semantic.json'),JSON.stringify(data,null,2));
  fs.writeFileSync(path.join(dir,id+'.preview-'+revision+'.html'),html);
  console.log(JSON.stringify({id,width:layout.width,height:layout.height,mode:layout.mode,layoutMs:layout.layoutMs}));
}
