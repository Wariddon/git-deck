$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$script:Root=$root
. (Join-Path $root 'lib\GitDeck.Features.ps1')
. (Join-Path $root 'lib\GitDeck.Ai.ps1')
. (Join-Path $root 'lib\GitDeck.Runtime.ps1')

# Secret scanning only looks at added lines and never echoes the secret.
$patch="commit:abc1234`ndiff --git a/app.cfg b/app.cfg`n+++ b/app.cfg`n+aws_key = AKIAABCDEFGHIJKLMNOP`n-old = AKIAZZZZZZZZZZZZZZZZ`n+token: `"ghp_abcdefghijklmnopqrstuvwxyz0123456789`"`n+password = `"correct-horse-battery`"`n+plain line"
$found=@(Find-GitDeckSecrets $patch)
if($found.Count -ne 3){throw "Expected 3 findings, got $($found.Count)"}
if($found[0].rule -ne 'aws-key' -or $found[0].file -ne 'app.cfg' -or $found[0].commit -ne 'abc1234'){throw 'AWS key finding is wrong'}
if($found[1].rule -ne 'github-token' -or $found[2].level -ne 'warn'){throw 'Token or assignment finding is wrong'}
foreach($item in $found){if($item.preview -match 'AKIAABCDEFGHIJKLMNOP|abcdefghijklmnopqrstuvwxyz|correct-horse'){throw "Secret leaked in preview: $($item.preview)"}}
if(@(Find-GitDeckSecrets "+const url = 'https://example.com/docs'").Count){throw 'Plain URL must not be flagged'}

# Protected branch names.
foreach($name in @('main','master','release/1.2','production')){if(-not (Test-GitDeckProtectedBranch $name)){throw "$name should be protected"}}
if(Test-GitDeckProtectedBranch 'feature/login'){throw 'feature branch is not protected'}

# GitHub remote parsing.
function Get-OriginUrl($Path){return $script:origin}
foreach($case in @(@('https://github.com/acme/demo.git','acme/demo'),@('git@github.com:acme/demo.git','acme/demo'),@('ssh://git@github.com/acme/demo','acme/demo'),@('https://gitlab.com/acme/demo.git',''))){
  $script:origin=$case[0];$slug=Get-GitHubRepoSlug 'x';if($slug -ne $case[1]){throw "Slug for $($case[0]) was '$slug'"}
}

# Static file names: flat names inside web/ only.
foreach($ok in @('/','/app.js','/features.css','/favicon.svg')){if(-not (Get-GitDeckStaticPath $ok)){throw "$ok should be served"}}
foreach($bad in @('/../git-repositories.txt','/lib/x.js','/.gitignore','/app.ps1','/a/b.css','/%2e%2e/x.js')){if(Get-GitDeckStaticPath $bad){throw "$bad must not be served"}}

# Live events ignore Git internals and noisy folders but keep refs/index.
$repo=[IO.Path]::Combine([IO.Path]::GetTempPath(),'gd-repo')
$sep=[IO.Path]::DirectorySeparatorChar
$cases=@(@('src/a.txt','files'),@('.git/index','refs'),@('.git/refs/heads/main','refs'),@('.git/objects/ab/cdef',''),@('.git/index.lock',''),@('node_modules/x/y.js',''))
foreach($case in $cases){$kind=Test-GitDeckRelevantChange $repo ($repo+$sep+($case[0] -replace '/',$sep));if($kind -ne $case[1]){throw "Change $($case[0]) classified as '$kind'"}}

# AI request: Anthropic payload shape, refusal and code-fence handling (HTTP mocked).
function Assert-Registered($Path){}
$script:diffText="diff --git a/f.txt b/f.txt`n+++ b/f.txt`n+hello"
function Invoke-GitCapture($Path,$Arguments){if($Arguments -contains '--cached' -and $Arguments -contains '-U3'){return @{Code=0;Output=$script:diffText}};if($Arguments[0] -eq 'branch'){return @{Code=0;Output='feature/x'}};return @{Code=0;Output='feat: earlier work'}}
$env:ANTHROPIC_API_KEY='test-key';$env:GITDECK_AI_PROVIDER='';$env:GITDECK_AI_MODEL=''
$script:Root=[IO.Path]::Combine([IO.Path]::GetTempPath(),'gd-no-config-'+[guid]::NewGuid().ToString('N'))  # never read a real git-deck-ai.json
function Invoke-GitDeckHttpJson($Uri,$Headers,$Body,$TimeoutSec){$script:sent=@{uri=$Uri;headers=$Headers;body=$Body};return $script:reply}
$script:reply=[pscustomobject]@{stop_reason='end_turn';content=@([pscustomobject]@{type='thinking';thinking=''},[pscustomobject]@{type='text';text="``````text`nfix: handle empty input`n``````"})}
$result=New-AiCommitMessage 'repo' 'conventional'
if($result.message -ne 'fix: handle empty input'){throw "Unexpected message '$($result.message)'"}
if($script:sent.uri -ne 'https://api.anthropic.com/v1/messages'){throw 'Wrong endpoint'}
if($script:sent.body.model -ne 'claude-opus-5-5' -or $script:sent.body.fallbacks -ne 'default' -or $script:sent.body.output_config.effort -ne 'low'){throw 'Unexpected request body'}
if($script:sent.headers['anthropic-version'] -ne '2023-06-01' -or $script:sent.headers['anthropic-beta'] -ne 'server-side-fallback-2026-07-01' -or $script:sent.headers['x-api-key'] -ne 'test-key'){throw 'Unexpected headers'}
if($script:sent.body.messages[0].content -notmatch 'Conventional Commits|<diff>'){throw 'Prompt is missing the diff'}
$script:reply=[pscustomobject]@{stop_reason='refusal';content=@()}
$blocked=$false;try{New-AiCommitMessage 'repo' 'plain'|Out-Null}catch{$blocked=$_.Exception.Message -match 'declined'};if(-not $blocked){throw 'Refusal must surface as an error'}
$script:diffText="diff --git a/k b/k`n+++ b/k`n+-----BEGIN RSA PRIVATE KEY-----"
$blocked=$false;try{New-AiCommitMessage 'repo' 'plain'|Out-Null}catch{$blocked=$_.Exception.Message -match 'secret'};if(-not $blocked){throw 'Diffs with secrets must never be sent'}
$env:ANTHROPIC_API_KEY=''

# App window: Edge --app when installed, default browser otherwise; the launcher opens its own window.
function Start-Process { param($FilePath,$ArgumentList) $script:opened=@{file=$FilePath;args=@($ArgumentList)} }
function Get-GitDeckEdgePath { return 'C:\Edge\msedge.exe' }
Open-GitDeckWindow 'http://127.0.0.1:8765/'
if($script:opened.file -ne 'C:\Edge\msedge.exe' -or $script:opened.args[0] -ne '--app="http://127.0.0.1:8765/"'){throw 'Edge must open Git Deck as an app window'}
function Get-GitDeckEdgePath { return $null }
Open-GitDeckWindow 'http://127.0.0.1:8765/'
if($script:opened.file -ne 'http://127.0.0.1:8765/'){throw 'Without Edge the default browser opens the URL'}
Remove-Item Function:\Start-Process
$launcher=Get-Content -Raw (Join-Path (Split-Path $PSScriptRoot -Parent) 'launcher\GitDeckLauncher.cs')  # $root was reassigned via $script:Root
if($launcher -notmatch '-NoBrowser -IdleShutdownSeconds'){throw 'The launcher must start the server with -NoBrowser (it opens its own window)'}
'PASS: secret scan, protected branches, GitHub slugs, static paths, change filter, AI request, app window'
