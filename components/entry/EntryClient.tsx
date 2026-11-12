"use client";

import { useEffect, useRef, useState } from "react";
import AuthGate from "@/components/auth/AuthGate";
import { track } from "@/lib/ga";
import { parseEntryConditions, type EntryConditions } from "@/lib/entry/conditions";
import type { EntryCard } from "@/lib/entry/types";
import PushPanel from "./PushPanel";

const STORAGE = "ddakfit-entry-conditions-v1";
const ALERT_INTENT = "ddakfit-entry-alert-intent";
const QUESTIONS: { key: keyof EntryConditions; title: string; hint: string; options: [string, string][] }[] = [
  { key: "age", title: "대표님의 연령대는요?", hint: "연령 조건이 있는 공고를 확인할게요.", options: [["under_30", "만 30세 미만"], ["30_39", "만 30~39세"], ["40_49", "만 40~49세"], ["50_plus", "만 50세 이상"]] },
  { key: "region", title: "어디에서 사업하시나요?", hint: "사업장 소재지 또는 창업 예정 지역을 골라 주세요.", options: ["서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종", "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주"].map(v => [v, v]) },
  { key: "business", title: "사업을 시작한 지 얼마나 됐나요?", hint: "사업자등록일을 기준으로 골라 주세요.", options: [["pre", "아직 준비 중이에요"], ["under_3", "3년 미만"], ["3_7", "3년 이상 ~ 7년 미만"], ["over_7", "7년 이상"]] },
  { key: "industry", title: "어떤 일을 하시나요?", hint: "가장 가까운 업종 하나를 골라 주세요.", options: [["tech", "IT·기술"], ["manufacturing", "제조"], ["food", "음식·외식"], ["retail", "도소매·유통"], ["service", "서비스"], ["other", "그 외 업종"]] },
];

export default function EntryClient() {
  const [started, setStarted] = useState(false);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Partial<EntryConditions>>({});
  const [results, setResults] = useState<EntryCard[] | null>(null);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [alerts, setAlerts] = useState(false);
  const [notice, setNotice] = useState<EntryCard | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const conditions = parseEntryConditions(answers);

  async function loadResults(value: EntryConditions, submit = true) {
    setBusy(true); setError("");
    if (submit) track("entry_conditions_submit");
    try {
      const response = await fetch("/api/entry/results", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.results)) throw new Error("unavailable");
      setResults(data.results); setTotal(data.total);
      track("entry_results_view", { count: data.results.length });
      try { localStorage.setItem(STORAGE, JSON.stringify(value)); } catch { /* Storage denial does not block discovery. */ }
    } catch { setError("공고를 불러오지 못했어요. 잠시 후 다시 시도해 주세요."); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    let saved: EntryConditions | null = null;
    try { saved = parseEntryConditions(JSON.parse(localStorage.getItem(STORAGE) ?? "null")); } catch { /* ignore */ }
    const params = new URLSearchParams(location.search);
    let wantsAlerts = false;
    try { wantsAlerts = localStorage.getItem(ALERT_INTENT) === "1"; } catch { /* ignore */ }
    if (saved) {
      const restored = saved;
      // Restore saved answers after mount (deferred: no synchronous setState in the effect body).
      queueMicrotask(() => {
        setAnswers(restored); setStarted(true); setStep(3);
        void loadResults(restored, false);
        setAlerts(wantsAlerts || params.has("installed"));
      });
    }
    const program = params.get("program");
    if (program) {
      fetch(`/api/entry/program?id=${encodeURIComponent(program)}`)
        .then(async res => { if (!res.ok) throw new Error("unavailable"); return res.json(); })
        .then(data => { if (data.program) setNotice(data.program); else setError("이 공고는 마감됐거나 현재 확인할 수 없어요. 다른 공고를 찾아보세요."); })
        .catch(() => setError("알림의 공고를 불러오지 못했어요. 조건을 골라 다시 확인해 주세요."));
    }
  }, []);

  useEffect(() => { if (started) heading.current?.focus(); }, [step, started, results]);

  function choose(value: string) {
    const next = { ...answers, [QUESTIONS[step].key]: value };
    setAnswers(next);
    if (step < 3) setStep(step + 1);
    else { const valid = parseEntryConditions(next); if (valid) void loadResults(valid); }
  }
  function openAlerts() {
    try { localStorage.setItem(ALERT_INTENT, "1"); } catch { /* ignore */ }
    setAlerts(true);
  }

  return <div className="entry-shell">
    <header className="entry-header"><a href="/discover" aria-label="딱지원핏 홈"><span className="entry-brand-mark">BCC</span><strong>딱, 지원핏</strong></a><span>지원사업 찾기 · 무료</span></header>
    <main className="entry-main">
      {notice && <section className="entry-notice"><p className="entry-eyebrow">알림에서 온 공고</p><NoticeCard card={notice} /></section>}
      {!started ? <section className="entry-hero">
        <p className="entry-eyebrow">정부지원사업, 처음이어도 괜찮아요</p>
        <h1>내 사업도<br /><em>지원받을 수 있을까?</em></h1>
        <p className="entry-lede">사업을 준비 중이어도, 이미 시작했어도.<br />내 조건에 맞는 공고부터 쉽게 확인해 보세요.</p>
        <div className="entry-illustration" aria-hidden="true"><span className="entry-paper"><small>내게 맞는 지원</small><b>누가 받을 수 있는지</b><b>최대 얼마인지</b><b>언제까지인지</b><i>✓</i></span><span className="entry-sticker">딱 필요한<br />것만</span></div>
        <button className="entry-primary" onClick={() => setStarted(true)}>1분이면 내가 받을 수 있는지 나와요 <span aria-hidden="true">→</span></button>
        <p className="entry-footnote">로그인 없이 · 네 가지만 선택 · 무료</p>
      </section> : results === null ? <section className="entry-question" aria-busy={busy}>
        <div className="entry-progress" aria-label={`${step + 1}/4단계`}>{QUESTIONS.map((q, i) => <span key={q.key} className={i <= step ? "filled" : ""} />)}</div>
        <p className="entry-eyebrow">{step + 1} / 4</p><h1 ref={heading} tabIndex={-1}>{busy ? "내게 맞는 공고를 찾고 있어요" : QUESTIONS[step].title}</h1>
        <p className="entry-lede">{QUESTIONS[step].hint}</p>
        <div className={`entry-options ${step === 1 ? "entry-regions" : ""}`}>
          {QUESTIONS[step].options.map(([value, label]) => <button key={value} disabled={busy} aria-pressed={answers[QUESTIONS[step].key] === value} onClick={() => choose(value)}>{label}</button>)}
        </div>
        {step > 0 && <button className="entry-text-button" disabled={busy} onClick={() => setStep(step - 1)}>← 이전 질문</button>}
        {error && conditions && <button className="entry-secondary" disabled={busy} onClick={() => void loadResults(conditions)}>다시 불러오기</button>}
      </section> : <section className="entry-results">
        <p className="entry-eyebrow">조건 확인 완료</p><h1 ref={heading} tabIndex={-1}>{results.length ? "이 공고부터 확인해 보세요" : "지금은 맞는 공고가 없어요"}</h1>
        <p className="entry-lede">{results.length ? `조건에 맞는 공고 ${total}건 중 ${results.length}건이에요.` : "새 공고가 들어오면 다시 찾아드릴게요."}</p>
        <p className="entry-caution">네 가지 조건으로 찾은 후보예요. 최종 신청 자격과 지원금은 원문에서 확인해 주세요.</p>
        <div className="entry-cards">{results.map(card => <NoticeCard key={card.id} card={card} />)}</div>
        <button className="entry-text-button" onClick={() => { setResults(null); setStep(0); setAlerts(false); }}>조건 다시 고르기</button>
        <section className="entry-alert-box"><p className="entry-eyebrow">새 공고를 놓치지 않도록</p><h2>새 공고 나오면 알려 드릴게요</h2><p>새 공고는 하루 한 번, 월요일에는 이번 주 공고를 모아서 보내 드려요.</p>
          {!alerts ? <button className="entry-primary" onClick={openAlerts}>새 공고 알림 받기</button> : conditions && <AuthGate><PushPanel conditions={conditions} /></AuthGate>}
        </section>
      </section>}
      {error && <p role="alert" className="entry-error">{error}</p>}
    </main>
    <footer className="entry-footer">딱, 지원핏 · BCC <a href="/privacy">개인정보처리방침</a></footer>
  </div>;
}

function NoticeCard({ card }: { card: EntryCard }) {
  return <article className="entry-card"><h2>{card.title}</h2><p>{card.description}</p><dl>
    <div><dt>누가</dt><dd>{card.who}</dd></div><div><dt>최대 얼마</dt><dd>{card.amount}</dd></div><div><dt>마감일</dt><dd>{card.deadline}</dd></div>
  </dl><a href={card.url} target="_blank" rel="noopener noreferrer" className="entry-source">공고 원문 확인 ↗</a>
  <a className="entry-preview" href={card.previewUrl} onClick={() => track("draft_preview_click")}>이 공고 계획서 초안 미리보기(무료) <span aria-hidden="true">→</span></a>
  <small>기존 무료 진단에서 제출서류를 확인한 뒤 미리보기로 이어져요.</small></article>;
}
