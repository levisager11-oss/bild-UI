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
