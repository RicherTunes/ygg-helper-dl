# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

YggTorrent Helper (Smart Timer) is a **Chrome/Brave/Opera Manifest V3 browser extension** that automatically manages the 30-second download wait timer on YggTorrent. Users visit torrent pages, and everything queues and downloads automatically — zero friction.

Written in vanilla JavaScript with no dependencies.

**Language**: All UI text, comments, and documentation are in **French**.

## File Reference

| File | Purpose |
|------|---------|
| `manifest.json` | Extension manifest (permissions, content scripts, 24 YggTorrent TLDs) |
| `background.js` | Service worker — Pipeline orchestrator (~500 lines) |
| `content.js` | Content script — Thin sensor + token service (~200 lines) |
| `content.css` | In-page overlay widget styles |
| `popup.html` | Popup dashboard HTML |
| `popup.js` | Popup dashboard logic |
| `popup.css` | Popup dashboard styles |
| `build.ps1` | PowerShell script to build `.crx` |
| `icons/` | Extension icons (16, 48, 128, 300x188) |
| `images/` | Documentation screenshots for README |

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
background.js (Service Worker)     ← Pipeline orchestrator
    ↕ message passing
content.js (Content Script)        ← Thin sensor + token service
    ↕ message passing
popup.js + popup.html (Popup UI)   ← Pipeline dashboard
```

### background.js — Pipeline Orchestrator (~500 lines)
- **Persistent queue** in `chrome.storage.local` (`ygg_queue` array + `ygg_timers` map)
- **`processQueue()`**: Idempotent, lease-locked pipeline processor. Picks the first queued item, requests a token, manages countdown via `chrome.alarms`, auto-triggers download, then cascades to next item with cooldown.
- **Token acquisition**: Primary via `REQUEST_TOKEN` message to content script on matching tab. Fallback via single reusable hidden tab when no tabs are open.
- **Error handling**: Classifies errors (rate_limit, auth, not_found, network) with per-type policies. Rate limits apply pipeline-wide backoff with jitter. Network errors use per-item exponential backoff (5s×2^n, max 5 retries).
- **Recovery**: `recoverPipeline()` on `onStartup`/`onInstalled` scans stale states and restarts the pipeline from persisted timestamps.
- **`chrome.alarms`** for all timers (countdown, process queue, update check, cleanup). No `setInterval`.
- **`chrome.downloads.onChanged`** for download completion tracking.
- Keeps: update checking, domain registration, wasted time stats.

### content.js — Thin Sensor + Token Service (~200 lines)
- Singleton `YggTimerManager` detects torrent ID and auto-enqueues via `ENQUEUE` message
- Serves `REQUEST_TOKEN` requests from background (fetches token from YggTorrent API using page cookies)
- Responds to `PING` for hidden tab readiness checks
- Renders 6 status states via `chrome.storage.onChanged` listener
- Local countdown rendering (receives `countdownEndsAt` once, renders locally with `setInterval`)
- Keeps: `getTorrentId()` (3-tier fallback), `getTorrentName()`, `createUI()`

### popup.js — Pipeline Dashboard
- Uses `chrome.storage.onChanged` for instant status updates (1s polling only for countdown display)
- Renders pipeline cards with phase badges for 6 states
- Retry/Remove buttons for error items
- Completed section showing download history
- Keeps: domain settings, update check, wasted time stats

## Message Protocol

| Action | Direction | Purpose |
|---|---|---|
| `ENQUEUE` | content → background | Add torrent to pipeline queue |
| `REQUEST_TOKEN` | background → content | Ask content script to fetch token from API |
| `TOKEN_RESULT` | content → background | Return token or error from fetch |
| `PING` | background → content | Check if content script is ready (hidden tab) |
| `RETRY_TIMER` | popup → background | Manual retry for errored timer |
| `REMOVE_TIMER` | popup → background | Remove timer from queue |
| `ADD_WASTED_TIME` | background (internal) | Add 30s to stats on token acquisition |
| `SAVE_CUSTOM_DOMAIN` | popup → background | Register content scripts for new domain |
| `GET_DOMAIN_CONFIG` | popup → background | Get current custom domain |
| `REMOVE_CUSTOM_DOMAIN` | popup → background | Unregister custom domain scripts |

## Storage Keys

All stored in `chrome.storage.local`:
- `ygg_queue` — Ordered array of torrent IDs (pipeline processing order)
- `ygg_timers` — Map of torrent data keyed by ID (see Timer Properties below)
- `ygg_pipeline_state` — Pipeline-wide state: `{ nextProcessAt, rateLimitCount, rateLimitUntil, consecutiveFailures }`
- `ygg_pipeline_lock` — Lease-based lock: `{ lockUntil, lockOwner }`
- `ygg_stats_wasted` — Total seconds (integer) of accumulated wait time
- `ygg_update_available` — `{ version, url }` when a newer version exists on GitHub
- `ygg_custom_domain` — User-configured domain string
- `ygg_dismissed` — Map of dismissed torrent IDs with timestamps (7-day TTL): `{ [torrentId]: dismissedAt }`

### Timer Properties

Each timer in `ygg_timers` contains:
- `status` — Current state: `queued`, `requesting`, `counting`, `downloading`, `done`, `error`
- `name` — Torrent display name
- `origin` — Base URL (e.g., `https://yggtorrent.org`)
- `enqueuedAt` — Timestamp when added to queue
- `statusSince` — Timestamp of last status change
- `token` — Download token from YggTorrent API
- `tokenRequestedAt` — When token request was initiated
- `tokenIssuedAt` — When token was received
- `requestNonce` — Unique ID for request deduplication
- `countdownEndsAt` — When the 30s countdown finishes
- `retryCount` — Number of retry attempts (max 5)
- `nextRetryAt` — When to retry after error
- `lastError` — Error message string
- `errorType` — Classified error: `rate_limit`, `auth`, `not_found`, `network`
- `downloadId` — Chrome download ID
- `completedAt` — When download finished

## Timer Status Machine

```
queued → requesting → counting → downloading → done
                  ↘        ↘          ↘
                   error ←←←←←←←←←←←←
                     ↓ (retry)
                   queued
```

6 statuses: `queued`, `requesting`, `counting`, `downloading`, `done`, `error`

## Domain Support

The manifest includes 24 known YggTorrent TLDs. When the site changes domain:
1. If the new domain is already in the manifest, it works automatically
2. If not, user can add it via the popup's "Domaine personnalisé" setting

## Conventions

- Console logs use prefixes: `[YggHelper]`, `[Pipeline]`, `[Stats]`, `[Update]`, `[Domain]`
- Storage keys use `ygg_` prefix
- Message actions are `UPPER_SNAKE_CASE`
- Alarm names use `ygg_` prefix: `ygg_process_queue`, `ygg_countdown_${id}`, `ygg_update_check`, `ygg_cleanup`
- Code uses camelCase for functions/variables, `UPPER_SNAKE_CASE` for constants
- Indentation: 4-space style in JavaScript files

## Testing

No automated tests. Manual testing only:
1. Load unpacked extension in browser
2. Visit a YggTorrent torrent page
3. Verify automatic enqueue and countdown
4. Check popup renders pipeline correctly (active vs pending timers)
5. If touching domain logic, test custom-domain registration

## Commit Guidelines

- Commit messages are short and pragmatic: `v1.4: Fix Brave compatibility`, `Update README.md`
- Do not commit distribution artifacts (`*.crx`, `*.zip`, `*key*.pem` are in `.gitignore`)
- For UI changes, include screenshots in PRs
