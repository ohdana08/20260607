import type { Metadata } from "next";
import Script from "next/script";
import { GoogleAnalytics } from "@next/third-parties/google";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://ddakfit.bccconsulting.kr"),
  title: "딱, 지원핏 | 정부지원사업 무료 추천",
  description:
    "사업을 시작한 시기와 지역, 하는 일을 바탕으로 지금 신청할 수 있는 정부지원사업을 무료로 찾으세요. 사업계획서 작성은 필요한 경우에만 선택할 수 있습니다.",
};

// GA4 측정 ID는 공개돼도 되는 값(비밀 아님) → NEXT_PUBLIC_ 로 둔다.
// 루트 layout에 두면 랜딩(/) · /embed 등 모든 페이지에서 로드된다.
// UTM 파라미터는 GA4가 자동으로 '획득' 보고서 출처로 수집한다.
const GA_ID = process.env.NEXT_PUBLIC_GA_ID; // 예: G-TYJSYWW5Q6

// 도우미 전용 GA4 속성 (2026-07-09 ③ 결정 — 가입 전환율·groble_click·order_verified 측정).
// 기존 GA_ID(홈페이지 통합 속성)는 그대로 두고, 두 번째 속성으로 함께 수집한다.
// (기준선 지표가 기존 속성 기준이라 옮기지 않고 병행 수집 — 8/8 판정 비교 유지)
const GA_ID_DOUMI = "G-5TN5XW0T2J";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-zinc-50 text-zinc-900">
        {children}
      </body>
      {/* GA4 (Google Analytics 4) — 공식 @next/third-parties 컴포넌트.
          gtag/dataLayer를 초기화하므로 lib/ga.ts의 track()도 그대로 동작한다. */}
      {GA_ID && <GoogleAnalytics gaId={GA_ID} />}
      {/* 두 번째 GA4 속성(도우미 전용) — dataLayer 큐잉이라 gtag.js 로드 전이어도 안전.
          config 이후 발화되는 모든 이벤트(sign_up 등)는 두 속성 모두에 수집된다. */}
      <Script id="ga-doumi" strategy="afterInteractive">
        {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('config', '${GA_ID_DOUMI}');`}
      </Script>
    </html>
  );
}
