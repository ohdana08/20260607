"use client";
import { useState } from "react";
import { authedHeaders } from "@/components/auth/AuthGate";
import type { Notice, Diagnosis, EvidenceFile, Source } from "@/lib/notice/types";
import { questionExample } from "@/lib/notice/questionExample";
import "./notice.css";

async function request<T>(
  body: Record<string, unknown> | FormData,
): Promise<T> {
  const headers = await authedHeaders();
  const form = body instanceof FormData;
  const res = await fetch("/api/notice-diagnosis", {
    method: "POST",
    headers: form
      ? headers
      : { "Content-Type": "application/json", ...headers },
    body: form ? body : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error(
      res.status === 401
        ? "로그인이 필요합니다."
        : res.status === 429
          ? "잠시 후 다시 시도해 주세요."
          : data.error || "자료를 읽지 못했습니다.",
    );
  return data;
}
type Reply = { status?: string; note?: string };
type Attachment = EvidenceFile & { group?: number };
type Props = {
  initialUrl: string;
  onPlan: (notice: Notice, notes: string) => void;
};
export default function NoticeDiagnosis({ initialUrl, onPlan }: Props) {
  const [url, setUrl] = useState(initialUrl),
    [notice, setNotice] = useState<Notice | null>(null);
  const [step, setStep] = useState(0),
    [group, setGroup] = useState(0);
  const [responses, setResponses] = useState<Record<number, Reply[]>>({}),
    [files, setFiles] = useState<Attachment[]>([]);
  const [report, setReport] = useState<Diagnosis | null>(null),
    [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  const active = notice?.groups[group],
    replies = responses[group] || [];
  const activeFiles = files.filter(f => f.group === undefined || f.group === group);
  const answers = active?.questions.map((_, i) => [replies[i]?.status, replies[i]?.note?.trim()].filter(Boolean).join(" · ") || (activeFiles.some(f => f.questionIndex === i) ? "첨부 자료로 답변합니다." : "")) || [];
  async function run(label: string, fn: () => Promise<void>) {
    setError("");
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "다시 시도해 주세요.");
    } finally {
      setBusy("");
    }
  }
  async function load() {
    if (notice && url.trim() === notice.url) {
      setStep(1);
      return;
    }
    await run("공고문과 첨부를 읽고 질문을 준비하고 있어요…", async () => {
      const n = await request<Notice>({ action: "import", url: url.trim() });
      setNotice(n);
      setUrl(n.url);
      setGroup(0);
      setResponses({});
      setFiles([]);
      setReport(null);
      setStep(1);
    });
  }
  async function upload(list: File[], questionIndex?: number) {
    if (!list.length) return;
    await run("첨부파일 본문을 읽고 있어요…", async () => {
      const fileGroup = questionIndex === undefined ? undefined : group;
      const sameSlot = (f: Attachment) => f.group === fileGroup && f.questionIndex === questionIndex;
      const addedNames = new Set(list.map(f => f.name).filter(name => !files.some(f => sameSlot(f) && f.name === name)));
      if (files.length + addedNames.size > 12)
        throw new Error("파일은 최대 12개까지 올릴 수 있습니다.");
      const errors: string[] = [];
      for (const f of list) {
        try {
          if (f.size > 3 * 1024 * 1024) throw new Error("3MB를 초과합니다.");
          const form = new FormData();
          form.set("file", f);
          const parsed = await request<Source>(form);
          setFiles((current) => [
            ...current.filter((s) => !sameSlot(s) || s.name !== parsed.name),
            { ...parsed, group: fileGroup, questionIndex },
          ]);
          setReport(null);
        } catch (e) {
          errors.push(
            f.name + " · " + (e instanceof Error ? e.message : "읽기 실패"),
          );
        }
      }
      if (errors.length) throw new Error(errors.join("\n"));
    });
  }
  async function analyze() {
    if (!notice || !active) return;
    await run("공고 조건과 답변·자료를 대조하고 있어요…", async () => {
      const result = await request<Diagnosis>({
        action: "diagnose",
        title: notice.title,
        group: active.name,
        questions: active.questions,
        answers,
        files: activeFiles.map(({name, text, questionIndex}) => ({name, text, questionIndex})),
      });
      setReport(result);
      setStep(2);
    });
  }
  function answer(i: number, change: Reply) {
    const next = [...replies];
    next[i] = { ...next[i], ...change };
    setResponses({ ...responses, [group]: next });
    setReport(null);
  }
  function attachmentField(questionIndex?: number) {
    return <>
            <label>
              {questionIndex === undefined ? "공통 자료 첨부" : "이 질문에 파일 첨부"} <small>선택 · 파일당 3MB, 전체 최대 12개</small>
              <input
                type="file"
                multiple
                accept=".pdf,.docx,.hwpx,.hwp,.txt,.md,.jpg,.jpeg,.png,.webp"
                onChange={(e) => {
                  const list = Array.from(e.target.files || []);
                  e.target.value = "";
                  void upload(list, questionIndex);
                }}
              />
            </label>
            {activeFiles.filter(f => f.questionIndex === questionIndex).map((f) => (
              <details key={f.name}>
                <summary>{f.name} · 본문 읽음</summary>
                <p>{f.text.slice(0, 400)}</p>
                <button
                  className="secondary"
                  onClick={() => {
                    setFiles(files.filter((s) => s !== f));
                    setReport(null);
                  }}
                >
                  첨부 제외
                </button>
              </details>
            ))}
    </>;
  }
  return (
    <article className="notice-flow">
      <ol aria-label="공고 진단 진행 단계">
        {["공고 가져오기", "내 준비 상태 확인하기", "진단 결과 보기"].map(
          (s, i) => (
            <li key={s} aria-current={step === i ? "step" : undefined}>
              {s}
            </li>
          ),
        )}
      </ol>
      {step === 0 && (
        <>
          <h1>지원하려는 공고의 링크를 붙여넣어 주세요</h1>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void load();
            }}
          >
            <label>
              공식 공고 링크
              <input
                type="url"
                required
                maxLength={4096}
                value={url}
                disabled={!!busy}
                onChange={(e) => setUrl(e.target.value)}
              />
            </label>
            <button disabled={!!busy}>공고 가져오기 →</button>
          </form>
          <details>
            <summary>영상으로 보기 · 지역별 사이트에서 공고 찾아 가져오기</summary>
            <video
              aria-label="공고를 찾아 첨부파일을 확인하고 딱지원핏으로 가져오는 방법"
              src="/notice/notice-walkthrough.mp4"
              controls
              playsInline
              preload="none"
            />
          </details>
        </>
      )}
      {step === 1 && notice && active && (
        <>
          <h1>내 준비 상태 확인하기</h1>
          <a href={notice.url} target="_blank" rel="noreferrer">
            {notice.title} ↗
          </a>
          <details>
            <summary>공고에서 읽은 자료 {notice.sources.length}개</summary>
            {notice.sources.map((s, i) => (
              <p key={i}>{s}</p>
            ))}
          </details>
          {!!notice.unread.length && (
            <p>본문 확인이 필요한 첨부 · {notice.unread.join(", ")}</p>
          )}
          <fieldset disabled={!!busy}>
            {notice.groups.length > 1 && (
              <label>
                어느 세부사업을 준비하고 계세요?
                <select
                  value={group}
                  onChange={(e) => {
                    setGroup(Number(e.target.value));
                    setReport(null);
                  }}
                >
                  {notice.groups.map((g, i) => (
                    <option key={i} value={i}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {active.questions.map((q, i) => (
              <div className="notice-question" key={group + "-" + i}>
                <h2 id={`question-${i}`}>{q.prompt}</h2>
                <div role="group" aria-labelledby={`question-${i}`}>
                  {(q.options ?? ["아직 준비 전", "있어요", "잘 모르겠어요"]).map(status => (
                    <button key={status} type="button" className="secondary"
                      aria-pressed={replies[i]?.status === status}
                      onClick={() => answer(i, { status })}>{status}</button>
                  ))}
                </div>
                <details>
                  <summary>추가로 알려줄 내용이 있어요</summary>
                  <input type="text" aria-label={q.prompt + " 추가 설명"} maxLength={1900}
                    value={replies[i]?.note || ""} aria-describedby={`note-help-${i}`}
                    onChange={e => answer(i, { note: e.target.value })}/>
                  <small className="notice-note-help" id={`note-help-${i}`}>
                    이미 해둔 일이나 기다리는 일을 알려주시면, 다음에 할 일을 더 구체적으로 안내해 드려요.
                    {questionExample(q) && <><br/>예를 들면 “{questionExample(q)}”</>}
                  </small>
                </details>
                {attachmentField(i)}
                <details>
                  <summary>질문의 근거</summary>
                  <p>
                    {q.source} · {q.quote}
                  </p>
                </details>
              </div>
            ))}
            {attachmentField()}
            <button
              className="secondary"
              onClick={() => {
                setStep(0);
                setError("");
              }}
            >
              ← 공고
            </button>
            <button
              disabled={active.questions.some((_, i) => !answers[i]?.trim())}
              onClick={() => void analyze()}
            >
              {activeFiles.length ? "이 자료로 진단받기" : "자료 없이 진단받기"}
            </button>
          </fieldset>
        </>
      )}
      {step === 2 && report && notice && active && (
        <>
          <h1>진단 결과 보기</h1>
          <p>
            {notice.title} · {active.name}
          </p>
          <h2>먼저 할 일</h2>
          <p>{report.priority}</p>
          {report.findings.map((r, i) => (
            <section className="notice-question" key={i}>
              <h2>{r.question}</h2>
              <strong>{r.status}</strong>
              <p>{r.reason}</p>
              <p>다음 행동 · {r.next}</p>
              {r.evidence && <blockquote>{r.evidence}</blockquote>}
              <details>
                <summary>공고 근거</summary>
                <p>
                  {active.questions[i].source} · {active.questions[i].quote}
                </p>
              </details>
            </section>
          ))}
          <button
            className="secondary"
            onClick={() => {
              setStep(1);
              setError("");
            }}
          >
            답변·자료 보강하기
          </button>
          <button
            onClick={() =>
              onPlan(
                notice,
                [
                  notice.title,
                  active.name,
                  ...active.questions.map(
                    (q, i) =>
                      q.prompt + " " + answers[i] + "\n공고 근거: " + q.quote,
                  ),
                  ...report.findings.map((f) =>
                    [f.reason, f.evidence, f.next].join("\n"),
                  ),
                ].join("\n"),
              )
            }
          >
            사업계획서로 이어가기 →
          </button>
        </>
      )}
      {busy && <p role="status">{busy}</p>}
      {error && <p role="alert">{error}</p>}
    </article>
  );
}
