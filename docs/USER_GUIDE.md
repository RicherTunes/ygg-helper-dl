# Guide Utilisateur - YggTorrent Helper

## Installation

### Méthode recommandée : Charger l'extension non empaquetée

1. **Téléchargez le code source**
   - Clonez le dépôt ou téléchargez le ZIP
   - Décompressez l'archive si nécessaire

2. **Ouvrez la page des extensions**
   - Chrome : `chrome://extensions`
   - Brave : `brave://extensions`
   - Opera : `opera://extensions`
   - Edge : `edge://extensions`

3. **Activez le Mode développeur**
   - Basculez l'interrupteur en haut à droite

4. **Chargez l'extension**
   - Cliquez sur "Charger l'extension non empaquetée"
   - Sélectionnez le dossier du projet

5. **Épinglez l'extension**
   - Cliquez sur l'icône puzzle 🧩 dans la barre d'outils
   - Épinglez "YggTorrent Helper" pour un accès rapide

## Utilisation

### Téléchargement automatique

1. Naviguez sur YggTorrent comme d'habitude
2. Ouvrez la page d'un torrent
3. Le widget "⚡ Helper" apparaît automatiquement
4. Le torrent est ajouté à la file d'attente
5. Le téléchargement se lance automatiquement après 30 secondes

### Le Pipeline

L'extension gère une file d'attente de torrents :

| État | Signification |
|------|---------------|
| 🟡 **En file** | En attente de traitement |
| 🔵 **Token** | Récupération du jeton de téléchargement |
| 🟠 **Countdown** | Compte à rebours de 30 secondes |
| 🟢 **Téléchargement** | Téléchargement en cours |
| ✅ **Terminé** | Téléchargement réussi |
| 🔴 **Erreur** | Échec (retry automatique) |

### Popup Dashboard

Cliquez sur l'icône ⚡ pour ouvrir le tableau de bord :

- **Pipeline** : Torrents en cours de traitement
- **Terminés** : Historique des téléchargements
- **Nettoyer** : Supprime les torrents terminés de la liste

### Domaine personnalisé

Si YggTorrent change de domaine :

1. Ouvrez le popup
2. Dépliez "Domaine personnalisé"
3. Entrez le nouveau domaine (ex: `yggtorrent.nouveau`)
4. Cliquez OK
5. Acceptez la demande de permission
6. Rechargez la page YggTorrent

## Résolution de problèmes

### L'extension ne fonctionne pas

1. **Vérifiez que l'extension est activée** dans `chrome://extensions`
2. **Rechargez l'extension** avec le bouton ↻
3. **Rechargez la page** YggTorrent
4. **Vérifiez la console** (F12) pour les erreurs

### Brave : L'extension ne détecte pas les torrents

Sur Brave, les extensions installées via `.crx` peuvent mal fonctionner.

**Solution** : Utilisez "Charger l'extension non empaquetée" (voir Installation)

### "Erreur : Rate limit"

YggTorrent limite le nombre de téléchargements. L'extension réessaie automatiquement avec un délai croissant.

**Solution** : Attendez quelques minutes. L'extension reprendra automatiquement.

### "Erreur : Fichier non trouvé"

Le torrent a peut-être été supprimé de YggTorrent.

**Solution** : Cliquez sur "Retirer" dans le popup et cherchez un autre torrent.

### Le téléchargement ne se lance pas

1. Vérifiez que les téléchargements ne sont pas bloqués par votre navigateur
2. Vérifiez l'espace disque disponible
3. Désactivez temporairement les autres extensions de téléchargement

## Mises à jour

L'extension vérifie automatiquement les mises à jour une fois par jour.

Si une mise à jour est disponible :
1. Une notification apparaît dans le popup
2. Cliquez sur le lien pour accéder aux releases
3. Téléchargez et installez la nouvelle version

## Statistiques

L'extension affiche le temps "gagné" (temps que vous n'avez pas attendu manuellement) dans le popup. Ce temps correspond au cumul des countdowns de 30 secondes.

## Confidentialité

- ✅ Aucune donnée envoyée à des serveurs externes
- ✅ Aucun tracking ni analytics
- ✅ Toutes les données restent locales dans votre navigateur
- ✅ Code source ouvert et auditable

## Support

- **Issues** : https://github.com/RicherTunes/ygg-helper-dl/issues
- **Discussions** : https://github.com/RicherTunes/ygg-helper-dl/discussions
