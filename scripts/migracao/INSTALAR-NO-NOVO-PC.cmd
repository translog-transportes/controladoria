@echo off
rem Instala o ERP Construtoras neste computador a partir deste pacote.
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0instalar.ps1"
echo.
pause
