import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PostgresClient } from "../src/index.js";

describe("PostgresClient", () => {
  let client: PostgresClient;

  beforeEach(async () => {
    client = new PostgresClient({
      url: "postgresql://orm:orm@localhost:5432/orm",
    });
    await client.connect();
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
    expect(client.connected).toBe(true);
    await expect(client.query("SELECT 1")).resolves.toEqual([]);
  });

  it("se déconnecte proprement", async () => {
    await client.disconnect();
    expect(client.connected).toBe(false);
  });

  it("mappe enum et default vers Sequelize", () => {
    const formatted = client.formatModelSchema({
      status: {
        type: "string",
        enum: ["active", "inactive", "archived"],
        default: "active",
      },
    });

    expect(formatted["status"]?.defaultValue).toBe("active");
    expect(formatted["status"]?.type.key).toBe("ENUM");
    expect(formatted["status"]?.type.values).toEqual([
      "active",
      "inactive",
      "archived",
    ]);
  });

  it("envoie le default à l'INSERT quand le champ n'est pas fourni", () => {
    const model = client.dbInstance!.define(
      "things",
      client.formatModelSchema({
        id: { type: "number", primary: true },
        name: { type: "string" },
        status: {
          type: "string",
          enum: ["active", "inactive"],
          default: "active",
        },
      }),
      { createdAt: false, updatedAt: false, deletedAt: false },
    );

    // `build` reproduit les valeurs que `create` enverra à Postgres
    expect(model.build({ name: "Widget" }).get("status")).toBe("active");
    expect(model.build({ name: "Widget", status: "inactive" }).get("status")).toBe(
      "inactive",
    );
  });
});
