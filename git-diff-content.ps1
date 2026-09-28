function Get-CommitFileContent([string]$Path,[string]$Hash,[string]$File) {
    Assert-Registered $Path
    $commit=Get-CommitDetails $Path $Hash
    $entry=@($commit.files | Where-Object { $_.path -ceq $File })
    if($entry.Count -ne 1){throw 'File is not part of this commit.'}
    $revision=$commit.fullHash
    if($entry[0].status -eq 'D'){
        if(-not $commit.parents.Count){throw 'Deleted file has no parent revision.'}
        $revision=$commit.parents[0]
    }
    $blob=(Invoke-GitOrThrow $Path @('rev-parse','--verify',($revision+':'+$File))).Trim()
    if($blob -notmatch '^[a-f0-9]{40}$'){throw 'Invalid blob.'}
    $type=(Invoke-GitOrThrow $Path @('cat-file','-t',$blob)).Trim()
    if($type -ne 'blob'){throw 'Only file blobs can be previewed.'}
    $size=[long](Invoke-GitOrThrow $Path @('cat-file','-s',$blob)).Trim()
    if($size -gt 10485760){return @{size=$size;tooLarge=$true;revision=$revision;binary=$true}}
    $info=New-Object Diagnostics.ProcessStartInfo
    $info.FileName='git';$info.WorkingDirectory=$Path;$info.Arguments='cat-file blob '+$blob
    $info.UseShellExecute=$false;$info.CreateNoWindow=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
    $process=New-Object Diagnostics.Process;$process.StartInfo=$info
    $stream=New-Object IO.MemoryStream
    try{
        [void]$process.Start();$errorRead=$process.StandardError.ReadToEndAsync()
        $process.StandardOutput.BaseStream.CopyTo($stream);$process.WaitForExit()
        if($process.ExitCode -ne 0){throw $errorRead.Result}
        $bytes=$stream.ToArray()
    }finally{$stream.Dispose();$process.Dispose()}
    $pdf=$bytes.Length -ge 5 -and [Text.Encoding]::ASCII.GetString($bytes,0,5) -eq '%PDF-'
    $binary=$pdf -or $bytes -contains 0;$text=''
    if(-not $binary -and $size -le 1000000){try{$text=(New-Object Text.UTF8Encoding($false,$true)).GetString($bytes)}catch{$binary=$true}}
    return @{size=$size;revision=$revision;binary=$binary;pdf=$pdf;text=$text;textTooLarge=($size -gt 1000000);base64=$(if($binary){[Convert]::ToBase64String($bytes)}else{''})}
}
