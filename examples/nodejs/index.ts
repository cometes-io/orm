import { orm } from "./db.js";
import { UserModel } from "./models/users.js";

console.log(await orm.ping());
console.log(
  `PostgreSQL → ${orm.postgres.url} (connected=${orm.postgres.connected})`,
);
console.log(
  `Redis      → ${orm.redis.url} (connected=${orm.redis.connected})`,
);

const startTest = async () => {
  console.time("start - test");

  //console.log(UserModel)
  //console.log(orm.models)

  await UserModel.create({
    name: "John Doe",
    age: 30, // not in schema -> not added to the query
  });

  console.log(await UserModel.findAll());
  console.timeEnd("start - test");
}

startTest();

// Garde le process vivant dans Docker Compose
if (process.env.KEEP_ALIVE === "1") {
  setInterval(() => {}, 1 << 30);
} else {
  await orm.disconnect();
}
