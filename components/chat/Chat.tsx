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
interface ChatFile {
  mediaType: string; // application/pdf
  data: string; // base64 (no prefix)
  name: string;
}
interface ChatDoc {
  name: string;
  text: string; // 워드 등에서 뽑아낸 글자 (전송 시 content에 합쳐짐)
}
interface Msg {
  role: Role;
  content: string;
  images?: ChatImage[];
  files?: ChatFile[];
  docs?: ChatDoc[];
}
type Mode = "intake" | "fitcheck" | "paywall" | "plan";
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
const READY_MARK = "[추천준비완료]"; // 인테이크 완료 신호(사용자에겐 숨김)
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
  const [pendingFiles, setPendingFiles] = useState<ChatFile[]>([]);
  const [pendingDocs, setPendingDocs] = useState<ChatDoc[]>([]);
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
  // 인테이크에서 핵심 정보(운영상태·업력·지역·나이·업종·필요한 도움)를 다 들으면 AI가 신호를 보냄.
  // 신호를 못 받아도 충분히 대화(6턴)하면 잠기지 않게 풀어줌(안전장치).
  const readyToRecommend =
    messages.some((m) => m.role === "assistant" && m.content.includes(READY_MARK)) ||
    userTurns >= 6;
  const programStage = mode === "fitcheck" || mode === "plan";

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

  // 워드에서 뽑은 글자를 전송 직전 content에 합쳐줌 (화면엔 칩으로만 표시)
  function foldDocs(ms: Msg[]): Msg[] {
    return ms.map((m) => {
      if (!m.docs || m.docs.length === 0) return m;
      const note = m.docs
        .map((d) => `\n\n[첨부한 문서 "${d.name}"의 내용]\n${d.text}`)
        .join("");
      const { docs: _drop, ...rest } = m;
      void _drop;
      return { ...rest, content: (m.content || "") + note };
    });
  }

  function readBase64(f: File): Promise<string> {
    return new Promise((res) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result).split(",")[1] ?? "");
      r.readAsDataURL(f);
    });
  }

  async function handleFiles(files: FileList | null) {
    if (!files) return;
    const imgs: ChatImage[] = [];
    const pdfs: ChatFile[] = [];
    const wordDocs: ChatDoc[] = [];
    for (const f of Array.from(files).slice(0, 3)) {
      const lower = f.name.toLowerCase();
      const isImage = f.type.startsWith("image/");
      const isPdf = f.type === "application/pdf" || lower.endsWith(".pdf");
      const isWord = lower.endsWith(".docx");
      const isHwp = lower.endsWith(".hwp") || lower.endsWith(".hwpx");
      if (isHwp) {
        alert(
          `${f.name}: 한글(HWP) 파일은 아직 바로 못 읽어요.\n한글에서 '파일 → PDF로 저장(또는 인쇄→PDF)' 한 뒤 그 PDF를 올려주세요. (또는 화면 캡처)`,
        );
        continue;
      }
      if (!isImage && !isPdf && !isWord) {
        alert(`${f.name}: 사진(JPG/PNG), PDF, 워드(.docx)만 첨부할 수 있어요.`);
        continue;
      }
      if (f.size > 3 * 1024 * 1024) {
        alert(`${f.name}: 파일은 3MB 이하만 가능해요. (크면 필요한 페이지만 캡처해서 사진으로 올려주세요.)`);
        continue;
      }
      if (isWord) {
        // 워드는 브라우저에서 글자만 뽑아 텍스트로 전송 (용량·API 제약 회피)
        try {
          const mod = await import("mammoth/mammoth.browser");
          const extractRawText = mod.extractRawText ?? mod.default?.extractRawText;
          const arrayBuffer = await f.arrayBuffer();
          const { value } = await extractRawText({ arrayBuffer });
          const text = (value || "").trim();
          if (!text) {
            alert(`${f.name}: 워드에서 글자를 읽지 못했어요. PDF로 저장해서 올려주세요.`);
            continue;
          }
          wordDocs.push({ name: f.name, text });
        } catch {
          alert(`${f.name}: 워드를 읽는 중 문제가 생겼어요. PDF로 저장해서 올려주세요.`);
        }
        continue;
      }
      const data = await readBase64(f);
      if (!data) continue;
      if (isImage) imgs.push({ mediaType: f.type, data });
      else pdfs.push({ mediaType: "application/pdf", data, name: f.name });
    }
    if (imgs.length) setPendingImages((p) => [...p, ...imgs].slice(0, 3));
    if (pdfs.length) setPendingFiles((p) => [...p, ...pdfs].slice(0, 3));
    if (wordDocs.length) setPendingDocs((p) => [...p, ...wordDocs].slice(0, 3));
  }

  async function send() {
    const text = input.trim();
    if (
      (!text &&
        pendingImages.length === 0 &&
        pendingFiles.length === 0 &&
        pendingDocs.length === 0) ||
      busy ||
      mode === "paywall"
    )
      return;
    const userMsg: Msg = {
      role: "user",
      content: text,
      ...(pendingImages.length > 0 ? { images: pendingImages } : {}),
      ...(pendingFiles.length > 0 ? { files: pendingFiles } : {}),
      ...(pendingDocs.length > 0 ? { docs: pendingDocs } : {}),
    };
    const history = [...messages, userMsg];
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setPendingImages([]);
    setPendingFiles([]);
    setPendingDocs([]);
    setBusy(true);

    const endpoint =
      mode === "plan"
        ? "/api/plan/chat"
        : mode === "fitcheck"
          ? "/api/plan/fitcheck"
          : "/api/chat";
    const payload =
      mode === "plan"
        ? { messages: foldDocs(history), code, program: selectedProgram, provider }
        : mode === "fitcheck"
          ? { messages: foldDocs(history), program: selectedProgram, provider }
          : { messages: stripImages(history), provider }; // 추천(intake)은 가벼운 텍스트만

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

  function focusInput() {
    setTimeout(() => {
      inputRef.current?.focus();
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    }, 350);
  }

  // 적합도 확인에서 "이건 말고 맞는 사업 찾아줘" → 추천 흐름으로 전환
  function switchToFind() {
    setMode("intake");
    setSelectedProgram(null);
    setRecs(null);
    setDraft(null);
    setCharts(null);
    setMessages((m) => [
      ...m,
      {
        role: "assistant",
        content: `네! 그럼 사장님께 맞는 지원사업을 찾아드릴게요. 🔎\n\n간단히 알려주세요:\n① 어떤 사업을 하세요(또는 준비 중)?\n② 어느 지역이세요?\n③ 나이대는요?\n④ 사업 시작한 지 얼마나 됐나요? (예비 / ○년차)\n⑤ 가장 필요한 도움은요? (자금 · 공간 · 판로 · 멘토링)\n\n(이미 위에서 말씀하신 게 있으면 빼고 답하셔도 돼요!)`,
      },
    ]);
    focusInput();
  }

  // 추천을 거치지 않고, 사용자가 가진 공고문/양식으로 바로 시작 (무료 확인 → 결제 → 작성)
  function startDirect() {
    const custom: Program = {
      id: `custom:${genId()}`,
      title: "직접 올린 공고문·양식",
      summary: "",
      target: "",
      supportField: "",
      region: "",
      applyEnd: null,
      url: "",
      formUrl: null,
      source: "sample",
    };
    setSelectedProgram(custom);
    setMode("fitcheck");
    setDraft(null);
    setCharts(null);
    setMessages((m) => {
      setPlanStartIdx(m.length);
      return [
        ...m,
        {
          role: "assistant",
          content: `좋아요! 이미 쓰고 싶은 사업이 있으시군요. 👍\n\n📎로 **그 사업의 공고문**과 **사업계획서 양식**을 올려주세요. (사진·PDF·워드 OK)\n\n제가 먼저 **무료로** 내용을 읽고, 사장님 사업과 맞는지·어떤 항목을 써야 하는지 알려드릴게요. 작성은 마음에 드실 때 결제하시면 돼요!\n\n(공고문이 없으면, 어떤 사업에 낼 건지 말씀해 주셔도 돼요.)`,
        },
      ];
    });
    focusInput();
  }

  // ① (무료) 공고문/양식 첨부 → 내 사업과 맞는지 확인
  function chooseProgram(p: Program) {
    setSelectedProgram(p);
    setMode("fitcheck");
    setDraft(null);
    setCharts(null);
    setMessages((m) => {
      setPlanStartIdx(m.length); // 이 사업 단계의 시작점
      return [
        ...m,
        {
          role: "assistant",
          content: `'${p.title}'를 고르셨네요! 👍\n\n바로 결제하지 마시고, **먼저 이 사업이 사장님 사업과 잘 맞는지 무료로 확인**해드릴게요.\n\n📎로 아래를 올려주세요:\n1️⃣ 이 사업의 **공고문** (방금 '공고 원문 보기'에서 받은 것)\n2️⃣ **사업계획서 양식** 파일\n\n📷 사진·PDF·워드 다 돼요! 제가 꼼꼼히 읽고 **사장님 아이템과 맞는지 / 자격(업력·지역·나이)이 되는지** 솔직하게 알려드릴게요.\n\n(파일이 없으면 사장님 사업을 한두 줄로 말씀해 주셔도 돼요!)`,
        },
      ];
    });
    focusInput();
  }

  // ③ (결제 후) 본격 작성 시작 — 앞서 올린 문서/대화를 그대로 이어서
  function enterPlanMode(p: Program) {
    setMode("plan");
    setDraft(null);
    setCharts(null);
    setMessages((m) => [
      ...m,
      {
        role: "assistant",
        content: `✅ 결제가 확인됐어요! 이제 '${p.title}' 사업계획서를 본격적으로 써드릴게요. 📝\n앞에서 보여주신 공고문·양식과 사업 내용을 바탕으로, 양식이 요구하는 항목 순서대로 하나씩 채워볼게요.\n\n이어서 답해 주세요 👇`,
      },
    ]);
    focusInput();
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

      {mode === "fitcheck" && (
        <div className="border-b border-amber-100 bg-amber-50 px-5 py-2.5 text-xs font-semibold text-amber-800">
          🔎 무료 적합도 확인 · <span className="text-amber-900">{selectedProgram?.title}</span> — 공고문·양식을
          올리면 내 사업과 맞는지 알려드려요 (결제 전이에요)
        </div>
      )}
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
          onClick={() => setMode("fitcheck")}
        >
          <div
            className="relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setMode("fitcheck")}
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
              onCancel={() => setMode("fitcheck")}
              verifyCode={verifyCode}
            />
          </div>
        </div>
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
        {/* 1단계: 인테이크 대화 (+추천) — 사업 선택 후에도 위에 그대로 보임 */}
        {(programStage ? messages.slice(0, planStartIdx) : messages).map((m, i) => (
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

        {/* 2단계: 선택한 사업 (적합도 확인 → 작성) — 구분선으로 명확히 분리 */}
        {programStage && (
          <>
            <div className="flex items-center gap-2 py-1">
              <div className="h-px flex-1 bg-blue-200" />
              <span className="shrink-0 rounded-full bg-blue-600 px-3 py-1 text-[11px] font-bold text-white">
                {mode === "fitcheck" ? "🔎 여기서부터 적합도 확인 (무료)" : "✍️ 여기서부터 사업계획서 작성"}
              </span>
              <div className="h-px flex-1 bg-blue-200" />
            </div>
            {messages.slice(planStartIdx).map((m, i) => (
              <Bubble key={`stage-${i}`} m={m} busy={busy} />
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
                disabled={recommending || busy || !readyToRecommend}
                className="w-full rounded-xl bg-blue-50 py-2.5 text-sm font-semibold text-blue-700 transition-colors hover:bg-blue-100 disabled:opacity-50"
              >
                {readyToRecommend
                  ? "✨ 이 내용으로 지원사업 추천받기"
                  : "✨ 추천받기 — 몇 가지만 더 답해 주세요"}
              </button>
              {!readyToRecommend && (
                <p className="mt-1.5 text-center text-[11px] text-zinc-400">
                  나에게 안 맞는 사업이 추천되지 않도록, 위 질문(지역·업력·나이 등)에 답해 주세요.
                </p>
              )}
            </div>
          )}
          {mode === "intake" && !recs && (
            <div className="px-4 pt-2">
              <button
                onClick={startDirect}
                className="w-full rounded-xl border border-zinc-200 py-2 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-50"
              >
                📄 이미 정한 공고문·양식이 있어요 → 바로 작성하기
              </button>
            </div>
          )}
          {mode === "fitcheck" && (
            <div className="border-t border-zinc-100 px-4 pt-3">
              <button
                onClick={() => setMode("paywall")}
                className="w-full rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
              >
                ✍️ 이 사업으로 사업계획서 쓰기 · {PRICE}
              </button>
              <button
                onClick={switchToFind}
                className="mt-2 w-full rounded-xl border border-zinc-200 py-2 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-50"
              >
                🔄 이 사업 말고, 나에게 맞는 지원사업 찾아줘
              </button>
              <p className="mt-1.5 text-center text-[11px] text-zinc-400">
                맞는지 먼저 확인하세요. 작성을 시작할 때만 결제하면 돼요.
              </p>
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
            {(pendingImages.length > 0 || pendingFiles.length > 0 || pendingDocs.length > 0) && (
              <div className="mb-2 flex flex-wrap gap-2">
                {pendingImages.map((im, k) => (
                  <div key={`img-${k}`} className="relative">
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
                {pendingFiles.map((f, k) => (
                  <div
                    key={`file-${k}`}
                    className="relative flex max-w-[200px] items-center gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-2 text-xs text-zinc-700"
                  >
                    <span>📄</span>
                    <span className="truncate">{f.name}</span>
                    <button
                      onClick={() => setPendingFiles((p) => p.filter((_, i) => i !== k))}
                      className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-zinc-800 text-xs text-white"
                      aria-label="첨부 제거"
                    >
                      ×
                    </button>
                  </div>
                ))}
                {pendingDocs.map((d, k) => (
                  <div
                    key={`doc-${k}`}
                    className="relative flex max-w-[200px] items-center gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-2 text-xs text-zinc-700"
                  >
                    <span>📝</span>
                    <span className="truncate">{d.name}</span>
                    <button
                      onClick={() => setPendingDocs((p) => p.filter((_, i) => i !== k))}
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
                  accept="image/*,application/pdf,.pdf,.docx"
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
                placeholder="여기에 답을 입력하세요… (📎로 사진·PDF·워드 첨부)"
                className="max-h-32 flex-1 resize-none rounded-2xl border border-zinc-200 px-4 py-2.5 text-sm outline-none focus:border-blue-500"
              />
              <button
                onClick={send}
                disabled={
                  busy ||
                  (!input.trim() && pendingImages.length === 0 && pendingFiles.length === 0)
                }
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
      {((m.files && m.files.length > 0) || (m.docs && m.docs.length > 0)) && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {(m.files ?? []).map((f, k) => (
            <span
              key={`f${k}`}
              className="flex max-w-[200px] items-center gap-1 rounded-lg bg-black/10 px-2 py-1 text-xs"
            >
              📄 <span className="truncate">{f.name}</span>
            </span>
          ))}
          {(m.docs ?? []).map((d, k) => (
            <span
              key={`d${k}`}
              className="flex max-w-[200px] items-center gap-1 rounded-lg bg-black/10 px-2 py-1 text-xs"
            >
              📝 <span className="truncate">{d.name}</span>
            </span>
          ))}
        </div>
      )}
      {m.content.replace(READY_MARK, "").trimEnd() || (busy ? "…" : "")}
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
