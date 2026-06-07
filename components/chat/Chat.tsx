"use client";

import { useEffect, useRef, useState } from "react";

type Role = "user" | "assistant";
interface Msg {
  role: Role;
  content: string;
}

const GREETING =
  "안녕하세요! 먼저 가볍게 여쭤볼게요. 혹시 이미 운영 중인 사업이 있으세요, 아니면 아직 준비 중(예비창업)이세요?";

export default function Chat() {
  const [messages, setMessages] = useState<Msg[]>([
    { role: "assistant", content: GREETING },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;

    const history = [...messages, { role: "user" as const, content: text }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
      });

      if (res.status === 503) {
        replaceLast("아직 AI 연결 준비 중이에요. 곧 사용할 수 있게 됩니다! 🙂");
        return;
      }
      if (!res.ok || !res.body) {
        replaceLast("죄송해요, 답변을 가져오지 못했어요. 다시 시도해 주세요.");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        replaceLast(acc);
      }
    } catch {
      replaceLast("연결이 끊겼어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  function replaceLast(content: string) {
    setMessages((prev) => {
      const copy = [...prev];
      copy[copy.length - 1] = { role: "assistant", content };
      return copy;
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <main className="flex flex-1 flex-col bg-white">
      <header className="border-b border-zinc-100 px-5 py-4">
        <h1 className="text-base font-semibold">정부지원사업 사업계획서 도우미</h1>
        <p className="mt-0.5 text-xs text-zinc-500">
          편하게 대화하듯 답해 주세요. 나에게 맞는 지원사업을 찾아 드릴게요.
        </p>
      </header>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-5">
        {messages.map((m, i) => (
          <div
            key={i}
            className={
              m.role === "user"
                ? "ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-emerald-600 px-4 py-3 text-sm leading-6 text-white"
                : "mr-auto max-w-[85%] rounded-2xl rounded-bl-sm bg-zinc-100 px-4 py-3 text-sm leading-6 text-zinc-900"
            }
          >
            {m.content || (busy ? "…" : "")}
          </div>
        ))}
      </div>

      <div className="border-t border-zinc-100 p-4">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder="여기에 답을 입력하세요…"
            className="max-h-32 flex-1 resize-none rounded-2xl border border-zinc-200 px-4 py-2.5 text-sm outline-none focus:border-emerald-500"
          />
          <button
            onClick={send}
            disabled={busy || !input.trim()}
            className="shrink-0 rounded-full bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            보내기
          </button>
        </div>
      </div>
    </main>
  );
}
