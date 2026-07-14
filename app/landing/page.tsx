import type { Metadata } from "next";
import "./landing.css";
import LandingClient from "./LandingClient";

// 실제 배포 도메인 (Vercel 프로젝트 20260607 — 커스텀 도메인 미연결, 안정적인 *.vercel.app 별칭).
// 그로블 웹훅 등록 주소(app/api/groble/webhook/route.ts)와 동일한 도메인으로 통일.
const SITE_URL = "https://20260607.vercel.app";

export const metadata: Metadata = {
  title: "정부지원사업 도우미 | 내 사업의 증거를 공고 양식에 맞춘 DOCX 초안으로",
  description:
    "매출·고객·거래처·경험은 있지만 사업계획서 어디에 써야 할지 막혔다면, 공고 자격을 무료로 확인하고 평가항목과 공식 양식 순서에 맞춘 DOCX 초안을 만드세요.",
  openGraph: {
    title: "정부지원사업 도우미 | 쓸 내용은 있는데 어디에 써야 할지 막혔다면",
    description: "공고 자격 진단은 무료. 내 사업의 증거를 평가항목에 배치한 맞춤 DOCX 초안 1건 39,900원.",
    type: "website",
    // TODO(배포 전 필수): og-government-plan-helper.png 파일이 public/에 아직 없음.
    // 1200x630 OG 이미지를 public/og-government-plan-helper.png 로 추가해야 카톡·SNS
    // 공유 시 썸네일이 정상 노출된다. 추가 전까지는 플랫폼 기본 파비콘 등으로 대체 노출됨.
    images: ["/og-government-plan-helper.png"],
    url: SITE_URL,
  },
  alternates: { canonical: SITE_URL },
};

export default function LandingPage() {
  return <LandingClient />;
}
