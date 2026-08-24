import { afterEach, describe, expect, expectTypeOf, it } from "vitest";
import {
  Op,
  Orm,
  type InferPartialValues,
  type InferValues,
  type Model,
  type WhereClause,
} from "../src/index.js";
import {
  applyCreateTimestamps,
  applySoftDeleteDefault,
  applyUpdatedAt,
} from "../src/model/model.js";

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
    expect(model.$schema).toBeUndefined();
    expect(orm.models).toContain(model);
  });
});

describe("InferPartialValues", () => {
  type ProductSchema = {
    id: { type: "number"; primary: true };
    name: { type: "string" };
    sku: { type: "string" };
    available: { type: "boolean" };
  };

  it("rend chaque champ facultatif", () => {
    const data: InferPartialValues<ProductSchema> = {};
    const dataWithSomeFields: InferPartialValues<ProductSchema> = {
      id: 1,
      name: "Widget",
    };

    expect(data).toEqual({});
    expect(dataWithSomeFields.name).toBe("Widget");
  });
});

describe("WhereClause", () => {
  type PostsSchema = {
    id: { type: "number"; primary: true };
    title: { type: "string" };
  };

  it("accepte une égalité et { [Op.not]: null }", () => {
    const where: WhereClause<PostsSchema> = {
      id: 1,
      title: { [Op.not]: null },
    };

    expect(where).toEqual({
      id: 1,
      title: { [Op.not]: null },
    });
  });
});

describe("Model.findAll / findOne — inférence depuis attributes", () => {
  type ProductSchema = {
    id: { type: "number"; primary: true };
    name: { type: "string" };
    sku: { type: "string" };
    available: { type: "boolean" };
  };

  type ProductModel = Model<ProductSchema>;
  type ProductRow = InferValues<ProductSchema>;

  it("attributes: ['id', 'name'] as const retourne { id: number; name: string }[]", () => {
    const query = (model: ProductModel) =>
      model.findAll({
        attributes: ["id", "name"] as const,
      });

    expectTypeOf(query).returns.toEqualTypeOf<
      Promise<{ id: number; name: string }[]>
    >();
  });

  it("un attribut inexistant provoque une erreur TypeScript", () => {
    const query = (model: ProductModel) =>
      // @ts-expect-error — "unknown" n'existe pas dans le schéma
      model.findAll({
        attributes: ["id", "unknown"] as const,
      });

    expect(typeof query).toBe("function");
  });

  it("sans attributes, findAll retourne tous les champs du modèle", () => {
    const queryAll = (model: ProductModel) => model.findAll();
    const queryWhere = (model: ProductModel) =>
      model.findAll({
        where: { id: 1 },
      });

    expectTypeOf(queryAll).returns.toEqualTypeOf<Promise<ProductRow[]>>();
    expectTypeOf(queryWhere).returns.toEqualTypeOf<Promise<ProductRow[]>>();
  });

  it("findOne retourne le même type sélectionné ou null", () => {
    const querySelected = (model: ProductModel) =>
      model.findOne({
        attributes: ["id", "name"] as const,
      });
    const queryAll = (model: ProductModel) => model.findOne();

    expectTypeOf(querySelected).returns.toEqualTypeOf<
      Promise<{ id: number; name: string } | null>
    >();
    expectTypeOf(queryAll).returns.toEqualTypeOf<Promise<ProductRow | null>>();
  });

  it("le typage de where continue de fonctionner avec les opérateurs Sequelize", () => {
    const query = (model: ProductModel) =>
      model.findAll({
        attributes: ["id", "name"] as const,
        where: {
          available: true,
          sku: { [Op.not]: null },
        },
      });

    expectTypeOf(query).returns.toEqualTypeOf<
      Promise<{ id: number; name: string }[]>
    >();

    const invalidWhere = (model: ProductModel) =>
      model.findOne({
        where: {
          // @ts-expect-error — "missing" n'est pas un champ du schéma
          missing: 1,
        },
      });

    expect(typeof invalidWhere).toBe("function");
  });
});

describe("Model.$schema — phantom InferValues", () => {
  type LocationSchema = {
    id: { type: "number"; primary: true };
    name: { type: "string" };
    lat: { type: "float" };
    active: { type: "boolean" };
    created_at: { type: "date" };
    deleted_at: { type: "date"; nullable: true };
  };

  type LocationModel = Model<LocationSchema>;

  it("typeof Model.$schema colle 1:1 au schéma inféré", () => {
    const recordOf = (model: LocationModel) =>
      null as unknown as typeof model.$schema;

    expectTypeOf(recordOf).returns.toEqualTypeOf<{
      id: number;
      name: string;
      lat: number;
      active: boolean;
      created_at: Date;
      deleted_at: Date | null;
    }>();
    expectTypeOf<LocationModel["$schema"]>().toEqualTypeOf<
      InferValues<LocationSchema>
    >();
  });

  it("nullable: true infère T | null, sinon T", () => {
    expectTypeOf<LocationModel["$schema"]["deleted_at"]>().toEqualTypeOf<
      Date | null
    >();
    expectTypeOf<LocationModel["$schema"]["created_at"]>().toEqualTypeOf<Date>();
    expectTypeOf<LocationModel["$schema"]["id"]>().not.toEqualTypeOf<
      number | null
    >();
  });

  it("create / findOne / findAll restent alignés sur Model.$schema", () => {
    type LocationRecord = LocationModel["$schema"];

    expectTypeOf<Parameters<LocationModel["create"]>[0]>().toEqualTypeOf<
      Partial<LocationRecord>
    >();

    const findAll = (model: LocationModel) => model.findAll();
    expectTypeOf(findAll).returns.toEqualTypeOf<Promise<LocationRecord[]>>();

    const findOne = (model: LocationModel) => model.findOne();
    expectTypeOf(findOne).returns.toEqualTypeOf<
      Promise<LocationRecord | null>
    >();
  });
});

describe("applySoftDeleteDefault", () => {
  const schema = {
    id: { type: "number", primary: true },
    user_id: { type: "number" },
    deleted_at: { type: "date", nullable: true },
  } as const;

  const schemaSansSoftDelete = {
    id: { type: "number", primary: true },
    title: { type: "string" },
  } as const;

  it("filtre deleted_at: null quand aucun where n'est fourni", () => {
    expect(applySoftDeleteDefault(schema)).toEqual({ deleted_at: null });
  });

  it("complète un where existant sans le réécrire", () => {
    expect(applySoftDeleteDefault(schema, { id: 1 })).toEqual({
      deleted_at: null,
      id: 1,
    });
  });

  it("laisse la valeur fournie surcharger le défaut", () => {
    const where = { deleted_at: { [Op.not]: null } };

    expect(applySoftDeleteDefault(schema, where)).toBe(where);
  });

  it("retire le filtre quand deleted_at vaut undefined", () => {
    const where = { id: 1, deleted_at: undefined } as WhereClause<typeof schema>;

    expect(applySoftDeleteDefault(schema, where)).toEqual({ id: 1 });
  });

  it("préserve les opérateurs de haut niveau en les combinant en AND", () => {
    const where = { [Op.or]: [{ id: 1 }, { id: 2 }] };
    const result = applySoftDeleteDefault(schema, where) as Record<
      string | symbol,
      unknown
    >;

    expect(result["deleted_at"]).toBeNull();
    expect(result[Op.or]).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("préfixe un where sous forme de tableau", () => {
    expect(applySoftDeleteDefault(schema, [{ id: 1 }])).toEqual([
      { deleted_at: null },
      { id: 1 },
    ]);
  });

  it("ne touche pas aux schémas sans deleted_at", () => {
    expect(applySoftDeleteDefault(schemaSansSoftDelete)).toBeUndefined();
    expect(applySoftDeleteDefault(schemaSansSoftDelete, { id: 1 })).toEqual({
      id: 1,
    });
  });
});

describe("applyUpdatedAt", () => {
  const schema = {
    id: { type: "number", primary: true },
    name: { type: "string" },
    updated_at: { type: "date" },
  } as const;

  const schemaSansUpdatedAt = {
    id: { type: "number", primary: true },
    name: { type: "string" },
  } as const;

  it("horodate updated_at à chaque appel", () => {
    const before = Date.now();
    const values = applyUpdatedAt(schema, { name: "John" });
    const after = Date.now();

    expect(values.name).toBe("John");
    expect(values.updated_at).toBeInstanceOf(Date);
    expect(values.updated_at!.getTime()).toBeGreaterThanOrEqual(before);
    expect(values.updated_at!.getTime()).toBeLessThanOrEqual(after);
  });

  it("écrase une valeur fournie par l'appelant", () => {
    const stale = new Date("2020-01-01T00:00:00.000Z");
    const values = applyUpdatedAt(schema, { updated_at: stale });

    expect(values.updated_at).not.toEqual(stale);
  });

  it("ne touche pas aux schémas sans updated_at", () => {
    const data = { name: "John" };

    expect(applyUpdatedAt(schemaSansUpdatedAt, data)).toBe(data);
  });
});

describe("applyCreateTimestamps", () => {
  const schema = {
    id: { type: "number", primary: true },
    user_id: { type: "number" },
    created_at: { type: "date" },
    updated_at: { type: "date" },
    deleted_at: { type: "date", nullable: true },
  } as const;

  const schemaSansTimestamps = {
    id: { type: "number", primary: true },
    name: { type: "string" },
  } as const;

  it("remplit created_at et updated_at si absents", () => {
    const before = Date.now();
    const values = applyCreateTimestamps(schema, { user_id: 1 });
    const after = Date.now();

    expect(values.user_id).toBe(1);
    expect(values.created_at).toBeInstanceOf(Date);
    expect(values.updated_at).toBeInstanceOf(Date);
    expect(values.created_at!.getTime()).toBeGreaterThanOrEqual(before);
    expect(values.created_at!.getTime()).toBeLessThanOrEqual(after);
    expect(values.updated_at).toEqual(values.created_at);
    expect(values).not.toHaveProperty("deleted_at");
  });

  it("conserve les valeurs fournies par l'appelant", () => {
    const createdAt = new Date("2020-01-01T00:00:00.000Z");
    const updatedAt = new Date("2020-06-01T00:00:00.000Z");
    const values = applyCreateTimestamps(schema, {
      user_id: 1,
      created_at: createdAt,
      updated_at: updatedAt,
    });

    expect(values.created_at).toBe(createdAt);
    expect(values.updated_at).toBe(updatedAt);
  });

  it("remplit seulement le champ manquant", () => {
    const createdAt = new Date("2020-01-01T00:00:00.000Z");
    const values = applyCreateTimestamps(schema, {
      user_id: 1,
      created_at: createdAt,
    });

    expect(values.created_at).toBe(createdAt);
    expect(values.updated_at).toBeInstanceOf(Date);
  });

  it("ne touche pas aux schémas sans created_at / updated_at", () => {
    const data = { name: "John" };

    expect(applyCreateTimestamps(schemaSansTimestamps, data)).toBe(data);
  });
});
