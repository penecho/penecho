"use strict";

const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const zlib = require("zlib");
const { promisify, TextDecoder } = require("util");

const inflateRaw = promisify(zlib.inflateRaw);

const PROJECT_HISTORY_LIMIT = 5;
const PROJECT_HISTORY_ITEM_LIMIT = 120;
const PROJECT_HISTORY_TEXT_LIMIT = 20_000;
const PROJECT_REGISTRY_LIMIT = 100;
const PROJECT_FILE_LIMIT = 64 * 1024 * 1024;
const PROJECT_UPLOAD_LIMIT = 32 * 1024 * 1024;
const PROJECT_UPLOAD_IDLE_TTL_MS = 24 * 60 * 60 * 1000;
const PROJECT_ROOT_PATH_LIMIT = 1_024;
const PROJECT_ROOT_DEPTH_LIMIT = 16;
const PROJECT_ROOT_ENTRY_LIMIT = 200;
const PROJECT_ROOT_SCAN_LIMIT = 2_000;
const PROJECT_ZIP_ENTRY_LIMIT = 2_000;
const PROJECT_ZIP_ENTRY_BYTES_LIMIT = 64 * 1024 * 1024;
const PROJECT_ZIP_TOTAL_BYTES_LIMIT = 256 * 1024 * 1024;
const PROJECT_FOLDER_ID_PATTERN = /^local-[0-9a-f]{24}$/;
const PROJECT_FILE_ID_PATTERN = /^file-[0-9a-f]{24}$/;
const PROJECT_ID_PATTERN = /^(?:local|file)-[0-9a-f]{24}$/;
const PROJECT_ROOT_ID_PATTERN = /^root-[0-9a-f]{24}$/;
const PROJECT_HISTORY_FILE = "canvas-agent-history.json";
const PROJECT_UPLOAD_DIRECTORY = "canvas-agent-files";
const PROJECT_FILE_HISTORY_DIRECTORY = "canvas-agent-file-history";
const PROJECT_ROOT_ID_KEY = "canvas-agent-root-id.key";
const PROJECT_UPLOAD_TEMP_FILE_PATTERN = /^\.upload-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/i;
const PROJECT_UPLOAD_CONTENT_FILE_PATTERN = /^content(?:\.[^\0-\x1f\x7f/\\:\u202a-\u202e\u2066-\u2069]{0,255})?$/u;
const HOST_ROOT_DENIED_SEGMENTS = new Set(["appdata", "library"]);

const DOCUMENT_EXTENSIONS = new Set([".pdf", ".docx", ".xlsx", ".csv", ".pptx"]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const DATABASE_EXTENSIONS = new Set([".db", ".sqlite", ".sqlite3"]);
const TEXT_EXTENSIONS = new Set([
  ".txt", ".text", ".md", ".markdown", ".mdx", ".rst", ".adoc", ".log",
  ".json", ".jsonc", ".jsonl", ".ndjson", ".yaml", ".yml", ".toml", ".ini", ".cfg",
  ".conf", ".config", ".properties", ".env", ".xml", ".xsd", ".svg", ".html",
  ".htm", ".css", ".scss", ".sass", ".less", ".js", ".jsx", ".mjs", ".cjs",
  ".ts", ".tsx", ".mts", ".cts", ".py", ".pyi", ".rb", ".php", ".java",
  ".kt", ".kts", ".go", ".rs", ".c", ".h", ".cc", ".cpp", ".cxx", ".hpp",
  ".cs", ".scala", ".swift", ".sh", ".bash", ".zsh", ".fish", ".ps1", ".bat", ".cmd",
  ".sql", ".graphql", ".gql", ".proto", ".vue", ".svelte", ".astro", ".tex",
  ".lock", ".diff", ".patch",
]);
const TEXT_FILENAMES = new Set([
  "readme", "license", "licence", "copying", "notice", "changelog", "changes",
  "authors", "contributors", "makefile", "dockerfile", "containerfile", "procfile",
  "gemfile", "rakefile", "justfile", ".gitignore", ".gitattributes", ".editorconfig",
  ".npmrc", ".nvmrc", ".prettierrc", ".eslintrc",
]);

const PROJECT_FILE_READERS = new Set(["text", "image", "document", "database", "binary"]);

function projectError(message, status = 400, code = "project_invalid") {
  return Object.assign(new Error(message), { status, code });
}

function boundedString(value, limit) {
  return String(value || "").slice(0, limit);
}

function historyEvaluationLabel(value, limit) {
  return boundedString(value, limit).replace(/[\0-\x1f\x7f]/g, "").trim();
}

function safeDisplayLabel(value, fallback = "Resource") {
  const label = String(value || "")
    .replace(/[\0-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/[\\/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return label && label !== "." && label !== ".." ? label : fallback;
}

function safeRelativeDisplay(relativePath) {
  return String(relativePath || "").split("/").filter(Boolean).map(segment => safeDisplayLabel(segment, "Folder")).join("/");
}

function normalizedHistoryItem(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  if (item.type === "message" && ["user", "assistant"].includes(item.role)) {
    const evaluationModel=historyEvaluationLabel(item.evaluationModel,200),evaluationChannel=historyEvaluationLabel(item.evaluationChannel,80);
    return {
      id:boundedString(item.id, 128), type:"message", role:item.role,
      text:boundedString(item.text, PROJECT_HISTORY_TEXT_LIMIT),
      attachmentCount:Math.max(0, Math.min(5, Number(item.attachmentCount) || 0)),
      eventKey:boundedString(item.eventKey, 128),
      ...(Number.isSafeInteger(item.turn) ? { turn:item.turn } : {}),
      ...(Number.isSafeInteger(item.step) ? { step:item.step } : {}),
      ...(item.role==="assistant"&&["like","criticism"].includes(item.evaluation)?{evaluation:item.evaluation}:{}),
      ...(item.role==="assistant"&&evaluationModel&&evaluationChannel?{evaluationModel,evaluationChannel}:{}),
    };
  }
  if (item.type === "error") return {
    id:boundedString(item.id, 128), type:"error",
    code:boundedString(item.code, 128), message:boundedString(item.message, 8_000),
    eventKey:boundedString(item.eventKey, 128),
  };
  if (item.type === "tool") return {
    id:boundedString(item.id, 128), type:"tool", callId:boundedString(item.callId, 256),
    name:boundedString(item.name, 128), argumentsText:boundedString(item.argumentsText, 8_000),
    resultText:boundedString(item.resultText, 8_000),
    ...(Number.isSafeInteger(item.turn) ? { turn:item.turn } : {}),
    ...(Number.isSafeInteger(item.step) ? { step:item.step } : {}),
    state:["running", "done", "error"].includes(item.state) ? item.state : "done",
  };
  return null;
}

function normalizedConversation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = boundedString(value.id, 128), createdAt = Number(value.createdAt), updatedAt = Number(value.updatedAt);
  if (!id || !Number.isFinite(createdAt) || !Number.isFinite(updatedAt)) return null;
  const items = (Array.isArray(value.items) ? value.items : []).slice(-PROJECT_HISTORY_ITEM_LIMIT).map(normalizedHistoryItem).filter(Boolean);
  if (!items.length) return null;
  return { id, createdAt, updatedAt, title:boundedString(value.title, 120), items };
}

function normalizedHistory(value) {
  const conversations = Array.isArray(value) ? value : Array.isArray(value?.conversations) ? value.conversations : [];
  return conversations.map(normalizedConversation).filter(Boolean).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, PROJECT_HISTORY_LIMIT);
}

function isFilesystemRoot(candidate) {
  return candidate === path.parse(candidate).root;
}

function hostSegmentNeedsApproval(segment) {
  const value = String(segment || "");
  return value.startsWith(".") || HOST_ROOT_DENIED_SEGMENTS.has(value.toLowerCase());
}

function isContained(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function opaqueId(prefix, identity) {
  return `${prefix}-${crypto.createHash("sha256").update(identity).digest("hex").slice(0, 24)}`;
}

function randomOpaqueId(prefix) {
  return `${prefix}-${crypto.randomBytes(12).toString("hex")}`;
}

function privateOpaqueId(prefix, identity, secret) {
  return `${prefix}-${crypto.createHmac("sha256", secret).update(identity).digest("hex").slice(0, 24)}`;
}

function projectPathIdentity(kind, canonical) {
  return crypto.createHash("sha256").update(`${kind}\0${canonical}`).digest("hex");
}

function normalizedMediaType(value) {
  const mediaType = String(value || "").split(";", 1)[0].trim().toLowerCase();
  if (mediaType && !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mediaType)) {
    throw projectError("The uploaded file media type is invalid.", 400, "project_file_type_invalid");
  }
  return mediaType;
}

function projectFileReader(filename) {
  const name = String(filename || ""), basename = path.basename(name).toLowerCase(), extension = path.extname(name).toLowerCase();
  if (DOCUMENT_EXTENSIONS.has(extension)) return "document";
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (DATABASE_EXTENSIONS.has(extension)) return "database";
  if (TEXT_EXTENSIONS.has(extension) || TEXT_FILENAMES.has(basename) || basename.startsWith(".env.")
    || basename.startsWith("dockerfile.") || basename.startsWith("containerfile.") || basename.startsWith("makefile.")) return "text";
  return null;
}

function validateUploadMediaType(_filename, mediaType) {
  try { return normalizedMediaType(mediaType); }
  catch { return ""; }
}

function safeUploadName(input) {
  const name = String(input || "").trim();
  if (!name || name.length > 255 || /[\0-\x1f\x7f\u202a-\u202e\u2066-\u2069]/.test(name) || /[\\/:]/.test(name)
    || name === "." || name === ".." || path.posix.basename(name) !== name || path.win32.basename(name) !== name) {
    throw projectError("Choose a file with a safe filename.", 400, "project_file_name_invalid");
  }
  return name;
}

function decodeCanonicalBase64(data, bytes) {
  const expectedBytes = Number(bytes);
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes <= 0 || expectedBytes > PROJECT_UPLOAD_LIMIT) {
    throw projectError("The uploaded file must be between 1 byte and 32 MB.", 413, "project_upload_too_large");
  }
  const maximumEncodedLength = Math.ceil(PROJECT_UPLOAD_LIMIT / 3) * 4;
  if (typeof data !== "string" || !data.length || data.length > maximumEncodedLength || data.length % 4 !== 0) {
    throw projectError("The uploaded file data is not canonical base64.", 400, "project_upload_invalid");
  }
  let padding = 0;
  if (data.charCodeAt(data.length - 1) === 61) padding += 1;
  if (data.charCodeAt(data.length - 2) === 61) padding += 1;
  const payloadEnd = data.length - padding;
  if (padding === 1 && payloadEnd % 4 !== 3 || padding === 2 && payloadEnd % 4 !== 2) {
    throw projectError("The uploaded file data is not canonical base64.", 400, "project_upload_invalid");
  }
  for (let index = 0; index < payloadEnd; index += 1) {
    const code = data.charCodeAt(index), alphaNumeric = code >= 65 && code <= 90 || code >= 97 && code <= 122 || code >= 48 && code <= 57;
    if (!alphaNumeric && code !== 43 && code !== 47) {
      throw projectError("The uploaded file data is not canonical base64.", 400, "project_upload_invalid");
    }
  }
  for (let index = payloadEnd; index < data.length; index += 1) {
    if (data.charCodeAt(index) !== 61) throw projectError("The uploaded file data is not canonical base64.", 400, "project_upload_invalid");
  }
  if (data.length / 4 * 3 - padding !== expectedBytes) {
    throw projectError("The uploaded file data does not match its declared size.", 400, "project_upload_invalid");
  }
  const decoded = Buffer.from(data, "base64");
  if (decoded.length !== expectedBytes || decoded.toString("base64") !== data) {
    throw projectError("The uploaded file data does not match its declared size.", 400, "project_upload_invalid");
  }
  return decoded;
}

function uploadContentError(message) {
  return projectError(message, 415, "project_file_content_invalid");
}

function bufferStartsWith(buffer, signature) {
  return buffer.length >= signature.length && buffer.subarray(0, signature.length).equals(signature);
}

async function officeZipEntries(bytes) {
  const minimum = Math.max(0, bytes.length - 65_557);
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0 || eocd + 22 > bytes.length) throw uploadContentError("The Office document is not a valid ZIP container.");
  const disk = bytes.readUInt16LE(eocd + 4), centralDisk = bytes.readUInt16LE(eocd + 6),
    diskEntries = bytes.readUInt16LE(eocd + 8), entryCount = bytes.readUInt16LE(eocd + 10),
    centralSize = bytes.readUInt32LE(eocd + 12), centralOffset = bytes.readUInt32LE(eocd + 16),
    commentLength = bytes.readUInt16LE(eocd + 20);
  if (eocd + 22 + commentLength !== bytes.length || disk !== 0 || centralDisk !== 0 || diskEntries !== entryCount
    || entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw uploadContentError("Multi-disk, ZIP64, or malformed Office files are not supported.");
  }
  if (entryCount < 1 || entryCount > PROJECT_ZIP_ENTRY_LIMIT || centralOffset + centralSize > eocd) {
    throw uploadContentError("The Office document has an unsafe ZIP directory.");
  }
  const names = new Set();
  let total = 0, offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== 0x02014b50) {
      throw uploadContentError("The Office document has a malformed ZIP directory.");
    }
    const flags = bytes.readUInt16LE(offset + 8), method = bytes.readUInt16LE(offset + 10),
      compressed = bytes.readUInt32LE(offset + 20), uncompressed = bytes.readUInt32LE(offset + 24),
      nameLength = bytes.readUInt16LE(offset + 28), extraLength = bytes.readUInt16LE(offset + 30),
      entryCommentLength = bytes.readUInt16LE(offset + 32), startDisk = bytes.readUInt16LE(offset + 34),
      localOffset = bytes.readUInt32LE(offset + 42), next = offset + 46 + nameLength + extraLength + entryCommentLength;
    if (next > bytes.length || startDisk !== 0 || flags & 0x1 || ![0, 8].includes(method)
      || uncompressed > PROJECT_ZIP_ENTRY_BYTES_LIMIT || localOffset + 30 > centralOffset) {
      throw uploadContentError("The Office document contains an unsafe ZIP entry.");
    }
    const nameBytes = bytes.subarray(offset + 46, offset + 46 + nameLength), name = nameBytes.toString("utf8").replaceAll("\\", "/");
    if (!name || name.includes("\0") || name.startsWith("/") || /^[A-Za-z]:/.test(name)
      || name.split("/").some(part => part === "..") || names.has(name)) {
      throw uploadContentError("The Office document contains an unsafe ZIP entry name.");
    }
    if (bytes.readUInt32LE(localOffset) !== 0x04034b50) throw uploadContentError("The Office document has a malformed local ZIP entry.");
    const localFlags = bytes.readUInt16LE(localOffset + 6), localMethod = bytes.readUInt16LE(localOffset + 8),
      localNameLength = bytes.readUInt16LE(localOffset + 26), localExtraLength = bytes.readUInt16LE(localOffset + 28),
      dataStart = localOffset + 30 + localNameLength + localExtraLength, dataEnd = dataStart + compressed;
    if (localFlags & 0x1 || localMethod !== method || dataEnd > centralOffset
      || !bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength).equals(nameBytes)) {
      throw uploadContentError("The Office document has an inconsistent local ZIP entry.");
    }
    const compressedBytes = bytes.subarray(dataStart, dataEnd);
    let actualLength;
    if (method === 0) {
      if (compressed !== uncompressed) throw uploadContentError("The Office document has an inconsistent stored ZIP entry.");
      actualLength = compressedBytes.length;
    } else {
      try { actualLength = (await inflateRaw(compressedBytes, { maxOutputLength:PROJECT_ZIP_ENTRY_BYTES_LIMIT })).length; }
      catch { throw uploadContentError("The Office document contains an invalid or oversized compressed ZIP entry."); }
      if (actualLength !== uncompressed) throw uploadContentError("The Office document ZIP entry size is inconsistent.");
    }
    total += actualLength;
    if (total > PROJECT_ZIP_TOTAL_BYTES_LIMIT) throw uploadContentError("The Office document expands beyond the safe reader limit.");
    names.add(name);
    offset = next;
  }
  if (offset !== centralOffset + centralSize) throw uploadContentError("The Office document ZIP directory length is inconsistent.");
  return names;
}

function validateUtf8Upload(bytes, label) {
  if (bytes.includes(0)) throw uploadContentError(`The uploaded ${label} contains NUL bytes.`);
  try { new TextDecoder("utf-8", { fatal:true }).decode(bytes); }
  catch { throw uploadContentError(`The uploaded ${label} is not valid UTF-8 text.`); }
}

async function validateUploadContent(filename, bytes) {
  const extension = path.extname(filename).toLowerCase(), reader = projectFileReader(filename);
  if (extension === ".pdf") {
    if (bytes.subarray(0, Math.min(1_024, bytes.length)).indexOf(Buffer.from("%PDF-")) < 0) throw uploadContentError("The uploaded PDF signature is invalid.");
  } else if ([".docx", ".xlsx", ".pptx"].includes(extension)) {
    const names = await officeZipEntries(bytes), required = {
      ".docx":"word/document.xml",
      ".xlsx":"xl/workbook.xml",
      ".pptx":"ppt/presentation.xml",
    }[extension];
    if (!names.has("[Content_Types].xml") || !names.has(required)) {
      throw uploadContentError(`The uploaded ${extension.slice(1).toUpperCase()} is missing required Office content.`);
    }
  } else if (extension === ".csv") {
    validateUtf8Upload(bytes, "CSV");
  } else if (DATABASE_EXTENSIONS.has(extension)) {
    if (!bufferStartsWith(bytes, Buffer.from("SQLite format 3\0", "binary"))) throw uploadContentError("The uploaded SQLite signature is invalid.");
  } else if (extension === ".png") {
    if (!bufferStartsWith(bytes, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) throw uploadContentError("The uploaded PNG signature is invalid.");
  } else if (extension === ".jpg" || extension === ".jpeg") {
    if (bytes.length < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) throw uploadContentError("The uploaded JPEG signature is invalid.");
  } else if (extension === ".webp") {
    if (bytes.length < 12 || bytes.subarray(0, 4).toString("ascii") !== "RIFF" || bytes.subarray(8, 12).toString("ascii") !== "WEBP") {
      throw uploadContentError("The uploaded WebP signature is invalid.");
    }
  } else if (extension === ".gif") {
    const signature = bytes.subarray(0, 6).toString("ascii");
    if (signature !== "GIF87a" && signature !== "GIF89a") throw uploadContentError("The uploaded GIF signature is invalid.");
  } else if (reader === "text") {
    validateUtf8Upload(bytes, "text file");
  }
}

async function uploadedFileReader(filename, bytes) {
  const specialized = projectFileReader(filename);
  if (specialized) {
    try { await validateUploadContent(filename, bytes); return specialized; }
    catch { return "binary"; }
  }
  try { validateUtf8Upload(bytes, "text file"); return "text"; }
  catch { return "binary"; }
}

function normalizedRootRelative(input, { allowEmpty = true } = {}) {
  const supplied = String(input ?? "");
  if (/[\0-\x1f\x7f\u202a-\u202e\u2066-\u2069]/.test(supplied) || supplied.length > PROJECT_ROOT_PATH_LIMIT || /^[A-Za-z]:/.test(supplied)
    || /^[/\\]/.test(supplied) || supplied.includes(":")) {
    throw projectError("The server folder path must be relative to its allowed root.", 400, "project_root_path_invalid");
  }
  if (!supplied) {
    if (allowEmpty) return { relativePath:"", segments:[] };
    throw projectError("Choose a folder inside the allowed root.", 400, "project_root_path_invalid");
  }
  const segments = supplied.split(/[\\/]/);
  if (segments.length > PROJECT_ROOT_DEPTH_LIMIT || segments.some(segment => !segment || segment === "." || segment === ".."
    || segment.toLowerCase() === ".penecho" || segment.length > 255)) {
    throw projectError("The server folder path is invalid or too deep.", 400, "project_root_path_invalid");
  }
  return { relativePath:segments.join("/"), segments };
}

async function atomicJsonWrite(file, value) {
  const directory = path.dirname(file), temporary = path.join(directory, `.${path.basename(file)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  await fs.mkdir(directory, { recursive:true, mode:0o700 });
  try {
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding:"utf8", mode:0o600, flag:"wx" });
    await fs.rename(temporary, file);
  } finally {
    await fs.unlink(temporary).catch(error => { if (error?.code !== "ENOENT") throw error; });
  }
}

async function regularReadableFile(input, unavailableMessage = "The selected file is unavailable.") {
  const supplied = String(input || "").trim();
  if (!supplied || supplied.includes("\0")) throw projectError("Choose a local file.");
  let canonical;
  try { canonical = await fs.realpath(path.resolve(supplied)); }
  catch { throw projectError(unavailableMessage, 404, "project_unavailable"); }
  const info = await fs.stat(canonical).catch(() => null);
  if (!info?.isFile()) throw projectError("The selected resource must be a regular local file.");
  if (info.size > PROJECT_FILE_LIMIT) throw projectError("The selected file exceeds the 64 MB reader limit.", 413, "project_file_too_large");
  const handle = await fs.open(canonical, "r").catch(() => null);
  if (!handle) throw projectError("The selected file is not readable.", 403, "project_file_unreadable");
  await handle.close();
  const reader = projectFileReader(canonical) || "binary";
  return { canonical, info, reader };
}

function normalizedRegistryProject(project) {
  if (!project || typeof project !== "object" || typeof project.path !== "string") return null;
  const id = String(project.id || ""), kind = project.kind === "file" ? "file" : project.kind === "folder" || project.kind == null ? "folder" : "";
  if (!kind || kind === "folder" && !PROJECT_FOLDER_ID_PATTERN.test(id) || kind === "file" && !PROJECT_FILE_ID_PATTERN.test(id)) return null;
  const storedSource = project.source || project.origin;
  const source = ["native", "server", "upload"].includes(storedSource) ? storedSource : "native";
  if (source === "upload" && kind !== "file") return null;
  return {
    ...project, id, kind, source, origin:source,
    name:safeDisplayLabel(project.name || path.basename(project.path), kind === "file" ? "File" : "Folder"), path:project.path,
    addedAt:Number.isFinite(Number(project.addedAt)) ? Number(project.addedAt) : 0,
    lastOpenedAt:Number.isFinite(Number(project.lastOpenedAt)) ? Number(project.lastOpenedAt) : 0,
  };
}

class CanvasAgentProjectStore {
  constructor({ stateDirectory, allowedRoots = [], hostRoots = [], logger = null }) {
    if (!stateDirectory) throw new Error("PenEcho Agent project storage requires a state directory.");
    this.stateDirectory = path.resolve(stateDirectory);
    this.registryFile = path.join(this.stateDirectory, "canvas-agent-projects.json");
    this.uploadDirectory = path.join(this.stateDirectory, PROJECT_UPLOAD_DIRECTORY);
    this.fileHistoryDirectory = path.join(this.stateDirectory, PROJECT_FILE_HISTORY_DIRECTORY);
    this.allowedRoots = Array.isArray(allowedRoots) ? [...allowedRoots] : [];
    this.hostRoots = Array.isArray(hostRoots) ? [...hostRoots] : [];
    this.logger = typeof logger === "function" ? logger : null;
    this.rootIdSecretPromise = null;
    this.rootCaches = new Map();
    this.queue = Promise.resolve();
  }

  async rootIdSecret() {
    if (!this.rootIdSecretPromise) {
      this.rootIdSecretPromise = (async () => {
        await fs.mkdir(this.stateDirectory, { recursive:true, mode:0o700 });
        const canonicalState = await fs.realpath(this.stateDirectory), keyFile = path.join(canonicalState, PROJECT_ROOT_ID_KEY);
        let info = await fs.lstat(keyFile).catch(error => error?.code === "ENOENT" ? null : Promise.reject(error));
        if (!info) {
          try { await fs.writeFile(keyFile, crypto.randomBytes(32), { flag:"wx", mode:0o600 }); }
          catch (error) { if (error?.code !== "EEXIST") throw error; }
          info = await fs.lstat(keyFile);
        }
        if (!info.isFile() || info.isSymbolicLink() || await fs.realpath(keyFile) !== keyFile || info.size !== 32) {
          throw projectError("The PenEcho Agent root identity key is unsafe.", 500, "project_metadata_invalid");
        }
        await fs.chmod(keyFile, 0o600);
        const secret = await fs.readFile(keyFile);
        if (secret.length !== 32) throw projectError("The PenEcho Agent root identity key is invalid.", 500, "project_metadata_invalid");
        return secret;
      })().catch(error => { this.rootIdSecretPromise = null; throw error; });
    }
    return this.rootIdSecretPromise;
  }

  async readRegistry() {
    try {
      const parsed = JSON.parse(await fs.readFile(this.registryFile, "utf8"));
      const projects = Array.isArray(parsed?.projects) ? parsed.projects : [];
      return projects.map(normalizedRegistryProject).filter(Boolean).slice(0, PROJECT_REGISTRY_LIMIT);
    } catch (error) {
      if (error?.code === "ENOENT" || error instanceof SyntaxError) return [];
      throw error;
    }
  }

  async writeRegistry(projects) {
    await atomicJsonWrite(this.registryFile, { version:2, projects:projects.slice(0, PROJECT_REGISTRY_LIMIT) });
  }

  mutate(operation) {
    const pending = this.queue.then(operation);
    this.queue = pending.catch(() => {});
    return pending;
  }

  async canonicalDirectory(input, { allowFilesystemRoot = false } = {}) {
    const supplied = String(input || "").trim();
    if (!supplied || supplied.includes("\0")) throw projectError("Choose a local project folder.");
    let canonical;
    try { canonical = await fs.realpath(path.resolve(supplied)); }
    catch { throw projectError("The selected project folder is unavailable.", 404, "project_unavailable"); }
    const info = await fs.stat(canonical).catch(() => null);
    if (!info?.isDirectory()) throw projectError("The selected project must be a local folder.");
    if (!allowFilesystemRoot && isFilesystemRoot(canonical)) throw projectError("The filesystem root cannot be selected as a project.");
    return canonical;
  }

  async resolvedRoots(configuredRoots) {
    if (!configuredRoots.length) return [];
    const rootIdSecret = await this.rootIdSecret(), candidates = await Promise.all(configuredRoots.map(async configured => {
      const configuredPath = typeof configured === "string" ? configured : configured?.path;
      const canonical = await this.canonicalDirectory(configuredPath, { allowFilesystemRoot:true }).catch(() => null);
      if (!canonical || path.basename(canonical).toLowerCase() === ".penecho") return null;
      const configuredName = typeof configured === "object" ? boundedString(configured?.name, 120).trim() : "";
      const driveLabel = isFilesystemRoot(canonical) && /^[A-Za-z]:$/.test(configuredName),
        name = configuredName && (driveLabel || !/[\0-\x1f\x7f/\\:]/.test(configuredName)) && configuredName !== "." && configuredName !== ".."
        ? safeDisplayLabel(configuredName, "Server folder") : safeDisplayLabel(path.basename(canonical), "Server folder");
      return {
        id:privateOpaqueId("root", canonical, rootIdSecret), name, path:canonical,
        guardPrivate:Boolean(configured?.guardPrivate), requireChild:Boolean(configured?.requireChild),
      };
    })), roots = [];
    for (const candidate of candidates) {
      if (!candidate || roots.some(root => root.path === candidate.path)) continue;
      roots.push(candidate);
    }
    return roots;
  }

  cachedRoots(key, configuredRoots) {
    const current = this.rootCaches.get(key), now = Date.now();
    if (current && now - current.createdAt < 30_000) return current.promise;
    const promise = this.resolvedRoots(configuredRoots).catch(error => {
      if (this.rootCaches.get(key)?.promise === promise) this.rootCaches.delete(key);
      throw error;
    });
    this.rootCaches.set(key, { createdAt:now, promise });
    return promise;
  }

  configuredRoots() {
    return this.cachedRoots("allowed", this.allowedRoots);
  }

  configuredHostRoots() {
    return this.cachedRoots("host", this.hostRoots);
  }

  async listRoots() {
    return (await this.configuredRoots()).map(root => ({ id:root.id, name:root.name }));
  }

  async listHostRoots() {
    return (await this.configuredHostRoots()).map(root => ({ id:root.id, name:root.name }));
  }

  async rootById(rootId, { host = false } = {}) {
    if (!PROJECT_ROOT_ID_PATTERN.test(String(rootId || ""))) throw projectError("The server root id is invalid.", 400, "project_root_invalid");
    const root = (await (host ? this.configuredHostRoots() : this.configuredRoots())).find(candidate => candidate.id === rootId);
    if (!root) throw projectError("The allowed server root was not found.", 404, "project_root_not_found");
    return root;
  }

  async resolveRootSelection(rootId, relativePath, options = {}) {
    const root = await this.rootById(rootId, options), normalized = normalizedRootRelative(relativePath);
    if (root.guardPrivate && normalized.segments.some(hostSegmentNeedsApproval) && options.approved !== true) {
      throw projectError("Approve access to this private host folder before browsing it.", 403, "project_root_approval_required");
    }
    let cursor = root.path;
    for (const segment of normalized.segments) {
      cursor = path.join(cursor, segment);
      let entry;
      try { entry = await fs.lstat(cursor); }
      catch (error) {
        if (["EACCES", "EPERM"].includes(error?.code)) throw projectError("The system denied access to this folder.", 403, "project_root_unreadable");
        throw projectError("The selected server folder is unavailable.", 404, "project_unavailable");
      }
      if (!entry?.isDirectory() || entry.isSymbolicLink()) throw projectError("The selected server folder is unavailable.", 404, "project_unavailable");
    }
    let canonical;
    try { canonical = await fs.realpath(cursor); }
    catch (error) {
      if (["EACCES", "EPERM"].includes(error?.code)) throw projectError("The system denied access to this folder.", 403, "project_root_unreadable");
      throw projectError("The selected server folder is unavailable.", 404, "project_unavailable");
    }
    if (!isContained(root.path, canonical)) throw projectError("The selected server folder escaped its allowed root.", 403, "project_root_escape");
    return { root, canonical, relativePath:normalized.relativePath };
  }

  async browseResolvedRoot(rootId, relativePath = "", options = {}) {
    const selected = await this.resolveRootSelection(rootId, relativePath, options), entries = [];
    let truncated = false, directory, scanned = 0;
    try { directory = await fs.opendir(selected.canonical); }
    catch (error) {
      if (["EACCES", "EPERM"].includes(error?.code)) {
        const parentPath = selected.relativePath.includes("/") ? selected.relativePath.slice(0, selected.relativePath.lastIndexOf("/")) : selected.relativePath ? "" : null;
        return {
          root:{ id:selected.root.id, name:selected.root.name }, rootId:selected.root.id, rootName:selected.root.name,
          path:selected.relativePath, relativePath:selected.relativePath, parentPath, entries:[], truncated:false,
          selectable:false, permissionDenied:true,
        };
      }
      throw projectError("The selected server folder cannot be browsed.", 403, "project_root_unreadable");
    }
    try {
      for await (const entry of directory) {
        scanned += 1;
        if (scanned > PROJECT_ROOT_SCAN_LIMIT) { truncated = true; break; }
        if (entry.name.toLowerCase() === ".penecho" || /[\0-\x1f\x7f\u202a-\u202e\u2066-\u2069]/.test(entry.name) || entry.isSymbolicLink() || !entry.isDirectory()) continue;
        const candidate = path.join(selected.canonical, entry.name), details = await fs.lstat(candidate).catch(() => null);
        if (details?.isSymbolicLink() || details && !details.isDirectory()) continue;
        const canonical = await fs.realpath(candidate).catch(() => null);
        if (canonical && !isContained(selected.root.path, canonical)) continue;
        if (entries.length >= PROJECT_ROOT_ENTRY_LIMIT) { truncated = true; break; }
        const childRelative = selected.relativePath ? `${selected.relativePath}/${entry.name}` : entry.name;
        if (childRelative.length > PROJECT_ROOT_PATH_LIMIT || childRelative.split("/").length > PROJECT_ROOT_DEPTH_LIMIT) continue;
        const permissionDenied = !details || !canonical;
        entries.push({
          name:safeDisplayLabel(entry.name, "Folder"), path:childRelative, relativePath:childRelative, kind:"folder",
          ...(selected.root.guardPrivate && hostSegmentNeedsApproval(entry.name) && options.approved !== true ? { approvalRequired:true } : {}),
          ...(permissionDenied ? { permissionDenied:true } : {}),
        });
      }
    } finally {
      await directory.close().catch(error => { if (error?.code !== "ERR_DIR_CLOSED") throw error; });
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    const parentPath = selected.relativePath.includes("/") ? selected.relativePath.slice(0, selected.relativePath.lastIndexOf("/")) : selected.relativePath ? "" : null,
      rootRequiresChild = options.host || selected.root.requireChild;
    return {
      root:{ id:selected.root.id, name:selected.root.name }, rootId:selected.root.id, rootName:selected.root.name,
      path:selected.relativePath, relativePath:selected.relativePath, parentPath, entries, truncated,
      selectable:!isFilesystemRoot(selected.canonical) && (!rootRequiresChild || Boolean(selected.relativePath)),
    };
  }

  browseRoot(rootId, relativePath = "", options = {}) {
    return this.browseResolvedRoot(rootId, relativePath, options);
  }

  browseHostRoot(rootId, relativePath = "", options = {}) {
    return this.browseResolvedRoot(rootId, relativePath, { ...options, host:true });
  }

  publicProject(project, { resolved = false } = {}) {
    const safeName = safeDisplayLabel(project.name || path.basename(project.path), project.kind === "file" ? "File" : "Folder");
    const safePath = project.source === "server"
      ? `${safeDisplayLabel(project.rootName, "Server folder")}${project.rootRelative ? `/${safeRelativeDisplay(project.rootRelative)}` : ""}`
      : safeName;
    return {
      id:project.id, kind:project.kind,
      name:safeName, path:resolved ? project.path : safePath, displayPath:safePath,
      source:project.source, origin:project.source,
      ...(project.kind === "file" ? {
        reader:project.reader,
        mediaType:project.mediaType || "",
        ...(Number.isFinite(project.bytes) ? { bytes:project.bytes } : {}),
      } : {}),
      addedAt:project.addedAt, lastOpenedAt:project.lastOpenedAt,
    };
  }

  async validateServerRecord(project) {
    const selected = await this.resolveRootSelection(project.rootId, project.rootRelative || "", { approved:true });
    if (selected.canonical !== project.path) throw projectError("The selected server folder changed identity.", 409, "project_changed");
    project.rootName = selected.root.name;
    project.rootRelative = selected.relativePath;
    project.displayPath = selected.relativePath ? `${selected.root.name}/${safeRelativeDisplay(selected.relativePath)}` : selected.root.name;
    return selected;
  }

  async validateUploadRecord(project, { allowMissing = false } = {}) {
    if (project.source !== "upload" || project.kind !== "file" || !PROJECT_FILE_ID_PATTERN.test(project.id)) {
      throw projectError("The uploaded file record is invalid.", 409, "project_upload_identity_invalid");
    }
    const safeName = safeUploadName(project.name), managedName = String(project.managedName || ""), extension = path.extname(safeName).toLowerCase(), storedReader = String(project.reader || ""), specializedReader = projectFileReader(safeName),
      readerMatches = specializedReader ? storedReader === specializedReader || storedReader === "binary" : storedReader === "text" || storedReader === "binary";
    if (managedName !== `content${extension}` || !PROJECT_FILE_READERS.has(storedReader) || !readerMatches) {
      throw projectError("The uploaded file identity is invalid.", 409, "project_upload_identity_invalid");
    }
    const rootInfo = await fs.lstat(this.uploadDirectory).catch(error => error?.code === "ENOENT" ? null : Promise.reject(error));
    if (!rootInfo) {
      if (allowMissing) return { directory:null, file:null };
      throw projectError("The uploaded file is unavailable.", 404, "project_unavailable");
    }
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw projectError("The upload storage identity is unsafe.", 409, "project_upload_identity_invalid");
    const canonicalRoot = await fs.realpath(this.uploadDirectory), directory = path.join(canonicalRoot, project.id), file = path.join(directory, managedName);
    if (project.path !== file) throw projectError("The uploaded file identity changed.", 409, "project_upload_identity_invalid");
    const directoryInfo = await fs.lstat(directory).catch(error => error?.code === "ENOENT" ? null : Promise.reject(error));
    if (!directoryInfo) {
      if (allowMissing) return { directory:null, file:null };
      throw projectError("The uploaded file is unavailable.", 404, "project_unavailable");
    }
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) throw projectError("The uploaded file directory is unsafe.", 409, "project_upload_identity_invalid");
    const fileInfo = await fs.lstat(file).catch(error => error?.code === "ENOENT" ? null : Promise.reject(error));
    if (!fileInfo) {
      if (allowMissing) return { directory, file:null };
      throw projectError("The uploaded file is unavailable.", 404, "project_unavailable");
    }
    if (!fileInfo.isFile() || fileInfo.isSymbolicLink() || await fs.realpath(file) !== file
      || !Number.isSafeInteger(project.bytes) || project.bytes <= 0 || fileInfo.size !== project.bytes
      || !/^[0-9a-f]{64}$/.test(String(project.sha256 || ""))) {
      throw projectError("The uploaded file identity is unsafe.", 409, "project_upload_identity_invalid");
    }
    project.name = safeName;
    project.displayPath = safeName;
    project.reader = storedReader;
    project.mediaType = validateUploadMediaType(safeName, project.mediaType);
    return { directory, file, info:fileInfo };
  }

  async validateRecord(project) {
    if (project.kind === "folder") {
      const canonical = await this.canonicalDirectory(project.path);
      if (canonical !== project.path) throw projectError("The selected project folder changed identity.", 409, "project_changed");
      if (project.source === "server") await this.validateServerRecord(project);
      else project.name = safeDisplayLabel(path.basename(canonical), "Folder");
      return project;
    }
    if (project.source === "upload") {
      const validated = await this.validateUploadRecord(project);
      project.bytes = validated.info.size;
    } else {
      const selected = await regularReadableFile(project.path);
      if (selected.canonical !== project.path) throw projectError("The selected file changed identity.", 409, "project_changed");
      project.name = safeDisplayLabel(path.basename(selected.canonical), "File");
      project.reader = selected.reader;
      project.bytes = selected.info.size;
    }
    return project;
  }

  async list() {
    const projects = await this.readRegistry(), available = [];
    for (const project of projects) {
      const valid = await this.validateRecord(project).catch(() => null);
      if (valid) available.push(this.publicProject(valid));
    }
    return available.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt || a.name.localeCompare(b.name));
  }

  async add(input, options = {}) {
    const kind = options?.kind === "file" ? "file" : options?.kind === "folder" || options?.kind == null ? "folder" : "";
    if (!kind) throw projectError("The selected resource kind is invalid.");
    const requestedOrigin = String(options?.origin || "native").toLowerCase();
    if (!["native", "desktop", "server"].includes(requestedOrigin)) throw projectError("The selected resource origin is invalid.");
    const source = requestedOrigin === "server" ? "server" : "native";
    let canonical, reader, bytes, root;
    if (kind === "folder") canonical = await this.canonicalDirectory(input);
    else {
      const selected = await regularReadableFile(input);
      canonical = selected.canonical; reader = selected.reader; bytes = selected.info.size;
    }
    if (source === "server") {
      if (kind !== "folder") throw projectError("Server roots can register project folders only.", 400, "project_root_kind_invalid");
      root = await this.resolveRootSelection(options.rootId, options.rootRelative || "", { approved:options.approved === true });
      if (root.canonical !== canonical) throw projectError("The selected folder does not match its allowed server root.", 403, "project_root_escape");
    }
    return this.mutate(async () => {
      const projects = await this.readRegistry(), now = Date.now(), existing = projects.find(project => project.path === canonical);
      let id = existing?.id || randomOpaqueId(kind === "folder" ? "local" : "file");
      while (!existing && projects.some(project => project.id === id)) id = randomOpaqueId(kind === "folder" ? "local" : "file");
      if (!existing && projects.length >= PROJECT_REGISTRY_LIMIT) throw projectError("The project list already contains 100 resources.", 409, "project_limit");
      if (existing?.source === "upload") {
        await this.validateUploadRecord(existing);
        const record = { ...existing, lastOpenedAt:now };
        await this.writeRegistry([record, ...projects.filter(project => project.id !== record.id)]);
        return this.publicProject(record);
      }
      const record = {
        ...(existing || {}), id, kind, source, origin:source, pathIdentity:projectPathIdentity(kind, canonical),
        name:safeDisplayLabel(path.basename(canonical), kind === "file" ? "File" : "Folder"), path:canonical,
        reader, bytes, mediaType:existing?.mediaType || "",
        displayPath:source === "server" ? (root.relativePath ? `${root.root.name}/${safeRelativeDisplay(root.relativePath)}` : root.root.name)
          : safeDisplayLabel(path.basename(canonical), kind === "file" ? "File" : "Folder"),
        rootId:source === "server" ? root.root.id : undefined,
        rootName:source === "server" ? root.root.name : undefined,
        rootRelative:source === "server" ? root.relativePath : undefined,
        addedAt:existing?.addedAt || now, lastOpenedAt:now,
      };
      const next = [record, ...projects.filter(project => project.id !== record.id && project.path !== canonical)];
      await this.writeRegistry(next);
      return this.publicProject(record);
    });
  }

  async addFromRoot(rootId, relativePath = "", options = {}) {
    const selected = await this.resolveRootSelection(rootId, relativePath, options);
    if (selected.root.requireChild && !selected.relativePath) {
      throw projectError("Choose a folder inside the selected host root.", 400, "project_root_path_invalid");
    }
    return this.add(selected.canonical, {
      kind:"folder", origin:"server", rootId:selected.root.id, rootName:selected.root.name, rootRelative:selected.relativePath, approved:options.approved === true,
    });
  }

  async addFromHostRoot(rootId, relativePath = "", options = {}) {
    if (!normalizedRootRelative(relativePath).segments.length) {
      throw projectError("Choose a folder inside a PenEcho host root.", 400, "project_root_path_invalid");
    }
    const selected = await this.resolveRootSelection(rootId, relativePath, { ...options, host:true });
    return this.add(selected.canonical, { kind:"folder", origin:"native" });
  }

  async ensureUploadRoot() {
    await fs.mkdir(this.uploadDirectory, { recursive:true, mode:0o700 });
    const info = await fs.lstat(this.uploadDirectory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw projectError("The upload storage directory is unsafe.", 409, "project_upload_identity_invalid");
    await fs.chmod(this.uploadDirectory, 0o700);
    return fs.realpath(this.uploadDirectory);
  }

  async cleanupUploadTemporaryFiles(directory) {
    if (!directory) return 0;
    let removed = 0;
    for (const name of await fs.readdir(directory)) {
      if (!PROJECT_UPLOAD_TEMP_FILE_PATTERN.test(name)) continue;
      const candidate = path.join(directory, name), info = await fs.lstat(candidate).catch(error => error?.code === "ENOENT" ? null : Promise.reject(error));
      if (!info || !info.isFile() || info.isSymbolicLink() || await fs.realpath(candidate) !== candidate) continue;
      await fs.unlink(candidate);
      removed += 1;
    }
    return removed;
  }

  async deleteUploadPlans(upload, history) {
    if (upload?.file) await fs.unlink(upload.file);
    if (upload?.directory) await fs.rmdir(upload.directory);
    if (history?.historyFile) await fs.unlink(history.historyFile);
    if (history?.historyDirectory) await fs.rmdir(history.historyDirectory);
  }

  async cleanupOrphanUploadDirectories(referencedIds, protectedIds, result) {
    const rootInfo = await fs.lstat(this.uploadDirectory).catch(error => error?.code === "ENOENT" ? null : Promise.reject(error));
    if (!rootInfo) return;
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw projectError("The upload storage directory is unsafe.", 409, "project_upload_identity_invalid");
    const canonicalRoot = await fs.realpath(this.uploadDirectory);
    for (const id of await fs.readdir(canonicalRoot)) {
      if (!PROJECT_FILE_ID_PATTERN.test(id)) continue;
      const directory = path.join(canonicalRoot, id);
      try {
        const info = await fs.lstat(directory);
        if (!info.isDirectory() || info.isSymbolicLink() || await fs.realpath(directory) !== directory) {
          result.skipped.push(id);
          continue;
        }
        result.temporaryFiles += await this.cleanupUploadTemporaryFiles(directory);
        if (referencedIds.has(id) || protectedIds.has(id)) continue;
        const entries = await fs.readdir(directory);
        if (entries.length > 1 || entries.some(name => !PROJECT_UPLOAD_CONTENT_FILE_PATTERN.test(name))) {
          result.skipped.push(id);
          continue;
        }
        const files = [];
        let safe = true;
        for (const name of entries) {
          const file = path.join(directory, name), fileInfo = await fs.lstat(file);
          if (!fileInfo.isFile() || fileInfo.isSymbolicLink() || await fs.realpath(file) !== file) { safe = false; break; }
          files.push(file);
        }
        if (!safe) { result.skipped.push(id); continue; }
        const history = await this.fileHistoryDeletionPlan({ id, kind:"file", source:"upload" });
        for (const file of files) await fs.unlink(file);
        await fs.rmdir(directory);
        if (history.historyFile) await fs.unlink(history.historyFile);
        if (history.historyDirectory) await fs.rmdir(history.historyDirectory);
        result.orphanIds.push(id);
      } catch (error) {
        if (error?.code === "ENOENT") continue;
        result.skipped.push(id);
      }
    }
  }

  async cleanupUploadsLocked(options = {}) {
    const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now(), protectedIds = new Set(
      (Array.isArray(options.protectedProjectIds) ? options.protectedProjectIds : []).map(String).filter(id => PROJECT_FILE_ID_PATTERN.test(id)),
    ), projects = await this.readRegistry(), retained = [], result = { expiredIds:[], orphanIds:[], temporaryFiles:0, skipped:[] };
    for (const project of projects) {
      const expired = project.source === "upload" && !protectedIds.has(project.id) && now - project.lastOpenedAt >= PROJECT_UPLOAD_IDLE_TTL_MS;
      if (!expired) { retained.push(project); continue; }
      try {
        const validated = await this.validateUploadRecord(project, { allowMissing:true });
        if (validated.directory) result.temporaryFiles += await this.cleanupUploadTemporaryFiles(validated.directory);
        const upload = await this.uploadDeletionPlan(project), history = await this.fileHistoryDeletionPlan(project);
        await this.deleteUploadPlans(upload, history);
        result.expiredIds.push(project.id);
      } catch {
        retained.push(project);
        result.skipped.push(project.id);
      }
    }
    if (retained.length !== projects.length) await this.writeRegistry(retained);
    const referencedIds = new Set(retained.filter(project => project.source === "upload").map(project => project.id));
    await this.cleanupOrphanUploadDirectories(referencedIds, protectedIds, result);
    result.skipped = [...new Set(result.skipped)];
    return result;
  }

  reportCleanupWarning(entry) {
    try { this.logger?.({ type:"canvas-agent-upload-cleanup-warning", ...entry }); }
    catch {}
  }

  async cleanupUploadsBestEffortLocked(options = {}) {
    try {
      const result = await this.cleanupUploadsLocked(options);
      if (result.skipped.length) this.reportCleanupWarning({ skippedProjectIds:result.skipped });
      return result;
    } catch (error) {
      this.reportCleanupWarning({ errorCode:typeof error?.code === "string" ? error.code.slice(0, 64) : "cleanup_failed" });
      return { expiredIds:[], orphanIds:[], temporaryFiles:0, skipped:[], failed:true };
    }
  }

  cleanupUploads(options = {}) {
    return this.mutate(() => this.cleanupUploadsBestEffortLocked(options));
  }

  async upload({ name:inputName, mediaType:inputMediaType, data, bytes } = {}, options = {}) {
    const name = safeUploadName(inputName), mediaType = validateUploadMediaType(name, inputMediaType), decoded = decodeCanonicalBase64(data, bytes), reader = await uploadedFileReader(name, decoded), sha256=crypto.createHash("sha256").update(decoded).digest("hex");
    return this.mutate(async () => {
      const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
      await this.cleanupUploadsBestEffortLocked({ now, protectedProjectIds:options.protectedProjectIds });
      const projects = await this.readRegistry();
      const duplicate=projects.find(project=>project.source==="upload"&&project.name===name&&project.bytes===decoded.length&&project.sha256===sha256);
      if(duplicate){
        const validated=await this.validateUploadRecord(duplicate),stored=await fs.readFile(validated.file);
        if(stored.length===decoded.length&&crypto.createHash("sha256").update(stored).digest("hex")===sha256){
          const record={...duplicate,lastOpenedAt:now};
          await this.writeRegistry([record,...projects.filter(project=>project.id!==record.id)]);
          return {...this.publicProject(record),reused:true};
        }
      }
      if (projects.length >= PROJECT_REGISTRY_LIMIT) throw projectError("The project list already contains 100 resources.", 409, "project_limit");
      const uploadRoot = await this.ensureUploadRoot(), extension = path.extname(name).toLowerCase(), managedName = `content${extension}`;
      let id, directory;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        id = `file-${crypto.randomBytes(12).toString("hex")}`;
        if (projects.some(project => project.id === id)) continue;
        directory = path.join(uploadRoot, id);
        try { await fs.mkdir(directory, { mode:0o700 }); break; }
        catch (error) { if (error?.code !== "EEXIST") throw error; directory = null; }
      }
      if (!directory) throw projectError("Could not allocate safe upload storage.", 500, "project_upload_failed");
      const destination = path.join(directory, managedName), temporary = path.join(directory, `.upload-${crypto.randomUUID()}.tmp`);
      let stored = false;
      try {
        await fs.writeFile(temporary, decoded, { flag:"wx", mode:0o600 });
        await fs.rename(temporary, destination);
        await fs.chmod(destination, 0o600);
        stored = true;
        const record = {
          id, kind:"file", source:"upload", origin:"upload", name, path:destination, displayPath:name, managedName,
          reader, mediaType, bytes:decoded.length,
          sha256,
          addedAt:now, lastOpenedAt:now,
        };
        await this.writeRegistry([record, ...projects]);
        return {...this.publicProject(record),reused:false};
      } catch (error) {
        await fs.unlink(temporary).catch(cleanupError => { if (cleanupError?.code !== "ENOENT") throw cleanupError; });
        if (stored) await fs.unlink(destination).catch(cleanupError => { if (cleanupError?.code !== "ENOENT") throw cleanupError; });
        await fs.rmdir(directory).catch(cleanupError => { if (cleanupError?.code !== "ENOENT") throw cleanupError; });
        throw error;
      }
    });
  }

  async resolve(id, { touch = false } = {}) {
    if (!PROJECT_ID_PATTERN.test(String(id || ""))) throw projectError("The selected project id is invalid.");
    const operation = async () => {
      const projects = await this.readRegistry(), project = projects.find(entry => entry.id === id);
      if (!project) throw projectError("The selected project was not found.", 404, "project_not_found");
      await this.validateRecord(project);
      if (touch) { project.lastOpenedAt = Date.now(); await this.writeRegistry(projects); }
      return this.publicProject(project, { resolved:true });
    };
    return touch ? this.mutate(operation) : operation();
  }

  async validateHistoryDirectory(directory, { allowMissing = true } = {}) {
    const info = await fs.lstat(directory).catch(error => error?.code === "ENOENT" ? null : Promise.reject(error));
    if (!info) {
      if (allowMissing) return null;
      throw projectError("The file history directory is unavailable.", 404, "project_metadata_invalid");
    }
    if (!info.isDirectory() || info.isSymbolicLink()) throw projectError("The file history directory is unsafe.", 409, "project_metadata_invalid");
    return fs.realpath(directory);
  }

  async validateHistoryFile(file) {
    const info = await fs.lstat(file).catch(error => error?.code === "ENOENT" ? null : Promise.reject(error));
    if (info && (!info.isFile() || info.isSymbolicLink())) {
      throw projectError("The conversation history file is unsafe.", 409, "project_metadata_invalid");
    }
    return info;
  }

  async fileHistoryDeletionPlan(project) {
    if (project.kind !== "file" || !PROJECT_FILE_ID_PATTERN.test(project.id)) {
      throw projectError("The file history identity is invalid.", 409, "project_metadata_invalid");
    }
    const historyRoot = await this.validateHistoryDirectory(this.fileHistoryDirectory);
    if (!historyRoot) return { historyDirectory:null, historyFile:null };
    const historyDirectory = path.join(historyRoot, project.id);
    const historyInfo = await fs.lstat(historyDirectory).catch(error => error?.code === "ENOENT" ? null : Promise.reject(error));
    if (!historyInfo) return { historyDirectory:null, historyFile:null };
    if (!historyInfo.isDirectory() || historyInfo.isSymbolicLink() || await fs.realpath(historyDirectory) !== historyDirectory) {
      throw projectError("The file history identity is unsafe.", 409, "project_metadata_invalid");
    }
    if (project.source !== "upload" && isContained(historyDirectory, path.resolve(project.path))) {
      throw projectError("The source file overlaps its private history directory.", 409, "project_metadata_invalid");
    }
    const historyFile = path.join(historyDirectory, PROJECT_HISTORY_FILE), entries = await fs.readdir(historyDirectory);
    if (entries.some(name => name !== PROJECT_HISTORY_FILE)) {
      throw projectError("The file history contains unexpected data.", 409, "project_metadata_invalid");
    }
    const historyFileInfo = await this.validateHistoryFile(historyFile);
    return { historyDirectory, historyFile:historyFileInfo ? historyFile : null };
  }

  async uploadDeletionPlan(project) {
    const upload = await this.validateUploadRecord(project, { allowMissing:true });
    if (upload.directory) {
      const entries = await fs.readdir(upload.directory);
      if (entries.some(name => name !== project.managedName)) throw projectError("The upload directory contains unexpected data.", 409, "project_upload_identity_invalid");
    }
    if (upload.file) {
      const digest = crypto.createHash("sha256").update(await fs.readFile(upload.file)).digest("hex");
      if (digest !== project.sha256) throw projectError("The uploaded file content changed identity.", 409, "project_upload_identity_invalid");
    }
    return upload;
  }

  async remove(id) {
    if (!PROJECT_ID_PATTERN.test(String(id || ""))) throw projectError("The selected project id is invalid.");
    return this.mutate(async () => {
      const projects = await this.readRegistry(), project = projects.find(entry => entry.id === id);
      if (!project) throw projectError("The selected project was not found.", 404, "project_not_found");
      const identityMatches = typeof project.pathIdentity === "string"
        ? project.pathIdentity === projectPathIdentity(project.kind, project.path)
        : project.id === opaqueId(project.kind === "folder" ? "local" : "file", project.path);
      if (project.source !== "upload" && !identityMatches) {
        throw projectError("The selected resource registration changed identity.", 409, "project_changed");
      }
      if (project.source === "upload") {
        const validated = await this.validateUploadRecord(project, { allowMissing:true });
        if (validated.directory) await this.cleanupUploadTemporaryFiles(validated.directory);
      }
      const uploadDeletion = project.source === "upload" ? await this.uploadDeletionPlan(project) : null;
      const historyDeletion = project.kind === "file" ? await this.fileHistoryDeletionPlan(project) : null;
      if (uploadDeletion?.file) await fs.unlink(uploadDeletion.file);
      if (uploadDeletion?.directory) await fs.rmdir(uploadDeletion.directory);
      if (historyDeletion?.historyFile) await fs.unlink(historyDeletion.historyFile);
      if (historyDeletion?.historyDirectory) await fs.rmdir(historyDeletion.historyDirectory);
      await this.writeRegistry(projects.filter(entry => entry.id !== id));
      return true;
    });
  }

  async fileHistoryFile(project, { create = false } = {}) {
    let historyRoot = await this.validateHistoryDirectory(this.fileHistoryDirectory);
    if (!historyRoot && create) {
      await fs.mkdir(this.fileHistoryDirectory, { recursive:true, mode:0o700 });
      await fs.chmod(this.fileHistoryDirectory, 0o700);
      historyRoot = await this.validateHistoryDirectory(this.fileHistoryDirectory, { allowMissing:false });
    }
    const lexicalRoot = historyRoot || this.fileHistoryDirectory, metadata = path.join(lexicalRoot, project.id);
    const existing = await fs.lstat(metadata).catch(error => error?.code === "ENOENT" ? null : Promise.reject(error));
    if (existing?.isSymbolicLink() || existing && !existing.isDirectory()) throw projectError("The file's history path is not a safe metadata folder.", 409, "project_metadata_invalid");
    if (!existing && create) await fs.mkdir(metadata, { mode:0o700 });
    if (create) {
      const canonicalMetadata = await fs.realpath(metadata);
      if (!isContained(historyRoot, canonicalMetadata) || path.basename(canonicalMetadata) !== project.id) {
        throw projectError("The file's history escaped its metadata folder.", 409, "project_metadata_invalid");
      }
    }
    const file = path.join(metadata, PROJECT_HISTORY_FILE);
    await this.validateHistoryFile(file);
    return { project, metadata, file };
  }

  async historyFile(id, { create = false } = {}) {
    const project = await this.resolve(id);
    if (project.kind === "file") return this.fileHistoryFile(project, { create });
    const metadata = path.join(project.path, ".penecho");
    const existing = await fs.lstat(metadata).catch(error => error?.code === "ENOENT" ? null : Promise.reject(error));
    if (existing?.isSymbolicLink() || existing && !existing.isDirectory()) throw projectError("The project's .penecho path is not a safe metadata folder.", 409, "project_metadata_invalid");
    const file = path.join(metadata, PROJECT_HISTORY_FILE);
    await this.validateHistoryFile(file);
    return { project, metadata, file };
  }

  async readHistory(id) {
    const { file } = await this.historyFile(id);
    try { return normalizedHistory(JSON.parse(await fs.readFile(file, "utf8"))); }
    catch (error) {
      if (error?.code === "ENOENT" || error instanceof SyntaxError) return [];
      throw error;
    }
  }

  async writeHistory(id, value) {
    const initial = await this.historyFile(id), conversations = normalizedHistory(value);
    if (initial.project.kind === "file") {
      const { file } = await this.fileHistoryFile(initial.project, { create:true });
      await atomicJsonWrite(file, { version:1, conversations });
      return conversations;
    }
    const { metadata, file } = initial;
    await fs.mkdir(metadata, { recursive:true, mode:0o700 });
    const canonicalMetadata = await fs.realpath(metadata), project = await this.resolve(id);
    if (canonicalMetadata !== path.join(project.path, ".penecho")) throw projectError("The project's metadata folder escaped the selected project.", 409, "project_metadata_invalid");
    await atomicJsonWrite(file, { version:1, conversations });
    return conversations;
  }
}

module.exports = {
  CanvasAgentProjectStore,
  PROJECT_HISTORY_LIMIT,
  PROJECT_REGISTRY_LIMIT,
  PROJECT_FILE_LIMIT,
  PROJECT_UPLOAD_LIMIT,
  PROJECT_UPLOAD_IDLE_TTL_MS,
  PROJECT_ROOT_DEPTH_LIMIT,
  PROJECT_ROOT_ENTRY_LIMIT,
  PROJECT_ROOT_SCAN_LIMIT,
  PROJECT_ZIP_ENTRY_LIMIT,
  PROJECT_ZIP_ENTRY_BYTES_LIMIT,
  PROJECT_ZIP_TOTAL_BYTES_LIMIT,
  PROJECT_FOLDER_ID_PATTERN,
  PROJECT_FILE_ID_PATTERN,
  PROJECT_ID_PATTERN,
  PROJECT_ROOT_ID_PATTERN,
  projectFileReader,
  validateProjectFileContent:validateUploadContent,
};
