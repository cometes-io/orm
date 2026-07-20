import path from "node:path";
import { fileURLToPath } from "node:url";
import { orm } from "./db.js";

const directory = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "migrations",
);

const result = await orm.migrate(directory);

console.log("Migrations appliquées :", result.applied);
console.log("Migrations déjà présentes :", result.skipped);

await orm.disconnect();
