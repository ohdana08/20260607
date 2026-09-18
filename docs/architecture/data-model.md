# DB 및 저장 스키마

## 현재 저장 구조

다음 표는 로컬 코드가 사용하는 구조다. 운영 DB에 접속해 스키마를 덤프한 결과가 아니다. 이번 작업에서 운영 DB 마이그레이션을 실행하지 않았다.

| 저장소            | 객체·키                                           | 필드·수명                                                                                                                 | 코드 근거                            |
| ----------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Supabase Auth     | 사용자                                            | id, email, app_metadata, identities                                                                                       | lib/auth/googleUser.ts               |
| Supabase Postgres | programs                                          | id, source, external_id, title, summary, target, support_field, region, apply_end, url, form_url, last_seen_at, closed_at | lib/supabase/programs.ts             |
| Supabase Postgres | leads                                             | 회원·문의·유입 관련 기존 CRM 데이터                                                                                       | app/api/lead/signup/route.ts         |
| Redis             | gp:validorder:{orderNo}                           | orderNo, registeredAt, via, status, productId                                                                             | lib/plan/paidAccess.ts               |
| Redis             | gp:paid:{userId} 및 발표 이용권                   | 주문·이메일·인증 시각·사용 공고·QA 구분                                                                                   | paidAccess.ts, presentationAccess.ts |
| Redis             | gp:evidence/strategy/audit/presentation:{orderNo} | 근거·전략·검수·발표 객체. 45일 TTL                                                                                        | lib/plan/artifacts.ts                |
| Redis             | gp:operations:v1:{YYYY-MM}                        | 이번 운영 월 문서. TTL 없음                                                                                               | lib/operations/storage.ts            |

## 이번 구현의 실제 스키마

`operations.schema.json`은 OperationsMonth의 JSON Schema다. Redis 한 키에 한 달 문서를 저장한다. 사용자·고객 원문을 넣지 않고 관리자 UUID, 집계 수치, 영상 계획만 보관한다.

| 객체            | 키       | 제약                                               |
| --------------- | -------- | -------------------------------------------------- |
| OperationsMonth | YYYY-MM  | schemaVersion=1, revision 정수                     |
| Goal            | month    | 실제 달력 날짜, 시작≤마감, 같은 월, 매출·가격 양수 |
| Snapshot        | asOf     | 월별 날짜당 1개. 미래 날짜 금지. 최대 31개         |
| Video           | id       | 월별 100개. 게시 완료는 YouTube https URL 필요     |
| AuditEntry      | revision | 변경 종류·객체 키·관리자 ID·UTC 시각. 최근 100개   |

숫자는 KRW·건수의 안전 정수다. `null`은 미확인, `0`은 확인된 0이다. 유튜브 귀속 주문과 매출은 전체 값 이하로 검증한다. 성공 주문 건수는 취소 이전 주문 수이며, 목표 계산에는 취소·환불을 차감한 금액을 사용한다. 이달 주문 이외의 환불 회계 처리는 별도 원장 범위다.

## 원자성

1. GET으로 현재 문서와 revision을 읽는다.
2. 클라이언트는 수정 요청에 expectedRevision을 넣는다.
3. 서버가 권한과 입력을 검증하고 다음 상태·감사 기록을 구성한다.
4. Redis EVAL이 현재 revision 비교와 SET을 한 실행에서 처리한다.
5. 다르면 409. 같은 요청을 재전송해도 중복 누적하지 않는다.

월별 조회는 단일 키 GET이다. 영상·성과 조회는 최대 100/31개만 메모리 정렬한다. 현재 규모에서는 별도 인덱스가 필요하지 않다. Redis maxmemory 정책으로 영구 기록이 축출되지 않는지, 지속성·백업 설정이 있는지 운영 환경에서 확인해야 한다.

## 관계형 확장 설계

다음은 추후 이전 설계이며 현재 생성된 테이블이 아니다.

```text
operations_months(month PK, schema_version, revision, target_krw,
  start_date, deadline, planned_videos, word_price_krw, updated_at)
performance_snapshots(month FK, as_of, gross_krw, refunds_krw,
  word_orders, bundle_orders, presentation_orders, published_videos,
  views NULL, site_visits NULL, attributed_orders NULL,
  attributed_net_krw NULL, note, PRIMARY KEY(month, as_of))
content_videos(month FK, id, title, planned_date, product, status,
  url, views_24h NULL, views_72h NULL, PRIMARY KEY(month, id))
operation_changes(month FK, revision, kind, object_key, actor_id,
  created_at, PRIMARY KEY(month, revision))
```

이전할 때에는 `UPDATE ... WHERE revision = :expected RETURNING ...`과 하위 행 upsert·감사 기록을 하나의 트랜잭션에 둔다. private schema 또는 RLS+명시적 관리자 정책을 적용하고 anon/authenticated에 광범위한 쓰기 권한을 주지 않는다. 기존 서비스의 Auth user_metadata는 권한 근거로 사용하지 않는다. 마이그레이션은 운영 백업·리허설·이전 결과 대조 후 적용한다.
