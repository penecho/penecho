# Agent latest Widget viewport regression — 2026-09-19

## Evidence and cause

The user's visible Canvas was read and captured through PenEcho MCP only. No
computer-use/browser automation was used. The three Widgets belong to the same
internal PenEcho Agent binding. The latest Widget (`widget-3`) extends from
y=8291 to y=14328; the viewport ended at approximately y=11345. The original
viewport screenshot is `original-viewport.webp`, with geometry and source
metadata in `initial-evidence.json`.

Runtime attention inspection reported `paused:true`, `blockedBy:null`. The
shared attention queue retained a global pause after pointer/wheel input and
Canvas switching. It did not reset when a new delivery batch or first-party
Agent turn began. A paused previous turn could therefore suppress new output.

External MCP has an additional Navigator follow path. The two external MCP
baseline Widgets successfully followed even before the fix; that result is
not evidence that the old internal Agent attention path worked. Do not call
this baseline a reproduction of the internal Agent failure.

## Change

- A new visible delivery batch resets stale pause state; pending work on a
  different Canvas cannot suppress the destination's new output.
- A fresh, non-replayed Agent turn retires its older pending attention and
  renews following. Starting a turn does not move the camera by itself.
- The existing queue retains newest-result selection, Canvas zoom, quiet
  presentation semantics and the active interaction guards.
- Navigation during a pending batch still pauses that batch. Explicit Show
  can resume it. No additional timer or scheduler was introduced.

## Verification and delivery

Both new behavioral regressions failed on the previous implementation and
passed after the change. The focused Agent/document/MCP suite passed 232 tests;
Navigator and MCP settings regressions passed 77 tests. The client build check,
syntax check and changed-file whitespace check passed.

Canonical source is `/Users/heack/workspace/penecho_071_version`, branch
`codex/update-localization`. The generated app was synced through Cloud's
official `sync-public-canvas.mjs --only=app.js`; both public and Agent runtime
mirror checks passed. The existing UAT received a successful static deployment.
The served local UAT app matched the formal build exactly:

`52778ab9e18fe8a793c48fbc6f954adf546eb4d2a989cddcfbe00dbe21aa3729`

The actual UAT public mount is the Cloud project's `.local-uat-runtime/public`.
The post-deploy planner reports no runtime differences. Files are locally
modified and deployed to UAT; no commit, push or production deployment was made.

The new acceptance Canvas is `Agent 最新 Widget 视口验收 · 0919`, document
`doc-b357c82f335e174c58bd432f9526f1de654e410fa3be7fad3946c7fa54eb46a1`.
Final first-party Agent browser acceptance awaits the user's refresh and two
Widget run. MCP cannot submit an internal Agent turn or refresh the user's
browser; external MCP follow is verified separately, not substituted for it.
