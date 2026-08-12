"use strict";

const { applyPatch, parsePatch } = require("diff");

const MAX_WIDGET_PATCH_BYTES = 256 * 1024;
const MAX_WIDGET_PATCH_FILES = 16;
const MAX_WIDGET_PATCH_HUNKS = 128;
const MAX_WIDGET_PATCH_LINES = 12000;
const WIDGET_MANIFEST_PATH = "widget.json";
const WIDGET_HTML_PATH = "widget.html";
const WIDGET_SOURCE_PATH = "widget.source";
const FINAL_NEWLINE = /(?:\r\n|\r|\n)$/;

function normalizedWidgetSource(value) {
  return typeof value === "string" ? value.replace(/\r\n/g, "\n").trim() : "";
}

function widgetSourceMirrorsHtml(source, html) {
  const normalizedSource = normalizedWidgetSource(source);
  return Boolean(normalizedSource) && normalizedSource === normalizedWidgetSource(html);
}

function widgetPatchFileContent(value) {
  if (typeof value !== "string" || !value || FINAL_NEWLINE.test(value)) return typeof value === "string" ? value : "";
  return `${value}\n`;
}

function widgetManifest(widgetEdit) {
  const common = {
    tool:widgetEdit.widgetType,
    pluginId:widgetEdit.pluginId,
    title:widgetEdit.title,
    refreshSeconds:widgetEdit.widgetType === "diagram_source" ? 0 : widgetEdit.refreshSeconds || 0,
    diagramKind:widgetEdit.diagramKind || null,
    sourceFormat:widgetEdit.sourceFormat || null,
  };
  if (widgetEdit.widgetType === "diagram_source") {
    return {
      ...common,
      sourceFile:WIDGET_SOURCE_PATH,
    };
  }
  const hasDistinctSource = !widgetEdit.sourceMirrorsHtml && typeof widgetEdit.source === "string" && Boolean(widgetEdit.source);
  return {
    ...common,
    frameworkVersion:widgetEdit.frameworkVersion || null,
    htmlFile:WIDGET_HTML_PATH,
    copyTextFile:widgetEdit.sourceMirrorsHtml ? WIDGET_HTML_PATH : hasDistinctSource ? WIDGET_SOURCE_PATH : null,
    copyLabel:hasDistinctSource ? widgetEdit.copyLabel || null : null,
  };
}

function widgetManifestContent(widgetEdit) {
  return `${JSON.stringify(widgetManifest(widgetEdit),null,2)}\n`;
}

function widgetPatchFile(path, originalContent) {
  const original = typeof originalContent === "string" ? originalContent : "";
  return {
    path,
    originalContent:original,
    originalEndsWithNewline:FINAL_NEWLINE.test(original),
    content:widgetPatchFileContent(original),
  };
}

function patchFilesForWidgetEdit(widgetEdit) {
  if (!widgetEdit) return [];
  const manifest = widgetPatchFile(WIDGET_MANIFEST_PATH,widgetManifestContent(widgetEdit));
  if (widgetEdit.widgetType === "diagram_source") {
    return [manifest,widgetPatchFile(WIDGET_SOURCE_PATH,widgetEdit.source)];
  }
  return [
    manifest,
    widgetPatchFile(WIDGET_HTML_PATH,widgetEdit.html),
    widgetPatchFile(WIDGET_SOURCE_PATH,!widgetEdit.sourceMirrorsHtml ? widgetEdit.source : ""),
  ];
}

function widgetPatchContract(widgetEdit) {
  return patchFilesForWidgetEdit(widgetEdit).map(file => ({ path:file.path }));
}

function widgetPatchFiles(widgetEdit) {
  return patchFilesForWidgetEdit(widgetEdit).map(file => ({
    path:file.path,
    content:file.content,
    originalEndsWithNewline:file.originalEndsWithNewline,
  }));
}

function possiblyUnifiedDiffLine(line) {
  return /^(?:--- a\/|\+\+\+ b\/|@@(?: |$)|[ +\\-]|\\ No newline at end of file$)/.test(line);
}

function normalizedPatchText(value, widgetEdit) {
  if (typeof value !== "string" || !value.trim() || Buffer.byteLength(value, "utf8") > MAX_WIDGET_PATCH_BYTES) return "";
  const paths = new Set(patchFilesForWidgetEdit(widgetEdit).map(file => file.path)),
    lines = [];
  for (const line of value.replace(/\r\n/g, "\n").split("\n")) {
    const updateFile = /^\*\*\* Update File: (.+)$/.exec(line);
    if (updateFile) {
      const path = updateFile[1];
      if (!paths.has(path)) return "";
      lines.push(`--- a/${path}`, `+++ b/${path}`);
      continue;
    }
    // Tolerate only the common existing-file marker. Creation, deletion and
    // moves remain outside the Refine contract and must never be normalized.
    if (/^\*\*\* (?:Add|Delete) File:/.test(line) || /^\*\*\* Move to:/.test(line)) return "";
    lines.push(line);
  }
  const
    firstHeader = lines.findIndex((line, index) => {
      const match = /^--- a\/(.+)$/.exec(line), path = match?.[1];
      return Boolean(path && paths.has(path) && lines[index + 1] === `+++ b/${path}`);
    });
  if (firstHeader < 0) return "";
  const diffLines = lines.slice(firstHeader);
  while (diffLines.at(-1) === "") diffLines.pop();
  while (diffLines.length && !possiblyUnifiedDiffLine(diffLines.at(-1))) diffLines.pop();
  return diffLines.length ? `${diffLines.join("\n")}\n` : "";
}

function coalescedPatchFileSections(patchText, widgetEdit) {
  if (!patchText) return "";
  const lines = patchText.split("\n"), finalNewline = lines.at(-1) === "",
    allowed = new Set(patchFilesForWidgetEdit(widgetEdit).map(file => file.path)),
    order = [], sections = new Map();
  if (finalNewline) lines.pop();
  let cursor = 0, sectionCount = 0;
  while (cursor < lines.length) {
    const header = /^--- a\/(.+)$/.exec(lines[cursor] || ""), path = header?.[1];
    if (!path || !allowed.has(path) || lines[cursor + 1] !== `+++ b/${path}`) return "";
    cursor += 2;
    const body = [];
    while (cursor < lines.length && !/^--- a\//.test(lines[cursor])) body.push(lines[cursor++]);
    if (!body.length || ++sectionCount > MAX_WIDGET_PATCH_HUNKS) return "";
    if (!sections.has(path)) {
      sections.set(path, []);
      order.push(path);
    }
    sections.get(path).push(...body);
  }
  const output = [];
  for (const path of order) output.push(`--- a/${path}`, `+++ b/${path}`, ...sections.get(path));
  return `${output.join("\n")}${finalNewline ? "\n" : ""}`;
}

function uniqueSequenceStart(lines, expected, minimumStart, matchesLine = (actual, submitted) => actual === submitted, preferredStart = null) {
  const matches = [];
  for (let candidate = minimumStart; candidate + expected.length <= lines.length; candidate++) {
    if (expected.every((line, index) => matchesLine(lines[candidate + index], line))) matches.push(candidate);
  }
  if (matches.length > 1 && Number.isSafeInteger(preferredStart) && matches.includes(preferredStart)) return preferredStart;
  return matches.length === 1 ? matches[0] : null;
}

function uniquelyLocatedPatchSequence(lines, entries, minimumStart, preferredStart = null) {
  const expected = entries.map(entry => entry.content), exactStart = uniqueSequenceStart(lines, expected, minimumStart, undefined, preferredStart);
  if (exactStart !== null) return { start:exactStart, repaired:false };
  const omittedIndentStart = uniqueSequenceStart(
    lines,
    expected,
    minimumStart,
    (actual, submitted) => actual === submitted || actual === ` ${submitted}`,
    preferredStart,
  );
  return omittedIndentStart === null ? null : { start:omittedIndentStart, repaired:true };
}

// An nl read view places one metadata TAB before every source line. Repair it
// only when the model copied that TAB onto every diff body line, the submitted
// old side has no exact match, and removing exactly one TAB yields the unique
// declared source location. Requiring at least one non-TAB source line proves
// that this is a systematic metadata prefix, not legitimate uniform indentation.
function repairedNumberingTabBody(body, sourceLines, minimumStart, declaredStart) {
  const diffLines = body.filter(line => line !== "\\ No newline at end of file"),
    expected = diffLines.filter(line => line[0] === " " || line[0] === "-").map(line => line.slice(1));
  if (!Number.isSafeInteger(declaredStart) || declaredStart < minimumStart || !expected.length
    || diffLines.some(line => ![" ","-","+"].includes(line[0]) || line[1] !== "\t")) return null;
  const exactMatches = [];
  for (let candidate = minimumStart; candidate + expected.length <= sourceLines.length; candidate++) {
    if (expected.every((line,index) => sourceLines[candidate + index] === line)) exactMatches.push(candidate);
    if (exactMatches.length > 1) break;
  }
  if (exactMatches.length) return null;
  const repairedExpected = expected.map(line => line.slice(1));
  if (!repairedExpected.some(line => !line.startsWith("\t"))) return null;
  const repairedStart = uniqueSequenceStart(sourceLines,repairedExpected,minimumStart);
  if (repairedStart === null || repairedStart !== declaredStart) return null;
  return body.map(line => line === "\\ No newline at end of file" ? line : `${line[0]}${line.slice(2)}`);
}

function setPatchDiagnostic(diagnostics, reason) {
  if (diagnostics && typeof diagnostics === "object" && !diagnostics.reason) diagnostics.reason = reason;
}

function patchBodyCounts(body) {
  let oldLines = 0, newLines = 0;
  for (const line of body) {
    if (line[0] === " ") {
      oldLines++;
      newLines++;
    } else if (line[0] === "-") oldLines++;
    else if (line[0] === "+") newLines++;
  }
  return { oldLines, newLines };
}

function trailingContextLines(body) {
  const result = [];
  for (let index = body.length - 1; index >= 0 && body[index][0] === " "; index--) result.unshift(body[index]);
  return result;
}

// Hunk line counts are redundant with the prefixed body lines and models
// occasionally miscount them or omit the coordinates as a bare @@ header.
// Canonicalize counts and uniquely infer missing coordinates before parsing;
// repair one swallowed source-indent space or one proven nl metadata TAB only
// at a unique target, and trim only exact unchanged context repeated across
// two ordered adjacent hunks.
// Paths, changed lines, additions, and the complete envelope remain strict.
function canonicalPatchCounts(patchText, widgetEdit, diagnostics = null) {
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
    let hunkCount = 0, previousEnd = 0, previousHunkStart = 0, previousTrailingContext = [], lineOffset = 0;
    while (cursor < lines.length && !/^--- a\//.test(lines[cursor])) {
      const rawHeader = lines[cursor] || "",
        header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(rawHeader),
        bareHeader = !header && /^@@[ \t]*$/.test(rawHeader);
      if (!header && !bareHeader) return "";
      let oldStart = header ? Number(header[1]) : null, newStart = header ? Number(header[2]) : null;
      if (header && (!Number.isSafeInteger(oldStart) || !Number.isSafeInteger(newStart))) return "";
      cursor++;
      let body = [];
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
      const tabRepairedBody = repairedNumberingTabBody(body,sourceLines,previousEnd,header && oldLines > 0 ? oldStart - 1 : null);
      if (tabRepairedBody) body = tabRepairedBody;
      const expectedEntries = body
        .map((line, bodyIndex) => ({ operation:line[0], content:line.slice(1), bodyIndex }))
        .filter(entry => entry.operation === " " || entry.operation === "-");
      let currentExpectedEntries = expectedEntries,
        expected = currentExpectedEntries.map(entry => entry.content);
      let locatedStart;
      if (expected.length) {
        const declaredStart = header && oldLines > 0 ? oldStart - 1 : null,
          overlap = hunkCount && declaredStart !== null && declaredStart >= previousHunkStart ? previousEnd - declaredStart : 0;
        if (overlap > 0) {
          const repeatedPrefix = body.slice(0,overlap),
            previousSuffix = previousTrailingContext.slice(-overlap),
            exactContextOverlap = repeatedPrefix.length === overlap
              && previousSuffix.length === overlap
              && repeatedPrefix.every((line,index) => line[0] === " " && line === previousSuffix[index]);
          if (!exactContextOverlap) {
            setPatchDiagnostic(diagnostics,"overlapping-hunk-context");
            return "";
          }
          body = body.slice(overlap);
          if (!body.length || !body.some(line => line[0] === "+" || line[0] === "-")) {
            setPatchDiagnostic(diagnostics,"overlapping-hunk-context");
            return "";
          }
          ({ oldLines, newLines } = patchBodyCounts(body));
          currentExpectedEntries = body
            .map((line, bodyIndex) => ({ operation:line[0], content:line.slice(1), bodyIndex }))
            .filter(entry => entry.operation === " " || entry.operation === "-");
          expected = currentExpectedEntries.map(entry => entry.content);
          locatedStart = expected.length ? uniqueSequenceStart(sourceLines,expected,previousEnd) : previousEnd;
          if (locatedStart !== previousEnd) {
            setPatchDiagnostic(diagnostics,"overlapping-hunk-context");
            return "";
          }
          oldStart = oldLines === 0 ? locatedStart : locatedStart + 1;
          newStart = locatedStart + lineOffset + (newLines === 0 ? 0 : 1);
        } else {
          const located = uniquelyLocatedPatchSequence(sourceLines, currentExpectedEntries, previousEnd, declaredStart);
          if (!located) return "";
          locatedStart = located.start;
          if (located.repaired) {
            currentExpectedEntries.forEach((entry, index) => {
              body[entry.bodyIndex] = `${entry.operation}${sourceLines[locatedStart + index]}`;
            });
          }
        }
        if (currentExpectedEntries.length && body.length) {
          currentExpectedEntries.forEach((entry, index) => {
            if (body[entry.bodyIndex].slice(1) === sourceLines[locatedStart + index]) return;
            body[entry.bodyIndex] = `${entry.operation}${sourceLines[locatedStart + index]}`;
          });
        }
      } else {
        if (bareHeader) return "";
        locatedStart = oldLines === 0 ? oldStart : oldStart - 1;
        const logicalEnd = sourceLines.at(-1) === "" ? sourceLines.length - 1 : sourceLines.length;
        // A context-free insertion is safe only at an unambiguous file edge.
        // Middle insertions must include surrounding source lines.
        if (locatedStart < previousEnd || locatedStart > logicalEnd || ![0,logicalEnd].includes(locatedStart)) {
          setPatchDiagnostic(diagnostics,"unanchored-insertion");
          return "";
        }
      }
      if (bareHeader) {
        oldStart = locatedStart + 1;
        newStart = oldStart + lineOffset;
      }
      output.push(`@@ -${oldStart},${oldLines} +${newStart},${newLines} @@${header?.[3] || ""}`, ...body);
      previousHunkStart = locatedStart;
      previousEnd = locatedStart + expected.length;
      previousTrailingContext = trailingContextLines(body);
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

function optionalManifestString(value) {
  return value === undefined || value === null ? null : typeof value === "string" ? value : false;
}

function parsedWidgetManifest(content, widgetEdit, diagnostics = null) {
  let manifest;
  try {
    manifest = JSON.parse(content);
  } catch {
    return null;
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)
    || manifest.tool !== widgetEdit.widgetType || manifest.pluginId !== widgetEdit.pluginId
    || typeof manifest.title !== "string" || !Number.isFinite(manifest.refreshSeconds)) return null;
  const commonKeys = ["tool","pluginId","title","refreshSeconds","diagramKind","sourceFormat"],
    typeKeys = widgetEdit.widgetType === "diagram_source"
      ? ["sourceFile"]
      : ["frameworkVersion","htmlFile","copyTextFile","copyLabel"],
    allowedKeys = new Set([...commonKeys,...typeKeys]),
    unsupportedKey = Object.keys(manifest).find(key => !allowedKeys.has(key));
  if (unsupportedKey !== undefined) {
    const safeKey = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(unsupportedKey) ? unsupportedKey : "";
    setPatchDiagnostic(diagnostics,safeKey ? `unsupported-manifest-field:${safeKey}` : "unsupported-manifest-field");
    return null;
  }
  for (const field of ["diagramKind","sourceFormat",...(widgetEdit.widgetType === "html_widget" ? ["frameworkVersion","copyLabel"] : [])]) {
    const value = optionalManifestString(manifest[field]);
    if (value === false) return null;
    manifest[field] = value;
  }
  if (widgetEdit.widgetType === "diagram_source") {
    if (manifest.sourceFile !== WIDGET_SOURCE_PATH) return null;
  } else if (manifest.htmlFile !== WIDGET_HTML_PATH
    || ![null,WIDGET_HTML_PATH,WIDGET_SOURCE_PATH].includes(manifest.copyTextFile ?? null)) return null;
  return manifest;
}

function restoredPatchFileContent(file, content) {
  if (file.originalEndsWithNewline || typeof content !== "string") return content;
  return content.replace(FINAL_NEWLINE,"");
}

function optionalCommandField(value) {
  return typeof value === "string" && value ? value : "";
}

function widgetCommandFromFiles(contents, widgetEdit, diagnostics = null) {
  const manifest = parsedWidgetManifest(contents.get(WIDGET_MANIFEST_PATH),widgetEdit,diagnostics);
  if (!manifest) return null;
  const diagramKind = optionalCommandField(manifest.diagramKind),
    sourceFormat = optionalCommandField(manifest.sourceFormat);
  if (widgetEdit.widgetType === "diagram_source") {
    return {
      tool:"diagram_source",
      pluginId:widgetEdit.pluginId,
      ...widgetEdit.box,
      title:manifest.title,
      refreshSeconds:0,
      sourceFormat,
      source:contents.get(WIDGET_SOURCE_PATH),
      ...(diagramKind ? { diagramKind } : {}),
    };
  }
  const frameworkVersion = optionalCommandField(manifest.frameworkVersion),
    copyLabel = optionalCommandField(manifest.copyLabel),
    copyTextFile = manifest.copyTextFile ?? null,
    distinctCopyText = copyTextFile === WIDGET_SOURCE_PATH ? contents.get(WIDGET_SOURCE_PATH) : "";
  if (copyTextFile === WIDGET_SOURCE_PATH && (widgetEdit.pluginId === "image-search" || typeof distinctCopyText !== "string" || !distinctCopyText.trim())) return null;
  return {
    tool:"html_widget",
    pluginId:widgetEdit.pluginId,
    ...widgetEdit.box,
    title:manifest.title,
    refreshSeconds:manifest.refreshSeconds,
    html:contents.get(WIDGET_HTML_PATH),
    ...(diagramKind ? { diagramKind } : {}),
    ...(sourceFormat ? { sourceFormat } : {}),
    ...(frameworkVersion ? { frameworkVersion } : {}),
    ...(copyTextFile === WIDGET_SOURCE_PATH ? { copyText:distinctCopyText,...(copyLabel ? { copyLabel } : {}) } : {}),
  };
}

function parsedWidgetPatch(command, widgetEdit, diagnostics = null) {
  if (!command || typeof command !== "object" || Array.isArray(command)
    || command.tool !== "widget_patch" || Object.keys(command).some(key => !["tool", "patch"].includes(key))) return null;
  const normalized = normalizedPatchText(command.patch, widgetEdit),
    submittedPatchText = coalescedPatchFileSections(normalized, widgetEdit),
    patchText = canonicalPatchCounts(submittedPatchText, widgetEdit, diagnostics);
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
  return hasChange && hunkCount <= MAX_WIDGET_PATCH_HUNKS && lineCount <= MAX_WIDGET_PATCH_LINES ? { patches, allowed } : null;
}

function commandFromWidgetPatch(command, widgetEdit, diagnostics = null) {
  const parsed = parsedWidgetPatch(command, widgetEdit, diagnostics);
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
  const originalContents = new Map(files.map(file => [file.path,file.originalContent])),
    finalContents = new Map(files.map(file => {
      const result = updated.has(file.path) ? updated.get(file.path) : file.content;
      return [file.path,restoredPatchFileContent(file,result)];
    })),
    originalCommand = widgetCommandFromFiles(originalContents,widgetEdit),
    updatedCommand = widgetCommandFromFiles(finalContents,widgetEdit,diagnostics);
  if (!originalCommand || !updatedCommand || JSON.stringify(updatedCommand) === JSON.stringify(originalCommand)) return null;
  return updatedCommand;
}

function resolveWidgetEditPatchCommands(commands, widgetEdit, diagnostics = null) {
  if (!widgetEdit) return commands;
  if (!Array.isArray(commands) || commands.length !== 1) {
    setPatchDiagnostic(diagnostics,"widget-patch-command-count");
    return [];
  }
  const command = commandFromWidgetPatch(commands[0], widgetEdit, diagnostics);
  if (!command) setPatchDiagnostic(diagnostics,"widget-patch-rejected");
  return command ? [command] : [];
}

module.exports = {
  MAX_WIDGET_PATCH_BYTES,
  commandFromWidgetPatch,
  resolveWidgetEditPatchCommands,
  widgetSourceMirrorsHtml,
  widgetPatchFileContent,
  widgetPatchContract,
  widgetPatchFiles,
};
