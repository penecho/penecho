// Standalone browser fixture server; never starts PenEcho or opens user documents.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../../..');
const routes={'/':'testcase/mcp-layout-capture/2026-09-18/sandbox.html',
 '/widget-host.html':'public/widget-host.html','/widget-host.js':'public/widget-host.js',
 '/widget-renderer.js':'public/vendor/penecho-dom-renderer.js',
 '/architecture-runtime.js':'public/vendor/architecture-runtime.js','/architecture-worker.js':'public/vendor/architecture-worker.js',
 '/workflow-runtime.js':'public/vendor/workflow-runtime.js','/sequence-runtime.js':'public/vendor/sequence-runtime.js'};
const server=http.createServer((req,res)=>{
 const u=new URL(req.url,'http://localhost');
 if(req.method==='POST'&&u.pathname==='/evidence'){
  let body='',size=0;req.on('data',chunk=>{size+=chunk.length;if(size>32*1024*1024)req.destroy();else body+=chunk;});
  req.on('end',()=>{try{const {id,report,full,viewport}=JSON.parse(body);if(!/^[a-z0-9-]+$/.test(id))throw Error('Invalid id');
   const dir=path.join(__dirname,'evidence');fs.mkdirSync(dir,{recursive:true});
   fs.writeFileSync(path.join(dir,id+'.json'),JSON.stringify(report,null,2)+'\n');
   for(const [suffix,data]of [['full',full],['viewport',viewport]]){if(!/^data:image\/png;base64,/.test(data))throw Error('Invalid image');fs.writeFileSync(path.join(dir,id+'-'+suffix+'.png'),Buffer.from(data.split(',')[1],'base64'));}
   res.writeHead(200);res.end('saved');
  }catch(e){res.writeHead(400);res.end(e.message);}});return;
 }
 let file=routes[u.pathname];
 if(/^\/(wf-[a-z0-9-]+|seq-[a-z0-9-]+)\.json$/.test(u.pathname))file='testcase/mcp-layout-capture/2026-09-18'+u.pathname;
 if(!file||!fs.existsSync(path.join(root,file))){res.writeHead(404);res.end();return;}
 res.writeHead(200,{'content-type':file.endsWith('.js')?'application/javascript':file.endsWith('.json')?'application/json':'text/html','cache-control':'no-store'});
 fs.createReadStream(path.join(root,file)).pipe(res);
});
server.listen(0,'127.0.0.1',()=>console.log(`Capture/layout fixtures: http://127.0.0.1:${server.address().port}/`));
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
