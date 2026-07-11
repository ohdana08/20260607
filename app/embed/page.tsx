import type { Metadata } from "next";
import Chat from "@/components/chat/Chat";
import AuthGate from "@/components/auth/AuthGate";
import { MAINTENANCE } from "@/lib/config";
import Maintenance from "@/components/Maintenance";

export const metadata: Metadata = {
  title: "정부지원사업 사업계획서 도우미",
};

// Minimal, framable entry rendered inside the BCC homepage iframe.
// 로그인 게이트(2026-07-10 토글): 기본 B안 = 진단 결과 직전(Chat 내부 AuthModal).
// NEXT_PUBLIC_AUTH_GATE=entry 설정 + 재배포 시 첫 화면 필수(C안) — AuthGate 참고.
export default function EmbedPage() {
  if (MAINTENANCE) return <Maintenance />;
  return (
    <AuthGate>
      <Chat />
    </AuthGate>
  );
}
