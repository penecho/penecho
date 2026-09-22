# PenEcho Cloud plugin

Create diagrams and interactive previews with your AI assistant, annotate the result, and revise the same editable Canvas.

## Connect

1. Install and enable the plugin in your client. The package contains both MCP configuration and the Canvas skill.
2. Complete the client's PenEcho authorization once: **Continue as guest** or sign in. OAuth configures and stores credentials automatically. No pairing code or second API-key step.
3. Ask for a diagram or interactive preview. The assistant opens a browser draft and connects to that exact Canvas. Keep its browser open during MCP operations.

New canvases remain browser drafts until you explicitly save them to Cloud. Guests can edit and render using an external AI through MCP; Cloud saving and the built-in PenEcho Agent require an account. Signing in preserves the draft. Clearing browser storage removes local drafts.

The endpoint is `https://penecho.ai/mcp` (Streamable HTTP, OAuth authorization code + PKCE S256, dynamic client registration). MCP canvas operations consume no PenEcho model credits. Your external assistant's model charges are separate.

## Clients

- **Codex / OpenAI and Cursor:** their manifests use `.mcp.json` and native remote OAuth. No local PenEcho runtime or proxy is needed.
- **Hermes plugin package:** root `plugin.json`, `mcp.json` and `skills/` form a portable Agent Plugins v1 package. Current Hermes translates portable HTTP entries without OAuth settings, so the portable package uses the fixed `mcp-remote@0.1.38` compatibility bridge. It needs Node.js 20+ and `npx`; the bridge handles browser OAuth and keeps credentials in its private `~/.mcp-auth` store. It does not install or launch the PenEcho desktop app. There are no secrets in package files.
- **Hermes native MCP catalog:** `hermes/optional-mcps/penecho/manifest.yaml` uses Hermes' built-in HTTP OAuth, without the bridge. This path includes server tools/instructions. The portable package additionally includes the Canvas skill. Choose one MCP connection path to avoid duplicate tools.

The installed client controls authorization prompts and browser placement. A side browser is preferred where supported; elsewhere the agent opens an external browser or supplies the Canvas link. MCP alone cannot force a host to open a sidebar. This release renders in the automatically opened browser, not in a headless Cloud renderer.

## Try it

- “Draw this project's architecture on a PenEcho canvas.”
- “Build an interactive preview comparing these two plans.”
- “Read my handwritten feedback and revise this diagram.”

Each conversation uses a stable sessionKey and workspaceId. Opening another conversation does not redirect existing sessions. Anonymous connection leases renew while a browser stays connected and expire 24 hours after disconnection; cleanup does not delete local drafts. Normal repeated opening reuses the workspace and does not spend the new-workspace allowance. Anonymous creation limits offer retry/sign-in and do not revoke existing work.

A guest credential always stays guest-scoped, including after its browser logs in. To authorize account-wide MCP access, reconnect the plugin and authorize the account. Account personal access tokens remain unchanged until explicit invalidation/reset. Advanced manual token setup is available through the client's secure credential settings; never paste tokens into chat or commit them to a repository.

## Distribution

See [RELEASE-CHECKLIST.md](RELEASE-CHECKLIST.md) for deploy checks, marketplace files, submission steps and review cases. Files in this repository do not mean a marketplace has approved the listing. Historical submission attempts remain in [SUBMISSION.md](SUBMISSION.md).

[Website](https://penecho.ai) · [Privacy](https://penecho.ai/privacy.html) · [Terms](https://penecho.ai/terms.html) · [Support](https://penecho.ai/contact.html)

Plugin configuration, workflow instructions and documentation use MIT (see LICENSE). PenEcho application licensing and trademark restrictions remain separate. The compatibility bridge is separately maintained and MIT licensed: [mcp-remote](https://github.com/punkpeye/mcp-remote).
