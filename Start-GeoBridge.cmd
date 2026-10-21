@echo off
cd /d "%~dp0"
set "GEOBRIDGE_NODE=node"
where node >nul 2>nul
if errorlevel 1 set "GEOBRIDGE_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
echo GeoBridge - local Open Banking assurance
echo Open http://127.0.0.1:4317 after the server starts.
echo Credentials: data\demo-credentials.json
"%GEOBRIDGE_NODE%" --env-file-if-exists=.env src/server.mjs
pause
