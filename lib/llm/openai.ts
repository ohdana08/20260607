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
    async *streamText({ system, messages, maxTokens = 1024, signal, onStop, onUsage }: StreamTextOptions) {
      const stream = await client().chat.completions.create(
        {
          model,
          messages: toMessages(system, messages),
          max_completion_tokens: maxTokens,
          stream: true,
          stream_options: { include_usage: true },
        },
        { signal },
      );
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) yield delta;
        const finishReason = chunk.choices[0]?.finish_reason;
        if (finishReason) {
          onStop?.({
            reason: finishReason === "length" ? "max_tokens" : finishReason,
          });
        }
        if (chunk.usage) {
          await onUsage?.({
            provider: "openai",
            model,
            inputTokens: chunk.usage.prompt_tokens ?? 0,
            outputTokens: chunk.usage.completion_tokens ?? 0,
          });
        }
      }
    },

    async json<T>({ system, messages, maxTokens = 2048, onUsage }: JsonOptions): Promise<T> {
      const res = await client().chat.completions.create({
        model,
        messages: toMessages(system, messages),
        max_completion_tokens: maxTokens,
      });
      await onUsage?.({
        provider: "openai",
        model,
        inputTokens: res.usage?.prompt_tokens ?? 0,
        outputTokens: res.usage?.completion_tokens ?? 0,
      });
      return extractJson<T>(res.choices[0]?.message?.content ?? "");
    },
  };
}
