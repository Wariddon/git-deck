$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $root 'git-dashboard-server.ps1'),[ref]$null,[ref]$null)
$fn=$ast.FindAll({param($n)$n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Invoke-GitCapture'},$false)[0]
. ([scriptblock]::Create($fn.Extent.Text.Replace('$items =',("`$ErrorActionPreference='Continue'`n    `$items ="))))
# Windows PowerShell 5.1 used to drop double quotes from native arguments: commit messages lost them.
$base=Join-Path $root ('output\native-args-test-'+[guid]::NewGuid().ToString('N'))
try{
    [void](New-Item -ItemType Directory -Force -Path $base)
    [void](Invoke-GitCapture $base @('init','-q','-b','main'));[void](Invoke-GitCapture $base @('config','user.email','t@example.test'));[void](Invoke-GitCapture $base @('config','user.name','T'))
    foreach($message in @('fix "quoted" value','say "hi"','path C:\a\ and "x y"','ends with backslash \','tab	and "q"','กำลัง "ทดสอบ" ภาษาไทย')){
        $r=Invoke-GitCapture $base @('commit','-q','--allow-empty','-m',$message)
        if($r.Code -ne 0){throw "Commit failed for [$message]: $($r.Output)"}
        $got=([string](Invoke-GitCapture $base @('log','-1','--format=%B')).Output).Trim()
        if($got -cne $message.Trim()){throw "Sent [$message], got [$got]"}
    }
    # An empty argument is still left out (optional refs rely on it).
    if((Invoke-GitCapture $base @('log','-1','--format=%s','')).Code -ne 0){throw 'Empty argument was passed to git'}
    Write-Host 'PASS: native arguments keep double quotes, backslashes and Thai text (Windows PowerShell 5.1)'
}finally{ if(Test-Path -LiteralPath $base){Remove-Item -LiteralPath $base -Recurse -Force} }
