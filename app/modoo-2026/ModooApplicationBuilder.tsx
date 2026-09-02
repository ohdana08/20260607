"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  MODU_2026_APPLICATION_URL,
  MODU_BUSINESS_STATUSES,
  MODU_DRAFT_SECTIONS,
  MODU_TRACKS,
  type ModooDraftRequest,
  type ModooDraftResult,
} from "@/lib/campaigns/modoo2026";
import { track } from "@/lib/ga";
import { captureUtm } from "@/lib/utm";

const EMPTY_FORM: ModooDraftRequest = {
  track: MODU_TRACKS[0],
  industry: "",
  businessStatus: "",
  customerScene: "",
  currentAlternative: "",
  problemEvidence: "",
  solutionMechanism: "",
  paymentMoment: "",
  firstValidation: "",
  founderEvidence: "",
  localGrounding: "",
  mentorDecision: "",
};

const INPUT_CLASS =
  "mt-2 w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3.5 text-[15px] leading-6 text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100";

function TextAreaField({
  id,
  label,
  hint,
  placeholder,
  value,
  required = false,
  maxLength = 2_000,
  onChange,
}: {
  id: keyof ModooDraftRequest;
  label: string;
  hint?: string;
  placeholder: string;
  value: string;
  required?: boolean;
  maxLength?: number;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-[15px] font-extrabold text-zinc-900">
        {label} {required ? <span className="text-blue-600">*</span> : <span className="text-zinc-400">(선택)</span>}
      </label>
      {hint ? <p className="mt-1 text-xs leading-5 text-zinc-500">{hint}</p> : null}
      <textarea
        id={id}
        name={id}
        rows={4}
        required={required}
        maxLength={maxLength}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className={`${INPUT_CLASS} resize-y`}
      />
      <p className="mt-1 text-right text-[11px] text-zinc-400">
        {value.length.toLocaleString()} / {maxLength.toLocaleString()}
      </p>
    </div>
  );
}

export default function ModooApplicationBuilder() {
  const [form, setForm] = useState<ModooDraftRequest>(EMPTY_FORM);
  const [draft, setDraft] = useState<ModooDraftResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");

  useEffect(() => {
    captureUtm();
    track("view_modoo_2026_campaign");
  }, []);

  function update<K extends keyof ModooDraftRequest>(key: K, value: ModooDraftRequest[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function generateDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setDraft(null);
    track("modoo_draft_start", { track: form.track, industry: form.industry });
    try {
      const response = await fetch("/api/modoo-2026/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = (await response.json().catch(() => ({}))) as {
        draft?: ModooDraftResult;
        error?: string;
      };
      if (!response.ok || !data.draft) throw new Error(data.error || "초안을 만들지 못했어요.");
      setDraft(data.draft);
      track("modoo_draft_complete", {
        track: form.track,
        missing_count: data.draft.missingFacts.length,
      });
      setTimeout(() => document.getElementById("draft-result")?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "초안을 만들지 못했어요.";
      setError(message);
      track("modoo_draft_error");
    } finally {
      setBusy(false);
    }
  }

  async function copyAnswer(key: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied(""), 1_500);
      track("modoo_answer_copy", { question: key });
    } catch {
      setError("복사하지 못했어요. 문장을 직접 선택해 복사해 주세요.");
    }
  }

  async function downloadDraft() {
    if (!draft || downloadBusy) return;
    setDownloadBusy(true);
    setError("");
    try {
      const response = await fetch("/api/modoo-2026/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "Word 파일을 만들지 못했어요.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "모두의창업_딱지원핏_작성재료정리본.docx";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      track("modoo_draft_docx_download");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Word 파일을 만들지 못했어요.");
    } finally {
      setDownloadBusy(false);
    }
  }

  return (
    <section id="builder" className="scroll-mt-6 py-16 sm:py-24">
      <div className="mx-auto grid w-full max-w-6xl gap-8 px-5 lg:grid-cols-[0.78fr_1.22fr] lg:px-8">
        <div className="lg:sticky lg:top-8 lg:self-start">
          <p className="text-sm font-extrabold tracking-[0.14em] text-blue-700">무료 작성 도우미</p>
          <h2 className="mt-3 text-3xl font-black leading-tight tracking-tight text-zinc-950 sm:text-4xl">
            대표님의 사실을
            <br />지원서 문장으로 바꿉니다
          </h2>
          <p className="mt-5 text-[15px] leading-7 text-zinc-600">
            공식 문항을 흉내 내는 설문이 아닙니다. 고객 장면과 근거부터 정리하고, 없는 매출·반응·성과는 만들지 않으며 더 확인할 부분은
            <b className="text-zinc-900"> [보완 필요]</b>로 남깁니다.
          </p>
          <div className="mt-6 space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-950">
            <p className="font-extrabold">작성 전에 확인해 주세요</p>
            <ul className="space-y-2 text-amber-900">
              <li>• 이 결과는 공식 지원서 문항 복제본이 아니라 작성 재료 정리본입니다.</li>
              <li>• 공식 플랫폼의 최신 질문과 글자 수를 마지막에 다시 확인해야 합니다.</li>
              <li>• 기창업자는 기존 사업과 다른 업종으로 창업할 조건을 직접 확인해야 합니다.</li>
            </ul>
          </div>
        </div>

        <form onSubmit={generateDraft} className="rounded-[28px] border border-zinc-200 bg-white p-5 shadow-xl shadow-zinc-200/50 sm:p-8">
          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <label htmlFor="track" className="block text-[15px] font-extrabold text-zinc-900">
                지원 트랙 <span className="text-blue-600">*</span>
              </label>
              <select
                id="track"
                value={form.track}
                onChange={(event) => update("track", event.target.value)}
                className={INPUT_CLASS}
              >
                {MODU_TRACKS.map((track) => <option key={track}>{track}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="businessStatus" className="block text-[15px] font-extrabold text-zinc-900">
                사업자등록 상태 <span className="text-blue-600">*</span>
              </label>
              <select
                id="businessStatus"
                required
                value={form.businessStatus}
                onChange={(event) => update("businessStatus", event.target.value)}
                className={INPUT_CLASS}
              >
                <option value="">선택해 주세요</option>
                {MODU_BUSINESS_STATUSES.map((status) => <option key={status}>{status}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="industry" className="block text-[15px] font-extrabold text-zinc-900">
                대표님이 부르는 사업 분야 <span className="text-blue-600">*</span>
              </label>
              <input
                id="industry"
                name="industry"
                required
                maxLength={100}
                value={form.industry}
                placeholder="예: 동네 식당 재고를 줄이는 예약 판매"
                onChange={(event) => update("industry", event.target.value)}
                className={INPUT_CLASS}
              />
            </div>
          </div>

          <div className="my-8 h-px bg-zinc-100" />
          <div className="space-y-7">
            <TextAreaField
              id="customerScene"
              label="최근 직접 보거나 겪은 고객의 불편 장면"
              hint="아이디어 설명보다 먼저, 실제로 있었던 한 장면을 적어주세요."
              placeholder="누가, 어떤 상황에서, 무엇 때문에 멈추거나 손해를 봤는지 적어주세요."
              value={form.customerScene}
              required
              onChange={(value) => update("customerScene", value)}
            />
            <TextAreaField
              id="currentAlternative"
              label="그 고객은 지금 어떤 방법으로 버티고 있나요?"
              hint="경쟁사 이름보다 고객이 현재 쓰는 행동과 그 한계를 적어주세요."
              placeholder="수기 정리, 지인 문의, 엑셀, 포기처럼 지금의 대처 방법을 적어주세요."
              value={form.currentAlternative}
              maxLength={1_500}
              onChange={(value) => update("currentAlternative", value)}
            />
            <TextAreaField
              id="problemEvidence"
              label="그 문제가 실제라는 자료나 관찰"
              hint="없으면 비워도 됩니다. 없는 근거를 그럴듯하게 만들지 않습니다."
              placeholder="고객 대화, 문의, 반복 횟수, 예약, 판매, 사진처럼 직접 확인 가능한 것만 적어주세요."
              value={form.problemEvidence}
              onChange={(value) => update("problemEvidence", value)}
            />
            <TextAreaField
              id="solutionMechanism"
              label="대표님의 방식이 불편을 줄이는 순서"
              hint="기능 이름보다 고객의 전후 행동이 어떻게 달라지는지 적어주세요."
              placeholder="고객 입력 → 처리 과정 → 고객이 받는 결과 순서로 적어주세요."
              value={form.solutionMechanism}
              required
              onChange={(value) => update("solutionMechanism", value)}
            />
            <TextAreaField
              id="paymentMoment"
              label="돈을 내는 사람과 결제가 일어나는 순간"
              placeholder="금액이 미정이면 지불 고객과 결제 시점만 적어도 됩니다."
              value={form.paymentMoment}
              maxLength={1_500}
              onChange={(value) => update("paymentMoment", value)}
            />
            <TextAreaField
              id="firstValidation"
              label="마감 후 30일 안에 가장 먼저 확인할 가설"
              hint="완성품 계획보다 실패 여부를 빨리 알 수 있는 작은 시험을 적어주세요."
              placeholder="누구에게 무엇을 보여주고, 어떤 반응이면 계속할지 적어주세요."
              value={form.firstValidation}
              maxLength={1_500}
              onChange={(value) => update("firstValidation", value)}
            />
            <TextAreaField
              id="founderEvidence"
              label="대표님이 이미 해본 관련 일이나 확보한 자원"
              placeholder="직무 경험, 직접 해결한 일, 기술, 고객 접점, 협력자 중 확인 가능한 것만 적어주세요."
              value={form.founderEvidence}
              onChange={(value) => update("founderEvidence", value)}
            />
            <TextAreaField
              id="localGrounding"
              label="이 지역에서 시작해야 하는 이유"
              hint="로컬 트랙을 선택했다면 지역 고객·자원·관계와의 연결을 적어주세요."
              placeholder="일반·기술 트랙이고 지역 연결이 없다면 비워두세요."
              value={form.localGrounding}
              maxLength={1_500}
              onChange={(value) => update("localGrounding", value)}
            />
            <TextAreaField
              id="mentorDecision"
              label="멘토와 가장 먼저 결정하고 싶은 쟁점 하나"
              hint="막연한 조언보다 실제로 선택해야 하는 두 갈래를 적어주세요."
              placeholder="예: 첫 고객을 개인으로 잡을지 식당 점주로 잡을지 결정하고 싶습니다."
              value={form.mentorDecision}
              maxLength={1_000}
              onChange={(value) => update("mentorDecision", value)}
            />
          </div>

          {error ? (
            <div role="alert" className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
              {error}
            </div>
          ) : null}
          <button
            type="submit"
            disabled={busy}
            className="mt-8 flex min-h-14 w-full items-center justify-center rounded-2xl bg-blue-700 px-5 text-base font-extrabold text-white transition hover:bg-blue-800 disabled:cursor-wait disabled:opacity-60"
          >
            {busy ? "대표님의 사실을 작성 재료로 정리하는 중…" : "무료로 지원서 작성 재료 정리하기"}
          </button>
          <p className="mt-3 text-center text-xs leading-5 text-zinc-500">
            입력 내용은 초안 생성에 사용됩니다. 선정 여부를 보장하지 않습니다.
          </p>
        </form>
      </div>

      {draft ? (
        <div id="draft-result" className="mx-auto mt-14 w-full max-w-4xl scroll-mt-6 px-5 lg:px-8">
          <div className="rounded-[28px] border border-blue-200 bg-white p-5 shadow-xl shadow-blue-100/60 sm:p-8">
            <div className="flex flex-col gap-4 border-b border-zinc-100 pb-6 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-sm font-extrabold text-blue-700">작성 초안 완성</p>
                <h2 className="mt-1 text-2xl font-black tracking-tight text-zinc-950">확인된 사실과 빈 근거를 먼저 검토하세요</h2>
              </div>
              <button
                type="button"
                onClick={() => void downloadDraft()}
                disabled={downloadBusy}
                className="min-h-11 shrink-0 rounded-xl bg-zinc-950 px-5 text-sm font-extrabold text-white hover:bg-zinc-800 disabled:opacity-60"
              >
                {downloadBusy ? "Word 만드는 중…" : "작성 재료 정리본 Word 받기"}
              </button>
            </div>

            <div className="mt-6 space-y-4">
              {MODU_DRAFT_SECTIONS.map((section) => (
                <article key={section.key} className="rounded-2xl border border-zinc-200 bg-zinc-50/60 p-4 sm:p-5">
                  <div className="flex items-start justify-between gap-4">
                    <h3 className="text-sm font-extrabold leading-6 text-zinc-900">{section.label}</h3>
                    <button
                      type="button"
                      onClick={() => void copyAnswer(section.key, draft.answers[section.key])}
                      className="shrink-0 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-50"
                    >
                      {copied === section.key ? "복사됨" : "복사"}
                    </button>
                  </div>
                  <p className="mt-3 whitespace-pre-wrap text-[14px] leading-7 text-zinc-700">{draft.answers[section.key]}</p>
                </article>
              ))}
            </div>

            {draft.missingFacts.length > 0 ? (
              <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-5">
                <h3 className="font-extrabold text-red-900">제출 전에 보완할 사실</h3>
                <ul className="mt-3 space-y-2 text-sm leading-6 text-red-800">
                  {draft.missingFacts.map((item) => <li key={item}>• {item}</li>)}
                </ul>
              </div>
            ) : null}

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <a
                href={MODU_2026_APPLICATION_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => track("modoo_official_apply_click", { location: "draft_result" })}
                className="flex min-h-12 items-center justify-center rounded-xl bg-blue-700 px-5 text-sm font-extrabold text-white hover:bg-blue-800"
              >
                모두의창업 공식 지원서 작성하기 ↗
              </a>
              <button
                type="button"
                onClick={() => {
                  setDraft(null);
                  document.getElementById("builder")?.scrollIntoView({ behavior: "smooth" });
                }}
                className="min-h-12 rounded-xl border border-zinc-300 bg-white px-5 text-sm font-bold text-zinc-700 hover:bg-zinc-50"
              >
                답변 고쳐서 다시 만들기
              </button>
            </div>
            <p className="mt-4 text-xs leading-5 text-zinc-500">
              공식 플랫폼의 최신 문항을 확인해 필요한 재료만 나눠 옮겨야 합니다. 이 Word 파일만으로는 신청이 완료되지 않습니다.
            </p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
