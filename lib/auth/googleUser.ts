import { AUTH_ANON_KEY, AUTH_URL } from "./config.ts";
import { isLocalReviewMatchRequest } from "./localReview.ts";
import { isMasterCode } from "../plan/access.ts";

export interface GoogleUser {
  id: string;
  email: string;
  isAdmin: boolean;
}
export class GoogleAuthDependencyError extends Error {
  constructor(readonly reason: "timeout" | "rate_limited" | "upstream_error" | "network" | "invalid_response") {
    super("Authentication service unavailable");
    this.name = "GoogleAuthDependencyError";
  }
}
export class GoogleAuthTimeoutError extends GoogleAuthDependencyError {
  constructor() {
    super("timeout");
    this.name = "GoogleAuthTimeoutError";
  }
}
const AUTH_TIMEOUT_MS = 2_000;

function configuredAdminEmails(): Set<string> {
  return new Set(
    String(process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

function hasAdminMetadata(metadata: {
  role?: unknown;
  roles?: unknown;
  is_admin?: unknown;
}): boolean {
  const role = String(metadata.role ?? "").trim().toLowerCase();
  const roles = Array.isArray(metadata.roles)
    ? metadata.roles.map((item) => String(item).trim().toLowerCase())
    : [];
  return metadata.is_admin === true || role === "admin" || roles.includes("admin");
}

async function verifyGoogleToken(token: string): Promise<GoogleUser | null> {
  const started = Date.now();
  const signal = AbortSignal.timeout(AUTH_TIMEOUT_MS);
  try {
    const response = await fetch(`${AUTH_URL}/auth/v1/user`, {
      headers: { apikey: AUTH_ANON_KEY, Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal,
    });
    if (response.status === 429) throw new GoogleAuthDependencyError("rate_limited");
    if (response.status >= 500) throw new GoogleAuthDependencyError("upstream_error");
    if (!response.ok) return null;

    let body: unknown;
    try { body = await response.json(); }
    catch { throw new GoogleAuthDependencyError("invalid_response"); }
    if (!body || typeof body !== "object" || Array.isArray(body) ||
      !("id" in body) || typeof body.id !== "string" || !body.id ||
      ("email" in body && body.email !== undefined && typeof body.email !== "string")) {
      throw new GoogleAuthDependencyError("invalid_response");
    }
    if (("app_metadata" in body && (!body.app_metadata || typeof body.app_metadata !== "object" || Array.isArray(body.app_metadata))) ||
      ("identities" in body && (!Array.isArray(body.identities) || body.identities.some((identity) =>
        !identity || typeof identity !== "object" || ("provider" in identity && typeof identity.provider !== "string"))))) {
      throw new GoogleAuthDependencyError("invalid_response");
    }
    const user = body as {
      id?: string;
      email?: string;
      app_metadata?: {
        providers?: string[];
        role?: unknown;
        roles?: unknown;
        is_admin?: unknown;
      };
      identities?: Array<{ provider?: string }>;
    };
    const providers = user.app_metadata?.providers;
    const isGoogle =
      (Array.isArray(providers) && providers.includes("google")) ||
      user.identities?.some((identity) => identity.provider === "google") === true;

    if (!user.id || !isGoogle) return null;
    const email = user.email ?? "";
    const isAdmin =
      hasAdminMetadata(user.app_metadata ?? {}) ||
      configuredAdminEmails().has(email.trim().toLowerCase());
    return { id: user.id, email, isAdmin };
  } catch (error) {
    const failure = signal.aborted ? new GoogleAuthTimeoutError()
      : error instanceof GoogleAuthDependencyError ? error : new GoogleAuthDependencyError("network");
    try {
      console.error(JSON.stringify({
        event: "auth_verification", outcome: failure.reason, timeoutMs: AUTH_TIMEOUT_MS,
        durationMs: Math.min(300_000, Math.max(0, Date.now() - started)),
      }));
    } catch { /* A metric sink cannot change authentication semantics. */ }
    throw failure;
  }
}

// Route handlers do not run in a React render cache. Share only this Request's
// verified identity, never a cross-request session or mutable paid entitlement.
// A short upper bound also rechecks a Request reused by a long-running handler.
const requestUsers = new WeakMap<Request, {
  token: string;
  until: number;
  user: Promise<GoogleUser | null>;
}>();
const REQUEST_AUTH_WINDOW_MS = 5_000;

export async function getGoogleUser(
  req: Request,
  options: { dependencyErrors?: boolean } = {},
): Promise<GoogleUser | null> {
  const authorization = req.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) { requestUsers.delete(req); return null; }
  let entry = requestUsers.get(req);
  if (!entry || entry.token !== token || Date.now() >= entry.until) {
    entry = { token, until: Date.now() + REQUEST_AUTH_WINDOW_MS, user: verifyGoogleToken(token) };
    requestUsers.set(req, entry);
  }
  let user: GoogleUser | null;
  try {
    user = await entry.user;
  } catch (error) {
    if (requestUsers.get(req) === entry) requestUsers.delete(req);
    if (options.dependencyErrors && error instanceof GoogleAuthDependencyError) throw error;
    return null;
  }
  // Do not retain transient errors or rejected sessions; the next check may retry.
  if (!user && requestUsers.get(req) === entry) requestUsers.delete(req);
  return user ? { ...user } : null;
}

export async function googleLoginGate(req: Request): Promise<Response | null> {
  if (isLocalReviewMatchRequest(req)) return null;
  const user = await getGoogleUser(req);
  if (user) return null;
  return Response.json(
    { error: "Google 로그인 후 이용해 주세요.", reason: "google_login_required" },
    { status: 401 },
  );
}

// 운영자 마스터 코드는 원래 결제·공고 바인딩 없이 유료 흐름을 점검하는 수단이다.
// 유료 라우트가 로그인 검사를 먼저 실행해 이 경로를 막지 않도록, 등록된 마스터 코드만 예외 처리한다.
export async function paidGoogleLoginGate(req: Request, code: unknown): Promise<Response | null> {
  if (isMasterCode(code)) return null;
  return googleLoginGate(req);
}
