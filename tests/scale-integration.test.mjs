import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadScaleModule, labRedis, redisCommand, labSql, sqlString as s } from "./helpers/scale-harness.mjs";
const { SnapshotCache } = loadScaleModule("lib/scale/snapshotCache.ts");
const { RedisSnapshotStore } = loadScaleModule("lib/scale/redisSnapshotStore.ts");
const key = () => `test:{scale-${randomUUID()}}:snapshot`;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("Redis: 100 cold requests across 10 instances perform one source load", async () => {
  const shared = key(); let reads = 0;
  const caches = Array.from({ length: 10 }, () => new SnapshotCache(new RedisSnapshotStore(labRedis, shared), async () => { reads++; await pause(40); return [{ id: "public-program" }]; }));
  const result = await Promise.all(Array.from({ length: 100 }, (_, i) => caches[i % 10].get()));
  assert.equal(reads, 1);
  assert.ok(result.every((rows) => rows[0].id === "public-program"));
  result[0][0].id = "consumer-mutated";
  assert.equal((await caches[0].get())[0].id, "public-program");
});
test("Redis: expired lock owner cannot publish over or release a new owner", async () => {
  const store = new RedisSnapshotStore(labRedis, key());
  assert.equal(await store.acquire("old", 10), true); await pause(20);
  assert.equal(await store.acquire("new", 1000), true);
  assert.equal(await store.publish("old", { value: "stale", freshUntil: Date.now()+1000, staleUntil: Date.now()+2000 }, 2000), false);
  await store.release("old");
  assert.equal(await store.acquire("third", 1000), false);
  assert.equal(await store.publish("new", { value: "new", freshUntil: Date.now()+1000, staleUntil: Date.now()+2000 }, 2000), true);
  assert.equal((await store.read()).value, "new");
});
test("Redis: stale catalog survives a failed refresh only within its lifetime", async () => {
  const k = key(), now = Date.now();
  await redisCommand("SET", k, JSON.stringify({ value: ["last-good"], freshUntil: now-1, staleUntil: now+150 }), "PX", 150);
  const cache = new SnapshotCache(new RedisSnapshotStore(labRedis, k), async () => { throw new Error("source down"); });
  assert.equal((await cache.get())[0], "last-good");
  await pause(175);
  await assert.rejects(cache.get());
});
test("Redis: bounded source timeout aborts load and releases its lock", async () => {
  const k = key(); let signal;
  const cache = new SnapshotCache(new RedisSnapshotStore(labRedis, k), async (received) => { signal=received; return new Promise(() => {}); },
    { freshMs:100, staleMs:200, localMs:20, loadMs:20, leaseMs:100, waitMs:100 });
  await assert.rejects(cache.get());
  assert.equal(signal.aborted, true);
  assert.equal(await redisCommand("GET", `${k}:lock`), null);
});
test("Redis: a cold cache outage cannot trigger unrestricted DB refreshes", async () => {
  let reads=0;
  const store={ async read(){throw new Error("Redis down");} };
  const cache=new SnapshotCache(store,async()=>{reads++;return[];});
  const results=await Promise.allSettled(Array.from({length:100},()=>cache.get()));
  assert.ok(results.every((r)=>r.status==='rejected')); assert.equal(reads,0);
});

async function queue(options = {}) {
  const name = `test-${randomUUID()}`;
  await labSql(`insert into public.scale_job_queues(name,max_running,max_pending,max_per_owner,max_attempts) values(${s(name)},${options.running??3},${options.pending??30},${options.owner??3},${options.attempts??3});`);
  return name;
}
const enqueue = async (q, owner=randomUUID(), idempotency=randomUUID(), payload={ documentId: "test-only" }) => JSON.parse(await labSql(`select row_to_json(j) from public.scale_enqueue(${s(q)},${s(owner)},${s(idempotency)},${s(JSON.stringify(payload))}::jsonb) j;`));
const claim = async (q) => JSON.parse(await labSql(`select coalesce(json_agg(j),'[]') from public.scale_claim(${s(q)}) j;`));
const complete = (job, result={ artifactKey: "test-only" }) => labSql(`select public.scale_complete(${s(job.id)},${s(job.lease_token)},${s(JSON.stringify(result))}::jsonb);`);

test("Postgres: concurrent same-key admission creates one job", async () => {
  assert.equal(await labSql("select current_database();"), "ddakfit_scale_lab");
  const q=await queue(), owner=randomUUID();
  const result=await Promise.all(Array.from({length:10},()=>enqueue(q,owner,"same-key")));
  assert.equal(new Set(result.map((job)=>job.id)).size,1);
  assert.equal(await labSql(`select count(*) from public.scale_jobs where queue=${s(q)};`),"1");
  await assert.rejects(enqueue(q,owner,"same-key",{documentId:"different"}),/IDEMPOTENCY_CONFLICT/);
});
test("Postgres: owner limit and global queue cap reject extra work", async () => {
  const q=await queue({pending:2,owner:1}),owner=randomUUID();
  await enqueue(q,owner); await assert.rejects(enqueue(q,owner),/OWNER_BUSY/);
  await enqueue(q); await assert.rejects(enqueue(q),/QUEUE_FULL/);
});
test("Postgres: 12 concurrent workers respect 3 global running slots", async () => {
  const q=await queue();
  await labSql(`select public.scale_enqueue(${s(q)},gen_random_uuid(),i::text,'{}'::jsonb) from generate_series(1,12) i;`);
  const jobs=(await Promise.all(Array.from({length:12},()=>claim(q)))).flat();
  assert.equal(jobs.length,3); assert.equal(new Set(jobs.map((j)=>j.id)).size,3);
  assert.equal(await labSql(`select count(*) from public.scale_jobs where queue=${s(q)} and state='running';`),"3");
});
test("Postgres: lease expiry recovers work and fences all stale writes", async () => {
  const q=await queue(); await enqueue(q); const [old]=await claim(q);
  await labSql(`update public.scale_jobs set lease_until=clock_timestamp()-interval '1 second' where id=${s(old.id)};`);
  const [next]=await claim(q); assert.equal(next.id,old.id); assert.equal(next.attempts,2); assert.notEqual(next.lease_token,old.lease_token);
  assert.equal(await complete(old),"f");
  assert.equal(await labSql(`select public.scale_heartbeat(${s(old.id)},${s(old.lease_token)});`),"f");
  assert.equal(await labSql(`select public.scale_fail(${s(old.id)},${s(old.lease_token)},'RETRY',true);`),"f");
  assert.equal(await complete(next),"t"); assert.equal(await complete(next),"f");
});
test("Postgres: retry waits for backoff and stops after max attempts", async () => {
  const q=await queue({attempts:2}); await enqueue(q); const [first]=await claim(q);
  assert.equal(await labSql(`select public.scale_fail(${s(first.id)},${s(first.lease_token)},'PROVIDER_BUSY',true);`),"t");
  assert.equal((await claim(q)).length,0);
  await labSql(`update public.scale_jobs set available_at=clock_timestamp()-interval '1 second' where id=${s(first.id)};`);
  const [second]=await claim(q);
  await labSql(`select public.scale_fail(${s(second.id)},${s(second.lease_token)},'PROVIDER_BUSY',true);`);
  assert.equal(await labSql(`select state from public.scale_jobs where id=${s(second.id)};`),"dead");
});
test("Postgres: a crashed last attempt goes to the dead letter state", async () => {
  const q=await queue({attempts:1}); await enqueue(q); const [job]=await claim(q);
  await labSql(`update public.scale_jobs set lease_until=clock_timestamp()-interval '1 second' where id=${s(job.id)};`);
  assert.equal((await claim(q)).length,0);
  assert.equal(await labSql(`select state from public.scale_jobs where id=${s(job.id)};`),"dead");
});
test("Postgres: browser roles cannot read jobs or call worker functions", async () => {
  await assert.rejects(labSql("set role anon; select * from public.scale_jobs;"),/permission denied/);
  await assert.rejects(labSql("set role authenticated; select * from public.scale_claim('word');"),/permission denied/);
  const q=await queue();
  assert.ok((await labSql(`set role service_role; select row_to_json(j) from public.scale_enqueue(${s(q)},${s(randomUUID())},'service','{}'::jsonb) j;`)).includes('queued'));
});
test("Postgres: oversized and null payloads cannot bypass idempotency validation", async () => {
  const q=await queue();
  await assert.rejects(enqueue(q,randomUUID(),"large",{text:"가".repeat(12000)}),/INVALID_JOB/);
  await assert.rejects(labSql(`select public.scale_enqueue(${s(q)},${s(randomUUID())},'null',null);`),/INVALID_JOB/);
});
