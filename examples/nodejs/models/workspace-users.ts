import { orm } from "../db.js";
import { UserModel } from "./users.js";

/**
 * Table de liaison workspace ↔ user.
 *
 * `user_id` porte une clé étrangère vers `users.id` : c'est elle qui rend
 * possible `include: [{ model: UserModel }]` ici, et l'include 1→N dans
 * l'autre sens (`UserModel.findOne({ include: [{ model: WorkspaceUserModel }] })`).
 * `UserModel` doit donc être déclaré avant ce modèle.
 *
 * La clé primaire est composite (`workspace_id` + `user_id`) : aucune colonne
 * `id` n'est générée, et rien n'est auto-incrémenté.
 */
export const WorkspaceUserModel = orm.declareModel({
  name: "workspace_users",
  schema: {
    workspace_id: {
      type: "number",
      primary: true,
    },
    user_id: {
      type: "number",
      primary: true,
      // L'alias du résultat est déduit du nom du champ : user_id → `user`.
      // `reverseAs` nomme la collection vue depuis `users` (sans lui :
      // `workspace_users`, le nom de cette table).
      references: {
        model: UserModel,
        key: "id",
        reverseAs: "memberships",
      },
    },
    role: {
      type: "string",
      enum: ["member", "admin"],
      default: "member",
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
 * Ligne inférée du schéma — `role: "member" | "admin"`,
 * `deleted_at: Date | null`. Exemple de valeur :
 *
 * ```
 * {
 *   workspace_id: 1,
 *   user_id: 1,
 *   role: 'member',
 *   created_at: 2026-09-11T07:21:13.618Z,
 *   updated_at: 2026-09-11T07:21:13.618Z,
 *   deleted_at: null
 * }
 * ```
 *
 * Avec un `include` sur `user_id`, la ligne jointe s'ajoute sous l'alias
 * `user` : `{ workspace_id: 1, user_id: 1, role: 'member', user: { … } }`.
 */
export type WorkspaceUserRecord = typeof WorkspaceUserModel.$schema;
