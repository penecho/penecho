import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cliInvocation, ensureMcp, isMainModule, SERVER_NAME, SERVER_URL } from '../integrations/penecho-cloud/skills/penecho-canvas/scripts/setup-mcp.mjs';

const missing = { status: 1, stdout: '', stderr: `Error: No MCP server named '${SERVER_NAME}' found.` };
const emptyList = host => ({ status: 0, stdout: host === 'codex' ? '[]' : 'No MCP servers configured.' });
const configured = (host, url = SERVER_URL, enabled = true) => ({
  status: 0, stderr: '',
  stdout: host === 'codex'
    ? JSON.stringify({ name: SERVER_NAME, enabled, transport: { type: 'streamable_http', url } })
    : `Name: ${SERVER_NAME}\nScope: User config\nStatus: ${enabled ? 'Needs authentication' : 'Disabled'}\nType: http\nURL: ${url}\n`,
});
function runner(...responses) {
  const calls = [];
  const run = async (...call) => { calls.push(call); assert.ok(responses.length, 'unexpected CLI command'); return responses.shift(); };
  return { run, calls };
}

for (const host of ['codex', 'claude']) {
  test(`${host}: add a missing production Cloud connection with native CLI and reuse it on the next call`, async () => {
    const cli = runner(missing, emptyList(host), { status: 0 }, configured(host), configured(host));
    assert.equal((await ensureMcp({ host, run: cli.run })).status, 'added');
    assert.equal((await ensureMcp({ host, run: cli.run })).status, 'existing');
    const mutation = cli.calls.filter(([, args]) => args[1] === 'add');
    assert.equal(mutation.length, 1);
    assert.deepEqual(mutation[0], [host, host === 'codex'
      ? ['mcp', 'add', SERVER_NAME, '--url', SERVER_URL]
      : ['mcp', 'add', '--transport', 'http', '--scope', 'user', SERVER_NAME, SERVER_URL], { interactive: true }]);
    assert.ok(cli.calls.every(([command]) => command === host), 'do not configure another host');
    assert.ok(cli.calls.every(([, args]) => !args.includes('login') && !args.includes('logout')), 'do not reset credentials');
  });

  test(`${host}: read-only check reports missing without adding`, async () => {
    const cli = runner(missing, emptyList(host));
    assert.equal((await ensureMcp({ host, checkOnly: true, run: cli.run })).status, 'missing');
    assert.equal(cli.calls.length, 2);
  });

  test(`${host}: preserve a conflicting non-production endpoint and disabled configuration`, async () => {
    for (const config of [configured(host, 'https://internaltest.penecho.ai/mcp'), configured(host, SERVER_URL, false)]) {
      const cli = runner(config);
      await assert.rejects(ensureMcp({ host, run: cli.run }), /preserved/);
      assert.equal(cli.calls.length, 1);
    }
  });

  test(`${host}: a failed configuration read must not trigger an add`, async () => {
    for (const failure of [{ status: 1, stderr: 'Permission denied' }, { status: null, error: { code: 'ENOENT' } }]) {
      const cli = runner(failure);
      await assert.rejects(ensureMcp({ host, run: cli.run }));
      assert.equal(cli.calls.length, 1);
    }
  });

  test(`${host}: verify saved configuration after an add failure without retrying the mutation`, async () => {
    const cli = runner(missing, emptyList(host), { status: 1 }, configured(host));
    assert.equal((await ensureMcp({ host, run: cli.run })).authorization, 'pending');
    assert.equal(cli.calls.length, 4);
    const unsaved = runner(missing, emptyList(host), { status: 1 }, missing);
    await assert.rejects(ensureMcp({ host, run: unsaved.run }), /did not configure/);
    assert.equal(unsaved.calls.length, 4);
  });
}

test('reuse existing production Cloud stdio bridges without replacing them', async () => {
  for (const host of ['codex', 'claude']) {
    const args = ['-y', 'mcp-remote@0.1.38', SERVER_URL, '--transport', 'http-only', '--resource', SERVER_URL];
    const output = host === 'codex'
      ? JSON.stringify({ name: SERVER_NAME, transport: { type: 'stdio', command: 'npx', args } })
      : `Type: stdio\nCommand: npx\nArgs: ${args.join(' ')}\n`;
    const cli = runner({ status: 0, stdout: output });
    assert.equal((await ensureMcp({ host, run: cli.run })).status, 'existing');
    assert.equal(cli.calls.length, 1);
  }
});

test('require an explicit current host before reading or changing configuration', async () => {
  const cli = runner();
  await assert.rejects(ensureMcp({ run: cli.run }), /current host/);
  assert.equal(cli.calls.length, 0);
});

for (const host of ['codex', 'claude']) {
  test(`${host}: verify and reuse a production alias or plugin connection without adding`, async () => {
    const alias = 'plugin:penecho-cloud:production';
    const config = configured(host);
    config.stdout = host === 'codex' ? JSON.stringify({ name: alias, enabled: true, transport: { type: 'streamable_http', url: SERVER_URL } })
      : config.stdout.replace(SERVER_NAME, alias);
    const listed = { status: 0, stdout: host === 'codex' ? `[${config.stdout}]` : `Checking MCP server health…\n${alias}: ${SERVER_URL} (HTTP) - Needs authentication\n` };
    const cli = runner(missing, listed, config);
    const result = await ensureMcp({ host, run: cli.run });
    assert.equal(result.name, alias);
    assert.equal(result.alias, true);
    assert.equal(result.status, 'existing');
    assert.ok(cli.calls.every(([, args]) => args[1] !== 'add'));
  });
  test(`${host}: an unreadable alias list fails before any add`, async () => {
    for (const listed of [{ status: 1, stderr: 'Permission denied' }, { status: 0, stdout: 'unexpected native output' }]) {
      const cli = runner(missing, listed);
      await assert.rejects(ensureMcp({ host, run: cli.run }), /No connection was added/);
      assert.equal(cli.calls.length, 2);
    }
  });
}

test('Windows official npm shim keeps paths with spaces and arguments outside a shell', () => {
  const shim = 'C:\\Users\\Canvas User\\AppData\\Roaming\\npm\\codex.cmd';
  const entry = 'C:\\Users\\Canvas User\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js';
  const args = ['mcp', 'get', 'plugin:PenEcho:production', '--json'];
  const invocation = cliInvocation('codex', args, { platform: 'win32', pathValue: 'C:\\Users\\Canvas User\\AppData\\Roaming\\npm', exists: path => [shim, entry].includes(path), node: 'C:\\Program Files\\nodejs\\node.exe' });
  assert.deepEqual(invocation, { command: 'C:\\Program Files\\nodejs\\node.exe', args: [entry, ...args] });
});

test('Windows native executable follows PATH priority and unsupported shims fail safely', () => {
  const executable = 'C:\\Users\\Canvas User\\PenEcho tools\\codex.exe';
  assert.deepEqual(cliInvocation('codex', ['app-server', '--stdio'], { platform: 'win32', pathValue: 'C:\\Users\\Canvas User\\PenEcho tools;C:\\npm', exists: path => [executable, 'C:\\npm\\codex.cmd'].includes(path) }), { command: executable, args: ['app-server', '--stdio'] });
  assert.throws(() => cliInvocation('codex', [], { platform: 'win32', pathValue: 'C:\\npm', exists: path => path.endsWith('.cmd') }), /Unsupported Windows CLI launcher/);
});

test('Windows npm Claude Code shim runs its native claude.exe, with cli.js as the legacy fallback', () => {
  const directory = 'C:\\Users\\Canvas User\\AppData\\Roaming\\npm', shim = `${directory}\\claude.cmd`;
  const native = `${directory}\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe`, legacy = `${directory}\\node_modules\\@anthropic-ai\\claude-code\\cli.js`;
  assert.deepEqual(cliInvocation('claude', ['mcp', 'list'], { platform: 'win32', pathValue: directory, exists: path => [shim, native].includes(path) }), { command: native, args: ['mcp', 'list'] });
  assert.deepEqual(cliInvocation('claude', ['mcp', 'list'], { platform: 'win32', pathValue: directory, exists: path => [shim, legacy].includes(path), node: 'node.exe' }), { command: 'node.exe', args: [legacy, 'mcp', 'list'] });
});

test('claude: a disabled production alias is preserved and skipped; the connection is still added', async () => {
  const list = { status: 0, stdout: `alias2: ${SERVER_URL} (HTTP) - Disabled for this project\n` };
  const disabledAlias = { status: 0, stdout: `Name: alias2\nStatus: Disabled\nType: http\nURL: ${SERVER_URL}\n` };
  const cli = runner(missing, list, disabledAlias, { status: 0 }, configured('claude'));
  assert.equal((await ensureMcp({ host: 'claude', run: cli.run })).status, 'added');
  assert.ok(cli.calls.every(([, args]) => !(args.includes('remove') || args.includes('enable'))), 'never change the disabled alias');
});

test('the CLI entry check follows symlinked skill directories', async () => {
  const script = new URL('../integrations/penecho-cloud/skills/penecho-canvas/scripts/setup-mcp.mjs', import.meta.url);
  const link = join(await mkdtemp(join(tmpdir(), 'penecho-skill-link-')), 'setup-mcp.mjs');
  await symlink(script, link);
  assert.equal(isMainModule(link, script.href), true);
  assert.equal(isMainModule(join(tmpdir(), 'other.mjs'), script.href), false);
  assert.equal(isMainModule(undefined, pathToFileURL(link).href), false);
});
