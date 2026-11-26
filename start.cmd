@echo off
rem Starts the Dhruva Setu page on this computer and opens it in the browser.
rem Close this window to stop it.
cd /d "%~dp0web"
if not exist node_modules call npm install --ignore-scripts
if not exist dist call npm run build
start "" http://localhost:4173
call npm run preview -- --port 4173 --strictPort
