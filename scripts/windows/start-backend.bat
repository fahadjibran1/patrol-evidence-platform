@echo off
setlocal

REM Starts the NestJS backend from the project root.
REM If you move the project, update PROJECT_ROOT below or keep this file inside scripts\windows.

set SCRIPT_DIR=%~dp0
for %%I in ("%SCRIPT_DIR%..\..") do set PROJECT_ROOT=%%~fI

cd /d "%PROJECT_ROOT%"

if not exist logs (
  mkdir logs
)

echo Starting backend from %PROJECT_ROOT%
echo Logs: %PROJECT_ROOT%\logs\backend.log

call npm run start >> "%PROJECT_ROOT%\logs\backend.log" 2>&1

endlocal
