"use strict";
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
function der(tag, ...parts) {
  const value = Buffer.concat(parts.map(p => Buffer.isBuffer(p) ? p : Buffer.from(p)));
  let n = value.length; const bytes = [];
  while (n) { bytes.unshift(n & 255); n >>>= 8; }
  return Buffer.concat([Buffer.from([tag, ...(value.length < 128 ? [value.length] : [128 | bytes.length, ...bytes])]), value]);
}
const seq = (...p) => der(48, ...p);
const oid = h => der(6, Buffer.from(h, 'hex'));
const algorithm = seq(oid('2a8648ce3d040302'));
const name = value => seq(der(49, seq(oid('550403'), der(12, value))));
const caName = name('PenEcho MCP Local CA');
const extension = (id, value, critical = false) => seq(oid(id), ...(critical ? [der(1, [255])] : []), der(4, value));
// RFC 5280 §4.1.2.5: no well-defined expiration date.
const CERTIFICATE_NOT_AFTER = Date.parse('9999-12-31T23:59:59Z');
function certificate(publicKey, signer, subject, extensions) {
  const serial = crypto.randomBytes(16); serial[0] = (serial[0] & 127) | 1;
  const date = ms => { const d = new Date(ms), text = d.toISOString().replace(/[-:T]/g, '').replace(/\.\d{3}Z$/, 'Z'); return der(d.getUTCFullYear() < 2050 ? 23 : 24, d.getUTCFullYear() < 2050 ? text.slice(2) : text); };
  const tbs = seq(der(160, der(2, [2])), der(2, serial), algorithm, caName,
    seq(date(Date.now() - 86400000), date(CERTIFICATE_NOT_AFTER)), subject,
    publicKey.export({format:'der', type:'spki'}), der(163, seq(...extensions)));
  const raw = seq(tbs, algorithm, der(3, [0], crypto.sign('sha256', tbs, signer)));
  return `-----BEGIN CERTIFICATE-----\n${raw.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`;
}
const keys = () => crypto.generateKeyPairSync('ec', {namedCurve:'prime256v1'});
const MAX_IDENTITY_BYTES = 64 * 1024;
function privateDirectory(directory) {
  fs.mkdirSync(directory, {recursive:true, mode:0o700});
  const info = fs.lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Stored MCP identity directory is invalid.');
  if (process.platform === 'win32') return;
  const fd = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_DIRECTORY);
  try { fs.fchmodSync(fd, 0o700); } finally { fs.closeSync(fd); }
}
function readIdentity(file) {
  const info = fs.lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_IDENTITY_BYTES) throw new Error('Stored MCP identity is invalid.');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_IDENTITY_BYTES) throw new Error('Stored MCP identity is invalid.');
    const buffer = Buffer.alloc(MAX_IDENTITY_BYTES + 1);
    let length = 0, count;
    while (length < buffer.length && (count = fs.readSync(fd, buffer, length, buffer.length - length, null))) length += count;
    if (length > MAX_IDENTITY_BYTES) throw new Error('Stored MCP identity is invalid.');
    const value = JSON.parse(buffer.toString('utf8', 0, length));
    if (process.platform !== 'win32') fs.fchmodSync(fd, 0o600);
    return value;
  } finally { fs.closeSync(fd); }
}
function loadDirectHttpIdentity(stateDirectory, reset = false) {
  const directory = path.join(stateDirectory, 'direct-http');
  privateDirectory(stateDirectory); privateDirectory(directory);
  const file = path.join(directory, 'identity.json');
  let value;
  try {
    if (reset) {
      try { const stat = fs.lstatSync(file); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Stored MCP identity is invalid.'); }
      catch (e) { if (e.code !== 'ENOENT') throw e; }
      throw Object.assign(new Error('Explicit identity reset'), {code:'ENOENT'});
    }
    value = readIdentity(file);
  }
  catch (e) {
    if (e.code !== 'ENOENT') throw new Error('Stored MCP identity is invalid.');
    const pair = keys();
    value = {version:1, accessToken:crypto.randomBytes(32).toString('hex'), key:pair.privateKey.export({format:'pem',type:'pkcs8'}),
      certificatePem:certificate(pair.publicKey, pair.privateKey, caName, [extension('551d13', seq(der(1, [255]), der(2, [0])), true), extension('551d0f', der(3, [1, 6]), true)])};
    const temporary = `${file}.${crypto.randomUUID()}.tmp`;
    try { fs.writeFileSync(temporary, JSON.stringify(value), {mode:0o600, flag:'wx'}); if (reset) fs.renameSync(temporary, file); else { try { fs.linkSync(temporary, file); } catch (e) { if (e.code !== 'EEXIST') throw e; } } value = readIdentity(file); }
    finally { try { fs.unlinkSync(temporary); } catch {} }
  }
  try {
    const cert = new crypto.X509Certificate(value.certificatePem), key = crypto.createPrivateKey(value.key);
    if (value.version !== 1 || !/^[a-f0-9]{64}$/.test(value.accessToken) || !cert.ca || !cert.checkPrivateKey(key) || !cert.verify(cert.publicKey) || Date.parse(cert.validTo) <= Date.now()) throw new Error();
    return {...value, hostId:crypto.createHash('sha256').update(cert.raw).digest('hex')};
  } catch { throw new Error('Stored MCP identity is invalid.'); }
}
function createDirectHttpLeaf(identity, addresses, hostnames = []) {
  const pair = keys();
  return {key:pair.privateKey.export({format:'pem',type:'pkcs8'}), cert:certificate(pair.publicKey, crypto.createPrivateKey(identity.key), name('PenEcho MCP'), [
    extension('551d13', seq(), true), extension('551d0f', der(3, [7, 128]), true),
    extension('551d25', seq(oid('2b06010505070301'))),
    extension('551d11', seq(...[...new Set(['localhost',...hostnames])].map(host=>der(130,host)), ...[...new Set(['127.0.0.1', ...addresses])].map(a => der(135, a.split('.').map(Number)))))
  ])};
}
module.exports = {loadDirectHttpIdentity, createDirectHttpLeaf, resetDirectHttpIdentity:stateDirectory => loadDirectHttpIdentity(stateDirectory, true)};
