# Screenshots

## Sizes and display types

| Device | Folder | API display type | Sizes (px) | Status |
|---|---|---|---|---|
| iPhone 6.9" | `iphone69` | `APP_IPHONE_67` | 1320 x 2868, 1290 x 2796 | Accepted (Duo Peas, Fold Days) |
| iPad 13" | `ipad13` | `APP_IPAD_PRO_3GEN_129` | 2064 x 2752, 2048 x 2732 | Accepted. `ipad13-2048` is the fallback folder at 2048 x 2732. |
| iPhone Duo, open (inner display, landscape) | `iphoneduo` | `APP_IPHONE_DUO` | 2853 x 2007, 2007 x 2853 | Uploaded for Fold Days (21 Oct 2026); acceptance not recorded |
| iPhone Duo, closed (outer display) | `iphoneduo-outer` | `APP_IPHONE_DUO` | 1398 x 2034 | Fallback folder; acceptance not confirmed |

- An app that runs on iPad needs the iPad set. Set `submit.requiredScreenshots` to match your app.
- iPhone Duo screenshots become required from April 2027 for apps that run on it (Apple developer news, 5 Oct 2026). Skip the Duo folders for apps that don't target it.
- Three to ten frames per set. The first frames show in search results: put the promise there.
- Raw captures: `xcrun simctl io <udid> screenshot --display=primary` is the outer display (or the only one), `--display=primary-1` is the inner display while the phone is open. On a closed phone only `primary` exists.

## Pipeline

1. **Demo data and launch switches in the app**, DEBUG only: one argument per screen (`-openScreen detail`), one for demo content (`-demo`), one to skip onboarding (`-uiTesting`). Never ship screenshots of empty states.
2. **Raw captures**: `raw-shots.py <device> <lang>` for `iphone`, `ipad` if the app runs on iPad, and for iPhone Duo apps `duo-inner` (phone open) and `duo-outer` (phone closed), each language. It sets a clean status bar (9:41, full battery). For the Duo, open or close the phone in Device Hub first, or pass `--set-pose` to use Duology's `duo-pose`.
3. **Compose**: `store-screens.py` puts a caption on top and the framed capture below, at the exact sizes above. Captions come from `screens.captions`, one pair per shot and language.
4. **Look at every frame.** For iPhone Duo apps, check that nothing important sits on the fold line in the inner-display frames. Run `duo-pose-matrix` for book and tabletop if the app uses them (those aren't store screenshots, but reviewers may try them).
5. **Upload**: `screenshots.mjs --dry`, then without `--dry`. Same name and same MD5 is skipped; a changed file with the same name replaces the old one. `--types=duo --no-review` touches only the Duo set.
6. **Review screenshot**: one image of the paywall with prices visible, on every product (`screenshots.reviewShot`). Products stay `MISSING_METADATA` without it.

## Product page header and search results asset

| File | Size | Placement type |
|---|---|---|
| `header/<locale>/header.png` | 3840 x 1646 (21:9) | `PRODUCT_PAGE_HEADER_ASSET` |
| `header/<locale>/search.png` | 3840 x 2560 (3:2) | `APP_STORE_SEARCH_RESULTS_ASSET` |

`store-header.py` builds them from the iPhone captures and the icon, keeping text and phones in the middle 70 % (Apple crops the sides on small screens). `header.mjs` uploads each file once into the app's asset library and places it on each localization. Placed on Fold Days, 21 Oct 2026 (en, fr).
