import { Orm } from "../../src/index.js";

/**
 * Exemple d'utilisation de l'ORM depuis Node.js (TypeScript).
 * Lancer avec : npm run example
 * Ou via Docker Compose : docker compose -f examples/docker-compose.yml up --build
 */
const orm = new Orm({ name: "demo" });

const postgresHost = process.env.POSTGRES_HOST ?? "localhost";
const postgresPort = process.env.POSTGRES_PORT ?? "5432";
const redisHost = process.env.REDIS_HOST ?? "localhost";
const redisPort = process.env.REDIS_PORT ?? "6379";

console.log(orm.ping());
console.log(`PostgreSQL → ${postgresHost}:${postgresPort}`);
console.log(`Redis      → ${redisHost}:${redisPort}`);

// Garde le process vivant dans Docker Compose
if (process.env.KEEP_ALIVE === "1") {
  setInterval(() => {}, 1 << 30);
}
