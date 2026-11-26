"use strict";
const fs = require("node:fs"), path = require("node:path"), { execFile } = require("node:child_process");
const isApp = file => { try { return /^workbuddy\.exe$/i.test(path.basename(file)) && fs.statSync(file).isFile(); } catch { return false; } };
// Read installation metadata only. Never run the Electron executable to ask its version.
const QUERY = String.raw`
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$candidates=@($env:WORKBUDDY_APP_PATH)
if($env:LOCALAPPDATA){$candidates+=Join-Path $env:LOCALAPPDATA 'Programs\WorkBuddy\WorkBuddy.exe'}
if($env:ProgramFiles){$candidates+=Join-Path $env:ProgramFiles 'WorkBuddy\WorkBuddy.exe'}
$programFilesX86=[Environment]::GetEnvironmentVariable('ProgramFiles(x86)')
if($programFilesX86){$candidates+=Join-Path $programFilesX86 'WorkBuddy\WorkBuddy.exe'}
$records=Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue
foreach($record in $records | Where-Object {$_.DisplayName -match '^WorkBuddy(?:\s|$)'}){
 if($record.InstallLocation){$candidates+=Join-Path $record.InstallLocation 'WorkBuddy.exe'}
 if($record.DisplayIcon){$candidates+=($record.DisplayIcon -replace ',\s*-?\d+$','').Trim('"')}
}
foreach($candidate in $candidates | Select-Object -Unique){
 if(!$candidate -or !(Test-Path -LiteralPath $candidate -PathType Leaf)){continue}
 $item=Get-Item -LiteralPath $candidate
 if($item.Name -ine 'WorkBuddy.exe'){continue}
 $info=$item.VersionInfo
 if($info.ProductName -and $info.ProductName -ine 'WorkBuddy'){continue}
 $version=[regex]::Match([string]$info.FileVersion,'\d+\.\d+\.\d+(?:\.\d+)?').Value
 @{path=$item.FullName;version=$version} | ConvertTo-Json -Compress
 break
}`;
// PowerShell takes seconds to answer, and the desktop app's window waits for whatever its server waits for. So it is asked in the background, now and then,
// and only when WorkBuddy is in none of its usual folders. Until it answers, WorkBuddy is taken as not here.
const ASK_MS = 10 * 60000;
let asked = { at:0, found:{} };
function ask(env, run) {
  asked.at = Date.now();
  const shell = env.SystemRoot ? path.join(env.SystemRoot,"System32","WindowsPowerShell","v1.0","powershell.exe") : "powershell.exe";
  run(shell,["-NoProfile","-NonInteractive","-EncodedCommand",Buffer.from(QUERY,"utf16le").toString("base64")],{env,encoding:"utf8",windowsHide:true,timeout:20000,maxBuffer:65536},(error, text) => {
    asked.found = {};
    if (error) return;
    try {
      const found = JSON.parse(String(text).replace(/^\uFEFF/,"").trim());
      if (isApp(found.path)) asked.found = {path:found.path,version:typeof found.version==="string" ? found.version : ""};
    } catch { /* It is not here. */ }
  });
}
function findWindowsWorkBuddy(env = process.env, run = execFile) {
  const candidates = [env.WORKBUDDY_APP_PATH, env.LOCALAPPDATA && path.join(env.LOCALAPPDATA,"Programs","WorkBuddy","WorkBuddy.exe"), env.ProgramFiles && path.join(env.ProgramFiles,"WorkBuddy","WorkBuddy.exe"), env["ProgramFiles(x86)"] && path.join(env["ProgramFiles(x86)"],"WorkBuddy","WorkBuddy.exe")].filter(Boolean);
  const file = candidates.find(isApp);
  if (file) return {path:file,version:""};
  if (Date.now() - asked.at >= ASK_MS) ask(env, run);
  return isApp(asked.found.path || "") ? asked.found : {};
}
module.exports = { findWindowsWorkBuddy };
