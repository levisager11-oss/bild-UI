#!/usr/bin/env bash
# Richtet einen Raspberry Pi (Raspberry Pi OS mit Desktop) als Kiosk ein. Einmal ausführen:
#   bash install-pi.sh
# Installiert Node.js und Chromium, startet den Kiosk nach dem Anmelden automatisch,
# meldet den Benutzer automatisch an und schaltet den Bildschirm nie ab.
set -e
cd "$(dirname "$(readlink -f "$0")")"
DIR="$PWD"

if [ "$(id -u)" = 0 ]; then
  echo "Bitte als normaler Benutzer starten (nicht mit sudo), das Skript fragt selbst nach dem Passwort." >&2
  exit 1
fi

echo "== Pakete installieren"
sudo apt-get update
if ! command -v node >/dev/null 2>&1 && [ ! -x node/bin/node ]; then
  sudo apt-get install -y nodejs
fi
if ! command -v chromium >/dev/null 2>&1 && ! command -v chromium-browser >/dev/null 2>&1; then
  sudo apt-get install -y chromium || sudo apt-get install -y chromium-browser
fi

NODE=node; [ -x node/bin/node ] && NODE="$DIR/node/bin/node"
MAJOR=$("$NODE" -p 'process.versions.node.split(".")[0]')
if [ "$MAJOR" -lt 18 ]; then
  echo "Node.js $("$NODE" -v) ist zu alt, der Kiosk braucht 18 oder neuer." >&2
  exit 1
fi
echo "Node.js $("$NODE" -v) ok"

# Windows-Zeilenenden entfernen, falls die Dateien über ein Windows-ZIP kamen.
sed -i 's/\r$//' start-kiosk.sh install-pi.sh check-pi.sh
chmod +x start-kiosk.sh install-pi.sh check-pi.sh
mkdir -p data

echo "== Autostart einrichten"
# XDG-Autostart wird von allen Desktops von Raspberry Pi OS gelesen (labwc, Wayfire, LXDE/X11).
mkdir -p "$HOME/.config/autostart"
cat >"$HOME/.config/autostart/tfbern-kiosk.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=TF Bern KI-Kiosk
Exec=$DIR/start-kiosk.sh
X-GNOME-Autostart-enabled=true
EOF

if command -v raspi-config >/dev/null 2>&1; then
  echo "== Automatische Anmeldung und Bildschirm immer an"
  sudo raspi-config nonint do_boot_behaviour B4 || echo "Hinweis: automatische Anmeldung konnte nicht gesetzt werden."
  sudo raspi-config nonint do_blanking 1 || echo "Hinweis: Bildschirmschoner konnte nicht abgeschaltet werden."
fi

echo
echo "Fertig. Nach einem Neustart (sudo reboot) startet der Kiosk von selbst."
echo "Jetzt gleich testen: $DIR/start-kiosk.sh"
[ -f data/ask.json ] || echo "Hinweis: data/ask.json fehlt noch (Recherche mit ask), siehe README."
