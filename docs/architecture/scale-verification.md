# 100배 설계 핵심 구현 검증

작성일 2026-09-17. 운영 배포/환경변수/DB를 변경하지 않았다. 원본 저장소 대신 기존 격리 작업본에 추가했다.

## 실행한 검사

- `npm run test:scale`: 사용량 제한 SDK timeout/저장소 오류/설정 누락·정상 한도, 작업 성공/실패/중단/토큰 거절, RPC 매핑 **12/12 통과**.
- `npm run test:scale:integration`: 실제 로컬 Redis·Postgres에서 **13/13 통과**.
- 수집 RCA 회귀 **24/24**, 기존 제품 guard(DOCX/PPTX/PDF 포함) 통과.
- TypeScript 및 변경 파일/API ESLint 통과. 정적 의존성 검사에서 순환·미해결 import·경계 위반 없음.
- 최종 production build 통과. 기존 경로와 `/operations`가 함께 빌드됨.

### 통합 검사의 의미

10개 캐시 객체에서 100개 동시 요청을 보내 원본 로더가 한 번만 호출됨을 확인했다. 프로세스 객체들은 한 Node 프로세스 안에 있지만 별도의 로컬 상태를 가지며 **Redis Lua와 임대는 실제 서버에서 실행**했다. 서로 다른 클라우드 서버/네트워크 지연을 포함한 실험은 아니다.

Postgres는 독립된 psql 연결을 동시에 사용했다. 12개 작업자가 경쟁해도 설정한 3개 슬롯만 획득했다. 같은 요청 키의 동시 접수 10개는 작업 하나로 합쳐졌고 다른 입력은 거절됐다. 임대 만료 후 재획득·이전 토큰의 완료/갱신/실패 거절·재시도 대기·dead 보관·anon/authenticated 접근 차단을 확인했다. 데이터와 역할은 테스트 전용이다.

## 캐시 부하 실험

[실험 결과](scale-benchmark.json): Node v24.14.1, 합성 공고 3,000행/1,689,781 bytes, 실제 Redis, 원본 조회는 50ms 합성 지연이다. 최초 100회/10객체의 동시 요청은 312ms에 끝났으며 원본 조회 1회였다.

| 입력 속도 | 요청 수 | p95 | 최대 | 예약 실행 지연 p95 |
|---|---:|---:|---:|---:|
| 1회/초 | 3 | 34.85ms | 34.85ms | 2.01ms |
| 10회/초 | 30 | 26.88ms | 28.73ms | 2.76ms |
| 100회/초 | 300 | 3.86ms | 7.07ms | 3.17ms |

각 구간은 3초 동안의 요청 예약이며 전체 구간 원본 조회는 1회였다. 같은 프로세스에서 생성·측정했고 순차 실험의 JIT/캐시 예열 영향이 있다. 특히 1회/초 표본 3개로 지연 분포를 일반화할 수 없다. 결과는 캐시 컴포넌트의 짧은 실험이지 **HTTP·로그인·실제 DB·AI·파일을 포함한 서비스의 p95 또는 100배 처리 성능 증명**이 아니다. 오래된 값 기한/임대/실패는 별도 통합 검사에서 확인했다.

## 실행 방법

프로젝트 루트에서 실행한다. 환경변수 파일을 복사하거나 운영 서비스를 연결하지 않는다.

```sh
npm ci --ignore-scripts
npm run test:scale
docker compose -f infra/scale/compose.yml up -d --wait
```

**새로 생성한 빈 테스트 DB에서 한 번만** 역할과 스키마를 초기화한다. 기존 스키마에는 이 파일을 재적용하지 말고 별도 마이그레이션을 검토한다.

```sh
docker compose -f infra/scale/compose.yml exec -T postgres psql -U scale_lab -d ddakfit_scale_lab -v ON_ERROR_STOP=1 -c 'create role anon; create role authenticated; create role service_role bypassrls;'
docker compose -f infra/scale/compose.yml exec -T postgres psql -U scale_lab -d ddakfit_scale_lab -v ON_ERROR_STOP=1 < infra/scale/jobs.sql
npm run test:scale:integration
npm run benchmark:scale
```

연결은 고정된 테스트 컨테이너/DB와 loopback Redis 포트만 사용한다. 테스트 함수는 환경변수에서 임의 DB 주소를 받아 실행하지 않는다. 각 검사는 서로 다른 키/큐 이름을 만든다. Postgres 데이터는 tmpfs이고 Redis 영속성은 끈 **폐기 가능한 테스트 환경**이므로 이 compose 파일을 운영 배포에 사용하지 않는다. 이번 실행에서는 Word 총 접수 상한을 대기시간 계산에 따라 40, 발표를 20으로 조정하고 로컬 DB에도 동일하게 반영했다.

```sh
docker compose -f infra/scale/compose.yml stop
```

위 중단 명령은 이 테스트 환경만 대상으로 한다. PostgreSQL tmpfs 데이터는 다시 시작하면 초기화가 필요할 수 있다. 컨테이너 이미지 태그는 로컬 검사 편의를 위한 값이며, 실제 작업자 배포는 검증된 digest/런타임으로 고정한다.

## 실제 제품에 연결하기 전

- `PROGRAM_CACHE_ENABLED=on`을 Preview에만 먼저 설정하고 인증/결제 데이터가 캐시에 없는지 확인한다.
- 새 큐 SQL의 service-role 전용 권한은 로컬에서 검증했다. 운영 Supabase의 기본 권한·RLS·PostgREST 노출 설정과 함께 다시 검사한다.
- 작업자 처리기는 아직 실제 유료 생성 코드에 연결하지 않았다. 입력/출력 참조 검증, 주문/원가 예약, 취소 중 실행, 다른 계정 접근을 붙인 후 사용한다.
- 작업자 함수의 AbortSignal을 무시하는 처리기는 임대 만료 후에도 외부 호출을 계속할 수 있다. 강제 종료 가능한 별도 프로세스, 제공자 timeout, 불확정 과금 대조까지 필요하다.
- 후보 인덱스는 운영 DB에 적용하지 않았다. 10만 공고 전체 검색과 기존 3,000행 상한 해소는 별도 단계다.
- 전체 요청 성공률·5xx·사용자 체감 지연과 장애 복구 목표는 미검증이다.

## 상태 기록

- 캐시 선택 경로와 사용량 제한 수정: 로컬 코드에 연결.
- 큐/작업자/복구 핵심: 로컬 구현·통합 검증.
- production build: 통과. 빌드는 실제 배포를 뜻하지 않음.
- 프로덕션 배포·클라우드 큐/작업자·외부 알림: 미실행.
