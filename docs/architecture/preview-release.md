# 딱지원핏 격리 Preview 검증 — 2026-09-17

## 현재 판정

후보 `2d2ecdb1d39edf052e4bf53f17ac23b7f1b22c21`의 두 번째 Preview에서 실제 Google 관리자 로그인과 주문 상태 조회가 성공했다. 운영 기록 GET은 약 22초 뒤 503으로 실패했고, UI는 안전한 오류 안내를 표시했다. **저장·재조회·월 전환·409 충돌 검증은 저장소 연결 실패로 차단되어 미검증이다.** 운영 도메인 배포·승격·Git 원격 push는 하지 않았다.

- 현재 고정 Preview: https://ddakfit-operations-preview.vercel.app/operations
- 두 번째 Deployment: `dpl_CMpyUGGV6d1UoreKdmqDe73m6VPk`. 동일 override 이름 재적용과 원격 빌드 통과를 확인했다. 업로드 194개 해시 재대조 및 환경·보호 설정의 독립 재검증은 하지 않았다.
- 첫 번째 Preview: https://20260607-pzgtlx7kt-jinjoos-projects.vercel.app/operations — `dpl_BfRNGB1j1BZf8DD8ABVJ6kGpkqn7`, READY, Preview (`target: null`). 아래 194개 업로드 해시 대조와 최초 서버 검사는 이 배포에서 확인한 근거다.
- 운영 기준: `dpl_9GsN1trKqwZB5jMMQWicB1NRxQDk`. 기존 운영 파일 UID 목록은 `preview-production-baseline.json`에 보존했다.
- 첫 배포의 실제 업로드 일반 파일 194개가 작업본 SHA-1과 모두 일치한다. 제외 폴더의 빈 디렉터리 항목 4개는 있으나 안의 파일은 업로드되지 않았다. **docs/ 제외 경로 파일 업로드 0건.**
- 첫 배포 준비 시 기존 최종 검증 manifest의 소스·테스트·설정·근거 125개 해시 변화 없음을 확인했다. 기존 단위·통합 234개 검사는 해당 기록을 재사용하며 이번에 재실행했다고 주장하지 않는다. 첫 배포의 원격 빌드·TypeScript가 통과했고 두 번째 배포의 원격 빌드도 통과했다.
- 정본 작업 폴더의 미커밋 파일 22개 해시 보존 확인.

## 환경 분리와 한계

기존 Preview와 Production이 Redis·Supabase service-role 환경변수 항목을 공유하는 것을 발견했다. 따라서 첫 배포 `dpl_BfRNGB1j1BZf8DD8ABVJ6kGpkqn7`에 새 무료 임시 Redis, 승인받은 관리자 이메일, 빈 service-role·수집·웹훅·AI 키를 적용했다. 이 첫 배포에서 빌드 및 런타임 양쪽에 override 이름이 실제 반영됐음을 배포 API로 확인했다. API는 값 자체를 반환하지 않으므로 서버 저장값을 직접 대조했다고 주장하지 않는다.

첫 배포의 설정은 `MAINTENANCE_MODE=on`, QA·로컬 인증 우회·로컬 저장·공고 캐시 off였으며, 배포 보호 `all_except_custom_domains` 유지도 첫 배포에서 확인한 근거다. 두 번째 배포에서는 동일 override 이름 재적용과 원격 빌드 통과만 확인했다. 첫 배포의 환경·보호·194개 업로드 해시 근거를 두 번째 배포의 독립 검증으로 확대하지 않는다. 환경의 세부 이름과 배포별 검증 범위는 `preview-release-verification.json`에 기록한다. 토큰·계정 이메일·로그인 URL fragment는 이 문서에 저장하지 않는다.

임시 Redis의 제공 만료일은 **2026-09-20**이며 정확한 만료 시각은 제공되지 않았다. 운영 저장소 주소를 읽을 수 없어 두 주소의 직접 비교는 미검증이다. 별도 신규 리소스를 만들고 이번 배포에만 지정했으며 운영 credential로 되돌리지 않는다. 영구 저장소로 전환하거나 결제·소유권 연결을 하지 않았다.

Auth는 기존 BCC Google 인증을 공유한다. 로그인 과정의 세션·접속 기록은 공유 Auth에 기록될 수 있다. 환경변수로 차단되지 않는 BCC 회원가입 프록시 및 Word 결제 링크는 이번 검증에서 호출하지 않았다. 사용 범위는 기존 계정 로그인, 관리자 운영 기록, 자동으로 호출되는 주문 조회까지다.

## 실제 서버 검사

| 검사 | 실제 결과 |
| --- | --- |
| 비로그인 운영 GET | 401, `private, no-store`, `Vary: Authorization`, 요청 UUID |
| 비로그인 운영 PUT | 401, `private, no-store`, 요청 UUID |
| 비밀 없는 수집 실행 | 401 |
| 비밀 없는 결제 웹훅 | 403 |
| 폐기된 초안 API | 410 |
| 현재 초안 생성 API | 503, `maintenance: true` |

GET 요청 ID는 `781eac6a-6349-4cd9-bd81-6539bc4382b2`, PUT은 `6d9de15d-3a7c-4edd-8b1b-c5b689db8353`다. 여기서 AI 503은 의도한 유지보수 차단이며 저장소 장애 검증과 다르다.

## 실사용 로그인 RCA와 해결

1. Preview의 Google 버튼이 정확한 `/operations` 복귀 주소를 요청했다.
2. 사용자에게 지정받은 기존 Google 계정을 선택했다.
3. 인증 후 Preview 대신 기존 BCC 비밀번호 재설정 페이지로 이동했다. 비밀번호 입력·변경은 하지 않았다.
4. 사용자가 Supabase 관리 콘솔에 로그인한 뒤 실제 URL Configuration을 확인했다.
5. Site URL이 그 비밀번호 재설정 주소였고, Redirect URLs 12개에 이번 Preview 주소는 없었다. 이 상태는 허용되지 않은 `redirectTo`가 Site URL로 복귀하는 설정과 일치한다.

이후 첫 Preview의 정확한 `/operations` 주소와 고정 alias의 `/operations` 주소를 허용 목록에 추가해 저장했다. Redirect URLs는 **총 14개**다.

- `https://20260607-pzgtlx7kt-jinjoos-projects.vercel.app/operations`
- `https://ddakfit-operations-preview.vercel.app/operations`

두 번째 배포의 고정 alias에서 실제 Google 관리자 로그인이 성공했고 `/api/order/verify`는 200을 반환했다. 인증 복귀 주소 문제는 해결되었으며, 현재 차단 지점은 저장소 연결이다. 인증 토큰·계정 이메일·로그인 fragment는 기록하지 않는다.

근거: [Supabase 공식 Redirect URLs 문서](https://supabase.com/docs/guides/auth/redirect-urls).

## 인증 후 실제 저장소 실패와 연결 조사

두 번째 Preview에서 인증된 `/api/operations` GET은 **21,965ms 후 503**을 반환했다. 요청 ID는 `65be3e21-128e-4ea4-9f30-50e418db0801`이다. 화면에는 “운영 기록을 저장하거나 불러오지 못했습니다. 입력을 유지한 채 다시 시도해 주세요.”가 표시되었다. 이는 실제 hosted 읽기 실패의 안전한 표시를 확인한 것이며 PUT 실패 시 입력 보존이나 저장 성공을 검증한 것은 아니다.

독립 생성한 start-redis DB endpoint 두 개는 같은 IP pool로 해석되었고, TCP/TLS 연결 수립이 제한 시간 안에 끝나지 않았다. 앞선 Mac의 독립 검사에서도 sandbox 밖 DNS는 정상이며 credential 전송 전 연결이 시간 초과됐다. 대조군 `upstash.com` TLS는 정상이다. 이 근거만으로 잘못된 토큰·애플리케이션 CAS 결함·공급자 전체 장애를 단정하지 않는다. endpoint 주소·IP·리소스 ID·토큰은 기록하지 않는다.

대체 저장소로 확인한 Vercel Upstash integration에는 Free DB가 정확히 한 개 있었으며 **다른 프로젝트의 기존 Free DB**였다. 새 checkout에는 **Pay As You Go 또는 Fixed 유료 요금제만** 표시되었다. 이 경로로 새 연결이나 유료 구독을 만들지 않았다. 운영 Redis 또는 다른 프로젝트의 Free DB도 연결하지 않았다.

사용 가능한 별도 저장소가 준비되면 동일 후보의 hosted 읽기·합성 값 저장·새로고침부터 재개한다. 현재 저장·재조회·월 전환·두 탭 충돌은 모두 차단/미검증으로 남긴다.

## 팀 독립 검토

- Architect: 후보 동결, 운영 파일 대조, 환경 분리, 배포·실제 UI 검증 총괄.
- Implementation: 제품 환경변수 소비 및 SDK 암묵 인증을 독립 분석. 유지보수 잠금과 빈 override 범위를 확인했다. 환경변수만으로 회원가입 프록시 전체를 막을 수 없다는 한계를 보고했다.
- Reviewer: 업로드 제외 규칙을 Vercel의 실제 열거기로 검증했다. 이전 실행기 버전에서 대상 프로젝트 고정과 출력 경계 누출 문제를 수정한 뒤 합성 테스트를 통과했다. 현재 private 실행기 SHA-256은 `951433ee52a71d12aa8e1289ad49bee273dd12db697114ad00a295e5be00c1cb`이며, 이 최신 버전의 최종 검증은 아직 재실행하지 않았다. 이전 합성 테스트 통과를 현재 해시의 검증 완료로 간주하지 않는다.
- SRE/Optimizer: 기존 환경의 공유 저장소 위험, 임시 리소스 만료·복구 조건, 실제 DNS/TLS 실패 단계를 독립 검증했다.

제품 코드 변경 없이 `.vercelignore`를 보강했다. 실행기 내부 변경은 배포 파일에 포함되지 않는다. 상세 초기 리뷰는 `preview-reviewer.md`, `preview-sre.md`다.

## 남은 실행 순서

1. 운영과 분리되고 실제 연결 가능한 저장소를 확보한다. 무료 대체 연결은 확보하지 못했으며 유료 요금제는 연결하지 않았다.
2. 완료한 실제 Google 관리자 로그인에 이어 관리자 읽기 → 합성 성과 저장 → 새로고침·월 전환 → 두 탭의 오래된 revision 충돌을 검증한다. 이 단계는 현재 차단/미검증이다.
3. 기존 일반 사용자 계정을 확보하면 403을 검증한다. 계정을 임의 생성하지 않는다.
4. 전용 환경에서 PUT 실패 시 입력 보존과 복구를 확인한다. 이번에 확인한 것은 실제 GET 503과 UI 오류 안내이며, PUT·복구는 미검증이다.
5. 운영 결제 이벤트/원장 대조, 백업·복원, 외부 알림 도착, 현재 알려진 취약 의존성의 제한 조건을 확인한 뒤 운영 배포를 검토한다.

임시 Redis와 AI 차단 설정이 적용된 이 Preview를 운영으로 직접 승격하면 안 된다. 운영 환경으로 새 배포를 만들 때 같은 검증 소스와 올바른 운영 설정을 다시 대조해야 한다.
