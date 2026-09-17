import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sequelize } from "sequelize";
import { PostgresClient } from "../src/index.js";
import { POSTGRES_URL, postgresReachable } from "./helpers/services.js";

describe("PostgresClient", () => {
  let client: PostgresClient;

  beforeEach(async () => {
    client = new PostgresClient({ url: POSTGRES_URL });
    await client.connect();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await client.disconnect();
  });

  it("refuse keepAlive.intervalMs invalide", () => {
    expect(
      () =>
        new PostgresClient({
          url: POSTGRES_URL,
          keepAlive: { intervalMs: 0 },
        }),
    ).toThrow("keepAlive.intervalMs must be a positive number");
  });

  it("keepAlive maintient le pool et ping jusqu'à disconnect", async () => {
    await client.disconnect();
    const authenticate = vi
      .spyOn(Sequelize.prototype, "authenticate")
      .mockResolvedValue(undefined);
    vi.useFakeTimers();

    client = new PostgresClient({
      url: POSTGRES_URL,
      keepAlive: { intervalMs: 5_000 },
      options: { pool: { max: 8 } },
    });
    await client.connect();

    expect(client.keepAlive).toEqual({ intervalMs: 5_000 });
    const sequelizeOptions = client.dbInstance as unknown as {
      options: {
        pool: { min?: number; max?: number; idle?: number };
        dialectOptions: { keepAlive?: boolean };
      };
    };
    expect(sequelizeOptions.options.pool).toEqual(
      expect.objectContaining({ min: 1, max: 8, idle: 10_000 }),
    );
    expect(sequelizeOptions.options.dialectOptions).toEqual(
      expect.objectContaining({ keepAlive: true }),
    );

    const query = vi
      .spyOn(client.dbInstance!, "query")
      .mockResolvedValue([[], undefined] as never);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(query).toHaveBeenCalledWith("SELECT 1", { logging: false });

    await client.disconnect();
    query.mockClear();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(query).not.toHaveBeenCalled();
    authenticate.mockRestore();
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

  it("déduit mysql depuis l'URL et génère LOCK TABLES", async () => {
    await client.disconnect();
    client = new PostgresClient({
      url: "mysql://orm:orm@localhost:3306/orm",
    });
    expect(client.dialect).toBe("mysql");

    const query = vi
      .spyOn(client.dbInstance!, "query")
      .mockResolvedValue([[], undefined] as never);
    const transaction = {} as never;

    await client.lockTable("users", "EXCLUSIVE", transaction);
    expect(query).toHaveBeenCalledWith("LOCK TABLES `users` WRITE", {
      transaction,
      logging: false,
    });

    await client.lockTable("users", "SHARE", transaction);
    expect(query).toHaveBeenCalledWith("LOCK TABLES `users` READ", {
      transaction,
      logging: false,
    });
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
