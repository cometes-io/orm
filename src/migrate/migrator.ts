import { readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  Sequelize,
  type QueryInterface,
  type Transaction,
} from "sequelize";
import type { PostgresClient } from "../postgres/client.js";

const MIGRATIONS_TABLE = "migrations";

/**
 * Contrat d'une migration TypeScript (style Sequelize).
 */
export type MigrationModule = {
  up: (
    queryInterface: QueryInterface,
    sequelize: typeof Sequelize,
    transaction: Transaction,
  ) => Promise<void>;
  down?: (
    queryInterface: QueryInterface,
    sequelize: typeof Sequelize,
    transaction: Transaction,
  ) => Promise<void>;
};

export type MigrateOptions = {
  /** Dossier contenant les fichiers `*.ts` (triés par nom). */
  directory: string;
};

export type MigrateResult = {
  /** Migrations appliquées pendant cet appel. */
  applied: string[];
  /** Migrations déjà présentes en base. */
  skipped: string[];
};

/**
 * Applique les migrations TypeScript versionnées d'un dossier.
 *
 * - Crée la table `migrations` si besoin
 * - Charge chaque `*.ts` non encore appliqué (ordre alphabétique)
 * - Appelle `up(queryInterface, Sequelize, transaction)`
 */
export async function runMigrations(
  client: PostgresClient,
  options: MigrateOptions,
): Promise<MigrateResult> {
  const sequelize = client.dbInstance;
  if (!sequelize) {
    throw new Error("PostgreSQL database instance not found");
  }

  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const [rows] = await sequelize.query(
    `SELECT name FROM ${MIGRATIONS_TABLE} ORDER BY name ASC`,
  );
  const appliedSet = new Set(
    (rows as Array<{ name: string }>).map((row) => row.name),
  );

  const files = (await readdir(options.directory))
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".d.ts"))
    .sort((a, b) => a.localeCompare(b));

  const applied: string[] = [];
  const skipped: string[] = [];
  const queryInterface = sequelize.getQueryInterface();

  for (const file of files) {
    if (appliedSet.has(file)) {
      skipped.push(file);
      continue;
    }

    const moduleUrl = pathToFileURL(path.join(options.directory, file)).href;
    const migration = (await import(moduleUrl)) as MigrationModule;

    if (typeof migration.up !== "function") {
      throw new Error(`Migration ${file} must export an async function up()`);
    }

    await sequelize.transaction(async (transaction) => {
      await migration.up(queryInterface, Sequelize, transaction);
      await sequelize.query(
        `INSERT INTO ${MIGRATIONS_TABLE} (name) VALUES (:name)`,
        {
          replacements: { name: file },
          transaction,
        },
      );
    });

    applied.push(file);
  }

  return { applied, skipped };
}
