import { Sequelize, Options, DataTypes } from "sequelize";
import { DefineModelSchema } from "../index.js";
import { TValues } from "../model/model.js";

/**
 * Options de connexion PostgreSQL.
 */
export type PostgresOptions = {
  url: string;
  options?: Options;
};

/**
 * Client PostgreSQL — persistance (stub).
 *
 * Cycle de vie : initialisation → connexion → CRUD → déconnexion.
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

  /** Indique si le client est connecté. */
  get connected(): boolean {
    return this.dbInstance !== undefined;
  }

  /** Établit la connexion (stub). */
  async connect(): Promise<void> {
    // sequelize connect
    this.dbInstance = new Sequelize(this.url, this.options);
  }

  /**
   * Exécute une requête SQL (stub CRUD).
   *
   * @throws Si le client n'est pas connecté
   */
  async query<T = unknown>(sql: string, _params: unknown[] = []): Promise<T[]> {
    if (!this.dbInstance) {
      throw new Error("PostgresClient is not connected");
    }
    void sql;
    return [];
  }

  /** Ferme la connexion. */
  async disconnect(): Promise<void> {
    if (!this.dbInstance) {
      throw new Error("PostgresClient is not connected");
    }
    await this.dbInstance.close();
    this.dbInstance = undefined as unknown as Sequelize;
  }

  /** Indique si le client est sain et ses informations de santé. */
  async healthy(): Promise<boolean> {
    try {
      if(!this.dbInstance) {
        return false;
      }
      await this.dbInstance.authenticate();
      return true;
    } catch (error) {
      console.error('Unable to connect to the database:', error);
      return false;
    }
  }

  formatModelSchema(schema: Record<string, DefineModelSchema>) {
    const list: Record<string, any> = {};

    const getType = (type: string) => {
      switch(type) {
        case 'string':
          return DataTypes.STRING;
        case 'number':
          return DataTypes.INTEGER;
        case 'boolean':
          return DataTypes.BOOLEAN;
        case 'float':
          return DataTypes.FLOAT;
        case 'date':
          return DataTypes.DATE;
        default:
          throw new Error(`Unknown type: ${type}`);
      }
    }

    for(const [key, value] of Object.entries(schema)) {
      list[key] = {
        type: getType(value.type),
        primaryKey: value.primary ?? false,
      }
    }

    console.log('formatModelSchema', list);

    return list;
  }

  getFieldsFromSchema(schema: TValues, attributes: Record<string, any>) {
    const list: Record<string, any> = {};

    for(const [key, value] of Object.entries(schema)) {
      if(attributes[key]) {
        list[key] = value;
      }
    }

    return list;
  }
}
