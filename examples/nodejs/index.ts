import { Op } from "../../src/index.js";
import { orm } from "./db.js";
import { UserModel } from "./models/users.js";
import { WorkspaceUserModel } from "./models/workspace-users.js";

/**
 * Parcours complet de l'API : CRUD, order / limit, count, include par clé
 * étrangère, transactions (commit et rollback), locks et cache Redis.
 *
 * Chaque scénario est autonome et laisse la base propre derrière lui.
 * Les commentaires `// →` reproduisent la sortie réelle de ce fichier.
 */

const section = (title: string) => console.log(`\n=== ${title} ===`);

/** Repart d'une base vierge : l'exemple est rejouable à l'infini. */
const resetFixtures = async () => {
  await WorkspaceUserModel.delete({
    where: { workspace_id: 1, deleted_at: undefined },
    force: true,
  });
  await UserModel.delete({
    where: { id: 1, deleted_at: undefined },
    force: true,
  });
};

section("Connexions");
console.log(await orm.ping());
// → { postgres: true, mysql: false, redis: true }
console.log(
  `PostgreSQL → ${orm.postgres.url} (connected=${orm.postgres.connected})`,
);
console.log(`Redis      → ${orm.redis.url} (connected=${orm.redis.connected})`);

// ---------------------------------------------------------------------------
// 1. CRUD et valeurs remplies par l'ORM
// ---------------------------------------------------------------------------
section("CRUD");
orm.cache(false);
orm.log(false);
// orm.logTo(console.error);
await resetFixtures();

// `create` renvoie la ligne complète : les champs absents de l'appel
// (status, created_at, updated_at, deleted_at) sont remplis par l'ORM.
const user = await UserModel.create({ id: 1, name: "John Doe" });
console.log("create →", user);
// → {
//     status: 'active',
//     id: 1,
//     name: 'John Doe',
//     created_at: 2026-09-11T07:21:13.618Z,
//     updated_at: 2026-09-11T07:21:13.618Z,
//     deleted_at: null
//   }

// `updateOne` cible la clé primaire, force updated_at, et ne renvoie rien.
await UserModel.updateOne(user.id, { name: "John Doe (edited)" });

// `attributes` restreint la sélection : le type du résultat suit exactement
// la liste fournie, et vaut `null` si aucune ligne ne correspond.
const reloaded = await UserModel.findOne({
  attributes: ["id", "name", "status"] as const,
  where: { id: user.id },
});
console.log("findOne →", reloaded);
// → { id: 1, name: 'John Doe (edited)', status: 'active' }

// ---------------------------------------------------------------------------
// 2. Lectures filtrées : where, order, limit, count
// ---------------------------------------------------------------------------
section("where / order / limit / count");

const activeUsers = await UserModel.findAll({
  attributes: ["id", "name", "status"] as const,
  where: { status: { [Op.in]: ["active", "inactive"] } },
  order: [["created_at", "DESC"], "id"],
  limit: 10,
});
console.log("findAll →", activeUsers);
// → [ { id: 1, name: 'John Doe (edited)', status: 'active' } ]
// `findAll` renvoie toujours un tableau (vide si aucune correspondance).

// Le filtre soft delete (deleted_at: null) est ajouté automatiquement.
console.log("count →", await UserModel.count({ where: { status: "active" } }));
// → 1

// ---------------------------------------------------------------------------
// 3. Clé étrangère et include
// ---------------------------------------------------------------------------
section("include (clé étrangère workspace_users.user_id → users.id)");

await WorkspaceUserModel.create({ workspace_id: 1, user_id: user.id });

// L'alias du résultat est déduit : user_id → user. `where` filtre le modèle joint.
const withUser = await WorkspaceUserModel.findOne({
  attributes: ["workspace_id", "user_id", "role"] as const,
  where: { workspace_id: 1, user_id: user.id },
  include: [
    {
      model: UserModel,
      attributes: ["id", "name", "status"] as const,
      where: { status: "active" },
      required: true, // INNER JOIN ; sans lui, `user` peut être null
    },
  ] as const,
});
console.log("findOne + include →", withUser);
// → {
//     workspace_id: 1,
//     user_id: 1,
//     role: 'member',
//     user: { id: 1, name: 'John Doe (edited)', status: 'active' }
//   }
// La ligne jointe est imbriquée sous l'alias, pas aplatie dans le résultat.
console.log("utilisateur joint →", withUser?.user?.name);
// → John Doe (edited)

// La même FK lue dans l'autre sens (1→N) : depuis `users`, les lignes de
// `workspace_users` arrivent sous l'alias `references.reverseAs`.
const withMemberships = await UserModel.findOne({
  attributes: ["id", "name"] as const,
  where: { id: user.id },
  include: [
    {
      model: WorkspaceUserModel,
      attributes: ["workspace_id", "role"] as const,
    },
  ] as const,
});
console.log("findOne + include 1→N →", withMemberships);
// → {
//     id: 1,
//     name: 'John Doe (edited)',
//     memberships: [ { workspace_id: 1, role: 'member' } ]
//   }
// Un 1→N renvoie toujours un tableau — vide s'il n'y a rien à joindre.
console.log("workspaces →", withMemberships?.memberships.length);
// → 1

// ---------------------------------------------------------------------------
// 4. Transaction validée + locks
// ---------------------------------------------------------------------------
section("transaction (commit) + lock");

await orm.begin();
try {
  // Verrou de table, puis FOR UPDATE sur les lectures suivantes.
  await orm.lock({ table: "workspace_users" });
  // → LOCK TABLE "workspace_users" IN EXCLUSIVE MODE
  await orm.lock();

  await WorkspaceUserModel.update(
    { role: "admin" },
    { where: { workspace_id: 1, user_id: user.id } },
  );

  // Lecture dans la transaction : elle voit la modification non encore
  // commitée, et ne passe jamais par le cache Redis.
  const locked = await WorkspaceUserModel.findOne({
    attributes: ["workspace_id", "user_id", "role"] as const,
    where: { workspace_id: 1, user_id: user.id },
    lock: true,
  });
  console.log("lecture verrouillée →", locked);
  // → { workspace_id: 1, user_id: 1, role: 'admin' }

  orm.unlock();
  await orm.commit();
} catch (error) {
  await orm.rollback();
  throw error;
}

console.log(
  "après commit →",
  await WorkspaceUserModel.findOne({
    attributes: ["workspace_id", "role"] as const,
    where: { workspace_id: 1, user_id: user.id },
  }),
);
// → { workspace_id: 1, role: 'admin' }   (le changement est bien persisté)

// ---------------------------------------------------------------------------
// 5. Transaction annulée
// ---------------------------------------------------------------------------
section("transaction (rollback)");

await orm.begin();
await UserModel.updateOne(user.id, { name: "Nom jamais persisté" });
await orm.rollback();

console.log(
  "après rollback →",
  await UserModel.findOne({
    attributes: ["id", "name"] as const,
    where: { id: user.id },
  }),
);
// → { id: 1, name: 'John Doe (edited)' }   (l'écriture a été annulée)

// ---------------------------------------------------------------------------
// 6. Cache Redis
// ---------------------------------------------------------------------------
section("cache Redis");
orm.cache(true);

// Seules les lectures sans where / include / order / limit sont mises en cache.
console.time("findAll (1er appel, va en base)");
await UserModel.findAll({ attributes: ["id", "name"] as const });
console.timeEnd("findAll (1er appel, va en base)");
// → findAll (1er appel, va en base): 1.905ms

console.time("findAll (2e appel, servi par Redis)");
await UserModel.findAll({ attributes: ["id", "name"] as const });
console.timeEnd("findAll (2e appel, servi par Redis)");
// → findAll (2e appel, servi par Redis): 0.406ms  (pas de requête SQL)

// Un where contourne toujours le cache : la requête repart en base.
console.time("findAll avec where (jamais caché)");
await UserModel.findAll({
  attributes: ["id", "name"] as const,
  where: { status: "active" },
});
console.timeEnd("findAll avec where (jamais caché)");
// → findAll avec where (jamais caché): 0.515ms

// Une écriture invalide les clés du modèle : la lecture suivante repart en base.
await UserModel.updateOne(user.id, { name: "John Doe" });

orm.cache(false);

// ---------------------------------------------------------------------------
// 7. Soft delete
// ---------------------------------------------------------------------------
section("soft delete");
await UserModel.deleteOne(user.id);
console.log("count après delete →", await UserModel.count());
// → 0   (la ligne existe encore, filtrée par deleted_at: null)

console.log(
  "y compris supprimés →",
  await UserModel.count({ where: { deleted_at: undefined } }),
);
// → 1

// ---------------------------------------------------------------------------
// Nettoyage
// ---------------------------------------------------------------------------
section("nettoyage");
await WorkspaceUserModel.delete({
  where: { workspace_id: 1, user_id: user.id },
  force: true,
});
await UserModel.deleteOne(user.id, { force: true });
console.log("users restants →", await UserModel.count({ where: { deleted_at: undefined } }));
// → 0

if (process.env.KEEP_ALIVE === "1") {
  setInterval(() => {}, 1 << 30);
} else {
  await orm.disconnect();
}
