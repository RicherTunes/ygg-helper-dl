// content.js
// YggTorrent Helper v1.3.2 — Thin Sensor + Token Service
// Détecte les torrents, enqueue au pipeline, affiche l'état

const YggTimerManager = {
    storageKey: 'ygg_timers',
    queueKey: 'ygg_queue',
    ui: null,
    torrentId: null,
    countdownInterval: null,

    init: async function() {
        this.torrentId = this.getTorrentId();

        if (this.torrentId) {
            console.log(`[YggHelper] Torrent ID trouvé: ${this.torrentId}`);
            this.setupUI();
            this.enqueue();
            this.listenForMessages();
            this.listenForStorageChanges();
        } else {
            console.log("[YggHelper] Aucun ID de torrent trouvé sur cette page.");
            // Écouter quand même PING et REQUEST_TOKEN pour les onglets cachés
            this.listenForMessages();
        }
    },

    // --- Détection du torrent ---
    getTorrentId: function() {
        const downloadBtn = document.getElementById('download-timer-btn');
        if (downloadBtn && downloadBtn.dataset.torrentId) return downloadBtn.dataset.torrentId;

        const reportInput = document.querySelector('form#report-torrent input[name="target"]');
        if (reportInput && reportInput.value) return reportInput.value;

        const match = window.location.href.match(/\/(\d+)-/);
        if (match && match[1]) return match[1];

        return null;
    },

    getTorrentName: function() {
        const reportName = document.querySelector('form#report-torrent strong');
        if (reportName) return reportName.innerText.trim();

        const h1 = document.querySelector('div.panel-heading h1');
        if (h1) return h1.innerText.trim();

        return "Torrent";
    },

    // --- Enqueue au pipeline ---
    enqueue: function() {
        const name = this.getTorrentName();
        const origin = window.location.origin;

        chrome.runtime.sendMessage({
            action: 'ENQUEUE',
            torrentId: this.torrentId,
            name: name,
            origin: origin
        }, (response) => {
            if (chrome.runtime.lastError) {
                console.error('[YggHelper] Erreur enqueue:', chrome.runtime.lastError.message);
                this.updateUIForStatus('error', { lastError: 'Impossible de contacter le service worker' });
                return;
            }

            if (response) {
                console.log(`[YggHelper] Enqueue réponse: status=${response.status}, position=${response.position}`);
                this.updateUIForStatus(response.status, {
                    position: response.position,
                    countdownEndsAt: response.countdownEndsAt
                });
            }
        });
    },

    // --- Écoute des messages du background ---
    listenForMessages: function() {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            // Ping pour vérifier que le content script est prêt
            if (request.action === 'PING') {
                sendResponse({ pong: true });
                return;
            }

            // Demande de token du pipeline
            if (request.action === 'REQUEST_TOKEN') {
                this.fetchToken(request.torrentId).then(result => {
                    sendResponse(result);
                }).catch(err => {
                    sendResponse({ success: false, error: err.message });
                });
                return true; // Async
            }
        });
    },

    // --- Écoute des changements de storage ---
    listenForStorageChanges: function() {
        chrome.storage.onChanged.addListener((changes, namespace) => {
            if (namespace !== 'local') return;
            if (!this.torrentId) return;

            // Recalculer sur changement de timers OU de queue (pour la position)
            if (changes[this.storageKey] || changes[this.queueKey]) {
                chrome.storage.local.get([this.storageKey, this.queueKey], (result) => {
                    const timers = result[this.storageKey] || {};
                    const queue = result[this.queueKey] || [];
                    const timer = timers[this.torrentId];

                    if (timer) {
                        // Enrichir avec la position dans la queue
                        const position = queue.indexOf(this.torrentId) + 1;
                        this.updateUIForStatus(timer.status, { ...timer, position });
                    }
                });
            }
        });
    },

    // --- Token fetch (service pour le pipeline) ---
    fetchToken: async function(torrentId) {
        try {
            console.log(`[YggHelper] Fetch token pour ${torrentId}...`);

            const response = await fetch('/engine/start_download_timer', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    'X-Requested-With': 'XMLHttpRequest'
                },
                body: `torrent_id=${torrentId}`
            });

            // Détecter les redirections vers la page de login
            if (response.redirected && response.url && response.url.includes('login')) {
                return {
                    success: false,
                    error: 'Redirection vers la page de connexion',
                    httpStatus: 403
                };
            }

            // Vérifier le content-type avant de tenter le parse
            const contentType = response.headers.get('content-type') || '';
            if (contentType.includes('text/html')) {
                const bodyPreview = await response.text();
                // Vérifier si c'est une page de login
                if (bodyPreview.includes('login') || bodyPreview.includes('connexion')) {
                    return {
                        success: false,
                        error: 'Page de connexion retournée au lieu du token',
                        httpStatus: 403,
                        responseBody: bodyPreview.slice(0, 500)
                    };
                }
                return {
                    success: false,
                    error: 'Réponse HTML au lieu de JSON (probable redirection ou erreur serveur)',
                    httpStatus: response.status,
                    responseBody: bodyPreview.slice(0, 500)
                };
            }

            // Lire le body en texte d'abord pour pouvoir l'inspecter
            const bodyText = await response.text();

            if (!response.ok) {
                return {
                    success: false,
                    error: `HTTP ${response.status}`,
                    httpStatus: response.status,
                    responseBody: bodyText.slice(0, 500)
                };
            }

            // Tenter le parse JSON
            let data;
            try {
                data = JSON.parse(bodyText);
            } catch (parseErr) {
                return {
                    success: false,
                    error: `Réponse invalide: ${bodyText.slice(0, 200)}`,
                    httpStatus: response.status,
                    responseBody: bodyText.slice(0, 500)
                };
            }

            if (!data.token) {
                return {
                    success: false,
                    error: "Token manquant dans la réponse",
                    httpStatus: response.status,
                    responseBody: bodyText.slice(0, 500)
                };
            }

            console.log(`[YggHelper] Token obtenu pour ${torrentId}`);
            return {
                success: true,
                token: data.token
            };

        } catch (err) {
            console.error('[YggHelper] Erreur fetch token:', err);
            return {
                success: false,
                error: err.message
            };
        }
    },

    // --- UI: Mise à jour basée sur le statut ---
    updateUIForStatus: function(status, data) {
        if (!this.ui) return;

        // Nettoyer le countdown local si on change d'état
        if (status !== 'counting' && this.countdownInterval) {
            clearInterval(this.countdownInterval);
            this.countdownInterval = null;
        }

        switch (status) {
            case 'queued':
                this.showQueued(data.position || 0, data.errorType);
                break;
            case 'requesting':
                this.showRequesting();
                break;
            case 'counting':
                this.showCounting(data.countdownEndsAt);
                break;
            case 'downloading':
                this.showDownloading();
                break;
            case 'done':
                this.showDone();
                break;
            case 'error':
                this.showError(data.lastError, data.errorType);
                break;
            default:
                this.showQueued(0);
        }
    },

    showQueued: function(position, errorType) {
        if (errorType === 'rate_limit') {
            this.ui.btn.innerText = '⏳ Rate-limit, retry auto...';
            this.ui.btn.style.backgroundColor = '#f59e0b';
            this.ui.container.querySelector('.ygg-left-bar').style.background =
                'linear-gradient(to bottom, #f59e0b, #d97706)';
        } else {
            const posText = position > 0 ? ` (#${position})` : '';
            this.ui.btn.innerText = `⏳ En file d'attente${posText}`;
            this.ui.btn.style.backgroundColor = '#8b5cf6';
            this.ui.container.querySelector('.ygg-left-bar').style.background =
                'linear-gradient(to bottom, #8b5cf6, #7c3aed)';
        }
        this.ui.btn.style.cursor = 'default';
        this.ui.btn.onclick = null;
    },

    showRequesting: function() {
        this.ui.btn.innerText = '🔄 Demande du token...';
        this.ui.btn.style.backgroundColor = '#f59e0b';
        this.ui.btn.style.cursor = 'wait';
        this.ui.btn.onclick = null;
        this.ui.container.querySelector('.ygg-left-bar').style.background =
            'linear-gradient(to bottom, #f59e0b, #d97706)';
    },

    showCounting: function(countdownEndsAt) {
        if (!countdownEndsAt) return;

        // Countdown local — pas besoin de poller le storage
        const updateDisplay = () => {
            const remaining = Math.max(0, Math.ceil((countdownEndsAt - Date.now()) / 1000));
            if (remaining <= 0) {
                this.ui.btn.innerText = '📥 Téléchargement imminent...';
                this.ui.btn.style.backgroundColor = '#10b981';
                if (this.countdownInterval) {
                    clearInterval(this.countdownInterval);
                    this.countdownInterval = null;
                }
            } else {
                this.ui.btn.innerText = `⏳ ${remaining}s restantes...`;
                this.ui.btn.style.backgroundColor = '#3b82f6';
            }
        };

        this.ui.btn.style.cursor = 'wait';
        this.ui.btn.onclick = null;
        this.ui.container.querySelector('.ygg-left-bar').style.background =
            'linear-gradient(to bottom, #3b82f6, #2563eb)';

        // Lancer le countdown local
        if (this.countdownInterval) clearInterval(this.countdownInterval);
        updateDisplay();
        this.countdownInterval = setInterval(updateDisplay, 1000);
    },

    showDownloading: function() {
        this.ui.btn.innerText = '🚀 Téléchargement en cours...';
        this.ui.btn.style.backgroundColor = '#10b981';
        this.ui.btn.style.cursor = 'default';
        this.ui.btn.onclick = null;
        this.ui.container.querySelector('.ygg-left-bar').style.background =
            'linear-gradient(to bottom, #10b981, #059669)';
    },

    showDone: function() {
        this.ui.btn.innerText = '✅ Téléchargé !';
        this.ui.btn.style.backgroundColor = '#6b7280';
        this.ui.btn.style.cursor = 'default';
        this.ui.btn.onclick = null;
        this.ui.container.querySelector('.ygg-left-bar').style.background =
            'linear-gradient(to bottom, #6b7280, #4b5563)';

        // Fade out après 5s
        setTimeout(() => {
            if (this.ui && this.ui.container) {
                this.ui.container.style.transition = 'opacity 0.5s, transform 0.5s';
                this.ui.container.style.opacity = '0';
                this.ui.container.style.transform = 'translateY(20px)';
                setTimeout(() => {
                    if (this.ui && this.ui.container) {
                        this.ui.container.remove();
                    }
                }, 500);
            }
        }, 5000);
    },

    showError: function(errorMessage, errorType) {
        let displayMsg = '❌ Erreur';
        if (errorType === 'rate_limit') {
            displayMsg = '⏳ Trop de requêtes, retry auto...';
            this.ui.btn.style.backgroundColor = '#f59e0b';
        } else if (errorType === 'auth') {
            displayMsg = '🔒 Connexion requise';
            this.ui.btn.style.backgroundColor = '#ef4444';
        } else if (errorType === 'not_found') {
            displayMsg = '❌ Torrent introuvable';
            this.ui.btn.style.backgroundColor = '#ef4444';
        } else {
            displayMsg = `❌ Erreur: ${errorMessage || 'inconnue'}`;
            this.ui.btn.style.backgroundColor = '#ef4444';
        }

        this.ui.btn.innerText = displayMsg;
        this.ui.btn.style.cursor = 'default';
        this.ui.btn.onclick = null;
        this.ui.container.querySelector('.ygg-left-bar').style.background =
            'linear-gradient(to bottom, #ef4444, #dc2626)';
    },

    // --- UI: Création du widget ---
    setupUI: function() {
        this.ui = this.createUI();
        document.body.appendChild(this.ui.container);
    },

    createUI: function() {
        const container = document.createElement('div');
        container.id = 'ygg-helper-reminder';

        // Barre latérale colorée (remplace le pseudo-element pour pouvoir la changer dynamiquement)
        const leftBar = document.createElement('div');
        leftBar.className = 'ygg-left-bar';
        leftBar.style.cssText = 'position:absolute;left:0;top:0;bottom:0;width:4px;background:linear-gradient(to bottom,#8b5cf6,#7c3aed);border-radius:12px 0 0 12px;';

        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'ygg-content-wrapper';

        const title = document.createElement('div');
        title.className = 'ygg-title';
        title.innerHTML = '<span>⚡</span> Helper';

        const btn = document.createElement('a');
        btn.href = "#";
        btn.className = 'ygg-download-btn';
        btn.innerText = '⏳ Connexion...';
        btn.onclick = (e) => e.preventDefault();

        const close = document.createElement('div');
        close.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
        close.className = 'ygg-close-btn';
        close.onclick = () => {
            container.remove();
            // Annuler le timer dans le pipeline
            if (this.torrentId) {
                chrome.runtime.sendMessage({ action: 'REMOVE_TIMER', torrentId: this.torrentId });
            }
        };

        contentWrapper.appendChild(title);
        contentWrapper.appendChild(btn);

        container.appendChild(leftBar);
        container.appendChild(contentWrapper);
        container.appendChild(close);

        return { container, btn };
    }
};

YggTimerManager.init();
