import { Redis } from "@upstash/redis";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ── [임시] Redis → Supabase leads 마이그레이션 (2026-07-12, 일회성) ──────
// 실행·검증이 끝나면 이 라우트와 MIGRATE_SECRET 환경변수를 함께 제거할 것.
// - gp:leads 세트의 리드 전체를 Supabase leads 테이블로 이전
// - 동일 연락처(공백·대소문자·하이픈 무시)는 최초 1건만 유지
// - Supabase에 이미 있는 연락처(이중 저장분)는 건너뜀
// - ⚠️ Redis 데이터는 절대 삭제하지 않는다 (건수 일치 확인 전 삭제 금지)
// 사용: GET /api/admin/migrate-leads?key=<MIGRATE_SECRET>&dry=1  (조회만)
//       GET /api/admin/migrate-leads?key=<MIGRATE_SECRET>         (실제 이전)

interface RedisLead {
  id: string;
  name: string;
  contact: string;
  createdAt: number;
}

const normContact = (c: unknown) =>
  String(c ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]/g, "");

export async function GET(req: Request) {
  const url = new URL(req.url);
  const secret = process.env.MIGRATE_SECRET;
  if (!secret || url.searchParams.get("key") !== secret) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const dry = url.searchParams.get("dry") === "1";

  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!redisUrl || !redisToken) {
    return Response.json({ error: "Redis 환경변수 없음" }, { status: 500 });
  }
  const redis = new Redis({ url: redisUrl, token: redisToken });
  const supabase = createAdminClient();

  // ⓪ 전체 키 스캔 — 리드가 어떤 키에 들어있는지 투명하게 보고 (판단 근거)
  const allKeys: string[] = [];
  let cursor = "0";
  do {
    const [next, keys] = await redis.scan(cursor, { match: "*", count: 1000 });
    allKeys.push(...keys);
    cursor = String(next);
  } while (cursor !== "0" && allKeys.length < 5000);

  // ① 리드 소스 1: 회원가입 리드 (gp:leads 세트 → gp:lead:{id})
  const ids = ((await redis.smembers("gp:leads")) ?? []) as string[];
  const raw = await Promise.all(ids.map((id) => redis.get<RedisLead>(`gp:lead:${id}`)));
  const signupLeads = raw.filter((l): l is RedisLead => Boolean(l && l.contact));

  // ① 리드 소스 2: (구) 진단 이메일 캡처 (gp:diag_leads 리스트, GAS 폴백 저장분)
  interface DiagLead {
    email?: string;
    timestamp?: number;
    marketingConsent?: boolean;
  }
  const diagRaw = ((await redis.lrange("gp:diag_leads", 0, -1)) ?? []) as (string | DiagLead)[];
  const diagLeads: RedisLead[] = diagRaw
    .map((item) => {
      const o: DiagLead = typeof item === "string" ? (JSON.parse(item) as DiagLead) : item;
      if (!o?.email) return null;
      return {
        id: `diag:${o.email}`,
        name: "(이메일 캡처)",
        contact: String(o.email),
        createdAt: Number(o.timestamp ?? 0),
      };
    })
    .filter((l): l is RedisLead => l !== null);

  const leads = [...signupLeads, ...diagLeads];

  // ② 연락처 기준 중복 제거 — 최초(createdAt 가장 이른) 1건만
  const byContact = new Map<string, RedisLead>();
  for (const l of [...leads].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))) {
    const key = normContact(l.contact);
    if (!byContact.has(key)) byContact.set(key, l);
  }
  const unique = [...byContact.values()];

  // ③ Supabase 현재 행 수 + 기존 연락처
  const { count: beforeCount, error: cntErr } = await supabase
    .from("leads")
    .select("*", { count: "exact", head: true });
  if (cntErr) return Response.json({ error: `Supabase count 실패: ${cntErr.message}` }, { status: 500 });
  const existing = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("leads").select("contact").range(from, from + 999);
    if (error) return Response.json({ error: `Supabase select 실패: ${error.message}` }, { status: 500 });
    for (const row of data ?? []) existing.add(normContact((row as { contact?: string }).contact));
    if (!data || data.length < 1000) break;
  }

  // ④ 이전 대상 = Supabase에 없는 연락처만
  const toInsert = unique.filter((l) => !existing.has(normContact(l.contact)));

  const report = {
    redis_keys: allKeys.sort(),
    redis_signup_set: ids.length,
    redis_signup_valid: signupLeads.length,
    redis_diag_list: diagLeads.length,
    redis_valid: leads.length,
    redis_unique_contacts: unique.length,
    supabase_before: beforeCount,
    to_insert: toInsert.length,
    to_insert_preview: toInsert.map((l) => ({
      name: l.name,
      contact: l.contact,
      createdAt: new Date(l.createdAt ?? 0).toISOString(),
    })),
  };

  if (dry) return Response.json({ dry: true, ...report });

  // ⑤ insert (원본 가입 시각 보존)
  let inserted = 0;
  const failures: string[] = [];
  for (const l of toInsert) {
    const { error } = await supabase.from("leads").insert({
      name: l.name || "(이름 없음)",
      contact: String(l.contact).trim(),
      request_type: "general",
      source: "redis_migration",
      message: "진단 챗봇 회원가입(캘린더 저장) — Redis 이전분",
      consent: true,
      consent_at: new Date(l.createdAt ?? Date.now()).toISOString(),
      created_at: new Date(l.createdAt ?? Date.now()).toISOString(),
    });
    if (error) failures.push(`${l.contact}: ${error.message}`);
    else inserted++;
  }

  // ⑥ 검증
  const { count: afterCount } = await supabase
    .from("leads")
    .select("*", { count: "exact", head: true });
  const delta = (afterCount ?? 0) - (beforeCount ?? 0);
  return Response.json({
    ...report,
    inserted,
    failures,
    supabase_after: afterCount,
    delta,
    ok: delta === inserted && inserted === toInsert.length,
    note: "Redis 데이터는 삭제하지 않았습니다.",
  });
}
