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
