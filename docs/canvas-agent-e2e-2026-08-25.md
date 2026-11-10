# PenEcho Agent browser E2E — 2026-08-25

Scope: PenEcho Agent only. Legacy Canvas AI is explicitly excluded.

## Completed baseline flows

| Flow | Codex CLI | DeepSeek API | Claude CLI | Kimi CLI |
| --- | --- | --- | --- | --- |
| UK 14-day travel plan | Passed after contract fix | Passed; multi-tool rejection recovered | Passed | Passed |
| Transformer visual explainer | Passed | Passed; self-corrected clipped height | Passed; self-corrected clipped height | Passed |

## Additional attachment and tool matrix

| # | Connection | Input / capability | Expected evidence | Status |
| --- | --- | --- | --- | --- |
| 1 | Codex CLI | Transformer paper PDF | file read, page-aware visual summary | Passed — read multiple ranges, created and visually inspected a cited summary; trace `1787663398696-8504be61-f2e1-41c0-a554-dbb0ed8b5a36` |
| 2 | DeepSeek API | World Bank research report PDF | report findings, cited pages, chart | Passed — useful scaffold, four bounded patches, page citations, and whole/detail capture checks; trace `1787665255582-b84b55f0-d649-4140-8f5f-f8ddcd7fba05` |
| 3 | Codex CLI | Synthetic Excel workbook | anomaly, trends, segment comparison | Passed — cross-sheet/cell analysis identified the April anomaly and produced a no-overflow dashboard; trace `1787665815160-27bdf6c1-118b-4871-b4dd-e60032ecd66f` |
| 4 | Kimi CLI | Synthetic PowerPoint deck | decision, evidence, risks, gaps | Passed — separated fact, assumption, risk, and missing evidence and captured the result three times; trace `1787666009162-a441e81b-bc85-44c5-ac65-8ed6676617da` |
| 5 | Claude CLI | Synthetic Word postmortem | concise extraction and action table | Externally blocked before model execution — provider pre-authorization balance was `$0.404540`, below the required `$0.413814`; trace `1787666315872-63e11341-ec2b-40b8-ac15-fc282d4624cc` |
| 6 | DeepSeek API, Codex fallback | NASA Earth JPEG | visual description and evidence limits | Attachment admission passed. DeepSeek upstream hung and exposed the missing host deadline; fixed and re-tested as an automatic 29-second `TIMEOUT`. The same fixture completed with Codex as a six-zone evidence board; traces `1787666498435-42c2507f-b882-4eb5-9fdf-02583375a539`, `1787668664428-7f907c14-e8e0-4664-9b1f-10b17c93c5f2`, and `1787667785940-cdd2e9da-0ca2-4f57-8e28-96ef9ee6bde2` |
| 7 | Codex CLI | `research_search` | related-paper landscape | Passed — four searches, five relevant papers, and five browser-verified DOI/arXiv links; trace `1787667953294-0f662cff-a25c-4cc3-bb74-ed97ca13ce01` |
| 8 | Kimi CLI | `github_repository_search` | repository landscape | Passed — two searches and five repositories. A no-tool follow-up converted bare URLs to five browser-verified Markdown links using retained conversation/tool history; traces `1787668049643-6739fb6e-832a-40cf-9651-565a3654bb97` and `1787668169506-67c09894-f7d2-472b-9940-bd6538ff77ba` |
| 9 | DeepSeek API | stock symbol + market data tools | sourced market snapshot | Passed — strict sequential symbol lookup then market-data lookup, with an AAPL snapshot and 22 daily rows; trace `1787668232787-89567014-51f0-4e7d-9896-92c5f136bea1` |
| 10 | Codex CLI | `web_read` plus search fallback | current official-source comparison | Passed — recovered from an oversized W3C response and completed from official W3C and MDN pages; ten browser-verified links across three official URLs; trace `1787668303469-73f3cfba-a81b-4e8f-b01f-d87465fe25a9` |

Test fixtures are synthetic or public and contain no user/company/private identity or banking data.

## Observed cache usage

Provider metrics have different denominators and must not be combined into one percentage.

| Connection | Completed measured cases | Observed cache reuse |
| --- | ---: | ---: |
| Codex CLI | 5 | 627,456 cached input tokens / 866,638 input tokens = **72.40%** |
| DeepSeek API | 2 | 823,936 cache-read tokens / (823,936 cache-read + 53,125 new input) = **93.94%** |
| Kimi CLI | 2 | Not exposed by Kimi ACP 0.29.2; unobservable, not zero |
| Claude CLI | 0 completed | Blocked before token usage by upstream balance |

## Bugs and observations

- Fixed: Visual Explorer create contract did not clearly require `title` and finite geometry.
- Fixed: `canvas_read` did not explicitly distinguish a non-newline EOF from the JSON delimiter.
- Fixed: widget patch mismatches did not report the first exact differing character.
- Current P0 policy: each model step contains at most one tool call, so returned HTML/patch data has one unambiguous result boundary. More than one is rejected as a whole, corrective feedback is returned, and the turn continues. A long Widget expected to exceed about 3,000 output tokens or delay visible progress for close to a minute should appear progressively as a useful scaffold followed by bounded same-file patches; same-target patching has only a 20-attempt runaway guard and should normally stop earlier when progress becomes marginal.
- Fixed: Claude/Kimi usage callbacks were not wired through the PenEcho Agent CLI adapter.
- Fixed: Anthropic-style cache read/write tokens are separate from new input tokens and must not be subtracted from `input_tokens`.
- Fixed: a Claude CLI `API Error: 403` result was treated as malformed Harness JSON and triggered one wasteful repair call; it is now classified as `UPSTREAM_ERROR` immediately.
- Fixed P0: provider activity/heartbeat could keep a PenEcho Agent model step alive beyond its configured hard total limit. Harness now owns a host-level deadline, records one synthetic `TIMEOUT`, restores the UI to an input-ready state, cancels the underlying provider, and suppresses the later abort duplicate. A real DeepSeek image request with a 30-second total limit ended automatically in 29.031 seconds; trace `1787668664428-7f907c14-e8e0-4664-9b1f-10b17c93c5f2`.
- Verified recovery: an intentionally unsupported detail capture returned `DETAIL_TARGET_REQUIRED`; the model continued and completed instead of ending the user turn.
- Verified history continuity: Kimi produced corrected Markdown links in a later no-tool step from the existing Harness conversation and prior tool outputs.
- External: Tavily returns HTTP 432 for the saved account/key; DuckDuckGo fallback works.
- External: Kimi ACP 0.29.2 does not expose token usage in its prompt result or update notifications, so cache hits remain unobservable rather than zero.
- External: the configured Claude endpoint ran out of pre-authorization balance during a final step; completed steps proved cache usage collection works.
