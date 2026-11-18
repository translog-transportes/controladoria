@echo off
rem Inicia o ERP Construtoras em http://localhost:3000 (feche esta janela para parar)
cd /d "%~dp0"
net start MySQL84 >nul 2>&1
start "" http://localhost:3000
"C:\Program Files\nodejs\node.exe" src\server.js
pause
