import { Op, type WhereOptions } from "sequelize";
import { Orm } from "../index.js";

export { Op };

/**
 * Types de champs supportés par le schéma.
 */
export type FieldType = "string" | "number" | "boolean" | "float" | "date";

/**
 * Description d'un champ de modèle.
 */
export type DefineModelSchema = {
  type: FieldType;
  primary?: boolean;
};

/**
 * Description d'une valeur de modèle.
 */
export type DefineModelValue = string | number | boolean | Date;

export type TValues = Record<string, DefineModelValue>;

/**
 * Valeur TypeScript dérivée du descripteur de champ.
 */
type InferFieldValue<T extends DefineModelSchema> = T["type"] extends
  | "number"
  | "float"
  ? number
  : T["type"] extends "boolean"
    ? boolean
    : T["type"] extends "date"
      ? Date
      : string;

/**
 * Ligne de données dérivée du schéma (valeurs, pas descripteurs).
 */
export type InferValues<TSchema extends Record<string, DefineModelSchema>> = {
  [K in keyof TSchema]: InferFieldValue<TSchema[K]>;
};

/**
 * Ligne partielle : chaque champ du schéma est facultatif.
 */
export type InferPartialValues<
  TSchema extends Record<string, DefineModelSchema>,
> = {
  [K in keyof TSchema]?: InferFieldValue<TSchema[K]>;
};

/**
 * Clés de schéma acceptées par `attributes`.
 */
export type AttributeKeys<
  TSchema extends Record<string, DefineModelSchema>,
> = readonly (keyof TSchema)[];

/**
 * Valeurs correspondant aux attributs sélectionnés.
 */
export type SelectedValues<
  TSchema extends Record<string, DefineModelSchema>,
  TAttributes extends AttributeKeys<TSchema>,
> = Pick<InferValues<TSchema>, TAttributes[number]>;

/**
 * Clause `where` : égalité sur les champs du schéma, ou opérateurs Sequelize
 * (`{ [Op.not]: null }`, `{ [Op.gt]: 1 }`, `Op.and` / `Op.or`, …).
 */
export type WhereClause<TSchema extends Record<string, DefineModelSchema>> =
  WhereOptions<{
    [K in keyof InferValues<TSchema>]: InferValues<TSchema>[K] | null;
  }>;

/**
 * Options passées à {@link defineModel}.
 */
export type DefineModelOptions<
  TSchema extends Record<string, DefineModelSchema> = Record<
    string,
    DefineModelSchema
  >,
> = {
  name: string;
  schema: TSchema;
};

/**
 * Définition de modèle retournée par {@link defineModel}.
 */
export interface Model<
  TSchema extends Record<string, DefineModelSchema> = Record<
    string,
    DefineModelSchema
  >,
> {
  readonly name: string;
  readonly schema: TSchema;
  readonly create: (data: Partial<InferValues<TSchema>>) => Promise<any>;
  findAll<const TAttributes extends AttributeKeys<TSchema>>(
    options: {
      attributes: TAttributes;
      where?: WhereClause<TSchema>;
    },
  ): Promise<SelectedValues<TSchema, TAttributes>[]>;
  findAll(options?: {
    where?: WhereClause<TSchema>;
  }): Promise<InferValues<TSchema>[]>;
  findOne<const TAttributes extends AttributeKeys<TSchema>>(
    options: {
      attributes: TAttributes;
      where?: WhereClause<TSchema>;
    },
  ): Promise<SelectedValues<TSchema, TAttributes> | null>;
  findOne(options?: {
    where?: WhereClause<TSchema>;
  }): Promise<InferValues<TSchema> | null>;
  readonly updateOne: (
    id: string | number,
    data: Partial<InferValues<TSchema>>,
  ) => Promise<void>;
  readonly deleteOne: (id: string | number) => Promise<void>;
}

/**
 * Déclare un modèle (table / collection) avec son schéma.
 *
 * @example
 * ```ts
 * export const UserModel = defineModel({
 *   name: "users",
 *   schema: {
 *     id: { type: "number", primary: true },
 *     name: { type: "string" },
 *   },
 * });
 * ```
 */
export function defineModel<
  TSchema extends Record<string, DefineModelSchema>, TORM extends Orm
>(options: DefineModelOptions<TSchema>, ORM: TORM): Model<TSchema> {
  const model = ORM.postgres.dbInstance!.define(options.name, ORM.postgres.formatModelSchema(options.schema), {
    createdAt: false,
    updatedAt: false,
    deletedAt: false,
  });
  return {
    name: options.name,
    schema: options.schema,
    create: async (data: Partial<InferValues<TSchema>>) => {
      // remove CACHE
      if (ORM.cacheEnabled && ORM.redis) {
        await ORM.redis.delStartWith(`model:${options.name}:findAll`);
      }

      return await model.create(ORM.postgres.getFieldsFromSchema(data as TValues, model.getAttributes()), { logging: ORM.logEnabled ? console.log : false });
    },
    findOne: (async ({
      attributes,
      where,
    }: {
      attributes?: AttributeKeys<TSchema>;
      where?: WhereClause<TSchema>;
    } = {}) => {
      const cacheKey = `model:${options.name}:findOne:${attributes?.join(",") ?? ""}:${JSON.stringify(where)}`;
      
      if (ORM.cacheEnabled && ORM.redis) {
        const cached = await ORM.redis.get(cacheKey);
        if (cached !== null) {
          return JSON.parse(cached) as InferValues<TSchema>;
        }
      }

      const optionsQuery: { attributes?: string[], where?: any } = {}
      if(attributes) {
        optionsQuery.attributes = ORM.postgres.getColumnsFromSchema(attributes as string[], model.getAttributes());
      }
      if(where) {
        optionsQuery.where = where;
      }

      const row = await model.findOne({ ...optionsQuery, raw: true, logging: ORM.logEnabled ? console.log : false });
      return row as InferValues<TSchema> | null;
    }) as Model<TSchema>["findOne"],
    updateOne: async (id: string | number, data: Partial<InferValues<TSchema>>) => {
      // remove CACHE
      if (ORM.cacheEnabled && ORM.redis) {
        await ORM.redis.delStartWith(`model:${options.name}:findOne`);
      }

      await model.update(ORM.postgres.getFieldsFromSchema(data as TValues, model.getAttributes()), { where: { id }, logging: ORM.logEnabled ? console.log : false });
    },
    deleteOne: async (id: string | number) => {
      // remove CACHE
      if (ORM.cacheEnabled && ORM.redis) {
        await ORM.redis.delStartWith(`model:${options.name}`);
      }

      await model.destroy({ where: { id }, logging: ORM.logEnabled ? console.log : false });
    },
    findAll: (async ({
      attributes,
      where,
    }: {
      attributes?: AttributeKeys<TSchema>;
      where?: WhereClause<TSchema>;
    } = {}) => {
      let disableCache = false;
      if(where) {
        disableCache = true;
      }

      const cacheKey = disableCache ? null : `model:${options.name}:findAll:${attributes?.join(",") ?? ""}`;
      
      if (cacheKey && ORM.cacheEnabled && ORM.redis) {
        const cached = await ORM.redis.get(cacheKey);
        if (cached !== null) {
          return JSON.parse(cached) as InferValues<TSchema>[];
        }
      }

      const optionsQuery: { attributes?: string[], where?: any } = {}
      if(attributes) {
        optionsQuery.attributes = ORM.postgres.getColumnsFromSchema(attributes as string[], model.getAttributes());
      }
      if(where) {
        optionsQuery.where = where;
      }
      
      const rows = await model.findAll({ ...optionsQuery, raw: true, logging: ORM.logEnabled ? console.log : false });
      
      if (cacheKey &&ORM.cacheEnabled && ORM.redis) {
        await ORM.redis.set(cacheKey, JSON.stringify(rows));
        // optionnel : TTL → redis.set(cacheKey, ..., { EX: 60 })
      }
      return rows as InferValues<TSchema>[];
    }) as Model<TSchema>["findAll"],
  };
}
