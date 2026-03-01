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
    downloading --> done: download complete
    downloading --> error: download failed
    error --> queued: retry
    done --> [*]
    error --> [*]: max retries
```

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
    }

    ygg_pipeline_lock {
        number lockUntil "Lock expiration timestamp"
        string lockOwner "Random ID of lock holder"
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

