# Security Policy

## Reporting a Vulnerability

Si vous découvrez une vulnérabilité de sécurité, merci de **ne pas** ouvrir une issue publique.

À la place, envoyez un email à [xfear26@hotmail.com] avec :

1. Une description de la vulnérabilité
2. Les étapes pour la reproduire
3. L'impact potentiel
4. Une proposition de correction si vous en avez une

## Response Time

- **Accusé de réception** : Sous 48h
- **Analyse initiale** : Sous 7 jours
- **Correction** : Dépend de la complexité, généralement sous 14 jours

## Disclosure Policy

- Les vulnérabilités seront documentées dans le CHANGELOG après correction
- Les rapports de sécurité confidentiels seront crédités (avec permission)

## Security Best Practices

Cette extension :

- ✅ N'envoie aucune donnée à des serveurs externes
- ✅ Ne stocke que des données locales (chrome.storage)
- ✅ Ne demande que les permissions nécessaires
- ✅ Sanitise les entrées utilisateur avant affichage (protection XSS)

## Known Security Considerations

- **Permissions** : L'extension nécessite `host_permissions` pour les domaines YggTorrent afin de fonctionner. Ces permissions sont limitées aux domaines connus.
- **Custom Domain** : L'ajout d'un domaine personnalisé demande des permissions supplémentaires (`<all_urls>`). N'ajoutez que des domaines de confiance.
