$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $root 'git-dashboard-server.ps1'),[ref]$null,[ref]$null)
$fn=$ast.FindAll({param($n)$n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Invoke-GitCapture'},$false)[0]
. ([scriptblock]::Create($fn.Extent.Text.Replace('$items =',("`$ErrorActionPreference='Continue'`n    `$items ="))))
. (Join-Path $root 'lib\GitDeck.Activity.ps1')
. (Join-Path $root 'lib\GitDeck.Insight.ps1')
function Assert-Registered($Path){}
function Run-Git([string]$Path,[string[]]$Arguments){$r=Invoke-GitCapture $Path $Arguments;if($r.Code -ne 0){throw "git $($Arguments -join ' '): $($r.Output)"}}
$base=Join-Path $root ('output\insight-test-'+[guid]::NewGuid().ToString('N'))
try{
    $repo=Join-Path $base 'repo';[void](New-Item -ItemType Directory -Force -Path $repo);Run-Git $repo @('init','-q','-b','main')
    Run-Git $repo @('config','user.email','t@example.test');Run-Git $repo @('config','user.name','Tee')
    [IO.File]::WriteAllText((Join-Path $repo 'app.yml'),"redis:`n  host: classic`n");Run-Git $repo @('add','.');Run-Git $repo @('commit','-q','-m','base')
    Run-Git $repo @('switch','-q','-c','feature/AP-1')
    [IO.File]::WriteAllText((Join-Path $repo 'app.yml'),"redis:`n  host: cluster`n");Run-Git $repo @('commit','-q','-am','AP-1 cluster')
    Run-Git $repo @('switch','-q','main')
    [IO.File]::WriteAllText((Join-Path $repo 'app.yml'),"redis:`n  host: sentinel`n");Run-Git $repo @('commit','-q','-am','sentinel on main')
    Run-Git $repo @('switch','-q','-c','feature/clean')
    [IO.File]::WriteAllText((Join-Path $repo 'other.txt'),"x");Run-Git $repo @('add','.');Run-Git $repo @('commit','-q','-m','other')

    # Conflict forecast: feature/AP-1 conflicts with main on app.yml, named with who changed it there.
    $f=Get-GitDeckMergeForecast $repo 'feature/AP-1' 'main' $false
    $r=@($f.results)[0]
    if(-not $f.supported -or $r.clean -or @($r.files).Count -ne 1 -or $r.files[0].file -ne 'app.yml' -or $r.files[0].author -ne 'Tee' -or $r.files[0].subject -ne 'sentinel on main'){throw "Forecast: $($f|ConvertTo-Json -Depth 6 -Compress)"}
    if($r.behind -ne 1 -or $r.ahead -ne 1){throw "Counts: $($r.behind) $($r.ahead)"}
    $c=@((Get-GitDeckMergeForecast $repo 'feature/clean' 'main' $false).results)[0]
    if(-not $c.clean -or @($c.files).Count){throw 'Clean branch reported conflicts'}
    $status=([string](Invoke-GitCapture $repo @('status','--porcelain')).Output).Trim()
    if($status){throw "Forecast touched the working tree: $status"}
    # A teammate's recent remote branch that edits the same file the other way is reported.
    Run-Git $repo @('switch','-q','-c','mate','main~1')
    [IO.File]::WriteAllText((Join-Path $repo 'app.yml'),"redis:`n  host: mate`n");Run-Git $repo @('commit','-q','-am','mate change')
    Run-Git $repo @('update-ref','refs/remotes/origin/feature/mate','mate');Run-Git $repo @('switch','-q','main');Run-Git $repo @('branch','-q','-D','mate')
    $o=@((Get-GitDeckMergeForecast $repo 'feature/AP-1' 'main' $true).others)
    if($o.Count -ne 1 -or $o[0].branch -ne 'origin/feature/mate' -or $o[0].clean -or @($o[0].shared)[0] -ne 'app.yml'){throw "Teammates: $($o|ConvertTo-Json -Depth 6 -Compress)"}
    $bad=Get-GitDeckMergeForecast $repo 'feature/AP-1' '--evil|main' $false
    if(@($bad.results).Count -ne 1){throw 'Unsafe base accepted'}

    # Time machine: the main line at two moments, with the newest tag and what came in between.
    $t0=(Get-Date).AddMinutes(-5).ToString('o');Run-Git $repo @('tag','1.0.0','main')
    $env:GIT_COMMITTER_DATE=(Get-Date).AddMinutes(1).ToString('yyyy-MM-ddTHH:mm:ss');Run-Git $repo @('switch','-q','main');[IO.File]::WriteAllText((Join-Path $repo 'later.txt'),'y');Run-Git $repo @('add','.');Run-Git $repo @('commit','-q','-m','later');Remove-Item Env:GIT_COMMITTER_DATE
    $m=Get-GitDeckMoments $repo (Get-Date).AddSeconds(30).ToString('o') (Get-Date).AddMinutes(3).ToString('o') 'main'
    if(-not $m.from.found -or $m.from.tag -ne '1.0.0' -or $m.to.subject -ne 'later' -or $m.commits -ne 1 -or @($m.files)[0] -ne 'later.txt' -or @($m.authors)[0] -ne 'Tee'){throw "Moments: $($m|ConvertTo-Json -Depth 5 -Compress)"}
    $early=Get-GitDeckMoments $repo '2001-01-01T00:00' (Get-Date).AddMinutes(3).ToString('o') 'main'
    if($early.from.found -or $early.commits -lt 3){throw "Before the first commit: $($early|ConvertTo-Json -Depth 5 -Compress)"}
    [void]$t0
    # History search: who added / removed a text, with the files and newest first.
    $h=Search-GitDeckHistory $repo 'cluster' 'S' '' 10
    if(@($h.commits).Count -ne 1 -or $h.commits[0].subject -ne 'AP-1 cluster' -or @($h.commits[0].files)[0] -ne 'app.yml'){throw "History: $($h|ConvertTo-Json -Depth 5 -Compress)"}
    $g=Search-GitDeckHistory $repo 'host: (cluster|sentinel)' 'G' '' 10
    if(@($g.commits).Count -ne 2){throw "Regex history: $(@($g.commits).Count)"}
    $threw=$false;try{[void](Search-GitDeckHistory $repo '' 'S' '' 10)}catch{$threw=$true};if(-not $threw){throw 'Empty text accepted'}

    # Lessons: only from the chosen folder, matching words, never secret-looking lines.
    $notes=Join-Path $base 'notes';[void](New-Item -ItemType Directory -Force -Path $notes)
    [IO.File]::WriteAllText((Join-Path $notes 'cfg.md'),"---`nname: Move config before deleting`ndescription: configmap wins over application-{env}.yml`n---`nAlways compare src-svc pom.xml with siblings.`npassword: hunter2 for src-svc`n",[Text.Encoding]::UTF8)
    [IO.File]::WriteAllText((Join-Path $notes 'other.md'),"# Unrelated`nnothing here`n",[Text.Encoding]::UTF8)
    $script:PrefsFile=Join-Path $base 'prefs.json'
    $none=Get-GitDeckLessons 'src-svc'
    if($none.configured){throw 'Lessons without a folder'}
    [IO.File]::WriteAllText($script:PrefsFile,(@{brainFolder=$notes}|ConvertTo-Json))
    $l=Get-GitDeckLessons 'src-svc|pom.xml|ab'
    if(@($l.lessons).Count -ne 1 -or $l.lessons[0].title -ne 'Move config before deleting' -or $l.lessons[0].description -notmatch 'configmap'){throw "Lessons: $($l|ConvertTo-Json -Depth 5 -Compress)"}
    if(@($l.lessons[0].snippets) -match 'hunter2'){throw 'Secret-looking line returned'}
    if(@($l.lessons[0].snippets).Count -ne 1){throw "Snippets: $(@($l.lessons[0].snippets) -join ' / ')"}
    Write-Host 'PASS: conflict forecast (in memory, who changed it), history search -S/-G, lessons from the chosen folder without secrets'
}finally{ if(Test-Path -LiteralPath $base){Remove-Item -LiteralPath $base -Recurse -Force} }
