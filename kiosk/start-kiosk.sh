#!/usr/bin/env bash
# Startet den Kiosk-Server und öffnet Chromium im Vollbild-Kiosk-Modus (Raspberry Pi OS / Linux).
# Gegenstück zu start-kiosk.bat. Beenden: Alt+F4 im Browser, danach stoppt auch der Server.

cd "$(dirname "$(readlink -f "$0")")" || exit 1
export COMFY_URL="${COMFY_URL:-http://192.168.60.37:8188}"
PORT="${PORT:-8080}"
export PORT

# Mitgeliefertes Node (Ordner node/) bevorzugen, sonst installiertes Node verwenden.
NODE=node
[ -x ./node/bin/node ] && NODE=./node/bin/node
if ! command -v "$NODE" >/dev/null 2>&1; then
  echo "Node.js fehlt. Bitte zuerst: bash install-pi.sh" >&2
  exit 1
fi

# --use-system-ca gibt es erst ab Node 22.15. Ältere Node-Versionen nutzen ihre eigene Zertifikatsliste,
# das reicht für ask (öffentliches Sectigo-Zertifikat) zusammen mit ask-ca.pem.
NODE_ARGS=()
"$NODE" --use-system-ca -e 0 >/dev/null 2>&1 && NODE_ARGS+=(--use-system-ca)
# ask-ca.pem: Zwischenzertifikat von ask, der Server schickt seit Aug. 2026 ein falsches mit.
[ -f ask-ca.pem ] && export NODE_EXTRA_CA_CERTS="$PWD/ask-ca.pem"

mkdir -p data
# Endlosschleife: Falls der Server einmal abbricht, startet er nach 3 Sekunden neu.
PIDFILE="$PWD/data/server.pid"
(
  while true; do
    "$NODE" "${NODE_ARGS[@]}" server.js &
    echo $! >"$PIDFILE"
    wait $!
    sleep 3
  done
) >>data/server.log 2>&1 &
LOOP_PID=$!
# Beim Beenden zuerst die Schleife, dann den Server stoppen.
trap 'kill "$LOOP_PID" 2>/dev/null; [ -f "$PIDFILE" ] && kill "$(cat "$PIDFILE")" 2>/dev/null; rm -f "$PIDFILE"' EXIT

# Warten, bis der Server antwortet (höchstens 30 s).
for _ in $(seq 60); do
  (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null && break
  sleep 0.5
done

# Bildschirm nicht abschalten (X11; unter Wayland erledigt das install-pi.sh über raspi-config).
command -v xset >/dev/null 2>&1 && [ -n "$DISPLAY" ] && xset s off -dpms s noblank 2>/dev/null

BROWSER=""
for b in chromium chromium-browser; do
  command -v "$b" >/dev/null 2>&1 && BROWSER="$b" && break
done
if [ -z "$BROWSER" ]; then
  echo "Chromium fehlt. Bitte zuerst: bash install-pi.sh" >&2
  exit 1
fi

# Eigenes Profil: keine «Wiederherstellen?»-Leiste nach einem Stromausfall, keine Anmeldung.
PROFILE="$PWD/data/chromium"
mkdir -p "$PROFILE"
sed -i 's/"exited_cleanly":false/"exited_cleanly":true/; s/"exit_type":"[^"]*"/"exit_type":"Normal"/' \
  "$PROFILE/Default/Preferences" 2>/dev/null

"$BROWSER" --kiosk "http://localhost:$PORT" \
  --user-data-dir="$PROFILE" \
  --no-first-run --noerrdialogs --disable-infobars --disable-session-crashed-bubble \
  --disable-pinch --overscroll-history-navigation=0 \
  --disable-features=Translate,TranslateUI --password-store=basic \
  --check-for-update-interval=31536000 \
  >>data/browser.log 2>&1
