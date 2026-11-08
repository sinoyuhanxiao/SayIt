param(
    [Parameter(Mandatory = $true)][string]$SourceClient,
    [string]$ToolsRoot = "$env:LOCALAPPDATA\SayItDevTools",
    [switch]$Dev
)

$ErrorActionPreference = 'Stop'
$stage = Join-Path $ToolsRoot 'SayItAskTestBuild\client'
New-Item -ItemType Directory -Force -Path $stage | Out-Null

# Copy into an isolated Windows build tree; never rewrite the original checkout.
& robocopy $SourceClient $stage /E /XD node_modules target dist transcribe-libs .git /NFL /NDL /NJH /NJS
if ($LASTEXITCODE -ge 8) { throw "Source staging failed: $LASTEXITCODE" }

$utf8 = New-Object System.Text.UTF8Encoding($false)
$files = @(
    Get-ChildItem (Join-Path $stage 'src') -Recurse -File -Include *.ts,*.tsx,*.json
    Get-ChildItem (Join-Path $stage 'src-tauri\src') -Recurse -File -Include *.rs
    Get-Item (Join-Path $stage 'src-tauri\tauri.conf.json')
)
foreach ($file in $files) {
    $text = [IO.File]::ReadAllText($file.FullName)
    $updated = $text.Replace('com.sayit.app', 'com.sayit.asktest')
    if ($file.Name -in @('TitleBar.tsx', 'Sidebar.tsx')) {
        $updated = $updated.Replace('>SayIt</span>', '>SayIt Ask Test</span>')
    }
    if ($updated -ne $text) { [IO.File]::WriteAllText($file.FullName, $updated, $utf8) }
}

$configPath = Join-Path $stage 'src-tauri\tauri.conf.json'
$config = Get-Content -Raw -Encoding UTF8 $configPath | ConvertFrom-Json
$config.productName = 'SayIt Ask Test'
$config | Add-Member -NotePropertyName mainBinaryName -NotePropertyValue 'sayit-ask-test' -Force
$config.bundle.shortDescription = 'SayIt voice questions test build'
$config.bundle.longDescription = 'Isolated SayIt test build with selected-text voice questions and a separate AI answer window.'
$config.app.windows[0].title = 'SayIt Ask Test'
# Avoid Tauri's npm hook running through an inherited WSL shell.
$config.build.beforeBuildCommand = ''
if ($Dev) {
    $config.productName = 'SayIt Ask Dev'
    $config.app.windows[0].title = 'SayIt Ask Dev'
    $config.build.beforeDevCommand = ''
    $config.build.devUrl = 'http://localhost:1430'
}
[IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json -Depth 30), $utf8)

$storagePath = Join-Path $stage 'src-tauri\src\storage\mod.rs'
$storage = [IO.File]::ReadAllText($storagePath)
$storage = $storage.Replace('("autoLaunch", "true"),', @'
("autoLaunch", "false"),
    ("autoLaunchInitialized", r#""true""#),
    ("autoLaunchArgsMigrated", r#""true""#),
    ("autoCheckUpdate", "false"),
    ("ask.enabled", "true"),
'@)
[IO.File]::WriteAllText($storagePath, $storage, $utf8)

# A test build must not import legacy application data, register itself at startup,
# or replace itself with the original project's automatic updates.
$mainPath = Join-Path $stage 'src-tauri\src\main.rs'
$main = [IO.File]::ReadAllText($mainPath)
$main = $main.Replace('if let Err(e) = storage.migrate_from_electron() {', 'if let Err(e) = Ok::<(), String>(()) {')
$main = $main.Replace('hook.start(app.handle(), &ptt_str, &hf_str, &ai_toggle_str);', 'if std::env::var_os("SAYIT_TEST_NO_SHORTCUTS").is_none() { hook.start(app.handle(), &ptt_str, &hf_str, &ai_toggle_str); }')
[IO.File]::WriteAllText($mainPath, $main, $utf8)

$shortcutsPath = Join-Path $stage 'src-tauri\src\commands\shortcuts.rs'
$shortcuts = [IO.File]::ReadAllText($shortcutsPath)
$shortcuts = $shortcuts.Replace('    // Read settings', '    if std::env::var_os("SAYIT_TEST_NO_SHORTCUTS").is_some() { return; }' + "`n" + '    // Read settings')
$shortcuts = $shortcuts.Replace('pub fn register_all_global_shortcuts(app: &AppHandle, storage: &Storage) {', 'pub fn register_all_global_shortcuts(app: &AppHandle, storage: &Storage) { if std::env::var_os("SAYIT_TEST_NO_SHORTCUTS").is_some() { return; }')
[IO.File]::WriteAllText($shortcutsPath, $shortcuts, $utf8)

$updatesPath = Join-Path $stage 'src\features\update\autoUpdate.ts'
$updates = [IO.File]::ReadAllText($updatesPath)
$updates = $updates.Replace('export async function startUpdateService(): Promise<void> {', 'export async function startUpdateService(): Promise<void> { if (import.meta.env.PROD) return;')
$updates = $updates.Replace('export async function checkForUpdateNow(): Promise<VersionInfo | null> {', 'export async function checkForUpdateNow(): Promise<VersionInfo | null> { if (import.meta.env.PROD) return null;')
[IO.File]::WriteAllText($updatesPath, $updates, $utf8)

Write-Output "Staged test build: $stage"
Write-Output 'Identity/data directory: com.sayit.asktest (original com.sayit.app is untouched)'
