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
