// 양식 목차 결정적 추출(2026-07-12) — LLM 요약이 목차를 압축·누락할 수 있어(검증에서 확인됨),
// 업로드된 양식 텍스트에서 항목 라인(□, n., n-n.)을 코드로 직접 뽑아 요약에 원문 그대로 결합한다.
// 2026-07-14 보강: 실제 프리팁스·예창·초창 양식 3종으로 검증 중 발견한 오염 2가지 —
// ① hwpx 추출 시 <hp:lineBreak/> 같은 내부 XML 태그가 텍스트에 그대로 남아, 같은 항목이
//    태그 차이만으로 다른 문자열이 돼 있음 → 태그 제거로 정리.
// ② 표지 요약 페이지의 짧은 제목과 본문 섹션 제목이 같은 번호/기호로 두 번씩 잡히고
//    "00.00 ~ 00.00" 같은 날짜 표 칸까지 숫자 접두사 정규식에 걸림 → 한글 없는 줄 배제 +
//    같은 번호("2." "2-1.")·같은 □항목(부가어 무시 후 동일)은 가장 정보량 많은 한 줄만 채택.
function formHeadingDedupKey(l: string): string {
  const num = l.match(/^[0-9]{1,2}(-[0-9]{1,2})?\./)?.[0];
  if (num) return num;
  if (/^(□|■)/.test(l))
    return l
      .replace(/^(□|■)\s*/, "")
      .replace(/창업\s*아이템\s*/g, "")
      .trim();
  return l;
}
export function extractFormHeadings(text: string): string[] {
  const candidates = text
    .split(/\n/)
    .map((l) => l.replace(/<[^>]+>/g, "").trim()) // hwpx 내부 XML 태그 잔존분 제거
    .filter(
      (l) =>
        l.length >= 2 &&
        l.length <= 60 &&
        /^(□|■|[0-9]{1,2}(-[0-9]{1,2})?\.\s*\S)/.test(l),
    )
    .filter((l) => /[가-힣]/.test(l)); // 날짜 표 칸 등 한글 없는 잡음 배제

  const bestByKey = new Map<string, string>();
  const order: string[] = [];
  for (const l of candidates) {
    const key = formHeadingDedupKey(l);
    const prev = bestByKey.get(key);
    if (!prev) order.push(key);
    if (!prev || l.length > prev.length) bestByKey.set(key, l);
  }
  return order.map((key) => bestByKey.get(key)!);
}
