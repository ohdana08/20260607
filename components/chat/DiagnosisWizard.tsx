"use client";

import { useEffect, useRef, useState } from "react";
import type { Program } from "@/lib/match/types";
import { PRICE_LABEL } from "@/lib/config";
import { track } from "@/lib/ga";
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
export type WizardStart = "scope" | "notice";
type Step = "scope" | "path" | "notice" | "form" | "diagnosis" | "result" | "handoff" | "preview";

const ACCEPT = "image/*,application/pdf,.pdf,.docx";

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
  onFindPrograms,
  onDirectProgram,
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
  onFindPrograms: () => void; // 도움 방식 1: 챗 인테이크(추천)로 전환
  onDirectProgram: () => void; // 도움 방식 2: '직접 올린 공고' 프로그램 세팅
  onAnalyze: (payload: WizPayload, note: string) => void; // 공고·양식 AI 분석 (스트리밍, 부모가 수행)
  onSubmitEvidence: (revenue: string, items: string[]) => void;
  onPay: () => void;
}) {
  const [step, setStep] = useState<Step>(start);
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
              desc="사업 정보를 바탕으로 지원 가능한 공고를 추천받습니다."
              onClick={onFindPrograms}
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
              onClick={onFindPrograms}
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
