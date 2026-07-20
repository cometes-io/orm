import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RedisClient } from "../src/index.js";

describe("RedisClient", () => {
  let client: RedisClient;

  beforeEach(() => {
    client = new RedisClient({ url: "redis://localhost:6379" });
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
    await client.connect();
    await client.set("user:1", "alice");
    await expect(client.get("user:1")).resolves.toBe("alice");
    await expect(client.get("missing")).resolves.toBeNull();
  });

  it("supporte enqueue/dequeue (queue)", async () => {
    await client.connect();
    await client.enqueue("jobs", "a");
    await client.enqueue("jobs", "b");
    await expect(client.dequeue("jobs")).resolves.toBe("a");
    await expect(client.dequeue("jobs")).resolves.toBe("b");
    await expect(client.dequeue("jobs")).resolves.toBeNull();
  });

  it("se déconnecte et vide le store", async () => {
    await client.connect();
    await client.set("k", "v");
    await client.disconnect();
    expect(client.connected).toBe(false);

    await client.connect();
    await expect(client.get("k")).resolves.toBeNull();
  });
});
