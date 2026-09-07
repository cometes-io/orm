import { orm } from "../db.js";

export const WorkspaceUserModel = orm.declareModel({
  name: "workspace_users",
  schema: {
    workspace_id: {
      type: "number",
    },
    user_id: {
      type: "number",
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

export type WorkspaceUserRecord = typeof WorkspaceUserModel.$schema;
