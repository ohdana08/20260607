import { Redis } from "@upstash/redis";
import { isMasterCode } from "./access";
import { getGoogleUser } from "@/lib/auth/googleUser";

// ── 유료 전환 파이프 (2026-07-09 ③ 결정: 셀프서비스 주문번호 인증) ─────────
// 코드 체계(ACCESS_CODES)를 대체한다. 흐름:
//   그로블 결제 → 로그인 → 주문번호(18자리) 입력 → is_paid → 초안 기능 오픈
// 저장은 기존 Upstash Redis 재사용 (codebind 와 같은 패턴, DDL 불필요):
//   gp:paid:<userId>       = { orderNo, email, verifiedAt }   ← is_paid 플래그
//   gp:orderused:<orderNo> = userId                            ← 주문번호 재사용 차단
//   gp:ordertries:<userId> = 시도 횟수                          ← 계정당 5회 제한

let redis: Redis | null = null;
function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  if (!redis) redis = new Redis({ url, token });
  return redis;
}

export const PAID_KEY = (userId: string) => `gp:paid:${userId}`;
export const ORDER_USED_KEY = (orderNo: string) => `gp:orderused:${orderNo}`;
export const ORDER_TRIES_KEY = (userId: string) => `gp:ordertries:${userId}`;
// 그로블 웹훅이 등록하는 "실결제 주문번호 원장" — 여기 있어야만 인증 통과 (실제 결제 검증)
export const VALID_ORDER_KEY = (orderNo: string) => `gp:validorder:${orderNo}`;
export const GROBLE_RAW_EVENTS = "gp:groble_raw"; // 최근 웹훅 원본 (스펙 확인/디버깅용)

export interface ValidOrder {
  orderNo: string;
  registeredAt: string;
  via: "webhook" | "manual"; // manual = 마스터코드로 수동 등록 (판매 리스트 대조 후)
  status: "valid" | "cancelled";
  productId?: string; // 그로블 content.id (2026-07-14 재구매) — 없으면(구형/미확인) 상품 필터는 통과시킨다
  raw?: unknown; // 웹훅 페이로드 요약
}

export const MAX_ORDER_TRIES = 5; // 계정당 주문번호 입력 시도 제한
export const ORDER_NO_RE = /^\d{18}$/; // 그로블 주문번호 형식 (예: 202607090949499786)

// ── QA 우회 (2026-07-12) — 결제 없이 유료 구간 전체 테스트용 ──────────────
// 환경변수 QA_MODE=true 인 배포에서만 "QA"+숫자 16자리(총 18자) 주문번호가 통과한다.
// 프로덕션은 QA_MODE 미설정(기본) → 무조건 거절. 하드코딩 마스터키 없음 — env 토글이 전부.
export const QA_ORDER_RE = /^QA\d{16}$/;
export function isQaOrder(orderNo: string): boolean {
  return process.env.QA_MODE === "true" && QA_ORDER_RE.test(orderNo);
}

export interface AuthedUser {
  id: string;
  email: string;
}

// Authorization: Bearer <supabase JWT> 를 통합 회원 시스템에 물어봐 검증한다.
// anon 키로 /auth/v1/user 를 호출하면 토큰의 유효성·만료를 서버가 판정해 준다 (service_role 불필요).
export async function getAuthedUser(req: Request): Promise<AuthedUser | null> {
  return getGoogleUser(req);
}

export interface PaidRecord {
  orderNo: string;
  email: string;
  verifiedAt: string;
  isQa?: boolean; // QA 우회로 인증된 테스트 세션 — 실주문과 구분
  // 이용권 소진(2026-07-13): 첫 초안 생성 시점에 해당 공고에 바인딩.
  // 같은 공고는 계속 허용(인터뷰 이어가기·docx 재다운로드·수정 1회 무료), 다른 공고는 추가 결제.
  usedProgramId?: string;
  usedAt?: string;
}

// 이용권 소진 — 첫 draft 호출 시 공고 1건에 바인딩 (이미 바인딩돼 있으면 유지)
export async function markCreditUsed(userId: string, programId: string): Promise<void> {
  const r = getRedis();
  if (!r || !programId) return;
  const paid = await r.get<PaidRecord>(PAID_KEY(userId));
  if (!paid || paid.usedProgramId) return; // 미결제 또는 이미 바인딩됨
  await r.set(PAID_KEY(userId), {
    ...paid,
    usedProgramId: programId,
    usedAt: new Date().toISOString(),
  });
}

export async function getPaidRecord(userId: string): Promise<PaidRecord | null> {
  const r = getRedis();
  if (!r) return null;
  return (await r.get<PaidRecord>(PAID_KEY(userId))) ?? null;
}

export type DraftAccess =
  | { ok: true; user?: AuthedUser }
  | { ok: false; reason: "login_required" | "payment_required" | "credit_used" };

// 초안(유료) 기능 관문 — 다음 중 하나면 통과:
//   1) 마스터 코드 (운영자 테스트용, 기존과 동일)
//   2) 로그인 + 주문번호 인증 완료(is_paid) + 이용권 미소진 또는 같은 공고 (2026-07-13)
// 가격 정책: 이용권 1건 = 사업계획서 초안 1건. 다른 공고는 추가 결제 필요.
export async function checkDraftAccess(
  req: Request,
  code?: unknown,
  programId?: string,
): Promise<DraftAccess> {
  if (isMasterCode(code)) return { ok: true };
  const user = await getAuthedUser(req);
  if (!user) return { ok: false, reason: "login_required" };
  const paid = await getPaidRecord(user.id);
  if (!paid) return { ok: false, reason: "payment_required" };
  if (paid.usedProgramId && programId && paid.usedProgramId !== programId) {
    return { ok: false, reason: "credit_used" };
  }
  return { ok: true, user };
}

export function paymentRequiredResponse(
  reason: "login_required" | "payment_required" | "credit_used",
): Response {
  return Response.json(
    {
      error:
        reason === "login_required"
          ? "로그인이 필요해요. 로그인 후 다시 시도해 주세요."
          : reason === "credit_used"
            ? "이용권 1건은 사업계획서 초안 1건에 사용돼요. 이미 다른 공고의 초안에 사용하셔서, 이 공고의 초안을 만들려면 추가 이용권 결제가 필요해요."
            : "결제 확인이 필요해요. [결제 확인] 메뉴에서 그로블 주문번호를 입력해 주세요.",
      reason,
    },
    { status: 402 },
  );
}
