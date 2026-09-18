import { createRevisionService } from "./revisionService";
import type { RevisionStatus, RevisionReservation } from "./revisionTypes";
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

const service = createRevisionService(
  {
    max: PLAN_MAX_REVISIONS,
    windowDays: PLAN_REVISION_WINDOW_DAYS,
    deliveryKey: (orderNo) => `gp:delivery:${orderNo}`,
    countKey: (orderNo) => `gp:revision-count:${orderNo}`,
  },
  { getPaidRecord, getStore: getRedis },
);

export type { RevisionStatus, RevisionReservation } from "./revisionTypes";

export function getRevisionStatus(
  userId: string,
  admin = false,
): Promise<RevisionStatus> {
  return service.getStatus(userId, admin);
}

export function markFirstFinalDelivery(
  userId: string,
  admin = false,
): Promise<RevisionStatus> {
  return service.markFirstDelivery(userId, admin);
}

export function reserveRevisionRound(
  userId?: string,
  admin = false,
): Promise<RevisionReservation> {
  return service.reserve(userId, admin);
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
