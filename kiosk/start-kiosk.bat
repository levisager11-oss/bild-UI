@echo off
rem Startet den Kiosk-Server und oeffnet Edge im Vollbild-Kiosk-Modus.
rem Beenden: Alt+F4 im Browser, danach das Server-Fenster schliessen.

cd /d "%~dp0"
if "%COMFY_URL%"=="" set COMFY_URL=http://192.168.60.37:8188

start "Kiosk-Server" /min node server.js
timeout /t 2 /nobreak >nul

start "" msedge --kiosk http://localhost:8080 --edge-kiosk-type=fullscreen --no-first-run --disable-pinch --overscroll-history-navigation=0
