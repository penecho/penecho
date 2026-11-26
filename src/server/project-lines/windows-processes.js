"use strict";
// Windows: the processes on this computer, and ending them, without waiting. PenEcho's window and its server share one thread there,
// so a program waited for freezes the window, and WMI (Win32_Process, tasklist, and taskkill with its tree) can take over 5 s to answer.
const path = require("node:path");
const { execFile, execFileSync, spawn } = require("node:child_process");

const shell = () => (process.env.SystemRoot ? path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe") : "powershell.exe");
// Asks Windows itself, one line per process: number|parent|processor ms|started ms|name and command line.
const SOURCE = String.raw`
using System;using System.Runtime.InteropServices;using System.Text;
public static class PenEchoProcesses {
[StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct Entry { public int size; public uint usage; public uint pid; public IntPtr heap; public uint module; public uint threads; public uint parent; public int priority; public uint flags; [MarshalAs(UnmanagedType.ByValTStr,SizeConst=260)] public string name; }
[DllImport("kernel32")] static extern IntPtr CreateToolhelp32Snapshot(uint flags,uint pid);
[DllImport("kernel32",CharSet=CharSet.Unicode)] static extern bool Process32FirstW(IntPtr h,ref Entry e);
[DllImport("kernel32",CharSet=CharSet.Unicode)] static extern bool Process32NextW(IntPtr h,ref Entry e);
[DllImport("kernel32")] static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
[DllImport("kernel32")] static extern bool CloseHandle(IntPtr h);
[DllImport("kernel32")] static extern bool GetProcessTimes(IntPtr h,out long created,out long ended,out long kernel,out long user);
[DllImport("ntdll")] static extern int NtQueryInformationProcess(IntPtr h,int what,IntPtr into,int size,out int needed);
static string Command(IntPtr h) {
 int n; NtQueryInformationProcess(h,60,IntPtr.Zero,0,out n); if(n<=0||n>1048576) return "";
 IntPtr b=Marshal.AllocHGlobal(n);
 try { if(NtQueryInformationProcess(h,60,b,n,out n)!=0) return ""; return Marshal.PtrToStringUni(Marshal.ReadIntPtr(b,IntPtr.Size),(ushort)Marshal.ReadInt16(b)/2); }
 catch { return ""; } finally { Marshal.FreeHGlobal(b); }
}
public static string List(uint only) {
 var all=new StringBuilder(); IntPtr s=CreateToolhelp32Snapshot(2,0); var e=new Entry(); e.size=Marshal.SizeOf(typeof(Entry));
 for(bool ok=Process32FirstW(s,ref e);ok;ok=Process32NextW(s,ref e)) {
  if(only!=0&&e.pid!=only) continue;
  long created=0,ended,kernel=0,user=0; string command=""; IntPtr h=OpenProcess(0x1000,false,e.pid);
  if(h!=IntPtr.Zero) { GetProcessTimes(h,out created,out ended,out kernel,out user); command=Command(h); CloseHandle(h); }
  all.Append(e.pid).Append('|').Append(e.parent).Append('|').Append((kernel+user)/10000).Append('|').Append(created>0?(created-116444736000000000L)/10000:0).Append('|').Append(e.name).Append(' ').Append(command.Replace('\n',' ').Replace('\r',' ')).Append('\n');
 }
 CloseHandle(s); return all.ToString();
}}`;
// The fallback is for a computer that will not compile a type (constrained PowerShell): slower, through WMI.
const script = (only = 0) => `$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
[Console]::OutputEncoding=New-Object Text.UTF8Encoding $false
try { Add-Type -TypeDefinition @'
${SOURCE}
'@
[Console]::Out.Write([PenEchoProcesses]::List(${only})) } catch {
Get-CimInstance Win32_Process${only ? ` -Filter "ProcessId=${only}"` : ""} | ForEach-Object { $t = if ($_.CreationDate) { [DateTimeOffset]::new($_.CreationDate).ToUnixTimeMilliseconds() } else { 0 }; "$($_.ProcessId)|$($_.ParentProcessId)|$([int64](([int64]$_.KernelModeTime + [int64]$_.UserModeTime) / 10000))|$t|$($_.Name) $(([string]$_.CommandLine) -replace '[\\r\\n]',' ')" } }`;
// The script goes in through stdin: it is longer than a command line may be.
const ARGS = ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-Command", "& ([ScriptBlock]::Create([Console]::In.ReadToEnd()))"];
const OPTIONS = { encoding:"utf8", maxBuffer:16 * 1024 * 1024, windowsHide:true };
function parse(text) {
  const rows = [];
  for (const line of String(text || "").split("\n")) {
    const [pid, ppid, cpu, startedAt, ...command] = line.trim().split("|");
    if (!/^\d+$/.test(pid) || !command.length) continue;
    rows.push({ pid:+pid, ppid:+ppid, cpu:+cpu || 0, startedAt:+startedAt || 0, command:command.join("|").trim() });
  }
  return rows;
}
// What a list just said of a process is taken for the process itself this long, so stopping a run asks once, not once for each of its processes.
const FRESH_MS = 3000;
let seen = { at:0, byPid:new Map() };
const asked = new Map();
function list() {
  return new Promise(resolve => {
    const child = execFile(shell(), ARGS, { ...OPTIONS, timeout:20000 }, (error, stdout) => {
      const rows = error ? [] : parse(stdout);
      if (!rows.length) return resolve(null);
      seen = { at:Date.now(), byPid:new Map(rows.map(row => [row.pid, row])) };
      resolve(rows.map(({ pid, ppid, cpu, startedAt }) => ({ pid, ppid, cpu, startedAt })));
    });
    child.stdin?.on("error", () => {});
    child.stdin?.end(script());
  });
}
// The name and command line of every process.
async function commands() {
  return await list() ? [...seen.byPid.values()].map(row => row.command) : null;
}
function meta(pid) {
  const now = Date.now();
  let row = now - seen.at < FRESH_MS ? seen.byPid.get(pid) : null;
  if (!row) {
    const known = asked.get(pid);
    if (known && now - known.at < FRESH_MS) row = known.row;
    else {
      try { row = parse(execFileSync(shell(), ARGS, { ...OPTIONS, input:script(pid), stdio:["pipe", "pipe", "ignore"], timeout:8000 })).find(r => r.pid === pid) || null; } catch { row = null; }
      for (const [id, old] of asked) if (now - old.at >= FRESH_MS) asked.delete(id);
      asked.set(pid, { at:Date.now(), row });
    }
  }
  return row ? { pid:row.pid, ppid:row.ppid, pgid:0, startedAt:row.startedAt, command:row.command } : null;
}
// Ends these processes and all they started. The answer comes once taskkill is done, for a caller who has to know.
function killWindowsTrees(pids) {
  const list = [...new Set(pids.map(Number))].filter(pid => Number.isInteger(pid) && pid > 0);
  if (!list.length) return Promise.resolve();
  return new Promise(resolve => {
    const timer = setTimeout(resolve, 20000);
    timer.unref?.();
    const done = () => { clearTimeout(timer); resolve(); };
    try {
      const child = spawn("taskkill.exe", ["/T", "/F", ...list.flatMap(pid => ["/PID", String(pid)])], { stdio:"ignore", windowsHide:true });
      child.on("error", done);
      child.on("exit", done);
      child.unref();
    } catch { done(); }
  });
}
module.exports = { list, commands, meta, killWindowsTrees, parse, script };
