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
