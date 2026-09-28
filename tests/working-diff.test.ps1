$ErrorActionPreference='Stop'
$tokens=$null;$errors=$null
$source=Join-Path $PSScriptRoot '..\git-dashboard-server.ps1'
$ast=[System.Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Server syntax errors'}
$definition=$ast.FindAll({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Get-WorkingDiff'},$false)[0]
. ([scriptblock]::Create($definition.Extent.Text))
function Assert-Registered($Path) {}
function Get-WorkspaceDetails {throw 'Diff must not read the full workspace'}
function Test-GitDeckProtectedStatusLine($line){return $line -like '?? .idea*'}
$script:commands=@()
function Invoke-GitCapture($Path,$Arguments){
    $script:commands+=,$Arguments
    if($Arguments[0] -eq 'status'){return @{Code=0;Output=" M tracked.txt`n?? .idea/"}}
    return @{Code=0;Output='sample diff'}
}
$result=Get-WorkingDiff 'C:\fixture' 'tracked.txt' $false
if($result.diff -ne 'sample diff' -or $script:commands.Count -ne 2){throw 'Unexpected diff reads'}
$result=Get-WorkingDiff 'C:\fixture' 'tracked.txt' $true
if($script:commands[-1] -notcontains '--cached'){throw 'Staged diff must use --cached'}
foreach($file in @('missing.txt','.idea/','..\outside.txt')){
    $blocked=$false
    try{Get-WorkingDiff 'C:\fixture' $file $false | Out-Null}catch{$blocked=$true}
    if(-not $blocked){throw "Unexpected accepted path: $file"}
}
'PASS: direct diff, staged diff, missing/protected/outside paths rejected'
