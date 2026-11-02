@echo off
rem Builds and starts Pulse (Windows port) from this folder, whatever directory you launch it from.
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies...
  call npm install
)
echo Building...
call npx electron-vite build
if errorlevel 1 (
  echo.
  echo Build failed - copy the text above and send it back.
  pause
  exit /b 1
)
echo Starting Pulse...
call npx electron-vite preview
echo.
echo Pulse exited with code %errorlevel%.
echo ---- startup log (%APPDATA%\Pulse\pulse.log) ----
if exist "%APPDATA%\Pulse\pulse.log" ( type "%APPDATA%\Pulse\pulse.log" ) else ( echo no log file was written )
pause
