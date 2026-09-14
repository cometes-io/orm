import { Sequelize, Options, DataTypes, type Transaction } from "sequelize";
import { DefineModelSchema } from "../index.js";
import {
  TABLE_LOCK_MODES,
  type TableLockMode,
  type TValues,
} from "../model/model.js";

/** `LOCK TABLE` n'accepte qu'un identifiant SQL simple (`users` ou `public.users`). */
const TABLE_NAME_PART = /^[A-Za-z_][A-Za-z0-9_]*$/;

const isSafeTableName = (table: string): boolean =>
  table.length > 0 && table.split(".").every((part) => TABLE_NAME_PART.test(part));

/** Intervalle par défaut du ping keep-alive (30 s). */
export const POSTGRES_KEEP_ALIVE_INTERVAL_MS = 30_000;

/**
 * Ping périodique et pool Sequelize pour ne pas laisser Postgres
 * (ou un NAT / un serveur serverless) couper la connexion.
 */
export type PostgresKeepAliveOptions = {
  /** Intervalle du `SELECT 1`. Défaut : {@link POSTGRES_KEEP_ALIVE_INTERVAL_MS}. */
  intervalMs?: number;
};

/**
 * Options de connexion PostgreSQL.
 */
export type PostgresOptions = {
  url: string;
  options?: Options;
  /**
   * Garde le pool ouvert et ping Postgres pour éviter la mise en veille.
   * `true` utilise un ping toutes les 30 s.
   */
  keepAlive?: boolean | PostgresKeepAliveOptions;
};

type NormalizedKeepAlive = false | { intervalMs: number };

const normalizeKeepAlive = (
  value: PostgresOptions["keepAlive"],
): NormalizedKeepAlive => {
  if (!value) {
    return false;
  }
  const intervalMs =
    value === true
      ? POSTGRES_KEEP_ALIVE_INTERVAL_MS
      : (value.intervalMs ?? POSTGRES_KEEP_ALIVE_INTERVAL_MS);
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new Error("keepAlive.intervalMs must be a positive number");
  }
  return { intervalMs };
};

const sequelizeOptionsWithKeepAlive = (
  options: Options,
  intervalMs: number,
): Options => {
  const idleFloor = intervalMs * 2;
  const dialectOptions = {
    ...(options.dialectOptions as Record<string, unknown> | undefined),
    keepAlive: true,
    keepAliveInitialDelayMillis:
      (options.dialectOptions as { keepAliveInitialDelayMillis?: number } | undefined)
        ?.keepAliveInitialDelayMillis ?? 10_000,
  };
  return {
    ...options,
    pool: {
      max: 5,
      acquire: 60_000,
      ...options.pool,
      min: Math.max(options.pool?.min ?? 1, 1),
      idle: Math.max(options.pool?.idle ?? idleFloor, idleFloor),
    },
    dialectOptions,
  };
};

/**
 * Client PostgreSQL (Sequelize).
 *
 * Le constructeur instancie Sequelize ; `healthy()` authentifie vraiment.
 */
export class PostgresClient {
  readonly url: string;
  readonly options: Options;
  /** `false` si le keep-alive est coupé. */
  readonly keepAlive: NormalizedKeepAlive;
  dbInstance?: Sequelize;
  #keepAliveTimer: ReturnType<typeof setInterval> | undefined = undefined;

  constructor(options: PostgresOptions = { url: "", options: {} as Options }) {
    this.url = options.url ?? "";
    this.options = options.options ?? {};
    this.keepAlive = normalizeKeepAlive(options.keepAlive);

    this.connect();
  }

  /** Indique si une instance Sequelize est disponible (pas un ping TCP). */
  get connected(): boolean {
    return this.dbInstance !== undefined;
  }

  /**
   * Instancie Sequelize. Sans `keepAlive`, la connexion TCP a lieu au
   * premier usage. Avec `keepAlive`, authentifie tout de suite et ping.
   */
  async connect(): Promise<void> {
    this.#stopKeepAlive();
    const sequelizeOptions = this.keepAlive
      ? sequelizeOptionsWithKeepAlive(this.options, this.keepAlive.intervalMs)
      : this.options;
    const sequelize = new Sequelize(this.url, sequelizeOptions);
    this.dbInstance = sequelize;

    if (!this.keepAlive) {
      return;
    }

    try {
      await sequelize.authenticate();
    } catch {
      // `healthy()` / `ping()` exposent l'échec ; le ping retentera.
    }

    if (this.dbInstance !== sequelize) {
      return;
    }

    this.#startKeepAlive();
  }

  /**
   * Exécute une requête SQL brute et renvoie les lignes.
   *
   * Les paramètres sont liés (`$1`, `$2`, …), jamais concaténés.
   *
   * @throws Si le client n'est pas connecté
   */
  async query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    if (!this.dbInstance) {
      throw new Error("PostgresClient is not connected");
    }

    const [rows] = await this.dbInstance.query(sql, {
      ...(params.length > 0 ? { bind: params } : {}),
      logging: false,
    });

    return (rows ?? []) as T[];
  }

  /** Démarre une transaction Sequelize (`BEGIN`). */
  async begin(logging: false | ((sql: string) => void) = false): Promise<Transaction> {
    if (!this.dbInstance) {
      throw new Error("PostgresClient is not connected");
    }
    return this.dbInstance.transaction({ logging });
  }

  /** `LOCK TABLE … IN <mode> MODE` (dans une transaction). */
  async lockTable(
    table: string,
    mode: TableLockMode,
    transaction: Transaction,
    logging: false | ((sql: string) => void) = false,
  ): Promise<void> {
    if (!this.dbInstance) {
      throw new Error("PostgresClient is not connected");
    }
    if (!isSafeTableName(table)) {
      throw new Error("Invalid table name");
    }
    if (!TABLE_LOCK_MODES.includes(mode)) {
      throw new Error("Invalid lock mode");
    }
    const quoted = table
      .split(".")
      .map((part) => `"${part}"`)
      .join(".");
    await this.dbInstance.query(`LOCK TABLE ${quoted} IN ${mode} MODE`, {
      transaction,
      logging,
    });
  }

  /** Ferme la connexion. */
  async disconnect(): Promise<void> {
    this.#stopKeepAlive();
    if (!this.dbInstance) {
      return;
    }
    await this.dbInstance.close();
    delete this.dbInstance;
  }

  #startKeepAlive(): void {
    if (!this.keepAlive) {
      return;
    }
    this.#stopKeepAlive();
    const intervalMs = this.keepAlive.intervalMs;
    this.#keepAliveTimer = setInterval(() => {
      const sequelize = this.dbInstance;
      if (!sequelize) {
        return;
      }
      void sequelize
        .query("SELECT 1", { logging: false })
        .catch(() => sequelize.authenticate().catch(() => undefined));
    }, intervalMs);
    this.#keepAliveTimer.unref();
  }

  #stopKeepAlive(): void {
    if (!this.#keepAliveTimer) {
      return;
    }
    clearInterval(this.#keepAliveTimer);
    this.#keepAliveTimer = undefined;
  }

  /** Indique si le client est joignable (`authenticate`). */
  async healthy(): Promise<boolean> {
    try {
      if (!this.dbInstance) {
        return false;
      }
      await this.dbInstance.authenticate();
      return true;
    } catch (error) {
      console.error("Unable to connect to the database:", error);
      return false;
    }
  }

  /**
   * Convertit le schéma ORM en attributs Sequelize
   * (`ENUM`, `defaultValue`, `references`).
   *
   * `autoIncrement` n'est posé que sur une clé primaire numérique unique :
   * une clé composite (table de liaison) n'est jamais auto-incrémentée.
   */
  formatModelSchema(schema: Record<string, DefineModelSchema>) {
    const attributes: Record<string, any> = {};
    const primaryFields = Object.values(schema).filter((field) => field.primary);
    const autoIncrementPrimary =
      primaryFields.length === 1 && primaryFields[0]?.type === "number";

    for (const [column, field] of Object.entries(schema)) {
      const enumValues = field.enum;
      const sequelizeType =
        field.type === "string" && enumValues && enumValues.length > 0
          ? DataTypes.ENUM(...(enumValues.map(String) as [string, ...string[]]))
          : toSequelizeDataType(field.type);

      attributes[column] = {
        type: sequelizeType,
        primaryKey: field.primary ?? false,
        autoIncrement: (field.primary ?? false) && autoIncrementPrimary,
        allowNull: field.primary ? false : field.nullable === true,
        ...(field.default !== undefined ? { defaultValue: field.default } : {}),
        ...(field.references
          ? {
              references: {
                model: field.references.model.name,
                key: field.references.key,
              },
            }
          : {}),
      };
    }

    return attributes;
  }

  /** Ne conserve que les champs présents dans les attributs Sequelize. */
  getFieldsFromSchema(values: TValues, attributes: Record<string, any>) {
    const fields: Record<string, any> = {};

    for (const [key, value] of Object.entries(values)) {
      if (attributes[key]) {
        fields[key] = value;
      }
    }

    return fields;
  }

  /** Ne conserve que les colonnes réellement définies sur le modèle. */
  getColumnsFromSchema(columns: string[], attributes: Record<string, any>) {
    return columns.filter((column) => Boolean(attributes[column]));
  }
}

const toSequelizeDataType = (type: string) => {
  switch (type) {
    case "string":
      return DataTypes.STRING;
    case "number":
      return DataTypes.INTEGER;
    case "boolean":
      return DataTypes.BOOLEAN;
    case "float":
      return DataTypes.FLOAT;
    case "date":
      return DataTypes.DATE;
    default:
      throw new Error(`Unknown type: ${type}`);
  }
};
