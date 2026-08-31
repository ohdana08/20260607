"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createClient, type SupabaseClient, type Session } from "@supabase/supabase-js";
import { AUTH_URL, AUTH_ANON_KEY } from "@/lib/auth/config";
import { track } from "@/lib/ga";

// 딱지원핏의 안내 랜딩은 공개하되 실제 도우미(/embed)는 Google 로그인이 필수다.
// BCC 홈페이지와 같은 Supabase 프로젝트를 사용하므로 기존 결제·수강 계정과 연결된다.

let _client: SupabaseClient | null = null;
function authClient(): SupabaseClient {
  if (!_client) {
    _client = createClient(AUTH_URL, AUTH_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
  }
  return _client;
}

function isGoogleSession(session: Session | null): session is Session {
  if (!session) return false;
  const providers = session.user.app_metadata?.providers;
  return (
    (Array.isArray(providers) && providers.includes("google")) ||
    session.user.identities?.some((identity) => identity.provider === "google") === true
  );
}

// ── 요청 직전에 "신선한" 토큰을 받는다 (2026-07-09 버그 수정) ────────────────
// 컨텍스트에 저장된 토큰 문자열은 1시간 뒤 만료될 수 있다 (시크릿 창·백그라운드 탭은
// 자동 갱신 타이머가 밀림). getSession() 은 만료 시 자동 갱신하므로 매 호출마다 이걸 쓴다.
export async function getFreshToken(): Promise<string | null> {
  try {
    const { data } = await authClient().auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

export async function authedHeaders(): Promise<Record<string, string>> {
  const t = await getFreshToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

// 401 을 받았을 때 마지막 시도: 리프레시 토큰으로 강제 갱신
export async function forceRefreshToken(): Promise<string | null> {
  try {
    const { data } = await authClient().auth.refreshSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

interface AuthCtx {
  session: Session | null;
  token: string | null;
  email: string | null;
  paid: boolean;
  localReview: boolean;
  setPaid: (v: boolean) => void;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function useAuth(): AuthCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside <AuthGate>");
  return v;
}

export default function AuthGate({
  children,
  allowLocalReview = false,
}: {
  children: ReactNode;
  allowLocalReview?: boolean;
}) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [paid, setPaid] = useState(false);

  useEffect(() => {
    const sb = authClient();
    sb.auth.getSession().then(async ({ data }) => {
      const current = data.session ?? null;
      if (current && !isGoogleSession(current)) await sb.auth.signOut();
      setSession(isGoogleSession(current) ? current : null);
      setReady(true);
    });
    const { data: sub } = sb.auth.onAuthStateChange((_e, s) => {
      setSession(isGoogleSession(s) ? s : null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // 로그인되면 결제 확인 상태를 서버에서 1회 조회
  useEffect(() => {
    const token = session?.access_token;
    if (!token) {
      Promise.resolve().then(() => setPaid(false));
      return;
    }
    fetch("/api/order/verify", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => setPaid(Boolean(d?.paid)))
      .catch(() => {});
  }, [session?.access_token]);

  const signOut = useCallback(async () => {
    await authClient().auth.signOut();
    setSession(null);
    setPaid(false);
  }, []);

  const ctx = useMemo<AuthCtx>(
    () => ({
      session,
      token: session?.access_token ?? null,
      email: session?.user?.email ?? null,
      paid,
      localReview: allowLocalReview,
      setPaid,
      signOut,
    }),
    [session, paid, allowLocalReview, signOut],
  );

  if (!ready) {
    return (
      <div className="flex flex-1 items-center justify-center py-20 text-sm text-zinc-400">
        불러오는 중…
      </div>
    );
  }
  if (!session && !allowLocalReview) {
    return <AuthCard />;
  }
  return <Ctx.Provider value={ctx}>{children}</Ctx.Provider>;
}

// 결과 직전 게이트용 모달 (B안) — 로그인/가입 성공 시 onAuthStateChange 가 세션을 채운다.
// onDone: 로그인 '성공'시에만 호출 (닫기/배경 클릭은 onClose) — 보관해 둔 작업을 이어갈 때 사용.
export function AuthModal({ onClose }: { onClose: () => void; onDone?: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40"
      onClick={onClose}
    >
      <div className="w-full" onClick={(e) => e.stopPropagation()}>
        <AuthCard />
      </div>
    </div>
  );
}

// ── 로그인/회원가입 카드 ──────────────────────────────────────────────────
function AuthCard() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function signInWithGoogle() {
    setBusy(true);
    setError("");
    track("sign_up", { method: "google" });
    const redirectTo = `${window.location.origin}${window.location.pathname}${window.location.search}`;
    const { error: oauthError } = await authClient().auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
        queryParams: { prompt: "select_account" },
      },
    });
    if (oauthError) {
      setError("Google 로그인 창을 열지 못했어요. 잠시 후 다시 시도해 주세요.");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-1 items-start justify-center px-4 py-10">
      <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold text-blue-600">딱, 지원핏 · BCC</p>
        <h2 className="mt-1 text-xl font-bold text-zinc-900">Google 로그인 후 시작합니다</h2>
        <p className="mt-1 text-xs leading-5 text-zinc-500">
          지원사업 찾기와 자격 확인을 사용하기 전에 본인의 Google 계정을 확인합니다.
          기존 결제 내역은 같은 이메일 계정에 연결됩니다.
        </p>

        {error && <p className="mt-2 text-xs text-red-500">{error}</p>}

        <button
          onClick={() => void signInWithGoogle()}
          disabled={busy}
          className="mt-5 flex w-full items-center justify-center gap-3 rounded-xl border border-zinc-300 bg-white py-3 text-sm font-semibold text-zinc-800 shadow-sm hover:border-blue-500 disabled:opacity-50"
        >
          <span className="grid h-6 w-6 place-items-center rounded-full bg-blue-600 font-bold text-white">G</span>
          {busy ? "Google 로그인으로 이동 중…" : "Google로 로그인하고 시작"}
        </button>

        <p className="mt-3 text-center text-[11px] leading-4 text-zinc-400">
          기본 프로필과 이메일만 로그인에 사용합니다. 입력한 실습 내용은 기존 정책에 따라 처리됩니다.
        </p>
      </div>
    </div>
  );
}
