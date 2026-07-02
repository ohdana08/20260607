import Anthropic from "@anthropic-ai/sdk";
import type { ChatMsg, JsonOptions, LlmClient, StreamTextOptions } from "./provider";
import { extractJson } from "./json";

// Cheap model for the conversational intake + matching (Phase 2). The final
// business-plan draft (Phase 3) will use claude-opus-4-8.
const INTAKE_MODEL = "claude-haiku-4-5";

let singleton: Anthropic | null = null;
function client(): Anthropic {
  // Reads ANTHROPIC_API_KEY from the environment (Vercel project env var).
  if (!singleton) singleton = new Anthropic();
  return singleton;
}

function toApiMessages(messages: ChatMsg[]): Anthropic.MessageParam[] {
  return messages.map((m) => {
    const role = m.role === "assistant" ? "assistant" : "user";
    const hasImages = m.images && m.images.length > 0;
    const hasFiles = m.files && m.files.length > 0;
    if (hasImages || hasFiles) {
      const content: Anthropic.ContentBlockParam[] = [
        ...(m.images ?? []).map((im) => ({
          type: "image" as const,
          source: {
            type: "base64" as const,
            media_type: im.mediaType as "image/png" | "image/jpeg" | "image/webp" | "image/gif",
            data: im.data,
          },
        })),
        ...(m.files ?? []).map((f) => ({
          type: "document" as const,
          source: {
            type: "base64" as const,
            media_type: "application/pdf" as const,
            data: f.data,
          },
        })),
        { type: "text" as const, text: m.content || "(첨부 파일 참고)" },
      ];
      return { role, content };
    }
    return { role, content: m.content };
  });
}

// ── 프롬프트 캐싱 (점검표 문제 6 재적용) ───────────────────────────────
// 규칙:
//  ① cache_control은 "비어있지 않은" 콘텐츠 블록에만 (빈 텍스트 블록에 붙이면 400 — 과거 롤백 원인)
//  ② 배치는 system 블록 + 마지막/직전 사용자 턴, 최대 3곳 (API 한도 4곳)
//     — 직전 턴 breakpoint는 draft 5연속 호출·match 재시도의 공유 프리픽스 캐시 히트에 필수
// Haiku 4.5·Opus 4.8 모두 4,096토큰 미만 프리픽스는 캐시가 안 됨(무해하게 무시됨) — 첨부·긴 대화부터 효과.
const CACHE: Anthropic.CacheControlEphemeral = { type: "ephemeral" };

function cachedSystem(system: string): Anthropic.TextBlockParam[] | string {
  if (!system.trim()) return system; // 빈 블록 금지(규칙 ①) — 캐싱 없이 그대로
  return [{ type: "text", text: system, cache_control: CACHE }];
}

// 메시지의 마지막 "비어있지 않은" 블록에 cache_control을 붙인다(규칙 ①). 붙일 곳 없으면 null.
function withCacheOnLastBlock(msg: Anthropic.MessageParam): Anthropic.MessageParam | null {
  const blocks: Anthropic.ContentBlockParam[] =
    typeof msg.content === "string"
      ? msg.content
        ? [{ type: "text", text: msg.content }]
        : []
      : msg.content.slice();
  let hit = -1;
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    // 이미지·문서 블록은 항상 비어있지 않음. 텍스트 블록은 내용 있을 때만(규칙 ①).
    if (b.type !== "text" || b.text.trim().length > 0) {
      hit = i;
      break;
    }
  }
  if (hit < 0) return null;
  blocks[hit] = { ...blocks[hit], cache_control: CACHE } as Anthropic.ContentBlockParam;
  return { ...msg, content: blocks };
}

// 마지막 사용자 턴 + 그 직전 사용자 턴에 breakpoint (system 포함 총 3곳, API 한도 4곳 이내).
// - 마지막 턴: 멀티턴(진단·코칭)의 누적 대화 + 첨부 프리픽스 재사용 (표준 패턴)
// - 직전 턴: 캐시 엔트리는 breakpoint 위치에만 기록되므로, draft(5연속)·match(재시도)처럼
//   "공유 프리픽스 + 달라지는 꼬리" 구조에서는 공유 프리픽스 끝(직전 사용자 턴)에
//   breakpoint가 있어야 2번째 호출부터 히트한다 (작업 G의 캐시 히트 조건).
function withConversationCache(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  const out = messages.slice();
  let tagged = 0;
  for (let i = out.length - 1; i >= 0 && tagged < 2; i--) {
    if (out[i].role !== "user") continue;
    const cached = withCacheOnLastBlock(out[i]);
    if (cached) {
      out[i] = cached;
      tagged++;
    }
  }
  return out;
}

// TEMP: 캐시 적중 확인용 로그(Vercel 로그에서 read>0 확인). 검증 후 제거 예정.
function logCacheUsage(label: string, usage: Anthropic.Usage): void {
  console.log(
    `[cache] ${label} input=${usage.input_tokens ?? 0}` +
      ` write=${usage.cache_creation_input_tokens ?? 0}` +
      ` read=${usage.cache_read_input_tokens ?? 0}` +
      ` output=${usage.output_tokens ?? 0}`,
  );
}

export function createAnthropicClient(model: string = INTAKE_MODEL): LlmClient {
  return {
    async *streamText({ system, messages, maxTokens = 1024, signal }: StreamTextOptions) {
      const stream = client().messages.stream(
        {
          model,
          max_tokens: maxTokens,
          ...(system ? { system: cachedSystem(system) } : {}),
          messages: withConversationCache(toApiMessages(messages)),
        },
        { signal },
      );
      for await (const event of stream) {
        if (event.type === "message_start") {
          logCacheUsage(`${model} streamText`, event.message.usage);
        }
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          yield event.delta.text;
        }
      }
    },

    async json<T>({ system, messages, maxTokens = 2048 }: JsonOptions): Promise<T> {
      const res = await client().messages.create({
        model,
        max_tokens: maxTokens,
        ...(system ? { system: cachedSystem(system) } : {}),
        messages: withConversationCache(toApiMessages(messages)),
      });
      logCacheUsage(`${model} json`, res.usage);
      const text = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      return extractJson<T>(text);
    },
  };
}
