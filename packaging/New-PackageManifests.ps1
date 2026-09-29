[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Version,
    [string]$Repository = 'Wariddon/git-deck',
    [string]$OutputDir = ''
)
# Generates Scoop and winget manifests for a published GitHub release.
# 1. .\Build-Release.ps1 -Version 1.2.0
# 2. Create GitHub release v1.2.0 and upload dist\GitDeck-1.2.0-windows.zip
# 3. .\packaging\New-PackageManifests.ps1 -Version 1.2.0
# The SHA256 is read from dist\GitDeck-<version>-windows.zip.sha256 so the
# manifests always match the uploaded file.
$ErrorActionPreference = 'Stop'
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw 'Use a plain x.y.z version for package managers.' }
$root = Split-Path $PSScriptRoot -Parent
if (-not $OutputDir) { $OutputDir = Join-Path $root 'dist\packaging' }
$zipName = "GitDeck-$Version-windows.zip"
$hashFile = Join-Path $root "dist\$zipName.sha256"
if (-not (Test-Path -LiteralPath $hashFile -PathType Leaf)) { throw "Missing $hashFile. Run Build-Release.ps1 -Version $Version first." }
$sha = ((Get-Content -LiteralPath $hashFile -Raw).Trim() -split '\s+')[0].ToLowerInvariant()
if ($sha -notmatch '^[0-9a-f]{64}$') { throw 'Invalid SHA256 file.' }
$url = "https://github.com/$Repository/releases/download/v$Version/$zipName"
$utf8 = New-Object Text.UTF8Encoding($false)
[void](New-Item -ItemType Directory -Path $OutputDir -Force)

# Scoop: add to a bucket repository, then `scoop install git-deck`.
$scoop = [ordered]@{
    version = $Version
    description = 'Compact local Git workspace for Windows with a browser-based UI.'
    homepage = "https://github.com/$Repository"
    license = 'MIT'
    depends = 'git'
    url = $url
    hash = $sha
    bin = 'GitDeck.exe'
    shortcuts = @(,@('GitDeck.exe', 'Git Deck'))
    persist = @('git-repositories.txt', 'git-scan-locations.txt', 'git-deck-ui-state.json', 'git-action-journal.json', 'git-deck-ai.json')
    checkver = [ordered]@{ github = "https://github.com/$Repository" }
    autoupdate = [ordered]@{ url = "https://github.com/$Repository/releases/download/v`$version/GitDeck-`$version-windows.zip"; hash = [ordered]@{ url = '$url.sha256' } }
}
[IO.File]::WriteAllText((Join-Path $OutputDir 'git-deck.json'), ($scoop | ConvertTo-Json -Depth 6), $utf8)

# winget: portable zip. Submit the folder to microsoft/winget-pkgs after `winget validate`.
$id = 'Wariddon.GitDeck'
$wingetDir = Join-Path $OutputDir "winget\$Version"
[void](New-Item -ItemType Directory -Path $wingetDir -Force)
$common = "PackageIdentifier: $id`nPackageVersion: $Version`n"
[IO.File]::WriteAllText((Join-Path $wingetDir "$id.yaml"), ("# yaml-language-server: `$schema=https://aka.ms/winget-manifest.version.1.6.0.schema.json`n" + $common + "DefaultLocale: en-US`nManifestType: version`nManifestVersion: 1.6.0`n"), $utf8)
[IO.File]::WriteAllText((Join-Path $wingetDir "$id.installer.yaml"), ("# yaml-language-server: `$schema=https://aka.ms/winget-manifest.installer.1.6.0.schema.json`n" + $common + @"
InstallerType: zip
NestedInstallerType: portable
NestedInstallerFiles:
- RelativeFilePath: GitDeck.exe
  PortableCommandAlias: gitdeck
Dependencies:
  PackageDependencies:
  - PackageIdentifier: Git.Git
Installers:
- Architecture: neutral
  InstallerUrl: $url
  InstallerSha256: $($sha.ToUpperInvariant())
ManifestType: installer
ManifestVersion: 1.6.0

"@), $utf8)
[IO.File]::WriteAllText((Join-Path $wingetDir "$id.locale.en-US.yaml"), ("# yaml-language-server: `$schema=https://aka.ms/winget-manifest.defaultLocale.1.6.0.schema.json`n" + $common + @"
PackageLocale: en-US
Publisher: Wariddon Rattanamalee
PackageName: Git Deck
License: MIT
LicenseUrl: https://github.com/$Repository/blob/main/LICENSE
PackageUrl: https://github.com/$Repository
ShortDescription: Compact local Git workspace for Windows with a browser-based UI.
Tags:
- git
- gui
- gitlab
- github
ManifestType: defaultLocale
ManifestVersion: 1.6.0

"@), $utf8)
Write-Host "Scoop manifest:  $(Join-Path $OutputDir 'git-deck.json')"
Write-Host "winget manifest: $wingetDir"
