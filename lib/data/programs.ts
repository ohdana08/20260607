import type { Program } from "@/lib/match/types";
import { SAMPLE_PROGRAMS } from "./sample";
import { getOpenPrograms } from "@/lib/supabase/programs";
import { isStillOpen } from "./openFilter";

// (2026-07-14 스프린트 — 시나리오A) 라이브 API 호출(요청마다 K-Startup·기업마당 호출) →
// 배치 수집(scripts/collect-programs.mts, GitHub Actions 주기 실행)이 Supabase
// programs 테이블에 5소스(K-Startup·기업마당·NIPA·KOCCA·SMTECH)를 미리 적재해두고,
// 이 함수는 그 테이블을 읽기만 한다. 무료(버튼) 매칭 경로는 DB 조회 1회뿐이라
// 외부 API·LLM 호출이 0회 — 비용 경계(무료 구간 고정비 0) 원칙에 부합하고 응답도 더 빠르다.
// DB 조회가 비거나 실패하면(배치 미실행·장애) 샘플로 폴백 — 기존 동작과 동일.
export async function fetchOpenPrograms(): Promise<{ programs: Program[]; usingSample: boolean }> {
  let programs: Program[] = [];
  try {
    programs = await getOpenPrograms();
  } catch (err) {
    console.error("[programs] Supabase 조회 실패", err);
  }
  // 수집 배치가 늦거나 DB에 오래된 행이 남아도 사용자 화면에는 마감 공고를 내보내지 않는다.
  const openPrograms = programs.filter((program) => isStillOpen(program.applyEnd));
  if (openPrograms.length === 0) {
    return {
      programs: SAMPLE_PROGRAMS.filter((program) => isStillOpen(program.applyEnd)),
      usingSample: true,
    };
  }
  return { programs: openPrograms, usingSample: false };
}
