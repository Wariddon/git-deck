# Task state is local only. Never persist file contents, credentials, logs or arbitrary commands.
$script:CockpitFile = Join-Path (Split-Path $PSScriptRoot -Parent) 'git-deck-tasks.json'

function Get-GitDeckTaskStore {
    if (-not (Test-Path -LiteralPath $script:CockpitFile -PathType Leaf)) { return @{schema=1;capsules=@();recipes=@()} }
    try {
        if ((Get-Item -LiteralPath $script:CockpitFile).Length -gt 2MB) { throw 'Too large' }
        $data = Get-Content -LiteralPath $script:CockpitFile -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop
        if ($data.schema -ne 1 -or $data.capsules -isnot [Array] -or $data.recipes -isnot [Array]) { throw 'Invalid schema' }
        if ($data.capsules.Count -gt 100 -or $data.recipes.Count -gt 50) { throw 'Invalid limits' }
        foreach ($item in @($data.capsules)+@($data.recipes)) {
            if ($item -isnot [PSCustomObject] -or $item.id -notmatch '^[0-9a-f-]{36}$' -or -not $item.updatedAt) { throw 'Invalid entry' }
            if ($item.repos -isnot [Array] -or $item.repos.Count -lt 1 -or $item.repos.Count -gt 20) { throw 'Invalid repository scope' }
            foreach ($repo in $item.repos) { if (-not ($repo.path -is [string]) -or -not $repo.path) { throw 'Invalid saved repository' } }
        }
        foreach ($item in $data.capsules) {
            if ($item.key -notmatch '^[A-Z][A-Z0-9]{1,9}-[0-9]{1,12}$' -or $item.next -notin @('review','test','push','request-review','check-environment') -or $item.views -isnot [Array]) { throw 'Invalid capsule' }
        }
        foreach ($item in $data.recipes) {
            if ($item.recipe -ne 'review-changes' -or $item.state -notin @('preview','blocked','completed')) { throw 'Invalid recipe' }
            foreach ($repo in $item.repos) {
                if ($repo.steps -isnot [Array] -or $repo.steps.Count -ne 3 -or $repo.basis -notmatch '^[0-9a-f]{64}$') { throw 'Invalid recipe steps' }
                if ((@($repo.steps.name) -join ',') -ne 'status,diff-summary,whitespace') { throw 'Invalid recipe step order' }
            }
        }
        return $data
    } catch { throw 'Task state could not be read. The existing file has been preserved.' }
}

function Update-GitDeckTaskStore([scriptblock]$Update) {
    $hash = [Security.Cryptography.SHA256]::Create()
    try { $key = [BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($script:CockpitFile.ToLowerInvariant()))).Replace('-','') } finally { $hash.Dispose() }
    $mutex = New-Object Threading.Mutex($false, ('Local\GitDeckTasks_'+$key)); $locked=$false
    try {
        try { $locked=$mutex.WaitOne(5000) } catch [Threading.AbandonedMutexException] { $locked=$true }
        if (-not $locked) { throw 'Task state is busy. Try again.' }
        $data=Get-GitDeckTaskStore
        $result=& $Update $data
        $temp=$script:CockpitFile+'.'+[guid]::NewGuid().ToString('N')+'.tmp'
        try {
            $json=$data|ConvertTo-Json -Depth 12
            if ([Text.Encoding]::UTF8.GetByteCount($json) -gt 2MB) { throw 'Task state is full. Remove an old entry first.' }
            [IO.File]::WriteAllText($temp,$json,(New-Object Text.UTF8Encoding($false)))
            if (Test-Path -LiteralPath $script:CockpitFile) { [IO.File]::Replace($temp,$script:CockpitFile,[Management.Automation.Language.NullString]::Value) } else { [IO.File]::Move($temp,$script:CockpitFile) }
        } finally { if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Force } }
        return $result
    } finally { if ($locked) { $mutex.ReleaseMutex() }; $mutex.Dispose() }
}

function Get-GitDeckTaskSnapshot([string]$Path, [switch]$IncludeDiff) {
    Assert-Registered $Path
    $status=Invoke-GitCapture $Path @('status','--porcelain=v1','--branch','--untracked-files=normal')
    if ($status.Code -ne 0) { throw 'Cannot read repository status. No action was performed.' }
    $lines=@(([string]$status.Output)-split "`r?`n"|Where-Object { $_ })
    # Branch from the status header, and the Git folder plus HEAD in one rev-parse (HEAD is empty before the first commit).
    $branch=@{Output=(Get-GitDeckHeaderBranch $(if($lines.Count -and $lines[0].StartsWith('## ')){$lines[0].Substring(3)}else{''}))}
    $both=Invoke-GitCapture $Path @('rev-parse','--absolute-git-dir','--verify','-q','HEAD')
    $parts=@(([string]$both.Output)-split "`r?`n"|Where-Object { $_ })
    if($both.Code -eq 0 -and $parts.Count -ge 2){$gitDir=$parts[0];$head=@{Code=0;Output=$parts[1]}}
    else{$gitDir=([string](Invoke-GitCapture $Path @('rev-parse','--absolute-git-dir')).Output).Trim();$head=@{Code=1;Output=''}}
    $files=@($lines|Where-Object {-not $_.StartsWith('## ')});$ahead=0;$behind=0
    $header=if($lines.Count){$lines[0]}else{''}
    if($header -match 'ahead (\d+)'){$ahead=[int]$Matches[1]};if($header -match 'behind (\d+)'){$behind=[int]$Matches[1]}
    $diffText=''
    if($IncludeDiff){
        if($head.Code -ne 0){throw 'The review recipe needs an initial commit.'}
        $diff=Invoke-GitCapture $Path @('diff','--no-ext-diff','--no-textconv','--binary','HEAD','--')
        if($diff.Code -ne 0 -or ([string]$diff.Output).Length -gt 4000000){throw 'Tracked diff is unavailable or too large for this recipe.'}
        $diffText=[string]$diff.Output
    }
    $digest=[Security.Cryptography.SHA256]::Create()
    try { $basis=[BitConverter]::ToString($digest.ComputeHash([Text.Encoding]::UTF8.GetBytes(([string]$head.Output)+"`n"+([string]$branch.Output)+"`n"+([string]$status.Output)+"`n"+$diffText))).Replace('-','').ToLowerInvariant() } finally { $digest.Dispose() }
    $operationType=Get-GitDeckOperationType $gitDir
    return [ordered]@{path=$Path;branch=([string]$branch.Output).Trim();head=$(if($head.Code -eq 0){([string]$head.Output).Trim()}else{''});basis=$basis;changed=$files.Count;ahead=$ahead;behind=$behind;conflicts=@($files|Where-Object {$_ -match '^(UU|AA|DD|AU|UA|DU|UD) '}).Count;operation=$operationType;checkedAt=[DateTime]::UtcNow.ToString('o')}
}

function Save-GitDeckTaskCapsule($Body) {
    $key=([string]$Body.key).Trim().ToUpperInvariant()
    if($key -notmatch '^[A-Z][A-Z0-9]{1,9}-[0-9]{1,12}$'){throw 'Use a ticket key, for example PAY-123.'}
    $steps=@('review','test','push','request-review','check-environment')
    if([string]$Body.next -notin $steps){throw 'Choose a next step.'}
    $paths=@($Body.paths|Select-Object -Unique)
    if(-not $paths.Count -or $paths.Count -gt 20){throw 'Choose between 1 and 20 repositories.'}
    $repos=@(foreach($path in $paths){if($path -isnot [string]){throw 'Invalid repository path'};Get-GitDeckTaskSnapshot $path})
    $views=@(foreach($view in @($Body.views)){
        if($view.path -notin $paths -or $view.tab -notin @('history','changes','overview')){throw 'Invalid saved view'}
        $commit=[string]$view.commit;if($commit -and $commit -notmatch '^[0-9a-f]{40,64}$'){throw 'Use a full commit hash'}
        $file=[string]$view.file;if($file){$file=ConvertTo-GitDeckRepoFile $file}
        $scroll=0;if($view.scroll -and (-not [int]::TryParse([string]$view.scroll,[ref]$scroll) -or $scroll -lt 0 -or $scroll -gt 100000000)){throw 'Invalid view position'}
        [ordered]@{path=[string]$view.path;tab=[string]$view.tab;commit=$commit;file=$file;scroll=$scroll}
    })
    if($views.Count -gt 20){throw 'Too many saved views'}
    $entry=[ordered]@{id=[guid]::NewGuid().ToString();key=$key;next=[string]$Body.next;repos=$repos;views=$views;updatedAt=[DateTime]::UtcNow.ToString('o')}
    return Update-GitDeckTaskStore {param($data)
        if(@($data.capsules).Count -ge 100){throw 'Capsule limit reached. Remove an old capsule first.'}
        $data.capsules=@($entry)+@($data.capsules)
        @{message='Task capsule saved locally. No branch was changed.';capsule=$entry}
    }
}

function Remove-GitDeckTaskCapsule($Body) {
    if([string]$Body.id -notmatch '^[0-9a-f-]{36}$'){throw 'Invalid capsule ID'}
    return Update-GitDeckTaskStore {param($data)
        $item=@($data.capsules|Where-Object {$_.id -eq $Body.id})|Select-Object -First 1
        if(-not $item -or [string]$item.updatedAt -cne [string]$Body.expectedUpdatedAt){throw 'Capsule changed. Refresh and try again.'}
        $data.capsules=@($data.capsules|Where-Object {$_.id -ne $Body.id})
        @{message='Capsule removed from this computer.'}
    }
}

function New-GitDeckFleetRecipe($Body) {
    # v1 is deliberately read-only. Arbitrary commands and repository writes are not accepted.
    if([string]$Body.recipe -ne 'review-changes'){throw 'Choose the supported read-only review recipe.'}
    $paths=@($Body.paths|Select-Object -Unique)
    if(-not $paths.Count -or $paths.Count -gt 20){throw 'Preview between 1 and 20 repositories.'}
    $repos=@(foreach($path in $paths){if($path -isnot [string]){throw 'Invalid repository path'};$snap=Get-GitDeckTaskSnapshot $path -IncludeDiff;[ordered]@{path=$path;branch=$snap.branch;head=$snap.head;basis=$snap.basis;steps=@([ordered]@{name='status';state='pending'},[ordered]@{name='diff-summary';state='pending'},[ordered]@{name='whitespace';state='pending'});state='pending';reason=''}})
    $entry=[ordered]@{id=[guid]::NewGuid().ToString();recipe='review-changes';repos=$repos;state='preview';updatedAt=[DateTime]::UtcNow.ToString('o')}
    return Update-GitDeckTaskStore {param($data)
        if(@($data.recipes).Count -ge 50){throw 'Recipe history limit reached. Remove an old plan first.'}
        $data.recipes=@($entry)+@($data.recipes)
        @{message='Review plan ready. No commands have run beyond status reads.';plan=$entry}
    }
}

function Invoke-GitDeckFleetRecipe($Body) {
    if([string]$Body.id -notmatch '^[0-9a-f-]{36}$' -or $Body.approved -ne $true){throw 'Preview and explicitly approve the plan first.'}
    return Update-GitDeckTaskStore {param($data)
        $plan=@($data.recipes|Where-Object {$_.id -eq $Body.id})|Select-Object -First 1
        if(-not $plan -or [string]$plan.updatedAt -cne [string]$Body.expectedUpdatedAt){throw 'Plan changed. Refresh and approve it again.'}
        foreach($repo in $plan.repos){
            if($repo.state -eq 'completed'){continue}
            try {
                $snap=Get-GitDeckTaskSnapshot $repo.path -IncludeDiff
                if($snap.basis -cne $repo.basis){throw 'Repository changed since preview. Create a new plan.'}
                foreach($step in $repo.steps){
                    if($step.state -eq 'completed'){continue}
                    $stepArguments=switch($step.name){'status'{@('status','--porcelain=v1')};'diff-summary'{@('diff','--no-ext-diff','--shortstat','HEAD','--')};'whitespace'{@('diff','--no-ext-diff','--check','HEAD','--')};default{throw 'Unknown recipe step'}}
                    $result=Invoke-GitCapture $repo.path $stepArguments
                    # Never persist command output (a failing check can include source lines).
                    $step.state=if($result.Code -eq 0){'completed'}else{'failed'}
                    if($result.Code -ne 0){throw 'A read-only check failed. Open the repository to review it.'}
                }
                $after=Get-GitDeckTaskSnapshot $repo.path -IncludeDiff
                if($after.basis -cne $repo.basis){throw 'Repository changed during checks. Create a new plan.'}
                $repo.state='completed';$repo.reason=''
            } catch { $repo.state='blocked'; $repo.reason=if($_.Exception.Message -like 'Repository changed*'){'Changed since preview; create a new plan.'}else{'Check failed or repository unavailable. Open workspace to inspect.'} }
        }
        $plan.state=if(@($plan.repos|Where-Object {$_.state -ne 'completed'}).Count){'blocked'}else{'completed'}
        $plan.updatedAt=[DateTime]::UtcNow.ToString('o')
        @{message='Read-only recipe checked. Nothing was staged, committed or pushed.';plan=$plan}
    }
}

function Remove-GitDeckFleetRecipe($Body) {
    return Update-GitDeckTaskStore {param($data)
        $plan=@($data.recipes|Where-Object {$_.id -eq $Body.id})|Select-Object -First 1
        if(-not $plan -or [string]$plan.updatedAt -cne [string]$Body.expectedUpdatedAt){throw 'Plan changed. Refresh and try again.'}
        $data.recipes=@($data.recipes|Where-Object {$_.id -ne $Body.id})
        @{message='Recipe history entry removed.'}
    }
}

function Get-GitDeckFailureLens([string]$Path,[string]$Ref) {
    Assert-Registered $Path
    $ci=Get-GitDeckCiStatus $Path $Ref
    if(-not $ci.id){return @{ci=$ci;jobs=@();matchesLocalRef=$false;checkedAt=[DateTime]::UtcNow.ToString('o');limited=$false}}
    $project=Get-GitLabProjectApi (ConvertTo-WebUrl (Get-OriginUrl $Path))
    if([string]$ci.id -notmatch '^[1-9][0-9]*$'){throw 'Invalid pipeline ID'}
    $endpoint="projects/$($project.encoded)/pipelines/$($ci.id)/jobs?per_page=100&include_retried=false"
    $answer=Invoke-GlabCapture @('api','--hostname',$project.host,'--output','json',$endpoint)
    if($answer.Code -ne 0){throw 'Failed jobs unavailable. Check GitLab CLI permissions.'}
    # Windows PowerShell 5.1 can preserve a JSON array as one pipeline item.
    $parsed=$answer.Output|ConvertFrom-Json -ErrorAction Stop
    $all=@($parsed)
    $jobs=@($all|Where-Object {$_.status -in @('failed','canceled','manual')}|ForEach-Object {[ordered]@{name=[string]$_.name;stage=[string]$_.stage;status=[string]$_.status;reason=[string]$_.failure_reason;url=[string]$_.web_url}})
    $resolved=Invoke-GitCapture $Path @('rev-parse','--verify','--end-of-options',($ci.ref+'^{commit}'))
    $current=($resolved.Code -eq 0 -and ([string]$resolved.Output).Trim() -ceq [string]$ci.sha)
    return @{ci=$ci;jobs=$jobs;matchesLocalRef=$current;limited=($all.Count -ge 100);checkedAt=[DateTime]::UtcNow.ToString('o')}
}
