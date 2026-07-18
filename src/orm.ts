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
};

/**
 * Point d'entrée de l'ORM.
 *
 * @example
 * ```ts
 * const orm = new Orm({ name: "demo" });
 * console.log(orm.ping()); // "orm:demo"
 * ```
 */
export class Orm {
  /** Identifiant logique de cette instance. */
  readonly name: string;

  /**
   * Crée une instance ORM.
   *
   * @param options - Configuration optionnelle
   */
  constructor(options: OrmOptions = {}) {
    this.name = options.name ?? "default";
  }

  /**
   * Vérifie que l'instance répond (stub de santé).
   *
   * @returns Chaîne au format `orm:<name>`
   */
  ping(): string {
    return `orm:${this.name}`;
  }
}


/// ON MANIPULES POSTGRESQL
//// INITIALISATION
//// CONNEXION
//// CRUD
//// DECONNEXION

/// ON MANIPULES REDIS
//// INITIALISATION
//// CONNEXION
//// CRUD + CACHE + QUEUE
//// DECONNEXION