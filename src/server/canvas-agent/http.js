"use strict";

const { WebSocketServer, WebSocket } = require("ws");

const MAX_AGENT_FRAME_BYTES = 48 * 1024 * 1024;

function attachCanvasAgent({ server, authorize, resolveConnection, prepareConnection, listConnections, resolveWebSearch = () => null, resolveWidgetCapabilities = () => ({ professionalEnabled:false, privatePlugins:[] }), resolveProject = async () => null, stateDirectory, rootDirectory, modelTimeoutMs, canvasAgentTurnLimit, logger = () => {}, conversationLogger = null, conversationTrace = null, onModelUsage = null }) {
  const wss = new WebSocketServer({ noServer:true, maxPayload:MAX_AGENT_FRAME_BYTES, perMessageDeflate:false });
  let hostPromise = null;
  const harnessFactory = async () => {
    const runtime = await import("./runtime.mjs");
    return new runtime.CanvasHarnessHost({ stateDirectory, rootDirectory, resolveConnection, prepareConnection, listConnections, resolveWebSearch, resolveWidgetCapabilities, resolveProject, modelTimeoutMs, canvasAgentTurnLimit, logger, conversationLogger, conversationTrace, onModelUsage });
  };
  const nativeFactory = async () => {
    const codexNativeHost = await import("./codex-native-host.mjs");
    return new codexNativeHost.CodexNativeHost({ stateDirectory, rootDirectory, resolveConnection, resolveWebSearch, resolveWidgetCapabilities, resolveProject, modelTimeoutMs, canvasAgentTurnLimit, logger, conversationLogger, conversationTrace, onModelUsage });
  };
  const host = () => {
    if (!hostPromise) hostPromise = import("./host-router.mjs").then(async hostRouter => {
      const instance = new hostRouter.CanvasAgentHostRouter({
        resolveConnection,
        prepareConnection,
        harnessFactory,
        nativeFactory,
      });
      await instance.initialize();
      return instance;
    });
    return hostPromise;
  };

  const peers = new Set();
  let peerModulePromise = null;
  async function createPeer(options) {
    if (!peerModulePromise) peerModulePromise = import("./peer.mjs");
    const { createCanvasAgentPeer } = await peerModulePromise;
    const peer = createCanvasAgentPeer({ ...options, runtime:host, onDisconnect:closed => peers.delete(closed) });
    peers.add(peer);
    return peer;
  }

  const upgrade = (req, socket, head) => {
    let pathname;
    try { pathname = new URL(req.url, "http://localhost").pathname; } catch { return; }
    if (pathname !== "/api/canvas-agent/socket") return;
    const error = authorize(req);
    if (error) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nForbidden");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, ws => wss.emit("connection", ws, req));
  };

  server.on("upgrade", upgrade);
  wss.on("connection", ws => {
    const pending = [];
    let closed = false;
    const peerPromise = createPeer({ sendFrame:frame => { if (ws.readyState === WebSocket.OPEN) ws.send(frame); }, closeTransport:(code, reason) => ws.close(code, reason) });
    let delivery = Promise.resolve();
    ws.on("message", raw => {
      if (pending.length >= 64) return ws.close(1009, "Too many pending PenEcho Agent frames");
      pending.push(raw);
      delivery = delivery.then(async () => {
        const peer = await peerPromise;
        while (pending.length && !closed) await peer.receive(pending.shift());
      }).catch(error => {
        logger({ type:"canvas-agent-peer-error", error:String(error?.message || error) });
        if (ws.readyState === WebSocket.OPEN) ws.close(1011, "PenEcho Agent unavailable");
      });
    });
    ws.on("close", () => { closed = true; void peerPromise.then(peer => peer.disconnect()).catch(() => {}); });
    ws.on("error", error => logger({ type:"canvas-agent-socket-error", error:String(error?.message || error) }));
  });

  return {
    async activeProjectIds() {
      if (!hostPromise) return [];
      try { return (await hostPromise).activeProjectIds(); }
      catch { return []; }
    },
    async close() {
      server.off("upgrade", upgrade);
      for (const client of wss.clients) client.close(1001, "PenEcho server closing");
      for (const peer of [...peers]) await peer.disconnect();
      await new Promise(resolve => wss.close(resolve));
      if (hostPromise) await (await hostPromise).dispose();
    },
  };
}

module.exports = { attachCanvasAgent };
