import { createRevisionService } from "./revisionService";
import type {
  RevisionStatus as PresentationRevisionStatus,
  RevisionReservation as PresentationRevisionReservation,
} from "./revisionTypes";
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

const service = createRevisionService(
  {
    max: PRESENTATION_MAX_REVISIONS,
    windowDays: PRESENTATION_REVISION_WINDOW_DAYS,
    deliveryKey: (orderNo) => `gp:presentation-delivery:${orderNo}`,
    countKey: (orderNo) => `gp:presentation-revision-count:${orderNo}`,
  },
  { getPaidRecord: getPresentationPaidRecord, getStore: getRedis },
);

export type {
  RevisionStatus as PresentationRevisionStatus,
  RevisionReservation as PresentationRevisionReservation,
} from "./revisionTypes";

export function getPresentationRevisionStatus(
  userId: string,
  admin = false,
): Promise<PresentationRevisionStatus> {
  return service.getStatus(userId, admin);
}

export function markFirstPresentationDelivery(
  userId: string,
  admin = false,
): Promise<PresentationRevisionStatus> {
  return service.markFirstDelivery(userId, admin);
}

export function reservePresentationRevision(
  userId?: string,
  admin = false,
): Promise<PresentationRevisionReservation> {
  return service.reserve(userId, admin);
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
