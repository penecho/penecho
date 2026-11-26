param(
    [string]$SetupPath = 'C:\PenEchoTestInput\Setup.exe',
    [string]$OutputDirectory = 'C:\PenEchoTestOutput'
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
New-Item -ItemType Directory -Force $OutputDirectory | Out-Null
$report = [ordered]@{ startedAt=[DateTime]::UtcNow.ToString('o'); machine=$env:COMPUTERNAME; user=$env:USERNAME; passed=$false }
$main = $null
try {
    # This script installs software. Refuse to run in the owner's host profile.
    if ($env:USERNAME -ne 'WDAGUtilityAccount' -or $env:COMPUTERNAME -eq 'DESKTOP-L25PJSB') {
        throw 'This installer acceptance check must run only inside Windows Sandbox.'
    }
    $installRoot = Join-Path $env:LOCALAPPDATA 'penecho'
    if (Test-Path $installRoot) { throw 'The sandbox must have no previous PenEcho installation.' }
    $report.setupSha256 = (Get-FileHash $SetupPath -Algorithm SHA256).Hash.ToLowerInvariant()
    Add-Type -AssemblyName System.Drawing
    Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class PenEchoInstallerWindow {
 public delegate bool EnumProc(IntPtr h, IntPtr l);
 [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc callback, IntPtr l);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
 [DllImport("user32.dll")] public static extern bool IsHungAppWindow(IntPtr h);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder text, int size);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out Rect rect);
 public struct Rect { public int Left,Top,Right,Bottom; }
}
'@
    function Get-PenEchoWindow([int]$ProcessId) {
        $found = New-Object System.Collections.Generic.List[object]
        $callback = [PenEchoInstallerWindow+EnumProc]{param($handle,$unused)
            [uint32]$owner=0
            [void][PenEchoInstallerWindow]::GetWindowThreadProcessId($handle,[ref]$owner)
            if ($owner -eq $ProcessId) {
                $title=New-Object Text.StringBuilder 1024
                [void][PenEchoInstallerWindow]::GetWindowText($handle,$title,1024)
                if ($title.ToString() -like '*PenEcho*') {
                    $rect=New-Object PenEchoInstallerWindow+Rect
                    [void][PenEchoInstallerWindow]::GetWindowRect($handle,[ref]$rect)
                    if (($rect.Right-$rect.Left) -lt 800 -or ($rect.Bottom-$rect.Top) -lt 600) { return $true }
                    $found.Add([pscustomobject]@{handle=$handle.ToInt64();title=$title.ToString();visible=[PenEchoInstallerWindow]::IsWindowVisible($handle);minimized=[PenEchoInstallerWindow]::IsIconic($handle);hung=[PenEchoInstallerWindow]::IsHungAppWindow($handle);left=$rect.Left;top=$rect.Top;width=($rect.Right-$rect.Left);height=($rect.Bottom-$rect.Top)})
                }
            }
            return $true
        }
        [void][PenEchoInstallerWindow]::EnumWindows($callback,[IntPtr]::Zero)
        return $found | Select-Object -First 1
    }
    # The observer is ready before Setup. Do not start/reveal PenEcho ourselves.
    $start = [DateTime]::UtcNow
    $setup = Start-Process -FilePath $SetupPath -PassThru
    $report.setupPid = $setup.Id
    $samples = New-Object System.Collections.Generic.List[object]
    $firstSeen = $null; $visibleSince = $null; $window = $null
    while (([DateTime]::UtcNow - $start).TotalSeconds -lt 150) {
        $main = Get-CimInstance Win32_Process -Filter "Name='PenEcho.exe'" | Where-Object {
            $_.ExecutablePath -like "$installRoot\app-*\PenEcho.exe" -and $_.CommandLine -notmatch '--type=' -and $_.CommandLine -match '--squirrel-firstrun'
        } | Select-Object -First 1
        if ($main) {
            if (-not $firstSeen) { $firstSeen = [DateTime]::UtcNow }
            $window = Get-PenEchoWindow $main.ProcessId
            if ($window) {
                $samples.Add([pscustomobject]@{elapsedMs=[int]([DateTime]::UtcNow-$start).TotalMilliseconds;pid=$main.ProcessId;visible=$window.visible;minimized=$window.minimized;hung=$window.hung})
                if ($window.visible -and -not $window.minimized -and -not $window.hung) {
                    if (-not $visibleSince) { $visibleSince=[DateTime]::UtcNow }
                    if (([DateTime]::UtcNow-$visibleSince).TotalSeconds -ge 3) { break }
                } else { $visibleSince=$null }
            }
            if (([DateTime]::UtcNow-$firstSeen).TotalSeconds -gt 35) { break }
        }
        Start-Sleep -Milliseconds 250
    }
    $report.samples = @($samples.ToArray())
    if ($main) {
        $report.application = @{pid=$main.ProcessId;parentPid=$main.ParentProcessId;path=$main.ExecutablePath;commandLine=$main.CommandLine;createdAt=$main.CreationDate.ToUniversalTime().ToString('o')}
        $report.asarSha256 = (Get-FileHash (Join-Path (Split-Path $main.ExecutablePath) 'resources\app.asar')).Hash.ToLowerInvariant()
    }
    $report.window=$window
    if (-not $visibleSince -or -not $window -or -not $window.visible -or $window.minimized -or $window.hung) {
        throw 'Setup did not automatically produce a visible, nonminimized, responsive PenEcho window.'
    }
    $report.visibleAfterMs=[int]($visibleSince-$start).TotalMilliseconds
    $http = Invoke-WebRequest 'http://127.0.0.1:3888/' -UseBasicParsing -TimeoutSec 10
    $report.httpStatus=$http.StatusCode
    if ($http.StatusCode -ne 200) { throw 'The installed local application did not respond successfully.' }
    $bitmap=New-Object Drawing.Bitmap $window.width,$window.height
    $graphics=[Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.CopyFromScreen($window.left,$window.top,0,0,$bitmap.Size)
        $bitmap.Save((Join-Path $OutputDirectory 'installer-first-window.png'),[Drawing.Imaging.ImageFormat]::Png)
    } finally { $graphics.Dispose(); $bitmap.Dispose() }
    $report.passed=$true
} catch {
    $report.error=$_.Exception.Message
} finally {
    $startupLog=Join-Path $env:APPDATA 'PenEcho\logs\desktop-startup.log'
    if (Test-Path $startupLog) { Copy-Item $startupLog (Join-Path $OutputDirectory 'desktop-startup.log') }
    $report.finishedAt=[DateTime]::UtcNow.ToString('o')
    $report | ConvertTo-Json -Depth 7 | Set-Content (Join-Path $OutputDirectory 'installer-report.json') -Encoding UTF8
    # Only the disposable guest may be shut down; never run this on the host.
    if ($env:USERNAME -eq 'WDAGUtilityAccount' -and $env:COMPUTERNAME -ne 'DESKTOP-L25PJSB') {
        shutdown.exe /s /t 3 | Out-Null
    }
}
if (-not $report.passed) { exit 1 }
