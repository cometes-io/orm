import { afterEach, describe, expect, it, vi } from "vitest";
import { Orm } from "../src/index.js";
import {
  POSTGRES_URL,
  REDIS_URL,
  postgresReachable,
  redisReachable,
} from "./helpers/services.js";

describe("Orm", () => {
  let orm: Orm;

  afterEach(async () => {
    if (orm) {
      await orm.disconnect().catch(() => undefined);
    }
    vi.restoreAllMocks();
  });

  it("expose les clients postgres et redis", () => {
    orm = new Orm({
      postgres: { url: "postgresql://orm:orm@db:5432/app" },
      redis: { url: "redis://cache:6380" },
    });

    expect(orm.postgres.url).toBe("postgresql://orm:orm@db:5432/app");
    expect(orm.redis.url).toBe("redis://cache:6380");
  });

  // Postgres : instance Sequelize créée. Redis : socket réellement ouvert.
  it("instancie puis libère les deux clients", async () => {
    orm = new Orm({
      postgres: { url: POSTGRES_URL },
      redis: { url: REDIS_URL },
    });

    await orm.connect();
    expect(orm.postgres.connected).toBe(true);
    expect(orm.redis.connected).toBe(redisReachable);

    await orm.disconnect();
    expect(orm.postgres.connected).toBe(false);
    expect(orm.redis.connected).toBe(false);
  });

  it(
    "ping reflète la joignabilité réelle des services",
    async () => {
      // `healthy()` journalise l'échec de connexion : inutile dans la sortie de test.
      vi.spyOn(console, "error").mockImplementation(() => undefined);

      orm = new Orm({
        postgres: { url: POSTGRES_URL },
        redis: { url: REDIS_URL },
      });

      await expect(orm.ping()).resolves.toEqual({
        postgres: postgresReachable,
        redis: redisReachable,
      });
    },
    // Sur un service injoignable, le client Redis réessaie avant d'abandonner :
    // `ping()` peut alors dépasser 10 s. Rapide dès que les services répondent.
    30_000,
  );
});

describe("Orm.begin / commit / rollback", () => {
  let orm: Orm;

  afterEach(async () => {
    if (orm) {
      await orm.disconnect().catch(() => undefined);
    }
  });

  const fakeTransaction = () => {
    orm = new Orm({
      postgres: { url: "postgres://orm:orm@localhost:5432/orm" },
      redis: { url: "redis://localhost:6379" },
    });

    const calls: string[] = [];
    const tx = {
      commit: async () => {
        calls.push("commit");
      },
      rollback: async () => {
        calls.push("rollback");
      },
    };
    orm.postgres.dbInstance!.transaction = (async () => tx) as never;
    return { calls, tx };
  };

  it("begin puis commit valide la transaction", async () => {
    const { calls, tx } = fakeTransaction();

    await expect(orm.commit()).rejects.toThrow("No transaction in progress");
    await expect(orm.rollback()).rejects.toThrow("No transaction in progress");

    const started = await orm.begin();
    expect(started).toBe(tx);
    expect(orm.currentTransaction).toBe(tx);
    await expect(orm.begin()).rejects.toThrow(
      "A transaction is already in progress",
    );

    await orm.commit();
    expect(calls).toEqual(["commit"]);
    expect(orm.currentTransaction).toBeNull();
  });

  it("rollback annule la transaction en cours", async () => {
    const { calls, tx } = fakeTransaction();

    await orm.begin();
    await orm.rollback();
    expect(calls).toEqual(["rollback"]);
    expect(orm.currentTransaction).toBeNull();

    await orm.begin();
    await orm.rollback(tx as never);
    expect(calls).toEqual(["rollback", "rollback"]);
  });

  it("refuse deux begin() en parallèle", async () => {
    fakeTransaction();

    const results = await Promise.allSettled([orm.begin(), orm.begin()]);
    const fulfilled = results.filter(
      (result) => result.status === "fulfilled",
    );
    const rejected = results.filter((result) => result.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toEqual(
      new Error(
        "Concurrent begin() is not supported; use orm.transaction(fn)",
      ),
    );

    await orm.commit();
    expect(orm.currentTransaction).toBeNull();
  });

  it("isole deux transaction(fn) concurrentes", async () => {
    orm = new Orm({
      postgres: { url: "postgres://orm:orm@localhost:5432/orm" },
      redis: { url: "redis://localhost:6379" },
    });
    let n = 0;
    orm.postgres.dbInstance!.transaction = (async () => {
      const id = ++n;
      return {
        id,
        commit: async () => undefined,
        rollback: async () => undefined,
      };
    }) as never;

    const seen: number[] = [];
    await Promise.all([
      orm.transaction(async (tx) => {
        const id = (tx as unknown as { id: number }).id;
        seen.push(id);
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(
          (orm.currentTransaction as unknown as { id: number }).id,
        ).toBe(id);
      }),
      orm.transaction(async (tx) => {
        const id = (tx as unknown as { id: number }).id;
        seen.push(id);
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(
          (orm.currentTransaction as unknown as { id: number }).id,
        ).toBe(id);
      }),
    ]);

    expect(seen.sort()).toEqual([1, 2]);
    expect(orm.currentTransaction).toBeNull();
  });

  it("transaction(fn) commit et rollback tout seuls", async () => {
    const { calls, tx } = fakeTransaction();

    await expect(
      orm.transaction(async (started) => {
        expect(started).toBe(tx);
        expect(orm.currentTransaction).toBe(tx);
        return "ok";
      }),
    ).resolves.toBe("ok");
    expect(calls).toEqual(["commit"]);
    expect(orm.currentTransaction).toBeNull();

    await expect(
      orm.transaction(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(calls).toEqual(["commit", "rollback"]);
  });
});

describe("Orm.lock / unlock", () => {
  let orm: Orm;

  afterEach(async () => {
    if (orm) {
      await orm.disconnect().catch(() => undefined);
    }
  });

  const fakeTransaction = () => {
    orm = new Orm({
      postgres: { url: "postgres://orm:orm@localhost:5432/orm" },
      redis: { url: "redis://localhost:6379" },
    });

    const queries: { sql: string; transaction: unknown }[] = [];
    const tx = {
      commit: async () => undefined,
      rollback: async () => undefined,
    };
    orm.postgres.dbInstance!.transaction = (async () => tx) as never;
    orm.postgres.dbInstance!.query = (async (
      sql: string,
      opts: { transaction?: unknown } = {},
    ) => {
      queries.push({ sql, transaction: opts.transaction });
      return [];
    }) as never;
    return { queries, tx };
  };

  it("exige une transaction", async () => {
    fakeTransaction();
    await expect(orm.lock()).rejects.toThrow("A transaction is required to lock");
  });

  it("active un verrou de lignes jusqu'à unlock ou commit", async () => {
    fakeTransaction();
    await orm.begin();
    await orm.lock();
    expect(orm.currentLock).toBe("UPDATE");
    await orm.lock("SHARE");
    expect(orm.currentLock).toBe("SHARE");
    orm.unlock();
    expect(orm.currentLock).toBeNull();

    await orm.lock();
    await orm.commit();
    expect(orm.currentLock).toBeNull();
  });

  it("exécute LOCK TABLE dans la transaction", async () => {
    const { queries, tx } = fakeTransaction();
    await orm.begin();
    await orm.lock({ table: "workspace_users" });
    await orm.lock({ table: "users", mode: "SHARE" });

    expect(queries).toEqual([
      {
        sql: 'LOCK TABLE "workspace_users" IN EXCLUSIVE MODE',
        transaction: tx,
      },
      {
        sql: 'LOCK TABLE "users" IN SHARE MODE',
        transaction: tx,
      },
    ]);
  });

  it("refuse un nom de table invalide", async () => {
    fakeTransaction();
    await orm.begin();
    await expect(orm.lock({ table: "users; DROP TABLE users" })).rejects.toThrow(
      "Invalid table name",
    );
  });
});
