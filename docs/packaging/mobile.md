# PenEcho mobile packaging

PenEcho mobile is a Capacitor client for Android and iOS. It connects to an existing PenEcho Node.js service instead of copying API keys, CLI providers, or Cloud device credentials into the phone.

## Runtime model

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

## Signing

The default APK uses Android's debug signature and can be installed for testing. A signed release APK is produced when these environment variables are present:

- `ANDROID_SIGNING_STORE_FILE`
- `ANDROID_SIGNING_STORE_PASSWORD`
- `ANDROID_SIGNING_KEY_ALIAS`
- `ANDROID_SIGNING_KEY_PASSWORD`

The manual GitHub Actions workflow restores the keystore from `ANDROID_KEYSTORE_BASE64` and forwards the other three values from repository secrets. Without those secrets it uploads the debug APK.

The default IPA is unsigned. It verifies the iOS device build and archive layout but cannot be installed on a physical device or submitted to App Store Connect. Distribution requires an Apple signing certificate, provisioning profile, and an explicit export method; those credentials are intentionally not embedded in the repository.

## GitHub Actions

`.github/workflows/desktop-release.yml` builds and uploads the `penecho-android` artifact alongside the desktop artifacts on manual runs and version tags. A tag build includes the APK in the draft GitHub Release.
