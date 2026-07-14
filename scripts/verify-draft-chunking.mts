// draftChunking 유닛테스트 (API 키 불필요) — 이어쓰기 오케스트레이션 로직만 검증.
// 실행: npx tsx scripts/verify-draft-chunking.mts
import { generateChunked, MAX_CONTINUATIONS } from "../lib/plan/draftChunking";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed++;
}

// 케이스 1: 한 번에 완주 (가장 흔한 경우 — 잘리지 않음)
{
  const r = await generateChunked(async (cont, onChunk) => {
    check("1콜 케이스: continuationText는 첫 호출에 null", cont === null);
    onChunk("전체 내용을 한 번에 다 씀.");
    return { stopReason: "end_turn" };
  });
  check("1콜 완주: attempts=1", r.attempts === 1, `실제 ${r.attempts}`);
  check("1콜 완주: truncated=false", !r.truncated);
  check("1콜 완주: 텍스트 보존", r.text === "전체 내용을 한 번에 다 씀.");
}

// 케이스 2: 1회 잘리고 이어쓰기로 완주 (긴 항목의 정상 케이스)
{
  let call = 0;
  const r = await generateChunked(async (cont, onChunk) => {
    call++;
    if (call === 1) {
      check("2콜 케이스: 1차 continuationText는 null", cont === null);
      onChunk("앞부분 문장이 중간에 끊어");
      return { stopReason: "max_tokens" };
    }
    check("2콜 케이스: 2차엔 누적 텍스트가 이어쓰기 컨텍스트로 전달됨", cont === "앞부분 문장이 중간에 끊어");
    onChunk("졌다가 이어서 자연스럽게 마무리.");
    return { stopReason: "end_turn" };
  });
  check("이어쓰기 완주: attempts=2", r.attempts === 2, `실제 ${r.attempts}`);
  check("이어쓰기 완주: truncated=false", !r.truncated);
  check(
    "이어쓰기 완주: 중복·누락 없이 순서대로 이어붙음",
    r.text === "앞부분 문장이 중간에 끊어졌다가 이어서 자연스럽게 마무리.",
    r.text,
  );
}

// 케이스 3: 이어쓰기 한도까지 계속 잘림 (극단적 케이스 — 무한루프 방지 확인)
{
  let call = 0;
  const r = await generateChunked(async (_cont, onChunk) => {
    call++;
    onChunk(`청크${call} `);
    return { stopReason: "max_tokens" }; // 매번 잘림 시뮬레이션
  });
  check(
    `한도 도달: attempts=MAX_CONTINUATIONS(${MAX_CONTINUATIONS})에서 멈춤(무한루프 방지)`,
    r.attempts === MAX_CONTINUATIONS,
    `실제 ${r.attempts}`,
  );
  check("한도 도달: truncated=true (관측용 플래그)", r.truncated);
}

console.log(failed === 0 ? "\n모든 검증 통과" : `\n${failed}건 실패`);
process.exit(failed === 0 ? 0 : 1);
