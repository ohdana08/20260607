import { checkRateLimit, tooManyRequests } from "@/lib/ratelimit";
import { extractHwpText } from "@/lib/hwp/extractHwp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_BYTES = 3 * 1024 * 1024;

// 브라우저에서 구형 HWP 파서가 깨지는 문제를 피하기 위해 서버에서 안전하게 텍스트만 추출한다.
export async function POST(req: Request) {
  const rl = await checkRateLimit(req, "fitcheck");
  if (!rl.ok) return tooManyRequests(rl.retryAfter);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ ok: false, error: "파일 요청을 읽지 못했어요." }, { status: 400 });
  }
  const uploaded = form.get("file");
  if (!(uploaded instanceof File)) {
    return Response.json({ ok: false, error: "한글 파일을 선택해 주세요." }, { status: 400 });
  }
  if (!uploaded.name.toLowerCase().endsWith(".hwp")) {
    return Response.json({ ok: false, error: ".hwp 파일만 처리할 수 있어요." }, { status: 400 });
  }
  if (uploaded.size === 0 || uploaded.size > MAX_FILE_BYTES) {
    return Response.json({ ok: false, error: "한글 파일은 3MB 이하만 가능해요." }, { status: 413 });
  }

  try {
    const text = await extractHwpText(await uploaded.arrayBuffer());
    if (text.trim().length < 30) {
      return Response.json(
        { ok: false, error: "파일에서 충분한 글자를 찾지 못했어요. 암호나 배포용 문서인지 확인해 주세요." },
        { status: 422 },
      );
    }
    return Response.json({ ok: true, text: text.slice(0, 50_000) });
  } catch (error) {
    console.warn("[files/extract] HWP parse failed", error instanceof Error ? error.message : "unknown");
    return Response.json(
      { ok: false, error: "한글 파일을 읽지 못했어요. 파일이 손상됐거나 암호가 설정됐는지 확인해 주세요." },
      { status: 422 },
    );
  }
}
