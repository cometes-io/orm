import { Orm } from "../index.js";

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
export type Model<
  TSchema extends Record<string, DefineModelSchema> = Record<
    string,
    DefineModelSchema
  >,
> = {
  readonly name: string;
  readonly schema: TSchema;
  readonly create: (data: Partial<InferValues<TSchema>>) => Promise<any>;
  readonly findAll: (options?: {
    attributes?: string[];
  }) => Promise<InferValues<TSchema>[]>;
  readonly findOne: (options?: {
    attributes?: string[];
    where?: Partial<InferValues<TSchema>>;
  }) => Promise<InferValues<TSchema> | null>;
  readonly updateOne: (
    id: string | number,
    data: Partial<InferValues<TSchema>>,
  ) => Promise<void>;
  readonly deleteOne: (id: string | number) => Promise<void>;
};

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
    findOne: async ({ attributes, where }: { attributes?: string[], where?: Partial<InferValues<TSchema>> } = {}) => {
      const cacheKey = `model:${options.name}:findOne:${attributes?.join(",") ?? ""}:${JSON.stringify(where)}`;
      
      if (ORM.cacheEnabled && ORM.redis) {
        const cached = await ORM.redis.get(cacheKey);
        if (cached !== null) {
          return JSON.parse(cached) as InferValues<TSchema>;
        }
      }

      const optionsQuery: { attributes?: string[] } = {}
      if(attributes) {
        optionsQuery.attributes = ORM.postgres.getColumnsFromSchema(attributes, model.getAttributes());
      }
      
      const row = await model.findOne({ ...optionsQuery, raw: true, logging: ORM.logEnabled ? console.log : false });
      return row as InferValues<TSchema> | null;
    },
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
    findAll: async ({ attributes }: { attributes?: string[] } = {}) => {
      const cacheKey = `model:${options.name}:findAll:${attributes?.join(",") ?? ""}`;
      
      if (ORM.cacheEnabled && ORM.redis) {
        const cached = await ORM.redis.get(cacheKey);
        if (cached !== null) {
          return JSON.parse(cached) as InferValues<TSchema>[];
        }
      }

      const optionsQuery: { attributes?: string[] } = {}
      if(attributes) {
        optionsQuery.attributes = ORM.postgres.getColumnsFromSchema(attributes, model.getAttributes());
      }
      
      const rows = await model.findAll({ ...optionsQuery, raw: true, logging: ORM.logEnabled ? console.log : false });
      
      if (ORM.cacheEnabled && ORM.redis) {
        await ORM.redis.set(cacheKey, JSON.stringify(rows));
        // optionnel : TTL → redis.set(cacheKey, ..., { EX: 60 })
      }
      return rows as InferValues<TSchema>[];
    },
  };
}
