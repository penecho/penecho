"use strict";

// Compare native fetch with the canonical local connector using an isolated
// UAT trial. Existing account state and the running Canvas are never changed.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { setTimeout:delay } = require("node:timers/promises");
const { CloudConnector } = require("../src/server/cloud-connector.js");
const { createSuggestionTransport } = require("../src/server/suggestion-transport.js");
const LLM = require("../src/server/jevision.js");

async function benchmark() {
  const origin = "https://internaltest.penecho.ai", endpoint = origin + "/api/v1/apps/penecho-llm/suggest/status";
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "penecho-suggest-keepalive-"));
  const transport = createSuggestionTransport();
  const connector = new CloudConnector({ stateDir:directory, executeRequest:async () => ({}), defaultOrigin:origin, suggestionTransport:transport });
  const report = { measuredAt:new Date().toISOString(), node:process.version, kind:"Native fetch versus canonical CloudConnector; UAT status GET", samples:[],
    pool:{maxSockets:transport.httpsAgent.maxSockets,maxFreeSockets:transport.httpsAgent.maxFreeSockets,idleTimeoutMs:transport.httpsAgent.options.timeout} };
  const ids = new WeakMap(); let opened = 0, current;
  const addRequest = transport.httpsAgent.addRequest.bind(transport.httpsAgent);
  transport.httpsAgent.addRequest = (request, ...args) => {
    const row = current;
    request.once("socket", socket => {
      if (!ids.has(socket)) ids.set(socket, ++opened);
      if (row) Object.assign(row, { socket:ids.get(socket), reusedSocket:request.reusedSocket });
    });
    return addRequest(request, ...args);
  };
  try {
    if (!(await connector.suggestionRequest("/status")).configured) throw Error("UAT suggestions are unavailable.");
    const headers = { "x-penecho-client":"canvas", "x-penecho-guest":connector.suggestionGuests[origin], accept:"application/json" };
    async function sample(route, phase) {
      const row = { route, phase }, started = performance.now(); current = route === "pooled-connector" ? row : null;
      try {
        if (route === "native-fetch") {
          const response = await fetch(endpoint, { headers, redirect:"error", signal:AbortSignal.timeout(12000) });
          row.status = response.status; row.valid = typeof (await response.json()).configured === "boolean";
        } else {
          connector.invalidateSuggestionStatus();
          const value = await connector.suggestionRequest("/status", { timeoutMs:12000 });
          row.status = 200; row.valid = typeof value.configured === "boolean";
        }
      } catch(error) { row.error = error.code || error.name; }
      row.ms = Math.round((performance.now()-started)*10)/10; report.samples.push(row);
    }
    for (let index=0; index<5; index++) for (const route of index%2 ? ["pooled-connector","native-fetch"] : ["native-fetch","pooled-connector"]) await sample(route,"warm");
    for (const seconds of [6, 30]) {
      await delay(seconds*1000);
      for (const route of ["native-fetch","pooled-connector"]) await sample(route,`after-${seconds}s-idle`);
    }
    if (process.argv.includes("--infer")) {
      const sharp = require("sharp");
      const png = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="500" height="170"><rect width="500" height="170" fill="white"/><text x="40" y="110" font-family="sans-serif" font-size="60">y = x² + ${Date.now()%10000}</text></svg>`)).png().toBuffer();
      const body = {version:1,mode:"ink",image:"data:image/png;base64,"+png.toString("base64"),context:{shapesFit:false}};
      report.inference = [];
      for (let index=0; index<2; index++) {
        current = null;
        const result = await LLM.requestCloudJeVision(connector,LLM.cloudJeVisionConfig(connector,{}),body);
        report.inference.push({ok:Boolean(result.answers),model:result.model,cached:result.cached,ms:result.latencyMs,action:result.answers.action?.choice,chargedCredits:result.chargedCredits});
      }
      if (!report.inference.every(row=>row.ok) || report.inference[0].cached || !report.inference[1].cached) throw Error("Expected a fresh synthetic result followed by a free cached result.");
    }
    if (report.samples.some(row=>row.status!==200 || !row.valid)) throw Error("Status comparison failed.");
    if (report.samples.filter(row=>row.route==="pooled-connector" && row.phase.includes("idle")).some(row=>!row.reusedSocket)) throw Error("The pooled connector did not reuse its idle connection.");
    const target = path.resolve(__dirname,"../docs/verification/suggestion-keepalive-20261003"); fs.mkdirSync(target,{recursive:true});
    fs.writeFileSync(path.join(target,"live-status.json"),JSON.stringify(report,null,2)+"\n");
    console.log(JSON.stringify(report));
  } finally { connector.close(); fs.rmSync(directory,{recursive:true,force:true}); }
}

if (require.main === module) benchmark().catch(error=>{console.error(JSON.stringify({error:error.code||error.name}));process.exitCode=1;});
