"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const shared = require("../src/server/network-access.js");
const desktop = require("../desktop/network-access.js");
const { isPrivateIpv4, lanHosts, lanUrls } = shared;

test("desktop network access re-exports the shared helper", () => {
  assert.strictEqual(desktop.isPrivateIpv4, shared.isPrivateIpv4);
  assert.strictEqual(desktop.lanHosts, shared.lanHosts);
  assert.strictEqual(desktop.lanUrls, shared.lanUrls);
  assert.deepEqual(Object.keys(desktop), ["isPrivateIpv4", "lanHosts", "lanUrls"]);
});

test("lanHosts removes the real tunnel benchmark address while keeping the LAN address", () => {
  assert.deepEqual(lanHosts({
    en0:[{ address:"192.168.3.158", family:"IPv4", internal:false }],
    utun4:[{ address:"198.18.64.45", family:"IPv4", internal:false }],
  }), ["192.168.3.158"]);
});

test("lanHosts excludes the complete benchmark range on ordinary interfaces", () => {
  assert.deepEqual(lanHosts({
    before:[{ address:"198.17.255.255", family:"IPv4", internal:false }],
    benchmarkStart:[{ address:"198.18.0.0", family:"IPv4", internal:false }],
    benchmarkEnd:[{ address:"198.19.255.255", family:"IPv4", internal:false }],
    after:[{ address:"198.20.0.0", family:"IPv4", internal:false }],
  }), ["198.17.255.255", "198.20.0.0"]);
});

test("lanHosts excludes private addresses from every supported tunnel interface", () => {
  const tunnelNames = ["utun4", "tun0", "tap", "wg12", "ipsec2", "ppp0", "UTUN9"];
  const interfaces = Object.fromEntries(tunnelNames.map((name, index) => [name, [
    { address:`10.0.${index}.1`, family:"IPv4", internal:false },
  ]]));
  assert.deepEqual(lanHosts(interfaces), []);
});

test("lanHosts accepts numeric and string IPv4 families and ignores malformed entries", () => {
  assert.deepEqual(lanHosts({
    numeric:[{ address:"192.168.1.20", family:4, internal:false }],
    string:[{ address:"10.0.0.5", family:"IPv4", internal:false }],
    internal:[{ address:"192.168.1.21", family:"IPv4", internal:true }],
    ipv6:[{ address:"2001:db8::1", family:"IPv6", internal:false }],
    nullEntry:[null, undefined, { address:"not-an-ip", family:"IPv4", internal:false }],
    malformedEntries:null,
  }), ["192.168.1.20", "10.0.0.5"]);
});

test("lanHosts preserves priority, numeric address order, and deduplication", () => {
  assert.deepEqual(lanHosts({
    public:[
      { address:"203.0.113.10", family:"IPv4", internal:false },
      { address:"203.0.113.2", family:"IPv4", internal:false },
    ],
    linkLocal:[{ address:"169.254.20.2", family:"IPv4", internal:false }],
    cgnat:[{ address:"100.64.0.2", family:"IPv4", internal:false }],
    private172:[{ address:"172.20.0.2", family:"IPv4", internal:false }],
    private10:[{ address:"10.0.0.20", family:"IPv4", internal:false }],
    private192:[
      { address:"192.168.1.20", family:"IPv4", internal:false },
      { address:"192.168.1.2", family:"IPv4", internal:false },
    ],
    duplicate:[{ address:"192.168.1.2", family:"IPv4", internal:false }],
  }), [
    "192.168.1.2", "192.168.1.20", "10.0.0.20", "172.20.0.2",
    "100.64.0.2", "203.0.113.2", "203.0.113.10",
  ]);
});

test("lanHosts excludes invalid, unspecified, loopback, multicast, and reserved IPv4", () => {
  assert.deepEqual(lanHosts({
    invalid:[
      { address:"not-an-ip", family:"IPv4", internal:false },
      { address:"192.168.1.256", family:"IPv4", internal:false },
    ],
    unspecified:[{ address:"0.1.2.3", family:"IPv4", internal:false }],
    loopback:[{ address:"127.0.0.2", family:"IPv4", internal:false }],
    multicast:[{ address:"224.0.0.1", family:"IPv4", internal:false }],
    reserved:[{ address:"240.0.0.1", family:"IPv4", internal:false }],
  }), []);
});

test("isPrivateIpv4 recognizes only RFC1918 IPv4 ranges", () => {
  assert.equal(isPrivateIpv4("10.0.0.1"), true);
  assert.equal(isPrivateIpv4("172.16.0.1"), true);
  assert.equal(isPrivateIpv4("172.31.255.255"), true);
  assert.equal(isPrivateIpv4("192.168.255.255"), true);
  assert.equal(isPrivateIpv4("172.15.255.255"), false);
  assert.equal(isPrivateIpv4("172.32.0.1"), false);
  assert.equal(isPrivateIpv4("100.64.0.1"), false);
  assert.equal(isPrivateIpv4("192.168.1.256"), false);
  assert.equal(isPrivateIpv4("2001:db8::1"), false);
});

test("lanHosts returns no addresses for empty or null interface maps", () => {
  assert.deepEqual(lanHosts({}), []);
  assert.deepEqual(lanHosts(null), []);
});

test("lanUrls validates ports and preserves hosts with a trailing slash", () => {
  const hosts = ["192.168.1.2", "203.0.113.8"];
  assert.deepEqual(lanUrls(3888, hosts), ["http://192.168.1.2:3888/", "http://203.0.113.8:3888/"]);
  assert.deepEqual(lanUrls("65535", hosts), ["http://192.168.1.2:65535/", "http://203.0.113.8:65535/"]);
  for (const port of [0, -1, 65536, 3888.5, "not-a-port", null, undefined]) assert.deepEqual(lanUrls(port, hosts), [], String(port));
});

test("LAN announcements omit Windows VM and VPN adapters without excluding physical private subnets", () => {
  const virtualNames = ["vEthernet (Default Switch)", "vEthernet (WSL)", "VMware Network Adapter VMnet1", "VirtualBox Host-Only Network", "Tailscale", "ZeroTier One", "WireGuard Tunnel", "OpenVPN TAP-Windows6", "Clash", "Mihomo", "Meta", "sing-box", "Work VPN"];
  const interfaces = Object.fromEntries(virtualNames.map((name, index) => [name, [{ address:`192.168.50.${index + 1}`, family:"IPv4", internal:false }]]));
  interfaces["Wi-Fi"] = [{ address:"192.168.50.100", family:"IPv4", internal:false }];
  interfaces["以太网"] = [{ address:"172.20.32.2", family:4, internal:false }];
  interfaces["Ethernet 2"] = [{ address:"169.254.20.1", family:"IPv4", internal:false }];
  assert.deepEqual(lanHosts(interfaces), ["192.168.50.100", "172.20.32.2"]);
  assert.deepEqual(lanUrls(3888, lanHosts(interfaces)), ["http://192.168.50.100:3888/", "http://172.20.32.2:3888/"]);
});
