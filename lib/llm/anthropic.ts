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

export function createAnthropicClient(model: string = INTAKE_MODEL): LlmClient {
  return {
    async *streamText({ system, messages, maxTokens = 1024, signal }: StreamTextOptions) {
      const stream = client().messages.stream(
        {
          model,
          max_tokens: maxTokens,
          ...(system ? { system } : {}),
          messages: toApiMessages(messages),
        },
        { signal },
      );
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          yield event.delta.text;
        }
      }
    },

    async json<T>({ system, messages, maxTokens = 2048 }: JsonOptions): Promise<T> {
      const res = await client().messages.create({
        model,
        max_tokens: maxTokens,
        ...(system ? { system } : {}),
        messages: toApiMessages(messages),
      });
      const text = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      return extractJson<T>(text);
    },
  };
}
