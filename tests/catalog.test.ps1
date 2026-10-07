$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
. (Join-Path $root 'lib/GitDeck.Catalog.ps1')
$base=Join-Path $root ('output/catalog-test-'+[guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $base)
$script:CatalogFile=Join-Path $base 'catalog.json'
$script:registered=@((Join-Path $base 'billing'),(Join-Path $base 'shared'))
function Get-Repositories{return $script:registered}
function Assert-Registered($Path){if($Path -notin $script:registered){throw 'Not registered'}}
function Assert-Throws([scriptblock]$Code){$failed=$false;try{& $Code|Out-Null}catch{$failed=$true};if(-not $failed){throw 'Expected request to be refused'}}
try{
  foreach($repo in $script:registered){[void](New-Item -ItemType Directory -Path $repo)}
  $body=@{service='Billing';kind='service';owner='Payments';system='Checkout';dependencies=@($script:registered[1]);environments=@(@{env='uat';app='billing-uat';context='company-uat';namespace='argocd'});docs='https://docs.example.test/billing';ci=''}
  [void](Save-GitDeckServiceMetadata $script:registered[0] $body)
  $catalog=@(Get-GitDeckServiceCatalog)
  if($catalog.Count -ne 2 -or $catalog[0].owner -ne 'Payments' -or $catalog[0].environments[0].context -ne 'company-uat'){throw 'Catalog save/read failed'}
  $other=@{service='Shared';kind='library';dependencies=@();environments=@()}
  [void](Save-GitDeckServiceMetadata $script:registered[1] $other)
  [void](Save-GitDeckServiceMetadata $script:registered[0] $body)
  if(@(Get-GitDeckCatalogEntries).Count -ne 2){throw 'Other entries lost on update'}
  $versioned=$body.Clone();$versioned.expectedUpdatedAt=[string](@(Get-GitDeckServiceCatalog)[0].updatedAt)
  [void](Save-GitDeckServiceMetadata $script:registered[0] $versioned)
  $beforeConflict=[IO.File]::ReadAllText($script:CatalogFile)
  Assert-Throws {Save-GitDeckServiceMetadata $script:registered[0] $versioned}
  if([IO.File]::ReadAllText($script:CatalogFile) -ne $beforeConflict){throw 'Stale editor overwrote newer metadata'}
  $allRegistered=$script:registered;$script:registered=@($allRegistered[0])
  [void](Save-GitDeckServiceMetadata $script:registered[0] $body)
  if(@(Get-GitDeckServiceCatalog)[0].dependencies[0] -ne $allRegistered[1]){throw 'Unavailable dependency silently removed'}
  $script:registered=$allRegistered
  foreach($url in @('javascript:alert(1)','https://user:pass@example.test','https://example.test?token=x')){Assert-Throws {ConvertTo-GitDeckCatalogUrl $url}}
  Assert-Throws {Save-GitDeckServiceMetadata 'C:/not-registered' $body}
  $bad=$body.Clone();$bad.dependencies=@($script:registered[0]);Assert-Throws {Save-GitDeckServiceMetadata $script:registered[0] $bad}
  $bad=$body.Clone();$bad.environments=@(@{env='uat';app='--refresh';context='company'});Assert-Throws {Save-GitDeckServiceMetadata $script:registered[0] $bad}
  $bad=$body.Clone();$bad.environments=@(@{env='uat';app='billing';context=''});Assert-Throws {Save-GitDeckServiceMetadata $script:registered[0] $bad}
  function Invoke-GitDeckArgoCapture([string[]]$Arguments){
    $script:argoArgs=$Arguments
    return '{"metadata":{"name":"billing-uat"},"status":{"sync":{"status":"Synced","revision":"abc"},"health":{"status":"Healthy"},"reconciledAt":"2026-10-07T00:00:00Z","summary":{"images":["registry.test/billing:1.2.3"]}}}'
  }
  $snapshot=Get-GitDeckObservedEnvironment $script:registered[0] 'uat'
  if($snapshot.health -ne 'Healthy' -or $snapshot.images.Count -ne 1 -or -not $snapshot.checkedAt){throw 'Argo snapshot parse failed'}
  if($script:argoArgs -contains '--refresh' -or $script:argoArgs -contains 'sync' -or $script:argoArgs -notcontains '--argocd-context'){throw 'Unsafe Argo request'}
  Assert-Throws {Get-GitDeckObservedEnvironment $script:registered[0] 'prod'}
  function Get-OriginUrl($Path){return 'https://gitlab.example.test/team/billing.git'}
  function ConvertTo-WebUrl($Url){return $Url}
  function Get-GitLabProjectApi($Url){return @{host='gitlab.example.test';encoded='team%2Fbilling'}}
  $script:ruleMode='approved';$script:pipelineSha='abc'
  function Invoke-GlabCapture([string[]]$Arguments){
    if($Arguments[-1] -like '*/approval_state'){
      if($script:ruleMode -eq 'unknown'){return @{Code=1;Output='denied'}}
      if($script:ruleMode -eq 'none'){return @{Code=0;Output='{"rules":[]}'}}
      return @{Code=0;Output=(@{rules=@(@{approvals_required=2;approved=($script:ruleMode -eq 'approved')})}|ConvertTo-Json -Depth 5)}
    }
    return @{Code=0;Output=(@{iid=12;title='PAY-123';state='opened';draft=$false;sha='abc';detailed_merge_status='mergeable';head_pipeline=@{status='success';sha=$script:pipelineSha}}|ConvertTo-Json -Depth 5)}
  }
  $mr=Get-GitDeckMrReadiness $script:registered[0] '12'
  if($mr.pipeline -ne 'success' -or $mr.approval.status -ne 'approved'){throw 'MR readiness failed'}
  $script:ruleMode='unknown';if((Get-GitDeckMrReadiness $script:registered[0] '12').approval.status -ne 'unknown'){throw 'Failed approval inferred success'}
  $script:ruleMode='waiting';if((Get-GitDeckMrReadiness $script:registered[0] '12').approval.left -ne 1){throw 'Missing approval rule'}
  $script:ruleMode='none';if((Get-GitDeckMrReadiness $script:registered[0] '12').approval.status -ne 'not-required'){throw 'Empty rules handling failed'}
  $script:pipelineSha='old';if((Get-GitDeckMrReadiness $script:registered[0] '12').pipeline -ne 'stale'){throw 'Old pipeline marked current'}
  Assert-Throws {Get-GitDeckMrReadiness $script:registered[0] '--help'}
  [IO.File]::WriteAllText($script:CatalogFile,'broken-json')
  Assert-Throws {Save-GitDeckServiceMetadata $script:registered[0] $body}
  if([IO.File]::ReadAllText($script:CatalogFile) -ne 'broken-json'){throw 'Corrupt catalog overwritten'}
  foreach($malformed in @('{"schema":1,"entries":"oops"}','{"schema":1,"entries":[{"path":"x","dependencies":"oops"}]}','{"schema":1,"entries":[{"path":"x"},{"path":"X"}]}','{"schema":1,"entries":[{"path":"x","dependencies":[12]}]}','{"schema":1,"entries":[{"path":"x","environments":[12]}]}')){
    [IO.File]::WriteAllText($script:CatalogFile,$malformed)
    Assert-Throws {Save-GitDeckServiceMetadata $script:registered[0] $body}
    if([IO.File]::ReadAllText($script:CatalogFile) -ne $malformed){throw 'Invalid schema silently overwritten'}
  }
  Write-Host 'PASS: local metadata preservation/guards, explicit read-only Argo context, approval unknown and stale CI'
}finally{
  $target=[IO.Path]::GetFullPath($base);$allowed=[IO.Path]::GetFullPath((Join-Path $root 'output'))+[IO.Path]::DirectorySeparatorChar
  if(-not $target.StartsWith($allowed,[StringComparison]::OrdinalIgnoreCase)){throw 'Unsafe fixture cleanup'}
  Remove-Item -LiteralPath $target -Recurse -Force
}
