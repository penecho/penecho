"use strict";
process.env.UV_THREADPOOL_SIZE = "16";
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const writing=process.argv[2]==="--write",root=path.resolve(process.argv[writing?3:2]||__dirname),manifest=path.join(root,"files.sha256.json");
const hash=file=>crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
if(writing){
 const files=[];
 function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const full=path.join(dir,entry.name);if(entry.isDirectory())walk(full);else if(entry.isFile()&&full!==manifest)files.push({path:path.relative(root,full),sha256:hash(full)});else if(!entry.isFile())throw Error("Unexpected package symlink: "+full);}}
 walk(root);fs.writeFileSync(manifest,JSON.stringify(files,null,2)+"\n");console.log(`Manifest written: ${files.length} files`);
}else{
 const files=JSON.parse(fs.readFileSync(manifest,"utf8").replace(/^\uFEFF/,""));
 let next=0,done=0;
 async function worker(){while(next<files.length){const e=files[next++],full=path.resolve(root,e.path);if(!full.startsWith(root+path.sep))throw Error("Invalid package path: "+e.path);const data=await fs.promises.readFile(full);if(crypto.createHash("sha256").update(data).digest("hex")!==e.sha256.toLowerCase())throw Error("File verification failed: "+e.path);done++;if(done%10000===0)console.log(`Verified ${done}/${files.length} files`);}}
 Promise.all(Array.from({length:16},worker)).then(()=>console.log(`Verified ${files.length} files`)).catch(error=>{console.error(error.message);process.exitCode=1;});
}
