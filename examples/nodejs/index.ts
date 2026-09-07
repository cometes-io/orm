import { Op } from "../../src/index.js";
import { orm } from "./db.js";
import { UserModel } from "./models/users.js";
import { WorkspaceUserModel } from "./models/workspace-users.js";

console.log(await orm.ping());
console.log(
  `PostgreSQL → ${orm.postgres.url} (connected=${orm.postgres.connected})`,
);
console.log(
  `Redis      → ${orm.redis.url} (connected=${orm.redis.connected})`,
);

const startTest = async (cache: boolean = false) => {
  console.time("start - test - cache: " + cache);
  orm.cache(cache);
  orm.log(false);

  const existing = await UserModel.findOne({
    attributes: ["id", "name", "status"] as const,
    where: { id: 1 },
  });

  console.log("user", existing);

  let userId: number;
  if (existing) {
    await UserModel.updateOne(existing.id, {
      name: "John Doe 1 bis",
    });
    userId = existing.id;
  } else {
    // created_at / updated_at / status (default: "active") sont remplis par l'ORM
    const created = await UserModel.create({
      id: 1,
      name: "John Doe 1",
    });
    console.log("created", created);
    userId = created.id;
  }

  const activeUsers = await UserModel.findAll({
    attributes: ["id", "name", "status"] as const,
    where: {
      status: { [Op.in]: ["active", "inactive"] },
    },
  });
  console.log("activeUsers", activeUsers);

  await WorkspaceUserModel.delete({
    where: { workspace_id: 1, user_id: userId, deleted_at: undefined },
  });

  const membership = await WorkspaceUserModel.create({
    workspace_id: 1,
    user_id: userId,
  });
  console.log("membership", membership);

  await WorkspaceUserModel.update(
    { role: "admin" },
    { where: { workspace_id: 1, user_id: userId } },
  );

  const adminMembership = await WorkspaceUserModel.findOne({
    attributes: ["workspace_id", "user_id", "role"] as const,
    where: { workspace_id: 1, user_id: userId },
  });
  console.log("adminMembership", adminMembership);

  await WorkspaceUserModel.delete({
    where: { workspace_id: 1, user_id: userId },
  });

  await UserModel.deleteOne(userId);

  console.timeEnd("start - test - cache: " + cache);
};

await startTest();
await startTest(true);

if (process.env.KEEP_ALIVE === "1") {
  setInterval(() => {}, 1 << 30);
} else {
  await orm.disconnect();
}
