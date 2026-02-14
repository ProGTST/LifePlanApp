@echo off
:: Right-click this file -> "Run as administrator" to add Defender exclusions.
:: Then run "npm run tauri dev" in a normal terminal.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0add-defender-exclusion.ps1"
pause
