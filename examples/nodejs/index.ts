import { orm } from "./db.js";
import { UserModel } from "./models/users.js";

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

  //console.log(UserModel)
  //console.log(orm.models)

  /*console.time("start - create");
  for(let i = 0; i < 1000; i++) {
    await UserModel.create({
      name: `John Doe ${i}`,
      age: 30, // not in schema -> not added to the query
    });
  }
  console.timeEnd("start - create");*/

const user = await UserModel.findOne({
  attributes: ["id", "name"],
  where: {
    id: 1,
  },
})

console.log('user',user)
if(user) {
  await UserModel.updateOne(user.id, {
    name: "John Doe 1 bis",
  })
} else {
  await UserModel.create({
    id: 1,
    name: "John Doe 1",
  })
}

await UserModel.findOne({
  where: {
    id: 1,
  },
})

  await UserModel.deleteOne(1)

  console.time("start - findAll");
  for(let i = 0; i < 1; i++) {
    const users = await UserModel.findAll({
      attributes: ["id", "name"],
    });
    console.log('users',users)
    const users2 = await UserModel.findAll({
      attributes: ["id", "name"],
      where: {
        id: users[0]?.id ?? 0,
      },
    });
    console.log('users2',users2)
  }
  console.timeEnd("start - findAll");

  console.timeEnd("start - test - cache: " + cache);
}

await startTest();
await startTest(true);

// Garde le process vivant dans Docker Compose
if (process.env.KEEP_ALIVE === "1") {
  setInterval(() => {}, 1 << 30);
} else {
  await orm.disconnect();
}
