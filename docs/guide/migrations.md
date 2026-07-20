# Migrations

Les migrations sont des modules TypeScript Sequelize (`up` / `down`), appliqués une seule fois et tracés en base.

## Pourquoi pas `AUTO_INCREMENT` ?

`AUTO_INCREMENT` est une syntaxe **MySQL**.  
PostgreSQL utilise `SERIAL` / `GENERATED … AS IDENTITY`.  
Avec Sequelize, on écrit `autoIncrement: true` : le dialecte Postgres génère le bon SQL.

## Principe

1. Fichiers `*.ts` dans un dossier (ex. `examples/nodejs/migrations/`)
2. Nommage ordonné : `001_create_users.ts`, `002_...`
3. Chaque fichier exporte `up(queryInterface, Sequelize, transaction)`
4. Table `migrations` : mémorise les fichiers déjà appliqués

## Exemple

```ts
import { DataTypes, type QueryInterface, type Transaction } from "sequelize";

export async function up(
  queryInterface: QueryInterface,
  _Sequelize: unknown,
  transaction: Transaction,
) {
  await queryInterface.createTable(
    "users",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      name: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
    },
    { transaction },
  );
}
```

## API

```ts
await orm.migrate("./migrations");
// → { applied: ["001_create_users.ts"], skipped: [] }
```

## Commandes

```bash
npm run migrate
npm run example:docker:migrate
```

## Adminer

http://localhost:8080 — serveur `postgres`, user/pass/db `orm`
