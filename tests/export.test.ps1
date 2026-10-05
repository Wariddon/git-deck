$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
. (Join-Path $root 'lib\GitDeck.Export.ps1')
$script:ExportsRoot='C:\exports'

# Exports ask where to save (Sourcetree's Save dialog); askLocation=false keeps the old exports folder.
function Select-SaveFile([string]$Title,[string]$Filter,[string]$FileName){$script:asked=@{title=$Title;filter=$Filter;name=$FileName};return $script:answer}
$script:answer='D:\out\demo.patch'
$path=Resolve-ExportPath ([pscustomobject]@{commit='abc'}) 'Save patch' 'Git patch (*.patch)|*.patch' 'demo-abc.patch'
if($path -ne 'D:\out\demo.patch'){throw "Expected the chosen path, got $path"}
if($script:asked.name -ne 'demo-abc.patch' -or $script:asked.title -ne 'Save patch'){throw 'The dialog must suggest the file name'}
$script:answer=''
if(Resolve-ExportPath ([pscustomobject]@{}) 'Save patch' 'x' 'demo.patch'){throw 'Cancel must return an empty path'}
$script:asked=$null
$path=Resolve-ExportPath ([pscustomobject]@{askLocation=$false}) 'Save patch' 'x' 'demo.patch'
if($path -ne 'C:\exports\demo.patch' -or $script:asked){throw 'askLocation=false must skip the dialog'}

# Every export action uses it, and a cancelled dialog is not an error.
$server=Get-Content -Raw (Join-Path $root 'git-dashboard-server.ps1')
foreach($title in @('Save patch','Save archive','Save bundle')){if($server -notmatch "Resolve-ExportPath \`$Body '$title'"){throw "$title must ask where to save"}}
if(([regex]::Matches($server,"return @\{message='Export cancelled\.';cancelled=\`$true\}")).Count -ne 3){throw 'Each export must treat Cancel as a normal result'}
if($server -notmatch "lib\\GitDeck\.Export\.ps1"){throw 'Server must load lib\GitDeck.Export.ps1'}
'PASS: exports ask where to save (patch, archive, bundle); Cancel is not an error'
