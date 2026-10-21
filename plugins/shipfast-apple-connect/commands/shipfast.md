---
name: shipfast
description: "Where is this app on the way to App Review? Runs the read-only checks of the shipfast pipeline (doctor, then submit without --submit), and lists what the agent can do next and what only the owner can do. Changes nothing in App Store Connect, except attaching the newest processed build to the version."
argument-hint: "[app-folder] [--offline]"
allowed-tools:
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/shipfast/scripts/doctor.mjs *)
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/shipfast/scripts/doctor.mjs" *)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/shipfast/scripts/submit.mjs)
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/skills/shipfast/scripts/submit.mjs")
  - Read
  - Glob
  - Grep
---

# /shipfast

Report where the app stands on the way to App Review. This command checks; it doesn't create products, set prices, upload or submit. Load the `shipfast` skill for any of that.

Arguments as typed: `$ARGUMENTS`

1. Find the app folder: the argument, else the current folder. It must hold `ship/ship.config.json`. If it doesn't, say so and offer `init.sh` from the skill (it copies the templates and changes nothing else).
2. From the app folder, run `node "${CLAUDE_PLUGIN_ROOT}/skills/shipfast/scripts/doctor.mjs"` (add `--offline` if the user passed it or no API key is set).
3. If the app record exists and `--offline` wasn't asked for, run `node "${CLAUDE_PLUGIN_ROOT}/skills/shipfast/scripts/submit.mjs"` with no flags. It attaches the newest VALID build to the version (say so) and lists what is missing. Never add `--submit`.
4. Map the result onto the checklist in `${CLAUDE_PLUGIN_ROOT}/skills/shipfast/references/manual-steps.md` and answer with three short lists:
   - **Done**: steps that are in place, with ids and states.
   - **Next for the agent**: the next scripts to run, in order, each with `--dry` first.
   - **Owner only**: web steps and decisions (app record, prices, Paid Apps agreement, App Privacy Publish, first products' Add for Review, the upload and submit go-ahead).
