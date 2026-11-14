@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 or newer is required. Install it from https://nodejs.org/
  pause
  exit /b 1
)
node scripts\setup.mjs
if errorlevel 1 goto failed
node scripts\build.mjs
if errorlevel 1 goto failed
node scripts\serve.mjs --open
if errorlevel 1 goto failed
exit /b 0
:failed
echo.
echo The site could not start. Check the error above.
pause
exit /b 1
