# AGENTS.md

For coding agents other than Claude Code (Codex, Cursor, Copilot, Gemini CLI). Claude Code users install the plugin; see the [README](README.md#quick-start).

## Use it on an app

Read [`plugins/shipfast-apple-connect/skills/shipfast/SKILL.md`](plugins/shipfast-apple-connect/skills/shipfast/SKILL.md) first and follow its steps in order. Scripts are in `plugins/shipfast-apple-connect/skills/shipfast/scripts/`; run them from the app's folder. `/shipfast` is the same as running `doctor.mjs`, then `submit.mjs` with no flags.

The rules in `SKILL.md` apply to you too: ask the owner before certificates, prices, uploads and submissions; never put secrets in tracked files; never create a simulator.

## Work on this repo

- Scripts: Node (ES modules, no dependencies) and Python 3 (Pillow for images only). Keep every app-specific value in the config.
- Every write to App Store Connect goes through `write()` in `lib/util.mjs`, so `--dry` covers it.
- Add a test in `tests/scripts.test.mjs` for new behaviour, using the fake App Store Connect.
- A fact about Apple's API goes in `references/lessons.md` only with how and when it was seen; a link goes in `references/sources.md`.
- Before you finish:

```bash
cd plugins/shipfast-apple-connect/skills/shipfast
for f in scripts/*.mjs scripts/lib/*.mjs tests/*.mjs templates/*.mjs; do node --check "$f"; done
for f in scripts/*.sh; do bash -n "$f"; done
python3 -m py_compile scripts/*.py scripts/lib/*.py
node --test tests/
```
