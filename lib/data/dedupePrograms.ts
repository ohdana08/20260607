import type { Program } from "@/lib/match/types";

const SOURCE_PRIORITY: Partial<Record<Program["source"], number>> = {
  egbiz: 0,
  kstartup: 1,
  bojo: 2,
  bizinfo: 3,
  nipa: 4,
  kocca: 4,
  smtech: 4,
  sample: 9,
};

export function canonicalProgramTitle(title: string): string {
  return title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/^\s*\[(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)(?:[^\]]*)\]\s*/, "")
    .replace(/[^0-9a-z가-힣]+/g, "");
}

function richness(program: Program): number {
  const unknown = /불명|원문 확인|정보 없음/;
  return (unknown.test(program.summary) ? 0 : program.summary.length) +
    (unknown.test(program.target) ? 0 : program.target.length) +
    (program.formUrl ? 30 : 0);
}

function prefer(left: Program, right: Program): Program {
  const leftPriority = SOURCE_PRIORITY[left.source] ?? 5;
  const rightPriority = SOURCE_PRIORITY[right.source] ?? 5;
  if (leftPriority !== rightPriority) return leftPriority < rightPriority ? left : right;
  return richness(left) >= richness(right) ? left : right;
}

// 제목(지역 머리표·문장부호 제거)과 마감일이 모두 같은 경우만 합친다.
// 지역 포털이 기업마당 공고를 재게시해도 추천 카드가 두 장 생기지 않게 하는 보수적 중복 제거다.
export function dedupePrograms(programs: Program[]): Program[] {
  const byKey = new Map<string, Program>();
  for (const program of programs) {
    const titleKey = canonicalProgramTitle(program.title);
    if (!titleKey) continue;
    const key = `${titleKey}|${program.applyEnd ?? "상시"}`;
    const existing = byKey.get(key);
    byKey.set(key, existing ? prefer(existing, program) : program);
  }
  return [...byKey.values()];
}
