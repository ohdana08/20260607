// 이용권 코드 검증 (가벼운 검증형 결제).
// 유효한 코드는 Vercel 환경변수 ACCESS_CODES 에 콤마로 구분해 넣는다.
//   예) ACCESS_CODES=BCC-7K2P9, BCC-Q4M1X, BCC-Z8N3T
// 결제(카톡 입금) 확인 후 운영자가 코드를 하나씩 발급한다.
export function isValidCode(code: unknown): boolean {
  if (typeof code !== "string") return false;
  const entered = code.trim().toUpperCase();
  if (!entered) return false;
  const valid = (process.env.ACCESS_CODES ?? "")
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);
  return valid.includes(entered);
}
