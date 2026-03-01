// background.js
// Service Worker pour YggTorrent Helper
// Gestion du verrouillage global (1 seul timer actif), stats, et domaines dynamiques

const STORAGE_KEY = 'ygg_timers';
const STATS_KEY = 'ygg_stats_wasted';
const DOMAIN_KEY = 'ygg_custom_domain';
const CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 heure

// --- CONFIGURATION UPDATE ---
const GITHUB_REPO = "RicherTunes/ygg-helper-dl";
const GITHUB_MANIFEST_URL = `https://raw.githubusercontent.com/${GITHUB_REPO}/refs/heads/main/manifest.json`;
const GITHUB_RELEASES_URL = `https://github.com/${GITHUB_REPO}/releases`;
const UPDATE_CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24 heures

// État global : Un seul timer peut être actif à la fois
let isTimerRunning = false;

// Au démarrage
chrome.runtime.onStartup.addListener(() => {
    checkForUpdates();
    registerCustomDomainScripts();
});

// À l'installation
chrome.runtime.onInstalled.addListener(() => {
    checkForUpdates();
    registerCustomDomainScripts();
});

// Check régulier
setInterval(checkForUpdates, UPDATE_CHECK_INTERVAL);

async function checkForUpdates() {
    try {
        const response = await fetch(GITHUB_MANIFEST_URL);
        if (!response.ok) return;

        const remoteManifest = await response.json();
        const localManifest = chrome.runtime.getManifest();

        if (isNewerVersion(localManifest.version, remoteManifest.version)) {
            console.log(`[Update] Nouvelle version disponible: ${remoteManifest.version}`);

            // Stocker l'info de mise à jour
            chrome.storage.local.set({
                'ygg_update_available': {
                    version: remoteManifest.version,
                    url: GITHUB_RELEASES_URL
                }
            });

            // Badge sur l'icône
            chrome.action.setBadgeText({ text: "NEW" });
            chrome.action.setBadgeBackgroundColor({ color: "#e74c3c" });
        } else {
            // Nettoyage si à jour
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

        // Retirer l'ancien enregistrement s'il existe
        try {
            await chrome.scripting.unregisterContentScripts({ ids: ['ygg-custom-domain'] });
        } catch (e) {
            // Pas d'enregistrement précédent, OK
        }

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

// Gestion des messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

    // Demande si on peut démarrer un timer
    if (request.action === "CAN_I_START") {
        sendResponse({ canStart: !isTimerRunning });
        return true; // Asynchrone
    }

    // Un onglet signale qu'il démarre un timer
    else if (request.action === "TIMER_STARTED") {
        isTimerRunning = true;
        console.log(`[Lock] Timer verrouillé par Tab ${sender.tab ? sender.tab.id : 'unknown'}`);
    }

    // Enregistrement d'un timer en attente (Pending)
    else if (request.action === "REGISTER_PENDING") {
        const timerId = request.torrentId;
        chrome.storage.local.get([STORAGE_KEY], (result) => {
            const timers = result[STORAGE_KEY] || {};
            // On ne met à jour que si pas déjà existant ou différent
            if (!timers[timerId] || timers[timerId].status !== 'pending') {
                timers[timerId] = {
                    status: 'pending',
                    name: request.name,
                    tabId: sender.tab.id,
                    addedAt: Date.now()
                };
                chrome.storage.local.set({ [STORAGE_KEY]: timers });
                console.log(`[Pending] Torrent ${timerId} mis en attente (Tab ${sender.tab.id})`);
            }
        });
    }

    // Force le démarrage d'un timer (depuis Popup)
    else if (request.action === "FORCE_START") {
        const targetTabId = request.tabId;
        if (targetTabId) {
            chrome.tabs.sendMessage(targetTabId, { action: "TRIGGER_START" });
        }
    }

    // Un onglet signale qu'il a fini ou annulé (libère le verrou)
    else if (request.action === "TIMER_FINISHED" || request.action === "TIMER_CANCELLED") {
        isTimerRunning = false;
        console.log(`[Lock] Timer libéré.`);
    }

    // Ajout du temps perdu (Statistique fun)
    else if (request.action === "ADD_WASTED_TIME") {
        addWastedTime(30); // Ajoute 30 secondes
    }

    // Gestion du téléchargement (Proxy)
    else if (request.action === "SCHEDULE_DOWNLOAD") {
        chrome.downloads.download({
            url: request.url,
            filename: request.filename,
            conflictAction: 'uniquify'
        }, (downloadId) => {
            if (chrome.runtime.lastError) {
                console.error("Erreur téléchargement:", chrome.runtime.lastError);
            } else {
                console.log(`Téléchargement lancé: ${downloadId}`);
                isTimerRunning = false;
            }
        });
    }

    // Configuration du domaine personnalisé
    else if (request.action === "SAVE_CUSTOM_DOMAIN") {
        const domain = request.domain;
        chrome.storage.local.set({ [DOMAIN_KEY]: domain }, async () => {
            await registerCustomDomainScripts();
            sendResponse({ success: true });
        });
        return true; // Asynchrone
    }

    else if (request.action === "GET_DOMAIN_CONFIG") {
        chrome.storage.local.get([DOMAIN_KEY], (result) => {
            sendResponse({ domain: result[DOMAIN_KEY] || '' });
        });
        return true; // Asynchrone
    }

    else if (request.action === "REMOVE_CUSTOM_DOMAIN") {
        chrome.storage.local.remove(DOMAIN_KEY, async () => {
            try {
                await chrome.scripting.unregisterContentScripts({ ids: ['ygg-custom-domain'] });
            } catch (e) {}
            sendResponse({ success: true });
        });
        return true;
    }
});

// --- Gestion des Statistiques (Temps Perdu) ---
function addWastedTime(seconds) {
    chrome.storage.local.get([STATS_KEY], (result) => {
        const currentTotal = result[STATS_KEY] || 0;
        const newTotal = currentTotal + seconds;
        chrome.storage.local.set({ [STATS_KEY]: newTotal });
        console.log(`[Stats] Temps perdu total : ${newTotal}s`);
    });
}

// --- Nettoyage périodique du stockage ---
function cleanupStorage() {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
        const timers = result[STORAGE_KEY];
        if (!timers) return;

        const now = Date.now();
        let changed = false;

        for (const [id, data] of Object.entries(timers)) {
            // Nettoyer les vieux timers (> 1h)
            const timestamp = data.startTime || data.addedAt || 0;
            if (now - timestamp > CLEANUP_INTERVAL) {
                delete timers[id];
                changed = true;
            }
        }

        if (changed) {
            chrome.storage.local.set({ [STORAGE_KEY]: timers });
        }
    });
}

setInterval(cleanupStorage, CLEANUP_INTERVAL);
