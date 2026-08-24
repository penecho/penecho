"use strict";

// Kept outside test/ so Node's default test discovery does not execute this stdin server as a test.

const readline = require("node:readline");

const mode = process.argv[2] === "app-server" ? "codex" : process.argv[2] === "acp" ? "kimi" : "claude";
const lines = readline.createInterface({ input:process.stdin, crlfDelay:Infinity });
let count = 0, initialized = false;
const send = value => process.stdout.write(`${JSON.stringify(value)}\n`);

function decision(provider) {
  return JSON.stringify({ type:"final", text:`${provider}:${process.pid}:${++count}` });
}

function codex(message) {
  if (message.method === "initialize") return send({ jsonrpc:"2.0", id:message.id, result:{ userAgent:"fake" } });
  if (message.method === "initialized") return;
  if (message.method === "thread/start") return send({ jsonrpc:"2.0", id:message.id, result:{ thread:{ id:`codex-thread-${process.pid}` }, model:"fake", modelProvider:"fake", cwd:process.cwd(), approvalPolicy:"never", approvalsReviewer:"user", sandbox:{ type:"readOnly" } } });
  if (message.method === "turn/start") {
    const turnId = `codex-turn-${count + 1}`;
    send({ jsonrpc:"2.0", id:message.id, result:{ turn:{ id:turnId, status:"inProgress", items:[] } } });
    if(JSON.stringify(message.params).includes("attempt-disabled-tool"))return send({jsonrpc:"2.0",method:"item/started",params:{threadId:message.params.threadId,turnId,item:{id:"command-1",type:"commandExecution"}}});
    send({ jsonrpc:"2.0", method:"item/agentMessage/delta", params:{ threadId:message.params.threadId, turnId, itemId:`item-${count + 1}`, delta:decision("codex") } });
    send({ jsonrpc:"2.0", method:"thread/tokenUsage/updated", params:{ threadId:message.params.threadId, turnId, tokenUsage:{ total:{ inputTokens:120, cachedInputTokens:80, outputTokens:8, reasoningOutputTokens:2, totalTokens:128 }, last:{ inputTokens:120, cachedInputTokens:80, cacheWriteInputTokens:0, outputTokens:8, reasoningOutputTokens:2, totalTokens:128 } } } });
    return send({ jsonrpc:"2.0", method:"turn/completed", params:{ threadId:message.params.threadId, turn:{ id:turnId, status:"completed", items:[] } } });
  }
  if (message.method === "turn/interrupt") return send({ jsonrpc:"2.0", id:message.id, result:{} });
  if (message.id !== undefined) send({ jsonrpc:"2.0", id:message.id, error:{ code:-32601, message:"unsupported" } });
}

function kimi(message) {
  if (message.method === "initialize") return send({ jsonrpc:"2.0", id:message.id, result:{ protocolVersion:1, agentInfo:{ name:"fake-kimi", version:"1" } } });
  if (message.method === "session/new") return send({ jsonrpc:"2.0", id:message.id, result:{ sessionId:`kimi-session-${process.pid}` } });
  if (message.method === "session/set_config_option") return send({ jsonrpc:"2.0", id:message.id, result:{} });
  if (message.method === "session/prompt") {
    if(JSON.stringify(message.params).includes("attempt-disabled-tool")){
      send({jsonrpc:"2.0",method:"session/update",params:{sessionId:message.params.sessionId,update:{sessionUpdate:"tool_call",toolCallId:"tool-1",title:"shell"}}});
      return send({jsonrpc:"2.0",id:message.id,result:{stopReason:"cancelled"}});
    }
    send({ jsonrpc:"2.0", method:"session/update", params:{ sessionId:message.params.sessionId, update:{ sessionUpdate:"agent_message_chunk", content:{ type:"text", text:decision("kimi") } } } });
    return send({ jsonrpc:"2.0", id:message.id, result:{ stopReason:"end_turn" } });
  }
  if (message.method === "session/cancel") return;
  if (message.id !== undefined) send({ jsonrpc:"2.0", id:message.id, error:{ code:-32601, message:"unsupported" } });
}

function claude(line) {
  const input=JSON.parse(line);
  if (!initialized) {
    initialized = true;
    send({ type:"system", subtype:"init", session_id:`claude-session-${process.pid}`, tools:[], mcp_servers:[] });
  }
  if(JSON.stringify(input).includes("attempt-disabled-tool"))return send({type:"assistant",message:{content:[{type:"tool_use",name:"Bash",input:{}}]}});
  send({
    type:"result",
    subtype:"success",
    session_id:`claude-session-${process.pid}`,
    result:decision("claude"),
    usage:{ input_tokens:100, cache_read_input_tokens:70, cache_creation_input_tokens:10, output_tokens:7 },
  });
}

lines.on("line", line => {
  if (!line.trim()) return;
  if (mode === "claude") return claude(line);
  const message = JSON.parse(line);
  if (mode === "codex") codex(message);
  else kimi(message);
});
