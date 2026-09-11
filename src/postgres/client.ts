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

/**
 * Options de connexion PostgreSQL.
 */
export type PostgresOptions = {
  url: string;
  options?: Options;
};

/**
 * Client PostgreSQL (Sequelize).
 *
 * Le constructeur instancie Sequelize ; `healthy()` authentifie vraiment.
 */
export class PostgresClient {
  readonly url: string;
  readonly options: Options;
  dbInstance?: Sequelize;

  constructor(options: PostgresOptions = { url: "", options: {} as Options }) {
    this.url = options.url ?? "";
    this.options = options.options ?? {};

    this.connect();
  }

  /** Indique si une instance Sequelize est disponible (pas un ping TCP). */
  get connected(): boolean {
    return this.dbInstance !== undefined;
  }

  /**
   * Instancie Sequelize. La connexion TCP a lieu au premier usage
   * (`authenticate`, requête, `healthy()`).
   */
  async connect(): Promise<void> {
    this.dbInstance = new Sequelize(this.url, this.options);
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
    if (!this.dbInstance) {
      return;
    }
    await this.dbInstance.close();
    delete this.dbInstance;
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
