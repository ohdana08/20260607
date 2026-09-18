import type { Metadata } from "next";
import { headers } from "next/headers";
import OperationsDashboard from "./OperationsDashboard";
import { isLocalOperationsRequest } from "@/lib/operations/http";
import { kstDate } from "@/lib/operations/domain";
import "./operations.css";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "딱지원핏 운영",
  robots: { index: false, follow: false },
};
export default async function OperationsPage() {
  const h = await headers();
  const host = h.get("host") ?? "invalid";
  const local = isLocalOperationsRequest(
    new Request(`http://${host}/operations`),
  );
  return (
    <OperationsDashboard local={local} initialMonth={kstDate().slice(0, 7)} />
  );
}
