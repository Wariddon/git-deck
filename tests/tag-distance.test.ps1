$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $root 'git-dashboard-server.ps1'),[ref]$null,[ref]$null)
$fn=$ast.FindAll({param($n)$n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Invoke-GitCapture'},$false)[0]
. ([scriptblock]::Create($fn.Extent.Text.Replace('$items =',("`$ErrorActionPreference='Continue'`n    `$items ="))))
. (Join-Path $root 'lib\GitDeck.MultiRepo.ps1')
. (Join-Path $root 'lib\GitDeck.Activity.ps1')
function Assert-Registered($Path){}
function Run-Git([string]$Path,[string[]]$Arguments){$r=Invoke-GitCapture $Path $Arguments;if($r.Code -ne 0){throw "git $($Arguments -join ' '): $($r.Output)"}}
$base=Join-Path $root ('output\tag-distance-test-'+[guid]::NewGuid().ToString('N'))
try{
    [void](New-Item -ItemType Directory -Force -Path $base);Run-Git $base @('init','-q','-b','main')
    Run-Git $base @('config','user.email','t@example.test');Run-Git $base @('config','user.name','T')
    Run-Git $base @('commit','-q','--allow-empty','-m','one');Run-Git $base @('tag','1.0.0')
    Run-Git $base @('commit','-q','--allow-empty','-m','two');Run-Git $base @('tag','v1.1.0')
    Run-Git $base @('commit','-q','--allow-empty','-m','three')
    $d=Get-GitDeckTagDistance $base '1.0.0|1.1.0|9.9.9|--bad'
    $byTag=@{};foreach($item in $d.tags){$byTag[$item.tag]=$item}
    if($byTag['1.0.0'].behind -ne 2 -or $byTag['1.1.0'].behind -ne 1 -or $byTag['9.9.9'].found){throw "Distance: $($d.tags|ConvertTo-Json -Compress)"}
    if($byTag.ContainsKey('--bad')){throw 'Unsafe tag accepted'}
    $t=Get-GitDeckTagDistance $base '1.0.0' 'v1.1.0'
    if(@($t.tags)[0].behind -ne 1 -or $t.mainline -ne 'refs/tags/v1.1.0'){throw "Against newest tag: $($t|ConvertTo-Json -Compress)"}
    $between=@(Get-GitDeckCommitsSince $base '1.0.0' 'v1.1.0')
    if($between.Count -ne 1 -or $between[0].subject -ne 'two'){throw "Between tags: $($between|ConvertTo-Json -Compress)"}
    $p=Get-GitDeckPendingWork $base
    if(@($p.activity).Count -ne 14 -or @($p.activity)[13] -ne 3){throw "Activity: $(@($p.activity) -join ',')"}
    Write-Host 'PASS: tag distance to the main line (v prefix, unknown and unsafe tags) and 14-day activity'
}finally{ if(Test-Path -LiteralPath $base){Remove-Item -LiteralPath $base -Recurse -Force} }
