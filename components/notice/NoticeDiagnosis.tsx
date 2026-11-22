"use client";
import { useState } from "react";
import { authedHeaders } from "@/components/auth/AuthGate";
import type { Notice, Diagnosis, Source } from "@/lib/notice/types";
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
type Props = {
  initialUrl: string;
  onPlan: (notice: Notice, notes: string) => void;
};
export default function NoticeDiagnosis({ initialUrl, onPlan }: Props) {
  const [url, setUrl] = useState(initialUrl),
    [notice, setNotice] = useState<Notice | null>(null);
  const [step, setStep] = useState(0),
    [group, setGroup] = useState(0);
  const [responses, setResponses] = useState<Record<number, string[]>>({}),
    [files, setFiles] = useState<Source[]>([]);
  const [report, setReport] = useState<Diagnosis | null>(null),
    [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  const active = notice?.groups[group],
    answers = responses[group] || [];
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
  async function upload(list: File[]) {
    if (!list.length) return;
    await run("첨부파일 본문을 읽고 있어요…", async () => {
      if (files.length + list.length > 12)
        throw new Error("파일은 최대 12개까지 올릴 수 있습니다.");
      const errors: string[] = [];
      for (const f of list) {
        try {
          if (f.size > 3 * 1024 * 1024) throw new Error("3MB를 초과합니다.");
          const form = new FormData();
          form.set("file", f);
          const parsed = await request<Source>(form);
          setFiles((current) => [
            ...current.filter((s) => s.name !== parsed.name),
            parsed,
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
        files,
      });
      setReport(result);
      setStep(2);
    });
  }
  function answer(i: number, value: string) {
    const next = [...answers];
    next[i] = value;
    setResponses({ ...responses, [group]: next });
    setReport(null);
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
                <label>
                  {q.prompt}
                  <textarea
                    rows={2}
                    maxLength={2000}
                    value={answers[i] || ""}
                    placeholder="현재 상황을 적어주세요"
                    onChange={(e) => answer(i, e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => answer(i, "아직 준비하지 못했어요.")}
                >
                  아직 준비 전
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => answer(i, "잘 모르겠어요.")}
                >
                  잘 모르겠어요
                </button>
                <details>
                  <summary>질문의 근거</summary>
                  <p>
                    {q.source} · {q.quote}
                  </p>
                </details>
              </div>
            ))}
            <label>
              내 사업 자료 첨부 <small>선택 · 파일당 3MB, 최대 12개</small>
              <input
                type="file"
                multiple
                accept=".pdf,.docx,.hwpx,.hwp,.txt,.md,.jpg,.jpeg,.png,.webp"
                onChange={(e) => {
                  const list = Array.from(e.target.files || []);
                  e.target.value = "";
                  void upload(list);
                }}
              />
            </label>
            {files.map((f) => (
              <details key={f.name}>
                <summary>{f.name} · 본문 읽음</summary>
                <p>{f.text.slice(0, 400)}</p>
                <button
                  className="secondary"
                  onClick={() => {
                    setFiles(files.filter((s) => s.name !== f.name));
                    setReport(null);
                  }}
                >
                  첨부 제외
                </button>
              </details>
            ))}
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
              {files.length ? "이 자료로 진단받기" : "자료 없이 진단받기"}
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
