#!/usr/bin/env python3
"""Compose App Store frames from the raw captures of raw-shots.py: caption on top, framed screenshot below.

usage: store-screens.py [--config <path>]
Reads   <root>/build/raw/<raw-device>-<lang>/<shot>.png
Writes  <screenshots.dir>/<folder>/<locale>/NN-<shot>.png   (the layout screenshots.mjs uploads)
        <screenshots.dir>/review/paywall.png                (from screens.reviewShot, if set)
Needs Pillow (python3 -m pip install Pillow).

Config "screens":
  shots     ordered list of shot names to compose (each needs a caption per language)
  captions  { "<lang>": { "<shot>": ["Title", "Subtitle"] } }
  locales   { "<lang>": "<App Store locale folder>" }, e.g. { "en": "en-US", "fr": "fr-FR" }
  colors    { "ground": "#07080a", "text": "#f2f4f7", "muted": "#a3abb6", "glow": "#461c0c", "line": "#262a31" }
  font      path to a .ttf (default: SF Pro Rounded from macOS)
  devices   overrides of DEVICES below
  reviewShot { "raw": "iphone-en", "shot": "paywall" }
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
from shipconfig import Config, config_arg  # noqa: E402

try:
    from PIL import Image, ImageDraw, ImageFilter, ImageFont
except ImportError:
    sys.exit('Pillow is missing: python3 -m pip install Pillow')

# out folder: (raw prefix, canvas WxH, share of the height for the shot, corner share, pixels cropped from the raw top)
# Canvas sizes are the ones screenshots.mjs accepts for each display type.
DEVICES = {
    'iphone69': ('iphone', (1320, 2868), 0.74, 0.11, 0),
    'ipad13': ('ipad', (2064, 2752), 0.76, 0.03, 72),
    'iphoneduo': ('duo-inner', (2853, 2007), 0.72, 0.03, 0),
    'iphoneduo-outer': ('duo-outer', (1398, 2034), 0.72, 0.07, 0),
}
DEFAULT_COLORS = {'ground': '#07080a', 'text': '#f2f4f7', 'muted': '#a3abb6', 'glow': '#461c0c', 'line': '#262a31'}
DEFAULT_FONT = '/System/Library/Fonts/SFNSRounded.ttf'


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
    out = Image.new('RGBA', img.size)
    out.paste(img, (0, 0), mask)
    return out


def compose(cfg, colors, font_path, raw_dir, out_dir, folder, spec, lang, locale, i, shot, caption):
    prefix, (W, H), share, corner, crop = spec
    src = os.path.join(raw_dir, f'{prefix}-{lang}', f'{shot}.png')
    if not os.path.exists(src):
        return None
    raw = Image.open(src).convert('RGB')
    if crop:
        raw = raw.crop((0, crop, raw.width, raw.height))
    canvas = Image.new('RGB', (W, H), colors['ground'])
    # A soft glow behind the caption.
    glow = Image.new('RGB', (W, H), colors['ground'])
    r = int(max(W, H) * 0.45)
    ImageDraw.Draw(glow).ellipse([W // 2 - r, -r, W // 2 + r, int(r * 0.9)], fill=colors['glow'])
    canvas = Image.blend(canvas, glow.filter(ImageFilter.GaussianBlur(r // 3)), 0.9)

    title, sub = caption
    unit = min(W, H)
    tf, sf = font(font_path, int(unit * 0.075)), font(font_path, int(unit * 0.038), 'Medium')
    d = ImageDraw.Draw(canvas)
    top = int(H * 0.055)
    max_w = int(W * 0.88)
    while d.textlength(title, font=tf) > max_w:
        tf = font(font_path, tf.size - 4)
    while d.textlength(sub, font=sf) > max_w:
        sf = font(font_path, sf.size - 2, 'Medium')
    d.text((W // 2, top), title, font=tf, fill=colors['text'], anchor='ma')
    d.text((W // 2, top + int(tf.size * 1.25)), sub, font=sf, fill=colors['muted'], anchor='ma')

    shot_h = int(H * share)
    scale = min(shot_h / raw.height, (W * 0.9) / raw.width)
    img = raw.resize((int(raw.width * scale), int(raw.height * scale)), Image.LANCZOS)
    rad = int(min(img.size) * corner)
    framed = Image.new('RGBA', (img.width + 8, img.height + 8), (0, 0, 0, 0))
    ImageDraw.Draw(framed).rounded_rectangle([0, 0, framed.width - 1, framed.height - 1], rad + 4, fill=colors['line'])
    framed.alpha_composite(rounded(img.convert('RGBA'), rad), (4, 4))
    canvas.paste(framed, ((W - framed.width) // 2, H - framed.height - int(H * 0.04)), framed)

    dest = os.path.join(out_dir, folder, locale)
    os.makedirs(dest, exist_ok=True)
    path = os.path.join(dest, f'{i + 1:02d}-{shot}.png')
    canvas.save(path, optimize=True)
    return path


def main():
    argv = sys.argv[1:]
    cfg = Config(config_arg(argv))
    raw_dir = os.path.join(cfg.root, 'build', 'raw')
    out_dir = cfg.path_of(cfg.get('screenshots.dir', 'Launch/store-screens'))
    colors = {k: rgb(v) for k, v in {**DEFAULT_COLORS, **cfg.get('screens.colors', {})}.items()}
    font_path = cfg.get('screens.font', DEFAULT_FONT)
    devices = {**DEVICES, **{k: tuple(v) for k, v in cfg.get('screens.devices', {}).items()}}
    shots = cfg.need('screens.shots')
    captions = cfg.need('screens.captions')
    locales = cfg.need('screens.locales')
    made = 0
    for folder, spec in devices.items():
        for lang, locale in locales.items():
            for i, shot in enumerate(shots):
                cap = captions.get(lang, {}).get(shot)
                if not cap:
                    sys.exit(f'no caption for {lang}/{shot} in screens.captions')
                p = compose(cfg, colors, font_path, raw_dir, out_dir, folder, spec, lang, locale, i, shot, cap)
                if p:
                    made += 1
                    print(os.path.relpath(p, cfg.root))
    rev = cfg.get('screens.reviewShot')
    if rev:
        src = os.path.join(raw_dir, rev['raw'], f'{rev["shot"]}.png')
        if os.path.exists(src):
            os.makedirs(os.path.join(out_dir, 'review'), exist_ok=True)
            dst = os.path.join(out_dir, 'review', 'paywall.png')
            Image.open(src).convert('RGB').save(dst)
            print(os.path.relpath(dst, cfg.root))
        else:
            print(f'! review shot not found: {src}')
    print(f'{made} frame(s). Look at every one: text over the fold or clipped captions are on you.')


if __name__ == '__main__':
    main()
