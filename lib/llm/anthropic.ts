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

const CACHE: Anthropic.CacheControlEphemeral = { type: "ephemeral" };

// 시스템 프롬프트(고정 + program 기반 공고 데이터)는 호출마다 동일하므로 캐싱한다.
// 문자열을 텍스트 블록 배열로 바꾸고 마지막 블록에 cache_control을 단다.
// 렌더 순서는 tools → system → messages 이므로 system 블록의 breakpoint가
// system 프리픽스 전체(공고 데이터 포함)를 캐싱한다.
function cachedSystem(system?: string): Anthropic.TextBlockParam[] | undefined {
  if (!system) return undefined;
  return [{ type: "text", text: system, cache_control: CACHE }];
}

// 멀티턴 대화(7단계 자가진단 등)에서 누적되는 대화 프리픽스 + 첨부(PDF/이미지)는
// 매 턴 그대로 다시 전송된다. 마지막 메시지의 마지막 블록에 breakpoint를 두면
// 직전 턴까지의 프리픽스를 캐시에서 읽어온다(표준 멀티턴 캐싱 패턴).
function withConversationCache(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  if (messages.length === 0) return messages;
  const out = messages.slice();
  const last = out[out.length - 1];
  const blocks: Anthropic.ContentBlockParam[] =
    typeof last.content === "string"
      ? [{ type: "text", text: last.content }]
      : last.content.slice();
  if (blocks.length === 0) return out;
  const i = blocks.length - 1;
  blocks[i] = { ...blocks[i], cache_control: CACHE } as Anthropic.ContentBlockParam;
  out[out.length - 1] = { ...last, content: blocks };
  return out;
}

// TEMP: 프롬프트 캐시 적중 확인용 로그. 배포·검증 후 제거할 것.
// cache_read_input_tokens 가 0보다 크면 캐시 적중.
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
      const sys = cachedSystem(system);
      const stream = client().messages.stream(
        {
          model,
          max_tokens: maxTokens,
          ...(sys ? { system: sys } : {}),
          // 대화형(스트리밍)은 멀티턴이므로 누적 대화 프리픽스를 캐싱한다.
          messages: withConversationCache(toApiMessages(messages)),
        },
        { signal },
      );
      for await (const event of stream) {
        // TEMP: message_start usage 에 cache_read/creation 토큰이 실린다.
        if (event.type === "message_start") {
          logCacheUsage(`${model} streamText`, event.message.usage);
        }
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          yield event.delta.text;
        }
      }
    },

    async json<T>({ system, messages, maxTokens = 2048 }: JsonOptions): Promise<T> {
      const sys = cachedSystem(system);
      const res = await client().messages.create({
        model,
        max_tokens: maxTokens,
        ...(sys ? { system: sys } : {}),
        // json 호출은 단발성 추출(match·teaser·visuals)이라 메시지 캐싱은 하지 않는다.
        // (match 의 공고 목록은 매 요청 바뀌어 캐싱 시 쓰기 프리미엄만 낭비됨)
        messages: toApiMessages(messages),
      });
      logCacheUsage(`${model} json`, res.usage); // TEMP: 배포·검증 후 제거
      const text = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      return extractJson<T>(text);
    },
  };
}
