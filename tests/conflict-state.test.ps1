$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $root 'git-dashboard-server.ps1'), [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'Server parse failed' }
foreach ($name in @('Invoke-GitCapture', 'Invoke-GitOrThrow', 'Get-GitOperationState')) {
    $fn = $ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name}, $false)[0]
    if (-not $fn) { throw "Missing function $name" }
    $definition = $fn.Extent.Text
    if ($name -eq 'Invoke-GitCapture') { $definition = $definition.Replace('$items =', "`$ErrorActionPreference = 'Continue'`n    `$items =") }
    . ([scriptblock]::Create($definition))
}
function Run-Git([string]$Path, [string[]]$Arguments) { [void](Invoke-GitOrThrow $Path $Arguments) }
function Write-Text([string]$File, [string]$Text) { [IO.File]::WriteAllText($File, $Text, (New-Object Text.UTF8Encoding($false))) }
$base = Join-Path $root ('output\conflict-state-test-' + [guid]::NewGuid().ToString('N'))
try {
    [void](New-Item -ItemType Directory -Path $base)
    Run-Git $base @('init', '-q', '-b', 'main')
    Run-Git $base @('config', 'user.name', 'Test')
    Run-Git $base @('config', 'user.email', 't@example.test')
    Run-Git $base @('config', 'core.autocrlf', 'true')
    Run-Git $base @('config', 'core.safecrlf', 'warn')
    Write-Text (Join-Path $base 'warning.txt') "one`ntwo`n"
    Run-Git $base @('add', '.')
    Run-Git $base @('commit', '-qm', 'base')
    Write-Text (Join-Path $base 'warning.txt') "one`nchanged`n"
    $legacy = Invoke-GitCapture $base @('diff', '--name-only', '--diff-filter=U')
    if ($legacy.Output -notmatch 'LF.*CRLF') { throw 'Fixture did not reproduce the line-ending diagnostic' }
    $operation = Get-GitOperationState $base
    if ($operation.active -or $operation.conflicts.Count) { throw 'Line-ending warning was reported as a conflict' }
    Run-Git $base @('add', '.')
    Run-Git $base @('commit', '-qm', 'warning edit')
    Run-Git $base @('config', 'core.autocrlf', 'false')

    $file = 'a spaced file.txt'
    Write-Text (Join-Path $base $file) "base`n"
    Run-Git $base @('add', '.')
    Run-Git $base @('commit', '-qm', 'conflict base')
    Run-Git $base @('switch', '-qc', 'side')
    Write-Text (Join-Path $base $file) "side`n"
    Run-Git $base @('add', '.')
    Run-Git $base @('commit', '-qm', 'side')
    Run-Git $base @('switch', '-q', 'main')
    Write-Text (Join-Path $base $file) "main`n"
    Run-Git $base @('add', '.')
    Run-Git $base @('commit', '-qm', 'main')
    $merge = Invoke-GitCapture $base @('merge', 'side')
    if ($merge.Code -eq 0) { throw 'Fixture merge should conflict' }
    $operation = Get-GitOperationState $base
    if (-not $operation.active -or $operation.type -ne 'merge' -or $operation.resolved -or $operation.conflicts.Count -ne 1 -or $operation.conflicts[0] -ne $file) { throw 'Real conflict missing, quoted or duplicated' }
    Write-Text (Join-Path $base $file) "resolved`n"
    Run-Git $base @('add', '--', $file)
    $operation = Get-GitOperationState $base
    if (-not $operation.active -or -not $operation.resolved -or $operation.conflicts.Count) { throw 'Staged resolution not detected' }

    # Stash conflicts have no MERGE_HEAD. Index stages must still be returned,
    # while a diagnostic-only record must not be mistaken for a path.
    function Invoke-GitCapture([string]$Path, [string[]]$Arguments) {
        if ($Arguments[0] -eq 'rev-parse') { return @{ Code = 0; Output = Join-Path $base 'empty-git-dir' } }
        if (($Arguments -join ' ') -ne 'ls-files --unmerged -z') { throw 'Unexpected conflict command' }
        $hash = 'a' * 40
        return @{ Code = 0; Output = "warning: LF will be replaced by CRLF`0" + "100644 $hash 2`t$file`0" + "100644 $hash 3`t$file`0" }
    }
    $operation = Get-GitOperationState $base
    if ($operation.active -or $operation.conflicts.Count -ne 1 -or $operation.conflicts[0] -ne $file) { throw 'Standalone stash conflict parsing failed' }
    function Invoke-GitCapture([string]$Path, [string[]]$Arguments) {
        if ($Arguments[0] -eq 'rev-parse') { return @{ Code = 0; Output = Join-Path $base 'empty-git-dir' } }
        return @{ Code = 128; Output = 'index read failed' }
    }
    $refused = $false
    try { [void](Get-GitOperationState $base) } catch { $refused = $_.Exception.Message -match 'Could not read unmerged' }
    if (-not $refused) { throw 'Index read error silently treated as clean' }
    Write-Host 'PASS: LF/CRLF warnings, real conflicts, stage deduplication, staged resolution, stash conflicts and read errors'
} finally {
    $resolved = [IO.Path]::GetFullPath($base)
    $allowed = [IO.Path]::GetFullPath((Join-Path $root 'output')) + [IO.Path]::DirectorySeparatorChar
    if (-not $resolved.StartsWith($allowed, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe test cleanup target' }
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
