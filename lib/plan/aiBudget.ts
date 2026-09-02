import { Redis } from "@upstash/redis";
import type { LlmUsage, Provider, Tier } from "@/lib/llm/provider";
import { resolveModel } from "@/lib/llm/provider";
import { getPaidRecord } from "./paidAccess";
import { getPresentationPaidRecord } from "./presentationAccess";
import { configuredPlanAiHardCapKrw } from "./productPolicy";
import { configuredPresentationAiHardCapKrw } from "./presentationPolicy";

const USD_TO_KRW_PLANNING = 1500;

let redis: Redis | null = null;
function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  if (!redis) redis = new Redis({ url, token });
  return redis;
}

const AI_SPEND_KEY = (orderNo: string) => `gp:ai-spend-krw:${orderNo}`;
const AI_LOG_KEY = (orderNo: string) => `gp:ai-usage:${orderNo}`;

interface ModelPrice {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  search: number;
}

function priceForModel(model: string): ModelPrice {
  if (model.includes("haiku")) {
    return { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1, search: 0.01 };
  }
  if (model.includes("sonnet")) {
    return { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3, search: 0.01 };
  }
  if (model.includes("opus")) {
    return { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5, search: 0.01 };
  }
  if (model.includes("mini")) {
    return { input: 0.15, output: 0.6, cacheWrite: 0.15, cacheRead: 0.075, search: 0 };
  }
  return { input: 2.5, output: 10, cacheWrite: 2.5, cacheRead: 1.25, search: 0 };
}

export function estimateUsageKrw(usage: LlmUsage): number {
  const p = priceForModel(usage.model);
  const usd =
    ((usage.inputTokens ?? 0) * p.input +
      (usage.outputTokens ?? 0) * p.output +
      (usage.cacheCreationInputTokens ?? 0) * p.cacheWrite +
      (usage.cacheReadInputTokens ?? 0) * p.cacheRead) /
      1_000_000 +
    (usage.webSearchRequests ?? 0) * p.search;
  return Math.max(1, Math.ceil(usd * USD_TO_KRW_PLANNING));
}

function estimateReservationKrw(
  model: string,
  estimatedInputTokens: number,
  maxOutputTokens: number,
  maxWebSearches: number,
): number {
  const p = priceForModel(model);
  const usd =
    (estimatedInputTokens * p.input + maxOutputTokens * p.output) / 1_000_000 +
    maxWebSearches * p.search;
  return Math.max(20, Math.ceil(usd * USD_TO_KRW_PLANNING * 1.2));
}

export interface AiBudgetReservation {
  ok: boolean;
  spentKrw: number;
  hardCapKrw: number;
  estimatedKrw: number;
  model: string;
  complete: (usage: LlmUsage) => Promise<void>;
  release: () => Promise<void>;
}

interface ReserveAiCallArgs {
  userId?: string;
  stage: string;
  provider: Provider;
  tier: Tier;
  estimatedInputTokens: number;
  maxOutputTokens: number;
  maxWebSearches?: number;
}

async function reserveOrderAiCall(
  args: ReserveAiCallArgs,
  orderNo: string | null,
  hardCapKrw: number,
): Promise<AiBudgetReservation> {
  const model = resolveModel(args.provider, args.tier);
  const noop: AiBudgetReservation = {
    ok: true,
    spentKrw: 0,
    hardCapKrw,
    estimatedKrw: 0,
    model,
    complete: async () => {},
    release: async () => {},
  };
  // 마스터코드 호출은 주문 원가와 섞지 않는다.
  if (!args.userId) return noop;
  const r = getRedis();
  if (!orderNo || !r) return { ...noop, ok: false };

  const estimatedKrw = estimateReservationKrw(
    model,
    Math.max(0, args.estimatedInputTokens),
    Math.max(1, args.maxOutputTokens),
    Math.max(0, args.maxWebSearches ?? 0),
  );
  const allocated = await r.incrby(AI_SPEND_KEY(orderNo), estimatedKrw);
  if (allocated > hardCapKrw) {
    await r.incrby(AI_SPEND_KEY(orderNo), -estimatedKrw);
    return {
      ...noop,
      ok: false,
      spentKrw: Math.max(0, allocated - estimatedKrw),
      hardCapKrw,
      estimatedKrw,
    };
  }

  let settled = false;
  return {
    ok: true,
    spentKrw: allocated,
    hardCapKrw,
    estimatedKrw,
    model,
    async complete(usage) {
      if (settled) return;
      settled = true;
      const actualKrw = estimateUsageKrw(usage);
      await r.incrby(AI_SPEND_KEY(orderNo), actualKrw - estimatedKrw);
      await r.lpush(AI_LOG_KEY(orderNo), {
        at: new Date().toISOString(),
        stage: args.stage,
        estimatedKrw,
        actualKrw,
        usage,
      });
      await r.ltrim(AI_LOG_KEY(orderNo), 0, 99);
    },
    async release() {
      if (settled) return;
      settled = true;
      await r.incrby(AI_SPEND_KEY(orderNo), -estimatedKrw);
    },
  };
}

export async function reservePaidAiCall(args: ReserveAiCallArgs): Promise<AiBudgetReservation> {
  const paid = args.userId ? await getPaidRecord(args.userId) : null;
  return reserveOrderAiCall(args, paid?.orderNo ?? null, configuredPlanAiHardCapKrw());
}

export async function reservePresentationAiCall(
  args: ReserveAiCallArgs,
): Promise<AiBudgetReservation> {
  const paid = args.userId ? await getPresentationPaidRecord(args.userId) : null;
  return reserveOrderAiCall(
    args,
    paid?.orderNo ?? null,
    configuredPresentationAiHardCapKrw(),
  );
}

export function aiBudgetExceededResponse(reservation: AiBudgetReservation): Response {
  return Response.json(
    {
      error:
        "이 주문에 설정된 AI 원가 상한에 도달했어요. 현재까지 작성된 내용은 유지되며, 전체 재생성 대신 고객문의에서 필요한 부분만 확인해 주세요.",
      reason: "ai_budget_exhausted",
      spentKrw: reservation.spentKrw,
      hardCapKrw: reservation.hardCapKrw,
    },
    { status: 429 },
  );
}

export async function getOrderAiSpendKrw(userId: string): Promise<number> {
  const paid = await getPaidRecord(userId);
  const r = getRedis();
  if (!paid || !r) return 0;
  return Math.max(0, Number((await r.get<number>(AI_SPEND_KEY(paid.orderNo))) ?? 0));
}
