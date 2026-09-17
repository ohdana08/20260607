import Anthropic from "@anthropic-ai/sdk";
import { extractJson } from "./json";
import type { ChatMsg, LlmUsage } from "./types";
import type { EvidenceSource } from "@/lib/plan/strategy";

let singleton: Anthropic | null = null;
function client(): Anthropic {
  if (!singleton) singleton = new Anthropic();
  return singleton;
}

function toMessages(messages: ChatMsg[]): Anthropic.MessageParam[] {
  return messages.map((message) => {
    const role = message.role === "assistant" ? "assistant" : "user";
    if (!message.images?.length && !message.files?.length) return { role, content: message.content };
    const content: Anthropic.ContentBlockParam[] = [
      ...(message.images ?? []).map((image) => ({
        type: "image" as const,
        source: {
          type: "base64" as const,
          media_type: image.mediaType as "image/png" | "image/jpeg" | "image/webp" | "image/gif",
          data: image.data,
        },
      })),
      ...(message.files ?? []).map((file) => ({
        type: "document" as const,
        source: {
          type: "base64" as const,
          media_type: "application/pdf" as const,
          data: file.data,
        },
      })),
      { type: "text" as const, text: message.content || "(첨부 자료를 확인하세요.)" },
    ];
    return { role, content };
  });
}

export async function researchJson<T>(args: {
  system: string;
  messages: ChatMsg[];
  maxTokens: number;
  maxSearches: number;
  onUsage?: (usage: LlmUsage) => void | Promise<void>;
}): Promise<{ data: T; searchedSources: EvidenceSource[] }> {
  const model = "claude-haiku-4-5";
  const history = toMessages(args.messages);
  const searched = new Map<string, EvidenceSource>();
  const totals: LlmUsage = {
    provider: "claude",
    model,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    webSearchRequests: 0,
  };
  let finalText = "";

  for (let turn = 0; turn < 3; turn++) {
    const remainingSearches = Math.max(0, args.maxSearches - (totals.webSearchRequests ?? 0));
    const response = await client().messages.create({
      model,
      max_tokens: args.maxTokens,
      system: args.system,
      messages: history,
      ...(remainingSearches > 0
        ? {
            tools: [
              {
                type: "web_search_20260209" as const,
                name: "web_search" as const,
                allowed_callers: ["direct"] as const,
                max_uses: remainingSearches,
                user_location: { type: "approximate" as const, country: "KR", timezone: "Asia/Seoul" },
              },
            ],
          }
        : {}),
    });
    totals.inputTokens += response.usage.input_tokens ?? 0;
    totals.outputTokens += response.usage.output_tokens ?? 0;
    totals.cacheCreationInputTokens =
      (totals.cacheCreationInputTokens ?? 0) + (response.usage.cache_creation_input_tokens ?? 0);
    totals.cacheReadInputTokens =
      (totals.cacheReadInputTokens ?? 0) + (response.usage.cache_read_input_tokens ?? 0);
    totals.webSearchRequests =
      (totals.webSearchRequests ?? 0) + (response.usage.server_tool_use?.web_search_requests ?? 0);

    for (const block of response.content) {
      if (block.type === "text") {
        finalText += block.text;
        for (const citation of block.citations ?? []) {
          if (citation.type !== "web_search_result_location") continue;
          searched.set(citation.url, {
            id: `web-${searched.size + 1}`,
            title: citation.title ?? citation.url,
            url: citation.url,
            publisher: "",
            checkedAt: new Date().toISOString(),
            sourceType: "independent",
            accessNote: "공개 웹 검색 결과의 인용 범위에서 확인",
            claim: "",
            excerpt: citation.cited_text,
            verified: true,
          });
        }
      }
      if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
        for (const result of block.content) {
          if (result.type !== "web_search_result") continue;
          searched.set(result.url, {
            id: `web-${searched.size + 1}`,
            title: result.title,
            url: result.url,
            publisher: "",
            checkedAt: new Date().toISOString(),
            pageAge: result.page_age ?? undefined,
            sourceType: "independent",
            accessNote: "공개 웹 검색 결과에서 확인",
            claim: "",
            excerpt: "",
            verified: true,
          });
        }
      }
    }
    history.push({ role: "assistant", content: response.content as Anthropic.ContentBlockParam[] });
    if (response.stop_reason !== "pause_turn" || remainingSearches === 0) break;
  }
  try {
    let data: T;
    try {
      data = extractJson<T>(finalText);
    } catch {
      // Search can stop on a tool turn, or return prose instead of the required envelope.
      // One bounded synthesis pass uses only collected material and cannot search again.
      const response = await client().messages.create({
        model, max_tokens: args.maxTokens,
        system: args.system + "\n검색을 마쳤습니다. 이미 확인한 자료와 사용자 설명만 사용해 요구된 JSON을 간결하게 완성하세요. 확인하지 못한 외부 사실은 gaps에 남기세요. 설명이나 검색 도구 호출 없이 JSON만 출력하세요.",
        messages: [...history, { role: "user", content: "위에서 확보한 내용으로 최종 JSON을 작성하세요. sources 최대 6개, gaps 최대 4개, 설명은 각 100자 이하. 검색 결과가 없으면 sources는 빈 배열로 두세요." }],
      });
      totals.inputTokens += response.usage.input_tokens ?? 0;
      totals.outputTokens += response.usage.output_tokens ?? 0;
      if (response.stop_reason === "max_tokens") throw new Error("research synthesis truncated");
      const result = response.content.filter((block): block is Anthropic.TextBlock => block.type === "text").map(block => block.text).join("");
      data = extractJson<T>(result);
    }
    return { data, searchedSources: [...searched.values()] };
  } finally {
    await args.onUsage?.(totals);
  }
}
