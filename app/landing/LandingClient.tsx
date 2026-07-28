"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { track } from "@/lib/ga";
import { captureUtm } from "@/lib/utm";
import { GROBLE_CHECKOUT_URL } from "@/lib/config";

// 배포 전 설정 — 실제 URL만 여기서 관리한다.
const FREE_DIAGNOSIS_URL = "/embed"; // 도우미 진단 진입 (app/page.tsx와 동일한 실제 제품 입구)
const PAID_CHECKOUT_URL = GROBLE_CHECKOUT_URL; // 그로블 신상품(RJczGx) 결제 링크 — lib/config.ts 단일 출처

// 확정된 운영정책 6칸 (2026-07-14 반영본 그대로 — 임의 수정 금지)
const POLICY = {
  usagePeriod:
    "이용권 1건은 공고 1건에 대한 초안 생성에 사용됩니다. 초안을 생성한 공고는 이후에도 계속 열어 인터뷰를 이어가거나 DOCX를 다시 내려받을 수 있습니다. 다른 공고의 초안이 필요하면 추가 이용권을 결제하세요.",
  editScope:
    "초안을 생성하기 전까지 인터뷰 답변을 자유롭게 수정할 수 있습니다. 초안 생성 이후에도 같은 공고 기준으로 내용을 보완할 수 있습니다.",
  regeneration: "초안을 생성한 공고는 소진되지 않고 유지되어, 같은 공고의 DOCX를 다시 내려받거나 이어서 작업할 수 있습니다.",
  systemError: "시스템 오류로 초안 생성에 실패한 경우, 사용된 이용권을 복구해 다시 생성할 수 있도록 합니다.",
  refund:
    "초안을 생성하기 전에는 환불이 가능합니다. 초안 생성이 완료된 후에는 디지털 콘텐츠 제공이 이루어진 것으로 보아 환불이 제한될 수 있으며, 구체적 기준은 환불정책 페이지를 따릅니다.",
  dataHandling:
    "입력하신 사업정보와 첨부자료는 초안 생성을 위해 외부 AI 모델(Anthropic)에 전달되며, 초안 생성 목적 외에는 사용하지 않습니다. 보관 기간과 삭제 요청 방법은 개인정보처리방침을 따릅니다.",
};

type DemoKey = "early" | "pre" | "b2g";
interface DemoData {
  tabLabel: string;
  title: string;
  facts: [string, string][];
  mapping: string;
  sentence: string;
  needs: string;
}
const DEMOS: Record<DemoKey, DemoData> = {
  early: {
    tabLabel: "초기창업자",
    title: "초기창업자 · AI 실무교육 서비스",
    facts: [
      ["유료 고객", "27개사"],
      ["재계약 고객", "8개사"],
      ["기관 납품", "2건"],
      ["교육 만족도", "4.6점"],
      ["대표자 관련 경력", "7년"],
    ],
    mapping: "실현가능성에는 유료 고객과 기관 납품 실적을, 성장전략에는 재계약 고객을, 팀 역량에는 기관 수행 경험과 대표자 경력을 배치합니다.",
    sentence:
      "2026년 상반기 유료 고객 27개사를 확보했으며, 이 중 8개사가 추가 계약으로 이어져 초기 수요와 반복 구매 가능성을 확인하였다. 또한 기관 납품 2건을 수행해 개인 고객뿐 아니라 기관 시장으로 확장할 가능성을 검증하였다.",
    needs: "고객 수 집계 기간, 거래 증빙자료, 재계약의 정의, 만족도 조사 응답 인원을 추가로 확인해야 합니다.",
  },
  pre: {
    tabLabel: "예비창업자",
    title: "예비창업자 · 반려견 수제간식 (멍이네 부엌)",
    facts: [
      ["공동구매 참여자", "87명"],
      ["재구매율", "41%"],
      ["리뷰 평점", "4.8점"],
      ["편집숍 입점 제안", "논의 단계"],
      ["매출", "초기 단계"],
    ],
    mapping:
      "문제인식에는 창업자 본인이 반려견 알레르기로 시판 간식을 급여할 수 없었던 개인 경험을, 팀 역량에는 자격증 대신 직접 만들어 먹인 실사용 경험과 레시피 노하우를, 성장전략에는 편집숍 입점 논의를 배치합니다.",
    sentence:
      "반려견 간식 시장은 성장세를 보이고 있으나, 알레르기나 민감한 소화기를 가진 반려견을 위한 안전한 급여 선택지는 여전히 제한적이다. 창업자 본인이 키우는 반려견이 심한 알레르기로 시판 간식을 거의 급여할 수 없었던 경험이 이 문제 인식의 출발점이 되었다. 반려동물 관련 공식 자격증은 보유하고 있지 않으나, 알레르기가 있는 반려견에게 직접 간식을 만들어 먹이며 축적한 레시피 노하우가 핵심 역량이다.",
    needs:
      "[증빙 필요] 편집숍 입점은 현재 논의 단계이며 확정된 계약·MOU가 아닙니다. 입점 확정 시 계약서·확인서로 근거를 보완하세요. 공동구매 참여자·재구매율·리뷰 수치는 판매 데이터·스토어 캡처로 증빙을 첨부하면 설득력이 높아집니다.",
  },
  b2g: {
    tabLabel: "기관 납품형",
    title: "기관 납품형 · 지역 소상공인 데이터 서비스",
    facts: [
      ["지자체 시범사업", "3건"],
      ["참여 점포", "86곳"],
      ["기관 재의뢰", "2건"],
      ["데이터 분석 보고서", "6건"],
      ["운영팀", "대표 포함 3명"],
    ],
    mapping: "실현가능성에는 지자체 시범사업과 참여 점포 수를, 성장전략에는 기관 재의뢰와 확장 모델을, 팀 역량에는 보고서 수행 경험과 운영팀 구성을 배치합니다.",
    sentence:
      "3개 지자체 시범사업을 통해 86개 점포의 데이터를 수집·분석했으며, 사업 종료 후 2개 기관에서 추가 과업을 요청받아 공공기관 대상 반복 수요를 확인하였다. 총 6건의 분석 보고서 납품 경험을 기반으로 지역 단위 확장 모델을 고도화할 계획이다.",
    needs: "시범사업 계약 범위, 참여 점포의 중복 여부, 재의뢰가 실제 계약으로 이어졌는지, 팀원별 담당 역할을 확인해야 합니다.",
  },
};
const DEMO_ORDER: DemoKey[] = ["early", "pre", "b2g"];

const FAQS: { q: string; a: string }[] = [
  {
    q: "실제 고객 사업계획서 비포·애프터는 왜 없나요?",
    a: "사업계획서에는 매출, 거래처, 특허, 투자계획과 같은 민감한 정보가 포함됩니다. 이름을 가려도 여러 정보를 조합하면 특정 사업자를 추정할 수 있어 실제 고객 문서를 홍보에 사용하지 않습니다. 대신 가상 사업 데모와 고객 본인의 비공개 문장 미리보기를 제공합니다.",
  },
  {
    q: "ChatGPT에 공고문을 붙여 넣는 것과 무엇이 다른가요?",
    a: "일반적인 문장 생성보다 공고 자격 확인, 공식 양식 순서, 평가항목별 증거 배치, 확인되지 않은 내용의 [확인 필요] 표시를 중심으로 설계했습니다.",
  },
  {
    q: "사업 아이템만 있고 아직 매출이 없어도 사용할 수 있나요?",
    a: "가능하지만 매출 대신 고객 인터뷰, 사전예약, 테스트 참여자, 개발 현황, 관련 경력처럼 현재 확인 가능한 증거가 있어야 더 구체적인 초안을 만들 수 있습니다. 아이템 자체가 정해지지 않은 단계에는 적합하지 않습니다.",
  },
  {
    q: "초안을 그대로 제출해도 되나요?",
    a: "아닙니다. DOCX 초안은 대표자가 사실관계, 숫자, 증빙자료와 공고의 최신 조건을 최종 확인하고 보완하기 위한 출발점입니다. 선정 또는 합격을 보장하지 않습니다.",
  },
  {
    q: "입력한 사업정보는 어떻게 처리되나요?",
    a: "입력하신 사업정보와 첨부자료는 초안 생성을 위해 외부 AI 모델(Anthropic)에 전달되며, 초안 생성 목적 외에는 사용하지 않습니다. 보관 기간과 삭제 요청 방법은 개인정보처리방침을 따릅니다.",
  },
  {
    q: "어떤 대표자에게 가장 적합한가요?",
    a: "실제 사업 또는 구체화된 아이템이 있고, 매출·고객·거래처·개발·투자·팀 이력 같은 재료는 설명할 수 있지만 이를 특정 공고의 평가항목과 양식에 맞게 배치하기 어려운 대표자에게 적합합니다.",
  },
];

function FreeDiagnosisLink({
  className,
  location,
  children,
}: {
  className: string;
  location: string;
  children: React.ReactNode;
}) {
  return (
    <Link className={className} href={FREE_DIAGNOSIS_URL} onClick={() => track("cta_free_diagnosis", { location })}>
      {children}
    </Link>
  );
}

export default function LandingClient() {
  const [demoKey, setDemoKey] = useState<DemoKey>("early");
  const [menuOpen, setMenuOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const demo = DEMOS[demoKey];

  useEffect(() => {
    captureUtm();
    track("view_landing");
  }, []);

  useEffect(() => {
    document.body.classList.toggle("menu-open", menuOpen);
  }, [menuOpen]);

  function selectDemo(key: DemoKey) {
    setDemoKey(key);
    track("demo_tab_view", { demo_type: key });
  }

  function toggleFaq(i: number) {
    const next = openFaq === i ? null : i;
    setOpenFaq(next);
    if (next !== null) track("faq_open", { question: FAQS[i].q });
  }

  return (
    <div className="landing-root" id="top">
      <div className="notice-bar">
        <div className="container notice-inner">
          <span><b>자격·준비 상태 진단 0원</b></span>
          <span>·</span>
          <span>공고 맞춤 DOCX 초안 1건 39,900원</span>
        </div>
      </div>

      <header className="header">
        <div className="container nav">
          <a className="brand" href="#top" aria-label="정부지원사업 도우미 홈">
            <span className="brand-mark">BCC</span>
            <span className="brand-copy">
              <strong>정부지원사업 도우미</strong>
              <span>비즈니스커리어컨설팅</span>
            </span>
          </a>

          <nav className="nav-links" aria-label="주요 메뉴">
            <a href="#demo">결과 예시</a>
            <a href="#preview">무료 미리보기</a>
            <a href="#difference">차이점</a>
            <a href="#price">가격</a>
            <a href="#faq">FAQ</a>
          </nav>

          <div className="nav-actions">
            <FreeDiagnosisLink className="btn btn-gold btn-sm" location="header">
              무료 진단 시작
            </FreeDiagnosisLink>
            <button
              className="menu-button"
              type="button"
              aria-label="모바일 메뉴 열기"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
            >
              <span />
            </button>
          </div>
        </div>
      </header>

      {!menuOpen ? null : (
        <nav className="mobile-menu" id="mobileMenu" aria-label="모바일 메뉴">
          <a href="#demo" onClick={() => setMenuOpen(false)}>결과 예시</a>
          <a href="#preview" onClick={() => setMenuOpen(false)}>무료 미리보기</a>
          <a href="#difference" onClick={() => setMenuOpen(false)}>차이점</a>
          <a href="#price" onClick={() => setMenuOpen(false)}>가격</a>
          <a href="#faq" onClick={() => setMenuOpen(false)}>FAQ</a>
          <FreeDiagnosisLink className="btn btn-gold" location="mobile_menu">
            무료 진단 시작
          </FreeDiagnosisLink>
        </nav>
      )}

      <main>
        <section className="hero">
          <div className="container hero-grid">
            <div>
              <div className="hero-badge">쓸 내용은 있는데, 어디에 써야 할지 모르는 대표자를 위해</div>
              <h1>
                매출·고객·거래처는 있는데
                <br />
                <mark>사업계획서 어디에 써야 할지</mark>
                <br />
                막혔나요?
              </h1>
              <p className="hero-lead">
                가지고 있는 사업의 증거를 공고 평가항목과 공식 양식 순서에 맞춰 배치하고, 부족한 자료까지 표시한 수정 가능한 DOCX
                초안을 만드세요.
              </p>
              <div className="hero-actions">
                <FreeDiagnosisLink className="btn btn-gold" location="hero">
                  내 공고 무료로 진단하기 <span className="arrow">→</span>
                </FreeDiagnosisLink>
                <a className="btn btn-light" href="#demo" onClick={() => track("cta_view_demo", { location: "hero" })}>
                  가상 결과 예시 먼저 보기
                </a>
              </div>
              <p className="hero-note">
                <b>진단까지 무료</b> · 초안이 필요할 때만 39,900원 · 입력하지 않은 실적은 사실처럼 쓰지 않습니다.
              </p>
            </div>

            <div className="hero-card-wrap" aria-label="증거가 평가항목과 문장으로 변환되는 예시">
              <div className="hero-orbit" aria-hidden="true" />
              <article className="proof-card">
                <div className="proof-head">
                  <small>EVIDENCE MAP</small>
                  <span className="proof-status">가상 데모</span>
                </div>
                <h2>
                  내가 가진 재료를
                  <br />
                  평가항목의 제자리로
                </h2>
                <div className="proof-sub">초기창업기업 · AI 실무교육 서비스 예시</div>
                <div className="proof-flow">
                  <div className="proof-row"><b>입력한 사실</b><span>유료 고객 27개사 · 재계약 8개사 · 기관 납품 2건</span></div>
                  <div className="proof-row"><b>평가항목</b><span>실현가능성 · 성장전략 · 팀 역량으로 분리 배치</span></div>
                  <div className="proof-row"><b>확인 필요</b><span>집계 기간 · 매출 증빙 · 재계약 기준</span></div>
                </div>
                <div className="proof-result">
                  <b>실제 초안 문장 예시</b>
                  <p>
                    &ldquo;2026년 상반기 유료 고객 27개사를 확보했으며, 이 중 8개사가 추가 계약으로 이어져 초기 수요와 반복
                    구매 가능성을 확인하였다.&rdquo;
                  </p>
                </div>
              </article>
            </div>
          </div>

          <div className="hero-trust">
            <div className="container trust-strip">
              <div className="trust-item"><strong>자격부터 확인</strong><span>쓰기 전에 지원 가능 여부부터</span></div>
              <div className="trust-item"><strong>입력 사실 중심</strong><span>없는 숫자와 실적은 만들지 않음</span></div>
              <div className="trust-item"><strong>공식 양식 순서</strong><span>업로드한 공고와 목차 기준</span></div>
              <div className="trust-item"><strong>수정 가능한 DOCX</strong><span>제출 전 직접 검토하고 보완</span></div>
            </div>
          </div>
        </section>

        <section className="section">
          <div className="container">
            <div className="max-copy center">
              <span className="eyebrow">THE REAL PROBLEM</span>
              <h2 className="section-title">
                글을 못 쓰는 게 아니라,
                <br />
                <span className="gold-text">증거를 어디에 배치할지</span> 모르는 겁니다.
              </h2>
              <p className="section-copy">
                일반적인 회사 소개문은 만들 수 있습니다. 문제는 심사위원이 보는 평가항목에 맞춰 매출·고객·거래처·경험을
                재배치하는 일입니다.
              </p>
            </div>

            <div className="pain-grid">
              <article className="pain-card">
                <span className="num">01</span>
                <h3>실적은 많은데<br />전부 성장전략에 몰아넣습니다.</h3>
                <p>고객 검증, 실행 역량, 확장 가능성은 각각 다른 평가항목의 증거입니다.</p>
              </article>
              <article className="pain-card">
                <span className="num">02</span>
                <h3>ChatGPT가 그럴듯한 계획을<br />사실처럼 덧붙입니다.</h3>
                <p>사업계획서는 나중에 증빙을 요구받습니다. 확인되지 않은 내용은 반드시 분리해야 합니다.</p>
              </article>
              <article className="pain-card">
                <span className="num">03</span>
                <h3>공고마다 양식이 다른데<br />일반 목차로 다시 씁니다.</h3>
                <p>좋은 문장보다 먼저 공식 양식의 항목명과 순서를 정확히 따라야 합니다.</p>
              </article>
            </div>
          </div>
        </section>

        <section className="section dark" id="demo">
          <div className="container">
            <div className="max-copy">
              <span className="eyebrow">PRODUCT PROOF</span>
              <h2 className="section-title">
                39,900원을 내면 무엇이 달라지는지
                <br />
                <span className="gold-text">가상 사업으로 먼저 확인하세요.</span>
              </h2>
              <p className="section-copy">
                실제 고객의 민감한 사업계획서를 공개하는 대신, 완전히 가상의 사업정보를 서비스 구조에 맞춰 변환한 예시를
                보여드립니다.
              </p>
            </div>

            <div className="demo-shell">
              <div className="demo-tabs" role="tablist" aria-label="가상 사업 유형 선택">
                {DEMO_ORDER.map((key) => (
                  <button
                    key={key}
                    className={`demo-tab${key === demoKey ? " active" : ""}`}
                    type="button"
                    role="tab"
                    aria-selected={key === demoKey}
                    onClick={() => selectDemo(key)}
                  >
                    {DEMOS[key].tabLabel}
                  </button>
                ))}
              </div>

              <div className="demo-body">
                <article className="demo-panel">
                  <div className="demo-panel-head">
                    <h3>{demo.title}</h3>
                    <span className="fiction-label">실제 고객 자료 아님</span>
                  </div>
                  <div className="fact-list">
                    {demo.facts.map(([label, value]) => (
                      <div className="fact" key={label}>
                        <span>{label}</span>
                        <b>{value}</b>
                      </div>
                    ))}
                  </div>
                </article>

                <article className="demo-panel">
                  <div className="demo-panel-head">
                    <h3>평가항목 배치와 초안</h3>
                    <span className="fiction-label">작동 방식 예시</span>
                  </div>
                  <div className="demo-output">
                    <div className="output-block">
                      <small>평가항목 배치</small>
                      <p>{demo.mapping}</p>
                    </div>
                    <div className="output-block">
                      <small>생성 문장</small>
                      <p>{demo.sentence}</p>
                    </div>
                    <div className="output-block warn">
                      <small>[확인 필요]와 부족한 증빙</small>
                      <p>{demo.needs}</p>
                    </div>
                  </div>
                </article>
              </div>
            </div>
            <p className="demo-caption">
              ※ 위 사례는 개인정보 보호를 위해 실제 고객이 아닌 가상 사업을 설정하고, 그 정보를 실제 도구에 넣어 생성한
              결과입니다. 확인되지 않은 사실에는 [증빙 필요]가 그대로 표시됩니다. 실제 결과는 사용자가 입력한 정보와 선택한
              공고의 공식 양식에 따라 달라집니다.
            </p>
          </div>
        </section>

        <section className="section cream">
          <div className="container">
            <div className="max-copy center">
              <span className="eyebrow">PRIVACY BY PRINCIPLE</span>
              <h2 className="section-title">
                실제 고객의 사업계획서를
                <br />
                <span className="gold-text">홍보용 비포·애프터로 공개하지 않습니다.</span>
              </h2>
              <p className="section-copy">
                이름과 회사명을 가려도 매출, 거래처, 특허, 지역, 기관 실적을 조합하면 특정 사업자를 추정할 수 있기 때문입니다.
              </p>
            </div>

            <div className="privacy-grid">
              <article className="privacy-statement">
                <div className="lock" aria-hidden="true">🔒</div>
                <h3>
                  남의 문서가 아니라
                  <br />
                  내 사업정보로 직접 확인하세요.
                </h3>
                <p>
                  공개 페이지에서는 가상 데모로 작동 방식을 보여주고, 무료 진단 후에는 고객님의 사업정보가 반영된 비공개
                  문장 미리보기를 제공합니다.
                </p>
              </article>

              <div className="privacy-proof">
                <article className="privacy-item">
                  <b>01 · 공개 증거</b>
                  <h4>가상 사업 데모</h4>
                  <p>타인의 사업정보 없이 평가항목 배치와 문장 수준을 확인합니다.</p>
                </article>
                <article className="privacy-item">
                  <b>02 · 개인 증거</b>
                  <h4>내 문장 미리보기</h4>
                  <p>무료 진단 후 입력한 사실이 어떤 문장으로 바뀌는지 확인합니다.</p>
                </article>
                <article className="privacy-item">
                  <b>03 · 구조 증거</b>
                  <h4>생성될 전체 목차</h4>
                  <p>결제 전에 작성될 평가항목과 문서 범위를 확인합니다.</p>
                </article>
                <article className="privacy-item">
                  <b>04 · 안전 증거</b>
                  <h4>[확인 필요] 표시</h4>
                  <p>확인되지 않은 숫자와 계획은 사실처럼 확정하지 않습니다.</p>
                </article>
              </div>
            </div>
          </div>
        </section>

        <section className="section" id="preview">
          <div className="container">
            <div className="max-copy">
              <span className="eyebrow">FREE PERSONAL PREVIEW</span>
              <h2 className="section-title">
                남의 후기를 믿기 전에,
                <br />
                <span className="gold-text">내 결과 일부를 무료로 보세요.</span>
              </h2>
              <p className="section-copy">
                무료 진단을 완료하면 결제 전에 내 사업의 강점, 평가항목 배치, 부족한 자료와 실제 초안 문장 일부를 확인할 수
                있습니다.
              </p>
            </div>

            <div className="preview-layout">
              <div className="preview-list">
                <article className="preview-item">
                  <div className="preview-icon">1</div>
                  <div><h3>강점으로 쓸 수 있는 증거</h3><p>매출, 유료 고객, 재구매, 기관 수행 이력 등 실제 재료를 추립니다.</p></div>
                </article>
                <article className="preview-item">
                  <div className="preview-icon">2</div>
                  <div><h3>증거가 들어갈 평가항목</h3><p>문제인식, 실현가능성, 성장전략, 팀 역량 중 적합한 위치를 보여줍니다.</p></div>
                </article>
                <article className="preview-item">
                  <div className="preview-icon">3</div>
                  <div><h3>부족한 정보와 증빙자료</h3><p>집계 기간, 계약 금액, 조사 인원처럼 확인이 필요한 내용을 분리합니다.</p></div>
                </article>
                <article className="preview-item">
                  <div className="preview-icon">4</div>
                  <div><h3>내 정보가 반영된 문장 1개</h3><p>39,900원 결제 전에 실제 작성 방향과 문장 수준을 확인합니다.</p></div>
                </article>
              </div>

              <article className="personal-card">
                <div className="personal-top"><i /><i /><i /></div>
                <div className="personal-body">
                  <div className="personal-progress"><span>무료 진단 결과</span><span>7/10 완료</span></div>
                  <div className="progress"><span /></div>
                  <div className="personal-summary">
                    <b>활용 가능한 핵심 증거</b>
                    <p>입력하신 &lsquo;유료 고객 12개사&rsquo;는 실현가능성의 시장 검증 근거로 활용할 수 있습니다.</p>
                  </div>
                  <div className="personal-sentence">
                    <small>내 초안 문장 미리보기</small>
                    <p>
                      &ldquo;현재까지 12개 기업과 유료 거래를 진행해 초기 고객 수요를 확인하였다. 다만 거래 기간, 계약
                      금액 및 재계약 여부에 대한 추가 확인이 필요하다.&rdquo;
                    </p>
                  </div>
                  <div className="locked">
                    <span className="lock-badge">나머지 평가항목은 결제 후 전체 DOCX로</span>
                    <div className="locked-lines"><span /><span /><span /><span /></div>
                  </div>
                </div>
              </article>
            </div>

            <div className="center" style={{ marginTop: 38 }}>
              <FreeDiagnosisLink className="btn btn-gold" location="preview">
                내 사업정보로 무료 미리보기 <span className="arrow">→</span>
              </FreeDiagnosisLink>
            </div>
          </div>
        </section>

        <section className="section dark" id="difference">
          <div className="container">
            <div className="max-copy center">
              <span className="eyebrow">WHY DIFFERENT</span>
              <h2 className="section-title">
                그럴듯한 글을 만드는 AI가 아니라,
                <br />
                <span className="gold-text">심사 기준에 증거를 배치하는 도구</span>입니다.
              </h2>
            </div>

            <div className="difference-grid">
              <article className="difference-card"><span className="tag">01 · 자격판정</span><h3>쓰기 전에<br />지원 가능 여부부터</h3><p>공고의 필수 자격과 제한 조건을 먼저 확인해 불필요한 작성을 줄입니다.</p></article>
              <article className="difference-card"><span className="tag">02 · 증거 인터뷰</span><h3>막연한 질문 대신<br />매출·고객·거래처부터</h3><p>실제 사실을 하나씩 확인해 평가항목에 사용할 재료를 수집합니다.</p></article>
              <article className="difference-card"><span className="tag">03 · 양식 보존</span><h3>일반 목차가 아니라<br />공식 양식 순서대로</h3><p>선택한 공고와 업로드한 양식의 항목명·순서에 맞춰 초안을 구성합니다.</p></article>
              <article className="difference-card"><span className="tag">04 · 허위 방지</span><h3>모르는 내용은<br />[확인 필요]로 남김</h3><p>입력하지 않은 실적을 확정하지 않고, 추가 확인할 정보와 증빙을 표시합니다.</p></article>
            </div>
          </div>
        </section>

        <section className="section cream">
          <div className="container">
            <div className="max-copy center">
              <span className="eyebrow">HOW IT WORKS</span>
              <h2 className="section-title">
                공고를 고르고, 사실을 답하면,
                <br />
                <span className="gold-text">양식에 맞춘 초안이 만들어집니다.</span>
              </h2>
            </div>

            <div className="process">
              <article className="process-step"><span className="step">STEP 01</span><h3>공고 선택·업로드</h3><p>신청할 공고와 공식 양식을 기준으로 작업을 시작합니다.</p></article>
              <article className="process-step"><span className="step">STEP 02</span><h3>무료 자격 진단</h3><p>필수 요건, 준비 상태와 결격 가능성을 먼저 확인합니다.</p></article>
              <article className="process-step"><span className="step">STEP 03</span><h3>증거 인터뷰</h3><p>매출, 고객, 거래처, 개발, 투자와 팀 이력을 질문합니다.</p></article>
              <article className="process-step"><span className="step">STEP 04</span><h3>DOCX 초안 생성</h3><p>공식 양식 순서, 확인 필요 항목과 증빙 목록을 함께 제공합니다.</p></article>
            </div>
          </div>
        </section>

        <section className="section" id="price">
          <div className="container">
            <div className="max-copy center">
              <span className="eyebrow">PRICE</span>
              <h2 className="section-title">
                먼저 무료로 확인하고,
                <br />
                <span className="gold-text">내 결과가 필요할 때만 결제하세요.</span>
              </h2>
              <p className="section-copy">무료 진단과 유료 결과물의 범위를 처음부터 분명하게 나눴습니다.</p>
            </div>

            <div className="pricing-wrap">
              <article className="price-card">
                <div className="plan">무료 진단</div>
                <div className="price">0<small>원</small></div>
                <div className="price-desc">지원 가능성과 준비 상태를 먼저 확인</div>
                <ul className="price-list">
                  <li>공고 필수 자격 확인</li>
                  <li>활용 가능한 핵심 증거 요약</li>
                  <li>평가항목 배치 방향</li>
                  <li>부족한 자료와 확인 항목</li>
                  <li>내 정보가 반영된 문장 일부</li>
                </ul>
                <FreeDiagnosisLink className="btn btn-line btn-full" location="pricing_free">
                  무료 진단 시작하기
                </FreeDiagnosisLink>
              </article>

              <article className="price-card featured">
                <div className="plan">공고 맞춤 DOCX 초안 1건</div>
                <div className="price">39,900<small>원</small></div>
                <div className="price-desc">선택한 공고와 공식 양식 기준</div>
                <ul className="price-list">
                  <li>공고·양식 기반 증거 인터뷰</li>
                  <li>원문 목차 순서의 전체 초안</li>
                  <li>[확인 필요] 문장 별도 표시</li>
                  <li>부족한 증빙자료 체크리스트</li>
                  <li>수정 가능한 DOCX 다운로드</li>
                </ul>
                <a
                  className="btn btn-gold btn-full"
                  href={PAID_CHECKOUT_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => track("cta_paid_checkout", { location: "pricing_paid" })}
                >
                  이 공고 맞춤 DOCX 받기 · 39,900원
                </a>
                <div className="price-foot">무료 진단 후 내 문장 미리보기를 확인하고 결제할 수 있습니다.</div>
              </article>
            </div>

            <div className="policy-note">
              <strong>운영정책:</strong> 확인되지 않은 유효기간·재생성·환불·데이터 보관 기준을 임의로 약속하지 않습니다. 아래
              내용은 실제 서비스 기준이며, 세부 조건은 각 정책 페이지(환불정책·개인정보처리방침)를 따릅니다.
            </div>

            <div className="policy-grid" id="policy">
              <article className="policy-card"><small>01 · 이용권</small><h3>사용 가능 기간</h3><p>{POLICY.usagePeriod}</p></article>
              <article className="policy-card"><small>02 · 수정</small><h3>답변 수정 범위</h3><p>{POLICY.editScope}</p></article>
              <article className="policy-card"><small>03 · 재생성</small><h3>동일 공고 재생성</h3><p>{POLICY.regeneration}</p></article>
              <article className="policy-card"><small>04 · 오류</small><h3>파일 생성 실패 처리</h3><p>{POLICY.systemError}</p></article>
              <article className="policy-card"><small>05 · 환불</small><h3>생성 전·후 환불 기준</h3><p>{POLICY.refund}</p></article>
              <article className="policy-card"><small>06 · 자료 처리</small><h3>보관·삭제·AI 전달 범위</h3><p>{POLICY.dataHandling}</p></article>
            </div>
          </div>
        </section>

        <section className="section dark">
          <div className="container founder-grid">
            <article className="founder-card">
              <span className="founder-label">DESIGNED BY BCC</span>
              <h3>
                심사위원이 어디서 탈락시키는지
                <br />
                알기에, 그 판단을 도구에 담았습니다.
              </h3>
              <p>
                이 도구가 다른 AI와 다른 이유는 화려한 문장이 아니라 배치입니다. 어떤 증거를 어느 평가항목에 놓아야 심사를
                통과하는지 — 그 판단 구조를 사업계획서 심사·지도 경험에서 그대로 옮겨 질문으로 만들었습니다.
              </p>
            </article>

            <div className="founder-note-box">
              <div className="founder-note-item">
                <b>심사 관점</b>
                <p>
                  합격하는 사업계획서가 아니라, 심사위원이 <em>탈락시키지 못하는</em> 사업계획서의 구조를 압니다.
                </p>
              </div>
              <div className="founder-note-item">
                <b>증거 배치</b>
                <p>같은 실적도 실현가능성·성장전략·팀 역량 중 어디에 놓느냐로 평가가 갈립니다. 그 자리를 잡아줍니다.</p>
              </div>
              <div className="founder-note-item">
                <b>정직한 초안</b>
                <p>없는 실적을 지어내면 나중에 증빙에서 무너집니다. 확인 안 된 내용은 [확인 필요]로 분리합니다.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="section" id="faq">
          <div className="container">
            <div className="max-copy center">
              <span className="eyebrow">FAQ</span>
              <h2 className="section-title">
                결제 전에 가장 많이
                <br />
                <span className="gold-text">망설이는 질문</span>부터 답합니다.
              </h2>
            </div>

            <div className="faq-list">
              {FAQS.map((item, i) => (
                <article className={`faq-item${openFaq === i ? " open" : ""}`} key={item.q}>
                  <button className="faq-q" type="button" aria-expanded={openFaq === i} onClick={() => toggleFaq(i)}>
                    <span>{item.q}</span>
                    <span>+</span>
                  </button>
                  <div className="faq-a">{item.a}</div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="final-cta" id="diagnosis">
          <div className="container final-inner">
            <div>
              <h2>
                타인의 사업계획서를 믿지 마세요.
                <br />
                내 사업정보가 어떻게 바뀌는지 직접 확인하세요.
              </h2>
              <p>자격과 준비 상태는 무료로 진단하고, 내 문장 미리보기를 확인한 뒤 결제하세요.</p>
            </div>
            <div className="final-actions">
              <FreeDiagnosisLink className="btn btn-dark" location="final">
                내 공고 무료로 진단하기 <span className="arrow">→</span>
              </FreeDiagnosisLink>
              <a className="btn btn-light" href="#demo" onClick={() => track("cta_view_demo", { location: "final" })}>
                가상 결과 예시 다시 보기
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer>
        <div className="container">
          <div className="footer-grid">
            <div>
              <div className="footer-brand"><span className="brand-mark">BCC</span><strong>정부지원사업 도우미</strong></div>
              <p className="footer-copy">매출·고객·거래처·경험 같은 실제 사업의 증거를 특정 공고의 평가항목과 공식 양식에 맞춰 정리하는 사업계획서 초안 도구입니다.</p>
            </div>
            <div>
              <div className="footer-title">SERVICE</div>
              <div className="footer-links"><a href="#demo">결과 예시</a><a href="#preview">무료 미리보기</a><a href="#price">가격</a><a href="#faq">FAQ</a></div>
            </div>
            <div>
              <div className="footer-title">LEGAL</div>
              <div className="footer-links"><a href="/terms">이용약관</a><a href="/privacy">개인정보처리방침</a><a href="/refund">환불정책</a><a href="/data-policy">AI·첨부자료 처리 안내</a></div>
            </div>
          </div>
          <div className="copyright">© {new Date().getFullYear()} Business Career Consulting. All rights reserved. · 사업자 정보와 고객문의 채널은 실제 정보로 교체하세요.</div>
        </div>
      </footer>

      <div className="sticky-mobile-cta">
        <FreeDiagnosisLink className="btn btn-gold" location="sticky_mobile">
          내 공고 무료로 진단하기
        </FreeDiagnosisLink>
      </div>
    </div>
  );
}
