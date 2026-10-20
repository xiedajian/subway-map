@echo off
setlocal
cd /d "%~dp0"

set "PYCMD=python"
where python >nul 2>nul
if errorlevel 1 (
  set "PYCMD=py -3"
  where py >nul 2>nul
  if errorlevel 1 (
    echo.
    echo   [ERROR] neither "python" nor "py" was found in PATH.
    echo   Install Python 3, or serve this folder on port 8000 with any static server.
    echo   Example with Node:  npx --yes serve -l 8000 .
    echo.
    pause
    exit /b 1
  )
)

echo.
echo   subway-map :: local static data viewer
echo   url  : http://localhost:8000/
echo   stop : close the minimized window named "subway-map server"
echo.

start "subway-map server" /min cmd /k %PYCMD% -m http.server 8000
timeout /t 2 /nobreak >nul
start "" http://localhost:8000/
exit /b 0
