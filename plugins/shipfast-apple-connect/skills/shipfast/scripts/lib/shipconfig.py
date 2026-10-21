"""Python side of config.mjs: finds ship.config.json, merges ship.local.json, resolves paths against the app root."""
import json
import os
import sys


def _find(explicit=None):
    explicit = explicit or os.environ.get('SHIPFAST_CONFIG')
    if explicit:
        p = os.path.abspath(explicit)
        if not os.path.exists(p):
            sys.exit(f'config not found: {p}')
        return p
    d = os.getcwd()
    while True:
        for p in (os.path.join(d, 'ship', 'ship.config.json'), os.path.join(d, 'ship.config.json')):
            if os.path.exists(p):
                return p
        if os.path.dirname(d) == d:
            break
        d = os.path.dirname(d)
    sys.exit('No ship.config.json found. Copy templates/ship.config.example.json to <app>/ship/ship.config.json, or pass --config <path>.')


def _merge(a, b):
    if isinstance(a, dict) and isinstance(b, dict):
        out = dict(a)
        for k, v in b.items():
            out[k] = _merge(a.get(k), v)
        return out
    return a if b is None else b


class Config:
    def __init__(self, explicit=None):
        self.path = _find(explicit)
        self.dir = os.path.dirname(self.path)
        with open(self.path) as f:
            data = json.load(f)
        local = os.path.join(self.dir, 'ship.local.json')
        if os.path.exists(local):
            with open(local) as f:
                data = _merge(data, json.load(f))
        self.data = data
        default_root = '..' if os.path.basename(self.dir) == 'ship' else '.'
        self.root = os.path.abspath(os.path.join(self.dir, data.get('root', default_root)))

    def get(self, key, fallback=None):
        v = self.data
        for k in key.split('.'):
            if not isinstance(v, dict) or k not in v:
                return fallback
            v = v[k]
        return fallback if v is None else v

    def need(self, key):
        v = self.get(key)
        if v in (None, '') or (isinstance(v, str) and 'REPLACE_ME' in v):
            sys.exit(f'ship.config.json: "{key}" is not set ({self.path})')
        return v

    def path_of(self, p):
        return p if os.path.isabs(p) else os.path.join(self.root, p)


def config_arg(argv):
    """Pops --config <path> or --config=<path> from argv; returns the path or None."""
    for i, a in enumerate(argv):
        if a == '--config' and i + 1 < len(argv):
            p = argv[i + 1]
            del argv[i:i + 2]
            return p
        if a.startswith('--config='):
            del argv[i]
            return a.split('=', 1)[1]
    return None
