# ⚡ YggTorrent Helper (Smart Timer)

![Version](https://img.shields.io/badge/version-1.4-blue.svg)
![Compatibility](https://img.shields.io/badge/browser-Chrome%20%7C%20Brave%20%7C%20Opera%20%7C%20Edge-red.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

Une extension web optimisée pour YggTorrent qui gère intelligemment le temps d'attente de téléchargement pour vous permettre de naviguer librement. Plus besoin d'attendre 30 secondes devant votre écran !

![Interface Principale](images/page_principal.png)

## 🚀 Fonctionnalités

- **Smart Timer** : Lance automatiquement le compte à rebours de 30s côté serveur dès que vous arrivez sur la fiche d'un torrent.
- **File d'attente Intelligente** :
  - **Actifs** : Les téléchargements en cours de traitement.
  - **En attente** : Si vous ouvrez plusieurs onglets, les suivants sont mis en attente pour ne pas bloquer le système (un seul timer à la fois).
  - **Démarrage Manuel** : Lancez les téléchargements en attente d'un simple clic quand le précédent est fini.
- **Navigation Libre** : Grâce au Service Worker, le timer continue même si vous fermez l'onglet ou naviguez ailleurs.
- **Mises à jour Automatiques** : Système de notification intégré pour vous avertir des nouvelles versions disponibles sur GitHub.
- **Multi-Domaines** : Supporte tous les domaines YggTorrent connus (`.org`, `.wtf`, `.support`, `.top`, `.town`, etc.) avec possibilité d'ajouter un domaine personnalisé depuis le popup.

![Notification de Mise à jour](images/update_notif.png)

## 📦 Installation

Cette extension n'est pas disponible sur le Chrome Web Store. Vous avez deux options pour l'installer.

### Option 1 : Via le code source (Recommandé)

1. **Télécharger le projet** :
   - Clonez ce dépôt ou téléchargez le fichier ZIP (Code > Download ZIP) et décompressez-le.

2. **Charger l'extension** :
   - Allez sur la page des extensions de votre navigateur :
     - Chrome : `chrome://extensions`
     - Brave : `brave://extensions`
     - Opera : `opera://extensions`
     - Edge : `edge://extensions`
   - Activez le **Mode développeur**.
   - Cliquez sur **"Charger l'extension non empaquetée"** (Load unpacked).
   - Sélectionnez le dossier racine du projet.

3. **Épingler l'extension** :
   - Cliquez sur l'icône puzzle (🧩) dans la barre d'outils.
   - Épinglez **YggHelper** pour un accès rapide.

### Option 2 : Via le fichier .crx

1. **Télécharger l'extension** :
   - Rendez-vous dans la section [Releases](https://github.com/RicherTunes/ygg-helper-dl/releases) et téléchargez le dernier fichier `.crx`.

2. **Installer** :
   - Ouvrez la page des extensions et activez le **Mode développeur**.
   - Glissez-déposez le fichier `.crx` directement dans la page des extensions.

> **Note :** Certains navigateurs (Brave notamment) peuvent restreindre les extensions installées via `.crx`. Préférez l'option 1 pour le développement et le test.

## 🦊 Installation sur Firefox

**WIP**

## 🛠️ Utilisation

1. Naviguez sur YggTorrent comme d'habitude.
2. Ouvrez la fiche d'un torrent.
3. Une notification discrète "⚡ Helper" apparaît en bas à droite pour confirmer la prise en charge.
4. Le timer démarre en arrière-plan. Vous pouvez continuer à naviguer !
5. Ouvrez l'extension (clic sur l'icône ⚡) pour voir l'état de vos téléchargements.
6. Une fois le timer terminé, cliquez sur "Télécharger" pour lancer le téléchargement.

### 🌐 Domaine personnalisé

Si YggTorrent change de domaine et que l'extension ne fonctionne plus :

1. Ouvrez le popup de l'extension.
2. Dépliez la section **"Domaine personnalisé"** en bas.
3. Entrez le nouveau domaine (ex: `yggtorrent.exemple`).
4. Cliquez **OK** et acceptez la demande de permission.
5. Rechargez la page YggTorrent.

## 🔨 Build

Un script PowerShell est fourni pour générer un fichier `.crx` :

```powershell
.\build.ps1
```

La clé de signature (`ygg-helper-dl-key.pem`) est générée automatiquement au premier build et stockée dans le dossier parent. Ne la partagez pas.

## 🤝 Contribution

Les contributions sont les bienvenues ! N'hésitez pas à ouvrir une Issue ou une Pull Request.

## ⚠️ Avertissement

Ce projet est à but éducatif et personnel uniquement. L'auteur n'est pas responsable de l'utilisation qui en est faite. Assurez-vous de respecter les conditions d'utilisation des sites que vous visitez et les lois en vigueur dans votre pays concernant le téléchargement.
