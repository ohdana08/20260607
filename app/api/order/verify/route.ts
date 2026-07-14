import { Redis } from "@upstash/redis";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, tooManyRequests } from "@/lib/ratelimit";
import { GROBLE_PRODUCT_ID } from "@/lib/config";
import {
  getAuthedUser,
  getPaidRecord,
  isQaOrder,
  MAX_ORDER_TRIES,
  ORDER_NO_RE,
  ORDER_TRIES_KEY,
  ORDER_USED_KEY,
  PAID_KEY,
  VALID_ORDER_KEY,
  type AuthedUser,
  type ValidOrder,
} from "@/lib/plan/paidAccess";

// 실주문 검증(최초·재구매 공용) — 시도 제한 → 원장 조회 → (재구매면) 상품 필터 →
// 재사용 차단 → is_paid 기록. repurchase=true 면 기존 usedProgramId 없이 새로
// 덮어써 이용권을 교체한다(=소진 해제).
async function verifyRealOrderAndRespond(
  r: Redis,
  user: AuthedUser,
  orderNo: string,
  opts: { repurchase: boolean },
): Promise<Response> {
  // 계정당 입력 시도 5회 제한 — 재구매 시도도 같은 버킷(무차별 대입 방지는 항상 적용)
  const tries = await r.incr(ORDER_TRIES_KEY(user.id));
  if (tries > MAX_ORDER_TRIES) {
    return Response.json(
      { ok: false, error: "입력 시도가 5회를 넘었어요. 문의하기로 연락 주시면 확인해 드릴게요." },
      { status: 429 },
    );
  }

  // ★ 실제 결제 검증: 그로블 웹훅이 등록한 실결제 주문번호만 통과.
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

  // 재구매 갱신 전용(2026-07-14): 상품 필터 — 재구매 대상은 신상품(RJczGx)만.
  // productId 를 확인할 수 없는(구형·미확인) 원장은 막지 않는다 — 실결제를 오탐으로
  // 막는 쪽이 훨씬 위험하므로 fail-open.
  if (opts.repurchase && valid.productId && valid.productId !== GROBLE_PRODUCT_ID) {
    return Response.json(
      { ok: false, error: "재구매 대상 상품의 주문번호가 아니에요. 최신 상품으로 다시 결제해 주세요." },
      { status: 400 },
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

  // 새 레코드로 통째로 덮어쓴다 — 재구매면 이전 usedProgramId 는 자동으로 사라진다(=소진 해제).
  const record = { orderNo, email: user.email, verifiedAt: new Date().toISOString() };
  await r.set(PAID_KEY(user.id), record);

  // 감사 기록 → BCC CRM(bcc-admin) leads 테이블 (그로블 판매 리스트 대조용).
  // 실패해도 인증 자체는 유효 — best effort.
  try {
    const db = createAdminClient();
    await db.from("leads").insert({
      name: `[${opts.repurchase ? "재구매" : "유료전환"}] ${user.email || user.id}`,
      contact: user.email || user.id,
      request_type: "product_b2c",
      status: "converted",
      source: `groble_order:${orderNo}`,
      message: `도우미 주문번호 인증 (userId: ${user.id}${opts.repurchase ? ", 재구매" : ""})`,
      consent: true,
      consent_at: record.verifiedAt,
    });
  } catch {
    /* CRM 기록 실패는 무시 (Redis 가 원본) */
  }

  console.log(`[order/verify] ${opts.repurchase ? "재구매 갱신" : "최초 인증"}: ${orderNo} (user: ${user.id})`);
  return Response.json({ ok: true, orderNo, ...(opts.repurchase ? { renewed: true } : {}) });
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

// GET — 내 결제 확인 상태 (로그인 필요). usedProgramId = 이용권이 바인딩된 공고 (소진 여부)
export async function GET(req: Request) {
  const user = await getAuthedUser(req);
  if (!user) return Response.json({ paid: false, loggedIn: false });
  const paid = await getPaidRecord(user.id);
  return Response.json({
    paid: Boolean(paid),
    loggedIn: true,
    orderNo: paid?.orderNo ?? null,
    usedProgramId: paid?.usedProgramId ?? null,
  });
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
  // QA 주문번호("QA"+16자리)는 영문을 살려야 하므로 영숫자만 남기고, 그 외엔 기존대로 숫자만
  const cleaned = String((body as { orderNo?: unknown })?.orderNo ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  const qa = isQaOrder(cleaned); // QA_MODE=true 배포에서만 true — 프로덕션(미설정)은 항상 false
  const orderNo = qa ? cleaned : cleaned.replace(/\D/g, "");

  if (!qa && !ORDER_NO_RE.test(orderNo)) {
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

  // 이미 인증된 계정 — 같은 번호 재입력이면 멱등 통과, 소진 후 "새" 번호면 재구매 갱신 시도.
  const already = await getPaidRecord(user.id);
  if (already) {
    // 소진 전(아직 이용권 미사용)이거나 같은 번호 재입력이면 기존 상태 그대로 반환 —
    // 결제 실수로 두 번 인증해도 기존 유효한 상태를 덮어쓰지 않는다.
    if (!already.usedProgramId || orderNo === already.orderNo) {
      return Response.json({
        ok: true,
        orderNo: already.orderNo,
        isQa: Boolean(already.isQa),
        usedProgramId: already.usedProgramId ?? null,
      });
    }
    // 이용권 소진 후 "새" QA 주문번호 → 원장 검증 없이 즉시 교체 (QA_MODE 한정 — 반복 테스트용)
    if (qa) {
      const renewed = { orderNo, email: user.email, verifiedAt: new Date().toISOString(), isQa: true };
      await r.set(PAID_KEY(user.id), renewed);
      console.log(`[order/verify] QA 이용권 갱신: ${orderNo} (user: ${user.id})`);
      return Response.json({ ok: true, orderNo, isQa: true, renewed: true });
    }
    // 실주문 재구매(2026-07-14): 새 주문번호를 최초 결제와 동일하게 완전 검증 후 통과하면 교체.
    return verifyRealOrderAndRespond(r, user, orderNo, { repurchase: true });
  }

  // ── QA 우회 (QA_MODE=true 배포 한정) — 원장 검증·재사용 차단 없이 테스트 통과 ──
  // 기록에는 전부 is_qa 표기를 남겨 실주문·실리드와 절대 섞이지 않게 한다.
  if (qa) {
    const record = { orderNo, email: user.email, verifiedAt: new Date().toISOString(), isQa: true };
    await r.set(PAID_KEY(user.id), record);
    try {
      const db = createAdminClient();
      const base = {
        name: `[QA테스트] ${user.email || user.id}`,
        contact: user.email || user.id,
        request_type: "qa_test",
        source: `qa_order:${orderNo}`,
        message: `QA 주문번호 인증 — 테스트 세션, 실주문 아님 (userId: ${user.id})`,
        consent: true,
        consent_at: record.verifiedAt,
      };
      const { error } = await db.from("leads").insert({ ...base, is_qa: true });
      // is_qa 컬럼이 아직 없으면 컬럼 없이 저장 (request_type/source 로도 QA 구분 가능)
      if (error) await db.from("leads").insert(base);
    } catch {
      /* CRM 기록 실패는 무시 (Redis 가 원본) */
    }
    console.log(`[order/verify] QA 통과: ${orderNo} (user: ${user.id})`);
    return Response.json({ ok: true, orderNo, isQa: true });
  }

  // 최초 실주문 검증 (2026-07-09) — 시도 제한·원장 조회·재사용 차단·is_paid 기록은
  // verifyRealOrderAndRespond가 재구매 경로와 공유한다.
  return verifyRealOrderAndRespond(r, user, orderNo, { repurchase: false });
}
