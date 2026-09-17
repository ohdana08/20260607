# API 계약과 기존 경로

새 운영 API의 전체 요청·응답은 [OpenAPI 3.1](operations.openapi.json)에 있다. 기존 API를 일괄 재설계하거나 실제 결제 계약을 변경하지 않았다. 기존 경로의 상세 타입과 오류 조건은 아래 코드가 기준이다.

## 운영 API

`GET /api/operations?month=2026-09`는 `state`, `summary`, `mode`, `source`, `automaticCollection`을 반환한다. month 생략 시 한국 날짜의 현재 월을 사용한다. 기록이 없으면 빈 상태와 미확인을 반환하며 GET이 저장소에 새 데이터를 쓰지는 않는다.

`PUT /api/operations`는 다음 형태다. 헤더는 `Authorization: Bearer <Supabase 사용자 토큰>`, `Content-Type: application/json`을 사용한다. 브라우저는 동일 출처에서 요청한다.

```json
{
  "month": "2026-09",
  "expectedRevision": 0,
  "command": {
    "kind": "goal",
    "value": {
      "month": "2026-09",
      "startDate": "2026-09-17",
      "deadline": "2026-09-30",
      "targetKrw": 1000000,
      "plannedVideos": 14,
      "wordPriceKrw": 29900
    }
  }
}
```

command 종류는 `goal`, `snapshot`, `video`다. 성공하면 새 revision과 계산 결과를 반환한다. 클라이언트는 GET에서 받은 revision을 다음 PUT에 넣는다. 서버가 변경자와 시각을 정하며 클라이언트가 보낸 관리자 여부·변경자는 받지 않는다.

| HTTP | code                         | 처리                           |
| ---- | ---------------------------- | ------------------------------ |
| 200  | 해당 없음                    | 조회·저장 성공                 |
| 400  | invalid_input                | 숫자·날짜·JSON·16KB 한도 확인  |
| 401  | unauthorized                 | 로그인 필요                    |
| 403  | forbidden / origin_forbidden | 관리자 권한 또는 출처 확인     |
| 409  | revision_conflict            | 새로 불러온 뒤 수정 재적용     |
| 503  | storage_unavailable          | 입력 유지, 연결 복구 후 재시도 |

nullable 지표는 반드시 `null` 또는 확인한 숫자를 보낸다. 날짜 간 관계·귀속 금액 상한 등 교차 필드 제약은 JSON Schema에 더해 서버 도메인 검증이 적용된다. 소비자가 계약만으로 쓰기 권한을 우회할 수 없다.

## 기존 주요 경로의 현재 계약 요약

| 경로                    | 주요 입력                                                           | 주요 출력·검증                                                                                                           | 코드                                                |
| ----------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| POST /api/match         | buttonProfile의 years, region, supportType 및 선택적 sector·bizDesc | Google 로그인, 요청 제한, 공식 공고 추천. 아이템 설명은 추천 정렬에 사용                                                 | [match](../../app/api/match/route.ts)               |
| POST /api/plan/fitcheck | messages, program, provider                                         | Google 로그인, 요청 제한, 공고·자격·제출유형 확인용 AI 응답                                                              | [fitcheck](../../app/api/plan/fitcheck/route.ts)    |
| GET /api/order/verify   | 기존 인증 헤더                                                      | paid, loggedIn, orderNo, usedProgramId. 기존 코드에서 최근 주문 연결이 발생할 수 있어 단순 통계 조회용으로 사용하지 않음 | [order/verify](../../app/api/order/verify/route.ts) |
| POST /api/order/verify  | orderNo                                                             | 로그인·형식·요청 제한·기존 주문 확인 후 이용권 연결 결과                                                                 | [order/verify](../../app/api/order/verify/route.ts) |
| POST /api/plan/docx     | programId, title, sections, acknowledgements 등                     | 기존 유료 권한과 최신 근거·전략·검수 일치 확인 후 DOCX. 확인 누락·변경된 초안은 409                                      | [docx](../../app/api/plan/docx/route.ts)            |

그 밖의 작성·근거·모의심사·수정·발표 API는 `app/api/plan`에 유지한다. 전체 시스템 흐름은 [시스템 설계](system-design.md)를 참고한다. 이번 OpenAPI의 적용 범위는 신규 운영 모듈이며, 기존 전체 API가 새 스키마로 재검증됐다는 의미는 아니다.
