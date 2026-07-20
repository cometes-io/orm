import { DefineModelOptions, DefineModelSchema, Model, defineModel } from "./model/model.js";
import { runMigrations, type MigrateResult } from "./migrate/index.js";
import { PostgresClient, type PostgresOptions } from "./postgres/index.js";
import { RedisClient, type RedisOptions } from "./redis/index.js";

/**
 * Options de configuration d'une instance {@link Orm}.
 */
export type OrmOptions = {
  /** Options PostgreSQL (persistance). */
  postgres?: PostgresOptions;
  /** Options Redis (cache / files). */
  redis?: RedisOptions;
};

/**
 * Point d'entrée de l'ORM.
 *
 * Agrège les clients PostgreSQL et Redis.
 *
 * @example
 * ```ts
 * const orm = new Orm({
 *   postgres: { url: "postgres://orm:orm@localhost:5432/orm" },
 * });
 * await orm.migrate("./migrations");
 * ```
 */
export class Orm {
  /** Client PostgreSQL. */
  readonly postgres: PostgresClient;
  /** Client Redis. */
  readonly redis: RedisClient;
  /** Modèles déclarés. */
  readonly models: Model[] = [];

  /**
   * Crée une instance ORM.
   *
   * @param options - Configuration optionnelle
   */
  constructor(options: OrmOptions = {}) {
    this.postgres = new PostgresClient(options.postgres);
    this.redis = new RedisClient(options.redis);
  }

  /**
   * Vérifie que l'instance répond (stub de santé).
   *
   * @returns État de santé postgres / redis
   */
  async ping(): Promise<{ postgres: boolean; redis: boolean }> {
    return {
      postgres: await this.postgres.healthy(),
      redis: this.redis.healthy(),
    };
  }

  /** Connecte PostgreSQL et Redis. */
  async connect(): Promise<void> {
    await Promise.all([this.postgres.connect(), this.redis.connect()]);
  }

  /** Déconnecte PostgreSQL et Redis. */
  async disconnect(): Promise<void> {
    await Promise.all([this.postgres.disconnect(), this.redis.disconnect()]);
  }

  /**
   * Applique les migrations SQL d'un dossier.
   *
   * @param directory - Chemin vers les fichiers `*.sql`
   */
  async migrate(directory: string): Promise<MigrateResult> {
    await this.connect();
    return runMigrations(this.postgres, { directory });
  }

  /** Déclare un modèle (table / collection) avec son schéma. */
  declareModel<TSchema extends Record<string, DefineModelSchema>>(
    options: DefineModelOptions<TSchema>,
  ): Model<TSchema> {
    if (!this.postgres.dbInstance) {
      throw new Error("PostgreSQL database instance not found");
    }

    const model = defineModel<TSchema, PostgresClient>(options, this.postgres);
    this.models.push(model as unknown as Model);
    return model;
  }
}
