import { createClient } from "@supabase/supabase-js";

// ⚠️ 서버 전용. service_role 은 RLS를 우회하는 마스터 키다.
//    - NEXT_PUBLIC_ 접두사가 없으므로 브라우저 번들에 포함되지 않는다.
//    - 클라이언트 컴포넌트에서 절대 import 하지 말 것 (route handler에서만 사용).
//    - BCC CRM(bcc-admin)과 같은 Supabase 프로젝트의 leads 테이블에 쓴다.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "Supabase admin 환경변수 누락: SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_URL",
    );
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
