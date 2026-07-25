"use strict";

const os = require("node:os");

const VIRTUAL_INTERFACE = /^(?:lo|utun|awdl|llw|docker|bridge|vmnet|vbox|virbr|tailscale|wg)/i;

function isPrivateIpv4(address) {
  const parts = String(address).split(".").map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10 || parts[0] === 192 && parts[1] === 168 || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31;
}

function lanHosts(interfaces = os.networkInterfaces()) {
  const candidates = [];
  for (const [name, entries] of Object.entries(interfaces || {})) {
    if (VIRTUAL_INTERFACE.test(name)) continue;
    for (const entry of entries || []) {
      if (entry?.internal || entry?.family !== "IPv4" || !entry.address) continue;
      candidates.push({ address:String(entry.address), private:isPrivateIpv4(entry.address) });
    }
  }
  return [...new Map(candidates
    .sort((a, b) => Number(b.private) - Number(a.private) || a.address.localeCompare(b.address, undefined, { numeric:true }))
    .map(item => [item.address, item.address])).values()].slice(0, 3);
}

function lanUrls(port, hosts = lanHosts()) {
  const value = Number(port);
  if (!Number.isInteger(value) || value < 1 || value > 65535) return [];
  return hosts.map(host => `http://${host}:${value}/`);
}

module.exports = { isPrivateIpv4, lanHosts, lanUrls };
