import { Redis } from "@upstash/redis";
import { isMasterCode } from "@/lib/plan/access";
import {
  GROBLE_RAW_EVENTS,
  ORDER_USED_KEY,
  PAID_KEY,
  VALID_ORDER_KEY,
  type ValidOrder,
} from "@/lib/plan/paidAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ── 그로블 웹훅 수신 (실제 결제 검증의 원장 생성) ──────────────────────────
// 그로블 Pro → 설정 → 웹훅에 아래 URL을 등록한다:
//   https://20260607.vercel.app/api/groble/webhook?key=<GROBLE_WEBHOOK_KEY>
// 지원 이벤트: 일반결제 완료 / 일반결제 취소 요청 / 정기결제 완료 / 정기결제 해지 신청
// 그로블이 서명을 제공하지 않으므로 URL 안의 비밀 key 로 위조를 차단한다.
//
// 페이로드 필드 스펙이 비공개라 방어적으로 파싱한다:
//   1) 흔한 필드명 후보에서 주문번호를 찾고
//   2) 없으면 페이로드 전체에서 18자리 숫자 패턴을 찾는다
//   3) 원본은 gp:groble_raw 에 최근 100건 보관 (스펙 확인·디버깅용)

function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

function keyOk(req: Request): boolean {
  const expected = process.env.GROBLE_WEBHOOK_KEY;
  if (!expected) return false; // 키 미설정이면 전부 차단 (fail-closed)
  const got = new URL(req.url).searchParams.get("key") ?? "";
  return got === expected;
}

// 그로블 실제 페이로드 스펙 (2026-07-09 테스트 발송 원본으로 확인, version 2026-04-30):
//   { id: "evt_...", type: "payment.completed", data: { object: { merchantUid: "<주문번호>", buyer, content, pricing, ... } } }
// 취소류는 type 에 cancel 이 포함될 것으로 가정 (미확인 시 원본 보관분으로 재확인).

// data.object.merchantUid 원본 값 추출 (실스펙 우선, 구조가 바뀌면 후보 필드 폴백)
function findMerchantUid(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const obj = (p.data as Record<string, unknown> | undefined)?.object as
    | Record<string, unknown>
    | undefined;
  const candidates = [obj?.merchantUid, obj?.merchant_uid, p.merchantUid, p.orderNo, p.orderId];
  for (const v of candidates) {
    if (typeof v === "string" || typeof v === "number") return String(v);
  }
  return null;
}

// 18자리 주문번호로 정규화. merchantUid 가 18자리가 아니면(테스트 이벤트 등) null.
function toOrderNo(uid: string | null, payload: unknown): string | null {
  if (uid) {
    const digits = uid.replace(/\D/g, "");
    if (/^\d{18}$/.test(digits)) return digits;
    return null; // merchantUid 는 있는데 주문번호 형식이 아님 (테스트 이벤트)
  }
  // 구조가 예상과 다를 때 최후 폴백: 직렬화 전체에서 18자리 숫자 패턴
  const m = JSON.stringify(payload ?? "").match(/\d{18}/);
  return m ? m[0] : null;
}

function isCancelEvent(payload: unknown): boolean {
  const type =
    payload && typeof payload === "object"
      ? String((payload as Record<string, unknown>).type ?? "").toLowerCase()
      : "";
  if (type.includes("cancel") || type.includes("refund")) return true;
  if (type.includes("completed")) return false;
  // type 필드가 없거나 낯선 값이면 본문 전체에서 취소 신호 탐색
  const s = JSON.stringify(payload ?? "").toLowerCase();
  return s.includes("취소") || s.includes("해지") || s.includes("cancel") || s.includes("refund");
}

export async function POST(req: Request) {
  if (!keyOk(req)) return Response.json({ error: "forbidden" }, { status: 403 });

  const r = getRedis();
  if (!r) return Response.json({ error: "storage unavailable" }, { status: 503 });

  let payload: unknown = null;
  try {
    payload = await req.json();
  } catch {
    // JSON 이 아니어도 원본은 남긴다
    payload = { _raw: await req.text().catch(() => "") };
  }

  // 원본 보관 (최근 100건) — 스펙 확인용
  await r.lpush(GROBLE_RAW_EVENTS, JSON.stringify({ at: new Date().toISOString(), payload }));
  await r.ltrim(GROBLE_RAW_EVENTS, 0, 99);

  const uid = findMerchantUid(payload);
  const orderNo = toOrderNo(uid, payload);
  if (!orderNo) {
    // merchantUid 가 주문번호(18자리) 형식이 아님 — 그로블 "테스트 발송"이 이 경우.
    // 실결제는 18자리 merchantUid 로 들어와 정상 등록된다. (원본 보관됨)
    if (uid) {
      return Response.json({
        ok: true,
        note: `연동 정상. merchantUid '${uid}' 는 테스트 값이라 등록하지 않았어요 — 실결제(18자리)는 자동 등록됩니다.`,
      });
    }
    return Response.json({ ok: false, note: "order number not found in payload (raw saved)" });
  }

  if (isCancelEvent(payload)) {
    // 결제 취소/해지: 원장에서 취소 표시 + 이미 인증에 쓰였다면 해당 계정 is_paid 회수
    const existing = await r.get<ValidOrder>(VALID_ORDER_KEY(orderNo));
    await r.set(VALID_ORDER_KEY(orderNo), {
      orderNo,
      registeredAt: existing?.registeredAt ?? new Date().toISOString(),
      via: existing?.via ?? "webhook",
      status: "cancelled",
    } satisfies ValidOrder);
    const usedBy = await r.get<string>(ORDER_USED_KEY(orderNo));
    if (usedBy) await r.del(PAID_KEY(usedBy));
    return Response.json({ ok: true, orderNo, action: "cancelled" });
  }

  // 결제 완료: 유효 주문번호 원장에 등록
  await r.set(VALID_ORDER_KEY(orderNo), {
    orderNo,
    registeredAt: new Date().toISOString(),
    via: "webhook",
    status: "valid",
  } satisfies ValidOrder);
  return Response.json({ ok: true, orderNo, action: "registered" });
}

// GET — 운영자 확인용 (마스터코드 또는 웹훅 키):
//   ?code=<마스터코드>              → 최근 웹훅 원본 10건
//   ?code=<마스터코드>&register=<18자리> → 주문번호 수동 등록 (웹훅 유실·과거 결제 대조 후)
//   ?key=<웹훅키>                   → 원본 조회만 가능 (파서 디버깅용, 수동 등록은 마스터코드만)
export async function GET(req: Request) {
  const url = new URL(req.url);
  const master = isMasterCode(url.searchParams.get("code"));
  if (!master && !keyOk(req)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  if (!master && url.searchParams.get("register")) {
    return Response.json({ error: "manual register requires master code" }, { status: 403 });
  }
  const r = getRedis();
  if (!r) return Response.json({ error: "storage unavailable" }, { status: 503 });

  const reg = url.searchParams.get("register");
  if (reg) {
    const digits = reg.replace(/\D/g, "");
    if (!/^\d{18}$/.test(digits)) {
      return Response.json({ ok: false, error: "18자리 숫자가 아니에요." }, { status: 400 });
    }
    await r.set(VALID_ORDER_KEY(digits), {
      orderNo: digits,
      registeredAt: new Date().toISOString(),
      via: "manual",
      status: "valid",
    } satisfies ValidOrder);
    return Response.json({ ok: true, orderNo: digits, action: "registered(manual)" });
  }

  const raw = await r.lrange(GROBLE_RAW_EVENTS, 0, 9);
  return Response.json({ recentEvents: raw });
}
