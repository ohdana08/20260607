import test from "node:test";
import assert from "node:assert/strict";
import type { Program } from "../lib/match/types.ts";
import { parseEntryConditions, type EntryConditions } from "../lib/entry/conditions.ts";
import { matchEntryPrograms } from "../lib/entry/match.ts";
import { sourceEntrySummary, validateEntrySummary } from "../lib/entry/summary.ts";
import { summarizeEntryOnce } from "../lib/entry/summaryAttempt.ts";
const now = new Date("2026-11-12T15:01:00Z"); // November 13 KST
const conditions: EntryConditions = { age: "30_39", region: "서울", business: "under_3", industry: "tech" };
const program = (overrides: Partial<Program> = {}): Program => ({
  id: "bizinfo:real", source: "bizinfo", title: "중소기업 사업화 지원", summary: "기업당 최대 5천만원 지원. 사업계획서 제출",
  target: "중소기업, 창업 3년 미만 기업", supportField: "사업화", region: "전국", applyEnd: "2026-12-31", url: "https://www.bizinfo.go.kr/notice/123", formUrl: null, ...overrides,
});
test("accept only the four enumerated conditions and discard extra personal fields", () => {
  assert.deepEqual(parseEntryConditions({ ...conditions, email: "unused" }), conditions);
  assert.equal(parseEntryConditions({ ...conditions, region: "anywhere" }), null);
  assert.equal(parseEntryConditions({ ...conditions, age: undefined }), null);
});
test("excludes examples, closed-by-date at KST boundary, bad URL, invalid date, unknown targets", () => {
  const bad = [program({ source: "sample" }), program({ id: "sample-demo" }), program({ applyEnd: "2026-11-12" }), program({ applyEnd: "2026-02-30" }), program({ url: "javascript:alert(1)" }), program({ target: "지원대상 정보 없음" }), program({ applyEnd: null })];
  assert.deepEqual(matchEntryPrograms(bad, conditions, now), []);
  assert.equal(matchEntryPrograms([program()], conditions, now).length, 1);
  assert.equal(matchEntryPrograms([program({ applyEnd: null, summary: "상시 모집" })], conditions, now).length, 1);
});
test("whole age band and business range must fit; no fuzzy partial eligibility", () => {
  assert.equal(matchEntryPrograms([program({ target: "중소기업 34세 이하, 업력 3년 미만" })], conditions, now).length, 0);
  assert.equal(matchEntryPrograms([program({ target: "중소기업 만 30세 이상 39세 이하, 업력 3년 미만" })], conditions, now).length, 1);
  assert.equal(matchEntryPrograms([program({ target: "중소기업 업력 2년 이내" })], conditions, now).length, 0);
  assert.equal(matchEntryPrograms([program({ target: "예비창업자" })], conditions, now).length, 0);
  assert.equal(matchEntryPrograms([program()], { ...conditions, business: "pre" }, now).length, 0);
  assert.equal(matchEntryPrograms([program({ target: "예비창업자" })], { ...conditions, business: "pre" }, now).length, 1);
});
test("region aliases, national mislabelling, industry and uncollected special qualifications", () => {
  assert.equal(matchEntryPrograms([program({ region: "경상남도" })], { ...conditions, region: "경남" }, now).length, 1);
  assert.equal(matchEntryPrograms([program({ target: "부산 소재 중소기업" })], conditions, now).length, 0);
  assert.equal(matchEntryPrograms([program({ target: "제조업 중소기업" })], conditions, now).length, 0);
  assert.equal(matchEntryPrograms([program({ target: "여성 대표 중소기업" })], conditions, now).length, 0);
});
test("returns all matches sorted stably, deduplicates IDs for callers to bundle safely", () => {
  const list = [program({ id: "b", applyEnd: "2026-12-20" }), program({ id: "a", applyEnd: "2026-12-10" }), program({ id: "a" })];
  assert.deepEqual(matchEntryPrograms(list, conditions, now).map((p) => p.id), ["a", "b"]);
});
test("money and dates come only from source facts, budget totals never become benefits", () => {
  assert.equal(sourceEntrySummary(program()).amount, "최대 5천만원");
  assert.equal(sourceEntrySummary(program({ summary: "총 예산 5억원, 최대 100개사" })).amount, "공고문 확인");
  assert.equal(sourceEntrySummary(program({ applyEnd: null })).deadline, "공고문 확인");
  const validated = validateEntrySummary(program(), { amount: "10억원", deadline: "2027-01-01", description: "100만원을 보장합니다" });
  assert.equal(validated.amount, "최대 5천만원");
  assert.equal(validated.deadline, "2026-12-31");
  assert.equal(validated.description, sourceEntrySummary(program()).description);
});
test("durable claim allows at most one concurrent model call and preserves failure fallback", async () => {
  const claims = new Set<string>(); let calls = 0; let finished = 0; let wasFailed = false;
  const store = {
    async claim(p: Program) { if (claims.has(p.id)) return false; claims.add(p.id); return true; },
    async finish(_p: Program, summary: ReturnType<typeof sourceEntrySummary>, failed: boolean) { finished++; wasFailed = failed; assert.equal(summary.amount, "최대 5천만원"); },
  };
  const generate = async () => { calls++; throw new Error("simulated timeout"); };
  const results = await Promise.all(Array.from({ length: 12 }, () => summarizeEntryOnce(program(), store, generate)));
  assert.equal(results.filter(Boolean).length, 1); assert.equal(calls, 1); assert.equal(finished, 1); assert.equal(wasFailed, true);
  assert.equal(await summarizeEntryOnce(program(), store, generate), false);
});

test("business UI bins are half-open at three and seven years", () => {
  const matches = (target: string, business: EntryConditions["business"]) => matchEntryPrograms([program({ target })], { ...conditions, business }, now).length;
  assert.equal(matches("중소기업 업력 3년 미만", "under_3"), 1);
  assert.equal(matches("중소기업 업력 3년 미만", "3_7"), 0);
  assert.equal(matches("중소기업 업력 3년 이상 7년 미만", "3_7"), 1);
  assert.equal(matches("중소기업 업력 7년 미만", "over_7"), 0);
  assert.equal(matches("중소기업 업력 7년 이상", "over_7"), 1);
  assert.equal(matches("중소기업 업력 7년 초과", "over_7"), 0);
});

test("negative industry and qualification lists fail closed", () => {
  for (const target of ["중소기업 (제조업 제외)", "제조업은 신청 불가", "예비창업자 제외 중소기업", "업력 3년 미만 제외"]) {
    assert.equal(matchEntryPrograms([program({ target })], { ...conditions, industry: "manufacturing" }, now).length, 0);
  }
});
