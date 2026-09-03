import { Redis } from "@upstash/redis";
import { getPaidRecord } from "./paidAccess";
import { PLAN_MAX_REVISIONS, PLAN_REVISION_WINDOW_DAYS } from "./productPolicy";

let redis: Redis | null = null;
function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  if (!redis) redis = new Redis({ url, token });
  return redis;
}

const DELIVERY_KEY = (orderNo: string) => `gp:delivery:${orderNo}`;
const REVISION_COUNT_KEY = (orderNo: string) => `gp:revision-count:${orderNo}`;

interface DeliveryRecord {
  deliveredAt: string;
  expiresAt: string;
}

export interface RevisionStatus {
  max: number;
  used: number;
  remaining: number;
  deliveredAt: string | null;
  expiresAt: string | null;
  expired: boolean;
}

function emptyStatus(): RevisionStatus {
  return {
    max: PLAN_MAX_REVISIONS,
    used: 0,
    remaining: PLAN_MAX_REVISIONS,
    deliveredAt: null,
    expiresAt: null,
    expired: false,
  };
}

export async function getRevisionStatus(userId: string, admin = false): Promise<RevisionStatus> {
  if (admin) return emptyStatus();
  const paid = await getPaidRecord(userId);
  const r = getRedis();
  if (!paid || !r) return emptyStatus();
  const [delivery, rawUsed] = await Promise.all([
    r.get<DeliveryRecord>(DELIVERY_KEY(paid.orderNo)),
    r.get<number>(REVISION_COUNT_KEY(paid.orderNo)),
  ]);
  const used = Math.max(0, Math.min(PLAN_MAX_REVISIONS, Number(rawUsed ?? 0)));
  const expired = Boolean(delivery && Date.parse(delivery.expiresAt) < Date.now());
  return {
    max: PLAN_MAX_REVISIONS,
    used,
    remaining: expired ? 0 : Math.max(0, PLAN_MAX_REVISIONS - used),
    deliveredAt: delivery?.deliveredAt ?? null,
    expiresAt: delivery?.expiresAt ?? null,
    expired,
  };
}

export async function markFirstFinalDelivery(userId: string, admin = false): Promise<RevisionStatus> {
  if (admin) return emptyStatus();
  const paid = await getPaidRecord(userId);
  const r = getRedis();
  if (!paid || !r) return emptyStatus();
  const deliveredAt = new Date();
  const expiresAt = new Date(deliveredAt.getTime() + PLAN_REVISION_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  await r.set(
    DELIVERY_KEY(paid.orderNo),
    { deliveredAt: deliveredAt.toISOString(), expiresAt: expiresAt.toISOString() } satisfies DeliveryRecord,
    { nx: true },
  );
  return getRevisionStatus(userId);
}

export interface RevisionReservation {
  ok: boolean;
  counted: boolean;
  status: RevisionStatus;
  rollback: () => Promise<void>;
}

// 첫 최종본 전의 근거 보완은 수정권을 차감하지 않는다. 첫 다운로드 뒤 묶음 수정만 원자적으로 1회 차감한다.
export async function reserveRevisionRound(userId?: string, admin = false): Promise<RevisionReservation> {
  if (admin) return { ok: true, counted: false, status: emptyStatus(), rollback: async () => {} };
  if (!userId) return { ok: true, counted: false, status: emptyStatus(), rollback: async () => {} };
  const paid = await getPaidRecord(userId);
  const r = getRedis();
  if (!paid || !r) return { ok: false, counted: false, status: emptyStatus(), rollback: async () => {} };
  const before = await getRevisionStatus(userId);
  if (!before.deliveredAt) {
    return { ok: true, counted: false, status: before, rollback: async () => {} };
  }
  if (before.expired || before.remaining <= 0) {
    return { ok: false, counted: false, status: before, rollback: async () => {} };
  }
  const used = await r.incr(REVISION_COUNT_KEY(paid.orderNo));
  if (used > PLAN_MAX_REVISIONS) {
    await r.decr(REVISION_COUNT_KEY(paid.orderNo));
    return { ok: false, counted: false, status: await getRevisionStatus(userId), rollback: async () => {} };
  }
  let settled = false;
  return {
    ok: true,
    counted: true,
    status: await getRevisionStatus(userId),
    async rollback() {
      if (settled) return;
      settled = true;
      await r.decr(REVISION_COUNT_KEY(paid.orderNo));
    },
  };
}

export function revisionUnavailableResponse(status: RevisionStatus): Response {
  return Response.json(
    {
      error: status.expired
        ? "수정 가능 기간이 끝났어요. 새로운 공고·양식 작성은 새 이용권으로 진행해 주세요."
        : "포함된 묶음 수정 3회를 모두 사용했어요. 추가 수정이나 전면 재작성은 새 이용권이 필요해요.",
      reason: "revision_limit",
      revision: status,
    },
    { status: 409 },
  );
}
