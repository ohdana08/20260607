import Anthropic from "@anthropic-ai/sdk";
import type { ChatMsg, JsonOptions, LlmClient, StreamTextOptions } from "./provider";

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
  return messages.map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: m.content,
  }));
}

// Pull a JSON value out of a model reply, tolerant of code fences / prose.
function extractJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.search(/[[{]/);
  if (start === -1) throw new Error("no JSON found in model reply");
  // Find the matching last bracket of the same kind.
  const open = candidate[start];
  const close = open === "[" ? "]" : "}";
  const end = candidate.lastIndexOf(close);
  if (end <= start) throw new Error("malformed JSON in model reply");
  return JSON.parse(candidate.slice(start, end + 1)) as T;
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
