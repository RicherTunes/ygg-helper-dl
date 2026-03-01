# Architecture Overview

## System Diagram

```mermaid
graph TB
    subgraph Browser
        subgraph "Content Script"
            CS[content.js<br/>YggTimerManager]
            UI[Overlay UI]
        end

        subgraph "Service Worker"
            BG[background.js<br/>Pipeline Orchestrator]
            Queue[(ygg_queue)]
            Timers[(ygg_timers)]
            State[(ygg_pipeline_state)]
        end

        subgraph "Popup UI"
            PJS[popup.js]
            PHTML[popup.html]
        end
    end

    subgraph "YggTorrent"
        Page[Torrent Page]
        API[Token API]
    end

    Page -->|detects torrent| CS
    CS -->|ENQUEUE| BG
    BG -->|REQUEST_TOKEN| CS
    CS -->|fetches token| API
    CS -->|TOKEN_RESULT| BG
    BG -->|chrome.downloads| DL[Download]
    BG -->|updates| Timers
    BG -->|updates| Queue
    PJS -->|reads| Timers
    PJS -->|reads| Queue
    PJS -->|RETRY_TIMER| BG
    PJS -->|REMOVE_TIMER| BG
    Timers -->|storage.onChanged| CS
    CS -->|renders| UI
```

## Message Flow

```mermaid
sequenceDiagram
    participant Page as YggTorrent Page
    participant CS as content.js
    participant BG as background.js
    participant API as YggTorrent API
    participant Storage as chrome.storage

    Page->>CS: User visits torrent page
    CS->>CS: getTorrentId()
    CS->>BG: ENQUEUE {torrentId, name, origin}
    BG->>Storage: Add to ygg_queue, ygg_timers
    BG->>BG: processQueue()

    Note over BG: Pipeline starts processing

    BG->>CS: REQUEST_TOKEN {torrentId, origin}
    CS->>API: GET /download.php
    API-->>CS: Token response
    CS-->>BG: TOKEN_RESULT {token} or {error}

    alt Success
        BG->>Storage: Update status: counting
        BG->>BG: Set alarm for 30s countdown
        Note over BG: 30 seconds pass
        BG->>BG: handleCountdownComplete()
        BG->>BG: chrome.downloads.download()
        BG->>Storage: Update status: downloading
    else Error
        BG->>Storage: Update status: error
        Note over BG: Retry with backoff
    end

    Storage-->>CS: storage.onChanged event
    CS->>CS: updateUIForStatus()
```

## Timer Status Machine

```mermaid
stateDiagram-v2
    [*] --> queued: ENQUEUE
    queued --> requesting: processQueue()
    requesting --> counting: TOKEN_RESULT success
    requesting --> error: TOKEN_RESULT failure
    counting --> downloading: countdown complete
    downloading --> done: download complete (MIME verified)
    downloading --> cancelled: USER_CANCELED
    downloading --> error: download failed / HTML response
    error --> queued: retry
    done --> [*]
    cancelled --> [*]
    error --> [*]: max retries
```

**7 statuses**: `queued`, `requesting`, `counting`, `downloading`, `done`, `cancelled`, `error`

| Status | Description | User Action Available |
|--------|-------------|----------------------|
| `queued` | Waiting in pipeline | Remove |
| `requesting` | Fetching token from API | None |
| `counting` | 30-second countdown active | Remove |
| `downloading` | Chrome download in progress | None |
| `done` | Successfully downloaded | Retélécharger |
| `cancelled` | User canceled download | Réessayer |
| `error` | Failed with classified error | Réessayer / Retirer |

## Storage Schema

```mermaid
erDiagram
    ygg_queue {
        string[] torrentIds "Ordered list of pending torrents"
    }

    ygg_timers {
        string status "queued|requesting|counting|downloading|done|error"
        string name "Torrent display name"
        string origin "Base URL (e.g., https://yggtorrent.org)"
        number enqueuedAt "Timestamp when added"
        number statusSince "Timestamp of last status change"
        string token "Download token from API"
        number tokenRequestedAt "When token request started"
        number tokenIssuedAt "When token was received"
        string requestNonce "Unique ID for deduplication"
        number countdownEndsAt "When countdown finishes"
        number retryCount "Number of retry attempts"
        number nextRetryAt "When to retry next"
        string lastError "Error message"
        string errorType "rate_limit|auth|not_found|network"
        number downloadId "Chrome download ID"
        number completedAt "When download finished"
    }

    ygg_pipeline_state {
        number nextProcessAt "When pipeline can process next"
        number rateLimitCount "Consecutive rate limits"
        number rateLimitUntil "Rate limit cooldown ends"
        number consecutiveFailures "Unknown error counter"
    }

    ygg_pipeline_lock {
        number lockUntil "Lock expiration timestamp"
        string lockOwner "Random ID of lock holder"
    }

    ygg_dismissed {
        number dismissedAt "When user dismissed (7-day TTL)"
    }
```

## Component Responsibilities

| Component | Responsibility |
|-----------|---------------|
| `background.js` | Pipeline orchestration, queue management, token requests, downloads, alarms |
| `content.js` | Torrent detection, token fetching, UI rendering |
| `popup.js` | Dashboard display, user actions (retry/remove) |

## Key Design Decisions

### Why chrome.alarms instead of setTimeout?

Manifest V3 Service Workers can be terminated at any time. `setTimeout`/`setInterval` callbacks are lost when the worker dies. `chrome.alarms` persists and wakes the worker.

### Why a lease-based lock?

Multiple async operations may try to process the queue simultaneously. The lock prevents race conditions with a TTL to handle crashed workers.

### Why hidden tab fallback?

If the user closes all YggTorrent tabs, there's no content script to fetch tokens. The hidden tab provides a temporary context for token acquisition.

## Error Classification System

The pipeline classifies errors into 4 types with different handling policies:

| Error Type | Detection | Policy |
|------------|-----------|--------|
| `rate_limit` | HTTP 429, HTML response, "wasn't available" message | Global backoff (all items wait) |
| `auth` | HTTP 403, login redirect | No auto-retry (user must login) |
| `not_found` | HTTP 404 | Remove from queue permanently |
| `network` | Timeout, fetch error | Per-item exponential backoff (max 5 retries) |

### Consecutive Failures Escalation

Unknown errors are tracked via `consecutiveFailures` counter. After 2 consecutive unknown errors, the pipeline escalates to rate-limit mode as a safety net.

## Stale State Detection

The pipeline detects and recovers from stuck states:

| State | Timeout | Recovery |
|-------|---------|----------|
| `requesting` | 30 seconds | Reset to `queued`, retry |
| `downloading` | 5 minutes | Mark as `error`, retry if under max |

## Request Deduplication

Each token request includes a `requestNonce` (random ID). Late responses with outdated nonces are ignored to prevent state corruption.

## Hidden Tab Optimization

The hidden tab is **reused** across multiple requests when possible:
- Tab is created on first fallback
- Tab persists for subsequent requests to same domain
- Tab is recycled when domain changes
- Reduces overhead of repeated tab creation

## SPA/bfcache Navigation Handling

The content script handles modern navigation patterns:

```mermaid
graph LR
    A[pageshow.persisted] --> D[refreshTorrentContext]
    B[popstate] --> D
    C[pushState/replaceState] --> D
    D --> E{torrentId changed?}
    E -->|Yes| F[Re-enqueue new torrent]
    E -->|No| G[No action]
```

The history API is patched to intercept `pushState`/`replaceState` calls.

## Download Filename Sanitization

Filenames are sanitized before download to prevent filesystem errors:
1. Remove control characters (`\x00-\x1f`)
2. Remove filesystem-unsafe characters (`<>:"/\|?*`)
3. Remove trailing dots/spaces (Windows issue)
4. Truncate to 150 characters max
5. Append `.torrent` extension if missing

## Pipeline Recovery on Startup

When the Service Worker restarts (`onStartup`/`onInstalled`):

1. **Recreate missing alarms** — Countdown alarms are recreated from `countdownEndsAt`
2. **Clean stale states** — Items stuck in `requesting`/`downloading` are reset
3. **Resume processing** — `processQueue()` is called to continue

## Configuration Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| `TIMER_DURATION` | 30s | YggTorrent mandatory wait |
| `LOCK_TTL` | 15s | Pipeline lock duration |
| `STALE_REQUESTING_TIMEOUT` | 30s | Max time waiting for token |
| `STALE_DOWNLOADING_TIMEOUT` | 5min | Max time for download |
| `COOLDOWN_BETWEEN_DOWNLOADS` | 3s | Delay between downloads |
| `MAX_RETRIES` | 5 | Max network error retries |
| `BASE_RETRY_DELAY` | 5s | Initial retry delay |
| `MAX_RETRY_DELAY` | 2min | Max retry delay cap |
| `CLEANUP_INTERVAL` | 1h | Cleanup completed timers |
| `DISMISSED_TTL` | 7 days | Expiry for dismissed torrents |

## Download Verification

When a download completes, the pipeline verifies it wasn't an HTML error page (expired/invalid token):

```mermaid
flowchart TD
    A[Download Complete] --> B{Check MIME type}
    B -->|text/html| C[Treat as rate_limit error]
    C --> D[Delete downloaded file]
    C --> E[Mark timer as error]
    B -->|application/x-bittorrent| F[Mark as done]
    F --> G[Set justCompleted flag]
    G --> H[Trigger UI animation]
```

This catches cases where YggTorrent returns an error page instead of the torrent file.

## User Cancellation Handling

When a user manually cancels a download:

```javascript
if (delta.error.current === 'USER_CANCELED') {
    timer.status = 'cancelled';  // Not 'error'
    // No auto-retry, User can manually retry.
}
```

**Cancelled items**:
- Do not auto-retry
- Show "Annulé — Réessayer" in UI
- Can be re-enqueued via manual retry button

## Retry Priority

When user clicks "Réessayer":
- Timer is added to **front** of queue (`queue.unshift()`)
- Dismissed status is cleared
- All retry state is reset (retryCount, nextRetryAt, lastError, errorType)

## Cleanup Behavior

The extension automatically cleans up old data:

| Data Type | TTL | Action |
|-----------|-----|--------|
| `done` timers | 1 hour | Removed from storage |
| `cancelled` timers | 1 hour | Removed from storage |
| `error` timers (no retry) | 1 hour | Removed from storage |
| `dismissed` entries | 7 days | Cleared from dismissed list |

## Hidden Tab Cleanup

The hidden tab is automatically closed when:
1. No more queued items for that origin
2. User removes all torrents from that domain
3. Pipeline becomes empty

## justCompleted Flag

On download success, a `justCompleted: true` flag is set:
- Used by content script to show "✅ Téléchargé !" animation
- Widget fades out after 5 seconds
- On page revisit, widget shows "✅ Déjà téléchargé — Retélécharger"
| `DISMISSED_TTL` | 7 days | Remembered removal duration |

## Download Verification

Downloads are verified after completion to detect token expiration:

| Check | Condition | Action |
|-------|-----------|--------|
| MIME type | `text/html` instead of torrent | Treat as `rate_limit`, delete file, retry |
| User cancel | `USER_CANCELED` error | Set status `cancelled`, no auto-retry |
| Network error | Other interruption | Set status `error`, retry with backoff |

## Completion Tracking

When a download completes successfully:

1. **`justCompleted` flag** — Set to `true` for UI animation (fades out widget after 5s)
2. **Cooldown** — 3-second delay before processing next item
3. **Hidden tab cleanup** — Closed if no more items for that origin

## Manual Retry Priority

When user clicks "Réessayer" (retry):
- Torrent is added to the **front** of the queue (`unshift`)
- All error state is cleared (`retryCount`, `lastError`, etc.)
- Removed from dismissed list (allows re-enqueue on page revisit)

## Automatic Cleanup

The pipeline automatically cleans up old data:

| Data Type | TTL | Trigger |
|-----------|-----|---------|
| Completed torrents | 1 hour | `CLEANUP_INTERVAL` alarm |
| Cancelled torrents | 1 hour | `CLEANUP_INTERVAL` alarm |
| Dismissed torrents | 7 days | `CLEANUP_INTERVAL` alarm |
| Stale requesting | 30 seconds | `processQueue()` |
| Stale downloading | 5 minutes | `processQueue()` |

## Update Notification System

The extension checks for updates daily:

1. **Fetch** manifest from GitHub (`GITHUB_MANIFEST_URL`)
2. **Compare** versions using semantic versioning
3. **Notify** via:
   - Badge text "NEW" (red background)
   - `ygg_update_available` storage entry
   - Popup banner with link to releases

## Custom Domain Script Registration

Dynamic content script registration for new domains:

```javascript
chrome.scripting.registerContentScripts([{
    id: 'ygg-custom-domain',
    matches: [`*://*.${domain}/*`, `*://${domain}/*`],
    js: ['content.js'],
    css: ['content.css'],
    runAt: 'document_idle',
    persistAcrossSessions: true  // Survives browser restart
}]);
```

Scripts are unregistered before re-registration to handle domain changes.

