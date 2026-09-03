"use client";

import { useEffect, useRef, useState } from "react";
import { authedHeaders } from "@/components/auth/AuthGate";
import {
  GROBLE_PRESENTATION_CHECKOUT_URL,
  PRESENTATION_PRICE_KRW,
  PRESENTATION_PRICE_LABEL,
} from "@/lib/config";
import { track } from "@/lib/ga";
import type { Program } from "@/lib/match/types";
import type { PlanDocxSection } from "@/lib/plan/docx";
import {
  mergePresentationClaims,
  PRESENTATION_STAGE_DEFS,
  type PresentationClaim,
  type PresentationInterviewReply,
  type PresentationPack,
  type PresentationProgress,
  type PresentationReview,
} from "@/lib/plan/presentation";
import type { EvidencePack, StrategyPack } from "@/lib/plan/strategy";
import type { PresentationRevisionStatus } from "@/lib/plan/presentationRevisions";
import {
  PRESENTATION_OUTCOME_NOTICE,
  PRESENTATION_REVISION_NOTICE,
} from "@/lib/plan/presentationPolicy";

interface PresentationImage {
  mediaType: string;
  data: string;
}

interface PresentationFile {
  mediaType: string;
  data: string;
  name?: string;
}

interface PresentationDoc {
  name: string;
  text: string;
}

interface PresentationMessage {
  role: "user" | "assistant";
  content: string;
  images?: PresentationImage[];
  files?: PresentationFile[];
  docs?: PresentationDoc[];
}

interface ConvertedFiles {
  imgs: PresentationImage[];
  pdfs: PresentationFile[];
  docs: PresentationDoc[];
}

interface PresentationOrderStatus {
  paid: boolean;
  loggedIn: boolean;
  wordPaid?: boolean;
  configured: boolean;
  usedProgramId?: string | null;
  source?: "presentation" | "bundle" | "qa" | "admin" | null;
  admin?: boolean;
  consentedAt?: string | null;
  revision?: PresentationRevisionStatus;
}

function apiMessages(messages: PresentationMessage[]) {
  return messages.map((message) => ({
    role: message.role,
    content:
      message.content +
      (message.docs ?? [])
        .map((doc) => `\n\n[첨부한 문서 "${doc.name}"의 내용]\n${doc.text}`)
        .join(""),
    images: message.images,
    files: message.files,
  }));
}

function claimStatusLabel(claim: PresentationClaim): string {
  if (claim.status === "verified" && claim.origin === "external") return "외부 근거 확인";
  if (claim.status === "verified") return "확인된 사실";
  if (claim.status === "hypothesis") return "가설·추정";
  if (claim.status === "plan") return "향후 계획";
  if (claim.status === "missing") return "근거 없음";
  return claim.origin === "upload" ? "첨부자료 제공" : "사용자 제공 정보";
}

function claimStatusClass(claim: PresentationClaim): string {
  if (claim.status === "verified") return "bg-emerald-100 text-emerald-800";
  if (claim.status === "hypothesis") return "bg-violet-100 text-violet-800";
  if (claim.status === "plan") return "bg-blue-100 text-blue-800";
  if (claim.status === "missing") return "bg-red-100 text-red-800";
  return "bg-amber-100 text-amber-800";
}

function safeFileName(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, "-").slice(0, 120) || "발표자료-원고";
}

function buildMarkdown(pack: PresentationPack, review: PresentationReview, sections: PlanDocxSection[]): string {
  const claimMap = new Map(pack.claimLedger.map((claim) => [claim.id, claim]));
  const lines = [
    `# ${pack.title}`,
    "",
    pack.subtitle,
    "",
    `- 발표 대상: ${pack.audience}`,
    `- 발표 시간: ${pack.durationMinutes}분`,
    `- 발표 서사: ${pack.narrative}`,
    `- 근거 검토: ${review.status} · ${review.score}/100`,
    "",
  ];
  pack.slides.forEach((slide, index) => {
    lines.push(`## ${index + 1}. ${slide.title}`, "", `> ${slide.headline}`, "");
    slide.bullets.forEach((bullet) => lines.push(`- ${bullet}`));
    lines.push("", `**시각자료 방향:** ${slide.visualBrief || "텍스트 중심"}`, "", "### 발표자 대본", "", slide.speakerNotes);
    const claims = slide.claimIds.map((id) => claimMap.get(id)).filter((claim): claim is PresentationClaim => Boolean(claim));
    if (claims.length > 0) {
      lines.push("", "### 연결된 주장");
      claims.forEach((claim) => lines.push(`- [${claimStatusLabel(claim)}] ${claim.text}`));
    }
    if (slide.sourceNotes.length > 0) {
      lines.push("", "### Sources");
      slide.sourceNotes.forEach((note) => lines.push(`- ${note}`));
    }
    lines.push("");
  });
  lines.push("# 예상 질문·답변", "");
  pack.qa.forEach((item, index) => {
    lines.push(`## Q${index + 1}. ${item.question}`, "", item.answer);
    if (item.risk) lines.push("", `- 주의: ${item.risk}`);
    if (item.sourceNotes.length) lines.push("", ...item.sourceNotes.map((note) => `- 출처: ${note}`));
    lines.push("");
  });
  lines.push("# 데이터·근거 장부", "");
  pack.claimLedger.forEach((claim) => {
    lines.push(`- **${claimStatusLabel(claim)}** · ${claim.text}`);
    if (claim.assumption) lines.push(`  - 가정: ${claim.assumption}`);
    if (claim.verificationPlan) lines.push(`  - 검증·실행: ${claim.verificationPlan}`);
    if (claim.evidenceIds.length > 0) lines.push(`  - 근거 ID: ${claim.evidenceIds.join(", ")}`);
  });
  lines.push("", "# 원본 사업계획서 데이터 부록", "");
  sections.forEach((section) => lines.push(`## ${section.heading}`, "", section.content, ""));
  return lines.filter((line) => line !== undefined).join("\n");
}

export default function PresentationStudio({
  program,
  sections,
  evidence,
  strategy,
  sourceConversation,
  provider,
  code,
  convertFiles,
}: {
  program: Program;
  sections: PlanDocxSection[];
  evidence: EvidencePack;
  strategy: StrategyPack;
  sourceConversation: { role: "user" | "assistant"; content: string }[];
  provider: "claude" | "openai";
  code: string;
  convertFiles: (files: FileList | null) => Promise<ConvertedFiles>;
}) {
  const [started, setStarted] = useState(false);
  const [messages, setMessages] = useState<PresentationMessage[]>([]);
  const [input, setInput] = useState("");
  const [images, setImages] = useState<PresentationImage[]>([]);
  const [files, setFiles] = useState<PresentationFile[]>([]);
  const [docs, setDocs] = useState<PresentationDoc[]>([]);
  const [claims, setClaims] = useState<PresentationClaim[]>([]);
  const [progress, setProgress] = useState<PresentationProgress | null>(null);
  const [pack, setPack] = useState<PresentationPack | null>(null);
  const [review, setReview] = useState<PresentationReview | null>(null);
  const [orderStatus, setOrderStatus] = useState<PresentationOrderStatus | null>(null);
  const [orderNo, setOrderNo] = useState("");
  const [orderChecking, setOrderChecking] = useState(false);
  const [purchaseConsent, setPurchaseConsent] = useState(false);
  const [revisionRequest, setRevisionRequest] = useState("");
  const [exporting, setExporting] = useState<"pptx" | "pdf" | null>(null);
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const serviceConsentOk = Boolean(orderStatus?.admin) || purchaseConsent || Boolean(orderStatus?.consentedAt);

  async function fetchOrderStatus(): Promise<PresentationOrderStatus | null> {
    const query = code ? `?code=${encodeURIComponent(code)}` : "";
    const res = await fetch(`/api/plan/presentation/order${query}`, {
      headers: await authedHeaders(),
      cache: "no-store",
    });
    const data = (await res.json().catch(() => null)) as PresentationOrderStatus | null;
    return res.ok && data ? data : null;
  }

  async function refreshOrderStatus() {
    const data = await fetchOrderStatus();
    if (data) setOrderStatus(data);
    return data;
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const data = await fetchOrderStatus();
      if (!cancelled && data) setOrderStatus(data);
    })();
    // 사업계획서 1건이 바뀌면 해당 발표자료 권한도 다시 확인한다.
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [program.id, code]);

  useEffect(() => {
    if (
      !orderStatus?.paid ||
      (orderStatus.usedProgramId && orderStatus.usedProgramId !== program.id)
    ) return;
    let cancelled = false;
    void (async () => {
      const params = new URLSearchParams({ programId: program.id });
      if (code) params.set("code", code);
      const res = await fetch(`/api/plan/presentation/generate?${params.toString()}`, {
        headers: await authedHeaders(),
        cache: "no-store",
      });
      const data = (await res.json().catch(() => null)) as
        | {
            pack?: PresentationPack | null;
            review?: PresentationReview | null;
            revision?: PresentationRevisionStatus;
          }
        | null;
      if (cancelled || !res.ok || !data?.pack || !data.review) return;
      setPack(data.pack);
      setReview(data.review);
      setClaims(data.pack.claimLedger);
      setStarted(true);
      if (data.revision) {
        setOrderStatus((current) => current ? { ...current, revision: data.revision } : current);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orderStatus?.paid, orderStatus?.usedProgramId, program.id, code]);

  async function verifyPresentationOrder() {
    const cleaned = orderNo.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!/^\d{18,19}$/.test(cleaned) && !/^PT\d{16}$/.test(cleaned)) return;
    setOrderChecking(true);
    setError("");
    try {
      const res = await fetch("/api/plan/presentation/order", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authedHeaders()) },
        body: JSON.stringify({ orderNo: cleaned }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; isQa?: boolean } | null;
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? "발표자료 결제를 확인하지 못했어요.");
      track("presentation_order_verified", { price: PRESENTATION_PRICE_KRW });
      setOrderNo("");
      await refreshOrderStatus();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "발표자료 결제를 확인하지 못했어요.");
    } finally {
      setOrderChecking(false);
    }
  }

  async function requestTurn(history: PresentationMessage[], currentProgress: PresentationProgress | null) {
    const res = await fetch("/api/plan/presentation/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authedHeaders()) },
      body: JSON.stringify({
        messages: apiMessages(history),
        sourceConversation,
        sections,
        claimLedger: claims,
        progress: currentProgress,
        code,
        program,
        evidence,
        strategy,
        reviewStatus: "ready",
        serviceConsent: serviceConsentOk,
        provider,
      }),
    });
    const data = (await res.json().catch(() => null)) as (PresentationInterviewReply & { error?: string }) | null;
    if (!res.ok || !data) throw new Error(data?.error ?? "발표 질문을 불러오지 못했어요.");
    setClaims((current) => mergePresentationClaims(current, data.claims));
    setProgress(data.progress);
    setMessages((current) => [...current, { role: "assistant", content: data.reply }]);
  }

  async function start() {
    if (busy || !serviceConsentOk) return;
    setStarted(true);
    setBusy(true);
    setError("");
    track("presentation_interview_start", { program: program.title });
    try {
      await requestTurn(
        [{
          role: "user",
          content: "(시작 신호) 기존 사업계획서와 제 원답변에서 이미 확보된 내용을 먼저 정리하고, 발표자료에 꼭 필요한 부족한 질문 하나만 시작해 주세요.",
        }],
        null,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "발표 인터뷰를 시작하지 못했어요.");
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    const content = input.trim();
    if (busy || (!content && images.length === 0 && files.length === 0 && docs.length === 0)) return;
    const userMessage: PresentationMessage = {
      role: "user",
      content: content || "첨부한 자료를 확인해 주세요.",
      images,
      files,
      docs,
    };
    const history = [...messages, userMessage];
    setMessages(history);
    setInput("");
    setImages([]);
    setFiles([]);
    setDocs([]);
    setPack(null);
    setReview(null);
    setBusy(true);
    setError("");
    try {
      await requestTurn(history, progress);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "답변을 반영하지 못했어요.");
    } finally {
      setBusy(false);
    }
  }

  async function addFiles(selected: FileList | null) {
    try {
      const converted = await convertFiles(selected);
      setImages((current) => [...current, ...converted.imgs].slice(0, 3));
      setFiles((current) => [...current, ...converted.pdfs].slice(0, 3));
      setDocs((current) => [...current, ...converted.docs].slice(0, 3));
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function generate(request = "") {
    const revisionMode = Boolean(request.trim() && pack);
    if ((!progress && !revisionMode) || generating) return;
    setGenerating(true);
    setError("");
    track("presentation_outline_generate", { program: program.title });
    try {
      const res = await fetch("/api/plan/presentation/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authedHeaders()) },
        body: JSON.stringify({
          interviewMessages: apiMessages(messages),
          sourceConversation,
          sections,
          claimLedger: claims,
          progress,
          code,
          program,
          evidence,
          strategy,
          reviewStatus: "ready",
          revisionRequest: request,
          serviceConsent: serviceConsentOk,
          provider,
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | {
            pack?: PresentationPack;
            review?: PresentationReview;
            revision?: PresentationRevisionStatus;
            error?: string;
          }
        | null;
      if (!res.ok || !data?.pack || !data.review) {
        throw new Error(data?.error ?? "발표자료 원고를 만들지 못했어요.");
      }
      setPack(data.pack);
      setReview(data.review);
      if (data.revision) {
        setOrderStatus((current) => current ? { ...current, revision: data.revision } : current);
      }
      setRevisionRequest("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "발표자료 원고를 만들지 못했어요.");
    } finally {
      setGenerating(false);
    }
  }

  async function downloadExport(format: "pptx" | "pdf") {
    if (!pack || !review || exporting) return;
    setExporting(format);
    setError("");
    try {
      const res = await fetch("/api/plan/presentation/export", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authedHeaders()) },
        body: JSON.stringify({ code, programId: program.id, format }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "발표자료 파일을 만들지 못했어요.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${safeFileName(pack.title)}.${format}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      track(format === "pptx" ? "presentation_pptx_download" : "presentation_pdf_download", {
        program: program.title,
      });
      await refreshOrderStatus();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "발표자료 파일을 만들지 못했어요.");
    } finally {
      setExporting(null);
    }
  }

  function downloadMarkdown() {
    if (!pack || !review) return;
    const markdown = buildMarkdown(pack, review, sections);
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${safeFileName(pack.title)}.md`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    track("presentation_brief_download", { program: program.title });
  }

  if (!orderStatus) {
    return (
      <section className="rounded-2xl border border-violet-200 bg-violet-50/50 p-4 text-sm text-violet-800">
        발표자료 추가 이용권을 확인하는 중…
      </section>
    );
  }

  const presentationUsable =
    orderStatus.paid &&
    (!orderStatus.usedProgramId || orderStatus.usedProgramId === program.id);
  const cleanedOrder = orderNo.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const orderFormatOk = /^\d{18,19}$/.test(cleanedOrder) || /^PT\d{16}$/.test(cleanedOrder);

  if (!presentationUsable) {
    return (
      <section className="rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 to-white p-5">
        <p className="text-xs font-bold text-violet-700">선택 추가상품 · 사업계획서와 별도 결제</p>
        <h3 className="mt-1 text-lg font-extrabold leading-7 text-zinc-900">
          사업계획서는 완성됐어요.<br />발표평가도 준비해야 하나요?
        </h3>
        <p className="mt-2 text-sm leading-6 text-zinc-700">
          지금까지 작성한 Word·원답변·근거를 그대로 이어받아 부족한 부분만 한 질문씩 확인합니다.
          사업계획서 29,900원에는 포함되지 않는 별도 상품입니다.
        </p>
        <div className="mt-4 overflow-hidden rounded-xl border border-violet-200 bg-white">
          <div className="px-4 py-3">
            <p className="text-sm font-extrabold text-zinc-900">발표자료 추가 · {PRESENTATION_PRICE_LABEL}</p>
            <ul className="mt-2 space-y-1 text-xs leading-5 text-zinc-700">
              <li>✓ 편집 가능한 PPTX와 제출·공유용 PDF</li>
              <li>✓ 슬라이드별 발표 대본과 출처 노트</li>
              <li>✓ 근거 기반 예상 질문·대표자 답변 5개 이상</li>
              <li>✓ 사실·사용자 정보·외부 근거·가설·향후 계획 분리</li>
              <li>✓ 첫 파일 제공 후 30일 이내 묶음 AI 수정 2회</li>
            </ul>
          </div>
          <div className="border-t border-violet-100 bg-violet-50 px-4 py-3 text-xs leading-5 text-violet-900">
            근거 없는 현재 실적·수치가 남으면 PPTX/PDF 생성을 차단합니다.
          </div>
        </div>

        <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] leading-5 text-zinc-700">
          <input
            type="checkbox"
            checked={serviceConsentOk}
            onChange={(event) => setPurchaseConsent(event.target.checked)}
            disabled={Boolean(orderStatus.consentedAt)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-violet-700"
          />
          <span>
            {PRESENTATION_OUTCOME_NOTICE} {PRESENTATION_REVISION_NOTICE} 유료 맞춤 티키타카를 시작한 뒤에는
            관련 법령이 허용하는 범위에서 청약철회가 제한될 수 있음을 확인했습니다.{" "}
            <a href="/refund" target="_blank" rel="noopener noreferrer" className="underline">환불정책 보기</a>
          </span>
        </label>

        {GROBLE_PRESENTATION_CHECKOUT_URL && orderStatus.configured ? (
          <a
            href={GROBLE_PRESENTATION_CHECKOUT_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-disabled={!purchaseConsent}
            onClick={(event) => {
              if (!purchaseConsent) {
                event.preventDefault();
                return;
              }
              track("presentation_checkout_click", { price: PRESENTATION_PRICE_KRW, program: program.title });
            }}
            className={purchaseConsent
              ? "mt-3 block rounded-xl bg-violet-700 py-3.5 text-center text-sm font-bold text-white hover:bg-violet-800"
              : "mt-3 block cursor-not-allowed rounded-xl bg-zinc-300 py-3.5 text-center text-sm font-bold text-white"}
          >
            발표자료 추가 결제 · {PRESENTATION_PRICE_LABEL}
          </a>
        ) : (
          <p className="mt-3 rounded-xl bg-zinc-100 px-3 py-3 text-center text-xs leading-5 text-zinc-600">
            발표자료 그로블 상품 연결 전입니다. 상품 ID와 결제 링크가 연결되면 버튼이 열립니다.
          </p>
        )}

        <div className="mt-3 rounded-xl border border-zinc-200 bg-white p-3">
          <p className="text-xs font-bold text-zinc-700">결제 후 주문번호 연결</p>
          <p className="mt-1 text-[11px] leading-4 text-zinc-500">
            그로블 주문내역의 숫자 18~19자리를 입력하면 이 사업의 발표자료가 열립니다.
          </p>
          <div className="mt-2 flex gap-2">
            <input
              value={orderNo}
              onChange={(event) => setOrderNo(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && orderFormatOk) void verifyPresentationOrder();
              }}
              inputMode="numeric"
              placeholder="주문번호 18~19자리"
              className="min-w-0 flex-1 rounded-xl border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-violet-500"
            />
            <button
              onClick={() => void verifyPresentationOrder()}
              disabled={!orderFormatOk || orderChecking}
              className="rounded-xl bg-violet-700 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
            >
              {orderChecking ? "확인 중…" : "확인"}
            </button>
          </div>
        </div>
        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs leading-5 text-red-700">{error}</p>}
      </section>
    );
  }

  if (!started) {
    return (
      <section className="rounded-2xl border border-violet-200 bg-violet-50/50 p-4">
        <p className="text-xs font-bold text-violet-700">
          {orderStatus.admin
            ? "관리자 검증 모드 · 결제 생략"
            : `결제 확인 완료 · ${orderStatus.source === "bundle" ? "Word+발표자료 묶음" : "발표자료 추가상품"}`}
        </p>
        <h3 className="mt-1 text-base font-extrabold text-zinc-900">사업계획서 다음은 발표자료 티키타카</h3>
        <p className="mt-2 text-sm leading-6 text-zinc-700">
          이미 들려주신 사업 이야기와 근거를 다시 입력할 필요가 없습니다. 빠진 부분만 한 질문씩 더 듣고,
          화면용 핵심 문장·발표 대본·데이터 부록으로 나눠 보존합니다.
        </p>
        <div className="mt-3 grid gap-2 text-xs text-zinc-700 sm:grid-cols-3">
          <div className="rounded-lg bg-white p-2.5">✓ 기존 원답변 자동 연결</div>
          <div className="rounded-lg bg-white p-2.5">✓ 사실·가설·계획 분리</div>
          <div className="rounded-lg bg-white p-2.5">✓ 가짜 실적이면 확정 차단</div>
        </div>
        {!orderStatus.admin && <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] leading-5 text-zinc-700">
          <input
            type="checkbox"
            checked={purchaseConsent}
            onChange={(event) => setPurchaseConsent(event.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-violet-700"
          />
          <span>
            {PRESENTATION_OUTCOME_NOTICE} {PRESENTATION_REVISION_NOTICE} 유료 맞춤 티키타카를 시작하면
            개인화된 디지털콘텐츠 제공이 개시되며 관련 법령이 허용하는 범위에서 청약철회가 제한될 수 있음을 확인했습니다.{" "}
            <a href="/refund" target="_blank" rel="noopener noreferrer" className="underline">환불정책 보기</a>
          </span>
        </label>}
        <button
          onClick={() => void start()}
          disabled={!serviceConsentOk || busy}
          className="mt-4 w-full rounded-xl bg-violet-700 py-3 text-sm font-bold text-white hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          발표자료 티키타카 시작하기 →
        </button>
        <p className="mt-2 text-center text-[10px] leading-4 text-zinc-500">
          PPTX · PDF · 발표자 노트 · 예상 질문과 답변 · 묶음 AI 수정 2회
        </p>
      </section>
    );
  }

  const completed = progress?.completedStageIds.length ?? 0;
  const percent = Math.round((completed / PRESENTATION_STAGE_DEFS.length) * 100);
  return (
    <section className="rounded-2xl border border-violet-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold text-violet-700">발표자료 티키타카</p>
          <h3 className="mt-0.5 text-base font-extrabold text-zinc-900">
            {progress?.stageLabel ?? "기존 자료를 읽는 중"}
          </h3>
        </div>
        <span className="rounded-full bg-violet-100 px-2.5 py-1 text-xs font-bold text-violet-800">
          {completed}/{PRESENTATION_STAGE_DEFS.length}
        </span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-100">
        <div className="h-full rounded-full bg-violet-600 transition-all" style={{ width: `${percent}%` }} />
      </div>

      <div className="mt-4 max-h-80 space-y-2 overflow-y-auto rounded-xl bg-zinc-50 p-3">
        {messages.map((message, index) => (
          <div
            key={`${message.role}-${index}`}
            className={`max-w-[92%] whitespace-pre-wrap rounded-xl px-3 py-2 text-sm leading-6 ${
              message.role === "user"
                ? "ml-auto bg-violet-700 text-white"
                : "mr-auto border border-zinc-200 bg-white text-zinc-700"
            }`}
          >
            {message.content}
            {(message.images?.length || message.files?.length || message.docs?.length) ? (
              <p className={`mt-1 text-[10px] ${message.role === "user" ? "text-violet-100" : "text-zinc-400"}`}>
                첨부 {Number(message.images?.length ?? 0) + Number(message.files?.length ?? 0) + Number(message.docs?.length ?? 0)}개 포함
              </p>
            ) : null}
          </div>
        ))}
        {busy && <div className="mr-auto rounded-xl bg-white px-3 py-2 text-sm text-zinc-500">답변과 자료를 정리하는 중…</div>}
      </div>

      {progress?.coveredSummary && (
        <details className="mt-3 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2">
          <summary className="cursor-pointer text-xs font-bold text-zinc-700">지금까지 담긴 아이디어·데이터</summary>
          <p className="mt-2 text-xs leading-5 text-zinc-600">{progress.coveredSummary}</p>
        </details>
      )}

      {claims.length > 0 && (
        <details className="mt-2 rounded-xl border border-zinc-200 px-3 py-2">
          <summary className="cursor-pointer text-xs font-bold text-zinc-700">주장·근거 장부 {claims.length}개</summary>
          <div className="mt-2 max-h-56 space-y-2 overflow-y-auto">
            {claims.map((claim) => (
              <div key={claim.id} className="rounded-lg bg-zinc-50 p-2 text-xs leading-5 text-zinc-700">
                <span className={`mr-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold ${claimStatusClass(claim)}`}>
                  {claimStatusLabel(claim)}
                </span>
                {claim.text}
                {claim.verificationPlan && <p className="mt-1 text-[10px] text-zinc-500">확인·실행: {claim.verificationPlan}</p>}
              </div>
            ))}
          </div>
        </details>
      )}

      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs leading-5 text-red-700">{error}</p>}

      {!progress?.ready && !pack && (
        <div className="mt-3 rounded-xl border border-zinc-200 p-3">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submit();
              }
            }}
            rows={3}
            placeholder="대표님만 아는 실제 이야기와 숫자를 편하게 답해 주세요."
            className="w-full resize-none text-sm leading-6 outline-none"
          />
          {(images.length > 0 || files.length > 0 || docs.length > 0) && (
            <p className="mt-1 text-[11px] text-violet-700">
              첨부 준비됨 · 사진 {images.length} · PDF {files.length} · 문서 {docs.length}
            </p>
          )}
          <div className="mt-2 flex gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,application/pdf,.pdf,.docx,.hwp,.hwpx,.txt,.md"
              onChange={(event) => void addFiles(event.target.files)}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
              className="rounded-lg border border-zinc-200 px-3 py-2 text-xs font-bold text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
            >
              ＋ 근거자료 첨부
            </button>
            <button
              onClick={() => void submit()}
              disabled={busy || (!input.trim() && images.length === 0 && files.length === 0 && docs.length === 0)}
              className="ml-auto rounded-lg bg-violet-700 px-4 py-2 text-xs font-bold text-white hover:bg-violet-800 disabled:opacity-50"
            >
              답변 보내기
            </button>
          </div>
        </div>
      )}

      {progress?.criticalMissing.length ? (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
          <b>원고 확정 전에 필요한 내용</b>
          <ul className="mt-1 list-disc pl-4">
            {progress.criticalMissing.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      ) : null}

      {progress && !pack && (
        <button
          onClick={() => void generate()}
          disabled={generating}
          className="mt-4 w-full rounded-xl bg-violet-700 py-3 text-sm font-bold text-white hover:bg-violet-800 disabled:opacity-50"
        >
          {generating
            ? "아이디어·데이터를 슬라이드와 대본에 배치하는 중…"
            : progress.ready
              ? "발표자료 원고 만들기 →"
              : "현재 내용으로 발표자료 초안 먼저 만들기 →"}
        </button>
      )}

      {pack && review && (
        <div className="mt-5 border-t border-zinc-100 pt-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-extrabold text-zinc-900">{pack.title}</p>
              <p className="mt-1 text-xs text-zinc-500">{pack.slides.length}장 · {pack.durationMinutes}분 · {pack.audience}</p>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${
              review.exportReady ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"
            }`}>
              {review.score}/100
            </span>
          </div>
          <p className="mt-2 rounded-lg bg-zinc-50 px-3 py-2 text-xs leading-5 text-zinc-700">{review.verdict}</p>
          <div className="mt-3 space-y-2">
            {pack.slides.map((slide, index) => (
              <details key={slide.id} className="rounded-xl border border-zinc-200 p-3" open={index === 0}>
                <summary className="cursor-pointer text-sm font-bold text-zinc-900">
                  {index + 1}. {slide.title}
                </summary>
                <p className="mt-2 text-sm font-semibold leading-6 text-violet-800">{slide.headline}</p>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-5 text-zinc-700">
                  {slide.bullets.map((bullet, bulletIndex) => <li key={`${slide.id}-bullet-${bulletIndex}`}>{bullet}</li>)}
                </ul>
                <p className="mt-2 text-[11px] leading-5 text-zinc-500"><b>발표 대본:</b> {slide.speakerNotes}</p>
                {slide.sourceNotes.length > 0 && (
                  <p className="mt-2 text-[10px] leading-4 text-zinc-400">출처: {slide.sourceNotes.join(" · ")}</p>
                )}
              </details>
            ))}
          </div>
          {pack.qa.length > 0 && (
            <details className="mt-3 rounded-xl border border-violet-200 bg-violet-50/40 p-3">
              <summary className="cursor-pointer text-sm font-bold text-violet-900">
                예상 질문·대표자 답변 {pack.qa.length}개
              </summary>
              <div className="mt-3 space-y-3">
                {pack.qa.map((item, index) => (
                  <div key={item.id} className="rounded-lg bg-white p-3 text-xs leading-5 text-zinc-700">
                    <p className="font-bold text-violet-800">Q{index + 1}. {item.question}</p>
                    <p className="mt-1">{item.answer}</p>
                    {item.risk && <p className="mt-1 text-[10px] text-amber-700">주의: {item.risk}</p>}
                  </div>
                ))}
              </div>
            </details>
          )}
          {review.issues.length > 0 && (
            <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-800">
              <b>발표자료 확정 전 점검</b>
              <ul className="mt-1 list-disc pl-4">
                {review.issues.map((issue, index) => (
                  <li key={`${issue.slideId}-${index}`}>{issue.issue} — {issue.action}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <button
              onClick={() => {
                setPack(null);
                setReview(null);
                setProgress((current) => current ? { ...current, ready: false } : current);
                setInput(review.issues.map((issue) => issue.action).join("\n"));
              }}
              className="rounded-xl border border-zinc-300 bg-white py-2.5 text-xs font-bold text-zinc-700 hover:bg-zinc-50"
            >
              보완 질문 계속하기
            </button>
            <button
              onClick={() => void downloadExport("pptx")}
              disabled={Boolean(exporting)}
              className="rounded-xl bg-violet-700 py-2.5 text-xs font-bold text-white hover:bg-violet-800 disabled:opacity-50"
            >
              {exporting === "pptx"
                ? "PPTX 만드는 중…"
                : review.exportReady
                  ? "편집 가능한 발표자료 받기 (.pptx)"
                  : "현재 내용으로 검토용 발표자료 받기 (.pptx)"}
            </button>
            <button
              onClick={() => void downloadExport("pdf")}
              disabled={Boolean(exporting)}
              className="rounded-xl border border-violet-300 bg-white py-2.5 text-xs font-bold text-violet-800 hover:bg-violet-50 disabled:opacity-50"
            >
              {exporting === "pdf" ? "PDF 만드는 중…" : "제출·공유용 PDF 받기"}
            </button>
            <button
              onClick={downloadMarkdown}
              disabled={Boolean(exporting)}
              className="rounded-xl border border-zinc-300 bg-white py-2.5 text-xs font-bold text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
            >
              발표 대본·근거 백업 (.md)
            </button>
          </div>
          <p className="mt-2 text-center text-[10px] leading-4 text-zinc-500">
            PPTX에는 슬라이드별 발표자 노트와 출처가 들어갑니다. PDF는 제출·공유용이며, 원문 데이터 전체는 백업 파일에 보존됩니다.
          </p>
          {orderStatus.revision?.deliveredAt && (
            <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50/60 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-bold text-blue-900">발표자료 묶음 AI 수정</p>
                <span className="text-[11px] font-bold text-blue-800">
                  {orderStatus.revision.remaining}/{orderStatus.revision.max}회 남음
                </span>
              </div>
              <p className="mt-1 text-[10px] leading-4 text-blue-700">
                {orderStatus.revision.expiresAt?.slice(0, 10)}까지 · 여러 요청을 한 번에 적으면 1회로 반영합니다.
              </p>
              <textarea
                value={revisionRequest}
                onChange={(event) => setRevisionRequest(event.target.value)}
                rows={3}
                placeholder="예: 4번 슬라이드의 고객 문제를 더 구체적으로, Q&A에는 가격 근거 질문을 추가해 주세요."
                className="mt-2 w-full resize-none rounded-lg border border-blue-200 bg-white p-2 text-xs leading-5 outline-none focus:border-blue-500"
              />
              <button
                onClick={() => void generate(revisionRequest)}
                disabled={
                  generating ||
                  !revisionRequest.trim() ||
                  orderStatus.revision.expired ||
                  orderStatus.revision.remaining <= 0
                }
                className="mt-2 w-full rounded-lg bg-blue-700 py-2.5 text-xs font-bold text-white disabled:opacity-50"
              >
                {generating ? "묶음 수정 반영 중…" : "수정 요청 전체 반영하기"}
              </button>
            </div>
          )}
          {!orderStatus.revision?.deliveredAt && review.exportReady && (
            <p className="mt-3 rounded-lg bg-zinc-50 px-3 py-2 text-center text-[10px] leading-4 text-zinc-500">
              첫 PPTX 또는 PDF를 받은 날부터 30일·묶음 수정 2회가 시작됩니다.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
