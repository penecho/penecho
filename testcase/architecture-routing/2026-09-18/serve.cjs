// Bounded static fixture server: real Widget Host/assets, no PenEcho app or state.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../../..');
const routes={
 '/':'testcase/architecture-routing/2026-09-18/browser.html',
 '/input.json':'testcase/architecture-routing/2026-09-18/input.json',
 '/public/widget-host.html':'public/widget-host.html',
 '/public/widget-host.js':'public/widget-host.js',
 '/public/widget-renderer.js':'public/vendor/penecho-dom-renderer.js',
 '/public/architecture-runtime.js':'public/vendor/architecture-runtime.js',
 '/public/architecture-worker.js':'public/vendor/architecture-worker.js',
};
http.createServer((req,res)=>{
 const file=routes[new URL(req.url,'http://localhost').pathname];
 if(!file){res.writeHead(404);return res.end();}
 res.writeHead(200,{'Content-Type':file.endsWith('.js')?'application/javascript':file.endsWith('.json')?'application/json':'text/html','Access-Control-Allow-Origin':'*','Cache-Control':'no-store'});
 fs.createReadStream(path.join(root,file)).pipe(res);
}).listen(8767,'127.0.0.1',()=>console.log('Architecture routing fixture: http://127.0.0.1:8767'));
