"use client";

import { useEffect, useRef, useState } from "react";
import { driver } from "driver.js";
import "driver.js/dist/driver.css";
import type { Recommendation, Program } from "@/lib/match/types";
import { PLAN_SECTIONS } from "@/lib/plan/sections";

type Role = "user" | "assistant";
interface ChatImage {
  mediaType: string;
  data: string; // base64 (no prefix)
}
interface Msg {
  role: Role;
  content: string;
  images?: ChatImage[];
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
const PLAN_MIN_TURNS = 5; // 2차 대화를 최소 이만큼 한 뒤에야 초안 작성 가능
const PRICE = "29,900원";
const PAYMENT_URL = "https://pf.kakao.com/_xbrxjxkxj/chat"; // BCC 카카오 채널
const BANK = { name: "부산은행", account: "101-2090-179-808", holder: "비즈니스커리어컨설팅" };
// 도구 유입 고객이 카톡에 보낼 메시지(표식 [사업계획서] 포함 → 사장님 자동응답 키워드로 구분).
const PAY_MSG = "[사업계획서] 이용권 입금했어요! 입금자명: ";

// ── 대화 기록(이 브라우저에 저장) ──
const LS_KEY = "govplan_convos_v1";
interface SavedConvo {
  id: string;
  title: string;
  updatedAt: number;
  messages: { role: Role; content: string }[];
}
function loadConvos(): SavedConvo[] {
  if (typeof window === "undefined") return [];
  try {
    const arr = JSON.parse(localStorage.getItem(LS_KEY) || "[]");
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
function persistConvos(list: SavedConvo[]) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(list));
  } catch {
    /* 용량 초과 등은 무시 */
  }
}
function genId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function Chat() {
  const [messages, setMessages] = useState<Msg[]>([{ role: "assistant", content: GREETING }]);
  const [input, setInput] = useState("");
  const [pendingImages, setPendingImages] = useState<ChatImage[]>([]);
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
  const [planStartIdx, setPlanStartIdx] = useState(0); // 2차 대화 시작 지점

  const [convoId, setConvoId] = useState<string>("");
  const [convos, setConvos] = useState<SavedConvo[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const userTurns = messages.filter((m) => m.role === "user").length;
  const planUserTurns = messages.slice(planStartIdx).filter((m) => m.role === "user").length;

  function startTour() {
    const d = driver({
      showProgress: true,
      nextBtnText: "다음 →",
      prevBtnText: "← 이전",
      doneBtnText: "시작하기",
      steps: [
        {
          popover: {
            title: "환영해요! 👋",
            description:
              "대화만 하면, 나에게 맞는 정부지원사업을 찾아주고 사업계획서까지 써드려요. 어려운 용어는 몰라도 괜찮아요!",
          },
        },
        {
          element: '[data-tour="input"]',
          popover: {
            title: "여기에 답을 적어요 ✍️",
            description: "편하게 대화하듯 답해 주세요. 챗봇이 하나씩 물어봐요.",
          },
        },
        {
          element: '[data-tour="send"]',
          popover: {
            title: "보내기",
            description:
              "몇 번 대화하면 입력창 위에 '✨ 지원사업 추천받기' 버튼이 생겨요. 누르면 나에게 맞는 사업이 나와요!",
          },
        },
        {
          element: '[data-tour="provider"]',
          popover: {
            title: "AI 고르기",
            description: "Claude 또는 ChatGPT 중에 골라 쓸 수 있어요. (기본은 Claude)",
          },
        },
        {
          element: '[data-tour="history"]',
          popover: {
            title: "지난 대화 보기 🕘",
            description: "예전에 나눈 대화를 여기서 다시 볼 수 있어요.",
          },
        },
        {
          popover: {
            title: "그럼 시작해볼까요? 😊",
            description: "먼저 '운영 중인 사업이 있는지, 준비 중인지'부터 답해보세요!",
          },
        },
      ],
    });
    d.drive();
  }

  // 첫 진입: 튜토리얼 1회 자동 실행
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (localStorage.getItem("tour_seen_v1")) return;
    const t = setTimeout(() => {
      try {
        startTour();
        localStorage.setItem("tour_seen_v1", "1");
      } catch {
        /* ignore */
      }
    }, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 첫 진입: 저장된 대화 불러오기 + 가장 최근 대화를 화면에 이어서 보여줌
  // (새로고침해도 대화가 사라지지 않게)
  useEffect(() => {
    const list = loadConvos();
    setConvos(list);
    const recent = list.find((c) => c.messages.some((m) => m.role === "user"));
    if (recent) {
      setMessages(recent.messages.map((m) => ({ role: m.role, content: m.content })));
      setConvoId(recent.id);
    } else {
      setConvoId(genId());
    }
  }, []);

  // 대화가 바뀔 때마다 이 브라우저에 자동 저장(이미지 제외, 사용자 발화 있을 때만)
  useEffect(() => {
    if (!convoId) return;
    const firstUser = messages.find((m) => m.role === "user");
    if (!firstUser) return;
    const title = firstUser.content.trim().slice(0, 30) || "새 대화";
    const stripped = messages.map((m) => ({ role: m.role, content: m.content }));
    setConvos((prev) => {
      const others = prev.filter((c) => c.id !== convoId);
      const next = [{ id: convoId, title, updatedAt: Date.now(), messages: stripped }, ...others].slice(0, 50);
      persistConvos(next);
      return next;
    });
  }, [messages, convoId]);

  function newChat() {
    setMessages([{ role: "assistant", content: GREETING }]);
    setRecs(null);
    setDraft(null);
    setCharts(null);
    setSelectedProgram(null);
    setCode("");
    setMode("intake");
    setPendingImages([]);
    setInput("");
    setConvoId(genId());
    setHistoryOpen(false);
  }

  function loadChat(c: SavedConvo) {
    setMessages(
      c.messages.length > 0
        ? c.messages.map((m) => ({ role: m.role, content: m.content }))
        : [{ role: "assistant", content: GREETING }],
    );
    setRecs(null);
    setDraft(null);
    setCharts(null);
    setSelectedProgram(null);
    setMode("intake");
    setPendingImages([]);
    setInput("");
    setConvoId(c.id);
    setHistoryOpen(false);
  }

  function deleteChat(id: string) {
    setConvos((prev) => {
      const next = prev.filter((c) => c.id !== id);
      persistConvos(next);
      return next;
    });
    if (id === convoId) newChat();
  }

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

  // 추천/작성/도식 호출엔 이미지를 빼고 텍스트만 보냄(비용·토큰 절약).
  function stripImages(ms: Msg[]) {
    return ms.map(({ role, content }) => ({ role, content }));
  }

  async function handleFiles(files: FileList | null) {
    if (!files) return;
    const next: ChatImage[] = [];
    for (const f of Array.from(files).slice(0, 3)) {
      if (!f.type.startsWith("image/")) {
        alert("지금은 이미지 파일만 첨부할 수 있어요.");
        continue;
      }
      if (f.size > 4 * 1024 * 1024) {
        alert(`${f.name}: 이미지는 4MB 이하만 가능해요.`);
        continue;
      }
      const data = await new Promise<string>((res) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(",")[1] ?? "");
        r.readAsDataURL(f);
      });
      if (data) next.push({ mediaType: f.type, data });
    }
    setPendingImages((p) => [...p, ...next].slice(0, 3));
  }

  async function send() {
    const text = input.trim();
    if ((!text && pendingImages.length === 0) || busy || mode === "paywall") return;
    const userMsg: Msg = {
      role: "user",
      content: text,
      ...(pendingImages.length > 0 ? { images: pendingImages } : {}),
    };
    const history = [...messages, userMsg];
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setPendingImages([]);
    setBusy(true);

    const endpoint = mode === "plan" ? "/api/plan/chat" : "/api/chat";
    const payload =
      mode === "plan"
        ? { messages: history, code, program: selectedProgram, provider }
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

  async function fetchRecs(append: boolean) {
    if (recommending || busy) return;
    setRecommending(true);
    if (!append) setRecs(null);
    try {
      const excludeIds = append && recs ? recs.map((r) => r.program.id) : [];
      const res = await fetch("/api/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: stripImages(messages), provider, excludeIds }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessages((m) => [...m, { role: "assistant", content: data?.error ?? "추천을 가져오지 못했어요." }]);
        return;
      }
      setUsingSample(Boolean(data.usingSample));
      const incoming: Recommendation[] = Array.isArray(data.recommendations) ? data.recommendations : [];
      if (append) {
        if (incoming.length === 0) {
          setMessages((m) => [
            ...m,
            { role: "assistant", content: "음, 더 찾아봤는데 추가로 딱 맞는 사업이 안 보여요. 대화를 조금 더 들려주시면 다시 찾아볼게요!" },
          ]);
        } else {
          setRecs((prev) => {
            const seen = new Set((prev ?? []).map((r) => r.program.id));
            return [...(prev ?? []), ...incoming.filter((r) => !seen.has(r.program.id))];
          });
        }
      } else {
        setRecs(incoming);
      }
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "추천을 가져오는 중 연결이 끊겼어요." }]);
    } finally {
      setRecommending(false);
    }
  }
  const recommend = () => fetchRecs(false);
  const recommendMore = () => fetchRecs(true);

  function chooseProgram(p: Program) {
    setSelectedProgram(p);
    if (code) enterPlanMode(p);
    else setMode("paywall");
  }

  function enterPlanMode(p: Program) {
    setMode("plan");
    setDraft(null);
    setCharts(null);
    setMessages((m) => {
      setPlanStartIdx(m.length); // 여기 이후의 사용자 답변이 2차 대화
      return [
        ...m,
        {
          role: "assistant",
          content: `✅ 이용권이 확인됐어요! 지금부터 '${p.title}' 사업계획서를 함께 써볼게요. 📝\n\n가장 정확하게 도와드리려면, 먼저 아래 두 가지를 📎로 **첨부**해 주세요:\n\n1️⃣ 이 사업의 **공고문** (방금 '공고 원문 보기'에서 받은 것)\n2️⃣ **사업계획서 양식** 파일 (다운로드 받으셨다면)\n\n📷 캡처(사진)로 올려주셔도 돼요! 제가 그 양식을 꼼꼼히 읽고, **요구하는 항목·순서 그대로** 심사위원 관점에서 하나씩 코칭하며 써드릴게요.\n\n(혹시 지금 파일이 없으면 "없어요" 라고 답해 주세요 — 일반적인 사업계획서 흐름으로 바로 시작할게요!)`,
        },
      ];
    });
    // 아래 입력창으로 시선·커서 유도
    setTimeout(() => {
      inputRef.current?.focus();
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    }, 350);
  }

  async function verifyCode(entered: string): Promise<{ ok: boolean; reason?: string }> {
    const res = await fetch("/api/plan/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: entered, programId: selectedProgram?.id }),
    });
    const data = await res.json();
    return { ok: Boolean(data?.ok), reason: data?.reason };
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
            messages: stripImages(messages),
            code,
            program: selectedProgram,
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
        body: JSON.stringify({
          messages: stripImages(messages),
          code,
          program: selectedProgram,
          provider,
        }),
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
      body: JSON.stringify({
        code,
        programId: selectedProgram?.id,
        title: draft.title,
        sections: draft.sections,
        charts: charts ?? [],
      }),
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
    <main className="relative flex h-[100dvh] flex-col overflow-hidden bg-white">
      <header className="border-b border-zinc-100 px-5 py-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2">
            <button
              onClick={() => setHistoryOpen(true)}
              title="내 대화 기록"
              data-tour="history"
              className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100"
            >
              🕘
            </button>
            <div>
              <h1 className="text-base font-semibold">정부지원사업 사업계획서 도우미</h1>
              <p className="mt-0.5 text-xs text-zinc-500">
                편하게 대화하듯 답해 주세요. 나에게 맞는 지원사업을 찾아 드릴게요.
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              onClick={startTour}
              title="사용법 다시 보기"
              className="flex h-8 items-center rounded-lg px-2 text-xs font-medium text-zinc-500 hover:bg-zinc-100"
            >
              ❓ 사용법
            </button>
            <div
              data-tour="provider"
              className="flex items-center gap-0.5 rounded-full bg-zinc-100 p-0.5 text-xs"
            >
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
        </div>
      </header>

      {mode === "plan" && (
        <div className="border-b border-blue-100 bg-blue-50 px-5 py-2.5 text-xs font-semibold text-blue-800">
          ✅ 이용권 확인 완료 · <span className="text-blue-900">{selectedProgram?.title}</span> 사업계획서
          작성 중 — 아래 질문에 답해 주세요 ↓
        </div>
      )}

      {historyOpen && (
        <div className="absolute inset-0 z-30 flex">
          <div className="flex-1 bg-black/20" onClick={() => setHistoryOpen(false)} />
          <div className="flex w-64 max-w-[80%] flex-col bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-100 px-3 py-3">
              <span className="text-sm font-semibold">내 대화 기록</span>
              <button onClick={() => setHistoryOpen(false)} className="text-zinc-400 hover:text-zinc-700">
                ✕
              </button>
            </div>
            <button
              onClick={newChat}
              className="m-2 rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
              ＋ 새 대화 시작
            </button>
            <div className="flex-1 overflow-y-auto">
              {convos.length === 0 && (
                <p className="px-3 py-4 text-xs text-zinc-400">저장된 대화가 아직 없어요.</p>
              )}
              {convos.map((c) => (
                <div
                  key={c.id}
                  className={`flex items-center gap-1 px-2 ${c.id === convoId ? "bg-blue-50" : ""}`}
                >
                  <button
                    onClick={() => loadChat(c)}
                    className="flex-1 truncate py-2.5 text-left text-sm text-zinc-700"
                  >
                    {c.title}
                  </button>
                  <button
                    onClick={() => deleteChat(c.id)}
                    title="삭제"
                    className="shrink-0 px-1 text-zinc-300 hover:text-red-500"
                  >
                    🗑
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {mode === "paywall" && selectedProgram && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setMode("intake")}
        >
          <div
            className="relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setMode("intake")}
              aria-label="닫기"
              className="absolute right-3 top-3 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 hover:bg-zinc-200"
            >
              ✕
            </button>
            <Paywall
              program={selectedProgram}
              onUnlock={(c) => {
                setCode(c);
                enterPlanMode(selectedProgram);
              }}
              onCancel={() => setMode("intake")}
              verifyCode={verifyCode}
            />
          </div>
        </div>
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
        {/* 1단계: 인테이크 대화 (+추천) — 작성 단계에서도 위에 그대로 보임 */}
        {(mode === "plan" ? messages.slice(0, planStartIdx) : messages).map((m, i) => (
          <Bubble key={i} m={m} busy={busy} />
        ))}

        {recommending && (
          <div className="mr-auto rounded-2xl bg-zinc-100 px-4 py-3 text-sm text-zinc-600">
            맞는 지원사업을 찾는 중이에요… 🔎
          </div>
        )}

        {recs && (
          <Recommendations
            recs={recs}
            usingSample={usingSample}
            onChoose={chooseProgram}
            onMore={recommendMore}
            loadingMore={recommending}
          />
        )}

        {/* 2단계: 사업계획서 작성 — 구분선으로 명확히 분리 */}
        {mode === "plan" && (
          <>
            <div className="flex items-center gap-2 py-1">
              <div className="h-px flex-1 bg-blue-200" />
              <span className="shrink-0 rounded-full bg-blue-600 px-3 py-1 text-[11px] font-bold text-white">
                ✍️ 여기서부터 사업계획서 작성
              </span>
              <div className="h-px flex-1 bg-blue-200" />
            </div>
            {messages.slice(planStartIdx).map((m, i) => (
              <Bubble key={`plan-${i}`} m={m} busy={busy} />
            ))}
          </>
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
          {mode === "intake" && userTurns >= 1 && !recs && (
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
                disabled={drafting || busy || planUserTurns < PLAN_MIN_TURNS}
                className="w-full rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
              >
                {drafting
                  ? "초안과 도식을 만드는 중이에요…"
                  : planUserTurns < PLAN_MIN_TURNS
                    ? `📄 초안 만들기 — 대화를 조금 더 해주세요 (${planUserTurns}/${PLAN_MIN_TURNS})`
                    : "📄 사업계획서 초안 만들기"}
              </button>
              {planUserTurns < PLAN_MIN_TURNS && (
                <p className="mt-1.5 text-center text-[11px] text-zinc-400">
                  질문에 충분히 답할수록 사업계획서가 좋아져요. 위 대화를 이어가 주세요.
                </p>
              )}
            </div>
          )}

          <div className="border-t border-zinc-100 p-4">
            {pendingImages.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {pendingImages.map((im, k) => (
                  <div key={k} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`data:${im.mediaType};base64,${im.data}`}
                      alt="첨부"
                      className="h-16 w-16 rounded-lg object-cover"
                    />
                    <button
                      onClick={() => setPendingImages((p) => p.filter((_, i) => i !== k))}
                      className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-zinc-800 text-xs text-white"
                      aria-label="첨부 제거"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-end gap-2">
              <label className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full border border-zinc-200 text-lg text-zinc-500 hover:bg-zinc-50">
                📎
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    handleFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
              </label>
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                rows={1}
                data-tour="input"
                placeholder="여기에 답을 입력하세요… (📎로 사진 첨부)"
                className="max-h-32 flex-1 resize-none rounded-2xl border border-zinc-200 px-4 py-2.5 text-sm outline-none focus:border-blue-500"
              />
              <button
                onClick={send}
                disabled={busy || (!input.trim() && pendingImages.length === 0)}
                data-tour="send"
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

function Bubble({ m, busy }: { m: Msg; busy: boolean }) {
  return (
    <div
      className={
        m.role === "user"
          ? "ml-auto max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-blue-600 px-4 py-3 text-sm leading-6 text-white"
          : "mr-auto max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-zinc-100 px-4 py-3 text-sm leading-6 text-zinc-900"
      }
    >
      {m.images && m.images.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {m.images.map((im, k) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={k}
              src={`data:${im.mediaType};base64,${im.data}`}
              alt="첨부 이미지"
              className="h-20 w-20 rounded-lg object-cover"
            />
          ))}
        </div>
      )}
      {m.content || (busy ? "…" : "")}
    </div>
  );
}

function Recommendations({
  recs,
  usingSample,
  onChoose,
  onMore,
  loadingMore,
}: {
  recs: Recommendation[];
  usingSample: boolean;
  onChoose: (p: Program) => void;
  onMore: () => void;
  loadingMore: boolean;
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
      <div className="rounded-xl bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-800">
        마음에 드는 사업의 <b>「사업계획서 쓰기」</b> 버튼을 누르면, 그 사업에 맞춰 AI가
        사업계획서를 처음부터 끝까지 함께 써드려요. (공고 원문은 참고용이에요)
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
          {r.whatItIs && (
            <div className="mt-2 rounded-lg bg-zinc-50 px-3 py-2 text-xs leading-5 text-zinc-600">
              <span className="font-semibold text-zinc-700">💡 어떤 사업이냐면</span> {r.whatItIs}
            </div>
          )}
          <p className="mt-2 text-sm leading-6 text-zinc-700">
            <span className="font-semibold text-blue-700">나에게 맞는 이유</span> {r.fitReason}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-zinc-500">
            <span className="rounded bg-zinc-100 px-1.5 py-0.5">{r.program.supportField}</span>
            <span className="rounded bg-zinc-100 px-1.5 py-0.5">{r.program.region}</span>
          </div>
          <button
            onClick={() => onChoose(r.program)}
            className="mt-3 w-full rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
          >
            📝 이 사업으로 사업계획서 쓰기
          </button>
          <a
            href={r.program.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 block text-center text-xs text-zinc-500 hover:underline"
          >
            공고 원문 보기 ↗
          </a>
        </div>
      ))}
      <button
        onClick={onMore}
        disabled={loadingMore}
        className="w-full rounded-xl border border-blue-200 bg-white py-2.5 text-sm font-semibold text-blue-700 transition-colors hover:bg-blue-50 disabled:opacity-50"
      >
        {loadingMore ? "다른 사업을 더 찾는 중이에요…" : "🔄 마음에 안 들면, 다른 지원사업 더 추천받기"}
      </button>

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
  verifyCode: (code: string) => Promise<{ ok: boolean; reason?: string }>;
}) {
  const [entered, setEntered] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!entered.trim() || checking) return;
    setChecking(true);
    setError("");
    const r = await verifyCode(entered.trim());
    setChecking(false);
    if (r.ok) onUnlock(entered.trim());
    else if (r.reason === "used_elsewhere")
      setError("이 코드는 다른 사업계획서에 이미 사용됐어요. 다른 지원사업은 새로 결제해 주세요.");
    else setError("코드가 맞지 않아요. 다시 확인해 주세요.");
  }

  function copyAccount() {
    navigator.clipboard?.writeText(BANK.account).then(
      () => alert("계좌번호를 복사했어요!"),
      () => {},
    );
  }
  function copyMessage() {
    navigator.clipboard?.writeText(PAY_MSG).then(
      () => alert("메시지를 복사했어요! 카카오톡에 붙여넣고 성함을 적어 보내주세요."),
      () => {},
    );
  }

  return (
    <div className="rounded-2xl border border-blue-200 bg-blue-50/50 p-5">
      <h3 className="text-sm font-bold text-zinc-900">💳 사업계획서 이용권 · {PRICE}</h3>
      <p className="mt-1 text-sm leading-6 text-zinc-700">
        <b>{program.title}</b>에 맞춰 AI랑 대화하며 사업계획서 초안을 완성하고 <b>Word 파일</b>(도식 포함)로
        다운로드할 수 있어요.
      </p>

      {/* 1단계: 입금 */}
      <div className="mt-3 rounded-xl border border-zinc-200 bg-white p-3">
        <div className="text-xs font-semibold text-zinc-500">① 아래 계좌로 {PRICE} 입금</div>
        <div className="mt-1 flex items-center justify-between gap-2">
          <div className="text-sm font-bold text-zinc-900">
            {BANK.name} {BANK.account}
          </div>
          <button
            onClick={copyAccount}
            className="shrink-0 rounded-lg bg-zinc-100 px-2 py-1 text-xs font-semibold text-zinc-600 hover:bg-zinc-200"
          >
            복사
          </button>
        </div>
        <div className="text-xs text-zinc-500">예금주: {BANK.holder}</div>
      </div>

      {/* 2단계: 카톡으로 알리기 (표식 메시지 복사 → 붙여넣기) */}
      <div className="mt-2 rounded-xl border border-zinc-200 bg-white p-3">
        <div className="text-xs font-semibold text-zinc-500">② 입금 후, 카카오톡으로 알려주세요</div>
        <p className="mt-1 text-[11px] leading-4 text-zinc-500">
          아래 메시지를 <b>복사</b>해서 카톡에 <b>붙여넣고</b>, 성함만 바꿔 보내면 돼요. (자동으로 입력되진 않아요)
        </p>
        <div className="mt-1.5 flex items-center justify-between gap-2 rounded-lg bg-zinc-50 px-2 py-1.5">
          <code className="truncate text-xs text-zinc-700">{PAY_MSG}홍길동</code>
          <button
            onClick={copyMessage}
            className="shrink-0 rounded-lg bg-zinc-200 px-2 py-1 text-xs font-semibold text-zinc-700 hover:bg-zinc-300"
          >
            1. 메시지 복사
          </button>
        </div>
        <a
          href={PAYMENT_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 block rounded-xl bg-[#FEE500] py-2.5 text-center text-sm font-bold text-[#181600] hover:brightness-95"
        >
          2. 카카오톡 열기 → 붙여넣기(꾹 눌러) → 보내기
        </a>
      </div>

      <p className="mt-2 text-xs leading-5 text-zinc-500">
        입금 확인 후 이용권 코드를 보내드려요(보통 빠르게). 코드를 받으면 아래에 입력하세요.
      </p>

      {/* 3단계: 코드 입력 */}
      <div className="mt-3">
        <label className="text-xs font-semibold text-zinc-600">③ 이용권 코드 입력</label>
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
