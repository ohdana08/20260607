import type { Metadata } from "next";
import { GROBLE_CHECKOUT_URL } from "@/lib/config";

export const metadata: Metadata = {
  title: "정부지원사업 사업계획서 도우미 — 소개",
  description:
    "13년·380개 공공기관 심사 노하우를 학습한 AI가 지원사업 찾기부터 사업계획서 초안까지 대신해 드립니다.",
};

// 그로블 결제창 링크 — lib/config.ts 의 단일 상수를 공유한다 (결제 모달과 동일 링크).
const CHECKOUT_URL = GROBLE_CHECKOUT_URL;

export default function Landing() {
  return (
    <main className="flex flex-1 flex-col items-center px-6 py-20">
      <div className="flex w-full max-w-2xl flex-1 flex-col items-center justify-center text-center">
        <p className="mb-3 text-sm font-medium text-blue-600">
          내 사업의 AI 직원
        </p>
        <h1 className="text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
          정부지원사업 사업계획서 도우미
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-lg font-medium leading-8 text-zinc-700">
          공고 찾기부터 사업계획서 초안까지, 대화 한 번으로 끝내는 AI
          직원입니다.
        </p>

        <ul className="mx-auto mt-8 max-w-xl space-y-3 text-left text-base leading-7 text-zinc-600">
          <li className="rounded-xl border border-zinc-200 bg-white px-5 py-4">
            <span className="font-semibold text-zinc-900">공고 찾기 대신</span>{" "}
            — 흩어진 정부지원사업 공고를 뒤지는 대신, 내 지역·단계·나이에 맞는
            사업을 대화 한 번으로 추천받아요.
          </li>
          <li className="rounded-xl border border-zinc-200 bg-white px-5 py-4">
            <span className="font-semibold text-zinc-900">
              사업 진단 대신
            </span>{" "}
            — 계획서를 쓰기 전에, 내 사업이 &ldquo;될 사업&rdquo;인지 7단계로
            빠르게 진단하고 약점을 짚어 드려요.
          </li>
          <li className="rounded-xl border border-zinc-200 bg-white px-5 py-4">
            <span className="font-semibold text-zinc-900">
              초안 작성 대신
            </span>{" "}
            — 13년·380개 공공기관 심사 노하우를 학습한 AI가 심사위원 관점을
            담은 사업계획서 초안을 만들어 드려요.
          </li>
        </ul>

        <div className="mt-10">
          <p className="text-sm text-zinc-500">이용 가격</p>
          <p className="mt-1 text-3xl font-bold tracking-tight">
            39,900<span className="text-lg font-semibold">원</span>
          </p>
        </div>

        <div className="mt-8 flex flex-col items-center gap-2">
          {CHECKOUT_URL ? (
            <a
              href={CHECKOUT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-12 items-center justify-center rounded-full bg-blue-600 px-8 text-base font-semibold text-white transition-colors hover:bg-blue-700"
            >
              구매하기
            </a>
          ) : (
            <button
              type="button"
              disabled
              className="inline-flex h-12 cursor-not-allowed items-center justify-center rounded-full bg-zinc-300 px-8 text-base font-semibold text-white"
            >
              구매하기 (결제 연결 준비 중)
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
