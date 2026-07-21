// 섹션 생성 자동 이어쓰기 (2026-07-14 max_tokens 구조 해결)
//
// 문제: 긴 항목은 한 번의 LLM 호출로 다 못 쓰고 stop_reason=max_tokens로 문장 중간에
// 잘렸다. 차선책(maxTokens 값만 올리기)은 "더 긴 항목이 오면 또 잘린다"는 문제를
// 미루기만 한다. 대신 잘리면 "방금 쓰던 데서 이어서" 다시 호출해 이어붙이고,
// 자연스럽게 끝날 때(stop_reason !== max_tokens)까지 반복한다 — 어떤 길이든 완주한다.
//
// route.ts는 실제 스트리밍 호출(callOnce)을 주입하고, 이 함수는 "몇 번 더 부를지"
// "언제 멈출지"만 결정하는 순수 오케스트레이션이라 API 키 없이도 단위 테스트 가능하다.

export const MAX_CONTINUATIONS = 3; // 이어쓰기 최대 횟수 — 무한 루프·과금 폭주 방지
export const CONTINUE_PROMPT =
  "계속 이어서 작성하세요. 새 문단이나 새 항목으로 다시 시작하지 말고, 방금 쓰던 문장 다음부터 자연스럽게 이어가세요.";

export interface ChunkCallResult {
  stopReason: string | null | undefined;
}

export interface ChunkedResult {
  text: string;
  attempts: number;
  // 이어쓰기 한도까지 다 써도 여전히 max_tokens면 true (극히 드묾 — 관측용)
  truncated: boolean;
}

/**
 * callOnce(continuationText, onChunk):
 *   - continuationText: null이면 첫 호출, 아니면 지금까지 누적된 본문(이어쓰기 컨텍스트용).
 *   - onChunk: 델타 텍스트가 도착할 때마다 호출(스트리밍 전달용). 순서대로만 호출됨.
 *   - 반환: 그 호출의 최종 stop_reason.
 */
export async function generateChunked(
  callOnce: (
    continuationText: string | null,
    onChunk: (delta: string) => void,
  ) => Promise<ChunkCallResult>,
): Promise<ChunkedResult> {
  let acc = "";
  let attempts = 0;
  let stopReason: string | null | undefined = null;
  let continuationText: string | null = null;

  do {
    attempts++;
    const r = await callOnce(continuationText, (delta) => {
      acc += delta;
    });
    stopReason = r.stopReason;
    continuationText = acc;
  } while (stopReason === "max_tokens" && attempts < MAX_CONTINUATIONS);

  return { text: acc, attempts, truncated: stopReason === "max_tokens" };
}
