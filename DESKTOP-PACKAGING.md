# PenEcho desktop packaging

This directory is a self-contained desktop-packaging snapshot of PenEcho 0.7.1. It keeps the existing browser canvas and CLI while adding an Electron shell for macOS and Windows.

End users do **not** need Node.js or Python. Electron bundles its own Chromium and Node.js runtime. API mode is the recommended beginner path. Codex CLI and Claude Code can also be installed from the setup page without opening a terminal.

## First launch

1. PenEcho opens the graphical setup page.
2. The user chooses API, Kimi, Codex CLI, or Claude CLI.
3. `Test, save & launch` validates the fields, encrypts any API key through Electron `safeStorage`, and tests the provider.
4. After a successful test, the app restarts and opens the local PenEcho canvas automatically.
5. Later launches open the canvas directly. `Settings…` remains available from the application menu.

Codex CLI and Claude Code selections include `Install & sign in`. PenEcho downloads only the providers' official installer scripts, validates the response, installs without administrator access, opens the official browser login, and then resumes the connection test. This path does not require npm or a separately installed Node.js runtime.

The Kimi partner preset supports Kimi Code and Kimi Open Platform, Global and Mainland China access, OpenAI-compatible defaults, and editable endpoints. Kimi Code defaults to model `k3` and also exposes its Anthropic-compatible endpoint. Kimi Open Platform defaults to model `kimi-k3`. The setup page uses the same partner links already published in the project README.

Desktop state is stored in the operating system's normal application-data directory:

- macOS: `~/Library/Application Support/PenEcho`
- Windows: `%APPDATA%\PenEcho`

The desktop service defaults to `127.0.0.1`. LAN listening is available only through Advanced settings. Personal plugins are stored under the application-data directory instead of inside the installed application bundle.

## Local development and packaging

Packaging requires Node.js 22.12 or newer on the build machine only.

```bash
npm ci
npm run check
npm run desktop
```

Create platform-native distributables:

```bash
# Run on macOS
npm run desktop:make:mac -- --arch=arm64

# Run on Windows
npm run desktop:make:windows -- --arch=x64

npm run desktop:collect
```

Forge writes raw output under `out/`. `desktop:collect` copies distributable files into `release/` and generates `SHA256SUMS-<platform>-<arch>.txt`.

Windows installers cannot be created reliably on this Mac without Wine/Mono and Windows-native signing tools. Use the included `desktop-release.yml` workflow or run the Windows command on Windows. The workflow builds macOS arm64/x64 and Windows x64 independently so `sharp` receives the correct native binary.

## Icons

The icon master is the same `public/penecho-mark.png` used by the website. Generate all platform assets with:

```bash
npm run icons
```

Generated production assets:

- `build/icons/penecho-1024.png`
- `build/icons/penecho.png`
- `build/icons/penecho.icns`
- `build/icons/penecho.ico`

The website brand icon is applied to the app bundle, Dock/taskbar executable, DMG and Windows setup executable.

## Signing and notarization

Unsigned builds are suitable only for local testing. Beginner-facing releases should always be signed.

macOS workflow secrets:

- `MAC_CERTIFICATE_P12_BASE64`
- `MAC_CERTIFICATE_PASSWORD`
- `MAC_CODESIGN_IDENTITY`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`

Windows workflow secrets for a PFX-based signing service:

- `WINDOWS_CERTIFICATE_PFX_BASE64`
- `WINDOWS_CERTIFICATE_PASSWORD`

Azure Artifact Signing can replace the PFX path later if the publisher account is eligible. Never commit certificates or credentials.

## GitHub Releases

Keep source, icon masters, Forge configuration and the workflow in the source branch. Do not commit DMG/EXE/ZIP files to Git. Release binaries belong in a version-specific GitHub Release such as `v0.7.1`.

The workflow can be run manually for private testing. When triggered by a `v*` tag, it creates a **draft** GitHub Release and uploads the installers. Test every installer before publishing the draft.

Packaged apps check for updates shortly after launch and every six hours. `Help -> Check for Updates…` also provides a manual check. The feed is fixed to `penecho/penecho` through Electron's GitHub Releases update service:

```text
https://update.electronjs.org/penecho/penecho/<platform>-<arch>/<current-version>
```

Only published GitHub Releases are offered. Drafts and prereleases are not installed as normal updates. PenEcho downloads an available update in the background and asks before restarting to install it. macOS automatic replacement requires a consistently signed and notarized app; Windows automatic replacement requires the installed Squirrel build.

Recommended public assets:

- `PenEcho-0.7.1-mac-arm64.dmg`
- `PenEcho-0.7.1-mac-x64.dmg`
- `PenEcho-Setup-0.7.1-win-x64.exe`
- `SHA256SUMS-<platform>-<arch>.txt`

The existing npm update installer is intentionally not invoked by the Electron entry point. Desktop auto-update should be added separately only after signed release artifacts are stable.
