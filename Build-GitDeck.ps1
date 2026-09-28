$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$source = Join-Path $root 'launcher\GitDeckLauncher.cs'
$output = Join-Path $root 'GitDeck.exe'
$icon = Join-Path $root 'GitDeck.ico'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler -PathType Leaf)) { throw 'Windows C# compiler was not found.' }

# Build a crisp app icon without requiring ImageMagick or another external tool.
Add-Type -AssemblyName System.Drawing
$bitmap = New-Object System.Drawing.Bitmap 256,256
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
try {
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $shape = New-Object System.Drawing.Drawing2D.GraphicsPath
    $shape.AddArc(8,8,56,56,180,90); $shape.AddArc(192,8,56,56,270,90)
    $shape.AddArc(192,192,56,56,0,90); $shape.AddArc(8,192,56,56,90,90); $shape.CloseFigure()
    $background = New-Object System.Drawing.Drawing2D.LinearGradientBrush ([System.Drawing.Rectangle]::new(8,8,240,240)),([System.Drawing.Color]::FromArgb(21,146,102)),([System.Drawing.Color]::FromArgb(7,95,67)),45
    $graphics.FillPath($background,$shape)
    $line = New-Object System.Drawing.Pen ([System.Drawing.Color]::White),20
    $line.StartCap = $line.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $graphics.DrawLines($line,[System.Drawing.Point[]]@([System.Drawing.Point]::new(76,66),[System.Drawing.Point]::new(76,142),[System.Drawing.Point]::new(101,174),[System.Drawing.Point]::new(180,174)))
    $graphics.DrawBezier($line,76,96,142,96,180,115,180,165)
    $node = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(223,248,236))
    $accent = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(143,224,185))
    $graphics.FillEllipse($node,53,43,46,46); $graphics.FillEllipse($node,157,151,46,46); $graphics.FillEllipse($accent,162,112,36,36)
    $png = New-Object System.IO.MemoryStream
    $bitmap.Save($png,[System.Drawing.Imaging.ImageFormat]::Png)
    $image = $png.ToArray(); $stream = New-Object System.IO.MemoryStream; $writer = New-Object System.IO.BinaryWriter $stream
    $writer.Write([UInt16]0); $writer.Write([UInt16]1); $writer.Write([UInt16]1)
    $writer.Write([Byte]0); $writer.Write([Byte]0); $writer.Write([Byte]0); $writer.Write([Byte]0)
    $writer.Write([UInt16]1); $writer.Write([UInt16]32); $writer.Write([UInt32]$image.Length); $writer.Write([UInt32]22); $writer.Write($image)
    [System.IO.File]::WriteAllBytes($icon,$stream.ToArray())
} finally {
    if ($writer) { $writer.Dispose() }; if ($stream) { $stream.Dispose() }; if ($png) { $png.Dispose() }
    if ($node) { $node.Dispose() }; if ($accent) { $accent.Dispose() }; if ($line) { $line.Dispose() }; if ($background) { $background.Dispose() }; if ($shape) { $shape.Dispose() }
    $graphics.Dispose(); $bitmap.Dispose()
}

& $compiler /nologo /target:winexe /optimize+ /win32icon:$icon /reference:System.dll /reference:System.Windows.Forms.dll /out:$output $source
if ($LASTEXITCODE -ne 0) { throw 'GitDeck.exe build failed.' }
Write-Host "Built $output"
