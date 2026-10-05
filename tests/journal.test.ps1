$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$tokens=$null;$errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $root 'git-dashboard-server.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Server parse failed'}
foreach($name in @('Get-ActionJournal','Add-ActionJournalEntry','Write-JsonFile')){
    $fn=$ast.FindAll({param($n)$n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$false)[0]
    if(-not $fn){throw "Missing server function $name"}
    . ([scriptblock]::Create($fn.Extent.Text))
}
$script:ActionJournal=[IO.Path]::Combine([IO.Path]::GetTempPath(),'gd-journal-'+[guid]::NewGuid().ToString('N')+'.json')
try {
    # A file saved by the old code: newest entry, then the older ones nested as {"value":[...]}.
    $old='[{"id":"a","path":"C:\\r","action":"commit","afterHead":"3"},{"value":[{"id":"b","path":"C:\\r","action":"merge","afterHead":"2"},{"value":[{"id":"c","path":"C:\\r","action":"pull","afterHead":"1"}],"Count":1}],"Count":2}]'
    [IO.File]::WriteAllText($script:ActionJournal,$old)
    $entries=@(Get-ActionJournal)
    if(($entries|ForEach-Object{$_.id}) -join ',' -ne 'a,b,c'){throw "Old nested journal must flatten to a,b,c, got $(($entries|ForEach-Object{$_.id}) -join ',')"}
    # Each entry reaches the pipeline on its own (this is what Undo filters on).
    $first=@(Get-ActionJournal | Where-Object { $_.path -eq 'C:\r' }) | Select-Object -First 1
    if($first.id -ne 'a'){throw 'The newest entry must come first through the pipeline'}
    # Saving again writes a flat array.
    Add-ActionJournalEntry ([pscustomobject]@{id='d';path='C:\r';action='commit';afterHead='4'})
    $raw=Get-Content -Raw $script:ActionJournal
    if($raw -match '"value"'){throw "Journal must be saved flat: $raw"}
    if((@(Get-ActionJournal)|ForEach-Object{$_.id}) -join ',' -ne 'd,a,b,c'){throw 'New entry first, then the old ones'}
} finally { Remove-Item -LiteralPath $script:ActionJournal -ErrorAction SilentlyContinue }
'PASS: action journal reads one entry at a time and repairs the old nested shape (Undo can find the last action)'
