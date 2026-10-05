$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$source = Join-Path $root 'launcher\GitDeckLauncher.cs'
$output = Join-Path $root 'GitDeck.exe'
$icon = Join-Path $root 'GitDeck.ico'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { throw 'Windows C# compiler was not found.' }
# Convert the shared brand artwork to Windows icon frames, preserving transparency.
Add-Type -AssemblyName System.Drawing
$art = [System.Drawing.Image]::FromFile((Join-Path $root 'assets\brand\git-deck-icon.png'))
$sizes = @(16,24,32,48,64,128,256)
$frames = @()
try {
    foreach ($size in $sizes) {
        $bitmap = New-Object System.Drawing.Bitmap $size,$size
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        $png = New-Object System.IO.MemoryStream
        try {
            $graphics.Clear([System.Drawing.Color]::Transparent)
            $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $graphics.DrawImage($art,0,0,$size,$size)
            $bitmap.Save($png,[System.Drawing.Imaging.ImageFormat]::Png)
            $frames += ,$png.ToArray()
        } finally { $png.Dispose(); $graphics.Dispose(); $bitmap.Dispose() }
    }
} finally { $art.Dispose() }
$stream = New-Object System.IO.MemoryStream
$writer = New-Object System.IO.BinaryWriter $stream
try {
    $writer.Write([UInt16]0); $writer.Write([UInt16]1); $writer.Write([UInt16]$sizes.Count)
    $offset = 6 + 16 * $sizes.Count
    for ($i=0; $i -lt $sizes.Count; $i++) {
        $dimension = if ($sizes[$i] -eq 256) { 0 } else { $sizes[$i] }
        $writer.Write([Byte]$dimension); $writer.Write([Byte]$dimension)
        $writer.Write([Byte]0); $writer.Write([Byte]0)
        $writer.Write([UInt16]1); $writer.Write([UInt16]32)
        $writer.Write([UInt32]$frames[$i].Length); $writer.Write([UInt32]$offset)
        $offset += $frames[$i].Length
    }
    foreach ($frame in $frames) { $writer.Write([byte[]]$frame) }
    [System.IO.File]::WriteAllBytes($icon,$stream.ToArray())
} finally { $writer.Dispose(); $stream.Dispose() }
# Retain the existing static SVG endpoint, with the same raster artwork inside.
$base64 = [Convert]::ToBase64String($frames[-1])
$svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><image width="256" height="256" href="data:image/png;base64,' + $base64 + '"/></svg>'
[System.IO.File]::WriteAllText((Join-Path $root 'web\favicon.svg'),$svg)
# The splash card draws the same artwork (resource GitDeck.logo.png).
$logo = Join-Path $root 'assets\brand\git-deck-icon.png'
& $compiler /nologo /target:winexe /optimize+ /win32icon:$icon /reference:System.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll "/resource:$logo,GitDeck.logo.png" /out:$output $source
if ($LASTEXITCODE -ne 0) { throw 'GitDeck.exe build failed.' }
Write-Host "Built $output with shared Git Deck artwork (16-256px)."
