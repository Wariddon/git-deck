$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$tokens=$null;$errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $root 'git-dashboard-server.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Server parse failed'}
foreach($name in @('Invoke-GitCapture','Invoke-GitOrThrow','Get-GitOperationState','Get-GitDeckVisibleStatusLines','Test-GitDeckProtectedStatusLine','Test-GitDeckProtectedPath','Assert-CommitHash')){
    $fn=$ast.FindAll({param($n)$n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$false)[0]
    if(-not $fn){throw "Missing server function $name"}
    $definition=$fn.Extent.Text
    if($name -eq 'Invoke-GitCapture'){$definition=$definition.Replace('$items =',("`$ErrorActionPreference='Continue'`n    `$items ="))}
    . ([scriptblock]::Create($definition))
}
. (Join-Path $root 'lib\GitDeck.Pull.ps1')
. (Join-Path $root 'lib\GitDeck.Switch.ps1')
. (Join-Path $root 'lib\GitDeck.Parity.ps1')
function Run-Git([string]$Path,[string[]]$Arguments){[void](Invoke-GitOrThrow $Path $Arguments)}
function Write-Text([string]$File,[string]$Text){[IO.File]::WriteAllText($File,$Text)}
function Refused([scriptblock]$Block,[string]$Pattern){try{& $Block|Out-Null;return $false}catch{return $_.Exception.Message -match $Pattern}}

$base=Join-Path $root ('output\parity-test-'+[guid]::NewGuid().ToString('N'))
try{
    [void](New-Item -ItemType Directory -Path $base)
    $repo=Join-Path $base 'repo'
    Run-Git $base @('init','-q','-b','main',$repo)
    Run-Git $repo @('config','user.email','t@example.test');Run-Git $repo @('config','user.name','Test');Run-Git $repo @('config','core.autocrlf','false')
    $lines="a`nb`nc`nd`ne`nf`ng`n"
    Write-Text (Join-Path $repo 'app.txt') $lines;Write-Text (Join-Path $repo 'debug.log') "log`n"
    [IO.File]::WriteAllBytes((Join-Path $repo 'image.bin'),[byte[]](0..255))
    Run-Git $repo @('add','.');Run-Git $repo @('commit','-q','-m','first')
    $first=(Invoke-GitOrThrow $repo @('rev-parse','HEAD')).Trim()
    Write-Text (Join-Path $repo 'app.txt') ($lines -replace 'a','A');Run-Git $repo @('commit','-qam','second')

    # Paths are confined to the working tree.
    if(-not (Refused {Resolve-GitDeckRepoFile $repo '..\outside.txt'} 'outside')){throw 'Path escape must be refused'}
    if(-not (Refused {Resolve-GitDeckRepoFile $repo '.git/config'} 'internals')){throw '.git must be refused'}
    if(-not (Refused {Resolve-GitDeckRepoFile $repo '-rf'} 'required')){throw 'Option-like paths must be refused'}

    # Ignore: appended once, tracked matches reported.
    $result=Add-GitDeckIgnorePattern $repo '*.log'
    if((Get-Content -Raw (Join-Path $repo '.gitignore')) -ne "*.log`n" -or $result.message -notmatch '1 tracked file'){throw "Ignore pattern not written or tracked match not reported: $($result.message)"}
    if((Add-GitDeckIgnorePattern $repo '*.log').message -notmatch 'already'){throw 'Duplicate pattern must not be appended twice'}
    if(-not (Refused {Add-GitDeckIgnorePattern $repo "a`nb"} 'Invalid')){throw 'Multi-line pattern must be refused'}

    # Stop tracking keeps the file on disk.
    [void](Stop-GitDeckTracking $repo 'debug.log')
    if(-not (Test-Path (Join-Path $repo 'debug.log'))){throw 'Stop tracking must keep the file'}
    if((Invoke-GitOrThrow $repo @('status','--porcelain','--','debug.log')).Trim() -ne 'D  debug.log'){throw 'File should be staged for removal from Git'}
    if(-not (Refused {Stop-GitDeckTracking $repo 'nope.txt'} 'not tracked')){throw 'Untracked path must be refused'}
    Run-Git $repo @('reset','-q','--','debug.log')

    # Recycle refuses tracked files (actual Recycle Bin use is not exercised in tests).
    if(-not (Refused {Remove-GitDeckUntracked $repo 'app.txt'} 'Only untracked')){throw 'Tracked file must not be recycled'}

    # Open a revision: binary-safe copy; runnable files are detected.
    $saved=Save-GitDeckRevision $repo $first 'image.bin'
    if([Convert]::ToBase64String([IO.File]::ReadAllBytes($saved)) -ne [Convert]::ToBase64String([byte[]](0..255))){throw 'Revision copy is not byte-identical'}
    if((Get-Content -Raw (Save-GitDeckRevision $repo $first 'app.txt')) -ne $lines){throw 'Old text revision not saved'}
    if(-not (Test-GitDeckRunnableFile 'x\run.bat') -or -not (Test-GitDeckRunnableFile 'x\a.ps1') -or (Test-GitDeckRunnableFile 'x\a.txt')){throw 'Runnable file detection is wrong'}
    if(-not (Refused {Save-GitDeckRevision $repo $first 'missing.txt'} 'does not exist')){throw 'Missing file must be refused'}

    # Reset a file to a commit: refused with local changes, otherwise restores the old content.
    Write-Text (Join-Path $repo 'app.txt') "dirty`n"
    if(-not (Refused {Restore-GitDeckFileAt $repo $first 'app.txt'} 'uncommitted')){throw 'Reset over local changes must be refused'}
    Run-Git $repo @('checkout','--','app.txt')
    [void](Restore-GitDeckFileAt $repo $first 'app.txt')
    if((Get-Content -Raw (Join-Path $repo 'app.txt')) -ne $lines){throw 'File was not reset to the first commit'}
    Run-Git $repo @('checkout','--','app.txt')

    # Stash apply/pop onto work in progress, like Sourcetree.
    Write-Text (Join-Path $repo 'app.txt') ($lines -replace 'g','G local')
    Run-Git $repo @('stash','push','-q','-m','one')
    Write-Text (Join-Path $repo 'image.txt') "unrelated work`n"
    $result=Invoke-GitDeckStashRestore $repo 'pop' 'stash@{0}'
    if($result.conflicts.Count -or (Get-Content -Raw (Join-Path $repo 'app.txt')) -notmatch 'G local' -or -not (Test-Path (Join-Path $repo 'image.txt'))){throw 'Pop onto unrelated work should just apply'}
    Run-Git $repo @('stash','push','-q','-u','-m','two')
    Write-Text (Join-Path $repo 'app.txt') ($lines -replace 'g','G other')
    if(-not (Refused {Invoke-GitDeckStashRestore $repo 'apply' 'stash@{0}'} 'Nothing was changed')){throw 'Apply over an overlapping local edit must be refused without changes'}
    if((Get-Content -Raw (Join-Path $repo 'app.txt')) -notmatch 'G other'){throw 'Refused apply must leave local work untouched'}
    Run-Git $repo @('commit','-qam','other')
    $result=Invoke-GitDeckStashRestore $repo 'pop' 'stash@{0}'
    if($result.conflicts -notcontains 'app.txt' -or -not $result.stashKept){throw 'Conflicting pop must report the file and keep the stash'}
    # External diff (VS Code mocked): commit = before vs after that commit; no commit = HEAD vs working copy.
    Run-Git $repo @('checkout','-f','-q','HEAD');Run-Git $repo @('stash','clear')
    function Get-Command { param($Name) [pscustomobject]@{ Source = 'C:\fake\code.cmd' } }
    function Start-Process { param($FilePath,$ArgumentList) $script:launched = @{ file = $FilePath; args = @($ArgumentList) } }
    $second=(Invoke-GitOrThrow $repo @('rev-parse','HEAD~1')).Trim()
    [void](Open-GitDeckExternalDiff $repo 'app.txt' $second)
    if($script:launched.file -ne 'C:\fake\code.cmd' -or $script:launched.args[0] -ne '--diff'){throw 'VS Code must be started with --diff'}
    $left=$script:launched.args[1].Trim('"');$right=$script:launched.args[2].Trim('"')
    if((Get-Content -Raw $left) -ne $lines -or (Get-Content -Raw $right) -ne ($lines -replace 'a','A')){throw 'Commit diff must show the file before and after that commit'}
    Write-Text (Join-Path $repo 'app.txt') "working`n"
    [void](Open-GitDeckExternalDiff $repo 'app.txt' '')
    if($script:launched.args[2].Trim('"') -ne (Join-Path $repo 'app.txt')){throw 'Working diff must compare against the working file itself'}
    Remove-Item Function:\Get-Command,Function:\Start-Process
    'PASS: ignore, stop tracking, recycle guard, binary-safe revision, reset file to commit, stash apply/pop onto work in progress, external diff'
} finally {
    if(Test-Path $base){Remove-Item -Recurse -Force $base -ErrorAction SilentlyContinue}
}
