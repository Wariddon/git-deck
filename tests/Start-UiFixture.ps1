[CmdletBinding()]
param([int]$Port=8787)
# Isolated visual QA app. No user inventory, auth, remotes or repositories are copied.
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$base=Join-Path $root ('output/playwright/fixture-'+[guid]::NewGuid().ToString('N'))
$package=Join-Path $base 'app'
[void](New-Item -ItemType Directory -Path $package -Force)
Get-ChildItem -LiteralPath $root -Filter '*.ps1' -File | Copy-Item -Destination $package
foreach($folder in @('web','lib')){Copy-Item -LiteralPath (Join-Path $root $folder) -Destination $package -Recurse}
$utf8=New-Object Text.UTF8Encoding($false)
$repos=@();$entries=@()
foreach($name in @('billing-api-with-long-service-name','shared-payments-library','deployment-configuration')){
  $repo=Join-Path $base $name;[void](New-Item -ItemType Directory -Path $repo)
  $ErrorActionPreference='Continue'
  & git -C $repo init -q -b main
  & git -C $repo config user.name 'Fixture User'
  & git -C $repo config user.email 'fixture@example.test'
  $ErrorActionPreference='Stop'
  [IO.File]::WriteAllText((Join-Path $repo 'README.md'),"# $name`nSynthetic visual QA repository. No remote.`n",$utf8)
  & git -C $repo add .; & git -C $repo commit -qm 'PAY-123: initial fixture'
  if($LASTEXITCODE){throw 'Fixture commit failed'}
  $repos+=$repo;$entries+=@{path=$repo;service=$name;kind='service';owner='Payments Platform';system='Checkout';description='Synthetic service directory for layout and workflow testing.';dependencies=@();environments=@();updatedAt=[DateTime]::UtcNow.ToString('o')}
}
$entries[0].dependencies=@($repos[1]);$entries[0].environments=@(@{env='uat';app='billing-uat';context='fixture-uat';namespace='argocd'})
[IO.File]::WriteAllLines((Join-Path $package 'git-repositories.txt'),$repos,$utf8)
[IO.File]::WriteAllText((Join-Path $package 'git-deck-catalog.json'),(@{schema=1;entries=$entries}|ConvertTo-Json -Depth 8),$utf8)
$shell=(Get-Process -Id $PID).Path;$server=Join-Path $package 'git-dashboard-server.ps1'
$process=Start-Process -FilePath $shell -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$server+'"'),'-NoBrowser','-Port',$Port) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $base 'server.out.log') -RedirectStandardError (Join-Path $base 'server.err.log')
@{base=$base;package=$package;pid=$process.Id;url="http://127.0.0.1:$Port/";repos=$repos}|ConvertTo-Json -Compress
