# Windows Defender: Add exclusions so Cargo build can run (fix "access denied" on probe files)
# Run as Administrator: Right-click PowerShell -> "Run as administrator"

$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "ERROR: Run PowerShell as Administrator (right-click -> Run as administrator)" -ForegroundColor Red
    exit 1
}

$paths = @(
    "$env:USERPROFILE\.cargo"
    "$env:TEMP"
)
if ($PSScriptRoot) { $paths += (Split-Path -Parent $PSScriptRoot) }

foreach ($p in $paths) {
    try {
        Add-MpPreference -ExclusionPath $p
        Write-Host "Added exclusion: $p" -ForegroundColor Green
    } catch {
        Write-Host "Failed: $p - $_" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "Done. Close this window, open a normal terminal, then run: npm run tauri dev" -ForegroundColor Cyan
