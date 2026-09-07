import { orm } from "../db.js";

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

/** Ligne inférée du schéma — `id: number`, `status: "active" | …`, `deleted_at: Date | null`. */
export type UserRecord = typeof UserModel.$schema;
