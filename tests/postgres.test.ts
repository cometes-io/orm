import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PostgresClient } from "../src/index.js";

describe("PostgresClient", () => {
  let client: PostgresClient;

  beforeEach(() => {
    client = new PostgresClient({
      url: "postgresql://orm:orm@localhost:5432/orm",
    });
  });

  afterEach(async () => {
    await client.disconnect();
  });

  it("applique l'url fournie", () => {
    expect(client.url).toBe("postgresql://orm:orm@localhost:5432/orm");
  });

  it("refuse query sans connexion", async () => {
    await client.disconnect();
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
