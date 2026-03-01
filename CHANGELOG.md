# Changelog

## [1.4] - 2026-03-01

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
- **Version** : 1.3 → 1.4.

## [1.3] - Version précédente

Version initiale forkée depuis MoowGlax/ygg-helper-dl.
