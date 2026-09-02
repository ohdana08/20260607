import { Redis } from "@upstash/redis";
import { isMasterCode } from "./access";
import { getAuthedUser, getPaidRecord, type AuthedUser } from "./paidAccess";

let redis: Redis | null = null;
function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  if (!redis) redis = new Redis({ url, token });
  return redis;
}

export const PRESENTATION_PAID_KEY = (userId: string) => `gp:presentation-paid:${userId}`;
export const PRESENTATION_ORDER_TRIES_KEY = (userId: string) =>
  `gp:presentation-ordertries:${userId}`;

export const PRESENTATION_QA_ORDER_RE = /^PT\d{16}$/;
export function isPresentationQaOrder(orderNo: string): boolean {
  return process.env.QA_MODE === "true" && PRESENTATION_QA_ORDER_RE.test(orderNo);
}

export interface PresentationPaidRecord {
  orderNo: string;
  email: string;
  verifiedAt: string;
  isQa?: boolean;
  source: "presentation" | "bundle" | "qa";
  consentedAt?: string;
  usedProgramId?: string;
  usedAt?: string;
}

export async function getPresentationPaidRecord(
  userId: string,
): Promise<PresentationPaidRecord | null> {
  const r = getRedis();
  if (!r) return null;
  return (await r.get<PresentationPaidRecord>(PRESENTATION_PAID_KEY(userId))) ?? null;
}

export async function grantPresentationAccess(args: {
  user: AuthedUser;
  orderNo: string;
  source: PresentationPaidRecord["source"];
  isQa?: boolean;
}): Promise<PresentationPaidRecord | null> {
  const r = getRedis();
  if (!r) return null;
  const existing = await r.get<PresentationPaidRecord>(PRESENTATION_PAID_KEY(args.user.id));
  if (existing?.orderNo === args.orderNo) return existing;
  const record: PresentationPaidRecord = {
    orderNo: args.orderNo,
    email: args.user.email,
    verifiedAt: new Date().toISOString(),
    source: args.source,
    ...(args.isQa ? { isQa: true } : {}),
  };
  await r.set(PRESENTATION_PAID_KEY(args.user.id), record);
  return record;
}

export async function markPresentationServiceConsent(userId: string): Promise<string | null> {
  const r = getRedis();
  if (!r) return null;
  const paid = await r.get<PresentationPaidRecord>(PRESENTATION_PAID_KEY(userId));
  if (!paid) return null;
  if (paid.consentedAt) return paid.consentedAt;
  const consentedAt = new Date().toISOString();
  await r.set(PRESENTATION_PAID_KEY(userId), {
    ...paid,
    consentedAt,
  } satisfies PresentationPaidRecord);
  return consentedAt;
}

export async function markPresentationCreditUsed(
  userId: string,
  programId: string,
): Promise<void> {
  const r = getRedis();
  if (!r || !programId) return;
  const paid = await r.get<PresentationPaidRecord>(PRESENTATION_PAID_KEY(userId));
  if (!paid || paid.usedProgramId) return;
  await r.set(PRESENTATION_PAID_KEY(userId), {
    ...paid,
    usedProgramId: programId,
    usedAt: new Date().toISOString(),
  } satisfies PresentationPaidRecord);
}

export type PresentationAccess =
  | { ok: true; user?: AuthedUser; paid?: PresentationPaidRecord }
  | {
      ok: false;
      reason:
        | "login_required"
        | "word_required"
        | "word_credit_mismatch"
        | "presentation_payment_required"
        | "presentation_credit_used";
    };

export async function checkPresentationAccess(
  req: Request,
  code?: unknown,
  programId?: string,
): Promise<PresentationAccess> {
  if (isMasterCode(code)) return { ok: true };
  const user = await getAuthedUser(req);
  if (!user) return { ok: false, reason: "login_required" };
  const [word, presentation] = await Promise.all([
    getPaidRecord(user.id),
    getPresentationPaidRecord(user.id),
  ]);
  if (!word) return { ok: false, reason: "word_required" };
  if (word.usedProgramId && programId && word.usedProgramId !== programId) {
    return { ok: false, reason: "word_credit_mismatch" };
  }
  if (!presentation) return { ok: false, reason: "presentation_payment_required" };
  if (
    presentation.usedProgramId &&
    programId &&
    presentation.usedProgramId !== programId
  ) {
    return { ok: false, reason: "presentation_credit_used" };
  }
  return { ok: true, user, paid: presentation };
}

export function presentationPaymentRequiredResponse(
  reason: Exclude<PresentationAccess, { ok: true }>["reason"],
): Response {
  const message = {
    login_required: "로그인 후 발표자료 결제를 확인해 주세요.",
    word_required: "최종 사업계획서 Word 상품을 먼저 이용해 주세요.",
    word_credit_mismatch: "이 발표자료는 현재 사업계획서와 연결된 계정에서만 만들 수 있어요.",
    presentation_payment_required:
      "발표자료는 Word 상품과 별도예요. 발표자료 추가 결제 후 주문번호를 연결해 주세요.",
    presentation_credit_used:
      "발표자료 이용권 1건은 사업계획서 1건에 사용돼요. 다른 사업의 발표자료는 새 이용권이 필요해요.",
  }[reason];
  return Response.json({ error: message, reason }, { status: 402 });
}
