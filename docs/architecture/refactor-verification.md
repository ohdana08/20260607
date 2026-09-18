# 리팩터링 변경과 검증 — 2026-09-17

작업본: `~/ddakfit-operations-20260917` · 브랜치 `codex/ddakfit-operations-20260917`.
시작점은 직전 운영 MVP 및 원본에서 보존한 품질 수정이다. HEAD와 비교한 전체 diff를 이번에 새로 작성한 코드로 해석하면 안 된다.

## 실제 적용한 변경

| 변경 | 코드 | 보존 사항 |
| --- | --- | --- |
| LLM 타입과 factory 분리 | [types](../../lib/llm/types.ts), [provider](../../lib/llm/provider.ts) | 공급자·모델 선택, 기존 타입 import 경로 재수출 |
| 문서 데이터 타입 분리 | [documentTypes](../../lib/plan/documentTypes.ts), [docx](../../lib/plan/docx.ts) | PlanDocx 타입 이름·필드·기존 경로, 파일 생성 코드 |
| 수정권 사용 사례 통합 | [revisionService](../../lib/plan/revisionService.ts), [Word wrapper](../../lib/plan/revisions.ts), [발표 wrapper](../../lib/plan/presentationRevisions.ts) | 함수 이름·Redis 키·3/2회·30일·NX·에러·복구 동작 |
| Chat에서 양식 파서 추출 | [formHeadings](../../lib/plan/formHeadings.ts) | 공식 목차 순서, 긴 원문 선택, HWPX 태그·날짜 잡음 제외 |
| 운영 화면 책임 분리 | [화면](../../app/operations/OperationsDashboard.tsx), [양식](../../app/operations/OperationsForms.tsx), [요청·상태 hook](../../app/operations/useOperationsDashboard.ts) | 입력 이름·기본값·저장·오류·월 변경·HTML |
| 구조 회귀 검사 추가 | [분석기](../../scripts/analyze-architecture.mjs) | 새 순환·순수 모듈의 infrastructure 역참조·미해결 내부 import 검사 |

타입 전용 import 이동을 포함한 [소스·검사 변경 목록](refactor-changes.json)을 제공한다. 기존 파일은 위치를 옮기거나 삭제하지 않았다. 새 앱 의존성과 운영 마이그레이션도 추가하지 않았다.

## 전후 수치

정적 분석 대상은 app/components/lib의 TS·TSX이며 파일 끝 빈 줄은 제외한다.

| 측정 | 전 | 후 | 해석 |
| --- | ---: | ---: | --- |
| 소스 파일 | 135 | 142 | 작은 경계 모듈 7개 추가 |
| 내부 의존성 간선 | 364 | 380 | 명시적 타입 모듈·wrapper 연결 증가. 간선 수 자체를 개선 점수로 쓰지 않음 |
| 모든 정적 순환 묶음 | 1 | 0 | LLM 타입 역참조 해소 |
| 타입 전용 간선 제외 순환 | 0 | 0 | 기존에도 실행 import 순환은 발견되지 않음 |
| 운영 화면 본문 | 721줄 | 483줄 | 양식 151줄, 요청·상태 hook 103줄로 책임 분리 |
| Chat | 4,672줄 | 4,641줄 | 순수 파서 추출만 완료. 거대 컴포넌트 해소 완료가 아님 |

## 계약 검사

코드 수정 **전에** 기존 Word·발표 wrapper에서 15개씩 30개 시나리오를 실행해 [고정 관찰 기록](../../tests/fixtures/revision-contracts.json)을 만들었다. 관리자·사용자 없음·미결제·저장소 없음·최초 제공·제공 전 수정·예약/중복 rollback·횟수 한도·만료 경계·동시 요청·409 응답을 포함한다.

변경 후 결과 객체, HTTP 상태·본문, 저장 키·값, 저장 호출 순서가 전부 같았다. Redis·주문 조회·시계만 테스트 대역으로 바꾸고 실제 public wrapper와 공통 서비스를 실행했다. 실제 Upstash 서버 경합 검사는 아니다. 저장소 오류 전파 2개와 목차 파서 3개를 더해 `test:refactor`는 35개다.

시작 소스와 현재 소스를 동일 TypeScript 설정으로 변환해 추가 확인했다.

- API route **40개 전부** 실행 코드 동일. 타입 import 이동으로 URL·요청·응답 로직을 바꾸지 않았다.
- 수정권 wrapper 2개를 제외한 기존 lib 실행 코드 동일. 새 파일은 별도다.
- 운영 UI는 로딩·저장된 0원/영상 계획·충돌 오류 3개 상태에서 React 서버 렌더 HTML이 변경 전과 동일했다. DOM 이벤트·브라우저 상호작용 검증을 대체하지 않는다.

## 실행 결과

| 검사 | 결과 |
| --- | --- |
| `npm run test:refactor` | 35/35 통과 |
| `npm run test:operations` | 37/37 통과 |
| `npm run test:guards` | 기존 제품 회귀 검사 통과, 실제 DOCX/PPTX/PDF 생성 검사 포함 |
| `npm run check:architecture` | 순환 0, 지정된 순수 모듈 경계 위반 0, 미해결 내부 import 0 |
| 변경 소스·검사 37개 ESLint | 통과 |
| `npx tsc --noEmit` | 통과 |
| `npm run build` | production build 통과 |
| 원본 저장소 수정 22개 SHA-256 | 작업 시작과 일치, 원본 보존 |
| 로컬 운영 기록 | revision 3, 사용자 보고 0 및 계획 영상 1개 유지 |

Node의 TypeScript/모듈 형식 감지 경고가 남아 있으며 테스트 실패가 아니다. 전체 레거시 lint 무경고·운영 보안 무결함을 주장하지 않는다.

## 남은 확인과 배포 범위

이번 마지막 브라우저 검증은 Mac 잠금으로 실행할 수 없었다. 이전 MVP의 실제 저장·새로고침·영상 수정·모바일 확인과 이번 코드/서버 렌더 검사를 구분한다. 잠금 해제 후 운영 화면의 월 변경·저장·오류 유지·영상 편집을 다시 확인한다.

실제 Google 로그인·Upstash 다중 인스턴스·Groble 결제/취소·유료 AI 호출은 이번에 실행하지 않았다. 기존 보안 감사 경고 2건도 별도다. 결제 P0 항목은 인수인계 문서의 다음 단계로 남아 있고 수정 완료로 표시하지 않는다.

운영 홈페이지·통합 관리자 메뉴·원격 Git·DB·환경변수·운영 배포를 변경하지 않았다. 이번 변경은 외부 계약을 유지한 로컬 1차 리팩터링이다.
