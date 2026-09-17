# 딱지원핏 격리 Preview 검증 — 2026-09-17

## 현재 판정

후보 `00ae18be56d2aed5fe4f90f5cc9e1ed246d1ac27`을 Supabase 기반 격리 Preview에 배포했다. 실제 Google 관리자 세션으로 읽기, 합성 0원 기록 저장, 새로고침 후 재조회, 월별 분리, 두 탭의 오래된 revision 충돌을 확인했다. **Preview 검증은 통과했다. 운영 배포와 Git 원격 push는 하지 않았다.**

- 고정 Preview: https://ddakfit-operations-preview.vercel.app/operations
- Deployment: `dpl_EkB2Sdw6TwDvpNEaSao8gvcSqEZc`
- Deployment URL: https://20260607-i6hpr9yss-jinjoos-projects.vercel.app
- Supabase migration: `operations_postgres_rpc`
- 제품 커밋: `00ae18be56d2aed5fe4f90f5cc9e1ed246d1ac27`

## 저장소 구조와 권한

운영 기록은 기존 BCC Supabase 프로젝트의 전용 private schema에 저장한다. 브라우저 JWT를 PostgREST RPC까지 전달하고, 함수 안에서 다음 세 조건을 모두 확인한다.

1. `auth.uid()`가 있는 인증 사용자
2. Preview scope의 UUID 허용 목록
3. Preview 배포에만 들어간 고엔트로피 capability의 SHA-256 일치

`anon`은 RPC를 실행할 수 없고 `authenticated`는 private schema와 표를 직접 읽을 수 없다. RPC만 `SECURITY DEFINER`로 실행하며 빈 `search_path`를 고정했다. 서비스 역할 키와 결제 Redis credential은 Preview에 넣지 않았다. 쓰기는 `(scope_id, month, revision)` 조건부 갱신으로 처리하고 자동 재시도하지 않는다.

DB는 문서 크기 1 MiB, 배열 수, 숫자·문자열 길이, 날짜, URL, 상태 enum을 다시 검증한다. 감사 actor·시각·revision은 요청값을 신뢰하지 않고 DB가 만든다. CAS 잠금 대기는 500ms로 제한한다. 앱은 Auth 2초, RPC 3초 후 응답 대기를 중단하지만 이것을 DB statement 실행 제한으로 주장하지 않는다.

## 실제 검증

### 로컬 PostgreSQL

- 깨끗한 PostgreSQL 17에 migration 적용 성공
- 익명 RPC 실행 거부
- authenticated의 private schema 사용·table SELECT 거부
- DB가 합성 actor를 실제 JWT UUID로 교체
- stale revision은 `null` 충돌 결과
- 16개 동시 최초 저장: 성공 1, 충돌 15
- 16개 동시 갱신: 성공 1, 충돌 15
- 최종 revision 2, audit 2

실제 DB 실행에서 PL/pgSQL 변수와 영상 별칭 충돌을 발견해 수정했다. 함수 내부 `SET statement_timeout`이 외부 문장 타이머를 보장하지 않는 것도 재현해 해당 선언을 제거했다.

### 테스트와 빌드

- 관련 테스트 61/61 통과
- 전체 release 테스트 207/207 통과
- 제품 보호 테스트 통과
- ESLint 통과
- 로컬 webpack 프로덕션 빌드·TypeScript 통과
- Vercel Turbopack 원격 빌드·TypeScript 통과

로컬 Turbopack은 샌드박스의 내부 포트 바인딩 차단으로 실패했으며, 같은 커밋의 webpack 빌드와 Vercel Turbopack 빌드는 통과했다.

### 실제 Preview 브라우저

1. Google 관리자 세션으로 2026-09 기록을 읽었다.
2. 합성 0원 성과를 저장해 revision 1을 확인했다.
3. 페이지 새로고침 후 0원 기록과 메모가 유지됐다.
4. 2026-08로 전환했을 때 별도 빈 revision 0이 표시됐다.
5. 2026-09로 돌아와 첫 탭에서 revision 2를 저장했다.
6. revision 1을 유지한 두 번째 탭의 저장은 409가 되었고 화면에 “다른 창에서 내용이 바뀌었습니다. 새로 불러온 뒤 다시 저장해 주세요.”가 표시됐다.
7. Supabase 최종 확인은 `revision=2`, `audit_count=2`, `actor_matches=true`다.

Vercel 로그에도 operations GET 200, PUT 200, stale PUT 409가 구조화 로그로 남았다. 토큰, capability, 계정 이메일, 고객 데이터는 근거 문서에 기록하지 않았다.

## 독립 검토

- Reviewer: Blocker 0 / Major 0 / Minor 0, 코드 검토 승인. 관련 테스트 61/61을 독립 재실행했다.
- SRE/Optimizer: Blocker 0 / Major 0 / Minor 0, 격리 Preview 검증 승인. 정상 GET은 RPC 1회, PUT은 읽기+쓰기 RPC 2회이며 쓰기 재시도가 없음을 확인했다.
- 정본 작업 폴더의 기존 미커밋 파일 22개는 기준 해시와 모두 일치한다.

Supabase Advisor의 이번 구조 관련 알림은 private 표 3개의 “RLS policy 없음” INFO와 authenticated가 실행하는 `SECURITY DEFINER` 함수 2개의 WARN이다. 둘 다 의도된 deny-by-default private table + 좁은 RPC 구조다. 함수는 JWT, scope capability, UUID allowlist를 다시 확인한다. 프로젝트의 기존 leaked-password 및 기존 표·정책 성능 알림은 이번 변경 범위 밖이다.

## 운영 승격 전 남은 관문

- 일반 사용자 계정의 hosted 403 검증
- 운영 백업·복원 시 revision·audit 보존 검증
- 실제 외부 알림 도착 검증
- 운영 환경 변수와 도메인으로 새 배포 후 동일 회귀 검사

현재 Preview는 합성 검증용이다. 이 배포를 운영으로 직접 승격하지 않는다.
