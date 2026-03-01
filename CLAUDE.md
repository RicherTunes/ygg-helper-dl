# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

YggTorrent Helper (Smart Timer) is a **Chrome/Brave/Opera Manifest V3 browser extension** that manages the 30-second download wait timer on YggTorrent in the background, letting users browse freely. Written in vanilla JavaScript with no dependencies.

**Language**: All UI text, comments, and documentation are in **French**.

## Development

Load the extension directly in the browser (no build step needed):
1. Open `brave://extensions` (or `chrome://extensions`)
2. Enable Developer Mode
3. "Load unpacked" → select this project folder
4. After code changes, click the reload button on the extension card

**Important**: On Brave, "Load unpacked" is the only reliable method. `.crx` installs appear enabled but silently fail to inject content scripts.

To build a `.crx` for distribution: `powershell -File build.ps1`

No package.json, no npm, no linting, no tests.

## Architecture

Three-part Chrome Extension architecture communicating via `chrome.runtime.onMessage`:

```
background.js (Service Worker)     ← Global coordinator
    ↕ message passing
content.js (Content Script)        ← Injected into YggTorrent pages
    ↕ message passing
popup.js + popup.html (Popup UI)   ← User dashboard
```

### background.js — Global State & Coordination
- **Global timer lock**: Only one timer can run at a time (`isTimerRunning` boolean)
- Routes messages between content script and popup
- Proxies downloads via `chrome.downloads` API
- Tracks "wasted time" statistics
- Checks for updates from GitHub every 24h
- Cleans up stale timers (>1 hour old)
- **Dynamic domain registration**: Registers content scripts for custom domains via `chrome.scripting.registerContentScripts()`

### content.js — Page Interaction
- Singleton object `YggTimerManager` handles all page logic
- Extracts torrent ID via 3-tier fallback: download button → report form → URL regex
- Requests token from YggTorrent's `POST /engine/start_download_timer` endpoint
- Manages 30-second countdown and injects a notification widget (bottom-right corner)
- Timer state machine: connecting → initializing → counting down → ready → downloaded
- Stores `origin` with timer data so popup can construct download URLs for any domain

### popup.js — Dashboard UI
- Polls `chrome.storage.local` every 1 second to render timer cards
- Separates timers into "active" (with token/countdown) and "pending" (queued)
- Allows force-starting pending timers and triggering downloads
- **Domain settings**: Collapsible panel to add custom YggTorrent domains

## Message Protocol

Actions exchanged via `chrome.runtime.sendMessage`:

| Action | Direction | Purpose |
|---|---|---|
| `CAN_I_START` | content → background | Check if timer slot is free |
| `TIMER_STARTED` | content → background | Acquire global lock |
| `TIMER_FINISHED` | content → background | Release global lock |
| `TIMER_CANCELLED` | content → background | Release lock on error/close |
| `REGISTER_PENDING` | content → background | Queue timer when slot occupied |
| `FORCE_START` | popup → background → content | Trigger a pending timer |
| `TRIGGER_START` | background → content | Signal content script to start |
| `ADD_WASTED_TIME` | content/popup → background | Add 30s to stats |
| `SCHEDULE_DOWNLOAD` | content/popup → background | Proxy download to Chrome API |
| `SAVE_CUSTOM_DOMAIN` | popup → background | Register content scripts for new domain |
| `GET_DOMAIN_CONFIG` | popup → background | Get current custom domain |
| `REMOVE_CUSTOM_DOMAIN` | popup → background | Unregister custom domain scripts |

## Storage Keys

All stored in `chrome.storage.local`:
- `ygg_timers` — Object keyed by torrent ID: `{ token, startTime, name, origin, status?, tabId? }`
- `ygg_stats_wasted` — Total seconds (integer) of accumulated wait time
- `ygg_update_available` — `{ version, url }` when a newer version exists on GitHub
- `ygg_custom_domain` — User-configured domain string (e.g., `yggtorrent.wtf`)

## Domain Support

The manifest includes 24 known YggTorrent TLDs. When the site changes domain:
1. If the new domain is already in the manifest, it works automatically
2. If not, user can add it via the popup's "Domaine personnalisé" setting, which uses `chrome.scripting.registerContentScripts()` and `chrome.permissions.request()`

## Conventions

- Console logs use prefixes: `[YggHelper]`, `[Timer]`, `[Stats]`, `[Lock]`, `[Update]`, `[Pending]`, `[Domain]`
- Storage keys use `ygg_` prefix
- Message actions are `UPPER_SNAKE_CASE`
- Code uses camelCase for functions/variables, `UPPER_SNAKE_CASE` for constants
