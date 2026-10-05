$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$tokens=$null;$errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $root 'git-dashboard-server.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Server parse failed'}
foreach($name in @('Invoke-GitCapture','Invoke-GitOrThrow','ConvertFrom-GitQuotedPath','Get-GitDeckStatusPath','Get-GitDeckQuery')){
    $fn=$ast.FindAll({param($n)$n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$false)[0]
    if(-not $fn){throw "Missing server function $name"}
    $definition=$fn.Extent.Text
    if($name -eq 'Invoke-GitCapture'){$definition=$definition.Replace('$items =',("`$ErrorActionPreference='Continue'`n    `$items ="))}
    . ([scriptblock]::Create($definition))
}
[Console]::OutputEncoding=[Text.Encoding]::UTF8
$thai=-join @(0x0E40,0x0E2D,0x0E01,0x0E2A,0x0E32,0x0E23 | ForEach-Object {[char]$_})

# Pure unquoting.
if((ConvertFrom-GitQuotedPath 'plain.txt') -ne 'plain.txt'){throw 'Plain path changed'}
if((ConvertFrom-GitQuotedPath '"my file.md"') -ne 'my file.md'){throw 'Space path not unquoted'}
if((ConvertFrom-GitQuotedPath '"a\"b\\c.txt"') -ne 'a"b\c.txt'){throw 'Escapes not decoded'}
if((ConvertFrom-GitQuotedPath '"\340\271\200.md"') -ne ([string][char]0x0E40+'.md')){throw 'Octal UTF-8 not decoded'}
if((Get-GitDeckStatusPath 'R  "old name.txt" -> "new name.txt"') -ne 'old name.txt -> new name.txt'){throw 'Rename not unquoted'}
if((Get-GitDeckStatusPath '?? "x y.md"') -ne 'x y.md'){throw 'Untracked not unquoted'}

# Query strings are decoded as UTF-8 (Thai file names in GET requests).
$query=Get-GitDeckQuery ([pscustomobject]@{RawUrl='/api/x?path=C%3A%5Cw&file=%E0%B9%80%E0%B8%AD+a.md&empty=&File=dup'})
if($query['file'] -ne ([string][char]0x0E40+[char]0x0E2D+' a.md')){throw "Query not UTF-8: $($query['file'])"}
if($query['path'] -ne 'C:\w' -or $query['empty'] -ne '' -or $null -ne $query['missing']){throw 'Query parsing wrong'}
if((Get-GitDeckQuery ([pscustomobject]@{RawUrl='/api/x'})).Count -ne 0){throw 'No query should be empty'}

# Real git: Thai names and spaces come back as the names on disk.
$base=Join-Path $root ('output\quoted-test-'+[guid]::NewGuid().ToString('N'))
try{
    [void](New-Item -ItemType Directory -Path $base)
    [void](Invoke-GitOrThrow $base @('init','-q'))
    [IO.File]::WriteAllText((Join-Path $base "$thai doc.md"),'x')
    [IO.File]::WriteAllText((Join-Path $base 'two words.txt'),'y')
    $lines=@(((Invoke-GitCapture $base @('status','--porcelain=v1')).Output) -split "`r?`n" | Where-Object {$_})
    $paths=@($lines | ForEach-Object { Get-GitDeckStatusPath $_ } | Sort-Object)
    foreach($expected in @("$thai doc.md",'two words.txt')){
        if($paths -notcontains $expected){throw "Expected '$expected' in: $($paths -join ' | ')"}
        if(-not (Test-Path -LiteralPath (Join-Path $base $expected))){throw "Parsed path does not exist on disk: $expected"}
    }
}finally{Remove-Item -LiteralPath $base -Recurse -Force -ErrorAction SilentlyContinue}
'PASS: quoted, Thai and spaced paths match the files on disk; queries decode as UTF-8'
