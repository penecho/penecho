"use strict";
// Shared by the MCP precheck and the browser commit path; diff is MIT licensed.
const { parsePatch, applyPatch } = require("diff");
const MAX_FILE_BYTES = 800000;
function bridgeError(code, message, status) { return Object.assign(new Error(message), {code, status}); }
function patchParseDiagnostic(error) {
  const message = typeof error?.message === "string" ? error.message : "";
  const bounded = (value, minimum = 1) => {
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= minimum && number <= MAX_FILE_BYTES ? number : null;
  };
  let match = /^Added line count did not match for hunk at line (\d+)$/.exec(message);
  if (match) {
    const line = bounded(match[1]);
    if (line !== null) return `Added line count did not match for hunk at line ${line}.`;
  }
  match = /^Removed line count did not match for hunk at line (\d+)$/.exec(message);
  if (match) {
    const line = bounded(match[1]);
    if (line !== null) return `Removed line count did not match for hunk at line ${line}.`;
  }
  match = /^Hunk at line (\d+) has more lines than expected \(expected (\d+) old lines and (\d+) new lines\)$/.exec(message);
  if (match) {
    const line = bounded(match[1]), oldLines = bounded(match[2],0), newLines = bounded(match[3],0);
    if (line !== null && oldLines !== null && newLines !== null) return `Hunk at line ${line} has more lines than expected (expected ${oldLines} old lines and ${newLines} new lines).`;
  }
  match = /^Hunk at line (\d+) contained invalid line /.exec(message);
  if (match) {
    const line = bounded(match[1]);
    if (line !== null) return `Hunk at line ${line} contains an invalid line.`;
  }
  return "patch must be a valid unified diff.";
}


// Correct only cardinalities in an unambiguous single hunk; never rewrite edit bytes.
function repairSingleHunkCounts(patch, fileName) {
  const lines = patch.split("\n");
  const headerLine = (line) => line?.replace(/\r$/, "");
  if(headerLine(lines[0]) !== `--- a/${fileName}` || headerLine(lines[1]) !== `+++ b/${fileName}`) return null;
  const match = /^@@ -(0|[1-9]\d*)(?:,(0|[1-9]\d*))? \+(0|[1-9]\d*)(?:,(0|[1-9]\d*))? @@(.*)$/.exec(headerLine(lines[2]));
  if(!match || match.slice(1,5).some(value => value !== undefined && (!Number.isSafeInteger(Number(value)) || Number(value) > MAX_FILE_BYTES))) return null;
  let oldCount = 0, newCount = 0, previous = null, oldEnded = false, newEnded = false;
  const end = lines.length - (lines.at(-1) === "" ? 1 : 0);
  for(let i = 3; i < end; i++) {
    const line = headerLine(lines[i]);
    if(line === "\\ No newline at end of file") {
      if(!previous) return null;
      if(previous !== "+") oldEnded = true;
      if(previous !== "-") newEnded = true;
      previous = null;
      continue;
    }
    // File-like headers in the body are ambiguous even when they could be edits.
    if(/^(---|\+\+\+)\s/.test(line) || !/^[ +-]/.test(line)) return null;
    const operation = line[0];
    if(operation !== "+") { if(oldEnded) return null; oldCount++; }
    if(operation !== "-") { if(newEnded) return null; newCount++; }
    previous = operation;
  }
  if((!oldCount && !newCount) || (oldCount && match[1] === "0") || (newCount && match[3] === "0")) return null;
  if(oldCount === Number(match[2] ?? 1) && newCount === Number(match[4] ?? 1)) return null;
  lines[2] = `@@ -${match[1]},${oldCount} +${match[3]},${newCount} @@${match[5]}${lines[2].endsWith("\r") ? "\r" : ""}`;
  const repaired = lines.join("\n");
  return new TextEncoder().encode(repaired).length <= MAX_FILE_BYTES ? repaired : null;
}


function validateCanvasFilePatch(patch, virtualPath) {
  const fileName = virtualPath.replace(/^\/+/, "");
  if(typeof patch !== "string" || new TextEncoder().encode(patch).length > MAX_FILE_BYTES) throw bridgeError("invalid_patch", "patch must be a bounded unified diff.", 400);
  let parsed;
  try { parsed = parsePatch(patch); }
  catch(error) {
    const repaired = repairSingleHunkCounts(patch, fileName);
    if(repaired === null) throw bridgeError("invalid_patch", patchParseDiagnostic(error), 400);
    try { parsed = parsePatch(repaired); }
    catch(repairError) { throw bridgeError("invalid_patch", patchParseDiagnostic(repairError), 400); }
  }
  if(parsed.length !== 1 || parsed[0].oldFileName !== `a/${fileName}` || parsed[0].newFileName !== `b/${fileName}` || !parsed[0].hunks.length)
    throw bridgeError("invalid_patch", `patch must modify exactly --- a/${fileName} and +++ b/${fileName}.`, 400);
  return parsed[0];
}
function applyCanvasFilePatch(source, patch, virtualPath) {
  const parsed = validateCanvasFilePatch(patch, virtualPath);
  const content = applyPatch(source, parsed, {fuzzFactor:0});
  if(content === false) throw bridgeError("PATCH_CONFLICT", "The patch no longer applies exactly. Re-read the virtual file and create a new patch and requestId.", 409);
  if(new TextEncoder().encode(content).length > MAX_FILE_BYTES) throw bridgeError("patch_too_large", "The patched content exceeds the 800,000-byte limit.", 413);
  return content;
}
module.exports = {validateCanvasFilePatch, applyCanvasFilePatch};
