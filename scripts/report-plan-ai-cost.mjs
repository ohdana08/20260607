import { Redis } from "@upstash/redis";

const orderNo = String(process.argv[2] ?? "").trim();
if (!orderNo) {
  console.error("사용법: npm run report:plan-cost -- 주문번호");
  process.exitCode = 1;
} else if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
  console.error(".env.local에 UPSTASH_REDIS_REST_URL/TOKEN이 필요합니다.");
  process.exitCode = 1;
} else {
  const redis = Redis.fromEnv();
  const [spent, logs] = await Promise.all([
    redis.get(`gp:ai-spend-krw:${orderNo}`),
    redis.lrange(`gp:ai-usage:${orderNo}`, 0, 99),
  ]);
  const rows = (Array.isArray(logs) ? logs : [])
    .map((entry) => (entry && typeof entry === "object" ? entry : {}))
    .sort((a, b) => String(a.at ?? "").localeCompare(String(b.at ?? "")))
    .map((entry) => ({
      시각: String(entry.at ?? ""),
      단계: String(entry.stage ?? ""),
      원가원: Number(entry.actualKrw ?? 0),
      모델: String(entry.usage?.model ?? ""),
      입력토큰: Number(entry.usage?.inputTokens ?? 0),
      출력토큰: Number(entry.usage?.outputTokens ?? 0),
      검색횟수: Number(entry.usage?.webSearchRequests ?? 0),
    }));

  console.log(`주문번호: ${orderNo}`);
  console.log(`누적 AI 원가: ${Math.max(0, Number(spent ?? 0)).toLocaleString("ko-KR")}원`);
  if (rows.length > 0) console.table(rows);
  else console.log("아직 저장된 AI 사용 기록이 없습니다.");
}
