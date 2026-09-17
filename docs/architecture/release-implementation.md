# Production preflight — Implementation Engineer

검토일: 2026-09-17. 작업본: `/Users/jinjoopwer/ddakfit-operations-20260917`. 비교 기준: `HEAD e2ee1f1` 및 이번 검토 시작 시 누적된 미커밋·신규 파일. 기존 성능 후보 5개만으로 범위를 제한하지 않았다. 원본 프로젝트, 기존 fixture/manifest, 다른 담당자의 변경은 보존했다.

이 문서는 담당 범위의 검토·수정 근거이며 전체 제품의 운영 배포 승인서가 아니다. Architect의 설계 승인 후 수정했고, Reviewer의 최종 독립 재검증 및 Architect의 통합 빌드 결과는 별도 보고서에서 합쳐야 한다.

## 읽은 맥락과 검토 범위

- 공통 `BCC_Brain/CLAUDE.md`, 개발 전체지도, 지금 할 일, `30_dev/BCC_공통개발팀_프로젝트별작업규칙.md`, 작업본 `AGENTS.md`.
- 설치된 Next 16.3.4 문서의 Route Handler, 인증, 캐시 지침. 관련 Supabase 지침과 설치 SDK의 요청·abortSignal 계약.
- `lib/plan`: aiBudget, artifacts, docx, paidAccess, presentation, presentationAccess, presentationExport, presentationRevisions, reviewer, revisionText, revisions, strategy의 누적 변경. 신규 documentTypes, formHeadings, revisionService, revisionTypes를 포함했다. paymentState는 Architect 소유 구현의 호출 계약을 확인했다.
- `lib/llm`: anthropic, openai, provider, research와 신규 types. `lib/viz/svg.ts`.
- `app/api/plan`: audit, chat, diagnose, docx, draft-batch, evidence, fitcheck, presentation/chat·export·generate·order, revise, strategy, verify의 변경.
- `app/api/modoo-2026/draft`, materials. `components/chat/Chat.tsx`, EvidenceDiagnosis, PresentationStudio.
- 추가 배정된 `app/api/lead/prestage/route.ts`, 신규 `lib/leads/prestageReservation.ts`. 실제 인증·결제·artifact 저장 호출을 따라가며 입력과 실패 경계를 확인했다.

타입 추출과 revision service 분리는 기존 계약 비교 테스트로 확인했다. LLM provider·research 변경, DOCX/도식 정규화, 발표자료 freshness, UI 저장 결과 적용 흐름은 호출부와 함께 검토했다. 스타일만의 의견은 결함으로 기록하지 않았다.

## 확인한 결함과 수정

| 분류 | 발생 조건과 영향 | 기원 | 최소 수정 및 전후 근거 |
| --- | --- | --- | --- |
| Major — 주장 근거 검사 우회 | `고객 100명이 사용 중이다`, `다운로드 5000건을 기록했다` 같은 정량 성과에 requiresEvidence=false를 받으면 증빙 요구가 사라졌다. `가입자 100명, 경쟁사 조사는 미정`처럼 실적과 미확인을 섞거나 외부 주장을 초보자 예외로 처리할 수도 있었다. | 누적 presentation 정규화 변경에서 도입된 회귀 | 숫자·고객·실적 관련 근거 필요 판정을 복구했다. 개인 경험·미확인 예외는 외부 자료가 아닌 단일 진술에 한정하고 정량 성과와 혼합된 문장이 예외를 통과하지 못하도록 했다. 순수 미확인/개인 경험, 명시적 미래 계획·가설 계약은 유지했다. 수정 전 첫 6개 테스트 중 5개 실패, 수정 후 6개 통과. |
| Major — 이전 심사 승인 잔류 | 초안 자동 수정이 성공하고 재심사가 실패하면 새 본문에 이전 본문의 승인·점수가 남았다. | Chat의 자동 수정 흐름에서 도입된 회귀 | 수정된 sections를 적용하기 직전에 `setPlanReview(null)`을 호출한다. 실제 generateDraft 함수를 추출해 실행한 테스트에서 이전 승인 잔류를 재현했고, 수정 후 재심사 실패 시 review=null을 확인했다. |
| Major — 발표 핵심 내용 누락 | 허용된 최대 5개 bullet을 전달해도 도식 없는 PPTX/PDF 슬라이드에서 3개만 표시했다. | 발표 export 카드 레이아웃 변경에서 도입된 회귀 | 최대 3열·2행으로 최대 5개 항목을 표시하며 기존 카드 스타일을 유지했다. 실제 PPTX ZIP의 visible slide XML 및 실제 PDF용 SVG 렌더에서 4·5번째 누락을 재현했다. 수정 후 5개 모두 보존된다. 5개 한글 장문 항목의 실제 PDF 렌더 PNG를 육안 확인해 겹침·하단 잘림 없이 확인했다. |
| Major — DB 실패 뒤 리드 영구 유실 | prestage가 Redis NX 영구 완료 marker를 DB insert 전에 기록한다. DB 실패 뒤 재요청은 dup=true 성공을 반환하여 실제 리드가 저장되지 않는다. | HEAD에도 존재한 결함. Reviewer가 실제 route 기반으로 독립 재현 | 30초 pending UUID 예약, DB 성공 뒤 토큰 일치 Lua finalize, 실패 시 토큰 일치 compare-delete로 변경했다. pending 충돌은 503 + Retry-After=5로 응답한다. 기존 숫자 완료 marker는 호환한다. DB 실패→복구 재시도 성공, 경합 중 거짓 dup 금지, 만료 소유자의 삭제·완료 금지, finalize 장애 표시 4개 테스트 통과. |
| Major — 결제 바인딩 경쟁 시 유료 AI 시작 | 사용권 조회 뒤 주문 상태가 바뀌거나 다른 program에 묶였는데도 호출부가 사용 처리 성공을 확인하지 않고 AI를 시작할 수 있었다. | HEAD에도 존재한 read/modify/write 경쟁. 저장 원자화는 Architect 소유 | draft-batch/evidence 및 presentation chat/generate에서 정상 입력·freshness·provider 검증 뒤, AI와 예산 예약 전에 예상 orderNo를 전달해 바인딩 성공을 요구한다. 실패 시 402. presentation consent도 예상 주문에 묶는다. 관리자는 바인딩을 생략한다. 4개 실제 route마다 바인딩 실패 시 budget=0/AI=0, 관리자에서 bind=0을 검증한 8개 테스트 통과. |

담당 범위에서 추가로 확인된 Blocker는 없다. 위의 확인된 Major는 승인된 범위에서 수정했다. Minor 스타일 변경은 하지 않았다. 아래 운영·의존성 제한을 미해결 코드 결함의 부재나 운영 검증 완료로 해석하면 안 된다.

## 발표자료 export 계약과 이미지 파서 경계

`review.exportReady=false`만으로 export를 차단하지 않았다. UI는 현재 내용을 검토용으로 받는 흐름을 명시하며, export route는 검토용 출력에 첫 납품 revision window를 시작하지 않는다. 이 동작은 경계 테스트에서도 유지했다.

제품의 `buildPresentationPptxBuffer` 호출부는 `app/api/plan/presentation/export/route.ts` 하나다. 요청에서 code/programId/format만 선택하고 사용자 소유 저장 artifact·evidence·strategy를 읽은 뒤 digest freshness를 검사한다. 이미지 흐름은 다음과 같다.

```text
저장된 strategy의 텍스트/도식 데이터
  → normalizeStrategyPack (허용된 필드만 재구성)
  → buildCharts (고정 SVG 템플릿 + 텍스트 escape)
  → Resvg.render().asPng()
  → chart.png (base64 PNG, 서버가 정한 width/height)
  → addImage({data: "data:image/png;base64,...", ...고정 배치})
```

추가 테스트는 실제 export route·strategy 정규화·Resvg·PptxGenJS를 실행했다. body의 charts/png/path 및 저장 텍스트에 `.icns`, `.jxl`, `.heif` URL/이미지 태그를 넣었다. 응답은 정상 PPTX였고 addImage에는 path가 없었으며 유일한 embedded media의 magic은 `89504e470d0a1a0a`(PNG)였다. SVG 태그는 escape된 글자로만 남았으며 새 `<image>` resource가 생기지 않았다. 테스트의 외부 fetch는 금지된 상태다.

Architect가 공유한 현재 npm audit의 image-size/PptxGenJS High 경고(GHSA-w3rx-r6r6-pgpr, GHSA-5p2g-fcmc-qvqq)는 의존성 잔존 위험으로 남긴다. 설치된 pptxgenjs 4.0.1 package.json에는 image-size 의존성이 있지만 실제 CJS/ES 배포 코드에는 image-size import가 없었다. 유사한 `getSizeFromImage` 코드는 `currently unused` 주석 안에 있다. 따라서 이번에 확인한 제품 경로에서 해당 공격 이미지 형식의 파서 도달을 재현하지 못했다. 취약점이 패치되었다거나 향후 이미지 업로드 추가에도 안전하다는 의미는 아니다. 의존성 다운그레이드나 임의 교체는 하지 않았다.

## 실패·관측·동시성 계약

- prestage는 Redis 요청당 750ms, DB 요청당 10초 제한을 둔다. stage 컬럼이 없는 오류(42703/PGRST204 + stage 명시)만 컬럼 없는 insert로 fallback한다. 일반 DB 장애를 두 번째 insert로 무조건 반복하지 않는다.
- 새 구조화 로그는 reservation_unavailable, stage_column_missing, insert_failed, reservation_release_failed, dedup_finalize_failed이다. 사용자 이메일·입력·토큰을 로그에 넣지 않는다.
- Redis 예약과 Postgres insert는 분산 트랜잭션이 아니다. DB 성공 뒤 finalize 장애 또는 DB 응답 timeout으로 결과를 확정할 수 없는 경우에는 중복 insert 가능성이 남는다. DB unique/upsert 계약을 추가하지 않은 이번 수정은 exactly-once를 보장하지 않는다. 확정된 DB 저장 성공 후 finalize 실패는 200 + deduplicationPending=true 및 로그로 표시한다. 새 pending marker는 만료되어 영구 차단을 만들지 않는다.
- 기존 영구 숫자 marker는 완료로 호환되므로 이전 장애로 이미 유실된 리드를 이 수정만으로 복구했다고 주장하지 않는다. 실제 고객 자료를 읽거나 marker를 정리하지 않았다.
- paymentState의 Lua·real Redis 원자성 검증은 Architect/Reviewer 담당이다. 이 문서의 8개 caller 테스트는 예상 주문 전달, bind 실패의 비용 차단, 관리자 우회를 검증하며 실제 결제를 실행하지 않는다.

## 최종 수행한 검증

| 명령/검사 | 결과 |
| --- | --- |
| `node --test tests/release-plan.test.mjs` | 22/22 통과: 주장 6, UI 1, 출력 2, export 이미지 경계 1, 유료 AI 바인딩 8, prestage 4 |
| `npm run test:refactor` | 35/35 통과: 문서 제목 및 Word/발표 revision 계약·오류 전파 |
| `npm run test:performance` | 35/35 통과, 기존 before source hash manifest 포함 |
| `npm run test:guards` | 통과: 제품 진입·제출·근거·모의심사·재작성·별도결제·파일 export 검사 |
| `npx tsc --noEmit --incremental false` | 전체 작업본 타입 검사 통과 |
| 대상 9개 제품 파일 + `tests/release-plan.test.mjs` ESLint | 통과. 마지막 이미지 테스트 추가 뒤 해당 테스트 파일 재검사 통과 |
| 실제 합성 출력 | `/private/tmp/release-plan-five-bullets.pptx`, `.pdf`, `.png` 생성. PDF 렌더 PNG 육안 확인. PPTX 실제 ZIP/XML·이미지 바이트 검사 |

수치로 집계되는 로컬 테스트는 이 담당자가 위 단계에서 실행한 92개(22+35+35)다. 제품 보호 스크립트·타입·린트는 별도 관문이다. 원래 fixture와 기존 manifest를 수정하지 않았다. 전체 빌드는 Architect가 현재 최종 후보를 대상으로 실행한다.

운영 인증·실결제·유료 AI·원격 Supabase/Redis·실제 고객 artifact·브라우저 UI·PowerPoint 데스크톱 앱에서의 실사용은 수행하지 않았다. UI 회귀는 실제 함수 실행이며 브라우저 E2E가 아니다. PPTX는 실제 파일을 생성·검사했지만 Office 자체 렌더링을 확인한 것은 아니다.

## 독립 재검증용 최종 SHA-256

다음 9개 제품 파일과 회귀 테스트를 Reviewer에게 인계한다. 다른 담당자가 소유한 paidAccess/presentationAccess/paymentState나 shared test harness는 여기서 수정하지 않았다.

```text
6c0149873b331a935ecc4eb537459673efe39d57fa441af540ed3aafc1bd4270  lib/plan/presentation.ts
29509f5982696e754556fa05253a7b44be8eb2f0a4f012db34641753ddbfc5f3  lib/plan/presentationExport.ts
1fd3e8906e700198342990c5b5c68fd013f145616ab4a801a07313134086997c  components/chat/Chat.tsx
651cba66affe7203564c1c029586f89491a0c07933588c87b18389431208c206  lib/leads/prestageReservation.ts
b1ceb648a7d1d902931f2b5033d11f031b29767e3ce791ba9946f1c751f9789e  app/api/lead/prestage/route.ts
d12359ba76a8160a48cb0a13fcbae46e364c8ab653168cfaa122941d22380132  app/api/plan/draft-batch/route.ts
f6cfa09f7e420ab92d288e57e5c2592e559089e693dde59454e770c063cb3055  app/api/plan/evidence/route.ts
0428058df3e49d4c4f9b7b428a47ba7f5fc265ce75fd26c3de233e310f903982  app/api/plan/presentation/chat/route.ts
2d14cca61076b5b659e54b99c8f2027d57657afabbbfece6ca3efcbfc13e22a5  app/api/plan/presentation/generate/route.ts
95f55ef6bc2c4c88938ad3fef4375509bc0d36b6c2f44d60dba2ebdd9518315e  tests/release-plan.test.mjs
```
