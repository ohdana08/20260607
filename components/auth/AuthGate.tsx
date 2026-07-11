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

// ── 회원가입 게이트 (2026-07-09 ③ 결정 → 2026-07-10 시점 토글) ──────────
// 도우미 사용은 BCC 통합 회원(bcc-homepage 회원가입결제시스템) 로그인 필수.
// 목적: 리드 확보 + API 남용 방지 + 결제(주문번호) 매칭 단순화.
//
// 게이트 시점 (2026-07-10 확정):
//   기본(B안) = 진단 완료 후 결과 보기 직전 — Chat.tsx submitEvidence 에서 AuthModal.
//   C안(첫 화면 필수) = Vercel env NEXT_PUBLIC_AUTH_GATE=entry 설정 후 재배포.
//   (NEXT_PUBLIC_* 는 빌드 시점에 박히므로 env 변경만으로는 안 바뀜 — 재배포 필수)
const GATE_AT_ENTRY = process.env.NEXT_PUBLIC_AUTH_GATE === "entry";

let _client: SupabaseClient | null = null;
function authClient(): SupabaseClient {
  if (!_client) {
    _client = createClient(AUTH_URL, AUTH_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
  }
  return _client;
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
  setPaid: (v: boolean) => void;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function useAuth(): AuthCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside <AuthGate>");
  return v;
}

export default function AuthGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [paid, setPaid] = useState(false);

  useEffect(() => {
    const sb = authClient();
    sb.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null);
      setReady(true);
    });
    const { data: sub } = sb.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // 로그인되면 결제 확인 상태를 서버에서 1회 조회
  useEffect(() => {
    const token = session?.access_token;
    if (!token) {
      setPaid(false);
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
      setPaid,
      signOut,
    }),
    [session, paid, signOut],
  );

  if (!ready) {
    return (
      <div className="flex flex-1 items-center justify-center py-20 text-sm text-zinc-400">
        불러오는 중…
      </div>
    );
  }
  if (!session && GATE_AT_ENTRY) {
    return <AuthCard onLogin={(s) => setSession(s)} />;
  }
  // B안(기본): 로그인 없이 통과 — 진단 결과 직전에 Chat 이 AuthModal 로 게이트.
  return <Ctx.Provider value={ctx}>{children}</Ctx.Provider>;
}

// 결과 직전 게이트용 모달 (B안) — 로그인/가입 성공 시 onAuthStateChange 가 세션을 채운다.
// onDone: 로그인 '성공'시에만 호출 (닫기/배경 클릭은 onClose) — 보관해 둔 작업을 이어갈 때 사용.
export function AuthModal({ onClose, onDone }: { onClose: () => void; onDone?: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40"
      onClick={onClose}
    >
      <div className="w-full" onClick={(e) => e.stopPropagation()}>
        <AuthCard onLogin={() => (onDone ? onDone() : onClose())} />
      </div>
    </div>
  );
}

// ── 로그인/회원가입 카드 ──────────────────────────────────────────────────
function AuthCard({ onLogin }: { onLogin: (s: Session) => void }) {
  const [tab, setTab] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [privacy, setPrivacy] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function doLogin(loginEmail = email, loginPw = password) {
    setBusy(true);
    setError("");
    const { data, error: err } = await authClient().auth.signInWithPassword({
      email: loginEmail.trim().toLowerCase(),
      password: loginPw,
    });
    setBusy(false);
    if (err || !data.session) {
      setError("이메일 또는 비밀번호가 맞지 않아요.");
      return;
    }
    onLogin(data.session);
  }

  async function doSignup() {
    if (!name.trim() || !phone.trim() || !email.trim()) {
      setError("이름·연락처·이메일을 모두 입력해 주세요.");
      return;
    }
    if (password.length < 8) {
      setError("비밀번호는 8자 이상이어야 해요.");
      return;
    }
    if (!privacy) {
      setError("개인정보 수집·이용에 동의해 주세요.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          phone: phone.trim(),
          email: email.trim().toLowerCase(),
          password,
          privacyConsent: privacy,
          marketingConsent: marketing,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBusy(false);
        setError(String(data?.error || "가입에 실패했어요. 잠시 후 다시 시도해 주세요."));
        if (res.status === 409) setTab("login");
        return;
      }
      // GA4 퍼널: 가입 완료 (③ 결정 — 가입 전환율 측정)
      track("sign_up", { method: "govplan" });
      setNotice("가입 완료! 바로 로그인할게요…");
      await doLogin(email, password);
    } catch {
      setError("가입 서버와 연결하지 못했어요.");
    } finally {
      setBusy(false);
    }
  }

  const input =
    "w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500";

  return (
    <div className="flex flex-1 items-start justify-center px-4 py-10">
      <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold text-blue-600">정부지원사업 도우미</p>
        <h2 className="mt-1 text-lg font-bold text-zinc-900">
          {tab === "login" ? "로그인하고 시작하기" : "회원가입하고 시작하기"}
        </h2>
        <p className="mt-1 text-xs leading-5 text-zinc-500">
          지원사업 찾기·3분 진단은 무료예요. 가입 한 번이면 진단 기록과 결제 확인이 계정에
          안전하게 연결돼요.
        </p>

        <div className="mt-4 grid grid-cols-2 gap-1 rounded-xl bg-zinc-100 p-1 text-sm font-semibold">
          {(["login", "signup"] as const).map((t) => (
            <button
              key={t}
              onClick={() => {
                setTab(t);
                setError("");
              }}
              className={`rounded-lg py-1.5 ${tab === t ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500"}`}
            >
              {t === "login" ? "로그인" : "회원가입"}
            </button>
          ))}
        </div>

        <div className="mt-4 space-y-2">
          {tab === "signup" && (
            <>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="이름" className={input} />
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="연락처 (숫자만)"
                inputMode="numeric"
                className={input}
              />
            </>
          )}
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="이메일"
            type="email"
            className={input}
          />
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={tab === "signup" ? "비밀번호 (8자 이상)" : "비밀번호"}
            type="password"
            className={input}
            onKeyDown={(e) => {
              if (e.key === "Enter" && tab === "login") void doLogin();
            }}
          />
          {tab === "signup" && (
            <div className="space-y-1.5 pt-1 text-xs text-zinc-600">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={privacy} onChange={(e) => setPrivacy(e.target.checked)} />
                (필수) 개인정보 수집·이용에 동의합니다
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} />
                (선택) 유용한 소식 받기에 동의합니다
              </label>
            </div>
          )}
        </div>

        {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
        {notice && <p className="mt-2 text-xs text-emerald-600">{notice}</p>}

        <button
          onClick={() => (tab === "login" ? void doLogin() : void doSignup())}
          disabled={busy}
          className="mt-4 w-full rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? "잠시만요…" : tab === "login" ? "로그인" : "가입하고 시작하기"}
        </button>

        <p className="mt-3 text-center text-[11px] leading-4 text-zinc-400">
          BCC 홈페이지 계정과 같은 계정이에요. 이미 가입하셨다면 로그인 탭을 이용해 주세요.
        </p>
      </div>
    </div>
  );
}
