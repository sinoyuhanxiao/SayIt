@echo off
setlocal
set "SAYIT_TOOLS=%LOCALAPPDATA%\SayItDevTools"
set "CARGO_HOME=%SAYIT_TOOLS%\cargo"
set "RUSTUP_HOME=%SAYIT_TOOLS%\rustup"
set "PATH=%CARGO_HOME%\bin;%SAYIT_TOOLS%\cmake-min\cmake-3.31.8-windows-x86_64\bin;%SAYIT_TOOLS%\ninja;C:\Program Files\nodejs;%PATH%"
call "%SAYIT_TOOLS%\msvc\setup_x64.bat"
if errorlevel 1 exit /b 1
set "VULKAN_SDK=%SAYIT_TOOLS%\VulkanSDK"
set "PATH=%VULKAN_SDK%\Bin;%PATH%"
set "CMAKE_GENERATOR=Ninja"
set "CC=cl"
set "CXX=cl"
set "CL=/utf-8"
set "CMAKE_BUILD_PARALLEL_LEVEL=2"
set "CARGO_BUILD_JOBS=2"
set "CARGO_PROFILE_RELEASE_LTO=false"
set "CARGO_PROFILE_RELEASE_OPT_LEVEL=0"
set "CARGO_PROFILE_RELEASE_CODEGEN_UNITS=16"
for /d %%V in ("%SAYIT_TOOLS%\msvc\VC\Redist\MSVC\*") do set "SAYIT_VC_REDIST_DIRS=%%~fV\x64\Microsoft.VC143.CRT"
cd /d "%SAYIT_TOOLS%\SayItAskTestBuild\client"
if errorlevel 1 exit /b 1
call npm.cmd run build
if errorlevel 1 exit /b 1
call npx.cmd tauri build --bundles nsis
if errorlevel 1 exit /b 1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0publish-ask-test.ps1"
exit /b %ERRORLEVEL%
