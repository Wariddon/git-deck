$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
. (Join-Path $root 'lib\GitDeck.Parity.ps1')
. (Join-Path $root 'lib\GitDeck.CustomActions.ps1')
$repo=[IO.Path]::Combine([IO.Path]::GetTempPath(),'gd-custom-'+[guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $repo)
$script:CustomActionsFile=Join-Path $repo 'actions.json'
function Assert-Registered($Path){}
try {
    # Saving validates and gives each action an id; one action round-trips as an array (PS 5.1 quirk).
    $saved=Save-GitDeckCustomActions @([pscustomobject]@{name='Echo';command='cmd.exe';arguments='/c echo $SHA $FILE';targets=@('commit','file','bogus');showOutput=$true})
    $actions=@(Get-GitDeckCustomActions)
    if($actions.Count -ne 1 -or -not $actions[0].id){throw 'One saved action with an id expected'}
    if((@($actions[0].targets) -join ',') -ne 'commit,file'){throw 'Unknown targets are dropped'}
    $bad=$false;try{Save-GitDeckCustomActions @([pscustomobject]@{name='';command='x';targets=@('repo')})|Out-Null}catch{$bad=$true};if(-not $bad){throw 'A name is required'}
    $bad=$false;try{Save-GitDeckCustomActions @([pscustomobject]@{name='x';command='x';targets=@()})|Out-Null}catch{$bad=$true};if(-not $bad){throw 'A target is required'}

    # Placeholders become single quoted arguments, also when the user already quoted them.
    $expanded=Expand-GitDeckCustomArguments '--sha $SHA --file "$FILE" $REPO' @{SHA='abc123';FILE='C:\a b\c.txt';REPO='C:\r'}
    if($expanded -ne '--sha "abc123" --file "C:\a b\c.txt" "C:\r"'){throw "Unexpected expansion: $expanded"}
    $bad=$false;try{Expand-GitDeckCustomArguments 'x $BRANCH' @{REPO='C:\r'}|Out-Null}catch{$bad=$_.Exception.Message -match 'BRANCH'};if(-not $bad){throw 'A missing value must be named'}

    # Running with output: values are validated (paths stay inside the repository) and output comes back.
    Set-Content -LiteralPath (Join-Path $repo 'a.txt') -Value 'x'
    $result=Invoke-GitDeckCustomAction $repo $actions[0].id ([pscustomobject]@{sha='abc1234';file='a.txt'})
    if($result.output -notmatch 'abc1234' -or $result.output -notmatch 'a\.txt'){throw "Output missing values: $($result.output)"}
    $bad=$false;try{Invoke-GitDeckCustomAction $repo $actions[0].id ([pscustomobject]@{sha='abc1234';file='..\outside.txt'})|Out-Null}catch{$bad=$true};if(-not $bad){throw 'Files outside the repository are refused'}
    $bad=$false;try{Invoke-GitDeckCustomAction $repo $actions[0].id ([pscustomobject]@{sha='not-a-sha';file='a.txt'})|Out-Null}catch{$bad=$true};if(-not $bad){throw 'Invalid SHA is refused'}
    $server=Get-Content -Raw (Join-Path $root 'git-dashboard-server.ps1')
    if($server -notmatch "lib\\GitDeck\.CustomActions\.ps1" -or $server -notmatch "'/api/custom-actions'"){throw 'Server must load custom actions and list them'}
    # Saving is global (no repository): it must come before the "registered repository" check.
    $save=$server.IndexOf("'custom-actions-save' { return Save-GitDeckCustomActions");$guard=$server.IndexOf("default { Assert-Registered `$path }")
    if($save -lt 0 -or $save -gt $guard){throw 'custom-actions-save must be handled before Assert-Registered'}
    if((Get-Content -Raw (Join-Path $root '.gitignore')) -notmatch 'git-deck-custom-actions\.json'){throw 'The actions file stays out of Git'}
} finally { Remove-Item -LiteralPath $repo -Recurse -Force -ErrorAction SilentlyContinue }
'PASS: custom actions save, fill $REPO/$SHA/$FILE/$BRANCH safely and run with output'
