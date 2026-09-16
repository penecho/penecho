# PenEcho — A shared visual workspace for AI agents

Create an architecture diagram or interactive preview with your AI assistant, mark up the result by hand, and ask the assistant to revise it on the same Canvas.

## Connect

1. Sign in at https://penecho.ai and open a Canvas.
2. Enable **Settings → MCP → Cloud MCP**, or use **Open MCP Canvas** from the Dashboard MCP page. Keep the Canvas open in your browser.
3. Install this plugin in a supported client and complete PenEcho OAuth authorization.
4. Ask the assistant to list available PenEcho canvases, then create or revise content in the one you select.

The remote endpoint is `https://penecho.ai/mcp` (Streamable HTTP). OAuth uses authorization code with PKCE S256 and dynamic client registration. No shared API key is bundled. A PenEcho account is required. Canvas operations through MCP are free and use no PenEcho credits; your assistant's model provider may charge for model usage separately.

This plugin uses Cloud MCP. Local MCP is a separate option requiring the PenEcho desktop app or CLI and its generated client configuration; installing this cloud plugin does not start a local host. See the main repository's [MCP setup guide](../../docs/mcp-setup.md).

## Try it

- “Draw this project's architecture on my PenEcho canvas.”
- “Build an interactive preview of this idea in PenEcho.”
- “Read my handwritten feedback and revise the canvas.”

Only explicitly enabled, connected canvases are available. Authorization does not grant access to another account or general Dashboard administration. Review edits before relying on their content. Revoke a client from PenEcho's MCP settings when no longer needed.

## Distribution files

`.codex-plugin/plugin.json` and `.cursor-plugin/plugin.json` share the same `.mcp.json` and Canvas workflow skill. `server.json` describes the cloud service for the official MCP Registry under the verified GitHub organization namespace. These files alone do not mean any marketplace has approved or published the listing.

[Website](https://penecho.ai) · [Privacy](https://penecho.ai/privacy.html) · [Terms](https://penecho.ai/terms.html) · [Support](https://penecho.ai/contact.html)

The original plugin configuration, workflow skill, and documentation are licensed under MIT; see LICENSE. This does not change the PenEcho application license. The logo and trademarks are excluded from the MIT grant and remain subject to the main repository's trademark policy.
