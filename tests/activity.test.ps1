$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '..\lib\GitDeck.Activity.ps1')
function Assert-Registered($Path){}
$sep=[char]31
$script:lastArgs=@()
$script:remote='origin'
function Invoke-GitCapture($Path,$Arguments){
 if($Arguments[0] -eq 'remote'){return @{Code=0;Output=$script:remote}}
 if($Arguments[0] -eq 'symbolic-ref'){return @{Code=0;Output="origin/main`n"}}
 if($Arguments[0] -eq 'for-each-ref' -and $Arguments -contains 'refs/remotes/origin/HEAD'){return @{Code=0;Output="refs/remotes/origin/HEAD`torigin/main`nrefs/remotes/origin/main`t`n"}}
 if($Arguments[0] -eq 'log' -and $Arguments -contains '--remotes'){return @{Code=0;Output=('a'*40)}}
 if($Arguments[0] -eq 'log' -and $Arguments[1] -eq 'origin/main'){$script:mainArgs=$Arguments;return @{Code=0;Output=""}}
 if($Arguments -contains '--numstat'){$script:lastArgs=$Arguments}
 $lines=@(
  "@@$sep$('a'*40)${sep}Wariddon${sep}w@example.com${sep}2026-10-01T09:30:00+07:00${sep}refs/heads/feature/PAY-1234${sep}fix: first",
  "3`t1`tsrc/A.java","-`t-`tlogo.png","",
  "@@$sep$('b'*40)${sep}Wariddon${sep}w@example.com${sep}2026-10-02T10:00:00+07:00${sep}refs/remotes/origin/main${sep}docs: second | with pipe"
 )
 return @{Code=0;Output=($lines -join "`n")}
}
$rows=@(Get-GitDeckActivity 'fixture' '2026-10-01' '2026-10-05' 'Wariddon, other@x.com' $false)
if($rows.Count -ne 2){throw "Expected 2 commits, got $($rows.Count)"}
if($rows[0].files -ne 2 -or $rows[0].added -ne 3 -or $rows[0].deleted -ne 1){throw 'numstat (incl. binary) parsed wrong'}
if($rows[0].ref -ne 'feature/PAY-1234' -or $rows[1].ref -ne 'origin/main'){throw 'ref prefix not cleaned'}
if($rows[1].subject -ne 'docs: second | with pipe'){throw 'subject lost'}
if(($rows[0].paths -join ',') -ne 'src/A.java,logo.png'){throw "paths wrong: $($rows[0].paths -join ',')"}
if($rows[0].pushed -ne $true -or $rows[1].pushed -ne $false){throw 'pushed status wrong'}
if($rows[0].merged -ne $false -or $mainArgs -notcontains '--since=2026-10-01 00:00:00'){throw 'merged status wrong'}
foreach($flag in @('--exclude=refs/stash','--all','--source','--no-merges','--fixed-strings','--author=Wariddon','--author=other@x.com','--since=2026-10-01 00:00:00','--until=2026-10-05 23:59:59')){if($lastArgs -notcontains $flag){throw "Missing $flag"}}
[void](Get-GitDeckActivity 'fixture' '2026-10-01' '2026-10-05' '' $true)
if($lastArgs -contains '--no-merges'){throw 'Merges flag ignored'}
foreach($bad in @(@('10/01/2026','2026-10-05','x'),@('2026-10-01','2026-10-05','--output=x'),@('2026-10-01','2026-10-05',('x'*101)))){
 $blocked=$false;try{Get-GitDeckActivity 'fixture' $bad[0] $bad[1] $bad[2] $false|Out-Null}catch{$blocked=$true};if(-not $blocked){throw "Accepted bad input: $($bad -join '|')"}}
$script:remote=''
$local=@(Get-GitDeckActivity 'fixture' '2026-10-01' '2026-10-05' '' $false)
if($null -ne $local[0].pushed){throw 'No remote should leave pushed unknown'}
'PASS: activity log parsing, numstat, ref cleanup, pushed/merged status, filters and input bounds'
