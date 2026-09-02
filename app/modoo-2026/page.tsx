import type { Metadata } from "next";
import Link from "next/link";
import ModooApplicationBuilder from "./ModooApplicationBuilder";
import {
  MODU_2026_APPLICATION_URL,
  MODU_2026_DEADLINE,
  MODU_2026_DEADLINE_LABEL,
  MODU_2026_NOTICE_URL,
} from "@/lib/campaigns/modoo2026";

const PAGE_URL = "https://ddakfit.bccconsulting.kr/modoo-2026";

export const metadata: Metadata = {
  title: "2026 모두의창업 지원서 작성 재료 정리 | 딱지원핏",
  description:
    "9월 17일 마감 모두의창업 2차. 공식 공고문을 받고 고객 장면·문제 근거·검증 계획부터 무료로 정리하세요.",
  alternates: { canonical: PAGE_URL },
  openGraph: {
    title: "모두의창업 지원서, 고객 장면과 근거부터 정리하세요",
    description: "공식 공고문 다운로드부터 딱지원핏 작성 재료 Word까지 한 화면에서 준비합니다.",
    url: PAGE_URL,
    type: "website",
    images: [{ url: "/og-government-plan-helper.png", width: 1200, height: 630 }],
  },
};

const RESOURCES = [
  {
    eyebrow: "공식 원문",
    title: "모두의창업 2차 공고문 PDF",
    description: "중소벤처기업부가 게시한 공식 공고문입니다.",
    href: "/api/modoo-2026/download?file=notice-pdf",
    label: "PDF 다운로드",
  },
  {
    eyebrow: "공식 원문",
    title: "모두의창업 2차 공고문 HWPX",
    description: "한글에서 확인할 수 있는 공식 공고 원본입니다.",
    href: "/api/modoo-2026/download?file=notice-hwpx",
    label: "HWPX 다운로드",
  },
  {
    eyebrow: "딱지원핏 제공",
    title: "딱지원핏 사실 정리 질문지 Word",
    description: "공식 문항 복제본이 아닌 고객 장면·근거·검증계획 정리용 질문지입니다.",
    href: "/api/modoo-2026/download?file=worksheet-docx",
    label: "질문지 Word 받기",
  },
] as const;

export default function Modoo2026Page() {
  return (
    <main className="w-full bg-[#f7f5ef] text-zinc-950">
      <header className="border-b border-white/10 bg-[#111827] text-white">
        <div className="mx-auto flex min-h-16 w-full max-w-6xl items-center justify-between gap-4 px-5 lg:px-8">
          <Link href="/" className="flex items-center gap-3" aria-label="딱지원핏 홈">
            <span className="grid h-9 w-9 place-items-center border border-amber-400 bg-zinc-950 text-[11px] font-black text-amber-300">BCC</span>
            <span>
              <b className="block text-sm">딱, 지원핏</b>
              <span className="block text-[10px] text-zinc-400">모두의창업 전용 모드</span>
            </span>
          </Link>
          <a
            href={MODU_2026_NOTICE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-bold text-zinc-300 hover:text-white"
          >
            공식 공고 확인 ↗
          </a>
        </div>
      </header>

      <section className="relative overflow-hidden bg-[#111827] text-white">
        <div aria-hidden="true" className="absolute -right-32 top-6 h-80 w-80 rounded-full border border-amber-300/20" />
        <div aria-hidden="true" className="absolute -right-16 top-24 h-52 w-52 rounded-full border border-blue-300/20" />
        <div className="relative mx-auto grid w-full max-w-6xl gap-10 px-5 py-16 sm:py-24 lg:grid-cols-[1.05fr_0.95fr] lg:px-8">
          <div>
            <span className="inline-flex rounded-full border border-amber-300/30 bg-amber-300/10 px-3 py-1 text-xs font-extrabold text-amber-300">
              중소벤처기업부 모두의창업 프로젝트 2차
            </span>
            <h1 className="mt-6 text-4xl font-black leading-[1.12] tracking-[-0.04em] sm:text-6xl">
              아이디어는 있는데
              <br />지원서 문장이 막힌다면
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-8 text-zinc-300 sm:text-lg">
              대표님이 직접 본 고객 장면과 확인 가능한 근거를 적어주세요. 딱지원핏이 없는 사실을 만들지 않고,
              공식 지원서를 쓸 때 꺼내 쓸 수 있는 작성 재료로 정리합니다.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a href="#builder" className="flex min-h-13 items-center justify-center rounded-xl bg-amber-400 px-6 text-sm font-black text-zinc-950 hover:bg-amber-300">
                무료로 작성 재료 정리하기
              </a>
              <a href="#resources" className="flex min-h-13 items-center justify-center rounded-xl border border-white/20 bg-white/5 px-6 text-sm font-bold text-white hover:bg-white/10">
                공고문·질문지 먼저 받기
              </a>
            </div>
            <p className="mt-4 text-xs leading-5 text-zinc-400">공식 기관 서비스가 아닌 민간 작성 보조 도구입니다. 선정 여부를 보장하지 않습니다.</p>
          </div>

          <aside className="self-end rounded-[28px] border border-white/10 bg-white/5 p-5 backdrop-blur sm:p-7">
            <p className="text-xs font-extrabold tracking-[0.14em] text-amber-300">이번 접수 핵심</p>
            <dl className="mt-5 space-y-5">
              <div className="border-b border-white/10 pb-5">
                <dt className="text-xs text-zinc-400">마감</dt>
                <dd className="mt-1 text-xl font-black"><time dateTime={MODU_2026_DEADLINE}>{MODU_2026_DEADLINE_LABEL}</time></dd>
              </div>
              <div className="border-b border-white/10 pb-5">
                <dt className="text-xs text-zinc-400">접수 방식</dt>
                <dd className="mt-1 font-extrabold">모두의창업 플랫폼 온라인 도전신청서</dd>
              </div>
              <div>
                <dt className="text-xs text-zinc-400">지원 대상</dt>
                <dd className="mt-1 font-extrabold">예비창업자 또는 업력 7년 이내 기창업자</dd>
                <p className="mt-2 text-xs leading-5 text-zinc-400">기창업자는 이종창업 등 세부 조건을 공식 공고에서 확인해야 합니다.</p>
              </div>
            </dl>
          </aside>
        </div>
      </section>

      <section id="resources" className="scroll-mt-6 border-b border-zinc-200 bg-white py-14 sm:py-20">
        <div className="mx-auto w-full max-w-6xl px-5 lg:px-8">
          <div className="max-w-2xl">
            <p className="text-sm font-extrabold tracking-[0.14em] text-blue-700">한 화면에서 준비하기</p>
            <h2 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">공고문과 사실 정리 질문지를 먼저 받아보세요</h2>
            <p className="mt-4 text-[15px] leading-7 text-zinc-600">
              공식 지원서는 별도 파일이 아니라 모두의창업 플랫폼에서 온라인으로 작성합니다. 아래 Word는 공식 문항을 옮긴 자료가 아니라 딱지원핏 고유의 증거 중심 작업지입니다.
            </p>
          </div>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {RESOURCES.map((resource) => (
              <article key={resource.href} className="flex flex-col rounded-2xl border border-zinc-200 bg-[#faf9f6] p-5">
                <p className="text-[11px] font-extrabold tracking-[0.12em] text-blue-700">{resource.eyebrow}</p>
                <h3 className="mt-3 text-lg font-black leading-7">{resource.title}</h3>
                <p className="mt-2 flex-1 text-sm leading-6 text-zinc-600">{resource.description}</p>
                <a href={resource.href} className="mt-5 flex min-h-11 items-center justify-center rounded-xl border border-zinc-300 bg-white px-4 text-sm font-extrabold text-zinc-900 hover:border-blue-400 hover:bg-blue-50">
                  {resource.label}
                </a>
              </article>
            ))}
          </div>
          <div className="mt-4 flex flex-col gap-3 rounded-2xl bg-blue-50 p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-semibold leading-6 text-blue-950">공식 질문과 접수 상태는 모두의창업 플랫폼에서 최종 확인하세요.</p>
            <a href={MODU_2026_APPLICATION_URL} target="_blank" rel="noopener noreferrer" className="shrink-0 rounded-xl bg-blue-700 px-5 py-3 text-center text-sm font-extrabold text-white hover:bg-blue-800">
              공식 온라인 지원서 열기 ↗
            </a>
          </div>
        </div>
      </section>

      <ModooApplicationBuilder />

      <section className="border-t border-zinc-200 bg-white py-10">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-5 text-xs leading-5 text-zinc-500 sm:flex-row sm:items-center sm:justify-between lg:px-8">
          <p>딱지원핏은 공고 확인과 작성 보조를 제공합니다. 자격·사실·증빙·최종 제출 책임은 신청자에게 있습니다.</p>
          <div className="flex gap-4">
            <Link href="/privacy" className="font-bold hover:text-zinc-900">개인정보처리방침</Link>
            <Link href="/terms" className="font-bold hover:text-zinc-900">이용약관</Link>
          </div>
        </div>
      </section>
    </main>
  );
}
