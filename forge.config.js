"use strict";

const path = require("node:path");
const pkg = require("./package.json");
const desktopTools = require("./tools/electron/package.json");

const ROOT = __dirname;
const ICON = path.join(ROOT, "build", "icons", "penecho");
const DESKTOP_TOOLS = path.join(ROOT, "tools", "electron");
const ELECTRON_VERSION = desktopTools.devDependencies.electron;
const desktopModule = name => {
  try {
    return require.resolve(name, { paths:[DESKTOP_TOOLS] });
  } catch (error) {
    if (error && error.code === "MODULE_NOT_FOUND") {
      throw new Error(`Desktop build dependencies are missing. Run "npm run desktop:deps" before packaging. (${name})`);
    }
    throw error;
  }
};
const appleApiNotarization = process.env.APPLE_API_KEY_PATH && process.env.APPLE_API_KEY_ID && process.env.APPLE_API_ISSUER ? {
  appleApiKey:process.env.APPLE_API_KEY_PATH,
  appleApiKeyId:process.env.APPLE_API_KEY_ID,
  appleApiIssuer:process.env.APPLE_API_ISSUER,
} : null, appleIdNotarization = process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID ? {
  appleId:process.env.APPLE_ID,
  appleIdPassword:process.env.APPLE_APP_SPECIFIC_PASSWORD,
  teamId:process.env.APPLE_TEAM_ID,
} : null, appleNotarization = process.env.MAC_CODESIGN_IDENTITY && (appleApiNotarization || appleIdNotarization),
  hasWindowsCertificate = Boolean(process.env.WINDOWS_CERTIFICATE_FILE && process.env.WINDOWS_CERTIFICATE_PASSWORD),
  macEntitlements = path.join(ROOT, "build", "entitlements.mac.plist");
const windowsSigning = hasWindowsCertificate ? {
  certificateFile:process.env.WINDOWS_CERTIFICATE_FILE,
  certificatePassword:process.env.WINDOWS_CERTIFICATE_PASSWORD,
  timestampServer:process.env.WINDOWS_TIMESTAMP_SERVER || "http://timestamp.digicert.com",
  hashes:["sha256"],
  description:"PenEcho",
  website:"https://github.com/penecho/penecho",
} : null;
const macSigning = process.env.MAC_CODESIGN_IDENTITY ? {
  identity:process.env.MAC_CODESIGN_IDENTITY,
  optionsForFile:() => ({
    hardenedRuntime:true,
    entitlements:macEntitlements,
  }),
} : {
  // Sign the complete bundle even when Developer ID credentials are unavailable.
  // Electron's linker signature only covers its main executable and Gatekeeper
  // rejects the resulting quarantined app as damaged.
  identity:"-",
  identityValidation:false,
  optionsForFile:() => ({
    hardenedRuntime:false,
    entitlements:macEntitlements,
  }),
  preAutoEntitlements:false,
  preEmbedProvisioningProfile:false,
};

module.exports = {
  packagerConfig: {
    name:"PenEcho",
    executableName:"PenEcho",
    icon:ICON,
    asar:{ unpack:"**/node_modules/{sharp,@img}/**/*" },
    prune:true,
    appBundleId:"app.penecho.desktop",
    appCategoryType:"public.app-category.productivity",
    appCopyright:`Copyright © ${new Date().getFullYear()} PenEcho contributors`,
    extendInfo:{
      CFBundleDisplayName:"PenEcho",
      CFBundleName:"PenEcho",
      NSHumanReadableCopyright:`Copyright © ${new Date().getFullYear()} PenEcho contributors`,
    },
    osxSign:macSigning,
    ...(appleNotarization ? {
      osxNotarize:appleNotarization,
    } : {}),
    ...(windowsSigning ? {
      windowsSign:windowsSigning,
    } : {}),
    ignore:[
      /^\/\.git(?:\/|$)/,
      /^\/\.github(?:\/|$)/,
      /^\/tools(?:\/|$)/,
      /^\/out(?:\/|$)/,
      /^\/release(?:\/|$)/,
      /^\/coverage(?:\/|$)/,
      /^\/test-results(?:\/|$)/,
      /^\/playwright-report(?:\/|$)/,
      /^\/public\/plugins\/private(?:\/|$)/,
    ],
  },
  rebuildConfig:{ force:true },
  hooks:{
    readPackageJson:(_forgeConfig, packageJson) => ({
      ...packageJson,
      devDependencies:{ ...packageJson.devDependencies, electron:ELECTRON_VERSION },
    }),
  },
  makers:[
    {
      name:desktopModule("@electron-forge/maker-dmg"),
      platforms:["darwin"],
      config:{
        name:`PenEcho-${pkg.version}`,
        title:"PenEcho",
        icon:`${ICON}.icns`,
        overwrite:true,
      },
    },
    {
      name:desktopModule("@electron-forge/maker-zip"),
      platforms:["darwin"],
      config:{},
    },
    {
      name:desktopModule("@electron-forge/maker-squirrel"),
      platforms:["win32"],
      config:{
        name:"penecho",
        authors:"PenEcho contributors",
        description:pkg.description,
        exe:"PenEcho.exe",
        setupExe:`PenEcho-Setup-${pkg.version}-win-x64.exe`,
        setupIcon:`${ICON}.ico`,
        loadingGif:path.join(ROOT, "build", "icons", "penecho-install.gif"),
        // Avoid invoking rcedit through Wine during cross-platform builds.
        // The installed app and Setup.exe still use the PenEcho icon.
        skipUpdateIcon:true,
        iconUrl:`https://github.com/penecho/penecho/releases/download/v${pkg.version}/penecho.ico`,
        noMsi:true,
        ...(windowsSigning ? { windowsSign:windowsSigning } : {}),
      },
    },
  ],
};
