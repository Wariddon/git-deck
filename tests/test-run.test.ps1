$ErrorActionPreference='Stop'
# Running tests: which command a repository gets, failing test names from each runner, "no tests" is not a
# pass, and a real run through a child process (exit code, output, working folder, stopping it).
$root=Split-Path $PSScriptRoot -Parent
. (Join-Path $root 'lib\GitDeck.TestRun.ps1')
$base=Join-Path $root ('output\test-run-test-'+[guid]::NewGuid().ToString('N'))
function New-Repo([string]$Name,[hashtable]$Files){$path=Join-Path $base $Name;[void](New-Item -ItemType Directory -Force -Path $path);foreach($key in $Files.Keys){[IO.File]::WriteAllText((Join-Path $path $key),[string]$Files[$key])};return $path}
function Expect($Actual,$Wanted,[string]$Label){if([string]$Actual -ne [string]$Wanted){throw "$Label`: got [$Actual], wanted [$Wanted]"}}
try{
    Expect (Get-GitDeckTestCommand (New-Repo 'm' @{'pom.xml'='<project/>'})).command 'mvn test' 'Maven'
    Expect (Get-GitDeckTestCommand (New-Repo 'w' @{'pom.xml'='<project/>';'mvnw.cmd'='x'})).command 'mvnw.cmd test' 'the wrapper wins'
    Expect (Get-GitDeckTestCommand (New-Repo 'g' @{'go.mod'='module x'})).command 'go test ./...' 'Go'
    Expect (Get-GitDeckTestCommand (New-Repo 'n' @{'package.json'='{"scripts":{"test":"vitest run"}}'})).command 'npm test' 'npm'
    Expect (Get-GitDeckTestCommand (New-Repo 'p' @{'package.json'='{"scripts":{"test":"vitest run"}}';'pnpm-lock.yaml'='x'})).command 'pnpm test' 'pnpm'
    if(Get-GitDeckTestCommand (New-Repo 'd' @{'package.json'='{"scripts":{"test":"echo \"Error: no test specified\" && exit 1"}}'})){throw 'The npm init placeholder is not a test'}
    if(Get-GitDeckTestCommand (New-Repo 'e' @{'README.md'='x'})){throw 'A repository with no build file has no test command'}
    if(Get-GitDeckTestCommand (New-Repo 'b' @{'package.json'='not json'})){throw 'A broken package.json has no test command'}

    $maven="[INFO] Results:`n[ERROR] Failures:`n[ERROR]   FooTest.pays:12 expected: <1> but was: <2>`n[ERROR] Errors:`n[ERROR]   BarTest.loads:40 NullPointer`n[ERROR] Tests run: 5, Failures: 1, Errors: 1`n[INFO] BUILD FAILURE"
    $names=@(Get-GitDeckTestFailures $maven)
    Expect $names.Count 2 'Maven failures'; Expect $names[0] 'FooTest.pays:12 expected: <1> but was: <2>' 'Maven name'
    Expect @(Get-GitDeckTestFailures "--- FAIL: TestPay (0.01s)`n    --- FAIL: TestPay/sub (0.00s)`nFAIL")[0] 'TestPay' 'Go'
    Expect @(Get-GitDeckTestFailures "FAILED tests/test_a.py::test_b - assert 1")[0] 'tests/test_a.py::test_b' 'pytest'
    Expect @(Get-GitDeckTestFailures "FooTest > pays FAILED")[0] 'FooTest > pays' 'Gradle'
    Expect @(Get-GitDeckTestFailures "test pay::works ... FAILED")[0] 'pay::works' 'cargo'
    Expect @(Get-GitDeckTestFailures "not ok 3 - pays twice")[0] 'pays twice' 'TAP'
    Expect @(Get-GitDeckTestFailures "  $([char]0x25CF) cart > adds")[0] 'cart > adds' 'Jest'
    Expect @(Get-GitDeckTestFailures "$([char]27)[31mFAIL$([char]27)[0m src/a.test.js > cart > adds")[0] 'src/a.test.js > cart > adds' 'Vitest with colours'
    Expect @(Get-GitDeckTestFailures "--- FAIL: TestPay (0s)`n--- FAIL: TestPay (0s)").Count 1 'each name once'
    Expect @(Get-GitDeckTestFailures "[INFO] BUILD SUCCESS").Count 0 'a pass names nothing'

    if(-not (Test-GitDeckTestsMissing '[INFO] Tests run: 0, Failures: 0' 'maven')){throw 'Zero tests run is not a pass'}
    if(-not (Test-GitDeckTestsMissing "?   	x/a	[no test files]`n?   	x/b	[no test files]" 'go')){throw 'Go with no test files is not a pass'}
    if(Test-GitDeckTestsMissing "ok  	x/a	0.1s`n?   	x/b	[no test files]" 'go'){throw 'Go with one tested package is a pass'}
    if(Test-GitDeckTestsMissing '[INFO] Tests run: 10, Failures: 0' 'maven'){throw 'Ten tests is a pass'}
    Expect (Get-GitDeckOutputTail "a`nb`nc" 2) "b`nc" 'tail'
    Assert-GitDeckTestCommand 'mvn -q test'
    $bad=$false;try{Assert-GitDeckTestCommand "mvn test`nformat c:"}catch{$bad=$true};if(-not $bad){throw 'A command of two lines was accepted'}

    # A real run: exit code, output and working folder, and a run that gets stopped.
    $repo=New-Repo 'run' @{'marker.txt'='here'}
    $log=Join-Path $base 'run.log';$ticks=0
    $code=Invoke-GitDeckTestProcess $repo 'type marker.txt && echo CI=%CI% && exit /b 3' $log 1 {$script:ticks++}
    Expect $code 3 'exit code'
    $text=Read-GitDeckTestLog $log
    if($text -notmatch 'here' -or $text -notmatch 'CI=true'){throw "Output: $text"}
    $stopped=$false;$slow=Join-Path $base 'slow.log'
    try{[void](Invoke-GitDeckTestProcess $repo 'ping -n 30 127.0.0.1' $slow 1 {throw 'stop now'})}catch{$stopped=($_.Exception.Message -eq 'stop now')}
    if(-not $stopped){throw 'A tick that throws must stop the run'}
    Write-Output 'PASS: test runs (command per repository, failing names per runner, no tests is no pass, real run and stop)'
}finally{Remove-Item -LiteralPath $base -Recurse -Force -ErrorAction SilentlyContinue}
