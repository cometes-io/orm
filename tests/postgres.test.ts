import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PostgresClient } from "../src/index.js";

describe("PostgresClient", () => {
  let client: PostgresClient;

  beforeEach(() => {
    client = new PostgresClient({
      host: "localhost",
      port: 5432,
      user: "orm",
      database: "orm",
    });
  });

  afterEach(async () => {
    await client.disconnect();
  });

  it("applique les options et les valeurs par défaut", () => {
    const defaults = new PostgresClient();
    expect(defaults.host).toBe("localhost");
    expect(defaults.port).toBe(5432);
    expect(defaults.user).toBe("orm");
    expect(defaults.database).toBe("orm");
    expect(defaults.connected).toBe(false);
  });

  it("refuse query sans connexion", async () => {
    await expect(client.query("SELECT 1")).rejects.toThrow(
      "PostgresClient is not connected",
    );
  });

  it("autorise query une fois connecté", async () => {
    await client.connect();
    expect(client.connected).toBe(true);
    await expect(client.query("SELECT 1")).resolves.toEqual([]);
  });

  it("se déconnecte proprement", async () => {
    await client.connect();
    await client.disconnect();
    expect(client.connected).toBe(false);
  });
});
