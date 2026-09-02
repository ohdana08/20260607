import { Redis } from "@upstash/redis";
import { createHash } from "node:crypto";
import { getPaidRecord } from "./paidAccess";
import { getPresentationPaidRecord } from "./presentationAccess";
import type { PlanDocxSection } from "./docx";
import type { PresentationPack, PresentationReview } from "./presentation";
import type { PlanReviewReport } from "./reviewer";
import type { EvidencePack, StrategyPack } from "./strategy";

let redis: Redis | null = null;
function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  if (!redis) redis = new Redis({ url, token });
  return redis;
}

const EVIDENCE_KEY = (orderNo: string) => `gp:evidence:${orderNo}`;
const STRATEGY_KEY = (orderNo: string) => `gp:strategy:${orderNo}`;
const AUDIT_KEY = (orderNo: string) => `gp:audit:${orderNo}`;
const PRESENTATION_KEY = (orderNo: string) => `gp:presentation:${orderNo}`;
const ARTIFACT_TTL_SECONDS = 60 * 60 * 24 * 45;

async function orderNoForUser(userId: string): Promise<string | null> {
  return (await getPaidRecord(userId))?.orderNo ?? null;
}

async function presentationOrderNoForUser(userId: string): Promise<string | null> {
  return (await getPresentationPaidRecord(userId))?.orderNo ?? null;
}

export async function saveEvidencePack(userId: string, evidence: EvidencePack): Promise<void> {
  const orderNo = await orderNoForUser(userId);
  const store = getRedis();
  if (!orderNo || !store) throw new Error("paid artifact storage unavailable");
  await store.set(EVIDENCE_KEY(orderNo), evidence, { ex: ARTIFACT_TTL_SECONDS });
}

export async function getEvidencePack(userId: string): Promise<EvidencePack | null> {
  const orderNo = await orderNoForUser(userId);
  const store = getRedis();
  if (!orderNo || !store) return null;
  return (await store.get<EvidencePack>(EVIDENCE_KEY(orderNo))) ?? null;
}

export async function saveStrategyPack(userId: string, strategy: StrategyPack): Promise<void> {
  const orderNo = await orderNoForUser(userId);
  const store = getRedis();
  if (!orderNo || !store) throw new Error("paid artifact storage unavailable");
  await store.set(STRATEGY_KEY(orderNo), strategy, { ex: ARTIFACT_TTL_SECONDS });
}

export async function getStrategyPack(userId: string): Promise<StrategyPack | null> {
  const orderNo = await orderNoForUser(userId);
  const store = getRedis();
  if (!orderNo || !store) return null;
  return (await store.get<StrategyPack>(STRATEGY_KEY(orderNo))) ?? null;
}

export function planSectionsDigest(sections: PlanDocxSection[]): string {
  return createHash("sha256")
    .update(JSON.stringify(sections.map((section) => [section.heading, section.content])))
    .digest("hex");
}

export function planArtifactDigest(value: EvidencePack | StrategyPack | PresentationPack | null): string {
  return value
    ? createHash("sha256").update(JSON.stringify(value)).digest("hex")
    : "missing";
}

export interface AuditArtifact {
  report: PlanReviewReport;
  sectionsDigest: string;
  evidenceDigest: string;
  strategyDigest: string;
  reviewedAt: string;
}

export async function saveAuditArtifact(
  userId: string,
  report: PlanReviewReport,
  sections: PlanDocxSection[],
  evidence: EvidencePack | null,
  strategy: StrategyPack | null,
): Promise<void> {
  const orderNo = await orderNoForUser(userId);
  const store = getRedis();
  if (!orderNo || !store) throw new Error("paid artifact storage unavailable");
  const artifact: AuditArtifact = {
    report,
    sectionsDigest: planSectionsDigest(sections),
    evidenceDigest: planArtifactDigest(evidence),
    strategyDigest: planArtifactDigest(strategy),
    reviewedAt: new Date().toISOString(),
  };
  await store.set(AUDIT_KEY(orderNo), artifact, { ex: ARTIFACT_TTL_SECONDS });
}

export async function getAuditArtifact(userId: string): Promise<AuditArtifact | null> {
  const orderNo = await orderNoForUser(userId);
  const store = getRedis();
  if (!orderNo || !store) return null;
  return (await store.get<AuditArtifact>(AUDIT_KEY(orderNo))) ?? null;
}

export interface PresentationArtifact {
  pack: PresentationPack;
  review: PresentationReview;
  sectionsDigest: string;
  evidenceDigest: string;
  strategyDigest: string;
  generatedAt: string;
}

export async function savePresentationArtifact(
  userId: string,
  pack: PresentationPack,
  review: PresentationReview,
  sections: PlanDocxSection[],
  evidence: EvidencePack,
  strategy: StrategyPack,
): Promise<void> {
  const orderNo = await presentationOrderNoForUser(userId);
  const store = getRedis();
  if (!orderNo || !store) throw new Error("paid artifact storage unavailable");
  const artifact: PresentationArtifact = {
    pack,
    review,
    sectionsDigest: planSectionsDigest(sections),
    evidenceDigest: planArtifactDigest(evidence),
    strategyDigest: planArtifactDigest(strategy),
    generatedAt: new Date().toISOString(),
  };
  await store.set(PRESENTATION_KEY(orderNo), artifact, { ex: ARTIFACT_TTL_SECONDS });
}

export async function getPresentationArtifact(userId: string): Promise<PresentationArtifact | null> {
  const orderNo = await presentationOrderNoForUser(userId);
  const store = getRedis();
  if (!orderNo || !store) return null;
  return (await store.get<PresentationArtifact>(PRESENTATION_KEY(orderNo))) ?? null;
}
