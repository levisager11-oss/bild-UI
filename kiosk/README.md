# KI-Bildgenerator – Kiosk für den Tag der offenen Tür

Touch-Oberfläche für ComfyUI im Design der Technischen Fachschule Bern. Besucher beschreiben ein Bild, die KI erstellt es in rund 15 Sekunden.

## Starten

Doppelklick auf `start-kiosk.bat`. Das startet den Server und öffnet Edge im Vollbild. Beenden mit Alt+F4.

Manuell:

```bash
node --use-system-ca server.js
```

Dann `http://localhost:8080` öffnen. `--use-system-ca` lässt Node die Zertifikate von Windows verwenden. Ohne diese Option scheitert die Verbindung zu ask, weil ask ein Zertifikat der Schule nutzt (Fehler `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` im Server-Fenster). Benötigt nur Node.js 18 oder neuer, keine Pakete. Die Seite ist nur vom Kiosk-PC selbst erreichbar (`HOST=0.0.0.0` öffnet sie fürs Netz).

## Funktionen

- Prompt-Ideen, Würfel (Wer + macht was + wo) und 8 Stil-Knöpfe
- Format Quadrat/Hoch/Quer, 1, 2 oder 4 Bilder auf einmal
- Fortschritt mit Live-Vorschau und «Wusstest du?»-Texten (KI und Schule)
- Ergebnis: Raster bei mehreren Bildern, «Was hat die KI verstanden?», «Technik» (Modelle, Seed, Schritte, Dauer, Grafikkarte)
- Profi-Einstellungen für Besucher: Schritte, Seed, Sampler, Prompt-Verbesserer und Recherche an/aus
- Optional: Recherche im Web über ask, wenn ein Prompt Weltwissen braucht (siehe unten)
- Bildzähler «Heute schon … Bilder erstellt»
- Hinweis, wenn ComfyUI nicht erreichbar ist
- Auto-Reset nach Inaktivität, danach Bildschirmschoner mit Beispielbildern und den letzten Besucherbildern

## Recherche mit ask (optional)

Bei Prompts mit bestimmten Dingen aus der echten Welt (Orte, Bauwerke, Fahrzeuge, Tierarten …) fragt der Kiosk zuerst ask, das Sprachmodell der Schule (Open WebUI unter `ask.ict-tfbern.ch`). Der Ablauf:

1. **Prüfen** (ca. 1–2 s): ask entscheidet, ob der Prompt Wissen braucht, und schlägt einen Suchbegriff vor. «Eine Katze mit Helm» braucht keins und geht direkt weiter.
2. **Recherchieren** (ca. 5 s): Die Websuche von Open WebUI liefert Treffer, der Kiosk-Server liest die 3 besten Seiten, ask fasst daraus das Aussehen zusammen. Quellen sind die gelesenen Seiten.
3. Die Fakten gehen zusammen mit dem Prompt an den Prompt-Verbesserer (Qwen 9B) und von dort an Flux.

Warum nicht einfach «Websuche an» beim Modell? Über die API von Open WebUI sucht das Modell nicht selbst, es erfindet dann Fakten und Quellen. Deshalb nutzt der Kiosk die Such-Schnittstelle von Open WebUI (`/api/v1/retrieval/process/web/search`) direkt. Open WebUI legt dabei pro Suche eine Sammlung `web-search-…` an, wie bei einer Suche im Chat.

Getestet (Okt. 2026): `ask-tfbern-beta` liefert die genauesten Fakten (ca. 5 s), `ask-tfbern` ist schneller, schmückt aber eher aus, `ask-base-nx` ist am langsamsten. `ask-base` soll laut Beschreibung nicht für Chats genutzt werden.

Besucher sehen die Phase «Recherche» mit dem Suchbegriff im Fortschritt. Fakten und Quellen stehen unter «Was hat die KI verstanden?». Fällt ask aus oder antwortet zu langsam, läuft alles ohne Recherche weiter.

**Einrichten:** `ask.example.json` nach `data/ask.json` kopieren und ausfüllen:

| Feld | Inhalt |
| --- | --- |
| `url` | Basis-Adresse der API, für ask `https://ask.ict-tfbern.ch/api` (der Kiosk hängt `/chat/completions`, `/models` und `/v1/retrieval/…` an) |
| `apiKey` | API-Schlüssel aus ask (Einstellungen → Konto), wird als `Authorization: Bearer …` gesendet |
| `model` | Modell-ID, empfohlen `ask-tfbern-beta` (Liste: `GET /api/models`) |
| `search` | `openwebui` (Standard): Websuche über Open WebUI, Seiten liest der Kiosk. `model`: das Modell sucht selbst (nur für andere Server, die das über die API können) |
| `planExtra` / `searchExtra` | Zusätzliche Felder für die beiden Anfragen ans Modell. Für ask `{ "features": { "web_search": false } }`, damit Open WebUI nicht zusätzlich selbst sucht |
| `timeoutMs` | Höchstwartezeit für die Zusammenfassung, Standard 25000 |

Alternativ gehen Umgebungsvariablen: `ASK_URL`, `ASK_KEY`, `ASK_MODEL`. Änderungen an `data/ask.json` gelten sofort, ohne Neustart. Ob ask erreichbar ist, zeigt das Betreuer-Menü. Dort lässt sich die Recherche auch ganz abschalten, Besucher können sie in den Profi-Einstellungen ausschalten.

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
