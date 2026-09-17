import { AsyncLocalStorage } from "node:async_hooks";
import type { Transaction } from "sequelize";
import {
  DefineModelOptions,
  DefineModelSchema,
  Model,
  defineModel,
  type LockClause,
  type LockTableOptions,
} from "./model/model.js";
import { runMigrations, type MigrateResult } from "./migrate/index.js";
import { PostgresClient, type MysqlOptions, type PostgresOptions } from "./postgres/index.js";
import { RedisClient, type RedisOptions } from "./redis/index.js";

type AsyncContext = {
  transaction: Transaction | null;
  lock: Exclude<LockClause, false> | null;
};

/** Fonction qui reçoit le SQL journalisé par Sequelize. */
export type SequelizeLogOutput = (sql: string, timing?: number) => void;

/**
 * Options de configuration d'une instance {@link Orm}.
 */
export type OrmOptions = {
  /** Options PostgreSQL (persistance). Incompatible avec {@link OrmOptions.mysql}. */
  postgres?: PostgresOptions;
  /** Options MySQL / MariaDB. Incompatible avec {@link OrmOptions.postgres}. */
  mysql?: MysqlOptions;
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
 * // ou MySQL :
 * const mysqlOrm = new Orm({
 *   mysql: { url: "mysql://orm:orm@localhost:3306/orm" },
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
  /** Si `true`, `findOne` / `findAll` simples passent par Redis. */
  cacheEnabled: boolean = false;
  /** Si `true`, Sequelize journalise le SQL. */
  logEnabled: boolean = false;
  /** Destination des logs SQL (`console.log` par défaut). */
  #logOutput: SequelizeLogOutput = console.log;
  /**
   * Contexte async (requête HTTP, `begin()`, `transaction()`).
   * Deux `begin()` en parallèle n'écrasent plus la même case mémoire.
   */
  readonly #async = new AsyncLocalStorage<AsyncContext>();
  #fallbackTransaction: Transaction | null = null;
  #fallbackLock: Exclude<LockClause, false> | null = null;
  /** `true` le temps que `begin()` attende Postgres — refuse un second `begin()` parallèle. */
  #beginOpening = false;

  /** Transaction Sequelize du contexte courant, ou `null`. */
  get currentTransaction(): Transaction | null {
    return this.#async.getStore()?.transaction ?? this.#fallbackTransaction;
  }

  set currentTransaction(value: Transaction | null) {
    const store = this.#async.getStore();
    if (store) {
      store.transaction = value;
      return;
    }
    this.#fallbackTransaction = value;
  }

  /** Verrou de lignes du contexte courant, ou `null`. */
  get currentLock(): Exclude<LockClause, false> | null {
    return this.#async.getStore()?.lock ?? this.#fallbackLock;
  }

  set currentLock(value: Exclude<LockClause, false> | null) {
    const store = this.#async.getStore();
    if (store) {
      store.lock = value;
      return;
    }
    this.#fallbackLock = value;
  }

  /**
   * Crée une instance ORM.
   *
   * @param options - Configuration optionnelle
   */
  constructor(options: OrmOptions = {}) {
    if (options.postgres && options.mysql) {
      throw new Error("Use either postgres or mysql, not both");
    }
    this.postgres = new PostgresClient(
      options.mysql
        ? { ...options.mysql, dialect: "mysql" }
        : options.postgres,
    );
    this.redis = new RedisClient(options.redis);
  }

  /**
   * Vérifie que l'instance répond.
   *
   * `postgres` / `mysql` : seul le dialecte configuré est sondé, l'autre vaut `false`.
   */
  async ping(): Promise<{
    postgres: boolean;
    mysql: boolean;
    redis: boolean;
  }> {
    const sql = await this.postgres.healthy();
    const mysql = this.postgres.dialect === "mysql";
    return {
      postgres: mysql ? false : sql,
      mysql: mysql ? sql : false,
      redis: await this.redis.healthy(),
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
   * Applique les migrations TypeScript d'un dossier (`*.ts`, tri alphabétique).
   */
  async migrate(directory: string): Promise<MigrateResult> {
    await this.connect();
    return runMigrations(this.postgres, { directory });
  }

  /** Déclare un modèle (table / collection) avec son schéma. */
  declareModel<
    const TSchema extends Record<string, DefineModelSchema>,
    TName extends string,
  >(options: DefineModelOptions<TSchema, TName>): Model<TSchema, TName> {
    if (!this.postgres.dbInstance) {
      throw new Error("PostgreSQL database instance not found");
    }

    const model = defineModel<TSchema, Orm, TName>(options, this);
    this.models.push(model as unknown as Model);
    return model;
  }

  /** Active ou coupe le cache Redis des lectures. */
  cache(value: boolean = true): void {
    this.cacheEnabled = value;
  }

  /** Active ou coupe les logs SQL Sequelize. */
  log(value: boolean = true): void {
    this.logEnabled = value;
  }

  /**
   * Choisit où Sequelize envoie le SQL (`console.log` par défaut).
   *
   * N’active pas les logs : appeler aussi {@link Orm.log}.
   */
  logTo(output: SequelizeLogOutput): void {
    this.#logOutput = output;
  }

  /** Option `logging` Sequelize dérivée de `logEnabled` et {@link Orm.logTo}. */
  sequelizeLogging(): false | SequelizeLogOutput {
    return this.logEnabled ? this.#logOutput : false;
  }

  /**
   * Démarre une transaction (`BEGIN`).
   *
   * Les appels suivants aux modèles l’utilisent tant qu’elle n’est pas
   * commitée / rollback, sauf si `transaction` est passé explicitement.
   *
   * Le contexte suit la chaîne async courante (ex. une requête HTTP).
   * Un seul `begin()` à la fois par instance : un second appel en parallèle
   * (`Promise.all`) lève une erreur. Pour du parallèle, utiliser
   * {@link Orm.transaction}.
   */
  async begin(): Promise<Transaction> {
    if (this.currentTransaction) {
      throw new Error("A transaction is already in progress");
    }
    if (this.#beginOpening) {
      throw new Error(
        "Concurrent begin() is not supported; use orm.transaction(fn)",
      );
    }

    this.#beginOpening = true;
    try {
      let store = this.#async.getStore();
      if (!store) {
        store = { transaction: null, lock: null };
        this.#async.enterWith(store);
      }

      const tx = await this.postgres.begin(this.sequelizeLogging());
      store.transaction = tx;
      store.lock = null;
      return tx;
    } finally {
      this.#beginOpening = false;
    }
  }

  /**
   * Exécute `fn` dans une transaction isolée (commit / rollback automatiques).
   *
   * Préférer cet API dès que plusieurs tâches concurrentes partagent la même
   * instance `Orm` : le contexte ne fuite pas d'un appel à l'autre.
   */
  async transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    const tx = await this.postgres.begin(this.sequelizeLogging());
    return this.#async.run({ transaction: tx, lock: null }, async () => {
      try {
        const result = await fn(tx);
        await tx.commit();
        return result;
      } catch (error) {
        try {
          await tx.rollback();
        } catch {
          // Déjà rollbackée, ou connexion fermée.
        }
        throw error;
      }
    });
  }

  /** Valide la transaction en cours, ou celle passée en argument (`COMMIT`). */
  async commit(transaction?: Transaction): Promise<void> {
    const tx = transaction ?? this.currentTransaction;
    if (!tx) {
      throw new Error("No transaction in progress");
    }
    await tx.commit();
    if (this.currentTransaction === tx) {
      this.currentTransaction = null;
      this.currentLock = null;
    }
  }

  /** Annule la transaction en cours, ou celle passée en argument (`ROLLBACK`). */
  async rollback(transaction?: Transaction): Promise<void> {
    const tx = transaction ?? this.currentTransaction;
    if (!tx) {
      throw new Error("No transaction in progress");
    }
    try {
      await tx.rollback();
    } finally {
      if (this.currentTransaction === tx) {
        this.currentTransaction = null;
        this.currentLock = null;
      }
    }
  }

  /**
   * Active un verrou dans la transaction courante.
   *
   * - `orm.lock()` / `orm.lock("SHARE")` : `SELECT … FOR UPDATE` (ou le mode)
   *   sur les `findOne` / `findAll` suivants.
   * - `orm.lock({ table: "users" })` : `LOCK TABLE` PostgreSQL.
   */
  async lock(
    options: Exclude<LockClause, false> | LockTableOptions = true,
  ): Promise<void> {
    const tx = this.currentTransaction;
    if (!tx) {
      throw new Error("A transaction is required to lock");
    }

    if (typeof options === "object") {
      await this.postgres.lockTable(
        options.table,
        options.mode ?? "EXCLUSIVE",
        tx,
        this.sequelizeLogging(),
      );
      return;
    }

    this.currentLock = options === true ? "UPDATE" : options;
  }

  /**
   * Désactive le verrou de lignes courant (`FOR UPDATE`).
   * Les `LOCK TABLE` restent jusqu’au `commit` / `rollback`.
   */
  unlock(): void {
    this.currentLock = null;
  }
}
