// background.js
// Service Worker pour YggTorrent Helper v1.3.2
// Pipeline de téléchargement automatique avec file d'attente persistante

// --- Clés de stockage ---
const STORAGE_KEY = 'ygg_timers';
const QUEUE_KEY = 'ygg_queue';
const PIPELINE_STATE_KEY = 'ygg_pipeline_state';
const PIPELINE_LOCK_KEY = 'ygg_pipeline_lock';
const STATS_KEY = 'ygg_stats_wasted';
const DOMAIN_KEY = 'ygg_custom_domain';

// --- Configuration ---
const TIMER_DURATION = 30000; // 30 secondes
const LOCK_TTL = 15000; // 15 secondes max pour le lock
const STALE_REQUESTING_TIMEOUT = 30000; // 30s sans réponse = stale
const STALE_DOWNLOADING_TIMEOUT = 5 * 60 * 1000; // 5 min
const COOLDOWN_BETWEEN_DOWNLOADS = 3000; // 3s entre téléchargements
const MAX_RETRIES = 5;
const BASE_RETRY_DELAY = 5000; // 5s
const MAX_RETRY_DELAY = 120000; // 2 min
const CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 heure

// --- Configuration Update ---
const GITHUB_REPO = "RicherTunes/ygg-helper-dl";
const GITHUB_MANIFEST_URL = `https://raw.githubusercontent.com/${GITHUB_REPO}/refs/heads/main/manifest.json`;
const GITHUB_RELEASES_URL = `https://github.com/${GITHUB_REPO}/releases`;

// --- Noms d'alarmes ---
const ALARM_PROCESS_QUEUE = 'ygg_process_queue';
const ALARM_UPDATE_CHECK = 'ygg_update_check';
const ALARM_CLEANUP = 'ygg_cleanup';
const ALARM_COUNTDOWN_PREFIX = 'ygg_countdown_';

// --- Initialisation ---
chrome.runtime.onStartup.addListener(() => {
    console.log('[Pipeline] Service Worker démarré (onStartup)');
    checkForUpdates();
    registerCustomDomainScripts();
    recoverPipeline();
});

chrome.runtime.onInstalled.addListener(() => {
    console.log('[Pipeline] Extension installée/mise à jour (onInstalled)');
    checkForUpdates();
    registerCustomDomainScripts();
    recoverPipeline();

    // Alarmes périodiques
    chrome.alarms.create(ALARM_UPDATE_CHECK, { periodInMinutes: 24 * 60 });
    chrome.alarms.create(ALARM_CLEANUP, { periodInMinutes: 60 });
});

// --- Gestionnaire d'alarmes ---
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_PROCESS_QUEUE) {
        console.log('[Pipeline] Alarme processQueue déclenchée');
        processQueue();
    } else if (alarm.name.startsWith(ALARM_COUNTDOWN_PREFIX)) {
        const torrentId = alarm.name.slice(ALARM_COUNTDOWN_PREFIX.length);
        console.log(`[Pipeline] Countdown terminé pour ${torrentId}`);
        handleCountdownComplete(torrentId);
    } else if (alarm.name === ALARM_UPDATE_CHECK) {
        checkForUpdates();
    } else if (alarm.name === ALARM_CLEANUP) {
        cleanupCompletedTimers();
    }
});

// ============================================================
// PIPELINE CORE
// ============================================================

async function acquireLock() {
    const result = await chrome.storage.local.get([PIPELINE_LOCK_KEY]);
    const lock = result[PIPELINE_LOCK_KEY];
    const now = Date.now();

    if (lock && lock.lockUntil > now) {
        return null; // Lock actif, pas expiré
    }

    const lockOwner = Math.random().toString(36).slice(2, 10);
    const newLock = {
        lockUntil: now + LOCK_TTL,
        lockOwner: lockOwner
    };

    await chrome.storage.local.set({ [PIPELINE_LOCK_KEY]: newLock });
    return lockOwner;
}

async function releaseLock(owner) {
    const result = await chrome.storage.local.get([PIPELINE_LOCK_KEY]);
    const lock = result[PIPELINE_LOCK_KEY];

    // Ne relâcher que si c'est notre lock
    if (lock && lock.lockOwner === owner) {
        await chrome.storage.local.remove(PIPELINE_LOCK_KEY);
    }
}

async function processQueue() {
    const lockOwner = await acquireLock();
    if (!lockOwner) {
        console.log('[Pipeline] Lock déjà pris, abandon');
        return;
    }

    try {
        const result = await chrome.storage.local.get([QUEUE_KEY, STORAGE_KEY, PIPELINE_STATE_KEY]);
        const queue = result[QUEUE_KEY] || [];
        const timers = result[STORAGE_KEY] || {};
        const pipelineState = result[PIPELINE_STATE_KEY] || {};
        const now = Date.now();

        // Vérifier le rate-limit global
        if (pipelineState.rateLimitUntil && pipelineState.rateLimitUntil > now) {
            console.log(`[Pipeline] Rate-limit actif jusqu'à ${new Date(pipelineState.rateLimitUntil).toLocaleTimeString()}`);
            scheduleProcessQueue(pipelineState.rateLimitUntil);
            return;
        }

        // Nettoyer les états stale
        let storageChanged = false;
        for (const id of queue) {
            const timer = timers[id];
            if (!timer) continue;

            // Requesting stale (> 30s sans réponse)
            if (timer.status === 'requesting' && timer.tokenRequestedAt && (now - timer.tokenRequestedAt > STALE_REQUESTING_TIMEOUT)) {
                console.log(`[Pipeline] Timer ${id} stale en requesting, reset à queued`);
                timer.status = 'queued';
                timer.statusSince = now;
                timer.tokenRequestedAt = null;
                storageChanged = true;
            }

            // Downloading stale (> 5min, fallback si onChanged raté)
            if (timer.status === 'downloading' && timer.statusSince && (now - timer.statusSince > STALE_DOWNLOADING_TIMEOUT)) {
                console.log(`[Pipeline] Timer ${id} stale en downloading, marqué erreur`);
                timer.status = 'error';
                timer.statusSince = now;
                timer.lastError = 'Téléchargement expiré (timeout)';
                timer.errorType = 'network';
                timer.retryCount = (timer.retryCount || 0) + 1;
                if (timer.retryCount <= MAX_RETRIES) {
                    timer.nextRetryAt = now + calculateRetryDelay(timer.retryCount);
                }
                storageChanged = true;
            }

            // Counting terminé
            if (timer.status === 'counting' && timer.countdownEndsAt && timer.countdownEndsAt <= now) {
                console.log(`[Pipeline] Timer ${id} countdown terminé, passage à downloading`);
                await triggerDownload(id, timer);
                storageChanged = true;
            }

            // Counting en cours — s'assurer que l'alarme existe
            if (timer.status === 'counting' && timer.countdownEndsAt && timer.countdownEndsAt > now) {
                const alarmName = ALARM_COUNTDOWN_PREFIX + id;
                const existing = await chrome.alarms.get(alarmName);
                if (!existing) {
                    const delayMs = timer.countdownEndsAt - now;
                    chrome.alarms.create(alarmName, { when: timer.countdownEndsAt });
                    console.log(`[Pipeline] Alarme countdown recréée pour ${id} (${Math.ceil(delayMs / 1000)}s)`);
                }
            }
        }

        // Réintégrer les erreurs avec nextRetryAt écoulé
        for (const id of queue) {
            const timer = timers[id];
            if (timer && timer.status === 'error' && timer.nextRetryAt && timer.nextRetryAt <= now) {
                console.log(`[Pipeline] Timer ${id} prêt pour retry`);
                timer.status = 'queued';
                timer.statusSince = now;
                timer.nextRetryAt = null;
                timer.lastError = null;
                storageChanged = true;
            }
        }

        // Chercher un timer en cours (requesting, counting, downloading)
        const inFlightId = queue.find(id => {
            const t = timers[id];
            return t && (t.status === 'requesting' || t.status === 'counting' || t.status === 'downloading');
        });

        if (inFlightId) {
            // Un timer est déjà en vol, ne pas en lancer un autre
            if (storageChanged) {
                await chrome.storage.local.set({ [STORAGE_KEY]: timers });
            }
            return;
        }

        // Vérifier le cooldown entre téléchargements
        if (pipelineState.nextProcessAt && pipelineState.nextProcessAt > now) {
            console.log(`[Pipeline] Cooldown actif, prochain traitement à ${new Date(pipelineState.nextProcessAt).toLocaleTimeString()}`);
            scheduleProcessQueue(pipelineState.nextProcessAt);
            if (storageChanged) {
                await chrome.storage.local.set({ [STORAGE_KEY]: timers });
            }
            return;
        }

        // Trouver le premier item queued
        const nextId = queue.find(id => {
            const t = timers[id];
            return t && t.status === 'queued';
        });

        if (!nextId) {
            // Rien à faire
            if (storageChanged) {
                await chrome.storage.local.set({ [STORAGE_KEY]: timers });
            }
            return;
        }

        // Lancer la demande de token
        const timer = timers[nextId];
        timer.status = 'requesting';
        timer.statusSince = now;
        timer.tokenRequestedAt = now;
        timer.requestNonce = Math.random().toString(36).slice(2, 10);
        storageChanged = true;

        await chrome.storage.local.set({ [STORAGE_KEY]: timers });

        // Watchdog: si le token n'arrive pas, processQueue détectera le stale
        scheduleProcessQueue(now + STALE_REQUESTING_TIMEOUT + 1000);

        console.log(`[Pipeline] Demande de token pour ${nextId} ("${timer.name}") nonce=${timer.requestNonce}`);
        await requestToken(nextId, timer);

    } finally {
        await releaseLock(lockOwner);
    }
}

async function scheduleProcessQueue(when) {
    const target = Math.max(when, Date.now() + 1000);
    // Ne jamais repousser une alarme déjà planifiée plus tôt
    const existing = await chrome.alarms.get(ALARM_PROCESS_QUEUE);
    if (existing && existing.scheduledTime <= target) {
        return; // Alarme existante plus proche, on garde
    }
    chrome.alarms.create(ALARM_PROCESS_QUEUE, { when: target });
}

function calculateRetryDelay(retryCount) {
    const delay = BASE_RETRY_DELAY * Math.pow(2, retryCount - 1);
    // Ajouter du jitter (±20%)
    const jitter = delay * 0.2 * (Math.random() * 2 - 1);
    return Math.min(delay + jitter, MAX_RETRY_DELAY);
}

// ============================================================
// TOKEN ACQUISITION
// ============================================================

async function requestToken(torrentId, timer) {
    const nonce = timer.requestNonce;

    // Essayer via un onglet ouvert d'abord
    const success = await requestTokenViaTab(torrentId, timer.origin, nonce);
    if (success) return;

    // Fallback: onglet caché
    console.log(`[Pipeline] Aucun onglet ouvert pour ${timer.origin}, fallback onglet caché`);
    await requestTokenViaHiddenTab(torrentId, timer.origin, nonce);
}

async function requestTokenViaTab(torrentId, origin, nonce) {
    try {
        // Chercher un onglet YggTorrent ouvert sur le bon domaine
        const tabs = await chrome.tabs.query({ url: origin + '/*' });
        const matchingTab = tabs[0];

        if (!matchingTab) return false;

        console.log(`[Pipeline] Envoi REQUEST_TOKEN au tab ${matchingTab.id}`);

        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                console.log(`[Pipeline] Timeout REQUEST_TOKEN pour tab ${matchingTab.id}`);
                resolve(false);
            }, 10000);

            chrome.tabs.sendMessage(matchingTab.id, {
                action: 'REQUEST_TOKEN',
                torrentId: torrentId,
                nonce: nonce
            }, (response) => {
                clearTimeout(timeout);
                if (chrome.runtime.lastError) {
                    console.log(`[Pipeline] Erreur sendMessage: ${chrome.runtime.lastError.message}`);
                    resolve(false);
                    return;
                }
                if (response && response.success) {
                    handleTokenReceived(torrentId, response.token, nonce);
                    resolve(true);
                } else if (response && response.error) {
                    handleTokenError(torrentId, response.error, response.httpStatus, response.responseBody);
                    resolve(true); // Géré, pas besoin de fallback
                } else {
                    resolve(false);
                }
            });
        });
    } catch (e) {
        console.error(`[Pipeline] Erreur requestTokenViaTab:`, e);
        return false;
    }
}

// --- Onglet caché pour fallback ---
let hiddenTabId = null;
let hiddenTabOrigin = null;

async function requestTokenViaHiddenTab(torrentId, origin, nonce) {
    try {
        // Réutiliser l'onglet caché s'il existe et correspond à l'origin
        if (hiddenTabId !== null) {
            try {
                const tab = await chrome.tabs.get(hiddenTabId);
                if (tab && tab.url && tab.url.startsWith(origin)) {
                    // Onglet existe et bon domaine, envoyer directement
                    return await sendTokenRequestToTab(hiddenTabId, torrentId, origin, nonce);
                }
                // Mauvais domaine, fermer et recréer
                await chrome.tabs.remove(hiddenTabId);
            } catch (e) {
                // Onglet n'existe plus
            }
            hiddenTabId = null;
            hiddenTabOrigin = null;
        }

        // Créer un nouvel onglet caché
        console.log(`[Pipeline] Création onglet caché pour ${origin}`);
        const tab = await chrome.tabs.create({
            url: origin,
            active: false,
            pinned: false
        });
        hiddenTabId = tab.id;
        hiddenTabOrigin = origin;

        // Attendre que le content script soit prêt
        await waitForContentScriptReady(tab.id, 15000);

        return await sendTokenRequestToTab(tab.id, torrentId, origin, nonce);

    } catch (e) {
        console.error(`[Pipeline] Erreur requestTokenViaHiddenTab:`, e);
        handleTokenError(torrentId, e.message, null, null);
        // Nettoyer l'onglet caché en cas d'erreur
        await cleanupHiddenTab();
        return false;
    }
}

async function sendTokenRequestToTab(tabId, torrentId, origin, nonce) {
    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            console.log(`[Pipeline] Timeout REQUEST_TOKEN pour onglet caché ${tabId}`);
            handleTokenError(torrentId, 'Timeout demande de token (onglet caché)', null, null);
            resolve(false);
        }, 15000);

        chrome.tabs.sendMessage(tabId, {
            action: 'REQUEST_TOKEN',
            torrentId: torrentId,
            nonce: nonce
        }, (response) => {
            clearTimeout(timeout);
            if (chrome.runtime.lastError) {
                console.log(`[Pipeline] Erreur sendMessage (caché): ${chrome.runtime.lastError.message}`);
                handleTokenError(torrentId, chrome.runtime.lastError.message, null, null);
                resolve(false);
                return;
            }
            if (response && response.success) {
                handleTokenReceived(torrentId, response.token, nonce);
                resolve(true);
            } else if (response && response.error) {
                handleTokenError(torrentId, response.error, response.httpStatus, response.responseBody);
                resolve(true);
            } else {
                handleTokenError(torrentId, 'Réponse invalide du content script', null, null);
                resolve(false);
            }
        });
    });
}

function waitForContentScriptReady(tabId, timeoutMs) {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();

        function ping() {
            if (Date.now() - startTime > timeoutMs) {
                reject(new Error('Timeout en attente du content script'));
                return;
            }

            chrome.tabs.sendMessage(tabId, { action: 'PING' }, (response) => {
                if (chrome.runtime.lastError || !response || !response.pong) {
                    setTimeout(ping, 500);
                } else {
                    resolve();
                }
            });
        }

        // Attendre un peu pour la page de charger
        setTimeout(ping, 1000);
    });
}

async function cleanupHiddenTab() {
    if (hiddenTabId !== null) {
        try {
            await chrome.tabs.remove(hiddenTabId);
        } catch (e) {
            // Déjà fermé
        }
        hiddenTabId = null;
        hiddenTabOrigin = null;
    }
}

// ============================================================
// TOKEN HANDLING
// ============================================================

async function handleTokenReceived(torrentId, token, nonce) {
    const result = await chrome.storage.local.get([STORAGE_KEY, PIPELINE_STATE_KEY]);
    const timers = result[STORAGE_KEY] || {};
    const pipelineState = result[PIPELINE_STATE_KEY] || {};
    const timer = timers[torrentId];

    if (!timer) return;

    // Ignorer les réponses tardives d'une requête précédente
    if (nonce && timer.requestNonce && nonce !== timer.requestNonce) {
        console.log(`[Pipeline] Nonce périmé pour ${torrentId} (reçu=${nonce}, attendu=${timer.requestNonce}), ignoré`);
        return;
    }

    const now = Date.now();
    timer.status = 'counting';
    timer.statusSince = now;
    timer.token = token;
    timer.tokenIssuedAt = now;
    timer.countdownEndsAt = now + TIMER_DURATION;
    timer.lastError = null;
    timer.errorType = null;

    // Reset rate-limit et échecs consécutifs sur succès
    pipelineState.rateLimitCount = 0;
    pipelineState.rateLimitUntil = null;
    pipelineState.consecutiveFailures = 0;

    await chrome.storage.local.set({
        [STORAGE_KEY]: timers,
        [PIPELINE_STATE_KEY]: pipelineState
    });

    // Alarme pour la fin du countdown
    chrome.alarms.create(ALARM_COUNTDOWN_PREFIX + torrentId, {
        when: timer.countdownEndsAt
    });

    // Stats temps perdu
    addWastedTime(30);

    console.log(`[Pipeline] Token reçu pour ${torrentId}, countdown jusqu'à ${new Date(timer.countdownEndsAt).toLocaleTimeString()}`);
}

async function handleTokenError(torrentId, errorMessage, httpStatus, responseBody) {
    const result = await chrome.storage.local.get([STORAGE_KEY, PIPELINE_STATE_KEY]);
    const timers = result[STORAGE_KEY] || {};
    const pipelineState = result[PIPELINE_STATE_KEY] || {};
    const timer = timers[torrentId];

    if (!timer) return;

    const now = Date.now();

    // === Étape 1: Classification explicite (signaux clairs) ===
    let errorType = 'unknown';

    // Signal clair: HTTP 429
    if (httpStatus === 429) {
        errorType = 'rate_limit';
    }
    // Signal clair: HTTP 403 ou redirection vers login
    else if (httpStatus === 403 || (errorMessage && errorMessage.includes('login'))) {
        errorType = 'auth';
    }
    // Signal clair: HTTP 404
    else if (httpStatus === 404) {
        errorType = 'not_found';
    }
    // Signal clair: réponse HTML au lieu de JSON (probable captcha, page d'erreur, redirect)
    else if (errorMessage && errorMessage.includes('Réponse HTML')) {
        errorType = 'rate_limit';
    }
    // Pattern connu YggTorrent
    else if (responseBody && (responseBody.includes("wasn't available") || responseBody.includes("pas disponible"))) {
        errorType = 'rate_limit';
    }
    // Token manquant dans une réponse JSON valide (le serveur a répondu mais sans token)
    else if (errorMessage && errorMessage.includes('Token manquant')) {
        errorType = 'rate_limit';
    }

    // === Étape 2: Compteur d'échecs consécutifs (filet de sécurité) ===
    // Si on ne reconnaît pas l'erreur, on compte les échecs consécutifs.
    // Après 2 échecs consécutifs de n'importe quel type, on traite comme rate-limit.
    // Cela couvre tous les cas imprévus: format de réponse changé, nouveau type d'erreur, etc.
    pipelineState.consecutiveFailures = (pipelineState.consecutiveFailures || 0) + 1;
    pipelineState.lastFailureAt = now;

    if (errorType === 'unknown') {
        if (pipelineState.consecutiveFailures >= 2) {
            console.log(`[Pipeline] ${pipelineState.consecutiveFailures} échecs consécutifs — escalade en rate-limit`);
            errorType = 'rate_limit';
        } else {
            errorType = 'network';
        }
    }

    console.log(`[Pipeline] Erreur token pour ${torrentId}: ${errorType} — "${errorMessage}" (échecs consécutifs: ${pipelineState.consecutiveFailures})`);

    // === Étape 3: Appliquer la politique d'erreur ===

    if (errorType === 'rate_limit') {
        // Rate-limit global — tout le pipeline s'arrête
        pipelineState.rateLimitCount = (pipelineState.rateLimitCount || 0) + 1;
        const backoff = calculateRetryDelay(pipelineState.rateLimitCount);
        pipelineState.rateLimitUntil = now + backoff;

        // L'item reste queued pour retry après le backoff
        timer.status = 'queued';
        timer.statusSince = now;
        timer.tokenRequestedAt = null;
        timer.lastError = errorMessage;
        timer.errorType = errorType;

        console.log(`[Pipeline] Rate-limit #${pipelineState.rateLimitCount}, backoff ${Math.round(backoff / 1000)}s`);
        scheduleProcessQueue(pipelineState.rateLimitUntil);

    } else if (errorType === 'not_found') {
        // Supprimer de la queue
        timer.status = 'error';
        timer.statusSince = now;
        timer.lastError = errorMessage;
        timer.errorType = errorType;

        const queueResult = await chrome.storage.local.get([QUEUE_KEY]);
        const queue = (queueResult[QUEUE_KEY] || []).filter(id => id !== torrentId);
        await chrome.storage.local.set({ [QUEUE_KEY]: queue });

        console.log(`[Pipeline] Torrent ${torrentId} introuvable, retiré de la queue`);

    } else if (errorType === 'auth') {
        // Erreur auth — marquer erreur, ne pas retry automatiquement
        timer.status = 'error';
        timer.statusSince = now;
        timer.lastError = errorMessage;
        timer.errorType = errorType;

    } else {
        // Erreur réseau — retry avec backoff par item
        timer.retryCount = (timer.retryCount || 0) + 1;

        if (timer.retryCount > MAX_RETRIES) {
            timer.status = 'error';
            timer.statusSince = now;
            timer.lastError = errorMessage;
            timer.errorType = errorType;
            console.log(`[Pipeline] Timer ${torrentId} max retries atteint`);
        } else {
            const delay = calculateRetryDelay(timer.retryCount);
            timer.status = 'error';
            timer.statusSince = now;
            timer.lastError = errorMessage;
            timer.errorType = errorType;
            timer.nextRetryAt = now + delay;
            console.log(`[Pipeline] Timer ${torrentId} retry #${timer.retryCount} dans ${Math.round(delay / 1000)}s`);
            scheduleProcessQueue(timer.nextRetryAt);
        }
    }

    await chrome.storage.local.set({
        [STORAGE_KEY]: timers,
        [PIPELINE_STATE_KEY]: pipelineState
    });

    // Relancer le pipeline pour le prochain item (sauf si rate-limit)
    if (errorType !== 'rate_limit') {
        scheduleProcessQueue(Date.now() + 1000);
    }
}

// ============================================================
// COUNTDOWN + DOWNLOAD
// ============================================================

async function handleCountdownComplete(torrentId) {
    const result = await chrome.storage.local.get([STORAGE_KEY]);
    const timers = result[STORAGE_KEY] || {};
    const timer = timers[torrentId];

    if (!timer || timer.status !== 'counting') return;

    await triggerDownload(torrentId, timer);
}

async function triggerDownload(torrentId, timer) {
    const downloadUrl = `${timer.origin}/engine/download_torrent?id=${torrentId}&token=${timer.token}`;
    const filename = (timer.name || 'Torrent').endsWith('.torrent')
        ? (timer.name || 'Torrent')
        : (timer.name || 'Torrent') + '.torrent';

    console.log(`[Pipeline] Lancement téléchargement: ${filename}`);

    timer.status = 'downloading';
    timer.statusSince = Date.now();

    try {
        const downloadId = await new Promise((resolve, reject) => {
            chrome.downloads.download({
                url: downloadUrl,
                filename: filename,
                conflictAction: 'uniquify'
            }, (id) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    resolve(id);
                }
            });
        });

        timer.downloadId = downloadId;
        console.log(`[Pipeline] Téléchargement lancé: ID ${downloadId}`);

    } catch (e) {
        console.error(`[Pipeline] Erreur téléchargement:`, e);
        timer.status = 'error';
        timer.statusSince = Date.now();
        timer.lastError = e.message;
        timer.errorType = 'network';
    }

    const result = await chrome.storage.local.get([STORAGE_KEY]);
    const timers = result[STORAGE_KEY] || {};
    timers[torrentId] = timer;
    await chrome.storage.local.set({ [STORAGE_KEY]: timers });

    if (timer.status === 'error') {
        // Erreur immédiate au lancement — relancer le pipeline pour le prochain item
        scheduleProcessQueue(Date.now() + 1000);
    } else if (timer.status === 'downloading') {
        // Watchdog: si onChanged est raté, processQueue détectera le stale
        scheduleProcessQueue(Date.now() + STALE_DOWNLOADING_TIMEOUT + 1000);
    }
}

// --- Suivi des téléchargements ---
chrome.downloads.onChanged.addListener(async (delta) => {
    if (!delta.state) return;

    const result = await chrome.storage.local.get([STORAGE_KEY, QUEUE_KEY, PIPELINE_STATE_KEY]);
    const timers = result[STORAGE_KEY] || {};
    const queue = result[QUEUE_KEY] || [];
    const pipelineState = result[PIPELINE_STATE_KEY] || {};

    // Trouver le timer correspondant à ce downloadId
    const torrentId = Object.keys(timers).find(id =>
        timers[id].downloadId === delta.id
    );

    if (!torrentId) return;

    const timer = timers[torrentId];
    const now = Date.now();

    if (delta.state.current === 'complete') {
        console.log(`[Pipeline] Téléchargement terminé: ${timer.name}`);
        timer.status = 'done';
        timer.statusSince = now;
        timer.completedAt = now;

        // Retirer de la queue
        const newQueue = queue.filter(id => id !== torrentId);

        // Cooldown avant le prochain
        pipelineState.nextProcessAt = now + COOLDOWN_BETWEEN_DOWNLOADS;

        await chrome.storage.local.set({
            [STORAGE_KEY]: timers,
            [QUEUE_KEY]: newQueue,
            [PIPELINE_STATE_KEY]: pipelineState
        });

        // Planifier le prochain traitement
        scheduleProcessQueue(pipelineState.nextProcessAt);

        // Fermer l'onglet caché si plus rien à traiter sur ce domaine
        const remainingForOrigin = newQueue.some(id =>
            timers[id] && timers[id].origin === timer.origin && timers[id].status === 'queued'
        );
        if (!remainingForOrigin) {
            await cleanupHiddenTab();
        }

    } else if (delta.state.current === 'interrupted') {
        const errorMsg = delta.error ? delta.error.current : 'Téléchargement interrompu';
        console.log(`[Pipeline] Téléchargement échoué: ${errorMsg}`);
        timer.status = 'error';
        timer.statusSince = now;
        timer.lastError = errorMsg;
        timer.errorType = 'network';
        timer.retryCount = (timer.retryCount || 0) + 1;

        if (timer.retryCount <= MAX_RETRIES) {
            timer.nextRetryAt = now + calculateRetryDelay(timer.retryCount);
            scheduleProcessQueue(timer.nextRetryAt);
        }

        await chrome.storage.local.set({ [STORAGE_KEY]: timers });
    }
});

// ============================================================
// ENQUEUE + MESSAGE HANDLING
// ============================================================

async function handleEnqueue(torrentId, name, origin, sendResponse) {
    const result = await chrome.storage.local.get([QUEUE_KEY, STORAGE_KEY]);
    const queue = result[QUEUE_KEY] || [];
    const timers = result[STORAGE_KEY] || {};
    const now = Date.now();

    // Déduplication : si déjà en queue ou in-flight, rafraîchir les infos
    if (timers[torrentId]) {
        const existing = timers[torrentId];

        // Si terminé ou erreur permanente, permettre le re-téléchargement
        if (existing.status === 'done' || (existing.status === 'error' && !existing.nextRetryAt)) {
            console.log(`[Pipeline] Re-enqueue: ${torrentId} (était ${existing.status})`);
            // Reset complet
            timers[torrentId] = {
                status: 'queued',
                name: name || existing.name,
                origin: origin || existing.origin,
                enqueuedAt: now,
                statusSince: now,
                tokenRequestedAt: null,
                tokenIssuedAt: null,
                token: null,
                countdownEndsAt: null,
                retryCount: 0,
                nextRetryAt: null,
                lastError: null,
                errorType: null,
                downloadId: null,
                completedAt: null,
                requestNonce: null
            };
            if (!queue.includes(torrentId)) {
                queue.push(torrentId);
            }
            await chrome.storage.local.set({
                [QUEUE_KEY]: queue,
                [STORAGE_KEY]: timers
            });
            sendResponse({ status: 'queued', position: queue.indexOf(torrentId) + 1, countdownEndsAt: null });
            processQueue();
            return;
        }

        // Sinon, juste rafraîchir les infos
        existing.name = name || existing.name;
        existing.origin = origin || existing.origin;

        await chrome.storage.local.set({ [STORAGE_KEY]: timers });

        sendResponse({
            status: existing.status,
            position: queue.indexOf(torrentId) + 1,
            countdownEndsAt: existing.countdownEndsAt
        });
        return;
    }

    // Nouveau timer
    timers[torrentId] = {
        status: 'queued',
        name: name || `Torrent #${torrentId}`,
        origin: origin,
        enqueuedAt: now,
        statusSince: now,
        tokenRequestedAt: null,
        tokenIssuedAt: null,
        token: null,
        countdownEndsAt: null,
        retryCount: 0,
        nextRetryAt: null,
        lastError: null,
        errorType: null,
        downloadId: null,
        completedAt: null,
        requestNonce: null
    };

    // Ajouter à la queue (à la fin)
    if (!queue.includes(torrentId)) {
        queue.push(torrentId);
    }

    await chrome.storage.local.set({
        [QUEUE_KEY]: queue,
        [STORAGE_KEY]: timers
    });

    console.log(`[Pipeline] Enqueue: ${torrentId} ("${name}") — position ${queue.length}`);

    sendResponse({
        status: 'queued',
        position: queue.length,
        countdownEndsAt: null
    });

    // Lancer le pipeline
    processQueue();
}

// --- Gestionnaire de messages ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

    if (request.action === 'ENQUEUE') {
        handleEnqueue(request.torrentId, request.name, request.origin, sendResponse);
        return true; // Async
    }

    else if (request.action === 'TOKEN_RESULT') {
        // Réponse asynchrone d'un content script suite à REQUEST_TOKEN
        if (request.success) {
            handleTokenReceived(request.torrentId, request.token, request.nonce);
        } else {
            handleTokenError(request.torrentId, request.error, request.httpStatus, request.responseBody);
        }
    }

    // --- Actions héritées de v1.3.1 ---

    else if (request.action === 'ADD_WASTED_TIME') {
        addWastedTime(30);
    }

    else if (request.action === 'RETRY_TIMER') {
        retryTimer(request.torrentId);
    }

    else if (request.action === 'REMOVE_TIMER') {
        removeTimer(request.torrentId);
    }

    // --- Configuration domaine personnalisé ---

    else if (request.action === 'SAVE_CUSTOM_DOMAIN') {
        const domain = request.domain;
        chrome.storage.local.set({ [DOMAIN_KEY]: domain }, async () => {
            await registerCustomDomainScripts();
            sendResponse({ success: true });
        });
        return true;
    }

    else if (request.action === 'GET_DOMAIN_CONFIG') {
        chrome.storage.local.get([DOMAIN_KEY], (result) => {
            sendResponse({ domain: result[DOMAIN_KEY] || '' });
        });
        return true;
    }

    else if (request.action === 'REMOVE_CUSTOM_DOMAIN') {
        chrome.storage.local.remove(DOMAIN_KEY, async () => {
            try {
                await chrome.scripting.unregisterContentScripts({ ids: ['ygg-custom-domain'] });
            } catch (e) {}
            sendResponse({ success: true });
        });
        return true;
    }
});

// ============================================================
// RETRY / REMOVE
// ============================================================

async function retryTimer(torrentId) {
    const result = await chrome.storage.local.get([STORAGE_KEY, QUEUE_KEY]);
    const timers = result[STORAGE_KEY] || {};
    const queue = result[QUEUE_KEY] || [];
    const timer = timers[torrentId];

    if (!timer) return;

    const now = Date.now();
    timer.status = 'queued';
    timer.statusSince = now;
    timer.retryCount = 0;
    timer.nextRetryAt = null;
    timer.lastError = null;
    timer.errorType = null;
    timer.token = null;
    timer.countdownEndsAt = null;
    timer.downloadId = null;

    // S'assurer qu'il est dans la queue
    if (!queue.includes(torrentId)) {
        queue.unshift(torrentId); // Priorité: au début
    }

    await chrome.storage.local.set({
        [STORAGE_KEY]: timers,
        [QUEUE_KEY]: queue
    });

    console.log(`[Pipeline] Retry manuel pour ${torrentId}`);
    processQueue();
}

async function removeTimer(torrentId) {
    const result = await chrome.storage.local.get([STORAGE_KEY, QUEUE_KEY]);
    const timers = result[STORAGE_KEY] || {};
    const queue = result[QUEUE_KEY] || [];

    delete timers[torrentId];
    const newQueue = queue.filter(id => id !== torrentId);

    // Supprimer l'alarme countdown si elle existe
    try {
        await chrome.alarms.clear(ALARM_COUNTDOWN_PREFIX + torrentId);
    } catch (e) {}

    await chrome.storage.local.set({
        [STORAGE_KEY]: timers,
        [QUEUE_KEY]: newQueue
    });

    console.log(`[Pipeline] Timer ${torrentId} supprimé`);

    // Relancer si d'autres items attendent
    if (newQueue.length > 0) {
        processQueue();
    }
}

// ============================================================
// RECOVERY (Service Worker restart)
// ============================================================

async function recoverPipeline() {
    console.log('[Pipeline] Récupération du pipeline...');

    const result = await chrome.storage.local.get([QUEUE_KEY, STORAGE_KEY, PIPELINE_LOCK_KEY]);
    const queue = result[QUEUE_KEY] || [];
    const timers = result[STORAGE_KEY] || {};
    const now = Date.now();
    let changed = false;

    // Nettoyer le lock expiré
    const lock = result[PIPELINE_LOCK_KEY];
    if (lock && lock.lockUntil <= now) {
        await chrome.storage.local.remove(PIPELINE_LOCK_KEY);
    }

    // Réévaluer les timers en vol
    for (const id of queue) {
        const timer = timers[id];
        if (!timer) continue;

        if (timer.status === 'requesting') {
            // Reset: on ne sait pas si la requête était en cours
            timer.status = 'queued';
            timer.statusSince = now;
            timer.tokenRequestedAt = null;
            changed = true;
            console.log(`[Pipeline] Recovery: ${id} requesting → queued`);
        }

        if (timer.status === 'counting' && timer.countdownEndsAt) {
            if (timer.countdownEndsAt <= now) {
                // Countdown déjà terminé, lancer le download
                console.log(`[Pipeline] Recovery: ${id} countdown expiré, téléchargement`);
                // On ne peut pas appeler triggerDownload ici directement car c'est async
                // On le laisse pour processQueue
                changed = true;
            } else {
                // Recréer l'alarme
                chrome.alarms.create(ALARM_COUNTDOWN_PREFIX + id, {
                    when: timer.countdownEndsAt
                });
                console.log(`[Pipeline] Recovery: alarme recréée pour ${id}`);
            }
        }
    }

    if (changed) {
        await chrome.storage.local.set({ [STORAGE_KEY]: timers });
    }

    // Relancer le pipeline
    if (queue.length > 0) {
        scheduleProcessQueue(Date.now() + 500);
    }
}

// ============================================================
// UTILITAIRES
// ============================================================

function addWastedTime(seconds) {
    chrome.storage.local.get([STATS_KEY], (result) => {
        const currentTotal = result[STATS_KEY] || 0;
        const newTotal = currentTotal + seconds;
        chrome.storage.local.set({ [STATS_KEY]: newTotal });
        console.log(`[Stats] Temps perdu total : ${newTotal}s`);
    });
}

function cleanupCompletedTimers() {
    chrome.storage.local.get([STORAGE_KEY, QUEUE_KEY], (result) => {
        const timers = result[STORAGE_KEY] || {};
        const queue = result[QUEUE_KEY] || [];
        const now = Date.now();
        let changed = false;

        for (const [id, timer] of Object.entries(timers)) {
            // Supprimer les timers terminés depuis plus d'1h
            if (timer.status === 'done' && timer.completedAt && (now - timer.completedAt > CLEANUP_INTERVAL)) {
                delete timers[id];
                changed = true;
            }
            // Supprimer les erreurs permanentes depuis plus d'1h
            if (timer.status === 'error' && !timer.nextRetryAt && timer.statusSince && (now - timer.statusSince > CLEANUP_INTERVAL)) {
                delete timers[id];
                changed = true;
            }
        }

        if (changed) {
            // Nettoyer la queue aussi
            const cleanQueue = queue.filter(id => timers[id]);
            chrome.storage.local.set({
                [STORAGE_KEY]: timers,
                [QUEUE_KEY]: cleanQueue
            });
        }
    });
}

// --- Vérification des mises à jour ---
async function checkForUpdates() {
    try {
        const response = await fetch(GITHUB_MANIFEST_URL);
        if (!response.ok) return;

        const remoteManifest = await response.json();
        const localManifest = chrome.runtime.getManifest();

        if (isNewerVersion(localManifest.version, remoteManifest.version)) {
            console.log(`[Update] Nouvelle version disponible: ${remoteManifest.version}`);
            chrome.storage.local.set({
                'ygg_update_available': {
                    version: remoteManifest.version,
                    url: GITHUB_RELEASES_URL
                }
            });
            chrome.action.setBadgeText({ text: "NEW" });
            chrome.action.setBadgeBackgroundColor({ color: "#e74c3c" });
        } else {
            chrome.storage.local.remove('ygg_update_available');
            chrome.action.setBadgeText({ text: "" });
        }
    } catch (e) {
        console.error("[Update] Erreur lors de la vérification:", e);
    }
}

function isNewerVersion(local, remote) {
    const v1 = local.split('.').map(Number);
    const v2 = remote.split('.').map(Number);
    for (let i = 0; i < Math.max(v1.length, v2.length); i++) {
        const n1 = v1[i] || 0;
        const n2 = v2[i] || 0;
        if (n2 > n1) return true;
        if (n2 < n1) return false;
    }
    return false;
}

// --- Enregistrement dynamique de content scripts pour domaines personnalisés ---
async function registerCustomDomainScripts() {
    try {
        const result = await chrome.storage.local.get([DOMAIN_KEY]);
        const domain = result[DOMAIN_KEY];
        if (!domain) return;

        try {
            await chrome.scripting.unregisterContentScripts({ ids: ['ygg-custom-domain'] });
        } catch (e) {}

        await chrome.scripting.registerContentScripts([{
            id: 'ygg-custom-domain',
            matches: [`*://*.${domain}/*`, `*://${domain}/*`],
            js: ['content.js'],
            css: ['content.css'],
            runAt: 'document_idle',
            persistAcrossSessions: true
        }]);

        console.log(`[Domain] Content scripts enregistrés pour: ${domain}`);
    } catch (e) {
        console.error("[Domain] Erreur enregistrement:", e);
    }
}
