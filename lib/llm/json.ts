// 모델 응답에서 JSON 값만 뽑아냄 (코드펜스/잡문 허용).
export function extractJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.search(/[[{]/);
  if (start === -1) throw new Error("no JSON found in model reply");
  const open = candidate[start];
  const close = open === "[" ? "]" : "}";
  const end = candidate.lastIndexOf(close);
  if (end <= start) throw new Error("malformed JSON in model reply");
  return JSON.parse(candidate.slice(start, end + 1)) as T;
}
