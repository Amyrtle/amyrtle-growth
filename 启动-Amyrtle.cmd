@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto missingnode
if exist node_modules\tsx\dist\cli.mjs goto build
call npm.cmd ci --no-fund --no-audit
if errorlevel 1 goto failed
:build
call npm.cmd run build
if errorlevel 1 goto failed
echo.
echo Amyrtle Growth: http://127.0.0.1:4173
echo Keep this window open. Press Ctrl+C to stop.
echo.
call npm.cmd start
if errorlevel 1 goto failed
exit /b 0
:missingnode
echo Please install Node.js 24 LTS first.
pause
exit /b 1
:failed
echo Startup failed. See the error above or README.md.
pause
exit /b 1
