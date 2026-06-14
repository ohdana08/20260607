import { getPublicReviews, saveReview } from "@/lib/reviews";
import type { ReviewInput } from "@/lib/reviews";
import { checkRateLimit, tooManyRequests } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 후기 노출 게이트: 후기가 이 개수 미만이면 섹션을 숨긴다. (빈 후기란 = 신뢰 하락)
const MIN_REVIEWS_TO_SHOW = 5;

// GET /api/review → { count, show, reviews }
//   show === true 일 때만 후기 섹션을 노출한다. (후기 5건 이상)
export async function GET() {
  try {
    const { count, reviews } = await getPublicReviews();
    const show = count >= MIN_REVIEWS_TO_SHOW;
    return Response.json({
      count,
      show,
      // 노출 조건을 못 채우면 목록도 비워서 내려보낸다(클라가 못 그리게).
      reviews: show ? reviews : [],
    });
  } catch (err) {
    console.error("[/api/review GET]", err);
    return Response.json({ count: 0, show: false, reviews: [] });
  }
}

// POST /api/review → 후기 저장
export async function POST(req: Request) {
  const rl = await checkRateLimit(req, "review");
  if (!rl.ok) return tooManyRequests(rl.retryAfter);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "요청을 읽지 못했어요." }, { status: 400 });
  }

  const b = (body ?? {}) as Partial<ReviewInput>;
  const rating = Number(b.rating);
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    return Response.json({ ok: false, error: "별점을 선택해 주세요." }, { status: 400 });
  }

  const input: ReviewInput = {
    rating: Math.round(rating),
    tags: Array.isArray(b.tags) ? b.tags.map(String).slice(0, 10) : [],
    comment: typeof b.comment === "string" ? b.comment.slice(0, 500) : "",
    publicConsent: Boolean(b.publicConsent),
    bizField: typeof b.bizField === "string" ? b.bizField.slice(0, 100) : "",
    name: typeof b.name === "string" ? b.name.slice(0, 50) : "",
  };

  const ok = await saveReview(input);
  if (!ok) {
    return Response.json(
      { ok: false, error: "후기 저장에 실패했어요. 잠시 후 다시 시도해 주세요." },
      { status: 502 },
    );
  }
  return Response.json({ ok: true });
}
