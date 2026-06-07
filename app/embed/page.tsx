import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "정부지원사업 사업계획서 도우미",
};

// Minimal, framable entry rendered inside the BCC homepage iframe.
// Phase 0: a static shell. The conversational intake (Phase 2) mounts here.
export default function EmbedPage() {
  return (
    <main className="flex flex-1 flex-col bg-white">
      <header className="border-b border-zinc-100 px-5 py-4">
        <h1 className="text-base font-semibold">정부지원사업 사업계획서 도우미</h1>
        <p className="mt-0.5 text-xs text-zinc-500">
          편하게 대화하듯 답해 주세요. 나에게 맞는 지원사업을 찾아 드릴게요.
        </p>
      </header>

      <div className="flex flex-1 flex-col justify-end gap-3 p-5">
        <div className="max-w-[85%] self-start rounded-2xl rounded-bl-sm bg-zinc-100 px-4 py-3 text-sm leading-6">
          안녕하세요! 먼저 가볍게 여쭤볼게요. 혹시 이미 운영 중인 사업이
          있으세요, 아니면 아직 준비 중(예비창업)이세요?
        </div>
      </div>

      <div className="border-t border-zinc-100 p-4">
        <div className="flex items-center gap-2 rounded-full border border-zinc-200 px-4 py-2.5 text-sm text-zinc-400">
          여기에 답을 입력하세요… (준비 중 — Phase 2에서 활성화)
        </div>
      </div>
    </main>
  );
}
