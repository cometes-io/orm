import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runMigrations } from "../src/index.js";
import type { PostgresClient } from "../src/index.js";

describe("runMigrations", () => {
  let directory: string;

  afterEach(async () => {
    if (directory) {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("applique les fichiers .ts dans l'ordre et ignore ceux déjà faits", async () => {
    directory = await mkdtemp(path.join(tmpdir(), "orm-migrate-"));

    await writeFile(
      path.join(directory, "002_second.ts"),
      `export async function up(_qi, _seq, _t) { globalThis.__ups.push("002"); }`,
      "utf8",
    );
    await writeFile(
      path.join(directory, "001_first.ts"),
      `export async function up(_qi, _seq, _t) { globalThis.__ups.push("001"); }`,
      "utf8",
    );

    (globalThis as { __ups?: string[] }).__ups = [];

    const appliedNames: string[] = [];

    const sequelize = {
      query: vi.fn(async (sql: string, options?: { replacements?: { name: string } }) => {
        if (sql.includes(`CREATE TABLE IF NOT EXISTS migrations`)) {
          return [[], undefined];
        }
        if (sql.includes("SELECT name FROM migrations")) {
          return [appliedNames.map((name) => ({ name })), undefined];
        }
        if (sql.includes("INSERT INTO migrations")) {
          appliedNames.push(options?.replacements?.name ?? "");
          return [[], undefined];
        }
        return [[], undefined];
      }),
      getQueryInterface: vi.fn(() => ({})),
      transaction: vi.fn(async (fn: (t: unknown) => Promise<void>) => {
        await fn({});
      }),
    };

    const client = { dbInstance: sequelize } as unknown as PostgresClient;

    const first = await runMigrations(client, { directory });
    expect(first.applied).toEqual(["001_first.ts", "002_second.ts"]);
    expect(first.skipped).toEqual([]);
    expect((globalThis as unknown as { __ups: string[] }).__ups).toEqual([
      "001",
      "002",
    ]);

    const second = await runMigrations(client, { directory });
    expect(second.applied).toEqual([]);
    expect(second.skipped).toEqual(["001_first.ts", "002_second.ts"]);
  });

  it("échoue sans instance Sequelize", async () => {
    const client = { dbInstance: undefined } as unknown as PostgresClient;
    await expect(
      runMigrations(client, { directory: "/tmp" }),
    ).rejects.toThrow("PostgreSQL database instance not found");
  });
});
