import { isMasterCode } from "@/lib/plan/access";
import { listAllLeads } from "@/lib/leads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 운영자(사장님)가 수집된 회원 정보를 보는 곳. 마스터 코드로 보호.
export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get("key") ?? "";
  if (!isMasterCode(key)) {
    return Response.json({ error: "권한이 없어요." }, { status: 403 });
  }
  const leads = await listAllLeads();
  return Response.json({ count: leads.length, leads });
}
