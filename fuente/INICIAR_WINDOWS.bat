@echo off
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
 echo Necesitas Node.js instalado para abrir la copia local.
 echo Instala Node.js, vuelve a abrir esta carpeta y ejecuta este archivo.
 pause
 exit /b 1
)
node serve.cjs
pause
