# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **AGENTS.md documentation hierarchy** — AI-readable documentation for the root, `icons/`, and `images/` directories to help AI assistants understand the codebase structure.
- **CLAUDE.md enhancements** — Added File Reference table, Testing section, and Commit Guidelines.

## [1.3.2] - 2026-03-01

### Fixed
- **Bug `LOCK_KEY` constant** : La constante était définie après son utilisation, causant une erreur silencieuse.
- **Scheduling async** : Les appels async dans `processQueue()` sont maintenant correctement séquencés.
- **XSS vulnerability** : Sanitisation du nom du torrent avant affichage dans l'UI (`textContent` au lieu de `innerHTML`).
- **Sanitisation des erreurs** : Les messages d'erreur sont maintenant échappés avant affichage.

## [1.3.2] - 2026-03-01

### Added
- **Pipeline de téléchargement automatique** : Remplacement du système binaire lock/unlock par une file d'attente persistante. Les torrents sont automatiquement enchaînés sans intervention utilisateur.
- **Auto-download** : Le téléchargement se lance automatiquement à la fin du countdown de 30s — plus besoin de cliquer "Télécharger".
- **Gestion du rate-limit** : Détection des erreurs 429 et "file unavailable", avec backoff exponentiel global et retry automatique.
- **Onglet caché fallback** : Si aucun onglet YggTorrent n'est ouvert, un onglet caché est créé temporairement pour obtenir le token.
- **Récupération du pipeline** : En cas de redémarrage du Service Worker, le pipeline reprend depuis l'état persisté dans `chrome.storage`.
- **7 états visuels** : `queued`, `requesting`, `counting`, `downloading`, `done`, `cancelled`, `error` — avec badges et couleurs distinctes dans le popup et le widget.
- **Section "Terminés"** dans le popup pour voir l'historique des téléchargements.
- **Boutons Retry/Retirer** pour les torrents en erreur dans le popup.
- **`chrome.alarms`** : Remplacement des `setInterval`/`setTimeout` de scheduling par des alarmes Chrome pour la fiabilité MV3 (les countdowns UI restent en `setInterval` local).
- **`chrome.downloads.onChanged`** : Suivi de la complétion des téléchargements via l'API native.
- **Stockage amélioré** : Nouvelles clés `ygg_queue` (ordre de la file), `ygg_pipeline_state` (état global), `ygg_pipeline_lock` (verrou lease-based), `ygg_dismissed` (torrents retirés par l'utilisateur).
- **Statut `cancelled`** : Les téléchargements annulés par l'utilisateur ne sont pas retry automatiquement. L'utilisateur peut réessayer manuellement.
- **Détection HTML** : Vérification MIME des téléchargements pour détecter les réponses HTML (token expiré) et les traiter comme rate-limit.
- **Nettoyage automatique** : Suppression des items terminaux après 1h, et des dismissed après 7 jours.
- **justCompleted flag** : Animation de succès dans le widget après téléchargement.
- **Retry prioritaire** : Les retries manuels vont en tête de file (`queue.unshift()`).

### Changed
- **content.js** : Restructuré en "thin sensor" — détecte les torrents, enqueue au pipeline, et affiche l'état. La logique d'orchestration est entièrement déplacée dans le background.
- **background.js** : Réécrit comme orchestrateur de pipeline avec `processQueue()` idempotent, acquisition de token via tab ou onglet caché, et gestion d'erreurs classifiées.
- **popup.js** : Utilise `chrome.storage.onChanged` au lieu du polling 1s pour les mises à jour de statut. Nouvelle UI avec cartes de pipeline montrant les 6 états.
- **popup.html** : Section "En attente" renommée en "Pipeline", ajout de la section "Terminés".
- **Version** : 1.3.1 → 1.3.2.

### Removed
- Verrou binaire `isTimerRunning` en mémoire (remplacé par file d'attente persistante).
- Messages `CAN_I_START`, `TIMER_STARTED`, `TIMER_FINISHED`, `TIMER_CANCELLED`, `REGISTER_PENDING`, `FORCE_START`, `TRIGGER_START`, `SCHEDULE_DOWNLOAD` (remplacés par `ENQUEUE`, `REQUEST_TOKEN`, `TOKEN_RESULT`, `RETRY_TIMER`, `REMOVE_TIMER`).
- Bouton "Démarrer" manuel dans le popup (tout est automatique).

## [1.3.1] - 2026-03-01

### Fixed
- **Extension non fonctionnelle sur Brave** : Les extensions installées via `.crx` sur Brave ne chargeaient pas les content scripts. Documentation mise à jour pour recommander "Load unpacked".
- **Bug `LOCK_KEY` non défini** (`background.js:143`) : Provoquait une erreur silencieuse à chaque téléchargement, empêchant la libération correcte du verrou global.
- **Icônes aux mauvaises dimensions** : `icon48.png` (24x24 → 48x48) et `icon128.png` (64x64 → 128x128) causaient des erreurs de chargement sur certains navigateurs.
- **URL de téléchargement codée en dur** dans le popup : Utilisait toujours `yggtorrent.org` au lieu de l'origine réelle du torrent.
- **Nettoyage des timers "pending"** : Les timers en attente n'avaient pas de `startTime`, causant un nettoyage incorrect.

### Added
- **Support multi-domaines** : 24 domaines YggTorrent connus ajoutés au manifest (`.org`, `.wtf`, `.support`, `.top`, `.town`, `.cool`, `.fi`, `.re`, `.nz`, `.si`, `.se`, `.gg`, `.is`, `.io`, `.la`, `.lat`, `.site`, `.ch`, `.pe`, `.to`, `.do`, `.ws`, `.com`, `ygg.re`).
- **Domaine personnalisé** : Nouvelle section dans le popup permettant d'ajouter un domaine YggTorrent non répertorié, avec enregistrement dynamique des content scripts via `chrome.scripting` API.
- **Compatibilité Brave** : Ajouté aux navigateurs supportés.
- **Script de build** (`build.ps1`) : Script PowerShell pour générer un fichier `.crx` signé.
- **`.gitignore`** : Exclusion de `key.pem`, `.crx`, et `.zip`.

### Changed
- **URLs GitHub** : Toutes les références mises à jour de `MoowGlax/ygg-helper-dl` vers `RicherTunes/ygg-helper-dl`.
- **Version** : 1.3 → 1.3.1.

## [1.3] - Version précédente

Version initiale forkée depuis MoowGlax/ygg-helper-dl.
