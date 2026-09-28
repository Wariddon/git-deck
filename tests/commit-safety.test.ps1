$ErrorActionPreference='Stop'
$tokens=$null;$errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '..\git-dashboard-server.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Server parse failed'}
$clause=$ast.FindAll({param($n) $n -is [System.Management.Automation.Language.SwitchStatementAst]},$true) | ForEach-Object {$_.Clauses} | Where-Object {$_.Item1.Value -eq 'commit'} | Select-Object -First 1
if(-not $clause){throw 'Commit handler not found'}
$handler=[scriptblock]::Create($clause.Item2.Extent.Text.Trim().TrimStart('{').TrimEnd('}'))
function Invoke-GitCapture($Path,$Arguments){if($Arguments[0] -eq 'status'){return @{Code=0;Output=' M demo.txt'}};return @{Code=$script:stagedCode;Output=''}}
function Get-GitDeckVisibleStatusLines($Output){return @($Output)}
function Invoke-GitDeckStageAll($Path){throw 'Commit must never stage files implicitly'}
function Invoke-GitOrThrow($Path,$Arguments){$script:committed=$true;return 'fixture commit'}
$path='fixture';$Body=@{message='test';amend=$false}
foreach($code in @(0,2)){$script:stagedCode=$code;$script:committed=$false;$blocked=$false;try{& $handler | Out-Null}catch{$blocked=$true};if(-not $blocked -or $script:committed){throw "Unsafe commit accepted for code $code"}}
$script:stagedCode=1;$script:committed=$false;& $handler | Out-Null
if(-not $script:committed){throw 'Staged commit rejected'}
$script:stagedCode=0;$script:committed=$false;$Body.amend=$true;& $handler | Out-Null
if(-not $script:committed){throw 'Message-only amend rejected'}
'PASS: no implicit staging, failed status blocked, staged commit and message-only amend'
