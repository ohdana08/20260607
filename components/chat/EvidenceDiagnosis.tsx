"use client";

import { useEffect, useState } from "react";
import type { Program } from "@/lib/match/types";
import { PLAN_SECTIONS } from "@/lib/plan/sections";
import { PRICE_LABEL } from "@/lib/config";
import {
  REVENUE_OPTIONS,
  NONE_ITEM,
  FIXED_GAPS,
  SHEET_CLOSING,
  type EvidenceRow,
  type EvidenceSheet,
} from "@/lib/diagnosis/evidence";
import {
  plainEvidenceCategory,
  plainEvidenceItem,
  plainGap,
} from "@/lib/plain-language";

// ── 합격 가능성 진단 (2026-07-11 디자인수정 반영) ───────────────────────
// 원칙: 한 화면 = 한 질문 = 한 행동. 상단에 "무료 진단 n/4" 진행표시.
// 화면 2/4: 월 평균 매출(단일선택) → 화면 3/4: 확보 실적(복수선택) → 부모가 분기.
// 사람 분석이 아니라 사업 분석 — 타이핑 없이 버튼만으로 끝난다 (LLM 호출 0회).

// 진행 표시 pill — 무료 구간은 초록, 유료 구간은 주황으로 경계를 색으로도 구분
export function StagePill({ paidLabel, children }: { paidLabel?: boolean; children: React.ReactNode }) {
  return (
    <span
      className={`inline-block rounded-full px-3 py-1 text-xs font-bold ${
        paidLabel ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"
      }`}
    >
      {children}
    </span>
  );
}

// 카드형 선택지 — 작은 칩 대신 체크 원이 있는 큰 카드 버튼 (PC 2열 / 모바일 1열)
export function OptionCard({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-xl border px-4 py-3 text-left text-[15px] font-medium transition-colors ${
        on
          ? "border-emerald-500 bg-emerald-50 text-emerald-900"
          : "border-zinc-200 bg-white text-zinc-700 hover:border-emerald-300"
      }`}
    >
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold ${
          on ? "border-emerald-500 bg-emerald-500 text-white" : "border-zinc-300 bg-white text-transparent"
        }`}
      >
        ✓
      </span>
      {children}
    </button>
  );
}

export function EvidenceDiagnosisForm({
  rows,
  mapError,
  onRetryMap,
  onSubmit,
}: {
  rows: EvidenceRow[] | null; // null = 매핑표 로딩 중
  mapError: boolean;
  onRetryMap: () => void;
  onSubmit: (revenue: string, items: string[]) => void;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [revenue, setRevenue] = useState<string>("");
  const [items, setItems] = useState<string[]>([]);

  function toggleItem(item: string) {
    setItems((prev) => {
      if (item === NONE_ITEM) return prev.includes(NONE_ITEM) ? [] : [NONE_ITEM];
      const base = prev.filter((i) => i !== NONE_ITEM); // 실적을 고르면 '해당 없음' 해제
      return base.includes(item) ? base.filter((i) => i !== item) : [...base, item];
    });
  }

  return (
    <div className="mr-auto w-full max-w-[95%] rounded-2xl border border-emerald-100 bg-emerald-50/40 p-4 sm:p-5">
      {step === 1 ? (
        <div>
          <StagePill>무료 확인 2/4</StagePill>
          <p className="mt-2.5 text-lg font-extrabold leading-7 text-zinc-900">
            최근 한 달에 평균 얼마나 파셨나요?
          </p>
          <p className="mt-1 text-[13px] text-zinc-500">대략적인 범위면 충분해요.</p>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {REVENUE_OPTIONS.map((v) => (
              <OptionCard key={v} on={revenue === v} onClick={() => setRevenue(v)}>
                {v}
              </OptionCard>
            ))}
          </div>
          <button
            onClick={() => setStep(2)}
            disabled={!revenue}
            className="mt-4 w-full rounded-xl bg-emerald-600 py-3.5 text-base font-bold text-white transition-colors hover:bg-emerald-700 disabled:opacity-40"
          >
            다음
          </button>
        </div>
      ) : (
        <div>
          <StagePill>무료 확인 3/4</StagePill>
          <p className="mt-2.5 text-lg font-extrabold leading-7 text-zinc-900">
            지금까지 실제로 해낸 일을 골라주세요
          </p>
          <p className="mt-1 text-[13px] text-zinc-500">여러 개 선택할 수 있습니다.</p>
          {rows === null ? (
            mapError ? (
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                확인할 내용을 불러오지 못했어요.
                <button onClick={onRetryMap} className="ml-2 font-semibold underline">
                  다시 시도
                </button>
              </div>
            ) : (
              <p className="mt-3 text-xs text-zinc-500">확인할 내용을 불러오는 중이에요…</p>
            )
          ) : (
            <>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {rows.map((r) => (
                  <OptionCard key={r.item} on={items.includes(r.item)} onClick={() => toggleItem(r.item)}>
                    {plainEvidenceItem(r.item)}
                  </OptionCard>
                ))}
                <OptionCard on={items.includes(NONE_ITEM)} onClick={() => toggleItem(NONE_ITEM)}>
                  {NONE_ITEM}
                </OptionCard>
              </div>
              <button
                onClick={() => onSubmit(revenue, items)}
                disabled={items.length === 0}
                className="mt-4 w-full rounded-xl bg-emerald-600 py-3.5 text-base font-bold text-white transition-colors hover:bg-emerald-700 disabled:opacity-40"
              >
                지금 준비된 것 확인하기
              </button>
            </>
          )}
          <button onClick={() => setStep(1)} className="mt-2 w-full py-1 text-xs text-zinc-400 hover:text-zinc-600">
            ← 한 달 판매 금액 다시 고르기
          </button>
        </div>
      )}
    </div>
  );
}

// ── 진단지 — 전부 무료 공개. 여기서는 결제를 요구하지 않는다 ────────────
// 마지막에 "여기까지는 무료" 경계를 명시하고, 다음 행동은 '초안 목차 보기' 하나만 노출.
// analysis: 위저드에서 공고문을 올렸을 때의 AI 분석(블록 A — 공고를 실제로 읽었다는 증거)
export function EvidenceSheetCard({
  sheet,
  onPreview,
  analysis,
  draftStatus = "ready",
}: {
  sheet: EvidenceSheet;
  onPreview?: () => void;
  analysis?: { text: string; busy: boolean };
  draftStatus?: "ready" | "not-required" | "unconfirmed";
}) {
  return (
    <div className="mr-auto w-full max-w-[95%] rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4 sm:p-5">
      <StagePill>무료 확인 4/4 · 결과</StagePill>
      <h3 className="mt-2.5 text-lg font-extrabold leading-7 text-zinc-900">
        지금 신청 준비 상태를 정리했어요
      </h3>

      {analysis && (analysis.text || analysis.busy) && (
        <div className="mt-3 rounded-xl border border-blue-200 bg-white p-3.5">
          <p className="text-xs font-bold text-blue-700">이 지원사업을 쉽게 풀면</p>
          <p className="mt-1.5 whitespace-pre-wrap text-sm leading-6 text-zinc-700">
            {analysis.text || "올려주신 안내문을 읽고 있어요…"}
            {analysis.busy ? " ▌" : ""}
          </p>
        </div>
      )}

      {sheet.strengths.length > 0 && (
        <div className="mt-3 rounded-xl border border-emerald-200 bg-white p-3.5">
          <p className="text-xs font-bold text-emerald-700">이미 준비된 내용</p>
          <ul className="mt-1.5 space-y-1.5">
            {sheet.strengths.map((s) => (
              <li key={s.item} className="text-sm leading-6 text-zinc-800">
                <span className="font-semibold text-emerald-700">✓</span> {plainEvidenceItem(s.item)}
                {s.tags.length > 0 && (
                  <span className="text-zinc-500">
                    {" "}→ {s.tags.map(plainEvidenceCategory).join(" · ")}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3.5">
        <p className="text-xs font-bold text-amber-800">더 준비하면 좋은 내용</p>
        <ul className="mt-1.5 space-y-1">
          {sheet.gaps.map((g) => (
            <li key={g} className="text-sm leading-6 text-amber-900">
              → <b>{plainGap(g)}</b>
            </li>
          ))}
          {FIXED_GAPS.map((g) => (
            <li key={g} className="text-sm leading-6 text-amber-900">
              → {plainGap(g)}
            </li>
          ))}
        </ul>
      </div>

      <blockquote className="mt-2.5 rounded-xl bg-white px-3.5 py-3 text-[13px] leading-5 text-zinc-700">
        {SHEET_CLOSING}
      </blockquote>

      {/* 무료 구간 종료 경계 — 여기서는 아직 결제를 요구하지 않는다 */}
      <div className="mt-4 flex items-center gap-3">
        <div className="h-px flex-1 border-t border-dashed border-emerald-300" />
        <span className="shrink-0 text-xs font-bold text-emerald-700">여기까지는 무료입니다</span>
        <div className="h-px flex-1 border-t border-dashed border-emerald-300" />
      </div>
      {draftStatus === "ready" && onPreview ? (
        <>
          <button
            onClick={onPreview}
            className="mt-3 w-full rounded-xl bg-blue-600 py-3.5 text-base font-bold text-white transition-colors hover:bg-blue-700"
          >
            이 지원에 낼 문서 미리보기
          </button>
          <p className="mt-1.5 text-center text-xs text-zinc-500">
            대표님 말이 문서에서 어떻게 바뀌는지 결제 전에 먼저 볼 수 있어요.
          </p>
        </>
      ) : (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
          {draftStatus === "not-required"
            ? "이 지원은 긴 사업계획서가 필요하지 않아요. 공식 안내문에서 바로 신청해 주세요."
            : "어떤 서류를 내야 하는지 확인 중이에요. 긴 사업계획서가 필요한지 확인되기 전에는 결제 안내를 띄우지 않습니다."}
        </div>
      )}
    </div>
  );
}

// ── 초안 미리보기 — 무료와 유료 사이의 전환 화면 (2026-07-11 신설) ──────
// "추천·진단은 무료였다"를 명시하고, 결제 전에 목차·예시 문장·맞춤 방향을 보여준다.
export function DraftPreviewCard({
  sheet,
  onPay,
  onBack,
  onView,
}: {
  sheet: EvidenceSheet;
  onPay: () => void;
  onBack: () => void;
  onView?: () => void; // 화면 도달 측정(1회)
}) {
  useEffect(() => {
    onView?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 진단에서 확인된 강점·평가항목을 미리보기 문장에 그대로 반영 — "내 정보가 반영된다"는 증거
  const topItems = sheet.strengths.slice(0, 2).map((s) => plainEvidenceItem(s.item));
  const allTags = [...new Set(sheet.strengths.flatMap((s) => s.tags))];
  const exampleSentence =
    topItems.length > 0
      ? `대표님 사업은 ‘${topItems.join("’, ‘")}’처럼 이미 해낸 일이 있습니다. 이 내용을 날짜·숫자·확인할 자료와 연결해, 담당자가 한 번에 이해할 수 있는 문장으로 바꿉니다.`
      : `말씀해주신 사업 내용을 바탕으로, 담당자가 무엇을 하는 사업인지 한 번에 이해할 수 있는 문장으로 바꿉니다.`;

  return (
    <div className="mr-auto w-full max-w-[95%] rounded-2xl border border-blue-200 bg-blue-50/30 p-4 sm:p-5">
      {/* 전환 안내 — 무료가 끝났음을 명시적으로 선언 */}
      <div className="text-center">
        <span className="inline-block rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800">
          ✓ 무료 확인 완료
        </span>
        <p className="mt-2 text-lg font-extrabold leading-7 text-zinc-900">여기까지는 모두 무료였습니다</p>
        <p className="mt-1 text-sm leading-6 text-zinc-600">
          이제 대표님 말을 이 지원에서 요구하는 사업계획서로 바꾸는 데 {PRICE_LABEL}이 필요해요.
        </p>
      </div>

      <div className="mt-4">
        <StagePill paidLabel>사업계획서 워드 초안 미리보기 · 1회 {PRICE_LABEL}</StagePill>
        <p className="mt-2.5 text-base font-extrabold leading-6 text-zinc-900">
          최종 문서에는 이런 공식 항목명이 들어갑니다
        </p>
      </div>

      {/* 실제 생성 골격(PLAN_SECTIONS) 그대로 — 결제 후 받는 목차와 동일해야 신뢰가 생긴다 */}
      <ol className="mt-2.5 divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white">
        {PLAN_SECTIONS.map((s) => (
          <li key={s.key} className="px-4 py-2.5 text-sm font-medium text-zinc-800">
            {s.heading}
          </li>
        ))}
      </ol>
      <p className="mt-1.5 text-xs leading-5 text-zinc-500">
        안내문과 작성 파일을 올리셨다면, 받은 파일의 항목명과 순서를 그대로 따라갑니다.
      </p>

      {allTags.length > 0 && (
        <div className="mt-2.5 rounded-xl bg-blue-100/60 px-3.5 py-2.5 text-sm leading-6 text-zinc-800">
          대표님이 말한 내용 중 <b className="text-blue-700">‘{allTags.map(plainEvidenceCategory).join("’·‘")}’</b>을
          먼저 보여줄 수 있어요. 최종 문서에서만 공식 심사용 표현으로 바꿉니다.
        </div>
      )}

      <div className="mt-2.5 rounded-r-xl border-l-4 border-blue-400 bg-white px-4 py-3">
        <p className="text-[11px] font-bold tracking-wide text-blue-700">대표님 말이 이렇게 바뀝니다</p>
        <p className="mt-1 text-sm leading-6 text-zinc-700">{exampleSentence}</p>
      </div>

      <button
        onClick={onPay}
        className="mt-4 w-full rounded-xl bg-blue-600 py-3.5 text-base font-bold text-white transition-colors hover:bg-blue-700"
      >
        {PRICE_LABEL}으로 워드 초안 만들기
      </button>
      <button
        onClick={onBack}
        className="mt-2 w-full rounded-xl border border-zinc-200 bg-white py-2.5 text-sm font-medium text-zinc-500 transition-colors hover:bg-zinc-50"
      >
        ← 무료 확인 결과 다시 보기
      </button>
    </div>
  );
}

// ── pre 전용 화면 — 실적이 쌓이기 전 단계 (유료 CTA 노출 금지) ──────────
export function PreStageCard({
  programs,
  loading,
}: {
  programs: Program[] | null;
  loading: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-2xl border border-sky-200 bg-sky-50/40 p-4">
      <h3 className="text-sm font-bold text-zinc-900">🌱 아직 보여줄 결과가 많지 않아도 괜찮아요</h3>
      <p className="mt-2 text-sm leading-6 text-zinc-700">
        지금 필요한 건 긴 문서보다 <b>고객 반응이나 작은 판매 결과를 만드는 것</b>이에요. 결과가 없어도
        시작할 수 있는 교육·전문가 도움·비용 지원부터 해보면, 그 경험을 다음 신청에서 보여줄 수 있어요.
      </p>
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="mt-3 w-full rounded-xl bg-sky-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-sky-700"
        >
          🌱 지금 단계에서도 신청할 수 있는 지원 보기
        </button>
      ) : loading || programs === null ? (
        <p className="mt-3 text-xs text-zinc-500">지금 신청할 수 있는 지원을 찾는 중이에요…</p>
      ) : programs.length === 0 ? (
        <div className="mt-3 rounded-xl bg-white p-3 text-xs leading-5 text-zinc-600">
          지금 바로 신청할 수 있는 교육·전문가 도움·비용 지원을 찾지 못했어요. K-Startup에서 직접 확인해 보세요:{" "}
          <a
            href="https://www.k-startup.go.kr/web/contents/bizpbanc-ongoing.do"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-blue-600 underline"
          >
            K-Startup에서 지금 모집 중인 지원 보기 ↗
          </a>
        </div>
      ) : (
        <ul className="mt-3 space-y-2">
          {programs.map((p) => (
            <li key={p.id} className="rounded-xl border border-zinc-200 bg-white p-3">
              <p className="text-sm font-semibold leading-5 text-zinc-900">{p.title}</p>
              <p className="mt-0.5 text-[11px] text-zinc-500">
                {p.supportField} · {p.region} · 마감 {p.applyEnd ?? "상시"}
              </p>
              <a
                href={p.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-block text-xs font-semibold text-blue-600 hover:underline"
              >
                공식 안내문 보기 ↗
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
