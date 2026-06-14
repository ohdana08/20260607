import { Redis } from "@upstash/redis";

// ── [기능 3] 후기 시스템 — 저장소 교체형 어댑터 ───────────────────────────
// GAS_WEBHOOK_URL 이 있으면 구글시트(GAS)에 저장/조회, 없으면 Upstash Redis로 폴백.
// → 운영은 시트(사람이 직접 공개 승인·실명 마스킹·합격후기 CRM), 개발은 설정 없이 즉시.
// 코드 재작성 없이 환경변수만으로 전환된다. (업무지시서 v2 — 4장)

export interface ReviewInput {
  rating: number; // 1~5
  tags: string[]; // 선택태그(복수)
  comment: string; // 한줄평 (선택)
  publicConsent: boolean; // 홈페이지 공개 동의
  bizField: string; // 사업분야 (예: 예비창업패키지 준비)
  name?: string; // 이름(공개 시 "김○○"로 마스킹해 노출)
}

export interface PublicReview {
  rating: number;
  tags: string[];
  comment: string;
  bizField: string;
  displayName: string; // 마스킹된 이름 (예: 김○○)
  timestamp: number;
}

// "홍길동" → "홍○○", "김철" → "김○", "Lee" → "L○○" (실명 일부만 노출)
export function maskName(name: string | undefined): string {
  const n = (name ?? "").trim();
  if (!n) return "익명";
  const first = Array.from(n)[0];
  const rest = Array.from(n).length - 1;
  return first + "○".repeat(Math.max(1, rest));
}

// ── Upstash 폴백 구현 ──────────────────────────────────────────────────
let redis: Redis | null = null;
function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  if (!redis) redis = new Redis({ url, token });
  return redis;
}

const REVIEW_LIST = "gp:reviews"; // 전체 후기 (JSON 문자열 리스트)
interface StoredReview extends ReviewInput {
  timestamp: number;
}

function gasUrl(): string | null {
  return process.env.GAS_WEBHOOK_URL || null;
}

// 후기 저장
export async function saveReview(input: ReviewInput): Promise<boolean> {
  const record: StoredReview = { ...input, timestamp: Date.now() };

  const url = gasUrl();
  if (url) {
    // GAS 웹훅으로 전송 (구글시트에 한 줄 append)
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "review",
          _token: process.env.GAS_TOKEN ?? "", // GAS Script Property REVIEW_TOKEN 과 매칭(선택)
          timestamp: new Date(record.timestamp).toISOString(),
          rating: record.rating,
          tags: record.tags.join(", "),
          comment: record.comment,
          publicConsent: record.publicConsent ? "Y" : "N",
          bizField: record.bizField,
          name: record.name ?? "",
        }),
      });
      return res.ok;
    } catch (err) {
      console.error("[reviews] GAS save failed", err);
      return false;
    }
  }

  // 폴백: Upstash Redis
  const r = getRedis();
  if (!r) return false;
  await r.rpush(REVIEW_LIST, JSON.stringify(record));
  return true;
}

// 공개 후기 목록 + 전체 개수 (홈페이지 노출 5건 이상 게이트에 사용)
export async function getPublicReviews(): Promise<{ count: number; reviews: PublicReview[] }> {
  const url = gasUrl();
  if (url) {
    try {
      // GAS doGet: ?type=reviews → { count, reviews:[{rating,tags,comment,bizField,name,timestamp}] }
      const token = process.env.GAS_TOKEN ? `&_token=${encodeURIComponent(process.env.GAS_TOKEN)}` : "";
      const res = await fetch(`${url}?type=reviews${token}`, { cache: "no-store" });
      if (!res.ok) return { count: 0, reviews: [] };
      const data = (await res.json()) as {
        count?: number;
        reviews?: Array<{
          rating?: number;
          tags?: string;
          comment?: string;
          bizField?: string;
          name?: string;
          timestamp?: string | number;
        }>;
      };
      const reviews = (data.reviews ?? []).map((x) => ({
        rating: Number(x.rating) || 0,
        tags: (x.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean),
        comment: x.comment ?? "",
        bizField: x.bizField ?? "",
        displayName: maskName(x.name),
        timestamp: typeof x.timestamp === "number" ? x.timestamp : Date.parse(String(x.timestamp)) || 0,
      }));
      return { count: Number(data.count) || reviews.length, reviews };
    } catch (err) {
      console.error("[reviews] GAS read failed", err);
      return { count: 0, reviews: [] };
    }
  }

  // 폴백: Upstash Redis
  const r = getRedis();
  if (!r) return { count: 0, reviews: [] };
  const raw = await r.lrange<string | StoredReview>(REVIEW_LIST, 0, -1);
  const all: StoredReview[] = raw.map((x) => (typeof x === "string" ? JSON.parse(x) : x));
  const publicOnes = all
    .filter((x) => x.publicConsent)
    .sort((a, b) => b.timestamp - a.timestamp)
    .map((x) => ({
      rating: x.rating,
      tags: x.tags,
      comment: x.comment,
      bizField: x.bizField,
      displayName: maskName(x.name),
      timestamp: x.timestamp,
    }));
  // count: 전체 후기 수(노출 게이트는 '쌓인 후기'가 기준). 공개 동의분만 reviews로 노출.
  return { count: all.length, reviews: publicOnes };
}
