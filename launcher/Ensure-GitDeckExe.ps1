# Builds GitDeck.exe when it is missing (it is not in Git) or older than launcher\GitDeckLauncher.cs
# (a pull changed the launcher). Called by git-dashboard.bat; safe to run any time.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$exe = Join-Path $root 'GitDeck.exe'
$source = Join-Path $root 'launcher\GitDeckLauncher.cs'
$fresh = (Test-Path -LiteralPath $exe) -and (Get-Item -LiteralPath $exe).LastWriteTimeUtc -ge (Get-Item -LiteralPath $source).LastWriteTimeUtc
if ($fresh) { return }
Write-Host 'Building GitDeck.exe (first start, or the launcher changed)...'
try { & (Join-Path $root 'Build-GitDeck.ps1') | Out-Null }
catch {
    # A running GitDeck.exe cannot be replaced; the old one keeps working until the next start.
    Write-Host "GitDeck.exe was not built: $($_.Exception.Message)"
}
