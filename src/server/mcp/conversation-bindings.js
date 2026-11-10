"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

// Metadata only: a damaged binding must fail closed rather than create a new document.
function conversationBindings(directory) {
  const key = (client, sessionKey) => crypto.createHash("sha256").update(JSON.stringify([client || "External AI", sessionKey])).digest("hex");
  const invalid = () => new Error("Stored MCP conversation binding is invalid.");
  function checkDirectory(create = false) {
    if (create) fs.mkdirSync(directory, {recursive:true,mode:0o700});
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw invalid();
  }
  function read(client, sessionKey) {
    if (!sessionKey) return null;
    try {
      checkDirectory();
      const file = path.join(directory, `${key(client, sessionKey)}.json`), stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8192) throw invalid();
      const fd = fs.openSync(file,fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      let value;
      try {
        const info = fs.fstatSync(fd); if (!info.isFile() || info.size > 8192) throw invalid();
        const buffer = Buffer.alloc(8193); let length = 0, count;
        while (length < buffer.length && (count = fs.readSync(fd,buffer,length,buffer.length-length,null))) length += count;
        if (length > 8192) throw invalid();
        value = JSON.parse(buffer.toString('utf8',0,length));
      } finally { fs.closeSync(fd); }
      if (value.sessionKey !== sessionKey || value.client !== (client || "External AI") || typeof value.documentId !== "string" || !value.documentId || value.documentId.length > 256 || typeof value.canvasId !== "string" || !value.canvasId || value.canvasId.length > 128) throw invalid();
      return value;
    } catch (error) { if (error.code === "ENOENT") return null; throw invalid(); }
  }
  function write(value) {
    if (!value.sessionKey || !value.documentId) return;
    checkDirectory(true);
    const file = path.join(directory, `${key(value.client, value.sessionKey)}.json`), temp = `${file}.${crypto.randomUUID()}.tmp`;
    const bytes = JSON.stringify({sessionKey:value.sessionKey,client:value.client || "External AI",canvasId:value.canvasId,documentId:value.documentId,updatedAt:Date.now()});
    if (Buffer.byteLength(bytes) > 8192) throw invalid();
    try {
      fs.writeFileSync(temp, bytes, {flag:"wx",mode:0o600});
      fs.renameSync(temp,file);
    } finally { try {fs.unlinkSync(temp);} catch(error) {if(error.code !== "ENOENT") throw error;} }
  }
  return {read,write};
}
module.exports = {conversationBindings};
