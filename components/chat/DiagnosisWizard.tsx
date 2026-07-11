"use client";

import { useEffect, useRef, useState } from "react";
import type { Program, Recommendation } from "@/lib/match/types";
import { PRICE_LABEL } from "@/lib/config";
import { track } from "@/lib/ga";
import {
  YEARS_OPTIONS,
  REGION_OPTIONS,
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

type EvidenceResult = { kind: "sheet"; sheet: EvidenceSheet } | { kind: "pre" };
export type WizardStart = "scope" | "notice" | "find";
type Step =
  | "scope"
  | "path"
  | "find-years"
  | "find-region"
  | "find-type"
  | "find-sector"
  | "find-results"
  | "notice"
  | "form"
  | "diagnosis"
  | "result"
  | "handoff"
  | "preview";

const ACCEPT = "image/*,application/pdf,.pdf,.docx";

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

// 찾기 단계 공용 — 단일 선택 카드 (누르면 바로 다음 단계로)
function PickCard({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center justify-between rounded-xl border border-zinc-200 bg-white px-5 py-4 text-left text-base font-semibold text-zinc-800 transition-colors hover:border-blue-400 hover:bg-blue-50/40"
    >
      {label}
      <span className="text-sm font-bold text-blue-500">→</span>
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
}) {
  const [step, setStep] = useState<Step>(start === "find" ? "find-years" : start);
  // 찾기 4단계 선택값 + 매칭 결과
  const [fYears, setFYears] = useState("");
  const [fRegion, setFRegion] = useState("");
  const [fType, setFType] = useState("");
  const [finding, setFinding] = useState(false);
  const [findError, setFindError] = useState("");
  const [findRes, setFindRes] = useState<{
    recommendations: Recommendation[];
    relaxed: boolean;
    usingSample: boolean;
  } | null>(null);
  const [shownCount, setShownCount] = useState(5);
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ buttonProfile: profile }),
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
      if (recommendations.length > 0) track("recommendation_shown", { count: recommendations.length, mode: "button" });
      else track("recommendation_empty", { mode: "button" });
    } catch {
      setFindError("연결이 끊겼어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setFinding(false);
    }
  }

  // 양식 확인 완료 → 공고·양식 분석을 백그라운드로 시작하고 버튼 진단으로 진행
  function proceedToDiagnosis() {
    if (fileCount > 0 || note.trim()) onAnalyze(payload, note);
    track("start_diagnosis", { program: program?.title ?? "" });
    setStep("diagnosis");
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
          <BackLink onClick={() => setStep("scope")}>← 이전으로</BackLink>
        </section>
      )}

      {/* ── 찾기 1/4: 업력 ─────────────────────────────────────── */}
      {step === "find-years" && (
        <section className="rounded-2xl border border-zinc-200 bg-white p-6 sm:p-9">
          <StagePill>지원사업 찾기 1/4</StagePill>
          <Title>사업을 시작한 지 얼마나 되셨나요?</Title>
          <Sub>업력에 따라 지원할 수 있는 공고가 달라져요.</Sub>
          <div className="mt-5 space-y-2.5">
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

      {/* ── 찾기 2/4: 지역 ─────────────────────────────────────── */}
      {step === "find-region" && (
        <section className="rounded-2xl border border-zinc-200 bg-white p-6 sm:p-9">
          <StagePill>지원사업 찾기 2/4</StagePill>
          <Title>어느 지역에서 사업하세요?</Title>
          <Sub>해당 지역 공고와 전국(중앙부처) 공고를 함께 찾아드려요.</Sub>
          <div className="mt-5 space-y-2.5">
            {REGION_OPTIONS.map((v) => (
              <PickCard
                key={v}
                label={v}
                onClick={() => {
                  setFRegion(v);
                  setStep("find-type");
                }}
              />
            ))}
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
                onClick={() =>
                  void runFind({ years: fYears, region: fRegion, supportType: fType, sector: v })
                }
              />
            ))}
          </div>
          <button
            onClick={() => void runFind({ years: fYears, region: fRegion, supportType: fType })}
            className="mt-3 w-full rounded-xl border border-zinc-200 bg-white py-3 text-sm font-semibold text-zinc-500 transition-colors hover:bg-zinc-50"
          >
            건너뛰고 전체 결과 보기
          </button>
          <BackLink onClick={() => setStep("find-type")}>← 이전으로</BackLink>
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
              {findRes.recommendations.slice(0, shownCount).map((r) => {
                const dl = ddayLabel(r.program.applyEnd);
                return (
                  <div key={r.program.id} className="rounded-2xl border border-zinc-200 bg-white p-5">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-base font-bold leading-6 text-zinc-900">{r.program.title}</h3>
                      <span
                        className={
                          r.eligibility === "가능성 높음"
                            ? "shrink-0 rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-700"
                            : "shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700"
                        }
                      >
                        {r.eligibility}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-zinc-600">{r.fitReason}</p>
                    <div className="mt-2.5 flex flex-wrap gap-1.5 text-xs text-zinc-500">
                      <span className={`rounded bg-zinc-100 px-2 py-1 ${dl.urgent ? "font-semibold text-red-600" : ""}`}>
                        📅 {dl.text}
                      </span>
                      {r.program.supportField && (
                        <span className="rounded bg-zinc-100 px-2 py-1">{r.program.supportField}</span>
                      )}
                      <span className="rounded bg-zinc-100 px-2 py-1">{r.program.region}</span>
                    </div>
                    {r.program.target && r.program.target !== "지원대상 정보 없음" && (
                      <p className="mt-2 text-xs leading-5 text-zinc-500">🎯 {r.program.target}</p>
                    )}
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
              {findRes.recommendations.length > shownCount && (
                <button
                  onClick={() => setShownCount((n) => n + 5)}
                  className="w-full rounded-xl border border-blue-200 bg-white py-3 text-base font-semibold text-blue-700 transition-colors hover:bg-blue-50"
                >
                  공고 더 보기 ({findRes.recommendations.length - shownCount}건 남음)
                </button>
              )}
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
            📎 <b className="text-blue-700">파일 올리기</b> — 사진·PDF·워드 모두 괜찮아요
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
            onClick={() => setStep("form")}
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
          {start === "scope" && <BackLink onClick={() => setStep("path")}>← 이전으로</BackLink>}
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
              await addFiles(e.target.files);
              e.target.value = "";
              proceedToDiagnosis();
            }}
          />
          <div className="mt-5 space-y-3">
            <BigChoice
              title="양식 파일 올리기"
              desc="공고에서 받은 사업계획서 양식(PDF·워드·캡처)을 올립니다."
              onClick={() => formInputRef.current?.click()}
            />
            <BigChoice
              title="양식 없이 진행하기"
              desc="표준 목차 기준으로 진단하고, 양식은 나중에 올려도 돼요."
              onClick={proceedToDiagnosis}
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
