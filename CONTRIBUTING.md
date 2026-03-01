# Contributing to YggTorrent Helper

Merci de votre intérêt pour contribuer à ce projet !

## 🐛 Signaler un bug

1. Vérifiez que le bug n'a pas déjà été signalé dans les [Issues](https://github.com/RicherTunes/ygg-helper-dl/issues).
2. Créez une nouvelle issue en utilisant le template "Bug Report".
3. Incluez :
   - Version de l'extension (dans le popup)
   - Navigateur et version (Chrome, Brave, Opera, Edge)
   - Étapes pour reproduire
   - Screenshots si applicable

## 💡 Proposer une fonctionnalité

1. Ouvrez une issue avec le label "enhancement".
2. Décrivez la fonctionnalité et son utilité.

## 🔧 Soumettre une Pull Request

### Prérequis

1. Fork le dépôt
2. Clonez votre fork localement

### Développement

1. Créez une branche pour votre modification :
   ```bash
   git checkout -b feature/ma-nouvelle-fonctionnalite
   ```

2. Chargez l'extension en mode développeur :
   - Ouvrez `chrome://extensions` (ou `brave://extensions`)
   - Activez le "Mode développeur"
   - Cliquez "Charger l'extension non empaquetée"
   - Sélectionnez le dossier du projet

3. Effectuez vos modifications en suivant les conventions du projet.

### Conventions de code

- **Langue** : UI et commentaires en français
- **Indentation** : 4 espaces
- **Nommage** : `camelCase` pour variables/fonctions, `UPPER_SNAKE_CASE` pour constantes
- **Storage keys** : Préfixe `ygg_`
- **Message actions** : `UPPER_SNAKE_CASE` (ex: `ENQUEUE`, `REQUEST_TOKEN`)

### Tester vos modifications

Il n'y a pas de tests automatisés. Testez manuellement :

1. Visitez une page torrent YggTorrent
2. Vérifiez l'auto-enqueue dans le popup
3. Vérifiez le countdown et le téléchargement automatique
4. Si vous touchez au code de domaines, testez avec un domaine personnalisé

### Soumettre

1. Commitez vos modifications avec un message clair :
   ```bash
   git commit -m "Ajout de la fonctionnalité X"
   ```

2. Poussez vers votre fork :
   ```bash
   git push origin feature/ma-nouvelle-fonctionnalite
   ```

3. Ouvrez une Pull Request avec :
   - Description des modifications
   - Étapes de test
   - Screenshots pour les modifications UI

## 📜 Code de conduite

- Soyez respectueux et inclusif
- Acceptez les critiques constructives
- Concentrez-vous sur ce qui est le mieux pour la communauté
