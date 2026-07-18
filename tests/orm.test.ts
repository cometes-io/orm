import { describe, expect, it } from "vitest";
import { Orm } from "../src/index.js";

describe("Orm", () => {
  it("utilise le nom fourni", () => {
    const orm = new Orm({ name: "test" });
    expect(orm.ping()).toBe("orm:test");
  });

  it("utilise le nom par défaut", () => {
    const orm = new Orm();
    expect(orm.ping()).toBe("orm:default");
  });
});
