# Testnacht 28./29. Oktober 2026 – Notizen

Ziel: beste Einstellungen für alle Themen. Branch `qualitaet-nacht`. Tests laufen über den Labor-Server (`KIOSK_LAB=1`) mit `tests/bench.js`, Übersichten mit `tests/sheet.py`. Bilder liegen im Scratchpad (nicht im Repo).

Rahmen:
- ComfyUI 0.42.4, RTX 6000 Ada (47 GB), ca. 10 GB frei mit allen Modellen geladen.
- Kein ComfyUI-Manager, keine Upscaler, keine LoRAs → nur vorhandene Modelle (Flux 3 Klein distilled bf16, Qwen-VL 4B, Qwen 3.5 9B Upsampler, Flux2-VAE).
- SSH: nicht verwendet. User 23:15: «ohne SSH, an der Installation nichts ändern, ohne Fragen bis 5:00 weitermachen». Erzeugten Schlüssel wieder gelöscht.
- Server-Installation bleibt unverändert; Modell-/Upscaler-Ideen nur als Vorschlag in den Bericht.

## Versuche

### 01 Sampler und Scheduler (72 Bilder, 6 Prompts × 2 Seeds × 6 Varianten)
- Varianten: euler/simple (bisher), euler/flux2, er_sde/simple, er_sde/flux2, res_multistep/simple, euler/beta.
- **Sieger: er_sde + simple.** In 100%-Ausschnitten deutlich mehr echtes Detail (Fell, Augen, Bauteile auf Platine), weniger «weichgezeichnet»; Comic sauberere Linien, Drache dynamischer.
- Flux2Scheduler ≈ simple (kein sichtbarer Unterschied) → simple behalten.
- euler/beta: einmal verunstalteter Text («der» gespiegelt). Text sonst bei allen korrekt; er_sde wechselt manchmal Schriftstärke im Schild (kleiner Schönheitsfehler).
- Zeit: alle ≈ 6,5 s Bild (+ ≈ 8 s Prompt-Verbesserer).

### 02 Schritte, Auflösung, Verfeinerung, Schärfen (56 Bilder, er_sde)
- Bildzeit: 16 Schritte 1 MP ≈ 6,5 s · 24 Schritte ≈ 9,6 s · 1,5 MP ≈ 10,5 s · 2 MP ≈ 15 s · Verfeinerung 1,5× (2. Durchgang) ≈ 16,5 s.
- **Native Auflösung bringt am meisten:** 2 MP = natürlichste Haut/Gesichter, feinstes Fell, präzisere Zahnräder; 1,5 MP schon deutlich besser als 1 MP.
- Verfeinerungs-Durchgang (Latent hochskalieren + denoise 0,35/0,5): behält Bildaufbau, schärfer, aber langsamer als natives 1,5 MP → nicht nötig.
- 24 statt 16 Schritte: kaum Unterschied. Nachschärfen (ImageSharpen 0,3): wirkt künstlich → aus.
- **Entscheid:** 1 Bild 2 MP, 2 Bilder 1,5 MP, 4 Bilder 1 MP; Betreuer-Menü-Stufe «Bildqualität» (schnell/hoch/maximal).

### Prüf-Schritt von ask (tests/plan-check.js, 40 Fälle, ohne GPU)
- Vorher 35/40: Steinbock, Axolotl nicht erkannt; Taschenmesser (Produkt) nicht; «Der Bundesrat» nicht als Personen; Mundart «e chatz uf em velo dür bärn» → erfand Zytglogge.
- PLAN_PROMPT neu: Sprachen/Mundart/Tippfehler erwähnt, Kategorien mit Beispielen (Marken/Produkte, nicht alltägliche Tierarten), Alltägliches ausdrücklich ausgenommen, Stadt nur als Kulisse braucht nichts, nie Wahrzeichen dazu erfinden, Personengruppen.
- Nachher 39/40, 39/40, 38/40 (3 Läufe). Rest: Murmeltier gilt als «alltäglich» (vertretbar), Steinbock → Artikel «Steinwild» (korrekt).

### 03 Prompt-Verbesserer (48 Bilder, 1 MP)
- Bisher top_k 1 = **greedy**: gleicher Text → immer gleiche Beschreibung (nur Bild-Seed ändert bei «Nochmal»).
- Sampling (temp 0,7/top_k 40 bzw. 1,0/64): Beschreibungen variieren, Qualität nicht besser, **öfter ungewollte Schrift** im Bild («TARGET», «BIBLIOTHEK», «PILOT»).
- thinking=true: **leere Beschreibung** → unbrauchbar. mtp=auto: identischer Text, gleiche Zeit (keine MTP-Gewichte) → nutzlos. presence 0: etwas kürzer, sonst gleich.
- **Entscheid: greedy bleibt.** Zukunftsstadt: Seilbahnen stehen in der Beschreibung, sind bei 1 MP aber zu klein → 2 MP hilft.
- Folge-Versuch 09: Zusatzregel gegen eigene Schrift/Schilder.
- Optimierung: bei greedy ist der Text-Seed egal → fest 0, damit ComfyUI die Beschreibung wiederverwendet («Nochmal» ≈ 8 s schneller).

### 09 Zusatzregel gegen ungewollte Schrift (24 Bilder, 1 MP)
- Regel: «add no signs, labels, logos, brand names or written words of your own. Only when the request itself asks for text, render exactly that text.»
- Ohne Regel: Bäckerei mit Kreidetafel voller verwaschener Schrift (beide Seeds), Fähnchen mit Schrift. Mit Regel: weg.
- Gewünschter Text («Tag der offenen Tür», «TF Bern») funktioniert weiter; Schild-Schrift mit Regel eine Spur weniger sauber.
- **Entscheid: Regel als Standard** (QUALITY.systemExtra).

### 10 Abwechslung bei «Nochmal» (12 Bilder, 2 MP)
- Gleiche (greedy) Beschreibung + 4 Seeds → **fast identische Bilder** (Pinguin, Bibliothek, Lego-Zug). Auch 2/4 Bilder in einem Batch sähen gleich aus.
- **Entscheid:** «Nochmal» = neue Beschreibung mit Sampling (temp 0,7, top_k 40, top_p 0,9, min_p 0,05, Zufalls-Seed). Bei 2/4 Bildern bekommt jedes Bild eine eigene Beschreibung (1. greedy, weitere Varianten) statt eines Batches. Kostet ≈ 8 s pro zusätzlichem Bild für die Beschreibung.
- 2 MP-Bild hier ≈ 23–24 s statt 15 s (lief parallel zu 04; Zeiten mit Vorsicht).

### 04 Stile (96 Bilder, 1 MP): heutige vs. ausführlichere Stil-Texte
- Ausführlichere Texte gewinnen bei Foto (natürlicheres Licht), Comic (Halbton, kräftiger), Aquarell (Papier, Pigment), Ölbild (Impasto), Bausteine (alles aus Steinen statt nur Figur), Skizze (Schraffur), 3D (gleichwertig).
- Pixel-Art: alte Fassung bei der Gasse blockiger → neue Fassung mit «large, clearly visible square pixels».
- **Entscheid:** neue STYLES übernommen.

### 11 Echte Varianten (24 Bilder)
- 4 Bilder mit je eigener Beschreibung: **4 deutlich verschiedene Bildaufbauten** (vorher fast identisch). «Nochmal» (variation): jedes Mal neues Bild. Verzweigung mit Referenzfoto funktioniert (Unterschiede kleiner, Foto gibt Turm vor).
- Zeiten (GPU): 2 Bilder 1,5 MP ≈ 39–40 s · 4 Bilder 1 MP ≈ 61–63 s · 2 Bilder mit Referenz ≈ 46 s · 1 Bild 2 MP ≈ 21–24 s.

### 06 Besucher-Eingaben (12 Bilder, 2 MP)
- Gut: Tippfehler («pizza bakt in einer kuche»), Französisch, Englisch, Anzahlen (3 rote Ballone + 2 gelbe Enten korrekt), langer Wunsch (alle Details), Text «TF Bern», Einhorn, abstrakt.
- Mundart «e chatz wo uf em velo dür bärn fahrt»: verstanden, aber Katze sitzt hinten auf dem Velo statt selbst zu fahren.
- «Hund»: Hund auf einer «Kiosk-Theke» → Ursache: Zusatzregel begann mit «Kiosk rule:» → umformuliert («Additional rule:»).
- «Explosionszeichnung eines Elektromotors»: als echte Explosion mit Feuer gedeutet (Sprachproblem des Upsamplers) → im Bericht erwähnen.

### 07 Echte Motive ohne vs. mit Recherche + Referenzfoto (60 Bilder, 2 MP)
- Foto bei 14/15 Motiven gefunden (Murmeltier gilt als alltäglich). Sehr grosse Gewinne: Berner Münster (ohne: 2 Türme, falsch → mit: echter 1 Turm), Kapellbrücke (echter Wasserturm), Schloss Chillon (echte Inselburg), Steinbock (ohne: weisse Ziege), Re 460 (echte Lokform statt Fantasie mit Aufschrift), Landwasserviadukt (echter Bogen + Tunnel + roter Zug), Rotmilan (ohne: roter Papagei!), Taschenmesser-Raumschiff, Kapellbrücke als Aquarell.
- Probleme: Bundeshaus bei Nacht mit bunter Lichtshow (aus den Recherche-Fakten über «Rendez-vous Bundesplatz»); Comic-Bundeshaus mit dem Wunsch als grossem Titel im Bild.
- Fixes: SUMMARY_PROMPT «nur dauerhaftes Aussehen, keine Shows/Events/Dekorationen»; Zusatzregel «keine Titel, nie den Wunsch selbst ins Bild schreiben»; Referenz-Anfrage «(a description of the picture, not text to show)».

### 12 Nachtest (10+10 Bilder)
- Bundeshaus bei Nacht: keine Lichtshow mehr. Comic-Bundeshaus: kein Titel mehr. Comics ohne Fantasie-Schrift. Schild-Text weiterhin korrekt.

### 05 Alle 20 Prompt-Ideen + 8 Würfel-Sätze (28 Bilder, 2 MP)
- Alle gut; Prüf-Schritt sucht bei Ideen korrekt kein Foto, ausser Zytglogge (→ Raumschiff mit Referenz hervorragend).
- «Igel hobelt ein Brett» → Igel sägt (Wort «hobeln» unbekannt) → Würfel-Baustein ersetzt durch «baut ein Vogelhaus».
- «Katze kocht Fondue in einer Schreinerei»: Schild «SCHREINEREI» trotz Regel (3/3 Seeds).

### 13 Fantasie-Schilder (Nachtest)
- Regel nur im Systemprompt reicht nicht für Ladenschilder. Neu: Wenn der Wunsch keinen Text verlangt (Muster WANTS_TEXT: Anführungszeichen, Aufschrift, Aufdruck, Schild ≠ Schildkröte, Text, Plakat, sign …), hängt der Server «No visible lettering, words, signs or labels anywhere in the picture.» an den Wunsch.
- Ergebnis: SCHREINEREI-Schild weg (3/3), Bäckerei/Markt ohne Schrift, «Tag der offenen Tür» weiterhin korrekt.

### 08 Formate und 4 Bilder (6 Aufträge)
- Hoch 1200×1744, Quer 1744×1200 (2 MP) je ≈ 22 s; Bausteine- und 3D-Stil gut. 4 Bilder (1 MP) ≈ 59 s, alle verschieden.

## Abschluss (ca. 01:50)
- Nach dem Unterbruch erledigt: 07/05/08 ausgewertet; Recherche nur dauerhaftes Aussehen; keine Titel aus dem Wunsch; «keine Schrift» im Wunsch (WANTS_TEXT); Würfel «baut ein Vogelhaus»; 12 neue Beispielbilder (2 MP, mit Referenzfotos); Startseite «in rund einer halben Minute»; Hinweis «4 Bilder ≈ 1 Min.»; README-Abschnitt.
- Endtest im echten Kiosk (ohne Labor-Modus): Zytglogge im Winter 33 s inkl. Recherche + Foto; «Nochmal» 29 s (Recherche aus Zwischenspeicher, neues Bild). Layout passt bei 1920×1080 und 1536×864.

## Stand beim Unterbruch (Nutzungslimit, ca. 00:45)
- Übernommen in server.js/app.js: er_sde, Qualitätsstufen (maximal = 2 MP bei 1 Bild), neue STYLES, Regel gegen Fantasie-Schrift, echte Varianten («Nochmal» + eigene Beschreibung pro Bild), besserer ask-Prüf-Schritt, ask-Zwischenspeicher.
- Läuft noch im Hintergrund (Ergebnisse im Scratchpad, nicht ausgewertet): 07 echte Motive mit/ohne Recherche+Foto, 05 alle Prompt-Ideen, 08 Formate/4 Varianten.
- Offen: 07/05/08 auswerten, schwache Prompt-Ideen ersetzen, Beispielbilder für den Bildschirmschoner neu erstellen, Zeitangabe auf der Startseite anpassen («in wenigen Sekunden» → ca. 25 s), README ergänzen, Bericht-Seite.

### 17 Standort Lorraine (29.10., 06:50)
- Foto `reference/standort-lorraine.jpg` (550×363) vom Nutzer abgelegt; Beschreibung in `standorte.json` genauer (Sandsteinbau, rotes Walmdach, Lukarnen, Berner Fahnen, graue Halle mit spitzen Dächern davor).
- Ohne Foto: erfundene Gebäude, beim Lego-Modell sogar ein Fussballstadion. Mit Foto: richtiges Gebäude in Winter, Nacht und Lego (6/6). Bildausschnitt bleibt nah am Foto.
- Kontrolle «Das Lorraine-Quartier in Bern im Herbst» (ohne TF Bern): kein Standort-Foto, Bild identisch (aus dem Zwischenspeicher).

### 18–20 Abwechslung bei Standort-Foto und Logo (29.10.)
- Problem: Mit Standort-Foto immer derselbe Blickwinkel wie das Foto, Logo immer auf weissem T-Shirt/Becher/Fahne (der Auftrag verlangte «on a white or light surface»; Beschreibung ist greedy, also pro Wunsch immer gleich).
- 18 (5 Wünsche × 3 Seeds × 4 Varianten): pro Bild ein Blickwinkel bzw. Farbe + Umgebung (`vary`) wirkt klar; Logo bleibt korrekt. Zusätzlich freie Beschreibung (`freeCaption`) oder Referenz 0,3 MP: kein weiterer Gewinn → aus.
- 19 (alle 7 Blickwinkel einzeln): «nah vor dem Eingang», «Detail» und «vom Nachbardach» sahen trotzdem aus wie das Foto → ersetzt. Rot aus den Logo-Farben gestrichen (Logo wurde umgefärbt).
- 20 (6 Blickwinkel × Lorraine/Felsenau): 12/12 verschieden, Gebäude erkennbar.
- Netzunterbruch während Test 18 hat den Server abstürzen lassen (Fehlerantwort nach schon gesendetem Bildkopf). Behoben in `proxyHttp`, dazu Sicherheitsnetz für unerwartete Fehler und Neustart-Schleife in `start-kiosk.bat`.

### 21 Zwei benannte Dinge (29.10.)
- Problem: «Die Roche-Türme vor dem Eiger» – der Prüf-Schritt durfte nur ein Ding nennen; Eiger ohne Suche und ohne Foto (Bild: beliebiger Berg).
- Neu: Prüf-Schritt liefert `things` (höchstens 2), je eigene Websuche und eigenes Wikipedia-Foto, Auftrag «beide in einer zusammenhängenden Szene». `plan-check.js`: 48/50 (die 2 Fehler sind falsche Artikelnamen von ask, z. B. «SBB Re 4/6 II»).
- 9 Wünsche × 2 Seeds, alt (nur erstes Ding) vs. neu: klar besser bei Eiger-Nordwand und Kapellbrücke (vorher erfunden), gleich gut bei bekannten Dingen (Matterhorn, Eiffelturm), Comic-Stil und Lego bleiben. Einzel-Wunsch-Kontrolle: identischer Auftrag (ComfyUI-Cache, 0 s).
- Nebenbefund Fotosuche: erfundene Titel («Roche-Türme»), Begriffsklärungen («Pilatus») und falsche Bedeutungen («Jungfrau» = Jungfräulichkeit, «Merkur» = Automarke) → Wikidata-Abgleich mit dem englischen Namen, Wikipedia-Suche als Rückfall, keine Personen (Suche hatte «Rob Pilatus» geliefert). Kette Prüfen → Foto mit 40 Wünschen: alle Fotos passend; wo ask sich irrt, kein Foto statt eines falschen.

### 22–23 Referenz als Anhaltspunkt (29.10.)
- Wunsch: Fotos sollen das Bild nicht zu stark bestimmen. Mit Foto in allen Schritten: Blickwinkel/Pose/Farbe kopiert, zwei Seeds fast dasselbe Bild.
- 22 (4 Wünsche, 7 Varianten): nur erste 50 % ≈ wie vorher; ab 10 % freierer Aufbau, Motiv exakt; ab 25 % Details schlechter; lockere Formulierung allein ändert Licht/Stimmung, Blickwinkel nur teils.
- 23 (8 Wunsch-Arten × 2 Seeds: jetzt / ab10 / ab15 / locker+ab10): locker+ab10 am freiesten bei erkennbaren Motiven (blaue statt weisse Vespa, Matterhorn und Eiger aus anderem Winkel, Steinbock in eigener Szene), Comic und Verwandlung gut. ab10 ≈ ab15. → Standard `refRange [0.1, 1]` + `refLoose`, nicht bei Logo/Standort.
- Achtung Test-Werkzeug: Roche lief in 22/23 zuerst nur mit Eiger-Foto (bench.js nahm alten Fotonamen aus seinem Zwischenspeicher, den der neu gestartete Server nicht mehr kannte). Behoben, Roche-Reihe neu gerechnet.

### 24 Endkontrolle (29.10.)
- Standardwerte, 7 Wünsche inkl. 4 Varianten, Logo-Shirt und Lorraine-Lego: alles läuft; 4 Varianten deutlich verschieden; Logo/Standort ohne die neue Einstellung, unverändert.
