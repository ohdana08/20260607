import { paidGoogleLoginGate } from "@/lib/auth/googleUser";
import {
  getAuditArtifact,
  getEvidencePack,
  getPresentationArtifact,
  getStrategyPack,
  planArtifactDigest,
} from "@/lib/plan/artifacts";
import {
  checkPresentationAccess,
  presentationPaymentRequiredResponse,
} from "@/lib/plan/presentationAccess";
import {
  buildPresentationPdfBuffer,
  buildPresentationPptxBuffer,
} from "@/lib/plan/presentationExport";
import { markFirstPresentationDelivery } from "@/lib/plan/presentationRevisions";
import { buildCharts } from "@/lib/viz/svg";
import { verifiedEvidenceIds } from "@/lib/plan/strategy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function safeFileName(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim().slice(0, 100) || "발표자료";
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "요청을 읽지 못했어요." }, { status: 400 });
  }
  const { code, programId, format } = (body ?? {}) as {
    code?: string;
    programId?: string;
    format?: "pptx" | "pdf";
  };
  const selectedFormat = format === "pdf" ? "pdf" : "pptx";
  const loginGate = await paidGoogleLoginGate(req, code);
  if (loginGate) return loginGate;
  const access = await checkPresentationAccess(req, code, programId);
  if (!access.ok) return presentationPaymentRequiredResponse(access.reason);
  if (!access.user) {
    return Response.json(
      { error: "운영 검수 모드에서는 저장된 발표자료가 없어 파일 내보내기를 생략합니다." },
      { status: 409 },
    );
  }
  if (!access.admin && !access.paid?.consentedAt) {
    return Response.json(
      { error: "발표자료 유료 맞춤 작성 범위와 환불정책을 먼저 확인해 주세요." },
      { status: 409 },
    );
  }

  const [artifact, audit, evidence, strategy] = await Promise.all([
    getPresentationArtifact(access.user.id, access.admin),
    getAuditArtifact(access.user.id, access.admin),
    getEvidencePack(access.user.id, access.admin),
    getStrategyPack(access.user.id, access.admin),
  ]);
  if (!artifact) {
    return Response.json(
      { error: "발표자료 원고를 먼저 만들어 주세요." },
      { status: 409 },
    );
  }
  const fresh =
    audit !== null &&
    evidence &&
    strategy &&
    artifact.sectionsDigest === audit.sectionsDigest &&
    artifact.evidenceDigest === planArtifactDigest(evidence) &&
    artifact.strategyDigest === planArtifactDigest(strategy);
  if (!fresh || !strategy) {
    return Response.json(
      { error: "사업계획서·근거·전략이 발표자료 생성 뒤 변경됐어요. 최신 내용으로 다시 만들어 주세요." },
      { status: 409 },
    );
  }

  const charts = await buildCharts(strategy.diagrams, verifiedEvidenceIds(evidence));
  const buffer = selectedFormat === "pdf"
    ? await buildPresentationPdfBuffer(artifact.pack, charts)
    : await buildPresentationPptxBuffer(artifact.pack, charts);
  const revision = artifact.review.exportReady
    ? await markFirstPresentationDelivery(access.user.id, access.admin)
    : null;
  const title = safeFileName(artifact.pack.title);
  const filename = encodeURIComponent(`${title}.${selectedFormat}`);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        selectedFormat === "pdf"
          ? "application/pdf"
          : "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Disposition": `attachment; filename="presentation.${selectedFormat}"; filename*=UTF-8''${filename}`,
      "Cache-Control": "no-store",
      ...(revision
        ? {
            "X-Presentation-Revision-Remaining": String(revision.remaining),
            "X-Presentation-Revision-Expires-At": revision.expiresAt ?? "",
          }
        : {}),
    },
  });
}
