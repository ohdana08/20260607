export type Product = "word" | "bundle" | "presentation";
export interface Goal {
  month: string;
  startDate: string;
  deadline: string;
  targetKrw: number;
  plannedVideos: number;
  wordPriceKrw: number;
}
export interface Snapshot {
  asOf: string;
  grossKrw: number;
  refundsKrw: number;
  wordOrders: number;
  bundleOrders: number;
  presentationOrders: number;
  publishedVideos: number;
  views: number | null;
  siteVisits: number | null;
  attributedOrders: number | null;
  attributedNetKrw: number | null;
  note: string;
}
export interface Video {
  id: string;
  title: string;
  plannedDate: string;
  product: Product;
  status: "planned" | "ready" | "published";
  url: string;
  views24h: number | null;
  views72h: number | null;
}
export interface AuditEntry {
  revision: number;
  kind: Command["kind"];
  key: string;
  actorId: string;
  at: string;
}
export interface OperationsMonth {
  schemaVersion: 1;
  revision: number;
  goal: Goal;
  snapshots: Snapshot[];
  videos: Video[];
  audit: AuditEntry[];
}
export type Command =
  | { kind: "goal"; value: Goal }
  | { kind: "snapshot"; value: Snapshot }
  | { kind: "video"; value: Video };
export interface Mutation {
  month: string;
  expectedRevision: number;
  command: Command;
}
export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputError";
  }
}
const DAY = 86_400_000;
export function kstDate(now = new Date()): string {
  return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}
export function validMonth(value: unknown): value is string {
  return typeof value === "string" && /^20\d{2}-(0[1-9]|1[0-2])$/.test(value);
}
export function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^20\d{2}-\d{2}-\d{2}$/.test(value))
    return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new InputError("입력 형식을 확인해 주세요.");
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some((key) => !keys.includes(key)))
    throw new InputError("허용되지 않은 입력 항목입니다.");
  return result;
}
function integer(
  value: unknown,
  name: string,
  maximum = 1_000_000_000_000,
  minimum = 0,
): number {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < minimum ||
    Number(value) > maximum
  )
    throw new InputError(
      `${name}: ${minimum} 이상 ${maximum} 이하 정수를 입력해 주세요.`,
    );
  return value as number;
}
function optionalInteger(value: unknown, name: string): number | null {
  return value === null ? null : integer(value, name);
}
function text(value: unknown, name: string, max: number): string {
  if (typeof value !== "string" || value.length > max)
    throw new InputError(`${name}: ${max}자 이내로 입력해 주세요.`);
  return value.trim();
}
export function parseGoal(value: unknown, month: string): Goal {
  const v = object(value, [
    "month",
    "startDate",
    "deadline",
    "targetKrw",
    "plannedVideos",
    "wordPriceKrw",
  ]);
  if (
    v.month !== month ||
    !validDate(v.startDate) ||
    !validDate(v.deadline) ||
    !v.startDate.startsWith(month) ||
    !v.deadline.startsWith(month) ||
    v.startDate > v.deadline
  )
    throw new InputError(
      "시작일과 마감일은 선택한 월 안의 실제 날짜여야 합니다.",
    );
  return {
    month,
    startDate: v.startDate,
    deadline: v.deadline,
    targetKrw: integer(v.targetKrw, "목표 매출", 1_000_000_000_000, 1),
    plannedVideos: integer(v.plannedVideos, "계획 영상", 1000, 1),
    wordPriceKrw: integer(v.wordPriceKrw, "Word 가격", 100_000_000, 1),
  };
}
export function parseSnapshot(
  value: unknown,
  month: string,
  today: string,
): Snapshot {
  const fields = [
    "asOf",
    "grossKrw",
    "refundsKrw",
    "wordOrders",
    "bundleOrders",
    "presentationOrders",
    "publishedVideos",
    "views",
    "siteVisits",
    "attributedOrders",
    "attributedNetKrw",
    "note",
  ];
  const v = object(value, fields);
  if (!validDate(v.asOf) || !v.asOf.startsWith(month) || v.asOf > today)
    throw new InputError(
      "성과 날짜는 선택한 월 안에서 오늘까지 지정해 주세요.",
    );
  const grossKrw = integer(v.grossKrw, "결제액");
  const refundsKrw = integer(v.refundsKrw, "취소·환불액");
  if (refundsKrw > grossKrw)
    throw new InputError(
      "취소·환불액은 이달에 집계한 주문의 결제액을 넘을 수 없습니다.",
    );
  const wordOrders = integer(v.wordOrders, "Word 주문"),
    bundleOrders = integer(v.bundleOrders, "묶음 주문"),
    presentationOrders = integer(v.presentationOrders, "발표 추가 주문");
  const attributedOrders = optionalInteger(
    v.attributedOrders,
    "유튜브 확인 주문",
  );
  const attributedNetKrw = optionalInteger(
    v.attributedNetKrw,
    "유튜브 확인 매출",
  );
  if (
    attributedOrders !== null &&
    attributedOrders > wordOrders + bundleOrders + presentationOrders
  )
    throw new InputError(
      "유튜브 확인 주문은 전체 성공 주문을 넘을 수 없습니다.",
    );
  if (attributedNetKrw !== null && attributedNetKrw > grossKrw - refundsKrw)
    throw new InputError(
      "유튜브 확인 매출은 전체 환불 차감 매출을 넘을 수 없습니다.",
    );
  return {
    asOf: v.asOf,
    grossKrw,
    refundsKrw,
    wordOrders,
    bundleOrders,
    presentationOrders,
    publishedVideos: integer(v.publishedVideos, "게시 영상", 1000),
    views: optionalInteger(v.views, "조회수"),
    siteVisits: optionalInteger(v.siteVisits, "방문 세션"),
    attributedOrders,
    attributedNetKrw,
    note: text(v.note, "확인 메모", 300),
  };
}
export function parseVideo(value: unknown, month: string): Video {
  const v = object(value, [
    "id",
    "title",
    "plannedDate",
    "product",
    "status",
    "url",
    "views24h",
    "views72h",
  ]);
  const id = text(v.id, "영상 ID", 64);
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id))
    throw new InputError("영상 ID 형식을 확인해 주세요.");
  const title = text(v.title, "제목", 120);
  if (!title) throw new InputError("영상 제목을 입력해 주세요.");
  if (!validDate(v.plannedDate) || !v.plannedDate.startsWith(month))
    throw new InputError("영상 날짜는 선택한 월 안에 있어야 합니다.");
  if (
    typeof v.product !== "string" ||
    !["word", "bundle", "presentation"].includes(v.product) ||
    typeof v.status !== "string" ||
    !["planned", "ready", "published"].includes(v.status)
  )
    throw new InputError("상품 또는 영상 상태를 확인해 주세요.");
  const url = text(v.url, "게시 주소", 500);
  if (url) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new InputError("YouTube 게시 주소를 입력해 주세요.");
    }
    if (
      parsed.protocol !== "https:" ||
      !["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].includes(
        parsed.hostname,
      ) ||
      parsed.username ||
      parsed.password
    )
      throw new InputError("https YouTube 주소만 저장할 수 있습니다.");
  }
  if (v.status === "published" && !url)
    throw new InputError("게시 완료 영상에는 실제 게시 주소가 필요합니다.");
  return {
    id,
    title,
    plannedDate: v.plannedDate,
    product: v.product as Product,
    status: v.status as Video["status"],
    url,
    views24h: optionalInteger(v.views24h, "24시간 조회수"),
    views72h: optionalInteger(v.views72h, "72시간 조회수"),
  };
}
export function parseMutation(value: unknown, today = kstDate()): Mutation {
  const v = object(value, ["month", "expectedRevision", "command"]);
  if (!validMonth(v.month))
    throw new InputError("월은 YYYY-MM 형식으로 입력해 주세요.");
  const c = object(v.command, ["kind", "value"]);
  let command: Command;
  if (c.kind === "goal")
    command = { kind: "goal", value: parseGoal(c.value, v.month) };
  else if (c.kind === "snapshot")
    command = {
      kind: "snapshot",
      value: parseSnapshot(c.value, v.month, today),
    };
  else if (c.kind === "video")
    command = { kind: "video", value: parseVideo(c.value, v.month) };
  else throw new InputError("지원하지 않는 저장 요청입니다.");
  return {
    month: v.month,
    expectedRevision: integer(v.expectedRevision, "문서 버전"),
    command,
  };
}
export function initialMonth(month: string): OperationsMonth {
  if (!validMonth(month)) throw new InputError("월 형식을 확인해 주세요.");
  const last = new Date(
    Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0),
  )
    .toISOString()
    .slice(0, 10);
  return {
    schemaVersion: 1,
    revision: 0,
    goal: {
      month,
      startDate: month === "2026-09" ? "2026-09-17" : `${month}-01`,
      deadline: last,
      targetKrw: 1000000,
      plannedVideos: month === "2026-09" ? 14 : Number(last.slice(8)),
      wordPriceKrw: 29900,
    },
    snapshots: [],
    videos: [],
    audit: [],
  };
}
export function applyCommand(
  current: OperationsMonth,
  command: Command,
  actorId: string,
  now = new Date(),
): OperationsMonth {
  const next = structuredClone(current);
  const revision = current.revision + 1;
  let key = current.goal.month;
  if (command.kind === "goal") next.goal = command.value;
  if (command.kind === "snapshot") {
    key = command.value.asOf;
    next.snapshots = next.snapshots
      .filter((s) => s.asOf !== key)
      .concat(command.value)
      .sort((a, b) => a.asOf.localeCompare(b.asOf));
  }
  if (command.kind === "video") {
    key = command.value.id;
    if (!next.videos.some((v) => v.id === key) && next.videos.length >= 100)
      throw new InputError("월별 영상은 최대 100개까지 기록할 수 있습니다.");
    next.videos = next.videos
      .filter((v) => v.id !== key)
      .concat(command.value)
      .sort(
        (a, b) =>
          a.plannedDate.localeCompare(b.plannedDate) ||
          a.id.localeCompare(b.id),
      );
  }
  next.revision = revision;
  next.audit = next.audit
    .concat({
      revision,
      kind: command.kind,
      key,
      actorId,
      at: now.toISOString(),
    })
    .slice(-100);
  return next;
}
export function summarize(state: OperationsMonth, today = kstDate()) {
  const latest = state.snapshots.filter((s) => s.asOf <= today).at(-1) ?? null;
  const goal = state.goal;
  const remainingDays = Math.max(
    0,
    Math.round(
      (Date.parse(goal.deadline) -
        Date.parse(today > goal.startDate ? today : goal.startDate)) /
        DAY,
    ) + 1,
  );
  const netKrw = latest ? latest.grossKrw - latest.refundsKrw : null;
  const remainingKrw =
    netKrw === null ? null : Math.max(0, goal.targetKrw - netKrw);
  const neededWordOrders =
    remainingKrw === null ? null : Math.ceil(remainingKrw / goal.wordPriceKrw);
  const remainingVideos = latest
    ? Math.max(0, goal.plannedVideos - latest.publishedVideos)
    : null;
  let nextAction =
    "결제 관리와 YouTube Studio에서 확인한 누적 성과를 입력하세요. 모르는 지표는 빈칸으로 둡니다.";
  if (latest) {
    if (remainingKrw === 0)
      nextAction =
        "목표 매출을 채웠습니다. 결과물 제공과 환불을 확인하고 다음 달 목표를 정하세요.";
    else if (remainingDays === 0)
      nextAction =
        "목표 기한이 지났습니다. 이번 달 결과를 확인하고 다음 달 목표를 별도로 설정하세요.";
    else if (latest.publishedVideos === 0)
      nextAction =
        "프로필에서 예시·가격으로 연결되는지 확인하고 판매형 영상 1편을 게시하세요.";
    else if (latest.views === null || latest.siteVisits === null)
      nextAction =
        "조회수와 유튜브 유입 세션을 확인하세요. 집계되지 않은 값은 0으로 바꾸지 않습니다.";
    else if (latest.views === 0)
      nextAction =
        "공개 게시 여부와 집계 시간을 확인한 뒤 첫 3초의 고객 상황을 구체화하세요.";
    else if (latest.siteVisits === 0)
      nextAction =
        "프로필 링크와 마지막 안내를 확인하고 예시·가격을 볼 이유를 보여주세요.";
    else if (latest.attributedOrders === null)
      nextAction =
        "결제 원본과 유입 출처를 대조하세요. 출처를 모르는 주문은 유튜브 주문으로 세지 않습니다.";
    else if (latest.attributedOrders === 0)
      nextAction =
        "시작·미리보기·결제 중 멈춘 지점과 고객 질문을 확인하세요. 방문이 적으면 비율 판단을 보류합니다.";
    else
      nextAction =
        "유튜브에서 온 실제 주문의 결과물 제공을 확인하고, 같은 문제의 다른 사례 영상을 만드세요.";
  }
  return {
    latest,
    netKrw,
    remainingKrw,
    remainingDays,
    neededWordOrders,
    remainingVideos,
    progress: netKrw === null ? null : netKrw / goal.targetKrw,
    dailyRevenueKrw:
      remainingKrw === null
        ? null
        : remainingKrw === 0
          ? 0
          : remainingDays
            ? Math.ceil(remainingKrw / remainingDays)
            : null,
    ordersPer100Visits:
      latest?.siteVisits && latest.attributedOrders !== null
        ? (latest.attributedOrders / latest.siteVisits) * 100
        : null,
    nextAction,
    today,
  };
}
