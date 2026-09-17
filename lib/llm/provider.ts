// Server-side composition root. Existing exports remain compatible.
import { createAnthropicClient } from "./anthropic";
import { createOpenAIClient } from "./openai";
import type { Provider, Tier, LlmClient } from "./types";
export type {
  Provider,
  Tier,
  LlmUsage,
  ChatImage,
  ChatFile,
  ChatMsg,
  StreamTextOptions,
  JsonOptions,
  LlmClient,
} from "./types";

/** Normalize an untrusted value into a known provider (default: claude). */
export function parseProvider(x: unknown): Provider {
  return x === "openai" ? "openai" : "claude";
}

/** Is the selected provider's API key configured on the server? */
export function isProviderConfigured(provider: Provider): boolean {
  return provider === "openai"
    ? Boolean(process.env.OPENAI_API_KEY)
    : Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * Resolve an LlmClient for the chosen provider + tier.
 * fast = cheap model (intake/match), quality = best model (plan draft).
 */
export function getLlm(provider: Provider, tier: Tier = "fast"): LlmClient {
  return provider === "openai"
    ? createOpenAIClient(resolveModel(provider, tier))
    : createAnthropicClient(resolveModel(provider, tier));
}

export function resolveModel(provider: Provider, tier: Tier = "fast"): string {
  if (provider === "openai") {
    return tier === "fast"
      ? "gpt-4o-mini"
      : process.env.OPENAI_MODEL || "gpt-4o";
  }
  return tier === "quality"
    ? "claude-opus-4-8" // 유료 초안: 최고 품질
    : tier === "balanced"
      ? "claude-sonnet-4-6" // 진단 보고서: 빠르고 충분한 품질
      : "claude-haiku-4-5"; // 문진·적합도·맛보기: 빠름/저렴
}
