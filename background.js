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
const DISMISSED_KEY = 'ygg_dismissed';

// --- Helpers de statut ---

/**
 * Vérifie si un statut est terminal (ne peut plus changer).
 * @param {string} status - Le statut à vérifier
 * @returns {boolean} true si le statut est 'done', 'cancelled', ou 'error'
 */
function isTerminal(status) {
    return status === 'done' || status === 'cancelled' || (status === 'error');
}

/**
 * Vérifie si un statut est actif (en cours de traitement).
 * @param {string} status - Le statut à vérifier
 * @returns {boolean} true si le statut est 'queued', 'requesting', 'counting', ou 'downloading'
 */
function isActive(status) {
    return status === 'queued' || status === 'requesting' || status === 'counting' || status === 'downloading';
}

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

// --- Notification IDs ---
const NOTIF_PIPELINE_COMPLETE = 'ygg-pipeline-complete';
const NOTIF_ERROR_PREFIX = 'ygg-error-';

// ============================================================
// BADGE & NOTIFICATIONS
// ============================================================

/**
 * Met à jour le badge de l'extension avec le nombre d'items dans le pipeline.
 * Compte: items en queue + items en erreur avec retry programmé
 * Si pipeline vide mais update dispo, affiche "NEW"
 */
async function updateBadge() {
    const result = await chrome.storage.local.get([QUEUE_KEY, STORAGE_KEY, 'ygg_update_available']);
    const queue = result[QUEUE_KEY] || [];
    const timers = result[STORAGE_KEY] || {};
    const updateAvailable = result['ygg_update_available'];

    let count = 0;

    // Items dans la queue
    count += queue.length;

    // Items en erreur avec retry programmé (pas encore remis dans la queue)
    for (const [torrentId, timer] of Object.entries(timers)) {
        if (timer.status === 'error' && timer.nextRetryAt && !queue.includes(torrentId)) {
            count++;
        }
    }

    if (count > 0) {
        // Priorité au compteur de pipeline
        await chrome.action.setBadgeText({ text: String(count) });
        await chrome.action.setBadgeBackgroundColor({ color: '#3b82f6' }); // Bleu
    } else if (updateAvailable) {
        // Pas de pipeline, mais update dispo
        await chrome.action.setBadgeText({ text: 'NEW' });
        await chrome.action.setBadgeBackgroundColor({ color: '#e74c3c' }); // Rouge
    } else {
        // Rien à afficher
        await chrome.action.setBadgeText({ text: '' });
    }
}

/**
 * Affiche une notification quand tous les téléchargements sont terminés.
 * @param {number} successCount - Nombre de téléchargements réussis
 */
async function showPipelineCompleteNotification(successCount) {
    if (successCount === 0) return;

    const options = {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: '✅ Téléchargements terminés',
        message: `${successCount} torrent${successCount > 1 ? 's' : ''} téléchargé${successCount > 1 ? 's' : ''} avec succès`,
        buttons: [{ title: 'Ouvrir le dossier' }],
        requireInteraction: false
    };

    try {
        await chrome.notifications.create(NOTIF_PIPELINE_COMPLETE, options);
    } catch (e) {
        console.log('[Notifications] Erreur création notification:', e);
    }
}

/**
 * Affiche une notification pour une erreur terminale.
 * @param {string} torrentId - ID du torrent en erreur
 * @param {string} name - Nom du torrent
 * @param {string} errorMessage - Message d'erreur
 */
async function showErrorNotification(torrentId, name, errorMessage) {
    const options = {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: '⚠️ Erreur de téléchargement',
        message: `${name}\n${errorMessage}`,
        buttons: [{ title: 'Réessayer' }],
        requireInteraction: false
    };

    try {
        await chrome.notifications.create(NOTIF_ERROR_PREFIX + torrentId, options);
    } catch (e) {
        console.log('[Notifications] Erreur création notification:', e);
    }
}

/**
 * Vérifie si une erreur est terminale (pas de retry automatique).
 * @param {object} timer - Le timer à vérifier
 * @returns {boolean} true si l'erreur est terminale
 */
function isTerminalError(timer) {
    // Max retries dépassé
    if (timer.retryCount > MAX_RETRIES) return true;
    // Erreur d'authentification
    if (timer.errorType === 'auth') return true;
    // Torrent non trouvé
    if (timer.errorType === 'not_found') return true;
    return false;
}

// --- Gestionnaire de clics sur notifications ---
chrome.notifications.onButtonClicked.addListener(async (notificationId, buttonIndex) => {
    if (notificationId === NOTIF_PIPELINE_COMPLETE && buttonIndex === 0) {
        // "Ouvrir le dossier" → afficher les téléchargements Chrome
        try {
            await chrome.downloads.showDefaultFolder();
        } catch (e) {
            console.log('[Notifications] Impossible d\'ouvrir le dossier:', e);
        }
        chrome.notifications.clear(notificationId);
    } else if (notificationId.startsWith(NOTIF_ERROR_PREFIX) && buttonIndex === 0) {
        // "Réessayer" → re-enqueue le torrent
        const torrentId = notificationId.slice(NOTIF_ERROR_PREFIX.length);
        const result = await chrome.storage.local.get([QUEUE_KEY, STORAGE_KEY]);
        const queue = result[QUEUE_KEY] || [];
        const timers = result[STORAGE_KEY] || {};

        if (timers[torrentId]) {
            const timer = timers[torrentId];
            timer.status = 'queued';
            timer.statusSince = Date.now();
            timer.retryCount = 0;
            timer.nextRetryAt = null;
            timer.lastError = null;
            timer.errorType = null;
            timer.token = null;
            timer.countdownEndsAt = null;
            timer.downloadId = null;
            timer.requestNonce = null;

            if (!queue.includes(torrentId)) {
                queue.unshift(torrentId); // Priorité au retry manuel
            }

            await chrome.storage.local.set({
                [QUEUE_KEY]: queue,
                [STORAGE_KEY]: timers
            });

            await updateBadge();
            processQueue();
        }
        chrome.notifications.clear(notificationId);
    }
});

chrome.notifications.onClicked.addListener((notificationId) => {
    // Clic sur la notification → fermer
    chrome.notifications.clear(notificationId);
});

// --- Initialisation ---
chrome.runtime.onStartup.addListener(() => {
    console.log('[Pipeline] Service Worker démarré (onStartup)');
    checkForUpdates();
    registerCustomDomainScripts();
    recoverPipeline();
    updateBadge();
});

chrome.runtime.onInstalled.addListener(() => {
    console.log('[Pipeline] Extension installée/mise à jour (onInstalled)');

    // Nettoyer les notifications de mise à jour obsolètes (ex: changement de version)
    chrome.storage.local.remove('ygg_update_available');
    chrome.action.setBadgeText({ text: "" });

    checkForUpdates();
    registerCustomDomainScripts();
    recoverPipeline();
    updateBadge();

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

/**
 * Acquiert un verrou lease-based pour le pipeline.
 * Le verrou expire automatiquement après LOCK_TTL ms.
 * @returns {Promise<string|null>} L'ID du propriétaire du lock, ou null si déjà verrouillé
 */
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

/**
 * Relâche le verrou du pipeline si on en est le propriétaire.
 * @param {string} owner - L'ID du propriétaire du lock
 * @returns {Promise<void>}
 */
async function releaseLock(owner) {
    const result = await chrome.storage.local.get([PIPELINE_LOCK_KEY]);
    const lock = result[PIPELINE_LOCK_KEY];

    // Ne relâcher que si c'est notre lock
    if (lock && lock.lockOwner === owner) {
        await chrome.storage.local.remove(PIPELINE_LOCK_KEY);
    }
}

/**
 * Processeur idempotent de la file d'attente.
 * Gère les états stale, rate-limiting, et déclenche les étapes suivantes.
 * Utilise un verrou lease-based pour éviter les race conditions.
 * @returns {Promise<void>}
 */
async function processQueue() {
    let lockOwner = await acquireLock();
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
            await scheduleProcessQueue(pipelineState.rateLimitUntil);
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

        // Nettoyer les items terminaux qui seraient restés en queue
        const cleanedQueue = queue.filter(id => {
            const t = timers[id];
            return t && !isTerminal(t.status);
        });
        if (cleanedQueue.length !== queue.length) {
            console.log(`[Pipeline] Nettoyage queue: ${queue.length} → ${cleanedQueue.length} items`);
            await chrome.storage.local.set({ [QUEUE_KEY]: cleanedQueue });
            // Continuer avec la queue nettoyée
            queue.length = 0;
            cleanedQueue.forEach(id => queue.push(id));
        }

        // Chercher un timer en cours (requesting, counting, downloading)
        const inFlightId = queue.find(id => {
            const t = timers[id];
            return t && isActive(t.status) && t.status !== 'queued';
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
            await scheduleProcessQueue(pipelineState.nextProcessAt);
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
        await scheduleProcessQueue(now + STALE_REQUESTING_TIMEOUT + 1000);

        console.log(`[Pipeline] Demande de token pour ${nextId} ("${timer.name}") nonce=${timer.requestNonce}`);

        // Libérer le lock AVANT la requête de token (peut durer 30s+ avec onglet caché)
        // Le statut 'requesting' empêche processQueue de lancer un autre token
        await releaseLock(lockOwner);
        lockOwner = null;

        await requestToken(nextId, timer);

    } finally {
        if (lockOwner) {
            await releaseLock(lockOwner);
        }
    }
}

/**
 * Planifie l'exécution de processQueue à un moment donné.
 * Ne repousse pas une alarme déjà planifiée plus tôt.
 * @param {number} when - Timestamp Unix en ms pour l'exécution
 * @returns {Promise<void>}
 */
async function scheduleProcessQueue(when) {
    const target = Math.max(when, Date.now() + 1000);
    // Ne jamais repousser une alarme déjà planifiée plus tôt
    const existing = await chrome.alarms.get(ALARM_PROCESS_QUEUE);
    if (existing && existing.scheduledTime <= target) {
        return; // Alarme existante plus proche, on garde
    }
    chrome.alarms.create(ALARM_PROCESS_QUEUE, { when: target });
}

/**
 * Calcule le délai avant retry avec backoff exponentiel et jitter.
 * @param {number} retryCount - Nombre de tentatives déjà effectuées
 * @returns {number} Délai en ms avant le prochain retry
 */
function calculateRetryDelay(retryCount) {
    const delay = BASE_RETRY_DELAY * Math.pow(2, retryCount - 1);
    // Ajouter du jitter (±20%)
    const jitter = delay * 0.2 * (Math.random() * 2 - 1);
    return Math.min(delay + jitter, MAX_RETRY_DELAY);
}

// ============================================================
// TOKEN ACQUISITION
// ============================================================

/**
 * Demande un token de téléchargement pour un torrent.
 * Essaie d'abord via un onglet ouvert, puis via un onglet caché en fallback.
 * @param {string} torrentId - L'ID du torrent
 * @param {Object} timer - L'objet timer contenant origin et requestNonce
 * @returns {Promise<void>}
 */
async function requestToken(torrentId, timer) {
    const nonce = timer.requestNonce;

    // Essayer via un onglet ouvert d'abord
    const success = await requestTokenViaTab(torrentId, timer.origin, nonce);
    if (success) return;

    // Fallback: onglet caché
    console.log(`[Pipeline] Aucun onglet ouvert pour ${timer.origin}, fallback onglet caché`);
    await requestTokenViaHiddenTab(torrentId, timer.origin, nonce);
}

/**
 * Demande un token via un onglet YggTorrent existant.
 * @param {string} torrentId - L'ID du torrent
 * @param {string} origin - L'origine du domaine YggTorrent
 * @param {string} nonce - Identifiant unique pour cette requête
 * @returns {Promise<boolean>} true si la requête a été envoyée, false sinon
 */
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
                if (tab && tab.url && new URL(tab.url).origin === origin) {
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
        await scheduleProcessQueue(pipelineState.rateLimitUntil);

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
            await scheduleProcessQueue(timer.nextRetryAt);
        }
    }

    await chrome.storage.local.set({
        [STORAGE_KEY]: timers,
        [PIPELINE_STATE_KEY]: pipelineState
    });

    // Mettre à jour le badge et notifier si erreur terminale
    await updateBadge();
    if (isTerminalError(timer)) {
        await showErrorNotification(torrentId, timer.name, timer.lastError);
    }

    // Relancer le pipeline pour le prochain item (sauf si rate-limit)
    if (errorType !== 'rate_limit') {
        await scheduleProcessQueue(Date.now() + 1000);
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
    // Relire depuis le storage pour éviter les doublons
    // (processQueue + alarme countdown peuvent appeler cette fonction en parallèle)
    const freshResult = await chrome.storage.local.get([STORAGE_KEY]);
    const freshTimers = freshResult[STORAGE_KEY] || {};
    const freshTimer = freshTimers[torrentId];

    if (!freshTimer || freshTimer.status === 'downloading' || freshTimer.status === 'done') {
        console.log(`[Pipeline] triggerDownload ignoré pour ${torrentId} (status=${freshTimer?.status})`);
        return;
    }

    // Utiliser les données fraîches
    timer = freshTimer;

    // Annuler l'alarme countdown (éviter un second déclenchement)
    try { await chrome.alarms.clear(ALARM_COUNTDOWN_PREFIX + torrentId); } catch (e) {}

    const downloadUrl = `${timer.origin}/engine/download_torrent?id=${encodeURIComponent(torrentId)}&token=${encodeURIComponent(timer.token)}`;
    const rawName = (timer.name || 'Torrent')
        .replace(/[\x00-\x1f<>:"/\\|?*]/g, '_') // control chars + filesystem-unsafe
        .replace(/[.\s]+$/, '')                    // trailing dots/spaces (Windows)
        .slice(0, 150)                             // bound length
        .trim() || 'Torrent';
    const filename = rawName.endsWith('.torrent') ? rawName : rawName + '.torrent';

    console.log(`[Pipeline] Lancement téléchargement: ${filename}`);

    timer.status = 'downloading';
    timer.statusSince = Date.now();

    // Écrire le statut AVANT le download pour bloquer les appels concurrents
    freshTimers[torrentId] = timer;
    await chrome.storage.local.set({ [STORAGE_KEY]: freshTimers });

    try {
        const downloadId = await new Promise((resolve, reject) => {
            chrome.downloads.download({
                url: downloadUrl,
                filename: filename,
                saveAs: false,
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
        await scheduleProcessQueue(Date.now() + 1000);
    } else if (timer.status === 'downloading') {
        // Watchdog: si onChanged est raté, processQueue détectera le stale
        await scheduleProcessQueue(Date.now() + STALE_DOWNLOADING_TIMEOUT + 1000);
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
        // Vérifier que c'est bien un .torrent et pas une page HTML (token expiré/invalide)
        try {
            const [downloadItem] = await chrome.downloads.search({ id: delta.id });
            if (downloadItem && downloadItem.mime && downloadItem.mime.includes('text/html')) {
                console.log(`[Pipeline] Téléchargement HTML détecté pour ${timer.name} — token invalide`);
                timer.status = 'error';
                timer.statusSince = now;
                timer.lastError = 'Le serveur a retourné une page HTML au lieu du fichier torrent';
                timer.errorType = 'rate_limit';
                timer.retryCount = (timer.retryCount || 0) + 1;
                if (timer.retryCount <= MAX_RETRIES) {
                    timer.nextRetryAt = now + calculateRetryDelay(timer.retryCount);
                    await scheduleProcessQueue(timer.nextRetryAt);
                }
                // Supprimer le fichier .htm téléchargé
                try { chrome.downloads.removeFile(delta.id); } catch (e) {}
                await chrome.storage.local.set({ [STORAGE_KEY]: timers });
                return;
            }
        } catch (e) {
            console.log(`[Pipeline] Impossible de vérifier le MIME du téléchargement:`, e);
        }

        console.log(`[Pipeline] Téléchargement terminé: ${timer.name}`);
        timer.status = 'done';
        timer.statusSince = now;
        timer.completedAt = now;
        timer.justCompleted = true;

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
        await scheduleProcessQueue(pipelineState.nextProcessAt);

        // Fermer l'onglet caché si plus rien à traiter sur ce domaine
        const remainingForOrigin = newQueue.some(id =>
            timers[id] && timers[id].origin === timer.origin && timers[id].status === 'queued'
        );
        if (!remainingForOrigin) {
            await cleanupHiddenTab();
        }

        // Mettre à jour le badge et notifier si pipeline terminé
        await updateBadge();
        if (newQueue.length === 0) {
            // Compter uniquement les téléchargements terminés depuis la dernière notification
            const lastNotified = pipelineState.lastPipelineNotifiedAt || 0;
            const successCount = Object.values(timers).filter(t =>
                t.status === 'done' && t.completedAt && t.completedAt > lastNotified
            ).length;
            if (successCount > 0) {
                pipelineState.lastPipelineNotifiedAt = now;
                await chrome.storage.local.set({ [PIPELINE_STATE_KEY]: pipelineState });
                await showPipelineCompleteNotification(successCount);
            }
        }

    } else if (delta.state.current === 'interrupted') {
        const errorReason = delta.error ? delta.error.current : '';

        // Annulation délibérée par l'utilisateur
        if (errorReason === 'USER_CANCELED') {
            console.log(`[Pipeline] Téléchargement annulé par l'utilisateur: ${timer.name}`);
            timer.status = 'cancelled';
            timer.statusSince = now;
            timer.lastError = 'Annulé par l\'utilisateur';
            // Pas de nextRetryAt, pas de retry automatique

            const newQueue = queue.filter(id => id !== torrentId);

            await chrome.storage.local.set({
                [STORAGE_KEY]: timers,
                [QUEUE_KEY]: newQueue
            });

            // Relancer le pipeline pour les items restants
            if (newQueue.length > 0) {
                await scheduleProcessQueue(now + COOLDOWN_BETWEEN_DOWNLOADS);
            }

            // Fermer l'onglet caché si plus rien pour ce domaine
            const remainingForOrigin = newQueue.some(id =>
                timers[id] && timers[id].origin === timer.origin && isActive(timers[id].status)
            );
            if (!remainingForOrigin) {
                await cleanupHiddenTab();
            }

            // Mettre à jour le badge
            await updateBadge();
            return;
        }

        // Autres interruptions (réseau, etc.) → retry avec backoff
        const errorMsg = errorReason || 'Téléchargement interrompu';
        console.log(`[Pipeline] Téléchargement échoué: ${errorMsg}`);
        timer.status = 'error';
        timer.statusSince = now;
        timer.lastError = errorMsg;
        timer.errorType = 'network';
        timer.retryCount = (timer.retryCount || 0) + 1;

        if (timer.retryCount <= MAX_RETRIES) {
            timer.nextRetryAt = now + calculateRetryDelay(timer.retryCount);
            await scheduleProcessQueue(timer.nextRetryAt);
        }

        await chrome.storage.local.set({ [STORAGE_KEY]: timers });

        // Mettre à jour le badge et notifier si erreur terminale
        await updateBadge();
        if (isTerminalError(timer)) {
            await showErrorNotification(torrentId, timer.name, timer.lastError);
        }
    }
});

// ============================================================
// ENQUEUE + MESSAGE HANDLING
// ============================================================

async function handleEnqueue(torrentId, name, origin, sendResponse) {
    const result = await chrome.storage.local.get([QUEUE_KEY, STORAGE_KEY, DISMISSED_KEY]);
    const queue = result[QUEUE_KEY] || [];
    const timers = result[STORAGE_KEY] || {};
    const dismissed = result[DISMISSED_KEY] || {};
    const now = Date.now();

    // Vérifie si l'utilisateur a explicitement retiré ce torrent
    if (dismissed[torrentId]) {
        console.log(`[Pipeline] Enqueue ignoré: ${torrentId} a été retiré par l'utilisateur`);
        sendResponse({ status: 'dismissed' });
        return;
    }

    // Déduplication : si déjà connu
    if (timers[torrentId]) {
        const existing = timers[torrentId];

        // Terminé → ne pas re-enqueue, montrer l'état
        if (existing.status === 'done') {
            console.log(`[Pipeline] Torrent ${torrentId} déjà téléchargé`);
            existing.name = name || existing.name;
            existing.origin = origin || existing.origin;
            await chrome.storage.local.set({ [STORAGE_KEY]: timers });
            sendResponse({ status: 'done', completedAt: existing.completedAt });
            return;
        }

        // Annulé par l'utilisateur → ne pas re-enqueue
        if (existing.status === 'cancelled') {
            console.log(`[Pipeline] Torrent ${torrentId} annulé par l'utilisateur`);
            existing.name = name || existing.name;
            existing.origin = origin || existing.origin;
            await chrome.storage.local.set({ [STORAGE_KEY]: timers });
            sendResponse({ status: 'cancelled' });
            return;
        }

        // Erreur permanente (pas de retry auto) → permettre le re-téléchargement
        if (existing.status === 'error' && !existing.nextRetryAt) {
            console.log(`[Pipeline] Re-enqueue: ${torrentId} (était erreur permanente)`);
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
            await updateBadge();
            sendResponse({ status: 'queued', position: queue.indexOf(torrentId) + 1, countdownEndsAt: null });
            processQueue();
            return;
        }

        // In-flight ou en attente de retry → juste rafraîchir les infos
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

    if (!queue.includes(torrentId)) {
        queue.push(torrentId);
    }

    await chrome.storage.local.set({
        [QUEUE_KEY]: queue,
        [STORAGE_KEY]: timers
    });

    await updateBadge();

    console.log(`[Pipeline] Enqueue: ${torrentId} ("${name}") — position ${queue.length}`);

    sendResponse({
        status: 'queued',
        position: queue.length,
        countdownEndsAt: null
    });

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
    const result = await chrome.storage.local.get([STORAGE_KEY, QUEUE_KEY, DISMISSED_KEY]);
    const timers = result[STORAGE_KEY] || {};
    const queue = result[QUEUE_KEY] || [];
    const dismissed = result[DISMISSED_KEY] || {};
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

    // Retirer de la dismissed list si présent
    delete dismissed[torrentId];

    await chrome.storage.local.set({
        [STORAGE_KEY]: timers,
        [QUEUE_KEY]: queue,
        [DISMISSED_KEY]: dismissed
    });

    await updateBadge();

    console.log(`[Pipeline] Retry manuel pour ${torrentId}`);
    processQueue();
}

async function removeTimer(torrentId) {
    const result = await chrome.storage.local.get([STORAGE_KEY, QUEUE_KEY, DISMISSED_KEY]);
    const timers = result[STORAGE_KEY] || {};
    const queue = result[QUEUE_KEY] || [];
    const dismissed = result[DISMISSED_KEY] || {};

    const removedTimer = timers[torrentId];
    delete timers[torrentId];
    const newQueue = queue.filter(id => id !== torrentId);

    // Se souvenir que l'utilisateur a retiré ce torrent (map avec timestamp)
    dismissed[torrentId] = Date.now();

    // Supprimer l'alarme countdown si elle existe
    try {
        await chrome.alarms.clear(ALARM_COUNTDOWN_PREFIX + torrentId);
    } catch (e) {}

    await chrome.storage.local.set({
        [STORAGE_KEY]: timers,
        [QUEUE_KEY]: newQueue,
        [DISMISSED_KEY]: dismissed
    });

    console.log(`[Pipeline] Timer ${torrentId} supprimé et ajouté aux dismissals`);

    // Fermer l'onglet caché si plus rien pour ce domaine
    if (removedTimer && removedTimer.origin) {
        const remainingForOrigin = newQueue.some(id =>
            timers[id] && timers[id].origin === removedTimer.origin && isActive(timers[id].status)
        );
        if (!remainingForOrigin && hiddenTabOrigin === removedTimer.origin) {
            await cleanupHiddenTab();
        }
    }

    await updateBadge();

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
        await scheduleProcessQueue(Date.now() + 500);
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
        console.log(`[Stats] Temps gagné total : ${newTotal}s`);
    });
}

function cleanupCompletedTimers() {
    chrome.storage.local.get([STORAGE_KEY, QUEUE_KEY, DISMISSED_KEY], (result) => {
        const timers = result[STORAGE_KEY] || {};
        const queue = result[QUEUE_KEY] || [];
        const dismissed = result[DISMISSED_KEY] || {};
        const now = Date.now();
        let changed = false;

        for (const [id, timer] of Object.entries(timers)) {
            const age = now - (timer.completedAt || timer.statusSince || 0);
            // Supprimer les items terminaux depuis plus d'1h
            if (isTerminal(timer.status) && !timer.nextRetryAt && age > CLEANUP_INTERVAL) {
                delete timers[id];
                changed = true;
            }
        }

        // Nettoyer la dismissed list (entrées de plus de 7 jours)
        const DISMISSED_TTL = 7 * 24 * 60 * 60 * 1000;
        let dismissedChanged = false;
        for (const [id, dismissedAt] of Object.entries(dismissed)) {
            if (now - dismissedAt > DISMISSED_TTL) {
                delete dismissed[id];
                dismissedChanged = true;
            }
        }

        if (changed || dismissedChanged) {
            const cleanQueue = queue.filter(id => timers[id]);
            const updates = { [STORAGE_KEY]: timers, [QUEUE_KEY]: cleanQueue };
            if (dismissedChanged) updates[DISMISSED_KEY] = dismissed;
            chrome.storage.local.set(updates);
            updateBadge();
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
            // Ne pas écraser le badge du pipeline - updateBadge() gère la priorité
            await updateBadge();
        } else {
            chrome.storage.local.remove('ygg_update_available');
            await updateBadge();
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
