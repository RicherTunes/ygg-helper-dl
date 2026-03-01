<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-01 | Updated: 2026-03-01 -->

# images

## Purpose
Documentation screenshots used by `README.md` to illustrate the extension's functionality and user interface. These are not bundled with the extension — they're only for GitHub documentation.

## Key Files

| File | Description | Status |
|------|-------------|--------|
| `page_principal.png` | Main popup UI showing Pipeline and Terminés sections | ✅ **Current** (v1.3.2) |
| `update_notif.png` | Update notification with blue banner | ✅ **Current** (v1.3.2) |
| `guide.png` | URL bar only | ⚠️ **NOT USEFUL** - Doesn't show extension UI |

## Screenshot Details (March 2026)

Screenshots were regenerated using Playwright from mock HTML files in `screenshots/` folder.

### page_principal.png
- Shows v1.3.2 UI with "Pipeline" and "Terminés" sections
- Phase badges: En file, Token, Countdown, Terminé, Erreur
- "Temps gagné" stat label
- No manual buttons - fully automatic pipeline
- 350px wide at 2x DPI (700px actual)

### update_notif.png
- Shows v1.3.2 UI with update notification banner
- Blue banner with "Mise à jour disponible !"
- "Temps gagné" stat label
- 350px wide at 2x DPI (700px actual)

### guide.png
This image only shows a browser URL bar. It does **not** show the extension UI. Consider replacing with actual widget screenshot or removing.

## For AI Agents

### Working In This Directory
- These are static PNG assets for documentation only
- Not part of the extension bundle — excluded from `.crx` builds
- If updating README screenshots, maintain similar dimensions and clarity

## Dependencies

### Internal
- Referenced by `README.md` for documentation purposes

### External
- None — static image assets
