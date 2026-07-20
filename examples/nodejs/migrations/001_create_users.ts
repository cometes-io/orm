import {
  DataTypes,
  type QueryInterface,
  type Transaction,
} from "sequelize";

/**
 * Crée la table users (alignée sur examples/nodejs/models/users.ts).
 *
 * `autoIncrement: true` → SERIAL / IDENTITY côté PostgreSQL
 * (pas AUTO_INCREMENT, qui est une syntaxe MySQL).
 */
export async function up(
  queryInterface: QueryInterface,
  _Sequelize: unknown,
  transaction: Transaction,
): Promise<void> {
  await queryInterface.createTable(
    "users",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      name: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
    },
    { transaction },
  );
}

export async function down(
  queryInterface: QueryInterface,
  _Sequelize: unknown,
  transaction: Transaction,
): Promise<void> {
  await queryInterface.dropTable("users", { transaction });
}
