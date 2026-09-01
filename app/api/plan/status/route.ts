import { getAuthedUser, getPaidRecord } from "@/lib/plan/paidAccess";
import { getOrderAiSpendKrw } from "@/lib/plan/aiBudget";
import { configuredPlanAiHardCapKrw, PLAN_OUTCOME_NOTICE, PLAN_REVISION_NOTICE } from "@/lib/plan/productPolicy";
import { getRevisionStatus } from "@/lib/plan/revisions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getAuthedUser(req);
  if (!user) return Response.json({ error: "로그인이 필요해요." }, { status: 401 });
  const paid = await getPaidRecord(user.id);
  if (!paid) return Response.json({ paid: false }, { headers: { "Cache-Control": "no-store" } });
  const [revision, aiSpendKrw] = await Promise.all([
    getRevisionStatus(user.id),
    getOrderAiSpendKrw(user.id),
  ]);
  return Response.json(
    {
      paid: true,
      usedProgramId: paid.usedProgramId ?? null,
      revision,
      aiCost: { spentKrw: aiSpendKrw, hardCapKrw: configuredPlanAiHardCapKrw() },
      notices: { outcome: PLAN_OUTCOME_NOTICE, revision: PLAN_REVISION_NOTICE },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
