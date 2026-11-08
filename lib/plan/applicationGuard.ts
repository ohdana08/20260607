import type { Program } from "@/lib/match/types";
import { classifyApplicationKind } from "@/lib/match/buttonFilter";

export interface DraftApplicationDecision {
  ok: boolean;
  applicationKind: Program["applicationKind"];
  requiresBusinessPlan: boolean | null;
  reason: string;
}

export function decideDraftApplication(
  input: Partial<Program> | null | undefined,
  documentConfirmed = false,
): DraftApplicationDecision {
  if (!input) {
    return {
      ok: false,
      applicationKind: "unknown",
      requiresBusinessPlan: null,
      reason: "선택한 공고 정보가 없습니다.",
    };
  }
  const program: Program = {
    id: input.id ?? "unknown",
    title: input.title ?? "",
    summary: input.summary ?? "",
    target: input.target ?? "",
    supportField: input.supportField ?? "",
    region: input.region ?? "",
    applyEnd: input.applyEnd ?? null,
    url: input.url ?? "",
    formUrl: input.formUrl ?? null,
    source: input.source ?? "sample",
    applicationKind: input.applicationKind,
    requiresBusinessPlan: input.requiresBusinessPlan,
    applicationKindReason: input.applicationKindReason,
  };
  const result = classifyApplicationKind(program);
  // 2026-11-08: 사용자가 안내문·작성 양식·기존 초안을 직접 올렸으면 그 문서가 AI 제출유형 판정보다 우선한다.
  // (AI가 공고를 간단 신청으로 추정해 false를 내도, 실제 양식을 가진 사용자의 결제·작성을 막지 않는다.)
  if (documentConfirmed) {
    return {
      ok: true,
      applicationKind: "business-plan",
      requiresBusinessPlan: true,
      reason:
        result.requiresBusinessPlan === false
          ? "AI 판정은 간단 신청이었지만, 업로드한 안내문·작성 양식을 우선해 사업계획서 제출로 처리합니다."
          : "업로드한 작성 양식 또는 이미 생성된 사업계획서 목차에서 제출 문서를 확인했습니다.",
    };
  }
  return {
    ok: result.requiresBusinessPlan === true,
    applicationKind: result.applicationKind,
    requiresBusinessPlan: result.requiresBusinessPlan,
    reason: result.applicationKindReason,
  };
}

export function draftApplicationError(decision: DraftApplicationDecision): Response {
  const error =
    decision.requiresBusinessPlan === false
      ? "이 공고는 사업계획서 유료 초안 대상이 아닙니다. 공고 원문에서 간단 신청을 진행해 주세요."
      : "사업계획서가 실제 제출서류인지 아직 확인되지 않았습니다. 무료 공고 분석에서 원문·양식을 먼저 확인해 주세요.";
  return Response.json(
    { error, applicationKind: decision.applicationKind, reason: decision.reason },
    { status: 409 },
  );
}
