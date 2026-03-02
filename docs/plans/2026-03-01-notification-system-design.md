# Notification System Design

**Date:** 2026-03-01
**Status:** Implemented

## Overview

Add badge counter and notifications to improve user awareness of pipeline state.

## Features Implemented

### 1. Badge Counter

- Shows total queue depth (items in queue + errors with retry scheduled)
- Blue background (#3b82f6)
- Updates in real-time on any queue/timer change
- Falls back to "NEW" (red) when pipeline empty but update available

### 2. Pipeline Complete Notification

- Triggered when queue transitions from non-empty to empty with at least one success
- Title: "✅ Téléchargements terminés"
- Body: "X torrents téléchargés avec succès"
- Action button: "Ouvrir le dossier" → opens Chrome downloads folder
- Click dismisses notification

### 3. Error Notification

- Triggered only for terminal errors (no auto-retry):
  - `retryCount > MAX_RETRIES` (5 attempts exhausted)
  - `errorType: 'auth'` (authentication failure)
  - `errorType: 'not_found'` (torrent deleted)
- Title: "⚠️ Erreur de téléchargement"
- Body: "{torrent name}\n{error message}"
- Action button: "Réessayer" → re-queues with retryCount=0
- Click dismisses notification

### 4. Badge Priority

1. Pipeline count (blue) - highest priority
2. Update available "NEW" (red) - when pipeline empty
3. Empty - when nothing to show

## Files Modified

- `background.js`: Added badge/notification functions, integrated at all state change points

## No Sound

Per user preference, no sound alerts were implemented.
