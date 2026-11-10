"use strict";
const {INSTRUCTIONS,PROMPTS,PROTOCOL_VERSION,promptResult,captureToolResult}=require("./protocol.js");
const {TOOLS,validateToolArguments}=require("./schema.js");
const {RESOURCES,readResource}=require("./resources.js");
const {getAuthoringGuidance}=require("./authoring-guidance.js");
const normal=value=>({content:[{type:"text",text:JSON.stringify(value)}],structuredContent:value});
const IP_DIRECT_INSTRUCTIONS = "This connection uses IP direct Streamable HTTP with an independent Bearer token. Keep its configured URL and HTTPS CA trust; no discovery connector is needed. For image files, use the imageUpload.url, method, contentType and target IDs returned by penecho_start_session: POST original bytes with canvasId, documentId, requestId and name as URL query parameters, using this connection's Bearer token and CA trust. Do not disable TLS verification or print credentials. Only discovery connections that return imageUpload.clientPath use client.js. Reuse the returned document-owned source in Widget HTML or penecho_place_image.";
function ipDirectTools(tools) {
  return tools.map(tool=>tool.name!=="penecho_upload_image"?tool:{...tool,
    description:"Save a chat attachment Data URL or an authorized same-document image reference without placement. For image files, use the direct HTTPS imageUpload transport returned by penecho_start_session. Reuse returned source in Widget HTML or place_image; requestId is idempotent.",
    inputSchema:{...tool.inputSchema,properties:{...tool.inputSchema.properties,source:{...tool.inputSchema.properties.source,
      description:"Full PNG/JPEG/WebP base64 Data URL (at most 800000 UTF-8 bytes including prefix), or an authorized same-document penecho-asset:<64 lowercase hex sha256> / penecho-ref:objects/<id>/image. No filesystem paths or remote URLs. For a local file, POST original bytes through the HTTPS imageUpload.url returned by start_session, with the same Bearer token and CA trust. Maximum raw input 32 MiB; the server processes supported images. Keep the exact target document current/open and reuse requestId for identical retries. Do not install a discovery connector for this IP direct connection."
    }}}});
}
function createMcpRpc({callTool,toolFailure,instructions=INSTRUCTIONS,tools=TOOLS}) {
  async function rpc(body, session, signal) {
    const result = value => ({jsonrpc:'2.0',id:body.id,result:value});
    const error = (code, message) => ({jsonrpc:'2.0',id:body.id,error:{code,message}});
    switch (body.method) {
      case 'initialize': return result({protocolVersion:PROTOCOL_VERSION,capabilities:{tools:{listChanged:false},prompts:{listChanged:false},resources:{subscribe:false,listChanged:false}},serverInfo:{name:'PenEcho',version:'1.0.0'},instructions:session.ipDirect?`${instructions}\n\n${IP_DIRECT_INSTRUCTIONS}`:instructions});
      case 'ping': return result({});
      case 'tools/list': return result({tools:session.ipDirect?ipDirectTools(tools):tools});
      case 'prompts/list': return result({prompts:PROMPTS});
      case 'resources/list': return result({resources:RESOURCES});
      case 'resources/templates/list': return result({resourceTemplates:[]});
      case 'prompts/get': try { return result(promptResult(body.params?.name, body.params?.arguments || {})); } catch (e) { return error(-32602,e.message); }
      case 'resources/read': try {
        const value=readResource(body.params?.uri,PROMPTS);
        if(session.ipDirect)value.contents=value.contents.map(content=>({...content,text:`${content.text}\n\n${IP_DIRECT_INSTRUCTIONS}`}));
        return result(value);
      } catch (e) { return error(e.code || -32602,e.message); }
      case 'tools/call': {
        try {
          const name = body.params?.name, args = body.params?.arguments ?? {};
          if (typeof name !== 'string' || !args || typeof args !== 'object' || Array.isArray(args)) return error(-32602,'Invalid params');
          const value = name === 'penecho_get_guidance' ? getAuthoringGuidance(validateToolArguments(name,args).id, args.detail) : await callTool(session.ownerId,name,args,{signal,...(session.ipDirect ? {ipDirect:true} : {})});
          return result(value?.image ? captureToolResult(value) : normal(value));
        } catch (e) { return result({...normal(toolFailure(e)),isError:true}); }
      }
      default: return error(-32601,'Method not found');
    }
  }
return rpc;
}
module.exports={createMcpRpc};
