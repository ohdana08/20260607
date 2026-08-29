import type { Metadata } from "next";
import { MAINTENANCE } from "@/lib/config";
import Maintenance from "@/components/Maintenance";
import LandingClient from "./landing/LandingClient";
import "./landing/landing.css";

const SITE_URL = "https://ddakfit.bccconsulting.kr";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "딱, 지원핏 | 나에게 맞는 정부지원사업 무료로 찾기",
  description:
    "정부지원사업을 어디서 찾아야 할지 막막하다면 지역·업력·사업단계에 맞는 모집 공고를 무료로 추천받고, 신청 자격과 원문까지 한 번에 확인하세요.",
  openGraph: {
    title: "딱, 지원핏 | 받을 수 있는 정부지원사업을 무료로 찾아보세요",
    description: "조건에 맞는 공고 추천과 자격 확인은 무료. 사업계획서 초안은 필요할 때만 선택하세요.",
    type: "website",
    images: [{ url: "/og-government-plan-helper.png", width: 1200, height: 630 }],
    url: SITE_URL,
  },
  alternates: { canonical: SITE_URL },
};

export default function Home() {
  if (MAINTENANCE) return <Maintenance />;
  return <LandingClient />;
}
