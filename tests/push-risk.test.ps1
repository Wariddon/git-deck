$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $root 'git-dashboard-server.ps1'),[ref]$null,[ref]$null)
$fn=$ast.FindAll({param($n)$n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Invoke-GitCapture'},$false)[0]
. ([scriptblock]::Create($fn.Extent.Text.Replace('$items =',("`$ErrorActionPreference='Continue'`n    `$items ="))))
. (Join-Path $root 'lib\GitDeck.Risk.ps1')
function Get-GitDeckCatalogEntries { return @($script:Catalog) }
function Run-Git([string]$Path,[string[]]$Arguments){$r=Invoke-GitCapture $Path $Arguments;if($r.Code -ne 0){throw "git $($Arguments -join ' '): $($r.Output)"}}
function Write-Text([string]$File,[string]$Text){[void](New-Item -ItemType Directory -Force -Path (Split-Path $File -Parent));[IO.File]::WriteAllText($File,$Text)}
$f={param($file,$added=1,$deleted=0,$status='M') [ordered]@{file=$file;added=$added;deleted=$deleted;status=$status}}

# Scoring: a README change is low; prod config + migration is high with a checklist; config counted once.
$low=Measure-GitDeckPushRisk @((& $f 'README.md' 3)) 0
if($low.level -ne 'low' -or $low.score -ne 0 -or @($low.checklist).Count){throw "README risk: $($low|ConvertTo-Json -Compress)"}
$high=Measure-GitDeckPushRisk @((& $f 'src/main/resources/application-prod.yml'),(& $f 'src/main/resources/db/migration/V12__add_column.sql' 20)) 0
if($high.level -ne 'high' -or $high.score -ne 60){throw "Prod config + migration: $($high.score) $($high.level)"}
if(@($high.reasons|Where-Object{$_.id -eq 'config'}).Count){throw 'Prod config counted twice'}
if(@($high.checklist).Count -ne 2){throw "Checklist: $(@($high.checklist) -join ' | ')"}
$medium=Measure-GitDeckPushRisk @((& $f 'pom.xml'),(& $f 'src/main/resources/application-uat.yml')) 2
if($medium.level -ne 'medium' -or $medium.score -ne 35){throw "pom + uat config + 2 consumers: $($medium.score) $($medium.level)"}
$big=Measure-GitDeckPushRisk @((& $f 'src/A.java' 1200 400)) 0
if(@($big.reasons|Where-Object{$_.id -eq 'size'})[0].weight -ne 25){throw 'Very large change not weighted'}

# Real commits: the outgoing range, numstat summed per file, and a catalog consumer.
$base=Join-Path $root ('output\push-risk-test-'+[guid]::NewGuid().ToString('N'))
try{
    $repo=Join-Path $base 'billing';[void](New-Item -ItemType Directory -Force -Path $repo)
    Run-Git $repo @('init','-q','-b','main');Run-Git $repo @('config','user.email','t@example.test');Run-Git $repo @('config','user.name','T')
    Write-Text (Join-Path $repo 'README.md') "x`n";Run-Git $repo @('add','.');Run-Git $repo @('commit','-qm','first')
    $start=([string](Invoke-GitCapture $repo @('rev-parse','HEAD')).Output).Trim()
    Write-Text (Join-Path $repo 'src/main/resources/application-prod.yml') "a: 1`n";Run-Git $repo @('add','.');Run-Git $repo @('commit','-qm','prod')
    Write-Text (Join-Path $repo 'src/main/resources/application-prod.yml') "a: 2`nb: 3`n";Run-Git $repo @('commit','-qam','prod again')
    $script:Catalog=@([pscustomobject]@{path='C:\other';dependencies=@($repo)})
    $risk=Get-GitDeckPushRisk $repo @('HEAD',"^$start")
    if($risk.files -ne 1 -or $risk.lines -ne 4){throw "Outgoing files/lines: $($risk.files) $($risk.lines)"}
    if(-not @($risk.reasons|Where-Object{$_.id -eq 'consumers'}).Count){throw 'Catalog consumer not counted'}
    Write-Host 'PASS: push risk (weights, prod config counted once, checklist, outgoing numstat, catalog consumers)'
}finally{
    if(Test-Path -LiteralPath $base){Remove-Item -LiteralPath $base -Recurse -Force}
}
