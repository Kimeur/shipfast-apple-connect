#!/usr/bin/env python3
"""Product page header (3840x1646, 21:9) and search results asset (3840x2560, 3:2), one pair per language,
built from the raw iPhone captures of raw-shots.py and the app icon. Writes
<screenshots.dir>/header/<locale>/{header,search}.png for header.mjs.
Everything important stays in the middle 70 % of the width: Apple crops the sides on smaller screens.

usage: store-header.py [--config <path>]
Config "header":
  icon     path to the 1024 px app icon PNG
  texts    { "<lang>": ["Title", "Subtitle"] }
  shots    { "header": ["shotA", "shotB"], "search": ["shotA", "shotB", "shotC"] }  (raw iphone captures)
Colors, font and locales come from "screens".
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
from shipconfig import Config, config_arg  # noqa: E402

try:
    from PIL import Image, ImageDraw, ImageFilter, ImageFont
except ImportError:
    sys.exit('Pillow is missing: python3 -m pip install Pillow')

DEFAULT_COLORS = {'ground': '#07080a', 'text': '#f2f4f7', 'muted': '#a3abb6', 'glow': '#4e1f0c', 'line': '#262a31'}


def rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def font(path, size, weight='Bold'):
    f = ImageFont.truetype(path, size)
    try:
        f.set_variation_by_name(weight)
    except Exception:
        pass
    return f


def rounded(img, radius):
    mask = Image.new('L', img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, img.size[0] - 1, img.size[1] - 1], radius, fill=255)
    out = Image.new('RGBA', img.size, (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out


def phone(path, height, line):
    shot = Image.open(path).convert('RGB')
    w = int(shot.width * height / shot.height)
    shot = shot.resize((w, height), Image.LANCZOS)
    rad = int(w * 0.11)
    framed = Image.new('RGBA', (w + 12, height + 12), (0, 0, 0, 0))
    ImageDraw.Draw(framed).rounded_rectangle([0, 0, framed.width - 1, framed.height - 1], rad + 6, fill=line)
    framed.alpha_composite(rounded(shot.convert('RGBA'), rad), (6, 6))
    return framed


def background(W, H, c):
    base = Image.new('RGB', (W, H), c['ground'])
    glow = Image.new('RGB', (W, H), c['ground'])
    r = int(H * 0.9)
    ImageDraw.Draw(glow).ellipse([W // 2 - r, H // 2 - r // 2, W // 2 + r, H // 2 + r], fill=c['glow'])
    return Image.blend(base, glow.filter(ImageFilter.GaussianBlur(r // 3)), 0.85)


def build(cfg, kind, lang, locale, c, fp):
    W, H = (3840, 1646) if kind == 'header' else (3840, 2560)
    img = background(W, H, c)
    d = ImageDraw.Draw(img)
    title, sub = cfg.need(f'header.texts.{lang}')
    raw = os.path.join(cfg.root, 'build', 'raw', f'iphone-{lang}')
    shots = cfg.need(f'header.shots.{kind}')
    safe_l, safe_r = int(W * 0.15), int(W * 0.85)
    if kind == 'header':
        # Left: icon, name, line. Right: phones. All inside the middle 70 %.
        icon = Image.open(cfg.path_of(cfg.need('header.icon'))).convert('RGB').resize((300, 300), Image.LANCZOS)
        img.paste(rounded(icon, 68), (safe_l, int(H * 0.22)), rounded(icon, 68))
        d.text((safe_l, int(H * 0.22) + 360), cfg.need('app.name'), font=font(fp, 150), fill=c['text'])
        d.text((safe_l, int(H * 0.22) + 540), title, font=font(fp, 96, 'Semibold'), fill=c['text'])
        d.text((safe_l, int(H * 0.22) + 680), sub, font=font(fp, 50, 'Medium'), fill=c['muted'])
        ph = int(H * 0.84)
        x = safe_r
        for i, s in enumerate(shots[:2]):
            p = phone(os.path.join(raw, f'{s}.png'), ph if i == 1 else int(ph * 0.94), c['line'])
            x -= p.width
            img.paste(p, (x, (H - p.height) // 2), p)
            x -= 60
    else:
        d.text((W // 2, int(H * 0.07)), title, font=font(fp, 190), fill=c['text'], anchor='ma')
        d.text((W // 2, int(H * 0.07) + 250), sub, font=font(fp, 84, 'Medium'), fill=c['muted'], anchor='ma')
        ph = int(H * 0.62)
        phones = [phone(os.path.join(raw, f'{s}.png'), ph if i != 1 else int(ph * 1.06), c['line']) for i, s in enumerate(shots[:3])]
        gap = 90
        x = (W - sum(p.width for p in phones) - gap * (len(phones) - 1)) // 2
        for i, p in enumerate(phones):
            y = H - p.height - int(H * 0.05) + (0 if i == 1 else int(H * 0.02))
            img.paste(p, (x, y), p)
            x += p.width + gap
    out = os.path.join(cfg.path_of(cfg.get('screenshots.dir', 'Launch/store-screens')), 'header', locale)
    os.makedirs(out, exist_ok=True)
    path = os.path.join(out, f'{kind}.png')
    img.save(path, optimize=True)
    print(os.path.relpath(path, cfg.root))


def main():
    argv = sys.argv[1:]
    cfg = Config(config_arg(argv))
    c = {k: rgb(v) for k, v in {**DEFAULT_COLORS, **cfg.get('screens.colors', {})}.items()}
    fp = cfg.get('screens.font', '/System/Library/Fonts/SFNSRounded.ttf')
    for kind in ('header', 'search'):
        for lang, locale in cfg.need('screens.locales').items():
            if cfg.get(f'header.texts.{lang}'):
                build(cfg, kind, lang, locale, c, fp)


if __name__ == '__main__':
    main()
