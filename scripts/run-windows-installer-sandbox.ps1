param(
    [Parameter(Mandatory=$true)][string]$SetupPath,
    [Parameter(Mandatory=$true)][string]$RunRoot,
    [string]$Observer = '',
    [ValidateSet('Limited','Highest')][string]$LauncherRunLevel = 'Limited',
    [ValidateRange(30,300)][int]$TimeoutSeconds = 240
)
$ErrorActionPreference='Stop'
if (-not $Observer) { $Observer=Join-Path $PSScriptRoot 'verify-windows-installer.ps1' }
$feature=Get-CimInstance Win32_OptionalFeature | Where-Object {$_.Name -eq 'Containers-DisposableClientVM'}
if ($feature.InstallState -ne 1) { throw 'Windows Sandbox is not enabled. This check will not enable it.' }
if (Get-Process WindowsSandbox,WindowsSandboxClient -ErrorAction SilentlyContinue) { throw 'A Windows Sandbox is already running; leave it untouched.' }
if (Test-Path $RunRoot) { throw 'Use a new, isolated test directory.' }
$inputDir=Join-Path $RunRoot 'input'; $outputDir=Join-Path $RunRoot 'output'
New-Item -ItemType Directory -Path $inputDir,$outputDir | Out-Null
Copy-Item $SetupPath (Join-Path $inputDir 'Setup.exe')
Copy-Item $Observer (Join-Path $inputDir 'verify-windows-installer.ps1')
$expected=(Get-FileHash $SetupPath).Hash.ToLowerInvariant()
if ((Get-FileHash (Join-Path $inputDir 'Setup.exe')).Hash.ToLowerInvariant() -ne $expected) { throw 'Staged installer checksum differs.' }
$hostBefore=@(Get-CimInstance Win32_Process -Filter "Name='PenEcho.exe'" | Select-Object ProcessId,CreationDate,ExecutablePath)
$config=Join-Path $RunRoot 'test.wsb'
@"
<Configuration>
  <Networking>Disable</Networking>
  <ClipboardRedirection>Disable</ClipboardRedirection>
  <AudioInput>Disable</AudioInput>
  <VideoInput>Disable</VideoInput>
  <PrinterRedirection>Disable</PrinterRedirection>
  <MemoryInMB>4096</MemoryInMB>
  <MappedFolders>
    <MappedFolder><HostFolder>$([Security.SecurityElement]::Escape($inputDir))</HostFolder><SandboxFolder>C:\PenEchoTestInput</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
    <MappedFolder><HostFolder>$([Security.SecurityElement]::Escape($outputDir))</HostFolder><SandboxFolder>C:\PenEchoTestOutput</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder>
  </MappedFolders>
  <LogonCommand><Command>powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\PenEchoTestInput\verify-windows-installer.ps1</Command></LogonCommand>
</Configuration>
"@ | Set-Content $config -Encoding UTF8
$task='PenEchoInstallerTest-'+[Guid]::NewGuid().ToString('N').Substring(0,12)
$action=New-ScheduledTaskAction -Execute 'C:\Windows\System32\WindowsSandbox.exe' -Argument ('"'+$config+'"')
$principal=New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel $LauncherRunLevel
$started=Get-Date
try {
    Register-ScheduledTask -TaskName $task -Action $action -Principal $principal | Out-Null
    Start-ScheduledTask -TaskName $task
    $reportFile=Join-Path $outputDir 'installer-report.json'
    while (-not (Test-Path $reportFile) -and ((Get-Date)-$started).TotalSeconds -lt $TimeoutSeconds) { Start-Sleep -Seconds 1 }
    if (-not (Test-Path $reportFile)) { throw "Windows Sandbox did not return installer evidence within $TimeoutSeconds seconds." }
    $report=Get-Content $reportFile -Raw | ConvertFrom-Json
    if ($report.setupSha256 -ne $expected) { throw 'Sandbox tested a different installer.' }
    $hostAfter=@(Get-CimInstance Win32_Process -Filter "Name='PenEcho.exe'" | Select-Object ProcessId,CreationDate,ExecutablePath)
    foreach ($original in $hostBefore) {
        if (-not ($hostAfter | Where-Object {$_.ProcessId -eq $original.ProcessId -and $_.CreationDate -eq $original.CreationDate})) {
            throw 'A pre-existing host PenEcho process changed during the isolated test.'
        }
    }
    @{hostProcessesPreserved=$true;setupSha256=$expected;before=$hostBefore;after=$hostAfter} | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $outputDir 'host-isolation.json') -Encoding UTF8
    $report | ConvertTo-Json -Depth 7
    if (-not $report.passed) { throw $report.error }
} finally {
    Unregister-ScheduledTask -TaskName $task -Confirm:$false -ErrorAction SilentlyContinue
    # No Sandbox existed at entry. Close only this test's subsequently launched
    # Sandbox UI if the guest failed to shut itself down after writing evidence.
    Get-Process WindowsSandboxClient,WindowsSandbox -ErrorAction SilentlyContinue | Where-Object {$_.StartTime -ge $started} | ForEach-Object {
        [void]$_.CloseMainWindow()
        if (-not $_.WaitForExit(10000)) { Stop-Process -Id $_.Id }
    }
}
