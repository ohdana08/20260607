import OpenAI from "openai";
import type { JsonOptions, LlmClient, StreamTextOptions } from "./provider";
import { extractJson } from "./json";

let singleton: OpenAI | null = null;
function client(): OpenAI {
  if (!singleton) singleton = new OpenAI(); // reads OPENAI_API_KEY
  return singleton;
}

type OAIMsg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

function toMessages(
  system: string | undefined,
  msgs: { role: string; content: string; images?: { mediaType: string; data: string }[] }[],
): OAIMsg[] {
  const out: OAIMsg[] = [];
  if (system) out.push({ role: "system", content: system });
  for (const m of msgs) {
    const role = m.role === "assistant" ? "assistant" : "user";
    if (role === "user" && m.images && m.images.length > 0) {
      out.push({
        role: "user",
        content: [
          ...m.images.map((im) => ({
            type: "image_url" as const,
            image_url: { url: `data:${im.mediaType};base64,${im.data}` },
          })),
          { type: "text" as const, text: m.content || "(이미지 참고)" },
        ],
      });
    } else if (role === "assistant") {
      out.push({ role: "assistant", content: m.content });
    } else {
      out.push({ role: "user", content: m.content });
    }
  }
  return out;
}

export function createOpenAIClient(model: string): LlmClient {
  return {
    async *streamText({ system, messages, maxTokens = 1024, signal }: StreamTextOptions) {
      const stream = await client().chat.completions.create(
        {
          model,
          messages: toMessages(system, messages),
          max_completion_tokens: maxTokens,
          stream: true,
        },
        { signal },
      );
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) yield delta;
      }
    },

    async json<T>({ system, messages, maxTokens = 2048 }: JsonOptions): Promise<T> {
      const res = await client().chat.completions.create({
        model,
        messages: toMessages(system, messages),
        max_completion_tokens: maxTokens,
      });
      return extractJson<T>(res.choices[0]?.message?.content ?? "");
    },
  };
}
