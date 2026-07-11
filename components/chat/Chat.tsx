"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { driver } from "driver.js";
import "driver.js/dist/driver.css";
import type { Recommendation, Program } from "@/lib/match/types";
import { PLAN_SECTIONS } from "@/lib/plan/sections";
import { track } from "@/lib/ga";
import { captureUtm, getLeadSource } from "@/lib/utm";
import { useAuth, authedHeaders, forceRefreshToken, AuthModal } from "@/components/auth/AuthGate";
import { GROBLE_CHECKOUT_URL, PRICE_LABEL, PRICE_KRW } from "@/lib/config";
import {
  EvidenceDiagnosisForm,
  EvidenceSheetCard,
  DraftPreviewCard,
  PreStageCard,
} from "@/components/chat/EvidenceDiagnosis";
import DiagnosisWizard, { type WizardStart, type WizPayload } from "@/components/chat/DiagnosisWizard";
import {
  buildSheet,
  isPreStage,
  type EvidenceRow,
  type EvidenceSheet,
} from "@/lib/diagnosis/evidence";

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
interface Lead {
  id: string;
  name: string;
  contact: string;
}
interface SavedProgram {
  id: string;
  title: string;
  applyEnd: string | null;
  url: string;
  supportField: string;
  region: string;
  savedAt: number;
}
const LEAD_KEY = "gp_lead_v1";
const VIEWED_KEY = "gp_viewed_v1";
// 사업계획서 표준 양식(구글드라이브, 공개 뷰어) + K-Startup 모집중 공고 목록.
// 드라이브 폴더에 공고문·별첨 양식이 들어 있어 사용자가 바로 받아 써볼 수 있다.
const OFFICIAL_LINKS: { label: string; href: string }[] = [
  { label: "예비창업패키지 양식", href: "https://drive.google.com/drive/folders/1SkYXXPAGHo28h0BSsIw9KHUbAfZktpcS" },
  { label: "초기창업패키지 양식", href: "https://drive.google.com/drive/folders/1Y57CqqwsFdaoEcb12NbXqZFpOyDSdHrt" },
  { label: "K-Startup 모집중 공고", href: "https://www.k-startup.go.kr/web/contents/bizpbanc-ongoing.do" },
];
interface Msg {
  role: Role;
  content: string;
  images?: ChatImage[];
  files?: ChatFile[];
  docs?: ChatDoc[];
}
type Mode = "intake" | "fitcheck" | "diagnose" | "paywall" | "plan";
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
// 합격 가능성 진단 결과 (2026-07-10 확정 설계 — 전부 무료 공개, LLM 호출 0회)
type EvidenceResult =
  | { kind: "sheet"; sheet: EvidenceSheet }
  | { kind: "pre" };

const GREETING =
  "안녕하세요! 사장님께 맞는 정부지원사업을 같이 찾아볼게요. 😊\n무료로 어디까지 받을 수 있는지 아래에서 먼저 확인해 주세요!";
// 인테이크 앞단 3문항(단계·지역·연령) — 버튼/선택지로 받아 LLM 호출 없이 수집 (점검표 문제 8)
interface IntakeProfile {
  stage: string;
  region: string;
  ageGroup: string;
}
const PROFILE_STAGES = ["예비창업 준비 중", "운영 중(사업자 있음)"];
const PROFILE_REGIONS = [
  "전국(어디든 가능)", "서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종",
  "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주",
];
const PROFILE_AGES = ["20대", "30대", "40대", "50대", "60대 이상"];
const PLAN_MIN_TURNS = 5; // 2차 대화를 최소 이만큼 한 뒤에야 초안 작성 가능
const READY_MARK = "[추천준비완료]"; // 인테이크 완료 신호(사용자에겐 숨김)
const PRICE = PRICE_LABEL; // 판매가 표기 — 원본은 lib/config.ts (2026-07-11 그로블 신상품 가격)
// 합격 가능성 진단 안내 (2026-07-10 확정 설계 — 버튼 2화면, 타이핑 불필요)
const DIAGNOSE_INTRO =
  "좋아요! 사업계획서를 쓰기 전에, **지금 가진 실적이 어떤 합격 근거가 되는지** 1분 만에 확인해볼게요. 📋\n\n사람을 분석하는 게 아니라 **사업을 분석**하는 진단이에요. 아래에서 골라주시기만 하면 돼요 — 타이핑은 필요 없어요!";
// 후기 수집 팝업의 태그 선택지 (업무지시서 4-2)
const REVIEW_TAGS = [
  "막막했는데 구조가 잡혔다",
  "심사위원 관점으로 위험한 표현을 잡아줬다",
  "혼자선 못 쓸 부분을 채워줬다",
  "빠르게 초안이 나왔다",
  "어떤 사업에 맞는지 알려줬다",
];
// (구) 계좌이체+카톡+이용권 코드 흐름은 2026-07-09 그로블 주문번호 인증(Paywall)으로 대체됨.

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
  // 유료 전환 파이프(2026-07-09): 로그인 세션 + 결제 확인(is_paid) 상태.
  // ⚠️ 토큰은 컨텍스트 값을 저장해 쓰지 말 것 — 만료 버그(§11) 재발.
  //    모든 인증 요청은 authedHeaders()로 요청 직전에 신선한 토큰을 받는다.
  const { session, paid, setPaid, email, signOut } = useAuth();
  const [payOpen, setPayOpen] = useState(false); // 상단 [결제 확인] 메뉴로 여는 모달
  // 로그인 게이트 B안(2026-07-10): 진단 결과 보기 직전에 로그인 요구
  const [authOpen, setAuthOpen] = useState(false);
  const [pendingEvidence, setPendingEvidence] = useState<{ revenue: string; items: string[] } | null>(null);

  const [messages, setMessages] = useState<Msg[]>([{ role: "assistant", content: GREETING }]);
  const [input, setInput] = useState("");
  const [pendingImages, setPendingImages] = useState<ChatImage[]>([]);
  const [pendingFiles, setPendingFiles] = useState<ChatFile[]>([]);
  const [pendingDocs, setPendingDocs] = useState<ChatDoc[]>([]);
  const [busy, setBusy] = useState(false);
  const [recommending, setRecommending] = useState(false);
  const [recs, setRecs] = useState<Recommendation[] | null>(null);
  const [nearMisses, setNearMisses] = useState<Program[]>([]); // 추천 0건 시 근접 공고 (리드 수집 흐름)
  const [usingSample, setUsingSample] = useState(false);
  // GA4 단계 이벤트(v3): 세션당 한 번만 발화하도록 가드
  const chatStartedRef = useRef(false);
  const validationFiredRef = useRef(false);

  const [provider, setProvider] = useState<"claude" | "openai">("claude");
  const [mode, setMode] = useState<Mode>("intake");
  // 인테이크 앞단 3문항(버튼) 결과 — /api/match 사전 필터에도 전달
  const [profile, setProfile] = useState<IntakeProfile | null>(null);
  const [selectedProgram, setSelectedProgram] = useState<Program | null>(null);
  const [code, setCode] = useState<string>("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [charts, setCharts] = useState<Chart[] | null>(null);
  const [planStartIdx, setPlanStartIdx] = useState(0); // 2차 대화 시작 지점
  // 합격 가능성 진단 (2026-07-10 확정 설계) — 매핑표는 evidence_map 테이블(하드코딩 금지)
  const [evMap, setEvMap] = useState<EvidenceRow[] | null>(null);
  const [evMapError, setEvMapError] = useState(false);
  const [evResult, setEvResult] = useState<EvidenceResult | null>(null);
  const [evPrograms, setEvPrograms] = useState<Program[] | null>(null); // pre: 실적 만드는 공고
  const [evProgramsLoading, setEvProgramsLoading] = useState(false);
  // 초안 미리보기(2026-07-11 디자인수정) — 무료 결과와 결제 사이의 전환 화면 (구 대화 호환용)
  const [previewOpen, setPreviewOpen] = useState(false);
  // 진단 위저드(2026-07-12 전면 적용) — null이면 챗 화면, 아니면 해당 시작 지점의 전체 화면 흐름
  const [wizardStart, setWizardStart] = useState<WizardStart | null>(null);
  // 위저드에서 올린 공고·양식의 AI 분석(스트리밍 상태) — 결과 화면 '이 공고의 핵심' 블록에 표시
  const [wizAnalysis, setWizAnalysis] = useState<{ text: string; busy: boolean }>({ text: "", busy: false });
  const wizardActive = wizardStart !== null;
  // 후기 수집 팝업
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewDone, setReviewDone] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingText, setEditingText] = useState("");
  // 회원(리드) + 관심사업 캘린더
  const [lead, setLead] = useState<Lead | null>(null);
  const [saved, setSaved] = useState<SavedProgram[]>([]);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [signupOpen, setSignupOpen] = useState(false);
  const [signupName, setSignupName] = useState("");
  const [signupContact, setSignupContact] = useState("");
  const [signupBusy, setSignupBusy] = useState(false);
  const [signupConsent, setSignupConsent] = useState(false);
  const [viewed, setViewed] = useState<SavedProgram[]>([]); // 비회원이 본 공고(이 브라우저 임시)
  const [nudgeDismissed, setNudgeDismissed] = useState(false);
  // 회원이면 서버 저장본, 비회원이면 본 공고 임시목록
  const calItems = lead ? saved : viewed;
  const collectedIds = new Set(calItems.map((s) => s.id));

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
  const programStage = mode === "fitcheck" || mode === "diagnose" || mode === "plan";
  // 대화 시작 전, 앞단 3문항 폼이 떠 있는 상태 (이때는 텍스트 입력 잠금)
  const profileFormVisible = mode === "intake" && !profile && messages.length === 1 && !recs;

  // 앞단 3문항 완료 — LLM 호출 없이 대화에 [내 정보]로 기록하고 아이템 질문으로 진행
  function submitProfile(p: IntakeProfile) {
    setProfile(p);
    setMessages((prev) => [
      ...prev,
      { role: "user", content: `[내 정보] 사업 단계: ${p.stage} / 지역: ${p.region} / 연령대: ${p.ageGroup}` },
      {
        role: "assistant",
        content: "좋아요, 확인했어요! 그럼 어떤 사업을 구상 중이세요? 한 문장으로 편하게 말씀해 주세요. 😊",
      },
    ]);
    // GA4: 인테이크 첫 답변(버튼 선택)이 이뤄진 순간 — 세션당 1회
    if (!chatStartedRef.current) {
      chatStartedRef.current = true;
      track("chat_started");
    }
    focusInput();
  }

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
          element: '[data-tour="history"]',
          popover: {
            title: "지난 대화 보기 🕘",
            description: "예전에 나눈 대화를 여기서 다시 볼 수 있어요.",
          },
        },
        {
          popover: {
            title: "3단계면 끝나요 📋",
            description:
              "①내 아이템·나이·지역에 맞는 정부지원사업 찾기 → ②합격하려면 뭐가 부족한지 진단 → ③빈칸 채우면 사업계획서 완성!",
          },
        },
        {
          popover: {
            title: "그럼 시작해볼까요? 😊",
            description: "먼저 '어떤 사업을 구상 중인지'부터 편하게 답해보세요!",
          },
        },
      ],
    });
    d.drive();
  }

  // 첫 진입: UTM 캡처(/embed 직접 유입 시 URL에서 읽어 sessionStorage 보관)
  useEffect(() => {
    captureUtm();
    // 운영자 테스트용: ?code=마스터코드 로 접속하면 결제 없이 초안 관문 통과
    const mc = new URLSearchParams(window.location.search).get("code");
    if (mc) setCode(mc);
  }, []);

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
      setWizardStart("scope"); // 첫 방문 — 화면 0(무료·유료 범위 안내)부터 위저드로
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
    setWizardStart("scope"); // 새 대화는 화면 0(무료·유료 범위 안내)부터
    setWizAnalysis({ text: "", busy: false });
    setRecs(null);
    setDraft(null);
    setCharts(null);
    setSelectedProgram(null);
    setCode("");
    setMode("intake");
    resetEvidence();
    setReviewOpen(false);
    setReviewDone(false);
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
    setWizardStart(null); // 기존 대화 열람 — 챗 화면으로
    setWizAnalysis({ text: "", busy: false });
    setRecs(null);
    setDraft(null);
    setCharts(null);
    setSelectedProgram(null);
    setMode("intake");
    resetEvidence();
    setReviewOpen(false);
    setReviewDone(false);
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

  // 스트림 오류 복구 문구는 다음 턴 LLM 입력에서 제외 — 토큰 낭비 방지 (점검표 문제 10)
  const RECOVERY_RE = /\n*\(죄송해요, 잠시 문제가 생겼어요\. 다시 (한 번 )?보내주시겠어요\?\)/g;

  // 추천/작성/도식 호출엔 이미지를 빼고 텍스트만 보냄(비용·토큰 절약).
  function stripImages(ms: Msg[]) {
    return ms.map(({ role, content }) => ({ role, content: content.replace(RECOVERY_RE, "") }));
  }

  // 워드에서 뽑은 글자를 전송 직전 content에 합쳐줌 (화면엔 칩으로만 표시)
  function foldDocs(ms: Msg[]): Msg[] {
    return ms.map((m) => {
      if (!m.docs || m.docs.length === 0) return { ...m, content: m.content.replace(RECOVERY_RE, "") };
      const note = m.docs
        .map((d) => `\n\n[첨부한 문서 "${d.name}"의 내용]\n${d.text}`)
        .join("");
      const { docs: _drop, ...rest } = m;
      void _drop;
      return { ...rest, content: (m.content.replace(RECOVERY_RE, "") || "") + note };
    });
  }

  function readBase64(f: File): Promise<string> {
    return new Promise((res) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result).split(",")[1] ?? "");
      r.readAsDataURL(f);
    });
  }

  // 첨부 변환(사진/PDF/워드 → 전송 가능한 형태) — 챗 입력창과 진단 위저드가 공용으로 쓴다
  async function convertFiles(files: FileList | null): Promise<WizPayload> {
    const imgs: ChatImage[] = [];
    const pdfs: ChatFile[] = [];
    const wordDocs: ChatDoc[] = [];
    if (!files) return { imgs, pdfs, docs: wordDocs };
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
    return { imgs, pdfs, docs: wordDocs };
  }

  async function handleFiles(files: FileList | null) {
    const { imgs, pdfs, docs } = await convertFiles(files);
    if (imgs.length) setPendingImages((p) => [...p, ...imgs].slice(0, 3));
    if (pdfs.length) setPendingFiles((p) => [...p, ...pdfs].slice(0, 3));
    if (docs.length) setPendingDocs((p) => [...p, ...docs].slice(0, 3));
  }

  // 회원 정보 + 비회원이 본 공고(임시) 불러오기
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LEAD_KEY);
      if (raw) {
        const l = JSON.parse(raw) as Lead;
        if (l?.id) {
          setLead(l);
          refreshSaved(l.id);
        }
      }
      const v = sessionStorage.getItem(VIEWED_KEY);
      if (v) setViewed(JSON.parse(v));
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 공고를 '보면' 자동으로 캘린더에 모음 (회원이면 서버, 비회원이면 이 브라우저 임시)
  function viewProgram(p: Program) {
    if (collectedIds.has(p.id)) return;
    if (lead) {
      doSave(lead.id, p);
      return;
    }
    setViewed((prev) => {
      if (prev.some((v) => v.id === p.id)) return prev;
      const next = [
        ...prev,
        {
          id: p.id,
          title: p.title,
          applyEnd: p.applyEnd,
          url: p.url,
          supportField: p.supportField,
          region: p.region,
          savedAt: Date.now(),
        },
      ];
      try {
        sessionStorage.setItem(VIEWED_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  async function refreshSaved(leadId: string) {
    try {
      const res = await fetch(`/api/calendar/list?leadId=${encodeURIComponent(leadId)}`);
      const d = await res.json();
      setSaved(Array.isArray(d.saved) ? d.saved : []);
    } catch {
      /* ignore */
    }
  }

  async function doSave(leadId: string, p: Program) {
    try {
      await fetch("/api/calendar/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId,
          program: {
            id: p.id,
            title: p.title,
            applyEnd: p.applyEnd,
            url: p.url,
            supportField: p.supportField,
            region: p.region,
          },
        }),
      });
      refreshSaved(leadId);
    } catch {
      /* ignore */
    }
  }

  async function submitSignup() {
    if (!signupName.trim() || !signupContact.trim() || !signupConsent || signupBusy) return;
    setSignupBusy(true);
    try {
      const res = await fetch("/api/lead/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: signupName,
          contact: signupContact,
          source: getLeadSource(), // UTM 기반 source (없으면 기본값은 서버에서 처리)
          consent: signupConsent,
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        alert(d?.error ?? "가입에 실패했어요.");
        return;
      }
      const l = d.lead as Lead;
      setLead(l);
      try {
        localStorage.setItem(LEAD_KEY, JSON.stringify(l));
      } catch {
        /* ignore */
      }
      // 가입 전에 '본 공고들'을 서버 캘린더로 옮겨 저장
      for (const v of viewed) {
        await doSave(l.id, {
          id: v.id,
          title: v.title,
          applyEnd: v.applyEnd,
          url: v.url,
          supportField: v.supportField,
          region: v.region,
        } as Program);
      }
      setViewed([]);
      try {
        sessionStorage.removeItem(VIEWED_KEY);
      } catch {
        /* ignore */
      }
      setSignupOpen(false);
      setSignupName("");
      setSignupContact("");
      setSignupConsent(false);
      setCalendarOpen(true);
    } catch {
      alert("연결에 문제가 생겼어요. 다시 시도해 주세요.");
    } finally {
      setSignupBusy(false);
    }
  }

  async function removeSaved(programId: string) {
    if (!lead) {
      setViewed((prev) => {
        const next = prev.filter((s) => s.id !== programId);
        try {
          sessionStorage.setItem(VIEWED_KEY, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
      return;
    }
    setSaved((prev) => prev.filter((s) => s.id !== programId));
    try {
      await fetch("/api/calendar/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: lead.id, programId }),
      });
    } catch {
      /* ignore */
    }
  }

  // 보낸 메시지 '제자리 수정' — 내용만 고치고 나머지 대화는 그대로 둔다
  function startEdit(globalIndex: number) {
    if (busy) return;
    const m = messages[globalIndex];
    if (!m || m.role !== "user") return;
    setEditingIndex(globalIndex);
    setEditingText(m.content.replace(READY_MARK, ""));
  }
  function saveEdit() {
    if (editingIndex == null) return;
    const idx = editingIndex;
    const text = editingText;
    setMessages((prev) => prev.map((m, i) => (i === idx ? { ...m, content: text } : m)));
    setEditingIndex(null);
    setEditingText("");
  }
  function cancelEdit() {
    setEditingIndex(null);
    setEditingText("");
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
    // intake(추천 초기 대화)는 첨부를 모델에 보내지 않는다(stripImages 가 PDF/이미지 제거).
    // PDF·이미지만 올리면 빈 메시지가 돼 API 가 거부하므로, 에러 대신 안내하고 첨부는 떼어낸다.
    if (mode === "intake" && (pendingFiles.length > 0 || pendingImages.length > 0)) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            "📄 사진·PDF 같은 첨부 파일은 사업계획서 작성 단계에서 활용할게요. 지금은 간단히 텍스트로 알려주세요!",
        },
      ]);
      setPendingFiles([]);
      setPendingImages([]);
      return;
    }
    const userMsg: Msg = {
      role: "user",
      content: text,
      ...(pendingImages.length > 0 ? { images: pendingImages } : {}),
      ...(pendingFiles.length > 0 ? { files: pendingFiles } : {}),
      ...(pendingDocs.length > 0 ? { docs: pendingDocs } : {}),
    };
    // GA4: 인테이크 단계에서 사용자가 첫 답변을 입력한 순간(세션당 1회)
    if (mode === "intake" && !chatStartedRef.current && text) {
      chatStartedRef.current = true;
      track("chat_started");
    }
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
          : mode === "diagnose"
            ? "/api/plan/diagnose"
            : "/api/chat";
    const payload =
      mode === "plan"
        ? { messages: foldDocs(history), code, program: selectedProgram, provider }
        : mode === "fitcheck"
          ? { messages: foldDocs(history), program: selectedProgram, provider }
          : mode === "diagnose"
            ? { messages: foldDocs(history), program: selectedProgram, kind: "chat", provider }
            : { messages: stripImages(history), provider }; // 추천(intake)은 가벼운 텍스트만

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authedHeaders()) },
        body: JSON.stringify(payload),
      });
      if (res.status === 429) {
        replaceLast("잠시 너무 많이 사용했어요. 잠깐 쉬었다가 다시 해주세요 🙏");
        return;
      }
      if (res.status === 402) {
        replaceLast("이 기능은 결제 확인이 필요해요. 상단 [💳 결제 확인]에서 그로블 주문번호를 입력해 주세요.");
        return;
      }
      if (!res.ok || !res.body) {
        // 서버가 이유를 담아 보낸 경우(JSON error) 그대로 보여준다 — generic 문구가 원인을 가리면 안 됨.
        // (2026-07-11: OPENAI 키 미설정 503이 "답변을 가져오지 못했어요"로만 보이던 문제)
        const serverMsg = await res
          .json()
          .then((d) => (typeof d?.error === "string" ? d.error : null))
          .catch(() => null);
        if (res.status === 503 && provider === "openai") {
          setProvider("claude"); // 미설정 프로바이더에 갇히지 않게 자동 복귀
          replaceLast(
            `${serverMsg ?? "ChatGPT 연결이 아직 준비되지 않았어요."}\n\nClaude로 바꿔뒀어요 — 방금 질문을 한 번만 다시 보내주세요!`,
          );
          return;
        }
        replaceLast(serverMsg ?? "죄송해요, 답변을 가져오지 못했어요. 다시 시도해 주세요.");
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
      // GA4: 검증 질문까지 마쳐 추천 준비 완료(1막+1.5막 통과 신호) — 세션당 1회
      if (mode === "intake" && !validationFiredRef.current && acc.includes(READY_MARK)) {
        validationFiredRef.current = true;
        track("validation_answered");
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
        body: JSON.stringify({
          messages: stripImages(messages),
          provider,
          excludeIds,
          profile: profile ?? undefined, // 사전 필터용(지역·단계·연령)
        }),
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
        // 0건이면 근접 공고(마감/모집 전 라벨)로 리드 수집 흐름 노출
        setNearMisses(
          incoming.length === 0 && Array.isArray(data.nearMisses) ? (data.nearMisses as Program[]) : [],
        );
      }
      // GA4: 공고 추천이 화면에 뜬 순간 / 0건 발생 측정
      if (incoming.length > 0) track("recommendation_shown", { count: incoming.length, more: append });
      else if (!append) track("recommendation_empty");
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

  // "이건 말고 맞는 사업 찾아줘" → 버튼 4단계 찾기 위저드 (2026-07-12: LLM 채팅 인테이크 대체)
  function switchToFind() {
    setMode("intake");
    setSelectedProgram(null);
    setRecs(null);
    setDraft(null);
    setCharts(null);
    resetEvidence();
    setWizAnalysis({ text: "", busy: false });
    setWizardStart("find");
  }

  // '직접 올린 공고' 프로그램 세팅 — 위저드 도움 방식 2(정한 공고 진단)의 공통 준비
  function makeCustomProgram() {
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
    resetEvidence();
    setWizAnalysis({ text: "", busy: false });
    setMessages((m) => {
      setPlanStartIdx(m.length);
      return m;
    });
  }

  // 추천을 거치지 않고, 사용자가 가진 공고문/양식으로 바로 시작 → 위저드 '공고 입력'부터
  function startDirect() {
    track("plan_writing_started", { program: "직접 올린 공고문·양식" });
    makeCustomProgram();
    setWizardStart("notice");
  }

  // ① (무료) 추천에서 공고 선택 → 위저드 '공고 입력'부터 (2026-07-12 단계형 전환)
  function chooseProgram(p: Program) {
    track("plan_writing_started", { program: p.title ?? "" });
    setSelectedProgram(p);
    setMode("fitcheck");
    setDraft(null);
    setCharts(null);
    resetEvidence();
    setWizAnalysis({ text: "", busy: false });
    setMessages((m) => {
      setPlanStartIdx(m.length); // 이 사업 단계의 시작점
      return m;
    });
    setWizardStart("notice");
  }

  // ── 합격 가능성 진단 (2026-07-10 확정 설계) ──────────────────────────
  // 버튼식 2화면(월매출 + 확보 실적) → 매핑표(evidence_map)로 진단지 즉시 생성.
  // 이메일 게이트 폐지: 진입 회원가입 필수(2026-07-09 ③)라 이메일은 이미 계정에 있다.
  function resetEvidence() {
    setEvResult(null);
    setEvPrograms(null);
    setEvProgramsLoading(false);
    setPreviewOpen(false);
  }

  async function loadEvidenceMap() {
    setEvMapError(false);
    try {
      const res = await fetch("/api/evidence-map");
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !Array.isArray(d?.rows)) throw new Error("map load failed");
      setEvMap(d.rows as EvidenceRow[]);
    } catch {
      setEvMapError(true);
    }
  }

  // 위저드가 열리면 매핑표를 미리 불러둔다 (진단 단계 도달 전에 준비)
  useEffect(() => {
    if (wizardActive && !evMap) void loadEvidenceMap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wizardActive]);

  // 위저드 화면 2~3에서 모은 공고문·양식을 AI가 읽는다 (스트리밍).
  // 대화 기록(messages)에도 그대로 남겨서, 결제 후 사업계획서 작성이 이 맥락을 이어받는다.
  async function wizardAnalyze(payload: WizPayload, note: string) {
    const base =
      "첨부한 공고문과 양식을 읽고 알려주세요: ① 이 공고가 무엇을 중요하게 평가하는지 ② 제 사업과 맞는지·자격(업력·지역·나이)이 되는지 ③ 어떤 항목을 써야 하는지. 간결하게 핵심만 부탁해요.";
    const content = note.trim() ? `[공고 링크/설명] ${note.trim()}\n\n${base}` : base;
    const userMsg: Msg = {
      role: "user",
      content,
      ...(payload.imgs.length > 0 ? { images: payload.imgs } : {}),
      ...(payload.pdfs.length > 0 ? { files: payload.pdfs } : {}),
      ...(payload.docs.length > 0 ? { docs: payload.docs } : {}),
    };
    const history = [...messages, userMsg];
    setMessages([...history, { role: "assistant", content: "" }]);
    setWizAnalysis({ text: "", busy: true });
    try {
      const res = await fetch("/api/plan/fitcheck", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authedHeaders()) },
        body: JSON.stringify({ messages: foldDocs(history), program: selectedProgram, provider }),
      });
      if (!res.ok || !res.body) {
        const fail = "공고 분석에 실패했어요. 진단 결과는 그대로 확인할 수 있고, 결제 전 대화에서 다시 올려주시면 돼요.";
        replaceLast(fail);
        setWizAnalysis({ text: "", busy: false });
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
        setWizAnalysis({ text: acc, busy: true });
      }
      setWizAnalysis({ text: acc, busy: false });
    } catch {
      replaceLast("공고 분석 중 연결이 끊겼어요.");
      setWizAnalysis((prev) => ({ ...prev, busy: false }));
    }
  }

  // 진단 시작 — 버튼 폼을 띄운다 (타이핑 없음, LLM 호출 없음)
  function enterDiagnose() {
    setMode("diagnose");
    resetEvidence();
    if (!evMap) void loadEvidenceMap();
    track("start_diagnosis", { program: selectedProgram?.title ?? "" });
    setMessages((m) => [...m, { role: "assistant", content: DIAGNOSE_INTRO }]);
  }

  // 화면 2 제출 → 로그인 게이트 B안: 결과 보기 직전이 게이트 지점.
  // 미로그인이면 답변을 보관하고 로그인 모달 → 성공 시 doSubmitEvidence 로 이어간다.
  function submitEvidence(revenue: string, items: string[]) {
    if (!session) {
      setPendingEvidence({ revenue, items });
      setAuthOpen(true);
      return;
    }
    doSubmitEvidence(revenue, items);
  }

  // 분기 실행: 실적 1개 이상 = 진단지 / 실적 0개 = pre 전용 화면
  function doSubmitEvidence(revenue: string, items: string[]) {
    // 체크 조합이 곧 시장 데이터 (GA4 이벤트 파라미터는 스칼라만 — 콤마 문자열로)
    const realItems = items.filter((i) => i !== "해당 없음");
    // 진단 답변을 대화 기록에 남긴다 — 결제 후 사업계획서 작성이 이 정보를 이어받는다
    setMessages((prev) => [
      ...prev,
      { role: "user", content: `[합격 가능성 진단] 월 평균 매출: ${revenue} / 확보 실적: ${items.join(", ")}` },
    ]);
    track("evidence_check", {
      items: items.join(","),
      count: realItems.length,
      revenue,
    });

    if (isPreStage(items)) {
      // 아직 실적이 쌓이기 전 단계 — 유료 CTA 노출 금지, leads stage='pre' 저장
      setEvResult({ kind: "pre" });
      track("no_evidence_view");
      void (async () => {
        try {
          await fetch("/api/lead/prestage", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(await authedHeaders()) },
          });
        } catch {
          /* 기록 실패는 화면 흐름에 영향 없음 */
        }
      })();
      setEvProgramsLoading(true);
      fetch("/api/programs/pre")
        .then((r) => r.json())
        .then((d) => setEvPrograms(Array.isArray(d?.programs) ? d.programs : []))
        .catch(() => setEvPrograms([]))
        .finally(() => setEvProgramsLoading(false));
    } else {
      setEvResult({ kind: "sheet", sheet: buildSheet(evMap ?? [], items) });
      track("view_diagnosis_result", { program: selectedProgram?.title ?? "" });
    }
    setTimeout(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }, 100);
  }

  // 무료 결과 → 초안 미리보기 (2026-07-11 디자인수정 3순위)
  // 결제 전에 목차·예시 문장을 먼저 보여준다. 여기서는 아직 결제를 요구하지 않는다.
  function openPreview() {
    track("draft_preview_click", { program: selectedProgram?.title ?? "" });
    setPreviewOpen(true);
    setTimeout(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }, 100);
  }

  // 결제 트리거 — 39,900원 버튼. 초안 미리보기를 확인한 뒤에만 도달한다. (// TODO: PG 연동 자리)
  // 이메일은 진단 전 게이트에서 이미 받았으므로 결제 단계에선 추가 가입을 받지 않는다.
  function clickPay() {
    track("click_pay", { program: selectedProgram?.title ?? "", price: PRICE_KRW });
    track("checkout_start", { program: selectedProgram?.title ?? "", price: PRICE_KRW });
    // 이미 결제 확인(is_paid)된 계정이면 바로 작성 시작
    if (paid && selectedProgram) {
      enterPlanMode(selectedProgram);
      return;
    }
    setMode("paywall");
  }

  // ③ (결제 후) 본격 작성 시작 — 앞서 올린 문서/대화를 그대로 이어서
  function enterPlanMode(p: Program) {
    // 결제 완료 측정 — 현재는 코드 검증 통과 시점. (// TODO: PG 연동 후 실제 결제 완료로 교체)
    track("complete_payment", { program: p.title ?? "", price: PRICE_KRW });
    setWizardStart(null); // 위저드 종료 → 결제 후 작성은 챗에서 이어간다
    setMode("plan");
    setDraft(null);
    setCharts(null);
    resetEvidence();
    setMessages((m) => [
      ...m,
      {
        role: "assistant",
        content: `✅ 결제가 확인됐어요! 이제 '${p.title}' 사업계획서를 본격적으로 써드릴게요. 📝\n앞에서 보여주신 공고문·양식과 사업 내용을 바탕으로, 양식이 요구하는 항목 순서대로 하나씩 채워볼게요.\n\n이어서 답해 주세요 👇`,
      },
    ]);
    focusInput();
  }

  // 결제 화면 닫기 — 진단 결과(미리보기)에서 왔다면 그 화면으로 되돌린다
  function closePaywall() {
    setPayOpen(false);
    if (mode === "paywall") setMode(evResult ? "diagnose" : "fitcheck");
  }

  // 그로블 주문번호 인증 (2026-07-09 ③ 결정: 셀프서비스 주문번호 인증)
  async function verifyOrder(orderNo: string): Promise<{ ok: boolean; error?: string }> {
    let res = await fetch("/api/order/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authedHeaders()) },
      body: JSON.stringify({ orderNo }),
    });
    if (res.status === 401) {
      // 세션 만료 가능성 — 리프레시 토큰으로 강제 갱신 후 1회 재시도
      const fresh = await forceRefreshToken();
      if (fresh) {
        res = await fetch("/api/order/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${fresh}` },
          body: JSON.stringify({ orderNo }),
        });
      }
      if (res.status === 401) {
        // 갱신도 실패 — UI 를 실제 상태(로그아웃)와 일치시킨다
        await signOut();
        return { ok: false, error: "세션이 만료됐어요. 다시 로그인한 뒤 주문번호를 입력해 주세요." };
      }
    }
    const data = await res.json().catch(() => ({}));
    if (data?.ok) {
      setPaid(true);
      // GA4 퍼널: 주문번호 인증 완료 = 유료 전환 확정
      track("order_verified", { price: PRICE_KRW });
      return { ok: true };
    }
    return { ok: false, error: String(data?.error || "확인에 실패했어요. 다시 시도해 주세요.") };
  }

  async function generateDraft() {
    if (!selectedProgram || drafting || !(paid || code)) return;
    setDrafting(true);
    setCharts(null);
    const title = `${selectedProgram.title} 사업계획서`;
    // TODO(양식 매핑 고도화): 현재 초안은 표준 PSST 5항목 골격(PLAN_SECTIONS)으로 생성됨.
    //   대화 단계(plan/chat)는 첨부 양식의 항목·순서를 그대로 따르지만, 자동 .docx 초안은
    //   아직 PSST 골격을 씀. 첨부 양식의 항목을 추출해 그 목차대로 생성하려면, 업로드 양식에서
    //   항목 리스트를 뽑는 단계(LLM 추출)를 추가하고 이 루프를 그 리스트로 구동해야 함.
    const sections: DraftSection[] = [];
    setDraft({ title, sections: [] });

    for (const sec of PLAN_SECTIONS) {
      sections.push({ heading: sec.heading, content: "" });
      setDraft({ title, sections: [...sections] });
      try {
        const res = await fetch("/api/plan/draft", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(await authedHeaders()) },
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
        headers: { "Content-Type": "application/json", ...(await authedHeaders()) },
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
    // 결과물 도달 측정 + 만족도 최고점에 후기 팝업 (한 번만)
    track("complete_draft", { program: selectedProgram?.title ?? "" });
    if (!reviewDone) {
      track("review_prompt_shown");
      setReviewOpen(true);
    }
  }

  // 후기 저장 — 구글시트(GAS) 또는 Upstash로 영구 저장
  async function submitReview(payload: {
    rating: number;
    tags: string[];
    comment: string;
    publicConsent: boolean;
  }): Promise<boolean> {
    try {
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          bizField: selectedProgram?.title ?? "",
          name: lead?.name ?? "",
        }),
      });
      if (!res.ok) return false;
      track("review_submitted", { rating: payload.rating });
      if (payload.publicConsent) track("review_public_consent");
      setReviewDone(true);
      return true;
    } catch {
      return false;
    }
  }

  async function downloadDocx() {
    if (!draft || !(paid || code)) return;
    const res = await fetch("/api/plan/docx", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authedHeaders()) },
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
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-2">
            <button
              onClick={() => setHistoryOpen(true)}
              title="내 대화 기록"
              data-tour="history"
              className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100"
            >
              🕘
            </button>
            <button
              onClick={() => setCalendarOpen(true)}
              title="내 관심사업 캘린더"
              className="relative mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100"
            >
              📅
              {calItems.length > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-600 px-1 text-[9px] font-bold text-white">
                  {calItems.length}
                </span>
              )}
            </button>
            <div className="min-w-0">
              <h1 className="text-base font-semibold leading-tight">정부지원사업 사업계획서 도우미</h1>
              <p className="mt-0.5 text-xs text-zinc-500">
                편하게 대화하듯 답해 주세요. 나에게 맞는 지원사업을 찾아 드릴게요.
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              onClick={() => setPayOpen(true)}
              title="그로블 주문번호로 결제 확인"
              className={`flex h-8 items-center rounded-lg px-2 text-xs font-semibold ${
                paid ? "text-emerald-600 hover:bg-emerald-50" : "text-blue-600 hover:bg-blue-50"
              }`}
            >
              💳 결제 확인{paid ? " ✓" : ""}
            </button>
            {session ? (
              <button
                onClick={() => void signOut()}
                title={email ? `${email} 로그아웃` : "로그아웃"}
                className="flex h-8 items-center rounded-lg px-2 text-xs font-medium text-zinc-400 hover:bg-zinc-100"
              >
                로그아웃
              </button>
            ) : (
              <button
                onClick={() => setAuthOpen(true)}
                title="로그인하면 진단 기록과 결제 확인이 계정에 연결돼요"
                className="flex h-8 items-center rounded-lg px-2 text-xs font-semibold text-blue-600 hover:bg-blue-50"
              >
                로그인
              </button>
            )}
            <button
              onClick={startTour}
              title="사용법 다시 보기"
              className="flex h-8 items-center rounded-lg px-2 text-xs font-medium text-zinc-500 hover:bg-zinc-100"
            >
              ❓ 사용법
            </button>
            {/* AI 토글 숨김 (2026-07-11): OPENAI_API_KEY 미등록 상태라 당분간 Claude 전용.
                ChatGPT를 다시 열려면 Vercel에 키 등록 후 이 자리에 토글 복원 (git 이력 참고). */}
          </div>
        </div>
      </header>

      {mode === "fitcheck" && !wizardActive && (
        <div className="border-b border-amber-100 bg-amber-50 px-5 py-2.5 text-xs font-semibold text-amber-800">
          🔎 적합도 확인 · <span className="text-amber-900">{selectedProgram?.title}</span> — 공고문·양식을
          올리면 내 사업과 맞는지 알려드려요
        </div>
      )}
      {mode === "diagnose" && !wizardActive && (
        <div className="border-b border-emerald-100 bg-emerald-50 px-5 py-2.5 text-xs font-semibold text-emerald-800">
          📋 합격 가능성 진단 · <span className="text-emerald-900">{selectedProgram?.title}</span> — 이미
          가진 실적을 합격 근거로 정리해드려요 (결제 전, 무료)
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

      {((mode === "paywall" && selectedProgram) || payOpen) && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={closePaywall}
        >
          <div
            className="relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={closePaywall}
              aria-label="닫기"
              className="absolute right-3 top-3 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 hover:bg-zinc-200"
            >
              ✕
            </button>
            <Paywall
              program={mode === "paywall" ? selectedProgram : null}
              paid={paid}
              onUnlock={() => {
                setPayOpen(false);
                if (mode === "paywall" && selectedProgram) enterPlanMode(selectedProgram);
              }}
              onCancel={closePaywall}
              verifyOrder={verifyOrder}
            />
          </div>
        </div>
      )}

      {/* 로그인 게이트 B안 — 진단 결과 보기 직전. 성공 시 보관한 답변으로 결과 표시 */}
      {authOpen && (
        <AuthModal
          onClose={() => setAuthOpen(false)}
          onDone={() => {
            setAuthOpen(false);
            const p = pendingEvidence;
            setPendingEvidence(null);
            if (p) doSubmitEvidence(p.revenue, p.items);
          }}
        />
      )}

      {/* 후기 수집 팝업 — 초안 완성 직후(만족도 최고점) */}
      {reviewOpen && (
        <ReviewModal
          onClose={() => setReviewOpen(false)}
          onSubmit={submitReview}
        />
      )}

      {/* 가입(간단 정보) 모달 — 관심사업 저장 시 */}
      {signupOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setSignupOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-bold text-zinc-900">💾 내 캘린더 저장하기</h3>
            <p className="mt-1 text-xs leading-5 text-zinc-500">
              간단한 정보만 남기면, 지금까지 <b>본 공고들의 마감일을 캘린더로 모아</b> 안전하게 보관하고
              알려드려요. 비밀번호 없어요!
            </p>
            <div className="mt-4 space-y-2">
              <input
                value={signupName}
                onChange={(e) => setSignupName(e.target.value)}
                placeholder="이름 (예: 홍길동)"
                className="w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
              />
              <input
                value={signupContact}
                onChange={(e) => setSignupContact(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitSignup()}
                placeholder="이메일 또는 전화번호"
                className="w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
              />
            </div>
            <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs leading-5 text-zinc-600">
              <input
                type="checkbox"
                checked={signupConsent}
                onChange={(e) => setSignupConsent(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-blue-600"
              />
              <span>
                <b>(필수)</b> 개인정보 수집·이용에 동의합니다. 수집 항목: 이름·연락처 / 이용 목적:
                마감 알림·맞춤 안내 / 동의 거부 시 캘린더 저장이 불가해요.
              </span>
            </label>
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setSignupOpen(false)}
                className="flex-1 rounded-xl border border-zinc-200 py-2.5 text-sm font-medium text-zinc-500 hover:bg-zinc-50"
              >
                취소
              </button>
              <button
                onClick={submitSignup}
                disabled={signupBusy || !signupName.trim() || !signupContact.trim() || !signupConsent}
                className="flex-1 rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {signupBusy ? "저장 중…" : "저장하고 캘린더 담기"}
              </button>
            </div>
            <p className="mt-2 text-center text-[10px] text-zinc-400">
              입력하신 정보는 마감 알림·맞춤 안내에만 사용돼요.
            </p>
          </div>
        </div>
      )}

      {/* 내 관심사업 캘린더 (드로어) */}
      {calendarOpen && (
        <div className="absolute inset-0 z-40 flex">
          <div className="flex-1 bg-black/20" onClick={() => setCalendarOpen(false)} />
          <div className="flex w-80 max-w-[85%] flex-col bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-100 px-3 py-3">
              <span className="text-sm font-semibold">
                📅 내 관심사업{lead ? ` · ${lead.name}님` : ""}
              </span>
              <button onClick={() => setCalendarOpen(false)} className="text-zinc-400 hover:text-zinc-700">
                ✕
              </button>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto p-3">
              {!lead && calItems.length > 0 && (
                <button
                  onClick={() => setSignupOpen(true)}
                  className="w-full rounded-xl bg-blue-600 px-3 py-2.5 text-xs font-bold text-white hover:bg-blue-700"
                >
                  💾 회원가입하고 이 캘린더 저장하기 (마감 알림 받기)
                </button>
              )}
              {!lead && calItems.length > 0 && (
                <p className="px-1 text-[11px] leading-5 text-amber-600">
                  ⚠️ 지금은 이 브라우저에만 임시 저장돼요. 가입해야 안전하게 보관돼요!
                </p>
              )}
              {calItems.length === 0 && (
                <p className="px-1 py-4 text-xs leading-5 text-zinc-400">
                  아직 본 공고가 없어요. 추천에서 <b>「공고 원문 보기」</b>를 누르면 여기 자동으로 모여요!
                </p>
              )}
              {calItems.map((s) => {
                const dl = deadlineLabel(s.applyEnd);
                return (
                  <div key={s.id} className="rounded-xl border border-zinc-200 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-xs font-bold leading-5 text-zinc-800">{s.title}</span>
                      <button
                        onClick={() => removeSaved(s.id)}
                        title="삭제"
                        className="shrink-0 text-zinc-300 hover:text-red-500"
                      >
                        🗑
                      </button>
                    </div>
                    <div
                      className={`mt-1 text-[11px] ${dl.urgent ? "font-semibold text-red-600" : "text-zinc-500"}`}
                    >
                      📅 {dl.text}
                    </div>
                    <div className="mt-0.5 text-[11px] text-zinc-400">
                      {[s.supportField, s.region].filter(Boolean).join(" · ")}
                    </div>
                    {s.url && (
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-block text-[11px] text-blue-600 hover:underline"
                      >
                        공고 원문 ↗
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* 진단 위저드 (2026-07-12) — 시안 그대로 한 화면 한 단계. 활성 시 챗 영역 전체를 대체 */}
      {wizardActive && (
        <div className="min-h-0 flex-1 overflow-y-auto bg-zinc-50 p-4 sm:p-6">
          <DiagnosisWizard
            key={convoId + (wizardStart ?? "")}
            start={wizardStart ?? "scope"}
            program={selectedProgram}
            evMap={evMap}
            evMapError={evMapError}
            onRetryMap={() => void loadEvidenceMap()}
            evResult={evResult}
            evPrograms={evPrograms}
            evProgramsLoading={evProgramsLoading}
            analysis={wizAnalysis}
            convertFiles={convertFiles}
            onDirectProgram={makeCustomProgram}
            onChooseProgram={chooseProgram}
            onViewProgram={viewProgram}
            hasLead={Boolean(lead)}
            onSignup={() => setSignupOpen(true)}
            onAnalyze={(payload, note) => void wizardAnalyze(payload, note)}
            onSubmitEvidence={submitEvidence}
            onPay={clickPay}
          />
        </div>
      )}

      {!wizardActive && (
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-5">
      {/* 본문 폭 제한(§11-1) — 대화도 시안처럼 좁은 컬럼으로 집중 */}
      <div className="mx-auto w-full max-w-[820px] space-y-3">
        {/* 1단계: 인테이크 대화 (+추천) — 사업 선택 후에도 위에 그대로 보임 */}
        {(programStage ? messages.slice(0, planStartIdx) : messages).map((m, i) =>
          editingIndex === i ? (
            <EditBox
              key={i}
              value={editingText}
              onChange={setEditingText}
              onSave={saveEdit}
              onCancel={cancelEdit}
            />
          ) : (
            <Bubble key={i} m={m} busy={busy} onEdit={() => startEdit(i)} />
          ),
        )}

        {/* 인테이크 앞단 3문항 — 버튼/선택지 (LLM 호출 0회) */}
        {profileFormVisible && <IntakeProfileForm onSubmit={submitProfile} />}

        {recommending && (
          <div className="mr-auto rounded-2xl bg-zinc-100 px-4 py-3 text-sm text-zinc-600">
            맞는 지원사업을 찾는 중이에요… 🔎
          </div>
        )}

        {recs && (
          <Recommendations
            recs={recs}
            nearMisses={nearMisses}
            usingSample={usingSample}
            onChoose={chooseProgram}
            onMore={recommendMore}
            loadingMore={recommending}
            onView={viewProgram}
            collectedIds={collectedIds}
            hasLead={Boolean(lead)}
            onSignup={() => setSignupOpen(true)}
          />
        )}

        {/* 2단계: 선택한 사업 (적합도 확인 → 작성) — 구분선으로 명확히 분리 */}
        {programStage && (
          <>
            <div className="flex items-center gap-2 py-1">
              <div className="h-px flex-1 bg-blue-200" />
              <span className="shrink-0 rounded-full bg-blue-600 px-3 py-1 text-[11px] font-bold text-white">
                {mode === "fitcheck"
                  ? "🔎 여기서부터 적합도 확인 (무료)"
                  : mode === "diagnose"
                    ? "🩺 여기서부터 7단계 자가진단 (무료)"
                    : "✍️ 여기서부터 사업계획서 작성"}
              </span>
              <div className="h-px flex-1 bg-blue-200" />
            </div>
            {messages.slice(planStartIdx).map((m, i) =>
              editingIndex === planStartIdx + i ? (
                <EditBox
                  key={`stage-${i}`}
                  value={editingText}
                  onChange={setEditingText}
                  onSave={saveEdit}
                  onCancel={cancelEdit}
                />
              ) : (
                <Bubble
                  key={`stage-${i}`}
                  m={m}
                  busy={busy}
                  onEdit={() => startEdit(planStartIdx + i)}
                />
              ),
            )}
          </>
        )}

        {/* 합격 가능성 진단 — 폼(2화면) → 진단지(전부 무료) → 초안 미리보기 → 결제.
            한 화면 = 한 단계: 미리보기가 열리면 진단지는 잠시 접는다 (2026-07-11 디자인수정) */}
        {mode === "diagnose" &&
          (!evResult ? (
            <EvidenceDiagnosisForm
              rows={evMap}
              mapError={evMapError}
              onRetryMap={() => void loadEvidenceMap()}
              onSubmit={submitEvidence}
            />
          ) : evResult.kind === "pre" ? (
            <PreStageCard programs={evPrograms} loading={evProgramsLoading} />
          ) : previewOpen ? (
            <DraftPreviewCard
              sheet={evResult.sheet}
              onPay={clickPay}
              onBack={() => setPreviewOpen(false)}
              onView={() => track("draft_preview_view", { program: selectedProgram?.title ?? "" })}
            />
          ) : (
            <EvidenceSheetCard sheet={evResult.sheet} onPreview={openPreview} />
          ))}

        {draft && (
          <DraftView
            draft={draft}
            drafting={drafting}
            charts={charts}
            onDownload={downloadDocx}
          />
        )}
      </div>
      </div>
      )}

      {mode !== "paywall" && !wizardActive && (
        <div className="mx-auto w-full max-w-[820px]">
          {/* 캘린더 저장(가입) 배너 — 추천 탐색 중에만. 진단·작성 중에는 노출하지 않는다 (§12) */}
          {mode === "intake" && !lead && !nudgeDismissed && calItems.length > 0 && (
            <div className="mx-4 mt-2 flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
              <span className="flex-1">
                📅 방금 본 공고 <b>{calItems.length}개</b>를 캘린더에 모았어요! 마감 놓치지 않게 저장할까요?
              </span>
              <button
                onClick={() => setSignupOpen(true)}
                className="shrink-0 rounded-lg bg-blue-600 px-2.5 py-1.5 font-semibold text-white hover:bg-blue-700"
              >
                저장(가입)
              </button>
              <button
                onClick={() => setNudgeDismissed(true)}
                className="shrink-0 text-blue-400 hover:text-blue-600"
                aria-label="닫기"
              >
                ✕
              </button>
            </div>
          )}
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
          {/* 진행 안내·직접 경로·표준양식 — 대화가 시작되면 숨긴다 (§12: 현재 단계만 노출) */}
          {mode === "intake" && !recs && userTurns === 0 && (
            <div className="px-4 pt-2 space-y-2">
              {/* 진행 단계 목차 — 처음 온 사람이 '어떻게 흘러가는지' 한눈에 (책 목차처럼) */}
              <div className="rounded-xl border border-blue-100 bg-blue-50/60 px-3 py-2.5">
                <p className="text-[11px] font-semibold text-blue-800">📋 이렇게 3단계로 진행돼요</p>
                <ol className="mt-1.5 space-y-1 text-[11px] leading-4 text-zinc-600">
                  <li className="flex gap-1.5">
                    <span className="font-bold text-blue-600">1.</span>
                    <span>내 <b>아이템·나이·지역</b>에 맞는 정부지원사업 찾기</span>
                  </li>
                  <li className="flex gap-1.5">
                    <span className="font-bold text-blue-600">2.</span>
                    <span>그 사업에 <b>합격하려면 뭐가 부족한지</b> 진단</span>
                  </li>
                  <li className="flex gap-1.5">
                    <span className="font-bold text-blue-600">3.</span>
                    <span>부족한 걸 채워 <b>사업계획서 작성</b></span>
                  </li>
                </ol>
              </div>

              {/* 이미 공고/양식 있는 사람 — 연노랑으로 시선 강조 (로직 동일) */}
              <button
                onClick={startDirect}
                className="w-full rounded-xl border border-yellow-300 bg-yellow-50 py-2.5 text-xs font-semibold text-yellow-800 transition-colors hover:bg-yellow-100"
              >
                📄 이미 정한 공고문·양식이 있어요 → 무료 진단 받기
              </button>

              {/* 공식 사업공고·양식 어디서 찾나요 — K-Startup 공식 링크(무료, 가입 불필요) */}
              <div className="rounded-xl border border-zinc-200 bg-zinc-50/60 px-3 py-2.5">
                <p className="text-[11px] font-semibold text-zinc-600">
                  📑 사업계획서 표준 양식 무료로 받기 (한 번 써보세요)
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {OFFICIAL_LINKS.map((l) => (
                    <a
                      key={l.label}
                      href={l.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => track("open_official_link", { name: l.label })}
                      className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-medium text-blue-700 hover:bg-blue-50"
                    >
                      {l.label} ↗
                    </a>
                  ))}
                </div>
                <p className="mt-1.5 text-[10px] leading-4 text-zinc-400">
                  예비/초기창업패키지 표준 양식(공고문·별첨 포함)을 바로 받아 한 번 써보세요. 막히면 위에서 같이
                  진단해 드려요.
                </p>
              </div>
            </div>
          )}
          {mode === "fitcheck" && (
            <div className="border-t border-zinc-100 px-4 pt-3">
              {/* 왜 바로 안 쓰고 진단부터인지 — 설명은 2줄 이내, 무료·유료 경계는 버튼 아래 명시 (§9·§11) */}
              <div className="mb-2 rounded-xl bg-blue-50 px-3 py-2.5 text-xs leading-5 text-blue-800">
                합격은 <b>이미 가진 매출·고객·거래처가 얼마나 잘 보이느냐</b>로 갈려요. 버튼만 누르면
                1분 만에 끝나요.
              </div>
              <button
                onClick={enterDiagnose}
                className="w-full rounded-xl bg-blue-600 py-3 text-base font-bold text-white transition-colors hover:bg-blue-700"
              >
                무료 합격 가능성 진단 받기
              </button>
              <p className="mt-1.5 text-center text-[11px] text-zinc-400">
                진단은 무료 · 사업계획서 초안 생성은 1회 {PRICE}입니다.
              </p>
              <button
                onClick={switchToFind}
                className="mt-2 w-full rounded-xl border border-zinc-200 py-2 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-50"
              >
                🔄 이 사업 말고, 나에게 맞는 지원사업 찾아줘
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

          {/* 진단(diagnose)은 버튼만으로 진행 — 텍스트 입력창은 숨긴다 (LLM 호출 0회) */}
          {mode !== "diagnose" && (
          <div className="border-t border-zinc-100 p-4">
            {programStage && (
              <p className="mb-2 text-center text-[11px] leading-4 text-zinc-400">
                💡 사진·PDF·워드(📎)를 올리면 진단과 사업계획서가 더 정확해져요 (공고문·양식·매출/예약 캡처 등)
              </p>
            )}
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
                disabled={profileFormVisible}
                placeholder={
                  profileFormVisible
                    ? "먼저 위에서 세 가지를 골라주세요 👆"
                    : "여기에 답을 입력하세요… (📎로 사진·PDF·워드 첨부)"
                }
                className="max-h-32 flex-1 resize-none rounded-2xl border border-zinc-200 px-4 py-2.5 text-sm outline-none focus:border-blue-500 disabled:bg-zinc-50"
              />
              <button
                onClick={send}
                disabled={
                  busy ||
                  profileFormVisible ||
                  (!input.trim() && pendingImages.length === 0 && pendingFiles.length === 0)
                }
                data-tour="send"
                className="shrink-0 rounded-full bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                보내기
              </button>
            </div>
          </div>
          )}
        </div>
      )}
    </main>
  );
}

// 인테이크 앞단 3문항(단계·지역·연령) 버튼 폼 — LLM 호출 없이 수집 (점검표 문제 8)
function IntakeProfileForm({ onSubmit }: { onSubmit: (p: IntakeProfile) => void }) {
  const [stage, setStage] = useState("");
  const [region, setRegion] = useState("");
  const [ageGroup, setAgeGroup] = useState("");
  const ready = Boolean(stage && region && ageGroup);
  const pick = (cur: string, v: string) =>
    `rounded-xl border px-3 py-2 text-xs font-medium transition-colors ${
      cur === v
        ? "border-blue-500 bg-blue-50 text-blue-700"
        : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
    }`;
  return (
    <div className="mr-auto w-full max-w-[95%] rounded-2xl border border-blue-100 bg-blue-50/40 p-4">
      <div className="space-y-3">
        <div>
          <p className="text-xs font-semibold text-zinc-700">1️⃣ 사업 단계가 어떻게 되세요?</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {PROFILE_STAGES.map((v) => (
              <button key={v} onClick={() => setStage(v)} className={pick(stage, v)}>
                {v}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold text-zinc-700">
            2️⃣ 어느 지역에서 하세요? <span className="font-normal text-zinc-400">(지역 제한 사업이 많아요)</span>
          </p>
          <select
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            className={`mt-1.5 w-full rounded-xl border px-3 py-2 text-xs outline-none focus:border-blue-500 ${
              region ? "border-blue-500 bg-blue-50 text-blue-700" : "border-zinc-200 bg-white text-zinc-600"
            }`}
          >
            <option value="">지역을 골라주세요</option>
            {PROFILE_REGIONS.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div>
          <p className="text-xs font-semibold text-zinc-700">
            3️⃣ 연령대는요? <span className="font-normal text-zinc-400">(나이로 자격이 갈리는 경우가 있어요)</span>
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {PROFILE_AGES.map((v) => (
              <button key={v} onClick={() => setAgeGroup(v)} className={pick(ageGroup, v)}>
                {v}
              </button>
            ))}
          </div>
        </div>
      </div>
      <button
        onClick={() => ready && onSubmit({ stage, region, ageGroup })}
        disabled={!ready}
        className="mt-3 w-full rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-40"
      >
        {ready ? "이걸로 시작하기 →" : "세 가지를 모두 골라주세요"}
      </button>
    </div>
  );
}

function EditBox({
  value,
  onChange,
  onSave,
  onCancel,
}: {
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="ml-auto flex w-full max-w-[85%] flex-col items-end gap-2">
      <textarea
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={Math.min(8, Math.max(2, value.split("\n").length))}
        className="w-full resize-none rounded-2xl border-2 border-blue-400 px-4 py-3 text-sm leading-6 text-zinc-900 outline-none"
      />
      <div className="flex gap-2">
        <button
          onClick={onCancel}
          className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-500 hover:bg-zinc-50"
        >
          취소
        </button>
        <button
          onClick={onSave}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
        >
          저장
        </button>
      </div>
    </div>
  );
}

// **별표** 마크다운을 볼드로 렌더링 — LLM 응답의 별표가 그대로 노출되지 않게 (v4.1 소정리)
function renderBold(text: string): ReactNode {
  const parts = text.split(/\*\*([^*]+)\*\*/g);
  if (parts.length === 1) return text;
  return parts.map((p, i) => (i % 2 === 1 ? <b key={i}>{p}</b> : p));
}

function Bubble({ m, busy, onEdit }: { m: Msg; busy: boolean; onEdit?: () => void }) {
  const isUser = m.role === "user";
  return (
    <div className={isUser ? "ml-auto flex max-w-[85%] flex-col items-end" : "mr-auto max-w-[85%]"}>
      <div
        className={
          isUser
            ? "whitespace-pre-wrap rounded-2xl rounded-br-sm bg-blue-600 px-4 py-3 text-sm leading-6 text-white"
            : "whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-zinc-100 px-4 py-3 text-sm leading-6 text-zinc-900"
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
        {renderBold(m.content.replace(READY_MARK, "").trimEnd()) || (busy ? "…" : "")}
      </div>
      {isUser && onEdit && !busy && (
        <button
          onClick={onEdit}
          className="mt-1 text-[11px] text-zinc-400 transition-colors hover:text-blue-600"
        >
          ✏️ 수정
        </button>
      )}
    </div>
  );
}

// 마감일 → 사람이 읽기 쉬운 라벨 (D-day, 상시, 마감)
function deadlineLabel(applyEnd: string | null): { text: string; urgent: boolean } {
  if (!applyEnd) return { text: "상시 모집 (마감일 없음)", urgent: false };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(`${applyEnd}T00:00:00`);
  const days = Math.round((end.getTime() - today.getTime()) / 86400000);
  if (Number.isNaN(days)) return { text: applyEnd, urgent: false };
  if (days < 0) return { text: `마감됨 (${applyEnd})`, urgent: false };
  if (days === 0) return { text: `⏰ 오늘 마감! (${applyEnd})`, urgent: true };
  return { text: `D-${days} · ${applyEnd}까지`, urgent: days <= 7 };
}

function Recommendations({
  recs,
  nearMisses,
  usingSample,
  onChoose,
  onMore,
  loadingMore,
  onView,
  collectedIds,
  hasLead,
  onSignup,
}: {
  recs: Recommendation[];
  nearMisses: Program[];
  usingSample: boolean;
  onChoose: (p: Program) => void;
  onMore: () => void;
  loadingMore: boolean;
  onView: (p: Program) => void;
  collectedIds: Set<string>;
  hasLead: boolean;
  onSignup: () => void;
}) {
  if (recs.length === 0) {
    // 추천 0건 — 근접 공고 + 알림 신청(가입)으로 리드 수집 (v4.1 패치 2)
    return (
      <div className="mr-auto max-w-[90%] space-y-3">
        <div className="space-y-2 rounded-2xl bg-zinc-100 px-4 py-3 text-sm leading-6 text-zinc-700">
          <p>
            지금 <b>모집 중인 공고</b> 중에선 사장님께 딱 맞는 게 안 보였어요 😢 예비창업패키지처럼 큰
            사업은 보통 연 1~2회만 열려서, 지금은 모집이 닫혀 있을 수 있어요. (말씀해주신 내용은 잘
            기억하고 있어요!)
          </p>
        </div>
        {nearMisses.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-zinc-500">그래도 조건에 가까웠던 공고들이에요 👇</p>
            {nearMisses.map((p) => (
              <div key={p.id} className="rounded-2xl border border-zinc-200 bg-white p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-bold leading-5 text-zinc-800">{p.title}</h3>
                  <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-500">
                    🕐 지금은 마감/모집 전
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px] text-zinc-500">
                  <span className="rounded bg-zinc-100 px-1.5 py-0.5">{p.supportField}</span>
                  <span className="rounded bg-zinc-100 px-1.5 py-0.5">{p.region}</span>
                  <span className="rounded bg-zinc-100 px-1.5 py-0.5">{deadlineLabel(p.applyEnd).text}</span>
                </div>
              </div>
            ))}
          </div>
        )}
        {!hasLead && (
          <button
            onClick={onSignup}
            className="w-full rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white hover:bg-blue-700"
          >
            🔔 맞는 공고가 열리면 알려드릴게요 — 알림 신청
          </button>
        )}
        <p className="text-xs leading-5 text-zinc-500">
          👉 위쪽 <b>‘📑 표준 양식 무료로 받기’</b>로 미리 사업계획서를 써두면, 새 공고가 열렸을 때 바로
          낼 수 있어요. 아래 <b>‘추천받기’</b>를 한 번 더 눌러보셔도 돼요!
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="text-sm font-semibold text-zinc-700">이런 지원사업이 잘 맞을 것 같아요 👇</div>
      <div className="rounded-xl bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-800">
        마음에 드는 사업의 <b>「무료 진단 받기」</b> 버튼을 누르면, 내 사업과 맞는지·무엇이
        부족한지 무료로 확인할 수 있어요. (공고 원문은 참고용이에요)
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
          {/* 공고 상세 (K-Startup 사이트처럼 자세히) */}
          <div className="mt-3 space-y-1.5 rounded-lg border border-zinc-100 bg-zinc-50/70 px-3 py-2.5 text-xs leading-5 text-zinc-600">
            {(() => {
              const dl = deadlineLabel(r.program.applyEnd);
              return (
                <div className="flex gap-1.5">
                  <span className="shrink-0 font-semibold text-zinc-700">📅 신청기간</span>
                  <span className={dl.urgent ? "font-semibold text-red-600" : ""}>{dl.text}</span>
                </div>
              );
            })()}
            {r.program.target && r.program.target !== "지원대상 정보 없음" && (
              <div className="flex gap-1.5">
                <span className="shrink-0 font-semibold text-zinc-700">🎯 지원대상</span>
                <span>{r.program.target}</span>
              </div>
            )}
            {r.program.summary && (
              <div className="flex gap-1.5">
                <span className="shrink-0 font-semibold text-zinc-700">📋 지원내용</span>
                <span>{r.program.summary}</span>
              </div>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-zinc-500">
            <span className="rounded bg-zinc-100 px-1.5 py-0.5">{r.program.supportField}</span>
            <span className="rounded bg-zinc-100 px-1.5 py-0.5">{r.program.region}</span>
          </div>
          <button
            onClick={() => onChoose(r.program)}
            className="mt-3 w-full rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
          >
            이 공고로 무료 진단 받기
          </button>
          <div className="mt-2 flex items-center justify-center gap-2">
            <a
              href={r.program.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => onView(r.program)}
              className="text-xs font-medium text-zinc-600 hover:underline"
            >
              공고 원문 보기 ↗
            </a>
            {collectedIds.has(r.program.id) && (
              <span className="text-[11px] font-medium text-blue-600">· 📅 캘린더에 담김</span>
            )}
          </div>
        </div>
      ))}
      <button
        onClick={onMore}
        disabled={loadingMore}
        className="w-full rounded-xl border border-blue-200 bg-white py-2.5 text-sm font-semibold text-blue-700 transition-colors hover:bg-blue-50 disabled:opacity-50"
      >
        {loadingMore ? "다른 사업을 더 찾는 중이에요…" : "🔄 마음에 안 들면, 다른 지원사업 더 추천받기"}
      </button>

      {/* 마감 알림(가입) 진입점 — 추천 결과 하단 상시 노출 (v4.1 패치 3) */}
      {!hasLead && (
        <button
          onClick={onSignup}
          className="w-full rounded-xl border border-zinc-200 bg-zinc-50 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100"
        >
          🔔 이 공고들 마감 알림 받기 (간단 가입 · 비밀번호 없음)
        </button>
      )}

      {usingSample && (
        <p className="text-[11px] leading-5 text-zinc-400">
          ※ 지금은 예시 데이터예요. 정부 데이터 연동이 끝나면 실제 공고로 바뀝니다.
        </p>
      )}
    </div>
  );
}

// ── 결제 확인 (2026-07-09 ③ 결정: 그로블 결제 → 셀프서비스 주문번호 인증) ──
function Paywall({
  program,
  paid,
  onUnlock,
  onCancel,
  verifyOrder,
}: {
  program: Program | null;
  paid: boolean;
  onUnlock: () => void;
  onCancel: () => void;
  verifyOrder: (orderNo: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [entered, setEntered] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const orderDigits = entered.replace(/\D/g, "");
  const formatOk = /^\d{18}$/.test(orderDigits);

  async function submit() {
    if (!formatOk || checking) return;
    setChecking(true);
    setError("");
    const r = await verifyOrder(orderDigits);
    setChecking(false);
    if (r.ok) {
      setDone(true);
    } else {
      setError(r.error ?? "확인에 실패했어요.");
    }
  }

  function clickGroble() {
    // GA4 퍼널: 그로블 결제 링크 클릭 (③ 결정 — 전환 트리거 측정)
    track("groble_click", { program: program?.title ?? "", price: PRICE_KRW });
  }

  if (paid || done) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-5">
        <h3 className="text-sm font-bold text-zinc-900">✅ 결제 확인 완료</h3>
        <p className="mt-1 text-sm leading-6 text-zinc-700">
          사업계획서 초안 작성 기능이 열렸어요. 이 계정으로 로그인하면 언제든 이용할 수 있어요.
        </p>
        <button
          onClick={onUnlock}
          className="mt-3 w-full rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700"
        >
          {program ? `'${program.title}' 사업계획서 쓰러 가기 →` : "닫기"}
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-blue-200 bg-blue-50/50 p-5">
      <h3 className="text-lg font-extrabold leading-7 text-zinc-900">
        내 사업 정보로
        <br />
        사업계획서 초안을 생성합니다
      </h3>
      <p className="mt-1 text-[13px] text-zinc-500">결제 전, 무엇을 받는지 마지막으로 확인하세요.</p>

      {/* 결제 상품 요약 — 무엇을 사는지 한 박스에 (2026-07-11 디자인수정 §8) */}
      <div className="mt-3 overflow-hidden rounded-xl border border-zinc-200 bg-white">
        {program && (
          <div className="flex gap-3 border-b border-zinc-100 px-4 py-3 text-sm">
            <span className="shrink-0 font-semibold text-zinc-500">선택한 공고</span>
            <span className="font-semibold text-zinc-800">{program.title}</span>
          </div>
        )}
        <div className="px-4 py-3">
          <p className="text-xs font-semibold text-zinc-500">{PRICE}에 포함되는 내용</p>
          <ul className="mt-1.5 space-y-1 text-sm leading-6 text-zinc-700">
            <li>✓ 공고 양식에 맞춘 사업계획서 초안 (Word 파일, 도식 포함)</li>
            <li>✓ 사업 실적의 평가항목별 배치</li>
            <li>✓ 복사·수정 가능한 문장</li>
            <li>✓ 보완 포인트 안내</li>
          </ul>
        </div>
        <div className="flex items-center justify-between border-t border-zinc-100 bg-zinc-50 px-4 py-3">
          <span className="text-sm font-bold text-zinc-700">가격</span>
          <span className="text-base font-extrabold text-zinc-900">1회 생성 {PRICE}</span>
        </div>
      </div>

      {/* 1단계: 그로블에서 결제 */}
      <div className="mt-3 rounded-xl border border-zinc-200 bg-white p-3">
        <div className="text-xs font-semibold text-zinc-500">① 그로블에서 결제</div>
        {GROBLE_CHECKOUT_URL ? (
          <a
            href={GROBLE_CHECKOUT_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={clickGroble}
            className="mt-2 block rounded-xl bg-blue-600 py-3.5 text-center text-base font-bold text-white hover:bg-blue-700"
          >
            {PRICE} 결제하고 초안 생성하기
          </a>
        ) : (
          <p className="mt-1.5 text-xs leading-5 text-zinc-500">
            결제 링크 준비 중이에요. 이미 결제하셨다면 아래에 주문번호를 입력해 주세요.
          </p>
        )}
        <p className="mt-1.5 text-[11px] leading-4 text-zinc-400">
          카드 명세서에는 결제대행사 <b>‘주식회사 페이플’</b>로 표기돼요 (정상 결제입니다).
        </p>
      </div>

      {/* 2단계: 주문번호 입력 → 즉시 오픈 */}
      <div className="mt-2 rounded-xl border border-zinc-200 bg-white p-3">
        <div className="text-xs font-semibold text-zinc-500">
          ② 결제 후, 그로블 주문내역의 <b>주문번호(숫자 18자리)</b>를 입력하면 즉시 열려요
        </div>
        <p className="mt-1 text-[11px] leading-4 text-zinc-400">
          가입 이메일이 결제 이메일과 달라도 괜찮아요 — 주문번호가 열쇠예요.
        </p>
        <div className="mt-2 flex gap-2">
          <input
            value={entered}
            onChange={(e) => setEntered(e.target.value)}
            placeholder="예: 202607090949499786"
            inputMode="numeric"
            className="flex-1 rounded-xl border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
          />
          <button
            onClick={submit}
            disabled={checking || !formatOk}
            className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {checking ? "확인 중…" : "확인"}
          </button>
        </div>
        {entered && !formatOk && (
          <p className="mt-1 text-[11px] text-zinc-400">숫자 18자리를 입력해 주세요. ({orderDigits.length}/18)</p>
        )}
        {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
      </div>

      {/* 신뢰·리스크 완화 문구 (2026-07-11 디자인수정 §8) */}
      <ul className="mt-3 space-y-1 text-[11px] leading-4 text-zinc-500">
        <li>· 생성된 초안은 직접 복사·수정할 수 있습니다.</li>
        <li>· 입력한 사업정보는 초안 생성 목적으로만 사용됩니다.</li>
        <li>· 결과 보완 기준과 수정 가이드를 함께 제공합니다.</li>
        <li>· 최종 제출 전에는 사실관계와 증빙자료 확인이 필요합니다.</li>
      </ul>

      <button onClick={onCancel} className="mt-3 text-xs text-zinc-400 hover:underline">
        {program ? "← 이전 화면으로 돌아가기" : "닫기"}
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

// 후기 수집 팝업 — 초안 완성 직후. 별점·태그·한줄평·공개동의.
function ReviewModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (p: {
    rating: number;
    tags: string[];
    comment: string;
    publicConsent: boolean;
  }) => Promise<boolean>;
}) {
  const [rating, setRating] = useState(5);
  const [tags, setTags] = useState<string[]>([]);
  const [comment, setComment] = useState("");
  const [consent, setConsent] = useState(true);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  function toggleTag(t: string) {
    setTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  }

  async function submit() {
    if (busy) return;
    setBusy(true);
    const ok = await onSubmit({ rating, tags, comment: comment.trim(), publicConsent: consent });
    setBusy(false);
    if (ok) {
      setDone(true);
      setTimeout(onClose, 1800);
    } else {
      alert("후기 저장에 실패했어요. 잠시 후 다시 시도해 주세요.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {done ? (
          <div className="py-8 text-center">
            <div className="text-3xl">🙏</div>
            <p className="mt-3 text-sm font-semibold text-zinc-800">
              후기 감사해요! <b>수정 1회 무료</b>로 도와드릴게요.
            </p>
          </div>
        ) : (
          <>
            <h3 className="text-base font-bold text-zinc-900">🎉 초안이 완성됐어요!</h3>
            <p className="mt-1 text-xs leading-5 text-zinc-500">
              30초만 후기 남겨주시면 <b>수정 1회 무료</b> 드려요.
            </p>

            {/* 별점 */}
            <div className="mt-4">
              <div className="text-xs font-semibold text-zinc-600">1. 별점</div>
              <div className="mt-1 flex gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    onClick={() => setRating(n)}
                    className={`text-2xl transition-transform hover:scale-110 ${
                      n <= rating ? "" : "opacity-30 grayscale"
                    }`}
                    aria-label={`${n}점`}
                  >
                    ⭐
                  </button>
                ))}
              </div>
            </div>

            {/* 태그 (복수선택) */}
            <div className="mt-4">
              <div className="text-xs font-semibold text-zinc-600">2. 어떤 점이 좋았나요? (복수선택)</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {REVIEW_TAGS.map((t) => (
                  <button
                    key={t}
                    onClick={() => toggleTag(t)}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                      tags.includes(t)
                        ? "bg-blue-600 text-white"
                        : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                    }`}
                  >
                    {tags.includes(t) ? "✓ " : ""}
                    {t}
                  </button>
                ))}
              </div>
            </div>

            {/* 한줄평 */}
            <div className="mt-4">
              <div className="text-xs font-semibold text-zinc-600">3. 한 줄 더 (선택)</div>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={2}
                placeholder="자유롭게 적어주세요"
                className="mt-1 w-full resize-none rounded-xl border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
              />
            </div>

            {/* 공개 동의 */}
            <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs leading-5 text-zinc-600">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="mt-0.5"
              />
              <span>이 후기를 홈페이지에 공개해도 좋아요 (이름은 “김○○”처럼 일부만 표시돼요)</span>
            </label>

            <div className="mt-4 flex gap-2">
              <button
                onClick={onClose}
                className="flex-1 rounded-xl border border-zinc-200 py-2.5 text-sm font-medium text-zinc-500 hover:bg-zinc-50"
              >
                다음에
              </button>
              <button
                onClick={submit}
                disabled={busy}
                className="flex-1 rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {busy ? "보내는 중…" : "후기 보내고 혜택 받기"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
