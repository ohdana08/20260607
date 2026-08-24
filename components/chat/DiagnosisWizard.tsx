"use client";

import { useEffect, useRef, useState } from "react";
import type { Program, Recommendation } from "@/lib/match/types";
import { PRICE_LABEL } from "@/lib/config";
import { track } from "@/lib/ga";
import { authedHeaders } from "@/components/auth/AuthGate";
import {
  YEARS_OPTIONS,
  REGION_MAIN,
  REGION_ETC,
  NATIONWIDE,
  TYPE_OPTIONS,
  SECTOR_OPTIONS,
  type ButtonProfile,
} from "@/lib/match/buttonFilter";
import {
  EvidenceDiagnosisForm,
  EvidenceSheetCard,
  DraftPreviewCard,
  PreStageCard,
  StagePill,
} from "@/components/chat/EvidenceDiagnosis";
import type { EvidenceRow, EvidenceSheet } from "@/lib/diagnosis/evidence";

// ── 진단 위저드 (2026-07-12, 0711 디자인수정 전면 적용) ─────────────────
// 시안 그대로 "한 화면 = 한 단계"의 전체 화면 흐름:
//   0 무료·유료 범위 안내 → 1 도움 방식 선택 → 2 공고 입력 → 3 양식 확인
//   → 4~5 매출·실적(버튼 진단) → 6 무료 결과 → 7 유료 전환 안내 → 8 초안 미리보기 → 결제
// 추천 대화·결제 후 작성은 기존 챗이 담당하고, 이 컴포넌트는 진단 구간만 맡는다.

export interface WizImage {
  mediaType: string;
  data: string;
}
export interface WizFile {
  mediaType: string;
  data: string;
  name: string;
}
export interface WizDoc {
  name: string;
  text: string;
}
export interface WizPayload {
  imgs: WizImage[];
  pdfs: WizFile[];
  docs: WizDoc[];
}
export const EMPTY_PAYLOAD: WizPayload = { imgs: [], pdfs: [], docs: [] };

// 찾기 결과 세션 캐시(2026-07-12) — 위저드는 공고 선택 시 리마운트되므로(부모 key 변경),
// 조건·결과를 부모(Chat)가 들고 있다가 재진입 시 그대로 복원한다. 규칙 매칭은 결정적이라 안전.
export interface FindState {
  years: string;
  region: string;
  type: string;
  sector?: string;
  bizDesc?: string; // "무슨 사업 하세요?" 한 줄 — 정렬 전용
  recommendations: Recommendation[];
  relaxed: boolean;
  usingSample: boolean;
}

type EvidenceResult = { kind: "sheet"; sheet: EvidenceSheet } | { kind: "pre" };
export type WizardStart = "scope" | "notice" | "find";
type Step =
  | "scope"
  | "path"
  | "chosen"
  | "find-years"
  | "find-region"
  | "find-type"
  | "find-sector"
  | "find-desc"
  | "find-results"
  | "notice"
  | "form"
  | "form-pick"
  | "diagnosis"
  | "result"
  | "handoff"
  | "preview";

const ACCEPT = "image/*,application/pdf,.pdf,.docx,.hwp,.hwpx,.txt,.md";

// 마감일 → 사람이 읽는 라벨 (Chat.tsx deadlineLabel과 동일 규칙)
function ddayLabel(applyEnd: string | null): { text: string; urgent: boolean } {
  if (!applyEnd) return { text: "상시 모집", urgent: false };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((new Date(`${applyEnd}T00:00:00`).getTime() - today.getTime()) / 86400000);
  if (Number.isNaN(days)) return { text: applyEnd, urgent: false };
  if (days < 0) return { text: `마감됨 (${applyEnd})`, urgent: false };
  if (days === 0) return { text: `⏰ 오늘 마감!`, urgent: true };
  return { text: `D-${days} · ${applyEnd}까지`, urgent: days <= 7 };
}

// 찾기 단계 공용 — 단일 선택 카드 (누르면 바로 다음 단계로). sub: 회색 보조 설명 한 줄
function PickCard({ label, sub, onClick }: { label: string; sub?: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white px-5 py-4 text-left transition-colors hover:border-blue-400 hover:bg-blue-50/40"
    >
      <span className="min-w-0">
        <span className="block text-base font-semibold text-zinc-800">{label}</span>
        {sub && <span className="mt-0.5 block text-[13px] leading-5 text-zinc-500">{sub}</span>}
      </span>
      <span className="shrink-0 text-sm font-bold text-blue-500">→</span>
    </button>
  );
}

// 지원유형·관심분야 버튼 서브텍스트 (2026-07-12 확정 카피)
const TYPE_SUBS: Record<string, string> = {
  사업화: "시제품 제작, 마케팅, 판로개척 등 사업 실행에 쓰는 지원금",
  "R&D": "기술·제품 개발에 쓰는 연구개발 자금",
  "시설·공간": "사무실, 공장, 입주공간 등 장소 지원",
  "멘토링·교육": "전문가 상담, 창업교육, 컨설팅 지원",
  "융자·보증": "낮은 금리로 빌려주는 돈 (지원금과 달리 갚아야 해요)",
};
const SECTOR_SUBS: Record<string, string> = {
  창업: "예비창업, 초기창업, 재창업 (예: 예비창업패키지)",
  경영: "마케팅, 판로, 인력, 경영개선 (예: 소상공인 경영지원)",
  기술: "기술개발, 특허, 스마트공장 (예: 중소기업 R&D)",
  수출: "해외진출, 수출바우처, 박람회 (예: 수출초보기업 지원)",
  금융: "정책자금, 융자, 보증 (예: 소진공 정책자금)",
};

function Title({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mt-3 text-2xl font-extrabold leading-snug tracking-tight text-zinc-900 sm:text-[27px]">
      {children}
    </h2>
  );
}
function Sub({ children }: { children: React.ReactNode }) {
  return <p className="mt-1.5 text-[15px] text-zinc-500">{children}</p>;
}
function BackLink({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="mt-4 text-[13px] text-zinc-400 hover:text-zinc-600">
      {children}
    </button>
  );
}
// 큰 선택 카드 (도움 방식·양식 확인) — 선택지 자체가 안내 역할
function BigChoice({
  title,
  desc,
  onClick,
}: {
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full rounded-2xl border border-zinc-200 bg-white px-6 py-5 text-left transition-colors hover:border-blue-400 hover:bg-blue-50/40"
    >
      <span className="block text-lg font-bold text-zinc-900">{title}</span>
      <span className="mt-1 block text-sm leading-6 text-zinc-500">{desc}</span>
      <span className="mt-2.5 block text-sm font-bold text-blue-600">선택하기 →</span>
    </button>
  );
}

export default function DiagnosisWizard({
  start,
  program,
  evMap,
  evMapError,
  onRetryMap,
  evResult,
  evPrograms,
  evProgramsLoading,
  analysis,
  convertFiles,
  onDirectProgram,
  onChooseProgram,
  onViewProgram,
  hasLead,
  onSignup,
  onAnalyze,
  onSubmitEvidence,
  onPay,
  initialFind,
  seenRecs,
  onFindResults,
  derivedYears,
  prefillRegion,
}: {
  start: WizardStart;
  program: Program | null;
  evMap: EvidenceRow[] | null;
  evMapError: boolean;
  onRetryMap: () => void;
  evResult: EvidenceResult | null;
  evPrograms: Program[] | null;
  evProgramsLoading: boolean;
  analysis: { text: string; busy: boolean };
  convertFiles: (files: FileList | null) => Promise<WizPayload>;
  onDirectProgram: () => void; // 도움 방식 2: '직접 올린 공고' 프로그램 세팅
  onChooseProgram: (p: Program) => void; // 추천 결과에서 공고 선택 → 진단 흐름으로
  onViewProgram: (p: Program) => void; // 공고 원문 열람 → 관심 캘린더 수집
  hasLead: boolean;
  onSignup: () => void; // 알림 신청(간단 가입) 모달 열기
  onAnalyze: (payload: WizPayload, note: string) => void; // 공고·양식 AI 분석 (스트리밍, 부모가 수행)
  onSubmitEvidence: (revenue: string, items: string[]) => void;
  onPay: () => void;
  initialFind: FindState | null; // 세션 캐시 — 리마운트 후에도 이전 추천 목록 복원
  seenRecs: Recommendation[]; // 이번 세션에서 본 모든 추천 (중복 제거)
  onFindResults: (fs: FindState) => void;
  derivedYears: string | null; // 대화에서 파생된 업력 버킷 — 프리필용 (단일 userProfile)
  prefillRegion: string | null; // 3문항·캐시에서 온 지역 — 프리필용
}) {
  const [step, setStep] = useState<Step>(start === "find" ? "find-years" : start);
  // 찾기 4단계 선택값 + 매칭 결과 — 세션 캐시(initialFind)가 있으면 그대로 복원
  const [fYears, setFYears] = useState(initialFind?.years ?? "");
  const [fRegion, setFRegion] = useState(initialFind?.region ?? "");
  const [fType, setFType] = useState(initialFind?.type ?? "");
  const [fSector, setFSector] = useState<string | undefined>(initialFind?.sector);
  const [fBizDesc, setFBizDesc] = useState(initialFind?.bizDesc ?? "");
  const [finding, setFinding] = useState(false);
  const [findError, setFindError] = useState("");
  const [findRes, setFindRes] = useState<{
    recommendations: Recommendation[];
    relaxed: boolean;
    usingSample: boolean;
  } | null>(
    initialFind
      ? {
          recommendations: initialFind.recommendations,
          relaxed: initialFind.relaxed,
          usingSample: initialFind.usingSample,
        }
      : null,
  );
  const [shownCount, setShownCount] = useState(5);

  // 결과 3분할(2026-07-12): 본 목록 / 연관 낮음(접힘, 제외 아님) / 교육·행사(접힘)
  function splitRecs(recs: Recommendation[]) {
    const events = fType !== "멘토링·교육" ? recs.filter((r) => r.kind === "event") : [];
    const evIds = new Set(events.map((r) => r.program.id));
    const main = recs.filter((r) => !evIds.has(r.program.id) && r.relevance !== "low");
    const lows = recs.filter((r) => !evIds.has(r.program.id) && r.relevance === "low");
    return { main, lows, events };
  }
  const [payload, setPayload] = useState<WizPayload>(EMPTY_PAYLOAD);
  const [note, setNote] = useState("");
  const noticeInputRef = useRef<HTMLInputElement>(null);
  const formInputRef = useRef<HTMLInputElement>(null);
  const fileCount = payload.imgs.length + payload.pdfs.length + payload.docs.length;

  useEffect(() => {
    if (start === "scope") track("scope_intro_view");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 진단 답변 제출(로그인 게이트 포함)이 끝나 결과가 생기면 결과 화면으로
  useEffect(() => {
    if (evResult && step === "diagnosis") setStep("result");
  }, [evResult, step]);

  async function addFiles(list: FileList | null) {
    const p = await convertFiles(list);
    setPayload((prev) => ({
      imgs: [...prev.imgs, ...p.imgs].slice(0, 3),
      pdfs: [...prev.pdfs, ...p.pdfs].slice(0, 3),
      docs: [...prev.docs, ...p.docs].slice(0, 3),
    }));
  }

  function removeChip(kind: keyof WizPayload, idx: number) {
    setPayload((prev) => ({ ...prev, [kind]: prev[kind].filter((_, i) => i !== idx) }));
  }

  // 찾기 4단계 완료 → 규칙 기반 매칭 (LLM 없음, 즉시)
  async function runFind(profile: ButtonProfile) {
    setFinding(true);
    setFindError("");
    setFindRes(null);
    setShownCount(5);
    setStep("find-results");
    try {
      const res = await fetch("/api/match", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authedHeaders()) },
        body: JSON.stringify({ buttonProfile: profile, provider: "claude" }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFindError(typeof d?.error === "string" ? d.error : "공고를 찾지 못했어요. 다시 시도해 주세요.");
        return;
      }
      const recommendations: Recommendation[] = Array.isArray(d.recommendations) ? d.recommendations : [];
      setFindRes({
        recommendations,
        relaxed: Boolean(d.relaxed),
        usingSample: Boolean(d.usingSample),
      });
      // 세션 캐시에 보존 — 공고 선택으로 위저드가 리마운트돼도 목록이 사라지지 않게 (2026-07-12)
      onFindResults({
        years: profile.years,
        region: profile.region,
        type: profile.supportType,
        sector: profile.sector,
        bizDesc: profile.bizDesc,
        recommendations,
        relaxed: Boolean(d.relaxed),
        usingSample: Boolean(d.usingSample),
      });
      if (recommendations.length > 0) track("recommendation_shown", { count: recommendations.length, mode: "button" });
      else track("recommendation_empty", { mode: "button" });
    } catch {
      setFindError("연결이 끊겼어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setFinding(false);
    }
  }

  // 양식 확인 완료 → 공고·양식 분석을 백그라운드로 시작하고 버튼 진단으로 진행.
  // roleNote: 파일 역할(공고문/양식) 구분 정보 — 분석·초안이 양식을 정확히 따르게 한다.
  function proceedToDiagnosis(roleNote?: string) {
    if (fileCount > 0 || note.trim())
      onAnalyze(payload, [note, roleNote].filter(Boolean).join("\n"));
    track("start_diagnosis", { program: program?.title ?? "" });
    setStep("diagnosis");
  }

  // 공고 입력 완료 → 다음 단계 분기 (2026-07-12: 이중 업로드 인식)
  // 이미 2개 이상 올렸으면 "양식 있나요?"를 또 묻지 않는다:
  //   파일명으로 양식이 식별되면 바로 진단으로, 애매하면 어느 것이 양식인지 버튼으로 확인.
  function afterNotice() {
    const named = [...payload.pdfs, ...payload.docs].map((f) => f.name);
    if (fileCount >= 2) {
      const formLike = named.filter((n) => /양식|서식|신청서|사업\s*계획서/.test(n));
      if (formLike.length > 0) {
        proceedToDiagnosis(
          `[파일 역할] 사업계획서 양식: ${formLike.join(", ")} / 나머지 파일은 공고문입니다.`,
        );
        return;
      }
      setStep("form-pick");
      return;
    }
    setStep("form");
  }

  const chips = [
    ...payload.imgs.map((f, i) => ({ kind: "imgs" as const, i, label: `사진 ${i + 1}` })),
    ...payload.pdfs.map((f, i) => ({ kind: "pdfs" as const, i, label: f.name })),
    ...payload.docs.map((f, i) => ({ kind: "docs" as const, i, label: f.name })),
  ];

  return (
    <div className="mx-auto w-full max-w-[760px] pb-10">
      {/* ── 화면 0: 무료·유료 범위 안내 ─────────────────────────── */}
      {step === "scope" && (
        <section className="rounded-2xl border border-zinc-200 bg-white p-6 sm:p-9">
          <h2 className="text-2xl font-extrabold leading-snug tracking-tight text-zinc-900 sm:text-[28px]">
            내 사업에 맞는 정부지원사업을
            <br />
            무료로 진단해보세요
          </h2>
          <Sub>추천과 진단은 무료입니다. 사업계획서 초안 생성만 유료예요.</Sub>
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-5">
              <p className="text-xs font-extrabold tracking-wide text-emerald-700">무료로 받는 결과</p>
              <ul className="mt-2 space-y-1.5 text-[15px] leading-6 text-zinc-700">
                <li>✓ 지원사업 추천</li>
                <li>✓ 공고 적합도 진단</li>
                <li>✓ 공고 핵심 요약</li>
                <li>✓ 현재 사업의 강점과 보완점</li>
              </ul>
            </div>
            <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-5">
              <p className="text-xs font-extrabold tracking-wide text-amber-700">유료로 받는 결과</p>
              <p className="mt-2 text-[15px] font-bold leading-6 text-zinc-800">
                사업계획서 초안 자동 작성 · 1회 {PRICE_LABEL}
              </p>
              <ul className="mt-1 space-y-1.5 text-[15px] leading-6 text-zinc-700">
                <li>· 내 사업 정보 반영</li>
                <li>· 선택한 공고 기준 반영</li>
                <li>· 복사·수정 가능한 초안 제공</li>
              </ul>
            </div>
          </div>
          <button
            onClick={() => {
              track("diagnosis_start");
              setStep("path");
            }}
            className="mt-6 h-14 w-full rounded-xl bg-blue-600 text-lg font-extrabold text-white transition-colors hover:bg-blue-700"
          >
            무료 진단 시작하기
          </button>
          <p className="mt-2 text-center text-[13px] text-zinc-400">
            사업계획서 초안 생성은 1회 {PRICE_LABEL}입니다.
          </p>
          {findRes && findRes.recommendations.length > 0 && (
            <button
              onClick={() => setStep("find-results")}
              className="mt-3 w-full rounded-xl border border-zinc-200 bg-white py-3 text-sm font-semibold text-zinc-600 transition-colors hover:bg-zinc-50"
            >
              📋 이전 추천 목록 다시 보기 ({findRes.recommendations.length}건)
            </button>
          )}
        </section>
      )}

      {/* ── 화면 1: 도움 방식 선택 ─────────────────────────────── */}
      {step === "path" && (
        <section className="rounded-2xl border border-zinc-200 bg-white p-6 sm:p-9">
          <Title>어떤 도움이 필요하신가요?</Title>
          <Sub>하나를 골라주세요. 언제든 되돌아올 수 있어요.</Sub>
          <div className="mt-5 space-y-3">
            <BigChoice
              title="내 사업에 맞는 지원사업 찾기"
              desc="업력·지역·필요한 지원을 고르면 바로 공고를 추천받습니다."
              onClick={() => setStep("find-years")}
            />
            <BigChoice
              title="이미 정한 공고 진단하기"
              desc="선택한 공고에 지원 가능한지 확인합니다."
              onClick={() => {
                onDirectProgram();
                setStep("notice");
              }}
            />
          </div>
          {findRes && findRes.recommendations.length > 0 && (
            <button
              onClick={() => setStep("find-results")}
              className="mt-3 w-full rounded-xl border border-zinc-200 bg-white py-3 text-sm font-semibold text-zinc-600 transition-colors hover:bg-zinc-50"
            >
              📋 이전 추천 목록 다시 보기 ({findRes.recommendations.length}건)
            </button>
          )}
          <BackLink onClick={() => setStep("scope")}>← 이전으로</BackLink>
        </section>
      )}

      {/* ── 선택한 공고 카드 — 공고 입력에서 뒤로 왔을 때의 복귀 지점 (2026-07-12) ── */}
      {step === "chosen" && program && (
        <section className="rounded-2xl border border-zinc-200 bg-white p-6 sm:p-9">
          <StagePill>선택한 공고</StagePill>
          <Title>{program.title}</Title>
          {(program.supportField || program.region) && (
            <div className="mt-3 flex flex-wrap gap-1.5 text-xs text-zinc-500">
              {program.supportField && (
                <span className="rounded bg-zinc-100 px-2 py-1">{program.supportField}</span>
              )}
              {program.region && <span className="rounded bg-zinc-100 px-2 py-1">{program.region}</span>}
              {program.applyEnd && (
                <span className="rounded bg-zinc-100 px-2 py-1">마감 {program.applyEnd}</span>
              )}
            </div>
          )}
          {program.target && program.target !== "지원대상 정보 없음" && (
            <p className="mt-3 text-sm leading-6 text-zinc-600">🎯 {program.target}</p>
          )}
          {program.url && (
            <a
              href={program.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => onViewProgram(program)}
              className="mt-2 inline-block text-sm font-medium text-blue-600 underline underline-offset-2"
            >
              공고 원문 보기 ↗
            </a>
          )}
          <button
            onClick={() => setStep("notice")}
            className="mt-5 h-14 w-full rounded-xl bg-blue-600 text-lg font-extrabold text-white transition-colors hover:bg-blue-700"
          >
            이 공고로 진단 이어가기
          </button>
          {findRes && findRes.recommendations.length > 0 && (
            <button
              onClick={() => setStep("find-results")}
              className="mt-2.5 w-full rounded-xl border border-zinc-200 bg-white py-3 text-sm font-semibold text-zinc-600 transition-colors hover:bg-zinc-50"
            >
              📋 추천 목록에서 다른 공고 보기
            </button>
          )}
          <BackLink onClick={() => setStep("find-years")}>← 조건 바꿔 다시 찾기</BackLink>
        </section>
      )}

      {/* ── 찾기 1/4: 업력 ─────────────────────────────────────── */}
      {step === "find-years" && (
        <section className="rounded-2xl border border-zinc-200 bg-white p-6 sm:p-9">
          <StagePill>지원사업 찾기 1/4</StagePill>
          <Title>사업을 시작한 지 얼마나 되셨나요?</Title>
          <Sub>업력에 따라 지원할 수 있는 공고가 달라져요.</Sub>
          {/* 프로필 동기화(2026-07-12): 대화·이전 검색에서 확인된 업력은 프리필 — 아래에서 수정만 */}
          {(() => {
            const pre = initialFind?.years || derivedYears;
            if (!pre) return null;
            return (
              <div className="mt-5">
                <button
                  onClick={() => {
                    setFYears(pre);
                    setStep("find-region");
                  }}
                  className="flex w-full items-center justify-between rounded-xl border-2 border-blue-400 bg-blue-50/60 px-5 py-4 text-left"
                >
                  <span>
                    <span className="block text-base font-bold text-blue-800">✓ {pre}</span>
                    <span className="mt-0.5 block text-[13px] text-blue-600">
                      프로필에서 자동 인식했어요 — 이대로 계속
                    </span>
                  </span>
                  <span className="shrink-0 text-sm font-bold text-blue-500">→</span>
                </button>
                <p className="mt-3 text-[13px] font-semibold text-zinc-400">다르면 직접 선택(수정하기)</p>
              </div>
            );
          })()}
          <div className="mt-3 space-y-2.5">
            {YEARS_OPTIONS.map((v) => (
              <PickCard
                key={v}
                label={v}
                onClick={() => {
                  setFYears(v);
                  setStep("find-region");
                }}
              />
            ))}
          </div>
          {start !== "find" && <BackLink onClick={() => setStep("path")}>← 이전으로</BackLink>}
        </section>
      )}

      {/* ── 찾기 2/4: 지역 — 부산·울산·경남 버튼 + 나머지 시도 드롭다운 + 전국 ── */}
      {step === "find-region" && (
        <section className="rounded-2xl border border-zinc-200 bg-white p-6 sm:p-9">
          <StagePill>지원사업 찾기 2/4</StagePill>
          <Title>어느 지역에서 사업하세요?</Title>
          <Sub>해당 지역 공고와 전국(중앙부처) 공고를 함께 찾아드려요.</Sub>
          {(() => {
            const pre = initialFind?.region || prefillRegion;
            if (!pre) return null;
            return (
              <div className="mt-5">
                <button
                  onClick={() => {
                    setFRegion(pre);
                    setStep("find-type");
                  }}
                  className="flex w-full items-center justify-between rounded-xl border-2 border-blue-400 bg-blue-50/60 px-5 py-4 text-left"
                >
                  <span>
                    <span className="block text-base font-bold text-blue-800">✓ {pre}</span>
                    <span className="mt-0.5 block text-[13px] text-blue-600">
                      프로필에서 자동 인식했어요 — 이대로 계속
                    </span>
                  </span>
                  <span className="shrink-0 text-sm font-bold text-blue-500">→</span>
                </button>
                <p className="mt-3 text-[13px] font-semibold text-zinc-400">다르면 직접 선택(수정하기)</p>
              </div>
            );
          })()}
          <div className="mt-3 space-y-2.5">
            {REGION_MAIN.map((v) => (
              <PickCard
                key={v}
                label={v}
                onClick={() => {
                  setFRegion(v);
                  setStep("find-type");
                }}
              />
            ))}
            <PickCard
              label={NATIONWIDE}
              sub="지역 제한 없이 전국 어디서나 지원 가능한 공고"
              onClick={() => {
                setFRegion(NATIONWIDE);
                setStep("find-type");
              }}
            />
            <select
              value=""
              onChange={(e) => {
                if (!e.target.value) return;
                setFRegion(e.target.value);
                setStep("find-type");
              }}
              className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-4 text-base font-semibold text-zinc-500 outline-none focus:border-blue-500"
            >
              <option value="">다른 지역 선택…</option>
              {REGION_ETC.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <BackLink onClick={() => setStep("find-years")}>← 이전으로</BackLink>
        </section>
      )}

      {/* ── 찾기 3/4: 지원유형 ─────────────────────────────────── */}
      {step === "find-type" && (
        <section className="rounded-2xl border border-zinc-200 bg-white p-6 sm:p-9">
          <StagePill>지원사업 찾기 3/4</StagePill>
          <Title>어떤 지원이 가장 필요하세요?</Title>
          <Sub>고르신 지원을 우선으로 보여드려요.</Sub>
          <div className="mt-5 space-y-2.5">
            {TYPE_OPTIONS.map((v) => (
              <PickCard
                key={v}
                label={v}
                sub={TYPE_SUBS[v]}
                onClick={() => {
                  setFType(v);
                  setStep("find-sector");
                }}
              />
            ))}
          </div>
          <BackLink onClick={() => setStep("find-region")}>← 이전으로</BackLink>
        </section>
      )}

      {/* ── 찾기 4/4: 분야 (보너스 매칭 — 골라도 결과가 줄지 않음) ── */}
      {step === "find-sector" && (
        <section className="rounded-2xl border border-zinc-200 bg-white p-6 sm:p-9">
          <StagePill>지원사업 찾기 4/4</StagePill>
          <Title>관심 분야가 있으세요?</Title>
          <Sub>골라도 결과가 줄지 않아요 — 해당 분야 특화 공고를 위로 올려드릴 뿐이에요.</Sub>
          <div className="mt-5 space-y-2.5">
            {SECTOR_OPTIONS.map((v) => (
              <PickCard
                key={v}
                label={v}
                sub={SECTOR_SUBS[v]}
                onClick={() => {
                  setFSector(v);
                  setStep("find-desc");
                }}
              />
            ))}
          </div>
          <button
            onClick={() => {
              setFSector(undefined);
              setStep("find-desc");
            }}
            className="mt-3 w-full rounded-xl border border-zinc-200 bg-white py-3 text-sm font-semibold text-zinc-500 transition-colors hover:bg-zinc-50"
          >
            건너뛰기
          </button>
          <BackLink onClick={() => setStep("find-type")}>← 이전으로</BackLink>
        </section>
      )}

      {/* ── 찾기 +1: 아이템 한 줄 (선택) — 정렬 전용, 결과가 줄지 않는다 (2026-07-12) ── */}
      {step === "find-desc" && (
        <section className="rounded-2xl border border-zinc-200 bg-white p-6 sm:p-9">
          <StagePill>지원사업 찾기 · 마지막</StagePill>
          <Title>무슨 사업 하세요? 한 줄로 알려주세요</Title>
          <Sub>적어도 결과가 줄지 않아요 — 내 사업과 가까운 공고를 위로 올려드릴 뿐이에요.</Sub>
          <input
            value={fBizDesc}
            onChange={(e) => setFBizDesc(e.target.value)}
            placeholder="예: 소상공인 대상 AI 교육·컨설팅"
            maxLength={200}
            onKeyDown={(e) => {
              if (e.key === "Enter" && fBizDesc.trim())
                void runFind({
                  years: fYears,
                  region: fRegion,
                  supportType: fType,
                  sector: fSector,
                  bizDesc: fBizDesc.trim(),
                });
            }}
            className="mt-5 w-full rounded-xl border border-zinc-200 px-4 py-4 text-base outline-none focus:border-blue-500"
          />
          <button
            onClick={() =>
              void runFind({
                years: fYears,
                region: fRegion,
                supportType: fType,
                sector: fSector,
                bizDesc: fBizDesc.trim() || undefined,
              })
            }
            disabled={!fBizDesc.trim()}
            className="mt-4 h-14 w-full rounded-xl bg-blue-600 text-lg font-extrabold text-white transition-colors hover:bg-blue-700 disabled:opacity-40"
          >
            이 내용으로 공고 찾기
          </button>
          <button
            onClick={() =>
              void runFind({ years: fYears, region: fRegion, supportType: fType, sector: fSector })
            }
            className="mt-2.5 w-full rounded-xl border border-zinc-200 bg-white py-3 text-sm font-semibold text-zinc-500 transition-colors hover:bg-zinc-50"
          >
            건너뛰고 결과 보기
          </button>
          <BackLink onClick={() => setStep("find-sector")}>← 이전으로</BackLink>
        </section>
      )}

      {/* ── 찾기 결과 ─────────────────────────────────────────── */}
      {step === "find-results" && (
        <section>
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 sm:p-8">
            <StagePill>지원사업 찾기 · 결과</StagePill>
            {finding ? (
              <p className="mt-4 text-base text-zinc-600">
                {fYears} · {fRegion} · {fType} 조건으로 모집 중인 공고를 찾고 있어요… 🔎
              </p>
            ) : findError ? (
              <div className="mt-4">
                <p className="text-base text-zinc-700">{findError}</p>
                <button
                  onClick={() =>
                    void runFind({ years: fYears, region: fRegion, supportType: fType })
                  }
                  className="mt-3 w-full rounded-xl bg-blue-600 py-3 text-base font-bold text-white hover:bg-blue-700"
                >
                  다시 시도
                </button>
              </div>
            ) : findRes && findRes.recommendations.length === 0 ? (
              <div className="mt-3">
                <Title>지금 모집 중인 공고 중엔 딱 맞는 게 없어요</Title>
                <Sub>
                  큰 지원사업은 연 1~2회만 열려요. 조건을 조금 넓히거나, 새 공고가 열리면 알림을
                  받아보세요.
                </Sub>
                <div className="mt-5 space-y-2.5">
                  {!fRegion.includes("전국") && (
                    <PickCard
                      label="지역을 전국(중앙부처)으로 넓혀 다시 찾기"
                      onClick={() => {
                        setFRegion("전국(중앙부처)");
                        void runFind({ years: fYears, region: "전국(중앙부처)", supportType: fType });
                      }}
                    />
                  )}
                  <PickCard label="필요한 지원유형 바꾸기" onClick={() => setStep("find-type")} />
                  <PickCard label="업력 다시 고르기" onClick={() => setStep("find-years")} />
                </div>
                {!hasLead && (
                  <button
                    onClick={onSignup}
                    className="mt-4 w-full rounded-xl bg-blue-600 py-3.5 text-base font-bold text-white hover:bg-blue-700"
                  >
                    🔔 맞는 공고가 열리면 알려드릴게요 — 알림 신청
                  </button>
                )}
              </div>
            ) : findRes ? (
              <div className="mt-3">
                <Title>이런 지원사업이 잘 맞을 것 같아요</Title>
                <Sub>
                  {fYears} · {fRegion} · {fType}
                  {findRes.relaxed
                    ? ` — 지금 모집 중인 ‘${fType}’ 공고가 없어서, 같은 조건의 다른 지원 공고를 보여드려요.`
                    : " 조건으로 찾았어요."}
                </Sub>
              </div>
            ) : null}
          </div>

          {!finding && findRes && findRes.recommendations.length > 0 && (
            <div className="mt-3 space-y-3">
              {splitRecs(findRes.recommendations).main.slice(0, shownCount).map((r) => {
                const dl = ddayLabel(r.program.applyEnd);
                return (
                  <div key={r.program.id} className="rounded-2xl border border-zinc-200 bg-white p-5">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-base font-bold leading-6 text-zinc-900">{r.program.title}</h3>
                      <span
                        className={
                          r.eligibility === "조건 충족"
                            ? "shrink-0 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700"
                            : "shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700"
                        }
                      >
                        {r.eligibility}
                      </span>
                    </div>
                    {r.eligibility === "확인 필요" && r.checkReason && (
                      <p className="mt-1 text-xs leading-5 text-amber-700">확인할 것: {r.checkReason}</p>
                    )}
                    {/* 내 사업과의 연관(2026-07-12) — 실제 근거가 있을 때만, 복붙 금지 */}
                    {r.bizWhy && (
                      <p className="mt-1 text-xs leading-5 text-blue-700">🔗 내 사업과의 연관: {r.bizWhy}</p>
                    )}
                    {/* 조건 원문 덤프 대신 내 조건 대조형 칩 (✓ 일치 / ⚠️ 주의) */}
                    <div className="mt-2.5 flex flex-wrap gap-1.5 text-xs">
                      <span
                        className={`rounded px-2 py-1 ${dl.urgent ? "bg-red-50 font-semibold text-red-600" : "bg-zinc-100 text-zinc-500"}`}
                      >
                        📅 {dl.text}
                      </span>
                      {(r.conditions ?? []).map((c) => (
                        <span
                          key={c}
                          className={
                            c.startsWith("⚠️")
                              ? "rounded bg-amber-50 px-2 py-1 font-medium text-amber-700"
                              : c.startsWith("✓")
                                ? "rounded bg-emerald-50 px-2 py-1 text-emerald-700"
                                : "rounded bg-zinc-100 px-2 py-1 text-zinc-500"
                          }
                        >
                          {c}
                        </span>
                      ))}
                    </div>
                    <button
                      onClick={() => onChooseProgram(r.program)}
                      className="mt-3.5 h-12 w-full rounded-xl bg-blue-600 text-base font-bold text-white transition-colors hover:bg-blue-700"
                    >
                      이 공고로 무료 진단 받기
                    </button>
                    <div className="mt-2 text-center">
                      <a
                        href={r.program.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => onViewProgram(r.program)}
                        className="text-sm font-medium text-zinc-500 underline underline-offset-2 hover:text-zinc-700"
                      >
                        공고 원문 보기 ↗
                      </a>
                    </div>
                  </div>
                );
              })}
              {(() => {
                const mainCount = splitRecs(findRes.recommendations).main.length;
                return mainCount > shownCount ? (
                  <button
                    onClick={() => setShownCount((n) => n + 5)}
                    className="w-full rounded-xl border border-blue-200 bg-white py-3 text-base font-semibold text-blue-700 transition-colors hover:bg-blue-50"
                  >
                    공고 더 보기 ({mainCount - shownCount}건 남음)
                  </button>
                ) : null;
              })()}

              {/* 연관 낮음 접힘(2026-07-12) — 제외가 아니라 하단 배치. 진단 CTA는 그대로 유지 */}
              {(() => {
                const lows = splitRecs(findRes.recommendations).lows;
                if (lows.length === 0) return null;
                return (
                  <details className="rounded-2xl border border-zinc-200 bg-white p-5">
                    <summary className="cursor-pointer text-sm font-semibold text-zinc-600">
                      🧭 내 사업과 거리가 있어 보이는 공고 {lows.length}건 보기
                    </summary>
                    <p className="mt-2 text-xs leading-5 text-zinc-500">
                      특정 산업·기관 자산 활용 공고 등이에요. 조건(지역·업력)은 맞아서 목록에서 빼지
                      않았어요 — 해당된다면 그대로 진단받으실 수 있어요.
                    </p>
                    <div className="mt-3 space-y-2">
                      {lows.map((r) => (
                        <div
                          key={r.program.id}
                          className="flex items-center justify-between gap-3 rounded-xl border border-zinc-100 px-4 py-3"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-zinc-800">{r.program.title}</p>
                            <a
                              href={r.program.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={() => onViewProgram(r.program)}
                              className="text-xs text-blue-600 underline underline-offset-2"
                            >
                              공고 원문 ↗
                            </a>
                          </div>
                          <button
                            onClick={() => onChooseProgram(r.program)}
                            className="shrink-0 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700"
                          >
                            진단 받기
                          </button>
                        </div>
                      ))}
                    </div>
                  </details>
                );
              })()}

              {/* 교육·행사형 분리(QA #2) — 하단 접힘 + '사업계획서 불필요' 라벨 + 유료 CTA 없음 */}
              {fType !== "멘토링·교육" &&
                (() => {
                  const events = splitRecs(findRes.recommendations).events;
                  if (events.length === 0) return null;
                  return (
                    <details className="rounded-2xl border border-zinc-200 bg-white p-5">
                      <summary className="cursor-pointer text-sm font-semibold text-zinc-600">
                        🎓 교육·행사 공고 {events.length}건 보기
                      </summary>
                      <p className="mt-2 text-xs leading-5 text-zinc-500">
                        아래 공고들은 사업계획서가 필요 없어요 — 신청서만 내면 됩니다. (초안 서비스
                        대상이 아니라 결제 안내를 붙이지 않아요)
                      </p>
                      <div className="mt-3 space-y-2">
                        {events.map((r) => {
                          const dl = ddayLabel(r.program.applyEnd);
                          return (
                            <div
                              key={r.program.id}
                              className="rounded-xl border border-zinc-100 px-4 py-3"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <p className="min-w-0 text-sm font-semibold leading-5 text-zinc-800">
                                  {r.program.title}
                                </p>
                                <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-500">
                                  신청서만
                                </span>
                              </div>
                              <p className={`mt-1 text-xs ${dl.urgent ? "font-semibold text-red-600" : "text-zinc-500"}`}>
                                📅 {dl.text}
                              </p>
                              <a
                                href={r.program.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={() => onViewProgram(r.program)}
                                className="mt-1 inline-block text-xs font-semibold text-blue-600 underline underline-offset-2"
                              >
                                공고 원문 보고 바로 신청 ↗
                              </a>
                            </div>
                          );
                        })}
                      </div>
                    </details>
                  );
                })()}
              {!hasLead && (
                <button
                  onClick={onSignup}
                  className="w-full rounded-xl border border-zinc-200 bg-zinc-50 py-3 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100"
                >
                  🔔 이 공고들 마감 알림 받기 (간단 가입 · 비밀번호 없음)
                </button>
              )}
              {findRes.usingSample && (
                <p className="text-xs leading-5 text-zinc-400">
                  ※ 지금은 예시 데이터예요. 정부 데이터 연동이 끝나면 실제 공고로 바뀝니다.
                </p>
              )}
              <div className="text-center">
                <button
                  onClick={() => setStep("find-years")}
                  className="py-1 text-sm text-zinc-400 underline underline-offset-2 hover:text-zinc-600"
                >
                  조건 바꿔서 다시 찾기
                </button>
              </div>
            </div>
          )}

          {/* 이전에 본 공고 — 조건을 바꿔 재추천해도 세션 내 목록은 사라지지 않는다 (2026-07-12) */}
          {(() => {
            const currentIds = new Set((findRes?.recommendations ?? []).map((r) => r.program.id));
            const prev = seenRecs.filter((r) => !currentIds.has(r.program.id));
            if (prev.length === 0) return null;
            return (
              <details className="mt-3 rounded-2xl border border-zinc-200 bg-white p-5">
                <summary className="cursor-pointer text-sm font-semibold text-zinc-600">
                  📂 이전에 본 공고 ({prev.length}건)
                </summary>
                <div className="mt-3 space-y-2">
                  {prev.map((r) => (
                    <div
                      key={r.program.id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-zinc-100 px-4 py-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-zinc-800">{r.program.title}</p>
                        <a
                          href={r.program.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => onViewProgram(r.program)}
                          className="text-xs text-blue-600 underline underline-offset-2"
                        >
                          공고 원문 ↗
                        </a>
                      </div>
                      <button
                        onClick={() => onChooseProgram(r.program)}
                        className="shrink-0 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700"
                      >
                        진단 받기
                      </button>
                    </div>
                  ))}
                </div>
              </details>
            );
          })()}
        </section>
      )}

      {/* ── 화면 2: 공고 입력 ─────────────────────────────────── */}
      {step === "notice" && (
        <section className="rounded-2xl border border-zinc-200 bg-white p-6 sm:p-9">
          <StagePill>무료 진단 1/4</StagePill>
          <Title>지원할 공고를 올려주세요</Title>
          <Sub>
            {program && program.source !== "sample"
              ? `‘${program.title}’ 공고문, 화면 캡처 또는 공고 링크를 등록해주세요.`
              : "공고문, 화면 캡처 또는 공고 링크를 등록해주세요."}
          </Sub>
          <input
            ref={noticeInputRef}
            type="file"
            accept={ACCEPT}
            multiple
            className="hidden"
            onChange={(e) => {
              void addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            onClick={() => noticeInputRef.current?.click()}
            className="mt-5 w-full rounded-2xl border-2 border-dashed border-blue-300 bg-blue-50/50 px-4 py-9 text-center text-[15px] text-zinc-600 transition-colors hover:bg-blue-50"
          >
            📎 <b className="text-blue-700">파일 올리기</b> — 사진·PDF·워드·한글(hwpx) 모두 괜찮아요
          </button>
          {chips.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-2">
              {chips.map((c) => (
                <span
                  key={`${c.kind}-${c.i}`}
                  className="flex max-w-[240px] items-center gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-xs text-zinc-700"
                >
                  📄 <span className="truncate">{c.label}</span>
                  <button
                    onClick={() => removeChip(c.kind, c.i)}
                    className="ml-0.5 text-zinc-400 hover:text-red-500"
                    aria-label="첨부 제거"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="🔗 또는 공고 링크 붙여넣기 / 어떤 사업에 낼지 한 줄 설명"
            className="mt-2.5 w-full rounded-xl border border-zinc-200 px-4 py-3.5 text-[15px] outline-none focus:border-blue-500"
          />
          <button
            onClick={afterNotice}
            disabled={fileCount === 0 && !note.trim()}
            className="mt-4 h-14 w-full rounded-xl bg-blue-600 text-lg font-extrabold text-white transition-colors hover:bg-blue-700 disabled:opacity-40"
          >
            공고 분석하기
          </button>
          <details className="mt-4 text-sm">
            <summary className="w-fit cursor-pointer text-blue-600 underline underline-offset-2">
              양식이나 공고문이 없나요?
            </summary>
            <p className="mt-2 rounded-xl bg-zinc-50 px-4 py-3 leading-6 text-zinc-600">
              자유양식·IR 사업이라면 공고 페이지의 지원내용과 평가방법을 캡처해 올려주세요. 아무것도
              없다면 위 입력칸에 어떤 사업에 낼 건지 한 줄만 적어주셔도 돼요.
            </p>
          </details>
          {start === "scope" ? (
            <BackLink onClick={() => setStep("path")}>← 이전으로</BackLink>
          ) : (
            // 추천에서 선택해 들어온 경우 — 뒤로가기는 추천 초기화면이 아니라 '선택한 공고 카드'로 (2026-07-12)
            program && (
              <BackLink onClick={() => setStep("chosen")}>← 선택한 공고 다시 보기</BackLink>
            )
          )}
        </section>
      )}

      {/* ── 화면 3: 사업계획서 양식 확인 ───────────────────────── */}
      {step === "form" && (
        <section className="rounded-2xl border border-zinc-200 bg-white p-6 sm:p-9">
          <StagePill>무료 진단 1/4</StagePill>
          <Title>사업계획서 양식이 있나요?</Title>
          <Sub>없어도 진단은 그대로 진행됩니다.</Sub>
          <input
            ref={formInputRef}
            type="file"
            accept={ACCEPT}
            multiple
            className="hidden"
            onChange={async (e) => {
              const formName = e.target.files?.[0]?.name ?? "";
              await addFiles(e.target.files);
              e.target.value = "";
              proceedToDiagnosis(
                formName ? `[파일 역할] '${formName}' 파일이 사업계획서 양식입니다.` : undefined,
              );
            }}
          />
          <div className="mt-5 space-y-3">
            <BigChoice
              title="양식 파일 올리기"
              desc="공고에서 받은 사업계획서 양식(한글·PDF·워드·캡처)을 올립니다."
              onClick={() => formInputRef.current?.click()}
            />
            <BigChoice
              title="양식 없이 진행하기"
              desc="표준 목차 기준으로 진단하고, 양식은 나중에 올려도 돼요."
              onClick={() => proceedToDiagnosis("[파일 역할] 별도 사업계획서 양식은 없습니다.")}
            />
          </div>
          <BackLink onClick={() => setStep("notice")}>← 공고 입력으로</BackLink>
        </section>
      )}

      {/* ── 화면 3b: 파일 역할 확인 — 2개 이상 올렸는데 어느 것이 양식인지 애매할 때만 ── */}
      {step === "form-pick" && (
        <section className="rounded-2xl border border-zinc-200 bg-white p-6 sm:p-9">
          <StagePill>무료 진단 1/4</StagePill>
          <Title>올려주신 파일 중 어느 것이 ‘사업계획서 양식’인가요?</Title>
          <Sub>공고문과 양식을 구분해두면 초안이 양식 항목 그대로 작성돼요.</Sub>
          <div className="mt-5 space-y-2.5">
            {chips.map((c) => (
              <PickCard
                key={`${c.kind}-${c.i}`}
                label={c.label}
                onClick={() =>
                  proceedToDiagnosis(
                    `[파일 역할] '${c.label}' 파일이 사업계획서 양식이고, 나머지는 공고문입니다.`,
                  )
                }
              />
            ))}
            <PickCard
              label="양식은 없어요 — 전부 공고문이에요"
              sub="표준 목차 기준으로 진단하고, 양식은 나중에 올려도 돼요."
              onClick={() =>
                proceedToDiagnosis("[파일 역할] 올린 파일은 모두 공고문이고, 별도 양식은 없습니다.")
              }
            />
          </div>
          <BackLink onClick={() => setStep("notice")}>← 공고 입력으로</BackLink>
        </section>
      )}

      {/* ── 화면 4~5: 매출·실적 버튼 진단 (2/4 → 3/4) ──────────── */}
      {step === "diagnosis" && (
        <section>
          <EvidenceDiagnosisForm
            rows={evMap}
            mapError={evMapError}
            onRetryMap={onRetryMap}
            onSubmit={onSubmitEvidence}
          />
          <BackLink onClick={() => setStep("form")}>← 양식 확인으로</BackLink>
        </section>
      )}

      {/* ── 화면 6: 무료 진단 결과 (4/4) ───────────────────────── */}
      {step === "result" &&
        evResult &&
        (evResult.kind === "pre" ? (
          <section>
            <PreStageCard programs={evPrograms} loading={evProgramsLoading} />
            <button
              onClick={() => setStep("find-years")}
              className="mt-3 w-full rounded-xl border border-zinc-200 bg-white py-3 text-sm font-semibold text-zinc-600 transition-colors hover:bg-zinc-50"
            >
              내게 맞는 다른 지원사업 찾아보기
            </button>
          </section>
        ) : (
          <EvidenceSheetCard
            sheet={evResult.sheet}
            analysis={analysis}
            onPreview={() => {
              track("draft_preview_click", { program: program?.title ?? "" });
              setStep("handoff");
            }}
          />
        ))}

      {/* ── 화면 7: 유료 전환 안내 — 무료가 끝났음을 선언 ───────── */}
      {step === "handoff" && (
        <section className="rounded-2xl border border-zinc-200 bg-white p-6 text-center sm:p-10">
          <span className="inline-block rounded-full bg-emerald-100 px-4 py-1.5 text-sm font-bold text-emerald-800">
            ✓ 무료 진단 완료
          </span>
          <h2 className="mt-4 text-2xl font-extrabold leading-snug tracking-tight text-zinc-900 sm:text-[27px]">
            추천과 진단은 무료였습니다
          </h2>
          <div className="mt-3">
            <span className="inline-block rounded-full bg-amber-100 px-4 py-1.5 text-sm font-bold text-amber-800">
              다음 단계 · 유료 서비스 · 1회 {PRICE_LABEL}
            </span>
          </div>
          <p className="mx-auto mt-4 max-w-md text-[15px] leading-7 text-zinc-600">
            이제 이 공고에 맞는 사업계획서 초안을 생성할 수 있어요. 결제 전에 어떤 목차와 문장이
            만들어지는지 먼저 확인해보세요.
          </p>
          <button
            onClick={() => setStep("preview")}
            className="mt-6 h-14 w-full rounded-xl bg-blue-600 text-lg font-extrabold text-white transition-colors hover:bg-blue-700"
          >
            초안 미리보기 확인하기
          </button>
          <button
            onClick={() => setStep("result")}
            className="mt-2.5 h-12 w-full rounded-xl border border-zinc-200 bg-white text-[15px] font-semibold text-zinc-500 transition-colors hover:bg-zinc-50"
          >
            무료 진단 결과로 돌아가기
          </button>
        </section>
      )}

      {/* ── 화면 8: 초안 목차 미리보기 → 결제(모달) ─────────────── */}
      {step === "preview" && evResult?.kind === "sheet" && (
        <DraftPreviewCard
          sheet={evResult.sheet}
          onPay={onPay}
          onBack={() => setStep("result")}
          onView={() => track("draft_preview_view", { program: program?.title ?? "" })}
        />
      )}
    </div>
  );
}
