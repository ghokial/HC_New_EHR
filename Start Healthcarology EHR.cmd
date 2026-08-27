@echo off
setlocal
cd /d "%~dp0"
set "HC_NODE=C:\Users\ghoki\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%HC_NODE%" (
  echo Healthcarology EHR could not find its bundled Node.js runtime.
  echo Open this project through Codex or install Node.js 22 or later.
  pause
  exit /b 1
)
start "Healthcarology EHR Server" /min "%HC_NODE%" server.mjs
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:4173/"
endlocal
