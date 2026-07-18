import { afterEach, describe, expect, it } from "vitest";
import { Orm } from "../src/index.js";

describe("Orm", () => {
  let orm: Orm;

  afterEach(async () => {
    if (orm) {
      await orm.disconnect();
    }
  });

  it("utilise le nom fourni", () => {
    orm = new Orm({ name: "test" });
    expect(orm.ping()).toBe("orm:test");
  });

  it("utilise le nom par défaut", () => {
    orm = new Orm();
    expect(orm.ping()).toBe("orm:default");
  });

  it("expose les clients postgres et redis", () => {
    orm = new Orm({
      postgres: { host: "db", database: "app" },
      redis: { host: "cache", port: 6380 },
    });

    expect(orm.postgres.host).toBe("db");
    expect(orm.postgres.database).toBe("app");
    expect(orm.redis.host).toBe("cache");
    expect(orm.redis.port).toBe(6380);
  });

  it("connecte et déconnecte les deux clients", async () => {
    orm = new Orm();
    expect(orm.postgres.connected).toBe(false);
    expect(orm.redis.connected).toBe(false);

    await orm.connect();
    expect(orm.postgres.connected).toBe(true);
    expect(orm.redis.connected).toBe(true);

    await orm.disconnect();
    expect(orm.postgres.connected).toBe(false);
    expect(orm.redis.connected).toBe(false);
  });
});
