import { Redis } from "@upstash/redis";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, tooManyRequests } from "@/lib/ratelimit";
import {
  getAuthedUser,
  getPaidRecord,
  MAX_ORDER_TRIES,
  ORDER_NO_RE,
  ORDER_TRIES_KEY,
  ORDER_USED_KEY,
  PAID_KEY,
  VALID_ORDER_KEY,
  type ValidOrder,
} from "@/lib/plan/paidAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

// GET — 내 결제 확인 상태 (로그인 필요)
export async function GET(req: Request) {
  const user = await getAuthedUser(req);
  if (!user) return Response.json({ paid: false, loggedIn: false });
  const paid = await getPaidRecord(user.id);
  return Response.json({ paid: Boolean(paid), loggedIn: true, orderNo: paid?.orderNo ?? null });
}

// POST — 주문번호 인증: 형식 검증 → 시도 제한 → 재사용 차단 → is_paid
export async function POST(req: Request) {
  // 무차별 대입 방지: IP 단위 rate limit을 인증보다 먼저 (기존 verify 버킷 재사용)
  const rl = await checkRateLimit(req, "verify");
  if (!rl.ok) return tooManyRequests(rl.retryAfter);

  const user = await getAuthedUser(req);
  if (!user) {
    return Response.json({ ok: false, error: "로그인이 필요해요." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "요청을 읽지 못했어요." }, { status: 400 });
  }
  const orderNo = String((body as { orderNo?: unknown })?.orderNo ?? "").replace(/\D/g, "");

  if (!ORDER_NO_RE.test(orderNo)) {
    return Response.json(
      { ok: false, error: "주문번호 형식이 아니에요. 그로블 주문내역의 18자리 숫자를 입력해 주세요." },
      { status: 400 },
    );
  }

  const r = getRedis();
  if (!r) {
    return Response.json(
      { ok: false, error: "지금은 확인이 어려워요. 잠시 후 다시 시도해 주세요." },
      { status: 503 },
    );
  }

  // 이미 인증된 계정이면 그대로 통과 (멱등)
  const already = await getPaidRecord(user.id);
  if (already) return Response.json({ ok: true, orderNo: already.orderNo });

  // 계정당 입력 시도 5회 제한 (형식이 유효한 시도만 카운트)
  const tries = await r.incr(ORDER_TRIES_KEY(user.id));
  if (tries > MAX_ORDER_TRIES) {
    return Response.json(
      { ok: false, error: "입력 시도가 5회를 넘었어요. 문의하기로 연락 주시면 확인해 드릴게요." },
      { status: 429 },
    );
  }

  // ★ 실제 결제 검증 (2026-07-09): 그로블 웹훅이 등록한 실결제 주문번호만 통과.
  //   존재하지 않는 18자리는 여기서 거부된다. 결제 취소된 주문번호도 거부.
  const valid = await r.get<ValidOrder>(VALID_ORDER_KEY(orderNo));
  if (!valid || valid.status !== "valid") {
    return Response.json(
      {
        ok: false,
        error:
          valid?.status === "cancelled"
            ? "결제가 취소된 주문번호예요."
            : "그로블 결제 내역에서 확인되지 않는 주문번호예요. 방금 결제하셨다면 1~2분 뒤 다시 시도해 주세요. 계속 안 되면 문의하기로 연락 주세요.",
      },
      { status: 404 },
    );
  }

  // 주문번호 재사용 차단 — 최초 1계정에만 묶인다 (동시요청 대비 NX)
  const bound = await r.set(ORDER_USED_KEY(orderNo), user.id, { nx: true });
  if (bound === null) {
    const owner = await r.get<string>(ORDER_USED_KEY(orderNo));
    if (owner !== user.id) {
      return Response.json(
        { ok: false, error: "이미 사용된 주문번호예요. 본인 결제가 맞다면 문의하기로 연락 주세요." },
        { status: 409 },
      );
    }
  }

  const record = { orderNo, email: user.email, verifiedAt: new Date().toISOString() };
  await r.set(PAID_KEY(user.id), record);

  // 감사 기록 → BCC CRM(bcc-admin) leads 테이블 (그로블 판매 리스트 대조용).
  // 실패해도 인증 자체는 유효 — best effort.
  try {
    const db = createAdminClient();
    await db.from("leads").insert({
      name: `[유료전환] ${user.email || user.id}`,
      contact: user.email || user.id,
      request_type: "product_b2c",
      status: "converted",
      source: `groble_order:${orderNo}`,
      message: `도우미 주문번호 인증 (userId: ${user.id})`,
      consent: true,
      consent_at: record.verifiedAt,
    });
  } catch {
    /* CRM 기록 실패는 무시 (Redis 가 원본) */
  }

  return Response.json({ ok: true, orderNo });
}
