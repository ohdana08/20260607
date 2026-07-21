import type { ReactNode } from "react";
import Link from "next/link";

// 정책 페이지 4종(약관·개인정보·환불·AI데이터) 공통 레이아웃 (2026-07-14).
export function PolicyPage({
  title,
  updatedLabel,
  children,
}: {
  title: string;
  updatedLabel: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="flex flex-1 flex-col items-center px-6 py-16">
      <div className="w-full max-w-2xl">
        <Link href="/" className="text-sm text-blue-600 hover:underline">
          ← 정부지원사업 도우미로 돌아가기
        </Link>
        <h1 className="mt-4 text-2xl font-bold tracking-tight text-zinc-900">{title}</h1>
        <p className="mt-1 text-sm text-zinc-500">{updatedLabel}</p>
        <div className="policy-prose mt-8 space-y-6 text-[15px] leading-7 text-zinc-700">
          {children}
        </div>
      </div>
    </main>
  );
}

export function Article({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-base font-bold text-zinc-900">{title}</h2>
      <div className="mt-2 space-y-2">{children}</div>
    </section>
  );
}

// 실제 값 미확정 항목 — 대괄호 원문은 그대로 두되, 배포 전 눈에 띄게 강조 표시한다.
// (2026-07-14: "Production 배포 전 반드시 실제값 교체" — 코드 TODO + 시각적 표시 이중 안전장치)
export function Placeholder({ children }: { children: ReactNode }) {
  return (
    <mark className="rounded bg-red-100 px-1 py-0.5 font-semibold text-red-700" title="TODO: 발사 전 실제값으로 교체 필수">
      {children}
    </mark>
  );
}
