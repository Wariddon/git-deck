$ErrorActionPreference='Stop'
$tokens=$null;$errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '..\git-dashboard-server.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Server parse failed'}
$fn=$ast.FindAll({param($n)$n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Get-CommitHistory'},$false)[0]
. ([scriptblock]::Create($fn.Extent.Text))
function Assert-Registered($Path){}
function Invoke-GitCapture($Path,$Arguments){
 $script:lastArgs=$Arguments
 $fields=@('abcdef1',('a'*40),('b'*40),'2026-09-28','Demo','Literal [query]','HEAD -> main')
 return @{Code=0;Output=($fields -join [char]31)}
}
$result=@(Get-CommitHistory 'fixture' 'all' '' $true 'date' 250 '[query]')
foreach($flag in @('--all','--date-order','-251','--skip=250','--fixed-strings','--regexp-ignore-case','--grep=[query]')){if($lastArgs -notcontains $flag){throw "Missing $flag"}}
if($result.Count -ne 1 -or $result[0].parents[0] -ne ('b'*40)){throw 'Invalid history parsing'}
[void](Get-CommitHistory 'fixture' 'current' '' $false 'topo' 0 '')
if($lastArgs -notcontains 'HEAD' -or $lastArgs -notcontains '--topo-order'){throw 'Scope/order lost'}
foreach($offset in @(-1,1000001)){$blocked=$false;try{Get-CommitHistory 'fixture' 'all' '' $true 'date' $offset ''|Out-Null}catch{$blocked=$true};if(-not $blocked){throw 'Invalid offset accepted'}}
$blocked=$false;try{Get-CommitHistory 'fixture' 'all' '' $true 'date' 0 ('x'*201)|Out-Null}catch{$blocked=$true};if(-not $blocked){throw 'Oversized query accepted'}
'PASS: history paging, literal message search, scope/order, parsing and input bounds'
