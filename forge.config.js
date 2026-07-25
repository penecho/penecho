"use strict";

const path = require("node:path");
const pkg = require("./package.json");

const ROOT = __dirname;
const ICON = path.join(ROOT, "build", "icons", "penecho");
const hasAppleNotarization = Boolean(
  process.env.MAC_CODESIGN_IDENTITY && process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID,
), hasWindowsCertificate = Boolean(process.env.WINDOWS_CERTIFICATE_FILE && process.env.WINDOWS_CERTIFICATE_PASSWORD),
  macEntitlements = path.join(ROOT, "build", "entitlements.mac.plist");

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
    ...(process.env.MAC_CODESIGN_IDENTITY ? {
      osxSign:{
        identity:process.env.MAC_CODESIGN_IDENTITY,
        hardenedRuntime:true,
        entitlements:macEntitlements,
        "entitlements-inherit":macEntitlements,
      },
    } : {}),
    ...(hasAppleNotarization ? {
      osxNotarize:{
        tool:"notarytool",
        appleId:process.env.APPLE_ID,
        appleIdPassword:process.env.APPLE_APP_SPECIFIC_PASSWORD,
        teamId:process.env.APPLE_TEAM_ID,
      },
    } : {}),
    ...(hasWindowsCertificate ? {
      windowsSign:{
        signToolOptions:{
          certificateFile:process.env.WINDOWS_CERTIFICATE_FILE,
          certificatePassword:process.env.WINDOWS_CERTIFICATE_PASSWORD,
        },
      },
    } : {}),
    ignore:[
      /^\/\.git(?:\/|$)/,
      /^\/\.github(?:\/|$)/,
      /^\/out(?:\/|$)/,
      /^\/release(?:\/|$)/,
      /^\/coverage(?:\/|$)/,
      /^\/test-results(?:\/|$)/,
      /^\/playwright-report(?:\/|$)/,
      /^\/public\/plugins\/private(?:\/|$)/,
    ],
  },
  rebuildConfig:{ force:true },
  makers:[
    {
      name:"@electron-forge/maker-dmg",
      platforms:["darwin"],
      config:{
        name:`PenEcho-${pkg.version}`,
        title:"PenEcho",
        icon:`${ICON}.icns`,
        overwrite:true,
      },
    },
    {
      name:"@electron-forge/maker-zip",
      platforms:["darwin"],
      config:{},
    },
    {
      name:"@electron-forge/maker-squirrel",
      platforms:["win32"],
      config:{
        name:"penecho",
        authors:"PenEcho contributors",
        description:pkg.description,
        exe:"PenEcho.exe",
        setupExe:`PenEcho-Setup-${pkg.version}-win-x64.exe`,
        setupIcon:`${ICON}.ico`,
        // Avoid invoking rcedit through Wine during cross-platform builds.
        // The installed app and Setup.exe still use the PenEcho icon.
        skipUpdateIcon:true,
        iconUrl:`https://github.com/penecho/penecho/releases/download/v${pkg.version}/penecho.ico`,
        noMsi:true,
      },
    },
  ],
};
