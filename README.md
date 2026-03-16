# Dashboard RSS

Dashboard RSS moderne pour ecran de supervision, pense comme un template deployable depuis GitHub avec une configuration utilisateur separee du code.

## Fonctionnalites

- vue fixe adaptee a un ecran de supervision recharge automatiquement
- article principal mis en avant avec image et resume
- bloc d'indicateurs, sante des flux, et titres secondaires recents
- cartes prioritaires avec badges de criticite
- priorite configurable par source via `priority`
- criticite configurable par mots-cles via `criticalityRules`
- cache serveur et endpoint de supervision `/api/status`
- configuration utilisateur externalisable via `CONFIG_PATH`
- deploiement simple avec Docker ou Portainer

## Structure de configuration

Le depot versionne uniquement un exemple: `feeds.example.json`.

Le fichier reel `feeds.json` est volontairement ignore par Git pour permettre a chaque utilisateur de gerer ses propres flux sans conflit lors des mises a jour.

Ordre de recherche de la configuration:

1. chemin fourni par la variable d'environnement `CONFIG_PATH`
2. fichier local `feeds.json`
3. fallback sur `feeds.example.json`

## Parametres disponibles

- `dashboardTitle` : titre visible sur l'ecran
- `refreshMinutes` : duree de cache serveur en minutes
- `maxItems` : nombre maximum d'articles agreges
- `requestTimeoutMs` : timeout reseau par flux
- `timezone` : fuseau horaire d'affichage
- `display.itemsPerPage` : nombre d'articles prepares pour la vue fixe
- `criticalityRules` : regles simples de criticite basees sur mots-cles
- `feeds[].priority` : poids de priorite par source, defaut `0`
- `feeds` : liste des flux RSS

Exemple:

```json
{
  "dashboardTitle": "Veille Cyber",
  "refreshMinutes": 5,
  "maxItems": 20,
  "requestTimeoutMs": 12000,
  "timezone": "Europe/Paris",
  "display": {
    "itemsPerPage": 10
  },
  "criticalityRules": [
    {
      "label": "Alerte",
      "className": "is-critical-high",
      "boost": 600,
      "keywords": ["ransomware", "zero-day", "0day", "exploit"]
    }
  ],
  "feeds": [
    {
      "name": "CERT-FR",
      "url": "https://www.cert.ssi.gouv.fr/feed/",
      "enabled": true,
      "priority": 3
    }
  ]
}
```

## Compatibilite

Les nouveaux champs sont optionnels.

Si `priority` ou `criticalityRules` ne sont pas renseignes:

- le dashboard continue de fonctionner
- le score repose essentiellement sur la fraicheur
- aucun badge de criticite n'est affiche

## APIs

### `GET /api/feed`

Retourne:

- `meta` : titre, timezone, cache, resume de sante des flux
- `items` : articles enrichis avec fraicheur, criticite, priorite source et score

Champs d'article utiles:

- `sourcePriority`
- `criticalityLabel`
- `criticalityClass`
- `matchedKeyword`
- `criticalityBoost`
- `score`

### `GET /api/status`

Endpoint de supervision pour suivre:

- la date du dernier snapshot
- l'age du cache
- le resume global des flux
- l'etat detaille par flux: `ok`, `empty`, `timeout`, `error`
- le nombre d'items, la duree de collecte et les derniers succes/erreurs

## Lancement local

Pour travailler localement avec ta propre config:

```bash
cp feeds.example.json feeds.json
npm install
npm start
```

Ensuite ouvre `http://localhost:3000`.

## Deploiement Docker

L'application peut lire un fichier de configuration monte dans le conteneur.

Exemple:

```bash
docker build -t dashboard-rss .
docker run -d \
  -p 3001:3000 \
  -e CONFIG_PATH=/app/config/feeds.json \
  -v /chemin/local/feeds.json:/app/config/feeds.json:ro \
  --name dashboard-rss \
  dashboard-rss
```

## Deploiement Portainer / Docker Compose

Le `docker-compose.yml` fourni est pret pour un usage type Portainer:

```yaml
services:
  dashboard-rss:
    build: .
    container_name: dashboard-rss
    ports:
      - "3001:3000"
    environment:
      - CONFIG_PATH=/app/config/feeds.json
    volumes:
      - ./feeds.json:/app/config/feeds.json:ro
    restart: unless-stopped
```

Avant le deploiement:

1. copie `feeds.example.json` en `feeds.json`
2. adapte les flux, priorites, et mots-cles critiques
3. deploie la stack

Si tu utilises Portainer avec un depot Git en source, assure-toi que le bind mount ou le volume pointe vers un `feeds.json` present cote hote, pas vers le fichier exemple du repo.

## Workflow de mise a jour

Le but du template est de separer code et configuration:

1. tu mets a jour le code depuis GitHub
2. tu rebuildes ou redeploies le conteneur
3. ton `feeds.json` utilisateur reste intact car il est monte depuis l'exterieur

Tant que la structure de configuration reste compatible, la mise a jour ne demande aucune action sur les flux.

Si une future version ajoute de nouveaux champs:

- l'application doit rester compatible avec les anciens fichiers autant que possible
- la documentation doit indiquer les nouveaux champs optionnels ou la migration necessaire

## Recommandations de versioning

- utiliser des tags ou releases GitHub pour les versions stables
- eviter de deployer uniquement `latest` en production
- conserver le `feeds.json` utilisateur hors du repo et hors du conteneur

## Notes

- certains flux ne fournissent pas toujours d'image
- les flux en erreur sont ignores sans bloquer tout le dashboard
- le navigateur ou le systeme d'affichage peut recharger l'onglet plus frequemment que le cache serveur
