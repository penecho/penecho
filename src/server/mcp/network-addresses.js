"use strict";
const os = require("node:os");
const net = require("node:net");
const normalize = address => String(address || '').replace(/^::ffff:/,'');
function isPrivateAddress(address) {
  const a = normalize(address);
  return net.isIPv4(a) && (/^10\.\d+\.\d+\.\d+$/.test(a) || /^192\.168\.\d+\.\d+$/.test(a) || /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(a));
}
function lanAddresses() { return [...new Set(Object.values(os.networkInterfaces()).flat().filter(a => a && a.family === 'IPv4' && isPrivateAddress(a.address)).map(a => a.address))]; }
module.exports = {isPrivateAddress, lanAddresses};
