import test from "node:test";
import assert from "node:assert/strict";
import { operationsHookHarness, flush, monthView } from "./helpers/operations-hook-harness.mjs";

test("late manual reload cannot replace the newly selected month", async () => {
  const h = operationsHookHarness(process.env.OPS_REVIEW_SOURCE_ROOT);
  h.render(); await flush();
  h.requests[0].resolve(monthView("2026-09")); await flush();
  const oldReload = h.render().load(); await flush();
  h.render().selectMonth("2026-10"); h.render(); await flush();
  h.requests[2].resolve(monthView("2026-10")); await flush();
  h.requests[1].resolve(monthView("2026-09")); await oldReload; await flush();
  const result = h.render();
  assert.equal(result.month, "2026-10");
  assert.equal(result.view.state.goal.month, "2026-10");
  assert.equal(result.loading, false);
  h.unmount();
});

test("late reload error cannot erase a successfully loaded new month", async () => {
  const h = operationsHookHarness(process.env.OPS_REVIEW_SOURCE_ROOT);
  h.render(); await flush();
  h.requests[0].resolve(monthView("2026-09")); await flush();
  const oldReload = h.render().load(); await flush();
  h.render().selectMonth("2026-10"); h.render(); await flush();
  h.requests[2].resolve(monthView("2026-10")); await flush();
  h.requests[1].reject(new Error("old September error")); await oldReload; await flush();
  const result = h.render();
  assert.equal(result.view?.state.goal.month, "2026-10");
  assert.equal(result.error, "");
  h.unmount();
});

test("month selection invalidates an old response before the next render", async () => {
  const h = operationsHookHarness(process.env.OPS_REVIEW_SOURCE_ROOT);
  h.render(); await flush();
  h.requests[0].resolve(monthView("2026-09")); await flush();
  const oldReload = h.render().load(); await flush();
  h.render().selectMonth("2026-10");
  h.requests[1].resolve(monthView("2026-09")); await oldReload; await flush();
  const result = h.render();
  assert.equal(result.view, null);
  assert.equal(result.loading, true);
  h.unmount();
});

test("duplicate save events share one in-flight mutation and block month change", async () => {
  const h = operationsHookHarness(process.env.OPS_REVIEW_SOURCE_ROOT);
  h.render(); await flush();
  h.requests[0].resolve(monthView("2026-09")); await flush();
  const state = h.render(), command = { kind: "video", value: { id: "v1" } };
  const first = state.save(command), second = state.save(command);
  state.selectMonth("2026-10"); await flush();
  assert.equal(h.requests.length, 2);
  assert.equal(h.render().month, "2026-09");
  h.requests[1].resolve(monthView("2026-09", 2));
  await Promise.all([first, second]); await flush();
  assert.equal(h.render().busy, false);
  h.unmount();
});
