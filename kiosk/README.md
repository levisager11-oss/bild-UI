# KI-Bildgenerator – Kiosk für den Tag der offenen Tür

Touch-Oberfläche für ComfyUI im Design der Technischen Fachschule Bern. Besucher beschreiben ein Bild, die KI erstellt es in rund 15 Sekunden. Es wird nichts gespeichert.

## Starten

Doppelklick auf `start-kiosk.bat`. Das startet den Server und öffnet Edge im Vollbild. Beenden mit Alt+F4.

Manuell:

```bash
node server.js
```

Dann `http://localhost:8080` öffnen. Benötigt nur Node.js 18 oder neuer, keine Pakete.

## Einstellungen

| Was | Wo |
| --- | --- |
| ComfyUI-Adresse | Umgebungsvariable `COMFY_URL` (Standard `http://192.168.60.37:8188`) |
| Port der Oberfläche | Umgebungsvariable `PORT` (Standard `8080`) |
| Prompt-Ideen | `public/ideas.js` |
| Zeit bis Auto-Reset | `IDLE_MS` und `IDLE_COUNTDOWN` oben in `public/app.js` |
| Bildformate | `FORMATS` in `server.js` und `public/app.js` |
| Schritte, Sampler, Modelle | `workflow.json` |

## Ablauf

1. `server.js` setzt den Text in `workflow.json` ein, wählt zufällige Seeds und schickt den Auftrag an ComfyUI.
2. Qwen 3.5 9B (Prompt-Upsampler) macht aus dem kurzen Text eine ausführliche englische Bildbeschreibung. Systemprompt: `system_prompt.txt`, aus der offiziellen ComfyUI-Vorlage «FLUX 3 Image Klein Distilled».
3. Flux 3 Image Klein (distilled) malt das Bild in 16 Schritten. Die Zwischenbilder kommen live über den Websocket.
4. Das Ergebnis liegt nur im Temp-Ordner von ComfyUI (`PreviewImage`), der beim Neustart von ComfyUI geleert wird.

Der Server leitet `/comfy/...` und den Websocket an ComfyUI weiter, weil ComfyUI keine CORS-Header sendet.
