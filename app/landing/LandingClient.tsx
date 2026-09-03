"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { track } from "@/lib/ga";
import { captureUtm } from "@/lib/utm";
import { isReturningFromPayment } from "@/lib/paymentReturn";
import {
  BUNDLE_PRICE_KRW,
  BUNDLE_PRICE_LABEL,
  GROBLE_BUNDLE_CHECKOUT_URL,
  GROBLE_CHECKOUT_URL,
  PRESENTATION_PRICE_KRW,
  PRESENTATION_PRICE_LABEL,
  PRICE_KRW,
  PRICE_LABEL,
} from "@/lib/config";
import { PLAN_OUTCOME_NOTICE, PLAN_REVISION_NOTICE } from "@/lib/plan/productPolicy";

// 배포 전 설정 — 실제 URL만 여기서 관리한다.
const FREE_DIAGNOSIS_URL = "/embed?start=find"; // 지원사업을 모르는 사람: 무료 찾기부터 시작
const DIRECT_DIAGNOSIS_URL = "/embed?start=direct"; // 이미 지원할 공고가 있는 사람: 공고 확인부터 시작
const PAID_CHECKOUT_URL = GROBLE_CHECKOUT_URL; // 그로블 신상품(RJczGx) 결제 링크 — lib/config.ts 단일 출처

// 유료 사업계획서 계약 범위와 실제 시스템 제한을 한곳에서 관리한다.
const POLICY = {
  usagePeriod:
    "이용권 1건은 동일 공고·동일 사업아이템·동일 양식의 사업계획서 1건에 사용됩니다. 다른 공고나 다른 사업아이템은 별도 주문입니다.",
  editScope:
    PLAN_REVISION_NOTICE,
  regeneration:
    "필수 근거 점검을 통과한 최초 최종 Word 1회를 제공합니다. 여러 요청을 모아 한 번에 제출하는 묶음 수정이며, 새로운 공고·아이템 변경·전면 재작성은 포함되지 않습니다.",
  systemError:
    "시스템 오류로 생성·수정에 실패한 호출은 수정 횟수로 차감하지 않습니다. 오류 직전까지 작성된 내용은 유지합니다.",
  refund:
    "결제 후 유료 맞춤 작성을 시작하기 전에는 청약철회를 요청할 수 있습니다. 별도 동의 후 개인화된 작성 서비스가 시작되면 관련 법령이 허용하는 범위에서 환불이 제한될 수 있으며, 구체적 기준은 환불정책 페이지를 따릅니다.",
  dataHandling:
    "입력하신 사업정보와 첨부자료는 작성을 위해 선택한 외부 AI 모델에 전달되며, 작성 목적 외에는 사용하지 않습니다. 보관 기간과 삭제 요청 방법은 개인정보처리방침을 따릅니다.",
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
    a: `네. 나에게 맞는 지원사업 찾기, 내가 신청해도 되는지 확인하기, 마감일과 준비할 서류 확인까지 무료입니다. 지원할 사업을 고른 뒤 사업계획서가 필요할 때만 최초 최종 Word 1회와 묶음 AI 수정 최대 3회가 포함된 ${PRICE_LABEL} 상품을 결제합니다.`,
  },
  {
    q: "정부지원사업 공고는 어디에서 찾나요?",
    a: "K-Startup, 기업마당 등 공개된 정부지원사업 모집 공고를 한곳에서 살펴볼 수 있도록 모으고 있습니다. 추천 결과마다 공고 원문 링크를 함께 제공하므로, 최종 신청 전에는 반드시 주관기관의 최신 원문을 확인할 수 있습니다.",
  },
  {
    q: "추천받은 지원은 바로 신청할 수 있나요?",
    a: "현재 신청을 받는 지원 가운데 사업을 시작한 시기, 지역, 지금 하는 일과 가까운 것을 먼저 보여드립니다. 다만 세부 조건과 내야 할 서류는 달라질 수 있으므로, 추천 뒤 내가 신청해도 되는지 무료로 확인하고 공식 안내문을 최종 확인해야 합니다.",
  },
  {
    q: "실제 고객 사업계획서 비포·애프터는 왜 없나요?",
    a: "사업계획서에는 매출, 거래처, 특허, 투자계획과 같은 민감한 정보가 포함됩니다. 이름을 가려도 여러 정보를 조합하면 특정 사업자를 추정할 수 있어 실제 고객 문서를 홍보에 사용하지 않습니다. 대신 가상 사업 데모와 고객 본인의 비공개 문장 미리보기를 제공합니다.",
  },
  {
    q: "ChatGPT에 지원사업 안내문을 붙여 넣는 것과 무엇이 다른가요?",
    a: "대표님에게는 쉬운 질문만 드리고, 뒤에서는 공식 안내문의 조건과 작성 파일 순서를 확인합니다. 고객·매출·계약처럼 실제로 해낸 일을 담당자가 찾기 쉬운 자리에 넣고, 확인되지 않은 내용은 [확인 필요]로 남깁니다.",
  },
  {
    q: "사업 아이템만 있고 아직 매출이 없어도 사용할 수 있나요?",
    a: "가능하지만 매출 대신 고객 인터뷰, 사전예약, 테스트 참여자, 개발 현황, 관련 경력처럼 현재 확인 가능한 증거가 있어야 더 구체적인 초안을 만들 수 있습니다. 아이템 자체가 정해지지 않은 단계에는 적합하지 않습니다.",
  },
  {
    q: "최종 Word를 받으면 선정이 보장되나요?",
    a: `필수 근거 점검을 통과한 Word만 내려받을 수 있지만, 대표자가 사실·숫자·증빙과 최신 신청 조건을 최종 확인해야 합니다. ${PLAN_OUTCOME_NOTICE}`,
  },
  {
    q: "발표자료도 사업계획서 가격에 포함되나요?",
    a: `아닙니다. ${PRICE_LABEL} 사업계획서 상품은 최종 Word와 묶음 AI 수정 3회까지입니다. 발표평가가 필요한 이용자만 Word 완성 후 PPTX·PDF·발표 대본·예상 질문과 답변이 포함된 ${PRESENTATION_PRICE_LABEL} 추가상품을 선택할 수 있습니다. 처음부터 둘 다 필요하면 ${BUNDLE_PRICE_LABEL} 묶음 상품을 선택할 수 있습니다.`,
  },
  {
    q: "입력한 사업정보는 어떻게 처리되나요?",
    a: "입력하신 사업정보와 첨부자료는 근거 확인·전략 설계·문서 작성을 위해 선택한 외부 AI 모델에 전달됩니다. 경쟁정보 조사는 개인정보와 비공개 사업정보를 제외한 일반 검색어로 공개 페이지에서만 진행하며, 출처 URL과 확인일을 남깁니다. 보관 기간과 삭제 요청 방법은 개인정보처리방침을 따릅니다.",
  },
  {
    q: "어떤 대표자에게 가장 적합한가요?",
    a: "지원사업을 어디서 찾아야 할지 모르는 대표자부터, 이미 지원할 공고가 있어 자격·공식 양식·확인 자료를 빠르게 정리해야 하는 대표자까지 이용할 수 있습니다. 찾기와 신청 가능 여부 확인은 무료이며, 긴 사업계획서가 필요한 경우에만 최종 Word 작성으로 이어집니다.",
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
    if (
      isReturningFromPayment({
        search: window.location.search,
        referrer: document.referrer,
        storage: window.localStorage,
      })
    ) {
      window.location.replace("/embed?payment=complete");
      return;
    }
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
          <span><b>받을 수 있는 지원 찾기·신청 가능 여부 확인 0원</b></span>
          <span aria-hidden="true">·</span>
          <span>사업계획서 작성은 필요할 때만</span>
          <span className="notice-divider" aria-hidden="true">|</span>
          <Link
            href="/modoo-2026"
            className="campaign-link"
            onClick={() => track("modoo_campaign_click", { location: "top_notice" })}
          >
            <b>모두의창업은 별도 입구에서 준비하기 →</b>
          </Link>
        </div>
      </div>

      <header className="header">
        <div className="container nav">
          <a className="brand" href="#top" aria-label="정부지원사업 도우미 홈">
            <span className="brand-mark">BCC</span>
            <span className="brand-copy">
              <strong>딱, 지원핏</strong>
              <span>쉬운 정부지원사업 길잡이</span>
            </span>
          </a>

          <nav className="nav-links" aria-label="주요 메뉴">
            <a href="#why-find">왜 필요한가요?</a>
            <a href="#how-to-find">어떻게 찾나요?</a>
            <a href="#demo">사업계획서 작성</a>
            <a href="#price">가격</a>
            <a href="#faq">FAQ</a>
          </nav>

          <div className="nav-actions">
            <FreeDiagnosisLink className="btn btn-gold btn-sm" location="header">
              3분 만에 받을 수 있는 지원 보기
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
          <a href="#how-to-find" onClick={() => setMenuOpen(false)}>어떻게 찾나요?</a>
          <a href="#demo" onClick={() => setMenuOpen(false)}>사업계획서 작성</a>
          <a href="#price" onClick={() => setMenuOpen(false)}>가격</a>
          <a href="#faq" onClick={() => setMenuOpen(false)}>FAQ</a>
          <FreeDiagnosisLink className="btn btn-gold" location="mobile_menu">
            3분 만에 받을 수 있는 지원 보기
          </FreeDiagnosisLink>
        </nav>
      )}

      <main>
        <section className="hero">
          <div className="container hero-grid">
            <div>
              <div className="hero-badge">정부지원사업을 몰라도 괜찮아요</div>
              <h1>
                사업 얘기부터 하세요.
                <br />
                지금 신청할 수 있는 지원을
                <br />
                <mark>찾아드립니다.</mark>
              </h1>
              <p className="hero-lead">
                사업을 시작한 시기, 지역, 지금 하는 일과 필요한 도움만 편하게 알려주세요. 현재 모집 중인 지원을 찾고,
                신청 가능 여부와 빠진 사실과 자료를 쉬운 말로 확인합니다.
              </p>
              <div className="hero-actions">
                <FreeDiagnosisLink className="btn btn-gold" location="hero">
                  3분 만에 받을 수 있는 지원 보기 <span className="arrow">→</span>
                </FreeDiagnosisLink>
                <Link
                  className="btn btn-light"
                  href={DIRECT_DIAGNOSIS_URL}
                  onClick={() => track("cta_direct_program", { location: "hero" })}
                >
                  이미 보고 있는 지원사업이 있어요
                </Link>
              </div>
              <p className="hero-note">
                <b>찾기와 신청 가능 여부 확인은 무료</b> · 공식 사업계획서가 필요한 경우에만 {PRICE_LABEL}입니다.
              </p>
            </div>

            <div className="hero-card-wrap" aria-label="정부지원사업 무료 추천 결과 화면 예시">
              <div className="hero-orbit" aria-hidden="true" />
              <article className="proof-card">
                <div className="proof-head">
                  <small>PLAIN LANGUAGE GUIDE</small>
                  <span className="proof-status">쉬운 말 안내</span>
                </div>
                <h2>
                  대표님의 말로 듣고,
                  <br />
                  어려운 말은 우리가 바꿉니다
                </h2>
                <div className="proof-sub">“부산에서 AI 교육을 하고 싶고, 처음 고객을 만날 돈이 필요해요.”</div>
                <div className="proof-flow">
                  <div className="proof-row"><b>대표님</b><span>평소 쓰는 말로 사업 이야기를 합니다</span></div>
                  <div className="proof-row"><b>딱지원핏</b><span>신청할 수 있는 지원과 확인할 조건·자료를 설명합니다</span></div>
                  <div className="proof-row"><b>마지막 문서</b><span>필요할 때만 공식 사업계획서 말투로 바꿉니다</span></div>
                </div>
                <div className="proof-result">
                  <b>결과는 이렇게 말합니다</b>
                  <p>
                    &ldquo;지금 정보로는 신청해볼 만해요. 다만 사업자등록 시기 한 가지만 공식 안내문에서 확인하면 돼요.&rdquo;
                  </p>
                </div>
              </article>
            </div>
          </div>

          <div className="hero-trust">
            <div className="container trust-strip">
              <div className="trust-item"><strong>어려운 검색어 필요 없음</strong><span>평소 쓰는 말로 질문에 답하기</span></div>
              <div className="trust-item"><strong>여러 사이트를 한곳에서</strong><span>흩어진 모집 정보를 모아 확인</span></div>
              <div className="trust-item"><strong>마감일·공식 안내까지</strong><span>쉬운 설명 뒤 원문도 함께 확인</span></div>
              <div className="trust-item"><strong>찾기·신청 확인 0원</strong><span>긴 문서가 필요할 때만 선택 결제</span></div>
            </div>
          </div>
        </section>

        <section className="section" id="why-find">
          <div className="container">
            <div className="max-copy center">
              <span className="eyebrow">WHY IT FEELS HARD</span>
              <h2 className="section-title">
                지원이 없는 게 아니라,
                <br />
                <span className="gold-text">어려운 말 속에서 내 것을 찾기</span> 힘든 겁니다.
              </h2>
              <p className="section-copy">
                정부지원사업은 여러 사이트에 흩어져 있고, ‘사업화·업력·판로·실증’ 같은 말부터 낯섭니다.
                딱지원핏은 대표님에게 공부를 시키지 않고, 평소 쓰는 말로 필요한 내용을 확인합니다.
              </p>
            </div>

            <div className="pain-grid">
              <article className="pain-card">
                <span className="num">01</span>
                <h3>사이트가 너무 많아<br />어디부터 봐야 할지 모릅니다.</h3>
                <p>기관마다 흩어진 모집 정보를 매번 찾아다니면 나에게 맞는 지원과 신청 시기를 놓치기 쉽습니다.</p>
              </article>
              <article className="pain-card">
                <span className="num">02</span>
                <h3>처음 보는 말이 많아<br />읽어도 내 얘기인지 모르겠습니다.</h3>
                <p>사업자등록한 시기, 지역, 전에 받은 지원처럼 실제로 확인할 내용을 쉬운 질문으로 바꿔야 합니다.</p>
              </article>
              <article className="pain-card">
                <span className="num">03</span>
                <h3>무엇을 준비해야 할지 몰라<br />매번 마감 직전에 급해집니다.</h3>
                <p>내 조건과 가까운 지원부터 보고, 신청 자격과 준비할 서류를 미리 확인해야 마감 전에 움직일 수 있습니다.</p>
              </article>
            </div>
          </div>
        </section>

        <section className="section cream" id="how-to-find">
          <div className="container">
            <div className="max-copy center">
              <span className="eyebrow">FREE FINDER</span>
              <h2 className="section-title">
                지원사업 이름 대신,
                <br />
                <span className="gold-text">대표님의 사업 이야기만 들려주세요.</span>
              </h2>
              <p className="section-copy">
                어려운 용어를 몰라도 괜찮습니다. 아래 질문에 답하면 지금 받을 수 있는 지원부터 무료로 좁혀드립니다.
              </p>
            </div>

            <div className="process">
              <article className="process-step"><span className="step">STEP 01</span><h3>언제 시작했나요?</h3><p>아직 사업자등록 전인지, 등록했다면 얼마나 됐는지 고릅니다.</p></article>
              <article className="process-step"><span className="step">STEP 02</span><h3>무엇이 필요한가요?</h3><p>제품을 만들 돈, 팔 곳, 일할 공간처럼 가장 가까운 말을 고릅니다.</p></article>
              <article className="process-step"><span className="step">STEP 03</span><h3>무엇을 파나요?</h3><p>지금 팔거나 앞으로 팔고 싶은 것을 친구에게 말하듯 한 줄로 적습니다.</p></article>
              <article className="process-step"><span className="step">STEP 04</span><h3>받을 수 있는 지원 보기</h3><p>쉽게 풀어쓴 설명, 신청 가능 여부, 마감일과 공식 안내문을 함께 봅니다.</p></article>
            </div>

            <div className="center" style={{ marginTop: 38 }}>
              <FreeDiagnosisLink className="btn btn-gold" location="finder_process">
                3분 만에 받을 수 있는 지원 보기 <span className="arrow">→</span>
              </FreeDiagnosisLink>
            </div>
          </div>
        </section>

        <section className="section dark" id="demo">
          <div className="container">
            <div className="max-copy">
              <span className="eyebrow">OPTIONAL NEXT STEP</span>
              <h2 className="section-title">
                지원할 사업은 정했지만,
                <br />
                <span className="gold-text">사업계획서 작성이 막혔나요?</span>
              </h2>
              <p className="section-copy">
                매출·고객·거래처 같은 자료는 있지만 어디에 써야 할지 모르거나 마감이 다가오는데 작성이 끝나지 않았다면,
                선택한 지원사업의 공식 양식에 맞추고, 근거 점검을 통과한 수정 가능한 최종 Word를 이용할 수 있습니다.
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
                    <h3>대표님의 말이 문서로 바뀐 모습</h3>
                    <span className="fiction-label">최종 문서 예시</span>
                  </div>
                  <div className="demo-output">
                    <div className="output-block">
                      <small>최종 사업계획서에서 쓰일 공식 항목</small>
                      <p>{demo.mapping}</p>
                    </div>
                    <div className="output-block">
                      <small>생성 문장</small>
                      <p>{demo.sentence}</p>
                    </div>
                    <div className="output-block warn">
                      <small>[확인 필요]와 더 준비할 자료</small>
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
                  공개 페이지에서는 가상 데모로 작동 방식을 보여주고, 무료 확인 후에는 고객님의 사업정보가 반영된 비공개
                  문장 미리보기를 제공합니다.
                </p>
              </article>

              <div className="privacy-proof">
                <article className="privacy-item">
                  <b>01 · 공개 증거</b>
                  <h4>가상 사업 데모</h4>
                  <p>타인의 사업정보 없이 어떤 내용이 어느 자리에 들어가는지와 문장 수준을 확인합니다.</p>
                </article>
                <article className="privacy-item">
                  <b>02 · 개인 증거</b>
                  <h4>내 문장 미리보기</h4>
                  <p>무료 확인 후 입력한 사실이 어떤 문장으로 바뀌는지 확인합니다.</p>
                </article>
                <article className="privacy-item">
                  <b>03 · 구조 증거</b>
                  <h4>생성될 전체 목차</h4>
                  <p>결제 전에 작성될 전체 순서와 문서 범위를 확인합니다.</p>
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
                지원할 사업을 골랐다면,
                <br />
                <span className="gold-text">신청 조건과 빠진 자료까지 무료로 확인하세요.</span>
              </h2>
              <p className="section-copy">
                내가 신청해도 되는지와 이미 해낸 일, 더 확인할 사실·자료를 정리합니다. 결제 전에는 대표님의 말이 실제
                문서에서 어떻게 바뀌는지도 볼 수 있습니다.
              </p>
            </div>

            <div className="preview-layout">
              <div className="preview-list">
                <article className="preview-item">
                  <div className="preview-icon">1</div>
                  <div><h3>이미 해낸 일</h3><p>판매, 돈을 낸 고객, 다시 산 고객, 계약처럼 실제 결과를 찾습니다.</p></div>
                </article>
                <article className="preview-item">
                  <div className="preview-icon">2</div>
                  <div><h3>더 준비하면 좋은 내용</h3><p>고객 반응, 제품 결과, 매출 기록, 팀 경험 중 비어 있는 것을 쉽게 알려드립니다.</p></div>
                </article>
                <article className="preview-item">
                  <div className="preview-icon">3</div>
                  <div><h3>신청 전에 확인할 자료</h3><p>매출 내역, 고객 반응, 계약서처럼 문장마다 필요한 확인 자료를 보여드립니다.</p></div>
                </article>
                <article className="preview-item">
                  <div className="preview-icon">4</div>
                  <div><h3>대표님 말이 바뀐 문장 1개</h3><p>{PRICE_LABEL} 결제 전에 최종 문서의 작성 방향과 문장 수준을 확인합니다.</p></div>
                </article>
              </div>

              <article className="personal-card">
                <div className="personal-top"><i /><i /><i /></div>
                <div className="personal-body">
                  <div className="personal-progress"><span>무료 확인 결과</span><span>7/10 완료</span></div>
                  <div className="progress"><span /></div>
                  <div className="personal-summary">
                    <b>이미 보여줄 수 있는 결과</b>
                    <p>&lsquo;돈을 낸 고객 12개사&rsquo;는 사람들이 실제로 이 서비스를 필요로 한다는 근거가 됩니다.</p>
                  </div>
                  <div className="personal-sentence">
                    <small>내 초안 문장 미리보기</small>
                    <p>
                      &ldquo;현재까지 12개 기업과 유료 거래를 진행해 초기 고객 수요를 확인하였다. 다만 거래 기간, 계약
                      금액 및 재계약 여부에 대한 추가 확인이 필요하다.&rdquo;
                    </p>
                  </div>
                  <div className="locked">
                    <span className="lock-badge">나머지 내용은 결제 후 전체 워드 문서로</span>
                    <div className="locked-lines"><span /><span /><span /><span /></div>
                  </div>
                </div>
              </article>
            </div>

            <div className="center" style={{ marginTop: 38 }}>
              <FreeDiagnosisLink className="btn btn-gold" location="preview">
                받을 수 있는 지원부터 무료로 보기 <span className="arrow">→</span>
              </FreeDiagnosisLink>
            </div>
          </div>
        </section>

        <section className="section dark" id="difference">
          <div className="container">
            <div className="max-copy center">
              <span className="eyebrow">WHY DIFFERENT</span>
              <h2 className="section-title">
                쉬운 설명만 하는 검색기가 아니라,
                <br />
                <span className="gold-text">신청 가능 여부부터 공식 양식 초안까지 잇는 도구</span>입니다.
              </h2>
            </div>

            <div className="difference-grid">
              <article className="difference-card"><span className="tag">01 · 모집 중 지원</span><h3>마감된 지원은 빼고<br />지금 볼 것부터</h3><p>여러 공식 출처의 모집 정보를 모아 사업 시작 시기·지역·필요한 도움에 가까운 순서로 보여드립니다.</p></article>
              <article className="difference-card"><span className="tag">02 · 결제 전 자격</span><h3>신청 가능성과 필요한 서류를<br />무료로 먼저</h3><p>긴 사업계획서가 필요 없는 지원에는 유료 초안 결제를 열지 않습니다.</p></article>
              <article className="difference-card"><span className="tag">03 · 실제 사실·자료</span><h3>아이디어를 꾸미지 않고<br />이미 해낸 일을 확인</h3><p>고객·매출·계약·팀 경험을 묻고, 확인되지 않은 내용은 [확인 필요]로 남깁니다.</p></article>
              <article className="difference-card"><span className="tag">04 · 공식 양식 워드</span><h3>대표님의 말은 쉽게,<br />마지막 문서는 정확하게</h3><p>받은 작성 파일의 항목과 순서를 보존하고, 근거 확인을 통과한 수정 가능한 최종 Word를 만듭니다.</p></article>
            </div>
          </div>
        </section>

        <section className="section cream">
          <div className="container">
            <div className="max-copy center">
              <span className="eyebrow">HOW IT WORKS</span>
              <h2 className="section-title">
                지원할 사업을 정한 다음에도,
                <br />
                <span className="gold-text">어려운 말을 공부할 필요가 없습니다.</span>
              </h2>
            </div>

            <div className="process">
              <article className="process-step"><span className="step">STEP 01</span><h3>받을 수 있는 지원 선택</h3><p>쉬운 설명을 보고 나와 가까운 지원을 고릅니다.</p></article>
              <article className="process-step"><span className="step">STEP 02</span><h3>신청해도 되는지 무료 확인</h3><p>지금 정보로 가능한지와 딱 하나 더 확인할 내용을 봅니다.</p></article>
              <article className="process-step"><span className="step">STEP 03</span><h3>사업 이야기 들려주기</h3><p>누가 불편한지, 누가 돈을 내는지, 왜 대표님이 할 수 있는지 편하게 답합니다.</p></article>
              <article className="process-step"><span className="step">STEP 04</span><h3>공식 워드 문서 받기</h3><p>마지막에만 받은 작성 파일의 순서와 공식 문체로 바꿉니다.</p></article>
            </div>
          </div>
        </section>

        <section className="section" id="price">
          <div className="container">
            <div className="max-copy center">
              <span className="eyebrow">PRICE</span>
              <h2 className="section-title">
                받을 수 있는 지원 찾기와 신청 가능 여부 확인은 무료,
                <br />
                <span className="gold-text">사업계획서 작성만 선택 결제.</span>
              </h2>
              <p className="section-copy">대표님의 사업 이야기를 듣고 맞는 지원을 찾는 단계에서는 결제를 요구하지 않습니다.</p>
            </div>

            <div className="pricing-wrap">
              <article className="price-card featured">
                <div className="plan">받을 수 있는 지원 찾기 + 신청 가능 여부 확인</div>
                <div className="price">0<small>원</small></div>
                <div className="price-desc">어려운 검색어 없이 받을 수 있는 지원부터 확인</div>
                <ul className="price-list">
                  <li>사업 시작 시기·지역·하는 일을 쉬운 질문으로 확인</li>
                  <li>무엇을 도와주는지와 나에게 가까운 이유 설명</li>
                  <li>마감일과 공식 안내문 바로가기</li>
                  <li>내가 신청해도 되는지 확인</li>
                  <li>부족한 사실과 준비할 자료 확인</li>
                </ul>
                <FreeDiagnosisLink className="btn btn-gold btn-full" location="pricing_free">
                  3분 만에 받을 수 있는 지원 보기
                </FreeDiagnosisLink>
              </article>

              <article className="price-card">
                <div className="plan">선택 결제 · 최종 Word 1회 + 묶음 AI 수정 최대 3회</div>
                <div className="price">{PRICE_KRW.toLocaleString("ko-KR")}<small>원</small></div>
                <div className="price-desc">지원할 사업을 정한 뒤 필요할 때만</div>
                <ul className="price-list">
                  <li>평소 쓰는 말로 사업 이야기 인터뷰</li>
                  <li>공식 출처 확인과 가까운 경쟁사 2곳 비교</li>
                  <li>근거가 충분한 A4용 도식 최대 6종 자동선택</li>
                  <li>근거 충돌·필수 데이터 보완 후 최종 점검</li>
                  <li>받은 작성 파일 순서의 수정 가능한 최종 Word</li>
                  <li>발표자료는 필요한 경우에만 별도 선택</li>
                </ul>
                <a
                  className="btn btn-line btn-full"
                  href={PAID_CHECKOUT_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => track("cta_paid_checkout", { location: "pricing_paid" })}
                >
                  근거 기반 사업계획서 만들기 · {PRICE_LABEL}
                </a>
                {GROBLE_BUNDLE_CHECKOUT_URL && (
                  <a
                    className="btn btn-line btn-full"
                    href={GROBLE_BUNDLE_CHECKOUT_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => track("cta_paid_checkout", {
                      location: "pricing_bundle",
                      price: BUNDLE_PRICE_KRW,
                      product: "word_presentation_bundle",
                    })}
                  >
                    Word + 발표자료 묶음 · {BUNDLE_PRICE_LABEL}
                  </a>
                )}
                <div className="price-foot">사업계획서가 필요한 지원사업을 선택했을 때만 안내됩니다. {PLAN_OUTCOME_NOTICE}</div>
              </article>

              <article className="price-card">
                <div className="plan">선택 추가 · Word 완성 후 발표평가 준비</div>
                <div className="price">{PRESENTATION_PRICE_KRW.toLocaleString("ko-KR")}<small>원</small></div>
                <div className="price-desc">발표평가가 있는 대표자만 추가 결제</div>
                <ul className="price-list">
                  <li>기존 Word·원답변·근거 자동 연결</li>
                  <li>편집 가능한 PPTX와 제출·공유용 PDF</li>
                  <li>슬라이드별 발표 대본과 출처 노트</li>
                  <li>예상 질문·대표자 답변 5개 이상</li>
                  <li>30일 이내 묶음 AI 수정 2회</li>
                </ul>
                <Link className="btn btn-line btn-full" href={DIRECT_DIAGNOSIS_URL}>
                  사업계획서부터 준비하기
                </Link>
                <div className="price-foot">
                  발표자료는 최종 Word 이후에 안내됩니다. 근거 없는 실적·수치가 남으면 파일 생성을 차단합니다.
                </div>
              </article>
            </div>

            <div className="policy-note">
              <strong>운영정책:</strong> 아래 내용은 실제 서비스에 적용되는 이용기간·수정·환불·데이터 보관 기준입니다. 세부
              조건은 이용약관, 환불정책과 개인정보처리방침을 따릅니다.
            </div>

            <div className="policy-grid" id="policy">
              <article className="policy-card"><small>01 · 이용권</small><h3>사용 가능 기간</h3><p>{POLICY.usagePeriod}</p></article>
              <article className="policy-card"><small>02 · 수정</small><h3>답변 수정 범위</h3><p>{POLICY.editScope}</p></article>
              <article className="policy-card"><small>03 · 최종본</small><h3>최종 Word 제공 범위</h3><p>{POLICY.regeneration}</p></article>
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
                지원사업 담당자가 어디에서 망설이는지
                <br />
                알기에, 그 판단을 도구에 담았습니다.
              </h3>
              <p>
                이 도구가 다른 AI와 다른 이유는 화려한 문장이 아니라 질문의 순서입니다. 담당자가 무엇을 궁금해하는지
                사업계획서 심사·지도 경험에서 찾아내고, 대표님이 쉽게 답할 수 있는 말로 바꿨습니다.
              </p>
            </article>

            <div className="founder-note-box">
              <div className="founder-note-item">
                <b>심사 관점</b>
                <p>
                  화려한 사업계획서가 아니라, 담당자가 <em>쉽게 이해하고 확인할 수 있는</em> 사업계획서의 구조를 압니다.
                </p>
              </div>
              <div className="founder-note-item">
                  <b>결과를 알맞은 자리에</b>
                <p>같은 매출·고객·계약 기록도 문서의 어느 부분에서 보여주느냐에 따라 이해가 달라집니다. 그 자리를 잡아줍니다.</p>
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
                정부지원사업은 받고 싶은데,
                <br />
                무엇이 나에게 맞는지 모르겠다면.
              </h2>
              <p>사업 얘기만 들려주세요. 받을 수 있는 지원 찾기와 신청 가능 여부 확인까지 무료입니다.</p>
            </div>
            <div className="final-actions">
              <FreeDiagnosisLink className="btn btn-dark" location="final">
                3분 만에 받을 수 있는 지원 보기 <span className="arrow">→</span>
              </FreeDiagnosisLink>
              <a className="btn btn-light" href="#how-to-find" onClick={() => track("cta_view_finder", { location: "final" })}>
                쉬운 질문 과정 다시 보기
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
              <p className="footer-copy">정부지원사업을 몰라도 사업 얘기부터 시작할 수 있습니다. 지금 신청할 수 있는 지원을 찾고, 신청 조건과 빠진 자료를 확인한 뒤 필요할 때만 공식 양식 최종 Word로 이어집니다.</p>
            </div>
            <div>
              <div className="footer-title">SERVICE</div>
              <div className="footer-links"><a href="#how-to-find">받을 수 있는 지원 찾기</a><a href="#demo">사업계획서 작성</a><a href="#price">가격</a><a href="#faq">FAQ</a></div>
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
          3분 만에 받을 수 있는 지원 보기
        </FreeDiagnosisLink>
      </div>
    </div>
  );
}
