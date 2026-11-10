'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const host=fs.readFileSync(path.join(__dirname,'../public/widget-host.js'),'utf8');
const start=host.indexOf('  function resolveImageAssets('),end=host.indexOf('  function csp(',start);
const context=vm.createContext({});vm.runInContext(host.slice(start,end),context);
const ref='penecho-asset:'+'a'.repeat(64),image='data:image/png;base64,iVBORw0KGgo=';
test('Widget resolver expands document assets for HTML and CSS without changing authored source',()=>{
 const html=`<img src="${ref}"><style>.hero{background-image:url('${ref}')}</style>`;
 const rendered=context.resolveImageAssets(html,{[ref]:image});
 assert.equal(rendered,html.split(ref).join(image));assert.ok(html.includes(ref));
 assert.throws(()=>context.resolveImageAssets(html,{}),/unavailable/);
 assert.throws(()=>context.resolveImageAssets(html,{[ref]:'file:///secret.png'}),/invalid/);
});
test('Widget image expansion bounds repeated references as well as unique payload size',()=>{
 const large='data:image/png;base64,'+'a'.repeat(700000);
 assert.throws(()=>context.resolveImageAssets(`<img src="${ref}">`.repeat(24),{[ref]:large}),/expansion exceeds/);
});
