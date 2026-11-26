@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" -AddToPath
if errorlevel 1 (
  echo Installation failed. See the error above.
  pause
  exit /b 1
)
pause
