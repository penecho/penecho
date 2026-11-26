require('./helpers/safety.js');
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

test('native project tools execute in a fresh process without warming the Harness host', () => {
  const script = String.raw`
    import assert from 'node:assert/strict'
    import fs from 'node:fs'
    import os from 'node:os'
    import path from 'node:path'
    import { createCanvasAgentNativeRuntime } from './src/server/canvas-agent/runtime.mjs'
    const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'penecho-native-tools-')))
    const project = path.join(base, 'project'), state = path.join(base, 'state')
    fs.mkdirSync(project); fs.mkdirSync(state)
    const put = (name, value) => {
      const file = path.join(project, name)
      fs.mkdirSync(path.dirname(file), { recursive:true }); fs.writeFileSync(file, value)
    }
    put('notes.txt', 'needle in ordinary text\n')
    put('.git/refs/heads/main', '341e34d6cf2965ac8f58d0d89cf33e285ace9b2d\n')
    put('.git/logs/refs/heads/main', 'old new Author <author@example.test> 1 +0000\tcommit: fixture\n')
    put('empty', '')
    put('unicode', '中文🙂\n' + 'a'.repeat(4095) + '汉字\n')
    put('malformed', Buffer.from([0xc3, 0x28]))
    put('nul', Buffer.from([0x61, 0, 0x62]))
    put('control', Buffer.from([0x61, 1, 0x62]))
    put('data.unknown', 'valid text with an unsupported extension')
    put('known.pdf', '%PDF-1.4\n')
    fs.writeFileSync(path.join(base, 'outside.txt'), 'outside secret')
    fs.symlinkSync(path.join(base, 'outside.txt'), path.join(project, 'escape'))
    const session = {
      projectRuntimeDirectory:state,
      project:{ kind:'folder', id:'fixture', name:'Project', path:project },
      widgetCapabilities:{ professionalEnabled:false, privatePlugins:[] },
      generalHtmlContract:{ hash:'g', document:'general' },
      visualExplorerContract:{ hash:'v', document:'visual' }, visualSkillContracts:{},
      widgetContractsLoaded:new Set(), visualSkillsLoaded:new Set(), nextWidgetContractOrder:500,
      webSearch:{ enabled:false },
    }
    try {
      const runtime = await createCanvasAgentNativeRuntime({ session, attachments:{ saveImages:async () => [] } })
      const run = (name, args) => runtime.tool(name).execute(args, { signal:new AbortController().signal })
      for (const name of ['.git/refs/heads/main', '.git/logs/refs/heads/main', 'empty', 'unicode']) {
        const result = await run('read', { file_path:name })
        assert.match(result, /<type>file<\/type>/, name)
        if (name === 'unicode') assert.match(result, /中文🙂/)
      }
      assert.match(await run('grep', { path:'notes.txt', pattern:'needle' }), /Found 1 match/)
      assert.match(await run('grep', { path:'.git/refs/heads', pattern:'341e34d6' }), /main/)
      assert.match(await run('glob', { pattern:'*.txt' }), /notes\.txt/)
      for (const name of ['malformed', 'nul', 'control']) {
        await assert.rejects(run('read', { file_path:name }), /UTF-8|binary control/, name)
      }
      for (const name of ['data.unknown', 'known.pdf']) {
        await assert.rejects(run('read', { file_path:name }), /read supports/, name)
      }
      await assert.rejects(run('read', { file_path:'escape' }), /outside the selected project/)
      await assert.rejects(run('grep', { path:'../outside.txt', pattern:'secret' }), /outside the selected project/)
      const fileRuntime = await createCanvasAgentNativeRuntime({
        session:{ ...session, project:{ kind:'file', name:'main', reader:'binary' } },
        attachments:{ saveImages:async () => [] },
      })
      assert.equal(fileRuntime.tool('read'), null, 'single-file classification stays unchanged')
      assert.ok(fileRuntime.tool('read_binary'))
      console.log('cold native search, extensionless text, binary rejection and confinement passed')
    } finally { fs.rmSync(base, { recursive:true, force:true }) }
  `
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd:path.resolve(__dirname, '..'), encoding:'utf8', timeout:30_000,
  })
  assert.equal(result.status, 0, `${result.error || ''}\n${result.stderr}\n${result.stdout}`)
  assert.match(result.stdout, /cold native search/)
})
