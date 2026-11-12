import type { Metadata } from "next";
import EntryClient from "@/components/entry/EntryClient";
import "./entry.css";

export const metadata: Metadata = {
  title: "나도 지원받을 수 있을까? | 딱, 지원핏",
  description: "연령대·지역·업력·업종 네 가지만 고르면 지금 확인할 지원사업을 찾아드려요.",
  appleWebApp: { capable: true, title: "딱, 지원핏", statusBarStyle: "default" },
  icons: { apple: "/pwa/icon-192.png" },
};
export default function DiscoverPage() { return <EntryClient />; }
