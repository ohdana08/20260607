"use client";

import { useEffect, useState } from "react";
import { authedHeaders } from "@/components/auth/AuthGate";
import { track } from "@/lib/ga";
import type { EntryConditions } from "@/lib/entry/conditions";

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
type PushConfig = { enabled: boolean; publicKey: string | null; consentVersion: string };
const CONSENT_VERSION = "2026-11-12";
function applicationKey(value: string): Uint8Array<ArrayBuffer> {
  const bytes = atob(value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4));
  return Uint8Array.from(bytes, c => c.charCodeAt(0));
}

export default function PushPanel({ conditions }: { conditions: EntryConditions }) {
  const [config, setConfig] = useState<PushConfig | null>(null);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(false);
  const [ios, setIos] = useState(false);
  const [supported, setSupported] = useState(false);
  const [consent, setConsent] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    // Read browser capabilities after mount (deferred to avoid synchronous setState in the effect body).
    queueMicrotask(() => {
      if (!active) return;
      setInstalled(matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
      setIos(/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
      setSupported("serviceWorker" in navigator && "PushManager" in window && "Notification" in window);
    });
    const onPrompt = (event: Event) => { event.preventDefault(); setInstallPrompt(event as InstallPrompt); track("pwa_install_prompt", { stage: "available" }); };
    const onInstalled = () => { setInstalled(true); setInstallPrompt(null); track("pwa_install_complete"); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    // Prompt may already have arrived before Google login mounted this panel.
    const previous = (window as Window & { ddakfitInstallPrompt?: InstallPrompt }).ddakfitInstallPrompt;
    if (previous) queueMicrotask(() => { if (active) setInstallPrompt(previous); });
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then(() => navigator.serviceWorker.ready).then(reg => { if (active) setRegistration(reg); })
      .catch(() => { if (active) setError("앱 설치 준비에 실패했어요. 새로고침해 주세요."); });
    fetch("/api/push/config").then(async response => { if (!response.ok) throw new Error(); return response.json(); })
      .then(data => { if (active) setConfig(data); }).catch(() => { if (active) setError("알림 설정을 불러오지 못했어요. 새로고침해 주세요."); });
    authedHeaders().then(headers => fetch("/api/push/subscription", { headers })).then(async response => {
      if (!response.ok) throw new Error(); return response.json();
    }).then(data => { if (active) setSubscribed(Boolean(data.subscribed)); }).catch(() => { /* Config remains visible; no invented subscription success. */ });
    return () => { active = false; window.removeEventListener("beforeinstallprompt", onPrompt); window.removeEventListener("appinstalled", onInstalled); };
  }, []);

  async function install() {
    if (!installPrompt) return;
    setError("");
    try {
      track("pwa_install_prompt", { stage: "shown" });
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === "dismissed") setMessage("나중에 브라우저 메뉴에서 홈 화면에 추가할 수 있어요.");
      else setMessage("설치가 끝나면 홈 화면의 딱지원핏 아이콘을 열어 주세요.");
      setInstallPrompt(null);
      delete (window as Window & { ddakfitInstallPrompt?: InstallPrompt }).ddakfitInstallPrompt;
    } catch { setError("설치 창을 열지 못했어요. 브라우저 메뉴에서 홈 화면에 추가해 주세요."); }
  }

  async function subscribe() {
    if (!consent || !registration || !config?.enabled || !config.publicKey || !supported) return;
    setBusy(true); setError(""); setMessage("");
    let created: PushSubscription | null = null;
    try {
      // Must be the first async operation in the user's click on iOS.
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setMessage("알림이 허용되지 않았어요. 원하실 때 브라우저 또는 기기 설정에서 허용할 수 있어요."); return; }
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) { subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationKey(config.publicKey) }); created = subscription; }
      const response = await fetch("/api/push/subscription", { method: "POST", headers: { "Content-Type": "application/json", ...await authedHeaders() }, body: JSON.stringify({ subscription: subscription.toJSON(), conditions, consent: true, consentVersion: CONSENT_VERSION }) });
      if (!response.ok) throw new Error("save_failed");
      setSubscribed(true); setMessage("알림 신청이 완료됐어요. 현재 선택한 조건으로 알려 드릴게요."); track("push_optin");
    } catch {
      if (created) await created.unsubscribe().catch(() => false);
      setError("알림 신청을 저장하지 못했어요. 다시 시도해 주세요.");
    } finally { setBusy(false); }
  }
  async function unsubscribe() {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/push/subscription", { method: "DELETE", headers: { "Content-Type": "application/json", ...await authedHeaders() }, body: "{}" });
      if (!response.ok) throw new Error("delete_failed");
      // Server revocation is authoritative even if the browser no longer has a subscription.
      setSubscribed(false); setConsent(false); track("push_optout");
      setMessage("이 계정의 공고 알림을 해지했어요.");
      const sub = await registration?.pushManager.getSubscription();
      await sub?.unsubscribe().catch(() => false);
    } catch { setError("해지 결과를 확인하지 못했어요. 다시 시도해 주세요."); }
    finally { setBusy(false); }
  }
  return <div className="entry-push-panel">
    {!installed && <div className="entry-install"><h3>1. 홈 화면에 딱지원핏 추가하기</h3>
      {ios ? <><p>Safari의 공유 버튼 → 홈 화면에 추가 → 추가한 아이콘을 열어 주세요. iOS 16.4 이상에서 알림을 받을 수 있어요.</p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/pwa/ios-install.svg" alt="1 공유 버튼 누르기, 2 홈 화면에 추가, 3 딱지원핏 아이콘 열기" width="620" height="190" />
      </> : installPrompt ? <button className="entry-secondary" onClick={() => void install()}>홈 화면에 추가</button> : <p>브라우저 메뉴에서 ‘앱 설치’ 또는 ‘홈 화면에 추가’를 선택해 주세요. 이미 설치했다면 홈 화면의 아이콘으로 열어 주세요.</p>}
    </div>}
    <h3>{installed ? "새 공고 알림 설정" : "2. 알림 허용하기"}</h3>
    {!supported && <p>이 브라우저에서는 알림을 사용할 수 없어요. 지원되는 브라우저에서 설치 후 다시 열어 주세요.</p>}
    {config && !config.enabled && <p className="entry-caution">공고 알림을 준비 중이에요. 알림 신청이 가능해지면 이 화면에서 설정할 수 있어요.</p>}
    <label className="entry-consent"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} />
      <span>내 조건에 맞는 정보성 공고 알림을 받는 데 동의합니다. 광고가 아니며 언제든 해지할 수 있어요. 하루 최대 한 번, 월요일에는 주간 묶음으로 보내 드려요.</span></label>
    <button className="entry-primary" disabled={busy || !consent || !supported || !installed || !registration || !config?.enabled} onClick={() => void subscribe()}>{busy ? "처리 중…" : subscribed ? "이 기기에서 현재 조건으로 알림 받기" : "알림 허용하고 신청 완료"}</button>
    {subscribed && <button className="entry-text-button" disabled={busy} onClick={() => void unsubscribe()}>이 계정의 모든 공고 알림 해지</button>}
    {message && <p role="status">{message}</p>}{error && <p role="alert" className="entry-error">{error}</p>}
  </div>;
}
