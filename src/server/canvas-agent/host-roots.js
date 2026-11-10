"use strict";

function windowsDriveRoots(platform = process.platform) {
  if (platform !== "win32") return [];
  return Array.from({ length:26 }, (_, index) => {
    const letter = String.fromCharCode(65 + index);
    return { name:`${letter}:`, path:`${letter}:\\`, guardPrivate:true };
  });
}

function macosRemoteRoots(homeDirectory, platform = process.platform) {
  if (platform !== "darwin") return [];
  const home = String(homeDirectory || "").trim();
  return [
    ...(home ? [{ name:"Home", path:home, guardPrivate:true, requireChild:true }] : []),
    { name:"External volumes", path:"/Volumes", guardPrivate:true, requireChild:true },
  ];
}

module.exports = { macosRemoteRoots, windowsDriveRoots };
