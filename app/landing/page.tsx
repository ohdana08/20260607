import type { Metadata } from "next";
import "./landing.css";
import LandingClient from "./LandingClient";

// 실제 배포 도메인 — Vercel 프로젝트 20260607에 연결된 딱지원핏 전용 주소.
const SITE_URL = "https://ddakfit.bccconsulting.kr";

export const metadata: Metadata = {
  // og:image 상대경로가 요청 호스트(프리뷰 배포 URL 등)로 잡히지 않고 항상 실제
  // 배포 도메인을 가리키도록 고정 — 프리뷰에서 검증 시 확인된 필요성(2026-07-14).
  metadataBase: new URL(SITE_URL),
  title: "딱, 지원핏 | 사업 얘기부터, 지금 신청할 수 있는 지원까지",
  description:
    "사업 얘기부터 하세요. 지금 신청할 수 있는 지원을 찾고, 빠진 사실과 자료를 확인한 뒤 필요한 경우 공식 양식 워드 초안으로 정리해드립니다.",
  openGraph: {
    title: "사업 얘기부터 하세요. 지금 신청할 수 있는 지원을 찾아드립니다.",
    description: "찾기와 신청 가능 여부 확인은 무료. 사업계획서가 필요한 지원만 공식 양식 워드 초안으로 이어집니다.",
    type: "website",
    images: [{ url: "/og-government-plan-helper.png", width: 1200, height: 630 }],
    url: SITE_URL,
  },
  alternates: { canonical: SITE_URL },
};

export default function LandingPage() {
  return <LandingClient />;
}
