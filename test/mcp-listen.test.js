"use strict";
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {listenMcp} = require('../src/server/mcp/listen.js');
function server(errors) {
  const value = new EventEmitter(); value.ports = [];
  value.listen = (port, host) => { assert.equal(host, '0.0.0.0'); value.ports.push(port); queueMicrotask(() => {
    const code = errors.shift(); if (code) value.emit('error', Object.assign(Error(code), {code})); else value.emit('listening');
  }); }; return value;
}
for (let busy = 0; busy <= 3; busy++) test(`MCP tries fixed candidates before dynamic fallback: ${busy} busy`, async () => {
  const value = server(Array(busy).fill('EADDRINUSE')); await listenMcp(value);
  assert.deepEqual(value.ports, [3922,13922,23922,0].slice(0,busy+1));
  assert.equal(value.listenerCount('error'),0); assert.equal(value.listenerCount('listening'),0);
});
test('MCP does not hide non-conflict errors', async () => {
  const value = server(['EACCES']); await assert.rejects(listenMcp(value), {code:'EACCES'});
  assert.deepEqual(value.ports,[3922]); assert.equal(value.listenerCount('listening'),0);
});
test('explicit ephemeral port remains ephemeral', async () => {
  const value = server([]); await listenMcp(value,0); assert.deepEqual(value.ports,[0]);
});
test('MCP listen rejects when neither listening nor error is emitted', async () => {
  const value = new EventEmitter(); value.listen = port => { value.port = port; };
  await assert.rejects(listenMcp(value,0,20), {code:'MCP_LISTEN_TIMEOUT'});
  assert.equal(value.listenerCount('error'),0); assert.equal(value.listenerCount('listening'),0);
});
