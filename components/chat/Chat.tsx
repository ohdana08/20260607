"use client";

import { useEffect, useRef, useState } from "react";
import type { Recommendation, Program } from "@/lib/match/types";
import { PLAN_SECTIONS } from "@/lib/plan/sections";

type Role = "user" | "assistant";
interface Msg {
  role: Role;
  content: string;
}
type Mode = "intake" | "paywall" | "plan";
interface DraftSection {
  heading: string;
  content: string;
}
interface Draft {
  title: string;
  sections: DraftSection[];
}
interface Chart {
  key: string;
  title: string;
  png: string;
  width: number;
  height: number;
}

const GREETING =
  "안녕하세요! 먼저 가볍게 여쭤볼게요. 혹시 이미 운영 중인 사업이 있으세요, 아니면 아직 준비 중(예비창업)이세요?";
const PRICE = "29,900원";
const PAYMENT_URL = "https://pf.kakao.com/_xbrxjxkxj/chat"; // BCC 카카오 채널

export default function Chat() {
  const [messages, setMessages] = useState<Msg[]>([{ role: "assistant", content: GREETING }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [recommending, setRecommending] = useState(false);
  const [recs, setRecs] = useState<Recommendation[] | null>(null);
  const [usingSample, setUsingSample] = useState(false);

  const [provider, setProvider] = useState<"claude" | "openai">("claude");
  const [mode, setMode] = useState<Mode>("intake");
  const [selectedProgram, setSelectedProgram] = useState<Program | null>(null);
  const [code, setCode] = useState<string>("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [charts, setCharts] = useState<Chart[] | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const hasUserReplied = messages.some((m) => m.role === "user");

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, recs, recommending, mode, draft, drafting]);

  function replaceLast(content: string) {
    setMessages((prev) => {
      const copy = [...prev];
      copy[copy.length - 1] = { role: "assistant", content };
      return copy;
    });
  }

  async function send() {
    const text = input.trim();
    if (!text || busy || mode === "paywall") return;
    const history = [...messages, { role: "user" as const, content: text }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);

    const endpoint = mode === "plan" ? "/api/plan/chat" : "/api/chat";
    const payload =
      mode === "plan"
        ? { messages: history, code, programTitle: selectedProgram?.title, provider }
        : { messages: history, provider };

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status === 429) {
        replaceLast("잠시 너무 많이 사용했어요. 잠깐 쉬었다가 다시 해주세요 🙏");
        return;
      }
      if (res.status === 402) {
        replaceLast("이 기능은 이용권이 필요해요.");
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
        body: JSON.stringify({ messages, provider }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessages((m) => [...m, { role: "assistant", content: data?.error ?? "추천을 가져오지 못했어요." }]);
        return;
      }
      setUsingSample(Boolean(data.usingSample));
      setRecs(Array.isArray(data.recommendations) ? data.recommendations : []);
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "추천을 가져오는 중 연결이 끊겼어요." }]);
    } finally {
      setRecommending(false);
    }
  }

  function chooseProgram(p: Program) {
    setSelectedProgram(p);
    if (code) enterPlanMode(p);
    else setMode("paywall");
  }

  function enterPlanMode(p: Program) {
    setMode("plan");
    setDraft(null);
    setMessages((m) => [
      ...m,
      {
        role: "assistant",
        content: `좋아요! '${p.title}'에 맞춰 사업계획서를 같이 써볼게요. 📝\n먼저, 어떤 점이 불편하거나 아쉬워서 이걸 만들고 싶으셨어요?`,
      },
    ]);
  }

  async function verifyCode(entered: string) {
    const res = await fetch("/api/plan/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: entered }),
    });
    const data = await res.json();
    return Boolean(data?.ok);
  }

  async function generateDraft() {
    if (!selectedProgram || !code || drafting) return;
    setDrafting(true);
    setCharts(null);
    const title = `${selectedProgram.title} 사업계획서`;
    const sections: DraftSection[] = [];
    setDraft({ title, sections: [] });

    for (const sec of PLAN_SECTIONS) {
      sections.push({ heading: sec.heading, content: "" });
      setDraft({ title, sections: [...sections] });
      try {
        const res = await fetch("/api/plan/draft", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages,
            code,
            programTitle: selectedProgram.title,
            section: { heading: sec.heading, guide: sec.guide },
            provider,
          }),
        });
        if (res.status === 429) {
          sections[sections.length - 1].content = "(잠시 너무 많이 사용했어요. 잠깐 후 다시 시도해 주세요.)";
          setDraft({ title, sections: [...sections] });
          break;
        }
        if (!res.ok || !res.body) {
          sections[sections.length - 1].content = "(이 항목 작성에 실패했어요.)";
          setDraft({ title, sections: [...sections] });
          continue;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let acc = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          acc += decoder.decode(value, { stream: true });
          sections[sections.length - 1].content = acc;
          setDraft({ title, sections: [...sections] });
        }
      } catch {
        sections[sections.length - 1].content = "(이 항목 작성 중 연결이 끊겼어요.)";
        setDraft({ title, sections: [...sections] });
      }
    }

    // 도식 자료 생성 (TAM/SAM/SOM·고객여정맵·퍼널·수익모델)
    try {
      const res = await fetch("/api/plan/visuals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages, code, programTitle: selectedProgram.title, provider }),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.charts) && data.charts.length > 0) setCharts(data.charts);
      }
    } catch {
      /* 도식 실패해도 초안은 유지 */
    }

    setDrafting(false);
  }

  async function downloadDocx() {
    if (!draft || !code) return;
    const res = await fetch("/api/plan/docx", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, title: draft.title, sections: draft.sections, charts: charts ?? [] }),
    });
    if (!res.ok) {
      alert("다운로드에 실패했어요. 다시 시도해 주세요.");
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${draft.title}.docx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
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
        <div className="flex items-start justify-between gap-2">
          <div>
            <h1 className="text-base font-semibold">정부지원사업 사업계획서 도우미</h1>
            <p className="mt-0.5 text-xs text-zinc-500">
              편하게 대화하듯 답해 주세요. 나에게 맞는 지원사업을 찾아 드릴게요.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-0.5 rounded-full bg-zinc-100 p-0.5 text-xs">
            <button
              onClick={() => setProvider("claude")}
              className={
                provider === "claude"
                  ? "rounded-full bg-white px-2.5 py-1 font-semibold text-zinc-900 shadow-sm"
                  : "px-2.5 py-1 text-zinc-500"
              }
            >
              Claude
            </button>
            <button
              onClick={() => setProvider("openai")}
              className={
                provider === "openai"
                  ? "rounded-full bg-white px-2.5 py-1 font-semibold text-zinc-900 shadow-sm"
                  : "px-2.5 py-1 text-zinc-500"
              }
            >
              ChatGPT
            </button>
          </div>
        </div>
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

        {recs && mode !== "plan" && (
          <Recommendations recs={recs} usingSample={usingSample} onChoose={chooseProgram} />
        )}

        {mode === "paywall" && selectedProgram && (
          <Paywall
            program={selectedProgram}
            onUnlock={(c) => {
              setCode(c);
              enterPlanMode(selectedProgram);
            }}
            onCancel={() => setMode(recs ? "intake" : "intake")}
            verifyCode={verifyCode}
          />
        )}

        {draft && (
          <DraftView
            draft={draft}
            drafting={drafting}
            charts={charts}
            onDownload={downloadDocx}
          />
        )}
      </div>

      {mode !== "paywall" && (
        <>
          {mode === "intake" && hasUserReplied && (
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
          {mode === "plan" && (
            <div className="border-t border-zinc-100 px-4 pt-3">
              <button
                onClick={generateDraft}
                disabled={drafting || busy}
                className="w-full rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
              >
                {drafting ? "초안을 작성하는 중이에요…" : "📄 사업계획서 초안 만들기"}
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
        </>
      )}
    </main>
  );
}

function Recommendations({
  recs,
  usingSample,
  onChoose,
}: {
  recs: Recommendation[];
  usingSample: boolean;
  onChoose: (p: Program) => void;
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
      <div className="text-sm font-semibold text-zinc-700">이런 지원사업이 잘 맞을 것 같아요 👇</div>
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
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs font-semibold">
            <a
              href={r.program.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-700 hover:underline"
            >
              공고 보러가기 →
            </a>
            <button
              onClick={() => onChoose(r.program)}
              className="rounded-full bg-blue-600 px-3 py-1.5 text-white hover:bg-blue-700"
            >
              📝 이 사업으로 사업계획서 쓰기
            </button>
          </div>
        </div>
      ))}
      {usingSample && (
        <p className="text-[11px] leading-5 text-zinc-400">
          ※ 지금은 예시 데이터예요. 정부 데이터 연동이 끝나면 실제 공고로 바뀝니다.
        </p>
      )}
    </div>
  );
}

function Paywall({
  program,
  onUnlock,
  onCancel,
  verifyCode,
}: {
  program: Program;
  onUnlock: (code: string) => void;
  onCancel: () => void;
  verifyCode: (code: string) => Promise<boolean>;
}) {
  const [entered, setEntered] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!entered.trim() || checking) return;
    setChecking(true);
    setError("");
    const ok = await verifyCode(entered.trim());
    setChecking(false);
    if (ok) onUnlock(entered.trim());
    else setError("코드가 맞지 않아요. 다시 확인해 주세요.");
  }

  return (
    <div className="rounded-2xl border border-blue-200 bg-blue-50/50 p-5">
      <h3 className="text-sm font-bold text-zinc-900">📝 사업계획서 함께 작성하기</h3>
      <p className="mt-1 text-sm leading-6 text-zinc-700">
        <b>{program.title}</b>에 맞춰 AI랑 대화하며 사업계획서 초안을 완성하고 <b>Word 파일로 다운로드</b>할 수
        있어요.
      </p>
      <p className="mt-2 text-sm font-bold text-blue-700">이용권 {PRICE}</p>

      <a
        href={PAYMENT_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 block rounded-xl bg-[#FEE500] py-2.5 text-center text-sm font-bold text-[#181600] hover:brightness-95"
      >
        카카오톡으로 결제하고 이용권 코드 받기
      </a>

      <div className="mt-3">
        <label className="text-xs font-semibold text-zinc-600">이용권 코드 입력</label>
        <div className="mt-1 flex gap-2">
          <input
            value={entered}
            onChange={(e) => setEntered(e.target.value)}
            placeholder="예: BCC-XXXXX"
            className="flex-1 rounded-xl border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
          <button
            onClick={submit}
            disabled={checking || !entered.trim()}
            className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {checking ? "확인 중…" : "코드 확인"}
          </button>
        </div>
        {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
      </div>

      <button onClick={onCancel} className="mt-3 text-xs text-zinc-400 hover:underline">
        ← 다른 사업 보기
      </button>
    </div>
  );
}

function DraftView({
  draft,
  drafting,
  charts,
  onDownload,
}: {
  draft: Draft;
  drafting: boolean;
  charts: Chart[] | null;
  onDownload: () => void;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200 p-4">
      <h3 className="text-sm font-bold text-zinc-900">{draft.title}</h3>
      <div className="mt-2 space-y-3">
        {draft.sections.map((s, i) => (
          <div key={i}>
            <div className="text-sm font-semibold text-zinc-800">{s.heading}</div>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-zinc-700">
              {s.content || "작성 중…"}
            </p>
          </div>
        ))}
      </div>

      {drafting && (
        <p className="mt-3 text-xs text-zinc-400">초안과 도식을 만드는 중이에요…</p>
      )}

      {charts && charts.length > 0 && (
        <div className="mt-4 border-t border-zinc-100 pt-3">
          <div className="text-sm font-semibold text-zinc-800">📊 포함된 도식</div>
          <div className="mt-2 space-y-3">
            {charts.map((c) => (
              <div key={c.key}>
                <div className="mb-1 text-xs font-medium text-zinc-500">{c.title}</div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`data:image/png;base64,${c.png}`}
                  alt={c.title}
                  className="w-full rounded-lg border border-zinc-100"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <button
        onClick={onDownload}
        disabled={drafting}
        className="mt-4 w-full rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {drafting ? "작성이 끝나면 다운로드할 수 있어요…" : "⬇️ Word(.docx)로 다운로드 (도식 포함)"}
      </button>
    </div>
  );
}
