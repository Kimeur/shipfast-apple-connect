#!/usr/bin/env python3
"""Check the App Store icon: 1024 x 1024, PNG, no alpha channel. --fix flattens it onto a solid colour.

usage: icon-check.py <icon-1024.png> [--fix] [--background "#000000"]
The App Store refuses an icon with an alpha channel, even a fully opaque one. A renderer that draws the
icon in SwiftUI (see templates/IconRender.example.swift) should flatten it itself; this is the safety net.
"""
import sys

try:
    from PIL import Image
except ImportError:
    sys.exit('Pillow is missing: python3 -m pip install Pillow')


def main():
    args = sys.argv[1:]
    if not args or args[0].startswith('-'):
        sys.exit(__doc__)
    path = args[0]
    fix = '--fix' in args
    bg = '#000000'
    if '--background' in args:
        bg = args[args.index('--background') + 1]
    img = Image.open(path)
    problems = []
    if img.format != 'PNG':
        problems.append(f'format {img.format}, need PNG')
    if img.size != (1024, 1024):
        problems.append(f'size {img.size[0]}x{img.size[1]}, need 1024x1024')
    if img.mode in ('RGBA', 'LA', 'PA') or 'transparency' in img.info:
        problems.append(f'has an alpha channel (mode {img.mode})')
    if not problems:
        print(f'ok: {path} is a 1024x1024 PNG without alpha')
        return
    print('\n'.join(f'! {p}' for p in problems))
    if not fix:
        sys.exit(1)
    rgba = img.convert('RGBA')
    flat = Image.new('RGB', rgba.size, bg)
    flat.paste(rgba, mask=rgba.split()[3])
    if flat.size != (1024, 1024):
        flat = flat.resize((1024, 1024), Image.LANCZOS)
    flat.save(path, 'PNG')
    print(f'fixed: {path} flattened onto {bg}, 1024x1024')


if __name__ == '__main__':
    main()
