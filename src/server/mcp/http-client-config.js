'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
function configError(code,message){return Object.assign(Error(message),{code});}
function safe(file){let p=path.parse(path.resolve(file)).root;for(const part of path.resolve(file).slice(p.length).split(path.sep).filter(Boolean)){p=path.join(p,part);try{if(fs.lstatSync(p).isSymbolicLink())throw configError('MCP_CONFIG_SYMLINK','Configuration symlinks are not supported');}catch(e){if(e.code!=='ENOENT')throw e;}}}
function load(file){safe(file);try{const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));try{const s=fs.fstatSync(fd);if(!s.isFile()||s.size>2*1024*1024)throw Error('Configuration file too large');return fs.readFileSync(fd,'utf8');}finally{fs.closeSync(fd);}}catch(e){if(e.code==='ENOENT')return null;throw e;}}
function save(file,value,expected){safe(file);if(value===expected)return;fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});const temp=file+'.'+crypto.randomBytes(12).toString('hex')+'.tmp';try{fs.writeFileSync(temp,value,{flag:'wx',mode:0o600});safe(file);if(load(file)!==expected)throw Object.assign(Error('Configuration changed during setup; retry.'),{code:'CONFIG_CONFLICT'});fs.renameSync(temp,file);}finally{try{fs.unlinkSync(temp);}catch{}}}
function configurationFragment(client,connection){
  if(connection.type==='stdio'){
    const {command,args,env}=connection;
    if(typeof command!=='string'||!command||!Array.isArray(args)||args.some(value=>typeof value!=='string')||env&&Object.values(env).some(value=>typeof value!=='string'))throw configError('MCP_CONFIG_INVALID','Invalid stdio configuration');
    const entry={type:'stdio',command,args,...(env&&Object.keys(env).length?{env}:{})};
    if(client==='codex')return `[mcp_servers.penecho]\ncommand = ${JSON.stringify(command)}\nargs = ${JSON.stringify(args)}\n`+(entry.env?`env = { ${Object.entries(entry.env).map(([key,value])=>JSON.stringify(key)+' = '+JSON.stringify(value)).join(', ')} }\n`:'');
    if(client==='hermes')return {mcp_servers:{penecho:entry}};
    if(client==='claude'||client==='json')return {mcpServers:{penecho:entry}};
    throw Error('Unsupported client');
  }
  const {url,accessToken}=connection;
  if(typeof url!=='string'||!url.startsWith('https://')||typeof accessToken!=='string'||/[\r\n]/.test(accessToken))throw Error('Invalid HTTP configuration');
  const headers={Authorization:`Bearer ${accessToken}`};
  if(client==='claude'||client==='json')return {mcpServers:{penecho:{type:'http',url,headers}}};
  if(client==='hermes')return {mcp_servers:{penecho:{url,headers}}};
  if(client==='codex')return `[mcp_servers.penecho]\nurl = ${JSON.stringify(url)}\nhttp_headers = { Authorization = ${JSON.stringify(headers.Authorization)} }\n`;
  throw Error('Unsupported client');
}
// Preserve unrelated tables verbatim; quoted dots are part of the key, not separators.
function tomlHeader(line){
  const match=line.match(/^\s*(\[\[|\[)(.*?)(\]\]|\])\s*(?:#.*)?$/);
  const unsupported=()=>configError('MCP_CONFIG_UNSUPPORTED','Unsupported TOML table syntax');
  if(!match||match[1].length!==match[3].length)throw unsupported();
  let rest=match[2].trim();const components=[];
  while(rest){
    const key=rest.match(/^(?:"(?:[^"\\\x00-\x1f]|\\.)*"|'[^'\x00-\x1f]*'|[A-Za-z0-9_-]+)/);
    if(!key)throw unsupported();
    try{components.push(key[0][0]==='"'?JSON.parse(key[0]):key[0][0]==="'"?key[0].slice(1,-1):key[0]);}catch{throw unsupported();}
    rest=rest.slice(key[0].length).trim();
    if(!rest)break;
    if(rest[0]!=='.')throw unsupported();
    rest=rest.slice(1).trim();if(!rest)throw unsupported();
  }
  if(!components.length)throw unsupported();
  return {components,array:match[1]==='[['};
}
// Narrow TOML editing: unsupported multiline/inline declarations fail before saving.
function replaceCodex(text,fragment){
  const unsupported=message=>configError('MCP_CONFIG_UNSUPPORTED',message);
  if(/'''|"""/.test(text))throw unsupported('Multiline TOML requires manual configuration');
  const lines=text.split(/\r?\n/),result=[];let skip=false,inMcpRoot=false;
  for(const line of lines){
    if(/^\s*\[/.test(line)){
      const {components,array}=tomlHeader(line);
      inMcpRoot=components.length===1&&components[0]==='mcp_servers';
      skip=components[0]==='mcp_servers'&&components[1]==='penecho';
      if(array&&(skip||inMcpRoot))throw unsupported('MCP array tables require manual configuration');
    }else if(inMcpRoot&&/^\s*(?:penecho|["']penecho["'])\s*[.=]/.test(line))throw unsupported('Inline MCP TOML requires manual configuration');
    else if(!skip&&/^\s*(?:mcp_servers|["']mcp_servers["'])\s*[.=]/.test(line))throw unsupported('Inline MCP TOML requires manual configuration');
    if(!skip)result.push(line);
  }
  return result.join('\n').replace(/\s*$/,'')+'\n\n'+fragment;
}
function processTrustEnvironment(client,caFile){if(client==='claude')return {NODE_EXTRA_CA_CERTS:caFile};if(client==='codex')return {CODEX_CA_CERTIFICATE:caFile};return {};}
function configureHttpClient(client,connection,options={}){const fragment=configurationFragment(client,connection),env=options.env||process.env,home=options.homeDirectory||options.home||(process.platform==='win32'?env.USERPROFILE||env.HOME:env.HOME)||os.homedir();const trust=connection.type==='stdio'?{trustRequired:false,reloadRequired:true,connectionVerified:false}: {trustRequired:true,reloadRequired:true,connectionVerified:false,processEnvironment:processTrustEnvironment(client,connection.caFile),trustInstructions:'Launch the AI client with this CA trust environment; restart existing clients. No system trust store was modified.'};if(client==='json')return {...trust,configured:false,configuration:fragment};if(client==='hermes')return {...trust,configured:false,manualRequired:true,configuration:connection.type==='stdio'?fragment:{mcp_servers:{penecho:{url:connection.url,headers:{Authorization:'Bearer <ACCESS_TOKEN>'}}}},documentation:'https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp',trustInstructions:connection.type==='stdio'?'Merge the stdio command/args entry into ~/.hermes/config.yaml; the CLI loads its own host CA. Reload the MCP configuration and verify tools.':'Merge the documented HTTP entry into ~/.hermes/config.yaml and configure CA trust for your Hermes Python HTTP runtime. TLS trust has not been configured.'};const base=options.rootDirectory||process.cwd();const file=client==='claude'?(env.CLAUDE_CONFIG_DIR?path.resolve(base,env.CLAUDE_CONFIG_DIR,'.claude.json'):path.join(home,'.claude.json')):(env.CODEX_HOME?path.resolve(base,env.CODEX_HOME,'config.toml'):path.join(home,'.codex/config.toml'));const snapshot=load(file),old=snapshot||'';if(client==='claude'){let config;try{config=old?JSON.parse(old):{};}catch{throw configError('MCP_CONFIG_INVALID','Invalid Claude configuration');}if(!config||typeof config!=='object'||Array.isArray(config)||config.mcpServers&&(typeof config.mcpServers!=='object'||Array.isArray(config.mcpServers)))throw configError('MCP_CONFIG_INVALID','Invalid Claude configuration');config.mcpServers={...config.mcpServers,...fragment.mcpServers};save(file,JSON.stringify(config,null,2)+'\n',snapshot);}else save(file,replaceCodex(old,fragment),snapshot);return {...trust,configured:true,client,configFile:file};}
module.exports={configureHttpClient,configurationFragment,generateHttpClientConfig:configurationFragment,processTrustEnvironment,replaceCodex};
