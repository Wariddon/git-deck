$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$tokens=$null;$errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $root 'git-dashboard-server.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Server parse failed'}
foreach($name in @('Invoke-GitCapture','Invoke-GitOrThrow')){
    $fn=$ast.FindAll({param($n)$n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$false)[0]
    $definition=$fn.Extent.Text
    if($name -eq 'Invoke-GitCapture'){$definition=$definition.Replace('$items =',("`$ErrorActionPreference='Continue'`n    `$items ="))}
    . ([scriptblock]::Create($definition))
}
. (Join-Path $root 'lib\GitDeck.MultiRepo.ps1')
. (Join-Path $root 'lib\GitDeck.Parity.ps1')
. (Join-Path $root 'lib\GitDeck.Features.ps1')
. (Join-Path $root 'lib\GitDeck.Integrations.ps1')
function Assert-Registered($Path){}
function Run-Git([string]$Path,[string[]]$Arguments){[void](Invoke-GitOrThrow $Path $Arguments)}
function Write-Text([string]$File,[string]$Text){[void](New-Item -ItemType Directory -Force -Path (Split-Path $File -Parent));[IO.File]::WriteAllText($File,$Text)}

# Environments from deploy file paths.
$cases=@{'helm/billing-svc/values-uat.yaml'='uat';'overlays/sit2/kustomization.yaml'='sit2';'env/production/app.yml'='prod';'values-pre-prod.yaml'='preprod';'apps/dev-tools/overlays/prod/k.yaml'='prod';'charts/app/values.yaml'='default'}
foreach($file in $cases.Keys){$got=Get-GitDeckDeployEnv $file;if($got -ne $cases[$file]){throw "Env of ${file}: $got"}}
$image=Split-GitDeckImage 'registry.local:5000/group/billing-svc:1.4.2@sha256:abc'
if($image.name -ne 'billing-svc' -or $image.tag -ne '1.4.2'){throw 'Image split failed'}
if((Split-GitDeckImage 'registry.local:5000/group/ledger').tag){throw 'Port read as a tag'}

$base=Join-Path $root ('output\integrations-test-'+[guid]::NewGuid().ToString('N'))
try{
    $repo=Join-Path $base 'deploy'
    [void](New-Item -ItemType Directory -Path $repo -Force)
    Run-Git $repo @('init','-q','-b','main');Run-Git $repo @('config','user.email','t@example.test');Run-Git $repo @('config','user.name','Test')
    # Kubernetes manifest, Helm values and Kustomize, plus a templated value that must be ignored.
    Write-Text (Join-Path $repo 'k8s/dev/billing.yaml') "spec:`n  containers:`n    - name: billing`n      image: registry.local/pay/billing-svc:1.5.0-poc03`n"
    Write-Text (Join-Path $repo 'helm/billing-svc/values-uat.yaml') "image:`n  repository: registry.local/pay/billing-svc`n  tag: `"1.4.5`"`nreplicas: 2`n"
    Write-Text (Join-Path $repo 'overlays/prod/kustomization.yaml') "images:`n  - name: registry.local/pay/billing-svc`n    newTag: 1.4.2`n  - name: ledger`n    newTag: v2.0.1 # pinned`n"
    Write-Text (Join-Path $repo 'helm/ledger/values-sit.yaml') "image:`n  repository: ledger`n  tag: {{ .Values.version }}`n"
    Write-Text (Join-Path $repo 'README.md') "image: not/a:yaml`n"
    Write-Text (Join-Path $repo 'env/prod/unrelated.yaml') "metadata:`n  name: not-an-image`n  tag: not-an-image-tag`nimage:`n  repository: not-a-sibling`nother:`n    tag: wrong-scope`n"
    Run-Git $repo @('add','.');Run-Git $repo @('commit','-qm','deploy')
    $map=Get-GitDeckDeployMap $repo ''
    $found=@($map.entries|ForEach-Object{"$($_.env)|$($_.service)|$($_.tag)"})|Sort-Object
    $expected=@('dev|billing-svc|1.5.0-poc03','prod|billing-svc|1.4.2','prod|ledger|v2.0.1','uat|billing-svc|1.4.5')
    if(($found -join ',') -ne ($expected -join ',')){throw "Deploy map: $($found -join ', ')"}
    if($map.ref -ne 'HEAD' -or -not $map.commit -or $map.files -ne 3){throw "Deploy map header: $($map.ref) $($map.files)"}
    # A ref reads committed content, not the working tree.
    Write-Text (Join-Path $repo 'helm/billing-svc/values-uat.yaml') "image:`n  repository: registry.local/pay/billing-svc`n  tag: 9.9.9`n"
    if(@((Get-GitDeckDeployMap $repo 'main').entries|Where-Object{$_.tag -eq '9.9.9'}).Count){throw 'Uncommitted change was read'}
    $refused=$false;try{[void](Get-GitDeckDeployMap $repo '--output=x')}catch{$refused=$true};if(-not $refused){throw 'Unsafe ref accepted'}

    # Editors: unknown editors and lines are refused; files must stay inside the repository.
    foreach($bad in @(@{editor='notepad'},@{editor='code';file='../x.txt'},@{editor='code';line='abc'})){
        $refused=$false;try{[void](Open-GitDeckEditor $repo $bad.editor $bad.file $bad.line)}catch{$refused=$true};if(-not $refused){throw "Unsafe editor request accepted: $($bad|ConvertTo-Json -Compress)"}
    }
    # Without bin\gitleaks.exe the extra scan is skipped.
    $script:GitDeckGitleaks=Join-Path $base 'missing-gitleaks.exe'
    if($null -ne (Invoke-GitDeckGitleaks $repo 'HEAD')){throw 'Missing gitleaks should be skipped'}
    # New secret rules.
    $found=@(Find-GitDeckSecrets "+++ b/app.yml`n+conn: DefaultEndpointsProtocol=https;AccountName=x;AccountKey=$('A'*60)==`n")
    if(-not $found.Count -or $found[0].rule -ne 'azure-storage-key'){throw 'Azure key not found'}
    Write-Host 'PASS: deploy map (manifests, Helm, Kustomize), editor guards, gitleaks optional, Azure key rule'
}finally{
    $target=[IO.Path]::GetFullPath($base);$allowed=[IO.Path]::GetFullPath((Join-Path $root 'output'))+[IO.Path]::DirectorySeparatorChar
    if(-not $target.StartsWith($allowed,[StringComparison]::OrdinalIgnoreCase)){throw 'Unsafe integration fixture cleanup'}
    if(Test-Path -LiteralPath $target){Remove-Item -LiteralPath $target -Recurse -Force}
}
