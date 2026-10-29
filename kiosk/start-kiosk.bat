@echo off
rem Startet den Kiosk-Server und oeffnet Edge im Vollbild-Kiosk-Modus.
rem Beenden: Alt+F4 im Browser, danach das Server-Fenster schliessen.

cd /d "%~dp0"
if "%COMFY_URL%"=="" set COMFY_URL=http://192.168.60.37:8188

rem Mitgeliefertes Node (Ordner node\) bevorzugen, sonst installiertes Node verwenden.
set "NODE=node"
if exist "%~dp0node\node.exe" set "NODE=%~dp0node\node.exe"

rem --use-system-ca: Zertifikate von Windows verwenden (ask nutzt ein Zertifikat der Schule)
rem Endlosschleife: Falls der Server einmal abbricht, startet er nach 3 Sekunden neu.
start "Kiosk-Server" /min cmd /c "for /l %%i in (0,0,1) do ("%NODE%" --use-system-ca server.js & timeout /t 3 /nobreak >nul)"
timeout /t 2 /nobreak >nul

start "" msedge --kiosk http://localhost:8080 --edge-kiosk-type=fullscreen --no-first-run --disable-pinch --overscroll-history-navigation=0
