import net from "node:net";

/**
 * Services externes utilisés par les tests d'intégration.
 *
 * Les URL sont surchargeables par variable d'environnement (la CI fournit ses
 * propres conteneurs). On sonde le port avant de lancer les suites concernées :
 * une machine sans Postgres ou sans Redis les ignore au lieu d'échouer.
 */

export const POSTGRES_URL =
  process.env.POSTGRES_URL ?? "postgres://orm:orm@localhost:5432/orm";

export const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

const reachable = (url: string, defaultPort: number): Promise<boolean> =>
  new Promise((resolve) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      resolve(false);
      return;
    }

    const socket = net.connect({
      host: parsed.hostname,
      port: Number(parsed.port) || defaultPort,
    });

    const settle = (result: boolean) => {
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(1_000);
    socket.once("connect", () => settle(true));
    socket.once("timeout", () => settle(false));
    socket.once("error", () => settle(false));
  });

export const postgresReachable = await reachable(POSTGRES_URL, 5432);
export const redisReachable = await reachable(REDIS_URL, 6379);
