'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {configureHttpClient,configurationFragment}=require('../src/server/mcp/http-client-config');
const connection={url:'https://127.0.0.1:1234/mcp',accessToken:'a'.repeat(64),caFile:'C:\\Users\\名字\\ca.pem'};
test('Codex preserves array tables before and after the replaced PenEcho subtree',()=>{
  const {replaceCodex}=require('../src/server/mcp/http-client-config');
  const before='[[model_providers.custom.models]] # retained\nid = "before"\n';
  const after='[[model_providers.custom.models]]\nid = "after"\n';
  const output=replaceCodex(before+'[mcp_servers.penecho]\ncommand = "old"\n[mcp_servers.penecho.env]\nOLD = "remove"\n'+after,configurationFragment('codex',connection));
  assert.ok(output.startsWith(before));assert.ok(output.includes(after));assert.ok(!output.includes('"old"'));assert.ok(!output.includes('"remove"'));
  assert.equal((output.match(/\[mcp_servers.penecho\]/g)||[]).length,1);
});
test('Codex distinguishes quoted dotted keys and supports quoted bracket characters',()=>{
  const {replaceCodex}=require('../src/server/mcp/http-client-config');
  const kept='["mcp_servers.penecho"]\nkeep = 1\n[mcp_servers."penecho.env"]\nkeep = 2\n[projects."folder]name"]\nkeep = 3\n';
  const output=replaceCodex(kept+'["mcp_servers" . "penecho"]\ncommand = "remove"\n',configurationFragment('codex',connection));
  assert.ok(output.startsWith(kept));assert.ok(!output.includes('"remove"'));
});
test('Codex rejects malformed or ambiguous headers with a stable error code',()=>{
  const {replaceCodex}=require('../src/server/mcp/http-client-config');
  for(const source of ['[[other]\nx=1','[other.]\nx=1','[[mcp_servers.penecho]]\nx=1'])assert.throws(()=>replaceCodex(source,''),{code:'MCP_CONFIG_UNSUPPORTED'});
});
function home(t){const dir=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'penecho-http-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
test('Claude preserves other entries and project scope',t=>{const dir=home(t);fs.writeFileSync(dir+'/.claude.json',JSON.stringify({projects:{demo:{mcpServers:{x:{}}}},mcpServers:{other:{url:'else'}}}));const result=configureHttpClient('claude',connection,{home:dir,env:{}});const config=JSON.parse(fs.readFileSync(dir+'/.claude.json'));assert.ok(config.projects.demo);assert.equal(config.mcpServers.other.url,'else');assert.equal(config.mcpServers.penecho.type,'http');assert.equal(result.processEnvironment.NODE_EXTRA_CA_CERTS,connection.caFile);assert.ok(result.trustRequired&&result.reloadRequired);assert.ok(!JSON.stringify(result).includes(connection.accessToken));});
test('Codex removes only PenEcho tables and preserves other subtable scopes',t=>{const dir=home(t);fs.mkdirSync(dir+'/.codex');fs.writeFileSync(dir+'/.codex/config.toml','model = "x"\n[mcp_servers.penecho]\ncommand = "old"\n[mcp_servers.penecho.env]\nX = "old"\n[mcp_servers.other]\nurl = "other"\n[mcp_servers.other.http_headers]\nX = "keep"\n');configureHttpClient('codex',connection,{home:dir,env:{}});const result=fs.readFileSync(dir+'/.codex/config.toml','utf8');assert.ok(result.includes('X = "keep"'));assert.ok(!result.includes('"old"'));assert.equal((result.match(/\[mcp_servers.penecho\]/g)||[]).length,1);});
test('Hermes remains manual, JSON explicitly exports secret, symlinks rejected',t=>{const dir=home(t);assert.equal(configureHttpClient('hermes',connection,{home:dir,env:{}}).configured,false);assert.ok(!JSON.stringify(configureHttpClient('hermes',connection,{home:dir,env:{}})).includes(connection.accessToken));assert.ok(JSON.stringify(configurationFragment('json',connection)).includes(connection.accessToken));fs.writeFileSync(dir+'/target','{}');fs.symlinkSync(dir+'/target',dir+'/.claude.json');assert.throws(()=>configureHttpClient('claude',connection,{home:dir,env:{}}),/symlink/);});
test('native config paths respect explicit client environment',t=>{const dir=home(t),env={CODEX_HOME:'codex-custom',CLAUDE_CONFIG_DIR:'claude-custom'};const codex=configureHttpClient('codex',connection,{home:dir,rootDirectory:dir,env});const claude=configureHttpClient('claude',connection,{home:dir,rootDirectory:dir,env});assert.equal(codex.configFile,path.join(dir,'codex-custom/config.toml'));assert.equal(claude.configFile,path.join(dir,'claude-custom/.claude.json'));assert.equal(fs.existsSync(dir+'/.claude.json'),false);});
test('concurrent external config edit is preserved and reports conflict',t=>{const dir=home(t),file=path.join(dir,'.claude.json');fs.writeFileSync(file,'{}');const write=fs.writeFileSync;fs.writeFileSync=function(target,...args){const result=write.call(fs,target,...args);if(String(target).startsWith(file+'.')&&String(target).endsWith('.tmp'))write.call(fs,file,'{"newer":true}');return result;};try{assert.throws(()=>configureHttpClient('claude',connection,{home:dir,env:{}}),{code:'CONFIG_CONFLICT'});assert.equal(fs.readFileSync(file,'utf8'),'{"newer":true}');assert.deepEqual(fs.readdirSync(dir),['.claude.json']);}finally{fs.writeFileSync=write;}});
test('HTTP to stdio migration removes obsolete connection fields and identical writes are no-ops',t=>{
 const dir=home(t),stdio={type:'stdio',command:'/node',args:['/client.js','--host-id','host'],env:{KEEP_NEW:'yes'}};
 fs.mkdirSync(dir+'/.codex');const codexFile=dir+'/.codex/config.toml';fs.writeFileSync(codexFile,'model = "keep-model"\n[mcp_servers.penecho]\nurl = "https://old.local/mcp"\nbearer_token_env_var = "OLD_TOKEN"\n[mcp_servers.penecho.http_headers]\nAuthorization = "secret-old"\n[mcp_servers.penecho.env]\nHTTP_PROXY = "obsolete"\n[mcp_servers.other]\ncommand = "other-command"\n');
 const claudeFile=dir+'/.claude.json';fs.writeFileSync(claudeFile,JSON.stringify({unrelated:true,mcpServers:{other:{command:'other-command'},penecho:{type:'http',url:'https://old.local/mcp',headers:{Authorization:'secret-old'},env:{HTTP_PROXY:'obsolete'}}}}));
 for(const [client,file] of [['codex',codexFile],['claude',claudeFile]]){const result=configureHttpClient(client,stdio,{home:dir,env:{}});assert.equal(result.trustRequired,false);assert.equal(result.processEnvironment,undefined);const content=fs.readFileSync(file,'utf8');for(const removed of ['old.local','OLD_TOKEN','secret-old','HTTP_PROXY','obsolete'])assert.ok(!content.includes(removed));assert.ok(content.includes('other-command'));assert.ok(content.includes('KEEP_NEW'));assert.ok(content.includes('/client.js'));
 fs.utimesSync(file,new Date(1000),new Date(1000));const before=fs.statSync(file);configureHttpClient(client,stdio,{home:dir,env:{}});const after=fs.statSync(file);assert.equal(after.mtimeMs,before.mtimeMs);assert.equal(after.ino,before.ino);assert.equal(fs.readFileSync(file,'utf8'),content);}
 assert.ok(fs.readFileSync(codexFile,'utf8').includes('keep-model'));assert.equal(JSON.parse(fs.readFileSync(claudeFile)).unrelated,true);
});
