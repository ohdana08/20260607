import { writeFileSync } from "node:fs";
import { labSql } from "../tests/helpers/scale-harness.mjs";

// A single fixed local connection owns this TEMP table. Never accepts a database
// URL; cannot apply indexes to the live programs table or other Docker projects.
const query = `select id,source,title,summary,target,support_field,region,apply_end,url,form_url
  from perf_programs where closed_at is null order by apply_end asc nulls last limit 3000`;
const explain = `explain (analyze, buffers, format json) ${query};`;
const result = await labSql(`
set client_min_messages = warning;
create temp table perf_programs (
  id text primary key, source text not null, title text not null, summary text not null,
  target text not null, support_field text not null, region text not null, apply_end date,
  url text not null, form_url text, closed_at timestamptz
);
insert into perf_programs
select 'fixture:' || i, 'sample', '가상 공고 ' || i,
  repeat('측정용 공고 요약입니다. ', 12), '중소기업', '사업화', '전국',
  case when i % 17 = 0 then null else date '2026-09-17' + (i % 180) end,
  'https://example.invalid/' || i, null,
  case when i % 5 = 0 then null else timestamptz '2026-09-01Z' end
from generate_series(1, 100000) i;
analyze perf_programs;
select json_build_object('postgres', version(), 'total_rows', 100000, 'open_rows', 20000)::text;
${explain}
${Array.from({ length: 5 }, () => explain).join("\n")}
create index perf_programs_open_deadline_idx on perf_programs (apply_end asc nulls last, id) where closed_at is null;
analyze perf_programs;
${explain}
${Array.from({ length: 5 }, () => explain).join("\n")}
`);

// psql pretty-prints JSON plans. Parse whole top-level JSON values, ignoring
// command-status lines; all data are synthetic and stored for independent review.
const values = [];
let depth = 0, start = -1, quoted = false, escaped = false;
for (let i = 0; i < result.length; i++) {
  const c = result[i];
  if (start < 0) { if (c === "{" || c === "[") { start = i; depth = 1; } continue; }
  if (quoted) { if (escaped) escaped = false; else if (c === "\\") escaped = true; else if (c === '"') quoted = false; continue; }
  if (c === '"') quoted = true;
  else if (c === "{" || c === "[") depth++;
  else if (c === "}" || c === "]") {
    depth--; if (depth === 0) { values.push(JSON.parse(result.slice(start, i + 1))); start = -1; }
  }
}
if (values.length !== 13) throw new Error(`Expected environment + 12 plans; got ${values.length}`);
const summarize = (plans) => {
  const times = plans.map((p) => p[0]["Execution Time"]).sort((a, b) => a - b);
  return { medianExecutionMs: times[2], minExecutionMs: times[0], maxExecutionMs: times[4], plans };
};
const report = { recordedAt: new Date().toISOString(), environment: values[0], query,
  limitations: ["Synthetic local TEMP table, not the production schema, data or query plan.",
    "One warmup + five measurements per variant; pages may be warm. Local buffers are not production disk I/O.",
    "Candidate index only. Live existing indexes/cardinality and write overhead must be inspected before deployment.",
    "ORDER BY preserves existing deadline-only contract; ties have no guaranteed order."],
  before: summarize(values.slice(2, 7)), after: summarize(values.slice(8, 13)) };
writeFileSync("docs/architecture/performance-db.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ environment: report.environment,
  beforeMedianMs: report.before.medianExecutionMs, afterMedianMs: report.after.medianExecutionMs,
  beforePlan: report.before.plans[0][0].Plan, afterPlan: report.after.plans[0][0].Plan }, null, 2));
