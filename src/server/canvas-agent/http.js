"use strict";

const { randomUUID } = require("crypto");
const { WebSocketServer, WebSocket } = require("ws");

const MAX_AGENT_FRAME_BYTES = 8 * 1024 * 1024;
const MAX_REMOTE_AGENT_CHANNELS = 8;
const REMOTE_AGENT_CHANNEL_TTL_MS = 5 * 60_000;
const REMOTE_AGENT_POLL_MS = 15_000;

function attachCanvasAgent({ server, authorize, resolveConnection, listConnections, resolveWebSearch = () => null, stateDirectory, rootDirectory, modelTimeoutMs, logger = () => {}, conversationLogger = null, conversationTrace = null }) {
  const wss = new WebSocketServer({ noServer:true, maxPayload:8 * 1024 * 1024, perMessageDeflate:false });
  let hostPromise = null;
  const host = () => {
    if (!hostPromise) hostPromise = Promise.all([
      import("./runtime.mjs"),
      import("./protocol.mjs"),
    ]).then(async ([runtime]) => {
      const instance = new runtime.CanvasHarnessHost({ stateDirectory, rootDirectory, resolveConnection, listConnections, resolveWebSearch, modelTimeoutMs, logger, conversationLogger, conversationTrace });
      await instance.initialize();
      return instance;
    });
    return hostPromise;
  };

  const peers = new Set(), remoteChannels = new Map();
  function createPeer({ sendFrame, closeTransport = () => {} }) {
    const binding = {}, state = { session:null, incomingSeq:0, outgoingSeq:0, closed:false, receiveQueue:Promise.resolve() };
    const send = (type, payload, identity = state.session) => {
      if (state.closed) return;
      state.outgoingSeq += 1;
      sendFrame(JSON.stringify({
        version:1,
        type,
        canvasSessionId:identity?.id || "",
        clientId:identity?.clientId || "",
        seq:state.outgoingSeq,
        payload,
      }));
    };
    const fail = (error, fatal = false) => {
      send("error", { message:String(error?.message || error || "Canvas Agent failed."), fatal });
      if (fatal) closeTransport(1008, "Canvas Agent protocol error");
    };
    const processFrame = async raw => {
      if (state.closed) return;
      try {
        if (Buffer.byteLength(raw) > MAX_AGENT_FRAME_BYTES) throw new Error("Canvas Agent message is too large.");
        const { parseClientEnvelope } = await import("./protocol.mjs");
        const envelope = parseClientEnvelope(raw);
        if (envelope.seq <= state.incomingSeq) throw new Error("Canvas Agent message sequence must increase.");
        state.incomingSeq = envelope.seq;
        const runtime = await host();
        if (envelope.type === "hello") {
          if (state.session) throw new Error("Canvas Agent hello was already accepted.");
          state.session = await runtime.connect({
            canvasSessionId:envelope.canvasSessionId || envelope.payload?.canvasSessionId || "",
            resumeToken:String(envelope.payload?.resumeToken || ""),
            clientId:String(envelope.clientId || envelope.payload?.clientId || ""),
            connectionId:String(envelope.payload?.connectionId || "default"),
            webSearchEnabled:envelope.payload?.webSearchEnabled === true,
            binding,
            send,
          });
          return;
        }
        if (state.session?.binding !== binding) throw new Error("Canvas Agent session moved to another connection.");
        if (!state.session || envelope.canvasSessionId && envelope.canvasSessionId !== state.session.id) throw new Error("Canvas Agent session is not established.");
        if (envelope.type === "state_sync") runtime.updateState(state.session, envelope.payload?.digest);
        else if (envelope.type === "user_turn" || envelope.type === "steer") {
          runtime.setWebSearchEnabled(state.session, envelope.payload?.webSearchEnabled === true);
          void runtime.submit(state.session, envelope.payload?.text, envelope.type === "steer", envelope.payload?.images, envelope.payload?.references).catch(error => fail(error));
        }
        else if (envelope.type === "cancel") runtime.cancel(state.session);
        else if (envelope.type === "tool_result") runtime.resolveToolResult(state.session, envelope.payload);
        else if (envelope.type === "new_conversation") {
          const previous = state.session, connectionId = String(envelope.payload?.connectionId || previous.connectionId);
          if (!resolveConnection(connectionId)) throw new Error("The selected AI connection was not found.");
          await runtime.disposeSession(previous);
          state.session = await runtime.connect({ clientId:previous.clientId, connectionId, webSearchEnabled:envelope.payload?.webSearchEnabled === true, binding, send });
        } else if (envelope.type === "ping") send("pong", { time:Date.now() });
      } catch (error) {
        fail(error, !state.session);
      }
    };
    const receive = raw => {
      const pending = state.receiveQueue.then(() => processFrame(raw));
      state.receiveQueue = pending.catch(() => {});
      return pending;
    };
    const disconnect = async () => {
      if (state.closed) return;
      state.closed = true;
      peers.delete(peer);
      await state.receiveQueue.catch(() => {});
      if (state.session) await host().then(runtime => runtime.disconnect(state.session, binding)).catch(() => {});
    };
    const peer = { receive, disconnect };
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
      if (remoteChannels.size >= MAX_REMOTE_AGENT_CHANNELS) throw Object.assign(new Error("Too many remote Canvas Agent sessions are open."), { code:"canvas_agent_limit" });
      const id = randomUUID(), channel = { id, frames:[], waiter:null, expiryTimer:null, closed:false, peer:null };
      channel.peer = createPeer({
        sendFrame:frame => { if (!channel.closed) { channel.frames.push(frame); touchRemoteChannel(channel); wakeRemoteChannel(channel); } },
        closeTransport:() => { channel.closed = true; wakeRemoteChannel(channel); },
      });
      remoteChannels.set(id, channel);
      touchRemoteChannel(channel);
      return { channelId:id };
    }
    const channel = remoteChannels.get(String(input?.channelId || ""));
    if (!channel) throw Object.assign(new Error("Remote Canvas Agent session was not found."), { code:"canvas_agent_session" });
    touchRemoteChannel(channel);
    if (operation === "canvas.agent.frame") {
      const frame = String(input?.frame || "");
      if (!frame || Buffer.byteLength(frame) > MAX_AGENT_FRAME_BYTES) throw Object.assign(new Error("Remote Canvas Agent frame is invalid."), { code:"canvas_agent_frame" });
      await channel.peer.receive(frame);
      return { accepted:true };
    }
    if (operation === "canvas.agent.pull") {
      if (channel.frames.length || channel.closed) return drainRemoteChannel(channel);
      if (channel.waiter) throw Object.assign(new Error("A Remote Canvas Agent poll is already pending."), { code:"canvas_agent_poll_conflict" });
      return new Promise(resolve => {
        const timer = setTimeout(() => { if (channel.waiter?.timer !== timer) return; channel.waiter = null; resolve({ frames:[], closed:false }); }, REMOTE_AGENT_POLL_MS);
        timer.unref?.();
        channel.waiter = { resolve, timer };
      });
    }
    if (operation === "canvas.agent.close") return { closed:await closeRemoteChannel(channel.id) };
    throw Object.assign(new Error("Remote Canvas Agent operation is invalid."), { code:"canvas_agent_operation" });
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
    const peer = createPeer({ sendFrame:frame => { if (ws.readyState === WebSocket.OPEN) ws.send(frame); }, closeTransport:(code, reason) => ws.close(code, reason) });
    ws.on("message", raw => { void peer.receive(raw); });
    ws.on("close", () => { void peer.disconnect(); });
    ws.on("error", error => logger({ type:"canvas-agent-socket-error", error:String(error?.message || error) }));
  });

  return {
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
