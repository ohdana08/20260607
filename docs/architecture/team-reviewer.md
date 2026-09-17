# 독립 Reviewer 검토 — 2026-09-17

판정: 아래 해시로 고정한 제품 파일 5개와 성능 검증 코드 범위에서 미해결 correctness/security/maintainability finding 없음. 앞 단계의 승인이나 측정 수치를 근거로 삼지 않고 소스와 실제 호출 경로를 확인한 뒤, 별도 하네스로 검증했다. 이 판정은 배포 승인이나 전체 저장소 보안 보장을 뜻하지 않는다.

검토자는 제품 코드를 수정하지 않았다. 작성 파일은 `tests/team-review.test.mjs`와 이 문서다. 원본 프로젝트, 기존 미커밋 변경, 보존된 performance-before 원문·manifest는 변경하지 않았다.

## 대조 범위와 결과

| 대상 | 직접 확인한 근거 | 결과 |
| --- | --- | --- |
| `lib/auth/googleUser.ts` | performance-before 원문과 diff, `paidGoogleLoginGate → checkDraftAccess/getAuthedUser`, `checkPresentationAccess` 호출 | Request별 WeakMap이며 토큰 변경·헤더 삭제 시 재검증한다. 실패한 이전 토큰 요청이 새 성공 항목을 삭제하지 않는다. 반환 객체 복사로 호출자가 admin 상태를 바꿔도 후속 호출에 유입되지 않는다. |
| 인증과 결제 분리 | 실제 `paidAccess.ts`, `presentationAccess.ts`를 독립 하네스에 로드해 저장소 응답을 허용→취소·다른 공고 바인딩으로 변경 | 동일 Request의 신원을 공유해도 Word·발표자료 결제 취소와 공고 바인딩 변경을 다음 권한 검사에서 거절한다. 결제 레코드는 신원 캐시에 들어가지 않는다. |
| `lib/match/buttonFilter.ts` | 17개 시도·8개 하위 지역, 후보 순서·시도 제외 조건·non-global 정규식 직접 대조 | 162,000개 지역/간격/줄바꿈/Unicode/자기지역 조합에서 이전 소스와 판정 일치. 나머지 추천 출력은 기존 전체 출력 대조 검사도 재실행했다. |
| `lib/supabase/programs.ts` | `fromRow`가 읽는 필드와 select 문자열, 실제 `catalogCache → getOpenPrograms`, 쿼리 옵션 | 변환 함수의 10개 필드와 조회 목록이 정확히 일치한다. null 마감·양식, 제한, 정렬, closed_at 조건, AbortSignal 전달을 보존한다. 추가 DB 필드는 기존에도 반환 Program에 포함되지 않았다. |
| `lib/scale/snapshotCache.ts` | performance-before 원문, `catalogCache.ts`, Redis lease 소유자 확인 Lua | 공유값 읽기·lease 획득 경합·다른 소유자 대기 경로에서 localUntil을 일관되게 설정한다. freshness와 stale 만료를 연장하지 않으며 중첩 반환값 변경도 내부에 유입되지 않는다. publish 실패·lease 상실 때 미발행 값을 승격하지 않는 검사도 재실행했다. |
| `lib/data/openFilter.ts` | team-before 원문과 직접 diff, `fetchOpenPrograms → isStillOpen → dedupePrograms` | 포매터만 1회 생성한다. 날짜는 호출할 때 다시 읽으며 KST 자정, 지연된 조회, 빈/전부 만료 목록 fallback에서도 최신 날짜를 사용한다. |
| 성능 검증 코드 | `tests/performance.test.mjs`, `tests/helpers/performance-harness.mjs` 직접 읽기 | 외부 전송은 합성 fetch로 대체하며 installed SDK가 만드는 PostgREST URL을 검사한다. 독립 reviewer 검사는 기존 하네스를 import하지 않고 런타임 의존성을 명시적으로 허용하는 별도 evaluator를 사용한다. |

## 발견 사항과 한계

이전 성능 측정에서 `matchByButtons` 앞단의 공고 마감 필터 비용이 제외된 문제는 팀 검토 중 별도 발견됐다. 원코드에서 날짜가 있는 공고마다 `new Intl.DateTimeFormat`을 생성하는 경로와 실제 `fetchOpenPrograms` 호출 위치를 확인했다. 이는 원래 4개 성능 패치가 새로 만든 회귀가 아니라 기존 비용 및 측정 범위의 누락이다. 필요한 코드 수정은 포매터만 모듈 단위로 재사용하는 것으로 반영됐고, 날짜 판정 회귀는 독립 검증을 통과했다. 전체 흐름의 새 성능 수치는 SRE 산출물에서 별도로 판단하며 이 문서는 그 수치를 인증하지 않는다.

신원 캐시에는 `isAdmin`도 포함된다. 같은 Request에서 인증 서버의 변경을 최대 5초 동안 다시 묻지 않는 것은 실제 동작이며, 권한 철회가 즉시 반영된다고 표현하면 안 된다. 독립 검사에서 4,999ms에는 유지되고 5,000ms에는 재검증·거절되는 점, 같은 토큰이어도 새 Request는 즉시 검증하는 점을 확인했다. 일반 유료 이용권은 이 창과 무관하게 매번 다시 읽는다.

이 검토는 합성 인증·DB·Redis 응답과 로컬 Node v24.14.1에서 수행했다. 실제 운영 DB 스키마·RLS, 네트워크 지연 수치, 실결제·환불, 유료 AI, 프로덕션 배포는 실행하거나 확인하지 않았다. [Supabase getUser 문서](https://supabase.com/docs/reference/javascript/auth-getuser) 및 changelog를 참고했고, 현재 코드의 인증 서버 조회 방식을 직접 확인했다.

## 실행 증거

- `node --test tests/team-review.test.mjs`: 독립 12/12 통과.
- `npx --no-install eslint tests/team-review.test.mjs`: 통과. 최초에 Next의 module 변수명 규칙에 걸린 테스트용 변수만 `loaded`로 고친 뒤 재실행했다.
- 수정 후 `node --test tests/team-review.test.mjs tests/performance.test.mjs`: 47/47 통과, 실패·취소·건너뜀 0.
- SRE의 최종 하네스 변경을 다시 읽고 `npm run test:team`을 직접 실행했다. 성능 35개 + 독립 Reviewer 12개 + SRE 경계 3개, 총 50/50 통과이며 실패·취소·건너뜀 0이다.
- 별도 인라인 Node 검사로 기본 before, 명시적 sourceRoot 우선순위, team-before 선택, 보존본 누락 시 현재 소스 fallback, 기본 현재 소스 선택을 각각 실행했다. 실제 로드 경로·SHA-256·동일 모듈 재호출 객체를 검사해 5/5 통과했다.
- 최종 실행 직전·직후 제품 5개와 두 성능 검증 파일의 SHA-256이 일치했다. reviewer 테스트 파일의 마지막 변수명 수정 후 해시는 아래와 같다.
- `performance-before` 6개 원문의 manifest 해시 검증 통과. 원래 제품 4개는 team-before manifest 해시와 같으며, 추가 openFilter 변경은 team-before 원문과 직접 비교했다.

| 파일 | 최종 SHA-256 |
| --- | --- |
| `lib/auth/googleUser.ts` | `da8e372a73bbc755f8e2db70d7818e94e19d8b0b5d97e864aa8ce1a0c6a97df9` |
| `lib/match/buttonFilter.ts` | `923705df05789511570410cb8ff85e7f83780d0e936f6a3b6a2666be013268e5` |
| `lib/supabase/programs.ts` | `399dadbe2025b433af55d33c2450de9b447c4fe4bb3107529cbb3fd5bb84aad6` |
| `lib/scale/snapshotCache.ts` | `aa4ff0282f7fdd7d01439fb86776a9cb4c6124f5c1bb7d82679feb4aba584d93` |
| `lib/data/openFilter.ts` | `9b0ec62c6bacd90df2a6ae0c1947f8613821a4847de3517f9167d55c36a226e7` |
| `tests/performance.test.mjs` | `9012866d5960dfe5b2689e4ca4fdd03ddeb11b22be3789f1c429f100576b2494` |
| `tests/helpers/performance-harness.mjs` | `1fa61d193847b1bfb22bd761638607681a8b61a6b18f8c86600e92519b69cb50` |
| `tests/team-review.test.mjs` | `867e56888d06160a9f8a14c9b16907e6f48670f43766578d0137a4bfdb8ad0d2` |

이 해시가 바뀌면 해당 변경에 대한 추가 검토가 필요하다. Implementation에는 제품 추가 수정 요청 없음과 독립 재검증 결과를 전달했다.

## 최종 하네스 추가 검토

최초 검토의 하네스 `413017cf…` 이후 SRE가 `sourceRoot` 선택과 로드 소스 출처·SHA 기록을 추가했다. 최종 `1fa61d19…` 본문을 다시 읽고 소스 선택을 실제 실행해 검토했으며, 이 변경에 미해결 finding은 없다. 제품 5개, `tests/performance.test.mjs`, 독립 Reviewer 테스트는 앞의 검토 해시를 유지한다. 최종 `npm run test:team` 실행 전후 해시도 일치했다.

- `sourceRoot`를 생략하면 이전과 동일하게 `before: true`일 때만 performance-before를 선택한다. 명시적 `sourceRoot`는 `before` 값보다 우선하며 `.source`가 없으면 현재 파일을 사용한다. 이 fallback은 완전한 과거 저장소 재생을 의미하지 않으므로 실제 로드된 `sources` 기록과 함께 해석해야 한다.
- 파일을 한 번 읽은 동일 `sourceText`로 SHA를 만들고 transpile한다. `sources`는 로드 경로와 해시만 기록하며 인증 응답·토큰을 기록하지 않는다. 기존 모듈별 캐시와 명시적 mock 우선순위도 유지한다.
- 기본 VM `fetch`는 계속 거절한다. `authHarness`는 합성 인증 응답과 Redis stub, `catalogHarness`는 example.invalid SDK 클라이언트의 합성 fetch를 유지한다. 조회 필드 projection·limit과 응답 바이트 계산 방식은 바뀌지 않았다. 이번 추가 검토와 테스트에서도 원격 API·운영 데이터는 사용하지 않았다.
- 이 최종 하네스의 검증은 SRE가 만든 시간 측정값이나 전체 벤치마크 방법론에 대한 별도 승인으로 확대하지 않는다.
