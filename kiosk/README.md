# KI-Bildgenerator – Kiosk für den Tag der offenen Tür

Touch-Oberfläche für ComfyUI im Design der Technischen Fachschule Bern. Besucher beschreiben ein Bild, die KI erstellt es in rund 15 Sekunden.

## Starten

Doppelklick auf `start-kiosk.bat`. Das startet den Server und öffnet Edge im Vollbild. Beenden mit Alt+F4.

Manuell:

```bash
node --use-system-ca server.js
```

Dann `http://localhost:8080` öffnen. `--use-system-ca` lässt Node die Zertifikate von Windows verwenden. Ohne diese Option scheitert die Verbindung zu ask, weil ask ein Zertifikat der Schule nutzt (Fehler `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` im Server-Fenster). Benötigt nur Node.js 18 oder neuer, keine Pakete. Die Seite ist nur vom Kiosk-PC selbst erreichbar (`HOST=0.0.0.0` öffnet sie fürs Netz).

## Auf den Kiosk-PC bringen (ohne Installation)

```bash
node pack.js
```

Das erstellt `dist/Kiosk.zip` (ca. 40 MB) mit allem, was der Kiosk braucht, auch `node.exe` im Ordner `node\`. Auf dem Kiosk-PC entpacken (z. B. nach `C:\Kiosk`, nicht im ZIP selbst starten) und `start-kiosk.bat` doppelklicken. Dort muss nichts installiert sein, Edge ist bei Windows dabei. Das Paket enthält den ask-Schlüssel (`data/ask.json`), also nicht weitergeben. Der Bildzähler startet auf dem Kiosk-PC neu.

## Auf einem Raspberry Pi

Der Kiosk läuft auch auf einem Raspberry Pi 4 oder 5 mit Raspberry Pi OS (mit Desktop, 64 Bit empfohlen). Die Bilder rechnet weiterhin ComfyUI auf dem Server mit Grafikkarte, der Pi zeigt nur die Oberfläche in Chromium an. 2 GB RAM reichen, 4 GB sind angenehmer.

1. Auf dem Windows-PC `node pack.js --pi` ausführen. Das erstellt `dist/Kiosk-Pi.zip` (ohne `node.exe`, mit `data/ask.json`, also nicht weitergeben).
2. Die ZIP auf den Pi bringen (USB-Stick oder `scp`) und entpacken, z. B. nach `~/Kiosk`:
   ```bash
   unzip Kiosk-Pi.zip -d ~
   ```
3. Einmal einrichten (fragt nach dem Passwort für `sudo`):
   ```bash
   bash ~/Kiosk/install-pi.sh
   ```
   Das installiert Node.js und Chromium aus Raspberry Pi OS, legt einen Autostart an (`~/.config/autostart/tfbern-kiosk.desktop`), stellt die automatische Anmeldung ein und schaltet das Abdunkeln des Bildschirms ab.
4. `sudo reboot`. Danach startet der Kiosk von selbst im Vollbild.

Von Hand starten: `~/Kiosk/start-kiosk.sh`. Beenden mit Alt+F4, dann stoppt auch der Server. Server-Meldungen stehen in `data/server.log`. Der Pi muss ComfyUI (`192.168.60.37:8188`) erreichen, sonst zeigt die Oberfläche den Hinweis «nicht erreichbar». Andere Adresse: `COMFY_URL=http://… ~/Kiosk/start-kiosk.sh` bzw. die Zeile `Exec=` in der Autostart-Datei anpassen.

**ask oder ComfyUI nicht erreichbar?** `bash ~/Kiosk/check-pi.sh` zeigt Uhrzeit, Node-Version und den genauen Fehler pro Verbindung. Das Betreuer-Menü nennt den Grund ebenfalls in Klammern. Häufige Gründe: `CERT_NOT_YET_VALID` oder `CERT_HAS_EXPIRED` heisst, die Uhr des Pi stimmt nicht. Der Pi 4 hat keine Batterie-Uhr und holt die Zeit per NTP, im Schulnetz evtl. gesperrt. Dann in `/etc/systemd/timesyncd.conf` unter `NTP=` den Zeitserver der Schule eintragen und `sudo systemctl restart systemd-timesyncd`. `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` heisst, ein Zertifikat der Schule fehlt; die `.crt`-Datei nach `/usr/local/share/ca-certificates/` kopieren und `sudo update-ca-certificates`, dann `NODE_EXTRA_CA_CERTS` in `start-kiosk.sh` darauf zeigen lassen. `ETIMEDOUT` oder `ECONNREFUSED` heisst, eine Firewall blockiert den Pi.

Unterschiede zu Windows: Chromium statt Edge, Node.js aus Raspberry Pi OS (Version 18 oder neuer genügt). `--use-system-ca` setzt das Start-Skript nur, wenn das Node es kennt (ab 22.15); `ask-ca.pem` wird wie unter Windows mitgegeben. Bleibt auf dem Touchscreen ein Mauszeiger stehen: in `raspi-config` unter Advanced Options auf X11 umstellen und `unclutter` installieren.

## Funktionen

- Prompt-Ideen, Würfel (Wer + macht was + wo) und 8 Stil-Knöpfe
- Format Quadrat/Hoch/Quer, 1, 2 oder 4 Bilder auf einmal
- Fortschritt mit Live-Vorschau und «Wusstest du?»-Texten (KI und Schule)
- Ergebnis: Raster bei mehreren Bildern, «Was hat die KI verstanden?», «Technik» (Modelle, Seed, Schritte, Dauer, Grafikkarte)
- Profi-Einstellungen für Besucher: Schritte, Seed, Sampler, Prompt-Verbesserer und Recherche an/aus
- Optional: Recherche im Web über ask, wenn ein Prompt Weltwissen braucht (siehe unten)
- Optional: Referenzfoto von Wikipedia für echte Orte, Bauwerke, Tiere und Fahrzeuge (siehe unten)
- Bild per Mail senden: Besucher wählt ein Bild aus und gibt die Mail-Adresse ein (siehe unten)
- Bildzähler «Heute schon … Bilder erstellt»
- Hinweis, wenn ComfyUI nicht erreichbar ist
- Auto-Reset nach Inaktivität, danach Bildschirmschoner mit Beispielbildern und den letzten Besucherbildern

## Recherche mit ask (optional)

Bei Prompts mit bestimmten Dingen aus der echten Welt (Orte, Bauwerke, Fahrzeuge, Tierarten …) fragt der Kiosk zuerst ask, das Sprachmodell der Schule (Open WebUI unter `ask.ict-tfbern.ch`). Der Ablauf:

1. **Prüfen** (ca. 1–2 s): ask entscheidet, ob der Prompt Wissen braucht, und nennt die bestimmten Dinge darin mit Suchbegriff – meist eins, höchstens zwei («Die Roche-Türme vor dem Eiger»). «Eine Katze mit Helm» braucht keins und geht direkt weiter. Eine Stadt oder Gegend als blosser Schauplatz («in Bern», «in den Alpen») zählt nicht als zweites Ding.
2. **Recherchieren** (ca. 5 s): Die Websuche von Open WebUI liefert Treffer, pro Ding eine eigene Suche. Der Kiosk-Server liest die 3 besten Seiten (bei zwei Dingen je 2), ask fasst daraus das Aussehen beider Dinge zusammen. Quellen sind die gelesenen Seiten.
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

**Zertifikat:** Seit dem Zertifikatswechsel im Aug. 2026 schickt `ask.ict-tfbern.ch` ein falsches Zwischenzertifikat mit. Browser merken das nicht, Node lehnt die Verbindung ab («unable to verify the first certificate»), ask gilt dann im Betreuer-Menü als nicht erreichbar. Deshalb liegt das richtige Zwischenzertifikat («Sectigo Public Server Authentication CA DV R36», gültig bis 2036) als `ask-ca.pem` bei, `start-kiosk.bat` gibt es Node über `NODE_EXTRA_CA_CERTS` mit. Wird der Server von Hand gestartet: `set NODE_EXTRA_CA_CERTS=ask-ca.pem` vorher setzen. Sobald die ICT die Kette auf dem Server korrigiert, ist die Datei nicht mehr nötig, schadet aber auch nicht.

Seit Ende Okt. 2026 hat ask ein Zertifikat der schuleigenen CA (`ICT-TFBERN-ROOT-CA`, Zwischen-CA `ict-tfbern-subCA`). Windows-PCs der Schule kennen sie, der Raspberry Pi nicht (Fehler `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`). Deshalb stehen beide Zertifikate ebenfalls in `ask-ca.pem` (öffentliche Zertifikate, nichts Geheimes). Wechselt die ICT die CA, die neuen Zertifikate aus Windows exportieren (certlm.msc → Vertrauenswürdige Stammzertifizierungsstellen, Base-64) und an `ask-ca.pem` anhängen.

## Referenzfotos von Wikipedia

Nennt ein Wunsch ein bestimmtes echtes Ding (Zytglogge, Matterhorn, Bartgeier, Tesla Cybertruck …), zeigt der Kiosk dem Bildmodell ein Foto davon. Das Motiv sieht dadurch deutlich echter aus. Ablauf:

1. Beim Prüfen nennt ask für jedes Ding (höchstens zwei) den passenden deutschen Wikipedia-Artikel und einen englischen Namen, dazu ob es eine echte Person ist und ob das Motiv verwandelt wird («als Raumschiff»).
2. Der Server holt das Hauptbild jedes Artikels, nur frei lizenzierte Bilder (`pilicense=free`), dazu Urheber und Lizenz von Wikimedia Commons. Er lädt es in den Input-Ordner von ComfyUI und merkt es sich 1 Stunde. Läuft parallel zur Web-Recherche.
3. Die Fotos gehen ans Bildmodell (`ReferenceMultiLatent`, 0,5 MP) und an den Prompt-Verbesserer, der sie sieht (Systemprompt `system_prompt_edit.txt` aus der ComfyUI-Vorlage «FLUX 3 Image Klein: Image Edit»). Bei zwei Fotos heisst es ausdrücklich: beide Dinge in **einer** zusammenhängenden Szene, jedes in seinen echten Proportionen. Das fertige Bild hat weiterhin die volle Auflösung.
4. Besucher sehen die Fotos mit Urheber und Lizenz unter «Was hat die KI verstanden?», die Technik-Ansicht listet «Referenzbild 1» und «2».

**Falscher oder erfundener Artikelname:** ask nennt manchmal einen Titel, den es nicht gibt («Roche-Türme»), eine Begriffsklärung («Pilatus») oder einen Artikel mit anderer Bedeutung («Jungfrau» = Jungfräulichkeit). Der Server prüft deshalb, ob die englische Wikidata-Beschreibung des Artikels zum englischen Namen passt, und sucht sonst in Wikipedia (zuerst mit dem englischen Namen, dann mit dem Titel). Treffer müssen das erste Namenswort enthalten und dürfen laut Wikidata keine Person sein (sonst kam für «Pilatus» der Sänger Rob Pilatus). Findet sich nichts Passendes, gibt es kein Foto statt eines falschen.

Getestete Regeln (Okt. 2026, rund 60 Vergleichsbilder mit gleichem Seed):

- **Foto als Anhaltspunkt, nicht als Vorlage** (Experimente 22–23, rund 100 Bilder): Wirkt das Foto in allen Malschritten, übernimmt das Bild Blickwinkel, Ausschnitt, Pose und Farbe, und verschiedene Seeds ergeben fast dasselbe Bild. Deshalb wirkt es erst ab 10 % der Schritte (`refRange: [0.1, 1]`, per `ConditioningSetTimestepRange`), die ersten Schritte legen den Bildaufbau nur nach Text an. Dazu sagt der Prompt-Verbesserer ausdrücklich: eigener Blickwinkel, Licht, Wetter und Jahreszeit, nur die wesentlichen Merkmale (`refLoose`). Ergebnis: Motive bleiben erkennbar, aber z. B. eine blaue Vespa statt der weissen vom Foto, das Matterhorn nicht mehr exakt aus der Foto-Perspektive, und 4 Bilder bzw. «Nochmal» unterscheiden sich deutlich. Getestet: nur in den ersten 50 % ≈ wie vorher (die Kopier-Wirkung entsteht am Anfang); ab 25 % gehen Details verloren (Zytglogge-Turmhelm); 10 % und 15 % fast gleich. Beim Schul-Logo und den Standort-Fotos gilt das nicht, dort bleiben die eigens getesteten Regeln.
- **Verwandlung** («als Raumschiff», ohne Stil-Knopf): freie Formulierung, die neue Form muss sofort erkennbar sein. Recherche-Fakten werden dabei weggelassen, weil sie das Bild zurück zum Foto ziehen.
- **Sonst** (realistisch oder mit Stil): Look, Farben, Bildausschnitt und Pose des Fotos ausdrücklich nicht übernehmen. Sonst geht ein Comic- oder Aquarell-Stil verloren und Tiere übernehmen die Pose aus dem Foto.
- Pro Ding ein Foto; zwei Fotos vom *selben* Ding waren schlechter. 0,25, 0,5 und 1 MP sehen gleich aus, 0,5 MP ist schneller als 1 MP. Der Prompt-Verbesserer muss das Foto sehen.
- **Zwei Dinge** (Experiment 21, 9 Wünsche × 2 Seeds, alt = nur das erste Ding vs. neu = beide): klar besser, wo das Bildmodell das zweite Ding nicht kennt – vorher ein beliebiger Berg statt der Eiger-Nordwand, eine erfundene Fachwerkbrücke statt der Kapellbrücke. Bei bekannten Dingen (Matterhorn, Eiffelturm) gleich gut wie vorher, auch Comic-Stil und Lego bleiben erhalten. Wünsche mit nur einem Ding laufen genau gleich wie vorher (gleicher Auftrag, ComfyUI nimmt sogar das Ergebnis aus dem Cache). Mehrzeit mit zweitem Foto ca. 5–6 s.
- Echte, bekannte Personen (Einstein, Federer) bekommen Recherche und Foto, ausser die Guardrails stehen auf «streng» (dort sind Personen ganz gesperrt). Respektlose Wünsche sperren die Guardrails vorher. Private Personen nie.
- Collagen als Wikipedia-Hauptbild (z. B. sechs Katzen bei «Hauskatze») werden übersprungen, dann wird der englische Artikel versucht («house cat» → Cat).
- Mehrzeit: ca. 1–2 s für das Foto (parallel zur Recherche) und ca. 3 s beim Malen.

**Wann ein Foto kommt** (Profi-Einstellungen «Referenzfoto»):

- **Automatisch** (Standard): ask entscheidet, nur bei bestimmten echten Dingen, die das Bildmodell nicht genau kennt (Orte, Bauwerke, Marken, seltene Tiere, bekannte Personen).
- **Immer**: das Hauptmotiv bekommt in jedem Fall ein Foto, auch Drache, Einhorn oder Roboter (dann der nächstliegende Artikel).
- **Aus**: kein Foto.

Ganz abschalten im Betreuer-Menü («Referenzfotos von Wikipedia»). Braucht ask für den Prüf-Schritt.

## Logo und Standorte der TF Bern

Nennt ein Wunsch «TF Bern», «TFBern» oder «Technische Fachschule», bekommt das Bildmodell echte Vorlagen mit, sonst nichts:

- **Logo** (`reference/tfbern-logo.png`): Die KI übernimmt das echte Logo auf T-Shirt, Becher, Fahne usw. Ohne Vorlage erfand sie rote Fantasie-Logos.
- **Standorte** (`reference/standorte.json`): Nennt der Wunsch zusätzlich «Felsenau» oder «Lorraine», kommt ein Foto des Gebäudes mit. Das Logo kommt dann nur dazu, wenn ein Gegenstand wie Fahne, T-Shirt oder Bus vorkommt.
  - Felsenau: Foto von Urs Schönholzer, CC BY 4.0, Wikimedia Commons.
  - Lorraine: Foto der Technischen Fachschule Bern (Lorrainestrasse 3, mit der Halle davor).
  - Weitere Standorte: Foto in `reference/` ablegen, Eintrag in `standorte.json` ergänzen, Server neu starten.
- **Abwechslung:** Sonst sähe jedes Bild aus wie das Foto bzw. das Logo immer auf Weiss. Darum bekommt jedes Bild einen eigenen Blickwinkel (`SITE_VIEWS`: Drohne, von weit weg, schräg, durch Bäume …) und für das Logo eine eigene Farbe und Umgebung (`LOGO_COLORS`, `LOGO_SETTINGS`). Nennt der Wunsch selbst Farbe, Ort oder Blickwinkel, gilt der Wunsch. Ausschalten: `vary: false` in `QUALITY`.

Wünsche ohne TF Bern bleiben unverändert (getestet: identischer Auftrag).

## Bild per Mail senden

Nach dem Bild: «Per Mail senden» → bei mehreren Bildern eins antippen → Adresse eingeben (Knöpfe für @gmail.com, @bluewin.ch usw.) → «Senden». Der Kiosk-Server holt das Bild selbst aus ComfyUI (nur echte Ergebnisse, keine fremden Dateien) und schickt es als PNG-Anhang mit kurzem Text und der Beschreibung des Besuchers.

- Mailserver `es-vs01.ict-tfbern.ch`, Port 25, ohne Verschlüsselung und ohne Login, Absender `pfsense@ict-tfbern.ch` (`mail.js`; ändern über `MAIL_HOST`, `MAIL_PORT`, `MAIL_FROM`).
- **Der Mailserver muss Mails vom Kiosk-PC weiterleiten (Relay).** Sonst antwortet er «454 Relay access denied», der Besucher sieht «Die Mail konnte nicht verschickt werden», und das Betreuer-Menü zeigt den Fehler unter «Mails heute».
- Die Adresse wird nicht gespeichert und nicht protokolliert (auch nicht in Fehlermeldungen). Das Feld wird nach dem Senden, beim Schliessen und beim Auto-Reset geleert.
- Die Workflow-Daten, die ComfyUI ins PNG schreibt, werden vor dem Versand entfernt.
- Höchstens 10 Mails pro Minute. Ein-/ausschalten im Betreuer-Menü («Bild per Mail senden»).

Relay prüfen, ohne eine Mail zu schicken:

```bash
node -e "require('./mail').smtp('jemand@example.com','',{dryRun:true}).then(()=>console.log('ok'),e=>console.log(e.message))"
```

## Guardrails (Filter für Wünsche)

Jeder Wunsch wird vor Recherche und Bild geprüft (`guardrails.js`). Stufe im Betreuer-Menü: **Aus / Locker / Mittel / Streng**, Standard «Mittel».

1. **Wortliste** (sofort, ohne Netz, erkennt auch Tricks wie «n4ckt» oder «s e x»). Harmlose Wörter wie Nacktschnecke, Killerwal, Taschenmesser, Blutorange, Wettkampf sind ausgenommen.
2. **ask** prüft den Sinn (Umschreibungen, Mundart, echte Personen bloßgestellt), ca. 1–2 s, läuft parallel zum Recherche-Schritt. Antwort 1 Stunde im Cache. Fällt ask aus, bleibt die Wortliste.
3. Der Prompt-Verbesserer bekommt eine Zusatzregel, damit er nichts Verbotenes von sich aus ergänzt.

| Stufe | gesperrt | erlaubt |
| --- | --- | --- |
| Locker | Sexuelles, Gore, Suizid, Nazi-/Hass-Symbole, Rassismus | Action- und Comic-Gewalt, Monster, derbe Wörter |
| Mittel | dazu realistische Gewalt, Leichen, Drogen, Beleidigungen, Bloßstellen echter Personen (Lehrer, Mitschüler, Promis) | Ritter mit Schwert, Piraten, Drachen, Geisterhaus, Promis in normalen Szenen |
| Streng | dazu alle Waffen und Kämpfe, Gruseliges, echte Personen überhaupt, Politik | friedliche, fröhliche Bilder |

Der Besucher sieht «Dieses Bild können wir hier leider nicht machen (Kategorie). Probier doch etwas anderes! Findest du, das ist ein Fehler? Dann sprich jemanden von der TF Bern an.». Das Betreuer-Menü zeigt die Anzahl und die letzten gesperrten Wünsche (nur im Speicher), das Server-Fenster protokolliert sie.

## Bildqualität (Testnacht 28./29. Oktober 2026)

Rund 550 Testbilder, Einzelheiten in `tests/NOTIZEN.md`. Die Werte stehen im `QUALITY`-Block in `server.js`.

| Einstellung | Wert | Warum |
| --- | --- | --- |
| Sampler | `er_sde`, Scheduler `simple`, 16 Schritte | sichtbar mehr echtes Detail als `euler`; mehr Schritte oder Flux2Scheduler brachten nichts |
| Auflösung | Stufe «maximal»: 1 Bild 2 MP, 2 Bilder 1,5 MP, 4 Bilder 1 MP | native 2 MP = natürlichste Gesichter, feinste Details; Verfeinerungs-Durchgang und Nachschärfen waren schlechter |
| Prompt-Verbesserer | greedy (top_k 1), Thinking aus | Sampling brachte ungewollte Schrift; Thinking lieferte leere Beschreibungen |
| «Nochmal», Bild 2–4 | neue Beschreibung mit temperature 0,7 / top_k 40 | gleiche Beschreibung + neuer Seed ergibt fast gleiche Bilder |
| Schrift | Zusatzregel + «keine Schrift» im Wunsch, wenn dieser keinen Text verlangt | sonst erfundene Schilder, Kreidetafeln und Titel mit verwaschener Schrift |
| Stile | ausführliche Stil-Texte | gewannen bei 7 von 8 Stilen deutlich |

Zeiten (GPU): 1 Bild ≈ 25 s, mit Recherche und Foto ≈ 33 s, «Nochmal» ≈ 28 s, 2 Bilder ≈ 40 s, 4 Bilder ≈ 60 s. Im Betreuer-Menü lässt sich die Stufe auf «hoch» oder «schnell» senken.

Grenzen: «Explosionszeichnung» wird als echte Explosion gemalt; Mundart wird verstanden, aber nicht immer genau umgesetzt; Wörter wie «hobeln» kennt das Modell nicht sicher.

## Testen

```bash
KIOSK_LAB=1 PORT=8090 node --use-system-ca server.js
node tests/bench.js tests/experiments/01-sampler.json <Ausgabeordner>
python -I tests/sheet.py <Ausgabeordner> uebersicht.jpg
node tests/plan-check.js
```

Im Labor-Modus darf eine Anfrage mit `lab` alle Werte aus `QUALITY` überschreiben. `plan-check.js` prüft den Prüf-Schritt von ask an 55 Beispielen (mit `--streng`, wenn die Guardrails auf «streng» stehen).

## Betreuer-Menü

**5× schnell aufs TF-Bern-Logo oben links tippen** (innert 3 Sekunden) oder **Strg+Alt+B** auf einer Tastatur, dann das Passwort eingeben. Das Passwort steht in `data/admin.json` als `{ "password": "…" }` (nicht im Git, `node pack.js` nimmt die Datei mit) oder in der Umgebungsvariable `ADMIN_PASSWORD`. Der Server prüft es, im Code steht es nicht. Fehlt beides, lässt sich das Menü nicht öffnen. Nach einem falschen Passwort wartet der Server 1 Sekunde. Zeigt den Status (ComfyUI, Grafikkarte, Warteschlange) und erlaubt:

- Standard-Schritte, max. Anzahl Bilder, Auto-Reset- und Bildschirmschoner-Zeit
- Prompt-Verbesserer, Besucherbilder im Schoner und Profi-Einstellungen an/aus
- Guardrails: Aus / Locker / Mittel / Streng
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
