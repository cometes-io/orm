import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  Op,
  Orm,
  modelCacheNamespace,
} from "../src/index.js";
import {
  POSTGRES_URL,
  REDIS_URL,
  postgresReachable,
  redisReachable,
} from "./helpers/services.js";

/**
 * CRUD réel contre PostgreSQL (et Redis si dispo).
 * Tables préfixées `orm_it_` pour ne pas croiser l'exemple Node.js.
 */
describe.skipIf(!postgresReachable)("Model (intégration SQL)", () => {
  let orm: Orm;
  let PersonModel: ReturnType<typeof declarePerson>;
  let MembershipModel: ReturnType<typeof declareMembership>;

  const declarePerson = () =>
    orm.declareModel({
      name: "orm_it_people",
      schema: {
        id: { type: "number", primary: true },
        name: { type: "string" },
        status: {
          type: "string",
          enum: ["active", "inactive", "archived"],
          default: "active",
        },
        created_at: { type: "date" },
        updated_at: { type: "date" },
        deleted_at: { type: "date", nullable: true },
      },
    });

  const declareMembership = (
    person: ReturnType<typeof declarePerson>,
  ) =>
    orm.declareModel({
      name: "orm_it_memberships",
      schema: {
        workspace_id: { type: "number", primary: true },
        user_id: {
          type: "number",
          primary: true,
          references: { model: person, key: "id" },
        },
        role: {
          type: "string",
          enum: ["member", "admin"],
          default: "member",
        },
        created_at: { type: "date" },
        updated_at: { type: "date" },
        deleted_at: { type: "date", nullable: true },
      },
    });

  beforeAll(async () => {
    orm = new Orm({
      postgres: { url: POSTGRES_URL },
      redis: { url: REDIS_URL },
    });
    orm.log(false);
    orm.cache(false);
    await orm.connect();

    await orm.postgres.query(`DROP TABLE IF EXISTS orm_it_memberships`);
    await orm.postgres.query(`DROP TABLE IF EXISTS orm_it_people`);
    await orm.postgres.query(`
      CREATE TABLE orm_it_people (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        deleted_at TIMESTAMPTZ
      )
    `);
    await orm.postgres.query(`
      CREATE TABLE orm_it_memberships (
        workspace_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL REFERENCES orm_it_people (id) ON DELETE CASCADE,
        role TEXT NOT NULL DEFAULT 'member',
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        deleted_at TIMESTAMPTZ,
        PRIMARY KEY (workspace_id, user_id)
      )
    `);

    PersonModel = declarePerson();
    MembershipModel = declareMembership(PersonModel);
  });

  beforeEach(async () => {
    orm.cache(false);
    await orm.postgres.query(`TRUNCATE orm_it_memberships, orm_it_people RESTART IDENTITY CASCADE`);
    if (redisReachable) {
      await orm.redis.delStartWith(modelCacheNamespace("orm_it_people"));
      await orm.redis.delStartWith(modelCacheNamespace("orm_it_memberships"));
    }
  });

  afterAll(async () => {
    if (!orm) {
      return;
    }
    await orm.postgres.query(`DROP TABLE IF EXISTS orm_it_memberships`).catch(() => undefined);
    await orm.postgres.query(`DROP TABLE IF EXISTS orm_it_people`).catch(() => undefined);
    await orm.disconnect();
  });

  it("create / findOne / findAll / count parcourent vraiment PostgreSQL", async () => {
    const created = await PersonModel.create({ name: "Ada" });
    expect(created.id).toBe(1);
    expect(created.name).toBe("Ada");
    expect(created.status).toBe("active");
    expect(created.created_at).toBeInstanceOf(Date);
    expect(created.updated_at).toBeInstanceOf(Date);
    expect(created.deleted_at).toBeNull();

    const found = await PersonModel.findOne({
      attributes: ["id", "name", "status"] as const,
      where: { id: created.id },
    });
    expect(found).toEqual({ id: 1, name: "Ada", status: "active" });

    await PersonModel.create({ name: "Grace", status: "inactive" });
    const listed = await PersonModel.findAll({
      attributes: ["id", "name"] as const,
      order: [["id", "ASC"]],
      limit: 10,
    });
    expect(listed).toEqual([
      { id: 1, name: "Ada" },
      { id: 2, name: "Grace" },
    ]);

    await expect(PersonModel.count({ where: { status: "active" } })).resolves.toBe(
      1,
    );
  });

  it("updateOne et update persistent en base", async () => {
    const person = await PersonModel.create({ name: "Ada" });
    await PersonModel.updateOne(person.id, { name: "Ada Lovelace" });

    const afterOne = await PersonModel.findOne({
      attributes: ["id", "name"] as const,
      where: { id: person.id },
    });
    expect(afterOne?.name).toBe("Ada Lovelace");

    await PersonModel.update(
      { status: "archived" },
      { where: { id: person.id } },
    );
    const afterAll = await PersonModel.findOne({
      attributes: ["status"] as const,
      where: { id: person.id },
    });
    expect(afterAll?.status).toBe("archived");
  });

  it("include joint la FK et soft-delete / force se voient en SQL", async () => {
    const person = await PersonModel.create({ name: "Ada" });
    const membership = await MembershipModel.create({
      workspace_id: 9,
      user_id: person.id,
    });
    expect(membership.role).toBe("member");

    await MembershipModel.updateOne(
      { workspace_id: 9, user_id: person.id },
      { role: "admin" },
    );

    const withUser = await MembershipModel.findOne({
      attributes: ["workspace_id", "user_id", "role"] as const,
      where: { workspace_id: 9, user_id: person.id },
      include: [
        {
          relation: "user_id",
          model: PersonModel,
          attributes: ["id", "name"] as const,
          required: true,
        },
      ] as const,
    });
    expect(withUser).toMatchObject({
      workspace_id: 9,
      user_id: person.id,
      role: "admin",
      user: { id: person.id, name: "Ada" },
    });

    await PersonModel.deleteOne(person.id);
    await expect(
      PersonModel.findOne({ where: { id: person.id } }),
    ).resolves.toBeNull();
    await expect(
      PersonModel.count({ where: { deleted_at: undefined } }),
    ).resolves.toBe(1);

    await PersonModel.deleteOne(person.id, { force: true });
    await expect(
      PersonModel.count({ where: { deleted_at: undefined } }),
    ).resolves.toBe(0);
  });

  it("transaction(fn) commit et rollback se voient en base", async () => {
    await orm.transaction(async () => {
      await PersonModel.create({ name: "Committed" });
    });
    await expect(PersonModel.count()).resolves.toBe(1);

    await expect(
      orm.transaction(async () => {
        await PersonModel.create({ name: "Rolled back" });
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");

    await expect(PersonModel.count()).resolves.toBe(1);
    const names = await PersonModel.findAll({
      attributes: ["name"] as const,
      order: ["id"],
    });
    expect(names).toEqual([{ name: "Committed" }]);
  });

  it("Op.in filtre réellement les lignes", async () => {
    await PersonModel.create({ name: "Ada", status: "active" });
    await PersonModel.create({ name: "Grace", status: "inactive" });
    await PersonModel.create({ name: "Edsger", status: "archived" });

    const rows = await PersonModel.findAll({
      attributes: ["name"] as const,
      where: { status: { [Op.in]: ["active", "inactive"] } },
      order: ["name"],
    });
    expect(rows.map((row) => row.name)).toEqual(["Ada", "Grace"]);
  });
});

describe.skipIf(!postgresReachable || !redisReachable)(
  "Model (intégration cache Redis)",
  () => {
    let orm: Orm;
    let PersonModel: ReturnType<typeof declareCachePerson>;

    const declareCachePerson = () =>
      orm.declareModel({
        name: "orm_it_cache_people",
        schema: {
          id: { type: "number", primary: true },
          name: { type: "string" },
          created_at: { type: "date" },
          updated_at: { type: "date" },
          deleted_at: { type: "date", nullable: true },
        },
      });

    beforeAll(async () => {
      orm = new Orm({
        postgres: { url: POSTGRES_URL },
        redis: { url: REDIS_URL },
      });
      orm.log(false);
      await orm.connect();
      await orm.postgres.query(`DROP TABLE IF EXISTS orm_it_cache_people`);
      await orm.postgres.query(`
        CREATE TABLE orm_it_cache_people (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL,
          deleted_at TIMESTAMPTZ
        )
      `);
      PersonModel = declareCachePerson();
    });

    beforeEach(async () => {
      await orm.postgres.query(
        `TRUNCATE orm_it_cache_people RESTART IDENTITY CASCADE`,
      );
      await orm.redis.delStartWith(modelCacheNamespace("orm_it_cache_people"));
    });

    afterAll(async () => {
      if (!orm) {
        return;
      }
      await orm.postgres
        .query(`DROP TABLE IF EXISTS orm_it_cache_people`)
        .catch(() => undefined);
      await orm.disconnect();
    });

    it("sert la 2e lecture depuis Redis et restaure les Date", async () => {
      const created = await PersonModel.create({ name: "Ada" });
      orm.cache(true);

      const first = await PersonModel.findAll({
        attributes: ["id", "name", "created_at"] as const,
      });
      expect(first[0]?.created_at).toBeInstanceOf(Date);

      const second = await PersonModel.findAll({
        attributes: ["id", "name", "created_at"] as const,
      });
      expect(second).toEqual(first);
      expect(second[0]?.created_at).toBeInstanceOf(Date);

      await PersonModel.updateOne(created.id, { name: "Ada Lovelace" });
      const afterWrite = await PersonModel.findAll({
        attributes: ["id", "name"] as const,
      });
      expect(afterWrite).toEqual([{ id: created.id, name: "Ada Lovelace" }]);
    });
  },
);
