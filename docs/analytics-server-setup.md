# 딱지원핏 서버 purchase 측정 — 구성/미구성/검증 경계

## 현재 상태

**2026-10-15 사이트 계측 코드는 운영 반영했다. 구매 발신자는 기존 Groble native로 한정하며 서버 MP는 비활성이다. 실제 구매 수신·전체 여정 연속성 검증 완료를 뜻하지 않는다.**

- Production 배포: `dpl_aYqxMv5ivwjVioGXTzwaLo2Yfg5m`. 공식 도메인 재조회·HTTP·운영 브라우저의 단일 loader/config를 확인했다.
- Production `NEXT_PUBLIC_GA_ID=G-TYJSYWW5Q6`, `NEXT_PUBLIC_GA4_PURCHASE_MODE=native`, `GA4_PURCHASE_MODE=native`. 공개 설정 세 값은 정확한 Production 대상을 재조회해 일치 확인했다. 아래 서버 경로 설명은 미래에 별도 승인·검증 후 활성화하는 경우의 계약이다.
- 기존 stream `14366606087`의 ID와 향상된 측정 꺼짐을 UI에서 확인했다. 새 stream은 생성하지 않았다. 로그인 없는 private context에서 Groble의 판매자 loader와 `page_view`/`view_item` 큐를 확인했지만 수집 URL을 차단했으므로 GA 실제 수신의 증거는 아니다.
- 도메인 구성의 기존 추천 목록만 읽었다. 후속 drag의 별도 조작 승인이 시간 초과돼 조건 입력·저장은 하지 않았다. 실제 cross-domain client/session 연속성, GA4 저장 퍼널, 실구매·복귀·다운로드는 남아 있다.

- 부모가 실제 GA UI에서 대조한 `G-5TN5XW0T2J`는 account `391237892`, property `532896870` `ga4-handson-blog`, stream `15070193239` `BCC 홈페이지`다. 딱지원핏 전용 속성이 아니다.
- 선택적 서버 경로는 프런트와 동일한 `NEXT_PUBLIC_GA_ID`를 사용한다. 미지정 때만 기존 ID 호환이며 잘못된 값은 저장·전송 전 차단한다. `site_id=ddakfit`, `app_id=ddakfit`를 고정한다. 커스텀 차원 등록은 하지 않았다.
- **서버 MP는 기본 비활성**이다. `GA4_PURCHASE_MODE=server_exclusive`를 정확히 명시해야만 서버 구매 경로와 checkout context API가 열린다. 부재·빈 값·`native`·오타·대소문자/공백 차이는 모두 `disabled`이며, 키가 둘 다 있어도 활성화되지 않는다.
- 이번 실행의 임시 MP 키는 GA4 UI에서 삭제했고 Vercel `GA4_MP_API_SECRET`도 제거 후 부재를 확인했다. **운영 서버 MP는 미구성/비활성**이며 비활성 잠금 코드는 배포했다. 네이티브 방식에 이 키를 새로 발급할 필요는 없다.
- 미래에 서버 MP를 별도 활성화하는 경우에만 `GROBLE_WEBHOOK_SIGNING_SECRET`도 필요하다. 현재 native 운영을 위해 발급할 필요는 없다. 구성 여부는 미확인이며 기존 URL key와 다른 Groble 공식 HMAC secret이다. 발급·재발급·값 조회는 하지 않았다. opt-in 이후에도 키 누락 시 purchase는 `unconfigured`로 전송/registry 생성을 건너뛴다.
- Groble native GA4 연결 ID `G-TYJSYWW5Q6`를 재사용한다. 그로블 내부 `begin_checkout`·실제 purchase/금액·귀속은 실결제로 확인하지 않았다. 서버와 병행하지 않는다. 사이트의 이동 클릭은 `checkout_link_click`로 별도 기록한다.

## 활성화 관문 — native와 병행 금지

1. Groble native GA4의 상품별 실제 발화/목표 스트림과 프런트·서버의 purchase 소유자를 확인한다. native가 켜진 상태에서 서버를 시험 활성화하지 않는다.
2. native 구매 측정을 끄거나 해당 상품이 native에서 전송되지 않음을 검증하고, **구매 발신자를 서버 하나로 한정**한다. 다른 상품·공유 속성 설정은 별도 승인 없이 변경하지 않는다.
3. 개인정보 allowlist, 실제 주문/금액/서명/귀속, 중복·재시도 및 운영 Redis Lua 검증을 완료하고 별도 운영 활성화 승인을 받는다. 실제 Redis는 현재 미가동이므로 이번 Map 모의 시험으로 대체 완료 처리하지 않는다.
4. 정확한 서버 대상 스트림 secret와 Groble 서명 secret를 서버 전용으로 구성한 후에만 `GA4_PURCHASE_MODE=server_exclusive`를 설정한다. 설정 하나가 native 중복 여부를 자동 검사하거나 증명하지는 않는다.
5. native를 다시 켜려면 **먼저 서버 mode를 제거/비활성화**한다. 합성 purchase의 실 GA/실 Redis 전송, 새 cron, 자동 활성화는 금지한다.

## 전송 조건 (모두 충족)

이 조건들 이전에 정확한 `GA4_PURCHASE_MODE=server_exclusive` opt-in이 필수다. 기본 비활성에서는 `reportPurchase`가 즉시 `disabled`, webhook은 analytics 동적 import/호출을 생략한다. 기존 원장/원본 로그 쓰기와 취소/Claude101 forward는 유지하되 신규 analytics registry/context 쓰기와 GA HTTP는 0이다.

1. `VERCEL_ENV=production`, `QA_MODE`가 `true` 아님.
2. 기존 webhook URL key 검사를 통과했고, 기존 주문 등록에서 취소 상태가 아님. 기존 등록/취소/Claude101 전달 기능은 보존.
3. analytics 전용 추가 검증: raw body bytes에 대한 HMAC-SHA256, `X-Groble-Timestamp` ±5분. 현재 키로 계산한 서명을 `X-Groble-Signature` 또는 회전 중 `X-Groble-Signature-Previous`와 상수시간 대조. 이 추가 검증 실패는 **analytics만 보류**하며 기존 결제 권한 보안을 교체하지 않는다.
4. 정확히 `payment.completed`, 스키마 `2026-04-30`, `evt_` 이벤트이며 `evt_test_`가 아님. 정규화 없는 18~19자리 `merchantUid`.
5. 현재 `lib/config.ts`의 딱지원핏 Word/구성된 presentation/bundle 상품 ID. 과거/누락/Claude101/알 수 없는 상품은 거절. 콘텐츠 유형 DOCUMENT 또는 SERVICE, 카드결제 CARD.
6. `data.object.pricing.finalAmount`가 **양의 안전한 정수**, currency가 **KRW**. 공식 문서상 실제 결제 금액이다. 문자열/0/누락/타 통화는 `unknown_pricing` 또는 부적격. 정가·클라이언트 금액으로 대체하지 않는다.
7. 발생시각이 72시간 이내이며 미래 오차 5분 이내. 만료는 `expired`로 보류하고 현재 시각으로 재작성하지 않는다.
8. 웹훅 sellerReference가 인증 기반 서버 checkout context와 연결. 원장은 현재 `valid`이며 상품 일치. 무연결/만료 context는 **unattributed로 분류하고 GA purchase 전송 보류**. 임의 Threads 캠페인이나 가짜 client ID를 만들지 않는다.

## 프런트 호출 계약

`NEXT_PUBLIC_GA4_PURCHASE_MODE=server_exclusive`일 때만 실제 외부 결제 이동 직전에 선택적으로 호출한다. 현재 native mode에서는 auth·context·popup·preventDefault를 모두 건너뛰어 원래 anchor 이동을 유지한다. 서버 mode 또한 별도로 정확히 opt-in해야 하며 프런트 설정만으로 서버를 켤 수 없다.

```text
POST /api/analytics/checkout
Authorization: Bearer <기존 Google auth access token>
Origin: https://ddakfit.bccconsulting.kr
Content-Type: application/json

{"client_id":"<gtag get configured measurement ID client_id>","session_id":"<gtag get session_id>"}
```

- client_id: 숫자 1~20자리 + 점 + 숫자 1~20자리. session_id: 양의 정수 문자열 1~13자리.
- 요청은 두 키만 허용, 실제 body 상한 512 bytes. URL/UTM/이메일/사용자 ID/주문번호/사업 원문은 받지 않는다.
- 성공 200: `{reference: "ddak_<random UUID>", expires_in: 86400}`. 기존 Groble URL에 `ref=reference`를 추가한다. `ref`를 이메일이나 내부 user ID로 대체하면 안 된다.
- mode 비활성 시 인증 호출·Redis 생성·context 생성 이전에 503 `{error: "disabled"}`, `Cache-Control: no-store`를 반환한다. 프런트는 이 응답으로 결제를 중단하거나 reference를 요구하면 안 된다.
- 활성화 이후: 401 인증 없음, 403 관리자/QA/Preview/공식 origin 아님, 400 잘못된 형식, 413 크기 초과, 429 계정별 10회/1시간, 503 인증 또는 저장 의존성 문제.
- 서버에 무작위 참조, client_id, session_id, 생성시각만 24시간 저장한다. 첫 결제 시 같은 context를 다른 주문에 재사용하지 못하도록 원자 결합한다. 인증 사용자 원문은 저장하지 않으며 rate-limit용 사용자 ID SHA256은 private Redis 키에만 사용하고 1시간 뒤 만료한다. 이메일을 해시하거나 GA로 전송하지 않는다.
- 관리자는 서버 `isAdmin`, QA 배포는 `QA_MODE`로 제외한다. 프런트 QA/디버그 표시도 호출 전에 제외해야 한다. 표시 없이 일반 회원으로 실제 결제하는 사람의 의도를 서버가 알아낼 수 있다고 보장하지 않는다.
- 외부 Groble에서 누가 실제 카드 입력을 했는지, 카드 입력/인증 단계 이탈, cross-device 및 세션 기여의 정확성은 검증하지 않았다. client/session 연계는 GA가 처리하는 조건에 따라 귀속이 제한될 수 있다.

## 비식별 거래/중복/재시도

- private Redis `gp:analytics:purchase:<raw-order>`에 **서버 무작위** `ddak_tx_<UUID>`를 원자 생성한다. 원 주문번호, sellerReference, 사용자 ID, 이메일, 이메일 해시를 GA transaction_id로 사용하지 않는다.
- 실제 전송 body는 client_id, 원 발생시각, purchase와 고정 scope, 랜덤 transaction_id, 확인된 value/currency, GA session, 고정 상품 ID/명/수량/실금액만 구성한다. webhook 전체를 복사하지 않는다.
- 원장·context 검사와 최초 거래 ID 생성/lease 획득을 Lua EVAL 하나로 처리한다. 30초 lease 동안 동시 수신은 `busy`/503. HTTP는 8초 timeout, redirect 금지.
- 2xx를 받으면 sent 기록. 2xx는 **transport 수락**이지 GA 유효성·보고서 반영 증명이 아니다.
- HTTP 실패/timeout/전송 후 저장 실패는 pending으로 남기고 503. Groble의 기존 웹훅 재전송으로 동일 랜덤 transaction_id/동결된 원 금액/원 client/session/원 발생시각으로 재시도한다. 프로세스 중단 lease는 30초 후 재획득 가능하다. 신규 cron 없음.
- registry는 90일 TTL. 초기 context가 만료돼도 이미 만들어진 pending registry로 72시간 이내 재시도 가능하다. 72시간 지난 원 이벤트는 임의 backdate하지 않고 보류한다.
- HTTP와 Redis 사이 분산 transaction이 아니므로 정확히 한 번 전달을 보장하지 않는다. 전송 성공 뒤 프로세스 중단 또는 lease 만료 경합에서는 동일 transaction_id 재전송이 가능하며 GA의 거래 중복 제거도 필요하다. busy의 503은 정상적인 재시도 신호다.
- 취소 권한처리는 기존 그대로다. 이번 범위는 purchase이며 **GA refund 이벤트는 추가하지 않았다**. GA purchase만으로 취소 차감 후 순매출이 맞다고 보고하면 안 된다.

## 시험과 한계

```sh
node --test tests/purchase-server.test.mjs tests/checkoutContext-server.test.mjs
./node_modules/.bin/eslint app/api/groble/webhook/route.ts app/api/analytics/checkout/route.ts lib/analytics/server.ts lib/analytics/purchase.ts lib/analytics/checkoutContext.ts tests/purchase-server.test.mjs tests/checkoutContext-server.test.mjs tests/helpers/purchase-server-fake.mjs tests/helpers/purchase-route-harness.mjs
./node_modules/.bin/tsc --noEmit --incremental false
```

합성 Map 기반 Redis 모델은 EVAL 원자 상태변화를 모사한다. 실제 Redis Lua 엔진/운영 Redis 동작을 실행한 검증과 구분해야 한다. HTTP는 메모리에서 가로채며 Production Redis/Groble/GA로 합성 결제 데이터를 보내지 않는다. 실제 webhook handler가 analytics를 호출하는 경로, 실패의 503, Claude101 HTTP 보존까지 시험한다. build와 최종 프런트 통합은 부모 담당이다.

실운영 활성화는 별도 승인과 정확한 스트림 secret, Groble 서명 secret 구성, 실제 전달/귀속 검증이 필요하다. 합성 purchase를 실제 보고 속성으로 전송해 시험하지 않는다. `/debug/mp/collect`의 공식 검증은 보고서에 집계되지 않지만 secret 자체를 검증하지 않으므로 그것만으로 구성 성공을 주장할 수 없다. 이번에는 외부 debug endpoint 호출도 하지 않았다.

## 개발 전/중 직접 확인한 공식 본문 (2026-10-15)

- https://www.groble.im/help/guides/webhook-events — finalAmount 실결제금액, KRW 정수, CARD/FREE, sellerReference/테스트 이벤트.
- https://www.groble.im/help/guides/webhook — HMAC raw bytes·5분·키 회전, `?ref=`, 웹훅 재전송 상태 코드/기간.
- https://developers.google.com/analytics/devguides/collection/protocol/ga4/sending-events — Web measurement_id/client_id/API secret, POST, timestamp와 제한.
- https://developers.google.com/analytics/devguides/collection/protocol/ga4/validating-events — 2xx로 유효성 보장 불가, debug 검증/보고서 제외/API secret 미검증.
- https://developers.google.com/analytics/devguides/collection/ga4/ecommerce — purchase transaction/value/currency/items, refund는 별도 이벤트.

문서 수집 도구의 extraction backend 오류 후 공개 URL의 HTTP GET 본문을 직접 확인했다. 실제 고객 payload나 인증정보는 조회하지 않았다.
