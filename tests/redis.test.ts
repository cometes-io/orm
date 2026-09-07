import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RedisClient } from "../src/index.js";

describe("RedisClient", () => {
  let client: RedisClient;

  beforeEach(async () => {
    client = new RedisClient({
      url: "redis://localhost:6379",
    });
    await client.connect();
  });

  afterEach(async () => {
    await client.disconnect();
  });

  it("applique l'url fournie", () => {
    expect(client.url).toBe("redis://localhost:6379");
  });

  it("refuse les opérations sans connexion", async () => {
    await client.disconnect();
    await expect(client.set("k", "v")).rejects.toThrow(
      "RedisClient is not connected",
    );
  });

  it("supporte set/get (cache)", async () => {
    await client.set("user:1", "alice");
    await expect(client.get("user:1")).resolves.toBe("alice");
    await expect(client.get("missing")).resolves.toBeNull();
  });

  it("applique un TTL de 5 minutes par défaut", async () => {
    await client.set("ttl:demo", "v");
    const ttl = await client.dbInstance!.ttl("ttl:demo");
    expect(ttl).toBeGreaterThan(4 * 60);
    expect(ttl).toBeLessThanOrEqual(5 * 60);
  });

  it("supprime les clés par préfixe", async () => {
    await client.set("model:users:findAll", "a");
    await client.set("model:users:findOne:1", "b");
    await client.set("model:posts:findAll", "c");

    await client.delStartWith("model:users");

    await expect(client.get("model:users:findAll")).resolves.toBeNull();
    await expect(client.get("model:users:findOne:1")).resolves.toBeNull();
    await expect(client.get("model:posts:findAll")).resolves.toBe("c");
  });

  it("supporte enqueue/dequeue (queue)", async () => {
    const queue = `jobs:${Date.now()}`;
    await client.enqueue(queue, "a");
    await client.enqueue(queue, "b");
    await expect(client.dequeue(queue)).resolves.toBe("a");
    await expect(client.dequeue(queue)).resolves.toBe("b");
    await expect(client.dequeue(queue)).resolves.toBeNull();
  });

  it("se déconnecte proprement", async () => {
    await client.set("k", "v");
    await client.disconnect();
    expect(client.connected).toBe(false);
  });

  it("healthy pingue Redis une fois connecté", async () => {
    expect(client.connected).toBe(true);
    await expect(client.healthy()).resolves.toBe(true);
  });
});
