# Git Deck exports (patch, archive, bundle): ask where to save, like Sourcetree.
# Dot-sourced by git-dashboard-server.ps1. Windows PowerShell 5.1 compatible.

# Save dialog like Sourcetree's export windows: suggested name, last folder remembered, shown in
# front of the Git Deck window (a hidden top-most owner keeps it from opening behind it).
function Select-SaveFile([string]$Title, [string]$Filter, [string]$FileName) {
    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-Object System.Windows.Forms.SaveFileDialog
    $dialog.Title = $Title; $dialog.Filter = $Filter; $dialog.FileName = $FileName
    $dialog.OverwritePrompt = $true; $dialog.AddExtension = $true
    $folder = $script:LastExportFolder
    if (-not $folder -or -not (Test-Path -LiteralPath $folder)) { $folder = [Environment]::GetFolderPath('MyDocuments') }
    $dialog.InitialDirectory = $folder
    $owner = New-Object System.Windows.Forms.Form
    $owner.TopMost = $true; $owner.ShowInTaskbar = $false; $owner.Opacity = 0; $owner.StartPosition = 'CenterScreen'
    try {
        $owner.Show(); $owner.Activate()
        if ($dialog.ShowDialog($owner) -ne [System.Windows.Forms.DialogResult]::OK) { return '' }
        $script:LastExportFolder = Split-Path -Parent $dialog.FileName
        return $dialog.FileName
    } finally { $owner.Close(); $owner.Dispose(); $dialog.Dispose() }
}

# Where an export goes: the save dialog, or Git Deck's exports folder when the caller opts out (askLocation=false).
function Resolve-ExportPath($Body, [string]$Title, [string]$Filter, [string]$FileName) {
    if ($Body.askLocation -eq $false) { return (Join-Path $script:ExportsRoot $FileName) }
    return (Select-SaveFile $Title $Filter $FileName)
}
