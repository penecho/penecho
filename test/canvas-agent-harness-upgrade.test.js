require('./helpers/safety.js');
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

test('provider configuration changes stay in memory and retain the existing agent', async () => {
  const { CanvasHarnessHost, connectionProfile } = await import('../src/server/canvas-agent/runtime.mjs')
  const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'penecho-harness-upgrade-'))
  const first = { id:'first', provider:'api', name:'First', apiKey:'fixture-key', apiModel:'test', apiUrl:'http://127.0.0.1:9/v1', apiFormat:'openai' }
  const second = { ...first, id:'second', name:'Second' }
  let connections = [first]
  const host = new CanvasHarnessHost({
    stateDirectory, rootDirectory:path.resolve(__dirname, '..'),
    resolveConnection:id => connections.find(connection => connection.id === id),
    listConnections:() => connections,
    capabilities:{ maintenance:false, cli:false },
  })
  try {
    await host.refreshProviders()
    const ctx = host.context, providers = () => ctx.llm.listProviders().map(provider => provider.id).sort()
    assert.ok(ctx.sessionProjections, 'the loop has its required in-memory projection registry')
    assert.equal(ctx.get('settings'), undefined, 'no settings migration service is mounted')
    assert.equal(ctx.get('profileContext'), undefined)
    const session = await host.connect({ connectionId:first.id, clientId:'upgrade', send:() => {} })
    const handle = session.handle, reference = host.piAiProviders
    connections = [first, second]
    await host.refreshProviders()
    assert.deepEqual(providers(), connections.map(connection => connectionProfile(connection).provider).sort())
    connections = [first, { ...second, name:'Renamed' }]
    await host.refreshProviders()
    assert.equal(reference.get()[connectionProfile(second).provider].displayName, 'Renamed')
    connections = [first]
    await host.refreshProviders()
    assert.deepEqual(providers(), [connectionProfile(first).provider])
    const previous = reference.get(), credentials = host.credentialRefs
    connections = [first, { ...second, apiUrl:'invalid URL' }]
    await assert.rejects(host.refreshProviders(), /Invalid URL/)
    assert.equal(reference.get(), previous, 'invalid replacements do not publish')
    assert.equal(host.credentialRefs, credentials, 'invalid replacements retain credential routing')
    assert.equal(host.piAiProviders, reference)
    assert.equal(session.handle, handle)
    assert.equal(host.sessions.get(session.id), session)
    assert.equal(fs.existsSync(path.join(stateDirectory, 'settings.yaml')), false)
  } finally {
    await host.dispose()
    fs.rmSync(stateDirectory, { recursive:true, force:true })
  }
})
