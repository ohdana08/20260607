import { AUTH_ANON_KEY, AUTH_URL } from "./config.ts";
import { isLocalReviewMatchRequest } from "./localReview.ts";
import { isMasterCode } from "../plan/access.ts";

export interface GoogleUser {
  id: string;
  email: string;
  isAdmin: boolean;
}

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

export async function getGoogleUser(req: Request): Promise<GoogleUser | null> {
  const authorization = req.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) return null;

  try {
    const response = await fetch(`${AUTH_URL}/auth/v1/user`, {
      headers: { apikey: AUTH_ANON_KEY, Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!response.ok) return null;

    const user = (await response.json()) as {
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
  } catch {
    return null;
  }
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
