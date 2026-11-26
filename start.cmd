@echo off
rem Starts the Dhruva Setu page on this computer and opens it in the browser.
rem Close this window to stop it.
setlocal
cd /d "%~dp0web"

rem Already running: show that page and leave it alone.
netstat -ano | findstr /r /c:":4173 .*LISTENING" >nul
if not errorlevel 1 (
  start "" http://localhost:4173
  exit /b 0
)

if not exist node_modules (
  call npm install --ignore-scripts
  if errorlevel 1 goto failed
)

rem Build every time, so the page always matches the code in this folder.
call npm run build
if errorlevel 1 (
  if not exist dist\index.html goto failed
  echo.
  echo The build failed. Showing the last good build instead.
)

rem The browser opens by itself once the page can be served, not before.
call npm run preview -- --port 4173 --strictPort --open
if errorlevel 1 (
  echo.
  echo The page server has stopped. The messages above say why.
  pause
)
exit /b 0

:failed
echo.
echo Could not prepare the page. The messages above say why.
pause
exit /b 1
