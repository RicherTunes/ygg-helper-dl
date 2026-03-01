<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-01 | Updated: 2026-03-01 -->

# icons

## Purpose
Extension icons in multiple sizes for Chrome/Brave/Opera/Edge. These are referenced in `manifest.json` for the extension's toolbar button and the extensions management page.

## Key Files

| File | Description |
|------|-------------|
| `icon16.png` | 16×16 icon — Used in toolbar, tabs, and favicons |
| `icon48.png` | 48×48 icon — Used in extensions management page |
| `icon128.png` | 128×128 icon — Used in Chrome Web Store and installation dialogs |
| `icon300x188.png` | 300×188 icon — Used for promotional images |

## For AI Agents

### Working In This Directory
- These are static PNG assets — no code changes needed here
- Icon sizes must match the dimensions specified in `manifest.json`
- If replacing icons, maintain the same filenames and dimensions

## Dependencies

### Internal
- Referenced by `manifest.json` in `icons` and `action.default_icon` properties

### External
- None — static image assets
