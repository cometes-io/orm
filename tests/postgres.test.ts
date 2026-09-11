import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PostgresClient } from "../src/index.js";
import { POSTGRES_URL, postgresReachable } from "./helpers/services.js";

describe("PostgresClient", () => {
  let client: PostgresClient;

  beforeEach(async () => {
    client = new PostgresClient({ url: POSTGRES_URL });
    await client.connect();
  });

  afterEach(async () => {
    await client.disconnect();
  });

  it("applique l'url fournie", () => {
    expect(client.url).toBe(POSTGRES_URL);
  });

  it("refuse query et begin sans connexion", async () => {
    await client.disconnect();
    await expect(client.query("SELECT 1")).rejects.toThrow(
      "PostgresClient is not connected",
    );
    await expect(client.begin()).rejects.toThrow(
      "PostgresClient is not connected",
    );
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

  it("mappe une référence de modèle vers une clé étrangère Sequelize", () => {
    const UserModel = {
      name: "users",
      schema: {
        id: { type: "number" as const, primary: true },
      },
      $schema: undefined as unknown as { id: number },
    };

    const formatted = client.formatModelSchema({
      user_id: {
        type: "number",
        references: { model: UserModel, key: "id" },
      },
    });

    expect(formatted["user_id"]?.references).toEqual({
      model: "users",
      key: "id",
    });
  });

  it("auto-incrémente une clé primaire numérique unique", () => {
    const formatted = client.formatModelSchema({
      id: { type: "number", primary: true },
      name: { type: "string" },
    });

    expect(formatted["id"]?.primaryKey).toBe(true);
    expect(formatted["id"]?.autoIncrement).toBe(true);
  });

  it("n'auto-incrémente pas une clé primaire composite", () => {
    const formatted = client.formatModelSchema({
      workspace_id: { type: "number", primary: true },
      user_id: { type: "number", primary: true },
    });

    expect(formatted["workspace_id"]?.primaryKey).toBe(true);
    expect(formatted["workspace_id"]?.autoIncrement).toBe(false);
    expect(formatted["user_id"]?.autoIncrement).toBe(false);
  });

  it("pousse nullable vers allowNull Sequelize", () => {
    const formatted = client.formatModelSchema({
      id: { type: "number", primary: true },
      name: { type: "string" },
      deleted_at: { type: "date", nullable: true },
    });

    expect(formatted["id"]?.allowNull).toBe(false);
    expect(formatted["name"]?.allowNull).toBe(false);
    expect(formatted["deleted_at"]?.allowNull).toBe(true);
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

// Nécessite un PostgreSQL joignable : ignoré si le port ne répond pas.
describe.skipIf(!postgresReachable)("PostgresClient (intégration)", () => {
  let client: PostgresClient;

  beforeEach(async () => {
    client = new PostgresClient({ url: POSTGRES_URL });
    await client.connect();
  });

  afterEach(async () => {
    await client.disconnect();
  });

  it("exécute une requête SQL et renvoie les lignes", async () => {
    await expect(client.query("SELECT 1 AS one")).resolves.toEqual([
      { one: 1 },
    ]);
  });

  it("lie les paramètres au lieu de les concaténer", async () => {
    const rows = await client.query<{ value: string }>(
      "SELECT $1::text AS value",
      ["'; DROP TABLE users; --"],
    );

    expect(rows).toEqual([{ value: "'; DROP TABLE users; --" }]);
  });

  it("healthy authentifie réellement la connexion", async () => {
    await expect(client.healthy()).resolves.toBe(true);
  });
});
