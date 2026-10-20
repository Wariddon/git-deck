$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $root 'git-dashboard-server.ps1'),[ref]$null,[ref]$null)
foreach($name in @('Invoke-GitCapture','Convert-LogLines')){
    $fn=$ast.FindAll({param($n)$n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$false)[0]
    if($fn){$definition=$fn.Extent.Text;if($name -eq 'Invoke-GitCapture'){$definition=$definition.Replace('$items =',("`$ErrorActionPreference='Continue'`n    `$items ="))};. ([scriptblock]::Create($definition))}
}
. (Join-Path $root 'lib\GitDeck.MultiRepo.ps1')
. (Join-Path $root 'lib\GitDeck.Fleet.ps1')
function Assert-Registered($Path){}
function Run-Git([string]$Path,[string[]]$Arguments){$r=Invoke-GitCapture $Path $Arguments;if($r.Code -ne 0){throw "git $($Arguments -join ' '): $($r.Output)"}}
$base=Join-Path $root ('output\ticket-journey-test-'+[guid]::NewGuid().ToString('N'))
try{
    $remote=Join-Path $base 'remote.git';$repo=Join-Path $base 'svc'
    [void](New-Item -ItemType Directory -Force -Path $base)
    Run-Git $base @('init','-q','--bare','-b','main',$remote);Run-Git $base @('clone','-q',$remote,$repo)
    Run-Git $repo @('config','user.email','t@example.test');Run-Git $repo @('config','user.name','T')
    Run-Git $repo @('commit','-q','--allow-empty','-m','base');Run-Git $repo @('tag','0.9');Run-Git $repo @('push','-q','origin','main','0.9')
    Run-Git $repo @('switch','-qc','feature/PAY-7');Run-Git $repo @('commit','-q','--allow-empty','-m','PAY-7 add fee')
    $local=Get-GitDeckTicketJourney $repo 'PAY-7' ''
    if(-not $local.found -or $local.pushed -or @($local.merged).Count -or $local.firstTag){throw "Local only: $($local|ConvertTo-Json -Compress)"}
    Run-Git $repo @('push','-q','-u','origin','feature/PAY-7')
    Run-Git $repo @('switch','-q','main');Run-Git $repo @('merge','-q','--no-ff','-m','Merge PAY-7','feature/PAY-7');Run-Git $repo @('tag','1.0');Run-Git $repo @('push','-q','origin','main','1.0');Run-Git $repo @('fetch','-q')
    $j=Get-GitDeckTicketJourney $repo 'PAY-7' 'uat:1.0|prod:0.9|sit:9.9|bad entry'
    if(-not $j.pushed -or (@($j.merged) -join ',') -ne 'origin/main' -or $j.firstTag.name -ne '1.0'){throw "Journey: $($j|ConvertTo-Json -Compress -Depth 4)"}
    $byEnv=@{};foreach($e in $j.environments){$byEnv[$e.env]=$e}
    if($byEnv['uat'].contains -ne $true -or $byEnv['prod'].contains -ne $false -or $null -ne $byEnv['sit'].contains -or $byEnv.Count -ne 3){throw "Environments: $($j.environments|ConvertTo-Json -Compress)"}
    if((Get-GitDeckTicketJourney $repo 'PAY-99' '').found){throw 'Unknown ticket found'}
    Write-Host 'PASS: ticket journey (pushed, merged into main, first tag, environments in / not in / unknown)'
}finally{ if(Test-Path -LiteralPath $base){Remove-Item -LiteralPath $base -Recurse -Force} }
