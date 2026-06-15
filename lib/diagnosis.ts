import { Redis } from "@upstash/redis";

// ── 진단 리드(이메일+동의) 저장 & 진단 보고서 메일 발송 — GAS+Gmail 어댑터 ──
// 이메일/동의 데이터는 구글시트(GAS)에만 저장한다. 비밀번호는 받지 않는다.
// 보고서 발송도 같은 GAS(MailApp/Gmail)에서 처리한다.
//   - GAS_DIAGNOSIS_URL: 진단 리드 시트 + Gmail 발송용 GAS 웹앱 URL
//   - GAS_TOKEN(선택): GAS Script Property와 매칭해 외부 스팸 차단
// GAS URL이 없으면: 캡처는 Upstash로 폴백(개발용), 메일 발송은 불가(sent=false).

export interface EmailCapture {
  email: string;
  privacyConsent: boolean; // (필수) 개인정보 수집·이용 동의
  marketingConsent: boolean; // (선택) 마케팅 수신 동의
  weaknessSummary?: string; // 진단 약점 요약(진단 후 채워짐)
}

function gasUrl(): string | null {
  return process.env.GAS_DIAGNOSIS_URL || null;
}
function token(): string {
  return process.env.GAS_TOKEN ?? "";
}

let redis: Redis | null = null;
function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const t = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !t) return null;
  if (!redis) redis = new Redis({ url, token: t });
  return redis;
}

// 이메일 형식 최소 검증 (서버에서도 한 번 더)
export function isEmail(x: unknown): x is string {
  return typeof x === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x.trim());
}

// 진단 시작 전: 이메일 + 동의 저장
export async function saveEmailCapture(c: EmailCapture): Promise<boolean> {
  const url = gasUrl();
  if (url) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "email_capture",
          _token: token(),
          timestamp: new Date().toISOString(),
          email: c.email.trim().toLowerCase(),
          privacyConsent: c.privacyConsent ? "Y" : "N",
          marketingConsent: c.marketingConsent ? "Y" : "N",
          weaknessSummary: c.weaknessSummary ?? "",
        }),
      });
      return res.ok;
    } catch (err) {
      console.error("[diagnosis] GAS capture failed", err);
      return false;
    }
  }
  // 폴백: Upstash (개발/초기). 운영은 GAS 시트 사용 권장.
  const r = getRedis();
  if (!r) return false;
  await r.rpush(
    "gp:diag_leads",
    JSON.stringify({ ...c, email: c.email.trim().toLowerCase(), timestamp: Date.now() }),
  );
  return true;
}

// 진단 후: 약점요약 갱신 + 전체 보고서 Gmail 발송 (Word .docx 첨부)
export async function sendReportEmail(args: {
  email: string;
  fullReportText: string;
  weaknessSummary: string;
  docxBase64?: string; // 있으면 GAS가 진단보고서.docx 로 첨부
}): Promise<boolean> {
  const url = gasUrl();
  if (!url) {
    // 메일 발송은 GAS 없이는 불가. (Upstash 폴백은 저장만, 발송 X)
    // TODO: 확인필요 - GAS_DIAGNOSIS_URL 미설정 시 발송 경로(n8n 등) 연결
    console.warn("[diagnosis] GAS_DIAGNOSIS_URL 미설정 — 보고서 메일 발송 생략");
    return false;
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "report",
        _token: token(),
        timestamp: new Date().toISOString(),
        email: args.email.trim().toLowerCase(),
        weaknessSummary: args.weaknessSummary,
        fullReportText: args.fullReportText,
        docxBase64: args.docxBase64 ?? "",
      }),
    });
    if (!res.ok) return false;
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; sent?: boolean };
    return data.sent ?? data.ok ?? true;
  } catch (err) {
    console.error("[diagnosis] GAS report send failed", err);
    return false;
  }
}
