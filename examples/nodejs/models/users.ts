import { orm } from "../db.js";

/**
 * Table `users`.
 *
 * `created_at` / `updated_at` / `deleted_at` sont gérés par l'ORM :
 * horodatage automatique à la création et à la mise à jour, et filtre
 * `deleted_at: null` ajouté par défaut aux lectures.
 */
export const UserModel = orm.declareModel({
  name: "users",
  schema: {
    id: {
      type: "number",
      primary: true,
    },
    name: {
      type: "string",
    },
    status: {
      type: "string",
      enum: ["active", "inactive", "archived"],
      default: "active",
    },
    created_at: {
      type: "date",
    },
    updated_at: {
      type: "date",
    },
    deleted_at: {
      type: "date",
      nullable: true,
    },
  },
});

/**
 * Ligne inférée du schéma — `id: number`, `status: "active" | …`,
 * `deleted_at: Date | null`. Exemple de valeur :
 *
 * ```
 * {
 *   id: 1,
 *   name: 'John Doe',
 *   status: 'active',
 *   created_at: 2026-09-11T07:21:13.618Z,
 *   updated_at: 2026-09-11T07:21:13.618Z,
 *   deleted_at: null
 * }
 * ```
 */
export type UserRecord = typeof UserModel.$schema;
