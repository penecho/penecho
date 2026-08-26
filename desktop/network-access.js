"use strict";

const os = require("node:os");

function isPrivateIpv4(address) {
  const parts = String(address).split(".").map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10 || parts[0] === 192 && parts[1] === 168 || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31;
}

function ipv4Priority(address) {
  const [first, second] = String(address).split(".").map(Number);
  if (first === 192 && second === 168) return 0;
  if (first === 10) return 1;
  if (first === 172 && second >= 16 && second <= 31) return 2;
  if (first === 100 && second >= 64 && second <= 127) return 3;
  if (first === 169 && second === 254) return 4;
  return 5;
}

function lanHosts(interfaces = os.networkInterfaces()) {
  const candidates = [];
  for (const entries of Object.values(interfaces || {})) {
    for (const entry of entries || []) {
      if (entry?.internal || ![4, "IPv4"].includes(entry?.family) || !entry.address) continue;
      candidates.push({ address:String(entry.address), priority:ipv4Priority(entry.address) });
    }
  }
  return [...new Map(candidates
    .sort((a, b) => a.priority - b.priority || a.address.localeCompare(b.address, undefined, { numeric:true }))
    .map(item => [item.address, item.address])).values()];
}

function lanUrls(port, hosts = lanHosts()) {
  const value = Number(port);
  if (!Number.isInteger(value) || value < 1 || value > 65535) return [];
  return hosts.map(host => `http://${host}:${value}/`);
}

module.exports = { isPrivateIpv4, lanHosts, lanUrls };
