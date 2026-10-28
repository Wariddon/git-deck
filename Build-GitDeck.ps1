# Builds GitDeck.exe from launcher\GitDeckLauncher.cs with the C# compiler that ships with Windows.
#   .\Build-GitDeck.ps1             build the launcher (reuses GitDeck.ico and web\favicon.svg)
#   .\Build-GitDeck.ps1 -Artwork    also redraw GitDeck.ico and web\favicon.svg from assets\brand
#   .\Build-GitDeck.ps1 -Shortcut   also add "Git Deck" to the Desktop and the Start menu (this user)
param([switch]$Artwork, [switch]$Shortcut)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$source = Join-Path $root 'launcher\GitDeckLauncher.cs'
$output = Join-Path $root 'GitDeck.exe'
$icon = Join-Path $root 'GitDeck.ico'
$logo = Join-Path $root 'assets\brand\git-deck-icon.png'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { throw 'Windows C# compiler was not found.' }
# The icon files are in Git. Redrawing them on every build left changes behind on other computers
# (and blocked their next pull), so they are only redrawn when asked or when the icon is missing.
if ($Artwork -or -not (Test-Path -LiteralPath $icon)) {
    # Convert the shared brand artwork to Windows icon frames, preserving transparency.
    Add-Type -AssemblyName System.Drawing
    $art = [System.Drawing.Image]::FromFile($logo)
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
}
# The splash card draws the same artwork (resource GitDeck.logo.png).
# The frameless window uses WebView2 (launcher\webview2, Microsoft's signed SDK files); they sit next to
# GitDeck.exe. Without them, or without the WebView2 runtime, GitDeck.exe opens an Edge app window instead.
$webview = Join-Path $root 'launcher\webview2'
foreach ($file in @('Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll', 'WebView2Loader.dll')) {
    $target = Join-Path $root $file
    try { Copy-Item -LiteralPath (Join-Path $webview $file) -Destination $target -Force } catch { if (-not (Test-Path -LiteralPath $target)) { throw } }
}
& $compiler /nologo /target:winexe /optimize+ /win32icon:$icon /reference:System.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll "/reference:$(Join-Path $webview 'Microsoft.Web.WebView2.Core.dll')" "/reference:$(Join-Path $webview 'Microsoft.Web.WebView2.WinForms.dll')" "/resource:$logo,GitDeck.logo.png" /out:$output $source
if ($LASTEXITCODE -ne 0) { throw 'GitDeck.exe build failed.' }
Write-Host "Built $output with shared Git Deck artwork (16-256px)."
if ($Shortcut) {
    $shell = New-Object -ComObject WScript.Shell
    foreach ($folder in @([Environment]::GetFolderPath('Desktop'), (Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs'))) {
        $link = $shell.CreateShortcut((Join-Path $folder 'Git Deck.lnk'))
        $link.TargetPath = $output; $link.WorkingDirectory = $root; $link.IconLocation = "$icon,0"; $link.Description = 'Git Deck'
        $link.Save()
    }
    Write-Host 'Added Git Deck to the Desktop and the Start menu.'
}
