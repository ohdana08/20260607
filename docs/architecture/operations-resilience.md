# Operations Auth 장애와 내구성 있는 알림

2026-09-18 구현 후보. 이 문서는 로컬 코드·합성 검증 계약을 설명한다. Queue/DLQ의 hosted 송수신, 배포, 실제 알림 재전달은 아직 실행하지 않았다.

## 인증 실패 분류

Operations는 `getGoogleUser(request, { dependencyErrors: true })`를 사용한다. 토큰 없음·만료·거부는 기존 401, Google 일반 사용자는 기존 403을 유지한다. Auth timeout(2초), 상류 429/5xx, 네트워크 실패, 잘못된 응답은 typed dependency error가 되어 `503/authentication_unavailable`로 반환된다. 이때 운영 저장소는 호출하지 않는다. 다른 라우트의 기본 `getGoogleUser` 계약은 변경하지 않았다.

`auth_verification` 로그는 outcome(timeout/rate_limited/upstream_error/network/invalid_response), timeoutMs, bounded durationMs만 기록한다. 기존 `operations_request`의 requestId·phase=auth·503이 알림 큐로 연결된다. 토큰, URL, 이메일, 사용자 UUID, 상류 응답·오류 문자열은 기록하지 않는다. 동일 Request의 동시 인증은 한 번만 수행하고, 실패 항목을 제거해 다음 확인은 재시도할 수 있다.

## 전달과 보존

- SDK는 `@vercel/queue` 0.5.1로 고정했다. 설치된 exports/types와 공식 SDK 문서를 대조했다.
- Vercel에서 `VERCEL=1`이고 기존 `OPS_SLACK_BOT_TOKEN`, `OPS_SLACK_CHANNEL_ID`가 설정된 5xx만 `operations-alerts-v1`에 보낸다. 로컬·미설정·4xx는 no-op이다. Vercel OIDC를 사용하며 Supabase 서비스 역할 키를 추가하지 않는다.
- payload는 version, requestId, method, phase, status, durationMs, deployment의 7개 키만 허용한다. 형식·enum·정수 범위·길이를 소비자에서 다시 검사한다. 토큰·채널은 큐에 넣지 않는다.
- 보존기간은 **24시간(86,400초)**, publish idempotencyKey는 requestId다. 기본 배포 고정을 유지하므로 Preview/Production과 배포별 메시지가 섞이지 않는다. 메시지가 처리되거나 만료될 때까지 발행 배포를 유지해야 한다.
- 5xx 요청은 큐 ACK를 최대 2초 기다린다. 성공 확인은 `queued`, 실패는 `failed`, 확인 불명은 `unknown`이다. SDK 0.5.1의 send는 AbortSignal을 제공하지 않으므로 대기 만료를 취소 성공으로 표현하지 않는다.
- 실패·확인 불명에는 직접 Slack 전송을 한 번 시도하고 최대 2초 기다린다. `queue_ack`와 `fallback_slack_ack`를 분리해 로그에 남긴다. 따라서 장애 경로의 추가 응답 대기는 최대 약 4초이며 이벤트 루프 지연은 별도다. 원 상태 코드·헤더·저장 결과를 유지한다.
- **At-least-once**다. 큐가 실제 수락했지만 ACK가 늦으면 직접 fallback과 후속 소비자가 같은 requestId를 Slack에 두 번 보낼 수 있다. Slack 성공 후 큐 ACK가 실패해도 재전달될 수 있다. 정확히 한 번 전달을 보장하지 않는다.

## 재시도와 실패 큐

내부 Queue callback 소비자는 deliveryCount=1부터 최대 8회 Slack을 시도한다. SDK visibility timeout은 30초, 함수 maxDuration은 15초다. Slack 시도는 2초 제한이며 정상 실패는 30초부터 지수 backoff를 사용한다. Slack 429의 Retry-After는 줄이지 않는다. 정상 backoff 상한은 1시간이지만 제공자가 지정한 더 긴 대기시간은 그대로 적용한다. 전송 완료 후 잔여 TTL을 다시 계산하고 최종 재시도 간격(backoff와 Retry-After 중 큰 값)이 실패 큐 저장 여유 2초를 포함한 잔여 시간을 넘으면 즉시 실패 큐로 넘긴다.

8회 실패, 보존기간 부족, Retry-After가 남은 보존기간을 초과하면 `operations-alerts-dead-v1`에 허용된 원 메타데이터·attempts·종료 reason을 저장한다. 이 실패 큐도 24시간 보존하며 `dead:${requestId}`로 중복 publish를 억제한다. 원 큐의 requestId 키와 별개이므로 SDK의 키 범위가 topic 단위인지에 의존하지 않는다. **실패 큐 저장 ACK 후에만 원 메시지를 ACK한다.** 실패 큐 publish가 실패하거나 확인되지 않으면 원 메시지는 재전달 대상으로 남고, 횟수 제한 이후에는 Slack을 다시 보내지 않고 실패 큐 저장만 재시도한다.

`operations_alert_dead_letter`의 `outcome=queued`는 별도 실패 큐의 저장 확인을 뜻하고, `persist_unconfirmed`는 확인되지 않은 상태다. malformed payload는 안전한 `invalid_payload` 로그를 남기고 버린다. 공격자가 넣은 원문을 실패 큐에 복사하지 않는다.

실패 큐에는 자동 소비자를 연결하지 않았다. 운영자가 Vercel Queues 관측 화면에서 적체·최대 메시지 나이와 실패 큐를 확인하고, 24시간 안에 별도 승인된 복구 절차를 수행해야 한다. 자동 영구 보관이나 무제한 복구를 보장하지 않는다. Retry-After로 종료한 메시지는 제공자 제한을 다시 확인하기 전에는 재전송하지 않는다. Retry-After 때문에 실패 큐로 넘기는 중 저장이 실패해도 제공자 지연을 줄이지 않으며, 그 대기 중 원 메시지가 만료될 수 있다. 원 큐와 실패 큐가 함께 보존기간 내내 장애라면 메시지가 만료될 수 있다. 최초 enqueue와 직접 fallback이 모두 실패한 경우에도 로그 외 내구성을 주장하지 않는다.

## 검증 경계

합성 테스트는 실제 어댑터·route·HTTP handler를 실행해 인증 분류, 큐 payload 제한, 24시간 TTL/requestId, 재시작 후 재전달, 늦은 ACK와 중복 fallback, 8회 한도, 긴 Retry-After, 실패 큐 handoff 실패 시 미ACK, 비밀값 비노출을 검증한다. SDK 및 Vercel의 실제 보존·내부 callback 격리·OIDC·배포 간 전달은 배포 후 hosted 검증 대상이다. `durationMs`는 큐·Slack 대기 전 요청 처리시간이며 전체 응답 지연이 아니다.

최종 로컬 검증: `test:operations` 78/78, `test:release` 250개 중 249 통과·별도 opt-in PostgreSQL 백업 통합 1개 skip, release-reviewer의 operations 접근 경계 2/2 통과. 수정 파일 ESLint, `git diff --check`, Next.js webpack 프로덕션 빌드와 빌드 타입 검사를 통과했다. `test:backup`을 별도 제공하고 백업 단위 테스트를 `test:release`에도 포함했다. 실제 PG17 백업 통합 검증은 별도 실행 결과로 구분한다.

공식 근거: [Vercel Queue SDK](https://vercel.com/docs/queues/sdk), [Queue concepts](https://vercel.com/docs/queues/concepts), [Slack chat.postMessage](https://docs.slack.dev/reference/methods/chat.postMessage/). SDK의 현재 최대 TTL과 별개로 이 구현은 승인된 24시간만 사용한다.
