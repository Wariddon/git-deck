@echo off
setlocal
chcp 65001 >nul
title Git Repository Manager

where git >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Git was not found in PATH.
    pause
    exit /b 1
)

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0git-repo-manager.ps1"
if errorlevel 1 (
    echo.
    echo [ERROR] Git Repository Manager stopped unexpectedly.
    pause
)
