import type { Program } from "@/lib/match/types";
import { fetchKstartupOpen } from "./kstartup";
import { fetchBizinfoOpen } from "./bizinfo";
import { fetchNipaOpen } from "./nipa";
import { fetchKoccaOpen } from "./kocca";
import { fetchSmtechOpen } from "./smtech";
import { isStillOpen } from "./openFilter";

// 배치 수집기(scripts/collect-programs.mts)가 쓰는 소스 목록·페처 레지스트리.
// 2026-07-14 스프린트: 라이브 API 호출(요청마다) → 이 함수들을 주기적으로 배치 실행해
// Supabase에 적재하는 방식으로 전환(lib/supabase/programs.ts 참조).
export const COLLECTABLE_SOURCES = ["kstartup", "bizinfo", "nipa", "kocca", "smtech"] as const;
export type CollectableSource = (typeof COLLECTABLE_SOURCES)[number];

const FETCHERS: Record<CollectableSource, () => Promise<Program[]>> = {
  kstartup: fetchKstartupOpen,
  bizinfo: fetchBizinfoOpen,
  nipa: fetchNipaOpen,
  kocca: fetchKoccaOpen,
  smtech: fetchSmtechOpen,
};

// 소스 하나를 수집 + 마감 지난 건 제거(KST 기준, K-Startup/기업마당과 동일 원칙).
export async function collectSource(source: CollectableSource): Promise<Program[]> {
  const items = await FETCHERS[source]();
  return items.filter((p) => isStillOpen(p.applyEnd));
}
