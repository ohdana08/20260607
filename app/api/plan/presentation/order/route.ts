import { Redis } from "@upstash/redis";
import {
  GROBLE_BUNDLE_CHECKOUT_URL,
  GROBLE_BUNDLE_PRODUCT_ID,
  GROBLE_PRESENTATION_CHECKOUT_URL,
  GROBLE_PRESENTATION_PRODUCT_ID,
  isBundleProductId,
  isPresentationProductId,
} from "@/lib/config";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, tooManyRequests } from "@/lib/ratelimit";
import { isMasterCode } from "@/lib/plan/access";
import {
  getAuthedUser,
  getPaidRecord,
  MAX_ORDER_TRIES,
  ORDER_NO_RE,
  ORDER_USED_KEY,
  VALID_ORDER_KEY,
  type ValidOrder,
} from "@/lib/plan/paidAccess";
import {
  getPresentationPaidRecord,
  grantPresentationAccess,
  isPresentationQaOrder,
  PRESENTATION_ORDER_TRIES_KEY,
} from "@/lib/plan/presentationAccess";
import { getPresentationRevisionStatus } from "@/lib/plan/presentationRevisions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

function productConfigured(): boolean {
  return Boolean(GROBLE_PRESENTATION_PRODUCT_ID && GROBLE_PRESENTATION_CHECKOUT_URL);
}

function bundleConfigured(): boolean {
  return Boolean(GROBLE_BUNDLE_PRODUCT_ID && GROBLE_BUNDLE_CHECKOUT_URL);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (isMasterCode(url.searchParams.get("code"))) {
    return Response.json({
      paid: true,
      loggedIn: false,
      configured: productConfigured(),
      bundleConfigured: bundleConfigured(),
      source: "qa",
      revision: {
        max: 2,
        used: 0,
        remaining: 2,
        deliveredAt: null,
        expiresAt: null,
        expired: false,
      },
    });
  }
  const user = await getAuthedUser(req);
  if (!user) {
    return Response.json({
      paid: false,
      loggedIn: false,
      configured: productConfigured(),
      bundleConfigured: bundleConfigured(),
    });
  }
  const [word, paid, revision] = await Promise.all([
    getPaidRecord(user.id),
    getPresentationPaidRecord(user.id),
    getPresentationRevisionStatus(user.id),
  ]);
  return Response.json(
    {
      paid: Boolean(paid),
      loggedIn: true,
      wordPaid: Boolean(word),
      configured: productConfigured(),
      bundleConfigured: bundleConfigured(),
      orderNo: paid?.orderNo ?? null,
      usedProgramId: paid?.usedProgramId ?? null,
      source: paid?.source ?? null,
      consentedAt: paid?.consentedAt ?? null,
      revision,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(req: Request) {
  const rl = await checkRateLimit(req, "verify");
  if (!rl.ok) return tooManyRequests(rl.retryAfter);
  const user = await getAuthedUser(req);
  if (!user) return Response.json({ ok: false, error: "로그인이 필요해요." }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "요청을 읽지 못했어요." }, { status: 400 });
  }
  const cleaned = String((body as { orderNo?: unknown })?.orderNo ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  const qa = isPresentationQaOrder(cleaned);
  const orderNo = qa ? cleaned : cleaned.replace(/\D/g, "");
  if (!qa && !ORDER_NO_RE.test(orderNo)) {
    return Response.json(
      { ok: false, error: "그로블 주문내역의 숫자 18~19자리를 입력해 주세요." },
      { status: 400 },
    );
  }
  const word = await getPaidRecord(user.id);
  if (!word) {
    return Response.json(
      { ok: false, error: "사업계획서 Word 상품을 먼저 이용한 계정에서 연결해 주세요." },
      { status: 409 },
    );
  }
  const r = getRedis();
  if (!r) return Response.json({ ok: false, error: "결제 저장소를 확인할 수 없어요." }, { status: 503 });

  const existing = await getPresentationPaidRecord(user.id);
  if (existing?.orderNo === orderNo) {
    return Response.json({ ok: true, orderNo, isQa: Boolean(existing.isQa), source: existing.source });
  }

  if (qa) {
    const granted = await grantPresentationAccess({ user, orderNo, source: "qa", isQa: true });
    return Response.json({ ok: Boolean(granted), orderNo, isQa: true, source: "qa" });
  }
  if (!GROBLE_PRESENTATION_PRODUCT_ID && !GROBLE_BUNDLE_PRODUCT_ID) {
    return Response.json(
      { ok: false, error: "발표자료 결제 상품 연결이 아직 완료되지 않았어요." },
      { status: 503 },
    );
  }

  const tries = await r.incr(PRESENTATION_ORDER_TRIES_KEY(user.id));
  if (tries > MAX_ORDER_TRIES) {
    return Response.json(
      { ok: false, error: "입력 시도가 5회를 넘었어요. 문의하기로 확인해 주세요." },
      { status: 429 },
    );
  }
  const valid = await r.get<ValidOrder>(VALID_ORDER_KEY(orderNo));
  if (!valid || valid.status !== "valid") {
    return Response.json(
      {
        ok: false,
        error:
          valid?.status === "cancelled"
            ? "취소된 주문번호예요."
            : "그로블 결제 내역에서 확인되지 않아요. 결제 후 1~2분 뒤 다시 시도해 주세요.",
      },
      { status: 404 },
    );
  }
  if (!isPresentationProductId(valid.productId)) {
    return Response.json(
      { ok: false, error: "발표자료 단품 또는 Word+발표자료 묶음 상품의 주문번호가 아니에요." },
      { status: 400 },
    );
  }

  const bound = await r.set(ORDER_USED_KEY(orderNo), user.id, { nx: true });
  if (bound === null && (await r.get<string>(ORDER_USED_KEY(orderNo))) !== user.id) {
    return Response.json(
      { ok: false, error: "이미 다른 계정에 연결된 주문번호예요." },
      { status: 409 },
    );
  }
  const source = isBundleProductId(valid.productId) ? "bundle" : "presentation";
  const granted = await grantPresentationAccess({ user, orderNo, source });
  if (!granted) return Response.json({ ok: false, error: "권한 저장에 실패했어요." }, { status: 503 });

  try {
    const db = createAdminClient();
    await db.from("leads").insert({
      name: `[발표자료 ${source === "bundle" ? "묶음" : "추가결제"}] ${user.email || user.id}`,
      contact: user.email || user.id,
      request_type: "product_b2c",
      status: "converted",
      source: `groble_presentation_order:${orderNo}`,
      message: `발표자료 주문번호 인증 (userId: ${user.id}, source: ${source})`,
      consent: true,
      consent_at: granted.verifiedAt,
    });
  } catch {
    /* Redis 권한이 원본이며 CRM 기록은 best effort */
  }

  return Response.json({ ok: true, orderNo, source });
}
