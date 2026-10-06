"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
// Release checks can point this same resource test at an extracted npm package.
const root=path.resolve(process.env.PENECHO_RESOURCE_TEST_ROOT||path.join(__dirname,'..'));
test('every startup script and stylesheet, MathJax extension and Widget host loads from the server',async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'penecho-resource-test-'));
  fs.writeFileSync(path.join(temp,'config.env'),'');
  const child=spawn(process.execPath,[path.join(root,'server.js')],{cwd:root,env:{...process.env,NODE_ENV:'test',PENECHO_TEST_OPEN_ACCESS:'1',PENECHO_STATE_DIR:path.join(temp,'state'),PENECHO_CLOUD_STATE_DIR:path.join(temp,'state'),PENECHO_CONFIG_FILE:path.join(temp,'config.env'),HOST:'127.0.0.1',PORT:'0',AI_PROVIDER:'api',AI_API_KEY:'fixture',AI_API_URL:'http://127.0.0.1:1/v1',AI_API_MODEL:'fixture',PENECHO_JEVISION_ENABLED:'false',PENECHO_CANVAS_AGENT_AUTO_OPEN:'false',PENECHO_REQUEST_TRACE:'false'},stdio:['ignore','pipe','pipe']});
  try{
    const origin=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('Isolated server startup timed out')),15000);child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/PenEcho: http:\/\/127\.0\.0\.1:(\d+)/);if(match){clearTimeout(timer);resolve(`http://127.0.0.1:${match[1]}`);}});child.once('exit',code=>{clearTimeout(timer);reject(Error(`Isolated server exited: ${code}`));});});
    const page=await fetch(origin),html=await page.text(),cookie=(page.headers.get('set-cookie')||'').split(';')[0];
    assert.equal(page.status,200);assert.equal(page.headers.get('cache-control'),'no-store');assert.equal(page.headers.get('etag'),null);
    const resources=[...new Set([...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(match=>match[1]).filter(url=>/\.(?:js|css)(?:\?|$)/.test(url)&&!url.startsWith('http')))];
    assert.ok(resources.length>30);
    for(const resource of resources){
      const response=await fetch(new URL(resource,`${origin}/`),{headers:{cookie}});assert.equal(response.status,200,resource);
      const bytes=Buffer.from(await response.arrayBuffer()),pathname=new URL(resource,`${origin}/`).pathname;
      if(pathname.startsWith('/api/')){assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('etag'),null);continue;}
      assert.deepEqual(bytes,fs.readFileSync(path.join(root,'public',pathname)),resource);
      if(bytes.length>=1024)assert.equal(response.headers.get('content-encoding'),'gzip',resource);
      assert.ok(response.headers.get('etag'),resource);
      const refresh=await fetch(new URL(resource,`${origin}/`),{headers:{cookie,'If-None-Match':response.headers.get('etag')}});assert.equal(refresh.status,304,resource);await refresh.arrayBuffer();
      if(pathname.endsWith('/tex-svg.js'))assert.equal(crypto.createHash('sha384').update(bytes).digest('base64'),html.match(/integrity="sha384-([^"]+)"/)[1]);
    }
    for(const resource of ['/vendor/mathjax-3.2.2/es5/input/tex/extensions/mhchem.js','/vendor/mathjax-3.2.2/es5/sre/mathmaps/en.json','/vendor/mathjax-3.2.2/es5/output/chtml/fonts/woff-v2/MathJax_Main-Regular.woff','/widget-host.html','/widget-host.js']){
      const response=await fetch(`${origin}${resource}`);assert.equal(response.status,200,resource);assert.deepEqual(Buffer.from(await response.arrayBuffer()),fs.readFileSync(path.join(root,'public',resource)),resource);
      if(resource.includes('/vendor/mathjax-'))assert.equal(response.headers.get('cloudflare-cdn-cache-control'),'public, max-age=31536000, immutable');
    }
    const configuration=await fetch(`${origin}/api/config.js`,{headers:{cookie,'If-None-Match':'*'}});assert.equal(configuration.status,200);assert.equal(configuration.headers.get('etag'),null);assert.equal(configuration.headers.get('cache-control'),'no-store');assert.match(await configuration.text(),/"cloudAccountSignedIn":false/);
  }finally{if(child.exitCode===null&&child.signalCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;}fs.rmSync(temp,{recursive:true,force:true});}
});
