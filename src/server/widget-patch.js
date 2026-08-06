"use strict";

const { applyPatch, parsePatch } = require("diff");

const MAX_WIDGET_PATCH_BYTES = 256 * 1024;
const MAX_WIDGET_PATCH_FILES = 2;
const MAX_WIDGET_PATCH_HUNKS = 128;
const MAX_WIDGET_PATCH_LINES = 12000;

function normalizedWidgetSource(value) {
  return typeof value === "string" ? value.replace(/\r\n/g, "\n").trim() : "";
}

function widgetSourceMirrorsHtml(source, html) {
  const normalizedSource = normalizedWidgetSource(source);
  return Boolean(normalizedSource) && normalizedSource === normalizedWidgetSource(html);
}

function widgetPatchFileContent(value) {
  if (typeof value !== "string" || !value || /(?:\r\n|\r|\n)$/.test(value)) return typeof value === "string" ? value : "";
  return `${value}\n`;
}

function patchFilesForWidgetEdit(widgetEdit) {
  if (!widgetEdit) return [];
  if (widgetEdit.widgetType === "diagram_source") {
    return [{ path:"widget.source", field:"source", content:widgetPatchFileContent(widgetEdit.source) }];
  }
  return [
    { path:"widget.html", field:"html", content:widgetPatchFileContent(widgetEdit.html) },
    ...(!widgetEdit.sourceMirrorsHtml && typeof widgetEdit.source === "string" && widgetEdit.source ? [{ path:"widget.source", field:"source", content:widgetPatchFileContent(widgetEdit.source) }] : []),
  ];
}

function widgetPatchContract(widgetEdit) {
  return patchFilesForWidgetEdit(widgetEdit).map(file => ({ path:file.path, widgetEditField:file.field }));
}

function normalizedPatchText(value) {
  if (typeof value !== "string" || !value.trim() || Buffer.byteLength(value, "utf8") > MAX_WIDGET_PATCH_BYTES) return "";
  return value.replace(/\r\n/g, "\n");
}

function uniqueSequenceStart(lines, expected, minimumStart, matchesLine = (actual, submitted) => actual === submitted) {
  const matches = [];
  for (let candidate = minimumStart; candidate + expected.length <= lines.length; candidate++) {
    if (expected.every((line, index) => matchesLine(lines[candidate + index], line))) matches.push(candidate);
    if (matches.length > 1) return null;
  }
  return matches.length === 1 ? matches[0] : null;
}

function uniquelyLocatedPatchSequence(lines, entries, minimumStart) {
  const expected = entries.map(entry => entry.content), exactStart = uniqueSequenceStart(lines, expected, minimumStart);
  if (exactStart !== null) return { start:exactStart, repaired:false };
  const omittedIndentStart = uniqueSequenceStart(
    lines,
    expected,
    minimumStart,
    (actual, submitted) => actual === submitted || actual === ` ${submitted}`,
  );
  return omittedIndentStart === null ? null : { start:omittedIndentStart, repaired:true };
}

// Hunk line counts are redundant with the prefixed body lines and models
// occasionally miscount them or omit the coordinates as a bare @@ header.
// Canonicalize counts and uniquely infer missing coordinates before parsing;
// also repair one swallowed source-indent space only at a unique target.
// Paths, body prefixes, additions, and the complete envelope remain strict.
function canonicalPatchCounts(patchText, widgetEdit) {
  const lines = patchText.split("\n"), finalNewline = lines.at(-1) === "";
  if (finalNewline) lines.pop();
  const files = new Map(patchFilesForWidgetEdit(widgetEdit).map(file => [file.path, file])), output = [];
  let cursor = 0, fileCount = 0;
  while (cursor < lines.length) {
    const fileHeader = /^--- a\/(.+)$/.exec(lines[cursor] || ""), path = fileHeader?.[1];
    if (!path || !files.has(path) || lines[cursor + 1] !== `+++ b/${path}`) return "";
    output.push(lines[cursor], lines[cursor + 1]);
    cursor += 2;
    fileCount++;
    const sourceLines = files.get(path).content.replace(/\r\n/g, "\n").split("\n");
    let hunkCount = 0, previousEnd = 0, lineOffset = 0;
    while (cursor < lines.length && !/^--- a\//.test(lines[cursor])) {
      const rawHeader = lines[cursor] || "",
        header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(rawHeader),
        bareHeader = !header && /^@@[ \t]*$/.test(rawHeader);
      if (!header && !bareHeader) return "";
      let oldStart = header ? Number(header[1]) : null, newStart = header ? Number(header[2]) : null;
      if (header && (!Number.isSafeInteger(oldStart) || !Number.isSafeInteger(newStart))) return "";
      cursor++;
      const body = [];
      let oldLines = 0, newLines = 0;
      while (cursor < lines.length && !/^@@(?: |$)/.test(lines[cursor]) && !/^--- a\//.test(lines[cursor])) {
        const line = lines[cursor++], operation = line[0];
        if (line === "\\ No newline at end of file") {
          if (!body.length) return "";
        } else if (operation === " ") {
          oldLines++;
          newLines++;
        } else if (operation === "-") oldLines++;
        else if (operation === "+") newLines++;
        else return "";
        body.push(line);
      }
      if (!body.length) return "";
      const expectedEntries = body
        .map((line, bodyIndex) => ({ operation:line[0], content:line.slice(1), bodyIndex }))
        .filter(entry => entry.operation === " " || entry.operation === "-");
      const expected = expectedEntries.map(entry => entry.content);
      let locatedStart;
      if (expected.length) {
        const located = uniquelyLocatedPatchSequence(sourceLines, expectedEntries, previousEnd);
        if (!located) return "";
        locatedStart = located.start;
        if (located.repaired) {
          expectedEntries.forEach((entry, index) => {
            body[entry.bodyIndex] = `${entry.operation}${sourceLines[locatedStart + index]}`;
          });
        }
      } else {
        if (bareHeader) return "";
        locatedStart = oldLines === 0 ? oldStart : oldStart - 1;
        if (locatedStart < previousEnd || locatedStart > sourceLines.length) return "";
      }
      if (bareHeader) {
        oldStart = locatedStart + 1;
        newStart = oldStart + lineOffset;
      }
      output.push(`@@ -${oldStart},${oldLines} +${newStart},${newLines} @@${header?.[3] || ""}`, ...body);
      previousEnd = locatedStart + expected.length;
      lineOffset += newLines - oldLines;
      hunkCount++;
    }
    if (!hunkCount) return "";
  }
  if (!fileCount) return "";
  return `${output.join("\n")}${finalNewline ? "\n" : ""}`;
}

function exactPatchEnvelope(lines, patches) {
  let cursor = 0;
  if (lines.at(-1) === "") lines.pop();
  for (const patch of patches) {
    if (lines[cursor++] !== `--- ${patch.oldFileName}` || lines[cursor++] !== `+++ ${patch.newFileName}`) return false;
    for (const hunk of patch.hunks) {
      const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/.exec(lines[cursor++] || "");
      const serializedOldStart = hunk.oldLines === 0 ? hunk.oldStart - 1 : hunk.oldStart,
        serializedNewStart = hunk.newLines === 0 ? hunk.newStart - 1 : hunk.newStart;
      if (!header
        || Number(header[1]) !== serializedOldStart || Number(header[2] === undefined ? 1 : header[2]) !== hunk.oldLines
        || Number(header[3]) !== serializedNewStart || Number(header[4] === undefined ? 1 : header[4]) !== hunk.newLines) return false;
      for (const line of hunk.lines) if (lines[cursor++] !== line) return false;
    }
  }
  return cursor === lines.length;
}

function exactContextPatch(source, patch) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  let previousEnd = 0, lineOffset = 0;
  const hunks = [];
  for (const hunk of patch.hunks) {
    const expected = hunk.lines.filter(line => line[0] === " " || line[0] === "-").map(line => line.slice(1));
    let start = Math.max(0, hunk.oldStart - 1);
    if (expected.length) {
      start = uniqueSequenceStart(lines, expected, previousEnd);
      if (start === null) return null;
    } else if (start < previousEnd || start > lines.length) return null;
    const oldStart = start + 1;
    hunks.push({ ...hunk, oldStart, newStart:oldStart + lineOffset });
    previousEnd = start + expected.length;
    lineOffset += hunk.newLines - hunk.oldLines;
  }
  return { ...patch, hunks };
}

function parsedWidgetPatch(command, widgetEdit) {
  if (!command || typeof command !== "object" || Array.isArray(command)
    || command.tool !== "widget_patch" || Object.keys(command).some(key => !["tool", "patch"].includes(key))) return null;
  const submittedPatchText = normalizedPatchText(command.patch), patchText = canonicalPatchCounts(submittedPatchText, widgetEdit);
  if (!submittedPatchText || !patchText) return null;
  let patches;
  try {
    patches = parsePatch(patchText);
  } catch {
    return null;
  }
  const files = patchFilesForWidgetEdit(widgetEdit), allowed = new Map(files.map(file => [file.path, file]));
  if (!patches.length || patches.length > Math.min(MAX_WIDGET_PATCH_FILES, files.length)
    || !exactPatchEnvelope(patchText.split("\n"), patches)) return null;
  const seen = new Set();
  let hunkCount = 0, lineCount = 0, hasChange = false;
  for (const patch of patches) {
    const oldPath = String(patch.oldFileName || ""), newPath = String(patch.newFileName || ""),
      path = oldPath.startsWith("a/") ? oldPath.slice(2) : "";
    hunkCount += patch.hunks.length;
    lineCount += patch.hunks.reduce((count, hunk) => count + hunk.lines.length, 0);
    hasChange ||= patch.hunks.some(hunk => hunk.lines.some(line => line[0] === "+" || line[0] === "-"));
    if (!allowed.has(path) || seen.has(path) || oldPath !== `a/${path}` || newPath !== `b/${path}`
      || !patch.hunks.length || patch.isRename || patch.isCopy || patch.isCreate || patch.isDelete || patch.isBinary) return null;
    seen.add(path);
  }
  const requiredPath = widgetEdit.widgetType === "diagram_source" ? "widget.source" : "widget.html";
  if (!seen.has(requiredPath)) return null;
  return hasChange && hunkCount <= MAX_WIDGET_PATCH_HUNKS && lineCount <= MAX_WIDGET_PATCH_LINES ? { patches, allowed } : null;
}

function commandFromWidgetPatch(command, widgetEdit) {
  const parsed = parsedWidgetPatch(command, widgetEdit);
  if (!parsed) return null;
  const updated = new Map(), files = patchFilesForWidgetEdit(widgetEdit);
  for (const patch of parsed.patches) {
    const path = patch.oldFileName.slice(2), file = parsed.allowed.get(path);
    const exactPatch = exactContextPatch(file.content, patch);
    if (!exactPatch) return null;
    let content;
    try {
      content = applyPatch(file.content, exactPatch, { fuzzFactor:0 });
    } catch {
      return null;
    }
    if (content === false) return null;
    updated.set(path, content);
  }
  if (!files.some(file => updated.has(file.path) && updated.get(file.path) !== file.content)) return null;
  const content = path => updated.has(path) ? updated.get(path) : parsed.allowed.get(path)?.content;
  if (widgetEdit.widgetType === "diagram_source") {
    return {
      tool:"diagram_source",
      pluginId:widgetEdit.pluginId,
      ...widgetEdit.box,
      title:widgetEdit.title,
      refreshSeconds:0,
      sourceFormat:widgetEdit.sourceFormat,
      source:content("widget.source"),
      ...(widgetEdit.diagramKind ? { diagramKind:widgetEdit.diagramKind } : {}),
    };
  }
  return {
    tool:"html_widget",
    pluginId:widgetEdit.pluginId,
    ...widgetEdit.box,
    title:widgetEdit.title,
    refreshSeconds:widgetEdit.refreshSeconds || 0,
    html:content("widget.html"),
    ...(widgetEdit.diagramKind ? { diagramKind:widgetEdit.diagramKind } : {}),
    ...(widgetEdit.sourceFormat ? { sourceFormat:widgetEdit.sourceFormat } : {}),
    ...(widgetEdit.frameworkVersion ? { frameworkVersion:widgetEdit.frameworkVersion } : {}),
    ...(parsed.allowed.has("widget.source") ? { copyText:content("widget.source"), copyLabel:widgetEdit.copyLabel || `Copy ${widgetEdit.sourceFormat || "source"}` } : {}),
  };
}

function resolveWidgetEditPatchCommands(commands, widgetEdit) {
  if (!widgetEdit) return commands;
  if (!Array.isArray(commands) || commands.length !== 1) return [];
  const command = commandFromWidgetPatch(commands[0], widgetEdit);
  return command ? [command] : [];
}

module.exports = {
  MAX_WIDGET_PATCH_BYTES,
  commandFromWidgetPatch,
  resolveWidgetEditPatchCommands,
  widgetSourceMirrorsHtml,
  widgetPatchFileContent,
  widgetPatchContract,
};
