"use strict";

const net = require("node:net");
const os = require("node:os");

const TUNNEL_INTERFACE = /^(?:utun\d*|tun\d*|tap\d*|wg\d*|ipsec\d*|ppp\d*)$/i;
// These adapters expose host-only, VM, or VPN networks, not LAN entry points.
// Match adapter names rather than private subnets: physical LANs use those too.
const VIRTUAL_INTERFACE = /(?:^vEthernet\b|\bVMware\b|\bVMnet\d*\b|\bVirtualBox\b|\bVBox\b|\bhost[- ]only\b|\bWSL\b|\bDocker\b|\bTailscale\b|\bZeroTier\b|\bWireGuard\b|\bWintun\b|\bOpenVPN\b|\bTAP-Windows\b|\bVPN\b|^Clash\b|^Mihomo\b|^Meta\b|^sing-box\b)/i;

function isPrivateIpv4(address) {
  const value = String(address);
  if (net.isIP(value) !== 4) return false;
  const [first, second] = value.split(".").map(Number);
  return first === 10 || first === 192 && second === 168 || first === 172 && second >= 16 && second <= 31;
}

function ipv4Priority(address) {
  const [first, second] = address.split(".").map(Number);
  if (first === 192 && second === 168) return 0;
  if (first === 10) return 1;
  if (first === 172 && second >= 16 && second <= 31) return 2;
  if (first === 100 && second >= 64 && second <= 127) return 3;
  return 4;
}

function isExcludedIpv4(address) {
  const [first, second] = address.split(".").map(Number);
  return first === 0 || first === 127 || first >= 224
    || first === 169 && second === 254
    || first === 198 && second >= 18 && second <= 19;
}

function lanHosts(interfaces = os.networkInterfaces()) {
  const candidates = [];
  for (const [interfaceName, entries] of Object.entries(interfaces || {})) {
    if (TUNNEL_INTERFACE.test(interfaceName) || VIRTUAL_INTERFACE.test(interfaceName) || !Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (entry?.internal || ![4, "IPv4"].includes(entry?.family) || !entry?.address) continue;
      const address = String(entry.address);
      if (net.isIP(address) !== 4 || isExcludedIpv4(address)) continue;
      candidates.push({ address, priority:ipv4Priority(address) });
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
