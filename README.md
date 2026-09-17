# @cometes/orm

ORM pour Node.js (TypeScript) — PostgreSQL ou MySQL en persistance, Redis en cache optionnel.

Vous décrivez vos tables une seule fois ; les types TypeScript des lignes en sont déduits automatiquement.

> Statut : API en évolution.

## Installation

```bash
npm install @cometes/orm
```

## Quickstart

### 1. Créer l’instance ORM

```ts
import { Orm } from "@cometes/orm";

export const orm = new Orm({
  postgres: {
    url: process.env.POSTGRES_URL ?? "postgres://orm:orm@localhost:5432/orm",
    // Empêche le pool / un Postgres serverless de couper la connexion
    // keepAlive: true,
  },
  // À la place de `postgres` :
  // mysql: { url: process.env.MYSQL_URL ?? "mysql://orm:orm@localhost:3306/orm" },
  redis: {
    url: process.env.REDIS_URL ?? "redis://redis:6379",
  },
});
```

Redis est facultatif : sans lui, tout fonctionne, seul le cache est indisponible.

### 2. Déclarer un modèle

Le schéma décrit la table. Les types des valeurs (`id: number`, `status: "active" | …`) sont inférés.

```ts
import { orm } from "./db.js";

export const UserModel = orm.declareModel({
  name: "users",
  schema: {
    id: { type: "number", primary: true },
    name: { type: "string" },
    status: {
      type: "string",
      enum: ["active", "inactive", "archived"],
      default: "active",
    },
    created_at: { type: "date" },
    updated_at: { type: "date" },
    deleted_at: { type: "date", nullable: true },
  },
});

// Ligne inférée, sans écrire le type à la main
type UserRecord = typeof UserModel.$schema;
// { id: number; name: string; status: "active" | "inactive" | "archived"; … }
```

Types de champ : `string`, `number`, `float`, `boolean`, `date`.  
Options de champ : `primary`, `nullable`, `enum`, `default`, `references` (clé étrangère).

### 3. Appliquer les migrations

Les modèles ne créent pas les tables : les migrations s’en chargent.

```ts
await orm.migrate("./migrations");
// → { applied: ["001_create_users.ts"], skipped: [] }
```

Voir [Migrations](docs/guide/migrations.md) pour le format des fichiers.

### 4. Lire et écrire

```ts
// Santé des connexions
console.log(await orm.ping());
// → { postgres: true, mysql: false, redis: true }

// Cache Redis et logs SQL (désactivés par défaut)
orm.cache(false);
orm.log(false);
// orm.logTo(console.error); // sortie des logs SQL une fois `log(true)`

// Création — les champs hors schéma sont ignorés,
// created_at / updated_at / default sont remplis par l'ORM
const user = await UserModel.create({ id: 1, name: "John Doe" });
// → { id: 1, name: 'John Doe', status: 'active', created_at: …, deleted_at: null }

// Lecture — le type de retour suit exactement `attributes`
const found = await UserModel.findOne({
  attributes: ["id", "name"] as const,
  where: { id: 1 },
});
// → { id: 1, name: 'John Doe' }   (ou null)

// Liste triée et limitée
const users = await UserModel.findAll({
  attributes: ["id", "name"] as const,
  order: [["created_at", "DESC"], "id"],
  limit: 10,
});
// → [ { id: 1, name: 'John Doe' } ]

await UserModel.updateOne(user.id, { name: "Jane Doe" });
await UserModel.deleteOne(user.id);

await orm.disconnect();
```

## API

### Instance `Orm`

| Méthode | Description |
|---------|-------------|
| `declareModel({ name, schema })` | Déclare un modèle et renvoie son API. |
| `migrate(dossier)` | Applique les migrations → `{ applied, skipped }`. |
| `ping()` | État des connexions → `{ postgres, mysql, redis }`. |
| `cache(bool)` | Active / coupe le cache Redis des lectures. |
| `log(bool)` | Active / coupe les logs SQL. |
| `logTo(fn)` | Destination des logs SQL (`console.log` par défaut). |
| `begin()` / `commit()` / `rollback()` | Transaction du contexte async courant. |
| `transaction(fn)` | Transaction isolée, commit / rollback automatiques. |
| `lock(…)` / `unlock()` | Verrous SQL (dans une transaction). |
| `connect()` / `disconnect()` | Ouverture / fermeture des connexions. |
| `orm.postgres` / `orm.redis` | Clients SQL (Postgres ou MySQL) et Redis. |

### Modèle

Toutes les méthodes acceptent en plus `transaction` ; `findOne` / `findAll` acceptent aussi `lock`.

| Méthode | Signature | Description |
|---------|-----------|-------------|
| `create` | `(data) => Promise<row>` | Insert ; renvoie la ligne complète. |
| `findOne` | `({ attributes?, where?, include?, order?, limit? }) => Promise<row \| null>` | Première ligne correspondante. |
| `findAll` | `({ attributes?, where?, include?, order?, limit? }) => Promise<row[]>` | Lignes correspondantes. |
| `updateOne` | `(key, data) => Promise<void>` | Update par clé primaire (`id` ou `{ workspace_id, user_id }`). |
| `update` | `(data, { where, order? }) => Promise<void>` | Update par `where` (obligatoire). |
| `deleteOne` | `(key, { force? }?) => Promise<void>` | Soft delete par clé primaire (`force: true` = `DELETE`). |
| `delete` | `({ where, order?, force? }) => Promise<void>` | Soft delete par `where` (obligatoire). |
| `count` | `({ where?, order?, limit? }) => Promise<number>` | Nombre de lignes. |

Les opérateurs Sequelize s’importent depuis le package : `import { Op } from "@cometes/orm"`.

## Ce que l’ORM fait pour vous

### Timestamps et soft delete

Si le schéma contient `created_at` / `updated_at` / `deleted_at`, l’ORM les gère : horodatage à la création et à la mise à jour. `delete` / `deleteOne` posent `deleted_at` (soft delete) ; `force: true` exécute un `DELETE` SQL. Les lectures filtrent `deleted_at: null` par défaut.

`nullable: true` infère `T | null` **et** pose `allowNull: true` côté Sequelize. Sans `nullable`, la colonne est `NOT NULL`.

### Clés étrangères et `include`

Une FK se déclare sur le champ ; le modèle référencé doit être déclaré avant.

```ts
export const WorkspaceUserModel = orm.declareModel({
  name: "workspace_users",
  schema: {
    workspace_id: { type: "number", primary: true },
    user_id: {
      type: "number",
      primary: true,
      references: { model: UserModel, key: "id" },
    },
  },
});

const membership = await WorkspaceUserModel.findOne({
  include: [
    {
      model: UserModel,
      attributes: ["id", "name"] as const,
      where: { status: "active" },
      required: true,
    },
  ] as const,
});
// → { workspace_id: 1, user_id: 1, user: { id: 1, name: 'John Doe' } }
```

L’alias est dérivé de la FK (`user_id` → `user`), ou fixé avec `references.as`. `required: true` passe le `LEFT JOIN` en `INNER JOIN`. `where` filtre le modèle joint. Un `include` peut contenir un autre `include` (jointures imbriquées). `relation` n’est utile que s’il y a plusieurs FK vers le même modèle.

### Relations 1→N

Rien à déclarer sur le parent, et `reverseAs` n’est pas obligatoire. Chaque `references` crée le `hasMany` inverse : l’alias 1→N est le **nom de la table enfant**.

```ts
export const UserModel = orm.declareModel({
  name: "users",
  schema: {
    id: { type: "number", primary: true },
    name: { type: "string" },
  },
});

export const TicketModel = orm.declareModel({
  name: "tickets",
  schema: {
    id: { type: "number", primary: true },
    user_id: {
      type: "number",
      references: {
        model: UserModel,
        key: "id",
        reverseAs: "tickets", // collection vue depuis `users`
      },
    },
    title: { type: "string" },
  },
});
```

`UserModel` doit être déclaré **avant** `TicketModel`. Sans `reverseAs`, l’alias 1→N est le nom de la table enfant (`tickets`).

```ts
const user = await UserModel.findOne({
  attributes: ["id", "name"] as const,
  include: [
    { model: TicketModel, attributes: ["id", "title"] as const },
  ] as const,
});
// → { id: 1, name: 'Ada', tickets: [ { id: 1, title: 'Bug' }, { id: 2, title: 'Feat' } ] }
```

La collection est **toujours un tableau**, vide s’il n’y a rien à joindre — jamais `null`. `required: true` écarte les parents sans enfant (`INNER JOIN`).

S’il y a **plusieurs** `references` vers la même table, l’alias est suffixé par le champ FK pour ne pas se chevaucher, et `relation` devient obligatoire à l’`include` :

```ts
create_user_id: {
  type: "number",
  references: { model: UserModel, key: "id", as: "create_user" },
},
update_user_id: {
  type: "number",
  references: { model: UserModel, key: "id", as: "update_user" },
},

await UserModel.findOne({
  include: [
    { model: TicketModel, relation: "update_user_id", attributes: ["id"] as const },
  ] as const,
});
// → { …, tickets_update_user_id: [ { id: 1 } ] }
```

`reverseAs` ne sert qu’à **renommer** une collection (`reverseAs: "memberships"`). Avec plusieurs FK, on peut le poser sur chacune pour éviter le suffixe (`reverseAs: "created_tickets"` / `"updated_tickets"`).

`limit` compte les lignes du **parent**. Détail : [Clés étrangères et include](docs/README.md#clés-étrangères-et-include).

### Transactions

```ts
await orm.begin();
try {
  await UserModel.create({ id: 1, name: "John Doe" });
  await orm.commit();
} catch (error) {
  await orm.rollback();
  throw error;
}
```

Les appels aux modèles rejoignent automatiquement la transaction du **contexte async** courant. Deux `begin()` en parallèle (`Promise.all`) lèvent une erreur : pour du parallèle, utiliser `orm.transaction(fn)` :

```ts
await orm.transaction(async () => {
  await UserModel.create({ id: 1, name: "John Doe" });
});
```

### Locks

```ts
await orm.begin();
try {
  await orm.lock({ table: "users" }); // LOCK TABLE
  await orm.lock();                   // SELECT … FOR UPDATE
  const user = await UserModel.findOne({ where: { id: 1 }, lock: true });
  orm.unlock();
  await orm.commit();
} catch (error) {
  await orm.rollback();
  throw error;
}
```

### Cache Redis

Avec `orm.cache(true)`, seules les lectures **sans** `where`, `include`, `order` ni `limit` passent par Redis (TTL 5 min). Toute écriture invalide `cometes:orm:model:<nom>:…`. Les dates sont taguées, pas devinées.

## Exemple complet

[`examples/nodejs/`](examples/nodejs/) est exécutable et commenté avec les valeurs de retour réelles.

```bash
# Stack Docker (Postgres + Redis + app + Adminer)
npm run example:docker:watch

# Ou en local (services déjà démarrés)
npm run migrate
npm run example
```

## Documentation

| Section | Contenu |
|---------|---------|
| [Référence](docs/README.md) | API détaillée : attributes, include, cache, transactions, locks |
| [Guide de démarrage](docs/guide/getting-started.md) | Installer, lancer l’exemple, Docker |
| [Migrations](docs/guide/migrations.md) | Fichiers versionnés + Adminer |
| [Architecture](docs/concepts/architecture.md) | Modèle mental du projet |

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

Ou en une ligne de commande  `npm run build && npm version patch && git push && npm publish`

## Licence

Apache License 2.0
