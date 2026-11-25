param([string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'PenEchoCLI'), [switch]$AddToPath)
$ErrorActionPreference = 'Stop'
$source = $PSScriptRoot
$build = Get-Content (Join-Path $source 'build.json') -Raw | ConvertFrom-Json
if ($env:PROCESSOR_ARCHITECTURE -ne 'AMD64' -and $env:PROCESSOR_ARCHITEW6432 -ne 'AMD64') { throw 'This package requires Windows x64.' }
$manifest = Get-Content (Join-Path $source 'files.sha256.json') -Raw | ConvertFrom-Json
# Verify the verifier and runtime with Windows before executing the bundled runtime.
foreach ($relative in @('runtime\node.exe', 'verify-files.cjs')) {
  $entry = $manifest | Where-Object { $_.path -eq $relative }
  if (!$entry -or (Get-FileHash -Algorithm SHA256 (Join-Path $source $relative)).Hash -ne $entry.sha256) { throw "Package verification failed: $relative" }
}
& (Join-Path $source 'runtime\node.exe') (Join-Path $source 'verify-files.cjs') $source
if ($LASTEXITCODE) { throw 'Package verification failed' }
$destination = Join-Path (Join-Path $InstallRoot 'versions') $build.buildId
if (Test-Path $destination) { throw "This build is already installed at $destination. Run its penecho.cmd or choose another -InstallRoot." }
New-Item -ItemType Directory -Force $destination | Out-Null
& robocopy.exe $source $destination /E /MT:16 /R:1 /W:1 /NFL /NDL /NJH /NJS | Out-Null
if ($LASTEXITCODE -gt 7) { throw "Copy failed: $LASTEXITCODE" }
& (Join-Path $destination 'runtime\node.exe') (Join-Path $destination 'verify-files.cjs') $destination
if ($LASTEXITCODE) { throw 'Installed file verification failed' }
$bin = Join-Path $InstallRoot 'bin'
New-Item -ItemType Directory -Force $bin | Out-Null
$launcher = "@echo off`r`ncall `"$destination\penecho.cmd`" %*`r`n"
[IO.File]::WriteAllText((Join-Path $bin 'penecho.cmd'), $launcher, [Text.Encoding]::Default)
if ($AddToPath) {
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  $entries = @($userPath -split ';' | Where-Object { $_ -and $_.TrimEnd('\') -ine $bin.TrimEnd('\') })
  [Environment]::SetEnvironmentVariable('Path', (@($bin) + $entries -join ';'), 'User')
}
Write-Output "Installed $($build.buildId)"
Write-Output "Run: $bin\penecho.cmd"
Write-Output 'Open http://localhost:3888 after starting. Use --port 3999 if 3888 is already occupied.'
Write-Output 'Open a new terminal to use the updated user PATH. If another installation wins PATH order, use the full command above.'
