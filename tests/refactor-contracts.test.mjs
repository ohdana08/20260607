import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PRODUCTS,
  SCENARIOS,
  captureRevisionScenario,
  revisionHarness,
} from "./helpers/revision-harness.mjs";

const baseline = JSON.parse(
  readFileSync(
    new URL("./fixtures/revision-contracts.json", import.meta.url),
    "utf8",
  ),
);
for (const [name, product] of Object.entries(PRODUCTS)) {
  for (const scenario of SCENARIOS) {
    test(`${name}: preserves pre-refactor contract for ${scenario}`, async () => {
      assert.deepEqual(
        await captureRevisionScenario(product, scenario),
        baseline.products[name][scenario],
      );
    });
  }
  test(`${name}: storage errors still propagate instead of granting a revision`, async () => {
    const h = revisionHarness(product);
    h.redis.get = async () => {
      throw new Error("store unavailable");
    };
    await assert.rejects(h.api[product.reserve]("user-1"), /store unavailable/);
  });
}
