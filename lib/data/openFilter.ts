// 공고 마감 필터 — KST(Asia/Seoul) 날짜 기준.
// 과거 버그(2026-07-10 수정): UTC 날짜로 비교해 KST 오전 9시 전에는 '어제'와 비교됐고,
// 그 결과 전날 마감 공고가 다음 날 오전까지 모집중으로 노출됐다 (7/9 마감 → 7/10 노출).

export function kstToday(): string {
  // en-CA 로케일은 YYYY-MM-DD 형식을 보장한다
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}

// 마감일 당일까지는 신청 가능. 마감일 미표기(null)는 상시 모집으로 보고 포함.
export function isStillOpen(applyEnd: string | null): boolean {
  return !applyEnd || applyEnd >= kstToday();
}
