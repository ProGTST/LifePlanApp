# Windows Defender: Add exclusions so Cargo build can run.
# - Fixes "access denied" on cargo install / probe files.
# - Fixes pre-commit "build-script-build が見つかりません" (exe is removed by Defender during build).
# Run as Administrator: Right-click PowerShell -> "Run as administrator"

$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "ERROR: This script requires Administrator rights." -ForegroundColor Red
    Write-Host ""
    Write-Host "1. Close this window." -ForegroundColor Yellow
    Write-Host "2. Right-click the PowerShell icon (or Windows Terminal -> PowerShell)." -ForegroundColor Yellow
    Write-Host "3. Click 'Run as administrator'." -ForegroundColor Yellow
    Write-Host "4. In the new window, run:" -ForegroundColor Yellow
    Write-Host "   cd D:\dev\DevEnv\local\LifePlanGant" -ForegroundColor Cyan
    Write-Host "   .\scripts\add-defender-exclusion.ps1" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Note: Use .\scripts\... (with the dot). Do not use \scripts\..." -ForegroundColor Gray
    exit 1
}

$repoRoot = if ($PSScriptRoot) { Split-Path -Parent $PSScriptRoot } else { $null }
$paths = @(
    "$env:USERPROFILE\.cargo"
    "$env:USERPROFILE\.cargo-install-build"
    "$env:USERPROFILE\.cargo-tmp"
    "$env:TEMP"
)
if ($repoRoot) {
    $paths += $repoRoot
    $paths += (Join-Path $repoRoot "src-tauri\target")
}

$anyFailed = $false
foreach ($p in $paths) {
    try {
        Add-MpPreference -ExclusionPath $p -ErrorAction Stop
        Write-Host "Added exclusion: $p" -ForegroundColor Green
    } catch {
        $anyFailed = $true
        Write-Host "Failed: $p" -ForegroundColor Red
        Write-Host "  $($_.Exception.Message)" -ForegroundColor Gray
    }
}

Write-Host ""
if ($anyFailed) {
    Write-Host "0x800106ba = Defender is managed by policy or Tamper Protection. Exclusions were NOT applied." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "For pre-commit Clippy errors, commit with (PowerShell):" -ForegroundColor Cyan
    Write-Host "  `$env:SKIP_CLIPPY=1; git commit -m `"your message`"" -ForegroundColor White
    Write-Host "CI will still run Clippy on push. See docs\CODING_CHECKS.md" -ForegroundColor Gray
} else {
    Write-Host "Done. You can run: cd src-tauri && cargo clean && then retry commit." -ForegroundColor Cyan
}
Write-Host ""
Write-Host "If cargo install fails with access denied, use the binary download method in docs\CODING_CHECKS.md" -ForegroundColor Gray
