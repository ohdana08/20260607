import { AUTH_ANON_KEY, AUTH_URL } from "@/lib/auth/config";

export interface GoogleUser {
  id: string;
  email: string;
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
      app_metadata?: { providers?: string[] };
      identities?: Array<{ provider?: string }>;
    };
    const providers = user.app_metadata?.providers;
    const isGoogle =
      (Array.isArray(providers) && providers.includes("google")) ||
      user.identities?.some((identity) => identity.provider === "google") === true;

    return user.id && isGoogle ? { id: user.id, email: user.email ?? "" } : null;
  } catch {
    return null;
  }
}

export async function googleLoginGate(req: Request): Promise<Response | null> {
  const user = await getGoogleUser(req);
  if (user) return null;
  return Response.json(
    { error: "Google 로그인 후 이용해 주세요.", reason: "google_login_required" },
    { status: 401 },
  );
}
