# IR 피치덱·사업계획서 범용 시각화 조사 원장

- 조사일: 2026-09-03
- 목적: 딱지원핏이 업종·단계·근거 수준에 따라 시각화 자료를 선택하고 배치하기 위한 근거 원장
- 범위: 범용 스타트업 IR 및 사업계획서
- 제외: 딥테크 전용 TRL, FTO, 인증, 임상·성능 검증 시각화

## 검증 원칙

1. 사업계획서의 검증된 사실만 시각화한다.
   - 사업계획서에 존재하는 주장이어야 한다.
   - 주장이 실제 증빙 ID와 연결되어야 한다.
   - 출처·산식·단위·기간이 필요한 수치는 모두 확인되어야 한다.
   - 증빙이 부족한 주장은 시각화하지 않고 자료요청으로 돌린다.

2. 고정된 유일한 IR 순서는 없다.
   - YC는 피치덱에 정해진 형식이나 순서가 없다고 명시하면서도 일반적인 구성요소를 제시한다.
   - Sequoia의 구조는 회사 목적 → 문제 → 해결책 → Why now → 시장 → 경쟁 → 사업모델 → 팀 → 재무 → 비전이다.
   - DocSend의 프리시드 데이터는 성공 덱의 흔한 초반 순서가 회사 목적 → Why now → 제품 → 사업모델이었다고 관찰한다.

3. 시각화는 장식이 아니라 주장과 증거를 연결해야 한다.
   - YC는 많은 단어보다 그래픽, 차트, 스크린샷이 강력하다고 설명한다.
   - Techstars는 시연과 핵심 기능 2~3개를 통해 보여주기를 권하고, 최소한의 문구를 권한다.
   - GOV.UK 투자준비 자료는 단순한 시각, 근거 중심 표현, 숫자의 내부 일관성을 강조한다.

4. 시장 시각화의 핵심은 원의 모양이 아니라 산식이다.
   - TAM은 전체 수요의 상한, SAM은 지역·고객·규제·제품 범위상 실제 서비스 가능한 부분, SOM은 전략·자원·성과를 바탕으로 3~5년 안에 획득 가능한 부분이다.
   - SOM은 목표 계정 수 × 연간 계약금액 × 획득률처럼 바텀업으로 설명할 수 있어야 한다.

5. 경쟁은 직접 경쟁사뿐 아니라 고객이 현재 쓰는 간접 대안까지 포함한다.
   - SBA 경쟁분석 가이드는 직접·간접 경쟁, 강점·약점, 진입장벽, 시장점유를 함께 보도록 한다.

6. 지표 시각화는 사업모델에 따라 달라야 한다.
   - SaaS: ARR/MRR, 유지율, ACV/ARPA, 총마진, CAC 회수기간 등.
   - 마켓플레이스: GMV, take rate, net revenue, match rate, 시장 깊이, GMV retention 등.
   - 하드웨어·커머스: 판매단가, 원가, 총마진, 반복구매, 재고회전, 채널별 전환 등.

## 출처별 채택 내용

### Sequoia Capital — Writing a Business Plan

- URL: https://sequoiacap.com/article/writing-a-business-plan
- 채택: 전체 이야기 구조의 대표 아키타입
- 한계: 유일한 정답 순서가 아니라 가이드

### Y Combinator — A Guide to Seed Fundraising

- URL: https://www.ycombinator.com/blog/this-brief-guide-is-a-summary-of-what-startup-founders-need-to-know-about-raising-the-seed-funds-critical-to-getting-their-company-off-the-ground
- 채택: 고정된 순서 없음, 일반 구성요소, 차트·그래픽·스크린샷 우선
- 한계: 시드 투자유치 중심

### Techstars — Master Your Pitch

- URL: https://toolkit.techstars.com/master-your-pitch
- 채택: 보여주기, 제품 데모, 핵심 기능 2~3개, 명확한 요청
- 한계: 라이브 피치 맥락이 강함

### GOV.UK Space Investment Growth Hub — Investor Readiness Essentials

- URL: https://www.gov.uk/government/publications/unlocking-space-for-investment-growth-hub/track-1-investor-readiness-essentials
- 채택: TAM/SAM/SOM 정의와 바텀업 SOM, traction과 재무 스냅샷, 근거 원칙
- 한계: 우주산업·Series A 맥락이므로 범용 정의와 검증원칙만 차용

### DocSend — Anatomy of a Compelling Pitch Deck

- URL: https://www.docsend.com/blog/anatomy-of-a-compelling-pitch-deck/
- 채택: 프리시드 덱의 관찰 데이터, 수익 흐름 시각화, 시장 산정 논리의 중요성
- 한계: 특정 시기·표본의 관찰값이므로 보편 규칙으로 사용하지 않음

### U.S. SBA — Market Research and Competitive Analysis

- URL: https://www.sba.gov/es/guia-de-negocios/planifique-su-empresa/investigacion-de-mercado-y-analisis-competitivo
- 채택: 직접·간접 대안, 진입장벽, 강점·약점, 점유기회

### Bessemer / a16z

- SaaS: https://www.bvp.com/atlas/scaling-from-1-to-10-million-arr
- Marketplace: https://a16z.com/13-metrics-for-marketplace-companies/
- GMV retention: https://a16z.com/gmv-retention-the-marketplace-metric-most-ignore/
- 채택: 사업모델별 KPI 분기
- 한계: 특정 사업모델에만 적용

## 딱지원핏 현재 구현 확인

- 현재 SVG 생성 후보: TAM/SAM/SOM, 운영 프로세스, 경쟁비교, 고객여정, 수익모델, 로드맵, 호환용 퍼널.
- 실제 출력은 최대 6개이며 근거 ID 또는 출처 메모가 없으면 대부분 생성하지 않는다.
- 발표자료 단계 매핑: 시장→TAM/SAM/SOM, 솔루션→프로세스/여정, 경쟁→비교표, 사업모델→수익구조, GTM→퍼널/여정, 로드맵→로드맵.
- 누락: 문제 정량화, Before/After, 제품 스크린샷, traction, 바텀업 시장산식, 가격·마진·unit economics, 포지셔닝 맵, GTM 전환율, 재무 전망, 자금사용-성과 연결, 팀 역량 매핑.
- 구조적 문제: 후보 그래프가 있으면 섹션별로 붙이는 방식이며, 사업계획서 주장과 증빙 연결을 모든 유형에 동일하게 강제하지 않는다. 프로세스·고객여정·수익모델·퍼널은 근거 ID 없이 출처 메모만으로도 생성될 수 있다.

## 최종 판단

딱지원핏의 다음 단계는 시각화 템플릿 수를 무작정 늘리는 것이 아니다. 먼저 `사업계획서 주장 → 증빙 연결 → 검증 통과/실패`를 판정하고, 통과한 자료에 대해서만 `적합한 시각화 → 출처/산식 → 생성`을 수행해야 한다. 데이터가 부족하면 숫자나 차트를 꾸며내지 않고 초안에 필요한 자료와 수집 방법을 표시해야 한다.
