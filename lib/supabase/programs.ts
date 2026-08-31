import type { Program } from "@/lib/match/types";
import { createAdminClient } from "./admin";

// programs 테이블 read/write — 배치 수집기(scripts/collect-programs.mts)와
// 앱의 fetchOpenPrograms(lib/data/programs.ts)가 공유하는 서버 전용 모듈.
// ⚠️ service_role 클라이언트(createAdminClient)를 쓴다 — 브라우저에서 import 금지.

interface ProgramRow {
  id: string;
  source: string;
  external_id: string;
  title: string;
  summary: string;
  target: string;
  support_field: string;
  region: string;
  apply_end: string | null;
  url: string;
  form_url: string | null;
  last_seen_at: string;
}

function toRow(p: Program, lastSeenAtIso: string): ProgramRow {
  const external_id = p.id.slice(p.id.indexOf(":") + 1) || p.id;
  return {
    id: p.id,
    source: p.source,
    external_id,
    title: p.title,
    summary: p.summary,
    target: p.target,
    support_field: p.supportField,
    region: p.region,
    apply_end: p.applyEnd,
    url: p.url,
    form_url: p.formUrl,
    last_seen_at: lastSeenAtIso,
  };
}

function fromRow(r: Record<string, unknown>): Program {
  return {
    id: r.id as string,
    title: r.title as string,
    summary: r.summary as string,
    target: r.target as string,
    supportField: r.support_field as string,
    region: r.region as string,
    applyEnd: (r.apply_end as string | null) ?? null,
    url: r.url as string,
    formUrl: (r.form_url as string | null) ?? null,
    source: r.source as Program["source"],
  };
}

export interface DiffSummary {
  source: string;
  seen: number;
  new: number;
  closed: number;
  deadlineChanged: number;
}

const CHUNK = 500;

// 소스 하나를 upsert하고 diff(신규/마감변경/종료)를 계산한다.
// mark-and-sweep: 이번 배치의 last_seen_at(runAt)보다 과거인, 아직 안 닫힌 같은 소스 행은
// "이번엔 안 보였다"는 뜻이므로 closed_at을 채운다 — 대상 건수와 무관하게 IN절 없이 처리된다.
export async function upsertAndDiff(
  source: Program["source"],
  programs: Program[],
  runAt: Date = new Date(),
): Promise<DiffSummary> {
  // 키 누락·외부 장애·응답 스키마 변경이 0건으로 보일 때 기존 공고를 전부 닫으면 안 된다.
  // 한 건이라도 정상 수집된 실행에서만 mark-and-sweep을 수행한다.
  if (programs.length === 0) {
    console.warn(`[programs] ${source}: 0건 응답이라 기존 공고를 보존합니다.`);
    return { source, seen: 0, new: 0, closed: 0, deadlineChanged: 0 };
  }

  const db = createAdminClient();
  const runIso = runAt.toISOString();

  const { data: beforeRows, error: beforeErr } = await db
    .from("programs")
    .select("id, apply_end")
    .eq("source", source)
    .is("closed_at", null);
  if (beforeErr) throw beforeErr;
  const beforeMap = new Map<string, string | null>(
    (beforeRows ?? []).map((r) => [r.id as string, (r.apply_end as string | null) ?? null]),
  );

  const rows = programs.map((p) => toRow(p, runIso));
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await db.from("programs").upsert(rows.slice(i, i + CHUNK), { onConflict: "id" });
    if (error) throw error;
  }

  // 이번 배치에서 안 보인 건(같은 소스, 아직 안 닫힘, last_seen_at이 이번 배치보다 과거) → 종료 처리
  const { error: closeErr } = await db
    .from("programs")
    .update({ closed_at: runIso })
    .eq("source", source)
    .is("closed_at", null)
    .lt("last_seen_at", runIso);
  if (closeErr) throw closeErr;

  let newCount = 0;
  let deadlineChanged = 0;
  const seenIds = new Set(rows.map((r) => r.id));
  for (const r of rows) {
    if (!beforeMap.has(r.id)) newCount++;
    else if ((beforeMap.get(r.id) ?? null) !== (r.apply_end ?? null)) deadlineChanged++;
  }
  const closed = [...beforeMap.keys()].filter((id) => !seenIds.has(id)).length;

  return { source, seen: rows.length, new: newCount, closed, deadlineChanged };
}

// 앱(무료 버튼 매칭 경로)이 읽는 함수 — DB 조회 1회, 외부 API·LLM 호출 없음.
export async function getOpenPrograms(limit = 3000): Promise<Program[]> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("programs")
    .select("*")
    .is("closed_at", null)
    .order("apply_end", { ascending: true, nullsFirst: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map(fromRow);
}
