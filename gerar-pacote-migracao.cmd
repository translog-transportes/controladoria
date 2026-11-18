@echo off
rem Gera o pacote (.zip) para levar o ERP Construtoras para outro computador.
rem O arquivo fica na pasta "migracao", dentro da pasta do sistema.
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\migracao\gerar-pacote.ps1"
echo.
pause
