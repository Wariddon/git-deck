[CmdletBinding()]
param([string]$Filter = '')
# Runs every Git Deck check: JavaScript syntax, tests/*.test.cjs with Node.js and
# tests/*.test.ps1 with the same PowerShell that runs this script.
# Used by CI and locally:  powershell -NoProfile -ExecutionPolicy Bypass -File .\run-tests.ps1
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { throw 'Node.js is required for the JavaScript checks.' }
$shell = (Get-Process -Id $PID).Path
$failed = New-Object 'System.Collections.Generic.List[string]'
$passed = 0

function Invoke-Check([string]$Name, [string]$File, [string[]]$Arguments) {
    $started = [Diagnostics.Stopwatch]::StartNew()
    # Windows PowerShell 5.1 turns redirected stderr into terminating errors under 'Stop'.
    $ErrorActionPreference = 'Continue'
    $output = & $File @Arguments 2>&1 | ForEach-Object { if ($_ -is [Management.Automation.ErrorRecord]) { $_.Exception.Message } else { [string]$_ } } | Out-String
    $code = $LASTEXITCODE
    $started.Stop()
    if ($code -eq 0) {
        $script:passed++
        Write-Host ('  ok    {0} ({1:N1}s)' -f $Name, $started.Elapsed.TotalSeconds) -ForegroundColor Green
    } else {
        $script:failed.Add($Name)
        Write-Host "  FAIL  $Name" -ForegroundColor Red
        Write-Host ($output.TrimEnd() -replace '(?m)^', '        ')
    }
}

Write-Host 'JavaScript syntax'
foreach ($file in @(Get-ChildItem -LiteralPath (Join-Path $root 'web') -Filter '*.js' -File | Sort-Object Name)) {
    if ($Filter -and $file.Name -notlike "*$Filter*") { continue }
    Invoke-Check "node --check web/$($file.Name)" $node.Source @('--check', $file.FullName)
}
Write-Host 'JavaScript tests'
foreach ($file in @(Get-ChildItem -LiteralPath (Join-Path $root 'tests') -Filter '*.test.cjs' -File | Sort-Object Name)) {
    if ($Filter -and $file.Name -notlike "*$Filter*") { continue }
    Invoke-Check "tests/$($file.Name)" $node.Source @($file.FullName)
}
Write-Host 'PowerShell tests'
foreach ($file in @(Get-ChildItem -LiteralPath (Join-Path $root 'tests') -Filter '*.test.ps1' -File | Sort-Object Name)) {
    if ($Filter -and $file.Name -notlike "*$Filter*") { continue }
    Invoke-Check "tests/$($file.Name)" $shell @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $file.FullName)
}

Write-Host ''
if ($failed.Count) {
    Write-Host "$($failed.Count) failed, $passed passed:" -ForegroundColor Red
    $failed | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
    exit 1
}
Write-Host "All $passed checks passed." -ForegroundColor Green
