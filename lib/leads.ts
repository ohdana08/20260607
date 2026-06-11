import { Redis } from "@upstash/redis";

// 가벼운 회원(리드) + 관심사업 캘린더 저장 — 기존 Upstash Redis 재사용(별도 DB 불필요).
let redis: Redis | null = null;
function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  if (!redis) redis = new Redis({ url, token });
  return redis;
}

export interface Lead {
  id: string;
  name: string;
  contact: string;
  createdAt: number;
}

export interface SavedProgram {
  id: string;
  title: string;
  applyEnd: string | null; // YYYY-MM-DD
  url: string;
  supportField: string;
  region: string;
  savedAt: number;
}

const LEAD = (id: string) => `gp:lead:${id}`;
const SAVED = (id: string) => `gp:saved:${id}`;
const LEAD_SET = "gp:leads";

export async function createLead(name: string, contact: string): Promise<Lead | null> {
  const r = getRedis();
  if (!r) return null;
  const id = crypto.randomUUID();
  const lead: Lead = { id, name: name.trim(), contact: contact.trim(), createdAt: Date.now() };
  await r.set(LEAD(id), lead);
  await r.sadd(LEAD_SET, id);
  return lead;
}

export async function getLead(id: string): Promise<Lead | null> {
  const r = getRedis();
  if (!r || !id) return null;
  return (await r.get<Lead>(LEAD(id))) ?? null;
}

export async function saveProgram(leadId: string, p: Omit<SavedProgram, "savedAt">): Promise<boolean> {
  const r = getRedis();
  if (!r || !(await r.exists(LEAD(leadId)))) return false;
  await r.hset(SAVED(leadId), { [p.id]: { ...p, savedAt: Date.now() } });
  return true;
}

export async function removeProgram(leadId: string, programId: string): Promise<void> {
  const r = getRedis();
  if (!r) return;
  await r.hdel(SAVED(leadId), programId);
}

export async function listSaved(leadId: string): Promise<SavedProgram[]> {
  const r = getRedis();
  if (!r || !leadId) return [];
  const all = await r.hgetall<Record<string, SavedProgram>>(SAVED(leadId));
  if (!all) return [];
  return Object.values(all).sort((a, b) => {
    // 마감 가까운 순(없으면 뒤로)
    const ax = a.applyEnd ?? "9999-99-99";
    const bx = b.applyEnd ?? "9999-99-99";
    return ax.localeCompare(bx);
  });
}

// 운영자용: 수집된 리드 전체 목록
export async function listAllLeads(): Promise<Lead[]> {
  const r = getRedis();
  if (!r) return [];
  const ids = await r.smembers(LEAD_SET);
  if (!ids || ids.length === 0) return [];
  const leads = await Promise.all(ids.map((id) => r.get<Lead>(LEAD(id))));
  return leads
    .filter((l): l is Lead => Boolean(l))
    .sort((a, b) => b.createdAt - a.createdAt);
}
