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
export type Tier = "fast" | "quality";

export interface ChatImage {
  mediaType: string; // "image/png" | "image/jpeg" | "image/webp" | "image/gif"
  data: string; // base64 (no data: prefix)
}

export interface ChatMsg {
  role: "user" | "assistant" | "system";
  content: string;
  images?: ChatImage[];
}

export interface StreamTextOptions {
  system?: string;
  messages: ChatMsg[];
  maxTokens?: number;
  signal?: AbortSignal;
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
      tier === "quality" ? process.env.OPENAI_MODEL || "gpt-4o" : "gpt-4o-mini";
    return createOpenAIClient(model);
  }
  return createAnthropicClient(tier === "quality" ? "claude-opus-4-8" : "claude-haiku-4-5");
}
