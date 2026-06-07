"use client";

import { useEffect, useRef, useState } from "react";
import type { Recommendation } from "@/lib/match/types";

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
  const [recommending, setRecommending] = useState(false);
  const [recs, setRecs] = useState<Recommendation[] | null>(null);
  const [usingSample, setUsingSample] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const hasUserReplied = messages.some((m) => m.role === "user");

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, recs, recommending]);

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

  async function recommend() {
    if (recommending || busy) return;
    setRecommending(true);
    setRecs(null);
    try {
      const res = await fetch("/api/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessages((m) => [
          ...m,
          { role: "assistant", content: data?.error ?? "추천을 가져오지 못했어요." },
        ]);
        return;
      }
      setUsingSample(Boolean(data.usingSample));
      setRecs(Array.isArray(data.recommendations) ? data.recommendations : []);
    } catch {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: "추천을 가져오는 중 연결이 끊겼어요. 다시 시도해 주세요." },
      ]);
    } finally {
      setRecommending(false);
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
                ? "ml-auto max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-blue-600 px-4 py-3 text-sm leading-6 text-white"
                : "mr-auto max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-zinc-100 px-4 py-3 text-sm leading-6 text-zinc-900"
            }
          >
            {m.content || (busy ? "…" : "")}
          </div>
        ))}

        {recommending && (
          <div className="mr-auto rounded-2xl bg-zinc-100 px-4 py-3 text-sm text-zinc-600">
            맞는 지원사업을 찾는 중이에요… 🔎
          </div>
        )}

        {recs && <Recommendations recs={recs} usingSample={usingSample} />}
      </div>

      {hasUserReplied && (
        <div className="border-t border-zinc-100 px-4 pt-3">
          <button
            onClick={recommend}
            disabled={recommending || busy}
            className="w-full rounded-xl bg-blue-50 py-2.5 text-sm font-semibold text-blue-700 transition-colors hover:bg-blue-100 disabled:opacity-50"
          >
            ✨ 이 내용으로 지원사업 추천받기
          </button>
        </div>
      )}

      <div className="border-t border-zinc-100 p-4">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder="여기에 답을 입력하세요…"
            className="max-h-32 flex-1 resize-none rounded-2xl border border-zinc-200 px-4 py-2.5 text-sm outline-none focus:border-blue-500"
          />
          <button
            onClick={send}
            disabled={busy || !input.trim()}
            className="shrink-0 rounded-full bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            보내기
          </button>
        </div>
      </div>
    </main>
  );
}

function Recommendations({
  recs,
  usingSample,
}: {
  recs: Recommendation[];
  usingSample: boolean;
}) {
  if (recs.length === 0) {
    return (
      <div className="mr-auto max-w-[90%] rounded-2xl bg-zinc-100 px-4 py-3 text-sm text-zinc-700">
        딱 맞는 사업을 아직 못 찾았어요. 아이템이나 상황을 조금만 더 알려주시면 다시 찾아볼게요!
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="text-sm font-semibold text-zinc-700">
        이런 지원사업이 잘 맞을 것 같아요 👇
      </div>
      {recs.map((r) => (
        <div key={r.program.id} className="rounded-2xl border border-zinc-200 p-4">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-sm font-bold text-zinc-900">{r.program.title}</h3>
            <span
              className={
                r.eligibility === "가능성 높음"
                  ? "shrink-0 rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-700"
                  : "shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700"
              }
            >
              {r.eligibility}
            </span>
          </div>
          <p className="mt-1.5 text-sm leading-6 text-zinc-700">{r.fitReason}</p>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-zinc-500">
            <span className="rounded bg-zinc-100 px-1.5 py-0.5">{r.program.supportField}</span>
            <span className="rounded bg-zinc-100 px-1.5 py-0.5">{r.program.region}</span>
          </div>
          <div className="mt-3 flex gap-3 text-xs font-semibold">
            <a
              href={r.program.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-700 hover:underline"
            >
              공고 보러가기 →
            </a>
            {r.program.formUrl && (
              <a
                href={r.program.formUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-700 hover:underline"
              >
                양식 다운로드 →
              </a>
            )}
          </div>
        </div>
      ))}
      {usingSample && (
        <p className="text-[11px] leading-5 text-zinc-400">
          ※ 지금은 예시 데이터예요. 정부 데이터 연동(승인 대기 중)이 끝나면 실제 공고로 바뀝니다.
        </p>
      )}
    </div>
  );
}
