$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $root 'git-dashboard-server.ps1'),[ref]$null,[ref]$null)
$fn=$ast.FindAll({param($n)$n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Invoke-GitCapture'},$false)[0]
. ([scriptblock]::Create($fn.Extent.Text.Replace('$items =',("`$ErrorActionPreference='Continue'`n    `$items ="))))
. (Join-Path $root 'lib\GitDeck.SelfUpdate.ps1')
function Run-Git([string]$Path,[string[]]$Arguments){$r=Invoke-GitCapture $Path $Arguments;if($r.Code -ne 0){throw "git $($Arguments -join ' '): $($r.Output)"}}

$base=Join-Path $root ('output\self-update-test-'+[guid]::NewGuid().ToString('N'))
try{
    [void](New-Item -ItemType Directory -Path $base)
    $remote=Join-Path $base 'remote.git';$deck=Join-Path $base 'deck';$dev=Join-Path $base 'dev'
    Run-Git $base @('init','-q','--bare','-b','main',$remote)
    Run-Git $base @('clone','-q',$remote,$dev)
    Run-Git $dev @('config','user.email','t@example.test');Run-Git $dev @('config','user.name','Test')
    [IO.File]::WriteAllText((Join-Path $dev 'app.txt'),"1`n");Run-Git $dev @('add','.');Run-Git $dev @('commit','-qm','first');Run-Git $dev @('push','-q','origin','main')
    Run-Git $base @('clone','-q',$remote,$deck)

    # A ZIP install (no .git) is reported and never pulled.
    $script:Root=$base
    if((Get-GitDeckSelfUpdate $false).git){throw 'Folder without .git reported as a clone'}
    $refused=$false;try{[void](Invoke-GitDeckSelfUpdate)}catch{$refused=$true};if(-not $refused){throw 'ZIP install was updated'}

    # Up to date, then one new commit on GitHub (here: the bare remote).
    $script:Root=$deck
    $state=Get-GitDeckSelfUpdate $true
    if(-not $state.git -or $state.behind -ne 0 -or $state.upstream -ne 'origin/main'){throw "Fresh clone state wrong: $($state|ConvertTo-Json -Compress)"}
    [IO.File]::WriteAllText((Join-Path $dev 'app.txt'),"2`n");Run-Git $dev @('commit','-qam','feat: newer Git Deck');Run-Git $dev @('push','-q','origin','main')
    $state=Get-GitDeckSelfUpdate $true
    if($state.behind -ne 1 -or $state.latest -ne 'feat: newer Git Deck'){throw "New version not seen: $($state|ConvertTo-Json -Compress)"}

    # Local edits block the automatic pull; without them it fast-forwards.
    [IO.File]::WriteAllText((Join-Path $deck 'app.txt'),"local`n")
    if((Get-GitDeckSelfUpdate $false).dirty -ne 1){throw 'Local change not reported'}
    $refused=$false;try{[void](Invoke-GitDeckSelfUpdate)}catch{$refused=$true};if(-not $refused){throw 'Pulled over local changes'}
    Run-Git $deck @('checkout','--','app.txt')
    [void](Invoke-GitDeckSelfUpdate)
    if(([IO.File]::ReadAllText((Join-Path $deck 'app.txt'))).Trim() -ne '2'){throw 'Update did not arrive'}
    if((Get-GitDeckSelfUpdate $false).behind -ne 0){throw 'Still behind after update'}
    Write-Host 'PASS: self-update reports new versions, refuses ZIP installs and local edits, fast-forwards'
}finally{
    if(Test-Path -LiteralPath $base){Remove-Item -LiteralPath $base -Recurse -Force}
}
