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

const orm = new Orm({
  postgres: { url: "postgres://orm:orm@localhost:5432/orm" },
});
await orm.migrate("./migrations");
console.log(await orm.ping());
```

En local, sans publier le package :

```bash
npm run migrate   # applique examples/nodejs/migrations/*.ts
npm run example
```

Voir le code : [`examples/nodejs/index.ts`](../../examples/nodejs/index.ts).

## Stack Docker (Postgres + Redis + Node + Adminer)

```bash
docker compose -f examples/docker-compose.yml up --build
```

| Service    | Port  | Rôle |
|------------|-------|------|
| PostgreSQL | 5432 (interne) | Persistance |
| Redis      | 6379 (interne) | Cache / files |
| migrate    | — | Applique les SQL puis s’arrête |
| Node.js    | — | Exemple applicatif |
| Adminer    | **8080** | UI pour lire la BDD |

Adminer : http://localhost:8080 — serveur `postgres`, user/pass/db `orm`.

Arrêt :

```bash
docker compose -f examples/docker-compose.yml down
```

## Suite

- [Migrations](./migrations.md)
- [Architecture](../concepts/architecture.md)
- [Index de la doc](../README.md)
