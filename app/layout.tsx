import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "정부지원사업 사업계획서 도우미",
  description:
    "예비창업자를 위한 정부지원사업 추천 + 사업계획서 작성 도우미. 어려운 용어 없이, 대화하면서 나에게 맞는 지원사업을 찾고 사업계획서 초안까지.",
};

// 측정 ID는 공개돼도 되는 값(비밀 아님) → NEXT_PUBLIC_* 로 둔다.
const GTM_ID = process.env.NEXT_PUBLIC_GTM_ID; // 예: GTM-K94NGCTP
const GA4_ID = process.env.NEXT_PUBLIC_GA4_ID; // 예: G-TYJSYWW5Q6

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full antialiased">
      <head>
        {/* GTM (있으면) — dataLayer로 모든 이벤트 전달 */}
        {GTM_ID && (
          <Script id="gtm-init" strategy="afterInteractive">
            {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
              new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
              j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
              'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
              })(window,document,'script','dataLayer','${GTM_ID}');`}
          </Script>
        )}
        {/* GA4(gtag) 직접 로드 — GTM이 없거나 GA4를 직접 쓰는 경우의 안전망 */}
        {GA4_ID && (
          <>
            <Script
              id="ga4-src"
              strategy="afterInteractive"
              src={`https://www.googletagmanager.com/gtag/js?id=${GA4_ID}`}
            />
            <Script id="ga4-init" strategy="afterInteractive">
              {`window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                gtag('js', new Date());
                gtag('config', '${GA4_ID}');`}
            </Script>
          </>
        )}
      </head>
      <body className="min-h-full flex flex-col bg-zinc-50 text-zinc-900">
        {GTM_ID && (
          <noscript>
            <iframe
              src={`https://www.googletagmanager.com/ns.html?id=${GTM_ID}`}
              height="0"
              width="0"
              style={{ display: "none", visibility: "hidden" }}
            />
          </noscript>
        )}
        {children}
      </body>
    </html>
  );
}
