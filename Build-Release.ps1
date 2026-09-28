[CmdletBinding()]
param([string]$Version='1.1.0')
$ErrorActionPreference='Stop'
if($Version -notmatch '^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?$'){throw 'Invalid version'}
$root=$PSScriptRoot
& (Join-Path $root 'Build-GitDeck.ps1')
$dist=Join-Path $root 'dist'
[void](New-Item -ItemType Directory -Path $dist -Force)
$stage=Join-Path $dist ('stage-'+[guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $stage)
# Explicit allowlist: never package local inventories, logs, jobs or credentials.
$files=@('GitDeck.exe','GitDeck.ico','git-dashboard.bat','git-dashboard-server.ps1','git-job-worker.ps1','git-repo-manager.bat','git-repo-manager.ps1','README.md','LICENSE')
foreach($file in $files){Copy-Item -LiteralPath (Join-Path $root $file) -Destination $stage}
[void](New-Item -ItemType Directory -Path (Join-Path $stage 'web'))
foreach($file in @('index.html','app.js','release-tools.js','release-ui.js','favicon.svg','styles.css','workspace.css','search.css','scan.css','gitlab.css')){
    Copy-Item -LiteralPath (Join-Path $root ('web/'+$file)) -Destination (Join-Path $stage 'web')
}
$zip=Join-Path $dist "GitDeck-$Version-windows.zip"
if(Test-Path -LiteralPath $zip){throw 'Release ZIP already exists; choose a new version or move the old ZIP first.'}
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip
$hash=(Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText(($zip+'.sha256'),($hash+'  '+[IO.Path]::GetFileName($zip)+"`n"))
Write-Host "Release: $zip"
Write-Host "SHA256: $hash"
