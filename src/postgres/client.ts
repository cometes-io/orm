/**
 * Options de connexion PostgreSQL.
 */
export type PostgresOptions = {
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
};

/**
 * Client PostgreSQL — persistance (stub).
 *
 * Cycle de vie : initialisation → connexion → CRUD → déconnexion.
 */
export class PostgresClient {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly database: string;
  #password: string;
  #connected = false;

  constructor(options: PostgresOptions = {}) {
    this.host = options.host ?? "localhost";
    this.port = options.port ?? 5432;
    this.user = options.user ?? "orm";
    this.database = options.database ?? "orm";
    this.#password = options.password ?? "orm";
  }

  /** Indique si le client est connecté. */
  get connected(): boolean {
    return this.#connected;
  }

  /** Établit la connexion (stub). */
  async connect(): Promise<void> {
    void this.#password;
    this.#connected = true;
  }

  /**
   * Exécute une requête SQL (stub CRUD).
   *
   * @throws Si le client n'est pas connecté
   */
  async query<T = unknown>(sql: string, _params: unknown[] = []): Promise<T[]> {
    if (!this.#connected) {
      throw new Error("PostgresClient is not connected");
    }
    void sql;
    return [];
  }

  /** Ferme la connexion. */
  async disconnect(): Promise<void> {
    this.#connected = false;
  }
}
