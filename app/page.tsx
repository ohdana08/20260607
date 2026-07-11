import Link from "next/link";
import ReviewsSection from "@/components/ReviewsSection";
import LandingTracker from "@/components/LandingTracker";
import { MAINTENANCE } from "@/lib/config";
import Maintenance from "@/components/Maintenance";

export default function Home() {
  if (MAINTENANCE) return <Maintenance />;
  return (
    <main className="flex flex-1 flex-col items-center px-6 py-20">
      <LandingTracker />
      <div className="flex w-full max-w-2xl flex-1 flex-col items-center justify-center text-center">
        <p className="mb-3 text-sm font-medium text-blue-600">
          예비창업자를 위한 정부지원사업 도우미
        </p>
        {/* 첫 화면 카피 — 2026-07-10 진단 재설계 확정안 */}
        <h1 className="text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
          사업은 잘하고 있는데,
          <br />
          사업계획서만 막히시나요?
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-base leading-7 text-zinc-600">
          이미 가진 매출·고객·거래처가 심사위원의 점수가 되도록.
        </p>
        <p className="mt-3 text-sm font-semibold text-emerald-600">
          결제 없이 진단까지 무료
        </p>
        <div className="mt-8 flex justify-center">
          <Link
            href="/embed"
            className="inline-flex h-12 items-center justify-center rounded-full bg-blue-600 px-7 text-base font-semibold text-white transition-colors hover:bg-blue-700"
          >
            시작하기
          </Link>
        </div>
      </div>

      {/* 후기 5건 이상 쌓이면 자동 노출 (그 전엔 렌더링 안 함) */}
      <ReviewsSection />
    </main>
  );
}
