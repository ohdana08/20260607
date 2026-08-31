import type { Metadata } from "next";
import "./landing.css";
import LandingClient from "./LandingClient";

// 실제 배포 도메인 — Vercel 프로젝트 20260607에 연결된 딱지원핏 전용 주소.
const SITE_URL = "https://ddakfit.bccconsulting.kr";

export const metadata: Metadata = {
  // og:image 상대경로가 요청 호스트(프리뷰 배포 URL 등)로 잡히지 않고 항상 실제
  // 배포 도메인을 가리키도록 고정 — 프리뷰에서 검증 시 확인된 필요성(2026-07-14).
  metadataBase: new URL(SITE_URL),
  title: "딱, 지원핏 | 내 사업에 맞는 정부지원사업 무료로 찾기",
  description:
    "사업을 시작한 시기와 지역, 하는 일을 알려주면 지금 신청할 수 있는 정부지원사업을 찾아드리고 신청 가능 여부와 준비할 서류까지 확인해드립니다.",
  openGraph: {
    title: "딱, 지원핏 | 내 사업에 맞는 정부지원사업부터 찾아드려요",
    description: "지원사업 찾기와 신청 가능 여부 확인은 무료. 사업계획서 작성은 필요한 경우에만 선택하세요.",
    type: "website",
    images: [{ url: "/og-government-plan-helper.png", width: 1200, height: 630 }],
    url: SITE_URL,
  },
  alternates: { canonical: SITE_URL },
};

export default function LandingPage() {
  return <LandingClient />;
}
