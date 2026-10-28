# KI-Bildgenerator – Kiosk für den Tag der offenen Tür

Touch-Oberfläche für ComfyUI im Design der Technischen Fachschule Bern. Besucher beschreiben ein Bild, die KI erstellt es in rund 15 Sekunden.

## Starten

Doppelklick auf `start-kiosk.bat`. Das startet den Server und öffnet Edge im Vollbild. Beenden mit Alt+F4.

Manuell:

```bash
node server.js
```

Dann `http://localhost:8080` öffnen. Benötigt nur Node.js 18 oder neuer, keine Pakete. Die Seite ist nur vom Kiosk-PC selbst erreichbar (`HOST=0.0.0.0` öffnet sie fürs Netz).

## Funktionen

- Prompt-Ideen, Würfel (Wer + macht was + wo) und 8 Stil-Knöpfe
- Format Quadrat/Hoch/Quer, 1, 2 oder 4 Bilder auf einmal
- Fortschritt mit Live-Vorschau und «Wusstest du?»-Texten (KI und Schule)
- Ergebnis: Raster bei mehreren Bildern, «Was hat die KI verstanden?», «Technik» (Modelle, Seed, Schritte, Dauer, Grafikkarte)
- Profi-Einstellungen für Besucher: Schritte, Seed, Sampler, Prompt-Verbesserer an/aus
- Bildzähler «Heute schon … Bilder erstellt»
- Hinweis, wenn ComfyUI nicht erreichbar ist
- Auto-Reset nach Inaktivität, danach Bildschirmschoner mit Beispielbildern und den letzten Besucherbildern

## Betreuer-Menü

**Strg+Alt+B** auf einer angeschlossenen Tastatur. Zeigt den Status (ComfyUI, Grafikkarte, Warteschlange) und erlaubt:

- Standard-Schritte, max. Anzahl Bilder, Auto-Reset- und Bildschirmschoner-Zeit
- Prompt-Verbesserer, Besucherbilder im Schoner und Profi-Einstellungen an/aus
- Warteschlange leeren, Besucherbilder aus dem Schoner entfernen, Bildzähler zurücksetzen, Schoner testen

Einstellungen und Zähler liegen in `data/` (nicht im Git).

## Anpassen

| Was | Wo |
| --- | --- |
| ComfyUI-Adresse | Umgebungsvariable `COMFY_URL` (Standard `http://192.168.60.37:8188`) |
| Port | Umgebungsvariable `PORT` (Standard `8080`) |
| Prompt-Ideen und Würfel-Bausteine | `public/ideas.js` |
| Texte während der Wartezeit | `public/facts.js` (Schul-Fakten von tfbern.ch, bitte vor dem Anlass prüfen) |
| Beispielbilder für den Schoner | `public/examples/` und `examples.json` |
| Stile | `STYLES` in `server.js` und `public/app.js` |
| Modelle, Sampler-Standard | `workflow.json` |

## Ablauf

1. `server.js` setzt Text und Stil in `workflow.json` ein, wählt Seeds und schickt den Auftrag an ComfyUI.
2. Qwen 3.5 9B (Prompt-Verbesserer) macht aus dem kurzen Text eine ausführliche englische Bildbeschreibung. Systemprompt: `system_prompt.txt`, aus der offiziellen ComfyUI-Vorlage «FLUX 3 Image Klein Distilled».
3. Flux 3 Image Klein (distilled) malt das Bild, standardmässig in 16 Schritten. Zwischenbilder kommen live über den Websocket.
4. Die Bilder liegen nur im Temp-Ordner von ComfyUI (`PreviewImage`). Für den Bildschirmschoner merkt sich der Server die letzten 30 im Speicher; nach einem Neustart sind sie weg.

Der Server leitet `/comfy/...` und den Websocket an ComfyUI weiter, weil ComfyUI keine CORS-Header sendet.
