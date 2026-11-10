"use strict";

const { randomUUID } = require("crypto");
const { WebSocketServer, WebSocket } = require("ws");

const MAX_AGENT_FRAME_BYTES = 48 * 1024 * 1024;
const MAX_REMOTE_AGENT_CHANNELS = 8;
const REMOTE_AGENT_CHANNEL_TTL_MS = 5 * 60_000;
const REMOTE_AGENT_POLL_MS = 15_000;

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

  const peers = new Set(), remoteChannels = new Map();
  let peerModulePromise = null;
  async function createPeer(options) {
    if (!peerModulePromise) peerModulePromise = import("./peer.mjs");
    const { createCanvasAgentPeer } = await peerModulePromise;
    const peer = createCanvasAgentPeer({ ...options, runtime:host, onDisconnect:closed => peers.delete(closed) });
    peers.add(peer);
    return peer;
  }

  function touchRemoteChannel(channel) {
    clearTimeout(channel.expiryTimer);
    channel.expiryTimer = setTimeout(() => closeRemoteChannel(channel.id), REMOTE_AGENT_CHANNEL_TTL_MS);
    channel.expiryTimer.unref?.();
  }
  function drainRemoteChannel(channel) {
    const frames = channel.frames.splice(0, 64), closed = Boolean(channel.closed && channel.frames.length === 0);
    if (closed) remoteChannels.delete(channel.id);
    return { frames, closed };
  }
  function wakeRemoteChannel(channel) {
    if (!channel.waiter || !channel.frames.length && !channel.closed) return;
    const waiter = channel.waiter;
    channel.waiter = null;
    clearTimeout(waiter.timer);
    waiter.resolve(drainRemoteChannel(channel));
  }
  async function closeRemoteChannel(id) {
    const channel = remoteChannels.get(String(id || ""));
    if (!channel) return false;
    remoteChannels.delete(channel.id);
    clearTimeout(channel.expiryTimer);
    channel.closed = true;
    wakeRemoteChannel(channel);
    await channel.peer.disconnect();
    return true;
  }
  async function executeRemote(input) {
    const operation = String(input?.operation || "");
    if (operation === "canvas.agent.open") {
      if (remoteChannels.size >= MAX_REMOTE_AGENT_CHANNELS) throw Object.assign(new Error("Too many remote PenEcho Agent sessions are open."), { code:"canvas_agent_limit" });
      const id = randomUUID(), channel = { id, frames:[], waiter:null, expiryTimer:null, closed:false, peer:null };
      channel.peer = await createPeer({
        sendFrame:frame => { if (!channel.closed) { channel.frames.push(frame); touchRemoteChannel(channel); wakeRemoteChannel(channel); } },
        closeTransport:() => { channel.closed = true; wakeRemoteChannel(channel); },
      });
      remoteChannels.set(id, channel);
      touchRemoteChannel(channel);
      return { channelId:id };
    }
    const channel = remoteChannels.get(String(input?.channelId || ""));
    if (!channel) throw Object.assign(new Error("Remote PenEcho Agent session was not found."), { code:"canvas_agent_session" });
    touchRemoteChannel(channel);
    if (operation === "canvas.agent.frame") {
      const frame = String(input?.frame || "");
      if (!frame || Buffer.byteLength(frame) > MAX_AGENT_FRAME_BYTES) throw Object.assign(new Error("Remote PenEcho Agent frame is invalid."), { code:"canvas_agent_frame" });
      await channel.peer.receive(frame);
      return { accepted:true };
    }
    if (operation === "canvas.agent.pull") {
      if (channel.frames.length || channel.closed) return drainRemoteChannel(channel);
      if (channel.waiter) throw Object.assign(new Error("A Remote PenEcho Agent poll is already pending."), { code:"canvas_agent_poll_conflict" });
      return new Promise(resolve => {
        const timer = setTimeout(() => { if (channel.waiter?.timer !== timer) return; channel.waiter = null; resolve({ frames:[], closed:false }); }, REMOTE_AGENT_POLL_MS);
        timer.unref?.();
        channel.waiter = { resolve, timer };
      });
    }
    if (operation === "canvas.agent.close") return { closed:await closeRemoteChannel(channel.id) };
    throw Object.assign(new Error("Remote PenEcho Agent operation is invalid."), { code:"canvas_agent_operation" });
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
      for (const channelId of [...remoteChannels.keys()]) await closeRemoteChannel(channelId);
      for (const peer of [...peers]) await peer.disconnect();
      await new Promise(resolve => wss.close(resolve));
      if (hostPromise) await (await hostPromise).dispose();
    },
    executeRemote,
  };
}

module.exports = { attachCanvasAgent };
