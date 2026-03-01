# Screenshot Capture Scripts

This directory contains scripts to capture screenshots of the YggTorrent Helper extension popup in various states.

## Prerequisites

1. Install Node.js (v18+)
2. Install dependencies:

```bash
cd screenshots
npm install
npx playwright install chromium
```

## Usage

### Quick Method (Mock HTML - Recommended)

Uses mock HTML files that simulate the extension UI without loading the actual extension:

```bash
node take-screenshots.js
```

This directly captures screenshots from `mock-pipeline.html` and `mock-update.html` and copies them to `images/`.

**Pros**: Fast, no extension loading issues, works headless
**Cons**: Mock files must be kept in sync with actual popup.html/popup.js

### Full Method (Real Extension)

Loads the actual extension and injects storage data:

```bash
npm run capture
```

This will generate screenshots in `screenshots/output/`:

| Screenshot | Description |
|------------|-------------|
| `page_principal.png` | Main interface with pipeline (for README) |
| `update_notif.png` | Update notification popup (for README) |
| `empty_state.png` | Empty state with no torrents |
| `countdown.png` | Single torrent in countdown |
| `mixed_states.png` | Mixed states (downloading + error) |

### Update README screenshots

```bash
npm run update-readme
```

This captures screenshots and copies the README-relevant ones to `images/`.

## How it works

The script:

1. **Loads the extension** in Chromium via `--load-extension` flag
2. **Finds the extension ID** by navigating to chrome://extensions
3. **Sets mock storage data** for different UI states (queued, counting, downloading, done, error, cancelled)
4. **Captures screenshots** of the popup for each state

## Customizing States

Edit `capture-screenshots.js` to modify:

- `SAMPLE_TORRENTS` - Sample torrent data for each status
- `SCENARIOS` - Different pipeline configurations
- `screenshots` array - Which screenshots to capture

## Troubleshooting

### "Could not find extension ID"

- Make sure the extension loads correctly in Chrome
- Try running with `headless: false` to see what's happening

### "Extension not loading"

- Verify the extension path is correct
- Check that manifest.json is valid
- Try loading the extension manually in Chrome first

### Storage not updating

- The popup may need to be reloaded after storage changes
- Check the browser console for errors
