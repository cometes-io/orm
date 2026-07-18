# Démarrage rapide

## Prérequis

- Node.js ≥ 20
- npm
- Docker (optionnel, pour Postgres + Redis)

## Installer le dépôt

```bash
git clone <url-du-repo>
cd orm
npm install
```

## Premier usage

```ts
import { Orm } from "@cometes-io/orm";

const orm = new Orm({ name: "app" });
orm.ping(); // "orm:app"
```

En local, sans publier le package, l’exemple importe directement les sources :

```bash
npm run example
```

Voir le code : [`examples/nodejs/index.ts`](../../examples/nodejs/index.ts).

## Stack Docker (Postgres + Redis + Node)

Depuis la racine du dépôt :

```bash
docker compose -f examples/docker-compose.yml up --build
```

Services sur le network `orm-net` :

| Service    | Port | Accès depuis Node |
|------------|------|-------------------|
| PostgreSQL | 5432 | `postgres:5432`   |
| Redis      | 6379 | `redis:6379`      |
| Node.js    | —    | conteneur `orm-nodejs` |

Arrêt :

```bash
docker compose -f examples/docker-compose.yml down
```

## Suite

- [Architecture](../concepts/architecture.md)
- [Index de la doc](../README.md)
