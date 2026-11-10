import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureMcp, SERVER_NAME, SERVER_URL } from '../integrations/penecho-uat/skills/penecho-canvas-uat/scripts/setup-mcp.mjs';

const missing = { status: 1, stdout: '', stderr: `Error: No MCP server named '${SERVER_NAME}' found.` };
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
  test(`${host}: add a missing UAT connection with native CLI and reuse it on the next call`, async () => {
    const cli = runner(missing, { status: 0 }, configured(host), configured(host));
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
    const cli = runner(missing);
    assert.equal((await ensureMcp({ host, checkOnly: true, run: cli.run })).status, 'missing');
    assert.equal(cli.calls.length, 1);
  });

  test(`${host}: preserve a conflicting production endpoint and disabled configuration`, async () => {
    for (const config of [configured(host, 'https://penecho.ai/mcp'), configured(host, SERVER_URL, false)]) {
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
    const cli = runner(missing, { status: 1 }, configured(host));
    assert.equal((await ensureMcp({ host, run: cli.run })).authorization, 'pending');
    assert.equal(cli.calls.length, 3);
    const unsaved = runner(missing, { status: 1 }, missing);
    await assert.rejects(ensureMcp({ host, run: unsaved.run }), /did not configure/);
    assert.equal(unsaved.calls.length, 3);
  });
}

test('reuse existing UAT stdio bridges without replacing them', async () => {
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
