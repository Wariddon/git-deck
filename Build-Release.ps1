[CmdletBinding()]
param([string]$Version='1.3.0')
$ErrorActionPreference='Stop'
if($Version -notmatch '^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?$'){throw 'Invalid version'}
$root=$PSScriptRoot
& (Join-Path $root 'Build-GitDeck.ps1')
$dist=Join-Path $root 'dist'
[void](New-Item -ItemType Directory -Path $dist -Force)
$stage=Join-Path $dist ('stage-'+[guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $stage)
# Explicit allowlist: never package local inventories, logs, jobs or credentials.
$files=@('GitDeck.exe','GitDeck.ico','git-dashboard.bat','git-dashboard-server.ps1','git-workflow-tools.ps1','git-diff-content.ps1','git-job-worker.ps1','git-repo-manager.bat','git-repo-manager.ps1','README.md','LICENSE')
foreach($file in $files){Copy-Item -LiteralPath (Join-Path $root $file) -Destination $stage}
[void](New-Item -ItemType Directory -Path (Join-Path $stage 'web'))
# Every web asset the server can serve (flat .html/.js/.css/.svg files).
foreach($file in @(Get-ChildItem -LiteralPath (Join-Path $root 'web') -File | Where-Object { $_.Extension -in @('.html','.js','.css','.svg') })){
    Copy-Item -LiteralPath $file.FullName -Destination (Join-Path $stage 'web')
}
[void](New-Item -ItemType Directory -Path (Join-Path $stage 'lib'))
foreach($file in @(Get-ChildItem -LiteralPath (Join-Path $root 'lib') -Filter '*.ps1' -File)){
    Copy-Item -LiteralPath $file.FullName -Destination (Join-Path $stage 'lib')
}
$zip=Join-Path $dist "GitDeck-$Version-windows.zip"
[void](New-Item -ItemType Directory -Path (Join-Path $stage 'assets/brand') -Force)
Copy-Item -LiteralPath (Join-Path $root 'assets/brand/git-deck-banner.png') -Destination (Join-Path $stage 'assets/brand/git-deck-banner.png')
if(Test-Path -LiteralPath $zip){throw 'Release ZIP already exists; choose a new version or move the old ZIP first.'}
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip
$hash=(Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText(($zip+'.sha256'),($hash+'  '+[IO.Path]::GetFileName($zip)+"`n"))
Write-Host "Release: $zip"
Write-Host "SHA256: $hash"
