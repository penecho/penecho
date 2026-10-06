"use strict";
// Run the required service/session checks against disposable databases, preserving existing UAT services.
const fs=require("node:fs"),path=require("node:path"),{execFileSync,spawn}=require("node:child_process"),{createRequire}=require("node:module");
const cloudRoot=path.resolve(__dirname,"../../penecho_cloud"),cloudRequire=createRequire(path.join(cloudRoot,"package.json")),
  directory=path.join(__dirname,"../docs/verification/basic-uat-regression-20260930"),
  suffix=`${process.pid}-${Date.now()}`,pgName=`penecho-basic-pg-${suffix}`,redisName=`penecho-basic-redis-${suffix}`,created=[];
const docker=(...args)=>execFileSync("docker",args,{encoding:"utf8",timeout:30000}).trim();
async function main(){
  try{
    docker("run","--detach","--rm","--name",pgName,"--publish","127.0.0.1::5432","--env","POSTGRES_USER=regression","--env","POSTGRES_PASSWORD=regression-only","--env","POSTGRES_DB=regression","postgres:16-bookworm");created.push(pgName);
    docker("run","--detach","--rm","--name",redisName,"--publish","127.0.0.1::6379","redis:7-bookworm");created.push(redisName);
    const pgPort=docker("port",pgName,"5432/tcp").split(":").at(-1),redisPort=docker("port",redisName,"6379/tcp").split(":").at(-1),
      databaseUrl=`postgres://regression:regression-only@127.0.0.1:${pgPort}/regression`,redisUrl=`redis://127.0.0.1:${redisPort}`;
    const {Client}=cloudRequire("pg");let ready=false;
    for(let attempt=0;attempt<60;attempt++){
      const client=new Client({connectionString:databaseUrl,connectionTimeoutMillis:1000});
      try{await client.connect();await client.query("SELECT 1");ready=true;break;}catch{}finally{await client.end().catch(()=>{});}
      await new Promise(resolve=>setTimeout(resolve,250));
    }
    if(!ready)throw Error("Disposable PostgreSQL did not become ready.");
    console.log("Disposable PostgreSQL and Redis are ready; checking Suggest admission, quotas, and login-session persistence.");
    const log=fs.createWriteStream(path.join(directory,"cloud-required-integrations.log"));
    const child=spawn(process.execPath,["--test","test/penecho-llm-admission.integration.test.mjs","test/penecho-llm-postgres.integration.test.mjs","test/sessions-redis.integration.test.mjs"],{
      cwd:cloudRoot,env:{...process.env,PENECHO_TEST_DATABASE_URL:databaseUrl,PENECHO_TEST_REDIS_URL:redisUrl,PENECHO_SESSIONS_TEST_REDIS_URL:redisUrl},stdio:["ignore","pipe","pipe"],
    });
    for(const stream of [child.stdout,child.stderr])stream.on("data",data=>{process.stdout.write(data);log.write(data);});
    const timer=setTimeout(()=>child.kill("SIGTERM"),120000);
    const code=await new Promise((resolve,reject)=>{child.once("error",reject);child.once("exit",resolve);});clearTimeout(timer);
    await new Promise(resolve=>log.end(resolve));
    if(code!==0)throw Error(`Cloud required integrations exited with code ${code}.`);
  }finally{
    for(const name of created.reverse())docker("rm","--force",name);
    console.log("Disposable test containers removed; existing UAT services preserved.");
  }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
