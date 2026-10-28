# Technische Fachschule Bern — Design System

Built from the **Corporate Design Manual, Mai 2022** (`uploads/220517_CD Manual.pdf`). Every rule below cites its section. Anything the manual does not cover is listed under **Screen additions** and uses CD colours only.

## Sources
- `uploads/220517_CD Manual.pdf` — CD Manual (primary source)
- `uploads/TF-Blau.pdf` — colour specification
- `assets/TFBern_Logo_RGB_PNG.png` — logo (blue mark, black wordmark)
- `fonts/` — DIN OT Light, Regular, Bold

## Communication (CD Kommunikationsgrundsätze)
- Always write out **«Technische Fachschule Bern»**. «TF Bern» is for internal use only.
- People (members and customers), offers and values are at the centre. The school should come across as open and attractive.
- The CD examples address learners with «du» (e.g. «Was brauchst du für die Lehre?»).
- No emoji.

## Logo (CD 1.1)
- Versions (1.1.2): blue mark with black wordmark, always on white, never on blue. Black, for one-colour use on light grounds. White on blue or white on black, for one-colour use on dark grounds.
- Never (1.1.3): on a background in the logo colour, two-colour on other bright colours, on images, distorted, mark separated from wordmark, or one-colour without enough contrast.
- Minimum width 51 mm (49 mm in Word templates). Usually placed top left. Clear space 1X all round (1.1.4–1.1.5).
- Other logos «Nachhaltigkeit» (72 mm) and «M.I.N.T.» (32 mm), black or white only (1.2). Files not yet provided.

## Typography (CD 1.3)
- **DIN OT Bold** — main titles and subtitles.
- **DIN OT Light** — body text, quotes and emphasis, always in lowercase (Minuskeln), never all caps.
- **Arial** Regular/Bold/Italic — Office correspondence only.
- Print body: 10 pt / 13 pt for little text, 8.5 pt / 11.5 pt for much text. Large titles are kerned by hand.

## Colour (CD 1.4)
- **TF Blau** `#0082B4` — R0 G130 B180 · Pantone 307 U / 7690 C · C90 M16 Y0 K20 · RAL 5015 · 3M 100–57 Olympic Blue. Used for titles, areas, lines and emphasis.
- Only TF Blau is used as a rule. No other shades.
- Lighter levels: only **80 %** `#3399C3`, **65 %** `#55AACF` (most used), **50 %** `#80C1DA`. Other levels only when several are needed.
- **Schwarz** `#000000` mainly for typography. **Weiss** `#FFFFFF`.
- Keep the blue : black : white proportion shown in the manual's graphic (1.4.1).
- Secondary colours (1.4.4), no usage rules given: `#F28855` · `#4EB68E` · `#EE716D` · `#60C5E2` · `#A5ACAE` · `#A2CE8D`.

## 45° Spickel (CD 1.5)
- Large images and coloured text boxes are cut at the bottom-right corner at 45°. The cut is **25 % of the shorter side**.
- Images spanning all columns get the cut and may bleed left. Images not spanning all columns get no cut and may bleed on all sides.
- Blue information boxes always get the cut. No circles, no boxes without the cut.
- Only two cut sizes: a larger one for images, a smaller one for text boxes.
- In-house print: 10 mm margin, no bleed.
- `InfoBox` and `SpickelImage` compute the 25 % automatically. For plain HTML use `.tf-spickel` and set `--spickel` to 25 % of the shorter side.

## Imagery (CD 1.6)
Not yet transcribed into this system. See pages 16 ff. of the manual.

## Screen additions (not in the manual)
- Screen type scale and 4 px spacing grid. Body line-height 1.3, from the 10/13 pt print ratio.
- Hover: TF Blau 100 % → 80 %.
- Keyboard focus: 2 px TF Blau outline.
- Buttons, badges and text fields: rectangular (radius 0), no shadows, CD colours only. Disabled = TF Blau 50 %.
- Content cards are not boxes. They sit on a 2 px blue rule, to avoid boxes without a Spickel.
- Text-field error state uses the secondary red `#EE716D` as a line, with the message in black bold.
- Contrast: TF Blau on white is about 4.3:1. That is below WCAG AA for small text, so use blue text at 18 px bold or larger, and black for small text. White text is used on TF Blau 100 % and 80 %, black text on 65 % and 50 %.

## Files
- `colors_and_type.css` — tokens ([CD] / [Screen] marked), fonts, helpers
- `components/` — Button, Badge, InfoBox, SpickelImage, SectionHeader, CourseCard, TextField
- `preview/` — foundation cards
- `ui_kits/website/` — click-through website mock
- `thumbnail.html` — design system tile
