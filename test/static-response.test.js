"use strict";
require("./helpers/safety.js");
const test=require("node:test"),assert=require("node:assert/strict"),http=require("node:http"),fs=require("node:fs/promises"),os=require("node:os"),path=require("node:path"),zlib=require("node:zlib");
const {createStaticResponder}=require('../src/server/static-response.js');
function request(port,{headers={},method='GET'}={}){return new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port,path:'/app.js',headers,method},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,bytes:Buffer.concat(chunks)}));});req.on('error',reject);req.end();});}
test('compressed and plain resources, HEAD, validators and live updates preserve the exact bytes',async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'penecho-static-')),file=path.join(temp,'app.js'),bytes=Buffer.from('const message="preserve resource contents";\n'.repeat(3000));
  await fs.writeFile(file,bytes);
  const send=createStaticResponder(),server=http.createServer((req,res)=>void send(req,res,file,{'Content-Type':'application/javascript','Cache-Control':'public, max-age=0, must-revalidate'}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
  try{
    const plain=await request(port);assert.equal(plain.status,200);assert.deepEqual(plain.bytes,bytes);assert.equal(plain.headers['content-encoding'],undefined);
    const zipped=await request(port,{headers:{'Accept-Encoding':'br, gzip'}});assert.equal(zipped.headers['content-encoding'],'gzip');assert.equal(zipped.headers.vary,'Accept-Encoding');assert.deepEqual(zlib.gunzipSync(zipped.bytes),bytes);assert.ok(zipped.bytes.length<bytes.length/10);
    const head=await request(port,{method:'HEAD',headers:{'Accept-Encoding':'gzip'}});assert.equal(head.bytes.length,0);assert.equal(Number(head.headers['content-length']),zipped.bytes.length);
    const denied=await request(port,{headers:{'Accept-Encoding':'gzip;q=0, *;q=1'}});assert.deepEqual(denied.bytes,bytes);assert.equal(denied.headers['content-encoding'],undefined);
    const cached=await request(port,{headers:{'If-None-Match':`"other", ${plain.headers.etag}`,'Accept-Encoding':'gzip'}});assert.equal(cached.status,304);assert.equal(cached.bytes.length,0);
    const next=Buffer.from(bytes.toString().replaceAll('preserve','updated!'));await fs.writeFile(file,next);
    const updated=await request(port,{headers:{'If-None-Match':plain.headers.etag,'Accept-Encoding':'gzip'}});assert.equal(updated.status,200);assert.notEqual(updated.headers.etag,plain.headers.etag);assert.deepEqual(zlib.gunzipSync(updated.bytes),next);
  }finally{await new Promise(resolve=>server.close(resolve));await fs.rm(temp,{recursive:true,force:true});}
});
test('private HTML never returns a validator or 304 and still issues its session cookie',async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'penecho-private-page-')),file=path.join(temp,'index.html');await fs.writeFile(file,'<html>session page</html>');
  const send=createStaticResponder(),server=http.createServer((req,res)=>void send(req,res,file,{'Content-Type':'text/html','Cache-Control':'no-store','Set-Cookie':'fixture=session; HttpOnly'}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{const response=await request(server.address().port,{headers:{'If-None-Match':'*'}});assert.equal(response.status,200);assert.equal(response.headers.etag,undefined);assert.equal(response.headers['cache-control'],'no-store');assert.match(response.headers['set-cookie'][0],/HttpOnly/);}
  finally{await new Promise(resolve=>server.close(resolve));await fs.rm(temp,{recursive:true,force:true});}
});
test("a page asks for its scripts and styles by their content, so a browser that has them never asks again",async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'penecho-page-')),page=path.join(temp,'index.html'),app=path.join(temp,'app.js');
  await fs.mkdir(path.join(temp,'lines'));await fs.writeFile(app,'one');await fs.writeFile(path.join(temp,'lines','a.css'),'a{}');
  await fs.writeFile(page,'<script src="/api/config.js"></script><link rel="stylesheet" href="lines/a.css"><script\n  defer\n  src="vendor/mathjax-3.2.2/es5/tex-svg.js"></script><script src="app.js"></script><script src="gone.js"></script><a href="app.js">app.js</a>');
  const send=createStaticResponder(),server=http.createServer((req,res)=>{const url=new URL(req.url,'http://x');if(url.searchParams.has('page'))return void send(req,res,page,{'Content-Type':'text/html','Cache-Control':'no-store','Set-Cookie':'fixture=session'},{page:true});return void send(req,res,app,{'Content-Type':'application/javascript','Cache-Control':'public, max-age=0, must-revalidate'},{version:url.searchParams.get('v')||''});});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
  try{
    const first=await fetch(`${base}/?page`),html=await first.text(),version=/src="app\.js\?v=([a-f0-9]{10})"/.exec(html)?.[1];
    assert.ok(version,html);assert.equal(first.headers.get('cache-control'),'no-store');assert.equal(first.headers.get('etag'),null);assert.match(first.headers.get('set-cookie'),/fixture/);
    assert.match(html,/href="lines\/a\.css\?v=[a-f0-9]{10}"/);
    for(const kept of ['src="/api/config.js"','src="vendor/mathjax-3.2.2/es5/tex-svg.js"','src="gone.js"','<a href="app.js">app.js</a>'])assert.ok(html.includes(kept),kept);
    assert.equal((await fetch(`${base}/app.js?v=${version}`)).headers.get('cache-control'),'public, max-age=31536000, immutable');
    await fs.writeFile(app,'two, changed');
    const next=await (await fetch(`${base}/?page`)).text(),changed=/src="app\.js\?v=([a-f0-9]{10})"/.exec(next)[1];
    assert.notEqual(changed,version);
    assert.equal((await fetch(`${base}/app.js?v=${version}`)).headers.get('cache-control'),'public, max-age=0, must-revalidate','the old address is not kept for good with the new content');
    assert.equal(await (await fetch(`${base}/app.js?v=${changed}`)).text(),'two, changed');
    const plain=await request(server.address().port,{});assert.equal(plain.headers['cache-control'],'public, max-age=0, must-revalidate');
  }finally{await new Promise(resolve=>server.close(resolve));await fs.rm(temp,{recursive:true,force:true});}
});
