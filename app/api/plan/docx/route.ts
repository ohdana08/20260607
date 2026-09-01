import { checkDraftAccess, paymentRequiredResponse } from "@/lib/plan/paidAccess";
import { buildPlanDocxBuffer, type PlanDocxChart, type PlanDocxSection } from "@/lib/plan/docx";
import {
  getAuditArtifact,
  getEvidencePack,
  getStrategyPack,
  planArtifactDigest,
  planSectionsDigest,
} from "@/lib/plan/artifacts";
import { countDraftPlaceholders } from "@/lib/plan/reviewer";
import { markFirstFinalDelivery } from "@/lib/plan/revisions";
import type { EvidenceSource } from "@/lib/plan/strategy";
import { buildCharts } from "@/lib/viz/svg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "요청을 읽지 못했어요." }, { status: 400 });
  }

  const { code, programId, title, sections, charts, reviewStatus, acknowledgements } = (body ?? {}) as {
    code?: string;
    programId?: string;
    title?: string;
    sections?: PlanDocxSection[];
    charts?: PlanDocxChart[];
    reviewStatus?: string;
    acknowledgements?: {
      reviewedIssues?: boolean;
      factsConfirmed?: boolean;
      outcomeUnderstood?: boolean;
      revisionPolicyUnderstood?: boolean;
    };
  };

  // 유료 관문(2026-07-09): 주문번호 인증(is_paid) 또는 마스터 코드
  const access = await checkDraftAccess(req, code, programId);
  if (!access.ok) return paymentRequiredResponse(access.reason);
  if (!Array.isArray(sections) || sections.length === 0) {
    return Response.json({ error: "내보낼 내용이 없어요." }, { status: 400 });
  }
  const acknowledged =
    acknowledgements?.reviewedIssues === true &&
    acknowledgements?.factsConfirmed === true &&
    acknowledgements?.outcomeUnderstood === true &&
    acknowledgements?.revisionPolicyUnderstood === true;
  if (!acknowledged) {
    return Response.json(
      { error: "제출 전 근거·사실·선정 비보장·수정 범위 안내를 모두 확인해 주세요." },
      { status: 409 },
    );
  }
  const placeholderCounts = countDraftPlaceholders(sections);
  if (placeholderCounts.missing > 0 || placeholderCounts.proof > 0) {
    return Response.json(
      { error: "보완 필요 또는 증빙 필요 표시가 남아 있어 최종 Word를 만들 수 없어요." },
      { status: 409 },
    );
  }

  let safeCharts = (charts ?? []).slice(0, 6);
  let evidenceSources: EvidenceSource[] = [];
  if (access.user) {
    const [audit, evidence, strategy] = await Promise.all([
      getAuditArtifact(access.user.id),
      getEvidencePack(access.user.id),
      getStrategyPack(access.user.id),
    ]);
    if (!audit || !evidence || !strategy || audit.report.status !== "ready" || !audit.report.submissionReady) {
      return Response.json(
        { error: "최신 초안의 필수 근거 검토를 통과한 뒤 Word를 내려받을 수 있어요." },
        { status: 409 },
      );
    }
    if (audit.sectionsDigest !== planSectionsDigest(sections)) {
      return Response.json(
        { error: "심사 이후 초안이 변경됐어요. 최신 내용으로 다시 심사해 주세요." },
        { status: 409 },
      );
    }
    if (
      audit.evidenceDigest !== planArtifactDigest(evidence) ||
      audit.strategyDigest !== planArtifactDigest(strategy)
    ) {
      return Response.json(
        { error: "심사 이후 근거 또는 전략이 변경됐어요. 최신 내용으로 다시 심사해 주세요." },
        { status: 409 },
      );
    }
    evidenceSources = evidence.sources.filter((source) => source.verified);
    safeCharts = await buildCharts(strategy.diagrams);
  } else if (reviewStatus !== "ready") {
    return Response.json({ error: "최종 심사 결과가 제출 가능 상태가 아니에요." }, { status: 409 });
  }

  const buffer = await buildPlanDocxBuffer(title, sections, safeCharts, evidenceSources);
  const revision = access.user ? await markFirstFinalDelivery(access.user.id) : null;

  const filename = encodeURIComponent(`${title || "사업계획서"}.docx`);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="plan.docx"; filename*=UTF-8''${filename}`,
      "Cache-Control": "no-store",
      ...(revision
        ? {
            "X-Revision-Remaining": String(revision.remaining),
            "X-Revision-Expires-At": revision.expiresAt ?? "",
          }
        : {}),
    },
  });
}
