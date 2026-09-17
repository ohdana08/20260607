# 최종 운영 반영 전 독립 Reviewer 검토

검토일: 2026-09-17. 작업본 `/Users/jinjoopwer/ddakfit-operations-20260917`, 기준 `e2ee1f1f7a8c6c8bc2fecfecf7360e4fde0739de` 및 검토 시작 당시 누적 변경 보존본 `/private/tmp/ddakfit-release-before-20260917`. 입력 목록은 `release-review-input.json`에 있다.

판정: 아래 범위와 최종 해시의 코드에서 재현한 Blocker/Major는 수정 후 독립 재검증을 통과했다. 확인된 미해결 Blocker/Major/Minor는 없다. 이 판정은 전체 저장소의 무결함 보장이나 실제 운영 배포 승인으로 확대하지 않는다. 운영 전제와 실환경 미검증 항목은 아래에 별도로 남긴다. 이전 5개 성능 파일 검토의 승인을 이번 누적 변경에 그대로 적용하지 않았다.

Reviewer는 제품 코드를 수정하지 않았다. 소유 테스트 두 개의 실제 import/Redis 어댑터와 독립 회귀 검증, 본 보고서만 갱신했다. 원본 프로젝트·타 작업자 변경·기존 fixture와 manifest를 보존했다.

## 범위와 방법

- 공통 CLAUDE.md·개발 지도·지금 할 일, 프로젝트 AGENTS.md와 설치된 Next Route Handler/인증 문서를 읽었다. 비밀값·운영 DB·실제 결제·유료 AI·원격 API는 사용하지 않았다.
- 인증 경계: `lib/auth/googleUser.ts`, Word/PT 접근 검사, `app/api/auth/signup`, lead 3개, files/extract, match/chat/review의 누적 diff와 rate limit 호출을 확인했다. 검증된 Google 사용자와 관리자 메타데이터, 신원 캐시와 결제 조회의 분리를 따라갔다.
- 운영 경계: `app/api/operations`, `lib/operations`의 인증·요청 제한·origin·CAS 저장 계약, 최종 월 선택/조회/저장 훅을 확인했다. UI 전반의 디자인이나 사용성 검토는 Architect 범위다.
- 결제 경계: Word verify POST/이메일 복구, presentation/order, webhook, paidAccess/presentationAccess, 신규 paymentState의 실제 호출을 확인했다. 원장 등록·취소·주문 소유·상품별 발급 marker·공고 binding·동의 갱신의 원자성 경계를 검토했다.
- 리드 경계: prestage 실제 route와 신규 reservation helper를 확인했다. 저장 실패/복구와 예약 토큰 계약을 검토했다.
- 유료 AI 경계: draft-batch/evidence 및 presentation chat/generate에서 expectedOrderNo 전달과 binding 실패 시 AI/예산 예약 이전 종료를 확인했다. 발표자료 내용 정규화·export·Chat 변경의 세부 비즈니스 검토는 Implementation 문서로 구분하고, 해당 22개 회귀 테스트와 실제 export 경계 테스트를 독립 재실행했다.
- 보존한 HEAD 코드에서 과거 결함을 재현하는 테스트와 현재 수정본의 바람직한 불변식 테스트를 분리했다. `release-reviewer.test.mjs`는 TypeScript 소스를 explicit-import evaluator에 로드한다. 현재 결제와 예약 Lua는 고정 loopback Redis에서 실행하며, 원격 fetch는 기본 거절한다. 웹훅 전달 검증만 합성 fetch로 대체한다.

## 확인된 결함과 해결

| ID / 심각도 | 재현 조건과 실제 영향 | 기원 | 최소 해결 및 독립 근거 |
| --- | --- | --- | --- |
| R1 / Blocker | 이미 A 주문을 소비한 계정이 B 주문을 사용한 뒤 A를 다시 verify하면, 기존 코드는 A를 미사용으로 덮고 제3 공고 접근을 허용했다. 주문별 1개 공고 과금 제한을 우회한다. | HEAD에도 존재 | 원장·소유·현재권한을 한 Lua에서 검사한다. 현재 동일 주문은 기존 binding을 보존하는 멱등 응답, 이미 소비한 과거 주문은 409. HEAD 실제 route 재현과 현재 route→checkDraftAccess 검증, 실제 Redis의 소유자/주문/공고 경합 검증 통과. |
| R2 / Major | 과거 A 환불 webhook이 계정의 현재 유효 B Word/PT 권한을 삭제했다. B 결제는 유효한데 이용권이 사라진다. | HEAD에도 존재 | 취소 Lua가 원장을 cancelled로 만들고 현재 record.orderNo가 취소 주문과 같을 때만 제거한다. A 환불 후 B 보존, B 환불 시 두 상품 회수 통과. 자동 completion/복구는 cancelled tombstone을 되살리지 않는다. |
| R3 / Major | prestage가 DB insert 전에 영구 NX 완료 marker를 만들었다. DB 실패 뒤 재시도는 dup=true 성공을 반환하면서 실제 리드를 저장하지 않는다. | HEAD에도 존재 | 30초 pending UUID 예약, 성공 후 compare-token finalize, 실패 시 compare-delete. HEAD 실제 route로 유실 재현, 현재 실제 Redis에서 실패→복구→저장 1건 확인. Implementation의 pending·만료 소유자·finalize 실패 경계 4개도 재실행 통과. |
| R4 / Major | 권한 조회 뒤 환불/재구매/다른 공고 binding이 경합하면 과거 read-modify-write가 권한을 복구하거나, 호출부가 binding 실패를 무시한 채 비용을 발생시킬 수 있었다. | HEAD에도 존재 | expectedOrderNo와 현재 원장 상태를 조건으로 atomic bind/consent한다. 4개 AI 진입 경로가 실패 시 AI=0, budget=0으로 종료한다. 실제 Redis 환불 경합·stale request·두 공고 경합과 실제 route 8개 검증 통과. |
| R5 / Major | 초기 단일 소유자 기반 수정에서는 사용한 Word가 있는 계정이 새 bundle을 PT부터 등록하면, 뒤의 합법적인 Word 등록도 과거 주문으로 거절했다. | 이번 결제 수정 중 발견된 중간 후보 회귀 | 상품별 발급 marker를 사용한다. Word 미발급·PT 발급 marker·동일 주문의 현재 PT가 모두 있을 때만 bundle의 Word 추가 발급을 허용한다. PT binding을 Word에 이어받고 PT consent/binding을 보존한다. 실제 두 POST 경로와 멱등 재요청, Lua 경합 테스트 통과. |
| R6 / Major | 새 Word bundle을 등록할 때 현재 Word는 사용됐지만 별개의 PT가 미사용이면, 초기 스크립트가 그 PT 구매를 덮었다. 기존 모델에서 과거 주문 재등록도 거절되어 미사용 구매를 잃는다. | 기존 덮어쓰기 위험이 중간 원자화 후보에도 남았음 | 소유자·marker·권한 쓰기 전에 다른 미사용 PT가 있으면 -3/409로 거절한다. 루트가 실제 Redis 11번째 테스트의 수정 전 실패를 보존하고 수정했다. Reviewer도 최신 Lua 테스트와 실제 verify route에서 두 현재권한·신규 주문 미소유·marker 없음 보존을 독립 확인했다. |

운영 훅의 늦은 수동 reload가 선택 월을 덮는 문제 및 같은 tick 중복 저장은 Architect가 발견·수정했다. Reviewer는 최종 generation/AbortController/동기 saving ref 코드를 읽고 실제 훅의 4개 회귀 테스트를 재실행하여 성공·오류·재렌더 이전 응답·중복 저장 보호를 확인했다. 출처를 Reviewer 최초 발견으로 바꾸지 않는다.

발표 주장 근거 판정, 수정 후 이전 심사 승인 잔류, 5개 bullet 중 뒤 2개 누락은 Implementation 소유 발견·수정이다. `release-implementation.md`에 전후 근거가 있으며 Reviewer는 최종 22개 테스트를 재실행했다. 공격자 지정 이미지 bytes/path가 export route에서 서버 생성 PNG 경계를 통과하지 못한다는 실제 렌더/ZIP 검증도 포함된다.

## 최종 추가 경계 확인

- 실제 Redis에서 같은 주문 두 사용자, 같은 계정 두 새 주문, 같은 권한 두 공고 binding, grant↔cancel, bind/consent↔cancel, 과거 요청↔새 주문 경합을 실행했다. 단일 current entitlement 모델에서 미사용 다른 주문을 조용히 덮는 대신 충돌로 처리한다.
- 웹훅 취소 tombstone 뒤 completion 재전송과 미지 event는 추가 전달하지 않는다. 등록된 정상 완료 전달에는 `AbortSignal.timeout(10_000)`을 넘긴다. 독립 합성 transport는 실패 응답 body를 읽으면 실패하도록 했으며 body를 읽지 않았다. 상태 실패와 예외 모두 응답은 `downstream unavailable`, 로그는 `{event:payment_forward,result:failed}`만 남는다. 실제 10초를 기다리거나 원격 서버를 호출한 검사는 아니다.
- operations는 익명/비관리자를 저장소 접근 전에 401/403으로 거절하고 `private, no-store`를 반환한다. development+명시 local toggle+loopback 조건 없이는 로컬 우회를 선택하지 않는다. JSON 16KB 제한, 검증된 월과 CAS revision 충돌 처리를 유지한다. 로그에는 서버 생성 requestId/제한된 method/phase/status/duration만 기록하고 observer 실패가 완료 응답을 바꾸지 않는다.
- rate store 누락·SDK timeout은 production 비용 경로를 503으로 닫는다. 신원 캐시의 관리자 상태는 같은 Request에서 최대 5초 창이 있으며 새 Request는 즉시 검증한다. 결제 권한은 이 신원 캐시에 포함되지 않는다.

## 남은 운영 전제와 검증 한계

1. 이전 숫자 prestage marker가 실제 DB 성공을 뜻하는지 이번 코드만으로 구별할 수 없다. 기존 CRM/marker 대조와 누락 리드 복구가 필요하다. 이 검토는 과거 고객 데이터를 복구하지 않았다.
2. 이전 버그로 생긴 결제 레코드, owner만 있고 lane marker가 없는 부분 발급, 취소됐으나 남은 레코드는 운영 결제 원장과 대조해야 한다. 새 코드는 모호한 과거 발급을 자동 재생성하지 않고 409로 보수적으로 거절한다. 기존 손상을 자동으로 정리했다고 주장하지 않는다.
3. prestage Redis와 DB는 분산 트랜잭션이 아니다. DB 저장 성공 뒤 finalize 실패 또는 불확실한 DB timeout은 중복 가능성이 남는다. 성공이 확정된 DB 저장 후 finalize 실패는 deduplicationPending=true로 표시한다. exactly-once/unique-upsert를 보장하지 않는다.
4. 결제 Lua는 현재 단일 Redis DB 키 구조를 전제로 한다. Redis Cluster 전환에는 키 동배치 설계가 필요하다. 외부 BCC 전달은 재시도/중복을 포함한 상대 서버의 멱등 처리와 이벤트 순서 계약을 실제 연동에서 확인해야 한다. 로컬 원장 원자성이 외부 전달 exactly-once를 뜻하지 않는다.
5. 운영 Google provider·신뢰 admin metadata·QA/master code·상품 ID·webhook secret·forward 설정·Redis/DB 가용성은 배포 전 운영 설정 관문이다. master 수동 등록은 명시적 운영 복구 권한이며 자동 tombstone 보호와 별도다. 비밀값이나 실주문을 읽어 확인하지 않았다.
6. 실환경 RLS/권한, 실제 가입/결제/환불/유료 AI, 브라우저 전체 E2E 및 PowerPoint 데스크톱 렌더는 실행하지 않았다. 파일 추출기는 이번 rate-limit diff와 진입 경계만 검토했으며 모든 파일 포맷 파서를 fuzzing한 것은 아니다. 의존성 audit/실DB 성능 및 최종 빌드·HTTP smoke는 Architect/SRE 산출물로 별도 판단한다.

## 독립 실행 결과

| 명령 | 결과 |
| --- | --- |
| `npm run test:team` | 최종 50/50 통과. paymentState/openFilter 실제 import와 SDK .or 어댑터를 추가하고 원래 assertion을 보존했다. |
| `node --test --test-name-pattern=Redis tests/release-payment-state.test.mjs tests/release-reviewer.test.mjs` | 최신 payment 11 + 독립 실제 route 6, 총 17/17 통과. 루프백 Redis 합성 데이터만 사용·개별 테스트 키 정리. |
| `node --test --test-name-pattern='release evidence\|operations\|rate store' tests/release-reviewer.test.mjs` | 6/6 통과. 이 중 3개는 HEAD의 과거 결함이 실제 존재함을 입증하는 별도 evidence 검사다. |
| `node --test tests/release-plan.test.mjs tests/release-operations-hook.test.mjs` | Implementation 22 + hook 4, 총 26/26 통과. |
| `npx --no-install eslint tests/release-reviewer.test.mjs tests/team-review.test.mjs` | 통과. |

테스트 항목 기준 위 합계는 99개이며, 보존된 결함 재현 3개를 현재 코드 통과 수로 혼동하지 않는다. 마지막 PT fixture의 B 상품을 bundle로 일치시킨 뒤 독립 Redis 6개를 다시 실행하여 6/6 통과했다. 초기에 sandbox의 loopback socket 접근이 EPERM으로 차단된 실행은 코드 실패로 집계하지 않았다. 승인된 로컬 Redis 명령으로 다시 실행해 위 결과를 얻었다.

## 최종 검토 파일 SHA-256

아래는 검토 종료 시점의 실제 파일 해시다. 관련 코드가 바뀌면 해당 경계를 다시 검증해야 한다. 전체 누적 입력 목록 중 다른 담당자 소유 범위는 해당 보고서와 최종 통합 manifest를 함께 사용한다. `team-reviewer.md`의 과거 해시는 당시 성능 후보 기록이며 이번 release의 최종 해시를 대신하지 않는다.

```text
da8e372a73bbc755f8e2db70d7818e94e19d8b0b5d97e864aa8ce1a0c6a97df9  lib/auth/googleUser.ts
634192359e3bf7470ecc9005d431fede1a13b0e318acaab503bb83f58f7bf7c8  lib/ratelimit.ts
be1ef0abf3597b5f08198944760430faa5b14c237b48eeaf25d3f8d7a7dc73e2  lib/config.ts
06a7abd42615f379f786c872378e198eb46af78809a29d9e765a7c213307a9c5  lib/plan/access.ts
1f091fc64e86ef45217a5d2fa347df005b22ffb9cd52f6e48c0d6f7610945a1d  lib/plan/paidAccess.ts
22e00dc612886d1657051721c00a6af1de0e256987f7f5f9679878309d5b02fd  lib/plan/presentationAccess.ts
f7a5d0d3664b33958cdae17402188e175e5387219aa21c5b7944fb4acd3f0840  lib/plan/paymentState.ts
32d6fd09c87d1177741f11cc8e743e91027b3fdef2bcc9bed431d352363a128d  app/api/order/verify/route.ts
764fe4af5f6ee46f73a394b68307a2b0c95ba8c8368b44b1e7d0fbc9ce83777c  app/api/plan/presentation/order/route.ts
e6e2dd79af5f8d4f2247004007d6a6f340af71af527070a0f799db642a931ca5  app/api/groble/webhook/route.ts
651cba66affe7203564c1c029586f89491a0c07933588c87b18389431208c206  lib/leads/prestageReservation.ts
b1ceb648a7d1d902931f2b5033d11f031b29767e3ce791ba9946f1c751f9789e  app/api/lead/prestage/route.ts
5f7733779cd59d2a34ad0c1e4b5a352058f394445b56eb6c484245a783817b78  app/api/auth/signup/route.ts
1c554891f3808909c5f742f3712d06dd0f47d4032e7e9221d2cbab8f6e6466e2  app/api/lead/email/route.ts
d6f240b22a62fed2aea09c29d135816e5f24933c2004a687c7932f4e60b315b6  app/api/lead/signup/route.ts
053a13137cbd59bdd4304c17aa8fc0a82ce7b965011ed8e0e5243758dbb9d79e  app/api/files/extract/route.ts
328673d006a40daa48a612a244da8f7f592d1e99b92934750da85d66e82050c0  app/api/chat/route.ts
9bfc3660e3ecc3a6765eb470a9301f1dc53226633a4653aa70d4bd519117be57  app/api/match/route.ts
191d5cf11bde552fb6e639289b22afbd7a98e7d2f6e6130195a3847bf604ad51  app/api/review/route.ts
dd82c93240c8042fc16f784864ac5e3fa04d7ca4535868307adb80695d31d1d3  app/api/operations/route.ts
e2f839334da6c2e370f54fc115731924d49c02b036351d65c11f345f406a8555  lib/operations/domain.ts
41e62d754053ccacb120e43d336e59c27954d6dc7bc5d344b0740bbbe641f809  lib/operations/http.ts
5cfbe4156de2ecddded005ac46b0f5db037a33744bcc8745bbe2e7828232edb5  lib/operations/storage.ts
dd4ce52f7fb89593aa96e5cd1395e015d726d30a5eb96851718d5d411e133b92  app/operations/useOperationsDashboard.ts
d12359ba76a8160a48cb0a13fcbae46e364c8ab653168cfaa122941d22380132  app/api/plan/draft-batch/route.ts
f6cfa09f7e420ab92d288e57e5c2592e559089e693dde59454e770c063cb3055  app/api/plan/evidence/route.ts
0428058df3e49d4c4f9b7b428a47ba7f5fc265ce75fd26c3de233e310f903982  app/api/plan/presentation/chat/route.ts
2d14cca61076b5b659e54b99c8f2027d57657afabbbfece6ca3efcbfc13e22a5  app/api/plan/presentation/generate/route.ts
bb9dbd29669c29ee1b31f988046f02dc44335cb199ad5bd4ed9fc08ed4617dee  app/api/plan/presentation/export/route.ts
6c0149873b331a935ecc4eb537459673efe39d57fa441af540ed3aafc1bd4270  lib/plan/presentation.ts
29509f5982696e754556fa05253a7b44be8eb2f0a4f012db34641753ddbfc5f3  lib/plan/presentationExport.ts
a8c366b28bf28b1cbab731c5d7f63d03bb8934e4a0c12666053e1d09f9c24c1a  lib/plan/strategy.ts
6b5c73fbf2111b7845743915b46fefbb806dd079d3d22109b1359ec47300f6f5  lib/plan/artifacts.ts
1fd3e8906e700198342990c5b5c68fd013f145616ab4a801a07313134086997c  components/chat/Chat.tsx
9b0ec62c6bacd90df2a6ae0c1947f8613821a4847de3517f9167d55c36a226e7  lib/data/openFilter.ts
25441ff40cfa5deea7393a0b11af68cf306c2a9f31001c518a2b2b5b46e50255  lib/supabase/programs.ts
923705df05789511570410cb8ff85e7f83780d0e936f6a3b6a2666be013268e5  lib/match/buttonFilter.ts
aa4ff0282f7fdd7d01439fb86776a9cb4c6124f5c1bb7d82679feb4aba584d93  lib/scale/snapshotCache.ts
33c9089903c5017a77b2c9c332b5af517a871edb45f2e48a8dbd7dcad3997e7b  tests/team-review.test.mjs
6879d151edb505011214e8a91a97b9fe9fa1cca69ff430973058cc1389d36e8a  tests/release-reviewer.test.mjs
43a2d9b5f49459a2448eb0f0f12c33a1c4c0e5089dc67bf35c49543ee19e74d2  tests/release-payment-state.test.mjs
95f55ef6bc2c4c88938ad3fef4375509bc0d36b6c2f44d60dba2ebdd9518315e  tests/release-plan.test.mjs
a79cc7bf3087e11f37cd3d98739d1f5d74d22fca6793d1c2b5fd1a47d7ffd913  tests/release-operations-hook.test.mjs
da16f8890397a0338deb9ca99d5400220d5bef0833c8b050d1f390f125a7cf89  tests/helpers/operations-hook-harness.mjs
2838be062f7d1a01af0defa00430d277c229f20333d03f049f8d2ad4e4404c33  tests/helpers/scale-harness.mjs
1fa61d193847b1bfb22bd761638607681a8b61a6b18f8c86600e92519b69cb50  tests/helpers/performance-harness.mjs
```
