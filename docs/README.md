# Référence

Documentation détaillée de `@cometes/orm`. Pour une première prise en main, commencer par le [README](../README.md) ou le [guide de démarrage](guide/getting-started.md).

L’exemple exécutable [`examples/nodejs/`](../examples/nodejs/) reprend tout ce qui suit, commenté avec ses valeurs de retour réelles.

## Sommaire

| Section | Contenu |
|---------|---------|
| [Instance `Orm`](#instance-orm) | Création, connexions, réglages |
| [Modèles](#modèles) | Schéma, types inférés, clés primaires |
| [API des modèles](#api-des-modèles) | CRUD et options communes |
| [`attributes`](#attributes) | Sélection de colonnes typée |
| [`where`](#where) | Filtres et opérateurs |
| [`order` et `limit`](#order-et-limit) | Tri et pagination |
| [Clés étrangères et `include`](#clés-étrangères-et-include) | Jointures |
| [Timestamps et soft delete](#timestamps-et-soft-delete) | Colonnes gérées par l’ORM |
| [Cache Redis](#cache-redis) | Quand une lecture est cachée |
| [Transactions](#transactions) | `begin` / `commit` / `rollback` |
| [Locks](#locks) | Verrous de lignes et de tables |

Autres pages : [Démarrage rapide](guide/getting-started.md) · [Migrations](guide/migrations.md) · [Architecture](concepts/architecture.md)

## Instance `Orm`

```ts
import { Orm } from "@cometes/orm";

const orm = new Orm({
  postgres: {
    url: "postgres://orm:orm@localhost:5432/orm",
    keepAlive: true, // ping toutes les 30 s ; `{ intervalMs: 60_000 }` pour régler
  },
  redis: { url: "redis://localhost:6379" }, // optionnel
});
```

`keepAlive` maintient au moins une connexion Sequelize et envoie un `SELECT 1` périodique, pour éviter qu’un NAT, un load balancer ou un Postgres serverless (mise en pause) ne coupe le socket. Coupé par défaut.

| Méthode | Retour | Description |
|---------|--------|-------------|
| `declareModel({ name, schema })` | `Model` | Déclare un modèle. |
| `migrate(dossier)` | `{ applied, skipped }` | Applique les migrations `*.ts` du dossier (tri alphabétique). |
| `ping()` | `{ postgres, redis }` | Test de santé des deux clients. |
| `cache(bool)` | — | Active / coupe le cache Redis des lectures (défaut : coupé). |
| `log(bool)` | — | Active / coupe les logs SQL (défaut : coupés). |
| `logTo(fn)` | — | Fonction qui reçoit le SQL (`console.log` par défaut). N’active pas les logs. |
| `begin()` | `Transaction` | Ouvre une transaction dans le contexte async courant. |
| `transaction(fn)` | `T` | Isole `fn` : commit si succès, rollback si erreur. |
| `commit(tx?)` / `rollback(tx?)` | — | Termine la transaction courante ou celle passée. |
| `lock(…)` / `unlock()` | — | Verrous PostgreSQL (voir [Locks](#locks)). |
| `connect()` / `disconnect()` | — | Ouvre / ferme les connexions. |

Propriétés utiles : `orm.postgres`, `orm.redis` (`url`, `dbInstance`, `connected`, `healthy()`), `orm.models`, `orm.currentTransaction`, `orm.currentLock`.

`postgres.connected` signifie « instance Sequelize créée ». `redis.connected` signifie « socket Redis ouvert ». `ping()` / `healthy()` testent vraiment le réseau.

Sans configuration Redis, tout fonctionne : seul le cache est indisponible.

## Modèles

Un modèle se déclare avec `orm.declareModel`. Les types de la ligne sont inférés du schéma.

```ts
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

type UserRecord = typeof UserModel.$schema;
// { id: number; name: string; status: "active" | "inactive" | "archived"; … }
```

`declareModel` ne crée pas la table : c’est le rôle des [migrations](guide/migrations.md). Le schéma doit rester aligné sur elles.

### Options de champ

| Option | Effet |
|--------|-------|
| `type` | `string`, `number`, `float`, `boolean` ou `date`. |
| `primary` | Colonne de clé primaire. |
| `nullable: true` | Infère `T \| null` et pose `allowNull: true` (sinon `NOT NULL`). |
| `enum` | Infère l’union des littéraux et génère un `ENUM` Sequelize. |
| `default` | Valeur envoyée à l’INSERT si le champ est omis. |
| `references` | Clé étrangère (voir [include](#clés-étrangères-et-include)). |

`$schema` est une propriété phantom : elle n’existe qu’au niveau des types, jamais à l’exécution.

### Clés primaires

Une clé primaire numérique **unique** est auto-incrémentée (`SERIAL` côté PostgreSQL).

Une clé primaire **composite** — typiquement une table de liaison — se déclare en marquant plusieurs champs, et n’est jamais auto-incrémentée :

```ts
schema: {
  workspace_id: { type: "number", primary: true },
  user_id: { type: "number", primary: true },
}
```

Déclarer au moins une clé primaire est important : sans elle, Sequelize ajoute une colonne `id` implicite qui n’existe pas dans votre table.

## API des modèles

| Méthode | Signature | Retour |
|---------|-----------|--------|
| `create` | `(data, { transaction? }?)` | La ligne créée, complétée par les valeurs par défaut et les timestamps. |
| `findOne` | `({ attributes?, where?, include?, order?, limit?, transaction?, lock? })` | La première ligne, ou `null`. |
| `findAll` | `({ attributes?, where?, include?, order?, limit?, transaction?, lock? })` | Un tableau (vide si aucune correspondance). |
| `updateOne` | `(key, data, { transaction? }?)` | `void`. `key` est la valeur de PK unique, ou l’objet de PK composite. |
| `update` | `(data, { where, order?, transaction? })` | `void`. `where` est obligatoire. |
| `deleteOne` | `(key, { transaction?, force? }?)` | `void`. Soft delete si `deleted_at` existe. |
| `delete` | `({ where, order?, transaction?, force? })` | `void`. `where` est obligatoire. |
| `count` | `({ where?, order?, limit?, transaction? }?)` | Un nombre. |

`create` et `updateOne` / `update` ignorent silencieusement les champs absents du schéma.

```ts
const user = await UserModel.create({ id: 1, name: "John Doe" });
// → {
//     id: 1,
//     name: 'John Doe',
//     status: 'active',
//     created_at: 2026-09-11T07:21:13.618Z,
//     updated_at: 2026-09-11T07:21:13.618Z,
//     deleted_at: null
//   }
```

### `attributes`

Le type de retour est déduit des clés passées (`as const`, ou inférence `const`) :

```ts
const user = await UserModel.findOne({
  attributes: ["id", "name"] as const,
  where: { id: 1 },
});
// user : { id: number; name: string } | null
// → { id: 1, name: 'John Doe' }
```

Sans `attributes`, `findOne` / `findAll` renvoient tous les champs du schéma.

### `where`

`where` accepte les valeurs simples et les opérateurs Sequelize, exportés par le package :

```ts
import { Op } from "@cometes/orm";

await UserModel.findAll({
  where: { status: { [Op.in]: ["active", "inactive"] } },
});
```

Le filtre soft delete est ajouté automatiquement (voir [Timestamps et soft delete](#timestamps-et-soft-delete)).

### `order` et `limit`

`order` est une liste de colonnes du schéma, éventuellement avec `"ASC"` / `"DESC"`. `limit` n’existe que sur les lectures (`findAll`, `findOne`, `count`) : PostgreSQL n’a pas de `UPDATE … LIMIT` / `DELETE … LIMIT`.

```ts
await UserModel.findAll({
  attributes: ["id", "name"] as const,
  where: { status: "active" },
  order: [["created_at", "DESC"], "id"],
  limit: 10,
});
```

## Clés étrangères et `include`

Une clé étrangère se déclare directement sur le champ avec `references`. Le modèle référencé doit être déclaré **avant** le modèle qui porte la FK :

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
    role: { type: "string", enum: ["member", "admin"], default: "member" },
  },
});
```

L’ORM déclare alors un `belongsTo` Sequelize. L’alias est déduit du nom du champ (`user_id` devient `user`) ; il peut être personnalisé avec `references: { model, key, as: "author" }`.

`include` est disponible uniquement sur `findOne` et `findAll` :

```ts
const membership = await WorkspaceUserModel.findOne({
  attributes: ["workspace_id", "user_id", "role"] as const,
  where: { workspace_id: 1 },
  include: [
    {
      model: UserModel,
      attributes: ["id", "name", "status"] as const,
      where: { status: "active" },
      required: true,
      include: [
        {
          model: CompanyModel,
          attributes: ["id", "name"] as const,
          required: true,
        },
      ] as const,
    },
  ] as const,
});
// membership.user.company.name
```

| Clé | Rôle |
|-----|------|
| `model` | Le modèle à joindre (doit correspondre à une FK `references`). |
| `where` | Filtre sur le modèle inclus (soft delete inclus). |
| `attributes` | Colonnes à charger ; la ligne jointe est alors typée comme partielle. |
| `required` | `true` → `INNER JOIN` ; `false` (défaut) → `LEFT JOIN`, et la valeur peut être `null`. |
| `include` | Jointures imbriquées sur le modèle inclus (même forme, récursif). |
| `relation` | Champ FK, seulement s’il y a **plusieurs** FK vers le même modèle. |

La ligne jointe est imbriquée sous l’alias, jamais aplatie dans le résultat. Le soft delete (`deleted_at: null`) est aussi appliqué au modèle inclus.

Les `include` se composent à l’infini (`include` dans un `include`). Les relations `hasMany` / `belongsToMany` ne font pas partie de cette version. Toute requête avec `include` contourne le cache Redis.

## Timestamps et soft delete

Ces colonnes sont prises en charge dès qu’elles figurent dans le schéma (les timestamps Sequelize restent désactivés) :

| Champ | Comportement |
|-------|--------------|
| `created_at` | Rempli à `new Date()` dans `create` s’il est omis. |
| `updated_at` | Rempli dans `create` s’il est omis ; forcé à maintenant dans `update` / `updateOne`. |
| `deleted_at` | Reste `NULL` à l’INSERT. Les lectures / `update` filtrent `deleted_at: null`. `delete` / `deleteOne` posent `deleted_at` (et `updated_at` s’il existe). `force: true` exécute un `DELETE` SQL. |

Pour lire aussi les lignes supprimées :

```ts
await UserModel.findAll({ where: { deleted_at: { [Op.not]: null } } });
await UserModel.findAll({ where: { deleted_at: undefined } });

await UserModel.deleteOne(1);                 // soft delete
await UserModel.deleteOne(1, { force: true }); // suppression réelle
```

## Cache Redis

Avec `orm.cache(true)`, `findOne` / `findAll` **sans** `where`, `include`, `order` ni `limit` passent par Redis (TTL **5 minutes**).

| Situation | Cachée ? |
|-----------|----------|
| `findAll({ attributes })` | Oui |
| Lecture avec `where`, `include`, `order` ou `limit` | Non |
| Lecture dans une transaction ou sous lock | Non |
| `create` / `update` / `updateOne` / `delete` / `deleteOne` | Invalident `cometes:orm:model:<nom>:…` |

Les clés sont préfixées `cometes:orm:` et le nom de modèle est suivi d’un `:` : invalider `users` n’efface pas `users_extra`.

Les `Date` sont taguées (`$cometes/orm:date`) à l’écriture : une string qui ressemble à une date ISO n’est **pas** convertie.

Une lecture filtrée n’est jamais cachée : la donnée reste fraîche, et le cache ne peut pas contenir de lignes non commitées.

## Transactions

`orm.begin()` ouvre une transaction PostgreSQL **dans le contexte async courant** (requête HTTP, tâche). Un seul `begin()` à la fois : un second appel en parallèle lève `Concurrent begin() is not supported; use orm.transaction(fn)`. `orm.transaction(fn)` isole chaque appel (commit si `fn` réussit, rollback sinon) et **peut** tourner en parallèle.

```ts
await orm.transaction(async () => {
  await UserModel.create({ name: "John Doe" });
  await WorkspaceUserModel.update(
    { role: "admin" },
    { where: { workspace_id: 1, user_id: 1 } },
  );
});
```

On peut aussi passer `transaction` explicitement à chaque appel. Un second `begin()` **dans le même contexte** lève une erreur, comme un `commit` / `rollback` sans transaction.

## Locks

Les verrous PostgreSQL s’utilisent **dans une transaction** ; ils sont libérés au `commit` / `rollback`. Un lock sans transaction lève une erreur.

| Appel | Effet |
|-------|-------|
| `orm.lock()` | `SELECT … FOR UPDATE` sur les lectures suivantes. |
| `orm.lock("SHARE")` | Idem avec un autre mode. |
| `orm.unlock()` | Retire le verrou de lignes courant. |
| `orm.lock({ table, mode? })` | `LOCK TABLE … IN <mode> MODE` (défaut `EXCLUSIVE`). |
| `findOne` / `findAll` avec `lock` | Verrou pour cet appel ; `false` désactive le verrou courant. |

Modes de lignes : `true`, `"UPDATE"`, `"SHARE"`, `"KEY SHARE"`, `"NO KEY UPDATE"`.

```ts
await orm.begin();
try {
  await orm.lock({ table: "workspace_users" });
  await orm.lock(); // FOR UPDATE sur les lectures suivantes
  const row = await WorkspaceUserModel.findOne({
    where: { workspace_id: 1, user_id: 1 },
    lock: true,
  });
  orm.unlock();
  await orm.commit();
} catch (error) {
  await orm.rollback();
  throw error;
}
```

Le nom de table passé à `orm.lock({ table })` est validé puis échappé : `LOCK TABLE` n’accepte pas de paramètre lié, un nom invalide est donc rejeté.

## Référence API

La référence publique est décrite en **TSDoc** dans `src/`. Les exports stables passent uniquement par [`src/index.ts`](../src/index.ts) :

- Cœur : `Orm`, `defineModel`, `Op`, `runMigrations`
- Clients : `PostgresClient`, `RedisClient`, `REDIS_CACHE_TTL_SECONDS`, `REDIS_KEY_PREFIX`
- Types : `InferValues`, `SelectedValues`, `PrimaryKeyArg`, `WhereClause`, `OrderClause`, `IncludeClause`, `IncludedValues`, `ModelReference`, `LockClause`, `LockTableOptions`, `TableLockMode`, `Transaction`, …
- Constantes : `TABLE_LOCK_MODES`
