import {
  DataTypes,
  type QueryInterface,
  type Transaction,
} from "sequelize";

/**
 * Table de liaison workspace ↔ user (update / delete par `where`).
 */
export async function up(
  queryInterface: QueryInterface,
  _Sequelize: unknown,
  transaction: Transaction,
): Promise<void> {
  await queryInterface.createTable(
    "workspace_users",
    {
      workspace_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        allowNull: false,
      },
      user_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        allowNull: false,
        references: {
          model: "users",
          key: "id",
        },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      role: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: "member",
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      deleted_at: {
        type: DataTypes.DATE,
        allowNull: true,
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
  await queryInterface.dropTable("workspace_users", { transaction });
}
