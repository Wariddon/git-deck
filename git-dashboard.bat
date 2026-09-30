@echo off
setlocal
chcp 65001 >nul
title Git Deck Local Server

where git >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Git was not found in PATH.
    pause
    exit /b 1
)

rem One app window and no console, like Sourcetree: hand over to GitDeck.exe when it
rem exists (it runs the server hidden). Use "git-dashboard.bat --console" to see server output.
if /i not "%~1"=="--console" if exist "%~dp0GitDeck.exe" (
    start "" "%~dp0GitDeck.exe"
    exit /b 0
)

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0git-dashboard-server.ps1"
if errorlevel 1 (
    echo.
    echo [ERROR] Git Deck stopped unexpectedly.
    pause
)
