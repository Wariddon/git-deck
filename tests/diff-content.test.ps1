$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent;$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $root 'git-dashboard-server.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Server parse failed'}
foreach($name in @('Invoke-GitCapture','Invoke-GitOrThrow','Assert-CommitHash','Get-CommitDetails','Get-CommitDiff')){
    $fn=$ast.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$false)[0]
    $definition=$fn.Extent.Text;if($name -eq 'Invoke-GitCapture'){$definition=$definition.Replace('$items =',("`$ErrorActionPreference='Continue'`n `$items ="))};. ([scriptblock]::Create($definition))
}
. (Join-Path $root 'git-diff-content.ps1')
$fixture=Join-Path $root ('output\diff-content-'+[guid]::NewGuid().ToString('N'));[void](New-Item -ItemType Directory -Path $fixture)
function Assert-Registered($Path){if($Path -ne $fixture){throw 'Not registered'}}
[void](Invoke-GitOrThrow $fixture @('init','--template=','-b','main'))
[void](Invoke-GitOrThrow $fixture @('config','user.name','Diff Test'));[void](Invoke-GitOrThrow $fixture @('config','user.email','diff@example.invalid'));[void](Invoke-GitOrThrow $fixture @('config','commit.gpgsign','false'))
$utf8=New-Object Text.UTF8Encoding($false)
[IO.File]::WriteAllText((Join-Path $fixture 'read me.md'),"# Safe`n<script>unsafe</script>`n",$utf8)
[IO.File]::WriteAllBytes((Join-Path $fixture 'sample.pdf'),[Text.Encoding]::ASCII.GetBytes("%PDF-1.4`n`0binary fixture"))
[void](Invoke-GitOrThrow $fixture @('add','.'));[void](Invoke-GitOrThrow $fixture @('-c','core.hooksPath=NUL','commit','-m','Initial'))
$first=(Invoke-GitOrThrow $fixture @('rev-parse','HEAD')).Trim();$detail=Get-CommitDetails $fixture $first
if($detail.files.Count -ne 2){throw 'Root file count wrong'}
$md=@($detail.files|Where-Object{$_.path -eq 'read me.md'})[0];if($md.added -ne 2){throw 'Numstat wrong'}
$pdf=Get-CommitFileContent $fixture $first 'sample.pdf';if(-not $pdf.pdf -or -not $pdf.binary -or -not $pdf.base64){throw 'Binary PDF not returned'}
[void](Invoke-GitOrThrow $fixture @('mv','read me.md','renamed.md'));[void](Invoke-GitOrThrow $fixture @('-c','core.hooksPath=NUL','commit','-m','Rename'))
$renamed=(Invoke-GitOrThrow $fixture @('rev-parse','HEAD')).Trim();$detail=Get-CommitDetails $fixture $renamed
if($detail.files[0].oldPath -ne 'read me.md' -or $detail.files[0].added -ne 0){throw 'Rename stats failed'}
[void](Invoke-GitOrThrow $fixture @('rm','renamed.md'));[void](Invoke-GitOrThrow $fixture @('-c','core.hooksPath=NUL','commit','-m','Delete'))
$deleted=(Invoke-GitOrThrow $fixture @('rev-parse','HEAD')).Trim();$content=Get-CommitFileContent $fixture $deleted 'renamed.md'
if($content.revision -ne $renamed -or -not $content.text.Contains('# Safe')){throw 'Deleted file did not use parent blob'}
$blocked=$false;try{Get-CommitFileContent $fixture $first '../secret'|Out-Null}catch{$blocked=$true};if(-not $blocked){throw 'Outside file accepted'}
if(-not (Get-CommitDiff $fixture $first 'read me.md').diff.Contains('+# Safe')){throw 'Root diff missing'}
'PASS: root stats, filenames with spaces, rename stats, PDF bytes, deleted-parent content and membership guard'
