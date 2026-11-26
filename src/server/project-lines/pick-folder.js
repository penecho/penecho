"use strict";
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

// The system's own "Choose folder" dialog, opened by the PenEcho server for a
// page in a browser on the same computer, which cannot learn a folder's path
// itself. One dialog at a time; closing it is a cancel, not an error.

const WAIT_MS = 10 * 60 * 1000;
const quote = text => String(text).replace(/["\\]/g, "\\$&");
function commandFor(platform, prompt, env = process.env) {
  if (platform === "darwin") return ["osascript", ["-e", "activate", "-e", `POSIX path of (choose folder with prompt "${quote(prompt)}")`]];
  if (platform === "win32") {
    const root = env && Object.entries(env).find(([key, value]) => /^(?:systemroot|windir)$/i.test(key) && String(value || "").trim())?.[1];
    const shell = root ? path.win32.join(String(root).trim(), "System32", "WindowsPowerShell", "v1.0", "powershell.exe") : "powershell.exe";
    return [shell, ["-NoProfile", "-WindowStyle", "Hidden", "-STA", "-Command",
      // The path goes out as UTF-8 bytes: Console.Out would use the system's code page, and a Chinese name would not come back.
      `$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.Windows.Forms; $owner = New-Object System.Windows.Forms.Form -Property @{TopMost=$true; ShowInTaskbar=$false}; $dialog = New-Object System.Windows.Forms.FolderBrowserDialog; $dialog.Description = '${String(prompt).replace(/'/g, "''")}'; if ($dialog.ShowDialog($owner) -eq 'OK') { $bytes = [Text.Encoding]::UTF8.GetBytes($dialog.SelectedPath); $out = [Console]::OpenStandardOutput(); $out.Write($bytes, 0, $bytes.Length); $out.Flush() }`]];
  }
  return ["zenity", ["--file-selection", "--directory", `--title=${prompt}`]];
}
function createFolderPicker({ platform = process.platform, run = execFile, env = process.env } = {}) {
  let open = null;
  function pick({ prompt = "Choose a folder" } = {}) {
    if (open) return open;
    const [command, args] = commandFor(platform, prompt, env);
    open = new Promise(resolve => {
      run(command, args, { timeout:WAIT_MS, windowsHide:platform === "win32", maxBuffer:64 * 1024 }, (error, stdout) => {
        const windows = platform === "win32", paths = windows ? path.win32 : path.posix, raw = windows ? String(stdout || "") : String(stdout || "").trim();
        // A drive keeps its slash: "D:" alone is not an absolute path.
        const bare = raw.replace(windows ? /[\\/]+$/ : /\/+$/, ""), chosen = raw && bare.length < paths.parse(raw).root.length ? paths.parse(raw).root : bare;
        // On Windows a cancel ends well with nothing written, so anything else is a dialog that failed: the page shows the folders itself.
        const lost = windows && !error?.killed ? { unavailable:true } : { canceled:true };
        if (error && error.code === "ENOENT") resolve({ unavailable:true });
        else if (!chosen) resolve(error ? lost : { canceled:true });
        else if (!paths.isAbsolute(chosen)) resolve(lost);
        else { try { resolve(fs.statSync(chosen).isDirectory() ? { path:chosen } : lost); } catch { resolve(lost); } }
      });
    }).finally(() => { open = null; });
    return open;
  }
  return { pick };
}

module.exports = { createFolderPicker, commandFor };
