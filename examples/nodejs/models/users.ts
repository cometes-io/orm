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
  },
});
