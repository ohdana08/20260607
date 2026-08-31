import type { Program } from "@/lib/match/types";
import {
  rankPublicEvidenceItems,
  suggestedEvidenceQuery,
  type PublicEvidenceAvailability,
} from "@/lib/data/publicEvidence";

const AVAILABILITY_LABEL: Record<PublicEvidenceAvailability, string> = {
  available: "바로 검색",
  application_required: "활용신청 필요",
  manual_only: "원문 수동 확인",
};

export default function PublicEvidencePanel({ program }: { program: Program }) {
  const context = `${program.title} ${program.summary} ${program.supportField}`;
  const field = program.supportField || program.title;
  const items = rankPublicEvidenceItems(context, "step6", 5);

  return (
    <details className="rounded-2xl border border-indigo-200 bg-indigo-50/50 p-4" open>
      <summary className="cursor-pointer list-none text-sm font-extrabold text-indigo-950">
        <span aria-hidden="true">📊</span> 계획서에 쓸 공식 근거 찾기
        <span className="ml-2 text-xs font-medium text-indigo-600">6단계 작성 보조도구</span>
      </summary>
      <p className="mt-2 text-xs leading-5 text-indigo-900/80">
        아래는 <b>이 공고와 관련된 공식 자료를 찾을 곳</b>입니다. 숫자를 자동으로
        지어내지 않고, 원문에서 기준연도·이용조건을 확인한 뒤 계획서에 넣습니다.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {items.map((item) => (
          <article key={item.id} className="rounded-xl border border-indigo-100 bg-white p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-xs font-bold leading-5 text-zinc-900">{item.title}</h3>
                <p className="text-[11px] text-zinc-500">{item.institution}</p>
              </div>
              <span className="shrink-0 rounded-full bg-indigo-100 px-2 py-1 text-[10px] font-semibold text-indigo-700">
                {AVAILABILITY_LABEL[item.availability]}
              </span>
            </div>
            <p className="mt-2 text-[11px] leading-5 text-zinc-700">{item.useFor}</p>
            <p className="mt-1 rounded-lg bg-zinc-50 px-2 py-1.5 text-[10px] leading-4 text-zinc-600">
              검색어: {suggestedEvidenceQuery(item, field)}
            </p>
            <p className="mt-1 text-[10px] leading-4 text-amber-700">{item.accessNote}</p>
            <a
              href={item.officialUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex text-[11px] font-semibold text-indigo-700 hover:underline"
            >
              공식 출처에서 확인 ↗
            </a>
          </article>
        ))}
      </div>
      <p className="mt-2 text-[10px] leading-4 text-zinc-500">
        ※ 확인하지 못한 내용은 초안에 <b>[확인 필요]</b>로 남겨두며, 개방 예정 데이터를
        현재 사용 가능한 것처럼 표현하지 않습니다.
      </p>
    </details>
  );
}
