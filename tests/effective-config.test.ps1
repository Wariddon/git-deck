$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $root 'git-dashboard-server.ps1'),[ref]$null,[ref]$null)
$fn=$ast.FindAll({param($n)$n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Invoke-GitCapture'},$false)[0]
. ([scriptblock]::Create($fn.Extent.Text.Replace('$items =',("`$ErrorActionPreference='Continue'`n    `$items ="))))
. (Join-Path $root 'lib\GitDeck.MultiRepo.ps1')
. (Join-Path $root 'lib\GitDeck.Fleet.ps1')
. (Join-Path $root 'lib\GitDeck.Integrations.ps1')
. (Join-Path $root 'lib\GitDeck.Config.ps1')
function Assert-Registered($Path){}
function Run-Git([string]$Path,[string[]]$Arguments){$r=Invoke-GitCapture $Path $Arguments;if($r.Code -ne 0){throw "git $($Arguments -join ' '): $($r.Output)"}}
function Write-Text([string]$File,[string]$Text){[void](New-Item -ItemType Directory -Force -Path (Split-Path $File -Parent));[IO.File]::WriteAllText($File,$Text)}

$base=Join-Path $root ('output\effective-config-test-'+[guid]::NewGuid().ToString('N'))
try{
    $service=Join-Path $base 'billing-svc';$deploy=Join-Path $base 'deploy-config'
    foreach($repo in @($service,$deploy)){[void](New-Item -ItemType Directory -Force -Path $repo);Run-Git $repo @('init','-q','-b','main');Run-Git $repo @('config','user.email','t@example.test');Run-Git $repo @('config','user.name','T')}
    Write-Text (Join-Path $service 'src/main/resources/application.yml') "server:`n  port: 8080`n"
    Write-Text (Join-Path $service 'src/main/resources/application-uat.yml') "spring:`n  datasource:`n    url: jdbc:old`n"
    Write-Text (Join-Path $service 'src/main/resources/application-prod.properties') "server.port=80`n"
    Run-Git $service @('add','.');Run-Git $service @('commit','-qm','config')
    Write-Text (Join-Path $deploy 'overlays/uat/billing-svc-config.yaml') "kind: ConfigMap`nmetadata:`n  name: billing-svc-config`ndata:`n  SPRING_DATASOURCE_URL: jdbc:uat`n"
    Write-Text (Join-Path $deploy 'overlays/prod/billing-svc-config.yaml') "kind: ConfigMap`nmetadata:`n  name: billing-svc-config`ndata:`n  SPRING_DATASOURCE_URL: jdbc:prod`n"
    Write-Text (Join-Path $deploy 'manifestvalues/uat/lns-app-configuration/billing-svc.yml') "spring:`n  data:`n    redis:`n      host: classic`n"
    Write-Text (Join-Path $deploy 'overlays/uat/ledger.yaml') "kind: ConfigMap`nmetadata:`n  name: ledger`n"
    Run-Git $deploy @('add','.');Run-Git $deploy @('commit','-qm','deploy')

    $result=Get-GitDeckEffectiveConfigSources $service 'uat' '' $deploy '' ''
    if((@($result.profiles) -join ',') -ne 'prod,uat'){throw "Profiles: $(@($result.profiles) -join ',')"}
    $files=@($result.service|ForEach-Object{"$($_.role):$($_.file)"})
    if(($files -join ',') -ne 'base:src/main/resources/application.yml,profile:src/main/resources/application-uat.yml'){throw "Service files: $($files -join ',')"}
    $deployFiles=@($result.deploy.files|ForEach-Object{$_.file})
    if(($deployFiles -join ',') -ne 'manifestvalues/uat/lns-app-configuration/billing-svc.yml,overlays/uat/billing-svc-config.yaml'){throw "Deploy files for uat: $($deployFiles -join ',')"}
    if(-not @($result.deploy.files)[0].nameMatch -or @($result.deploy.files)[1].nameMatch){throw 'nameMatch wrong'}
    if($result.deploy.ref -ne 'HEAD' -or $result.deploy.name -ne 'billing-svc'){throw 'Deploy ref or name wrong'}
    # A ref reads committed files; a different deploy name; unsafe input is refused.
    Write-Text (Join-Path $service 'src/main/resources/application.yml') "server:`n  port: 1`n"
    if(@((Get-GitDeckEffectiveConfigSources $service 'uat' 'main' '' '' '').service)[0].content -notmatch '8080'){throw 'Ref did not read the committed file'}
    if(@((Get-GitDeckEffectiveConfigSources $service 'uat' '' $deploy '' 'ledger').deploy.files).Count -ne 1){throw 'Deploy name override ignored'}
    foreach($bad in @(@('../x','',''),@('uat','--output=x',''),@('uat','','a b'))){$refused=$false;try{[void](Get-GitDeckEffectiveConfigSources $service $bad[0] $bad[1] $deploy '' $bad[2])}catch{$refused=$true};if(-not $refused){throw "Unsafe input accepted: $($bad -join '|')"}}
    Write-Host 'PASS: effective config sources (profiles, service files by role, deploy files by service and environment, ref, unsafe input)'
}finally{
    if(Test-Path -LiteralPath $base){Remove-Item -LiteralPath $base -Recurse -Force}
}
