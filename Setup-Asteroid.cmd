@echo off
setlocal
cd /d "%~dp0"
node scripts\setup-asteroids.mjs
if errorlevel 1 (
  echo Asteroid analysis setup could not finish. Check the error above.
  pause
  exit /b 1
)
echo Asteroid analysis is ready. Start the website with Start-Web.cmd.
pause
