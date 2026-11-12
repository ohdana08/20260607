import type { Program } from "../match/types.ts";
import type { EntrySummary } from "./types.ts";
import { entryDate } from "./match.ts";

export const CHECK_NOTICE = "공고문 확인";
export function plainEntryText(text: string, limit = 180): string {
  return text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, limit);
}
export function verifiedEntryAmount(p: Program): string {
  const text = plainEntryText(`${p.title} ${p.summary}`, 600);
  // Only an explicit per-recipient ceiling is a maximum benefit; a programme's
  // total budget, average subsidy, loan balance or unlabelled amount is not one.
  const found = text.match(/(?:기업|업체|개사|인|사업자)\s*(?:당|별)\s*(?:지원(?:금|한도)?\s*)?(?:최대|한도)\s*([\d,]+(?:\.\d+)?\s*(?:억|천만|백만|만)?\s*원)/);
  return found ? `최대 ${found[1].replace(/\s+/g, "")}` : CHECK_NOTICE;
}
export function sourceEntrySummary(p: Program): EntrySummary {
  return {
    who: plainEntryText(p.target) || CHECK_NOTICE,
    amount: verifiedEntryAmount(p), deadline: entryDate(p.applyEnd) ?? CHECK_NOTICE,
    description: plainEntryText(p.summary, 140) || "지원 내용과 신청 방법을 원문에서 확인하세요.", sourceUrl: p.url,
  };
}
/** Model may simplify prose only. Money/date/link are always source-derived. */
export function validateEntrySummary(p: Program, value: unknown): EntrySummary {
  const fallback = sourceEntrySummary(p);
  if (!value || typeof value !== "object") return fallback;
  const v = value as Record<string, unknown>;
  // Reject unverified numbers/links in generated prose; source labels retain all
  // eligibility detail, so the model cannot silently broaden who qualifies.
  const description = typeof v.description === "string" ? plainEntryText(v.description, 140) : "";
  return { ...fallback, description: description && !/[0-9]|https?:|최대|보장|확정|누구나/.test(description) ? description : fallback.description };
}
