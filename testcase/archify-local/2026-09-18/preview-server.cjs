// Development harness for the actual widget-host sandbox; no application credentials/state.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../../..');
http.createServer((req,res)=>{
 const u=new URL(req.url,'http://localhost'),routes={'/public/widget-renderer.js':'public/vendor/penecho-dom-renderer.js','/public/architecture-runtime.js':'public/vendor/architecture-runtime.js','/public/architecture-worker.js':'public/vendor/architecture-worker.js'};
 const file=path.resolve(root,routes[u.pathname]||'.'+decodeURIComponent(u.pathname));
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);return res.end();}
 res.writeHead(200,{'Content-Type':file.endsWith('.js')?'application/javascript':file.endsWith('.json')?'application/json':'text/html','Access-Control-Allow-Origin':'*','Cache-Control':'no-store'});fs.createReadStream(file).pipe(res);
}).listen(8767,'127.0.0.1',()=>console.log('Architecture sandbox harness http://127.0.0.1:8767'));
