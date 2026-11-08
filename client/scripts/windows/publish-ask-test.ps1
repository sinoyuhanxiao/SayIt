param([string]$ToolsRoot = "$env:LOCALAPPDATA\SayItDevTools")
$ErrorActionPreference = 'Stop'
$bundle = Join-Path $ToolsRoot 'SayItAskTestBuild\client\src-tauri\target\release\bundle\nsis'
$installer = Get-ChildItem $bundle -Filter '*-setup.exe' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $installer) { throw 'No Windows test installer was generated.' }
$destination = Join-Path $env:USERPROFILE 'Downloads\SayIt-Ask-Test'
New-Item -ItemType Directory -Force -Path $destination | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$target = Join-Path $destination ("SayIt-Ask-Test-0.2.4-$stamp-setup.exe")
Copy-Item $installer.FullName $target -ErrorAction Stop
$hash = (Get-FileHash -Algorithm SHA256 $target).Hash
Write-Output "TEST INSTALLER: $target"
Write-Output "SHA256: $hash"
