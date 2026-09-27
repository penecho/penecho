param(
    [Parameter(Mandatory=$true)][string]$SourceRoot,
    [Parameter(Mandatory=$true)][string]$LatestMetadataFile
)
$ErrorActionPreference = 'Stop'
Set-Location $SourceRoot
$packageRoot = Join-Path $SourceRoot 'out\PenEcho-win32-x64'
$executable = Join-Path $packageRoot 'PenEcho.exe'
if (-not (Test-Path $executable)) { throw 'The packaged Windows executable is not ready.' }
function Run-Electron([string]$File, [string[]]$Arguments) {
    $quotedArguments = $Arguments | ForEach-Object { '"' + $_ + '"' }
    $process = Start-Process -FilePath $File -ArgumentList $quotedArguments -Wait -PassThru -NoNewWindow
    if ($process.ExitCode -ne 0) { throw "Electron verification failed: $($process.ExitCode)" }
}
$env:ELECTRON_RUN_AS_NODE = '1'
Run-Electron $executable @(
    (Join-Path $SourceRoot 'scripts\verify-desktop-package.cjs'),
    (Join-Path $packageRoot 'resources\app.asar'),
    (Join-Path $SourceRoot '.penecho-build-manifest.json'),
    (Join-Path $SourceRoot 'package-windows.json'),
    $LatestMetadataFile
)
Remove-Item Env:ELECTRON_RUN_AS_NODE
$renderOutput = Join-Path $SourceRoot 'docs\verification\windows-render'
Run-Electron (Join-Path $SourceRoot 'tools\electron\node_modules\electron\dist\electron.exe') @(
    (Join-Path $SourceRoot 'scripts\verify-desktop-update-render.cjs'), $renderOutput, $LatestMetadataFile
)
$profileRecord = Join-Path $renderOutput 'temporary-profile.txt'
if (Test-Path $profileRecord) {
    $temporaryProfile = (Get-Content $profileRecord -Raw).Trim()
    if ((Split-Path $temporaryProfile -Leaf) -like 'penecho-update-smoke-*') {
        Remove-Item -LiteralPath $temporaryProfile -Recurse -Force
        Remove-Item $profileRecord
    }
}
$menuOutput = Join-Path $SourceRoot 'docs\verification\windows-menu'
Run-Electron (Join-Path $SourceRoot 'tools\electron\node_modules\electron\dist\electron.exe') @(
    (Join-Path $SourceRoot 'scripts\verify-desktop-menu.cjs'), $menuOutput
)
$menuProfileRecord = Join-Path $menuOutput 'temporary-profile.txt'
if (Test-Path $menuProfileRecord) {
    $menuProfile = (Get-Content $menuProfileRecord -Raw).Trim()
    if ((Split-Path $menuProfile -Leaf) -like 'penecho-menu-test-*') {
        Remove-Item -LiteralPath $menuProfile -Recurse -Force
        Remove-Item $menuProfileRecord
    }
}
$setup = Get-ChildItem (Join-Path $SourceRoot 'release') -Filter '*Setup*.exe' | Select-Object -First 1
@{
    executableVersion=(Get-Item $executable).VersionInfo.ProductVersion
    executableSignature=(Get-AuthenticodeSignature $executable).Status.ToString()
    setupSignature=(Get-AuthenticodeSignature $setup.FullName).Status.ToString()
} | ConvertTo-Json | Set-Content (Join-Path $SourceRoot 'windows-signing.json') -Encoding utf8
