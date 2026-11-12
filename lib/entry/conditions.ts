export const ENTRY_AGES = ["under_30", "30_39", "40_49", "50_plus"] as const;
export const ENTRY_REGIONS = ["서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종", "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주"] as const;
export const ENTRY_BUSINESSES = ["pre", "under_3", "3_7", "over_7"] as const;
export const ENTRY_INDUSTRIES = ["tech", "manufacturing", "food", "retail", "service", "other"] as const;
export interface EntryConditions {
  age: typeof ENTRY_AGES[number];
  region: typeof ENTRY_REGIONS[number];
  business: typeof ENTRY_BUSINESSES[number];
  industry: typeof ENTRY_INDUSTRIES[number];
}
export function parseEntryConditions(value: unknown): EntryConditions | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const includes = (options: readonly string[], input: unknown) => typeof input === "string" && options.includes(input);
  if (!includes(ENTRY_AGES, v.age) || !includes(ENTRY_REGIONS, v.region) || !includes(ENTRY_BUSINESSES, v.business) || !includes(ENTRY_INDUSTRIES, v.industry)) return null;
  return { age: v.age, region: v.region, business: v.business, industry: v.industry } as EntryConditions;
}
