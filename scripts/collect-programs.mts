// 7소스 배치 수집기 — GitHub Actions와 Vercel Cron이 주기 실행한다.
// 라이브 API 호출(요청마다) 대신 이 스크립트가 K-Startup·기업마당·e나라도움·NIPA·KOCCA·SMTECH·경기기업비서를
// 모아 Supabase programs 테이블에 upsert하고, 신규/마감변경/종료(diff)를 로그로 남긴다.
//
// 실행: npx tsx scripts/collect-programs.mts
// 필요 환경변수: KSTARTUP_KEY, BIZINFO_KEY, BOJO_SERVICE_KEY(또는 같은 data.go.kr 키),
//              KOCCA_KEY(선택 — 없으면 kocca 0건 스킵),
//              NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// 소스 하나가 실패해도 나머지는 계속 진행한다(Promise.allSettled) — 사이트 개편으로
// 파서 하나가 죽어도 전체 배치가 멈추지 않게. 0건 수집은 각 lib/data/*.ts가 자체
// 경고 로그를 남긴다("조용히 빠뜨리지 않는다" 원칙).
import { runCollection } from "../lib/data/collectionRun";

const result = await runCollection();
if (!result.ok) process.exitCode = 1;
