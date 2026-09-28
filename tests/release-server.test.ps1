$ErrorActionPreference='Stop'
$tokens=$null;$errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '..\git-dashboard-server.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Server parse failed'}
$fn=$ast.FindAll({param($n)$n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Get-PushPreview'},$false)[0]
. ([scriptblock]::Create($fn.Extent.Text))
function Assert-Registered($Path){}
function Invoke-GitOrThrow($Path,$Arguments){
 switch($Arguments[0]){'remote'{return 'origin'}'rev-parse'{if($Arguments[1] -eq '--git-path'){return 'nonexistent/FETCH_HEAD'};return ('a'*40)}'rev-list'{return "2`t3"}'log'{return 'abc123 sample commit'}default{throw 'Unexpected command'}}
}
function Invoke-GitCapture($Path,$Arguments){return @{Code=0;Output=('b'*40)}}
$preview=Get-PushPreview $PSScriptRoot 'origin' 'main' 'main'
if($preview.ahead -ne 3 -or $preview.behind -ne 2 -or $preview.commits.Count -ne 1){throw 'Incorrect push comparison'}
foreach($remote in @('-bad','unknown')){$blocked=$false;try{Get-PushPreview $PSScriptRoot $remote 'main' 'main'|Out-Null}catch{$blocked=$true};if(-not $blocked){throw 'Invalid remote accepted'}}
$blocked=$false;try{Get-PushPreview $PSScriptRoot 'origin' '-bad' 'main'|Out-Null}catch{$blocked=$true};if(-not $blocked){throw 'Invalid branch accepted'}
'PASS: push preview counts and invalid refs'
