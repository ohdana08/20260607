import { Redis } from "@upstash/redis";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, tooManyRequests } from "@/lib/ratelimit";
import { isBundleProductId, isPlanProductId } from "@/lib/config";
import {
  GROBLE_RAW_EVENTS,
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
  type PaidRecord,
  type ValidOrder,
} from "@/lib/plan/paidAccess";
import { grantPresentationAccess } from "@/lib/plan/presentationAccess";

interface RawPaymentEvent {
  saved: Record<string, unknown>;
  event: Record<string, unknown>;
  object: Record<string, unknown>;
}

function readRawPaymentEvent(raw: unknown): RawPaymentEvent | null {
  let envelope: unknown = raw;
  if (typeof raw === "string") {
    try {
      envelope = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!envelope || typeof envelope !== "object") return null;
  const saved = envelope as Record<string, unknown>;
  const payload = saved.payload;
  if (!payload || typeof payload !== "object") return null;
  const event = payload as Record<string, unknown>;
  const object = (event.data as Record<string, unknown> | undefined)?.object;
  if (!object || typeof object !== "object") return null;
  return { saved, event, object: object as Record<string, unknown> };
}

function rawOrderNo(item: RawPaymentEvent): string {
  return String(item.object.merchantUid ?? item.object.merchant_uid ?? "").replace(/\D/g, "");
}

function rawBuyerEmail(item: RawPaymentEvent): string | null {
  const buyer = item.object.buyer;
  if (typeof buyer === "string" && buyer.includes("@")) return buyer.trim().toLowerCase();
  if (!buyer || typeof buyer !== "object") return null;
  const record = buyer as Record<string, unknown>;
  const direct = [record.email, record.emailAddress, record.contactEmail, record.userEmail];
  for (const value of direct) {
    if (typeof value === "string" && value.includes("@")) return value.trim().toLowerCase();
  }
  for (const [key, value] of Object.entries(record)) {
    if (key.toLowerCase().includes("email") && typeof value === "string" && value.includes("@")) {
      return value.trim().toLowerCase();
    }
  }
  return null;
}

// 2026-08-03 이전 파서는 18자리만 인정해, 실제 19자리 결제 웹훅을 원본 목록에는
// 보관하면서 유효 주문 원장에는 넣지 못했다. 사용자가 해당 번호를 처음 인증할 때
// 서명된 웹훅 원본에서 결제완료 건을 찾아 한 번만 복구한다.
async function recoverOrderFromRawEvents(r: Redis, orderNo: string): Promise<ValidOrder | null> {
  const rawEvents = await r.lrange<unknown>(GROBLE_RAW_EVENTS, 0, 99);
  for (const raw of rawEvents) {
    const item = readRawPaymentEvent(raw);
    if (!item || rawOrderNo(item) !== orderNo) continue;

    // 목록은 최신순이다. 같은 주문의 가장 최근 상태가 취소면 절대 되살리지 않는다.
    const type = String(item.event.type ?? "").toLowerCase();
    const cancelled = type.includes("cancel") || type.includes("refund");
    const completed = type.includes("completed");
    if (!cancelled && !completed) continue;

    const content = item.object.content as Record<string, unknown> | undefined;
    const productId = typeof content?.id === "string" ? content.id : undefined;
    // 자동 복구는 현재 판매 상품임이 확인된 원본만 허용한다.
    if (!cancelled && !isPlanProductId(productId)) return null;

    const recovered: ValidOrder = {
      orderNo,
      registeredAt: typeof item.saved.at === "string" ? item.saved.at : new Date().toISOString(),
      via: "webhook",
      status: cancelled ? "cancelled" : "valid",
      ...(productId ? { productId } : {}),
    };
    await r.set(VALID_ORDER_KEY(orderNo), recovered);
    return recovered;
  }
  return null;
}

// 로그인 이메일과 그로블 구매 이메일이 같으면, 최근 미사용 결제를 주문번호 입력 없이 연결한다.
// 가장 최근 이벤트가 취소/환불인 주문은 이전 완료 이벤트까지 거슬러 올라가지 않는다.
async function claimRecentOrderByEmail(
  r: Redis,
  user: AuthedUser,
): Promise<PaidRecord | null> {
  const email = user.email.trim().toLowerCase();
  if (!email) return null;
  const rawEvents = await r.lrange<unknown>(GROBLE_RAW_EVENTS, 0, 99);
  const seenOrders = new Set<string>();
  for (const raw of rawEvents) {
    const item = readRawPaymentEvent(raw);
    if (!item) continue;
    const orderNo = rawOrderNo(item);
    if (!ORDER_NO_RE.test(orderNo) || seenOrders.has(orderNo)) continue;
    seenOrders.add(orderNo);

    const type = String(item.event.type ?? "").toLowerCase();
    if (type.includes("cancel") || type.includes("refund") || !type.includes("completed")) continue;
    if (rawBuyerEmail(item) !== email) continue;
    const content = item.object.content as Record<string, unknown> | undefined;
    const productId = typeof content?.id === "string" ? content.id : undefined;
    if (!isPlanProductId(productId)) continue;

    const bound = await r.set(ORDER_USED_KEY(orderNo), user.id, { nx: true });
    if (bound === null && (await r.get<string>(ORDER_USED_KEY(orderNo))) !== user.id) continue;

    const registeredAt =
      typeof item.saved.at === "string" ? item.saved.at : new Date().toISOString();
    await r.set(VALID_ORDER_KEY(orderNo), {
      orderNo,
      registeredAt,
      via: "webhook",
      status: "valid",
      productId,
    } satisfies ValidOrder);
    const record: PaidRecord = {
      orderNo,
      email: user.email,
      verifiedAt: new Date().toISOString(),
    };
    await r.set(PAID_KEY(user.id), record);
    if (isBundleProductId(productId)) {
      await grantPresentationAccess({ user, orderNo, source: "bundle" });
    }
    console.log(`[order/verify] 결제 이메일 자동 연결: ${orderNo} (user: ${user.id})`);
    return record;
  }
  return null;
}

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
  //   존재하지 않는 18~19자리는 여기서 거부된다. 결제 취소된 주문번호도 거부.
  let valid = await r.get<ValidOrder>(VALID_ORDER_KEY(orderNo));
  if (!valid) valid = await recoverOrderFromRawEvents(r, orderNo);
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

  // 발표자료 단품 주문으로 더 비싼 Word 상품이 열리지 않도록 최초·재구매 모두 상품을 분리한다.
  // productId가 없는 과거 수동·구형 주문만 기존 고객 보호를 위해 통과시킨다.
  if (valid.productId && !isPlanProductId(valid.productId)) {
    return Response.json(
      { ok: false, error: "사업계획서 Word 또는 묶음 상품의 주문번호가 아니에요." },
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
  if (isBundleProductId(valid.productId)) {
    await grantPresentationAccess({ user, orderNo, source: "bundle" });
  }

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
  let paid = await getPaidRecord(user.id);
  if (!paid) {
    const r = getRedis();
    if (r) paid = await claimRecentOrderByEmail(r, user);
  }
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
      { ok: false, error: "주문번호 형식이 아니에요. 그로블 주문내역의 18~19자리 숫자를 입력해 주세요." },
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
