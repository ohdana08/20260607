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
  supportingMaterials: [],
};

const MATERIAL_ACCEPT = "image/png,image/jpeg,image/webp,image/gif,application/pdf,.pdf,.docx,.hwp,.hwpx,.txt,.md";

const INPUT_CLASS =
  "mt-2 w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3.5 text-[15px] leading-6 text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100";

type ModooTextFieldKey = Exclude<keyof ModooDraftRequest, "supportingMaterials">;

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
  id: ModooTextFieldKey;
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
  const [materialBusy, setMaterialBusy] = useState(false);
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

  async function uploadMaterials(files: FileList | null) {
    if (!files || files.length === 0 || materialBusy) return;
    const remaining = 3 - form.supportingMaterials.length;
    if (remaining <= 0) {
      setError("자료는 최대 3개까지 올릴 수 있어요. 기존 자료를 지우고 다시 선택해 주세요.");
      return;
    }

    setMaterialBusy(true);
    setError("");
    const collected: ModooDraftRequest["supportingMaterials"] = [];
    const failed: string[] = [];
    for (const file of Array.from(files).slice(0, remaining)) {
      if (file.size > 3 * 1024 * 1024) {
        failed.push(`${file.name}: 3MB보다 큰 파일이에요.`);
        continue;
      }
      try {
        const body = new FormData();
        body.append("file", file);
        const response = await fetch("/api/modoo-2026/materials", { method: "POST", body });
        const data = (await response.json().catch(() => ({}))) as {
          material?: ModooDraftRequest["supportingMaterials"][number];
          error?: string;
        };
        if (!response.ok || !data.material) throw new Error(data.error || "파일을 읽지 못했어요.");
        collected.push(data.material);
      } catch (caught) {
        failed.push(`${file.name}: ${caught instanceof Error ? caught.message : "파일을 읽지 못했어요."}`);
      }
    }
    if (collected.length > 0) {
      setForm((current) => ({
        ...current,
        supportingMaterials: [...current.supportingMaterials, ...collected].slice(0, 3),
      }));
      track("modoo_material_upload", { file_count: collected.length });
    }
    if (failed.length > 0) setError(failed.join("\n"));
    setMaterialBusy(false);
  }

  async function generateDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || materialBusy) return;
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
            내가 겪은 일과 자료를
            <br />지원서 문장으로 바꿉니다
          </h2>
          <p className="mt-5 text-[15px] leading-7 text-zinc-600">
            공식 지원서와 똑같은 질문표는 아닙니다. 대표님이 직접 본 일과 가지고 있는 자료부터 정리합니다. 없는 매출·반응·성과는 만들지 않고, 더 확인할 내용은
            <b className="text-zinc-900"> [보완 필요]</b>로 남깁니다.
          </p>
          <div className="mt-6 space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-950">
            <p className="font-extrabold">작성 전에 확인해 주세요</p>
            <ul className="space-y-2 text-amber-900">
              <li>• 이 결과는 공식 지원서 문항 복제본이 아니라 작성 재료 정리본입니다.</li>
              <li>• 공식 플랫폼의 최신 질문과 글자 수를 마지막에 다시 확인해야 합니다.</li>
              <li>• 이미 사업자등록증이 있다면, 기존 사업과 다른 업종으로 지원해야 하는지 공고문에서 확인해 주세요.</li>
            </ul>
          </div>
        </div>

        <form onSubmit={generateDraft} className="rounded-[28px] border border-zinc-200 bg-white p-5 shadow-xl shadow-zinc-200/50 sm:p-8">
          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <label htmlFor="track" className="block text-[15px] font-extrabold text-zinc-900">
                어느 분야로 신청할까요? <span className="text-blue-600">*</span>
              </label>
              <select
                id="track"
                value={form.track}
                onChange={(event) => update("track", event.target.value)}
                className={INPUT_CLASS}
              >
                {MODU_TRACKS.map((track) => <option key={track}>{track}</option>)}
              </select>
              <p className="mt-1 text-xs leading-5 text-zinc-500">특정 지역의 사람·공간·자원과 깊이 연결된 아이디어라면 로컬 트랙을 확인해 보세요.</p>
            </div>
            <div>
              <label htmlFor="businessStatus" className="block text-[15px] font-extrabold text-zinc-900">
                지금 사업자등록증이 있나요? <span className="text-blue-600">*</span>
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
                어떤 일을 하는 아이디어인가요? <span className="text-blue-600">*</span>
              </label>
              <input
                id="industry"
                name="industry"
                required
                maxLength={100}
                value={form.industry}
                placeholder="예: 동네 식당의 남는 음식을 가까운 손님과 연결하는 서비스"
                onChange={(event) => update("industry", event.target.value)}
                className={INPUT_CLASS}
              />
            </div>
          </div>

          <div className="my-8 h-px bg-zinc-100" />
          <div className="space-y-7">
            <TextAreaField
              id="customerScene"
              label="누가, 언제, 어떤 불편을 겪었나요?"
              hint="직접 보거나 들은 일 중 아이디어를 떠올리게 한 장면을 말하듯 적어주세요."
              placeholder="예: 엄마의 작은 식당에서 마감할 때마다 남은 식재료를 버리는 것을 보았습니다."
              value={form.customerScene}
              required
              onChange={(value) => update("customerScene", value)}
            />
            <TextAreaField
              id="currentAlternative"
              label="그 사람은 지금 이 문제를 어떻게 해결하고 있나요?"
              hint="내 아이디어가 없는 지금, 사람들이 실제로 하는 방법을 적어주세요. 모르면 비워도 됩니다."
              placeholder="예: 종이에 적거나, 지인에게 묻거나, 엑셀에 정리하거나, 그냥 포기합니다."
              value={form.currentAlternative}
              maxLength={1_500}
              onChange={(value) => update("currentAlternative", value)}
            />
            <TextAreaField
              id="problemEvidence"
              label="이 문제가 실제로 있다는 것을 보여줄 내용이 있나요?"
              hint="대화, 문의, 사진, 메모, 예약, 판매 기록이 있다면 적어주세요. 없으면 비워도 됩니다."
              placeholder="예: 지난 일주일 동안 폐기하는 장면을 직접 세 번 보았고 사진을 찍었습니다."
              value={form.problemEvidence}
              onChange={(value) => update("problemEvidence", value)}
            />
            <div className="rounded-2xl border border-blue-200 bg-blue-50/50 p-5">
              <div>
                <p className="text-[15px] font-extrabold text-zinc-900">사진이나 문서가 있다면 여기에 올려주세요 <span className="text-zinc-400">(선택)</span></p>
                <p className="mt-1 text-xs leading-5 text-zinc-600">고객 대화 캡처, 문의 기록, 사진, PDF, Word, 한글 파일을 올리면 실제 작성 근거로 반영합니다.</p>
              </div>
              <label
                htmlFor="supporting-materials"
                className="mt-4 flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-blue-300 bg-white px-4 text-center transition hover:border-blue-500 hover:bg-blue-50"
              >
                <span className="text-2xl" aria-hidden="true">📎</span>
                <span className="mt-2 text-sm font-extrabold text-blue-700">
                  {materialBusy ? "자료에서 글자를 읽는 중…" : "파일 선택하기"}
                </span>
                <span className="mt-1 text-xs text-zinc-500">최대 3개 · 파일당 3MB 이하</span>
              </label>
              <input
                id="supporting-materials"
                type="file"
                accept={MATERIAL_ACCEPT}
                multiple
                disabled={materialBusy || form.supportingMaterials.length >= 3}
                className="sr-only"
                onChange={(event) => {
                  void uploadMaterials(event.target.files);
                  event.target.value = "";
                }}
              />
              {form.supportingMaterials.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2" aria-label="읽은 첨부 자료">
                  {form.supportingMaterials.map((material, index) => (
                    <span key={`${material.name}-${index}`} className="flex max-w-full items-center gap-2 rounded-xl border border-blue-200 bg-white px-3 py-2 text-xs text-zinc-700">
                      <span aria-hidden="true">✅</span>
                      <span className="max-w-[220px] truncate">{material.name}</span>
                      <button
                        type="button"
                        aria-label={`${material.name} 제거`}
                        onClick={() => update("supportingMaterials", form.supportingMaterials.filter((_, itemIndex) => itemIndex !== index))}
                        className="font-black text-zinc-400 hover:text-red-600"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
              <p className="mt-3 text-[11px] leading-5 text-zinc-500">딱지원핏 서버에 파일 원본을 따로 보관하지 않습니다. PDF와 사진은 내용을 읽기 위해 AI 제공자에게 전송될 수 있어요. 주민등록번호·계좌번호는 가리고 올려주세요.</p>
            </div>
            <TextAreaField
              id="solutionMechanism"
              label="내 아이디어를 쓰면 무엇이 어떻게 달라지나요?"
              hint="사용하기 전과 후를 비교해 쉽게 설명해 주세요."
              placeholder="예: 식당이 남은 메뉴를 올리면 가까운 손님이 예약하고, 정해진 시간에 찾아갑니다."
              value={form.solutionMechanism}
              required
              onChange={(value) => update("solutionMechanism", value)}
            />
            <TextAreaField
              id="paymentMoment"
              label="누가, 언제 돈을 내나요?"
              hint="가격을 아직 모르면 누가 무엇을 받을 때 돈을 내는지만 적어도 됩니다."
              placeholder="예: 식당 주인이 예약 판매가 실제로 일어났을 때 수수료를 냅니다."
              value={form.paymentMoment}
              maxLength={1_500}
              onChange={(value) => update("paymentMoment", value)}
            />
            <TextAreaField
              id="firstValidation"
              label="처음 30일 동안 무엇을 해볼 건가요?"
              hint="완성품을 만드는 계획보다, 사람들이 정말 필요로 하는지 작게 확인하는 방법을 적어주세요."
              placeholder="예: 식당 주인 3명에게 예약 판매 화면을 보여주고 직접 쓸 의사가 있는지 묻습니다."
              value={form.firstValidation}
              maxLength={1_500}
              onChange={(value) => update("firstValidation", value)}
            />
            <TextAreaField
              id="founderEvidence"
              label="내가 이 아이디어를 실행할 수 있는 이유는 무엇인가요?"
              hint="거창한 경력이 아니어도 됩니다. 직접 해본 일, 잘 아는 분야, 도움을 줄 사람을 적어주세요."
              placeholder="예: 가족 식당의 발주와 마감 과정을 2년 동안 가까이서 봤고, 간단한 예약 페이지를 만들 수 있습니다."
              value={form.founderEvidence}
              onChange={(value) => update("founderEvidence", value)}
            />
            <TextAreaField
              id="localGrounding"
              label="로컬 트랙이라면, 왜 바로 이 지역에서 시작하나요?"
              hint="이 지역의 사람, 공간, 재료, 문화, 문제와 내 아이디어가 어떻게 연결되는지 적어주세요."
              placeholder="일반·기술 트랙을 선택했거나 지역과 관계가 없다면 비워두세요."
              value={form.localGrounding}
              maxLength={1_500}
              onChange={(value) => update("localGrounding", value)}
            />
            <TextAreaField
              id="mentorDecision"
              label="멘토에게 가장 먼저 물어보고 싶은 것은 무엇인가요?"
              hint="‘잘 되게 해주세요’보다, 지금 고민 중인 두 가지 선택지를 적으면 더 좋습니다."
              placeholder="예: 첫 고객을 일반 손님으로 잡을지, 식당 주인으로 잡을지 묻고 싶습니다."
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
            disabled={busy || materialBusy}
            className="mt-8 flex min-h-14 w-full items-center justify-center rounded-2xl bg-blue-700 px-5 text-base font-extrabold text-white transition hover:bg-blue-800 disabled:cursor-wait disabled:opacity-60"
          >
            {materialBusy ? "올린 자료를 읽는 중…" : busy ? "내 답변으로 초안을 만드는 중…" : "내 답변으로 초안 만들기"}
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
                <h2 className="mt-1 text-2xl font-black tracking-tight text-zinc-950">작성된 문장과 더 필요한 내용을 확인하세요</h2>
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
                <h3 className="font-extrabold text-red-900">제출 전에 더 확인할 내용</h3>
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
