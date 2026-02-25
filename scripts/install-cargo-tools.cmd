@echo off
REM Install cargo-audit and cargo-deny (run from project dir, not System32)

set "CARGO_TARGET_DIR=%USERPROFILE%\.cargo-install-build"
set "TMP=%USERPROFILE%\.cargo-tmp"
set "TEMP=%USERPROFILE%\.cargo-tmp"

if not exist "%TMP%" mkdir "%TMP%"
if not exist "%CARGO_TARGET_DIR%" mkdir "%CARGO_TARGET_DIR%"

echo CARGO_TARGET_DIR=%CARGO_TARGET_DIR%
echo TMP/TEMP=%TMP%
echo.
echo Installing cargo-audit and cargo-deny...
cargo install cargo-audit cargo-deny
if errorlevel 1 (
  echo.
  echo Install failed. Try: run from user dir, not Admin; or download exe from GitHub Releases.
  exit /b 1
)
echo.
echo Done.
exit /b 0
