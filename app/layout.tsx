import type { Metadata } from "next";
import Script from "next/script";
import { GoogleAnalytics } from "@next/third-parties/google";
import "./globals.css";

export const metadata: Metadata = {
  title: "정부지원사업 사업계획서 도우미",
  description:
    "예비창업자를 위한 정부지원사업 추천 + 사업계획서 작성 도우미. 어려운 용어 없이, 대화하면서 나에게 맞는 지원사업을 찾고 사업계획서 초안까지.",
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
