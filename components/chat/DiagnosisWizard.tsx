"use client";
/* eslint-disable react-hooks/set-state-in-effect -- 부모의 비동기 진단 결과를 위저드 단계에 동기화합니다. */

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
import {
  plainCheckReason,
  plainCondition,
  plainEligibilityLabel,
  plainProgramExplanation,
  plainSectorOption,
  plainSupportOption,
  plainYearOption,
} from "@/lib/plain-language";

// ── 진단 위저드 (2026-07-12, 0711 디자인수정 전면 적용) ─────────────────
// 시안 그대로 "한 화면 = 한 단계"의 전체 화면 흐름:
//   0 도움 방식 선택·무료 범위 안내 → 1 공고 입력 → 2 양식 확인
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

// 추천 카드에서 계산한 제출서류 판정을 선택한 Program에도 보존한다.
// 이 값이 빠지면 무료 결과 뒤에서 6단계 전환이 "확인 중"으로 멈춘다.
function programWithApplicationDecision(recommendation: Recommendation): Program {
  return {
    ...recommendation.program,
    applicationKind: recommendation.applicationKind ?? recommendation.program.applicationKind,
    requiresBusinessPlan:
      recommendation.requiresBusinessPlan ?? recommendation.program.requiresBusinessPlan,
  };
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
    const events = recs.filter((r) => r.requiresBusinessPlan === false);
    const evIds = new Set(events.map((r) => r.program.id));
    const main = recs.filter((r) => !evIds.has(r.program.id) && r.relevance !== "low");
    const lows = recs.filter((r) => !evIds.has(r.program.id) && r.relevance === "low");
    return { main, lows, events };
  }
  const [payload, setPayload] = useState<WizPayload>(EMPTY_PAYLOAD);
  // 추천에서 선택한 공식 공고 URL을 사용자가 다시 복사하지 않아도 분석 입력에 그대로 이월한다.
  const [note, setNote] = useState(program?.url ?? "");
  const noticeInputRef = useRef<HTMLInputElement>(null);
  const formInputRef = useRef<HTMLInputElement>(null);
  const fileCount = payload.imgs.length + payload.pdfs.length + payload.docs.length;

  useEffect(() => {
    if (start === "scope") track("scope_intro_view");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 단계별 조회만으로도 어디에서 이탈하는지 볼 수 있다. 자유입력 내용은 GA4로 보내지 않는다.
  useEffect(() => {
    track("plain_flow_step_view", { step });
  }, [step]);

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
        setFindError(typeof d?.error === "string" ? d.error : "지원사업을 찾지 못했어요. 다시 시도해 주세요.");
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
      {/* ── 화면 0: 처음 온 사람의 두 가지 출발점 ───────────────── */}
      {step === "scope" && (
        <section className="rounded-2xl border border-zinc-200 bg-white p-6 sm:p-9">
          <h2 className="text-2xl font-extrabold leading-snug tracking-tight text-zinc-900 sm:text-[28px]">
            어떤 도움이 필요하세요?
          </h2>
          <Sub>지원사업 이름을 몰라도 괜찮아요. 지금 상황에 맞는 쪽을 골라주세요.</Sub>
          <div className="mt-5 space-y-3">
            <BigChoice
              title="어떤 지원을 받을 수 있는지 모르겠어요"
              desc="어려운 검색어 없이 지금 하는 일과 필요한 도움만 알려주시면 됩니다."
              onClick={() => {
                track("diagnosis_start", { path: "find" });
                setStep("find-years");
              }}
            />
            <BigChoice
              title="이미 보고 있는 지원사업이 있어요"
              desc="안내문이나 링크를 올리면 내가 신청해도 되는지부터 쉽게 풀어드려요."
              onClick={() => {
                track("diagnosis_start", { path: "direct" });
                onDirectProgram();
                setStep("notice");
              }}
            />
          </div>
          <div className="mt-5 rounded-xl bg-zinc-50 px-4 py-3 text-[13px] leading-6 text-zinc-600">
            <p><b className="text-emerald-700">맞는 지원 찾기와 내가 신청할 수 있는지 확인하는 건 무료</b>예요.</p>
            <p>긴 문서 작성이 필요한 사업을 골랐을 때만 최종 Word 1회와 묶음 AI 수정 최대 3회가 포함된 {PRICE_LABEL} 상품을 안내합니다.</p>
          </div>
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
          <Title>어떤 도움이 필요하세요?</Title>
          <Sub>지원사업 이름을 몰라도 괜찮아요. 지금 상황에 맞는 쪽을 골라주세요.</Sub>
          <div className="mt-5 space-y-3">
            <BigChoice
              title="어떤 지원을 받을 수 있는지 모르겠어요"
              desc="어려운 검색어 없이 지금 하는 일과 필요한 도움만 알려주시면 됩니다."
              onClick={() => {
                track("diagnosis_start", { path: "find" });
                setStep("find-years");
              }}
            />
            <BigChoice
              title="이미 보고 있는 지원사업이 있어요"
              desc="안내문이나 링크를 올리면 내가 신청해도 되는지부터 쉽게 풀어드려요."
              onClick={() => {
                track("diagnosis_start", { path: "direct" });
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
          <StagePill>선택한 지원사업</StagePill>
          <Title>{program.title}</Title>
          {program.region && (
            <div className="mt-3 flex flex-wrap gap-1.5 text-xs text-zinc-500">
              {program.region && <span className="rounded bg-zinc-100 px-2 py-1">{program.region}</span>}
              {program.applyEnd && (
                <span className="rounded bg-zinc-100 px-2 py-1">마감 {program.applyEnd}</span>
              )}
            </div>
          )}
          <p className="mt-3 rounded-xl bg-blue-50 px-4 py-3 text-sm leading-6 text-zinc-700">
            <b className="text-blue-700">쉽게 말하면</b> · {plainProgramExplanation(program)}
          </p>
          {program.url && (
            <a
              href={program.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => onViewProgram(program)}
              className="mt-2 inline-block text-sm font-medium text-blue-600 underline underline-offset-2"
            >
              공식 안내문 보기 ↗
            </a>
          )}
          <button
            onClick={() => setStep("notice")}
            className="mt-5 h-14 w-full rounded-xl bg-blue-600 text-lg font-extrabold text-white transition-colors hover:bg-blue-700"
          >
            내가 신청해도 되는지 확인하기
          </button>
          {findRes && findRes.recommendations.length > 0 && (
            <button
              onClick={() => setStep("find-results")}
              className="mt-2.5 w-full rounded-xl border border-zinc-200 bg-white py-3 text-sm font-semibold text-zinc-600 transition-colors hover:bg-zinc-50"
            >
              📋 추천 목록에서 다른 지원 보기
            </button>
          )}
          <BackLink onClick={() => setStep("find-years")}>← 조건 바꿔 다시 찾기</BackLink>
        </section>
      )}

      {/* ── 찾기 1/4: 업력 ─────────────────────────────────────── */}
      {step === "find-years" && (
        <section className="rounded-2xl border border-zinc-200 bg-white p-6 sm:p-9">
          <StagePill>맞는 지원 찾기 1/4</StagePill>
          <Title>사업을 시작한 지 얼마나 되셨나요?</Title>
          <Sub>사업자등록을 한 시기에 따라 볼 수 있는 지원이 달라져요.</Sub>
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
                    <span className="block text-base font-bold text-blue-800">✓ {plainYearOption(pre).label}</span>
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
                label={plainYearOption(v).label}
                sub={plainYearOption(v).sub}
                onClick={() => {
                  track("plain_flow_answer", { step: "business_start", value: v });
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
          <StagePill>맞는 지원 찾기 2/4</StagePill>
          <Title>어느 지역에서 사업하세요?</Title>
          <Sub>그 지역에서만 받을 수 있는 지원과 전국에서 받을 수 있는 지원을 함께 찾아드려요.</Sub>
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
                  track("plain_flow_answer", { step: "region", value: v });
                  setFRegion(v);
                  setStep("find-type");
                }}
              />
            ))}
            <PickCard
              label="지역 제한 없는 지원도 함께 볼래요"
              sub="전국 어디에서나 신청할 수 있는 지원을 봅니다."
              onClick={() => {
                track("plain_flow_answer", { step: "region", value: NATIONWIDE });
                setFRegion(NATIONWIDE);
                setStep("find-type");
              }}
            />
            <select
              value=""
              onChange={(e) => {
                if (!e.target.value) return;
                track("plain_flow_answer", { step: "region", value: e.target.value });
                setFRegion(e.target.value);
                setStep("find-type");
              }}
              className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-4 text-base font-semibold text-zinc-500 outline-none focus:border-blue-500"
            >
              <option value="">다른 지역 고르기…</option>
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
          <StagePill>맞는 지원 찾기 3/4</StagePill>
          <Title>지금 가장 필요한 도움은 무엇인가요?</Title>
          <Sub>아래에서 가장 가까운 말을 골라주세요. 어려운 지원사업 이름은 몰라도 됩니다.</Sub>
          <div className="mt-5 space-y-2.5">
            {TYPE_OPTIONS.map((v) => (
              <PickCard
                key={v}
                label={plainSupportOption(v).label}
                sub={plainSupportOption(v).sub}
                onClick={() => {
                  track("plain_flow_answer", { step: "needed_help", value: v });
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
          <StagePill>맞는 지원 찾기 4/4</StagePill>
          <Title>앞으로 가장 해보고 싶은 일은 무엇인가요?</Title>
          <Sub>잘 모르겠으면 건너뛰어도 됩니다. 결과가 줄어들지는 않아요.</Sub>
          <div className="mt-5 space-y-2.5">
            {SECTOR_OPTIONS.map((v) => (
              <PickCard
                key={v}
                label={plainSectorOption(v).label}
                sub={plainSectorOption(v).sub}
                onClick={() => {
                  track("plain_flow_answer", { step: "next_goal", value: v });
                  setFSector(v);
                  setStep("find-desc");
                }}
              />
            ))}
          </div>
          <button
            onClick={() => {
              track("plain_flow_answer", { step: "next_goal", value: "skipped" });
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
          <StagePill>맞는 지원 찾기 · 마지막</StagePill>
          <Title>지금 돈을 받고 파는 것, 또는 앞으로 팔고 싶은 게 무엇인가요?</Title>
          <Sub>친구에게 말하듯 한 줄이면 충분해요. 이 답은 검색 결과를 줄이지 않고 순서만 더 정확하게 만듭니다.</Sub>
          <input
            value={fBizDesc}
            onChange={(e) => setFBizDesc(e.target.value)}
            placeholder="예: 작은 가게 사장님에게 AI로 홍보하는 법을 알려줘요"
            maxLength={200}
            onKeyDown={(e) => {
              if (e.key === "Enter" && fBizDesc.trim()) {
                track("plain_flow_answer", { step: "business_description", value: "provided" });
                void runFind({
                  years: fYears,
                  region: fRegion,
                  supportType: fType,
                  sector: fSector,
                  bizDesc: fBizDesc.trim(),
                });
              }
            }}
            className="mt-5 w-full rounded-xl border border-zinc-200 px-4 py-4 text-base outline-none focus:border-blue-500"
          />
          <button
            onClick={() => {
              track("plain_flow_answer", { step: "business_description", value: "provided" });
              void runFind({
                years: fYears,
                region: fRegion,
                supportType: fType,
                sector: fSector,
                bizDesc: fBizDesc.trim() || undefined,
              });
            }}
            disabled={!fBizDesc.trim()}
            className="mt-4 h-14 w-full rounded-xl bg-blue-600 text-lg font-extrabold text-white transition-colors hover:bg-blue-700 disabled:opacity-40"
          >
            이 내용으로 받을 수 있는 지원 보기
          </button>
          <button
            onClick={() => {
              track("plain_flow_answer", { step: "business_description", value: "skipped" });
              void runFind({ years: fYears, region: fRegion, supportType: fType, sector: fSector });
            }}
            className="mt-2.5 w-full rounded-xl border border-zinc-200 bg-white py-3 text-sm font-semibold text-zinc-500 transition-colors hover:bg-zinc-50"
          >
            설명 없이 결과부터 보기
          </button>
          <BackLink onClick={() => setStep("find-sector")}>← 이전으로</BackLink>
        </section>
      )}

      {/* ── 찾기 결과 ─────────────────────────────────────────── */}
      {step === "find-results" && (
        <section>
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 sm:p-8">
            <StagePill>받을 수 있는 지원 · 결과</StagePill>
            {finding ? (
              <p className="mt-4 text-base text-zinc-600">
                {plainYearOption(fYears).label} · {fRegion} · {plainSupportOption(fType).label}에 맞춰 찾고 있어요… 🔎
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
                <Title>지금 신청할 수 있는 것 중엔 딱 맞는 게 없어요</Title>
                <Sub>
                  큰 지원은 보통 1년에 한두 번만 열려요. 범위를 조금 넓히거나, 새 모집이 열리면 알림을
                  받아보세요.
                </Sub>
                <div className="mt-5 space-y-2.5">
                  {!fRegion.includes("전국") && (
                    <PickCard
                      label="지역 제한 없는 지원까지 넓혀서 다시 보기"
                      onClick={() => {
                        setFRegion("전국(중앙부처)");
                        void runFind({ years: fYears, region: "전국(중앙부처)", supportType: fType });
                      }}
                    />
                  )}
                  <PickCard label="필요한 도움을 바꿔보기" onClick={() => setStep("find-type")} />
                  <PickCard label="사업을 시작한 시기 다시 고르기" onClick={() => setStep("find-years")} />
                </div>
                {!hasLead && (
                  <button
                    onClick={onSignup}
                    className="mt-4 w-full rounded-xl bg-blue-600 py-3.5 text-base font-bold text-white hover:bg-blue-700"
                  >
                    🔔 나와 맞는 지원이 열리면 알려드릴게요 — 알림 신청
                  </button>
                )}
              </div>
            ) : findRes ? (
              <div className="mt-3">
                <Title>지금은 이런 지원을 살펴보면 좋아요</Title>
                <Sub>
                  {plainYearOption(fYears).label} · {fRegion} · {plainSupportOption(fType).label}
                  {findRes.relaxed
                    ? " — 지금 필요한 도움과 정확히 같은 모집이 없어, 가까운 다른 지원도 함께 보여드려요."
                    : " — 이 답을 바탕으로 찾았어요."}
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
                          r.eligibility !== "확인 필요"
                            ? "shrink-0 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700"
                            : "shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700"
                        }
                      >
                        {plainEligibilityLabel(r.eligibility)}
                      </span>
                    </div>
                    {r.eligibility === "확인 필요" && r.checkReason && (
                      <p className="mt-1 text-xs leading-5 text-amber-700">
                        확인할 것: {plainCheckReason(r.checkReason)}
                      </p>
                    )}
                    <p className="mt-2 rounded-xl bg-blue-50 px-3.5 py-2.5 text-sm leading-6 text-zinc-700">
                      <b className="text-blue-700">쉽게 말하면</b> · {r.whatItIs || plainProgramExplanation(r.program)}
                    </p>
                    {/* 내 사업과의 연관(2026-07-12) — 실제 근거가 있을 때만, 복붙 금지 */}
                    {r.bizWhy && (
                      <p className="mt-1 text-xs leading-5 text-blue-700">🔗 내 사업과 가까운 이유: {r.bizWhy}</p>
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
                          {plainCondition(c)}
                        </span>
                      ))}
                    </div>
                    <button
                      onClick={() => onChooseProgram(programWithApplicationDecision(r))}
                      className="mt-3.5 h-12 w-full rounded-xl bg-blue-600 text-base font-bold text-white transition-colors hover:bg-blue-700"
                    >
                      내가 신청해도 되는지 무료로 확인하기
                    </button>
                    <div className="mt-2 text-center">
                      <a
                        href={r.program.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => onViewProgram(r.program)}
                        className="text-sm font-medium text-zinc-500 underline underline-offset-2 hover:text-zinc-700"
                      >
                        공식 안내문 보기 ↗
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
                    다른 지원 더 보기 ({mainCount - shownCount}건 남음)
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
                      🧭 내 사업과 조금 거리가 있어 보이는 지원 {lows.length}건 보기
                    </summary>
                    <p className="mt-2 text-xs leading-5 text-zinc-500">
                      특정 업종이나 기관의 장비·자료를 꼭 써야 하는 경우 등이에요. 지역과 사업 시작 시기는
                      맞아서 빼지 않았습니다. 나와 관련 있다면 그대로 확인할 수 있어요.
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
                              공식 안내문 ↗
                            </a>
                          </div>
                          <button
                            onClick={() => onChooseProgram(programWithApplicationDecision(r))}
                            className="shrink-0 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700"
                          >
                            신청 가능 여부 보기
                          </button>
                        </div>
                      ))}
                    </div>
                  </details>
                );
              })()}

              {/* 제출서류 기준 분리 — 사업계획서 불필요 공고에는 유료 CTA를 붙이지 않는다 */}
              {(() => {
                  const events = splitRecs(findRes.recommendations).events;
                  if (events.length === 0) return null;
                  return (
                    <details className="rounded-2xl border border-zinc-200 bg-white p-5">
                      <summary className="cursor-pointer text-sm font-semibold text-zinc-600">
                        🧾 긴 문서 없이 바로 신청하는 지원 {events.length}건 보기
                      </summary>
                      <p className="mt-2 text-xs leading-5 text-zinc-500">
                        아래 지원은 사업계획서가 필요 없어요. 장비·공간 예약 또는 교육·행사 참가처럼
                        공식 안내문에서 바로 신청하면 됩니다. 결제 안내도 나오지 않아요.
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
                                공식 안내문 보고 바로 신청 ↗
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
                  🔔 이 지원들의 마감 알림 받기 (간단 가입 · 비밀번호 없음)
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
                  답을 바꿔서 다시 찾기
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
                  📂 이전에 본 지원 ({prev.length}건)
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
                          공식 안내문 ↗
                        </a>
                      </div>
                      <button
                        onClick={() => onChooseProgram(programWithApplicationDecision(r))}
                        className="shrink-0 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700"
                      >
                        신청 가능 여부 보기
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
          <StagePill>무료 확인 1/4</StagePill>
          <Title>지원사업 안내문을 올려주세요</Title>
          <Sub>
            {program && program.source !== "sample"
              ? `‘${program.title}’ 안내문, 화면 캡처 또는 링크를 등록해주세요.`
              : "모집 안내문, 화면 캡처 또는 링크를 등록해주세요."}
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
            📎 <b className="text-blue-700">파일 올리기</b> — 사진·PDF·워드·한글(.hwp/.hwpx) 모두 괜찮아요
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
            placeholder="🔗 또는 안내문 링크 붙여넣기 / 어떤 지원인지 한 줄 설명"
            className="mt-2.5 w-full rounded-xl border border-zinc-200 px-4 py-3.5 text-[15px] outline-none focus:border-blue-500"
          />
          <button
            onClick={afterNotice}
            disabled={fileCount === 0 && !note.trim()}
            className="mt-4 h-14 w-full rounded-xl bg-blue-600 text-lg font-extrabold text-white transition-colors hover:bg-blue-700 disabled:opacity-40"
          >
            내가 신청해도 되는지 확인하기
          </button>
          <details className="mt-4 text-sm">
            <summary className="w-fit cursor-pointer text-blue-600 underline underline-offset-2">
              받은 파일이나 안내문이 없나요?
            </summary>
            <p className="mt-2 rounded-xl bg-zinc-50 px-4 py-3 leading-6 text-zinc-600">
              정해진 서류가 없다면 안내 페이지에서 무엇을 도와주는지와 어떻게 뽑는지가 적힌 부분을
              캡처해 올려주세요. 아무것도 없다면 위 칸에 어떤 지원인지 한 줄만 적어도 됩니다.
            </p>
          </details>
          {start === "scope" ? (
            <BackLink onClick={() => setStep("path")}>← 이전으로</BackLink>
          ) : (
            // 추천에서 선택해 들어온 경우 — 뒤로가기는 추천 초기화면이 아니라 '선택한 공고 카드'로 (2026-07-12)
            program && (
              <BackLink onClick={() => setStep("chosen")}>← 선택한 지원사업 다시 보기</BackLink>
            )
          )}
        </section>
      )}

      {/* ── 화면 3: 사업계획서 양식 확인 ───────────────────────── */}
      {step === "form" && (
        <section className="rounded-2xl border border-zinc-200 bg-white p-6 sm:p-9">
          <StagePill>무료 확인 1/4</StagePill>
          <Title>작성하라고 받은 빈 서류가 있나요?</Title>
          <Sub>‘사업계획서 양식’이라고 적힌 한글·PDF·워드 파일을 말해요. 없어도 확인할 수 있습니다.</Sub>
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
              title="작성할 빈 서류 올리기"
              desc="안내 페이지에서 받은 한글·PDF·워드 파일이나 화면 캡처를 올립니다."
              onClick={() => formInputRef.current?.click()}
            />
            <BigChoice
              title="받은 서류 없이 계속하기"
              desc="일반적인 작성 순서로 확인하고, 파일은 나중에 올려도 돼요."
              onClick={() => proceedToDiagnosis("[파일 역할] 별도 사업계획서 양식은 없습니다.")}
            />
          </div>
          <BackLink onClick={() => setStep("notice")}>← 안내문 입력으로</BackLink>
        </section>
      )}

      {/* ── 화면 3b: 파일 역할 확인 — 2개 이상 올렸는데 어느 것이 양식인지 애매할 때만 ── */}
      {step === "form-pick" && (
        <section className="rounded-2xl border border-zinc-200 bg-white p-6 sm:p-9">
          <StagePill>무료 확인 1/4</StagePill>
          <Title>올려주신 파일 중 실제로 작성해야 하는 빈 서류는 무엇인가요?</Title>
          <Sub>안내문과 작성할 파일을 구분하면 나중에 그 순서 그대로 초안을 만들 수 있어요.</Sub>
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
              label="작성할 빈 서류는 없어요 — 전부 안내문이에요"
              sub="일반적인 작성 순서로 확인하고, 파일은 나중에 올려도 돼요."
              onClick={() =>
                proceedToDiagnosis("[파일 역할] 올린 파일은 모두 공고문이고, 별도 양식은 없습니다.")
              }
            />
          </div>
          <BackLink onClick={() => setStep("notice")}>← 안내문 입력으로</BackLink>
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
          <BackLink onClick={() => setStep("form")}>← 작성할 서류 확인으로</BackLink>
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
              지금 단계에 맞는 다른 지원 찾아보기
            </button>
          </section>
        ) : (
          <EvidenceSheetCard
            sheet={evResult.sheet}
            analysis={analysis}
            draftStatus={
              program?.requiresBusinessPlan === true
                ? "ready"
                : program?.requiresBusinessPlan === false
                  ? "not-required"
                  : "unconfirmed"
            }
            onPreview={
              program?.requiresBusinessPlan === true
                ? () => {
                    track("draft_preview_click", { program: program?.title ?? "" });
                    setStep("handoff");
                  }
                : undefined
            }
          />
        ))}

      {/* ── 화면 7: 유료 전환 안내 — 무료가 끝났음을 선언 ───────── */}
      {step === "handoff" && program?.requiresBusinessPlan === true && (
        <section className="rounded-2xl border border-zinc-200 bg-white p-6 text-center sm:p-10">
          <span className="inline-block rounded-full bg-emerald-100 px-4 py-1.5 text-sm font-bold text-emerald-800">
            ✓ 무료 확인 완료
          </span>
          <h2 className="mt-4 text-2xl font-extrabold leading-snug tracking-tight text-zinc-900 sm:text-[27px]">
            여기까지는 모두 무료였습니다
          </h2>
          <div className="mt-3">
            <span className="inline-block rounded-full bg-amber-100 px-4 py-1.5 text-sm font-bold text-amber-800">
              다음 단계 · 사업계획서 워드 초안 · 1회 {PRICE_LABEL}
            </span>
          </div>
          <p className="mx-auto mt-4 max-w-md text-[15px] leading-7 text-zinc-600">
            이제 대표님이 말해주신 내용을 이 지원사업에서 요구하는 문서 말투와 순서로 바꿀 수 있어요.
            결제 전에 어떤 내용이 만들어지는지 먼저 확인해보세요.
          </p>
          <button
            onClick={() => setStep("preview")}
            className="mt-6 h-14 w-full rounded-xl bg-blue-600 text-lg font-extrabold text-white transition-colors hover:bg-blue-700"
          >
            내가 받을 문서 미리보기
          </button>
          <button
            onClick={() => setStep("result")}
            className="mt-2.5 h-12 w-full rounded-xl border border-zinc-200 bg-white text-[15px] font-semibold text-zinc-500 transition-colors hover:bg-zinc-50"
          >
            무료 확인 결과로 돌아가기
          </button>
        </section>
      )}

      {/* ── 화면 8: 초안 목차 미리보기 → 결제(모달) ─────────────── */}
      {step === "preview" && program?.requiresBusinessPlan === true && evResult?.kind === "sheet" && (
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
