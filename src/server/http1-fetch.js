"use strict";

// Node 26's built-in fetch speaks HTTP/2 to any server that offers it, penecho.ai included. When a timeout cuts off an HTTP/2
// upload whose body is still waiting to be sent, Node keeps writing empty frames forever: the server stops answering, its memory
// grows past 70 GB and macOS kills it (nodejs/node#67363, nodejs/undici#6181; not fixed in a released Node 26 yet).
// HTTP/1.1 does not have this, so every fetch this process makes uses it. Node 24 (the desktop app) already does.
let applied = false;

function useHttp1ForFetch({ undici = loadUndici(), env = process.env } = {}) {
  if (applied) return true;
  if (!undici) return false;
  const options = { allowH2:false };
  // Keep honouring HTTP_PROXY / HTTPS_PROXY / NO_PROXY when Node was asked to.
  const useEnvProxy = /^(?:1|true)$/i.test(String(env.NODE_USE_ENV_PROXY || ""));
  undici.setGlobalDispatcher(useEnvProxy ? new undici.EnvHttpProxyAgent(options) : new undici.Agent(options));
  applied = true;
  return true;
}

function loadUndici() {
  try { return require("undici"); } catch { return null; }
}

module.exports = { useHttp1ForFetch };
