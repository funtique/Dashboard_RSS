# Dashboard RSS

Dashboard RSS moderne pour ecran de supervision, avec aggregation de plusieurs flux et affichage des derniers articles sous forme de tableau.

## Fonctionnalites

- affichage de l'image d'illustration si disponible
- titre de l'article
- heure et date de publication
- site source
- configuration simple via `feeds.json`
- rafraichissement automatique
- deploiement Docker simple pour Portainer ou Raspberry Pi

## Configuration

Edite `feeds.json` :

- `dashboardTitle` : titre visible sur l'ecran
- `refreshMinutes` : frequence de rafraichissement
- `maxItems` : nombre maximum d'articles affiches
- `timezone` : fuseau horaire d'affichage
- `feeds` : liste des flux RSS

Exemple :

```json
{
  "dashboardTitle": "Veille RSS",
  "refreshMinutes": 10,
  "maxItems": 24,
  "timezone": "Europe/Paris",
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
