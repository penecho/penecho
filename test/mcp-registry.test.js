"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const crypto = require("node:crypto");
const { test } = require("node:test");
const { createMcpService } = require("../src/server/mcp/service.js");
const { registryStateDirectory, recordsDirectory, readRecords, writeRecord, discoverRecords } = require("../src/server/mcp/records.js");
const { PenEchoStdioServer, selectRecord } = require("../src/server/mcp/stdio.js");

test("desktop and CLI share home registry across application state directories", async t => {
  const home = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "penecho-shared-registry-"));
  t.mock.method(os, "homedir", () => home);
  const desktopState = path.join(home, "AppData", "PenEcho");
  const cliState = path.join(home, "cli-state");
  const servers = [];
  const services = [desktopState, cliState].map(stateDirectory => {
    let service;
    const server = http.createServer((req, res) => service.handleHttp(req, res));
    servers.push(server);
    service = createMcpService({server, authorizeBrowser:() => null, stateDirectory});
    return service;
  });
  try {
    await Promise.all(servers.map(server => new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); })));
    services.forEach((service, index) => service.register(servers[index].address()));
    const shared = path.join(home, ".penecho");
    assert.equal(registryStateDirectory(), shared);
    assert.equal(recordsDirectory(), path.join(shared, "mcp", "instances"));
    assert.equal(readRecords(recordsDirectory()).length, 2);
    assert.equal(fs.existsSync(recordsDirectory(desktopState)), false);
    assert.equal(fs.existsSync(recordsDirectory(cliState)), false);
    // HTTP bootstrap is asynchronous; read the authorized status endpoint before
    // inspecting the generated stdio launcher and shared credential directory.
    for (const server of servers) {
      const response=await fetch(`http://127.0.0.1:${server.address().port}/api/mcp/status`);
      const status=await response.json();
      assert.deepEqual(status.config.args.slice(-2), ["--state-directory", path.join(shared,"mcp")]);
    }
    const bridge = new PenEchoStdioServer({stateDirectory:desktopState});
    assert.deepEqual(new Set(bridge.records().map(record => record.instanceId)), new Set(services.map(service => service.instanceId)));
    assert.equal(selectRecord({stateDirectory:cliState, instanceId:services[1].instanceId}).instanceId, services[1].instanceId);
    assert.deepEqual(await bridge.listCanvases(), {canvases:[], discovery:{status:"no-opted-in-canvas", instances:2, reachable:2}});
    const sharedRecord = bridge.records()[0];
    writeRecord(recordsDirectory(desktopState), {...sharedRecord, port:1});
    const legacy = {...sharedRecord, instanceId:crypto.randomUUID(), port:42002};
    writeRecord(recordsDirectory(desktopState), legacy);
    assert.equal(bridge.records().length, 3);
    assert.equal(bridge.records().find(record => record.instanceId === sharedRecord.instanceId).port, sharedRecord.port);
    await services[0].close();
    assert.deepEqual(readRecords(recordsDirectory()).map(record => record.instanceId), [services[1].instanceId]);
    const invalidDirectory = path.join(home, "not-directory");
    fs.writeFileSync(invalidDirectory, "file");
    assert.equal(discoverRecords({stateDirectory:invalidDirectory}).length, 1);
    assert.equal(discoverRecords({registryStateDirectory:invalidDirectory,stateDirectory:desktopState}).length, 2);
  } finally {
    await Promise.all(services.map(service => service.close()));
    await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
    fs.rmSync(home, {recursive:true, force:true});
  }
});
