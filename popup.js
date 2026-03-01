// popup.js - Dashboard du pipeline v1.3.2

const STORAGE_KEY = 'ygg_timers';
const QUEUE_KEY = 'ygg_queue';
const STATS_KEY = 'ygg_stats_wasted';
const TIMER_DURATION = 30; // secondes

document.addEventListener('DOMContentLoaded', () => {
    updatePipeline();
    updateStats();
    checkUpdateStatus();
    initDomainSettings();

    // Version depuis le manifest
    const manifest = chrome.runtime.getManifest();
    const versionEl = document.getElementById('appVersion');
    if (versionEl) {
        versionEl.innerText = `v${manifest.version}`;
    }

    // Écouter les changements de storage au lieu de poller
    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace !== 'local') return;
        if (changes[STORAGE_KEY] || changes[QUEUE_KEY]) {
            updatePipeline();
        }
        if (changes[STATS_KEY]) {
            updateStats();
        }
    });

    // Fallback: refresh toutes les 2s pour les countdowns
    setInterval(() => {
        updateCountdowns();
    }, 1000);

    // Credits
    document.getElementById('creditsLink').addEventListener('click', () => {
        chrome.tabs.create({ url: 'https://github.com/RicherTunes' });
    });

    // Tout nettoyer
    document.getElementById('cleanAllBtn').addEventListener('click', () => {
        chrome.storage.local.remove([STORAGE_KEY, QUEUE_KEY], () => {
            updatePipeline();
        });
    });

    // Lien de mise à jour
    const updateLink = document.getElementById('updateLink');
    if (updateLink) {
        updateLink.addEventListener('click', (e) => {
            e.preventDefault();
            chrome.storage.local.get(['ygg_update_available'], (result) => {
                if (result.ygg_update_available && result.ygg_update_available.url) {
                    chrome.tabs.create({ url: result.ygg_update_available.url });
                }
            });
        });
    }
});

// --- Pipeline Dashboard ---

function updatePipeline() {
    chrome.storage.local.get([STORAGE_KEY, QUEUE_KEY], (result) => {
        const timers = result[STORAGE_KEY] || {};
        const queue = result[QUEUE_KEY] || [];

        const pipelineList = document.getElementById('pipelineList');
        const pipelineCount = document.getElementById('pipelineCount');
        const completedTitle = document.getElementById('completedSectionTitle');
        const completedList = document.getElementById('completedList');
        const completedCount = document.getElementById('completedCount');

        // Séparer les items actifs et terminés
        const activeItems = [];
        const completedItems = [];

        // Items dans la queue (ordre préservé)
        queue.forEach((id, index) => {
            const timer = timers[id];
            if (!timer) return;
            activeItems.push({ id, ...timer, position: index + 1 });
        });

        // Items done ou error permanent (hors queue)
        for (const [id, timer] of Object.entries(timers)) {
            if (!queue.includes(id)) {
                if (timer.status === 'done') {
                    completedItems.push({ id, ...timer });
                } else if (timer.status === 'error' && !timer.nextRetryAt) {
                    activeItems.push({ id, ...timer, position: -1 });
                }
            }
        }

        // Trier les terminés par date (plus récent en premier)
        completedItems.sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));

        pipelineCount.innerText = activeItems.length;

        // Rendu des actifs
        if (activeItems.length === 0 && completedItems.length === 0) {
            pipelineList.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">📂</div>
                    <p>Aucun téléchargement en cours</p>
                    <span class="empty-sub">Visitez une page de torrent pour commencer</span>
                </div>`;
        } else {
            renderPipelineCards(activeItems, pipelineList);
        }

        // Rendu des terminés
        if (completedItems.length > 0) {
            completedTitle.style.display = 'flex';
            completedCount.innerText = completedItems.length;
            renderCompletedCards(completedItems, completedList);
        } else {
            completedTitle.style.display = 'none';
            completedList.innerHTML = '';
        }
    });
}

function renderPipelineCards(items, container) {
    // Conserver les cartes existantes pour éviter le scintillement
    const existingIds = new Set();

    items.forEach(item => {
        existingIds.add(item.id);
        let card = document.getElementById(`timer-${item.id}`);

        if (!card) {
            card = createPipelineCard(item);
            container.appendChild(card);
        }

        updatePipelineCard(card, item);
    });

    // Supprimer les cartes orphelines
    container.querySelectorAll('.timer-card').forEach(card => {
        const id = card.id.replace('timer-', '');
        if (!existingIds.has(id)) {
            card.remove();
        }
    });
}

function createPipelineCard(item) {
    const card = document.createElement('div');
    card.id = `timer-${item.id}`;
    card.className = `timer-card status-${item.status}`;

    const header = document.createElement('div');
    header.className = 'timer-header';

    const nameEl = document.createElement('div');
    nameEl.className = 'timer-name';
    nameEl.textContent = item.name || 'Torrent #' + item.id;
    nameEl.title = item.name || '';

    const badge = document.createElement('span');
    badge.className = `phase-badge ${item.status}`;
    badge.textContent = getStatusLabel(item.status);

    header.appendChild(nameEl);
    header.appendChild(badge);

    const progressContainer = document.createElement('div');
    progressContainer.className = 'timer-progress-container';
    const progressBar = document.createElement('div');
    progressBar.className = 'timer-progress-bar';
    progressBar.style.width = '0%';
    progressContainer.appendChild(progressBar);

    const footer = document.createElement('div');
    footer.className = 'timer-footer';
    const statusEl = document.createElement('span');
    statusEl.className = 'timer-status';
    const actionGroup = document.createElement('div');
    actionGroup.className = 'action-group';
    footer.appendChild(statusEl);
    footer.appendChild(actionGroup);

    const errorDiv = document.createElement('div');
    errorDiv.className = 'timer-error';
    errorDiv.style.display = 'none';

    card.appendChild(header);
    card.appendChild(progressContainer);
    card.appendChild(footer);
    card.appendChild(errorDiv);

    return card;
}

function updatePipelineCard(card, item) {
    const now = Date.now();

    // Mettre à jour la classe de statut
    card.className = `timer-card status-${item.status}`;

    // Badge
    const badge = card.querySelector('.phase-badge');
    badge.className = `phase-badge ${item.status}`;
    badge.innerText = getStatusLabel(item.status);

    // Barre de progression
    const progressBar = card.querySelector('.timer-progress-bar');
    const statusText = card.querySelector('.timer-status');
    const actionGroup = card.querySelector('.action-group');
    const errorDiv = card.querySelector('.timer-error');

    errorDiv.style.display = 'none';

    switch (item.status) {
        case 'queued':
            progressBar.style.width = '0%';
            if (item.errorType === 'rate_limit') {
                statusText.innerText = 'Rate-limit, retry automatique...';
                statusText.style.color = '#f59e0b';
            } else {
                statusText.innerText = item.position > 0 ? `Position #${item.position} dans la file` : 'En attente';
                statusText.style.color = '#8b5cf6';
            }
            setActionButtons(actionGroup, item.id, ['remove']);
            break;

        case 'requesting':
            progressBar.style.width = '10%';
            progressBar.style.background = 'linear-gradient(90deg, #f59e0b, #d97706)';
            statusText.innerText = 'Demande du token...';
            statusText.style.color = '#f59e0b';
            actionGroup.innerHTML = '';
            break;

        case 'counting': {
            const endsAt = item.countdownEndsAt || (now + 30000);
            card.dataset.countdownEndsAt = endsAt; // Stocker pour le refresh local
            const elapsed = Math.max(0, TIMER_DURATION - (endsAt - now) / 1000);
            const progress = Math.min(100, (elapsed / TIMER_DURATION) * 100);
            const remaining = Math.max(0, Math.ceil((endsAt - now) / 1000));

            progressBar.style.width = `${progress}%`;
            progressBar.style.background = 'linear-gradient(90deg, #8b5cf6, #3b82f6)';
            statusText.innerText = remaining > 0 ? `Countdown: ${remaining}s` : 'Prêt !';
            statusText.style.color = remaining > 0 ? '#3b82f6' : '#10b981';
            actionGroup.innerHTML = '';
            break;
        }

        case 'downloading':
            progressBar.style.width = '100%';
            progressBar.style.background = 'linear-gradient(90deg, #10b981, #059669)';
            statusText.innerText = 'Téléchargement en cours...';
            statusText.style.color = '#10b981';
            actionGroup.innerHTML = '';
            break;

        case 'error':
            progressBar.style.width = '100%';
            progressBar.style.background = '#ef4444';
            statusText.innerText = getErrorLabel(item.errorType);
            statusText.style.color = '#ef4444';

            if (item.lastError) {
                errorDiv.style.display = 'block';
                errorDiv.textContent = item.lastError;
            }

            setActionButtons(actionGroup, item.id, ['retry', 'remove']);

            if (item.nextRetryAt && item.nextRetryAt > now) {
                const retryIn = Math.ceil((item.nextRetryAt - now) / 1000);
                statusText.innerText += ` (retry dans ${retryIn}s)`;
            }
            break;

        default:
            progressBar.style.width = '0%';
            statusText.innerText = item.status;
    }
}

function renderCompletedCards(items, container) {
    container.innerHTML = '';

    items.forEach(item => {
        const card = document.createElement('div');
        card.className = 'timer-card status-done';

        const header = document.createElement('div');
        header.className = 'timer-header';
        const nameEl = document.createElement('div');
        nameEl.className = 'timer-name';
        nameEl.textContent = item.name || 'Torrent #' + item.id;
        nameEl.title = item.name || '';
        const badge = document.createElement('span');
        badge.className = 'phase-badge done';
        badge.textContent = 'Terminé';
        header.appendChild(nameEl);
        header.appendChild(badge);

        const footer = document.createElement('div');
        footer.className = 'timer-footer';
        const statusEl = document.createElement('span');
        statusEl.className = 'timer-status';
        statusEl.style.color = '#6b7280';
        statusEl.textContent = formatTimeAgo(item.completedAt);
        const actionGroup = document.createElement('div');
        actionGroup.className = 'action-group';
        const removeBtn = document.createElement('button');
        removeBtn.className = 'action-btn remove';
        removeBtn.textContent = 'Retirer';
        removeBtn.onclick = () => {
            chrome.runtime.sendMessage({ action: 'REMOVE_TIMER', torrentId: item.id });
        };
        actionGroup.appendChild(removeBtn);
        footer.appendChild(statusEl);
        footer.appendChild(actionGroup);

        card.appendChild(header);
        card.appendChild(footer);
        container.appendChild(card);
    });
}

// --- Countdown refresh (pour les cartes "counting") ---
// Utilise le dataset DOM pour éviter de lire le storage à chaque seconde
function updateCountdowns() {
    const now = Date.now();
    document.querySelectorAll('.timer-card.status-counting').forEach(card => {
        const endsAt = Number(card.dataset.countdownEndsAt);
        if (!endsAt) return;

        const remaining = Math.max(0, Math.ceil((endsAt - now) / 1000));
        const elapsed = TIMER_DURATION - remaining;
        const progress = Math.min(100, (elapsed / TIMER_DURATION) * 100);

        const progressBar = card.querySelector('.timer-progress-bar');
        const statusText = card.querySelector('.timer-status');

        if (progressBar) progressBar.style.width = `${progress}%`;
        if (statusText) {
            statusText.innerText = remaining > 0 ? `Countdown: ${remaining}s` : 'Prêt !';
            statusText.style.color = remaining > 0 ? '#3b82f6' : '#10b981';
        }
    });
}

// --- Action Buttons (DOM-safe, pas de innerHTML avec données utilisateur) ---

function setActionButtons(container, torrentId, actions) {
    container.innerHTML = '';

    if (actions.includes('retry')) {
        const retryBtn = document.createElement('button');
        retryBtn.className = 'action-btn retry';
        retryBtn.textContent = 'Réessayer';
        retryBtn.onclick = () => {
            chrome.runtime.sendMessage({ action: 'RETRY_TIMER', torrentId: torrentId });
        };
        container.appendChild(retryBtn);
    }

    if (actions.includes('remove')) {
        const removeBtn = document.createElement('button');
        removeBtn.className = 'action-btn remove';
        removeBtn.textContent = 'Retirer';
        removeBtn.onclick = () => {
            chrome.runtime.sendMessage({ action: 'REMOVE_TIMER', torrentId: torrentId });
        };
        container.appendChild(removeBtn);
    }
}

// --- Helpers ---

function getStatusLabel(status) {
    const labels = {
        queued: 'File d\'attente',
        requesting: 'Token...',
        counting: 'Countdown',
        downloading: 'Téléchargement',
        done: 'Terminé',
        error: 'Erreur'
    };
    return labels[status] || status;
}

function getErrorLabel(errorType) {
    const labels = {
        rate_limit: 'Rate-limit',
        auth: 'Authentification requise',
        not_found: 'Torrent introuvable',
        network: 'Erreur réseau'
    };
    return labels[errorType] || 'Erreur';
}

function formatTimeAgo(timestamp) {
    if (!timestamp) return '';
    const diff = Math.floor((Date.now() - timestamp) / 1000);
    if (diff < 60) return `Il y a ${diff}s`;
    if (diff < 3600) return `Il y a ${Math.floor(diff / 60)}min`;
    return `Il y a ${Math.floor(diff / 3600)}h`;
}

function formatTime(totalSeconds) {
    if (totalSeconds < 60) return `${totalSeconds}s`;
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
    return `${minutes}m ${seconds}s`;
}

// --- Stats ---
function updateStats() {
    chrome.storage.local.get([STATS_KEY], (result) => {
        const totalSeconds = result[STATS_KEY] || 0;
        const statsEl = document.getElementById('wastedTimeDisplay');
        if (statsEl) {
            statsEl.innerText = formatTime(totalSeconds);
        }
    });
}

// --- Update Check ---
function checkUpdateStatus() {
    chrome.storage.local.get(['ygg_update_available'], (result) => {
        const updateInfo = result.ygg_update_available;
        const banner = document.getElementById('updateBanner');
        const versionSpan = document.getElementById('newVersion');

        if (updateInfo && banner && versionSpan) {
            versionSpan.innerText = updateInfo.version;
            banner.style.display = 'flex';
        } else if (banner) {
            banner.style.display = 'none';
        }
    });
}

// --- Domain Settings ---
function initDomainSettings() {
    const toggle = document.getElementById('settingsToggle');
    const body = document.getElementById('settingsBody');
    const arrow = document.getElementById('settingsArrow');
    const input = document.getElementById('domainInput');
    const saveBtn = document.getElementById('saveDomainBtn');
    const removeBtn = document.getElementById('removeDomainBtn');
    const status = document.getElementById('domainStatus');

    chrome.runtime.sendMessage({ action: "GET_DOMAIN_CONFIG" }, (response) => {
        if (response && response.domain) {
            input.value = response.domain;
            removeBtn.style.display = 'block';
            status.innerText = `Domaine actif: ${response.domain}`;
            status.className = 'domain-status success';
        }
    });

    toggle.addEventListener('click', () => {
        const isOpen = body.style.display !== 'none';
        body.style.display = isOpen ? 'none' : 'block';
        arrow.classList.toggle('open', !isOpen);
    });

    saveBtn.addEventListener('click', async () => {
        let domain = input.value.trim().toLowerCase();
        if (!domain) {
            status.innerText = "Veuillez entrer un domaine.";
            status.className = 'domain-status error';
            return;
        }

        domain = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
        input.value = domain;

        status.innerText = "Demande de permission...";
        status.className = 'domain-status';

        try {
            const granted = await chrome.permissions.request({
                origins: [`*://*.${domain}/*`, `*://${domain}/*`]
            });

            if (!granted) {
                status.innerText = "Permission refusée par le navigateur.";
                status.className = 'domain-status error';
                return;
            }

            chrome.runtime.sendMessage({ action: "SAVE_CUSTOM_DOMAIN", domain: domain }, (response) => {
                if (response && response.success) {
                    status.innerText = `Domaine enregistré ! Rechargez les pages YggTorrent.`;
                    status.className = 'domain-status success';
                    removeBtn.style.display = 'block';
                } else {
                    status.innerText = "Erreur lors de l'enregistrement.";
                    status.className = 'domain-status error';
                }
            });
        } catch (e) {
            status.innerText = `Erreur: ${e.message}`;
            status.className = 'domain-status error';
        }
    });

    removeBtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: "REMOVE_CUSTOM_DOMAIN" }, (response) => {
            if (response && response.success) {
                input.value = '';
                status.innerText = "Domaine personnalisé supprimé.";
                status.className = 'domain-status';
                removeBtn.style.display = 'none';
            }
        });
    });
}
