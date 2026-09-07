import {
  createClient,
  type RedisClientOptions,
  type RedisClientType,
} from "redis";

/**
 * Options de connexion Redis.
 */
export type RedisOptions = {
  url: string;
  options?: Omit<RedisClientOptions, "url">;
};

type RedisDbInstance = RedisClientType;

/** TTL par défaut des clés de cache (5 minutes). */
export const REDIS_CACHE_TTL_SECONDS = 5 * 60;

/**
 * Client Redis — cache et files.
 *
 * Cycle de vie : initialisation → connexion → CRUD / cache / queue → déconnexion.
 * Comme {@link PostgresClient} : `url` + `options`, `dbInstance`, `connect` / `disconnect` / `healthy`.
 */
export class RedisClient {
  readonly url: string;
  readonly options: Omit<RedisClientOptions, "url">;
  dbInstance?: RedisDbInstance;

  constructor(options: RedisOptions = { url: "", options: {} }) {
    this.url = options.url ?? "";
    this.options = options.options ?? {};

    this.connect();
  }

  /** Indique si le client est instancié (comme `PostgresClient.connected`). */
  get connected(): boolean {
    return this.dbInstance !== undefined;
  }

  /**
   * Instancie le client Redis (comme `new Sequelize(...)`).
   * L’ouverture du socket a lieu à `healthy()` ou à la première commande.
   */
  async connect(): Promise<void> {
    if (!this.dbInstance) {
      this.dbInstance = createClient({
        url: this.url,
        ...this.options,
      }) as RedisDbInstance;
    }
  }

  /**
   * Écrit une valeur (CRUD / cache).
   * TTL par défaut : {@link REDIS_CACHE_TTL_SECONDS} (5 min). Passer `0` pour aucune expiration.
   *
   * @throws Si le client n'est pas connecté
   */
  async set(
    key: string,
    value: string,
    ttlSeconds: number = REDIS_CACHE_TTL_SECONDS,
  ): Promise<void> {
    await this.#ensureOpen();
    if (ttlSeconds > 0) {
      await this.dbInstance!.set(key, value, { expiration: { type: "EX", value: ttlSeconds } });
    } else {
      await this.dbInstance!.set(key, value);
    }
  }

  /**
   * Lit une valeur (CRUD / cache).
   *
   * @throws Si le client n'est pas connecté
   */
  async get(key: string): Promise<string | null> {
    await this.#ensureOpen();
    return (await this.dbInstance!.get(key)) ?? null;
  }

  async del(key: string): Promise<void> {
    await this.#ensureOpen();
    await this.dbInstance!.del(key);
  }

  async delStartWith(key: string): Promise<void> {
    await this.#ensureOpen();
    const keys: string[] = [];

    for await (const found of this.dbInstance!.scanIterator({
      MATCH: `${key}*`,
    })) {
      const batch = Array.isArray(found) ? found : [found];
      for (const item of batch) {
        if (item) {
          keys.push(item);
        }
      }
    }

    if (keys.length > 0) {
      for (const found of keys) {
        await this.dbInstance!.del(found);
      }
    }
  }

  /**
   * Enfile une valeur (liste Redis, FIFO).
   *
   * @throws Si le client n'est pas connecté
   */
  async enqueue(queue: string, value: string): Promise<void> {
    await this.#ensureOpen();
    await this.dbInstance!.rPush(queue, value);
  }

  /**
   * Défile une valeur (liste Redis, FIFO).
   *
   * @throws Si le client n'est pas connecté
   */
  async dequeue(queue: string): Promise<string | null> {
    await this.#ensureOpen();
    return (await this.dbInstance!.lPop(queue)) ?? null;
  }

  /** Ferme la connexion. */
  async disconnect(): Promise<void> {
    if (!this.dbInstance) {
      return;
    }
    if (this.dbInstance.isOpen) {
      await this.dbInstance.quit();
    }
    delete this.dbInstance;
  }

  #assertInstantiated(): void {
    if (!this.dbInstance) {
      throw new Error("RedisClient is not connected");
    }
  }

  async #ensureOpen(): Promise<void> {
    this.#assertInstantiated();
    if (!this.dbInstance!.isOpen) {
      await this.dbInstance!.connect();
    }
  }

  /** Indique si le client est sain (PING). */
  async healthy(): Promise<boolean> {
    try {
      if (!this.dbInstance) {
        return false;
      }
      if (!this.dbInstance.isOpen) {
        await this.dbInstance.connect();
      }
      const pong = await this.dbInstance.ping();
      return pong === "PONG";
    } catch (error) {
      console.error("Unable to connect to Redis:", error);
      return false;
    }
  }
}
