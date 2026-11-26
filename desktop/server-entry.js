"use strict";

// The PenEcho server of the desktop app, in its own process (server-process.js starts it, Electron running as Node).
// The agents and commands it starts must not be told to run as Node too.
delete process.env.ELECTRON_RUN_AS_NODE;
// Read once, the language stays; the person's own LC_ALL comes back with the settings.
Intl.DateTimeFormat().resolvedOptions();
if (process.platform !== "win32") delete process.env.LC_ALL;

const { createLink, setActive } = require("../src/server/desktop-link.js");
const { applyEnvironment } = require("./config-environment.js");

// However busy this thread gets, the server does not outlive the app and keep its port: a second thread looks whether the app is still
// there. Windows ends a process with the one that started it by itself.
if (process.platform !== "win32") {
  const { Worker } = require("node:worker_threads");
  new Worker(`const app = process.ppid, look = setInterval(() => {
    if (process.ppid === app) return;
    clearInterval(look);
    setTimeout(() => process.kill(process.pid, "SIGKILL"), 4000);
  }, 1000);`, { eval:true, resourceLimits:{ maxOldGenerationSizeMb:64, maxYoungGenerationSizeMb:16 } }).on("error", error => console.error(`Watching the app failed: ${error.message}`)).unref();
}

const link = createLink({ send:(message, callback) => process.send(message, callback) });
let server = null, stopping = false;

// Electron's own process goes on after a promise nobody waited for; so does this one, and says so in the log.
process.on("unhandledRejection", error => { console.error(`${new Date().toISOString()} Unhandled rejection: ${error?.stack || error}`); });

function stop() {
  if (stopping) return;
  stopping = true;
  if (server?.shutDown) server.shutDown();
  else process.exit(0);
}

function listen() {
  return new Promise((resolve, reject) => {
    if (server.startError) { reject(new Error(server.startError)); return; }
    if (server.listening) { resolve(); return; }
    server.once("error", reject);
    server.once("listening", () => {
      server.off("error", reject);
      server.on("error", error => { console.error(`${new Date().toISOString()} Server error: ${error?.stack || error}`); });
      resolve();
    });
  });
}

link.handle("start", async ({ env }) => {
  applyEnvironment(env);
  setActive(link);
  server = require("../server.js");
  await listen();
  const access = require("../src/server/local-access.js").active();
  access?.onChange(() => link.notify("network-access", { on:access.on() }));
  const address = server.address();
  return { port:typeof address === "object" && address ? address.port : Number(process.env.PORT), host:process.env.HOST, networkAccess:access ? access.on() : true };
});
// A file picked in the window's own dialog: the grant is kept by the process that takes the file in.
link.handle("picker-grant", input => require("../src/server/canvas-agent/native-picker-grants.js").issueNativePickerGrant(input));
link.handle("stop", () => { setImmediate(stop); return true; });

process.on("message", message => link.receive(message));
// The app has gone, however it ended: nobody can reach this server any more.
process.once("disconnect", () => { link.close(); stop(); });
