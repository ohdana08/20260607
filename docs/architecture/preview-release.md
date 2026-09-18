# 딱지원핏 격리 Preview 승격 관문 — 2026-09-18

## 현재 판정

후보 `d4f7dd2`를 격리 Preview에서 검증했다. Google 관리자 저장·충돌 검증에 이어 일반 사용자 403, 합성 범위 백업·격리 복원, 합성 503의 BCC Slack 실제 수신, 정상 복구 200을 확인했다. **Preview 승격 관문은 통과했다. 운영 배포와 Git 원격 push는 하지 않았다.**

- 고정 Preview: https://ddakfit-operations-preview.vercel.app/operations
- 최종 정상 Deployment: `dpl_2rR3tBQYCr22yuoYG5JsiAoD52Vw`
- 최종 Deployment URL: https://20260607-2gd7880ub-jinjoos-projects.vercel.app
- 제품 커밋: `d4f7dd2`
- Supabase migration: `operations_postgres_rpc`

## 저장소와 권한

운영 기록은 기존 BCC Supabase 프로젝트의 전용 private schema에 저장한다. 브라우저 JWT, Preview scope의 UUID 허용 목록, 고엔트로피 capability의 SHA-256을 RPC 안에서 모두 확인한다. `anon`은 RPC를 실행할 수 없고 `authenticated`는 private schema와 표를 직접 읽을 수 없다. 쓰기는 `(scope_id, month, revision)` 조건부 갱신이며 자동 재시도하지 않는다.

서비스 역할 키와 결제 Redis credential은 Preview에 넣지 않았다. DB는 문서 크기 1 MiB, 배열 수, 숫자·문자열 길이, 날짜, URL, 상태 enum을 검증하고 감사 actor·시각·revision은 DB가 만든다. CAS 잠금 대기는 500ms, 앱의 Auth 대기는 2초, RPC 대기는 3초다.

## 실제 검증

### 테스트와 빌드

- 전체 release 테스트 219/219 통과
- 외부 알림 관련 테스트 61/61 통과
- ESLint 및 diff 검사 통과
- Vercel Turbopack 원격 빌드·TypeScript 통과
- Reviewer 최종 코드 판정 Blocker 0 / Major 0 / Minor 0

### Google 관리자 저장

2026-09 합성 0원 기록 저장·새로고침·월별 분리와 두 탭 stale revision 409를 확인했다. 최종 상태는 `revision=2`, `audit_count=2`, `actor_matches=true`다.

### 일반 사용자 403

동일 Google 계정을 인증한 뒤 `ADMIN_EMAILS`만 비운 별도 Preview `dpl_GeA7ZdnHZkuy5DovHhAySsCe4meo`에서 실제 애플리케이션 권한 분기를 검사했다. GET `/api/operations`는 403, `phase=auth`, requestId `a9084cb9-e8d8-4943-b8c7-a9f2edca4efb`였고 저장소에 도달하지 않았다. 같은 requestId의 Slack 메시지가 없어서 4xx가 장애 알림을 만들지 않는 것도 확인했다.

첫 인증 시도는 Supabase Auth가 2초 제한에 걸려 401이 한 번 발생했고 재시도는 819ms에 인증되어 403이 확정됐다. 이 현상은 권한 판정과 구분하며 Auth 지연 관측이 필요한 근거로 남긴다.

### 백업·격리 복원

Free 플랜에는 관리형 일일 백업이 없으므로 합성 Preview scope만 논리 백업했다. 백업 파일은 `.local/preview-release/operations-backup-20260917.json`이며 Git에서 제외되고 권한은 600이다.

빈 PostgreSQL 17 격리 DB에 migration과 합성 백업을 복원했다. 원본/복원 상태 SHA-256 `0e4b3489fd7dc264b3d1f8c33b010c40ff4c01d76fcd3cfd15382cf9fa0b544b`가 일치했고 scope 1, operator 1, month 1, revision 2, audit 2를 보존했다. 복원에는 51ms가 걸렸다. 이후 revision 3 저장 성공, revision 2 재시도 충돌, audit 3과 actor 일치를 확인했다. 익명 RPC와 authenticated의 private schema/table 직접 접근은 계속 차단됐다.

이것은 합성 scope의 논리 복원 절차 검증이다. 관리형 프로젝트 전체 복원이나 정기 외부 백업 운영을 완료했다는 뜻은 아니다.

### 외부 장애 알림과 복구

알림 코드는 operations 5xx만 Slack `chat.postMessage`로 한 번 전송한다. 알림 본문에는 requestId, method, phase, status, 요청 처리시간, 배포 환경만 기록한다. 승인된 토큰과 채널 ID는 전송 경로에만 사용하며 알림 본문·공개 로그에 기록하지 않는다. 사용자·URL·payload도 기록하지 않는다. 최대 대기는 2초이고 재시도는 없다. Slack 실패는 원래 HTTP 응답과 저장 결과를 바꾸지 않는다.

capability를 누락한 별도 Preview `dpl_UapQZh7Z851ZHBHFKN2skN6fpghs`에서 합성 503을 발생시켰다. Vercel 로그는 requestId `c4286239-713a-428e-a6ba-ab9407e2afdd`, `phase=read`, `status=503`, 알림 결과 `sent`를 기록했다. BCC Slack에서 동일 requestId 메시지를 `2026-09-17T15:11:44.050Z`에 실제 수신했다.

이후 별칭을 정상 Preview `dpl_2rR3tBQYCr22yuoYG5JsiAoD52Vw`로 복구했다. GET은 requestId `dd9b70d1-3cbc-44a8-8506-2baef76ce821`, `phase=read`, `status=200`이었고 화면은 revision 2를 다시 표시했다.

### OAuth 복귀 주소 결함

검증 중 Preview `/embed`가 Supabase Auth 허용 목록에 없어 OAuth가 기존 Site URL인 관리자 비밀번호 재설정 페이지로 돌아가는 결함을 발견했다. Supabase Redirect URLs에 `https://ddakfit-operations-preview.vercel.app/embed`를 추가하고 기존 세션을 로그아웃한 뒤 재로그인했다. 수정 후 callback은 Preview `/embed#`로 돌아왔고 토큰 fragment는 클라이언트가 소비해 제거했다. 최종 정상 Preview에서 새 세션으로 관리자 GET 200을 다시 확인했다.

## 남은 운영 조건

- Free 플랜에서는 합성 검증 파일만 존재한다. 운영 전 정기 offsite `supabase db dump`, 보존 기간, 주기적 격리 복원 시험을 자동화해야 한다.
- Slack 알림은 단발 전송이라 rate limit이나 네트워크 실패 시 유실될 수 있다. 운영 안정권에서는 durable queue 또는 별도 모니터를 추가해야 한다.
- `durationMs`는 Slack 대기 전 요청 처리시간이다. 전체 사용자 응답 시간으로 해석하지 않는다.
- Auth 2초 제한에서 일시적 401이 관측됐다. 운영 전 Auth 성공률과 timeout 지표·경보를 추가한다.
- 운영 환경 변수와 운영 도메인으로 새 배포한 뒤 같은 403·503·복구 회귀 검사를 수행한다.

비밀값, 계정 이메일, 고객 payload는 이 문서와 증거 JSON에 기록하지 않았다.
