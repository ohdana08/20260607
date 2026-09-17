# 실행·검증·배포

## 로컬에서 지금 실행

Node.js 24 LTS와 npm을 사용한다.

```bash
npm ci
npm run dev:operations
```

http://127.0.0.1:3107/operations 에 접속한다. 로컬 실행은 실제 파일 `.local/operations/YYYY-MM.json`에 저장하며 재시작 후에도 남는다. 이 경로는 Git에서 제외했다. localhost 전용 개발 모드에서는 운영 로그인·운영 Redis 대신 로컬 관리자와 별도 파일을 사용한다. 배포 빌드에서 이 모드는 동작하지 않는다.

`성과 저장 → 새로고침 → 동일 수치 확인`, `영상 추가 → 상태 수정`, `목표 저장 → 역산 변경`으로 사용한다. 수정된 내용은 월별 revision과 변경자·시각이 기록된다. 저장 충돌은 409로 표시되며 새로 불러온 다음 재입력한다.

## 실제 인증·저장소로 실행

```bash
npm run dev
```

Google 로그인과 서버 관리자 권한이 필요하다. 본체의 기존 공개 Auth 설정을 사용한다. `ADMIN_EMAILS` 또는 신뢰할 수 있는 app_metadata에서 관리자임을 확인해야 한다. 새 `/operations` 로그인 복귀 주소가 Supabase의 허용 목록에 들어 있는지 점검한다.

운영에 필요한 새 모듈의 환경변수:

```dotenv
UPSTASH_REDIS_REST_URL=<배포 환경의 Redis REST 주소>
UPSTASH_REDIS_REST_TOKEN=<서버 비밀 저장소에서 주입>
ADMIN_EMAILS=<승인된 관리자 이메일 목록>
```

기존 본체의 AI·공고 수집·결제 환경변수는 기존 배포 설정을 유지한다. 운영 환경변수를 로컬에 복사하지 않았으며 새 키를 발급하지 않았다. Redis 연결이 없으면 503으로 실패한다.

## 검증 명령

```bash
npm run test:operations
npm run test:guards
npx tsc --noEmit
npx eslint app/operations app/api/operations lib/operations tests/operations.test.ts scripts/dev-operations.mjs
npm run build
```

새 모듈의 숫자 계산·권한·본문 크기·입력 오류·동시 수정·실제 로컬 파일 저장을 검사한다. 기존 제품 가드는 그대로 실행한다. 테스트 더블을 사용한 인증 검사는 실제 Google 로그인 E2E와 구분한다.

## 배포 구조

기존 Vercel 프로젝트에 `/operations`와 `/api/operations`가 추가되는 구조다. 별도 DB를 만들거나 고객 데이터를 이전할 필요가 없다. 이 작업에서는 배포·운영 환경변수·실제 결제 설정을 변경하지 않았다.

1. 후보 작업본에 포함된 기존 수정과 신규 운영 모듈을 함께 검토한다.
2. lockfile 기준 설치, 타입·가드·신규 검사, production build를 통과시킨다.
3. 비운영 Redis와 관리자 계정으로 Preview를 검증한다. 실제 운영 Redis를 Preview 검증용으로 쓰지 않는다.
4. 인증 없는 GET/PUT 401, 일반 계정 403, 관리자 저장·재조회, 충돌 409, 오류 503을 확인한다.
5. Redis EVAL이 배포 계정에서 허용되는지 실제 테스트 키로 확인한다. localhost 전용 모드를 켜지 않는다.
6. 대상 배포와 되돌릴 배포를 기록하고 운영 반영을 결정한다.
7. 운영 반영 후 관리자 페이지·API·기존 랜딩·무료 탐색·결제 복귀를 확인한다.

## 복구·확장

- UI/API 장애: 이전 Vercel 배포로 복귀한다. 이번 변경은 기존 결제·공고·이용권 키를 수정하지 않는다.
- 입력 오류: 같은 날짜의 성과를 수정해 새 revision으로 남긴다. 수치를 조용히 삭제하지 않는다.
- 데이터 손상: 백업 월 문서의 schemaVersion·revision·합계를 검사한 뒤 관리자 작업으로 복구한다. 최근 100개 감사 기록은 전체 백업이 아니다.
- 자동 수집 도입: manual_verified와 API 원본을 구분하고 대조 결과를 남긴다. 자동 수집 결과가 불완전하면 이전 수치를 0으로 덮어쓰지 않는다.

## 남은 운영 검증

실제 Google 관리자 로그인, Preview Redis EVAL, 다중 서버 경합, 백업 복구, YouTube/GA4 자동 수집, 주문 귀속 자동 집계는 이번 로컬 검증과 별도다. 기존 발표 생성 의존성의 npm 감사 경고 2건(image-size 및 상위 pptxgenjs)이 남아 있다. 이번에 새 패키지는 추가하지 않았고, 호환성을 깨는 자동 강제 다운그레이드는 하지 않았다. 기존 코드의 서버 생성 이미지 제한을 유지한다.
