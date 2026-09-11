/**
 * Clés et sérialisation du cache Redis propres à `@cometes/orm`.
 *
 * Le `:` après le nom de modèle évite qu'un SCAN `users*` n'efface `users_extra`.
 * Les `Date` sont taguées explicitement : une string ISO reste une string.
 */

/** Préfixe unique du package — toutes les clés ORM commencent ainsi. */
export const REDIS_KEY_PREFIX = "cometes:orm:";

/** Marqueur JSON d'une Date (ne pas confondre avec un champ métier). */
export const CACHED_DATE_KEY = "$cometes/orm:date";

type TaggedDate = { [CACHED_DATE_KEY]: string };

/** Namespace invalidable d'un modèle : `cometes:orm:model:users:`. */
export const modelCacheNamespace = (modelName: string): string =>
  `${REDIS_KEY_PREFIX}model:${modelName}:`;

export const modelCacheKey = (
  modelName: string,
  operation: "findOne" | "findAll",
  attributes: string,
): string =>
  `${modelCacheNamespace(modelName)}${operation}:${attributes}`;

const isTaggedDate = (value: object): value is TaggedDate => {
  const keys = Object.keys(value);
  return (
    keys.length === 1 &&
    keys[0] === CACHED_DATE_KEY &&
    typeof (value as TaggedDate)[CACHED_DATE_KEY] === "string"
  );
};

const tagDates = (value: unknown): unknown => {
  if (value instanceof Date) {
    return { [CACHED_DATE_KEY]: value.toISOString() } satisfies TaggedDate;
  }
  if (Array.isArray(value)) {
    return value.map(tagDates);
  }
  if (value !== null && typeof value === "object") {
    const tagged: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      tagged[key] = tagDates(nested);
    }
    return tagged;
  }
  return value;
};

const untagDates = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(untagDates);
  }
  if (value !== null && typeof value === "object") {
    if (isTaggedDate(value)) {
      return new Date(value[CACHED_DATE_KEY]);
    }
    const revived: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      revived[key] = untagDates(nested);
    }
    return revived;
  }
  return value;
};

/** Sérialise une valeur de cache en taguant chaque `Date`. */
export const stringifyCachedJson = (value: unknown): string =>
  JSON.stringify(tagDates(value));

/** Relit un payload de cache : seules les dates taguées redeviennent `Date`. */
export const parseCachedJson = <T>(raw: string): T =>
  untagDates(JSON.parse(raw)) as T;
