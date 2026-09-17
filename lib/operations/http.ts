import {
  applyCommand,
  initialMonth,
  InputError,
  kstDate,
  parseMutation,
  summarize,
  validMonth,
  type OperationsMonth,
} from "./domain.ts";
import { OperationsStorageAccessError, type OperationsStore } from "./storage.ts";
import { randomUUID } from "node:crypto";
export interface Operator {
  id: string;
  isAdmin: boolean;
}
interface Dependencies {
  authenticate: (req: Request) => Promise<Operator | null>;
  store: () => OperationsStore;
  now?: () => Date;
  local?: boolean;
  observe?: (event: OperationsEvent) => void | Promise<void>;
}
export interface OperationsEvent {
  event: "operations_request";
  requestId: string;
  method: string;
  phase: "method" | "auth" | "origin" | "input" | "read" | "write";
  status: number;
  // Request handling time before optional alert delivery; excludes Slack wait.
  durationMs: number;
}
export function isLocalOperationsRequest(
  req: Request,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const url = new URL(req.url);
  const host = req.headers.get("host");
  return (
    env.NODE_ENV === "development" &&
    env.OPS_LOCAL_MODE === "on" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1") &&
    (host === null || /^(localhost|127\.0\.0\.1)(:\d{1,5})?$/.test(host))
  );
}
const HEADERS = {
  "Cache-Control": "private, no-store",
  Vary: "Authorization",
  "X-Content-Type-Options": "nosniff",
};
function sameOrigin(req: Request, origin: string): boolean {
  try {
    const source = new URL(origin),
      target = new URL(req.url);
    return (
      source.origin === target.origin ||
      (source.protocol === target.protocol &&
        source.host === req.headers.get("host"))
    );
  } catch {
    return false;
  }
}
function reply(value: unknown, status = 200) {
  return Response.json(value, { status, headers: HEADERS });
}
async function readJson(req: Request): Promise<unknown> {
  if (
    !req.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    throw new InputError("JSON 형식으로 보내 주세요.");
  const reader = req.body?.getReader();
  if (!reader) throw new InputError("저장할 내용이 없습니다.");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 16384) {
      await reader.cancel();
      throw new InputError("요청은 16KB 이하여야 합니다.");
    }
    chunks.push(value);
  }
  const all = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(all));
  } catch {
    throw new InputError("JSON 내용을 확인해 주세요.");
  }
}
function view(state: OperationsMonth, now: Date, local: boolean) {
  return {
    state,
    summary: summarize(state, kstDate(now)),
    mode: local ? "local" : "production",
    source: "manual_verified",
    automaticCollection: false,
  };
}
async function handleOperationsRequest(
  req: Request,
  deps: Dependencies,
  context: { phase: OperationsEvent["phase"] },
): Promise<Response> {
  try {
    if (!["GET", "PUT"].includes(req.method))
      return reply(
        { error: "지원하지 않는 요청입니다.", code: "method_not_allowed" },
        405,
      );
    context.phase = "auth";
    const user = await deps.authenticate(req);
    if (!user)
      return reply(
        { error: "로그인이 필요합니다.", code: "unauthorized" },
        401,
      );
    if (!user.isAdmin)
      return reply(
        { error: "관리자만 사용할 수 있습니다.", code: "forbidden" },
        403,
      );
    context.phase = "origin";
    const origin = req.headers.get("origin");
    if (req.method === "PUT" && origin && !sameOrigin(req, origin))
      return reply(
        {
          error: "다른 사이트에서 보낸 저장 요청입니다.",
          code: "origin_forbidden",
        },
        403,
      );
    const now = deps.now?.() ?? new Date();
    if (req.method === "GET") {
      context.phase = "input";
      const month =
        new URL(req.url).searchParams.get("month") ?? kstDate(now).slice(0, 7);
      if (!validMonth(month))
        throw new InputError("월은 YYYY-MM 형식이어야 합니다.");
      context.phase = "read";
      const state = (await deps.store().read(month)) ?? initialMonth(month);
      return reply(view(state, now, Boolean(deps.local)));
    }
    context.phase = "input";
    const mutation = parseMutation(await readJson(req), kstDate(now));
    context.phase = "read";
    const store = deps.store();
    const current =
      (await store.read(mutation.month)) ?? initialMonth(mutation.month);
    if (current.revision !== mutation.expectedRevision)
      return reply(
        {
          error:
            "다른 창에서 내용이 바뀌었습니다. 새로 불러온 뒤 다시 저장해 주세요.",
          code: "revision_conflict",
        },
        409,
      );
    const next = applyCommand(current, mutation.command, user.id, now);
    context.phase = "write";
    const stored = await store.compareAndSet(mutation.month, mutation.expectedRevision, next);
    if (stored === null)
      return reply(
        {
          error:
            "동시에 저장된 변경이 있습니다. 새로 불러온 뒤 다시 저장해 주세요.",
          code: "revision_conflict",
        },
        409,
      );
    return reply(view(stored, now, Boolean(deps.local)));
  } catch (error) {
    if (error instanceof InputError)
      return reply({ error: error.message, code: "invalid_input" }, 400);
    if (error instanceof OperationsStorageAccessError)
      return reply({ error: "운영 기록 접근 권한을 확인해 주세요.", code: "storage_forbidden" }, 403);
    return reply(
      {
        error:
          "운영 기록을 저장하거나 불러오지 못했습니다. 입력을 유지한 채 다시 시도해 주세요.",
        code: "storage_unavailable",
      },
      503,
    );
  }
}

export async function operationsRequest(req: Request, deps: Dependencies): Promise<Response> {
  const started = Date.now();
  const requestId = randomUUID();
  const context: { phase: OperationsEvent["phase"] } = { phase: "method" };
  const response = await handleOperationsRequest(req, deps, context);
  response.headers.set("X-Request-ID", requestId);
  const event: OperationsEvent = {
    event: "operations_request", requestId,
    method: ["GET", "PUT"].includes(req.method) ? req.method : "OTHER",
    phase: context.phase, status: response.status,
    durationMs: Math.max(0, Date.now() - started),
  };
  // Only bounded metadata. Never log user identifiers, payloads, URLs or error text.
  try {
    if (event.status >= 500) console.error(JSON.stringify(event));
    else console.info(JSON.stringify(event));
  } catch {
    // A log sink cannot change a completed write into a reported failure.
  }
  try {
    await deps.observe?.(event);
  } catch {
    // An optional alert failure cannot alter the original response either.
  }
  return response;
}
