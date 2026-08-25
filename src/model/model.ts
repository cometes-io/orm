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
  /** Si `true`, la valeur inférée est `T | null`. */
  nullable?: true;
};

/**
 * Description d'une valeur de modèle.
 */
export type DefineModelValue = string | number | boolean | Date;

export type TValues = Record<string, DefineModelValue>;

/**
 * Valeur TypeScript dérivée du type de champ (sans nullabilité).
 */
type InferFieldBase<T extends DefineModelSchema> = T["type"] extends
  | "number"
  | "float"
  ? number
  : T["type"] extends "boolean"
    ? boolean
    : T["type"] extends "date"
      ? Date
      : string;

/**
 * Valeur TypeScript dérivée du descripteur de champ.
 */
type InferFieldValue<T extends DefineModelSchema> = T extends {
  nullable: true;
}
  ? InferFieldBase<T> | null
  : InferFieldBase<T>;

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
> = Partial<InferValues<TSchema>>;

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

/** Champ de soft delete filtré par défaut dans `findAll` / `findOne`. */
const SOFT_DELETE_FIELD = "deleted_at";

/** Champ horodaté à la création. */
const CREATED_AT_FIELD = "created_at";

/** Champ horodaté à chaque `updateOne`. */
const UPDATED_AT_FIELD = "updated_at";

const isPlainWhereObject = (value: unknown): boolean => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const hasSoftDeleteField = (clause: unknown): boolean =>
  typeof clause === "object" && clause !== null && SOFT_DELETE_FIELD in clause;

/**
 * Ajoute `deleted_at: null` à la clause `where` quand le schéma possède ce
 * champ et que l'appelant ne le renseigne pas lui-même.
 *
 * Renseigner `deleted_at` surcharge le défaut ; `deleted_at: undefined` retire
 * le filtre (toutes les lignes, supprimées incluses).
 *
 * Interne — exporté pour les tests.
 */
export function applySoftDeleteDefault<
  TSchema extends Record<string, DefineModelSchema>,
>(
  schema: TSchema,
  where?: WhereClause<TSchema>,
): WhereClause<TSchema> | undefined {
  if (!(SOFT_DELETE_FIELD in schema)) {
    return where;
  }

  const asWhereClause = (clause: unknown) => clause as WhereClause<TSchema>;
  const defaultClause = { [SOFT_DELETE_FIELD]: null };

  if (where === undefined) {
    return asWhereClause(defaultClause);
  }

  if (Array.isArray(where)) {
    return asWhereClause(
      where.some(hasSoftDeleteField) ? where : [defaultClause, ...where],
    );
  }

  // `literal()`, `fn()`, `where()` … : ne pas les décomposer, les combiner en AND
  if (!isPlainWhereObject(where)) {
    return asWhereClause({ [Op.and]: [defaultClause, where] });
  }

  const clause = where as Record<string | symbol, unknown>;

  if (!hasSoftDeleteField(clause)) {
    return asWhereClause({ ...defaultClause, ...clause });
  }

  if (clause[SOFT_DELETE_FIELD] === undefined) {
    const { [SOFT_DELETE_FIELD]: _unfiltered, ...rest } = clause;
    return asWhereClause(rest);
  }

  return where;
}

/**
 * Force `updated_at` à l'instant présent quand le schéma possède ce champ.
 *
 * Interne — exporté pour les tests.
 */
export function applyUpdatedAt<
  TSchema extends Record<string, DefineModelSchema>,
>(
  schema: TSchema,
  data: Partial<InferValues<TSchema>>,
): Partial<InferValues<TSchema>> {
  if (!(UPDATED_AT_FIELD in schema)) {
    return data;
  }

  return { ...data, [UPDATED_AT_FIELD]: new Date() };
}

const isProvided = (data: object, field: string): boolean =>
  field in data && (data as Record<string, unknown>)[field] !== undefined;

/**
 * Remplit `created_at` / `updated_at` avec `new Date()` à l'INSERT quand le
 * schéma les possède et que l'appelant ne les fournit pas.
 *
 * Une valeur fournie n'est pas écrasée. `deleted_at` n'est pas touché.
 *
 * Interne — exporté pour les tests.
 */
export function applyCreateTimestamps<
  TSchema extends Record<string, DefineModelSchema>,
>(
  schema: TSchema,
  data: Partial<InferValues<TSchema>>,
): Partial<InferValues<TSchema>> {
  const now = new Date();
  const hasCreatedAt = CREATED_AT_FIELD in schema;
  const hasUpdatedAt = UPDATED_AT_FIELD in schema;

  if (!hasCreatedAt && !hasUpdatedAt) {
    return data;
  }

  const values: Partial<InferValues<TSchema>> = { ...data };

  if (hasCreatedAt && !isProvided(data, CREATED_AT_FIELD)) {
    (values as Record<string, unknown>)[CREATED_AT_FIELD] = now;
  }

  if (hasUpdatedAt && !isProvided(data, UPDATED_AT_FIELD)) {
    (values as Record<string, unknown>)[UPDATED_AT_FIELD] = now;
  }

  return values;
}

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
  /**
   * Ligne inférée du schéma (`InferValues<TSchema>`).
   * Phantom TypeScript : ne pas lire à runtime.
   *
   * @example
   * ```ts
   * type LocationRecord = typeof LocationModel.$schema;
   * ```
   */
  readonly $schema: InferValues<TSchema>;
  readonly create: (data: Partial<InferValues<TSchema>>) => Promise<InferValues<TSchema>>;
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
    $schema: undefined as unknown as InferValues<TSchema>,
    create: async (data: Partial<InferValues<TSchema>>) => {
      // remove CACHE
      if (ORM.cacheEnabled && ORM.redis) {
        await ORM.redis.delStartWith(`model:${options.name}:findAll`);
      }

      const values = applyCreateTimestamps(options.schema, data);

      const created = await model.create(ORM.postgres.getFieldsFromSchema(values as TValues, model.getAttributes()), { logging: ORM.logEnabled ? console.log : false });
      return created.get() as InferValues<TSchema>;
    },
    findOne: (async ({
      attributes,
      where,
    }: {
      attributes?: AttributeKeys<TSchema>;
      where?: WhereClause<TSchema>;
    } = {}) => {
      const effectiveWhere = applySoftDeleteDefault(options.schema, where);
      const cacheKey = `model:${options.name}:findOne:${attributes?.join(",") ?? ""}${effectiveWhere ? `:${JSON.stringify(effectiveWhere)}` : ""}`;
      
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
      if(effectiveWhere) {
        optionsQuery.where = effectiveWhere;
      }

      const row = await model.findOne({ ...optionsQuery, raw: true, logging: ORM.logEnabled ? console.log : false });
      return row as InferValues<TSchema> | null;
    }) as Model<TSchema>["findOne"],
    updateOne: async (id: string | number, data: Partial<InferValues<TSchema>>) => {
      // remove CACHE
      if (ORM.cacheEnabled && ORM.redis) {
        await ORM.redis.delStartWith(`model:${options.name}:findOne`);
      }

      const values = applyUpdatedAt(options.schema, data);

      await model.update(ORM.postgres.getFieldsFromSchema(values as TValues, model.getAttributes()), { where: { id }, logging: ORM.logEnabled ? console.log : false });
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
      // TODO Supprimer le cache si include ?
      /*if(where) {
        disableCache = true;
      }*/

      const effectiveWhere = applySoftDeleteDefault(options.schema, where);
      const cacheKey = disableCache ? null : `model:${options.name}:findAll:${attributes?.join(",") ?? ""}${effectiveWhere ? `:${JSON.stringify(effectiveWhere)}` : ""}`;
      
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
      if(effectiveWhere) {
        optionsQuery.where = effectiveWhere;
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
