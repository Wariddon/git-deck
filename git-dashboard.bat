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

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0git-dashboard-server.ps1"
if errorlevel 1 (
    echo.
    echo [ERROR] Git Deck stopped unexpectedly.
    pause
)
