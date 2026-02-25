# Download cargo-audit and cargo-deny Windows binaries (no build, no PermissionDenied).
# Run in PowerShell (no Admin required). Requires: .cargo\bin in PATH.

$ErrorActionPreference = "Stop"
$binDir = Join-Path $env:USERPROFILE ".cargo\bin"
$tempDir = Join-Path $env:TEMP "cargo-tools-download"

if (-not (Test-Path $binDir)) {
    New-Item -ItemType Directory -Path $binDir -Force | Out-Null
    Write-Host "Created: $binDir" -ForegroundColor Green
}

if (-not (Test-Path $tempDir)) {
    New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
}

try {
    # cargo-audit (zip)
    $auditZip = "https://github.com/rustsec/rustsec/releases/download/cargo-audit/v0.22.1/cargo-audit-x86_64-pc-windows-msvc-v0.22.1.zip"
    $auditDest = Join-Path $tempDir "cargo-audit.zip"
    Write-Host "Downloading cargo-audit..." -ForegroundColor Cyan
    Invoke-WebRequest -Uri $auditZip -OutFile $auditDest -UseBasicParsing
    Expand-Archive -Path $auditDest -DestinationPath $tempDir -Force
    $auditExe = Get-ChildItem -Path $tempDir -Filter "cargo-audit.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($auditExe) {
        Copy-Item -Path $auditExe.FullName -Destination (Join-Path $binDir "cargo-audit.exe") -Force
        Write-Host "Installed: cargo-audit.exe" -ForegroundColor Green
    } else {
        Write-Host "cargo-audit.exe not found in archive" -ForegroundColor Red
    }

    # cargo-deny (tar.gz) - Windows 10+ has tar
    $denyTgz = "https://github.com/EmbarkStudios/cargo-deny/releases/download/0.19.0/cargo-deny-0.19.0-x86_64-pc-windows-msvc.tar.gz"
    $denyDest = Join-Path $tempDir "cargo-deny.tar.gz"
    Write-Host "Downloading cargo-deny..." -ForegroundColor Cyan
    Invoke-WebRequest -Uri $denyTgz -OutFile $denyDest -UseBasicParsing
    $denyExtract = Join-Path $tempDir "cargo-deny"
    if (-not (Test-Path $denyExtract)) { New-Item -ItemType Directory -Path $denyExtract -Force | Out-Null }
    Set-Location $denyExtract
    tar -xzf $denyDest 2>$null
    if (-not $?) {
        Write-Host "tar failed; trying alternative extraction..." -ForegroundColor Yellow
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $gz = [System.IO.Compression.GZipStream]::new([System.IO.File]::OpenRead($denyDest), [System.IO.Compression.CompressionMode]::Decompress)
        $tarPath = Join-Path $tempDir "cargo-deny.tar"
        $tarFile = [System.IO.File]::Create($tarPath)
        $gz.CopyTo($tarFile)
        $tarFile.Close(); $gz.Close()
        tar -xf $tarPath -C $denyExtract 2>$null
    }
    Set-Location $env:USERPROFILE
    $denyExe = Get-ChildItem -Path $denyExtract -Filter "cargo-deny.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($denyExe) {
        Copy-Item -Path $denyExe.FullName -Destination (Join-Path $binDir "cargo-deny.exe") -Force
        Write-Host "Installed: cargo-deny.exe" -ForegroundColor Green
    } else {
        Write-Host "cargo-deny.exe not found in archive" -ForegroundColor Red
    }
}
finally {
    if (Test-Path $tempDir) {
        Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host ""
Write-Host "Done. Check: cargo audit --version  and  cargo deny --version" -ForegroundColor Cyan
Write-Host "If not found, ensure %USERPROFILE%\.cargo\bin is in your PATH." -ForegroundColor Yellow
