import { afterEach, describe, expect, it } from "vitest";
import { Orm } from "../src/index.js";

describe("declareModel", () => {
  let orm: Orm;

  afterEach(async () => {
    if (orm) {
      await orm.disconnect().catch(() => undefined);
    }
  });

  it("déclare un modèle via l'instance Orm", async () => {
    orm = new Orm({
      postgres: { url: "postgres://orm:orm@localhost:5432/orm" },
      redis: { url: "redis://localhost:6379" },
    });

    // connect() est lancé dans le constructeur ; on attend qu'il aboutisse
    await orm.connect();

    const model = orm.declareModel({
      name: "posts",
      schema: {
        id: { type: "number", primary: true },
        title: { type: "string" },
      },
    });

    expect(model.name).toBe("posts");
    expect(model.schema.id).toEqual({ type: "number", primary: true });
    expect(model.schema.title).toEqual({ type: "string" });
    expect(orm.models).toContain(model);
  });
});
