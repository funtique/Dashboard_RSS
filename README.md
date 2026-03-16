# Dashboard RSS

Dashboard RSS moderne pour ecran de supervision, avec aggregation de plusieurs flux et affichage fixe des articles les plus recents.

## Fonctionnalites

- vue fixe adaptee a un ecran de supervision recharge automatiquement
- article principal mis en avant avec image et resume
- bloc d'indicateurs et titres secondaires recents
- cartes prioritaires pour les articles suivants
- configuration simple via `feeds.json`
- cache serveur pour limiter les appels RSS
- deploiement Docker simple pour Portainer ou Raspberry Pi

## Configuration

Edite `feeds.json` :

- `dashboardTitle` : titre visible sur l'ecran
- `refreshMinutes` : duree de cache serveur en minutes
- `maxItems` : nombre maximum d'articles affiches
- `timezone` : fuseau horaire d'affichage
- `display.itemsPerPage` : nombre d'articles prepares pour la vue fixe (defaut: 10)
- `feeds` : liste des flux RSS

Exemple :

```json
{
  "dashboardTitle": "Veille RSS",
  "refreshMinutes": 10,
  "maxItems": 24,
  "timezone": "Europe/Paris",
  "display": {
    "itemsPerPage": 10
  },
  "feeds": [
    {
      "name": "Le Monde",
      "url": "https://www.lemonde.fr/rss/une.xml",
      "enabled": true
    }
  ]
}
```

## Lancement local

```bash
npm install
npm start
```

Ouvre ensuite `http://localhost:3000`.

## Deploiement Portainer

Tu peux utiliser le `Dockerfile` ou `docker-compose.yml`.

Avec Docker Compose :

```bash
docker compose up -d --build
```

Le conteneur ecoute sur le port interne `3000`, mais le port publie par defaut est `3001`.
L'URL a utiliser cote navigateur est donc `http://<ip-du-rpi>:3001`.

## Notes

- certains flux ne fournissent pas toujours d'image
- les flux en erreur sont ignores sans bloquer tout le dashboard
- le navigateur ou le systeme d'affichage peut recharger l'onglet plus frequemment que le cache serveur
