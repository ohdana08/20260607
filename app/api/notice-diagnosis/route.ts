import { googleLoginGate } from "@/lib/auth/googleUser";
import { maintenanceGate } from "@/lib/config";
import { checkRateLimit, tooManyRequests } from "@/lib/ratelimit";
import { readNotice } from "@/lib/notice/read";
import { documentText } from "@/lib/notice/documents";
import { makeQuestions, diagnose } from "@/lib/notice/analyze";
import type { Question, EvidenceFile } from "@/lib/notice/types";

export const runtime = "nodejs";
export const maxDuration = 120;
function string(v: unknown, max: number): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= max;
}
function bad(error: string, status = 400) {
  return Response.json({ error }, { status });
}
export async function POST(req: Request) {
  const gate = maintenanceGate() || (await googleLoginGate(req));
  if (gate) return gate;
  const limit = await checkRateLimit(req, "fitcheck");
  if (!limit.ok) return tooManyRequests(limit.retryAfter, limit.unavailable);
  try {
    if (req.headers.get("content-type")?.startsWith("multipart/form-data")) {
      const f = (await req.formData()).get("file");
      if (!(f instanceof File) || !f.size || f.size > 3 * 1024 * 1024)
        return bad("파일은 각 3MB 이내로 올려 주세요.", 413);
      const text = await documentText(
        f.name,
        new Uint8Array(await f.arrayBuffer()),
        true,
      );
      return Response.json({ name: f.name, text });
    }
    const body = await req.json();
    if (body?.action === "import" && string(body.url, 4096)) {
      const notice = await readNotice(body.url);
      const groups = await makeQuestions(notice.sources);
      return Response.json({
        ...notice,
        sources: notice.sources.map((s) => s.name),
        groups,
      });
    }
    const { questions, answers, files, title, group } = body || {};
    if (
      body?.action !== "diagnose" ||
      !string(title, 250) ||
      !string(group, 250) ||
      !Array.isArray(questions) ||
      !questions.length ||
      questions.length > 6 ||
      !questions.every(
        (q: Question) =>
          q &&
          string(q.prompt, 600) &&
          string(q.source, 512) &&
          string(q.quote, 1200),
      ) ||
      !Array.isArray(answers) ||
      answers.length !== questions.length ||
      !answers.every((a) => string(a, 2000)) ||
      !Array.isArray(files) ||
      files.length > 12 ||
      !files.every(
        (f: EvidenceFile) => f && string(f.name, 512) && string(f.text, 24000) &&
          (f.questionIndex === undefined || (Number.isInteger(f.questionIndex) && f.questionIndex >= 0 && f.questionIndex < questions.length)),
      )
    )
      return bad("답변이나 자료를 확인해 주세요.");
    return Response.json(
      await diagnose(questions, answers, files, title, group),
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    return bad(
      /^[가-힣]/.test(msg)
        ? msg
        : "자료를 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      422,
    );
  }
}
