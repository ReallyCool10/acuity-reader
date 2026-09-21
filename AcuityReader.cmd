@echo off
rem Launch Acuity Reader from wherever this repo is checked out.
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo Electron is not installed. Run "npm install" first.
  pause
  exit /b 1
)
start "" "node_modules\electron\dist\electron.exe" .
