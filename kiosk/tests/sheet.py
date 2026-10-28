"""Contact sheet for a bench run: one row per prompt and seed, one column per variant.

    python -I tests/sheet.py <runDir> <out.jpg> [--cols a,b,c] [--rows key,key] [--seeds 1,2] [--size 300]
"""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

args = sys.argv[1:]
run, out = args[0], args[1]


def opt(name, default=None):
    if name in args:
        return args[args.index(name) + 1]
    return default


res = json.load(open(os.path.join(run, 'results.json'), encoding='utf-8'))
cols = opt('--cols')
cols = cols.split(',') if cols else list(dict.fromkeys(r['variant'] for r in res.values()))
rows = opt('--rows')
rows = rows.split(',') if rows else list(dict.fromkeys(r['prompt'] for r in res.values()))
seeds = opt('--seeds')
seeds = [int(s) for s in seeds.split(',')] if seeds else sorted({r['seed'] for r in res.values()})
W = int(opt('--size', 300))
LABEL = 24
font = ImageFont.load_default(size=15)
grid = [(p, s) for p in rows for s in seeds]
sheet = Image.new('RGB', (W * len(cols), (W + LABEL) * len(grid)), 'white')
draw = ImageDraw.Draw(sheet)
for r, (p, s) in enumerate(grid):
    for c, v in enumerate(cols):
        key = f'{p}__{v}__{s}'
        x, y = c * W, r * (W + LABEL)
        meta = res.get(key, {})
        gpu = f" {meta['gpu']:.1f}s" if meta.get('gpu') else ''
        draw.text((x + 4, y + 4), f'{p} | {v} | {s}{gpu}'[:48], fill='black', font=font)
        f = os.path.join(run, key + '.png')
        if not os.path.exists(f):
            draw.text((x + 10, y + LABEL + 10), meta.get('error', 'fehlt')[:40], fill='red', font=font)
            continue
        im = Image.open(f).convert('RGB')
        im.thumbnail((W - 4, W - 4))
        sheet.paste(im, (x + (W - im.width) // 2, y + LABEL + (W - im.height) // 2))
sheet.save(out, quality=86)
print(out, sheet.size)
