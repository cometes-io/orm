/**
 * Options de connexion Redis.
 */
export type RedisOptions = {
  url: string;
};

/**
 * Client Redis — cache et files (stub).
 *
 * Cycle de vie : initialisation → connexion → CRUD / cache / queue → déconnexion.
 */
export class RedisClient {
  readonly url: string;
  #connected = false;
  readonly #store = new Map<string, string>();

  constructor(options: RedisOptions = { url: "" }) {
    this.url = options.url ?? "";

    this.connect();
  }

  /** Indique si le client est connecté. */
  get connected(): boolean {
    return this.#connected;
  }

  /** Établit la connexion (stub). */
  async connect(): Promise<void> {
    this.#connected = true;
  }

  /**
   * Écrit une valeur (CRUD / cache).
   *
   * @throws Si le client n'est pas connecté
   */
  async set(key: string, value: string): Promise<void> {
    this.#assertConnected();
    this.#store.set(key, value);
  }

  /**
   * Lit une valeur (CRUD / cache).
   *
   * @throws Si le client n'est pas connecté
   */
  async get(key: string): Promise<string | null> {
    this.#assertConnected();
    return this.#store.get(key) ?? null;
  }

  async del(key: string): Promise<void> {
    this.#assertConnected();
    this.#store.delete(key);
  }

  async delStartWith(key: string): Promise<void> {
    this.#assertConnected();
    for(const k of this.#store.keys()) {
      if(k.startsWith(key)) {
        this.#store.delete(k);
      }
    }
  }


  /**
   * Enfile une valeur (queue stub).
   *
   * @throws Si le client n'est pas connecté
   */
  async enqueue(queue: string, value: string): Promise<void> {
    this.#assertConnected();
    const existing = this.#store.get(queue);
    const items = existing ? (JSON.parse(existing) as string[]) : [];
    items.push(value);
    this.#store.set(queue, JSON.stringify(items));
  }

  /**
   * Défile une valeur (queue stub).
   *
   * @throws Si le client n'est pas connecté
   */
  async dequeue(queue: string): Promise<string | null> {
    this.#assertConnected();
    const existing = this.#store.get(queue);
    if (!existing) {
      return null;
    }
    const items = JSON.parse(existing) as string[];
    const value = items.shift() ?? null;
    this.#store.set(queue, JSON.stringify(items));
    return value;
  }

  /** Ferme la connexion et vide le store mémoire. */
  async disconnect(): Promise<void> {
    this.#connected = false;
    this.#store.clear();
  }

  #assertConnected(): void {
    if (!this.#connected) {
      throw new Error("RedisClient is not connected");
    }
  }

  /** Indique si le client est sain. */
  healthy(): boolean {
    return this.connected ?? false;
  }
}
