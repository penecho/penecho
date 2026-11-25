# Harness integration baseline — 2026-11-04

The PenEcho Agent runtime uses the exact published DSH **0.2.1-rc.5** package
family, Cordis **4.0.5**, timer **1.1.7**, and Sharp **0.35.5**. The package
lockfile is the reproducible dependency graph. This is the official default
release channel at the review time; the newer `next` and `alpha` channels are
not part of this change.

## Compatibility boundaries

- Codex connections retain the native App Server owner. Other connections retain
  the Harness owner. No shell, Git graph tool, persistence plugin, profile UI,
  legacy-settings migration, or new autonomous capability is enabled.
- The loop requires an internal session-projection registry. Provider settings
  stay in memory using the upstream volatile-config protocol. Replacements are
  validated before publishing; agents and sessions are retained.
- System instructions, first-class tool-result messages, transient stream
  frames, and tool call identifiers are mapped to the existing PenEcho CLI and
  UI contracts. Private reasoning and tool argument deltas remain private.
- Historical loop-freeze and Anthropic replay patches are retired. Published
  bundles are hash-verified and generated only to expose internals to tests.
  Requested model aliases and resolved response identities remain separate.
- Both model paths retain the previous effective attachment normalization
  bounds: 2048 pixels per side, 4,194,304 pixels, and a 4,194,304-byte target.
  Source admission limits still apply before conversion. Valid single-frame
  PNGs can be canonicalized to 8-bit sRGB PNG without resizing, preserving
  transparency and orientation; clean PNGs pass through unchanged. Oversized
  and animated inputs remain subject to upstream normalization. Stored object
  paths are unchanged, and existing objects are not rewritten or migrated.
- Request image limits are converted from total-pixel policy into the explicit
  dimensions required by the updated attachment API. Only one Sharp version
  is installed so image transformations share one native library stack.

## Native project tool repairs

`grep` and `glob` resolve the packaged ripgrep executable lazily, independently
of whether the Harness host has been initialized. Packaged `app.asar.unpacked`
resolution is retained. Launch errors retain sanitized diagnostic codes.

The folder text reader accepts unknown extensionless names only after validating
the complete existing size-limited snapshot as UTF-8 without binary control
content. Git refs and reflogs therefore work as text. Recognized document and
binary formats, unsupported extensions, single-file attachment classification,
and canonical path confinement retain their existing handling.

Reading Git text metadata does not provide commit-graph traversal. Reliable
ahead/behind counts would require a separately scoped read-only Git capability.

## Verification

- `node scripts/build-harness-backports.cjs --check`
- `node --test test/canvas-agent*.test.js`
- `npm run check`
- Compare the shared source changes in root `main` and `claude/projects-v1`;
  preserve each checkout's unrelated manifest fields and pre-existing work.

Important regression files cover cold-process native search, extensionless
text and binary rejection, configuration updates without session disposal,
model/thinking replay, cancellation, compaction configuration, attachment
compatibility, image request limits, and existing document receipts/conflicts.
Local verification does not establish a running server reload, desktop package
acceptance, commit, push, or deployment.
