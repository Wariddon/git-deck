$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$tokens=$null;$errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $root 'git-dashboard-server.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Server parse failed'}
foreach($name in @('Invoke-GitCapture','Invoke-GitOrThrow','Resolve-GitRef','Get-GitOperationState','Test-GitDeckProtectedStatusLine','Test-GitDeckProtectedPath')){
    $fn=$ast.FindAll({param($n)$n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$false)[0]
    $definition=$fn.Extent.Text
    if($name -eq 'Invoke-GitCapture'){$definition=$definition.Replace('$items =',("`$ErrorActionPreference='Continue'`n    `$items ="))}
    . ([scriptblock]::Create($definition))
}
. (Join-Path $root 'git-workflow-tools.ps1')
$script:Root=Join-Path $root ('output\workflow-test-'+[guid]::NewGuid().ToString('N'))
$script:registered=@()
function Get-Repositories {return $script:registered}
function Save-Repositories($Repositories){$script:registered=@($Repositories)}
function Assert-Registered($Path){if($script:registered -notcontains $Path){throw 'Not registered'}}
$created=New-TrainingRepository
if(-not $created.path.StartsWith($script:Root+'\sandboxes\')){throw 'Sandbox escaped test root'}
$status=Get-WorkflowStatus $created.path
if($status.branch -ne 'main' -or $status.files.Count -ne 1){throw 'Expected main and one practice change'}
if((Invoke-GitOrThrow $created.path @('remote')).Trim()){throw 'Training repository must have no remote'}
$review=Get-CheckoutReview $created.path 'lesson/conflict'
if(-not $review.blocked -or $review.changedFiles -notcontains 'lesson.txt'){throw 'Dirty checkout review did not block'}
[void](Invoke-GitOrThrow $created.path @('add','--','notes.txt'))
[void](Invoke-GitOrThrow $created.path @('commit','-m','Test practice commit'))
$review=Get-CheckoutReview $created.path 'lesson/conflict'
if($review.blocked){throw 'Clean checkout review unexpectedly blocked'}
$merge=Invoke-GitCapture $created.path @('merge','--no-edit','lesson/conflict')
if($merge.Code -eq 0){throw 'Expected practice conflict'}
$status=Get-WorkflowStatus $created.path
if(-not $status.operation.active){throw 'Conflict not detected'}
[void](Invoke-GitOrThrow $created.path @('merge','--abort'))
$rejected=$false;try{Get-WorkflowStatus $root | Out-Null}catch{$rejected=$true};if(-not $rejected){throw 'Unregistered path accepted'}
'PASS: isolated practice creation, no remote, fresh status, dirty/clean checkout, conflict and registration guard'
"Fixture retained only in ignored output: $script:Root"
