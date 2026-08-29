"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { track } from "@/lib/ga";
import { captureUtm } from "@/lib/utm";
import { GROBLE_CHECKOUT_URL, PRICE_KRW, PRICE_LABEL } from "@/lib/config";

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
    "결제 후 유료 맞춤 작성을 시작하기 전에는 청약철회를 요청할 수 있습니다. 별도 동의 후 개인화된 작성 서비스가 시작되면 관련 법령이 허용하는 범위에서 환불이 제한될 수 있으며, 구체적 기준은 환불정책 페이지를 따릅니다.",
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
    q: "정부지원사업 찾기는 정말 무료인가요?",
    a: `네. 내 조건에 맞는 공고 추천, 공고 핵심 확인과 신청 자격 진단까지 무료입니다. 지원할 공고를 정한 뒤 공고 양식에 맞춘 전체 사업계획서 DOCX 초안이 필요할 때만 1건 ${PRICE_LABEL}을 결제합니다.`,
  },
  {
    q: "정부지원사업 공고는 어디에서 찾나요?",
    a: "K-Startup, 기업마당 등 공개된 정부지원사업 모집 공고를 한곳에서 살펴볼 수 있도록 모으고 있습니다. 추천 결과마다 공고 원문 링크를 함께 제공하므로, 최종 신청 전에는 반드시 주관기관의 최신 원문을 확인할 수 있습니다.",
  },
  {
    q: "추천받은 공고는 바로 신청할 수 있는 공고인가요?",
    a: "모집 중인 공고 가운데 입력한 지역·업력·사업단계·관심분야와 가까운 공고를 우선 보여드립니다. 다만 세부 자격과 제출서류는 공고마다 다르고 변경될 수 있으므로, 추천 뒤 무료 자격 진단과 공고 원문을 최종 확인해야 합니다.",
  },
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
    a: "마감이 다가오는 실제 공고가 있고, 매출·고객·거래처·개발·투자·팀 이력 같은 재료는 설명할 수 있지만 이를 공고의 평가항목과 공식 양식에 맞게 배치하기 어려운 대표자에게 가장 적합합니다. 아이템 자체가 없거나 아직 지원할 공고를 고르지 못했다면 무료 추천과 진단부터 이용하세요.",
  },
  {
    q: "사업계획서가 필요 없는 공고도 결제해야 하나요?",
    a: "아닙니다. 장비·공간 예약, 교육·행사 참가처럼 간단 신청만 필요한 공고는 유료 초안 대상으로 열지 않습니다. 무료 분석에서 제출서류를 먼저 확인하고, 사업계획서가 실제로 필요한 공고에만 결제 안내를 보여드립니다.",
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
          <span><b>정부지원사업 찾기·자격 확인 0원</b></span>
          <span>·</span>
          <span>사업계획서 초안은 필요할 때만</span>
        </div>
      </div>

      <header className="header">
        <div className="container nav">
          <a className="brand" href="#top" aria-label="정부지원사업 도우미 홈">
            <span className="brand-mark">BCC</span>
            <span className="brand-copy">
              <strong>딱, 지원핏</strong>
              <span>정부지원사업 도우미</span>
            </span>
          </a>

          <nav className="nav-links" aria-label="주요 메뉴">
            <a href="#why-find">왜 필요한가요?</a>
            <a href="#how-to-find">무료로 찾는 방법</a>
            <a href="#demo">사업계획서 초안</a>
            <a href="#price">가격</a>
            <a href="#faq">FAQ</a>
          </nav>

          <div className="nav-actions">
            <FreeDiagnosisLink className="btn btn-gold btn-sm" location="header">
              내 지원사업 무료로 찾기
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
          <a href="#why-find" onClick={() => setMenuOpen(false)}>왜 필요한가요?</a>
          <a href="#how-to-find" onClick={() => setMenuOpen(false)}>무료로 찾는 방법</a>
          <a href="#demo" onClick={() => setMenuOpen(false)}>사업계획서 초안</a>
          <a href="#price" onClick={() => setMenuOpen(false)}>가격</a>
          <a href="#faq" onClick={() => setMenuOpen(false)}>FAQ</a>
          <FreeDiagnosisLink className="btn btn-gold" location="mobile_menu">
            내 지원사업 무료로 찾기
          </FreeDiagnosisLink>
        </nav>
      )}

      <main>
        <section className="hero">
          <div className="container hero-grid">
            <div>
              <div className="hero-badge">정부지원사업, 어디서 찾아야 할지 모르겠다면</div>
              <h1>
                내가 받을 수 있는
                <br />
                <mark>정부지원사업을</mark>
                <br />
                무료로 찾아보세요.
              </h1>
              <p className="hero-lead">
                지역·업력·사업단계·관심분야 몇 가지만 알려주면 지금 확인할 공고를 먼저 추천하고, 신청 자격과 마감일,
                공고 원문까지 한 번에 보여드립니다.
              </p>
              <div className="hero-actions">
                <FreeDiagnosisLink className="btn btn-gold" location="hero">
                  내 지원사업 무료로 찾기 <span className="arrow">→</span>
                </FreeDiagnosisLink>
                <a className="btn btn-light" href="#how-to-find" onClick={() => track("cta_view_finder", { location: "hero" })}>
                  어떻게 찾아주는지 보기
                </a>
              </div>
              <p className="hero-note">
                <b>결제 없이 공고 추천·자격 확인까지 무료</b> · 사업계획서 초안은 지원할 공고를 정한 뒤 선택하세요.
              </p>
            </div>

            <div className="hero-card-wrap" aria-label="정부지원사업 무료 추천 결과 화면 예시">
              <div className="hero-orbit" aria-hidden="true" />
              <article className="proof-card">
                <div className="proof-head">
                  <small>FREE PROGRAM MATCH</small>
                  <span className="proof-status">무료 추천</span>
                </div>
                <h2>
                  지금 확인할 공고를
                  <br />
                  내 조건에 맞는 순서로
                </h2>
                <div className="proof-sub">부산 · 예비창업 · AI·콘텐츠 · 사업화 희망 예시</div>
                <div className="proof-flow">
                  <div className="proof-row"><b>조건 확인</b><span>지역 · 업력 · 사업단계 · 필요한 지원</span></div>
                  <div className="proof-row"><b>추천 이유</b><span>내 조건과 맞는 항목, 마감일, 지원 내용을 요약</span></div>
                  <div className="proof-row"><b>바로 확인</b><span>신청 자격 진단 · 주관기관 공고 원문 링크</span></div>
                </div>
                <div className="proof-result">
                  <b>추천 결과 화면 예시</b>
                  <p>
                    &ldquo;예비창업 단계와 지역 조건이 맞는 공고입니다. 마감일과 제외 조건을 확인한 뒤 무료 자격 진단을
                    이어가세요.&rdquo;
                  </p>
                </div>
              </article>
            </div>
          </div>

          <div className="hero-trust">
            <div className="container trust-strip">
              <div className="trust-item"><strong>여러 공고를 한곳에서</strong><span>흩어진 모집 공고를 모아 확인</span></div>
              <div className="trust-item"><strong>내 조건부터 맞춤</strong><span>지역·업력·사업단계 기준 추천</span></div>
              <div className="trust-item"><strong>마감일·원문까지</strong><span>요약만 보지 않고 공식 공고 확인</span></div>
              <div className="trust-item"><strong>추천·자격 확인 0원</strong><span>결제 없이 지원할 공고부터 선택</span></div>
            </div>
          </div>
        </section>

        <section className="section" id="why-find">
          <div className="container">
            <div className="max-copy center">
              <span className="eyebrow">WHY IT FEELS HARD</span>
              <h2 className="section-title">
                공고가 없는 게 아니라,
                <br />
                <span className="gold-text">나에게 맞는 공고를 찾기</span> 어려운 겁니다.
              </h2>
              <p className="section-copy">
                정부지원사업은 여러 사이트와 기관에 흩어져 있고, 제목만으로는 내가 신청할 수 있는지 판단하기 어렵습니다.
                그래서 검색보다 먼저 내 조건에 맞춰 거르는 과정이 필요합니다.
              </p>
            </div>

            <div className="pain-grid">
              <article className="pain-card">
                <span className="num">01</span>
                <h3>공고 사이트가 너무 많아<br />어디부터 봐야 할지 모릅니다.</h3>
                <p>기관과 플랫폼마다 흩어진 공고를 매번 찾아다니면 중요한 모집 시기를 놓치기 쉽습니다.</p>
              </article>
              <article className="pain-card">
                <span className="num">02</span>
                <h3>제목만 봐서는<br />내가 받을 수 있는지 모릅니다.</h3>
                <p>지역, 업력, 사업단계와 제외 조건을 읽어야 비로소 신청 가능성을 판단할 수 있습니다.</p>
              </article>
              <article className="pain-card">
                <span className="num">03</span>
                <h3>찾았을 때는 마감이 임박하거나<br />자격이 맞지 않습니다.</h3>
                <p>내 조건과 가까운 공고부터 보고 마감일과 원문을 함께 확인해야 준비할 시간을 확보할 수 있습니다.</p>
              </article>
            </div>
          </div>
        </section>

        <section className="section cream" id="how-to-find">
          <div className="container">
            <div className="max-copy center">
              <span className="eyebrow">FREE FINDER</span>
              <h2 className="section-title">
                어려운 검색어 대신,
                <br />
                <span className="gold-text">내 사업 조건만 알려주세요.</span>
              </h2>
              <p className="section-copy">
                공고 제목을 몰라도 괜찮습니다. 네 단계로 지금 확인할 지원사업과 신청 가능성을 무료로 좁혀드립니다.
              </p>
            </div>

            <div className="process">
              <article className="process-step"><span className="step">STEP 01</span><h3>사업단계 선택</h3><p>예비창업, 창업연차 등 현재 사업 상태를 알려주세요.</p></article>
              <article className="process-step"><span className="step">STEP 02</span><h3>지역·분야 선택</h3><p>소재 지역과 사업 분야, 필요한 지원을 간단히 고릅니다.</p></article>
              <article className="process-step"><span className="step">STEP 03</span><h3>맞는 공고 추천</h3><p>조건이 가까운 모집 공고를 이유와 마감일과 함께 보여드립니다.</p></article>
              <article className="process-step"><span className="step">STEP 04</span><h3>자격·원문 확인</h3><p>무료 진단을 거쳐 주관기관의 최신 공고 원문으로 이동합니다.</p></article>
            </div>

            <div className="center" style={{ marginTop: 38 }}>
              <FreeDiagnosisLink className="btn btn-gold" location="finder_process">
                지금 내 지원사업 찾아보기 <span className="arrow">→</span>
              </FreeDiagnosisLink>
            </div>
          </div>
        </section>

        <section className="section dark" id="demo">
          <div className="container">
            <div className="max-copy">
              <span className="eyebrow">OPTIONAL NEXT STEP</span>
              <h2 className="section-title">
                지원할 공고를 찾았다면,
                <br />
                <span className="gold-text">작성까지 필요할 때만 이용하세요.</span>
              </h2>
              <p className="section-copy">
                공고 찾기와 자격 확인은 계속 무료입니다. 사업계획서 작성이 막힐 때만 내 사업의 증거를 공고 평가항목과 공식
                양식에 배치한 수정 가능한 DOCX 초안을 선택할 수 있습니다.
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
              <span className="eyebrow">AFTER YOU PICK A PROGRAM</span>
              <h2 className="section-title">
                지원할 공고를 골랐다면,
                <br />
                <span className="gold-text">작성 준비 상태도 무료로 보세요.</span>
              </h2>
              <p className="section-copy">
                선택한 공고의 자격과 핵심 조건을 확인하고, 결제 전에 내 사업의 강점과 부족한 자료, 실제 초안 문장 일부까지
                확인할 수 있습니다.
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
                  <div><h3>내 정보가 반영된 문장 1개</h3><p>{PRICE_LABEL} 결제 전에 실제 작성 방향과 문장 수준을 확인합니다.</p></div>
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
                지원사업 찾기부터 무료로 시작 <span className="arrow">→</span>
              </FreeDiagnosisLink>
            </div>
          </div>
        </section>

        <section className="section dark" id="difference">
          <div className="container">
            <div className="max-copy center">
              <span className="eyebrow">WHY DIFFERENT</span>
              <h2 className="section-title">
                아이디어 생성만 하거나 완성본 리뷰만 하는 도구가 아니라,
                <br />
                <span className="gold-text">실제 공고 선택부터 제출 준비까지 잇는 도구</span>입니다.
              </h2>
            </div>

            <div className="difference-grid">
              <article className="difference-card"><span className="tag">01 · 모집 중 공고</span><h3>마감 공고를 걷어내고<br />지금 볼 공고부터</h3><p>지역·업력·단계를 기준으로 모집 중인 공식 공고와 원문을 먼저 좁힙니다.</p></article>
              <article className="difference-card"><span className="tag">02 · 결제 전 자격</span><h3>신청 가능성과 제출서류를<br />무료로 먼저 확인</h3><p>사업계획서가 필요 없는 간단 신청 공고에는 유료 초안 결제를 열지 않습니다.</p></article>
              <article className="difference-card"><span className="tag">03 · 근거 인터뷰</span><h3>아이디어를 꾸미기보다<br />실제 증거를 평가항목에</h3><p>고객·매출·계약·팀 이력을 묻고 확인되지 않은 사실은 보완·증빙 필요로 남깁니다.</p></article>
              <article className="difference-card"><span className="tag">04 · 제출 전 점검</span><h3>공식 목차 DOCX와<br />위험 검토표까지</h3><p>양식 순서를 보존한 초안과 항목별 보완·증빙 목록으로 마지막 확인까지 이어갑니다.</p></article>
            </div>
          </div>
        </section>

        <section className="section cream">
          <div className="container">
            <div className="max-copy center">
              <span className="eyebrow">HOW IT WORKS</span>
              <h2 className="section-title">
                지원할 공고를 정한 다음에도,
                <br />
                <span className="gold-text">신청 준비를 이어갈 수 있습니다.</span>
              </h2>
            </div>

            <div className="process">
              <article className="process-step"><span className="step">STEP 01</span><h3>추천 공고 선택</h3><p>내 조건에 맞는 공고의 지원 내용과 원문을 확인합니다.</p></article>
              <article className="process-step"><span className="step">STEP 02</span><h3>무료 자격 진단</h3><p>필수 요건, 준비 상태와 결격 가능성을 먼저 확인합니다.</p></article>
              <article className="process-step"><span className="step">STEP 03</span><h3>필요할 때 인터뷰</h3><p>초안을 원할 때만 매출, 고객, 개발, 투자와 팀 이력을 답합니다.</p></article>
              <article className="process-step"><span className="step">STEP 04</span><h3>DOCX 초안 생성</h3><p>공식 양식 순서, 확인 필요 항목과 증빙 목록을 함께 제공합니다.</p></article>
            </div>
          </div>
        </section>

        <section className="section" id="price">
          <div className="container">
            <div className="max-copy center">
              <span className="eyebrow">PRICE</span>
              <h2 className="section-title">
                공고 찾기와 자격 확인은 무료,
                <br />
                <span className="gold-text">사업계획서 초안만 선택 결제.</span>
              </h2>
              <p className="section-copy">내게 맞는 공고를 찾는 단계에서 결제를 요구하지 않습니다.</p>
            </div>

            <div className="pricing-wrap">
              <article className="price-card featured">
                <div className="plan">정부지원사업 찾기 + 자격 진단</div>
                <div className="price">0<small>원</small></div>
                <div className="price-desc">내 조건에 맞는 지원사업부터 무료로 확인</div>
                <ul className="price-list">
                  <li>지역·업력·사업단계 맞춤 공고 추천</li>
                  <li>추천 이유와 마감일 확인</li>
                  <li>공고 원문 바로가기</li>
                  <li>공고 필수 자격 확인</li>
                  <li>준비 상태와 부족한 자료 확인</li>
                </ul>
                <FreeDiagnosisLink className="btn btn-gold btn-full" location="pricing_free">
                  내 지원사업 무료로 찾기
                </FreeDiagnosisLink>
              </article>

              <article className="price-card">
                <div className="plan">선택 기능 · 공고 맞춤 DOCX 초안 1건</div>
                <div className="price">{PRICE_KRW.toLocaleString("ko-KR")}<small>원</small></div>
                <div className="price-desc">지원할 공고를 정한 뒤 필요할 때만</div>
                <ul className="price-list">
                  <li>공고·양식 기반 증거 인터뷰</li>
                  <li>원문 목차 순서의 전체 초안</li>
                  <li>[확인 필요] 문장 별도 표시</li>
                  <li>부족한 증빙자료 체크리스트</li>
                  <li>수정 가능한 DOCX 다운로드</li>
                </ul>
                <a
                  className="btn btn-line btn-full"
                  href={PAID_CHECKOUT_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => track("cta_paid_checkout", { location: "pricing_paid" })}
                >
                  공고 맞춤 DOCX 초안 · {PRICE_LABEL}
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
                무료 추천부터 작성까지,
                <br />
                <span className="gold-text">궁금한 질문</span>부터 답합니다.
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
                정부지원사업을 찾고 싶은데,
                <br />
                어디서 찾아야 할지 모르겠다면.
              </h2>
              <p>내 조건만 알려주세요. 맞는 공고 추천과 신청 자격 확인까지 무료로 시작할 수 있습니다.</p>
            </div>
            <div className="final-actions">
              <FreeDiagnosisLink className="btn btn-dark" location="final">
                내 지원사업 무료로 찾기 <span className="arrow">→</span>
              </FreeDiagnosisLink>
              <a className="btn btn-light" href="#how-to-find" onClick={() => track("cta_view_finder", { location: "final" })}>
                무료 추천 과정 다시 보기
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer>
        <div className="container">
          <div className="footer-grid">
            <div>
              <div className="footer-brand"><span className="brand-mark">BCC</span><strong>딱, 지원핏</strong></div>
              <p className="footer-copy">지역·업력·사업단계에 맞는 정부지원사업을 무료로 찾고, 자격과 원문을 확인한 뒤 필요할 때만 공고 맞춤 사업계획서 초안까지 이어가는 도구입니다.</p>
            </div>
            <div>
              <div className="footer-title">SERVICE</div>
              <div className="footer-links"><a href="#how-to-find">무료 공고 찾기</a><a href="#demo">사업계획서 초안</a><a href="#price">가격</a><a href="#faq">FAQ</a></div>
            </div>
            <div>
              <div className="footer-title">LEGAL</div>
              <div className="footer-links"><a href="/terms">이용약관</a><a href="/privacy">개인정보처리방침</a><a href="/refund">환불정책</a><a href="/data-policy">AI·첨부자료 처리 안내</a></div>
            </div>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} 비즈니스커리어컨설팅(BCC) · 대표 오예림 · 사업자등록번호 153-15-01286 ·{" "}
            <a href="https://open.kakao.com/o/gmPptFti" target="_blank" rel="noopener noreferrer">고객문의</a>
          </div>
        </div>
      </footer>

      <div className="sticky-mobile-cta">
        <FreeDiagnosisLink className="btn btn-gold" location="sticky_mobile">
          내 지원사업 무료로 찾기
        </FreeDiagnosisLink>
      </div>
    </div>
  );
}
