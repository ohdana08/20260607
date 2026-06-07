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

export type Provider = "claude" | "openai";

export interface ChatMsg {
  role: "user" | "assistant" | "system";
  content: string;
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

/**
 * Resolve an LlmClient for the chosen provider.
 * Claude is wired up now; OpenAI lands in a later phase.
 */
export function getLlm(provider: Provider): LlmClient {
  if (provider === "claude") return createAnthropicClient();
  throw new Error(`getLlm: provider "${provider}" is not implemented yet`);
}
