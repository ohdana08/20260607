import type { Program } from "@/lib/match/types";
import { fetchKstartupOpen } from "./kstartup";
import { fetchBizinfoOpen } from "./bizinfo";
import { SAMPLE_PROGRAMS } from "./sample";
import { isStillOpen } from "./openFilter";

// 풀 상한 (2026-07-14 P0): kstartup 10페이지(1,000) + bizinfo 5페이지(500) 중
// 모집중만 남긴 전량을 수용. 예전 160 상한은 지역 공고를 소리 없이 잘랐다 —
// LLM 토큰 가드는 여기가 아니라 prefilter의 MAX_CANDIDATES(45)가 담당하므로
// 풀 절단은 커버리지 손해만 남긴다.
const POOL_MAX = 1200;

// 두 배열을 번갈아 섞어 양쪽 소스가 고르게 들어가도록.
function interleave<T>(a: T[], b: T[]): T[] {
  const out: T[] = [];
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (i < a.length) out.push(a[i]);
    if (i < b.length) out.push(b[i]);
  }
  return out;
}

// K-Startup + 기업마당(중앙·지자체 포함)을 합쳐 모집중 공고 목록을 반환.
// 둘 다 0건이면 샘플로 폴백.
export async function fetchOpenPrograms(
  maxCount: number = POOL_MAX,
): Promise<{ programs: Program[]; usingSample: boolean }> {
  const [ks, biz] = await Promise.allSettled([fetchKstartupOpen(), fetchBizinfoOpen()]);
  // API 응답 직후 마감 지난 공고 제거 (KST 기준 — 2026-07-10 버그 수정).
  // kstartup 은 모집중 플래그(rcrt_prgs_yn)만 믿어 날짜 검사가 없었고,
  // bizinfo 는 UTC 날짜로 비교해 KST 오전엔 전날 마감 공고가 통과했다.
  const ksList = (ks.status === "fulfilled" ? ks.value : []).filter((p) => isStillOpen(p.applyEnd));
  const bizList = (biz.status === "fulfilled" ? biz.value : []).filter((p) => isStillOpen(p.applyEnd));
  if (ks.status === "rejected") console.error("[programs] kstartup failed", ks.reason);
  if (biz.status === "rejected") console.error("[programs] bizinfo failed", biz.reason);

  const merged = interleave(ksList, bizList).slice(0, maxCount);
  if (merged.length === 0) return { programs: SAMPLE_PROGRAMS, usingSample: true };
  return { programs: merged, usingSample: false };
}
