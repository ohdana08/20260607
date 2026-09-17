// Shared LLM contracts. No vendor SDK or factory dependency.
export type Provider = "claude" | "openai";
// fast = 저렴/빠름(문진·적합도·진단 맛보기), balanced = 중간(진단 보고서),
// quality = 최고품질(유료 사업계획서 초안 — 비용 감수)
export type Tier = "fast" | "balanced" | "quality";

export interface LlmUsage {
  provider: Provider;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  webSearchRequests?: number;
}

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
  onUsage?: (usage: LlmUsage) => void | Promise<void>;
}

export interface JsonOptions {
  system?: string;
  messages: ChatMsg[];
  // Requested output schema; adapters currently parse JSON without runtime schema validation.
  schema: Record<string, unknown>;
  maxTokens?: number;
  onUsage?: (usage: LlmUsage) => void | Promise<void>;
}

export interface LlmClient {
  /** Stream a plain-text completion token-by-token. */
  streamText(options: StreamTextOptions): AsyncIterable<string>;
  /** Return parsed JSON. Callers must validate domain constraints. */
  json<T>(options: JsonOptions): Promise<T>;
}
