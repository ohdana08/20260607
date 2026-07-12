// Provider-agnostic LLM interface.
//
// The app supports BOTH Claude and OpenAI, selected by the user at runtime.
// Route handlers depend only on `LlmClient` and never import a vendor SDK
// directly, so swapping/adding providers stays local to lib/llm/*.
//
// Concrete implementations land in Phase 2 (lib/llm/anthropic.ts,
// lib/llm/openai.ts). Before writing the Anthropic client, consult the
// /claude-api skill for current Opus 4.8 params (e.g. adaptive thinking,
// output_config.effort; prefills and budget_tokens are unsupported).

import { createAnthropicClient } from "./anthropic";
import { createOpenAIClient } from "./openai";

export type Provider = "claude" | "openai";
// fast = 저렴/빠름(문진·적합도·진단 맛보기), balanced = 중간(진단 보고서),
// quality = 최고품질(유료 사업계획서 초안 — 비용 감수)
export type Tier = "fast" | "balanced" | "quality";

export interface ChatImage {
  mediaType: string; // "image/png" | "image/jpeg" | "image/webp" | "image/gif"
  data: string; // base64 (no data: prefix)
}

export interface ChatFile {
  mediaType: string; // "application/pdf"
  data: string; // base64 (no data: prefix)
  name?: string;
}

export interface ChatMsg {
  role: "user" | "assistant" | "system";
  content: string;
  images?: ChatImage[];
  files?: ChatFile[]; // PDF 등 문서 (Claude document 블록)
}

export interface StreamTextOptions {
  system?: string;
  messages: ChatMsg[];
  maxTokens?: number;
  signal?: AbortSignal;
  onStop?: (stop: { reason?: string | null; outputTokens?: number }) => void;
}

export interface JsonOptions {
  system?: string;
  messages: ChatMsg[];
  // JSON Schema the model output is validated against.
  schema: Record<string, unknown>;
  maxTokens?: number;
}

export interface LlmClient {
  /** Stream a plain-text completion token-by-token. */
  streamText(options: StreamTextOptions): AsyncIterable<string>;
  /** Return a structured object validated against `schema`. */
  json<T>(options: JsonOptions): Promise<T>;
}

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
  if (provider === "openai") {
    const model =
      tier === "fast" ? "gpt-4o-mini" : process.env.OPENAI_MODEL || "gpt-4o";
    return createOpenAIClient(model);
  }
  const model =
    tier === "quality"
      ? "claude-opus-4-8" // 유료 초안: 최고 품질
      : tier === "balanced"
        ? "claude-sonnet-4-6" // 진단 보고서: 빠르고 충분한 품질
        : "claude-haiku-4-5"; // 문진·적합도·맛보기: 빠름/저렴
  return createAnthropicClient(model);
}
