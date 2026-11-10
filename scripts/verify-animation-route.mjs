// UAT provider probe with current canonical document tools and isolated Canvas
// receipts. Reads the existing provider; never writes accounts or user documents.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { resolve, join } from 'node:path';
import { PERSONA } from '../src/server/canvas-agent/runtime.mjs';
import { createDocumentTools, DOCUMENT_TOOL_INSTRUCTIONS } from '../src/server/canvas-agent/document-tools.mjs';
const require = createRequire(import.meta.url);
const { getAuthoringGuidance, GUIDANCE_IDS } = require('../src/server/mcp/authoring-guidance.js');
const { validateToolArguments } = require('../src/server/mcp/schema.js');
const root = resolve(import.meta.dirname, '..');
const directory = join(root, 'docs/verification/scene-animation-20261004/provider');
await mkdir(directory, { recursive: true });
const sha = value => createHash('sha256').update(value).digest('hex');
const payload = {
  system: [PERSONA, DOCUMENT_TOOL_INSTRUCTIONS, 'Host-supplied authoritative canvas digest: {"empty":true,"objects":[]}'].join('\n\n'),
  tools: createDocumentTools({ id: 'isolated-animation-route' }).map(({ name, description, parameters }) => ({ name, description, parameters })),
  guidance: Object.fromEntries(GUIDANCE_IDS.map(id => [id, { brief: getAuthoringGuidance(id, 'brief'), full: getAuthoringGuidance(id, 'full') }])),
  modelId: '0c073afd-76a4-4b5c-9292-248c2396eb9b',
  task: '使用动画讲解勾股定理\n\n<penecho_host_references>{"initialCanvasState":{"empty":true,"objects":[]}}</penecho_host_references>',
};
async function inside(payload) {
  const { loadConfig } = await import('/app/src/config.mjs');
  const { createDatabasePool } = await import('/app/src/db/pool.mjs');
  const { createProviderSecretCipher } = await import('/app/src/services/provider-crypto.mjs');
  const { PostgresProviderStore } = await import('/app/src/services/provider-store-postgres.mjs');
  const { ProviderHttpClient } = await import('/app/src/services/provider-http.mjs');
  const { ProviderExecutor } = await import('/app/src/services/provider-executor.mjs');
  const { randomUUID } = await import('node:crypto');
  const config = loadConfig();
  if (config.production || config.appOrigin !== 'https://internaltest.penecho.ai') throw Error('UAT only');
  const pool = createDatabasePool(config), cipher = createProviderSecretCipher(config);
  const store = new PostgresProviderStore({ config, pool, cipher });
  const client = new ProviderHttpClient({ allowedPorts: config.providerAllowedPorts, maxResponseBytes: config.hostedMaxResponseBytes });
  const executor = new ProviderExecutor({ client, timeoutMs: 180000 });
  let secret;
  try {
    const { rows } = await pool.query('SELECT id,model_id,upstream_model,endpoint_url,protocol,thinking FROM provider_endpoints WHERE model_id=$1 AND protocol=$2 AND enabled AND retired_at IS NULL ORDER BY priority,id LIMIT 1', [payload.modelId, 'openai-compatible']);
    if (rows.length !== 1) throw Error('Configured UAT provider unavailable');
    const p = rows[0], provider = { id: p.id, modelId: p.model_id, upstreamModel: p.upstream_model, endpointUrl: p.endpoint_url, protocol: p.protocol, thinking: p.thinking };
    secret = await store.providerSecret(p.id);
    const messages = [{ role: 'system', content: payload.system }, { role: 'user', content: payload.task }];
    const calls = [], steps = [];
    for (let step = 1; step <= 6; step++) {
      const started = performance.now();
      const result = await executor.executeChat({ provider, secret, requestId: randomUUID(), apiFormat: 'openai', directCanvas: true, signal: AbortSignal.timeout(180000), request: { model: provider.upstreamModel, messages, tools: payload.tools.map(t => ({ type: 'function', function: t })), max_tokens: 32000, reasoning_effort: 'high' } });
      const choice = result.response.choices[0], message = choice.message;
      steps.push({ step, ms: Math.round(performance.now() - started), finish: choice.finish_reason, usage: result.usage });
      messages.push(message);
      for (const call of message.tool_calls || []) {
        const name = call.function.name, args = JSON.parse(call.function.arguments);
        calls.push({ step, name, arguments: args });
        if (name === 'penecho_present_widget' || name === 'penecho_draw') {
          console.log(JSON.stringify({ calls, steps, modelId: p.model_id, upstreamModel: p.upstream_model, created: { name, arguments: args }, isolated: true }));
          return;
        }
        let output;
        if (name === 'penecho_get_guidance') output = payload.guidance[args.id]?.[args.detail || 'brief'] || { error: 'Unknown guidance' };
        else if (name === 'penecho_inspect_session') output = { documentId: 'isolated-animation-route', revision: 0, empty: true, objects: [] };
        else if (name === 'penecho_list_files') output = { documentId: 'isolated-animation-route', entries: [], total: 0 };
        else output = { error: 'No existing objects in this isolated Canvas. Use automatic placement to create the requested result.' };
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(output) });
      }
      if (!message.tool_calls?.length) throw Error('No creation tool was selected');
    }
    throw Error('Creation did not occur within six steps');
  } catch (error) {
    console.error(JSON.stringify({ error: String(error.message).replaceAll(secret || '\u0000', '[redacted]') }));
    process.exitCode = 1;
  } finally { client.close(); cipher.close(); await pool.end(); }
}
const child = spawn('docker', ['exec', '-i', 'penecho-uat-local-app-1', 'node', '--input-type=module', '-'], { cwd: root, stdio: ['pipe', 'pipe', 'inherit'] });
child.stdin.end(`(${inside.toString()})(${JSON.stringify(payload)}).catch(error=>{console.error(error.name);process.exitCode=1;});`);
let output = '';
child.stdout.on('data', chunk => { output += chunk; });
const code = await new Promise(resolve => child.once('close', resolve));
if (code !== 0) throw Error('Provider probe failed');
const report = JSON.parse(output.trim());
const created = report.created;
if (created.name !== 'penecho_present_widget' || !created.arguments.scene || created.arguments.html) throw Error('Explicit animation did not select Scene');
if (!report.calls.slice(0, -1).some(call => call.name === 'penecho_get_guidance' && call.arguments.id === 'scene' && call.arguments.detail === 'full')) throw Error('Full Scene guidance must precede creation');
validateToolArguments(created.name, { ...created.arguments, sessionId: 'agent-' + 'a'.repeat(64) });
if (created.arguments.scene.engine !== 'motion' || !created.arguments.scene.beats?.length) throw Error('Expected a timed motion proof');
report.createdAt = new Date().toISOString();
report.scope = 'Actual UAT provider; canonical persona and document tools; isolated receipts; stops at creation for independent browser verification.';
report.sourceHashes = { runner: sha(await readFile(import.meta.filename)), system: sha(payload.system), tools: sha(JSON.stringify(payload.tools)), guidance: sha(JSON.stringify(payload.guidance)) };
await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
await writeFile(join(directory, 'scene.json'), JSON.stringify(created.arguments.scene, null, 2) + '\n');
console.log(JSON.stringify({ directory, route: 'scene', engine: 'motion', calls: report.calls.map(call => ({ name: call.name, guidance: call.arguments.id })), steps: report.steps, isolated: true }));
