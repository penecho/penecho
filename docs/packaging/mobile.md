# PenEcho mobile packaging

PenEcho currently ships a Capacitor connection client. Android continues to use that client. The iOS v1 release target is a separate standalone runtime and must not be submitted to TestFlight until that runtime is complete.

## iOS v1 runtime contract

- The iPhone or iPad runs the Canvas without a separately deployed PenEcho Node.js service, CLI provider, desktop computer, or linked device.
- The user configures an OpenAI- or Anthropic-compatible API connection in the app. The API key belongs in iOS Keychain and native networking adds it to the exact configured provider request; it must never be returned to WebView JavaScript or stored in localStorage.
- Cloud sign-in uses `ASWebAuthenticationSession` with the registered `ai.penecho.mobile://cloud-sign-in` callback. The resulting restricted Cloud token also belongs in Keychain.
- A signed-in iOS app can read and synchronize Cloud Projects and Canvases and can read, add, and remove private or community Favorites without a linked desktop device.
- The Cloud website keeps its existing linked-device requirement for opening an editable remote Canvas. Native iOS account access must not weaken that web gate.
- Apple Pencil is handled as a `pointerType === "pen"` input with pressure-sensitive width. Finger touch remains navigation. This behavior already exists in the shared Canvas input contract and does not require a mobile-only fork.

## Build isolation

The 071 repository remains the source of Canvas assets. A mobile build may copy those assets into a disposable staging directory, but it must never write generated mobile files back to `public/` or to PenEcho Cloud's `public/canvas/` mirror. Mobile adapters, native code, credentials, and generated Xcode files stay under `tools/mobile`, ignored staging directories, or `release/mobile`.

## Current connection-client runtime

1. Start PenEcho on a computer or HTTPS server that the phone can reach.
2. For private LAN use, start the service with LAN listening enabled and open the port in the host firewall.
3. Open the mobile app and enter the complete PenEcho address, for example `http://192.168.1.20:3888`.
4. The WebView navigates to that address. The canvas and every `/api/*` request then share the server origin and use the existing PenEcho security checks.

The app remembers the last address in local WebView storage. It does not store the server's API key. HTTP is enabled so private LAN servers work, but an internet-facing PenEcho service must use HTTPS.

## Local builds

The mobile toolchain requires Node.js 22.12 or newer. Android additionally requires JDK 21 and Android SDK 35. iOS requires macOS, Xcode 16 or newer, and CocoaPods.

```bash
npm ci
npm run mobile:deps

# Produces release/mobile/PenEcho-<version>-android-debug.apk by default.
npm run mobile:apk

# Produces release/mobile/PenEcho-<version>-ios-unsigned.ipa.
npm run mobile:ipa
```

Capacitor generates `tools/mobile/android` and `tools/mobile/ios` during the build. Both directories are disposable and ignored by Git. The committed connection page lives under `tools/mobile/web`; mobile icons are generated from `build/icons/penecho-1024.png`.

## Android signing

The default APK uses Android's debug signature and can be installed for testing. A signed release APK is produced when these environment variables are present:

- `ANDROID_SIGNING_STORE_FILE`
- `ANDROID_SIGNING_STORE_PASSWORD`
- `ANDROID_SIGNING_KEY_ALIAS`
- `ANDROID_SIGNING_KEY_PASSWORD`

The manual GitHub Actions workflow restores the keystore from `ANDROID_KEYSTORE_BASE64` and forwards the other three values from repository secrets. Without those secrets it uploads the debug APK.

## iOS signing

Without signing variables, `npm run mobile:ipa` still produces an unsigned archive check. With the following variables it performs a manual App Store distribution archive and `xcodebuild -exportArchive`, producing `release/mobile/PenEcho-<version>-ios.ipa`:

- `APPLE_TEAM_ID`
- `IOS_SIGNING_IDENTITY` (normally `Apple Distribution`)
- `IOS_PROVISIONING_PROFILE_SPECIFIER`
- `IOS_BUILD_NUMBER` (GitHub Actions uses its monotonically increasing run number)

The certificate and profile themselves are installed by CI and are never committed.

## GitHub Actions

`.github/workflows/desktop-release.yml` builds and uploads the `penecho-android` artifact alongside the desktop artifacts on manual runs and version tags. A tag build includes the APK in the draft GitHub Release.

`.github/workflows/ios-release.yml` is intentionally separate from the desktop workflow. Every `v*` tag automatically builds and uploads a signed `penecho-ios` workflow artifact. Configure the `ios-signing` GitHub Environment with:

- `IOS_DISTRIBUTION_CERTIFICATE_P12_BASE64`
- `IOS_DISTRIBUTION_CERTIFICATE_PASSWORD`
- `IOS_PROVISIONING_PROFILE_BASE64`
- `IOS_SIGNING_IDENTITY` (optional when `Apple Distribution` is correct)
- `APPLE_TEAM_ID`
- `APPLE_API_KEY_P8_BASE64`
- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER`

TestFlight upload is an explicit `workflow_dispatch` option. This keeps tag builds automatic while preventing an unfinished or unaccepted iOS runtime from being submitted automatically. After App Store Connect finishes processing the uploaded build, complete export-compliance, privacy, TestFlight review, and App Review metadata in App Store Connect. Apple review and release cannot be replaced by GitHub Actions.
