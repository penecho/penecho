// Standalone test fixture server, NOT a PenEcho application process. Serves only
// named test fixtures and production Widget assets; no credentials or app state.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../../..'),fixtures=require('./fixtures.cjs');
const routes={
 '/':'testcase/workflow-local/2026-09-18/sandbox.html',
 '/public/widget-host.html':'public/widget-host.html','/public/widget-host.js':'public/widget-host.js',
 '/public/widget-renderer.js':'public/vendor/penecho-dom-renderer.js',
 '/public/architecture-runtime.js':'public/vendor/architecture-runtime.js',
 '/public/architecture-worker.js':'public/vendor/architecture-worker.js',
 '/public/sequence-runtime.js':'public/vendor/sequence-runtime.js',
 '/public/workflow-runtime.js':'public/vendor/workflow-runtime.js',
};
const server=http.createServer((req,res)=>{
 const u=new URL(req.url,'http://localhost');
 if(u.pathname==='/fixture.json'){
  const data=fixtures[u.searchParams.get('id')];
  res.writeHead(data?200:404,{'content-type':'application/json','cache-control':'no-store'});return res.end(JSON.stringify(data||{}));
 }
 const relative=routes[u.pathname];if(!relative){res.writeHead(404);return res.end();}
 res.writeHead(200,{'content-type':relative.endsWith('.js')?'application/javascript':'text/html','access-control-allow-origin':'*','cache-control':'no-store'});
 fs.createReadStream(path.join(root,relative)).pipe(res);
});
server.listen(8768,'127.0.0.1',()=>console.log('Workflow Widget harness: http://127.0.0.1:8768/'));
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
