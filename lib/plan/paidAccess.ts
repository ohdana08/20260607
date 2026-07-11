import { Redis } from "@upstash/redis";
import { isMasterCode } from "./access";
import { AUTH_URL, AUTH_ANON_KEY } from "@/lib/auth/config";

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
  raw?: unknown; // 웹훅 페이로드 요약
}

export const MAX_ORDER_TRIES = 5; // 계정당 주문번호 입력 시도 제한
export const ORDER_NO_RE = /^\d{18}$/; // 그로블 주문번호 형식 (예: 202607090949499786)

export interface AuthedUser {
  id: string;
  email: string;
}

// Authorization: Bearer <supabase JWT> 를 통합 회원 시스템에 물어봐 검증한다.
// anon 키로 /auth/v1/user 를 호출하면 토큰의 유효성·만료를 서버가 판정해 준다 (service_role 불필요).
export async function getAuthedUser(req: Request): Promise<AuthedUser | null> {
  const h = req.headers.get("authorization") ?? "";
  const token = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  if (!token) return null;
  try {
    const res = await fetch(`${AUTH_URL}/auth/v1/user`, {
      headers: { apikey: AUTH_ANON_KEY, Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const u = (await res.json()) as { id?: string; email?: string };
    return u?.id ? { id: u.id, email: u.email ?? "" } : null;
  } catch {
    return null;
  }
}

export interface PaidRecord {
  orderNo: string;
  email: string;
  verifiedAt: string;
}

export async function getPaidRecord(userId: string): Promise<PaidRecord | null> {
  const r = getRedis();
  if (!r) return null;
  return (await r.get<PaidRecord>(PAID_KEY(userId))) ?? null;
}

export type DraftAccess =
  | { ok: true; user?: AuthedUser }
  | { ok: false; reason: "login_required" | "payment_required" };

// 초안(유료) 기능 관문 — 다음 중 하나면 통과:
//   1) 마스터 코드 (운영자 테스트용, 기존과 동일)
//   2) 로그인 + 주문번호 인증 완료(is_paid)
export async function checkDraftAccess(req: Request, code?: unknown): Promise<DraftAccess> {
  if (isMasterCode(code)) return { ok: true };
  const user = await getAuthedUser(req);
  if (!user) return { ok: false, reason: "login_required" };
  const paid = await getPaidRecord(user.id);
  return paid ? { ok: true, user } : { ok: false, reason: "payment_required" };
}

export function paymentRequiredResponse(reason: "login_required" | "payment_required"): Response {
  return Response.json(
    {
      error:
        reason === "login_required"
          ? "로그인이 필요해요. 로그인 후 다시 시도해 주세요."
          : "결제 확인이 필요해요. [결제 확인] 메뉴에서 그로블 주문번호를 입력해 주세요.",
      reason,
    },
    { status: 402 },
  );
}
