# PenEcho desktop packaging

This directory contains PenEcho's Electron packaging for macOS and Windows. It keeps the existing browser canvas and CLI while adding a native desktop shell.

End users do **not** need Node.js or Python. Electron bundles its own Chromium and Node.js runtime. API mode is the recommended beginner path. Codex CLI and Claude Code can also be installed from the setup page without opening a terminal.

## First launch

1. PenEcho opens the graphical setup page.
2. The user chooses API, Kimi, Codex CLI, or Claude CLI.
3. `Test, save & launch` validates the fields, stores any API key in a user-only local credential file, and tests the provider for up to 30 seconds. On macOS the key is compressed locally without accessing Keychain; Windows keeps Electron `safeStorage` and DPAPI encryption.
4. After a successful test, the app restarts and opens the local PenEcho canvas automatically. If the test fails or times out, the saved configuration can still be launched.
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
npm run desktop:deps
npm run check
npm run desktop
```

The Electron/Forge toolchain is isolated under `tools/electron`. A normal root `npm install` installs only the web/CLI application and icon generator; it does not install Electron or the macOS/Windows makers. Run `npm run desktop:deps` explicitly only on machines that develop or package the desktop app.

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

The website brand icon is applied to the app bundle, Dock/taskbar executable, DMG and Windows setup executable. Squirrel's generic green install animation is replaced with the generated PenEcho-branded `penecho-install.gif`, so first install and update never show an unfamiliar third-party splash.

## Signing and notarization

Unsigned builds are suitable only for local testing. Beginner-facing releases should always be signed.

The macOS jobs use the protected GitHub Environment named `macos-signing`. That environment requires approval from the repository owner and is restricted to `v*` tags. Its secret values are never stored in source or exposed to repository visitors.

Required `macos-signing` environment secrets:

- `MAC_CERTIFICATE_P12_BASE64`
- `MAC_CERTIFICATE_PASSWORD`
- `MAC_CODESIGN_IDENTITY`
- `APPLE_API_KEY_P8_BASE64`
- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER`

The workflow restores both credentials only inside the temporary GitHub-hosted runner. It signs the complete app with Developer ID, submits the app and DMG to Apple's notary service, staples the tickets, and verifies the result with `codesign`, Gatekeeper (`spctl`), and `stapler` before uploading artifacts. A missing credential fails the macOS jobs instead of silently producing an ad-hoc-signed release.

The Windows job uses the GitHub Environment named `windows-signing`. Until a signing identity is configured it deliberately produces an unsigned installer and writes a warning to the build log. Adding a complete signing configuration switches the same workflow to signed output; a partial configuration fails instead of silently falling back to unsigned output.

Preferred Azure Artifact Signing environment variables (no certificate private key is stored in GitHub):

- `AZURE_ARTIFACT_SIGNING_ENDPOINT`
- `AZURE_ARTIFACT_SIGNING_ACCOUNT_NAME`
- `AZURE_ARTIFACT_SIGNING_CERTIFICATE_PROFILE_NAME`
- `AZURE_CLIENT_ID`
- `AZURE_TENANT_ID`
- `AZURE_SUBSCRIPTION_ID`

Configure these as GitHub Environment variables after the public identity validation and certificate profile are complete. The Entra application or managed identity must trust the `windows-signing` GitHub Environment through OIDC and have the `Artifact Signing Certificate Profile Signer` role on the certificate profile. The workflow requests a short-lived GitHub OIDC token and uses Microsoft's `ArtifactSigning` PowerShell module; no Azure client secret or third-party GitHub Action is required. It signs the packaged application before Squirrel creates its package, then signs the final Setup executable and verifies both signatures. Enabling Azure signing later requires environment and Azure identity configuration only; it does not require another source change.

PFX-based Authenticode remains an optional fallback using `windows-signing` environment secrets:

- `WINDOWS_CERTIFICATE_PFX_BASE64`
- `WINDOWS_CERTIFICATE_PASSWORD`

The certificate must be a Windows-trusted code-signing certificate with its private key, not the Apple Developer ID certificate. Configure either Azure or PFX, never both. Signed modes use SHA-256 and a trusted timestamp, and the workflow verifies that both `PenEcho.exe` and `PenEcho-Setup-*.exe` have valid timestamped Authenticode signatures before artifacts are uploaded.

The update download progress is shown only inside the PenEcho window. It is intentionally never mirrored onto the Windows taskbar icon.

Never commit certificates or credentials.

## GitHub Releases

Keep source, icon masters, Forge configuration and the workflow in the source branch. Do not commit DMG/EXE/ZIP files to Git. Release binaries belong in a version-specific GitHub Release such as `v0.9.0`.

The workflow can be run manually for private testing. When triggered by a `v*` tag, it creates a **draft** GitHub Release and uploads the installers. Test every installer before publishing the draft.

Packaged apps check for updates shortly after launch and every six hours. `Help -> Check for Updates…` also provides a manual check. PenEcho reads the latest published release directly from the public GitHub Releases API, shows the release notes, and waits for the user to approve the download.

Only published GitHub Releases are offered. Drafts and prereleases are not installed as normal updates. The updater accepts only the exact asset name for the current platform and architecture, only downloads it from the `penecho/penecho` GitHub Release path over HTTPS, and checks GitHub's SHA-256 digest when it is available.

Local unsigned builds can still exercise the update flow during development:

- macOS downloads the matching ZIP, validates its PenEcho bundle ID and version, then replaces the installed `.app` after the running process exits. PenEcho must be installed in a user-writable location.
- Windows downloads the matching Squirrel Setup executable and starts its silent installed-app upgrade path. Squirrel install/update events update the shortcut and exit without opening the canvas.

These paths intentionally do not invoke Electron's native `autoUpdater`, because macOS Squirrel requires a valid Apple code signature even when both releases are intentionally unsigned. Signing and notarization can still be added later without changing the release asset contract.

Recommended public assets:

- `PenEcho-0.9.0-mac-arm64.dmg`
- `PenEcho-0.9.0-mac-x64.dmg`
- `PenEcho-0.9.0-mac-arm64.zip`
- `PenEcho-0.9.0-mac-x64.zip`
- `PenEcho-Setup-0.9.0-win-x64.exe`
- `RELEASES`
- `penecho-0.9.0-full.nupkg`
- `SHA256SUMS-<platform>-<arch>.txt`

The DMG and Setup executable are the visible installers. PenEcho uses the macOS ZIP and Windows Setup executable for in-app updates, so those assets must remain attached when the draft is published. `RELEASES` and `.nupkg` remain useful Squirrel release artifacts but are not downloaded by PenEcho's unsigned update path.
