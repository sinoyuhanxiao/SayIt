param([string]$SourceClient, [string]$ToolsRoot = "$env:LOCALAPPDATA\SayItDevTools", [int]$OwnerProcessId = 0)
$ErrorActionPreference = 'Stop'
$previous = ''
Write-Output 'Watching repository native source changes.'
while ($OwnerProcessId -eq 0 -or (Get-Process -Id $OwnerProcessId -ErrorAction SilentlyContinue)) {
    $native = Join-Path $SourceClient 'src-tauri'
    $files = @(Get-ChildItem (Join-Path $native 'src') -Recurse -File -Filter '*.rs')
    $files += @(Get-Item (Join-Path $native 'Cargo.toml'), (Join-Path $native 'Cargo.lock'), (Join-Path $native 'tauri.conf.json'))
    $signature = ($files | Sort-Object FullName | ForEach-Object { "$($_.FullName):$($_.LastWriteTimeUtc.Ticks):$($_.Length)" }) -join "`n"
    if ($previous -and $previous -ne $signature) {
        Write-Output 'Native source changed. Synchronizing for automatic rebuild.'
        & "$PSScriptRoot\stage-ask-test.ps1" -SourceClient $SourceClient -ToolsRoot $ToolsRoot -Dev
    }
    $previous = $signature
    Start-Sleep -Seconds 1
}
