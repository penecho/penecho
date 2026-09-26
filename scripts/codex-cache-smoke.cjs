#!/usr/bin/env node
'use strict';

// Opt-in live test: uses the existing Codex login and makes five model calls.
// All runtime state is temporary; the report contains only answers and usage.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { testConfiguredProvider } = require('../src/cli/main.js');
const { callCodexCli } = require('../src/providers/codex-cli.js');
const { CODEX_CLI_PINNED_VERSION, assertCodexCliBundle, assertCodexCliVersion } = require('../src/providers/cli-installer.js');

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Live Codex connection and prompt-cache test (five paid/quota-consuming model calls).\nnode scripts/codex-cache-smoke.cjs --codex ABS_EXECUTABLE --output REPORT_JSON\nUses GPT-6 Sol at medium effort, the current login, isolated temporary state, and synthetic context.');
    return;
  }
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    if (!['--codex', '--output'].includes(args[index]) || !args[index + 1]) throw new Error('Expected --codex ABS_EXECUTABLE --output REPORT_JSON');
    options[args[index].slice(2)] = args[index + 1];
  }
  if (!options.codex || !path.isAbsolute(options.codex) || !options.output) throw new Error('Provide an absolute --codex executable and --output report path.');
  assertCodexCliBundle(options.codex);
  const version = execFileSync(options.codex, ['--version'], { encoding:'utf8' }).trim();
  assertCodexCliVersion(version);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'penecho-cache-smoke-'));
  const report = { startedAt:new Date().toISOString(), version, model:'gpt-6-sol', effort:'medium', turns:[] };
  let host;
  try {
    const env = { ...process.env, CODEX_CLI_PATH:options.codex, CODEX_CLI_MODEL:report.model, AI_EFFORT:report.effort };
    report.connectionTest = await testConfiguredProvider({ provider:'codex-cli', cwd:root, stateDir:path.join(root, 'connection'), env }, {
      timeoutMs:120000,
      codexCaller:input => callCodexCli({ ...input, onUsage:usage => { report.connectionUsage = usage; } }),
    });
    console.log(JSON.stringify({ connectionTest:report.connectionTest, usage:report.connectionUsage }));
    const { CodexNativeHost } = await import('../src/server/canvas-agent/codex-native-host.mjs');
    const connection = { id:'cache-smoke', provider:'codex-cli', name:'Cache smoke', cliPath:options.codex, cliModel:report.model, effort:report.effort };
    let latestUsage;
    host = new CodexNativeHost({
      stateDirectory:path.join(root, 'native'), rootDirectory:path.resolve(__dirname, '..'),
      resolveConnection:id => id === connection.id ? connection : null,
      resolveProject:async () => null, modelTimeoutMs:() => 120000,
      resolveCliCandidates:() => [{ executable:options.codex, source:'configured' }],
      installManagedCli:async requested => {
        assert.equal(requested, CODEX_CLI_PINNED_VERSION);
        return { executable:options.codex, version };
      },
      onModelUsage:usage => { latestUsage = usage; },
    });
    const context = Array.from({ length:120 }, (_, index) => `Record ${index + 1}: This synthetic cache fixture describes a blue circle on a blank canvas, with no real user content or external resources.`).join('\n');
    const firstPrompt = `This is a text-only cache diagnostic. Do not use tools or modify the canvas. Keep the following reference context for later turns.\n${context}\nReply with CACHE_OK only.`;
    for (let conversation = 1; conversation <= 2; conversation++) {
      const session = await host.connect({ clientId:`cache-smoke-${conversation}`, connectionId:connection.id, binding:{ name:'cache-smoke' }, send:() => {} });
      for (let turn = 1; turn <= (conversation === 1 ? 3 : 1); turn++) {
        latestUsage = null;
        const started = Date.now();
        const result = await host.submit(session, turn === 1 ? firstPrompt : 'Using the unchanged reference context from this conversation, reply with CACHE_OK only. Do not use tools or modify the canvas.');
        const usage = latestUsage?.usage;
        assert.equal(latestUsage?.status, 'succeeded');
        assert.ok(Number.isSafeInteger(usage?.inputTokens) && usage.inputTokens > 0, 'Missing input-token usage');
        assert.ok(Number.isSafeInteger(usage.cachedInputTokens), 'Missing cached-token usage');
        assert.match(result.output, /CACHE_OK/);
        const row = { conversation, turn, elapsedMs:Date.now() - started, answer:result.output, ...usage, cacheHitPercent:Number((100 * usage.cachedInputTokens / usage.inputTokens).toFixed(2)) };
        report.turns.push(row);
        console.log(JSON.stringify(row));
      }
    }
    report.success = true;
  } catch (error) {
    report.success = false;
    report.error = error.message;
    throw error;
  } finally {
    await host?.dispose();
    fs.rmSync(root, { recursive:true, force:true });
    report.completedAt = new Date().toISOString();
    fs.mkdirSync(path.dirname(path.resolve(options.output)), { recursive:true });
    fs.writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`, { mode:0o600 });
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
