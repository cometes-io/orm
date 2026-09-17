import { afterEach, describe, expect, expectTypeOf, it } from "vitest";
import {
  CACHED_DATE_KEY,
  Op,
  Orm,
  parseCachedJson,
  stringifyCachedJson,
  type InferPartialValues,
  type InferValues,
  type Model,
  type Transaction,
  type WhereClause,
} from "../src/index.js";
import {
  applyCreateTimestamps,
  applySoftDeleteDefault,
  applyUpdatedAt,
  primaryKeyWhere,
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

describe("enum / default", () => {
  type StatusSchema = {
    id: { type: "number"; primary: true };
    status: {
      type: "string";
      enum: ["active", "inactive", "archived"];
      default: "active";
    };
    deleted_at: { type: "date"; nullable: true };
  };

  it("infère l'union des littéraux enum", () => {
    expectTypeOf<InferValues<StatusSchema>["status"]>().toEqualTypeOf<
      "active" | "inactive" | "archived"
    >();
  });

  it("enum + nullable infère l'union | null", () => {
    type NullableStatusSchema = {
      status: {
        type: "string";
        enum: ["active", "inactive"];
        nullable: true;
      };
    };

    expectTypeOf<InferValues<NullableStatusSchema>["status"]>().toEqualTypeOf<
      "active" | "inactive" | null
    >();
  });

  it("accepte enum et default sur le descripteur", () => {
    const schema: StatusSchema = {
      id: { type: "number", primary: true },
      status: {
        type: "string",
        enum: ["active", "inactive", "archived"],
        default: "active",
      },
      deleted_at: { type: "date", nullable: true },
    };

    expect(schema.status.enum).toEqual(["active", "inactive", "archived"]);
    expect(schema.status.default).toBe("active");
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
      model.findAll({
        // @ts-expect-error — "unknown" n'existe pas dans le schéma
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

  it("accepte order et limit avec where", () => {
    const query = (model: ProductModel) =>
      model.findAll({
        attributes: ["id", "name"] as const,
        where: { available: true },
        order: [["name", "DESC"], "id"],
        limit: 10,
      });

    expectTypeOf(query).returns.toEqualTypeOf<
      Promise<{ id: number; name: string }[]>
    >();

    const invalidOrder = (model: ProductModel) =>
      model.findOne({
        order: [
          // @ts-expect-error — "missing" n'est pas un champ du schéma
          ["missing", "DESC"],
        ],
        limit: 1,
      });

    expect(typeof invalidOrder).toBe("function");
  });
});

describe("Model.findAll / findOne — include par clé étrangère", () => {
  let orm: Orm;

  afterEach(async () => {
    if (orm) {
      await orm.disconnect().catch(() => undefined);
    }
  });

  const declareModels = () => {
    orm = new Orm({
      postgres: { url: "postgres://orm:orm@localhost:5432/orm" },
      redis: { url: "redis://localhost:6379" },
    });

    const associations: {
      target: unknown;
      options: { as: string; foreignKey: string; targetKey: string };
    }[] = [];
    const reverseAssociations: {
      target: unknown;
      options: { as: string; foreignKey: string; sourceKey: string };
    }[] = [];
    const queries: Record<string, unknown>[] = [];
    const sequelizeModels: Record<string, Record<string, unknown>> = {};

    orm.postgres.dbInstance!.define = ((name: string) => {
      const attributes =
        name === "users"
          ? {
              id: {},
              name: {},
              status: {},
              deleted_at: {},
            }
          : {
              workspace_id: {},
              user_id: {},
              role: {},
            };
      const sequelizeModel = {
        getAttributes: () => attributes,
        belongsTo: (
          target: unknown,
          options: { as: string; foreignKey: string; targetKey: string },
        ) => {
          associations.push({ target, options });
        },
        hasMany: (
          target: unknown,
          options: { as: string; foreignKey: string; sourceKey: string },
        ) => {
          reverseAssociations.push({ target, options });
        },
        findOne: async (options: Record<string, unknown>) => {
          queries.push(options);
          return {
            get: () => ({
              workspace_id: 1,
              user_id: 2,
              user: { id: 2, name: "John" },
            }),
          };
        },
        findAll: async (options: Record<string, unknown>) => {
          queries.push(options);
          return [
            {
              get: () => ({
                workspace_id: 1,
                user_id: 2,
                user: { id: 2, name: "John" },
              }),
            },
          ];
        },
      };
      sequelizeModels[name] = sequelizeModel;
      return sequelizeModel;
    }) as never;

    const UserModel = orm.declareModel({
      name: "users",
      schema: {
        id: { type: "number", primary: true },
        name: { type: "string" },
        status: {
          type: "string",
          enum: ["active", "inactive"],
        },
        deleted_at: { type: "date", nullable: true },
      },
    });

    const WorkspaceUserModel = orm.declareModel({
      name: "workspace_users",
      schema: {
        workspace_id: { type: "number" },
        user_id: {
          type: "number",
          references: { model: UserModel, key: "id" },
        },
        role: { type: "string" },
      },
    });

    return {
      UserModel,
      WorkspaceUserModel,
      associations,
      reverseAssociations,
      queries,
      sequelizeModels,
    };
  };

  it("infère les attributs inclus sous l'alias de *_id", () => {
    const { UserModel, WorkspaceUserModel } = declareModels();

    const query = () =>
      WorkspaceUserModel.findOne({
        attributes: ["workspace_id", "role"] as const,
        include: [
          {
            model: UserModel,
            attributes: ["id", "name"] as const,
          },
        ] as const,
      });

    type IncludedRow = NonNullable<Awaited<ReturnType<typeof query>>>;
    expectTypeOf<IncludedRow>().not.toBeNever();
    expectTypeOf<IncludedRow["workspace_id"]>().toEqualTypeOf<number>();
    expectTypeOf<IncludedRow["role"]>().toEqualTypeOf<string>();
    expectTypeOf<IncludedRow["user"]>().not.toBeNever();
  });

  it("déclare belongsTo et transmet l'include à Sequelize", async () => {
    const {
      WorkspaceUserModel,
      UserModel,
      associations,
      queries,
      sequelizeModels,
    } = declareModels();

    const row = await WorkspaceUserModel.findOne({
      where: { workspace_id: 1 },
      include: [
        {
          model: UserModel,
          attributes: ["id", "name"] as const,
          where: { status: "active" },
          required: true,
        },
      ] as const,
    });

    expect(associations).toEqual([
      {
        target: sequelizeModels["users"],
        options: {
          as: "user",
          foreignKey: "user_id",
          targetKey: "id",
        },
      },
    ]);
    expect(queries[0]).toMatchObject({
      raw: false,
      include: [
        {
          association: "user",
          attributes: ["id", "name"],
          where: { deleted_at: null, status: "active" },
          required: true,
        },
      ],
    });
    expect(row).toMatchObject({
      workspace_id: 1,
      user: { id: 2, name: "John" },
    });
  });

  it("exige relation s'il y a plusieurs FK vers le même modèle", async () => {
    const { UserModel, queries } = declareModels();

    const ReviewModel = orm.declareModel({
      name: "reviews",
      schema: {
        author_id: {
          type: "number",
          references: { model: UserModel, key: "id" },
        },
        editor_id: {
          type: "number",
          references: { model: UserModel, key: "id" },
        },
      },
    });

    await expect(
      ReviewModel.findOne({
        include: [{ model: UserModel }] as const,
      }),
    ).rejects.toThrow(
      'Several foreign keys reference "users" (author_id, editor_id); set relation',
    );

    await ReviewModel.findOne({
      include: [{ model: UserModel, relation: "author_id" }] as const,
    });
    expect(queries.at(-1)).toMatchObject({
      include: [{ association: "author" }],
    });
  });

  it("déclare le hasMany inverse et joint la collection depuis le parent", async () => {
    const {
      UserModel,
      WorkspaceUserModel,
      reverseAssociations,
      queries,
      sequelizeModels,
    } = declareModels();

    await UserModel.findAll({
      attributes: ["id", "name"] as const,
      include: [
        {
          model: WorkspaceUserModel,
          attributes: ["workspace_id", "role"] as const,
        },
      ] as const,
    });

    expect(reverseAssociations).toEqual([
      {
        target: sequelizeModels["workspace_users"],
        options: {
          as: "workspace_users",
          foreignKey: "user_id",
          sourceKey: "id",
        },
      },
    ]);
    expect(queries.at(-1)).toMatchObject({
      include: [
        {
          association: "workspace_users",
          attributes: ["workspace_id", "role"],
          required: false,
        },
      ],
    });
  });

  it("type une collection 1→N en tableau, jamais en null", () => {
    const { UserModel, WorkspaceUserModel } = declareModels();

    const query = () =>
      UserModel.findAll({
        attributes: ["id"] as const,
        include: [
          { model: WorkspaceUserModel, attributes: ["role"] as const },
        ] as const,
      });

    type Row = Awaited<ReturnType<typeof query>>[number];
    expectTypeOf<Row["workspace_users"]>().toBeArray();
    expectTypeOf<Row["workspace_users"][number]["role"]>().toEqualTypeOf<
      string | undefined
    >();
  });

  it("respecte reverseAs pour nommer la collection 1→N", async () => {
    const { UserModel, reverseAssociations, queries } = declareModels();

    const PostModel = orm.declareModel({
      name: "posts",
      schema: {
        user_id: {
          type: "number",
          references: { model: UserModel, key: "id", reverseAs: "articles" },
        },
        role: { type: "string" },
      },
    });

    expect(reverseAssociations.at(-1)?.options).toMatchObject({
      as: "articles",
      foreignKey: "user_id",
      sourceKey: "id",
    });

    const query = () =>
      UserModel.findOne({
        attributes: ["id"] as const,
        include: [{ model: PostModel, attributes: ["role"] as const }] as const,
      });
    type Row = NonNullable<Awaited<ReturnType<typeof query>>>;
    expectTypeOf<Row["articles"]>().toBeArray();

    await query();
    expect(queries.at(-1)).toMatchObject({
      include: [{ association: "articles" }],
    });
  });

  it("suffixe l'alias inverse et exige relation quand l'enfant porte plusieurs FK", async () => {
    const { UserModel, reverseAssociations, queries } = declareModels();

    const ReviewModel = orm.declareModel({
      name: "reviews",
      schema: {
        author_id: {
          type: "number",
          references: { model: UserModel, key: "id" },
        },
        editor_id: {
          type: "number",
          references: { model: UserModel, key: "id" },
        },
      },
    });

    expect(reverseAssociations.map((entry) => entry.options.as)).toEqual([
      "workspace_users",
      "reviews_author_id",
      "reviews_editor_id",
    ]);

    await expect(
      UserModel.findAll({ include: [{ model: ReviewModel }] as const }),
    ).rejects.toThrow(
      'Several foreign keys in "reviews" reference this model (author_id, editor_id); set relation',
    );

    await UserModel.findAll({
      include: [{ model: ReviewModel, relation: "editor_id" }] as const,
    });
    expect(queries.at(-1)).toMatchObject({
      include: [{ association: "reviews_editor_id" }],
    });
  });

  it("refuse un include sans lien de clé étrangère", () => {
    const { UserModel, WorkspaceUserModel } = declareModels();

    const OrphanModel = orm.declareModel({
      name: "orphans",
      schema: { id: { type: "number", primary: true } },
    });

    const queries = () => [
      UserModel.findAll({
        // @ts-expect-error — aucune FK entre users et orphans
        include: [{ model: OrphanModel }] as const,
      }),
      UserModel.findAll({
        // @ts-expect-error — "role" n'est pas une FK de workspace_users vers users
        include: [{ model: WorkspaceUserModel, relation: "role" }] as const,
      }),
      UserModel.findAll({
        // @ts-expect-error — "missing" n'est pas un champ de workspace_users
        include: [
          { model: WorkspaceUserModel, attributes: ["missing"] as const },
        ] as const,
      }),
    ];

    expect(typeof queries).toBe("function");
  });

  it("type le where de l'include sur le modèle joint", () => {
    const { UserModel, WorkspaceUserModel } = declareModels();

    const query = () =>
      WorkspaceUserModel.findOne({
        include: [
          {
            model: UserModel,
            where: { status: "active" },
          },
        ] as const,
      });

    expect(typeof query).toBe("function");
  });

  it("imbrique les include et infère user.company", async () => {
    orm = new Orm({
      postgres: { url: "postgres://orm:orm@localhost:5432/orm" },
      redis: { url: "redis://localhost:6379" },
    });

    const queries: Record<string, unknown>[] = [];
    orm.postgres.dbInstance!.define = ((name: string) => ({
      getAttributes: () =>
        name === "companies"
          ? { id: {}, name: {}, deleted_at: {} }
          : name === "users"
            ? { id: {}, name: {}, company_id: {}, deleted_at: {} }
            : { user_id: {}, role: {} },
      belongsTo: () => undefined,
      hasMany: () => undefined,
      findOne: async (options: Record<string, unknown>) => {
        queries.push(options);
        return {
          get: () => ({
            role: "admin",
            user: { id: 2, name: "Ada", company: { id: 1, name: "Cometes" } },
          }),
        };
      },
    })) as never;

    const CompanyModel = orm.declareModel({
      name: "companies",
      schema: {
        id: { type: "number", primary: true },
        name: { type: "string" },
        deleted_at: { type: "date", nullable: true },
      },
    });
    const UserModel = orm.declareModel({
      name: "users",
      schema: {
        id: { type: "number", primary: true },
        name: { type: "string" },
        company_id: {
          type: "number",
          references: { model: CompanyModel, key: "id" },
        },
        deleted_at: { type: "date", nullable: true },
      },
    });
    const MemberModel = orm.declareModel({
      name: "members",
      schema: {
        user_id: {
          type: "number",
          references: { model: UserModel, key: "id" },
        },
        role: { type: "string" },
      },
    });

    const query = () =>
      MemberModel.findOne({
        attributes: ["role"] as const,
        include: [
          {
            model: UserModel,
            attributes: ["id", "name"] as const,
            required: true,
            include: [
              {
                model: CompanyModel,
                attributes: ["id", "name"] as const,
                required: true,
              },
            ] as const,
          },
        ] as const,
      });

    type NestedRow = NonNullable<Awaited<ReturnType<typeof query>>>;
    type NestedCompany = NestedRow["user"]["company"];
    const companyName: NestedCompany extends { name?: string } ? string : never =
      "Cometes";
    expect(companyName).toBe("Cometes");

    const row = await query();
    expect(queries[0]).toMatchObject({
      include: [
        {
          association: "user",
          required: true,
          include: [
            {
              association: "company",
              attributes: ["id", "name"],
              required: true,
            },
          ],
        },
      ],
    });
    expect(row?.user.company.name).toBe("Cometes");
  });

  it("permet un alias explicite et refuse un modèle non déclaré", () => {
    const { UserModel } = declareModels();

    expect(() =>
      orm.declareModel({
        name: "audit_logs",
        schema: {
          actor_id: {
            type: "number",
            references: {
              model: {
                ...UserModel,
                name: "undeclared_users",
              },
              key: "id",
              as: "actor",
            },
          },
        },
      }),
    ).toThrow('Referenced model "undeclared_users" must be declared first');
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

describe("primaryKeyWhere", () => {
  it("accepte une valeur scalaire sur une PK unique", () => {
    expect(
      primaryKeyWhere({ id: { type: "number", primary: true } }, 7),
    ).toEqual({ id: 7 });
  });

  it("exige un objet sur une PK composite", () => {
    const schema = {
      workspace_id: { type: "number" as const, primary: true as const },
      user_id: { type: "number" as const, primary: true as const },
    };
    expect(() => primaryKeyWhere(schema, 1)).toThrow(
      "Composite primary key requires an object",
    );
    expect(
      primaryKeyWhere(schema, { workspace_id: 1, user_id: 2 }),
    ).toEqual({ workspace_id: 1, user_id: 2 });
  });
});

describe("parseCachedJson", () => {
  it("restaure uniquement les Date taguées", () => {
    const at = new Date("2026-09-11T07:21:13.618Z");
    const parsed = parseCachedJson<{ at: Date; name: string; iso: string }>(
      stringifyCachedJson({
        at,
        name: "Ada",
        iso: "2026-09-11T07:21:13.618Z",
      }),
    );
    expect(parsed.at).toBeInstanceOf(Date);
    expect(parsed.at.toISOString()).toBe(at.toISOString());
    expect(parsed.name).toBe("Ada");
    expect(parsed.iso).toBe("2026-09-11T07:21:13.618Z");
  });

  it("ne transforme pas une string ISO brute en Date", () => {
    const parsed = parseCachedJson<{ note: string }>(
      '{"note":"2026-09-11T07:21:13.618Z"}',
    );
    expect(parsed.note).toBe("2026-09-11T07:21:13.618Z");
  });

  it("tague avec la clé unique du package", () => {
    const encoded = JSON.parse(
      stringifyCachedJson({ at: new Date("2026-09-11T07:21:13.618Z") }),
    ) as { at: Record<string, string> };
    expect(encoded.at).toEqual({
      [CACHED_DATE_KEY]: "2026-09-11T07:21:13.618Z",
    });
  });
});

describe("Model.create — timestamps envoyés à l'INSERT", () => {
  let orm: Orm;

  afterEach(async () => {
    if (orm) {
      await orm.disconnect().catch(() => undefined);
    }
  });

  /** Remplace `define()` pour capturer les valeurs envoyées à Sequelize. */
  const declareCapturingModel = (columns: string[]) => {
    orm = new Orm({
      postgres: { url: "postgres://orm:orm@localhost:5432/orm" },
      redis: { url: "redis://localhost:6379" },
    });

    const inserted: Record<string, unknown>[] = [];
    const attributes = Object.fromEntries(
      columns.map((column) => [column, {}]),
    );

    orm.postgres.dbInstance!.define = (() => ({
      create: async (values: Record<string, unknown>) => {
        inserted.push(values);
        return { get: () => values };
      },
      getAttributes: () => attributes,
    })) as never;

    return { inserted };
  };

  it("insère created_at et updated_at non nuls sans que l'appelant les passe", async () => {
    const { inserted } = declareCapturingModel([
      "id",
      "user_id",
      "latitude",
      "longitude",
      "created_at",
      "updated_at",
      "deleted_at",
    ]);

    const LocationModel = orm.declareModel({
      name: "locations",
      schema: {
        id: { type: "number", primary: true },
        user_id: { type: "number" },
        latitude: { type: "float" },
        longitude: { type: "float" },
        created_at: { type: "date" },
        updated_at: { type: "date" },
        deleted_at: { type: "date", nullable: true },
      },
    });

    await LocationModel.create({ user_id: 1, latitude: 1.5, longitude: 1.5 });

    expect(inserted).toHaveLength(1);
    expect(inserted[0]!["created_at"]).toBeInstanceOf(Date);
    expect(inserted[0]!["updated_at"]).toBeInstanceOf(Date);
    expect(inserted[0]).not.toHaveProperty("deleted_at");
  });

  it("conserve un created_at fourni par l'appelant", async () => {
    const { inserted } = declareCapturingModel([
      "id",
      "created_at",
      "updated_at",
    ]);

    const LocationModel = orm.declareModel({
      name: "locations",
      schema: {
        id: { type: "number", primary: true },
        created_at: { type: "date" },
        updated_at: { type: "date" },
      },
    });

    const createdAt = new Date("2020-01-01T00:00:00.000Z");
    await LocationModel.create({ created_at: createdAt });

    expect(inserted[0]!["created_at"]).toBe(createdAt);
    expect(inserted[0]!["updated_at"]).toBeInstanceOf(Date);
  });

  it("laisse l'INSERT inchangé sur un schéma sans timestamps", async () => {
    const { inserted } = declareCapturingModel(["id", "title"]);

    const PostModel = orm.declareModel({
      name: "posts",
      schema: {
        id: { type: "number", primary: true },
        title: { type: "string" },
      },
    });

    await PostModel.create({ title: "Hello" });

    expect(inserted[0]).toEqual({ title: "Hello" });
  });
});

describe("Model.update / Model.delete — where", () => {
  type WorkspaceUserSchema = {
    workspace_id: { type: "number" };
    user_id: { type: "number" };
    role: { type: "string" };
    deleted_at: { type: "date"; nullable: true };
    updated_at: { type: "date" };
  };

  type WorkspaceUserModel = Model<WorkspaceUserSchema>;

  it("typage : update(data, { where }) et delete({ where })", () => {
    const update = (model: WorkspaceUserModel, role: string) =>
      model.update(
        { role },
        {
          where: { workspace_id: 1, user_id: 2 },
          order: [["updated_at", "DESC"]],
        },
      );
    const remove = (model: WorkspaceUserModel) =>
      model.delete({
        where: { workspace_id: 1, user_id: 2 },
        order: [["updated_at", "DESC"]],
      });

    const noWriteLimit = (model: WorkspaceUserModel) =>
      model.update(
        { role: "admin" },
        {
          where: { workspace_id: 1 },
          // @ts-expect-error — PostgreSQL n'a pas de UPDATE … LIMIT
          limit: 1,
        },
      );

    const count = (model: WorkspaceUserModel) =>
      model.count({
        where: { workspace_id: 1, user_id: 2 },
        order: [["updated_at", "DESC"]],
        limit: 5,
      });

    const withTx = (model: WorkspaceUserModel, transaction: Transaction) =>
      model.update(
        { role: "admin" },
        { where: { workspace_id: 1 }, transaction },
      );

    expectTypeOf(update).returns.toEqualTypeOf<Promise<void>>();
    expectTypeOf(remove).returns.toEqualTypeOf<Promise<void>>();
    expectTypeOf(count).returns.toEqualTypeOf<Promise<number>>();
    expectTypeOf(withTx).returns.toEqualTypeOf<Promise<void>>();
    expect(typeof noWriteLimit).toBe("function");
  });

  it("refuse un champ where hors schéma", () => {
    const update = (model: WorkspaceUserModel) =>
      model.update(
        { role: "admin" },
        {
          where: {
            // @ts-expect-error — "missing" n'est pas un champ du schéma
            missing: 1,
          },
        },
      );
    const remove = (model: WorkspaceUserModel) =>
      // @ts-expect-error — where est obligatoire
      model.delete();

    expect(typeof update).toBe("function");
    expect(typeof remove).toBe("function");
  });

  let orm: Orm;

  afterEach(async () => {
    if (orm) {
      await orm.disconnect().catch(() => undefined);
    }
  });

  const declareCapturingModel = () => {
    orm = new Orm({
      postgres: { url: "postgres://orm:orm@localhost:5432/orm" },
      redis: { url: "redis://localhost:6379" },
    });

    const updates: {
      values: Record<string, unknown>;
      where: unknown;
      order?: unknown;
      limit?: number;
      transaction?: unknown;
    }[] = [];
    const destroys: {
      where: unknown;
      order?: unknown;
      limit?: number;
      transaction?: unknown;
    }[] = [];
    const counts: {
      where: unknown;
      order?: unknown;
      limit?: number;
      transaction?: unknown;
    }[] = [];
    const finds: {
      where: unknown;
      order?: unknown;
      limit?: number;
      transaction?: unknown;
      lock?: unknown;
    }[] = [];
    const attributes = {
      workspace_id: {},
      user_id: {},
      role: {},
      deleted_at: {},
      updated_at: {},
    };

    const captureExtras = (opts: {
      order?: unknown;
      limit?: number;
      transaction?: unknown;
      lock?: unknown;
    }) => ({
      ...(opts.order !== undefined ? { order: opts.order } : {}),
      ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
      ...(opts.transaction !== undefined
        ? { transaction: opts.transaction }
        : {}),
      ...(opts.lock !== undefined ? { lock: opts.lock } : {}),
    });

    orm.postgres.dbInstance!.define = (() => ({
      create: async () => ({ get: () => ({}) }),
      update: async (
        values: Record<string, unknown>,
        opts: {
          where: unknown;
          order?: unknown;
          limit?: number;
          transaction?: unknown;
        },
      ) => {
        updates.push({
          values,
          where: opts.where,
          ...captureExtras(opts),
        });
      },
      destroy: async (opts: {
        where: unknown;
        order?: unknown;
        limit?: number;
        transaction?: unknown;
      }) => {
        destroys.push({
          where: opts.where,
          ...captureExtras(opts),
        });
      },
      count: async (
        opts: {
          where?: unknown;
          order?: unknown;
          limit?: number;
          transaction?: unknown;
        } = {},
      ) => {
        counts.push({
          where: opts.where,
          ...captureExtras(opts),
        });
        return 2;
      },
      findAll: async (opts: {
        where?: unknown;
        order?: unknown;
        limit?: number;
        transaction?: unknown;
        lock?: unknown;
      }) => {
        finds.push({
          where: opts.where,
          ...captureExtras(opts),
        });
        return [];
      },
      findOne: async (opts: {
        where?: unknown;
        order?: unknown;
        limit?: number;
        transaction?: unknown;
        lock?: unknown;
      }) => {
        finds.push({
          where: opts.where,
          ...captureExtras(opts),
        });
        return null;
      },
      getAttributes: () => attributes,
    })) as never;

    return { updates, destroys, counts, finds };
  };

  it("update envoie data + where (deleted_at: null par défaut, updated_at now)", async () => {
    const { updates } = declareCapturingModel();

    const WorkspaceUserModel = orm.declareModel({
      name: "workspace_users",
      schema: {
        workspace_id: { type: "number" },
        user_id: { type: "number" },
        role: { type: "string" },
        deleted_at: { type: "date", nullable: true },
        updated_at: { type: "date" },
      },
    });

    await WorkspaceUserModel.update(
      { role: "admin" },
      { where: { workspace_id: 10, user_id: 20 } },
    );

    expect(updates).toHaveLength(1);
    expect(updates[0]!.values["role"]).toBe("admin");
    expect(updates[0]!.values["updated_at"]).toBeInstanceOf(Date);
    expect(updates[0]!.where).toEqual({
      deleted_at: null,
      workspace_id: 10,
      user_id: 20,
    });
  });

  it("delete pose deleted_at au lieu de détruire la ligne", async () => {
    const { updates, destroys } = declareCapturingModel();

    const WorkspaceUserModel = orm.declareModel({
      name: "workspace_users",
      schema: {
        workspace_id: { type: "number" },
        user_id: { type: "number" },
        role: { type: "string" },
        deleted_at: { type: "date", nullable: true },
        updated_at: { type: "date" },
      },
    });

    await WorkspaceUserModel.delete({
      where: { workspace_id: 10, user_id: 20 },
    });

    expect(destroys).toHaveLength(0);
    expect(updates).toHaveLength(1);
    expect(updates[0]!.values["deleted_at"]).toBeInstanceOf(Date);
    expect(updates[0]!.values["updated_at"]).toBeInstanceOf(Date);
    expect(updates[0]!.where).toEqual({
      deleted_at: null,
      workspace_id: 10,
      user_id: 20,
    });
  });

  it("count applique le where et le défaut deleted_at: null", async () => {
    const { counts } = declareCapturingModel();

    const WorkspaceUserModel = orm.declareModel({
      name: "workspace_users",
      schema: {
        workspace_id: { type: "number" },
        user_id: { type: "number" },
        role: { type: "string" },
        deleted_at: { type: "date", nullable: true },
        updated_at: { type: "date" },
      },
    });

    await expect(
      WorkspaceUserModel.count({
        where: { workspace_id: 10, user_id: 20 },
      }),
    ).resolves.toBe(2);

    expect(counts).toHaveLength(1);
    expect(counts[0]!.where).toEqual({
      deleted_at: null,
      workspace_id: 10,
      user_id: 20,
    });
  });

  it("findAll / count transmettent order et limit ; update / delete seulement order", async () => {
    const { finds, updates, destroys, counts } = declareCapturingModel();
    const order = [["updated_at", "DESC"], "user_id"] as const;

    const WorkspaceUserModel = orm.declareModel({
      name: "workspace_users",
      schema: {
        workspace_id: { type: "number" },
        user_id: { type: "number" },
        role: { type: "string" },
        deleted_at: { type: "date", nullable: true },
        updated_at: { type: "date" },
      },
    });

    await WorkspaceUserModel.findAll({
      attributes: ["workspace_id", "user_id"] as const,
      where: { workspace_id: 10 },
      order,
      limit: 3,
    });
    await WorkspaceUserModel.update(
      { role: "admin" },
      { where: { workspace_id: 10 }, order },
    );
    await WorkspaceUserModel.delete({
      where: { workspace_id: 10 },
      order,
    });
    await WorkspaceUserModel.count({
      where: { workspace_id: 10 },
      order,
      limit: 5,
    });

    expect(finds[0]).toMatchObject({ order, limit: 3 });
    expect(updates[0]).toMatchObject({ order });
    expect(updates[0]).not.toHaveProperty("limit");
    expect(updates[1]).toMatchObject({ order });
    expect(updates[1]).not.toHaveProperty("limit");
    expect(destroys).toHaveLength(0);
    expect(counts[0]).toMatchObject({ order, limit: 5 });
  });

  it("transmet la transaction courante et une transaction explicite", async () => {
    const { finds, updates, destroys, counts } = declareCapturingModel();
    const fakeTx = { id: "implicit" };
    const explicitTx = { id: "explicit" };
    orm.currentTransaction = fakeTx as never;

    const WorkspaceUserModel = orm.declareModel({
      name: "workspace_users",
      schema: {
        workspace_id: { type: "number" },
        user_id: { type: "number" },
        role: { type: "string" },
        deleted_at: { type: "date", nullable: true },
        updated_at: { type: "date" },
      },
    });

    await WorkspaceUserModel.findAll({
      where: { workspace_id: 10 },
    });
    await WorkspaceUserModel.update(
      { role: "admin" },
      { where: { workspace_id: 10 }, transaction: explicitTx as never },
    );
    await WorkspaceUserModel.delete({
      where: { workspace_id: 10 },
    });
    await WorkspaceUserModel.count({
      where: { workspace_id: 10 },
    });

    expect(finds[0]?.transaction).toBe(fakeTx);
    expect(updates[0]?.transaction).toBe(explicitTx);
    expect(updates[1]?.transaction).toBe(fakeTx);
    expect(destroys).toHaveLength(0);
    expect(counts[0]?.transaction).toBe(fakeTx);
  });

  it("transmet lock (courant, explicite, ou lock: false)", async () => {
    const { finds } = declareCapturingModel();
    const fakeTx = { id: "tx" };
    orm.currentTransaction = fakeTx as never;
    orm.currentLock = "UPDATE";

    const WorkspaceUserModel = orm.declareModel({
      name: "workspace_users",
      schema: {
        workspace_id: { type: "number" },
        user_id: { type: "number" },
        role: { type: "string" },
        deleted_at: { type: "date", nullable: true },
        updated_at: { type: "date" },
      },
    });

    await WorkspaceUserModel.findAll({
      where: { workspace_id: 10 },
    });
    await WorkspaceUserModel.findOne({
      where: { workspace_id: 10 },
      lock: "SHARE",
    });
    await WorkspaceUserModel.findAll({
      where: { workspace_id: 10 },
      lock: false,
    });

    expect(finds[0]?.lock).toBe("UPDATE");
    expect(finds[1]?.lock).toBe("SHARE");
    expect(finds[2]?.lock).toBeUndefined();
  });

  it("refuse un lock sans transaction", async () => {
    const { finds } = declareCapturingModel();

    const WorkspaceUserModel = orm.declareModel({
      name: "workspace_users",
      schema: {
        workspace_id: { type: "number" },
        user_id: { type: "number" },
        role: { type: "string" },
        deleted_at: { type: "date", nullable: true },
        updated_at: { type: "date" },
      },
    });

    await expect(
      WorkspaceUserModel.findOne({
        where: { workspace_id: 10 },
        lock: true,
      }),
    ).rejects.toThrow("A transaction is required to lock rows");
    expect(finds).toHaveLength(0);
  });

  it("ne cache pas les lectures avec where, include, order ou limit", async () => {
    const { finds } = declareCapturingModel();
    const gets: string[] = [];
    const sets: string[] = [];
    orm.cache(true);
    orm.redis.get = (async (key: string) => {
      gets.push(key);
      return null;
    }) as typeof orm.redis.get;
    orm.redis.set = (async (key: string) => {
      sets.push(key);
    }) as typeof orm.redis.set;

    const WorkspaceUserModel = orm.declareModel({
      name: "workspace_users",
      schema: {
        workspace_id: { type: "number" },
        user_id: { type: "number" },
        role: { type: "string" },
        deleted_at: { type: "date", nullable: true },
        updated_at: { type: "date" },
      },
    });

    await WorkspaceUserModel.findAll({
      attributes: ["workspace_id"] as const,
    });
    await WorkspaceUserModel.findAll({
      attributes: ["workspace_id"] as const,
      where: { workspace_id: 10 },
    });
    await WorkspaceUserModel.findAll({
      attributes: ["workspace_id"] as const,
      order: ["workspace_id"],
    });
    await WorkspaceUserModel.findAll({
      attributes: ["workspace_id"] as const,
      limit: 2,
    });
    await WorkspaceUserModel.findAll({
      attributes: ["workspace_id"] as const,
      include: [],
    } as never);

    expect(finds).toHaveLength(5);
    expect(gets).toEqual([
      "cometes:orm:model:workspace_users:findAll:workspace_id",
    ]);
    expect(sets).toEqual([
      "cometes:orm:model:workspace_users:findAll:workspace_id",
    ]);
  });

  it("invalide tout le préfixe du modèle à chaque écriture", async () => {
    declareCapturingModel();
    const prefixes: string[] = [];
    orm.cache(true);
    orm.redis.delStartWith = (async (prefix: string) => {
      prefixes.push(prefix);
    }) as typeof orm.redis.delStartWith;

    const UserModel = orm.declareModel({
      name: "users",
      schema: {
        id: { type: "number", primary: true },
        name: { type: "string" },
      },
    });

    await UserModel.create({ name: "Ada" });
    await UserModel.updateOne(1, { name: "Ada Lovelace" });
    await UserModel.update({ name: "x" }, { where: { id: 1 } });
    await UserModel.deleteOne(1);
    await UserModel.delete({ where: { id: 1 } });

    expect(prefixes).toEqual([
      "cometes:orm:model:users:",
      "cometes:orm:model:users:",
      "cometes:orm:model:users:",
      "cometes:orm:model:users:",
      "cometes:orm:model:users:",
    ]);
  });

  it("updateOne / deleteOne ciblent une clé primaire composite", async () => {
    const { updates } = declareCapturingModel();

    const WorkspaceUserModel = orm.declareModel({
      name: "workspace_users",
      schema: {
        workspace_id: { type: "number", primary: true },
        user_id: { type: "number", primary: true },
        role: { type: "string" },
        deleted_at: { type: "date", nullable: true },
        updated_at: { type: "date" },
      },
    });

    await expect(WorkspaceUserModel.updateOne(1 as never, { role: "admin" })).rejects.toThrow(
      "Composite primary key requires an object",
    );

    await WorkspaceUserModel.updateOne(
      { workspace_id: 10, user_id: 20 },
      { role: "admin" },
    );
    await WorkspaceUserModel.deleteOne({ workspace_id: 10, user_id: 20 });

    expect(updates[0]!.where).toEqual({ workspace_id: 10, user_id: 20 });
    expect(updates[1]!.where).toEqual({
      deleted_at: null,
      workspace_id: 10,
      user_id: 20,
    });
    expect(updates[1]!.values["deleted_at"]).toBeInstanceOf(Date);
  });

  it("delete sans deleted_at détruit vraiment la ligne", async () => {
    const { destroys } = declareCapturingModel();

    const TagModel = orm.declareModel({
      name: "tags",
      schema: {
        id: { type: "number", primary: true },
        name: { type: "string" },
      },
    });

    await TagModel.delete({ where: { id: 1 } });
    expect(destroys).toHaveLength(1);
    expect(destroys[0]!.where).toEqual({ id: 1 });
  });

  it("force: true détruit même avec deleted_at", async () => {
    const { updates, destroys } = declareCapturingModel();

    const UserModel = orm.declareModel({
      name: "users",
      schema: {
        id: { type: "number", primary: true },
        deleted_at: { type: "date", nullable: true },
      },
    });

    await UserModel.deleteOne(1, { force: true });
    expect(updates).toHaveLength(0);
    expect(destroys).toHaveLength(1);
    expect(destroys[0]!.where).toEqual({ id: 1 });
  });

  it("relit les Date depuis le cache Redis", async () => {
    declareCapturingModel();
    const createdAt = new Date("2026-09-11T07:21:13.618Z");
    orm.cache(true);
    orm.redis.get = (async () =>
      stringifyCachedJson({
        id: 1,
        created_at: createdAt,
      })) as typeof orm.redis.get;

    const UserModel = orm.declareModel({
      name: "users",
      schema: {
        id: { type: "number", primary: true },
        created_at: { type: "date" },
      },
    });

    const row = await UserModel.findOne({ attributes: ["id", "created_at"] as const });
    expect(row?.created_at).toBeInstanceOf(Date);
    expect(row?.created_at.toISOString()).toBe(createdAt.toISOString());
  });
});
