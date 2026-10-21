#!/usr/bin/env python3
"""Raw App Store captures: launches the installed app straight into each screen and saves a PNG per screen.

usage: raw-shots.py <device> <lang> [--config <path>] [--only shot1,shot2] [--set-pose]
  device   a key of capture.devices (default keys: iphone, ipad, and for foldable iPhone Duo apps duo-inner, duo-outer)
  lang     a key of capture.languages (e.g. en, fr)
  --set-pose  iPhone Duo only: set the pose first with Duology's duo-pose (needs the user's Accessibility permission;
              found through $DUO_POSE or PATH). Without it, set the pose in Device Hub yourself.

Writes <root>/build/raw/<device>-<lang>/<shot>.png. Uses existing simulators only, found by name: it never
creates one (each takes 4-6 GB). The app must already be built for the simulator (capture.appPath).
Your app needs launch arguments that open each screen with demo data (capture.shots[].args), DEBUG only.
"""
import json
import os
import shutil
import subprocess
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
from shipconfig import Config, config_arg  # noqa: E402

DEFAULT_DEVICES = {
    'iphone': {'simulator': 'iPhone 17', 'display': 'primary'},
    'ipad': {'simulator': 'iPad Pro 13-inch (M5)', 'display': 'primary'},
    'duo-inner': {'simulator': 'iPhone Duo', 'display': 'primary-1', 'pose': 'open'},
    'duo-outer': {'simulator': 'iPhone Duo', 'display': 'primary', 'pose': 'closed'},
}


def sh(*args, check=True, quiet=False):
    r = subprocess.run(args, capture_output=True, text=True)
    if check and r.returncode:
        sys.exit(f'{" ".join(args)} failed: {r.stderr.strip()[:400]}')
    if not quiet and r.stdout.strip():
        print(r.stdout.strip())
    return r


def find_udid(name):
    data = json.loads(sh('xcrun', 'simctl', 'list', 'devices', 'available', '-j', quiet=True).stdout)
    matches = [d for runtime in data['devices'].values() for d in runtime if d['name'] == name]
    if not matches:
        sys.exit(f'No simulator named "{name}". Use an existing one (capture.devices.<device>.simulator); never create one here.')
    booted = [d for d in matches if d['state'] == 'Booted']
    return (booted or matches)[0]['udid']


def main():
    argv = sys.argv[1:]
    cfg = Config(config_arg(argv))
    set_pose = '--set-pose' in argv
    only = None
    if '--only' in argv:
        i = argv.index('--only')
        only = set(argv[i + 1].split(','))
        del argv[i:i + 2]
    argv = [a for a in argv if a != '--set-pose']
    if len(argv) != 2:
        sys.exit(__doc__)
    dev_key, lang = argv
    devices = {**DEFAULT_DEVICES, **cfg.get('capture.devices', {})}
    if dev_key not in devices:
        sys.exit(f'unknown device {dev_key}; known: {", ".join(devices)}')
    dev = devices[dev_key]
    languages = cfg.get('capture.languages', {'en': 'en_US'})
    if lang not in languages:
        sys.exit(f'unknown language {lang}; known: {", ".join(languages)}')

    os.environ.setdefault('DEVELOPER_DIR', cfg.get('xcode.developerDir', '/Applications/Xcode-27.1.app/Contents/Developer'))
    bundle = cfg.need('app.bundleId')
    app_path = cfg.path_of(cfg.need('capture.appPath'))
    if not os.path.isdir(app_path):
        sys.exit(f'app not built: {app_path} (build for the simulator first, e.g. run-sim.sh)')
    shots = [s for s in cfg.need('capture.shots') if not only or s['name'] in only]
    wait = float(os.environ.get('WAIT', cfg.get('capture.wait', 6)))

    udid = find_udid(dev['simulator'])
    out = os.path.join(cfg.root, 'build', 'raw', f'{dev_key}-{lang}')
    os.makedirs(out, exist_ok=True)
    sh('xcrun', 'simctl', 'boot', udid, check=False, quiet=True)
    sh('xcrun', 'simctl', 'bootstatus', udid, '-b', quiet=True)

    if dev.get('pose'):
        tool = os.environ.get('DUO_POSE') or shutil.which('duo-pose')
        if set_pose and tool:
            sh(tool, 'set', dev['pose'])
        elif set_pose:
            sys.exit('--set-pose: duo-pose not found (install Duology\'s duology-ship plugin or set $DUO_POSE)')
        else:
            print(f'The iPhone Duo must be {dev["pose"]} in Device Hub now (or pass --set-pose).')

    # A clean status bar: 9:41, full battery and signal.
    sh('xcrun', 'simctl', 'status_bar', udid, 'override', '--time', '9:41', '--batteryState', 'charged',
       '--batteryLevel', '100', '--cellularBars', '4', '--wifiBars', '3', check=False, quiet=True)
    sh('xcrun', 'simctl', 'install', udid, app_path, quiet=True)
    base = cfg.get('capture.launchArgs', [])
    for i, shot in enumerate([{'name': 'warmup', 'args': []}] + shots):
        sh('xcrun', 'simctl', 'launch', '--terminate-running-process', udid, bundle, *base,
           '-AppleLanguages', f'({lang})', '-AppleLocale', languages[lang], *shot.get('args', []), quiet=True)
        time.sleep(wait if i else wait + 2)
        if shot['name'] == 'warmup':
            continue
        path = os.path.join(out, f'{shot["name"]}.png')
        sh('xcrun', 'simctl', 'io', udid, 'screenshot', f'--display={dev.get("display", "primary")}', path, quiet=True)
        print(f'got {dev_key}-{lang}/{shot["name"]}')
    sh('xcrun', 'simctl', 'status_bar', udid, 'clear', check=False, quiet=True)
    print(f'raw captures in {os.path.relpath(out, cfg.root)}. Look at every one before composing.')


if __name__ == '__main__':
    main()
