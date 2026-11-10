#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SERVER_NAME = 'penecho-uat';
export const SERVER_URL = 'https://internaltest.penecho.ai/mcp';

// Keep configuration reads private: native CLI output can contain headers.
// An add command may start normal browser OAuth, so keep that command interactive.
export function runCli(command, args, { interactive = false } = {}) {
  return new Promise(resolveResult => {
    const child = spawn(command, args, {
      shell: false,
      stdio: interactive ? 'inherit' : ['ignore', 'pipe', 'pipe'],
      ...(interactive ? {} : { timeout: 45000 }),
    });
    let stdout = '', stderr = '';
    child.stdout?.on('data', data => { stdout += data; });
    child.stderr?.on('data', data => { stderr += data; });
    child.on('error', error => resolveResult({ status: null, stdout, stderr, error }));
    child.on('close', status => resolveResult({ status, stdout, stderr }));
  });
}

function isUatBridge(command, args) {
  if (!/(?:^|[/\\])npx(?:\.cmd)?$/.test(command || '') || !Array.isArray(args)) return false;
  const urls = args.filter(arg => /^https?:\/\//.test(arg));
  return args.some(arg => /^mcp-remote(?:@[^\s]+)?$/.test(arg))
    && urls.length > 0 && urls.every(url => url === SERVER_URL);
}

function matchesConfig(host, output) {
  if (host === 'codex') {
    let config;
    try { config = JSON.parse(output); } catch { return false; }
    if (config.name !== SERVER_NAME || config.enabled === false) return false;
    const transport = config.transport || {};
    return (transport.type === 'streamable_http' && transport.url === SERVER_URL)
      || (transport.type === 'stdio' && isUatBridge(transport.command, transport.args));
  }
  const field = name => output.match(new RegExp(`^\\s*${name}:\\s*(.*)$`, 'mi'))?.[1]?.trim();
  if (/disabled|pending approval/i.test(field('Status') || '')) return false;
  const type = field('Type')?.toLowerCase();
  return (type === 'http' && field('URL') === SERVER_URL)
    || (type === 'stdio' && isUatBridge(field('Command'), field('Args')?.split(/\s+/)));
}

async function inspect(host, run) {
  const args = ['mcp', 'get', SERVER_NAME, ...(host === 'codex' ? ['--json'] : [])];
  const result = await run(host, args);
  if (result.error) {
    throw new Error(`Cannot run ${host} MCP setup. Check that its CLI is installed and executable.`);
  }
  if (result.status === 0) {
    if (!matchesConfig(host, result.stdout)) {
      throw new Error(`The existing ${SERVER_NAME} configuration is incompatible or disabled. It was preserved; inspect it before changing it.`);
    }
    return true;
  }
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  // A permission/configuration/health-check error must never be treated as absence.
  if (new RegExp(`No MCP server named ['"]${SERVER_NAME}['"](?: found)?[.]`, 'i').test(output)) return false;
  throw new Error(`Could not inspect ${host}'s ${SERVER_NAME} configuration (exit ${result.status}). Check CLI/configuration access; no connection was changed.`);
}

export async function ensureMcp({ host, checkOnly = false, run = runCli }) {
  if (!['codex', 'claude'].includes(host)) throw new Error('Select the current host with --host codex or --host claude.');
  const result = { host, name: SERVER_NAME, url: SERVER_URL };
  if (await inspect(host, run)) return { ...result, status: 'existing' };
  if (checkOnly) return { ...result, status: 'missing' };

  const args = host === 'codex'
    ? ['mcp', 'add', SERVER_NAME, '--url', SERVER_URL]
    : ['mcp', 'add', '--transport', 'http', '--scope', 'user', SERVER_NAME, SERVER_URL];
  const added = await run(host, args, { interactive: true });
  if (added.error) throw new Error(`Cannot run ${host}'s native MCP add command. Check CLI/configuration access.`);
  if (!await inspect(host, run)) {
    throw new Error(`The native ${host} command did not configure ${SERVER_NAME}. No fallback credentials or settings were created.`);
  }
  // Codex can save the connection before its automatic OAuth attempt fails.
  // Keep that connection and resume normal login rather than adding it again.
  return { ...result, status: 'added', ...(added.status !== 0 ? { authorization: 'pending' } : {}) };
}

// Compare real paths: import.meta.url is resolved through symlinks.
const invokedDirectly = () => { try { return !!process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };
if (invokedDirectly()) {
  const args = process.argv.slice(2);
  const hostIndex = args.indexOf('--host');
  const host = hostIndex >= 0 ? args[hostIndex + 1] : undefined;
  const expected = ['--host', host, ...(args.includes('--check') ? ['--check'] : [])];
  try {
    if (args.length !== expected.length || args.some(arg => !expected.includes(arg))) {
      throw new Error('Usage: node scripts/setup-mcp.mjs --host codex|claude [--check]');
    }
    const result = await ensureMcp({ host, checkOnly: args.includes('--check') });
    console.log(JSON.stringify(result));
    if (result.authorization === 'pending') process.exitCode = 2;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
