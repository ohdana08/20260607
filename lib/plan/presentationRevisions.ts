import { Redis } from "@upstash/redis";
import { getPresentationPaidRecord } from "./presentationAccess";
import {
  PRESENTATION_MAX_REVISIONS,
  PRESENTATION_REVISION_WINDOW_DAYS,
} from "./presentationPolicy";

let redis: Redis | null = null;
function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  if (!redis) redis = new Redis({ url, token });
  return redis;
}

const DELIVERY_KEY = (orderNo: string) => `gp:presentation-delivery:${orderNo}`;
const REVISION_COUNT_KEY = (orderNo: string) => `gp:presentation-revision-count:${orderNo}`;

interface DeliveryRecord {
  deliveredAt: string;
  expiresAt: string;
}

export interface PresentationRevisionStatus {
  max: number;
  used: number;
  remaining: number;
  deliveredAt: string | null;
  expiresAt: string | null;
  expired: boolean;
}

function emptyStatus(): PresentationRevisionStatus {
  return {
    max: PRESENTATION_MAX_REVISIONS,
    used: 0,
    remaining: PRESENTATION_MAX_REVISIONS,
    deliveredAt: null,
    expiresAt: null,
    expired: false,
  };
}

export async function getPresentationRevisionStatus(
  userId: string,
): Promise<PresentationRevisionStatus> {
  const paid = await getPresentationPaidRecord(userId);
  const r = getRedis();
  if (!paid || !r) return emptyStatus();
  const [delivery, rawUsed] = await Promise.all([
    r.get<DeliveryRecord>(DELIVERY_KEY(paid.orderNo)),
    r.get<number>(REVISION_COUNT_KEY(paid.orderNo)),
  ]);
  const used = Math.max(0, Math.min(PRESENTATION_MAX_REVISIONS, Number(rawUsed ?? 0)));
  const expired = Boolean(delivery && Date.parse(delivery.expiresAt) < Date.now());
  return {
    max: PRESENTATION_MAX_REVISIONS,
    used,
    remaining: expired ? 0 : Math.max(0, PRESENTATION_MAX_REVISIONS - used),
    deliveredAt: delivery?.deliveredAt ?? null,
    expiresAt: delivery?.expiresAt ?? null,
    expired,
  };
}

export async function markFirstPresentationDelivery(
  userId: string,
): Promise<PresentationRevisionStatus> {
  const paid = await getPresentationPaidRecord(userId);
  const r = getRedis();
  if (!paid || !r) return emptyStatus();
  const deliveredAt = new Date();
  const expiresAt = new Date(
    deliveredAt.getTime() + PRESENTATION_REVISION_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );
  await r.set(
    DELIVERY_KEY(paid.orderNo),
    { deliveredAt: deliveredAt.toISOString(), expiresAt: expiresAt.toISOString() } satisfies DeliveryRecord,
    { nx: true },
  );
  return getPresentationRevisionStatus(userId);
}

export interface PresentationRevisionReservation {
  ok: boolean;
  counted: boolean;
  status: PresentationRevisionStatus;
  rollback: () => Promise<void>;
}

export async function reservePresentationRevision(
  userId?: string,
): Promise<PresentationRevisionReservation> {
  if (!userId) return { ok: true, counted: false, status: emptyStatus(), rollback: async () => {} };
  const paid = await getPresentationPaidRecord(userId);
  const r = getRedis();
  if (!paid || !r) return { ok: false, counted: false, status: emptyStatus(), rollback: async () => {} };
  const before = await getPresentationRevisionStatus(userId);
  if (!before.deliveredAt) {
    return { ok: true, counted: false, status: before, rollback: async () => {} };
  }
  if (before.expired || before.remaining <= 0) {
    return { ok: false, counted: false, status: before, rollback: async () => {} };
  }
  const used = await r.incr(REVISION_COUNT_KEY(paid.orderNo));
  if (used > PRESENTATION_MAX_REVISIONS) {
    await r.decr(REVISION_COUNT_KEY(paid.orderNo));
    return {
      ok: false,
      counted: false,
      status: await getPresentationRevisionStatus(userId),
      rollback: async () => {},
    };
  }
  let settled = false;
  return {
    ok: true,
    counted: true,
    status: await getPresentationRevisionStatus(userId),
    async rollback() {
      if (settled) return;
      settled = true;
      await r.decr(REVISION_COUNT_KEY(paid.orderNo));
    },
  };
}

export function presentationRevisionUnavailableResponse(
  status: PresentationRevisionStatus,
): Response {
  return Response.json(
    {
      error: status.expired
        ? "발표자료 수정 가능 기간이 끝났어요. 새 발표자료 이용권으로 진행해 주세요."
        : "포함된 발표자료 묶음 수정 2회를 모두 사용했어요. 추가 수정은 새 이용권이 필요해요.",
      reason: "presentation_revision_limit",
      revision: status,
    },
    { status: 409 },
  );
}
