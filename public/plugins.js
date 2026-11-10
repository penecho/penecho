"use strict";
(() => {
  const MAX_DOCUMENT_BYTES = 12000,
    MAX_STYLES_BYTES = 32000,
    MAX_CONNECT_ORIGINS = 8,
    PLUGIN_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

  function scalar(value) {
    const text = value.trim();
    if (!text) return "";
    if (text === "true") return true;
    if (text === "false") return false;
    if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text);
    if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) return text.slice(1, -1);
    return text;
  }

  function frontmatter(source) {
    const lines = source.split(/\r?\n/), data = {};
    let listKey = null;
    for (const rawLine of lines) {
      if (!rawLine.trim() || rawLine.trimStart().startsWith("#")) continue;
      const list = /^\s+-\s+(.+)$/.exec(rawLine);
      if (list) {
        if (!listKey || !Array.isArray(data[listKey])) throw Error("Plugin frontmatter contains an unexpected list item");
        data[listKey].push(scalar(list[1]));
        continue;
      }
      const field = /^([a-z][a-z0-9-]*):(?:\s*(.*))?$/.exec(rawLine);
      if (!field) throw Error(`Unsupported plugin frontmatter line: ${rawLine.trim()}`);
      listKey = null;
      if (!field[2]) {
        data[field[1]] = [];
        listKey = field[1];
      } else if (field[1] === "connect" && /^\[.*\]$/.test(field[2].trim())) {
        const items = field[2].trim().slice(1, -1).trim();
        data[field[1]] = items ? items.split(",").map((item) => scalar(item)) : [];
      } else data[field[1]] = scalar(field[2]);
    }
    return data;
  }

  function exactHttpsOrigin(value) {
    if (typeof value !== "string" || value.length > 256) return null;
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.username || url.password || url.hostname.includes("*") || url.pathname !== "/" || url.search || url.hash) return null;
      return url.origin;
    } catch {
      return null;
    }
  }

  function utf8Bytes(value) {
    let bytes = 0;
    for (const character of value) {
      const code = character.codePointAt(0);
      bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
    }
    return bytes;
  }

  function optionalText(metadata, key, maximum) {
    const value = metadata[key];
    if (value === undefined) return "";
    if (typeof value !== "string" || !value.trim() || value.length > maximum) throw Error(`Plugin ${key} is invalid`);
    return value.trim();
  }

  function validateStyles(value = "") {
    if (value === undefined || value === null || value === "") return "";
    if (typeof value !== "string" || utf8Bytes(value) > MAX_STYLES_BYTES) throw Error("Plugin CSS exceeds 32000 UTF-8 bytes");
    return value.trim();
  }

  function parse(markdown, styles = "") {
    if (typeof markdown !== "string" || !markdown.trim() || utf8Bytes(markdown) > MAX_DOCUMENT_BYTES) throw Error("Plugin document is empty or exceeds 12000 UTF-8 bytes");
    const match = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n([\s\S]*)$/.exec(markdown);
    if (!match) throw Error("Plugin document needs YAML frontmatter");
    const metadata = frontmatter(match[1]), body = match[2].trim();
    if (metadata["penecho-plugin"] !== 1) throw Error("Unsupported PenEcho plugin version");
    if (!PLUGIN_ID.test(metadata.id || "") || metadata.id.length > 64) throw Error("Plugin id is invalid");
    if (typeof metadata.name !== "string" || !metadata.name.trim() || metadata.name.length > 80) throw Error("Plugin name is invalid");
    const nameZh = optionalText(metadata, "name-zh", 80),
      description = optionalText(metadata, "description", 240),
      descriptionZh = optionalText(metadata, "description-zh", 240),
      category = optionalText(metadata, "category", 48),
      categoryZh = optionalText(metadata, "category-zh", 48),
      source = optionalText(metadata, "source", 80);
    if (!description) throw Error("Plugin description is required");
    if (!category) throw Error("Plugin category is required");
    if (!source) throw Error("Plugin source is required");
    if (!["string", "number"].includes(typeof metadata.version) || !String(metadata.version).trim() || String(metadata.version).length > 32) throw Error("Plugin version is invalid");
    if (!Array.isArray(metadata.connect) || metadata.connect.length > MAX_CONNECT_ORIGINS) throw Error("Plugin connect must contain zero to eight exact HTTPS origins");
    const connect = metadata.connect.map(exactHttpsOrigin);
    if (connect.some((origin) => !origin) || new Set(connect).size !== connect.length) throw Error("Plugin connect contains an invalid or duplicate origin");
    const refreshSeconds = Number(metadata["recommended-refresh-seconds"]);
    if (!Number.isFinite(refreshSeconds) || refreshSeconds < 60 || refreshSeconds > 86400) throw Error("Plugin refresh interval must be between 60 seconds and one day");
    const oneShot = /^##[ \t]+One-shot example[ \t]*\r?\n([\s\S]*?)(?=^##[ \t]+|(?![\s\S]))/im.exec(body);
    if (!oneShot) throw Error("Plugin needs a one-shot example");
    if (!/\b(?:html_widget|diagram_source)\b/.test(oneShot[1])) throw Error("Plugin one-shot example must identify the expected output command");
    return Object.freeze({
      id: metadata.id,
      name: metadata.name.trim(),
      nameZh,
      description,
      descriptionZh,
      category,
      categoryZh,
      source,
      version: String(metadata.version),
      connect: Object.freeze(connect),
      recommendedRefreshSeconds: Math.round(refreshSeconds),
      document: markdown.trim(),
      styles: validateStyles(styles),
    });
  }

  const api = Object.freeze({ exactHttpsOrigin, parse, validateStyles });
  if (typeof module === "object" && module.exports) module.exports = api;
  else window.PENECHO_PLUGINS = api;
})();
