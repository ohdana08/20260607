import type { Metadata } from "next";
import Analytics from "@/components/Analytics";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://ddakfit.bccconsulting.kr"),
  title: "딱, 지원핏 | 사업 얘기부터, 지금 신청할 수 있는 지원까지",
  description:
    "사업 얘기부터 하세요. 지금 신청할 수 있는 지원을 찾고, 빠진 사실과 자료를 확인한 뒤 필요한 경우 공식 양식 워드 초안으로 정리해드립니다.",
};

// 기존 BCC 공유 스트림을 유지한다. 동일 ID는 한 번만 초기화한다.

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-zinc-50 text-zinc-900">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
