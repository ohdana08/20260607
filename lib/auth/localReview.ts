// 운영 인증을 건드리지 않고 로컬 UI 검사를 할 때만, 읽기 전용 추천 API를 연다.
// 세 조건(개발 빌드·명시적 환경변수·localhost의 /api/match)이 모두 맞아야 한다.
export function isLocalReviewMatchRequest(
  req: Request,
  env: { NODE_ENV?: string; LOCAL_REVIEW_MODE?: string } = process.env,
): boolean {
  if (env.NODE_ENV !== "development" || env.LOCAL_REVIEW_MODE !== "on") return false;
  try {
    const url = new URL(req.url);
    const localHost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    return localHost && url.pathname === "/api/match";
  } catch {
    return false;
  }
}
