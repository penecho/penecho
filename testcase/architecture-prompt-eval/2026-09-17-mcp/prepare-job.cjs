"use strict";
// Snapshot actual local MCP tool responses into a reproducible API evaluation.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { PenEchoStdioServer } = require("../../../src/server/mcp/stdio.js");
const root = __dirname;
const name = process.argv[2];
if (!/^[a-z0-9-]+$/.test(name || "")) throw Error("Supply a new run name");
const jobPath = path.join(root, `${name}.job.json`);
if (fs.existsSync(jobPath)) throw Error("Preserve old jobs; choose a new name");
const sha = text => crypto.createHash("sha256").update(text).digest("hex");
(async () => {
  const messages = [];
  const server = new PenEchoStdioServer({output:{write:text => messages.push(JSON.parse(text))}});
  server.records = () => { throw Error("Guidance must not discover Canvas instances"); };
  await server.handle({jsonrpc:"2.0",id:1,method:"initialize",params:{}});
  for (const id of ["visual-explorer", "architecture"]) {
    await server.handle({jsonrpc:"2.0",id:messages.length+1,method:"tools/call",params:{name:"penecho_get_guidance",arguments:{id,detail:"full"}}});
  }
  const [base, rule] = messages.slice(1).map(message => {
    if (message.result?.isError || !message.result?.structuredContent?.document) throw Error("MCP guidance read failed");
    return message.result.structuredContent;
  });
  const facts = fs.readFileSync(path.join(root,"facts.md"),"utf8");
  const transport = "Evaluation transport: no tools are exposed in this API request; all data collection is already complete. The following documents are exact guidance returned by this repository's MCP tools. Author one complete standalone HTML document with inline CSS/SVG and only necessary JavaScript. The supervisor will send your exact HTML to penecho_present_widget and inspect actual pixels. Return only final HTML, without Markdown fences or narration. No external assets, scripts, network requests or nested frames. Keep an opaque readable content surface. Do not insert review/progress instructions into the artifact.";
  const system = `${transport}\n\n${base.document}\n\n<scoped_visual_rule id="${rule.id}" scope="architecture regions of this artifact only" sha256="${rule.hash}">\n${rule.document}\n</scoped_visual_rule>`;
  const prompt = `请根据以下已完成的数据搜集，绘制用于技术讲解的“PenEcho MCP 架构”。让读者看清谁调用谁、哪些能力属于同一宿主，以及如何到达浏览器画布。完整事实供你选择主次；不要把代码索引全部变成节点。主图实体简单，详情与主图可对应；关系准确、文字可读且无遮挡。\n\n${facts}\n\n宿主可用视口：1939×1134 CSS px。宽度自适应；详情可垂直滚动，主图应适合这个阅读尺度。你自主选择构图，不必模仿任何预设模板。`;
  const job = {endpoint:"https://open.bigmodel.cn/api/anthropic/v1/messages",model:"glm-5.3-flash",system,prompt,parameters:{max_tokens:16000,thinking:{type:"disabled"}},outputDir:path.relative(process.cwd(),path.join(root,"runs",name))};
  fs.writeFileSync(jobPath,JSON.stringify(job,null,2)+"\n",{flag:"wx"});
  fs.writeFileSync(path.join(root,`${name}.guidance.json`),JSON.stringify({responses:messages.slice(1),factsSha256:sha(facts),systemSha256:sha(system),ruleHash:rule.hash},null,2)+"\n",{flag:"wx"});
  console.log(JSON.stringify({jobPath,baseBytes:Buffer.byteLength(base.document),ruleBytes:Buffer.byteLength(rule.document),factsBytes:Buffer.byteLength(facts),ruleHash:rule.hash}));
})();
