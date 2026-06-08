import type { Program } from "@/lib/match/types";
import { fetchKstartupOpen } from "./kstartup";
import { fetchBizinfoOpen } from "./bizinfo";
import { SAMPLE_PROGRAMS } from "./sample";

const MAX_TO_RANK = 120; // LLM 토큰 절약: 추천 후보 상한

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
export async function fetchOpenPrograms(): Promise<{ programs: Program[]; usingSample: boolean }> {
  const [ks, biz] = await Promise.allSettled([fetchKstartupOpen(), fetchBizinfoOpen()]);
  const ksList = ks.status === "fulfilled" ? ks.value : [];
  const bizList = biz.status === "fulfilled" ? biz.value : [];
  if (ks.status === "rejected") console.error("[programs] kstartup failed", ks.reason);
  if (biz.status === "rejected") console.error("[programs] bizinfo failed", biz.reason);

  const merged = interleave(ksList, bizList).slice(0, MAX_TO_RANK);
  if (merged.length === 0) return { programs: SAMPLE_PROGRAMS, usingSample: true };
  return { programs: merged, usingSample: false };
}
