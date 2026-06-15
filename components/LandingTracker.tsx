"use client";

import { useEffect } from "react";
import { track } from "@/lib/ga";
import { captureUtm } from "@/lib/utm";

// 랜딩 진입 측정 (view_landing) + UTM 캡처(sessionStorage).
// 랜딩(/)으로 들어와 /embed 로 이동해도 UTM이 유지되게 여기서 먼저 잡아둔다.
export default function LandingTracker() {
  useEffect(() => {
    captureUtm();
    track("view_landing");
  }, []);
  return null;
}
