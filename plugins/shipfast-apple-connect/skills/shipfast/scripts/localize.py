#!/usr/bin/env python3
"""Translate an app's string catalogs through Xcode's localization export and import.

usage:
  localize.py export <lang>                     xcodebuild -exportLocalizations into build/loc/<lang>.xcloc
  localize.py fill <lang> <strings.json>        write translations into the .xliff (JSON: {"source": "target"})
  localize.py import <lang>                     xcodebuild -importLocalizations back into the catalogs
  [--config <path>]

`fill` lists every source string it has no translation for, so you can add them and run it again.
Keep the JSON in the repo (e.g. ship/strings/fr.json): it is the source of truth for re-imports.
Check the result on the simulator in that language: a long word can break a layout on the outer display.
"""
import html
import json
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
from shipconfig import Config, config_arg  # noqa: E402


def main():
    argv = sys.argv[1:]
    cfg = Config(config_arg(argv))
    if len(argv) < 2:
        sys.exit(__doc__)
    cmd, lang = argv[0], argv[1]
    env = {**os.environ, 'DEVELOPER_DIR': cfg.get('xcode.developerDir', '/Applications/Xcode-27.1.app/Contents/Developer')}
    project = cfg.path_of(cfg.need('xcode.project'))
    loc_dir = os.path.join(cfg.root, 'build', 'loc')
    xcloc = os.path.join(loc_dir, f'{lang}.xcloc')

    if cmd == 'export':
        os.makedirs(loc_dir, exist_ok=True)
        subprocess.run(['xcodebuild', '-exportLocalizations', '-project', project, '-localizationPath', loc_dir,
                        '-exportLanguage', lang], check=True, env=env)
        print(xcloc)
    elif cmd == 'fill':
        if len(argv) != 3:
            sys.exit('usage: localize.py fill <lang> <strings.json>')
        with open(argv[2]) as f:
            table = json.load(f)
        path = os.path.join(xcloc, 'Localized Contents', f'{lang}.xliff')
        with open(path) as f:
            s = f.read()
        missing = []

        def fill(m):
            block = m.group(0)
            src = html.unescape(re.search(r'<source>(.*?)</source>', block, re.S).group(1))
            if src not in table:
                missing.append(src)
                return block
            tgt = html.escape(table[src], quote=False)
            block = re.sub(r'\s*<target[^>]*>.*?</target>', '', block, flags=re.S)
            return block.replace('</source>', f'</source>\n        <target state="translated">{tgt}</target>', 1)

        s = re.sub(r'<trans-unit .*?</trans-unit>', fill, s, flags=re.S)
        with open(path, 'w') as f:
            f.write(s)
        print(f'{len(missing)} missing' + (':\n  ' + '\n  '.join(missing) if missing else ''))
    elif cmd == 'import':
        subprocess.run(['xcodebuild', '-importLocalizations', '-project', project, '-localizationPath', xcloc],
                       check=True, env=env)
    else:
        sys.exit(__doc__)


if __name__ == '__main__':
    main()
