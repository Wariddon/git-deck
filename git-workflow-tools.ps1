# Read-only lightweight snapshots; no network access or history graph traversal.
function Get-WorkflowStatus([string]$Path) {
    Assert-Registered $Path
    $timer=[Diagnostics.Stopwatch]::StartNew()
    $result=Invoke-GitCapture $Path @('status','--porcelain=v1')
    if($result.Code -ne 0){throw $result.Output}
    $files=New-Object 'System.Collections.Generic.List[object]'
    $protected=New-Object 'System.Collections.Generic.List[string]'
    foreach($line in @($result.Output -split "`r?`n" | Where-Object {$_})){
        if(Test-GitDeckProtectedStatusLine $line){$protected.Add($line.Substring(3));continue}
        if($line.Length -lt 4){continue}
        $index=$line.Substring(0,1);$work=$line.Substring(1,1)
        $files.Add(@{status=$line.Substring(0,2);path=$line.Substring(3);indexStatus=$index;worktreeStatus=$work;staged=($index -ne ' ' -and $index -ne '?');unstaged=($work -ne ' ' -or $line.StartsWith('??'))})
    }
    $branch=(Invoke-GitOrThrow $Path @('branch','--show-current')).Trim()
    $head=Invoke-GitCapture $Path @('rev-parse','--verify','HEAD')
    $operation=Get-GitOperationState $Path
    $timer.Stop()
    return @{branch=$branch;head=$(if($head.Code -eq 0){$head.Output.Trim()}else{''});files=$files.ToArray();operation=$operation;protectedUntracked=@{count=$protected.Count;paths=$protected.ToArray()};checkedAt=[DateTime]::UtcNow.ToString('o');gitMs=$timer.ElapsedMilliseconds}
}

function Get-CheckoutReview([string]$Path,[string]$Target) {
    $status=Get-WorkflowStatus $Path
    $hash=Resolve-GitRef $Path $Target
    $files=@();$ahead=0;$behind=0
    if($status.head){
        $counts=(Invoke-GitOrThrow $Path @('rev-list','--left-right','--count',($status.head+'...'+$hash))).Trim() -split '\s+'
        $ahead=[int]$counts[0];$behind=[int]$counts[1]
        $files=@((Invoke-GitOrThrow $Path @('diff','--name-only',$status.head,$hash,'--')) -split "`r?`n" | Where-Object {$_})
    }
    return @{status=$status;target=$Target;targetHash=$hash;currentOnly=$ahead;targetOnly=$behind;changedFiles=$files;blocked=($status.files.Count -gt 0 -or $status.operation.active)}
}

function New-TrainingRepository {
    # Always create a fresh, isolated child; never accept a user-supplied destination.
    $base=Join-Path $script:Root 'sandboxes'
    [void](New-Item -ItemType Directory -Path $base -Force)
    $path=Join-Path $base ('practice-'+[guid]::NewGuid().ToString('N'))
    [void](New-Item -ItemType Directory -Path $path -ErrorAction Stop)
    [void](Invoke-GitOrThrow $path @('init','--template=','-b','main'))
    $hooks=Join-Path $path '.git\training-no-hooks';[void](New-Item -ItemType Directory -Path $hooks)
    [void](Invoke-GitOrThrow $path @('config','core.hooksPath',$hooks))
    [void](Invoke-GitOrThrow $path @('config','user.name','Git Deck Practice'))
    [void](Invoke-GitOrThrow $path @('config','user.email','practice@example.invalid'))
    [void](Invoke-GitOrThrow $path @('config','commit.gpgsign','false'))
    $utf8=New-Object Text.UTF8Encoding($false)
    [IO.File]::WriteAllText((Join-Path $path 'lesson.txt'),"color=blue`n",$utf8)
    [IO.File]::WriteAllText((Join-Path $path 'README.md'),"# Git Deck practice`nNo remote. This disposable repository is separate from your projects.`n1. Edit lesson.txt, stage and commit.`n2. Create a branch and switch back to main.`n3. Merge lesson/conflict into main to practice a conflict.`n4. Use Conflict Center to resolve, or abort the merge.`n",$utf8)
    [void](Invoke-GitOrThrow $path @('add','--','README.md','lesson.txt'))
    [void](Invoke-GitOrThrow $path @('-c','core.hooksPath=NUL','commit','-m','Practice: initial commit'))
    [void](Invoke-GitOrThrow $path @('switch','-c','lesson/conflict'))
    [IO.File]::WriteAllText((Join-Path $path 'lesson.txt'),"color=green`n",$utf8)
    [void](Invoke-GitOrThrow $path @('add','--','lesson.txt'))
    [void](Invoke-GitOrThrow $path @('-c','core.hooksPath=NUL','commit','-m','Practice: feature color'))
    [void](Invoke-GitOrThrow $path @('switch','main'))
    [IO.File]::WriteAllText((Join-Path $path 'lesson.txt'),"color=red`n",$utf8)
    [void](Invoke-GitOrThrow $path @('add','--','lesson.txt'))
    [void](Invoke-GitOrThrow $path @('-c','core.hooksPath=NUL','commit','-m','Practice: main color'))
    [IO.File]::WriteAllText((Join-Path $path 'notes.txt'),"My first practice commit`n",$utf8)
    Save-Repositories (@(Get-Repositories)+$path)
    return @{message='Practice repository created. No remote configured.';path=$path;name=(Split-Path $path -Leaf)}
}
