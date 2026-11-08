param(
    [string]$SourceClient = '\\wsl.localhost\Ubuntu\home\erikyu\projects\SayIt\client',
    [string]$ToolsRoot = "$env:LOCALAPPDATA\SayItDevTools"
)
$ErrorActionPreference = 'Stop'
$mutex = New-Object Threading.Mutex($false, 'Local\SayItAskDevLauncher')
if (-not $mutex.WaitOne(0)) {
    $binary = Join-Path $ToolsRoot 'SayItAskTestBuild\client\src-tauri\target\release\sayit.exe'
    $running = Get-Process sayit -ErrorAction SilentlyContinue | Where-Object Path -eq $binary
    if ($running) { Start-Process -FilePath $binary }
    Write-Host 'SayIt Ask Dev is already running. Use its tray icon to open it.'
    exit 0
}
$watcher = $null
try {
    Write-Host 'Starting SayIt Ask Dev. Frontend changes refresh automatically; native changes rebuild automatically.'
    Write-Host 'The first native build can take several minutes. No installer is needed.'
    & "$PSScriptRoot\stage-ask-test.ps1" -SourceClient $SourceClient -ToolsRoot $ToolsRoot -Dev
    $ready = $false
    try { $ready = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 'http://localhost:1430/ask.html').StatusCode -eq 200 } catch {}
    if (-not $ready) {
        $vite = 'cd /home/erikyu/projects/SayIt/client && VITE_SAYIT_ASK_DEV=1 npm run dev -- --host 0.0.0.0 --port 1430'
        Start-Process wsl.exe -ArgumentList @('-d', 'Ubuntu', '--', 'bash', '-lc', ('"' + $vite + '"')) -WindowStyle Minimized
        for ($attempt = 0; $attempt -lt 40; $attempt++) {
            Start-Sleep -Milliseconds 500
            try { $ready = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 'http://localhost:1430/ask.html').StatusCode -eq 200 } catch {}
            if ($ready) { break }
        }
    }
    if (-not $ready) { throw 'Frontend server did not start on port 1430.' }
    # Local-only inspection for this development process; never set a system environment variable.
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9424 --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling'
    $watchArguments = '-NoProfile -ExecutionPolicy Bypass -File "{0}\watch-ask-native.ps1" -SourceClient "{1}" -ToolsRoot "{2}" -OwnerProcessId {3}' -f $PSScriptRoot,$SourceClient,$ToolsRoot,$PID
    $watcher = Start-Process powershell.exe -ArgumentList $watchArguments -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $ToolsRoot 'ask-native-watch.log') `
        -RedirectStandardError (Join-Path $ToolsRoot 'ask-native-watch-errors.log')
    & cmd.exe /d /c ('"' + "$PSScriptRoot\run-ask-dev.cmd" + '" 2>&1') | Tee-Object -FilePath (Join-Path $ToolsRoot 'ask-dev-live.log')
    if ($LASTEXITCODE -ne 0) { throw "Development app exited with code $LASTEXITCODE" }
} catch {
    Write-Host $_ -ForegroundColor Red
    Read-Host 'Press Enter to close'
} finally {
    if ($watcher) { Stop-Process -Id $watcher.Id -ErrorAction SilentlyContinue }
    $mutex.ReleaseMutex()
    $mutex.Dispose()
}
