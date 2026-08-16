# @cometes-io/orm

ORM pour Node.js (TypeScript) — PostgreSQL en persistance, Redis en cache optionnel.

> Statut : API en évolution.

## Installation

```bash
npm install @cometes-io/orm
```

## Quickstart

### 1. Créer l’instance ORM

```ts
import { Orm } from "@cometes-io/orm";

export const orm = new Orm({
  postgres: {
    url: process.env.POSTGRES_URL ?? "postgres://orm:orm@localhost:5432/orm",
  },
  redis: {
    url: process.env.REDIS_URL ?? "redis://localhost:6379",
  },
});
```

### 2. Déclarer un modèle

Le schéma décrit la table. Les types TypeScript des valeurs (`id: number`, `name: string`, …) sont inférés automatiquement.

```ts
import { orm } from "./db.js";

export const UserModel = orm.declareModel({
  name: "users",
  schema: {
    id: {
      type: "number",
      primary: true,
    },
    name: {
      type: "string",
    },
  },
});
```

Types de champs supportés : `string`, `number`, `boolean`, `float`, `date`.

### 3. Migrations

Avant d’utiliser les modèles, appliquez les migrations (création des tables) :

```ts
await orm.migrate("./migrations");
```

Voir [docs/guide/migrations.md](docs/guide/migrations.md) pour le format des fichiers.

### 4. CRUD

```ts
import { orm } from "./db.js";
import { UserModel } from "./models/users.js";

// Santé des connexions
console.log(await orm.ping());

// Cache Redis (optionnel) et logs SQL
orm.cache(false);
orm.log(false);

// Lecture
const user = await UserModel.findOne({
  attributes: ["id", "name"],
  where: { id: 1 },
});

if (user) {
  // Mise à jour — user.id est typé number
  await UserModel.updateOne(user.id, {
    name: "John Doe 1 bis",
  });
} else {
  // Création — les champs hors schéma sont ignorés
  await UserModel.create({
    id: 1,
    name: "John Doe 1",
  });
}

// Liste
const users = await UserModel.findAll({
  attributes: ["id", "name"],
});

// Suppression
await UserModel.deleteOne(1);

await orm.disconnect();
```

### API des modèles

| Méthode | Signature | Description |
|---------|-----------|-------------|
| `create` | `(data) => Promise` | Insert. Seuls les champs du schéma sont envoyés. |
| `findOne` | `({ attributes?, where? }) => Promise<row \| null>` | Première ligne correspondante. |
| `findAll` | `({ attributes? }) => Promise<row[]>` | Toutes les lignes. |
| `updateOne` | `(id, data) => Promise<void>` | Update par clé primaire. |
| `deleteOne` | `(id) => Promise<void>` | Delete par clé primaire. |

Avec le cache activé (`orm.cache(true)`), `findOne` / `findAll` passent par Redis ; `create` / `updateOne` / `deleteOne` invalident les clés concernées.

## Exemple complet

Le dossier [`examples/nodejs/`](examples/nodejs/) reprend exactement ce flux :

```bash
# Stack Docker (Postgres + Redis + app)
npm run example:docker:watch

# Ou en local (services déjà up)
npm run migrate
npm run example
```

## Documentation

| Section | Contenu |
|---------|---------|
| [Guide de démarrage](docs/guide/getting-started.md) | Installer, lancer l’exemple, Docker |
| [Migrations](docs/guide/migrations.md) | SQL versionnés + Adminer |
| [Architecture](docs/concepts/architecture.md) | Modèle mental du projet |
| [Exemple Node.js](examples/nodejs/) | Code exécutable |

## Scripts

```bash
npm run build                 # compile src/ → dist/
npm run migrate               # applique examples/nodejs/migrations/*.ts
npm run example               # lance l’exemple local
npm run example:docker        # stack Docker
npm run example:docker:watch  # stack Docker + hot reload
npm test                      # tests unitaires
npm run ci                    # typecheck + tests + build
```

## CI

À chaque push / PR sur `main`, GitHub Actions exécute typecheck, tests et build sur Node 20 et 22 (voir [`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

## Publier une nouvelle version sur npm

Le package publié est [`@cometes/orm`](https://www.npmjs.com/package/@cometes/orm). Seul le dossier `dist/` est envoyé : compiler avant de publier.

```bash
# 1. Vérifier que tout passe
npm run ci

# 2. Incrémenter la version — choisir l’une des commandes (commit + tag git)
npm version patch   # 0.1.1 → 0.1.2  (correctif)
npm version minor   # 0.1.1 → 0.2.0  (nouvelle fonctionnalité)
npm version major   # 0.1.1 → 1.0.0  (breaking change)

# 3. Publier (package scoped : accès public)
npm publish --access public

# 4. Pousser le commit et le tag
git push && git push --tags
```

Il faut être connecté (`npm login`) et avoir les droits de publication sur l’organisation `@cometes`. Vérifier avec `npm whoami`.

## Licence

Apache License 2.0
