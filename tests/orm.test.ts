import { afterEach, describe, expect, it } from "vitest";
import { Orm } from "../src/index.js";

describe("Orm", () => {
  let orm: Orm;

  afterEach(async () => {
    if (orm) {
      await orm.disconnect().catch(() => undefined);
    }
  });

  it("expose les clients postgres et redis", () => {
    orm = new Orm({
      postgres: { url: "postgresql://orm:orm@db:5432/app" },
      redis: { url: "redis://cache:6380" },
    });

    expect(orm.postgres.url).toBe("postgresql://orm:orm@db:5432/app");
    expect(orm.redis.url).toBe("redis://cache:6380");
  });

  it("connecte et déconnecte les deux clients", async () => {
    orm = new Orm({
      postgres: { url: "postgresql://orm:orm@localhost:5432/orm" },
      redis: { url: "redis://localhost:6379" },
    });

    await orm.connect();
    expect(orm.postgres.connected).toBe(true);
    expect(orm.redis.connected).toBe(true);

    await orm.disconnect();
    expect(orm.postgres.connected).toBe(false);
    expect(orm.redis.connected).toBe(false);
  });

  it("ping retourne l'état des clients", async () => {
    orm = new Orm({
      postgres: { url: "postgresql://orm:orm@localhost:5432/orm" },
      redis: { url: "redis://localhost:6379" },
    });

    const status = await orm.ping();
    expect(status).toHaveProperty("postgres");
    expect(status).toHaveProperty("redis");
  });
});
