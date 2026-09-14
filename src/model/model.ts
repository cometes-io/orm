import {
  Model as SequelizeModel,
  Op,
  Transaction,
  type Includeable,
  type ModelStatic,
  type WhereOptions,
} from "sequelize";
import { Orm } from "../index.js";
import {
  modelCacheKey,
  modelCacheNamespace,
  parseCachedJson,
  stringifyCachedJson,
} from "../redis/cache.js";

export { Op };
export type { Transaction };

/**
 * Modèles : schéma, inférence TypeScript, et implémentation Sequelize.
 *
 * Organisation du fichier :
 * 1. Types publics (schéma, where, include, lock)
 * 2. Helpers de timestamps / soft delete
 * 3. API `Model` + `defineModel`
 */

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
  /** Restreint la valeur inférée à ces littéraux (ex. `"active" | "inactive"`). */
  enum?: readonly (string | number)[];
  /** Valeur par défaut Sequelize / TypeScript (`default: "active"`). */
  default?: DefineModelValue | null;
  /** Clé étrangère vers un modèle déjà déclaré. */
  references?: ModelReference<any>;
};

/**
 * Référence de clé étrangère. `as` est déduit de `*_id` quand il est omis
 * (`user_id` devient `user`).
 */
type ReferencedModelShape = {
  readonly name: string;
  readonly schema: Record<string, DefineModelSchema>;
  readonly $schema: Record<string, unknown>;
};

export type ModelReference<
  TModel extends ReferencedModelShape = ReferencedModelShape,
> = {
  model: TModel;
  key: Extract<keyof TModel["schema"], string>;
  as?: string;
};

/**
 * Description d'une valeur de modèle.
 */
export type DefineModelValue = string | number | boolean | Date;

export type TValues = Record<string, DefineModelValue>;

/**
 * Valeur TypeScript dérivée du type de champ (sans enum ni nullabilité).
 */
type InferFieldFromType<T extends DefineModelSchema> = T["type"] extends
  | "number"
  | "float"
  ? number
  : T["type"] extends "boolean"
    ? boolean
    : T["type"] extends "date"
      ? Date
      : string;

/**
 * Valeur TypeScript dérivée du type de champ (sans nullabilité).
 */
type InferFieldBase<T extends DefineModelSchema> = T extends {
  enum: readonly (infer E)[];
}
  ? E
  : InferFieldFromType<T>;

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

/** Clés du schéma qui portent une FK (`references`). */
type ReferenceFieldKeys<
  TSchema extends Record<string, DefineModelSchema>,
> = {
  [K in keyof TSchema]: "references" extends keyof TSchema[K] ? K : never;
}[keyof TSchema] & string;

/** Alias Sequelize : `references.as`, sinon `user_id` → `user`. */
type ReferenceAlias<
  TSchema extends Record<string, DefineModelSchema>,
  TField extends ReferenceFieldKeys<TSchema>,
> = TSchema[TField] extends { references: { as: infer TAlias extends string } }
  ? TAlias
  : TField extends `${infer TAlias}_id`
    ? TAlias
    : TField;

type ReferencedModelOf<
  TSchema extends Record<string, DefineModelSchema>,
  TField extends ReferenceFieldKeys<TSchema>,
> = TSchema[TField] extends {
  references: { model: infer TModel extends ReferencedModelShape };
}
  ? TModel
  : never;

type RelationFieldForModel<
  TSchema extends Record<string, DefineModelSchema>,
  TModel,
> = {
  [K in ReferenceFieldKeys<TSchema>]: TSchema[K] extends {
    references: { model: TModel };
  }
    ? K
    : never;
}[ReferenceFieldKeys<TSchema>];

type IncludeRelationField<
  TSchema extends Record<string, DefineModelSchema>,
  TInclude extends IncludeOption<TSchema>,
> = TInclude extends {
  relation: infer TField extends ReferenceFieldKeys<TSchema>;
}
  ? TField
  : TInclude extends { model: infer TModel }
    ? RelationFieldForModel<TSchema, TModel>
    : never;

type IncludeOptionForField<
  TSchema extends Record<string, DefineModelSchema>,
  TField extends ReferenceFieldKeys<TSchema>,
> = {
  /** Le modèle ciblé par `schema[relation].references`. */
  model: ReferencedModelOf<TSchema, TField>;
  /**
   * Champ FK. Inutile s'il n'y a qu'une FK vers `model` :
   * déduit de `references.model`.
   */
  relation?: TField;
  attributes?: AttributeKeys<ReferencedModelOf<TSchema, TField>["schema"]>;
  where?: WhereClause<ReferencedModelOf<TSchema, TField>["schema"]>;
  /** `true` génère un INNER JOIN ; `false` (défaut) un LEFT JOIN. */
  required?: boolean;
  /** Jointures imbriquées sur le modèle inclus. */
  include?: IncludeClause<ReferencedModelOf<TSchema, TField>["schema"]>;
};

/** Include disponible à partir des champs du schéma ayant `references`. */
export type IncludeOption<
  TSchema extends Record<string, DefineModelSchema>,
> = {
  [TField in ReferenceFieldKeys<TSchema>]: IncludeOptionForField<
    TSchema,
    TField
  >;
}[ReferenceFieldKeys<TSchema>];

export type IncludeClause<
  TSchema extends Record<string, DefineModelSchema>,
> = readonly IncludeOption<TSchema>[];

type IncludedItemValue<
  TSchema extends Record<string, DefineModelSchema>,
  TInclude extends IncludeOption<TSchema>,
> = IncludeRelationField<TSchema, TInclude> extends infer TField extends
  ReferenceFieldKeys<TSchema>
  ? TSchema[TField] extends {
      references: {
        model: {
          readonly $schema: infer TValues extends Record<string, unknown>;
        };
      };
    }
    ? (TInclude extends { readonly attributes: readonly unknown[] }
        ? Partial<TValues>
        : TValues) &
        (TInclude extends {
          model: {
            schema: infer TNestedSchema extends Record<
              string,
              DefineModelSchema
            >;
          };
        }
          ? "include" extends keyof TInclude
            ? TInclude extends {
                include: infer TNested extends IncludeClause<TNestedSchema>;
              }
              ? IncludedValues<TNestedSchema, TNested>
              : Record<never, never>
            : Record<never, never>
          : Record<never, never>)
    : never
  : never;

/** Champs ajoutés au résultat par une clause `include`. */
export type IncludedValues<
  TSchema extends Record<string, DefineModelSchema>,
  TIncludes extends IncludeClause<TSchema>,
> = {
  [TInclude in TIncludes[number] as IncludeRelationField<
    TSchema,
    TInclude
  > extends infer TField extends ReferenceFieldKeys<TSchema>
    ? ReferenceAlias<TSchema, TField>
    : never]: TInclude extends { required: true }
    ? IncludedItemValue<TSchema, TInclude>
    : IncludedItemValue<TSchema, TInclude> | null;
};

/**
 * Clause `where` : égalité sur les champs du schéma, ou opérateurs Sequelize
 * (`{ [Op.not]: null }`, `{ [Op.gt]: 1 }`, `Op.and` / `Op.or`, …).
 */
export type WhereClause<TSchema extends Record<string, DefineModelSchema>> =
  WhereOptions<{
    [K in keyof InferValues<TSchema>]: InferValues<TSchema>[K] | null;
  }>;

/**
 * Clause `ORDER BY` : clés du schéma, éventuellement avec direction.
 *
 * @example
 * ```ts
 * order: [["created_at", "DESC"], "id"]
 * ```
 */
export type OrderDirection = "ASC" | "DESC";

export type OrderClause<TSchema extends Record<string, DefineModelSchema>> =
  readonly (
    | Extract<keyof TSchema, string>
    | readonly [Extract<keyof TSchema, string>, OrderDirection]
  )[];

/**
 * Verrou de lignes PostgreSQL (`SELECT … FOR UPDATE` / `FOR SHARE` / …).
 * `true` équivaut à `"UPDATE"`. `false` désactive le verrou courant.
 */
export type LockClause =
  | boolean
  | "UPDATE"
  | "SHARE"
  | "KEY SHARE"
  | "NO KEY UPDATE";

/** Modes `LOCK TABLE … IN <mode> MODE`. */
export const TABLE_LOCK_MODES = [
  "ACCESS SHARE",
  "ROW SHARE",
  "ROW EXCLUSIVE",
  "SHARE UPDATE EXCLUSIVE",
  "SHARE",
  "SHARE ROW EXCLUSIVE",
  "EXCLUSIVE",
  "ACCESS EXCLUSIVE",
] as const;

export type TableLockMode = (typeof TABLE_LOCK_MODES)[number];

export type LockTableOptions = {
  table: string;
  mode?: TableLockMode;
};

/** Clés marquées `primary: true`. */
type PrimaryFieldKeys<
  TSchema extends Record<string, DefineModelSchema>,
> = {
  [K in keyof TSchema]: TSchema[K] extends { primary: true } ? K : never;
}[keyof TSchema] & string;

/**
 * Clé primaire passée à `updateOne` / `deleteOne`.
 *
 * Une PK unique : la valeur (`1`) ou `{ id: 1 }`.
 * Une PK composite : l'objet complet `{ workspace_id, user_id }`.
 */
export type PrimaryKeyArg<
  TSchema extends Record<string, DefineModelSchema>,
> = [PrimaryFieldKeys<TSchema>] extends [never]
  ? string | number
  : InferValues<TSchema>[PrimaryFieldKeys<TSchema>] | {
      [K in PrimaryFieldKeys<TSchema>]: InferValues<TSchema>[K];
    };

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
 *
 * Les surcharges de `findAll` / `findOne` permettent d'inférer le type de
 * retour depuis `attributes` et `include` (`as const`).
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
  readonly create: (
    data: Partial<InferValues<TSchema>>,
    options?: { transaction?: Transaction },
  ) => Promise<InferValues<TSchema>>;
  findAll<
    const TAttributes extends AttributeKeys<TSchema>,
    const TIncludes extends IncludeClause<TSchema>,
  >(
    options: {
      attributes: TAttributes;
      include: TIncludes;
      where?: WhereClause<TSchema>;
      order?: OrderClause<TSchema>;
      limit?: number;
      transaction?: Transaction;
      lock?: LockClause;
    },
  ): Promise<
    Array<
      SelectedValues<TSchema, TAttributes> &
        IncludedValues<TSchema, TIncludes>
    >
  >;
  findAll<const TIncludes extends IncludeClause<TSchema>>(
    options: {
      include: TIncludes;
      where?: WhereClause<TSchema>;
      order?: OrderClause<TSchema>;
      limit?: number;
      transaction?: Transaction;
      lock?: LockClause;
    },
  ): Promise<
    Array<InferValues<TSchema> & IncludedValues<TSchema, TIncludes>>
  >;
  findAll<const TAttributes extends AttributeKeys<TSchema>>(
    options: {
      attributes: TAttributes;
      where?: WhereClause<TSchema>;
      order?: OrderClause<TSchema>;
      limit?: number;
      transaction?: Transaction;
      lock?: LockClause;
    },
  ): Promise<SelectedValues<TSchema, TAttributes>[]>;
  findAll(options?: {
    where?: WhereClause<TSchema>;
    order?: OrderClause<TSchema>;
    limit?: number;
    transaction?: Transaction;
    lock?: LockClause;
  }): Promise<InferValues<TSchema>[]>;
  findOne<
    const TAttributes extends AttributeKeys<TSchema>,
    const TIncludes extends IncludeClause<TSchema>,
  >(
    options: {
      attributes: TAttributes;
      include: TIncludes;
      where?: WhereClause<TSchema>;
      order?: OrderClause<TSchema>;
      limit?: number;
      transaction?: Transaction;
      lock?: LockClause;
    },
  ): Promise<
    | (SelectedValues<TSchema, TAttributes> &
        IncludedValues<TSchema, TIncludes>)
    | null
  >;
  findOne<const TIncludes extends IncludeClause<TSchema>>(
    options: {
      include: TIncludes;
      where?: WhereClause<TSchema>;
      order?: OrderClause<TSchema>;
      limit?: number;
      transaction?: Transaction;
      lock?: LockClause;
    },
  ): Promise<
    (InferValues<TSchema> & IncludedValues<TSchema, TIncludes>) | null
  >;
  findOne<const TAttributes extends AttributeKeys<TSchema>>(
    options: {
      attributes: TAttributes;
      where?: WhereClause<TSchema>;
      order?: OrderClause<TSchema>;
      limit?: number;
      transaction?: Transaction;
      lock?: LockClause;
    },
  ): Promise<SelectedValues<TSchema, TAttributes> | null>;
  findOne(options?: {
    where?: WhereClause<TSchema>;
    order?: OrderClause<TSchema>;
    limit?: number;
    transaction?: Transaction;
    lock?: LockClause;
  }): Promise<InferValues<TSchema> | null>;
  readonly updateOne: (
    key: PrimaryKeyArg<TSchema>,
    data: Partial<InferValues<TSchema>>,
    options?: { transaction?: Transaction },
  ) => Promise<void>;
  readonly update: (
    data: Partial<InferValues<TSchema>>,
    options: {
      where: WhereClause<TSchema>;
      order?: OrderClause<TSchema>;
      transaction?: Transaction;
    },
  ) => Promise<void>;
  readonly deleteOne: (
    key: PrimaryKeyArg<TSchema>,
    options?: { transaction?: Transaction; force?: boolean },
  ) => Promise<void>;
  readonly delete: (options: {
    where: WhereClause<TSchema>;
    order?: OrderClause<TSchema>;
    transaction?: Transaction;
    /** `true` : `DELETE` SQL, même si `deleted_at` existe. */
    force?: boolean;
  }) => Promise<void>;
  readonly count: (options?: {
    where?: WhereClause<TSchema>;
    order?: OrderClause<TSchema>;
    limit?: number;
    transaction?: Transaction;
  }) => Promise<number>;
}

const resolveTransaction = (
  orm: Orm,
  explicit?: Transaction,
): Transaction | undefined => explicit ?? orm.currentTransaction ?? undefined;

const resolveLock = (
  orm: Orm,
  explicit?: LockClause,
): Exclude<LockClause, false> | undefined => {
  const value = explicit !== undefined ? explicit : (orm.currentLock ?? undefined);
  if (value === undefined || value === false) {
    return undefined;
  }
  return value === true ? "UPDATE" : value;
};

const toSequelizeLock = (lock: Exclude<LockClause, false>) => {
  switch (lock) {
    case true:
    case "UPDATE":
      return Transaction.LOCK.UPDATE;
    case "SHARE":
      return Transaction.LOCK.SHARE;
    case "KEY SHARE":
      return Transaction.LOCK.KEY_SHARE;
    case "NO KEY UPDATE":
      return Transaction.LOCK.NO_KEY_UPDATE;
  }
};

/** Redis : uniquement les lectures sans filtre, tri, limite, include, tx ou lock. */
const shouldSkipFindCache = ({
  where,
  include,
  order,
  limit,
  transaction,
  lock,
}: {
  where?: unknown;
  include?: unknown;
  order?: unknown;
  limit?: unknown;
  transaction?: unknown;
  lock?: unknown;
}): boolean =>
  where !== undefined ||
  include !== undefined ||
  order !== undefined ||
  limit !== undefined ||
  Boolean(transaction) ||
  Boolean(lock);

/** Instance Sequelize associée à un modèle public (pour `belongsTo` / include). */
const sequelizeModels = new WeakMap<object, ModelStatic<SequelizeModel>>();

/** Alias runtime : `as` explicite, sinon suffixe `_id` retiré. */
const referenceAlias = (field: string, reference: ModelReference): string =>
  reference.as ?? (field.endsWith("_id") ? field.slice(0, -3) : field);

/** Champ FK d'un include : `relation` ou unique `references.model` correspondant. */
const resolveIncludeField = (
  schema: Record<string, DefineModelSchema>,
  include: { model: ReferencedModelShape; relation?: string },
): string => {
  if (include.relation !== undefined) {
    return include.relation;
  }

  const matches = Object.keys(schema).filter(
    (name) => schema[name]?.references?.model === include.model,
  );

  if (matches.length === 0) {
    throw new Error(
      `No foreign key references model "${include.model.name}"`,
    );
  }

  if (matches.length > 1) {
    throw new Error(
      `Several foreign keys reference "${include.model.name}" (${matches.join(", ")}); set relation`,
    );
  }

  return matches[0]!;
};

/** Traduit nos `include` ORM en `include` Sequelize. */
const formatIncludes = <
  TSchema extends Record<string, DefineModelSchema>,
>(
  schema: TSchema,
  includes: IncludeClause<TSchema> | undefined,
): Includeable[] | undefined => {
  if (includes === undefined) {
    return undefined;
  }

  return includes.map((include) => {
    const field = resolveIncludeField(schema, include);
    const descriptor = schema[field];
    const reference = descriptor?.references;
    if (!reference) {
      throw new Error(`Field "${field}" is not a declared foreign key`);
    }
    if (include.model !== reference.model) {
      throw new Error(`Included model does not match foreign key "${field}"`);
    }

    const target = sequelizeModels.get(reference.model);
    if (!target) {
      throw new Error(
        `Referenced model "${reference.model.name}" must be declared first`,
      );
    }

    const where = applySoftDeleteDefault(
      reference.model.schema as Record<string, DefineModelSchema>,
      include.where as
        | WhereClause<Record<string, DefineModelSchema>>
        | undefined,
    );

    const nested = formatIncludes(
      reference.model.schema as Record<string, DefineModelSchema>,
      include.include as IncludeClause<Record<string, DefineModelSchema>> | undefined,
    );

    return {
      association: referenceAlias(field, reference),
      ...(include.attributes
        ? {
            attributes: Array.from(include.attributes, String).filter(
              (attribute) => attribute in target.getAttributes(),
            ),
          }
        : {}),
      ...(where ? { where } : {}),
      ...(nested ? { include: nested } : {}),
      required: include.required ?? false,
    };
  });
};

/** Instance Sequelize → objet JS plat (`include` inclus). */
const plainValue = <T>(value: T): T =>
  value &&
  typeof value === "object" &&
  "get" in value &&
  typeof value.get === "function"
    ? (value.get({ plain: true }) as T)
    : value;

const sequelizeLogging = (orm: Orm) => orm.sequelizeLogging();

const invalidateCache = async (orm: Orm, modelName: string) => {
  if (orm.cacheEnabled && orm.redis) {
    await orm.redis.delStartWith(modelCacheNamespace(modelName));
  }
};

const primaryFieldNames = (
  schema: Record<string, DefineModelSchema>,
): string[] =>
  Object.entries(schema)
    .filter(([, field]) => field.primary)
    .map(([name]) => name);

/**
 * `where` de clé primaire : valeur scalaire si PK unique, objet si composite.
 */
export const primaryKeyWhere = (
  schema: Record<string, DefineModelSchema>,
  key: string | number | Record<string, unknown>,
): Record<string, unknown> => {
  const fields = primaryFieldNames(schema);

  if (typeof key === "object" && key !== null) {
    const names = fields.length > 0 ? fields : Object.keys(key);
    const where: Record<string, unknown> = {};
    for (const name of names) {
      if (key[name] === undefined) {
        throw new Error(`Missing primary key field "${name}"`);
      }
      where[name] = key[name];
    }
    return where;
  }

  if (fields.length > 1) {
    throw new Error("Composite primary key requires an object");
  }

  return { [fields[0] ?? "id"]: key };
};

const destroyOrSoftDelete = async (
  orm: Orm,
  schema: Record<string, DefineModelSchema>,
  sequelizeModel: ModelStatic<SequelizeModel>,
  sequelizeAttributes: Record<string, unknown>,
  where: WhereClause<Record<string, DefineModelSchema>>,
  extras: {
    order?: unknown;
    transaction?: Transaction | undefined;
    force?: boolean | undefined;
  },
) => {
  const effectiveWhere =
    extras.force === true
      ? where
      : (applySoftDeleteDefault(schema, where) ?? where);
  const logging = sequelizeLogging(orm);
  const options = {
    where: effectiveWhere,
    ...(extras.order ? { order: extras.order } : {}),
    ...(extras.transaction ? { transaction: extras.transaction } : {}),
    logging,
  };

  if (SOFT_DELETE_FIELD in schema && extras.force !== true) {
    const values = applyUpdatedAt(schema, {
      [SOFT_DELETE_FIELD]: new Date(),
    } as never);
    await sequelizeModel.update(
      orm.postgres.getFieldsFromSchema(values as TValues, sequelizeAttributes),
      options as never,
    );
    return;
  }

  await sequelizeModel.destroy(options as never);
};

type FindCallOptions<TSchema extends Record<string, DefineModelSchema>> = {
  attributes?: AttributeKeys<TSchema>;
  where?: WhereClause<TSchema>;
  include?: IncludeClause<TSchema>;
  order?: OrderClause<TSchema>;
  limit?: number;
  transaction?: Transaction;
  lock?: LockClause;
};

/**
 * Prépare les options Sequelize communes à `findOne` / `findAll`
 * (where, include, lock, cache).
 */
const prepareFind = <TSchema extends Record<string, DefineModelSchema>>(
  orm: Orm,
  schema: TSchema,
  modelName: string,
  sequelizeAttributes: Record<string, unknown>,
  operation: "findOne" | "findAll",
  options: FindCallOptions<TSchema>,
) => {
  const transaction = resolveTransaction(orm, options.transaction);
  const lock = resolveLock(orm, options.lock);
  if (lock && !transaction) {
    throw new Error("A transaction is required to lock rows");
  }

  const include = formatIncludes(schema, options.include);
  const where = applySoftDeleteDefault(schema, options.where);
  const skipCache = shouldSkipFindCache({
    where: options.where,
    include: options.include,
    order: options.order,
    limit: options.limit,
    transaction,
    lock,
  });

  return {
    transaction,
    lock,
    include,
    /** `null` = ne pas lire ni écrire Redis. */
    cacheKey: skipCache
      ? null
      : modelCacheKey(
          modelName,
          operation,
          options.attributes?.join(",") ?? "",
        ),
    sequelizeOptions: {
      ...(options.attributes
        ? {
            attributes: orm.postgres.getColumnsFromSchema(
              options.attributes as string[],
              sequelizeAttributes,
            ),
          }
        : {}),
      ...(where ? { where } : {}),
      ...(options.order ? { order: [...options.order] } : {}),
      ...(options.limit !== undefined ? { limit: options.limit } : {}),
      ...(transaction ? { transaction } : {}),
      ...(include ? { include } : {}),
      ...(lock ? { lock: toSequelizeLock(lock) } : {}),
      // `raw: true` aplatit les includes ; on le désactive dès qu'il y a un JOIN.
      raw: include === undefined,
      logging: sequelizeLogging(orm) as false | ((sql: string) => void),
    },
  };
};

/**
 * Déclare un modèle (table / collection) avec son schéma.
 *
 * Les timestamps Sequelize (`createdAt` / `updatedAt` / `deletedAt`) restent
 * à `false` : l'ORM gère `created_at` / `updated_at` / `deleted_at` à la main.
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
  const TSchema extends Record<string, DefineModelSchema>, TORM extends Orm
>(options: DefineModelOptions<TSchema>, ORM: TORM): Model<TSchema> {
  const sequelizeModel = ORM.postgres.dbInstance!.define(
    options.name,
    ORM.postgres.formatModelSchema(options.schema),
    {
      createdAt: false,
      updatedAt: false,
      deletedAt: false,
      freezeTableName: true,
    },
  );
  const sequelizeAttributes = sequelizeModel.getAttributes();

  const publicModel = {
    name: options.name,
    schema: options.schema,
    $schema: undefined as unknown as InferValues<TSchema>,
    create: async (
      data: Partial<InferValues<TSchema>>,
      { transaction: explicit } = {},
    ) => {
      const transaction = resolveTransaction(ORM, explicit);
      await invalidateCache(ORM, options.name);

      const values = applyCreateTimestamps(options.schema, data);
      const created = await sequelizeModel.create(
        ORM.postgres.getFieldsFromSchema(values as TValues, sequelizeAttributes),
        {
          logging: sequelizeLogging(ORM),
          ...(transaction ? { transaction } : {}),
        },
      );
      return created.get() as InferValues<TSchema>;
    },
    findOne: (async (call: FindCallOptions<TSchema> = {}) => {
      const prepared = prepareFind(
        ORM,
        options.schema,
        options.name,
        sequelizeAttributes,
        "findOne",
        call,
      );

      if (prepared.cacheKey && ORM.cacheEnabled && ORM.redis) {
        const cached = await ORM.redis.get(prepared.cacheKey);
        if (cached !== null) {
          return parseCachedJson(cached);
        }
      }

      const row = await sequelizeModel.findOne(prepared.sequelizeOptions as never);
      const plainRow = row === null ? null : plainValue(row);

      if (prepared.cacheKey && ORM.cacheEnabled && ORM.redis) {
        await ORM.redis.set(prepared.cacheKey, stringifyCachedJson(plainRow));
      }

      return plainRow as InferValues<TSchema> | null;
    }) as Model<TSchema>["findOne"],
    updateOne: async (
      key: PrimaryKeyArg<TSchema>,
      data: Partial<InferValues<TSchema>>,
      { transaction: explicit } = {},
    ) => {
      const transaction = resolveTransaction(ORM, explicit);
      await invalidateCache(ORM, options.name);

      const values = applyUpdatedAt(options.schema, data);
      await sequelizeModel.update(
        ORM.postgres.getFieldsFromSchema(values as TValues, sequelizeAttributes),
        {
          where: primaryKeyWhere(
            options.schema,
            key as string | number | Record<string, unknown>,
          ),
          logging: sequelizeLogging(ORM),
          ...(transaction ? { transaction } : {}),
        },
      );
    },
    update: async (
      data: Partial<InferValues<TSchema>>,
      {
        where,
        order,
        transaction: explicit,
      }: {
        where: WhereClause<TSchema>;
        order?: OrderClause<TSchema>;
        transaction?: Transaction;
      },
    ) => {
      const transaction = resolveTransaction(ORM, explicit);
      await invalidateCache(ORM, options.name);

      const values = applyUpdatedAt(options.schema, data);
      const effectiveWhere =
        applySoftDeleteDefault(options.schema, where) ?? where;

      await sequelizeModel.update(
        ORM.postgres.getFieldsFromSchema(values as TValues, sequelizeAttributes),
        {
          where: effectiveWhere,
          ...(order ? { order } : {}),
          ...(transaction ? { transaction } : {}),
          logging: sequelizeLogging(ORM),
        },
      );
    },
    deleteOne: async (
      key: PrimaryKeyArg<TSchema>,
      { transaction: explicit, force } = {},
    ) => {
      const transaction = resolveTransaction(ORM, explicit);
      await invalidateCache(ORM, options.name);

      await destroyOrSoftDelete(
        ORM,
        options.schema,
        sequelizeModel as ModelStatic<SequelizeModel>,
        sequelizeAttributes,
        primaryKeyWhere(
          options.schema,
          key as string | number | Record<string, unknown>,
        ) as WhereClause<Record<string, DefineModelSchema>>,
        { transaction, force },
      );
    },
    delete: async ({
      where,
      order,
      transaction: explicit,
      force,
    }: {
      where: WhereClause<TSchema>;
      order?: OrderClause<TSchema>;
      transaction?: Transaction;
      force?: boolean;
    }) => {
      const transaction = resolveTransaction(ORM, explicit);
      await invalidateCache(ORM, options.name);

      await destroyOrSoftDelete(
        ORM,
        options.schema,
        sequelizeModel as ModelStatic<SequelizeModel>,
        sequelizeAttributes,
        where as WhereClause<Record<string, DefineModelSchema>>,
        { order, transaction, force },
      );
    },
    count: async ({
      where,
      order,
      limit,
      transaction: explicit,
    }: {
      where?: WhereClause<TSchema>;
      order?: OrderClause<TSchema>;
      limit?: number;
      transaction?: Transaction;
    } = {}) => {
      const transaction = resolveTransaction(ORM, explicit);
      const effectiveWhere = applySoftDeleteDefault(options.schema, where);
      return await sequelizeModel.count({
        ...(effectiveWhere ? { where: effectiveWhere } : {}),
        ...(order ? { order } : {}),
        ...(limit !== undefined ? { limit } : {}),
        ...(transaction ? { transaction } : {}),
        logging: sequelizeLogging(ORM),
      });
    },
    findAll: (async (call: FindCallOptions<TSchema> = {}) => {
      const prepared = prepareFind(
        ORM,
        options.schema,
        options.name,
        sequelizeAttributes,
        "findAll",
        call,
      );

      if (prepared.cacheKey && ORM.cacheEnabled && ORM.redis) {
        const cached = await ORM.redis.get(prepared.cacheKey);
        if (cached !== null) {
          return parseCachedJson(cached);
        }
      }

      const rows = await sequelizeModel.findAll(prepared.sequelizeOptions as never);
      const plainRows = rows.map((row) => plainValue(row));

      if (prepared.cacheKey && ORM.cacheEnabled && ORM.redis) {
        await ORM.redis.set(prepared.cacheKey, stringifyCachedJson(plainRows));
      }

      return plainRows as InferValues<TSchema>[];
    }) as Model<TSchema>["findAll"],
  } as Model<TSchema>;

  sequelizeModels.set(publicModel, sequelizeModel as ModelStatic<SequelizeModel>);
  bindBelongsToAssociations(options.schema, sequelizeModel);

  return publicModel;
}

/** Enregistre les `belongsTo` Sequelize à partir des champs `references`. */
const bindBelongsToAssociations = (
  schema: Record<string, DefineModelSchema>,
  sequelizeModel: ModelStatic<SequelizeModel>,
) => {
  for (const [field, descriptor] of Object.entries(schema)) {
    const reference = descriptor.references;
    if (!reference) {
      continue;
    }

    const target = sequelizeModels.get(reference.model);
    if (!target) {
      throw new Error(
        `Referenced model "${reference.model.name}" must be declared first`,
      );
    }

    sequelizeModel.belongsTo(target, {
      as: referenceAlias(field, reference),
      foreignKey: field,
      targetKey: reference.key,
    });
  }
};
