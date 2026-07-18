import { Orm } from "../../src/index.js";

/**
 * Exemple d'utilisation de l'ORM depuis Node.js (TypeScript).
 * Lancer avec : npm run example
 * Ou via Docker Compose : docker compose -f examples/docker-compose.yml up --build
 */
const orm = new Orm({
  name: "demo",
  postgres: {
    host: process.env.POSTGRES_HOST ?? "localhost",
    port: Number(process.env.POSTGRES_PORT ?? "5432"),
    user: process.env.POSTGRES_USER ?? "orm",
    password: process.env.POSTGRES_PASSWORD ?? "orm",
    database: process.env.POSTGRES_DB ?? "orm",
  },
  redis: {
    host: process.env.REDIS_HOST ?? "localhost",
    port: Number(process.env.REDIS_PORT ?? "6379"),
  },
});

await orm.connect();

console.log(orm.ping());
console.log(
  `PostgreSQL → ${orm.postgres.host}:${orm.postgres.port} (connected=${orm.postgres.connected})`,
);
console.log(
  `Redis      → ${orm.redis.host}:${orm.redis.port} (connected=${orm.redis.connected})`,
);

// Garde le process vivant dans Docker Compose
if (process.env.KEEP_ALIVE === "1") {
  setInterval(() => {}, 1 << 30);
} else {
  await orm.disconnect();
}
