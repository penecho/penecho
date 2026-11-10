"use strict";
const DEFAULT_MCP_PORTS = Object.freeze([3922, 13922, 23922]);
function listenMcp(server, preferredPort = DEFAULT_MCP_PORTS[0], timeoutMs = 10000) {
  const ports = preferredPort === DEFAULT_MCP_PORTS[0] ? [...DEFAULT_MCP_PORTS, 0] : preferredPort ? [preferredPort, 0] : [0];
  return new Promise((resolve, reject) => {
    let index = 0, finished = false;
    const cleanup = () => { server.off('error', failed); server.off('listening', listening); };
    const finish = (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      cleanup();
      if (error) {
        // A fake or broken server may never emit the close callback. Closing
        // is best effort here; the caller only needs a bounded listen result.
        try { server.close?.(() => {}); } catch {}
        try { server.closeAllConnections?.(); server.closeIdleConnections?.(); } catch {}
        reject(error);
      } else resolve();
    };
    const listening = () => finish();
    const attempt = () => { try { server.listen(ports[index], '0.0.0.0'); } catch (error) { finish(error); } };
    const failed = error => {
      if (finished) return;
      if (error.code === 'EADDRINUSE' && index + 1 < ports.length) { index++; attempt(); }
      else finish(error);
    };
    const duration = Number(timeoutMs);
    const timer = setTimeout(() => finish(Object.assign(new Error('MCP listener timed out'), {code:'MCP_LISTEN_TIMEOUT'})), Number.isFinite(duration) && duration > 0 ? duration : 10000);
    server.on('error', failed); server.once('listening', listening); attempt();
  });
}
module.exports = {DEFAULT_MCP_PORTS, listenMcp};
