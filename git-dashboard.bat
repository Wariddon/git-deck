@echo off
setlocal
chcp 65001 >nul
title Git Deck Local Server

where git >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Git was not found in PATH. Install Git for Windows, then run this again.
    pause
    exit /b 1
)

rem One app window and no console, like Sourcetree: hand over to GitDeck.exe (it runs the server
rem hidden). GitDeck.exe is not in Git, so after a clone it is built here once, and again after a
rem pull that changed launcher\GitDeckLauncher.cs. Use "git-dashboard.bat --console" to see server output.
if /i "%~1"=="--console" goto server
rem The release ZIP already contains GitDeck.exe and has no launcher sources.
if exist "%~dp0launcher\Ensure-GitDeckExe.ps1" powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0launcher\Ensure-GitDeckExe.ps1"
if not exist "%~dp0GitDeck.exe" goto nolauncher
start "" "%~dp0GitDeck.exe"
exit /b 0

:nolauncher
echo GitDeck.exe could not be built; starting the server in this window instead.

:server
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0git-dashboard-server.ps1"
if errorlevel 1 (
    echo.
    echo [ERROR] Git Deck stopped unexpectedly.
    pause
)
