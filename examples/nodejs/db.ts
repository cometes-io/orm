import { Orm } from "../../src/index.js";

/**
 * Instance ORM partagée de l'exemple.
 * Les modèles l'importent pour se déclarer via `orm.declareModel(...)`.
 */
export const orm = new Orm({
  postgres: {
    url: process.env.POSTGRES_URL ?? "postgres://orm:orm@postgres:5432/orm",
  },
  redis: {
    url: process.env.REDIS_URL ?? "redis://redis:6379",
  },
});
