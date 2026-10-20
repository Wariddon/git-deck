$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $root 'lib\GitDeck.Runtime.ps1'),[ref]$null,[ref]$null)
$fn=$ast.FindAll({param($n)$n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Test-GitDeckRefChange'},$false)[0]
. ([scriptblock]::Create($fn.Extent.Text))
$git='C:\repo\.git'
foreach($hit in @('HEAD','refs\heads\feature\AP-1','refs\remotes\origin\main','packed-refs','MERGE_HEAD','rebase-merge')){ if(-not (Test-GitDeckRefChange $git "$git\$hit")){throw "Missed: $hit"} }
foreach($miss in @('index','FETCH_HEAD','objects\ab\cdef','refs\heads\main.lock','logs\HEAD','config')){ if(Test-GitDeckRefChange $git "$git\$miss"){throw "Counted: $miss"} }
Write-Host 'PASS: fleet watchers react to refs only (not index, FETCH_HEAD, objects, locks)'
