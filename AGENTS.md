<!-- Generated: 2026-03-01 | Updated: 2026-03-01 -->

# ygg-helper-dl

## Purpose
YggTorrent Helper (Smart Timer) is a **Manifest V3 browser extension** for Chrome/Brave/Opera/Edge that automatically manages the 30-second download wait timer on YggTorrent. Written in vanilla JavaScript with no dependencies or build step.

## Key Files

| File | Description |
|------|-------------|
| `manifest.json` | Extension manifest with permissions, content scripts, host permissions for 24 YggTorrent TLDs |
| `background.js` | Service worker (~500 lines) — Pipeline orchestrator with persistent queue, token acquisition, alarms, downloads |
| `content.js` | Content script (~200 lines) — Thin sensor + token service, detects torrents, enqueues, renders UI states |
| `content.css` | Styles for the in-page overlay widget |
| `popup.html` | Popup dashboard HTML structure |
| `popup.js` | Pipeline dashboard logic — renders queue cards, handles retry/remove |
| `popup.css` | Popup dashboard styles |
| `build.ps1` | PowerShell script to package `.crx` for distribution |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `icons/` | Extension icons in multiple sizes (see `icons/AGENTS.md`) |
| `images/` | Documentation screenshots for README (see `images/AGENTS.md`) |

## For AI Agents

### Working In This Directory
- **No build step**: Load the extension directly via `chrome://extensions` → "Load unpacked"
- **Language**: All UI text, comments, and documentation are in **French**
- **Indentation**: 4-space style in JavaScript files
- **No package.json**: No npm, no linting, no automated tests

### Testing Requirements
Manual testing only:
1. Load unpacked extension in browser
2. Visit a YggTorrent torrent page
3. Verify automatic enqueue and countdown
4. Check popup renders pipeline correctly
5. If touching domain logic, test custom-domain registration

### Common Patterns
- **Message passing**: `chrome.runtime.onMessage` for background ↔ content ↔ popup communication
- **Storage keys**: All use `ygg_` prefix (e.g., `ygg_timers`, `ygg_queue`)
- **Message actions**: `UPPER_SNAKE_CASE` (e.g., `ENQUEUE`, `REQUEST_TOKEN`, `TOKEN_RESULT`)
- **Alarm names**: `ygg_` prefix (e.g., `ygg_process_queue`, `ygg_countdown_${id}`)
- **Console logs**: Prefixed with `[YggHelper]`, `[Pipeline]`, `[Stats]`, `[Update]`, `[Domain]`

## Architecture

Three-part Chrome Extension architecture:

```
background.js (Service Worker)     ← Pipeline orchestrator
    ↕ message passing
content.js (Content Script)        ← Thin sensor + token service
    ↕ message passing
popup.js + popup.html (Popup UI)   ← Pipeline dashboard
```

### Timer Status Machine

```
queued → requesting → counting → downloading → done
                  ↘        ↘          ↘
                   error ←←←←←←←←←←←←
                     ↓ (retry)
                   queued
```

6 statuses: `queued`, `requesting`, `counting`, `downloading`, `done`, `error`

## Dependencies

### Internal
- `icons/` — Extension icons referenced in manifest

### External
- Chrome Extension APIs (Manifest V3)
- No external JavaScript libraries

## Coding Style & Naming Conventions

- Keep **French** UI strings, comments, and docs consistent with the existing codebase.
- Naming: `camelCase` for variables/functions, `UPPER_SNAKE_CASE` for constants and message actions.

## Commit & Pull Request Guidelines

- Commit messages in history are short and pragmatic (e.g., `v1.4: ...`, `Update README.md`). Match that style.
- PRs should include: a clear description, manual test steps, and **screenshots** for UI changes.
- Do not commit distribution artifacts or keys (`*.crx`, `*.zip`, `*key*.pem` are ignored by `.gitignore`).
