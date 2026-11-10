# PenEcho 1.1.4 official Codex directory submission packet

Prepared 2026-10-10 from canonical `penecho_071_version` source. This is a local submission candidate, not evidence of an upload, review submission, approval, publication, or a deployed runtime change. Version 1.1.4 adds persistent agent installation and activation checks; it has not been uploaded.

## Package and listing

Upload `penecho-cloud-plugin.zip`, rebuilt with `python3 scripts/package-penecho-cloud.py`. It contains the root portable `plugin.json`, native `mcp.json`, `.codex-plugin/plugin.json`, logo, and canonical Canvas Skill. The standalone `penecho-canvas.zip` remains a separate Skill distribution.

The root portable manifest has no `extensions.com.openai`. Under the current [OpenAI submission rules](https://developers.openai.com/plugins/deploy/submission), OpenAI therefore reads listing, review, and publication settings from the Codex overlay. Package identity still comes from root `plugin.json`, skills from `skills/`, and MCP servers from root `mcp.json`. Do not add a partial root `com.openai` object: it would replace the overlay settings rather than merge them.

- Name: PenEcho
- Publisher: PenEcho (the portal uses the selected verified developer identity)
- Subtitle: Draw and revise on a canvas
- Category: Productivity
- Endpoint: https://penecho.ai/mcp
- Website: https://penecho.ai
- Privacy: https://penecho.ai/privacy.html
- Terms: https://penecho.ai/terms.html
- Support: https://penecho.ai/contact.html
- Source: https://github.com/penecho/penecho
- Packaged icon and logo: `assets/logo.png`

The overlay's long description explains guest browser editing, handwritten revision, account sign-in for Cloud saving or PenEcho's own AI, keeping the browser open, and unsaved drafts' dependence on the original browser profile's local storage. Release notes are packaged under `extensions.com.openai.publication.release_notes`.

## Authentication import and reviewer access

The main package keeps standard native Streamable HTTP configuration and endpoint OAuth discovery. OAuth uses dynamic client registration, resource `https://penecho.ai/mcp`, and scope `canvas:access`. Do not bundle static credentials or server auth extensions. An earlier actual Codex loader rejected server-level extensions and dropped the MCP entry; see the release checklist for its version and evidence boundary.

The current portal describes advanced authentication settings as imported from `mcp.json`, rather than an editable portal setting. Inspect the actual imported app's authentication and OAuth discovery before submission; this packet does not establish that those portal settings are configured or accepted. If the portal cannot represent the discovered OAuth configuration, record its concrete validation error before changing the compatible native package.

Guest OAuth should support the guest diagram cases. For any account features or revoked-grant case, use a dedicated reviewer account and client with only synthetic data. Enter reviewer access, account/login details, and any required private instructions in the secure portal form. Credentials and `reviewer_instructions` must never appear in the ZIP. Required reviewer access must work without a manual MFA, email, SMS, or private-network step. Do not use an owner's account or revoke an unrelated production grant.

## Review scenarios and remaining evidence

The overlay contains exactly five positive and three negative scenarios under `extensions.com.openai.review.test_cases`. These are planned cases with expected outcomes, not recorded passes. Tool names were checked against canonical Canvas schemas and the Cloud workspace schema; live tool discovery and execution are still required for review evidence.

| Kind | Scenario | Required setup / observation |
| --- | --- | --- |
| Positive 1 | Guest architecture diagram | Complete guest OAuth; open one draft; bind its ready document; draw client/API/database shapes. |
| Positive 2 | Revision retaining artifacts | Rename the existing label using its current revision; preserve document identity and unrelated content. |
| Positive 3 | Interactive preview | Exercise the plan selector and observe totals changing locally; inspect Widget source. |
| Positive 4 | Handwritten feedback | Draw synthetic circle/replacement text, then inspect visual evidence and revise the existing object. |
| Positive 5 | Refresh/reconnect/new-tab takeover | Retain the same browser profile and storage; repeat each stage, preserve artifacts, and continue only after the latest page binds. |
| Negative 1 | Another user's unshared document | Synthetic separate reviewer accounts; unauthorized content cannot be read, copied, or changed. |
| Negative 2 | Revoked access | Revoke only a dedicated review grant; old access must fail without automatic replacement authorization. |
| Negative 3 | Unsupported payment | Decline the transfer request without payment credentials, invented tools, or Canvas mutation. |

Initial MCP review also requires a reviewer-accessible video walkthrough URL demonstrating the workflow and test cases. No recording URL is available in this packet, so `demo_recording_url` is deliberately omitted. Supply a real accessible recording through the portal or a later package update; never use a placeholder URL.

Before requesting review, run the cases with the dedicated review setup, record actual results and host/version, inspect imported OAuth, provide the recording URL and required secure reviewer access, and confirm the portal's developer/domain and listing requirements. Packaging tests verify submission metadata and unchanged distribution boundaries; they do not prove these workflows passed or that OpenAI accepted the package.

## Local 1.1.4 installation-package evidence (2026-10-10)

The canonical package now includes `INSTALL.md`, the complete-Skill persistent installer and native exact-path Codex activation checks. `node --test test/penecho-cloud-skill-setup.test.mjs test/penecho-cloud-skill-install.test.mjs` passed 29 tests. `python3 test/penecho-distribution.test.py -v` passed 9 tests, including deterministic allowlist packaging, canonical archive contents, preserved native transport/overlay metadata, and byte-equivalent `.plugin` output while retaining the three-archive build API.

Claude Code 2.1.296 strict validation passed for the plugin and root marketplace. The plugin validator advised a marketplace install line; remote installation is not the primary path while the root catalog remains unpublished. Skill Creator `quick_validate.py` passed using an existing Python environment with PyYAML; the system and bundled workspace Python lacked PyYAML. No dependencies, user Skills, MCP connections or credentials were installed by these package tests.

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `penecho-canvas.zip` | 13652 | `99f0a186d40ecb3460a1a7f379be896880ae83634d185013350cc0f365abcaff` |
| `penecho-cloud-plugin.zip` | 42675 | `6190987cfae76e909e9391336cad01fe64a2ffbe7eb62ece406ff28d71f627c9` |
| `penecho-cloud.plugin` | 42675 | `6190987cfae76e909e9391336cad01fe64a2ffbe7eb62ece406ff28d71f627c9` |
| `penecho-hermes-plugin.zip` | 33644 | `533a38be41aea102f0c4d97d6e86ded7edc35b44ae8f045499d592b1e95000b4` |

The primary model accepted the preceding 1.1.4 build through extracted-package tests using actual Codex Skill discovery/repeat installation and isolated Claude configuration/alias/repeat installation. The final documentation correction authenticates the exact reused connection name, including plugin-managed authorization, and regenerated artifacts passed all 9 packaging tests; runtime checks were not repeated for that documentation-only correction.

These results establish local installer behavior, metadata and archive integrity. They do not establish a fresh Windows Desktop installation, Claude Chat/Cowork account installation, native install-card behavior, current-conversation tool discovery, completed OAuth, publication, or a deployed runtime change. The following 1.1.3 hashes and portal history are retained as historical evidence, not relabeled as 1.1.4.

## Historical 1.1.3 packaging evidence (2026-10-10)

`python3 test/penecho-distribution.test.py -v` passed 8 tests, including canonical archive contents, native transport, metadata limits/assets, review-case schema, invalid-input rejection, and deterministic rebuild. Its builds use the official `scripts/package-penecho-cloud.py` implementation. The standalone Skill source and archive were unchanged by this submission preparation; Hermes compatibility output was also unchanged.

| File | SHA-256 before | SHA-256 after |
| --- | --- | --- |
| `skills/penecho-canvas/SKILL.md` | `c28c88f6f0aaf7b44cc32c5a9c35613a1135dc6e280f4d4c3931c81d9e1298c1` | `c28c88f6f0aaf7b44cc32c5a9c35613a1135dc6e280f4d4c3931c81d9e1298c1` |
| `penecho-canvas.zip` | `93a9f4a3f7c5603fc408234f5650ea33e60633a9f16c9bd2f4f97a2e2ff1f4d8` | `93a9f4a3f7c5603fc408234f5650ea33e60633a9f16c9bd2f4f97a2e2ff1f4d8` |
| `penecho-cloud-plugin.zip` | `2a2d00918c88406b210e25902e2890dd64016905becb6dd7aa112fcf055c9b1f` | `dd9bd6ff8b877b6eba8f0a6546b3ea4db1073647363524685de2d85fa7ed5b21` |
| `penecho-hermes-plugin.zip` | `d5ce9fb4844bfb77d742c315f8d7bf7068450dded12e871d601b93bf3a05e15e` | `d5ce9fb4844bfb77d742c315f8d7bf7068450dded12e871d601b93bf3a05e15e` |

## Submission status recorded during 1.1.3 (2026-10-10)

The authenticated Edge submission portal redirected Upload to organization verification because no verified developer identity was available. The user selected Business. Starting Business verification returned “Payment method required” and required a valid default payment method. Edge is now at Billing overview with Add payment details available; the user is handling billing. No ZIP upload, plugin draft, scan, review submission, approval, or publication has occurred.

Live public HTTP checks returned 200 for the homepage, support/contact page, privacy policy, terms, protected-resource OAuth discovery, and authorization-server discovery. Discovery advertises dynamic client registration, PKCE S256, and `canvas:access`. These checks establish public availability and discovery metadata, not imported portal authentication or a completed authenticated Canvas workflow.

The primary agent independently reran all 8 distribution tests, verified the main ZIP's 14 members and SHA-256 `dd9bd6ff8b877b6eba8f0a6546b3ea4db1073647363524685de2d85fa7ed5b21`, and confirmed the standalone Skill ZIP remained unchanged. This submission work made no runtime changes.

## Historical record: 1.0.0 (2026-09-16)

The following record describes an earlier account-required release. Its workflow, portal observations, marketplace statuses, and checks have not been re-verified as current. They are retained for provenance and do not override the current 1.1.4 packet above.

# Marketplace submission material

Prepared 2026-09-16. This file is a submission packet, not evidence of approval.

## Shared listing

- Name: PenEcho
- Publisher: PenEcho Inc
- Tagline: A shared visual workspace for AI agents
- Endpoint: https://penecho.ai/mcp
- Website: https://penecho.ai
- Privacy: https://penecho.ai/privacy.html
- Terms: https://penecho.ai/terms.html
- Support: support@penecho.ai
- Source: https://github.com/penecho/penecho
- Logo: https://raw.githubusercontent.com/penecho/penecho/main/integrations/penecho-cloud/assets/logo.png
- Category: Productivity / Developer tools / Design

Description:

PenEcho gives your AI assistant a shared visual workspace. Turn architecture discussions into diagrams, ideas into interactive previews, and explanations into visual material on an infinite canvas. Draw or write feedback directly beside the result, then ask your assistant to read it and revise the same work. Connect your PenEcho account, open a Canvas, and explicitly enable Cloud MCP before use. Keep the Canvas open while collaborating.

## Authentication and data access

Streamable HTTP with OAuth authorization code, PKCE S256, dynamic client registration and resource binding. Scope: `canvas:access`. MCP authorization accesses opted-in canvases belonging to the signed-in account. It does not provide general account-management access. Users can revoke client authorization in PenEcho MCP settings. Personal tokens are separately available but are not bundled or required by this plugin.

Discovery: `https://penecho.ai/.well-known/oauth-protected-resource/mcp`

Issuer metadata: `https://penecho.ai/.well-known/oauth-authorization-server/oauth/mcp`

Do not claim support for Client ID Metadata Documents until verified. Do not provide an owner's personal token as a marketplace-wide credential.

## Reviewer setup and cases

Use a dedicated reviewer account and a Canvas containing only synthetic material. Supply credentials through the marketplace's private review channel if required; never commit them here. A browser Canvas must remain connected with Cloud MCP enabled.

1. **Connection / discovery:** Authorize with OAuth; call `tools/list`, then `penecho_list_canvases`. Expected: available tools and only opted-in canvases. An empty list requires opening/enabling a Canvas, not a guessed ID.
2. **Architecture:** Ask “Create a client, API, and database architecture diagram on my PenEcho canvas.” Bind a stable session, load relevant guidance, create the diagram. Expected: visible labeled content in the selected Canvas and preserved document identity.
3. **Interactive preview:** Ask “Build an interactive preview comparing two project plans.” Expected: a working Widget with readable labels and controls, inspectable source, and a stable artifact ID.
4. **Handwritten feedback:** Circle a label and write a replacement on the test Canvas, then ask “Read my handwritten feedback and revise the diagram.” Expected: agent inspects relevant visual evidence, edits the existing artifact, and preserves unrelated content.
5. **Access boundary:** Disable MCP on the test Canvas or revoke the test client's grant. Expected: further unauthorized access is refused. Test with the dedicated account only.

These are acceptance cases to execute, not a claim that every marketplace client has passed them.

## Initial release notes

Initial cloud MCP submission. Includes OAuth connection to PenEcho Cloud and a Canvas workflow skill covering visual explanations, interactive previews, and revision from handwritten feedback. Requires a PenEcho account and an open, explicitly enabled Canvas. MCP operations consume no PenEcho credits; external assistant model charges are separate. No embedded marketplace UI or local desktop runtime is included.

## Submission state

- Claude: user reports the service cannot be accessed; remote submission remains pending.
- OpenAI: logged in, but Create plugin → With MCP requires verified developer identity before creating a draft. No draft or review submission exists from this task yet.
- Cursor: logged in and publisher form available. Public repository must contain the plugin files; final Submit Application also accepts Publisher Terms. Plugin materials use MIT with explicit owner authorization; logo/trademarks are excluded. The owner will merge the PR.
- Smithery: listing created at https://smithery.ai/servers/kongyang217/penecho-cloud; OAuth discovered, release scan waiting for account authorization. This is not a verified ready-to-install release.
- Official MCP Registry: search for PenEcho returned no entries. GitHub account has active administrator membership in `penecho`. Device login needs user authorization; server name is `io.github.penecho/cloud`.

## Verification evidence

Production checks on 2026-09-16: protected-resource and issuer metadata return HTTP 200; unauthenticated MCP initialize returns HTTP 401 with the correct `WWW-Authenticate` resource metadata. These checks verify discovery and rejection behavior, not the complete authenticated OAuth/Canvas loop.

Plugin manifest validated with the Plugin Creator validator. Registry metadata validated against the official 2025-12-11 JSON Schema. No application runtime files were modified or deployed by this work.
