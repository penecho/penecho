"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const MOBILE_ROOT = __dirname;
const APP_PACKAGE = require(path.join(ROOT, "package.json"));
const CAPACITOR_BIN = path.join(MOBILE_ROOT, "node_modules", ".bin", process.platform === "win32" ? "cap.cmd" : "cap");
const RELEASE_DIR = path.join(ROOT, "release", "mobile");
const ICON_SOURCE = path.join(ROOT, "build", "icons", "penecho-1024.png");

function fail(message) {
  console.error(`Mobile packaging error: ${message}`);
  process.exitCode = 1;
}

function run(command, args, cwd, env = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: "inherit",
    shell: process.platform === "win32" && command.endsWith(".cmd"),
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(command)} exited with status ${result.status}`);
}

function cap(...args) {
  if (!fs.existsSync(CAPACITOR_BIN)) throw new Error(`Mobile dependencies are missing. Run "npm run mobile:deps" first.`);
  run(CAPACITOR_BIN, args, MOBILE_ROOT);
}

function ensureDir(directory) {
  fs.mkdirSync(directory, { recursive:true });
}

function buildNumber(version) {
  const [major = 0, minor = 0, patch = 0] = String(version).split(".").map(value => Number.parseInt(value, 10) || 0);
  return major * 10000 + minor * 100 + patch;
}

async function writePng(source, target, width, height = width) {
  let sharp;
  try { sharp = require("sharp"); }
  catch { throw new Error("The root sharp dependency is required to generate mobile icons."); }
  ensureDir(path.dirname(target));
  await sharp(source).resize(width, height, { fit:"contain", background:{ r:255, g:255, b:255, alpha:0 } }).png().toFile(target);
}

async function writeSplash(target) {
  const sharp = require("sharp");
  const metadata = await sharp(target).metadata();
  const width = metadata.width || 2732;
  const height = metadata.height || 2732;
  const logoSize = Math.max(96, Math.round(Math.min(width, height) * 0.28));
  const logo = await sharp(ICON_SOURCE).resize(logoSize, logoSize, { fit:"contain" }).png().toBuffer();
  const temporary = `${target}.penecho.png`;
  await sharp({
    create:{ width, height, channels:4, background:{ r:16, g:24, b:39, alpha:1 } },
  }).composite([{ input:logo, gravity:"center" }]).png().toFile(temporary);
  fs.renameSync(temporary, target);
}

function filesBelow(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes:true }).flatMap(entry => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(target) : [target];
  });
}

async function generateAndroidIcons() {
  const sizes = { mdpi:48, hdpi:72, xhdpi:96, xxhdpi:144, xxxhdpi:192 };
  for (const [density, size] of Object.entries(sizes)) {
    const directory = path.join(MOBILE_ROOT, "android", "app", "src", "main", "res", `mipmap-${density}`);
    await writePng(ICON_SOURCE, path.join(directory, "ic_launcher.png"), size);
    await writePng(ICON_SOURCE, path.join(directory, "ic_launcher_round.png"), size);
    await writePng(ICON_SOURCE, path.join(directory, "ic_launcher_foreground.png"), size);
  }
  const adaptiveDirectory = path.join(MOBILE_ROOT, "android", "app", "src", "main", "res", "mipmap-anydpi-v26");
  const adaptiveXml = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">',
    '  <background android:drawable="@color/ic_launcher_background" />',
    '  <foreground android:drawable="@mipmap/ic_launcher_foreground" />',
    '</adaptive-icon>',
    "",
  ].join("\n");
  ensureDir(adaptiveDirectory);
  for (const name of ["ic_launcher.xml", "ic_launcher_round.xml"]) {
    fs.writeFileSync(path.join(adaptiveDirectory, name), adaptiveXml);
  }
  const resources = path.join(MOBILE_ROOT, "android", "app", "src", "main", "res");
  for (const splash of filesBelow(resources).filter(file => path.basename(file) === "splash.png")) {
    await writeSplash(splash);
  }
}

async function configureAndroidNetwork() {
  const { Builder, parseStringPromise } = require("xml2js");
  const manifestPath = path.join(MOBILE_ROOT, "android", "app", "src", "main", "AndroidManifest.xml");
  const manifest = await parseStringPromise(fs.readFileSync(manifestPath, "utf8"));
  manifest.manifest.application[0].$["android:usesCleartextTraffic"] = "true";
  fs.writeFileSync(manifestPath, new Builder().buildObject(manifest));
}

async function generateIosIcons() {
  const iconSet = path.join(MOBILE_ROOT, "ios", "App", "App", "Assets.xcassets", "AppIcon.appiconset");
  const contentsPath = path.join(iconSet, "Contents.json");
  if (!fs.existsSync(contentsPath)) throw new Error(`Capacitor did not create ${contentsPath}`);
  const contents = JSON.parse(fs.readFileSync(contentsPath, "utf8"));
  for (const image of contents.images || []) {
    if (!image.filename || !image.size) continue;
    const width = Number.parseFloat(image.size.split("x")[0]);
    const scale = Number.parseInt(String(image.scale || "1x"), 10);
    if (Number.isFinite(width) && Number.isFinite(scale)) {
      await writePng(ICON_SOURCE, path.join(iconSet, image.filename), Math.round(width * scale));
    }
  }
  const splashSet = path.join(MOBILE_ROOT, "ios", "App", "App", "Assets.xcassets", "Splash.imageset");
  for (const splash of filesBelow(splashSet).filter(file => path.extname(file).toLowerCase() === ".png")) {
    await writeSplash(splash);
  }
}

function configureIosNetwork() {
  const plist = require("plist");
  const plistPath = path.join(MOBILE_ROOT, "ios", "App", "App", "Info.plist");
  const info = plist.parse(fs.readFileSync(plistPath, "utf8"));
  info.NSAppTransportSecurity = {
    ...info.NSAppTransportSecurity,
    NSAllowsArbitraryLoadsInWebContent:true,
    NSAllowsLocalNetworking:true,
  };
  info.NSLocalNetworkUsageDescription = "Connect to a PenEcho server on your local network.";
  info.ITSAppUsesNonExemptEncryption = false;
  fs.writeFileSync(plistPath, plist.build(info));
}

function ensurePlatform(platform) {
  fs.copyFileSync(ICON_SOURCE, path.join(MOBILE_ROOT, "web", "penecho-mark.png"));
  const directory = path.join(MOBILE_ROOT, platform);
  if (!fs.existsSync(directory)) cap("add", platform);
  cap("sync", platform);
  return directory;
}

function copyArtifact(source, extension, suffix) {
  if (!fs.existsSync(source)) throw new Error(`Expected build artifact was not found: ${source}`);
  ensureDir(RELEASE_DIR);
  const target = path.join(RELEASE_DIR, `PenEcho-${APP_PACKAGE.version}-${suffix}.${extension}`);
  fs.copyFileSync(source, target);
  console.log(target);
}

function iosBuildNumber() {
  const explicit = Number.parseInt(process.env.IOS_BUILD_NUMBER || process.env.GITHUB_RUN_NUMBER || "", 10);
  return Number.isSafeInteger(explicit) && explicit > 0 ? explicit : buildNumber(APP_PACKAGE.version);
}

function iosSigning() {
  const teamId = String(process.env.APPLE_TEAM_ID || "").trim();
  const profile = String(process.env.IOS_PROVISIONING_PROFILE_SPECIFIER || "").trim();
  const identity = String(process.env.IOS_SIGNING_IDENTITY || "Apple Distribution").trim();
  const requested = Boolean(teamId || profile || process.env.IOS_SIGNING_IDENTITY);
  if (requested && (!teamId || !profile || !identity)) {
    throw new Error("Signed iOS builds require APPLE_TEAM_ID, IOS_PROVISIONING_PROFILE_SPECIFIER, and IOS_SIGNING_IDENTITY.");
  }
  return requested ? { teamId, profile, identity } : null;
}

async function buildAndroid() {
  const androidRoot = ensurePlatform("android");
  await generateAndroidIcons();
  await configureAndroidNetwork();
  cap("sync", "android");
  const gradle = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
  const signed = Boolean(process.env.ANDROID_SIGNING_STORE_FILE);
  const task = signed ? "assembleRelease" : "assembleDebug";
  const args = [
    `app:${task}`,
    "--no-daemon",
    `-Pandroid.injected.version.name=${APP_PACKAGE.version}`,
    `-Pandroid.injected.version.code=${buildNumber(APP_PACKAGE.version)}`,
  ];
  if (signed) {
    args.push(
      `-Pandroid.injected.signing.store.file=${process.env.ANDROID_SIGNING_STORE_FILE}`,
      `-Pandroid.injected.signing.store.password=${process.env.ANDROID_SIGNING_STORE_PASSWORD || ""}`,
      `-Pandroid.injected.signing.key.alias=${process.env.ANDROID_SIGNING_KEY_ALIAS || ""}`,
      `-Pandroid.injected.signing.key.password=${process.env.ANDROID_SIGNING_KEY_PASSWORD || ""}`,
    );
  }
  run(gradle, args, androidRoot);
  copyArtifact(
    path.join(androidRoot, "app", "build", "outputs", "apk", signed ? "release" : "debug", `app-${signed ? "release" : "debug"}.apk`),
    "apk",
    signed ? "android" : "android-debug",
  );
}

async function buildIos() {
  const iosRoot = ensurePlatform("ios");
  await generateIosIcons();
  configureIosNetwork();
  cap("sync", "ios");
  const signing = iosSigning();
  const projectVersion = String(iosBuildNumber());
  const archiveRoot = path.join(RELEASE_DIR, "ios", "PenEcho.xcarchive");
  fs.rmSync(archiveRoot, { recursive:true, force:true });
  const archiveArgs = [
    "archive",
    "-workspace", path.join(iosRoot, "App", "App.xcworkspace"),
    "-scheme", "App",
    "-configuration", "Release",
    "-sdk", "iphoneos",
    "-archivePath", archiveRoot,
    `MARKETING_VERSION=${APP_PACKAGE.version}`,
    `CURRENT_PROJECT_VERSION=${projectVersion}`,
  ];
  if (signing) {
    archiveArgs.push(
      `DEVELOPMENT_TEAM=${signing.teamId}`,
      "CODE_SIGN_STYLE=Manual",
      `CODE_SIGN_IDENTITY=${signing.identity}`,
      `PROVISIONING_PROFILE_SPECIFIER=${signing.profile}`,
    );
  } else {
    archiveArgs.push("CODE_SIGNING_ALLOWED=NO", "CODE_SIGNING_REQUIRED=NO", "CODE_SIGN_IDENTITY=");
  }
  run("xcodebuild", archiveArgs, MOBILE_ROOT);

  if (signing) {
    const exportRoot = path.join(RELEASE_DIR, "ios", "export");
    const exportOptionsPath = path.join(RELEASE_DIR, "ios", "ExportOptions.plist");
    fs.rmSync(exportRoot, { recursive:true, force:true });
    ensureDir(exportRoot);
    fs.writeFileSync(exportOptionsPath, require("plist").build({
      method:"app-store-connect",
      destination:"export",
      signingStyle:"manual",
      signingCertificate:signing.identity,
      teamID:signing.teamId,
      provisioningProfiles:{ "ai.penecho.mobile":signing.profile },
      manageAppVersionAndBuildNumber:false,
      stripSwiftSymbols:true,
      uploadSymbols:true,
    }));
    run("xcodebuild", [
      "-exportArchive",
      "-archivePath", archiveRoot,
      "-exportPath", exportRoot,
      "-exportOptionsPlist", exportOptionsPath,
    ], MOBILE_ROOT);
    const exported = filesBelow(exportRoot).find(file => path.extname(file).toLowerCase() === ".ipa");
    if (!exported) throw new Error("Xcode export succeeded without producing an IPA.");
    copyArtifact(exported, "ipa", "ios");
    return;
  }

  const appPath = path.join(archiveRoot, "Products", "Applications", "App.app");
  const payloadRoot = path.join(RELEASE_DIR, "ios", "Payload");
  fs.rmSync(payloadRoot, { recursive:true, force:true });
  ensureDir(payloadRoot);
  fs.cpSync(appPath, path.join(payloadRoot, "PenEcho.app"), { recursive:true });
  const ipa = path.join(RELEASE_DIR, `PenEcho-${APP_PACKAGE.version}-ios-unsigned.ipa`);
  fs.rmSync(ipa, { force:true });
  run("/usr/bin/ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", "Payload", ipa], path.join(RELEASE_DIR, "ios"));
  console.log(ipa);
}

const target = process.argv[2];
if (!["android", "ios"].includes(target)) {
  fail(`usage: node ${path.relative(ROOT, __filename)} <android|ios>`);
} else {
  (target === "android" ? buildAndroid() : buildIos()).catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
