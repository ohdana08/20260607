// BCC 통합 회원 시스템(bcc-homepage 회원가입결제시스템)의 Supabase 프로젝트.
// 두 값 모두 "공개" 값이다 — bcc-homepage /api/config 가 모든 브라우저에 내려주는 값과 동일
// (anon 키는 RLS로 보호되는 공개 키). service_role 은 절대 여기에 두지 않는다.
export const AUTH_URL = "https://jhjxrkypnigcohgnzhvq.supabase.co";
export const AUTH_ANON_KEY = "sb_publishable_24zMJ7No-ikaGOhZE3BubA_nInm0Hok";

// 회원가입은 bcc-homepage 의 기존 /api/signup 을 그대로 재사용한다(프록시 경유).
// pending 계정 병합·동의 기록·profiles 생성 로직이 거기에 이미 있다.
export const SIGNUP_UPSTREAM = "https://bcc-homepage.vercel.app/api/signup";
