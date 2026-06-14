"use client";

import { useEffect } from "react";
import { track } from "@/lib/ga";

// 랜딩 진입 측정 (view_landing) — 1회 발화.
export default function LandingTracker() {
  useEffect(() => {
    track("view_landing");
  }, []);
  return null;
}
