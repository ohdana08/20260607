// Local component benchmark only: real Redis, synthetic catalog/source latency.
// No production HTTP, Supabase, authentication or AI calls are made.
import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { loadScaleModule, labRedis } from "../tests/helpers/scale-harness.mjs";
const { SnapshotCache } = loadScaleModule("lib/scale/snapshotCache.ts");
const { RedisSnapshotStore } = loadScaleModule("lib/scale/redisSnapshotStore.ts");
const programs = Array.from({ length: 3000 }, (_, i) => ({ id: `synthetic:${i}`, title: `합성 공고 ${i}`, summary: "공개 공고 성능 검사 데이터 ".repeat(12), region: "경기", applyEnd: "2026-12-31" }));
let sourceReads = 0;
const shared = `benchmark:{${randomUUID()}}:catalog`;
const caches = Array.from({ length: 10 }, () => new SnapshotCache(new RedisSnapshotStore(labRedis, shared), async () => {
  sourceReads++; await new Promise((resolve) => setTimeout(resolve, 50)); return programs;
}));
const coldStarted=performance.now();
await Promise.all(Array.from({length:100},(_,i)=>caches[i%10].get()));
const cold={requests:100,instances:10,sourceReads,durationMs:Math.round(performance.now()-coldStarted)};
const percentile=(a,p)=>[...a].sort((x,y)=>x-y)[Math.min(a.length-1,Math.ceil(a.length*p)-1)];
const phases=[];
for (const rps of [1,10,100]) {
  const n=rps*3, latencies=[], scheduleLag=[], start=performance.now();
  await Promise.all(Array.from({length:n},(_,i)=>new Promise((resolve,reject)=>setTimeout(async()=>{
    const began=performance.now();scheduleLag.push(began-start-i*1000/rps);
    try { await caches[i%10].get();latencies.push(performance.now()-began);resolve(); } catch(error){reject(error);}
  },i*1000/rps))));
  const durationMs=performance.now()-start;
  phases.push({offeredRps:rps,requests:n,durationMs:Math.round(durationMs),p95Ms:Number(percentile(latencies,.95).toFixed(2)),maxMs:Number(Math.max(...latencies).toFixed(2)),schedulingLagP95Ms:Number(percentile(scheduleLag,.95).toFixed(2))});
}
const report={measuredAt:new Date().toISOString(),scope:"single-host component benchmark; real Redis; synthetic source; excludes HTTP/auth/DB/AI",node:process.version,catalogRows:programs.length,catalogBytes:Buffer.byteLength(JSON.stringify(programs)),cold,phases,totalSourceReads:sourceReads};
writeFileSync('docs/architecture/scale-benchmark.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
