# Documentation

Documentation utilisateur de `@cometes-io/orm`.

L’exemple exécutable (`examples/nodejs/`) reprend le flux décrit ici.

## Guides

- [Démarrage rapide](guide/getting-started.md) — installation, premier usage, stack Docker
- [Migrations](guide/migrations.md) — SQL versionnés + Adminer

## Concepts

- [Architecture](concepts/architecture.md) — organisation du dépôt et responsabilités

## Modèles

Déclaration via `orm.declareModel`. Les types de la ligne sont inférés du schéma (`string`, `number`, `boolean`, `float`, `date`).

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

`$schema` est une propriété phantom (TypeScript uniquement). `nullable: true` infère `T | null`. `enum` infère l’union des littéraux. `default` est envoyé à Sequelize (`defaultValue`) à l’INSERT si le champ n’est pas fourni.

Exporter `Op` depuis `@cometes-io/orm` pour les opérateurs Sequelize (`Op.in`, `Op.not`, …).

## API des modèles

| Méthode | Signature | Description |
|---------|-----------|-------------|
| `create` | `(data) => Promise<row>` | Insert. Champs hors schéma ignorés. |
| `findOne` | `({ attributes?, where? }) => Promise<row \| null>` | Première ligne. |
| `findAll` | `({ attributes?, where? }) => Promise<row[]>` | Toutes les lignes correspondantes. |
| `updateOne` | `(id, data) => Promise<void>` | Update par clé primaire. |
| `update` | `(data, { where }) => Promise<void>` | Update par clause `where` (obligatoire). |
| `deleteOne` | `(id) => Promise<void>` | Delete par clé primaire. |
| `delete` | `({ where }) => Promise<void>` | Delete par clause `where` (obligatoire). |
| `count` | `({ where? }) => Promise<number>` | Nombre de lignes correspondantes. |

### `attributes`

Le type de retour est déduit des clés passées (`as const` ou inférence `const`) :

```ts
const user = await UserModel.findOne({
  attributes: ["id", "name"] as const,
  where: { id: 1 },
});
// user : { id: number; name: string } | null
```

Sans `attributes`, `findAll` / `findOne` renvoient tous les champs du schéma.

### Timestamps et soft delete

Si le schéma contient ces colonnes (les timestamps Sequelize restent à `false`) :

| Champ | Comportement |
|-------|----------------|
| `created_at` | Rempli à `new Date()` dans `create` s’il est omis. |
| `updated_at` | Rempli à `new Date()` dans `create` s’il est omis ; forcé à maintenant dans `update` / `updateOne`. |
| `deleted_at` | Non rempli à l’INSERT (reste `NULL`). `findAll` / `findOne` / `update` / `delete` ajoutent `deleted_at: null` par défaut. Passer `deleted_at: { [Op.not]: null }` ou `deleted_at: undefined` pour surcharge / désactiver le filtre. |

```ts
await UserModel.create({ name: "John Doe" });
// INSERT … status = 'active', created_at / updated_at = now, deleted_at = NULL

await WorkspaceUserModel.update(
  { role: "admin" },
  { where: { workspace_id, user_id } },
);

await WorkspaceUserModel.delete({
  where: { workspace_id, user_id },
});
```

### Cache Redis

`orm.redis` est un vrai client (`url` + `options`, `dbInstance`, `connect` / `disconnect` / `healthy`), comme `orm.postgres`.

Avec `orm.cache(true)`, `findOne` / `findAll` passent par Redis (TTL **5 minutes**). `create` / `update` / `updateOne` / `delete` / `deleteOne` invalident les clés concernées.

## Référence API

La référence publique est décrite via **TSDoc** dans `src/`.  
Les exports stables passent uniquement par [`src/index.ts`](../src/index.ts) : `Orm`, `defineModel`, `Op`, `runMigrations`, clients Postgres / Redis, et les types (`InferValues`, `WhereClause`, `$schema`, …).

## Exemple

[`examples/nodejs/`](../examples/nodejs/) — utilisateurs + memberships workspace, migrations `001` / `002`.
