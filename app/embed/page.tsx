import type { Metadata } from "next";
import Chat from "@/components/chat/Chat";

export const metadata: Metadata = {
  title: "정부지원사업 사업계획서 도우미",
};

// Minimal, framable entry rendered inside the BCC homepage iframe.
export default function EmbedPage() {
  return <Chat />;
}
