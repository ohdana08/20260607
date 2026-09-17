# Preview 후보 독립 패키징 검토 — 2026-09-17

대상: `/Users/jinjoopwer/ddakfit-operations-20260917`, 기준 HEAD `e2ee1f1f7a8c6c8bc2fecfecf7360e4fde0739de`의 누적 변경. 역할은 읽기 검토와 본 문서 작성이며 제품 수정·Git stage/commit·배포·외부 쓰기를 수행하지 않았다. 기존 심사 기록은 변경하지 않았다.

판정: 검토한 후보의 소스/테스트/증거 해시가 기존 최종 검증과 일치한다. 발견한 CLI 배포 제외 누락은 Architect가 수정했고 실제 CLI 파일 열거로 해소를 확인했다. 남은 image-size 의존성 High는 미해결 경고로 유지하되, 현재 PNG 생성 경계에서 해당 공격 이미지 파서 도달이 확인되지 않아 이 경고 자체를 Preview 중단 사유로 추가하지 않는다. 보호된 Preview 검증과 실제 운영 승격 판단은 별도다.

## 해시 및 재현성

`release-final-verification.json`을 읽고 각 파일 바이트를 다시 SHA-256 계산했다. 누락/불일치 없이 source 94개, test 20개, configuration 4개, evidence 7개, 총 125개가 일치했다. 이 숫자는 모든 저장소 파일의 검토를 의미하지 않으며 manifest가 명시한 범위다. `.vercelignore` 수정은 이후 패키징 보완이므로 기존 증거를 덮어쓰지 않고 아래 별도 해시로 기록한다.

직접 dependencies/devDependencies 27개에 대해 package.json과 lockfile 루트 spec을 대조하고 실제 설치 버전/locked version/spec 만족 여부를 확인했다. 불일치 0개다. `@upstash/ratelimit` 설치 package.json의 `v2.0.8` 표기는 lock의 `2.0.8`과 semver상 동일하다. lockfileVersion은 3이며 Next/React/PptxGenJS/image-size 주요 항목에 integrity가 있다. 설치·lockfile을 바꾸지 않았다.

| 항목 | 현재 값 |
| --- | --- |
| Next / @next/third-parties / eslint-config-next | 16.3.4 |
| React / react-dom | 19.2.4 |
| PptxGenJS | 4.0.1 |
| image-size | 1.2.1 |

이미 수행한 234개 검사는 다시 돌리지 않았다. 이번에는 기존 실제 export 이미지 경계 1개만 독립 재실행해 통과했다. 원래 검증의 실행 결과 자체는 해당 최종 manifest/역할별 문서가 근거다.

## Git 후보와 제외 범위

초기 Git 후보 166개와 이후 Architect의 `.vercelignore` 보완을 확인했다. 본 문서 작성 직전 후보는 167개로 app 33, components 3, lib 42, scripts 8, tests 35, infra 3, docs 39, 루트 설정/README 4개다. 이후 팀 문서 추가나 커밋 단계에서는 숫자가 달라질 수 있다.

- 누적 제품/운영 소스, 신규 helper, 설정, scripts, 자동 회귀 tests/합성 fixtures와 검토 증거 docs, opt-in infra는 Git 후보에 함께 보존하는 것이 타당하다. `release-fixes.patch`는 심사 중 보완만 담으므로 HEAD 기준 전체 후보를 대신할 수 없다.
- `tests/fixtures/`는 재현 가능한 합성/보존 소스 fixture이며 `test-fixtures/` 사용자 검증 자료와 구분한다. 전자는 Git에 포함하고 배포에서는 제외한다. 후자는 기존대로 Git·배포에서 제외한다.
- 실제 `.local/operations/2026-09.json`은 로컬 자료다. 존재/경로만 확인했으며 내용을 읽지 않았다. `.local`, `.tmp`, `.env*`, `.vercel`, 개인 키 파일은 후보에 강제 추가하지 않는다.
- 후보 경로에 로컬·환경·키 경로와 symlink가 없음을 확인했다. 후보의 private-key/provider-token/JWT 정형 패턴 검사에서 발견 0개였다. 패턴 검사에 걸리지 않는 모든 비밀의 부재를 보장하는 결과는 아니다. `.env*` 실제 값·토큰·운영 데이터는 읽거나 출력하지 않았다. 현재 추적 환경 경로는 기존 `.env.example`뿐이다.

## 발견 및 해결: 배포 제외 누락

**Major — CLI 배포에 로컬 운영 자료 포함 가능.** 이전 `.vercelignore`는 `test-fixtures/` 한 줄이었다. 설치 CLI 54.14.2의 `getVercelIgnore`는 기본 제외 목록과 `.vercelignore`/`.nowignore`를 합치며 `.gitignore` 내용은 읽지 않는다. 따라서 Git에서 제외된 실제 `.local/operations/2026-09.json`과 가정한 `.tmp`, `.env`, `.env.preview`, 개인 키 경로가 CLI 업로드 후보가 됐다. 자료 유출이 실제 발생했다고 주장하지는 않는다.

Architect는 `.local/`, `.tmp/`, `.env*`, `.codex/`, `.agents/`, `docs/`, `tests/`, `infra/`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.tsbuildinfo`를 명시 제외했다. 변경 후 **설치 CLI 자체의 `buildFileTree`와 `getVercelIgnore`를 읽기 전용으로 호출**했다. createDeployment/deploy 명령은 호출하지 않았고 외부 fetch는 거절하도록 했다.

- 열거 결과 198개 항목 중 일반 파일 194개. 제외 범주의 일반 파일은 0개다. `.local`, `docs`, `infra`, `tests` 디렉터리명 4개는 빈 디렉터리 항목으로 남지만 내부 파일은 포함되지 않았다.
- 실제 로컬 JSON을 포함한 제외 9개 경로 검사 통과. `app/api/operations/route.ts`, operations page/hook, `lib/operations/http.ts`, `lib/plan/paymentState.ts`, package.json/lock, Next/TS 설정의 포함 검증 통과.
- app/lib/components/Next 설정에 docs/tests/infra import가 없음을 확인했다. package의 build 명령은 `next build`이며 테스트 스크립트는 빌드에 자동 실행되지 않는다. scripts는 유지했다. 배포 후 런타임 성공은 실제 Preview에서 확인해야 한다.

Vercel 공식 문서도 기본 제외 외에는 파일이 업로드되고 `.vercelignore`로 추가 범위를 정한다고 설명한다. `.env.local`은 기본 제외지만 모든 `.env*`나 `.local`이 자동 제외되는 것은 아니다. [배포 제외 문서](https://vercel.com/docs/deployments/vercel-ignore), [CLI 기본 제외 목록](https://vercel.com/docs/builds/build-features).

## 남은 image-size / PptxGenJS High 2개

2026-09-17 `npm audit --omit=dev --json`을 실제 registry에 읽기 실행했다. high 2, critical 0이며 종료코드 1은 남은 경고를 나타낸다. 두 package entry는 image-size와 이를 의존하는 pptxgenjs다. image-size entry에는 아래 advisory 두 건이 들어 있다.

| 공식 advisory | 현상 | 최신 명시 상태 |
| --- | --- | --- |
| [GHSA-w3rx-r6r6-pgpr / CVE-2025-71330](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr) | 조작 ICNS의 길이 0 entry가 offset을 전진시키지 않아 무한 루프/가용성 손실 | affected <=2.0.2, patched None, 2026-08-07 갱신 |
| [GHSA-5p2g-fcmc-qvqq / CVE-2025-71329](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq) | 조작 JXL/HEIF의 box 크기 0 처리에서 무한 루프/가용성 손실 | affected <=2.0.2, patched None, 2026-08-07 갱신 |

현재 설치 1.2.1은 공지의 영향 버전에 해당한다. 설치된 ICNS 루프는 0 길이를 거절하지 않는다. JXL의 partial-stream loop와 공유 findBox 코드도 읽었다. 공유 findBox에는 최소 전진 처리가 있으므로 모든 세부 경로가 동일하게 취약하다고 단정하지 않는다. 공지와 audit가 미해결인 상태를 해소했다고 해석하지 않으며 악성 입력으로 실제 무한 루프를 실행하지 않았다.

PptxGenJS 4.0.1의 package.json에는 image-size가 의존성으로 남는다. 하지만 실제 선택되는 CJS/ES bundle에서 image-size import/require를 찾지 못했고, getSizeFromImage 관련 부분은 주석 처리된 미사용 코드다. 제품 app/lib/components에도 image-size/sizeof 직접 호출이 없다.

제품의 `buildPresentationPptxBuffer` 호출자는 presentation/export route 하나다. route는 요청의 code/programId/format만 고르고 사용자 소유 artifact를 읽는다. 저장 전략은 정규화한 도식 데이터로 재구성되고, 고정 SVG 템플릿과 escape한 텍스트를 Resvg로 PNG 변환한다. PptxGenJS addImage에는 서버 생성 `data:image/png;base64,...`와 고정 배치가 전달되며 요청의 이미지 URL/path/bytes를 전달하지 않는다. 기존 실제 route→정규화→Resvg→PptxGenJS 테스트를 다시 실행하여 임의 이미지 입력 무시와 출력 PNG magic을 확인했다.

따라서 **현재 검토 경로에서 공격자가 ICNS/JXL/HEIF bytes를 해당 parser에 공급하는 경로는 확인되지 않았다**는 한정된 판정이다. 취약 의존성이 패치됐거나 전체 이미지 처리가 안전하다는 판정은 아니다. npm audit의 fixAvailable은 pptxgenjs 2.2.0으로의 SemVer-major 다운그레이드를 제안하므로 호환성 검증 없이 적용하지 않았다. 향후 이미지 업로드/URL 전달, 라이브러리 버전/번들 변경 시 재검토가 필요하다.

## 종료 시 SHA-256

```text
7b12ea6aa3bcc276e381a7f17e5817c4633a66b22ae935c0bf0077bed40ba653  .vercelignore
1976defa4ad55b425b645a5d781ffdff57c882d1d9b81296badde450552b68ef  .gitignore
ce8b976190968ac0c37b38172f0ef022e613750ddfb9578bab0f91314a54420b  package.json
1f5235ecfdc6eb9eedc6e8385e70489cd74ec382e0b03f0fd6df686ceb2a5f6d  package-lock.json
04e84ccf4029d6e903dcc21ea3334347c0bd2fd839228bd0efe113db4f61a389  docs/architecture/release-final-verification.json
873d182a8e2e1c0b5e522ef146117936b96b9b2024667bd4c1de59e2b031d27a  node_modules/pptxgenjs/dist/pptxgen.cjs.js
05844c5625e2cda3b449eb967c2246dd57ca57341886a7c28eeebca263b29bd4  node_modules/pptxgenjs/dist/pptxgen.es.js
5e6a097fca237b0bb3b68a1be920e39a3846c0018d8917658b5ed88590a710e8  node_modules/image-size/dist/types/icns.js
2958da1fbda466a2aff5769e3353dc8da6848ae1be0e1f9ec6cd7af25f759721  node_modules/image-size/dist/types/jxl.js
21c673dbce64e0fe43c27e43442ba1c8da2492c375aa78493357cb80d4d61138  node_modules/image-size/dist/types/heif.js
```

의존 라이브러리의 위 해시는 실제 설치 코드에 대한 검토 근거다. node_modules를 Git이나 CLI 배포 후보에 포함하라는 의미가 아니다. Preview 로그인·독립 저장소·Vercel 원격 설정과 최종 commit/deployment SHA 확인은 각 담당 결과와 합쳐야 한다.
