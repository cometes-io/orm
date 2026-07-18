import { PostgresClient, type PostgresOptions } from "./postgres/index.js";
import { RedisClient, type RedisOptions } from "./redis/index.js";

/**
 * Options de configuration d'une instance {@link Orm}.
 */
export type OrmOptions = {
  /**
   * Identifiant logique de l'instance.
   *
   * Utile pour distinguer plusieurs connexions (ex. `"primary"`, `"readonly"`).
   * @defaultValue `"default"`
   */
  name?: string;
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
 * const orm = new Orm({ name: "demo" });
 * await orm.connect();
 * console.log(orm.ping()); // "orm:demo"
 * await orm.disconnect();
 * ```
 */
export class Orm {
  /** Identifiant logique de cette instance. */
  readonly name: string;
  /** Client PostgreSQL. */
  readonly postgres: PostgresClient;
  /** Client Redis. */
  readonly redis: RedisClient;

  /**
   * Crée une instance ORM.
   *
   * @param options - Configuration optionnelle
   */
  constructor(options: OrmOptions = {}) {
    this.name = options.name ?? "default";
    this.postgres = new PostgresClient(options.postgres);
    this.redis = new RedisClient(options.redis);
  }

  /**
   * Vérifie que l'instance répond (stub de santé).
   *
   * @returns Chaîne au format `orm:<name>`
   */
  ping(): string {
    return `orm:${this.name}`;
  }

  /** Connecte PostgreSQL et Redis. */
  async connect(): Promise<void> {
    await Promise.all([this.postgres.connect(), this.redis.connect()]);
  }

  /** Déconnecte PostgreSQL et Redis. */
  async disconnect(): Promise<void> {
    await Promise.all([this.postgres.disconnect(), this.redis.disconnect()]);
  }
}
