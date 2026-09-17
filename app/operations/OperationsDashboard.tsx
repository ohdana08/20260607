"use client";
import type { FormEvent } from "react";
import AuthGate from "@/components/auth/AuthGate";
import type { Video } from "@/lib/operations/domain";
import { useOperationsDashboard } from "./useOperationsDashboard";
import { NumberField, GoalForm, VideoForm } from "./OperationsForms";
const money = (value: number | null) =>
  value === null ? "미확인" : `${value.toLocaleString("ko-KR")}원`;
const count = (value: number | null) =>
  value === null ? "미확인" : value.toLocaleString("ko-KR");
const number = (data: FormData, key: string) => Number(data.get(key));
const optional = (data: FormData, key: string) =>
  String(data.get(key) ?? "").trim() === "" ? null : Number(data.get(key));
const string = (data: FormData, key: string) => String(data.get(key) ?? "");
export default function OperationsDashboard(props: {
  local: boolean;
  initialMonth: string;
}) {
  return props.local ? (
    <Dashboard {...props} />
  ) : (
    <AuthGate>
      <Dashboard {...props} />
    </AuthGate>
  );
}
function Dashboard({
  local,
  initialMonth,
}: {
  local: boolean;
  initialMonth: string;
}) {
  const { month, view, loading, busy, error, notice, load, save, selectMonth } =
    useOperationsDashboard(local, initialMonth);
  function snapshotSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const d = new FormData(event.currentTarget);
    void save({
      kind: "snapshot",
      value: {
        asOf: string(d, "asOf"),
        grossKrw: number(d, "grossKrw"),
        refundsKrw: number(d, "refundsKrw"),
        wordOrders: number(d, "wordOrders"),
        bundleOrders: number(d, "bundleOrders"),
        presentationOrders: number(d, "presentationOrders"),
        publishedVideos: number(d, "publishedVideos"),
        views: optional(d, "views"),
        siteVisits: optional(d, "siteVisits"),
        attributedOrders: optional(d, "attributedOrders"),
        attributedNetKrw: optional(d, "attributedNetKrw"),
        note: string(d, "note"),
      },
    });
  }
  function goalSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const d = new FormData(event.currentTarget);
    void save({
      kind: "goal",
      value: {
        month,
        startDate: string(d, "startDate"),
        deadline: string(d, "deadline"),
        targetKrw: number(d, "targetKrw"),
        plannedVideos: number(d, "plannedVideos"),
        wordPriceKrw: number(d, "wordPriceKrw"),
      },
    });
  }
  function videoSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const d = new FormData(event.currentTarget);
    void save({
      kind: "video",
      value: {
        id: string(d, "id") || crypto.randomUUID(),
        title: string(d, "title"),
        plannedDate: string(d, "plannedDate"),
        product: string(d, "product") as Video["product"],
        status: string(d, "status") as Video["status"],
        url: string(d, "url"),
        views24h: optional(d, "views24h"),
        views72h: optional(d, "views72h"),
      },
    });
  }
  const state = view?.state,
    summary = view?.summary,
    latest = summary?.latest;
  return (
    <main className="ops">
      <header className="ops-head">
        <div>
          <a href="/landing" className="ops-brand">
            딱, 지원핏
          </a>
          <p className="ops-eyebrow">CHANNEL OPERATIONS</p>
          <h1>이번 달, 다음 한 걸음.</h1>
          <p className="ops-sub">
            실제 성과를 기록하고 매출 목표까지 남은 일을 확인하세요.
          </p>
        </div>
        <div className="ops-month">
          <label htmlFor="ops-month">관리할 월</label>
          <input
            id="ops-month"
            type="month"
            value={month}
            onChange={(e) => selectMonth(e.target.value)}
            min="2000-01"
            max="2099-12"
            disabled={busy}
          />
          <button
            className="ops-secondary"
            type="button"
            onClick={() => void load()}
            disabled={loading || busy}
          >
            새로 불러오기
          </button>
        </div>
      </header>
      <div className="ops-source">
        <span>{local ? "로컬 작업본" : "관리자 전용"}</span>
        <p>
          결제 내역과 채널 통계에서 확인한 값을 직접 기록합니다. 모르는 지표는
          빈칸으로 남겨주세요.
        </p>
      </div>
      {error && (
        <div className="ops-error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <p className="ops-notice" role="status">
          {notice}
        </p>
      )}
      {loading && (
        <p role="status" className="ops-empty">
          운영 기록을 불러오고 있습니다.
        </p>
      )}
      {!loading && state && summary && (
        <>
          <section className="ops-metrics" aria-label="매출 목표 현황">
            <Metric
              label="환불 차감 매출"
              value={money(summary.netKrw)}
              detail={`목표 ${money(state.goal.targetKrw)}`}
              emphasis
            />
            <Metric
              label="남은 매출"
              value={money(summary.remainingKrw)}
              detail={`마감 ${state.goal.deadline}`}
            />
            <Metric
              label="추가 Word 주문"
              value={
                summary.neededWordOrders === null
                  ? "미확인"
                  : `${count(summary.neededWordOrders)}건`
              }
              detail={`${money(state.goal.wordPriceKrw)} 기준 계산`}
            />
            <Metric
              label="남은 날짜"
              value={`${summary.remainingDays}일`}
              detail={`오늘 ${summary.today} 포함`}
            />
          </section>
          <section className="ops-next">
            <div>
              <span className="ops-eyebrow">지금 할 일</span>
              <h2>{summary.nextAction}</h2>
            </div>
            <div className="ops-pace">
              <span>하루 필요 매출</span>
              <strong>
                {summary.remainingDays === 0 && summary.remainingKrw
                  ? "기한 종료"
                  : money(summary.dailyRevenueKrw)}
              </strong>
              <small>판매 예측이 아닌 목표 역산입니다.</small>
            </div>
          </section>
          <section className="ops-columns">
            <div className="ops-panel">
              <div className="ops-section-title">
                <h2>성과 기록</h2>
                <span>
                  {latest ? `최근 ${latest.asOf}` : "첫 기록을 남겨주세요"}
                </span>
              </div>
              <p className="ops-help">
                선택한 월 1일부터 확인일까지의 누적값입니다. 같은 날짜를 다시
                저장하면 기존 기록을 수정합니다.
              </p>
              <form
                key={`snapshot-${JSON.stringify(latest)}`}
                onSubmit={snapshotSubmit}
              >
                <div className="ops-fields">
                  <label>
                    확인 날짜
                    <input
                      name="asOf"
                      type="date"
                      required
                      defaultValue={
                        summary.today.startsWith(month)
                          ? summary.today
                          : state.goal.deadline
                      }
                      min={`${month}-01`}
                      max={summary.today}
                    />
                  </label>
                  <NumberField
                    name="grossKrw"
                    label="전체 결제액 (원)"
                    value={latest?.grossKrw ?? 0}
                  />
                  <NumberField
                    name="refundsKrw"
                    label="취소·환불액 (원)"
                    value={latest?.refundsKrw ?? 0}
                  />
                  <NumberField
                    name="wordOrders"
                    label="Word 성공 주문 (건)"
                    value={latest?.wordOrders ?? 0}
                  />
                  <NumberField
                    name="bundleOrders"
                    label="묶음 성공 주문 (건)"
                    value={latest?.bundleOrders ?? 0}
                  />
                  <NumberField
                    name="presentationOrders"
                    label="발표 추가 성공 주문 (건)"
                    value={latest?.presentationOrders ?? 0}
                  />
                  <NumberField
                    name="publishedVideos"
                    label="게시한 영상 (편)"
                    value={latest?.publishedVideos ?? 0}
                  />
                  <NumberField
                    name="views"
                    label="쇼츠 조회수 (회)"
                    value={latest?.views ?? null}
                    optional
                  />
                  <NumberField
                    name="siteVisits"
                    label="유튜브 유입 세션 (회)"
                    value={latest?.siteVisits ?? null}
                    optional
                  />
                  <NumberField
                    name="attributedOrders"
                    label="유튜브 확인 주문 (건)"
                    value={latest?.attributedOrders ?? null}
                    optional
                  />
                  <NumberField
                    name="attributedNetKrw"
                    label="유튜브 확인 매출 (원)"
                    value={latest?.attributedNetKrw ?? null}
                    optional
                  />
                </div>
                <label className="ops-note-label">
                  확인 메모
                  <textarea
                    name="note"
                    maxLength={300}
                    defaultValue={latest?.note ?? ""}
                    placeholder="확인한 자료와 고객 질문을 짧게 적으세요. 고객 이름·연락처는 넣지 않습니다."
                  />
                </label>
                <p className="ops-help">
                  묶음 주문을 Word 주문으로 중복 입력하지 않습니다. 유튜브 확인
                  매출은 출처가 확인된 주문의 환불 차감 금액입니다.
                </p>
                <button type="submit" disabled={busy}>
                  {busy ? "저장 중…" : "성과 저장"}
                </button>
              </form>
            </div>
            <div className="ops-side">
              <section className="ops-panel">
                <h2>고객이 움직인 단계</h2>
                <dl className="ops-funnel">
                  <div>
                    <dt>쇼츠 조회</dt>
                    <dd>{count(latest?.views ?? null)}</dd>
                  </div>
                  <div>
                    <dt>유튜브 유입 세션</dt>
                    <dd>{count(latest?.siteVisits ?? null)}</dd>
                  </div>
                  <div>
                    <dt>유튜브 확인 주문</dt>
                    <dd>{count(latest?.attributedOrders ?? null)}</dd>
                  </div>
                  <div>
                    <dt>유튜브 확인 매출</dt>
                    <dd>{money(latest?.attributedNetKrw ?? null)}</dd>
                  </div>
                </dl>
                <p className="ops-help">
                  전체 매출과 유튜브 매출을 구분합니다. 공통 프로필 링크로는
                  개별 영상의 매출을 단정할 수 없습니다.
                </p>
              </section>
              <section className="ops-panel">
                <h2>날짜별 매출</h2>
                {state.snapshots.length === 0 ? (
                  <p className="ops-empty">
                    성과를 저장하면 누적 기록이 쌓입니다.
                  </p>
                ) : (
                  <ol className="ops-history">
                    {state.snapshots.map((s) => (
                      <li key={s.asOf}>
                        <span>{s.asOf.slice(5)}</span>
                        <div className="ops-track">
                          <div
                            style={{
                              width: `${Math.min(100, ((s.grossKrw - s.refundsKrw) / state.goal.targetKrw) * 100)}%`,
                            }}
                          />
                        </div>
                        <strong>{money(s.grossKrw - s.refundsKrw)}</strong>
                      </li>
                    ))}
                  </ol>
                )}
                <p className="ops-help">
                  누적값을 합산하지 않습니다. 가장 최근 날짜의 값을 목표와
                  비교합니다.
                </p>
              </section>
            </div>
          </section>
          <section className="ops-panel">
            <div className="ops-section-title">
              <h2>영상 실행표</h2>
              <span>
                목표 {state.goal.plannedVideos}편 · 남은 게시{" "}
                {summary.remainingVideos === null
                  ? "미확인"
                  : `${summary.remainingVideos}편`}
              </span>
            </div>
            <p className="ops-help">
              같은 게시 후 경과 시간끼리 비교하세요. 24시간 조회수와 72시간
              조회수는 더하지 않습니다.
            </p>
            <div className="ops-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>예정일</th>
                    <th>주제</th>
                    <th>상품</th>
                    <th>상태</th>
                    <th>24시간</th>
                    <th>72시간</th>
                  </tr>
                </thead>
                <tbody>
                  {state.videos.map((v) => (
                    <tr key={v.id}>
                      <td>{v.plannedDate.slice(5)}</td>
                      <td>
                        {v.url ? (
                          <a
                            href={v.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {v.title}
                          </a>
                        ) : (
                          v.title
                        )}
                        <details>
                          <summary>수정</summary>
                          <VideoForm
                            video={v}
                            date={v.plannedDate}
                            submit={videoSubmit}
                            busy={busy}
                          />
                        </details>
                      </td>
                      <td>
                        {v.product === "word"
                          ? "Word"
                          : v.product === "bundle"
                            ? "묶음"
                            : "발표 추가"}
                      </td>
                      <td>
                        {v.status === "published"
                          ? "게시 완료"
                          : v.status === "ready"
                            ? "편집 완료"
                            : "계획"}
                      </td>
                      <td>{count(v.views24h)}</td>
                      <td>{count(v.views72h)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {state.videos.length === 0 && (
              <p className="ops-empty">첫 영상의 주제와 예정일을 등록하세요.</p>
            )}
            <details className="ops-details">
              <summary>영상 추가</summary>
              <VideoForm
                key={`new-${state.videos.map((video) => video.id).join(",")}`}
                date={state.goal.startDate}
                submit={videoSubmit}
                busy={busy}
              />
            </details>
          </section>
          <details className="ops-panel ops-details">
            <summary>목표와 계산 기준</summary>
            <GoalForm
              key={JSON.stringify(state.goal)}
              goal={state.goal}
              submit={goalSubmit}
              busy={busy}
            />
            <p className="ops-help">
              이곳의 Word 가격은 역산 기준입니다. 실제 상품 판매 가격을 바꾸지
              않습니다.
            </p>
          </details>
          <footer className="ops-footer">
            <span>
              기록 버전 {state.revision} · 최근 변경{" "}
              {state.audit.at(-1)?.at.slice(0, 19).replace("T", " ") ?? "없음"}{" "}
              UTC
            </span>
            <span>매출은 수수료·제작비·세금 차감 전 금액입니다.</span>
          </footer>
        </>
      )}
    </main>
  );
}
function Metric({
  label,
  value,
  detail,
  emphasis = false,
}: {
  label: string;
  value: string;
  detail: string;
  emphasis?: boolean;
}) {
  return (
    <div className={`ops-metric${emphasis ? " ops-metric-main" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}
