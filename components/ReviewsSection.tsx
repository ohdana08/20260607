"use client";

import { useEffect, useState } from "react";

interface PublicReview {
  rating: number;
  tags: string[];
  comment: string;
  bizField: string;
  displayName: string;
  timestamp: number;
}

// 후기 5건 미만이면 섹션 자체를 렌더링하지 않는다. (빈 후기란 = 신뢰 하락)
// 5건 이상이면 공개 동의 후기를 보여준다. (업무지시서 v2 — 4-1)
export default function ReviewsSection() {
  const [show, setShow] = useState(false);
  const [reviews, setReviews] = useState<PublicReview[]>([]);

  useEffect(() => {
    let alive = true;
    fetch("/api/review")
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        if (d?.show && Array.isArray(d.reviews) && d.reviews.length > 0) {
          setShow(true);
          setReviews(d.reviews);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (!show) return null;

  return (
    <section className="w-full max-w-3xl px-6 py-14">
      <h2 className="text-center text-xl font-bold text-zinc-900">사장님들의 후기 ⭐</h2>
      <p className="mt-2 text-center text-sm text-zinc-500">
        실제로 사업계획서 초안을 받아보신 분들의 이야기예요.
      </p>
      <div className="mt-7 grid gap-4 sm:grid-cols-2">
        {reviews.slice(0, 6).map((r, i) => (
          <div key={i} className="rounded-2xl border border-zinc-200 bg-white p-5 text-left shadow-sm">
            <div className="text-sm text-amber-500">{"⭐".repeat(Math.max(1, Math.min(5, r.rating)))}</div>
            {r.comment && (
              <p className="mt-2 text-sm leading-6 text-zinc-700">“{r.comment}”</p>
            )}
            {r.tags.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {r.tags.map((t, k) => (
                  <span key={k} className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-medium text-blue-700">
                    {t}
                  </span>
                ))}
              </div>
            )}
            <div className="mt-3 text-xs font-medium text-zinc-400">
              {r.displayName} 님{r.bizField ? ` · ${r.bizField}` : ""}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
