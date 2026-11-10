param(
    [Parameter(Mandatory=$true)][string]$SourceRoot,
    [string]$DependencyRoot
)
$ErrorActionPreference = 'Stop'
Set-Location $SourceRoot
$env:npm_config_cache = 'C:\Users\msi\PenEchoBuild\cache\npm'
$env:ELECTRON_CACHE = 'C:\Users\msi\PenEchoBuild\cache\electron'
$env:PENECHO_TARGET_PLATFORM = 'win32'
$env:PENECHO_TARGET_ARCH = 'x64'
node --version
if ($DependencyRoot) {
    # Reuse only an already verified native Windows build with identical locks.
    foreach ($lock in @('package-lock.json', 'tools\electron\package-lock.json')) {
        if ((Get-FileHash (Join-Path $SourceRoot $lock)).Hash -ne (Get-FileHash (Join-Path $DependencyRoot $lock)).Hash) {
            throw "Dependency lock differs: $lock"
        }
    }
    foreach ($relative in @('node_modules', 'tools\electron\node_modules')) {
        $from = Join-Path $DependencyRoot $relative
        $to = Join-Path $SourceRoot $relative
        if (-not (Test-Path $from) -or (Test-Path $to)) { throw "Expected existing source and new dependency destination: $relative" }
        robocopy $from $to /E /R:1 /W:1 /NFL /NDL /NJH /NJS | Out-Null
        if ($LASTEXITCODE -gt 7) { throw "Dependency copy failed: $relative" }
    }
} else {
    npm.cmd ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'Root dependency installation failed.' }
    npm.cmd run desktop:deps -- --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'Electron dependency installation failed.' }
}
# Electron 43 downloads its runtime explicitly rather than in npm postinstall.
node tools/electron/node_modules/electron/install.js
if ($LASTEXITCODE -ne 0) { throw 'Electron test runtime preparation failed.' }
npm.cmd run check:client
if ($LASTEXITCODE -ne 0) { throw 'Generated client check failed.' }
npm.cmd run desktop:make:windows -- --arch=x64
if ($LASTEXITCODE -ne 0) { throw 'Windows packaging failed.' }
npm.cmd run desktop:collect
if ($LASTEXITCODE -ne 0) { throw 'Windows artifact collection failed.' }
