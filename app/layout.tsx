import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "정부지원사업 사업계획서 도우미",
  description:
    "예비창업자를 위한 정부지원사업 추천 + 사업계획서 작성 도우미. 어려운 용어 없이, 대화하면서 나에게 맞는 지원사업을 찾고 사업계획서 초안까지.",
};

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
    </html>
  );
}
