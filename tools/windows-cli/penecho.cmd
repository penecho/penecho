@echo off
setlocal
set "PATH=%~dp0runtime;%PATH%"
set "PENECHO_SKIP_UPDATE_CHECK=1"
"%~dp0runtime\node.exe" "%~dp0app\cli.js" %*
exit /b %errorlevel%
