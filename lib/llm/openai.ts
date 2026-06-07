import OpenAI from "openai";
import type { JsonOptions, LlmClient, StreamTextOptions } from "./provider";
import { extractJson } from "./json";

let singleton: OpenAI | null = null;
function client(): OpenAI {
  if (!singleton) singleton = new OpenAI(); // reads OPENAI_API_KEY
  return singleton;
}

type OAIMsg = { role: "system" | "user" | "assistant"; content: string };

function toMessages(system: string | undefined, msgs: { role: string; content: string }[]): OAIMsg[] {
  const out: OAIMsg[] = [];
  if (system) out.push({ role: "system", content: system });
  for (const m of msgs) {
    out.push({ role: m.role === "assistant" ? "assistant" : "user", content: m.content });
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
