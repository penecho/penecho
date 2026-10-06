"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

function validateAddress(host, port) {
  if (typeof host !== "string" || net.isIP(host) !== 4 || host === "0.0.0.0" || Number(host.split(".")[0]) >= 224) {
    throw Object.assign(new Error("Enter a valid IPv4 address for this PenEcho host."), {status:400, code:"invalid_ip_address"});
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw Object.assign(new Error("The port must be between 1 and 65535."), {status:400, code:"invalid_ip_port"});
  }
  return {host, port};
}

const endpoint = value => value.host ? `https://${value.host}:${value.port}/mcp` : "";
function createIpDirectSettings(stateDirectory) {
  const file = path.join(stateDirectory, "direct-http", "ip-direct.json");
  let value = {version:1, revision:0, host:"", port:0, enabled:false, accessToken:"", previousUrl:""};
  try {
    const directoryInfo = fs.lstatSync(path.dirname(file));
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) throw Error("Invalid IP direct settings directory.");
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    try {
      const info = fs.fstatSync(fd);
      if (!info.isFile() || info.size > 4096) throw Error("Invalid IP direct settings file.");
      const bytes = Buffer.alloc(4097);
      const length = fs.readSync(fd, bytes, 0, bytes.length, 0);
      if (length > 4096) throw Error("Invalid IP direct settings file.");
      const data = JSON.parse(bytes.toString("utf8", 0, length));
      if (data.version !== 1 || !Number.isSafeInteger(data.revision) || data.revision < 1 || typeof data.enabled !== "boolean"
        || typeof data.accessToken !== "string" || !/^(?:[a-f0-9]{64})?$/.test(data.accessToken) || typeof data.previousUrl !== "string"
        || data.enabled && !data.accessToken || Object.keys(data).some(key => !Object.hasOwn(value,key))) throw Error("Invalid IP direct settings.");
      validateAddress(data.host, data.port);
      if (data.previousUrl && !/^https:\/\/[0-9.]+:\d+\/mcp$/.test(data.previousUrl)) throw Error("Invalid previous IP direct address.");
      value = data;
    } finally { fs.closeSync(fd); }
  } catch (error) {
    if (error.code !== "ENOENT") throw Object.assign(new Error("Stored IP direct settings are invalid."), {code:"invalid_ip_settings"});
  }
  function save(next) {
    const directory = path.dirname(file);
    fs.mkdirSync(directory, {recursive:true, mode:0o700});
    const info = fs.lstatSync(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw Error("Invalid IP direct settings directory.");
    const temporary = file + "." + crypto.randomUUID() + ".tmp";
    const result = {...next, revision:value.revision + 1};
    try {
      fs.writeFileSync(temporary, JSON.stringify(result), {mode:0o600, flag:"wx"});
      fs.renameSync(temporary, file);
      value = result;
    } finally { try { fs.unlinkSync(temporary); } catch {} }
    return {...value};
  }
  function apply(input) {
    const fields = {
      "save-address":["action","host","port","revision"],
      "generate-token":["action","host","port","revision"],
      "rotate-token":["action","revision"],
      "set-enabled":["action","enabled","revision"],
    };
    if (!input || typeof input !== "object" || Array.isArray(input) || typeof input.action !== "string" || !Object.hasOwn(fields,input.action)
      || Object.keys(input).some(key => !fields[input.action].includes(key))) {
      throw Object.assign(new Error("Invalid IP direct action."), {status:400, code:"invalid_ip_action"});
    }
    if (input.revision !== value.revision) throw Object.assign(new Error("IP direct settings changed. Refresh before trying again."), {status:409, code:"ip_settings_changed"});
    let next = {...value};
    if (["save-address","generate-token"].includes(input.action)) {
      Object.assign(next, validateAddress(input.host, input.port));
      if (value.accessToken && endpoint(next) !== endpoint(value)) next.previousUrl = value.previousUrl || endpoint(value);
    }
    if (input.action === "generate-token") {
      next.accessToken ||= crypto.randomBytes(32).toString("hex");
      next.enabled = true;
    }
    if (input.action === "rotate-token") {
      if (!value.accessToken) throw Object.assign(new Error("Generate an IP direct token first."), {status:400,code:"ip_token_required"});
      next.accessToken = crypto.randomBytes(32).toString("hex");
      next.previousUrl = "";
    }
    if (input.action === "set-enabled") {
      if (typeof input.enabled !== "boolean" || !value.accessToken) throw Object.assign(new Error("Generate an IP direct token first."), {status:400,code:"ip_token_required"});
      next.enabled = input.enabled;
    }
    return save(next);
  }
  return {get:() => ({...value}), apply, endpoint:() => endpoint(value)};
}

module.exports = {createIpDirectSettings, validateAddress};
