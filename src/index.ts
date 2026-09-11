/**
 * API publique de `@cometes-io/orm`.
 *
 * N'exporter ici que les symboles destinés aux consommateurs du package.
 *
 * @packageDocumentation
 */
export { Orm, type OrmOptions } from "./orm.js";
export {
  defineModel,
  Op,
  type AttributeKeys,
  type DefineModelOptions,
  type DefineModelSchema,
  type FieldType,
  type InferPartialValues,
  type InferValues,
  type IncludeClause,
  type IncludeOption,
  type IncludedValues,
  type ModelReference,
  type Model,
  type PrimaryKeyArg,
  type SelectedValues,
  type TValues,
  type OrderClause,
  type OrderDirection,
  type LockClause,
  type LockTableOptions,
  type TableLockMode,
  TABLE_LOCK_MODES,
  type Transaction,
  type WhereClause,
} from "./model/model.js";
export {
  runMigrations,
  type MigrateOptions,
  type MigrateResult,
  type MigrationModule,
} from "./migrate/index.js";
export { PostgresClient, type PostgresOptions } from "./postgres/index.js";
export {
  RedisClient,
  REDIS_CACHE_TTL_SECONDS,
  REDIS_KEY_PREFIX,
  CACHED_DATE_KEY,
  modelCacheKey,
  modelCacheNamespace,
  parseCachedJson,
  stringifyCachedJson,
  type RedisOptions,
} from "./redis/index.js";
