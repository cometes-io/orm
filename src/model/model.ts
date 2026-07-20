import { Sequelize } from "sequelize";
import { PostgresClient } from "../index.js";

/**
 * Description d'un champ de modèle.
 */
export type DefineModelSchema = {
  type: string;
  primary?: boolean;
};

/**
* Description d'une valeur de modèle.
*/
export type DefineModelValue = string | number;

export type TValues = Record<string, DefineModelValue>

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
  readonly create: (data: TValues) => Promise<any>;
  readonly findAll: () => Promise<any[]>;
  //readonly findOne: (id: string) => Promise<TSchema | null>;
  //readonly update: (id: string, data: TSchema) => Promise<void>;
  //readonly delete: (id: string) => Promise<void>;
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
  TSchema extends Record<string, DefineModelSchema>, TClient extends PostgresClient
>(options: DefineModelOptions<TSchema>, client: TClient): Model<TSchema> {
  const model = client.dbInstance!.define(options.name, client.formatModelSchema(options.schema));
  console.log(model, model.getAttributes());
  return {
    name: options.name,
    schema: options.schema,
    create: async (data: TValues) => {
      return await model.create(client.getFieldsFromSchema(data, model.getAttributes()));
    },
    findAll: async () => {
      return []; //await model.findAll();
    },
  };
}
