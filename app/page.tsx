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
        <h1 className="text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
          흩어진 정부지원사업,
          <br />
          대화 한 번으로 나에게 맞는 걸 찾고
          <br />
          사업계획서 초안까지.
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-base leading-7 text-zinc-600">
          어려운 용어는 몰라도 괜찮아요. 편하게 대화하듯 답하면, 나에게 맞는
          지원사업을 추천하고 공고문·양식을 찾아 사업계획서 초안까지 만들어
          드려요.
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
