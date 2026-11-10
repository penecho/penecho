"use strict";

const { EventEmitter } = require("node:events");
const { randomUUID } = require("node:crypto");
const MAX_FRAME_BYTES = 12 * 1024 * 1024;
const MAX_QUEUE_BYTES = 24 * 1024 * 1024;
const MAX_CHANNELS = 8;
const LEASE_MS = 45_000;
const POLL_MS = 15_000;
const failure = (code, message) => Object.assign(new Error(message), {code});

// Internal connector adapter only: never mount this executor on public HTTP.
// Native transport pongs do not renew the browser lease; only inbound activity does.
function createRemoteMcpChannels({ attach, leaseMs = LEASE_MS, pollMs = POLL_MS }) {
  const channels = new Map();
  let stopped = false;
  function drain(channel) {
    const frames = [];
    let bytes = 0;
    while (channel.frames.length && bytes + Buffer.byteLength(channel.frames[0]) <= MAX_FRAME_BYTES) {
      const frame = channel.frames.shift();
      frames.push(frame);
      bytes += Buffer.byteLength(frame);
    }
    channel.bytes -= bytes;
    return {frames, closed:channel.closed};
  }
  function wake(channel) {
    if (!channel.waiter) return;
    clearTimeout(channel.waiter.timer);
    const {resolve} = channel.waiter;
    channel.waiter = null;
    resolve(drain(channel));
  }
  function end(channel) {
    if (channel.closed) return;
    channel.closed = true;
    clearTimeout(channel.expiry);
    channels.delete(channel.id);
    channel.frames = [];
    channel.bytes = 0;
    channel.socket.readyState = 3;
    channel.socket.emit("close");
    wake(channel);
  }
  function touch(channel) {
    clearTimeout(channel.expiry);
    channel.expiry = setTimeout(() => end(channel), leaseMs);
    channel.expiry.unref?.();
  }
  async function execute(input) {
    if (stopped) throw failure("mcp_service_closed", "The MCP service is closed.");
    const operation = input?.operation;
    if (!["canvas.mcp.open", "canvas.mcp.frame", "canvas.mcp.pull", "canvas.mcp.close"].includes(operation)) throw failure("mcp_remote_operation", "Invalid MCP channel operation.");
    if (operation === "canvas.mcp.open") {
      if (channels.size >= MAX_CHANNELS) throw failure("mcp_remote_limit", "Too many remote MCP channels.");
      const socket = new EventEmitter();
      const channel = {id:randomUUID(), socket, frames:[], bytes:0, closed:false, waiter:null, expiry:null};
      socket.readyState = 1;
      socket.close = socket.terminate = () => end(channel);
      socket.ping = () => socket.emit("pong");
      socket.send = frame => {
        if (channel.closed) throw failure("mcp_remote_session", "MCP channel is closed.");
        const bytes = Buffer.byteLength(frame);
        if (bytes > MAX_FRAME_BYTES || channel.bytes + bytes > MAX_QUEUE_BYTES || channel.frames.length >= 128) {
          end(channel);
          throw failure("mcp_remote_limit", "MCP channel queue exceeded its limit.");
        }
        channel.frames.push(frame);
        channel.bytes += bytes;
        wake(channel);
      };
      channels.set(channel.id, channel);
      touch(channel);
      try { attach(socket); } catch (error) { end(channel); throw error; }
      return {channelId:channel.id};
    }
    const channel = channels.get(input?.channelId);
    if (!channel) {
      if (operation === "canvas.mcp.close") return {closed:true};
      throw failure("mcp_remote_session", "Remote MCP channel was not found.");
    }
    if (operation === "canvas.mcp.close") { end(channel); return {closed:true}; }
    if (operation === "canvas.mcp.frame") {
      if (typeof input.frame !== "string" || !input.frame || Buffer.byteLength(input.frame) > MAX_FRAME_BYTES) throw failure("mcp_remote_frame", "Invalid MCP frame.");
      try { JSON.parse(input.frame); } catch { throw failure("mcp_remote_frame", "Invalid MCP JSON frame."); }
      touch(channel);
      channel.socket.emit("message", Buffer.from(input.frame));
      return {accepted:!channel.closed};
    }
    if (channel.waiter) throw failure("mcp_remote_poll_conflict", "An MCP channel poll is already pending.");
    touch(channel);
    if (channel.frames.length) return drain(channel);
    return new Promise(resolve => {
      const timer = setTimeout(() => wake(channel), pollMs);
      timer.unref?.();
      channel.waiter = {resolve, timer};
    });
  }
  return {execute, disconnect() { for (const channel of channels.values()) end(channel); }, close() { stopped = true; for (const channel of channels.values()) end(channel); }};
}

module.exports = { createRemoteMcpChannels, MAX_FRAME_BYTES, MAX_QUEUE_BYTES, MAX_CHANNELS, LEASE_MS, POLL_MS };
