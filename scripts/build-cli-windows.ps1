param(
  [Parameter(Mandatory=$true)][string]$SourcePackage,
  [Parameter(Mandatory=$true)][string]$LockFile,
  [Parameter(Mandatory=$true)][string]$Templates,
  [Parameter(Mandatory=$true)][string]$OutputDirectory,
  [Parameter(Mandatory=$true)][string]$BuildId,
  [Parameter(Mandatory=$true)][string]$SourceRevision,
  [string]$NodeVersion = '22.23.2'
)
$ErrorActionPreference = 'Stop'
if ($BuildId -notmatch '^[a-zA-Z0-9._-]+$') { throw 'Invalid build ID' }
New-Item -ItemType Directory -Force $OutputDirectory | Out-Null
$stage = Join-Path $OutputDirectory $BuildId
if (Test-Path $stage) { throw "Build directory already exists: $stage" }
New-Item -ItemType Directory $stage | Out-Null
$runtimeZip = Join-Path $OutputDirectory "node-v$NodeVersion-win-x64.zip"
$checksums = Join-Path $OutputDirectory "node-v$NodeVersion-SHASUMS256.txt"
& curl.exe --fail --location --retry 2 -o $runtimeZip "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-win-x64.zip"
if ($LASTEXITCODE) { throw 'Node download failed' }
& curl.exe --fail --location --retry 2 -o $checksums "https://nodejs.org/dist/v$NodeVersion/SHASUMS256.txt"
if ($LASTEXITCODE) { throw 'Checksum download failed' }
$expected = ((Get-Content $checksums | Where-Object { $_ -match "  node-v$([regex]::Escape($NodeVersion))-win-x64.zip$" }) -split '\s+')[0]
if (!$expected -or (Get-FileHash $runtimeZip -Algorithm SHA256).Hash -ne $expected) { throw 'Node checksum mismatch' }
Expand-Archive -LiteralPath $runtimeZip -DestinationPath $stage
Rename-Item (Join-Path $stage "node-v$NodeVersion-win-x64") 'runtime'
& tar.exe -xzf $SourcePackage -C $stage
if ($LASTEXITCODE) { throw 'Source extraction failed' }
Rename-Item (Join-Path $stage 'package') 'app'
$app = Join-Path $stage 'app'
Copy-Item $LockFile (Join-Path $app 'package-lock.json')
$env:PATH = (Join-Path $stage 'runtime') + ';' + $env:PATH
Push-Location $app
try {
  & (Join-Path $stage 'runtime\node.exe') (Join-Path $stage 'runtime\node_modules\npm\bin\npm-cli.js') ci --omit=dev --no-audit --no-fund
  if ($LASTEXITCODE) { throw 'Production dependency installation failed' }
} finally { Pop-Location }
Copy-Item (Join-Path $Templates '*') $stage
$package = Get-Content (Join-Path $app 'package.json') -Raw | ConvertFrom-Json
@{buildId=$BuildId;version=$package.version;sourceRevision=$SourceRevision;sourceIncludesUncommittedChanges=$true;builtAtUtc=[DateTime]::UtcNow.ToString('o');platform='win32-x64';nodeVersion=$NodeVersion;packageSHA256=(Get-FileHash $SourcePackage -Algorithm SHA256).Hash;lockSHA256=(Get-FileHash $LockFile -Algorithm SHA256).Hash;nodeArchiveSHA256=$expected} | ConvertTo-Json | Set-Content (Join-Path $stage 'build.json') -Encoding UTF8
& (Join-Path $stage 'runtime\node.exe') (Join-Path $stage 'verify-files.cjs') --write $stage
if ($LASTEXITCODE) { throw 'Manifest generation failed' }
$zip = Join-Path $OutputDirectory "penecho-win.zip"
& (Join-Path $stage 'runtime\node.exe') (Join-Path $PSScriptRoot 'package-cli-zip.cjs') $stage $zip
if ($LASTEXITCODE) { throw 'ZIP packaging failed' }
Write-Output "READY: $zip"
